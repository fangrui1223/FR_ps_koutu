from __future__ import annotations

import argparse
import http.client
import json
import os
import secrets
import signal
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


CREATE_NO_WINDOW = 0x08000000
CREATE_NEW_PROCESS_GROUP = 0x00000200


def _atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".partial")
    partial.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(partial, path)


def _http(port: int, token: str, method: str, path: str, body: dict[str, Any] | None = None):
    payload = None if body is None else json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    headers = {"Authorization": f"Bearer {token}"}
    if payload is not None:
        headers.update({"Content-Type": "application/json", "Content-Length": str(len(payload))})
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=10 * 60)
    try:
        connection.request(method, path, body=payload, headers=headers)
        response = connection.getresponse()
        raw = response.read()
        return response.status, json.loads(raw.decode("utf-8"))
    finally:
        connection.close()


def _read_endpoint(path: Path, session_root: Path) -> tuple[int, str, int] | None:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if value.get("sessionRoot") != str(session_root):
            return None
        port = int(value["port"])
        token = str(value["token"])
        pid = int(value["pid"])
        if not 1 <= port <= 65535 or len(token.encode("utf-8")) < 32 or pid <= 0:
            return None
        status, body = _http(port, token, "GET", "/v1/health")
        if status == 200 and body.get("status") == "ok":
            return port, token, pid
    except (OSError, ValueError, KeyError, json.JSONDecodeError, ConnectionError, TimeoutError):
        return None
    return None


def _stop_endpoint(endpoint: tuple[int, str, int] | None, endpoint_file: Path) -> None:
    if endpoint is not None:
        try:
            os.kill(endpoint[2], signal.SIGTERM)
        except OSError:
            pass
    try:
        endpoint_file.unlink()
    except OSError:
        pass


def _start_backend(args: argparse.Namespace, endpoint_file: Path) -> tuple[int, str, int]:
    token = secrets.token_hex(32)
    nonce = f"{os.getpid()}-{time.time_ns()}"
    token_file = args.session_root / f"legacy-token-{nonce}.txt"
    ready_name = f"legacy-ready-{nonce}.json"
    ready_file = args.session_root / ready_name
    token_file.write_text(token, encoding="utf-8")
    command = [
        sys.executable,
        "-m",
        "sam31_backend.server",
        "--port",
        "0",
        "--session-root",
        str(args.session_root),
        "--token-file",
        str(token_file),
        "--ready-file",
        ready_name,
        "--parent-pid",
        "0",
        "--idle-seconds",
        str(args.idle_seconds),
    ]
    if args.mock_alpha:
        command.append("--mock-alpha")
    else:
        command.extend(["--model-checkpoint", str(args.model_checkpoint)])
        command.extend(["--official-sam3-root", str(args.official_sam3_root)])
    process = subprocess.Popen(
        command,
        cwd=Path(__file__).resolve().parents[1],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        creationflags=CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        close_fds=True,
    )
    deadline = time.monotonic() + 90
    try:
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError("The local SAM 3.1 backend exited during startup.")
            if ready_file.is_file():
                ready = json.loads(ready_file.read_text(encoding="utf-8"))
                port = int(ready["port"])
                endpoint = (port, token, process.pid)
                status, body = _http(port, token, "GET", "/v1/health")
                if status != 200 or body.get("status") != "ok":
                    raise RuntimeError("The local SAM 3.1 backend failed its health check.")
                _atomic_json(
                    endpoint_file,
                    {"port": port, "token": token, "pid": process.pid, "sessionRoot": str(args.session_root)},
                )
                return endpoint
            time.sleep(0.05)
        raise RuntimeError("The local SAM 3.1 backend did not become ready.")
    except Exception:
        process.kill()
        raise
    finally:
        for path in (token_file, ready_file):
            try:
                path.unlink()
            except OSError:
                pass


def _endpoint(args: argparse.Namespace, endpoint_file: Path) -> tuple[int, str, int]:
    existing = _read_endpoint(endpoint_file, args.session_root)
    if existing is not None:
        return existing
    _stop_endpoint(None, endpoint_file)
    return _start_backend(args, endpoint_file)


def run(args: argparse.Namespace) -> int:
    args.session_root = args.session_root.resolve()
    args.session_root.mkdir(parents=True, exist_ok=True)
    request = json.loads(args.request_file.read_text(encoding="utf-8"))
    endpoint_file = args.session_root / "legacy-endpoint.json"

    last_error: Exception | None = None
    for attempt in range(2):
        endpoint = None
        try:
            endpoint = _endpoint(args, endpoint_file)
            status, response = _http(endpoint[0], endpoint[1], "POST", "/v1/infer", request)
            if status < 500:
                _atomic_json(args.response_file, response)
                return 0
            last_error = RuntimeError("The backend returned a technical failure.")
        except (OSError, ValueError, KeyError, json.JSONDecodeError, ConnectionError, TimeoutError) as error:
            last_error = error
        _stop_endpoint(endpoint, endpoint_file)
        if attempt == 0:
            continue
    raise RuntimeError("Backend inference failed after one automatic restart.") from last_error


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="SAM 3.1 Photoshop ExtendScript bridge")
    parser.add_argument("--session-root", type=Path, required=True)
    parser.add_argument("--request-file", type=Path, required=True)
    parser.add_argument("--response-file", type=Path, required=True)
    parser.add_argument("--model-checkpoint", type=Path)
    parser.add_argument("--official-sam3-root", type=Path)
    parser.add_argument("--idle-seconds", type=float, default=120.0)
    parser.add_argument("--mock-alpha", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if not args.mock_alpha and (args.model_checkpoint is None or args.official_sam3_root is None):
        raise SystemExit("--model-checkpoint and --official-sam3-root are required")
    try:
        return run(args)
    except Exception as error:
        request_id = "unknown"
        try:
            request_id = str(json.loads(args.request_file.read_text(encoding="utf-8")).get("requestId", request_id))
        except Exception:
            pass
        _atomic_json(
            args.response_file,
            {
                "schemaVersion": 1,
                "requestId": request_id,
                "status": "error",
                "error": {
                    "code": "TECHNICAL_FAILURE",
                    "message": str(error) or "Backend inference failed after one automatic restart.",
                },
            },
        )
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
