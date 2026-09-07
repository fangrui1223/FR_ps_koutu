import argparse
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from sam31_backend import legacy_bridge
from sam31_backend.service import InferenceService
from sam31_backend.server import _parent_alive


class LifecycleTests(unittest.TestCase):
    def test_unwritable_log_does_not_emit_tracebacks(self):
        import contextlib
        import io
        import logging
        from sam31_backend.diagnostics import QuietRotatingFileHandler
        with tempfile.TemporaryDirectory() as root:
            handler = QuietRotatingFileHandler(str(Path(root) / "missing" / "log"), delay=True)
            output = io.StringIO()
            try:
                with contextlib.redirect_stderr(output):
                    handler.emit(logging.LogRecord("test", logging.INFO, "", 0, "message", (), None))
                self.assertEqual(output.getvalue(), "")
            finally:
                handler.close()

    def test_busy_service_cannot_idle_exit_and_error_resets_timer(self):
        with tempfile.TemporaryDirectory() as root:
            service = InferenceService(Path(root), object())
            started, release = threading.Event(), threading.Event()
            def blocked(raw):
                started.set()
                release.wait(2)
                raise RuntimeError("test failure")
            service._infer = blocked
            def worker():
                with self.assertRaises(RuntimeError):
                    service.infer({})
            thread = threading.Thread(target=worker)
            thread.start()
            self.assertTrue(started.wait(2))
            service.last_activity = time.monotonic() - 1000
            self.assertFalse(service.is_idle(120))
            release.set()
            thread.join(2)
            self.assertFalse(thread.is_alive())
            self.assertFalse(service.is_idle(120))
            service.last_activity -= 1000
            self.assertTrue(service.is_idle(120))
            self.assertFalse(service.is_idle(0))

    def test_legacy_startup_failure_is_retried_once(self):
        with tempfile.TemporaryDirectory() as root:
            folder = Path(root)
            request = folder / "request.json"
            request.write_text('{"requestId":"request-test"}')
            args = argparse.Namespace(session_root=folder, request_file=request, response_file=folder / "response.json")
            with patch.object(legacy_bridge, "_endpoint", side_effect=[RuntimeError("startup failed"), (1234, "t", 1)]) as endpoint, \
                 patch.object(legacy_bridge, "_http", return_value=(200, {"status": "ok"})), \
                 patch.object(legacy_bridge, "_stop_endpoint"):
                self.assertEqual(legacy_bridge.run(args), 0)
                self.assertEqual(endpoint.call_count, 2)

    def test_legacy_health_timeout_is_short(self):
        with patch.object(legacy_bridge.http.client, "HTTPConnection") as connection:
            connection.return_value.getresponse.return_value.read.return_value = b'{}'
            legacy_bridge._http(1234, "token", "GET", "/v1/health")
            self.assertEqual(connection.call_args.kwargs["timeout"], 5)

    def test_parent_liveness_uses_current_process(self):
        import os
        self.assertTrue(_parent_alive(os.getpid()))
