from __future__ import annotations

import argparse
import http.client
import json
import tempfile
import threading
import time
from pathlib import Path

from sam31_backend import MODEL_ID
from sam31_backend.adapters import AlphaProxyAdapter
from sam31_backend.server import create_server


TOKEN = "stress-token-0123456789abcdef0123456789abcdef0123456789abcdef"


def request_body(request_id: str) -> dict[str, object]:
    return {
        "schemaVersion": 1,
        "requestId": request_id,
        "modelId": MODEL_ID,
        "prompts": ["pants"],
        "threshold": 0.5,
        "document": {"width": 2, "height": 2, "resolution": 300.0},
        "input": {
            "file": f"{request_id}/input.rgba8",
            "encoding": "rgba8",
            "width": 2,
            "height": 2,
            "bounds": {"left": 0, "top": 0, "right": 2, "bottom": 2},
        },
        "roi": None,
        "output": {"file": f"{request_id}/mask.gray8", "encoding": "gray8"},
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run 1000 sequential HTTP requests")
    parser.add_argument("--count", type=int, default=1000)
    args = parser.parse_args()
    if args.count < 1:
        raise SystemExit("--count must be positive")

    with tempfile.TemporaryDirectory(prefix="fr-sam-stress-") as temporary:
        root = Path(temporary)
        server = create_server(0, TOKEN, root, AlphaProxyAdapter())
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        port = server.server_address[1]
        started = time.perf_counter()
        try:
            for index in range(args.count):
                request_id = f"stress-{index:06d}"
                request_dir = root / request_id
                request_dir.mkdir()
                request_dir.joinpath("input.rgba8").write_bytes(
                    bytes([10, 20, 30, 255] * 4)
                )
                payload = json.dumps(request_body(request_id)).encode("utf-8")
                connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                connection.request(
                    "POST",
                    "/v1/infer",
                    body=payload,
                    headers={
                        "Authorization": f"Bearer {TOKEN}",
                        "Content-Type": "application/json",
                        "Content-Length": str(len(payload)),
                    },
                )
                response = connection.getresponse()
                body = json.loads(response.read().decode("utf-8"))
                connection.close()
                if response.status != 200 or body.get("status") != "ok":
                    raise RuntimeError(
                        f"request {index} failed: HTTP {response.status} {body}"
                    )
                mask = request_dir.joinpath("mask.gray8").read_bytes()
                if mask != bytes([255] * 4):
                    raise RuntimeError(f"request {index} produced an invalid mask")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)

        elapsed = time.perf_counter() - started
        print(
            json.dumps(
                {
                    "status": "ok",
                    "requests": args.count,
                    "elapsedSeconds": round(elapsed, 3),
                    "requestsPerSecond": round(args.count / elapsed, 2),
                },
                separators=(",", ":"),
            )
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
