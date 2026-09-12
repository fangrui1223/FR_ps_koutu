"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../../legacy/SAM31 Image Processor Bridge.jsx"), "utf8");
test("legacy bridge has no shell launch and preserves old action keys", () => {
  assert.doesNotMatch(source, /app\.system\s*\(|cmd\.exe|powershell\.exe/);
  assert.match(source, /new File\(runtime.launcher\)\.execute\(\)/);
  assert.match(source, /sam31Prompt/); assert.match(source, /sam31Threshold/);
  new vm.Script(source.replace(/^#target.*$/m, ""));
});
function guardFixture() {
  const flags = {};
  const context = {
    DocumentMode: { RGB: "RGB" }, BitsPerChannelType: { EIGHT: 8 }, LayerKind: { NORMAL: "normal" }, BlendMode: { NORMAL: "normal" },
    ActionReference: function () { this.putEnumerated = () => {}; }, charIDToTypeID: x => x, stringIDToTypeID: x => x,
    executeActionGet: () => ({ hasKey: key => Object.hasOwn(flags, key), getBoolean: key => flags[key] })
  };
  vm.runInNewContext(source.slice(source.indexOf("    function canExportBackgroundDirectly("), source.indexOf("    function saveInputPlanes(")), context);
  const doc = { mode: "RGB", bitsPerChannel: 8, layers: [1], channels: [1,2,3], activeChannels: [1,2,3], activeLayer: {
    isBackgroundLayer: true, kind: "normal", visible: true, opacity: 100, fillOpacity: 100, blendMode: "normal", grouped: false
  } };
  return { doc, flags, run: roi => context.canExportBackgroundDirectly(doc, roi) };
}
test("direct export is restricted to plain RGB8 backgrounds without ROI", () => {
  const f = guardFixture(); assert.equal(f.run(false), true); assert.equal(f.run(true), false);
  for (const [key, value] of Object.entries({ mode: "CMYK", bitsPerChannel: 16, layers: [1,2], channels: [1,2,3,4], activeChannels: [1] })) {
    const g = guardFixture(); g.doc[key] = value; assert.equal(g.run(false), false, key);
  }
  for (const [key, value] of Object.entries({ isBackgroundLayer: false, kind: "smartObject", visible: false, opacity: 50, fillOpacity: 50, blendMode: "multiply", grouped: true })) {
    const g = guardFixture(); g.doc.activeLayer[key] = value; assert.equal(g.run(false), false, key);
  }
  for (const key of ["layerEffects", "hasUserMask", "hasVectorMask", "hasFilterMask"]) {
    const g = guardFixture(); g.flags[key] = true; assert.equal(g.run(false), false, key);
  }
});
test("mask is placed into a previously hidden container and cleanup is retained", () => {
  assert.ok(source.indexOf("hiddenGroup.visible = false") < source.indexOf('executeAction(charIDToTypeID("Plc ")'));
  assert.match(source, /selectionLayer\.parent\.id !== hiddenGroup\.id/);
  assert.match(source, /if \(hiddenGroup\) hiddenGroup.remove\(\)/);
  assert.match(source, /doc\.activeHistoryState = originalState/);
});
