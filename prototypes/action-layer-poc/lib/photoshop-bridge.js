"use strict";

const photoshop = require("photoshop");
const {
  alphaToMask,
  hasNonZero,
  multiplyMaskByRoi,
  normalizeActionInfo
} = require("./pure.js");

function numeric(value) {
  if (typeof value === "number") return value;
  if (value && typeof value.value === "number") return value.value;
  return Number(value);
}

function documentBounds(doc) {
  return {
    left: 0,
    top: 0,
    right: Math.round(numeric(doc.width)),
    bottom: Math.round(numeric(doc.height))
  };
}

function disposeImageData(value) {
  const imageData = value && (value.imageData || value);
  if (imageData && typeof imageData.dispose === "function") imageData.dispose();
}

function assertSupportedDocument(doc) {
  if (!doc) throw new Error("没有活动文档。");
  if (!doc.activeLayers || doc.activeLayers.length !== 1) {
    throw new Error("请只选择一个活动图层。");
  }

  const modeText = String(doc.mode || "").toLowerCase();
  if (modeText && !modeText.includes("rgb")) {
    throw new Error("只支持 RGB 文档。");
  }
  const eightBits = photoshop.constants &&
    photoshop.constants.BitsPerChannelType &&
    photoshop.constants.BitsPerChannelType.EIGHT;
  const bitsText = String(doc.bitsPerChannel || "").toLowerCase();
  if (doc.bitsPerChannel !== eightBits &&
      Number(doc.bitsPerChannel) !== 8 &&
      !bitsText.includes("eight") &&
      !bitsText.includes("8")) {
    throw new Error("只支持 RGB 8 位文档。");
  }
}

async function readExistingSelection(doc, bounds) {
  let selectionObject;
  try {
    selectionObject = await photoshop.imaging.getSelection({
      documentID: doc.id,
      sourceBounds: bounds
    });
  } catch (error) {
    return null;
  }

  if (!selectionObject || !selectionObject.imageData) return null;

  try {
    const data = await selectionObject.imageData.getData({ chunky: true });
    const sourceBounds = selectionObject.sourceBounds;
    const width = sourceBounds.right - sourceBounds.left;
    const height = sourceBounds.bottom - sourceBounds.top;
    if (width <= 0 || height <= 0 || data.length < width * height) return null;
    return { data: new Uint8Array(data), bounds: sourceBounds };
  } finally {
    disposeImageData(selectionObject);
  }
}

async function readActiveLayerMask(doc) {
  const layer = doc.activeLayers[0];
  const imageObject = await photoshop.imaging.getPixels({
    documentID: doc.id,
    layerID: layer.id,
    sourceBounds: documentBounds(doc),
    colorSpace: "RGB",
    componentSize: 8
  });

  try {
    if (imageObject.level !== 0) {
      throw new Error(`活动图层读取意外使用了金字塔级别 ${imageObject.level}。`);
    }
    const imageData = imageObject.imageData;
    const bounds = imageObject.sourceBounds;
    const width = bounds.right - bounds.left;
    const height = bounds.bottom - bounds.top;
    if (width <= 0 || height <= 0) throw new Error("活动图层没有可读取像素。");
    const data = await imageData.getData({ chunky: true });
    return {
      layer,
      bounds,
      width,
      height,
      pixelFormat: imageData.pixelFormat,
      components: imageData.components,
      mask: alphaToMask(data, width, height, imageData.components)
    };
  } finally {
    disposeImageData(imageObject);
  }
}

async function putMaskAsSelection(doc, layerMask) {
  const selectionData = await photoshop.imaging.createImageDataFromBuffer(layerMask.mask, {
    width: layerMask.width,
    height: layerMask.height,
    components: 1,
    chunky: true,
    colorSpace: "Grayscale",
    colorProfile: "Gray Gamma 2.2"
  });

  try {
    await photoshop.imaging.putSelection({
      documentID: doc.id,
      imageData: selectionData,
      replace: true,
      targetBounds: {
        left: layerMask.bounds.left,
        top: layerMask.bounds.top
      },
      commandName: "SAM 3.1 选区 PoC"
    });
  } finally {
    disposeImageData(selectionData);
  }
}

async function createCenterTestRoi() {
  const doc = photoshop.app.activeDocument;
  assertSupportedDocument(doc);
  const bounds = documentBounds(doc);
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  const mask = new Uint8Array(width * height);
  const left = Math.floor(width * 0.25);
  const right = Math.ceil(width * 0.75);
  const top = Math.floor(height * 0.25);
  const bottom = Math.ceil(height * 0.75);
  for (let y = top; y < bottom; y += 1) {
    mask.fill(255, y * width + left, y * width + right);
  }
  await putMaskAsSelection(doc, { mask, width, height, bounds });
  return { left, top, right, bottom };
}

function measureMask(mask, bounds, width, height) {
  let selectedPixels = 0;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      if (mask[row + x] === 0) continue;
      selectedPixels += 1;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }

  return {
    selectedPixels,
    totalPixels: width * height,
    selectedBounds: selectedPixels === 0 ? null : {
      left: bounds.left + left,
      top: bounds.top + top,
      right: bounds.left + right + 1,
      bottom: bounds.top + bottom + 1
    }
  };
}

async function runLayerAlphaSelection(rawInfo) {
  const info = normalizeActionInfo(rawInfo);
  if (info.prototypeMode === "forced-error") {
    throw new Error("PoC 强制错误：用于验证 Photoshop 动作是否停止批次。");
  }

  const doc = photoshop.app.activeDocument;
  assertSupportedDocument(doc);
  const fullBounds = documentBounds(doc);

  // Capture the ROI before any mutation. No selection mutation occurs until every
  // read/validation step has succeeded, so failures preserve the original selection.
  const roi = await readExistingSelection(doc, fullBounds);
  const layerMask = await readActiveLayerMask(doc);
  if (roi) multiplyMaskByRoi(layerMask.mask, layerMask.bounds, roi.data, roi.bounds);
  if (!hasNonZero(layerMask.mask)) {
    throw new Error("活动图层在当前搜索选区内没有有效像素。");
  }

  const maskStats = measureMask(
    layerMask.mask,
    layerMask.bounds,
    layerMask.width,
    layerMask.height
  );

  await putMaskAsSelection(doc, layerMask);
  return {
    info,
    diagnostics: {
      documentId: doc.id,
      layerId: layerMask.layer.id,
      layerName: layerMask.layer.name,
      pixelFormat: layerMask.pixelFormat,
      components: layerMask.components,
      bounds: layerMask.bounds,
      usedExistingSelection: Boolean(roi),
      roiBounds: roi ? roi.bounds : null,
      selectedPixels: maskStats.selectedPixels,
      totalPixels: maskStats.totalPixels,
      selectedBounds: maskStats.selectedBounds
    }
  };
}

async function runInModal(executionContext, rawInfo) {
  if (executionContext && executionContext.hostControl) {
    return runLayerAlphaSelection(rawInfo);
  }
  return photoshop.core.executeAsModal(
    () => runLayerAlphaSelection(rawInfo),
    { commandName: "SAM 3.1 选区 PoC" }
  );
}

module.exports = {
  assertSupportedDocument,
  createCenterTestRoi,
  documentBounds,
  readActiveLayerMask,
  readExistingSelection,
  runInModal,
  runLayerAlphaSelection
};
