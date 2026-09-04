from __future__ import annotations

import argparse
import ctypes
import json
import os
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

from .adapters import AlphaProxyAdapter, InferenceAdapter
from .diagnostics import event as diagnostic_event
from .errors import ServiceError
from .service import InferenceService, decode_json
from .validation import MAX_JSON_BYTES


class Sam31HttpServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = False

    def __init__(self, address: tuple[str, int], token: str, service: InferenceService):
        if address[0] != "127.0.0.1":
            raise ValueError("The backend may only bind to 127.0.0.1.")
        self.token = token
        self.service = service
        super().__init__(address, Sam31RequestHandler)


class Sam31RequestHandler(BaseHTTPRequestHandler):
    server: Sam31HttpServer
    protocol_version = "HTTP/1.1"

    def log_message(self, format: str, *args: Any) -> None:
        return

    def _authorized(self) -> bool:
        provided = self.headers.get("Authorization", "")
        expected = f"Bearer {self.server.token}"
        return secrets.compare_digest(provided, expected)

    def _send(self, status: int, body: dict[str, Any]) -> None:
        payload = json.dumps(body, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _reject_unauthorized(self) -> bool:
        if self._authorized():
            return False
        error = ServiceError("UNAUTHORIZED", "Invalid session token.", 401, False)
        self._send(401, error.response())
        return True

    def do_GET(self) -> None:
        if self._reject_unauthorized():
            return
        if self.path != "/v1/health":
            self._send(404, ServiceError("NOT_FOUND", "Endpoint not found.", 404).response())
            return
        self._send(200, self.server.service.health())

    def do_POST(self) -> None:
        if self._reject_unauthorized():
            return
        if self.path != "/v1/infer":
            self._send(404, ServiceError("NOT_FOUND", "Endpoint not found.", 404).response())
            return

        request_id = None
        try:
            raw_length = self.headers.get("Content-Length")
            if raw_length is None:
                raise ServiceError("INVALID_REQUEST", "Content-Length is required.", 411)
            length = int(raw_length)
            if length < 2 or length > MAX_JSON_BYTES:
                raise ServiceError("INVALID_REQUEST", "Request body size is invalid.", 400)
            raw = decode_json(self.rfile.read(length))
            if isinstance(raw, dict) and isinstance(raw.get("requestId"), str):
                request_id = raw["requestId"]
            response = self.server.service.infer(raw)
            self._send(200, response)
            diagnostic_event(
                "inference",
                status="ok",
                durationMs=round(float(response.get("timingsMs", {}).get("total", 0.0)), 2),
                modelReady=self.server.service.adapter.model_ready,
            )
        except ServiceError as error:
            diagnostic_event(
                "inference", status="error", code=error.code, retryable=error.retryable
            )
            self._send(error.http_status, error.response(request_id))
        except (ValueError, OSError) as error:
            service_error = ServiceError(
                "INVALID_REQUEST", str(error), http_status=400, retryable=False
            )
            self._send(service_error.http_status, service_error.response(request_id))
        except Exception:
            service_error = ServiceError(
                "INFERENCE_FAILED",
                "The backend encountered an internal error.",
                http_status=500,
                retryable=True,
            )
            diagnostic_event("inference", status="error", code=service_error.code, retryable=True)
            self._send(500, service_error.response(request_id))


def create_server(
    port: int,
    token: str,
    session_root: Path,
    adapter: InferenceAdapter,
) -> Sam31HttpServer:
    if len(token.encode("utf-8")) < 32:
        raise ValueError("Session token must contain at least 32 bytes.")
    return Sam31HttpServer(
        ("127.0.0.1", port), token, InferenceService(session_root, adapter)
    )


def _read_and_remove_token(path: Path) -> str:
    token = path.read_text(encoding="utf-8").strip()
    try:
        path.unlink()
    except OSError:
        pass
    if len(token.encode("utf-8")) < 32:
        raise ValueError("Token file must contain at least 32 bytes.")
    return token


def _parent_alive(parent_pid: int) -> bool:
    if parent_pid <= 0:
        return True
    if os.name == "nt":
        process_query_limited_information = 0x1000
        handle = ctypes.windll.kernel32.OpenProcess(
            process_query_limited_information, False, parent_pid
        )
        if not handle:
            return False
        ctypes.windll.kernel32.CloseHandle(handle)
        return True
    try:
        os.kill(parent_pid, 0)
        return True
    except OSError:
        return False


def _write_ready_file(session_root: Path, relative_name: str, port: int) -> None:
    path = (session_root / relative_name).resolve()
    path.relative_to(session_root.resolve())
    payload = {"status": "ready", "port": port, "pid": os.getpid()}
    partial = path.with_name(path.name + ".partial")
    partial.write_text(json.dumps(payload), encoding="utf-8")
    os.replace(partial, path)


def run_server(args: argparse.Namespace) -> int:
    session_root = args.session_root.resolve()
    session_root.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_HUB_OFFLINE", "1")
    os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")
    token = _read_and_remove_token(args.token_file.resolve())
    if args.mock_alpha:
        adapter: InferenceAdapter = AlphaProxyAdapter()
    else:
        if args.model_checkpoint is None:
            raise RuntimeError("--model-checkpoint is required outside mock mode.")
        from .meta_adapter import MetaSam31Adapter

        adapter = MetaSam31Adapter(args.model_checkpoint, args.official_sam3_root)
    server = create_server(args.port, token, session_root, adapter)
    server.timeout = 0.5
    _write_ready_file(session_root, args.ready_file, server.server_address[1])
    diagnostic_event("backend", status="ready", modelReady=adapter.model_ready)

    try:
        while True:
            server.handle_request()
            if not _parent_alive(args.parent_pid):
                return 0
            idle_for = time.monotonic() - server.service.last_activity
            if args.idle_seconds > 0 and idle_for >= args.idle_seconds:
                return 0
    finally:
        diagnostic_event("backend", status="stopped", modelReady=adapter.model_ready)
        server.server_close()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="SAM 3.1 Photoshop local backend")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--session-root", type=Path, required=True)
    parser.add_argument("--token-file", type=Path, required=True)
    parser.add_argument("--ready-file", default="backend-ready.json")
    parser.add_argument("--parent-pid", type=int, default=0)
    parser.add_argument("--idle-seconds", type=float, default=120.0)
    parser.add_argument("--mock-alpha", action="store_true")
    parser.add_argument("--model-checkpoint", type=Path)
    parser.add_argument("--official-sam3-root", type=Path)
    return parser


def main() -> int:
    return run_server(build_parser().parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
