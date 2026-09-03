from __future__ import annotations

import os
import time
from io import BytesIO
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from .errors import ServiceError
from .validation import InferRequest


@dataclass(frozen=True, slots=True)
class AdapterResult:
    prompt: str
    score: float
    selected_pixels: int
    timings_ms: dict[str, float]


class InferenceAdapter(Protocol):
    @property
    def model_ready(self) -> bool: ...

    def infer(self, request: InferRequest) -> AdapterResult: ...


class AlphaProxyAdapter:
    """Development-only adapter used to verify transport and selection semantics."""

    @property
    def model_ready(self) -> bool:
        return False

    def infer(self, request: InferRequest) -> AdapterResult:
        started = time.perf_counter()
        if request.input.encoding == "rgba8":
            rgba = request.input.path.read_bytes()
        else:
            from PIL import Image

            with Image.open(request.input.path) as image:
                rgba = image.convert("RGBA").tobytes()
        width = request.input.width
        height = request.input.height
        bounds = request.input.bounds
        mask = bytearray(width * height)

        for index in range(width * height):
            mask[index] = rgba[index * 4 + 3]

        if request.roi is not None:
            if request.roi.encoding == "gray8":
                roi = request.roi.path.read_bytes()
            else:
                from PIL import Image

                with Image.open(request.roi.path) as image:
                    roi = image.getchannel("A").tobytes()
            roi_bounds = request.roi.bounds
            overlap_left = max(bounds.left, roi_bounds.left)
            overlap_top = max(bounds.top, roi_bounds.top)
            overlap_right = min(bounds.right, roi_bounds.right)
            overlap_bottom = min(bounds.bottom, roi_bounds.bottom)

            if overlap_right <= overlap_left or overlap_bottom <= overlap_top:
                mask[:] = bytes(len(mask))
            else:
                for y in range(bounds.top, bounds.bottom):
                    target_row = (y - bounds.top) * width
                    if y < overlap_top or y >= overlap_bottom:
                        mask[target_row : target_row + width] = bytes(width)
                        continue
                    roi_row = (y - roi_bounds.top) * request.roi.width
                    for x in range(bounds.left, bounds.right):
                        target_index = target_row + x - bounds.left
                        if x < overlap_left or x >= overlap_right:
                            mask[target_index] = 0
                            continue
                        roi_index = roi_row + x - roi_bounds.left
                        mask[target_index] = (mask[target_index] * roi[roi_index] + 127) // 255

        selected_pixels = sum(value != 0 for value in mask)
        if selected_pixels == 0:
            raise ServiceError(
                "EMPTY_EFFECTIVE_ROI",
                "The active layer has no effective pixels inside the search selection.",
                http_status=422,
                retryable=False,
            )

        compose_done = time.perf_counter()
        _write_mask(request, mask)
        finished = time.perf_counter()
        return AdapterResult(
            prompt=request.prompts[0],
            score=1.0,
            selected_pixels=selected_pixels,
            timings_ms={
                "preprocess": 0.0,
                "inference": 0.0,
                "compose": (compose_done - started) * 1000,
                "total": (finished - started) * 1000,
            },
        )


def _atomic_write(path: Path, data: bytes | bytearray | memoryview) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".partial")
    try:
        with partial.open("wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(partial, path)
    except OSError as error:
        try:
            partial.unlink(missing_ok=True)
        except OSError:
            pass
        raise ServiceError(
            "OUTPUT_WRITE_FAILED",
            "The backend could not write the output mask.",
            http_status=500,
            retryable=True,
        ) from error


def _write_mask(request: InferRequest, data: bytes | bytearray | memoryview) -> None:
    if request.output_encoding == "gray8":
        _atomic_write(request.output_path, data)
        return
    from PIL import Image

    alpha = Image.frombytes("L", (request.input.width, request.input.height), bytes(data))
    rgba = Image.new("RGBA", alpha.size, (255, 255, 255, 0))
    rgba.putalpha(alpha)
    encoded = BytesIO()
    rgba.save(encoded, format="PNG", compress_level=1)
    _atomic_write(request.output_path, encoded.getbuffer())
