from __future__ import annotations

import argparse
import json
import shutil
import tempfile
import time
from pathlib import Path

from PIL import Image, ImageOps

from sam31_backend import MODEL_ID
from sam31_backend.meta_adapter import MetaSam31Adapter
from sam31_backend.service import InferenceService


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run one warm SAM 3.1 adapter across a folder of real images."
    )
    parser.add_argument("--images", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--official-sam3-root", type=Path, required=True)
    parser.add_argument("--prompt", default="pants,trousers")
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--report", type=Path)
    args = parser.parse_args()

    prompts = [item.strip() for item in args.prompt.split(",") if item.strip()]
    paths = sorted(
        path
        for path in args.images.rglob("*")
        if path.is_file() and path.suffix.lower() in {".jpg", ".jpeg", ".png", ".tif", ".tiff"}
    )
    if not paths:
        raise SystemExit("No supported images found.")

    adapter = MetaSam31Adapter(args.model.resolve(), args.official_sam3_root.resolve())
    items: list[dict[str, object]] = []
    started = time.perf_counter()
    with tempfile.TemporaryDirectory(prefix="fr-sam-real-") as temporary:
        root = Path(temporary)
        service = InferenceService(root, adapter, cache_size=2)
        for index, path in enumerate(paths):
            request_id = f"real-{index:04d}"
            request_dir = root / request_id
            request_dir.mkdir()
            input_path = request_dir / "input.png"
            with Image.open(path) as source:
                image = ImageOps.exif_transpose(source).convert("RGBA")
                width, height = image.size
                dpi = float(source.info.get("dpi", (72.0, 72.0))[0] or 72.0)
                image.save(input_path, format="PNG", compress_level=1)

            request = {
                "schemaVersion": 1,
                "requestId": request_id,
                "modelId": MODEL_ID,
                "prompts": prompts,
                "threshold": args.threshold,
                "document": {"width": width, "height": height, "resolution": dpi},
                "input": {
                    "file": f"{request_id}/input.png",
                    "encoding": "png-rgba8",
                    "width": width,
                    "height": height,
                    "bounds": {"left": 0, "top": 0, "right": width, "bottom": height},
                },
                "roi": None,
                "output": {
                    "file": f"{request_id}/mask.png",
                    "encoding": "png-alpha8",
                },
            }
            item_started = time.perf_counter()
            try:
                response = service.infer(request)
                with Image.open(request_dir / "mask.png") as mask_image:
                    alpha = mask_image.getchannel("A")
                    histogram = alpha.histogram()
                    nonzero = sum(histogram[1:])
                    soft = sum(histogram[1:255])
                items.append(
                    {
                        "file": path.name,
                        "status": "ok",
                        "score": response["selected"]["score"],
                        "selectedPrompt": response["selected"]["prompt"],
                        "nonzeroPixels": nonzero,
                        "softPixels": soft,
                        "elapsedMs": round((time.perf_counter() - item_started) * 1000, 2),
                    }
                )
            except Exception as error:
                items.append(
                    {
                        "file": path.name,
                        "status": "error",
                        "errorType": type(error).__name__,
                        "message": str(error),
                        "elapsedMs": round((time.perf_counter() - item_started) * 1000, 2),
                    }
                )
            finally:
                shutil.rmtree(request_dir, ignore_errors=True)

    succeeded = sum(item["status"] == "ok" for item in items)
    report = {
        "status": "ok" if succeeded == len(items) else "failed",
        "images": len(items),
        "succeeded": succeeded,
        "failed": len(items) - succeeded,
        "elapsedSeconds": round(time.perf_counter() - started, 3),
        "items": items,
    }
    text = json.dumps(report, ensure_ascii=False, indent=2)
    print(text)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(text + "\n", encoding="utf-8")
    return 0 if succeeded == len(items) else 1


if __name__ == "__main__":
    raise SystemExit(main())
