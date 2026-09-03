"use strict";

const { MODEL_ID, SCHEMA_VERSION, parsePromptCandidates, normalizeThreshold } = require("./action-info.js");
const { MAX_PIXELS, MAX_SIDE } = require("./imaging-contract.js");

function normalizeBounds(bounds) {
  const value = {};
  for (const key of ["left", "top", "right", "bottom"]) {
    const number = Number(bounds[key]);
    if (!Number.isFinite(number) || !Number.isInteger(number)) throw new Error(`无效边界：${key}。`);
    value[key] = number;
  }
  if (value.right <= value.left || value.bottom <= value.top) throw new Error("边界尺寸必须为正数。");
  return value;
}

function normalizeDocumentSize(widthValue, heightValue) {
  const width = Number(widthValue);
  const height = Number(heightValue);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new Error("文档尺寸无效。");
  }
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
    throw new Error("文档超过最长边 12000 / 96 MP 上限。");
  }
  return { width, height };
}

function assertPlaneInsideDocument(bounds, document, label) {
  if (bounds.left < 0 || bounds.top < 0 || bounds.right > document.width || bounds.bottom > document.height) {
    throw new Error(`${label}超出文档画布。`);
  }
}

function buildInferRequest(options) {
  const prompts = parsePromptCandidates(options.prompt);
  const inputBounds = normalizeBounds(options.inputBounds);
  const document = normalizeDocumentSize(options.documentWidth, options.documentHeight);
  assertPlaneInsideDocument(inputBounds, document, "活动图层边界");
  const inputEncoding = options.inputEncoding || "rgba8";
  const inputFile = options.inputFile || "input.rgba8";
  const outputEncoding = options.outputEncoding || "gray8";
  const outputFile = options.outputFile || "mask.gray8";
  if (!["rgba8", "png-rgba8"].includes(inputEncoding)) throw new Error("不支持的活动图层编码。");
  if (!["gray8", "png-alpha8"].includes(outputEncoding)) throw new Error("不支持的输出选区编码。");
  const request = {
    schemaVersion: SCHEMA_VERSION,
    requestId: String(options.requestId),
    modelId: MODEL_ID,
    prompts,
    threshold: normalizeThreshold(options.threshold),
    document: { width: document.width, height: document.height },
    input: {
      file: `${options.requestId}/${inputFile}`,
      encoding: inputEncoding,
      width: inputBounds.right - inputBounds.left,
      height: inputBounds.bottom - inputBounds.top,
      bounds: inputBounds
    },
    roi: null,
    output: {
      file: `${options.requestId}/${outputFile}`,
      encoding: outputEncoding
    }
  };
  if (options.sourcePath) request.document.sourcePath = String(options.sourcePath);
  if (options.roiBounds) {
    const roiBounds = normalizeBounds(options.roiBounds);
    assertPlaneInsideDocument(roiBounds, document, "搜索选区边界");
    const roiEncoding = options.roiEncoding || "gray8";
    const roiFile = options.roiFile || "roi.gray8";
    if (!["gray8", "png-alpha8"].includes(roiEncoding)) throw new Error("不支持的搜索选区编码。");
    request.roi = {
      file: `${options.requestId}/${roiFile}`,
      encoding: roiEncoding,
      width: roiBounds.right - roiBounds.left,
      height: roiBounds.bottom - roiBounds.top,
      bounds: roiBounds
    };
  }
  return request;
}

function validateSuccessResponse(response, request) {
  if (!response || response.status !== "ok" || response.requestId !== request.requestId) {
    throw new Error("后端返回了不匹配的请求响应。");
  }
  const mask = response.mask;
  if (!mask || mask.encoding !== request.output.encoding || mask.file !== request.output.file) {
    throw new Error("后端返回了无效的掩码描述。");
  }
  const expected = request.input;
  if (mask.width !== expected.width || mask.height !== expected.height) {
    throw new Error("后端掩码尺寸与活动图层不一致。");
  }
  const actualBounds = normalizeBounds(mask.bounds);
  for (const key of ["left", "top", "right", "bottom"]) {
    if (actualBounds[key] !== expected.bounds[key]) throw new Error("后端掩码坐标与活动图层不一致。");
  }
  if (!response.selected || !request.prompts.includes(response.selected.prompt)) {
    throw new Error("后端返回了未知提示词结果。");
  }
  const score = Number(response.selected.score);
  if (!Number.isFinite(score) || score < request.threshold || score > 1) {
    throw new Error("后端返回了无效的候选置信度。");
  }
  return response;
}

module.exports = {
  assertPlaneInsideDocument,
  buildInferRequest,
  normalizeBounds,
  normalizeDocumentSize,
  validateSuccessResponse
};
