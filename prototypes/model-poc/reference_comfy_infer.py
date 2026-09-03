from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image


def parse_candidates(raw: str) -> list[str]:
    candidates = [part.strip() for part in raw.split(",") if part.strip()]
    if not candidates:
        raise ValueError("At least one non-empty English prompt is required.")
    if len(candidates) > 5:
        raise ValueError("At most five comma-separated candidates are supported.")
    for candidate in candidates:
        if not candidate.isascii():
            raise ValueError(f"Prompt must contain ASCII/English text only: {candidate!r}")
    return candidates


def load_image(path: Path, resize_width: int | None, resize_height: int | None) -> torch.Tensor:
    rgb = Image.open(path).convert("RGB")
    if (resize_width is None) != (resize_height is None):
        raise ValueError("--resize-width and --resize-height must be supplied together")
    if resize_width is not None and resize_height is not None:
        if resize_width <= 0 or resize_height <= 0:
            raise ValueError("resize dimensions must be positive")
        rgb = rgb.resize((resize_width, resize_height), Image.Resampling.LANCZOS)
    array = np.asarray(rgb, dtype=np.float32) / 255.0
    return torch.from_numpy(array).unsqueeze(0)


def save_mask(mask: torch.Tensor, path: Path) -> None:
    values = (mask.detach().float().cpu().clamp(0, 1).numpy() * 255.0).astype(np.uint8)
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(values, mode="L").save(path)


def synchronize() -> None:
    if torch.cuda.is_available():
        torch.cuda.synchronize()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Reference-only SAM 3.1 inference through the installed ComfyUI runtime."
    )
    parser.add_argument("--comfy-root", type=Path, default=Path(r"C:\FR_comfyui"))
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--prompt", required=True, help="One phrase or up to five comma-separated candidates.")
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--refine-iterations", type=int, default=2)
    parser.add_argument("--resize-width", type=int)
    parser.add_argument("--resize-height", type=int)
    parser.add_argument("--output-mask", type=Path, required=True)
    parser.add_argument("--output-json", type=Path, required=True)
    args = parser.parse_args()

    if not 0.0 <= args.threshold <= 1.0:
        raise ValueError("threshold must be between 0 and 1")
    candidates = parse_candidates(args.prompt)

    checkpoint_path = args.checkpoint.resolve()
    image_path = args.image.resolve()
    output_mask_path = args.output_mask.resolve()
    output_json_path = args.output_json.resolve()

    comfy_root = args.comfy_root.resolve()
    sys.path.insert(0, str(comfy_root))
    os.chdir(comfy_root)

    import folder_paths  # noqa: PLC0415
    from comfy import model_management, sd  # noqa: PLC0415
    from comfy_extras.nodes_sam3 import SAM3_Detect  # noqa: PLC0415

    image = load_image(image_path, args.resize_width, args.resize_height)
    height, width = int(image.shape[1]), int(image.shape[2])

    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.reset_peak_memory_stats()

    synchronize()
    load_started = time.perf_counter()
    model, clip, _, _ = sd.load_checkpoint_guess_config(
        str(checkpoint_path),
        output_vae=False,
        output_clip=True,
        output_clipvision=False,
        embedding_directory=folder_paths.get_folder_paths("embeddings"),
    )
    synchronize()
    model_load_seconds = time.perf_counter() - load_started

    best: dict | None = None
    timings: list[dict] = []
    for candidate in candidates:
        tokens = clip.tokenize(candidate)
        conditioning = clip.encode_from_tokens_scheduled(tokens)

        synchronize()
        started = time.perf_counter()
        output = SAM3_Detect.execute(
            model=model,
            image=image,
            conditioning=conditioning,
            threshold=args.threshold,
            refine_iterations=args.refine_iterations,
            individual_masks=True,
        )
        synchronize()
        elapsed = time.perf_counter() - started

        masks, all_boxes = output[0], output[1]
        boxes = all_boxes[0] if all_boxes else []
        timings.append({"prompt": candidate, "seconds": elapsed, "detections": len(boxes)})
        if boxes and masks.shape[0] > 0:
            score = float(boxes[0]["score"])
            if best is None or score > best["score"]:
                best = {
                    "prompt": candidate,
                    "score": score,
                    "bbox": boxes[0],
                    "mask": masks[0],
                }

    if best is None:
        raise RuntimeError("No object met the requested confidence threshold.")

    save_mask(best["mask"], output_mask_path)
    selected_pixels = int((best["mask"] > 0).sum().item())
    peak_vram = int(torch.cuda.max_memory_allocated()) if torch.cuda.is_available() else 0
    device = str(model_management.get_torch_device())

    report = {
        "status": "PASS",
        "referenceOnly": True,
        "distributionWarning": "Uses the local ComfyUI GPL implementation only as a compatibility oracle; do not ship this code in the closed backend.",
        "checkpoint": str(checkpoint_path),
        "image": str(image_path),
        "imageSize": {"width": width, "height": height},
        "sourceWasResizedForBenchmark": args.resize_width is not None,
        "candidates": candidates,
        "threshold": args.threshold,
        "refineIterations": args.refine_iterations,
        "modelLoadSeconds": model_load_seconds,
        "candidateTimings": timings,
        "selected": {
            "prompt": best["prompt"],
            "score": best["score"],
            "bbox": best["bbox"],
            "selectedPixels": selected_pixels,
            "selectedFraction": selected_pixels / (width * height),
        },
        "device": device,
        "peakTorchAllocatedBytes": peak_vram,
        "outputMask": str(output_mask_path),
    }
    rendered = json.dumps(report, indent=2, ensure_ascii=False)
    print(rendered)
    output_json_path.parent.mkdir(parents=True, exist_ok=True)
    output_json_path.write_text(rendered + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
