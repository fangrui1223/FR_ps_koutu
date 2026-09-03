from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from . import BACKEND_VERSION, MODEL_ID, PROTOCOL_VERSION
from .adapters import InferenceAdapter
from .errors import ServiceError
from .validation import InferRequest, parse_infer_request


@dataclass(frozen=True, slots=True)
class CachedResponse:
    body_hash: str
    response: dict[str, Any]


class InferenceService:
    def __init__(self, session_root: Path, adapter: InferenceAdapter, cache_size: int = 128):
        self.session_root = session_root.resolve()
        self.session_root.mkdir(parents=True, exist_ok=True)
        self.adapter = adapter
        self.cache_size = cache_size
        self._cache: OrderedDict[str, CachedResponse] = OrderedDict()
        self._lock = threading.Lock()
        self.last_activity = time.monotonic()

    def health(self) -> dict[str, Any]:
        self.last_activity = time.monotonic()
        return {
            "status": "ok",
            "protocolVersion": PROTOCOL_VERSION,
            "backendVersion": BACKEND_VERSION,
            "modelId": MODEL_ID,
            "modelReady": self.adapter.model_ready,
        }

    def infer(self, raw: Any) -> dict[str, Any]:
        request = parse_infer_request(raw, self.session_root)
        body_hash = hashlib.sha256(request.canonical_json.encode("utf-8")).hexdigest()
        self.last_activity = time.monotonic()

        with self._lock:
            cached = self._cache.get(request.request_id)
            if cached is not None:
                if cached.body_hash != body_hash:
                    raise ServiceError(
                        "REQUEST_ID_CONFLICT",
                        "The requestId was reused with different request data.",
                        http_status=409,
                        retryable=False,
                    )
                self._cache.move_to_end(request.request_id)
                return cached.response

            response = self._run_adapter(request)
            self._cache[request.request_id] = CachedResponse(body_hash, response)
            while len(self._cache) > self.cache_size:
                self._cache.popitem(last=False)
            self.last_activity = time.monotonic()
            return response

    def _run_adapter(self, request: InferRequest) -> dict[str, Any]:
        result = self.adapter.infer(request)
        return {
            "status": "ok",
            "requestId": request.request_id,
            "selected": {"prompt": result.prompt, "score": result.score},
            "mask": {
                "file": request.output_relative_file,
                "encoding": request.output_encoding,
                "width": request.input.width,
                "height": request.input.height,
                "bounds": request.input.bounds.as_dict(),
            },
            "selectedPixels": result.selected_pixels,
            "timingsMs": result.timings_ms,
        }


def decode_json(body: bytes) -> Any:
    try:
        return json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ServiceError(
            "INVALID_REQUEST",
            "Request body must be valid UTF-8 JSON.",
            http_status=400,
            retryable=False,
        ) from error
