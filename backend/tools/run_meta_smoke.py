from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image

from sam31_backend import MODEL_ID
from sam31_backend.meta_adapter import MetaSam31Adapter
from sam31_backend.service import InferenceService


def main() -> None:
    parser = argparse.ArgumentParser(description="Smoke-test the production Meta SAM 3.1 adapter.")
    parser.add_argument("--official-root", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--session-root", type=Path, required=True)
    parser.add_argument("--prompt", default="black leather jacket,pants")
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--resize-width", type=int)
    parser.add_argument("--resize-height", type=int)
    parser.add_argument("--report", type=Path, required=True)
    args = parser.parse_args()

    session_root = args.session_root.resolve()
    request_id = "meta-adapter-smoke-0001"
    request_dir = session_root / request_id
    request_dir.mkdir(parents=True, exist_ok=True)
    image = Image.open(args.image.resolve()).convert("RGBA")
    if (args.resize_width is None) != (args.resize_height is None):
        raise ValueError("--resize-width and --resize-height must be supplied together")
    if args.resize_width is not None:
        image = image.resize((args.resize_width, args.resize_height), Image.Resampling.LANCZOS)
    rgba = np.asarray(image, dtype=np.uint8)
    (request_dir / "input.rgba8").write_bytes(rgba.tobytes())
    prompts = [part.strip() for part in args.prompt.split(",") if part.strip()]
    request = {
        "schemaVersion": 1,
        "requestId": request_id,
        "modelId": MODEL_ID,
        "prompts": prompts,
        "threshold": args.threshold,
        "document": {
            "width": image.width,
            "height": image.height,
            "sourcePath": str(args.image.resolve()),
        },
        "input": {
            "file": f"{request_id}/input.rgba8",
            "encoding": "rgba8",
            "width": image.width,
            "height": image.height,
            "bounds": {"left": 0, "top": 0, "right": image.width, "bottom": image.height},
        },
        "roi": None,
        "output": {"file": f"{request_id}/mask.gray8", "encoding": "gray8"},
    }
    service = InferenceService(
        session_root,
        MetaSam31Adapter(args.checkpoint.resolve(), args.official_root.resolve()),
    )
    cold_response = service.infer(request)
    warm_request = json.loads(json.dumps(request))
    warm_request["requestId"] = "meta-adapter-smoke-0002"
    warm_request["output"]["file"] = "meta-adapter-smoke-0002/mask.gray8"
    warm_response = service.infer(warm_request)
    mask = np.fromfile(request_dir / "mask.gray8", dtype=np.uint8).reshape(image.height, image.width)
    Image.fromarray(mask, mode="L").save(request_dir / "mask.png")
    report = {
        "coldResponse": cold_response,
        "warmResponse": warm_response,
        "maskPng": str((request_dir / "mask.png").resolve()),
        "officialSourceRoot": str(args.official_root.resolve()),
        "usesComfyUI": False,
    }
    rendered = json.dumps(report, indent=2, ensure_ascii=False)
    print(rendered)
    args.report.resolve().parent.mkdir(parents=True, exist_ok=True)
    args.report.resolve().write_text(rendered + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
