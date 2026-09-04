# Third-party notices

FR SAM Text Selection's original source code is released under the MIT License.
The installer downloads and installs third-party components whose own licenses
continue to apply. They are not relicensed under MIT.

## Meta SAM 3 / SAM 3.1

- Source: https://github.com/facebookresearch/sam3
- Pinned source revision: `660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7`
- Model source: https://huggingface.co/Comfy-Org/sam3.1
- Model file SHA-256: `9ba99c92703c2e8b4f47de2d34a539bb8e18923049e238b780d70dbe6368eb03`
- License: Meta SAM License, redistributed as `SAM-LICENSE.txt` in release installations.

The SAM license includes conditions and restrictions beyond a standard
open-source license. Review it before redistributing or using the model.

## Runtime components

The online installer pins the Windows runtime roots listed in
`installer/runtime-requirements.txt`. Important upstream licenses include:

- CPython 3.10.11 — Python Software Foundation License.
- PyTorch 2.10.0 and torchvision 0.25.0 — BSD-style licenses.
- triton-windows 3.6.0.post26 — MIT License; Windows port maintained by its
  upstream project and not by Meta, Adobe, or FR.
- NumPy, Pillow, safetensors, timm, ftfy, iopath, einops, psutil,
  pycocotools, and their pinned dependencies — their respective upstream
  licenses, preserved in installed package metadata.

## Adobe SDK

Adobe UXP Hybrid Plugin SDK headers and runtime interfaces remain subject to
Adobe's terms. The SDK itself is not redistributed as source in this repository.

This notice is informational and is not legal advice.
