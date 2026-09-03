from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from safetensors import safe_open


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def main() -> None:
    parser = argparse.ArgumentParser(description="Inspect a SAM 3.1 safetensors checkpoint without loading tensors.")
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()

    path = args.checkpoint.resolve()
    with safe_open(path, framework="pt", device="cpu") as archive:
        keys = list(archive.keys())
        metadata = archive.metadata() or {}

    prefix_counts: dict[str, int] = {}
    for key in keys:
        prefix = key.split(".", 1)[0]
        prefix_counts[prefix] = prefix_counts.get(prefix, 0) + 1

    report = {
        "path": str(path),
        "sizeBytes": path.stat().st_size,
        "sha256": sha256(path),
        "tensorCount": len(keys),
        "prefixCounts": dict(sorted(prefix_counts.items())),
        "metadata": metadata,
        "keySamples": keys[:40],
        "compatibilitySignals": {
            "hasDetector": any(k.startswith("detector.") for k in keys),
            "hasTracker": any(k.startswith("tracker.") or k.startswith("detector.tracker.") for k in keys),
            "hasLanguageBackbone": any("language_backbone" in k for k in keys),
        },
    }

    rendered = json.dumps(report, indent=2, ensure_ascii=False)
    print(rendered)
    if args.json:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        args.json.write_text(rendered + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
