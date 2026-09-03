"use strict";

const MAX_CANDIDATES = 5;

function parsePromptCandidates(rawPrompt) {
  if (typeof rawPrompt !== "string") {
    throw new Error("提示词必须是字符串。");
  }

  const candidates = [];
  const seen = new Set();
  for (const part of rawPrompt.split(",")) {
    const value = part.trim().replace(/\s+/g, " ");
    if (!value) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9 '\-/]*$/.test(value)) {
      throw new Error("提示词只支持英文、数字、空格、撇号、连字符和斜杠。");
    }
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(value);
    }
  }

  if (candidates.length === 0) {
    throw new Error("请输入至少一个英文提示词。");
  }
  if (candidates.length > MAX_CANDIDATES) {
    throw new Error(`提示词候选最多 ${MAX_CANDIDATES} 个。`);
  }
  return candidates;
}

function normalizeThreshold(value) {
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0.05 || threshold > 0.95) {
    throw new Error("置信度阈值必须在 0.05 到 0.95 之间。");
  }
  return Math.round(threshold * 100) / 100;
}

function normalizeActionInfo(info) {
  const value = info || {};
  return {
    schemaVersion: 1,
    modelId: "sam3.1-multiplex-fp16",
    prompt: parsePromptCandidates(value.prompt || "pants").join(", "),
    threshold: normalizeThreshold(value.threshold == null ? 0.5 : value.threshold),
    prototypeMode: value.prototypeMode === "forced-error" ? "forced-error" : "layer-alpha"
  };
}

function intersectBounds(a, b) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}

function alphaToMask(pixelData, width, height, components) {
  const size = width * height;
  if (![1, 2, 3, 4].includes(components)) {
    throw new Error(`不支持的像素分量数：${components}`);
  }
  if (pixelData.length < size * components) {
    throw new Error("图层像素缓冲区长度不足。");
  }

  const mask = new Uint8Array(size);
  const alphaIndex = components === 2 || components === 4 ? components - 1 : -1;
  if (alphaIndex < 0) {
    mask.fill(255);
    return mask;
  }

  for (let i = 0; i < size; i += 1) {
    mask[i] = pixelData[i * components + alphaIndex];
  }
  return mask;
}

function multiplyMaskByRoi(targetMask, targetBounds, roiData, roiBounds) {
  const overlap = intersectBounds(targetBounds, roiBounds);
  if (!overlap) {
    targetMask.fill(0);
    return targetMask;
  }

  const targetWidth = targetBounds.right - targetBounds.left;
  const roiWidth = roiBounds.right - roiBounds.left;
  for (let y = targetBounds.top; y < targetBounds.bottom; y += 1) {
    for (let x = targetBounds.left; x < targetBounds.right; x += 1) {
      const targetIndex = (y - targetBounds.top) * targetWidth + (x - targetBounds.left);
      if (x < overlap.left || x >= overlap.right || y < overlap.top || y >= overlap.bottom) {
        targetMask[targetIndex] = 0;
        continue;
      }
      const roiIndex = (y - roiBounds.top) * roiWidth + (x - roiBounds.left);
      targetMask[targetIndex] = Math.round((targetMask[targetIndex] * roiData[roiIndex]) / 255);
    }
  }
  return targetMask;
}

function hasNonZero(mask) {
  for (const value of mask) {
    if (value !== 0) return true;
  }
  return false;
}

module.exports = {
  MAX_CANDIDATES,
  alphaToMask,
  hasNonZero,
  intersectBounds,
  multiplyMaskByRoi,
  normalizeActionInfo,
  normalizeThreshold,
  parsePromptCandidates
};
