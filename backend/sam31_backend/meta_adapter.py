from __future__ import annotations

import gc
import hashlib
import sys
import time
from pathlib import Path
from typing import Any

from .adapters import AdapterResult, _write_mask
from .errors import ServiceError
from .validation import InferRequest

EXPECTED_CHECKPOINT_SHA256 = "9BA99C92703C2E8B4F47DE2D34A539BB8E18923049E238B780D70DBE6368EB03"
MODEL_RESOLUTION = 1008
# NVIDIA commonly reports a marketed 16 GB board a little below 16 GiB. The
# product gate is therefore a 16 GB-class card with at least 15 GiB reported.
MINIMUM_REPORTED_VRAM_BYTES = 15 * 1024**3


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().upper()


def _validate_cuda_runtime(torch: Any) -> None:
    if not torch.cuda.is_available():
        raise ServiceError(
            "CUDA_ERROR",
            "A supported NVIDIA CUDA GPU is required.",
            http_status=500,
            retryable=False,
        )
    try:
        properties = torch.cuda.get_device_properties(torch.cuda.current_device())
        total_memory = int(properties.total_memory)
    except Exception as error:
        raise ServiceError(
            "CUDA_ERROR",
            "The NVIDIA GPU memory capacity could not be verified.",
            http_status=500,
            retryable=False,
        ) from error
    if total_memory < MINIMUM_REPORTED_VRAM_BYTES:
        raise ServiceError(
            "CUDA_ERROR",
            "An NVIDIA GPU with at least 16 GB of VRAM is required.",
            http_status=500,
            retryable=False,
            details={"reportedVramBytes": total_memory},
        )


class MetaSam31Adapter:
    """SAM 3.1 detector built from Meta's official source, not ComfyUI."""

    def __init__(self, checkpoint_path: Path, official_root: Path | None = None):
        self.checkpoint_path = checkpoint_path.resolve()
        self.official_root = official_root.resolve() if official_root else None
        self._model: Any = None
        self._processor_type: Any = None
        self._torch: Any = None
        self._np: Any = None
        self._image_type: Any = None

    @property
    def model_ready(self) -> bool:
        return self._model is not None

    def _load(self) -> None:
        if self._model is not None:
            return
        if not self.checkpoint_path.is_file():
            raise ServiceError(
                "MODEL_NOT_READY",
                "The pinned SAM 3.1 checkpoint is missing.",
                http_status=503,
                retryable=False,
            )
        if _sha256(self.checkpoint_path) != EXPECTED_CHECKPOINT_SHA256:
            raise ServiceError(
                "UNSUPPORTED_MODEL",
                "The installed SAM 3.1 checkpoint hash does not match the supported model.",
                http_status=400,
                retryable=False,
            )
        if self.official_root is not None:
            root_text = str(self.official_root)
            if root_text not in sys.path:
                sys.path.insert(0, root_text)

        try:
            import numpy as np
            import torch
            import sam3.model_builder as model_builder
            from PIL import Image
            from safetensors.torch import load_file
            from sam3.model.sam3_image_processor import Sam3Processor
            from sam3.model.vl_combiner import SAM3VLBackboneTri
        except ImportError as error:
            raise ServiceError(
                "MODEL_NOT_READY",
                "The packaged SAM 3.1 runtime is incomplete.",
                http_status=503,
                retryable=False,
            ) from error

        _validate_cuda_runtime(torch)

        class DetectorOnlyTriBackbone(SAM3VLBackboneTri):
            def forward_image(self, samples):
                return super().forward_image(
                    samples,
                    need_sam3_out=True,
                    need_interactive_out=False,
                    need_propagation_out=False,
                )

        try:
            visual = model_builder._create_multiplex_tri_backbone()
            if self.official_root is not None:
                bpe_path = self.official_root / "sam3" / "assets" / "bpe_simple_vocab_16e6.txt.gz"
            else:
                import sam3

                bpe_path = Path(sam3.__file__).resolve().parent / "assets" / "bpe_simple_vocab_16e6.txt.gz"
            text = model_builder._create_text_encoder(str(bpe_path))
            backbone = DetectorOnlyTriBackbone(visual=visual, text=text, scalp=0)
            model = model_builder._create_sam3_model(
                backbone=backbone,
                transformer=model_builder._create_sam3_transformer(),
                input_geometry_encoder=model_builder._create_geometry_encoder(),
                segmentation_head=model_builder._create_segmentation_head(),
                dot_prod_scoring=model_builder._create_dot_product_scoring(),
                inst_interactive_predictor=None,
                eval_mode=True,
            )
            checkpoint = load_file(str(self.checkpoint_path), device="cpu")
            detector = {
                key.removeprefix("detector."): value
                for key, value in checkpoint.items()
                if key.startswith("detector.")
            }
            missing, unexpected = model.load_state_dict(detector, strict=False)
            allowed_missing = {
                "backbone.language_backbone.encoder.text_projection",
                *{
                    f"backbone.vision_backbone.trunk.blocks.{index}.attn.freqs_cis"
                    for index in range(32)
                },
            }
            disallowed_missing = sorted(set(missing) - allowed_missing)
            if disallowed_missing or unexpected:
                raise ServiceError(
                    "UNSUPPORTED_MODEL",
                    "The checkpoint does not match the official SAM 3.1 detector architecture.",
                    http_status=400,
                    retryable=False,
                    details={
                        "missing": disallowed_missing[:20],
                        "unexpected": list(unexpected)[:20],
                    },
                )
            model = model.cuda().eval()
            self._model = model
            self._processor_type = Sam3Processor
            self._torch = torch
            self._np = np
            self._image_type = Image
            del checkpoint, detector
            gc.collect()
        except ServiceError:
            raise
        except RuntimeError as error:
            raise ServiceError(
                "CUDA_ERROR",
                "SAM 3.1 could not be loaded on the NVIDIA GPU.",
                http_status=500,
                retryable=True,
            ) from error

    def _prepare_source(self, request: InferRequest):
        np = self._np
        Image = self._image_type
        if request.input.encoding == "rgba8":
            rgba = np.memmap(
                request.input.path,
                dtype=np.uint8,
                mode="r",
                shape=(request.input.height, request.input.width, 4),
            )
        else:
            with Image.open(request.input.path) as image:
                rgba = np.asarray(image.convert("RGBA"), dtype=np.uint8).copy()
        alpha = np.asarray(rgba[:, :, 3]).copy()

        if request.roi is not None:
            if request.roi.encoding == "gray8":
                roi = np.memmap(
                    request.roi.path,
                    dtype=np.uint8,
                    mode="r",
                    shape=(request.roi.height, request.roi.width),
                )
            else:
                with Image.open(request.roi.path) as image:
                    roi = np.asarray(image.getchannel("A"), dtype=np.uint8).copy()
            constrained = np.zeros_like(alpha)
            input_bounds = request.input.bounds
            roi_bounds = request.roi.bounds
            left = max(input_bounds.left, roi_bounds.left)
            top = max(input_bounds.top, roi_bounds.top)
            right = min(input_bounds.right, roi_bounds.right)
            bottom = min(input_bounds.bottom, roi_bounds.bottom)
            if right > left and bottom > top:
                input_x1 = left - input_bounds.left
                input_y1 = top - input_bounds.top
                input_x2 = right - input_bounds.left
                input_y2 = bottom - input_bounds.top
                roi_x1 = left - roi_bounds.left
                roi_y1 = top - roi_bounds.top
                roi_x2 = right - roi_bounds.left
                roi_y2 = bottom - roi_bounds.top
                source_alpha = alpha[input_y1:input_y2, input_x1:input_x2].astype(np.uint16)
                roi_alpha = np.asarray(roi[roi_y1:roi_y2, roi_x1:roi_x2], dtype=np.uint16)
                constrained[input_y1:input_y2, input_x1:input_x2] = (
                    (source_alpha * roi_alpha + 127) // 255
                ).astype(np.uint8)
            alpha = constrained

        rows = np.any(alpha != 0, axis=1)
        columns = np.any(alpha != 0, axis=0)
        if not rows.any() or not columns.any():
            raise ServiceError(
                "EMPTY_EFFECTIVE_ROI",
                "The active layer has no effective pixels inside the search selection.",
                http_status=422,
                retryable=False,
            )
        y_values = np.flatnonzero(rows)
        x_values = np.flatnonzero(columns)
        crop = (
            int(x_values[0]),
            int(y_values[0]),
            int(x_values[-1]) + 1,
            int(y_values[-1]) + 1,
        )
        x1, y1, x2, y2 = crop
        rgb = np.asarray(rgba[y1:y2, x1:x2, :3]).copy()
        crop_alpha = alpha[y1:y2, x1:x2]
        rgb[crop_alpha == 0] = 127
        pil = Image.fromarray(rgb, mode="RGB")
        if max(pil.size) > MODEL_RESOLUTION:
            scale = MODEL_RESOLUTION / max(pil.size)
            low_size = (max(1, round(pil.width * scale)), max(1, round(pil.height * scale)))
            pil = pil.resize(low_size, Image.Resampling.LANCZOS)
        return pil, alpha, crop

    def infer(self, request: InferRequest) -> AdapterResult:
        started = time.perf_counter()
        self._load()
        load_done = time.perf_counter()
        torch = self._torch
        np = self._np
        Image = self._image_type

        source, effective_alpha, crop = self._prepare_source(request)
        prepared = time.perf_counter()
        processor = self._processor_type(
            self._model,
            resolution=MODEL_RESOLUTION,
            device="cuda",
            confidence_threshold=request.threshold,
        )
        best: dict[str, Any] | None = None
        try:
            with torch.inference_mode(), torch.autocast(device_type="cuda", dtype=torch.bfloat16):
                state = processor.set_image(source)
                for prompt in request.prompts:
                    output = processor.set_text_prompt(prompt=prompt, state=state)
                    scores = output["scores"]
                    if scores.numel() == 0:
                        continue
                    index = int(torch.argmax(scores).item())
                    score = float(scores[index].float().item())
                    if best is None or score > best["score"]:
                        best = {
                            "prompt": prompt,
                            "score": score,
                            # Meta's processor exposes the post-sigmoid mask in
                            # masks_logits. Keep that continuous plane so
                            # Photoshop receives a genuine grayscale selection.
                            "mask": output["masks_logits"][index]
                            .detach()
                            .to(device="cpu", dtype=torch.float32),
                        }
            torch.cuda.synchronize()
        except torch.cuda.OutOfMemoryError as error:
            torch.cuda.empty_cache()
            raise ServiceError(
                "CUDA_ERROR",
                "The GPU ran out of memory during SAM 3.1 inference.",
                http_status=500,
                retryable=True,
            ) from error
        except RuntimeError as error:
            raise ServiceError(
                "INFERENCE_FAILED",
                "SAM 3.1 inference failed.",
                http_status=500,
                retryable=True,
            ) from error

        inference_done = time.perf_counter()
        if best is None:
            raise ServiceError(
                "NO_OBJECT",
                "No candidate met the confidence threshold.",
                http_status=422,
                retryable=False,
            )

        low_probability = np.squeeze(best["mask"].numpy())
        if low_probability.ndim != 2:
            raise ServiceError(
                "INFERENCE_FAILED",
                "SAM 3.1 returned an unexpected mask shape.",
                http_status=500,
                retryable=True,
            )
        x1, y1, x2, y2 = crop
        low_mask = np.rint(np.clip(low_probability, 0.0, 1.0) * 255.0).astype(np.uint8)
        crop_mask = np.asarray(
            Image.fromarray(low_mask, mode="L").resize(
                (x2 - x1, y2 - y1), Image.Resampling.BILINEAR
            ),
            dtype=np.uint8,
        )
        output = np.zeros((request.input.height, request.input.width), dtype=np.uint8)
        weighted = (
            (crop_mask.astype(np.uint16) * effective_alpha[y1:y2, x1:x2].astype(np.uint16) + 127)
            // 255
        ).astype(np.uint8)
        output[y1:y2, x1:x2] = weighted
        selected_pixels = int(np.count_nonzero(output))
        if selected_pixels == 0:
            raise ServiceError(
                "NO_OBJECT",
                "The selected object has no pixels inside the effective search area.",
                http_status=422,
                retryable=False,
            )
        _write_mask(request, memoryview(output))
        finished = time.perf_counter()
        return AdapterResult(
            prompt=best["prompt"],
            score=best["score"],
            selected_pixels=selected_pixels,
            timings_ms={
                "modelLoad": (load_done - started) * 1000,
                "preprocess": (prepared - load_done) * 1000,
                "inference": (inference_done - prepared) * 1000,
                "compose": (finished - inference_done) * 1000,
                "total": (finished - started) * 1000,
            },
        )
