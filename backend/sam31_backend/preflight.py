from __future__ import annotations

import argparse
import json
from pathlib import Path

from .meta_adapter import EXPECTED_CHECKPOINT_SHA256, MetaSam31Adapter, _validate_cuda_runtime


def run(model: Path, official_sam3_root: Path) -> dict[str, object]:
    model = model.resolve()
    official_sam3_root = official_sam3_root.resolve()
    if not model.is_file():
        raise RuntimeError("The SAM 3.1 model checkpoint is missing.")
    if not (official_sam3_root / "sam3" / "model_builder.py").is_file():
        raise RuntimeError("The packaged official SAM 3 source is incomplete.")

    import numpy
    import PIL
    import safetensors
    import timm
    import torch
    import torchvision

    _validate_cuda_runtime(torch)
    # This intentionally constructs and moves the complete detector to CUDA.
    # It validates the fixed checkpoint hash/architecture and catches upstream
    # imports that are missing from the published dependency metadata.
    adapter = MetaSam31Adapter(model, official_sam3_root)
    adapter._load()
    properties = torch.cuda.get_device_properties(torch.cuda.current_device())
    return {
        "status": "ok",
        "modelSha256": EXPECTED_CHECKPOINT_SHA256,
        "modelReady": adapter.model_ready,
        "gpu": properties.name,
        "vramBytes": int(properties.total_memory),
        "versions": {
            "torch": torch.__version__,
            "torchvision": torchvision.__version__,
            "numpy": numpy.__version__,
            "pillow": PIL.__version__,
            "safetensors": safetensors.__version__,
            "timm": timm.__version__,
        },
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Validate the installed SAM 3.1 Photoshop runtime")
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--official-sam3-root", type=Path, required=True)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    try:
        result = run(args.model, args.official_sam3_root)
    except Exception as error:
        print(json.dumps({"status": "error", "message": str(error)}, ensure_ascii=False))
        return 1
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
