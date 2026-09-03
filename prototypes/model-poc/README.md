# SAM 3.1 model feasibility PoC

This directory answers two separate questions:

1. Is the exact pinned `sam3.1_multiplex_fp16.safetensors` file intact and structurally recognizable?
2. Can the installed ComfyUI runtime use that exact file for text-prompt segmentation on the RTX 5090?

`reference_comfy_infer.py` is deliberately a reference oracle only. It imports the local ComfyUI implementation and therefore must not be copied into or packaged with the planned closed-source backend. Product implementation must use Meta's official licensed code or an independently implemented adapter after legal review.

The reference runner splits comma-separated candidates, executes them independently, and selects the globally highest-confidence single object. This matches the frozen product behavior.

`memory_optimized_reference.py` tests the proposed production memory policy. Detection always happens at 1008×1008; every candidate competes before refinement; only the global Top-1 is refined; and the document-size mask is assembled on CPU. This avoids ComfyUI's full-resolution GPU mask allocation at 8000×12000.

`official_meta_infer.py` loads the same safetensors checkpoint through a clean checkout of Meta's official `facebookresearch/sam3` source and does not import ComfyUI. It exists to prove the formal adapter and checkpoint mapping separately from the GPL reference oracle.

The formal product adapter now lives at `backend/sam31_backend/meta_adapter.py`. It uses the pinned official Meta source checkout at commit `660a5e9e1b8b4c02c0ad97229b88a09a6e4ff5b7e`, verifies the exact checkpoint SHA-256, applies active-layer alpha and strict ROI constraints, runs detection at 1008 pixels, chooses the global Top-1, and composes the full-resolution mask on CPU.

Measured results on the RTX 5090 with two prompts (`black leather jacket`, `pants`):

| Path | Size | Cold total | Warm total | Result |
|---|---:|---:|---:|---|
| Formal backend | 1024×1536 | 9.231 s | 0.205 s | jacket, 0.96875 |
| Formal backend | 4000×6000 | 9.729 s | 0.573 s | jacket, 0.96484375 |
| Formal backend | 8000×12000 | 11.287 s | 1.791 s | jacket, 0.96875 |

The 1024×1536 official mask has IoU `0.9887769282` against the ComfyUI oracle. The 8000×12000 formal backend mask has IoU `0.9902975345` against the optimized reference. The official standalone test peaked at approximately 4.12 GB of Torch allocations. These timings cover backend processing only, not Photoshop capture, Hybrid transport, or selection write-back.

Example:

```powershell
C:\FR_comfyui\python\python.exe reference_comfy_infer.py `
  --checkpoint ..\..\models\sam3.1_multiplex_fp16.safetensors `
  --image ..\..\tests\fixtures\fashion-jacket-pants.png `
  --prompt "black leather jacket,pants" `
  --output-mask results\mask.png `
  --output-json results\report.json
```
