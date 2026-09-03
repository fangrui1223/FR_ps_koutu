"use strict";

function toRgba8(source, components, width, height) {
  const pixelCount = width * height;
  if (!source || !Number.isInteger(pixelCount) || pixelCount <= 0) {
    throw new Error("活动图层像素缓冲区无效。");
  }
  if (components !== 3 && components !== 4) {
    throw new Error(`活动图层未返回 RGB/RGBA 8 位像素（实际 ${components} 分量）。`);
  }
  if (source.length !== pixelCount * components) {
    throw new Error("活动图层像素缓冲区长度与边界不一致。");
  }
  if (components === 4) {
    return { data: Uint8Array.from(source.subarray(0, pixelCount * 4)), sourceComponents: 4 };
  }

  const rgba = new Uint8Array(pixelCount * 4);
  for (let sourceIndex = 0, targetIndex = 0; targetIndex < rgba.length; sourceIndex += 3, targetIndex += 4) {
    rgba[targetIndex] = source[sourceIndex];
    rgba[targetIndex + 1] = source[sourceIndex + 1];
    rgba[targetIndex + 2] = source[sourceIndex + 2];
    rgba[targetIndex + 3] = 255;
  }
  return { data: rgba, sourceComponents: 3 };
}

module.exports = { toRgba8 };
