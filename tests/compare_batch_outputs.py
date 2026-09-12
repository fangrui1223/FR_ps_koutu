"""Read-only pixel comparison of two local QA batch directories."""
import argparse
import json
from pathlib import Path
from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("baseline", type=Path)
parser.add_argument("candidate", type=Path)
args = parser.parse_args()
old = {p.name: p for p in args.baseline.rglob("*.jpg")}
new = {p.name: p for p in args.candidate.rglob("*.jpg")}
assert old.keys() == new.keys(), "Output file names differ"
changed = []
for name in sorted(new):
    with Image.open(new[name]) as image:
        image.verify()
    with Image.open(old[name]) as a, Image.open(new[name]) as b:
        assert a.size == b.size, f"Dimensions differ: {name}"
        if a.convert("RGB").tobytes() != b.convert("RGB").tobytes():
            changed.append(name)
print(json.dumps({"count": len(new), "names_equal": True, "dimensions_equal": True,
                  "decoded_pixels_identical": len(new) - len(changed), "changed": changed,
                  "bytes": sum(p.stat().st_size for p in new.values())}, ensure_ascii=False))
