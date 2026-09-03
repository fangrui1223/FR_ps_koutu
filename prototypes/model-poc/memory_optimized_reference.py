from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from PIL import Image


MODEL_SIZE = 1008


def candidates_from(raw: str) -> list[str]:
    values = [value.strip() for value in raw.split(",") if value.strip()]
    if not values or len(values) > 5:
        raise ValueError("Supply one to five comma-separated prompt candidates.")
    if any(not value.isascii() for value in values):
        raise ValueError("Prompts must contain English/ASCII text only.")
    return values


def to_tensor(image: Image.Image) -> torch.Tensor:
    data = np.asarray(image, dtype=np.float32) / 255.0
    return torch.from_numpy(data).unsqueeze(0)


def sync() -> None:
    if torch.cuda.is_available():
        torch.cuda.synchronize()


def main() -> None:
    parser = argparse.ArgumentParser(description="Memory-bounded SAM 3.1 feasibility reference.")
    parser.add_argument("--comfy-root", type=Path, default=Path(r"C:\FR_comfyui"))
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--refine-iterations", type=int, default=2)
    parser.add_argument("--resize-width", type=int)
    parser.add_argument("--resize-height", type=int)
    parser.add_argument("--output-mask", type=Path, required=True)
    parser.add_argument("--output-json", type=Path, required=True)
    args = parser.parse_args()

    prompts = candidates_from(args.prompt)
    if not 0 <= args.threshold <= 1:
        raise ValueError("threshold must be between 0 and 1")
    if (args.resize_width is None) != (args.resize_height is None):
        raise ValueError("resize width and height must be supplied together")

    checkpoint_path = args.checkpoint.resolve()
    image_path = args.image.resolve()
    output_mask_path = args.output_mask.resolve()
    output_json_path = args.output_json.resolve()
    comfy_root = args.comfy_root.resolve()

    sys.path.insert(0, str(comfy_root))
    os.chdir(comfy_root)
    import folder_paths  # noqa: PLC0415
    from comfy import model_management, sd  # noqa: PLC0415
    from comfy_extras.nodes_sam3 import _extract_text_prompts  # noqa: PLC0415

    source = Image.open(image_path).convert("RGB")
    if args.resize_width is not None:
        if args.resize_width <= 0 or args.resize_height <= 0:
            raise ValueError("resize dimensions must be positive")
        source = source.resize((args.resize_width, args.resize_height), Image.Resampling.LANCZOS)
    width, height = source.size
    detector_image = source.resize((MODEL_SIZE, MODEL_SIZE), Image.Resampling.BILINEAR)
    detector_tensor = to_tensor(detector_image)

    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.reset_peak_memory_stats()

    sync()
    total_started = time.perf_counter()
    load_started = time.perf_counter()
    model, clip, _, _ = sd.load_checkpoint_guess_config(
        str(checkpoint_path),
        output_vae=False,
        output_clip=True,
        output_clipvision=False,
        embedding_directory=folder_paths.get_folder_paths("embeddings"),
    )
    model_management.load_model_gpu(model)
    device = model_management.get_torch_device()
    dtype = model.model.get_dtype()
    sam3_model = model.model.diffusion_model
    frame = detector_tensor[..., :3].movedim(-1, 1).to(device=device, dtype=dtype)
    sync()
    model_load_seconds = time.perf_counter() - load_started

    best: dict | None = None
    detection_timings: list[dict] = []
    for prompt in prompts:
        conditioning = clip.encode_from_tokens_scheduled(clip.tokenize(prompt))
        text_embeddings, text_mask, _ = _extract_text_prompts(conditioning, device, dtype)[0]
        sync()
        started = time.perf_counter()
        result = sam3_model(
            frame,
            text_embeddings=text_embeddings,
            text_mask=text_mask,
            boxes=None,
            threshold=args.threshold,
            orig_size=(MODEL_SIZE, MODEL_SIZE),
        )
        sync()
        elapsed = time.perf_counter() - started

        scores = result["scores"][0].sigmoid()
        valid = torch.nonzero(scores > args.threshold, as_tuple=False).flatten()
        detection_timings.append({"prompt": prompt, "seconds": elapsed, "detections": int(valid.numel())})
        if valid.numel() == 0:
            continue
        local = valid[torch.argmax(scores[valid])]
        score = float(scores[local].item())
        if best is None or score > best["score"]:
            best = {
                "prompt": prompt,
                "score": score,
                "box1008": result["boxes"][0][local].detach().float().cpu(),
                "coarse1008": result["masks"][0][local].detach(),
            }

    if best is None:
        raise RuntimeError("No object met the requested confidence threshold.")

    x1, y1, x2, y2 = best["box1008"].tolist()
    scale_x, scale_y = width / MODEL_SIZE, height / MODEL_SIZE
    fx1, fy1, fx2, fy2 = x1 * scale_x, y1 * scale_y, x2 * scale_x, y2 * scale_y
    bw, bh = fx2 - fx1, fy2 - fy1
    cx1 = max(0, int(fx1 - bw * 0.1))
    cy1 = max(0, int(fy1 - bh * 0.1))
    cx2 = min(width, int(fx2 + bw * 0.1))
    cy2 = min(height, int(fy2 + bh * 0.1))

    sync()
    refine_started = time.perf_counter()
    refined_logits: torch.Tensor | None = None
    if args.refine_iterations > 0 and cx2 > cx1 and cy2 > cy1:
        crop = source.crop((cx1, cy1, cx2, cy2)).resize(
            (MODEL_SIZE, MODEL_SIZE), Image.Resampling.BILINEAR
        )
        crop_frame = to_tensor(crop).movedim(-1, 1).to(device=device, dtype=dtype)

        mx1 = max(0, int(cx1 / width * MODEL_SIZE))
        my1 = max(0, int(cy1 / height * MODEL_SIZE))
        mx2 = min(MODEL_SIZE, max(mx1 + 1, int(cx2 / width * MODEL_SIZE)))
        my2 = min(MODEL_SIZE, max(my1 + 1, int(cy2 / height * MODEL_SIZE)))
        mask_logits = best["coarse1008"][my1:my2, mx1:mx2].unsqueeze(0).unsqueeze(0)
        for _ in range(args.refine_iterations):
            mask_input = F.interpolate(
                mask_logits, size=(MODEL_SIZE, MODEL_SIZE), mode="bilinear", align_corners=False
            )
            mask_logits = sam3_model.forward_segment(crop_frame, mask_inputs=mask_input)
        refined_logits = mask_logits.detach().float().cpu()
    sync()
    refine_seconds = time.perf_counter() - refine_started

    compose_started = time.perf_counter()
    coarse_binary = (best["coarse1008"].detach().float().cpu().numpy() > 0).astype(np.uint8) * 255
    coarse_full = Image.fromarray(coarse_binary, mode="L").resize((width, height), Image.Resampling.BILINEAR)
    coarse_full = coarse_full.point(lambda value: 255 if value > 127 else 0, mode="L")
    final_mask = coarse_full

    if refined_logits is not None:
        refined_binary = (refined_logits[0, 0].numpy() > 0).astype(np.uint8) * 255
        refined_crop = Image.fromarray(refined_binary, mode="L").resize(
            (cx2 - cx1, cy2 - cy1), Image.Resampling.BILINEAR
        )
        refined_crop = refined_crop.point(lambda value: 255 if value > 127 else 0, mode="L")
        refined_full = Image.new("L", (width, height), 0)
        refined_full.paste(refined_crop, (cx1, cy1))
        final_mask = Image.fromarray(
            np.maximum(np.asarray(coarse_full, dtype=np.uint8), np.asarray(refined_full, dtype=np.uint8)),
            mode="L",
        )

    output_mask_path.parent.mkdir(parents=True, exist_ok=True)
    final_mask.save(output_mask_path)
    compose_seconds = time.perf_counter() - compose_started
    total_seconds = time.perf_counter() - total_started
    selected_pixels = int(np.count_nonzero(np.asarray(final_mask, dtype=np.uint8)))

    report = {
        "status": "PASS",
        "referenceOnly": True,
        "algorithm": "1008px detection for all candidates, global Top-1, one 1008px refinement, CPU full-resolution mask composition",
        "imageSize": {"width": width, "height": height},
        "candidates": prompts,
        "threshold": args.threshold,
        "selected": {
            "prompt": best["prompt"],
            "score": best["score"],
            "bbox": {"x": fx1, "y": fy1, "width": bw, "height": bh},
            "selectedPixels": selected_pixels,
            "selectedFraction": selected_pixels / (width * height),
        },
        "timings": {
            "modelLoadSeconds": model_load_seconds,
            "detections": detection_timings,
            "refineSeconds": refine_seconds,
            "cpuComposeAndPngSeconds": compose_seconds,
            "totalAfterSourcePreparedSeconds": total_seconds,
        },
        "device": str(device),
        "peakTorchAllocatedBytes": int(torch.cuda.max_memory_allocated()) if torch.cuda.is_available() else 0,
        "outputMask": str(output_mask_path),
    }
    rendered = json.dumps(report, indent=2, ensure_ascii=False)
    print(rendered)
    output_json_path.parent.mkdir(parents=True, exist_ok=True)
    output_json_path.write_text(rendered + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
