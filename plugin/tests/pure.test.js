"use strict";

const assert = require("assert");
const { migrateActionInfo, normalizeActionInfo, parsePromptCandidates } = require("../lib/action-info.js");
const {
  documentBounds,
  normalizeBounds: normalizeImagingBounds,
  normalizeGray8
} = require("../lib/imaging-contract.js");
const { toRgba8 } = require("../lib/pixel-buffer.js");
const {
  buildInferRequest,
  normalizeDocumentSize,
  validateSuccessResponse
} = require("../lib/protocol.js");

assert.deepStrictEqual(parsePromptCandidates(" pants, Pants, black leather jacket "), ["pants", "black leather jacket"]);
assert.throws(() => parsePromptCandidates("裤子"), /只支持英文/);
assert.throws(() => parsePromptCandidates("a,b,c,d,e,f"), /最多 5/);

const info = normalizeActionInfo({ prompt: "pants, trousers", threshold: "0.504" });
assert.deepStrictEqual(info, {
  schemaVersion: 1,
  modelId: "sam3.1-multiplex-fp16",
  prompt: "pants, trousers",
  threshold: 0.5
});
assert.deepStrictEqual(migrateActionInfo({ prompt: "jacket", threshold: 0.6 }), {
  schemaVersion: 1,
  modelId: undefined,
  prompt: "jacket",
  threshold: 0.6
});
assert.deepStrictEqual(normalizeActionInfo({ prompt: "jacket", threshold: 0.6 }), {
  schemaVersion: 1,
  modelId: "sam3.1-multiplex-fp16",
  prompt: "jacket",
  threshold: 0.6
});
assert.throws(() => normalizeActionInfo({ schemaVersion: 2, prompt: "pants" }), /不支持的动作参数版本/);

const request = buildInferRequest({
  requestId: "request-0001",
  prompt: info.prompt,
  threshold: info.threshold,
  documentWidth: 100,
  documentHeight: 200,
  sourcePath: "C:\\images\\a.psd",
  inputBounds: { left: 10, top: 20, right: 90, bottom: 180 },
  roiBounds: { left: 25, top: 50, right: 75, bottom: 150 }
});
assert.strictEqual(request.input.width, 80);
assert.strictEqual(request.input.height, 160);
assert.strictEqual(request.roi.width, 50);
assert.strictEqual(request.output.file, "request-0001/mask.gray8");

const response = {
  status: "ok",
  requestId: "request-0001",
  selected: { prompt: "pants", score: 0.9 },
  mask: {
    file: "request-0001/mask.gray8",
    encoding: "gray8",
    width: 80,
    height: 160,
    bounds: { left: 10, top: 20, right: 90, bottom: 180 }
  }
};
assert.strictEqual(validateSuccessResponse(response, request), response);
assert.throws(() => validateSuccessResponse({ ...response, requestId: "wrong" }, request), /不匹配/);

const pngRequest = buildInferRequest({
  requestId: "request-png1",
  prompt: "pants",
  threshold: 0.5,
  documentWidth: 100,
  documentHeight: 200,
  inputBounds: { left: 0, top: 0, right: 100, bottom: 200 },
  inputFile: "input.png",
  inputEncoding: "png-rgba8",
  roiBounds: { left: 0, top: 0, right: 100, bottom: 200 },
  roiFile: "roi.png",
  roiEncoding: "png-alpha8",
  outputFile: "mask.png",
  outputEncoding: "png-alpha8"
});
assert.strictEqual(pngRequest.input.file, "request-png1/input.png");
assert.strictEqual(pngRequest.roi.encoding, "png-alpha8");
assert.strictEqual(pngRequest.output.file, "request-png1/mask.png");
assert.strictEqual(validateSuccessResponse({
  ...response,
  requestId: "request-png1",
  selected: { prompt: "pants", score: 0.9 },
  mask: {
    file: "request-png1/mask.png",
    encoding: "png-alpha8",
    width: 100,
    height: 200,
    bounds: { left: 0, top: 0, right: 100, bottom: 200 }
  }
}, pngRequest).status, "ok");

const rgb = toRgba8(Uint8Array.from([1, 2, 3, 4, 5, 6]), 3, 2, 1);
assert.deepStrictEqual(Array.from(rgb.data), [1, 2, 3, 255, 4, 5, 6, 255]);
assert.strictEqual(rgb.sourceComponents, 3);
const rgba = toRgba8(Uint8Array.from([1, 2, 3, 4]), 4, 1, 1);
assert.deepStrictEqual(Array.from(rgba.data), [1, 2, 3, 4]);
assert.strictEqual(rgba.sourceComponents, 4);
assert.throws(() => toRgba8(Uint8Array.from([1]), 1, 1, 1), /RGB\/RGBA/);
assert.throws(() => toRgba8(Uint8Array.from([1, 2, 3, 4]), 3, 1, 1), /长度与边界不一致/);

assert.deepStrictEqual(documentBounds({ width: { value: 12000 }, height: 8000 }), {
  left: 0, top: 0, right: 12000, bottom: 8000
});
assert.deepStrictEqual(normalizeDocumentSize(12000, 8000), { width: 12000, height: 8000 });
assert.throws(() => normalizeDocumentSize(12001, 1), /最长边 12000/);
assert.throws(() => normalizeDocumentSize(10000, 10000), /96 MP/);
assert.throws(() => normalizeImagingBounds({ left: 0.5, top: 0, right: 10, bottom: 10 }), /整数坐标/);
const gray = normalizeGray8(
  Uint8Array.from([0, 64, 128, 255]),
  { components: 1, componentSize: 8 },
  { left: 10, top: 20, right: 12, bottom: 22 }
);
assert.deepStrictEqual(Array.from(gray), [0, 64, 128, 255]);
assert.throws(
  () => normalizeGray8(Uint8Array.from([0, 1]), { components: 2, componentSize: 8 }, { left: 0, top: 0, right: 1, bottom: 1 }),
  /单通道灰度 8 位/
);

const landscapeRequest = buildInferRequest({
  requestId: "request-landscape",
  prompt: "pants",
  threshold: 0.5,
  documentWidth: 12000,
  documentHeight: 8000,
  inputBounds: { left: 0, top: 0, right: 12000, bottom: 8000 }
});
assert.strictEqual(landscapeRequest.document.width, 12000);
assert.throws(() => buildInferRequest({
  requestId: "request-outside",
  prompt: "pants",
  threshold: 0.5,
  documentWidth: 100,
  documentHeight: 100,
  inputBounds: { left: 0, top: 0, right: 101, bottom: 100 }
}), /超出文档画布/);

console.log("production plugin pure tests: PASS");
