"use strict";

const assert = require("node:assert/strict");
const {
  alphaToMask,
  intersectBounds,
  multiplyMaskByRoi,
  normalizeActionInfo,
  parsePromptCandidates
} = require("../lib/pure.js");

assert.deepEqual(parsePromptCandidates("black leather jacket, pants, Pants"), [
  "black leather jacket",
  "pants"
]);
assert.throws(() => parsePromptCandidates("裤子"), /只支持英文/);
assert.throws(() => parsePromptCandidates("a,b,c,d,e,f"), /最多 5 个/);
assert.equal(normalizeActionInfo({ threshold: "0.534" }).threshold, 0.53);
assert.deepEqual(intersectBounds(
  { left: 0, top: 0, right: 4, bottom: 4 },
  { left: 2, top: 1, right: 6, bottom: 3 }
), { left: 2, top: 1, right: 4, bottom: 3 });

const rgba = new Uint8Array([
  10, 20, 30, 0,
  10, 20, 30, 128,
  10, 20, 30, 255,
  10, 20, 30, 64
]);
assert.deepEqual(Array.from(alphaToMask(rgba, 2, 2, 4)), [0, 128, 255, 64]);

const target = new Uint8Array([255, 255, 255, 255]);
multiplyMaskByRoi(
  target,
  { left: 10, top: 20, right: 12, bottom: 22 },
  new Uint8Array([128]),
  { left: 11, top: 21, right: 12, bottom: 22 }
);
assert.deepEqual(Array.from(target), [0, 0, 0, 128]);

console.log("action-layer-poc pure tests: PASS");
