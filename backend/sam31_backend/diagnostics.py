from __future__ import annotations

import json
import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

_LOGGER_NAME = "fr_sam"
_ALLOWED_FIELDS = {
    "backendVersion",
    "code",
    "durationMs",
    "event",
    "modelReady",
    "retryable",
    "stage",
    "status",
}
_logger: logging.Logger | None = None


class QuietRotatingFileHandler(RotatingFileHandler):
    def handleError(self, record: logging.LogRecord) -> None:
        # Permission/disk/rotation failures are non-fatal. Never dump private
        # local paths and a traceback for every image in a long batch.
        return


def _log_root() -> Path:
    local = os.environ.get("LOCALAPPDATA")
    base = Path(local) if local else Path(os.environ.get("TEMP", "."))
    return base / "FR" / "FR SAM Text Selection" / "Logs"


def logger() -> logging.Logger:
    global _logger
    if _logger is not None:
        return _logger
    instance = logging.getLogger(_LOGGER_NAME)
    instance.setLevel(logging.INFO)
    instance.propagate = False
    if not instance.handlers:
        root = _log_root()
        root.mkdir(parents=True, exist_ok=True)
        handler = QuietRotatingFileHandler(
            root / "backend.log",
            maxBytes=512 * 1024,
            backupCount=2,
            encoding="utf-8",
            delay=True,
        )
        handler.setFormatter(logging.Formatter("%(message)s"))
        instance.addHandler(handler)
    _logger = instance
    return instance


def event(name: str, **fields: Any) -> None:
    safe: dict[str, Any] = {"event": str(name)}
    for key, value in fields.items():
        if key in _ALLOWED_FIELDS and value is not None:
            safe[key] = value
    try:
        logger().info(json.dumps(safe, ensure_ascii=True, separators=(",", ":")))
    except (OSError, ValueError, TypeError):
        # Diagnostics must never change the result of a Photoshop command.
        return
