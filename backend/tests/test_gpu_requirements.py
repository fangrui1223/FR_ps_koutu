from __future__ import annotations

import unittest

from sam31_backend.errors import ServiceError
from sam31_backend.meta_adapter import MINIMUM_REPORTED_VRAM_BYTES, _validate_cuda_runtime


class _Properties:
    def __init__(self, total_memory: int):
        self.total_memory = total_memory


class _Cuda:
    def __init__(self, available: bool, total_memory: int = MINIMUM_REPORTED_VRAM_BYTES):
        self._available = available
        self._total_memory = total_memory

    def is_available(self):
        return self._available

    def current_device(self):
        return 0

    def get_device_properties(self, _device):
        return _Properties(self._total_memory)


class _Torch:
    def __init__(self, cuda: _Cuda):
        self.cuda = cuda


class GpuRequirementTests(unittest.TestCase):
    def test_accepts_a_16_gb_class_gpu(self):
        _validate_cuda_runtime(_Torch(_Cuda(True, MINIMUM_REPORTED_VRAM_BYTES)))

    def test_rejects_insufficient_vram(self):
        with self.assertRaises(ServiceError) as caught:
            _validate_cuda_runtime(_Torch(_Cuda(True, MINIMUM_REPORTED_VRAM_BYTES - 1)))
        self.assertEqual("CUDA_ERROR", caught.exception.code)
        self.assertFalse(caught.exception.retryable)

    def test_rejects_missing_cuda(self):
        with self.assertRaises(ServiceError) as caught:
            _validate_cuda_runtime(_Torch(_Cuda(False)))
        self.assertEqual("CUDA_ERROR", caught.exception.code)
        self.assertFalse(caught.exception.retryable)


if __name__ == "__main__":
    unittest.main()
