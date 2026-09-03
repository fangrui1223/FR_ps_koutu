"use strict";

const MAX_PIXELS = 96000000;
const MAX_SIDE = 12000;

function numeric(value) {
  if (typeof value === "number") return value;
  if (value && typeof value.value === "number") return value.value;
  return Number(value);
}

function normalizeBounds(bounds, label = "边界") {
  if (!bounds || typeof bounds !== "object") throw new Error(`${label}无效。`);
  const normalized = {};
  for (const key of ["left", "top", "right", "bottom"]) {
    const value = numeric(bounds[key]);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new Error(`${label}必须使用整数坐标。`);
    }
    normalized[key] = value;
  }
  if (normalized.right <= normalized.left || normalized.bottom <= normalized.top) {
    throw new Error(`${label}尺寸必须为正数。`);
  }
  return normalized;
}

function dimensions(bounds) {
  return { width: bounds.right - bounds.left, height: bounds.bottom - bounds.top };
}

function assertInside(outer, inner, label) {
  if (
    inner.left < outer.left || inner.top < outer.top ||
    inner.right > outer.right || inner.bottom > outer.bottom
  ) {
    throw new Error(`${label}超出文档画布。`);
  }
}

function documentBounds(doc) {
  const width = numeric(doc && doc.width);
  const height = numeric(doc && doc.height);
  if (!Number.isFinite(width) || !Number.isInteger(width) || width <= 0 ||
      !Number.isFinite(height) || !Number.isInteger(height) || height <= 0) {
    throw new Error("文档尺寸无效。");
  }
  if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
    throw new Error("文档超过最长边 12000 / 96 MP 上限。");
  }
  return { left: 0, top: 0, right: width, bottom: height };
}

function normalizeGray8(data, imageData, bounds, label = "选区") {
  if (!imageData || imageData.components !== 1 || imageData.componentSize !== 8) {
    const components = imageData && imageData.components;
    const componentSize = imageData && imageData.componentSize;
    throw new Error(`${label}未返回单通道灰度 8 位数据（实际 ${components} 分量 / ${componentSize} 位）。`);
  }
  const { width, height } = dimensions(bounds);
  const expected = width * height;
  if (!data || data.length !== expected) throw new Error(`${label}缓冲区长度与边界不一致。`);
  return Uint8Array.from(data);
}

function hasNonZero(data) {
  if (!data) return false;
  for (let index = 0; index < data.length; index += 1) {
    if (data[index] !== 0) return true;
  }
  return false;
}

module.exports = {
  MAX_PIXELS,
  MAX_SIDE,
  assertInside,
  dimensions,
  documentBounds,
  hasNonZero,
  normalizeBounds,
  normalizeGray8,
  numeric
};
