from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from safetensors.torch import load_file


def parse_candidates(raw: str) -> list[str]:
    candidates = []
    seen = set()
    for part in raw.split(","):
        value = " ".join(part.strip().split())
        if not value:
            continue
        if not value.isascii():
            raise ValueError("Prompts must be English/ASCII text.")
        key = value.casefold()
        if key not in seen:
            seen.add(key)
            candidates.append(value)
    if not 1 <= len(candidates) <= 5:
        raise ValueError("Supply one to five comma-separated prompt candidates.")
    return candidates


def synchronize() -> None:
    if torch.cuda.is_available():
        torch.cuda.synchronize()


def main() -> None:
    parser = argparse.ArgumentParser(description="Inference using only Meta's official SAM 3.1 source.")
    parser.add_argument("--official-root", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--image", type=Path, required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--max-input-side", type=int, default=1008)
    parser.add_argument("--output-mask", type=Path, required=True)
    parser.add_argument("--output-json", type=Path, required=True)
    args = parser.parse_args()

    official_root = args.official_root.resolve()
    sys.path.insert(0, str(official_root))
    import sam3.model_builder as model_builder  # noqa: PLC0415
    from sam3.model.sam3_image_processor import Sam3Processor  # noqa: PLC0415
    from sam3.model.vl_combiner import SAM3VLBackboneTri  # noqa: PLC0415

    class DetectorOnlyTriBackbone(SAM3VLBackboneTri):
        def forward_image(self, samples):
            return super().forward_image(
                samples,
                need_sam3_out=True,
                need_interactive_out=False,
                need_propagation_out=False,
            )

    def build_multiplex_detector():
        visual = model_builder._create_multiplex_tri_backbone()
        bpe_path = official_root / "sam3" / "assets" / "bpe_simple_vocab_16e6.txt.gz"
        text = model_builder._create_text_encoder(str(bpe_path))
        backbone = DetectorOnlyTriBackbone(visual=visual, text=text, scalp=0)
        return model_builder._create_sam3_model(
            backbone=backbone,
            transformer=model_builder._create_sam3_transformer(),
            input_geometry_encoder=model_builder._create_geometry_encoder(),
            segmentation_head=model_builder._create_segmentation_head(),
            dot_prod_scoring=model_builder._create_dot_product_scoring(),
            inst_interactive_predictor=None,
            eval_mode=True,
        )

    prompts = parse_candidates(args.prompt)
    if not 0.05 <= args.threshold <= 0.95:
        raise ValueError("threshold must be between 0.05 and 0.95")
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA is required for this feasibility test.")

    source = Image.open(args.image.resolve()).convert("RGB")
    original_size = source.size
    if max(source.size) > args.max_input_side:
        scale = args.max_input_side / max(source.size)
        low_size = (max(1, round(source.width * scale)), max(1, round(source.height * scale)))
        low_source = source.resize(low_size, Image.Resampling.LANCZOS)
    else:
        low_source = source

    torch.cuda.empty_cache()
    torch.cuda.reset_peak_memory_stats()
    load_started = time.perf_counter()
    model = build_multiplex_detector()
    checkpoint = load_file(str(args.checkpoint.resolve()), device="cpu")
    detector = {
        key.removeprefix("detector."): value
        for key, value in checkpoint.items()
        if key.startswith("detector.")
    }
    missing, unexpected = model.load_state_dict(detector, strict=False)
    model = model.cuda().eval()
    synchronize()
    load_seconds = time.perf_counter() - load_started

    processor = Sam3Processor(model, resolution=1008, device="cuda", confidence_threshold=args.threshold)
    with torch.autocast(device_type="cuda", dtype=torch.bfloat16):
        state = processor.set_image(low_source)
        synchronize()
        best = None
        prompt_reports = []
        for prompt in prompts:
            started = time.perf_counter()
            output = processor.set_text_prompt(prompt=prompt, state=state)
            synchronize()
            elapsed = time.perf_counter() - started
            scores = output["scores"]
            prompt_reports.append({"prompt": prompt, "seconds": elapsed, "detections": int(scores.numel())})
            if scores.numel() == 0:
                continue
            index = int(torch.argmax(scores).item())
            score = float(scores[index].float().item())
            if best is None or score > best["score"]:
                best = {
                    "prompt": prompt,
                    "score": score,
                    "mask": output["masks"][index].detach().to(device="cpu", dtype=torch.uint8),
                    "box": output["boxes"][index].detach().float().cpu(),
                }

    if best is None:
        raise RuntimeError("No object met the confidence threshold.")

    low_mask = np.squeeze(best["mask"].numpy()) * 255
    if low_mask.ndim != 2:
        raise RuntimeError(f"Unexpected official mask shape: {best['mask'].shape}")
    full_mask = Image.fromarray(low_mask, mode="L").resize(original_size, Image.Resampling.NEAREST)
    args.output_mask.resolve().parent.mkdir(parents=True, exist_ok=True)
    full_mask.save(args.output_mask.resolve())
    selected_pixels = int(np.count_nonzero(np.asarray(full_mask)))
    box = best["box"].tolist()
    scale_x = original_size[0] / low_source.width
    scale_y = original_size[1] / low_source.height

    report = {
        "status": "PASS",
        "implementation": "Meta official facebookresearch/sam3 source; no ComfyUI imports",
        "officialSourceCommit": "660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7e",
        "checkpoint": str(args.checkpoint.resolve()),
        "image": str(args.image.resolve()),
        "originalSize": {"width": original_size[0], "height": original_size[1]},
        "modelInputSourceSize": {"width": low_source.width, "height": low_source.height},
        "prompts": prompts,
        "threshold": args.threshold,
        "loadSeconds": load_seconds,
        "promptTimings": prompt_reports,
        "stateDict": {"missing": list(missing), "unexpected": list(unexpected)},
        "selected": {
            "prompt": best["prompt"],
            "score": best["score"],
            "bbox": {
                "left": box[0] * scale_x,
                "top": box[1] * scale_y,
                "right": box[2] * scale_x,
                "bottom": box[3] * scale_y,
            },
            "selectedPixels": selected_pixels,
        },
        "peakTorchAllocatedBytes": int(torch.cuda.max_memory_allocated()),
        "outputMask": str(args.output_mask.resolve()),
    }
    rendered = json.dumps(report, indent=2, ensure_ascii=False)
    print(rendered)
    args.output_json.resolve().parent.mkdir(parents=True, exist_ok=True)
    args.output_json.resolve().write_text(rendered + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
