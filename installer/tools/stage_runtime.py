from __future__ import annotations

import argparse
import importlib.metadata as metadata
import json
import shutil
import sys
from collections import deque
from pathlib import Path

from packaging.requirements import Requirement


ROOT_DISTRIBUTIONS = (
    "torch",
    "torchvision",
    "numpy",
    "Pillow",
    "safetensors",
    "timm",
    "ftfy",
    "regex",
    "iopath",
    "typing_extensions",
    "huggingface_hub",
    # Meta's current model_builder imports pkg_resources at runtime but its
    # pyproject.toml does not declare setuptools as a runtime dependency.
    "setuptools",
    # sam3/sam/rope.py imports einops although the upstream project currently
    # lists it only in its optional notebook dependency group.
    "einops",
    # The official tracker modules import Triton at module import time even
    # though the detector-only Photoshop path does not execute EDT kernels.
    "triton-windows",
    # Imported transitively by the upstream image dataset module while
    # model_builder initializes, even for inference-only construction.
    "pycocotools",
    # Imported at module import time by the upstream video predictor that
    # model_builder exposes alongside the still-image model.
    "psutil",
)


def normalized(name: str) -> str:
    return name.lower().replace("-", "_").replace(".", "_")


def copy_file(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, destination)


def copy_base_runtime(prefix: Path, output: Path) -> None:
    output.mkdir(parents=True, exist_ok=True)
    for source in prefix.iterdir():
        if source.is_file() and (
            source.suffix.lower() in {".dll", ".exe", ".pyd", ".zip"}
            or source.name.upper().startswith(("LICENSE", "README"))
        ):
            copy_file(source, output / source.name)
    for directory in ("DLLs",):
        source = prefix / directory
        if source.is_dir():
            shutil.copytree(source, output / directory, dirs_exist_ok=True)
    library = prefix / "Lib"
    for source in library.rglob("*"):
        if (
            "site-packages" in source.parts
            or "__pycache__" in source.parts
            or source.suffix.lower() == ".pyc"
            or not source.is_file()
        ):
            continue
        copy_file(source, output / source.relative_to(prefix))


def dependency_closure(names: tuple[str, ...]) -> list[metadata.Distribution]:
    queue = deque(names)
    found: dict[str, metadata.Distribution] = {}
    while queue:
        requested = queue.popleft()
        key = normalized(requested)
        if key in found:
            continue
        try:
            distribution = metadata.distribution(requested)
        except metadata.PackageNotFoundError as error:
            raise RuntimeError(f"Required Python distribution is missing: {requested}") from error
        canonical = normalized(distribution.metadata["Name"])
        if canonical in found:
            continue
        found[canonical] = distribution
        for raw_requirement in distribution.requires or ():
            requirement = Requirement(raw_requirement)
            if requirement.marker is not None and not requirement.marker.evaluate({"extra": ""}):
                continue
            queue.append(requirement.name)
    return [found[key] for key in sorted(found)]


def copy_distribution(distribution: metadata.Distribution, site_packages: Path, output: Path) -> list[str]:
    copied: list[str] = []
    root = site_packages.resolve()
    for entry in distribution.files or ():
        source = Path(distribution.locate_file(entry)).resolve()
        try:
            relative = source.relative_to(root)
        except ValueError:
            # Console entry points outside site-packages are not needed by the backend.
            continue
        if not source.is_file() or "__pycache__" in relative.parts:
            continue
        copy_file(source, output / relative)
        copied.append(relative.as_posix())
    return copied


def copy_licenses(distribution: metadata.Distribution, site_packages: Path, output: Path) -> list[str]:
    copied: list[str] = []
    target = output / normalized(distribution.metadata["Name"])
    for entry in distribution.files or ():
        name = Path(entry).name.upper()
        if not any(token in name for token in ("LICENSE", "COPYING", "NOTICE")):
            continue
        source = Path(distribution.locate_file(entry)).resolve()
        if not source.is_file():
            continue
        try:
            relative = source.relative_to(site_packages.resolve())
        except ValueError:
            continue
        destination = target / relative.name
        copy_file(source, destination)
        copied.append(destination.relative_to(output).as_posix())
    return copied


def main() -> int:
    parser = argparse.ArgumentParser(description="Stage a minimal standalone Python runtime from an audited source")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--licenses", type=Path, required=True)
    args = parser.parse_args()

    prefix = Path(sys.prefix).resolve()
    site_packages = prefix / "Lib" / "site-packages"
    if not site_packages.is_dir():
        raise RuntimeError("The source Python runtime has no Lib/site-packages directory.")
    copy_base_runtime(prefix, args.output)
    staged_site_packages = args.output / "Lib" / "site-packages"
    distributions = dependency_closure(ROOT_DISTRIBUTIONS)
    manifest: dict[str, object] = {
        "python": sys.version,
        "roots": list(ROOT_DISTRIBUTIONS),
        "distributions": [],
    }
    for distribution in distributions:
        files = copy_distribution(distribution, site_packages, staged_site_packages)
        licenses = copy_licenses(distribution, site_packages, args.licenses)
        manifest["distributions"].append(
            {
                "name": distribution.metadata["Name"],
                "version": distribution.version,
                "license": distribution.metadata.get("License", ""),
                "fileCount": len(files),
                "licenseFiles": licenses,
            }
        )
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
