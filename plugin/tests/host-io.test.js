"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function loadIo(photoshop) {
  const filename = path.resolve(__dirname, "../lib/photoshop-io.js");
  const localRequire = createRequire(filename);
  const context = { module: { exports: {} }, Uint8Array, require: (name) => name === "photoshop" ? photoshop : localRequire(name) };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });
  return context.module.exports;
}
const bounds = { left: 0, top: 0, right: 2, bottom: 1 };

test("known absence of selection requires no Imaging read", async () => {
  const io = loadIo({ imaging: { getSelection: () => { throw Error("must not call"); } } });
  assert.equal(await io.captureSelection({ selection: { bounds: null } }, bounds), null);
});
test("selection read failure never silently expands ROI to whole image", async () => {
  const io = loadIo({ imaging: { getSelection: async () => { throw Error("host failed"); } } });
  await assert.rejects(io.captureSelection({ id: 1, selection: { bounds } }, bounds), /避免误在全图搜索/);
});
test("empty selection response is rejected and disposed", async () => {
  let disposed = false;
  const io = loadIo({ imaging: { getSelection: async () => ({ sourceBounds: bounds, imageData: {
    width: 2, height: 1, components: 1, componentSize: 8,
    getData: async () => new Uint8Array(2), dispose: () => { disposed = true; }
  } }) } });
  await assert.rejects(io.captureSelection({ id: 1, selection: { bounds } }, bounds), /没有可用像素/);
  assert.equal(disposed, true);
});
test("capture guards reject a switched document, changed layer and changed history", () => {
  const doc = { id: 1, activeLayers: [{ id: 2 }], width: 2, height: 1, activeHistoryState: { id: 3 } };
  const ps = { app: { activeDocument: doc } };
  const io = loadIo(ps);
  const capture = { state: { documentId: 1, layerId: 2, width: 2, height: 1, historyId: 3 } };
  io.assertCaptureUnchanged(capture);
  doc.id = 99; assert.throws(() => io.assertCaptureUnchanged(capture), /未写入/);
  doc.id = 1; doc.activeLayers[0].id = 99; assert.throws(() => io.assertCaptureUnchanged(capture));
  doc.activeLayers[0].id = 2; doc.activeHistoryState.id = 99; assert.throws(() => io.assertCaptureUnchanged(capture));
});
test("all public manifests retain filesystem permission", () => {
  for (const name of ["manifest.json", "manifest.hybrid.template.json"]) {
    const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "..", name), "utf8"));
    assert.equal(manifest.requiredPermissions.localFileSystem, "fullAccess");
    assert.equal(manifest.requiredPermissions.enableAddon, true);
  }
});
test("runtime errors have short Chinese summary without long paths", () => {
  const { errorSummary } = require("../lib/ui-messages.js");
  const summary = errorSummary("未找到或无法访问 FR SAM 运行时配置。C:\\Users\\example\\".repeat(4));
  assert.ok(summary.length < 100);
  assert.ok(!summary.includes("C:\\Users"));
});

test("legacy build markers cannot become ExtendScript at-sign directives", () => {
  const jsx = fs.readFileSync(path.resolve(__dirname, "../../legacy/SAM31 Image Processor Bridge.jsx"), "utf8");
  assert.doesNotMatch(jsx, /\/\/\s*@sam31/);
  assert.match(jsx, /var ALLOW_DEV_FALLBACK = false;/);
  assert.match(jsx, /if \(exportedLayer\.grouped\) exportedLayer\.grouped = false;/);
});
