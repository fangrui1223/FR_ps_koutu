from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser(description="Compare two binary masks.")
    parser.add_argument("reference", type=Path)
    parser.add_argument("candidate", type=Path)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()

    reference = np.asarray(Image.open(args.reference).convert("L")) > 0
    candidate = np.asarray(Image.open(args.candidate).convert("L")) > 0
    if reference.shape != candidate.shape:
        raise ValueError(f"shape mismatch: {reference.shape} != {candidate.shape}")

    intersection = int(np.logical_and(reference, candidate).sum())
    union = int(np.logical_or(reference, candidate).sum())
    report = {
        "reference": str(args.reference.resolve()),
        "candidate": str(args.candidate.resolve()),
        "shape": list(reference.shape),
        "intersectionPixels": intersection,
        "unionPixels": union,
        "iou": intersection / union if union else 1.0,
        "referencePixels": int(reference.sum()),
        "candidatePixels": int(candidate.sum()),
    }
    rendered = json.dumps(report, indent=2)
    print(rendered)
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(rendered + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
