from __future__ import annotations

import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path

from PIL import Image

from sam31_backend import MODEL_ID
from sam31_backend.adapters import AlphaProxyAdapter
from sam31_backend.server import create_server


TOKEN = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"


class BackendProtocolTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.server = create_server(0, TOKEN, self.root, AlphaProxyAdapter())
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]

    def tearDown(self) -> None:
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        self.temporary.cleanup()

    def request(self, method: str, path: str, body=None, token: str = TOKEN):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=3)
        payload = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"Authorization": f"Bearer {token}"}
        if payload is not None:
            headers["Content-Type"] = "application/json"
            headers["Content-Length"] = str(len(payload))
        connection.request(method, path, body=payload, headers=headers)
        response = connection.getresponse()
        decoded = json.loads(response.read().decode("utf-8"))
        connection.close()
        return response.status, decoded

    def make_request(self, request_id: str = "request-0001"):
        request_dir = self.root / request_id
        request_dir.mkdir()
        # Bounds are x=[10,12), y=[20,22). Alpha values: 255, 128, 64, 0.
        rgba = bytes(
            [
                10, 20, 30, 255,
                10, 20, 30, 128,
                10, 20, 30, 64,
                10, 20, 30, 0,
            ]
        )
        (request_dir / "input.rgba8").write_bytes(rgba)
        # ROI covers only the right column with 50% and 100% weights.
        (request_dir / "roi.gray8").write_bytes(bytes([128, 255]))
        return {
            "schemaVersion": 1,
            "requestId": request_id,
            "modelId": MODEL_ID,
            "prompts": ["black leather jacket", "pants"],
            "threshold": 0.5,
            "document": {"width": 100, "height": 100, "resolution": 300.0},
            "input": {
                "file": f"{request_id}/input.rgba8",
                "encoding": "rgba8",
                "width": 2,
                "height": 2,
                "bounds": {"left": 10, "top": 20, "right": 12, "bottom": 22},
            },
            "roi": {
                "file": f"{request_id}/roi.gray8",
                "encoding": "gray8",
                "width": 1,
                "height": 2,
                "bounds": {"left": 11, "top": 20, "right": 12, "bottom": 22},
            },
            "output": {"file": f"{request_id}/mask.gray8", "encoding": "gray8"},
        }

    def test_health_requires_token_and_reports_loopback_service(self):
        status, body = self.request("GET", "/v1/health", token="wrong-token")
        self.assertEqual(401, status)
        self.assertEqual("UNAUTHORIZED", body["error"]["code"])

        status, body = self.request("GET", "/v1/health")
        self.assertEqual(200, status)
        self.assertEqual(1, body["protocolVersion"])
        self.assertEqual(MODEL_ID, body["modelId"])
        self.assertFalse(body["modelReady"])

    def test_alpha_proxy_applies_strict_roi_and_is_idempotent(self):
        request = self.make_request()
        status, body = self.request("POST", "/v1/infer", request)
        self.assertEqual(200, status)
        self.assertEqual("black leather jacket", body["selected"]["prompt"])
        self.assertEqual(bytes([0, 64, 0, 0]), (self.root / "request-0001/mask.gray8").read_bytes())

        status, repeated = self.request("POST", "/v1/infer", request)
        self.assertEqual(200, status)
        self.assertEqual(body["requestId"], repeated["requestId"])

    def test_png_transport_preserves_rgba_and_soft_roi_alpha(self):
        request = self.make_request("request-png1")
        request_dir = self.root / "request-png1"
        raw_rgba = (request_dir / "input.rgba8").read_bytes()
        Image.frombytes("RGBA", (2, 2), raw_rgba).save(request_dir / "input.png")
        roi_alpha = (request_dir / "roi.gray8").read_bytes()
        roi = Image.new("RGBA", (1, 2), (255, 255, 255, 0))
        roi.putalpha(Image.frombytes("L", (1, 2), roi_alpha))
        roi.save(request_dir / "roi.png")
        request["input"].update(file="request-png1/input.png", encoding="png-rgba8")
        request["roi"].update(file="request-png1/roi.png", encoding="png-alpha8")
        request["output"].update(file="request-png1/mask.png", encoding="png-alpha8")

        status, body = self.request("POST", "/v1/infer", request)
        self.assertEqual(200, status)
        self.assertEqual("png-alpha8", body["mask"]["encoding"])
        with Image.open(request_dir / "mask.png") as mask:
            self.assertEqual("RGBA", mask.mode)
            self.assertEqual(bytes([0, 64, 0, 0]), mask.getchannel("A").tobytes())
            self.assertAlmostEqual(300.0, mask.info["dpi"][0], delta=0.1)

    def test_request_id_conflict_is_rejected(self):
        request = self.make_request()
        self.assertEqual(200, self.request("POST", "/v1/infer", request)[0])
        request["threshold"] = 0.6
        status, body = self.request("POST", "/v1/infer", request)
        self.assertEqual(409, status)
        self.assertEqual("REQUEST_ID_CONFLICT", body["error"]["code"])

    def test_path_traversal_is_rejected(self):
        request = self.make_request()
        request["output"]["file"] = "../outside.gray8"
        status, body = self.request("POST", "/v1/infer", request)
        self.assertEqual(400, status)
        self.assertEqual("PATH_OUTSIDE_SESSION", body["error"]["code"])

    def test_landscape_12000_by_8000_document_is_supported(self):
        request = self.make_request()
        request["document"]["width"] = 12000
        request["document"]["height"] = 8000
        status, body = self.request("POST", "/v1/infer", request)
        self.assertEqual(200, status)
        self.assertEqual("ok", body["status"])

    def test_document_over_96_megapixels_is_rejected(self):
        request = self.make_request()
        request["document"]["width"] = 10000
        request["document"]["height"] = 10000
        status, body = self.request("POST", "/v1/infer", request)
        self.assertEqual(400, status)
        self.assertEqual("INVALID_REQUEST", body["error"]["code"])


if __name__ == "__main__":
    unittest.main()
