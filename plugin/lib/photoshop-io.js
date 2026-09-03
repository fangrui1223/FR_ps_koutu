"use strict";

const photoshop = require("photoshop");
const { toRgba8 } = require("./pixel-buffer.js");
const {
  assertInside,
  dimensions,
  documentBounds,
  hasNonZero,
  normalizeBounds,
  normalizeGray8
} = require("./imaging-contract.js");

function dispose(value) {
  const imageData = value && (value.imageData || value);
  if (imageData && typeof imageData.dispose === "function") imageData.dispose();
}

function temporaryName(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 0x1000000).toString(16)}`;
}

function topLevelLayers(doc) {
  return Array.from(doc && doc.layers ? doc.layers : []);
}

async function saveActiveLayerPng(doc, folder, canvasBounds) {
  const sourceLayer = doc.activeLayers[0];
  const file = await folder.createFile("input.png", { overwrite: true });
  let exportDoc = null;
  try {
    exportDoc = await photoshop.app.createDocument({
      width: canvasBounds.right,
      height: canvasBounds.bottom,
      resolution: Number(doc.resolution) || 72,
      mode: "RGBColorMode",
      depth: 8,
      fill: "transparent",
      name: temporaryName("SAM31-input")
    });
    const placeholders = topLevelLayers(exportDoc);
    const exportedLayer = await sourceLayer.duplicate(exportDoc);
    for (const layer of placeholders) layer.visible = false;
    exportedLayer.visible = true;
    if (exportedLayer.isClippingMask) exportedLayer.isClippingMask = false;
    try { exportedLayer.blendMode = photoshop.constants.BlendMode.NORMAL; } catch (error) {}
    await exportDoc.saveAs.png(file, { compression: 0, interlaced: false }, true);
  } finally {
    if (exportDoc) await Promise.resolve(exportDoc.closeWithoutSaving()).catch(() => {});
  }
  return {
    layer: sourceLayer,
    fileName: "input.png",
    encoding: "png-rgba8",
    bounds: canvasBounds,
    width: canvasBounds.right,
    height: canvasBounds.bottom,
    components: 4,
    sourceComponents: 4
  };
}

async function fillCurrentSelectionWhite() {
  await photoshop.action.batchPlay([{
    _obj: "fill",
    using: { _enum: "fillContents", _value: "white" },
    opacity: { _unit: "percentUnit", _value: 100 },
    mode: { _enum: "blendMode", _value: "normal" },
    _options: { dialogOptions: "dontDisplay" }
  }], {});
}

async function saveSelectionPng(doc, folder, canvasBounds) {
  let selectionBounds = null;
  try { selectionBounds = doc.selection && doc.selection.bounds; } catch (error) {}
  if (selectionBounds == null) return null;

  const file = await folder.createFile("roi.png", { overwrite: true });
  let roiDoc = null;
  try {
    roiDoc = await doc.duplicate(temporaryName("SAM31-roi"), false);
    const originalLayers = topLevelLayers(roiDoc);
    const maskLayer = await roiDoc.layers.add();
    maskLayer.name = "SAM31 temporary ROI";
    for (const layer of originalLayers) layer.visible = false;
    maskLayer.visible = true;
    await fillCurrentSelectionWhite();
    await roiDoc.saveAs.png(file, { compression: 0, interlaced: false }, true);
  } finally {
    if (roiDoc) await Promise.resolve(roiDoc.closeWithoutSaving()).catch(() => {});
  }
  return {
    fileName: "roi.png",
    encoding: "png-alpha8",
    bounds: canvasBounds,
    width: canvasBounds.right,
    height: canvasBounds.bottom
  };
}

function assertSupportedDocument(doc) {
  if (!doc) throw new Error("没有活动文档。");
  if (!doc.activeLayers || doc.activeLayers.length !== 1) throw new Error("请只选择一个活动图层。");
  if (!String(doc.mode || "").toLowerCase().includes("rgb")) throw new Error("只支持 RGB 文档。");
  const eight = photoshop.constants && photoshop.constants.BitsPerChannelType && photoshop.constants.BitsPerChannelType.EIGHT;
  const bits = String(doc.bitsPerChannel || "").toLowerCase();
  if (doc.bitsPerChannel !== eight && Number(doc.bitsPerChannel) !== 8 && !bits.includes("eight") && !bits.includes("8")) {
    throw new Error("只支持 RGB 8 位文档。");
  }
  documentBounds(doc);
}

async function captureSelection(doc, bounds) {
  try {
    if (doc.selection && doc.selection.bounds == null) return null;
  } catch (error) {
    // Older host builds may not expose Document.selection; getSelection remains
    // the authoritative fallback for the supported Photoshop range.
  }
  let result;
  try {
    result = await photoshop.imaging.getSelection({ documentID: doc.id, sourceBounds: bounds });
  } catch (error) {
    return null;
  }
  if (!result || !result.imageData) return null;
  try {
    const data = await result.imageData.getData({ chunky: true });
    const sourceBounds = normalizeBounds(result.sourceBounds, "搜索选区边界");
    assertInside(bounds, sourceBounds, "搜索选区边界");
    const normalized = normalizeGray8(data, result.imageData, sourceBounds, "搜索选区");
    if (!hasNonZero(normalized)) return null;
    const { width, height } = dimensions(sourceBounds);
    return { data: normalized, bounds: sourceBounds, width, height };
  } finally {
    dispose(result);
  }
}

async function captureActiveLayer(doc) {
  const layer = doc.activeLayers[0];
  const canvasBounds = documentBounds(doc);
  const result = await photoshop.imaging.getPixels({
    documentID: doc.id,
    layerID: layer.id,
    sourceBounds: canvasBounds,
    colorSpace: "RGB",
    componentSize: 8
  });
  try {
    if (result.level !== 0) throw new Error(`活动图层读取意外使用了金字塔级别 ${result.level}。`);
    const data = await result.imageData.getData({ chunky: true });
    const bounds = normalizeBounds(result.sourceBounds, "活动图层边界");
    assertInside(canvasBounds, bounds, "活动图层边界");
    const { width, height } = dimensions(bounds);
    if (result.imageData.componentSize !== 8) {
      throw new Error(`活动图层未返回 8 位像素（实际 ${result.imageData.componentSize} 位）。`);
    }
    const components = result.imageData.components;
    const normalized = toRgba8(data, components, width, height);
    return {
      layer,
      data: normalized.data,
      bounds,
      width,
      height,
      components: 4,
      sourceComponents: normalized.sourceComponents
    };
  } finally {
    dispose(result);
  }
}

async function captureDocument(options = {}) {
  const doc = photoshop.app.activeDocument;
  assertSupportedDocument(doc);
  const bounds = documentBounds(doc);
  const legacySafe = Boolean(options.legacySafe);
  if (legacySafe && !options.folder) throw new Error("动作兼容捕获缺少临时目录。");
  const roi = legacySafe
    ? await saveSelectionPng(doc, options.folder, bounds)
    : await captureSelection(doc, bounds);
  const input = legacySafe
    ? await saveActiveLayerPng(doc, options.folder, bounds)
    : await captureActiveLayer(doc);
  let sourcePath = null;
  try {
    sourcePath = doc.path ? String(doc.path) : null;
  } catch (error) {
    sourcePath = null;
  }
  return { doc, bounds, roi, input, sourcePath, legacySafe };
}

async function commitSelectionFromPng(doc, maskFile, assertNotCancelled) {
  if (!maskFile) throw new Error("动作兼容写回缺少掩码文件。");
  let maskDoc = null;
  let selectionLayer = null;
  try {
    if (typeof assertNotCancelled === "function") assertNotCancelled();
    maskDoc = await photoshop.app.open(maskFile);
    const sourceLayer = maskDoc.activeLayers[0] || maskDoc.layers[0];
    if (!sourceLayer) throw new Error("动作兼容掩码没有可读取图层。");
    selectionLayer = await sourceLayer.duplicate(doc);
    await Promise.resolve(maskDoc.closeWithoutSaving());
    maskDoc = null;
    if (typeof assertNotCancelled === "function") assertNotCancelled();
    await doc.selection.load(selectionLayer, photoshop.constants.SelectionType.REPLACE, false);
  } finally {
    if (maskDoc) await Promise.resolve(maskDoc.closeWithoutSaving()).catch(() => {});
    if (selectionLayer) await Promise.resolve(selectionLayer.delete()).catch(() => {});
  }
}

async function commitSelection(doc, mask, width, height, bounds, assertNotCancelled) {
  if (mask && mask.encoding === "png-alpha8") {
    await commitSelectionFromPng(doc, mask.file, assertNotCancelled);
    return;
  }
  if (!(mask instanceof Uint8Array) || mask.length !== width * height) throw new Error("输出选区缓冲区尺寸无效。");
  const normalizedBounds = normalizeBounds(bounds, "输出选区边界");
  const expected = dimensions(normalizedBounds);
  if (expected.width !== width || expected.height !== height) throw new Error("输出选区尺寸与边界不一致。");
  assertInside(documentBounds(doc), normalizedBounds, "输出选区边界");
  let hasPixel = false;
  for (let index = 0; index < mask.length; index += 1) {
    if (mask[index] !== 0) {
      hasPixel = true;
      break;
    }
  }
  if (!hasPixel) throw new Error("没有找到满足阈值的对象。");
  const imageData = await photoshop.imaging.createImageDataFromBuffer(mask, {
    width,
    height,
    components: 1,
    chunky: true,
    colorSpace: "Grayscale",
    colorProfile: "Gray Gamma 2.2"
  });
  try {
    if (typeof assertNotCancelled === "function") assertNotCancelled();
    await photoshop.imaging.putSelection({
      documentID: doc.id,
      imageData,
      replace: true,
      targetBounds: { left: normalizedBounds.left, top: normalizedBounds.top },
      commandName: "SAM 3.1 文本选区"
    });
  } finally {
    dispose(imageData);
  }
}

module.exports = {
  assertSupportedDocument,
  captureActiveLayer,
  captureDocument,
  captureSelection,
  commitSelection,
  commitSelectionFromPng,
  documentBounds
};
