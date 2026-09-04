from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path, PurePath
from typing import Any

from . import MODEL_ID, PROTOCOL_VERSION
from .errors import ServiceError

MAX_JSON_BYTES = 1024 * 1024
MAX_PIXELS = 8000 * 12000
MAX_SIDE = 12000
MAX_PROMPTS = 5
PROMPT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9 '\-/]*$")
REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$")


@dataclass(frozen=True, slots=True)
class Bounds:
    left: int
    top: int
    right: int
    bottom: int

    @property
    def width(self) -> int:
        return self.right - self.left

    @property
    def height(self) -> int:
        return self.bottom - self.top

    def as_dict(self) -> dict[str, int]:
        return {
            "left": self.left,
            "top": self.top,
            "right": self.right,
            "bottom": self.bottom,
        }


@dataclass(frozen=True, slots=True)
class Plane:
    relative_file: str
    path: Path
    encoding: str
    width: int
    height: int
    bounds: Bounds


@dataclass(frozen=True, slots=True)
class InferRequest:
    request_id: str
    model_id: str
    prompts: tuple[str, ...]
    threshold: float
    document_width: int
    document_height: int
    document_resolution: float
    input: Plane
    roi: Plane | None
    output_relative_file: str
    output_path: Path
    output_encoding: str
    canonical_json: str


def _fail(code: str, message: str, *, status: int = 400) -> ServiceError:
    return ServiceError(code, message, http_status=status, retryable=False)


def _object(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise _fail("INVALID_REQUEST", f"{name} must be an object.")
    return value


def _integer(value: Any, name: str, minimum: int, maximum: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise _fail("INVALID_REQUEST", f"{name} must be an integer.")
    if value < minimum or value > maximum:
        raise _fail("INVALID_REQUEST", f"{name} is outside the supported range.")
    return value


def _bounds(raw: Any, name: str) -> Bounds:
    obj = _object(raw, name)
    values = {}
    for key in ("left", "top", "right", "bottom"):
        values[key] = _integer(obj.get(key), f"{name}.{key}", -1_000_000, 1_000_000)
    result = Bounds(**values)
    if result.width <= 0 or result.height <= 0:
        raise _fail("INVALID_REQUEST", f"{name} must have positive dimensions.")
    return result


def resolve_session_file(session_root: Path, relative_name: Any) -> tuple[str, Path]:
    if not isinstance(relative_name, str) or not relative_name or len(relative_name) > 260:
        raise _fail("INVALID_REQUEST", "File path must be a non-empty relative string.")
    pure = PurePath(relative_name)
    if pure.is_absolute() or pure.drive or any(part in {"", ".", ".."} for part in pure.parts):
        raise _fail("PATH_OUTSIDE_SESSION", "File path must stay inside the session directory.")
    root = session_root.resolve()
    resolved = (root / Path(*pure.parts)).resolve()
    try:
        resolved.relative_to(root)
    except ValueError as error:
        raise _fail("PATH_OUTSIDE_SESSION", "File path escaped the session directory.") from error
    return relative_name.replace("\\", "/"), resolved


def _plane(
    raw: Any,
    name: str,
    session_root: Path,
    expected_encodings: dict[str, int | None],
    *,
    must_exist: bool,
) -> Plane:
    obj = _object(raw, name)
    relative_file, path = resolve_session_file(session_root, obj.get("file"))
    encoding = obj.get("encoding")
    if encoding not in expected_encodings:
        choices = " or ".join(expected_encodings)
        raise _fail("INVALID_REQUEST", f"{name}.encoding must be {choices}.")
    width = _integer(obj.get("width"), f"{name}.width", 1, 12000)
    height = _integer(obj.get("height"), f"{name}.height", 1, 12000)
    if width * height > MAX_PIXELS:
        raise _fail("INVALID_REQUEST", f"{name} exceeds the 96 MP limit.")
    bounds = _bounds(obj.get("bounds"), f"{name}.bounds")
    if bounds.width != width or bounds.height != height:
        raise _fail("INVALID_REQUEST", f"{name} dimensions do not match its bounds.")
    if must_exist:
        if not path.is_file():
            raise _fail("INVALID_REQUEST", f"{name} file does not exist.")
        components = expected_encodings[encoding]
        if components is not None:
            expected_size = width * height * components
            if path.stat().st_size != expected_size:
                raise _fail(
                    "INPUT_SIZE_MISMATCH",
                    f"{name} file size does not match its dimensions.",
                )
        else:
            try:
                from PIL import Image

                with Image.open(path) as image:
                    if image.format != "PNG" or image.size != (width, height):
                        raise _fail(
                            "INPUT_SIZE_MISMATCH",
                            f"{name} PNG does not match its declared dimensions.",
                        )
                    if encoding == "png-alpha8" and "A" not in image.getbands():
                        raise _fail("INVALID_REQUEST", f"{name} PNG must contain an alpha channel.")
            except ServiceError:
                raise
            except (OSError, ValueError) as error:
                raise _fail("INVALID_REQUEST", f"{name} is not a valid PNG file.") from error
    return Plane(relative_file, path, encoding, width, height, bounds)


def parse_infer_request(raw: Any, session_root: Path) -> InferRequest:
    request = _object(raw, "request")
    if request.get("schemaVersion") != PROTOCOL_VERSION:
        raise _fail("UNSUPPORTED_SCHEMA", "Only protocol schema version 1 is supported.")

    request_id = request.get("requestId")
    if not isinstance(request_id, str) or not REQUEST_ID_RE.fullmatch(request_id):
        raise _fail("INVALID_REQUEST", "requestId has an invalid format.")

    model_id = request.get("modelId")
    if model_id != MODEL_ID:
        raise _fail("UNSUPPORTED_MODEL", f"Unsupported modelId: {model_id!r}.")

    raw_prompts = request.get("prompts")
    if not isinstance(raw_prompts, list) or not 1 <= len(raw_prompts) <= MAX_PROMPTS:
        raise _fail("INVALID_REQUEST", "prompts must contain between 1 and 5 items.")
    prompts: list[str] = []
    seen: set[str] = set()
    for raw_prompt in raw_prompts:
        if not isinstance(raw_prompt, str):
            raise _fail("INVALID_REQUEST", "Each prompt must be a string.")
        prompt = " ".join(raw_prompt.strip().split())
        if not 1 <= len(prompt) <= 120 or not PROMPT_RE.fullmatch(prompt):
            raise _fail("INVALID_REQUEST", "Prompts support English text and basic punctuation only.")
        key = prompt.casefold()
        if key in seen:
            raise _fail("INVALID_REQUEST", "prompts must already be normalized and unique.")
        seen.add(key)
        prompts.append(prompt)

    threshold_value = request.get("threshold")
    if isinstance(threshold_value, bool) or not isinstance(threshold_value, (int, float)):
        raise _fail("INVALID_REQUEST", "threshold must be numeric.")
    threshold = float(threshold_value)
    if not 0.05 <= threshold <= 0.95:
        raise _fail("INVALID_REQUEST", "threshold must be between 0.05 and 0.95.")

    document = _object(request.get("document"), "document")
    document_width = _integer(document.get("width"), "document.width", 1, MAX_SIDE)
    document_height = _integer(document.get("height"), "document.height", 1, MAX_SIDE)
    resolution_value = document.get("resolution", 72.0)
    if isinstance(resolution_value, bool) or not isinstance(resolution_value, (int, float)):
        raise _fail("INVALID_REQUEST", "document.resolution must be numeric.")
    document_resolution = float(resolution_value)
    if not 1.0 <= document_resolution <= 1200.0:
        raise _fail("INVALID_REQUEST", "document.resolution is outside the supported range.")

    if document_width * document_height > MAX_PIXELS:
        raise _fail("INVALID_REQUEST", "Document exceeds the 96 MP limit.")
    input_plane = _plane(
        request.get("input"),
        "input",
        session_root,
        {"rgba8": 4, "png-rgba8": None},
        must_exist=True,
    )
    if (
        input_plane.bounds.left < 0
        or input_plane.bounds.top < 0
        or input_plane.bounds.right > document_width
        or input_plane.bounds.bottom > document_height
    ):
        raise _fail("INVALID_REQUEST", "input.bounds must stay inside the document.")

    roi_value = request.get("roi")
    roi_plane = None
    if roi_value is not None:
        roi_plane = _plane(
            roi_value,
            "roi",
            session_root,
            {"gray8": 1, "png-alpha8": None},
            must_exist=True,
        )
        if (
            roi_plane.bounds.left < 0
            or roi_plane.bounds.top < 0
            or roi_plane.bounds.right > document_width
            or roi_plane.bounds.bottom > document_height
        ):
            raise _fail("INVALID_REQUEST", "roi.bounds must stay inside the document.")

    output = _object(request.get("output"), "output")
    output_encoding = output.get("encoding")
    if output_encoding not in {"gray8", "png-alpha8"}:
        raise _fail("INVALID_REQUEST", "output.encoding must be gray8 or png-alpha8.")
    output_relative_file, output_path = resolve_session_file(session_root, output.get("file"))
    if output_path == input_plane.path or (roi_plane and output_path == roi_plane.path):
        raise _fail("INVALID_REQUEST", "Output must not overwrite an input file.")

    canonical_json = json.dumps(request, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return InferRequest(
        request_id=request_id,
        model_id=model_id,
        prompts=tuple(prompts),
        threshold=threshold,
        document_width=document_width,
        document_height=document_height,
        document_resolution=document_resolution,
        input=input_plane,
        roi=roi_plane,
        output_relative_file=output_relative_file,
        output_path=output_path,
        output_encoding=output_encoding,
        canonical_json=canonical_json,
    )
