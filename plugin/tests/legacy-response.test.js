"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.resolve(__dirname, "../../legacy/SAM31 Image Processor Bridge.jsx"), "utf8");
const body = source.slice(source.indexOf("    function applyInferenceResponse("), source.indexOf("    function splitPrompts("));
function fixture() {
  const events = [];
  const context = {
    UnitValue: (value, unit) => { assert.equal(unit, "px"); return value; }, SelectionType: { REPLACE: "replace" },
    fail: message => { throw Error(message); }, loadTransparencySelection: () => events.push("mask")
  };
  vm.runInNewContext(body, context);
  const doc = { width: { as: () => 8000 }, height: { as: () => 12000 }, selection: {
    select: (points, mode, feather, antialias) => {
      assert.deepEqual(JSON.parse(JSON.stringify(points)), [[0, 0], [8000, 0], [8000, 12000], [0, 12000]]);
      assert.equal(mode, "replace"); assert.equal(feather, 0); assert.equal(antialias, false); events.push("all");
    }
  } };
  const request = { requestId: "current", output: { file: "mask.png" } };
  return { events, run: response => context.applyInferenceResponse(doc, response, request, { exists: true }) };
}
const noObject = { requestId: "current", status: "error", error: { code: "NO_OBJECT" } };
test("bridge NO_OBJECT continues without mask import", () => {
  const f = fixture(); f.run(noObject); f.run(noObject);
  assert.deepEqual(f.events, ["all", "all"]);
});
test("bridge rejects other errors and stale responses without modifying selection", () => {
  const f = fixture();
  for (const response of [null, { ...noObject, requestId: "stale" }, { ...noObject, schemaVersion: 2 },
    { ...noObject, status: "unexpected" }, { ...noObject, error: { code: "TECHNICAL_FAILURE" } }]) assert.throws(() => f.run(response));
  assert.deepEqual(f.events, []);
});
test("bridge successful response still imports the model mask", () => {
  const f = fixture(); f.run({ schemaVersion: 1, requestId: "current", status: "ok", mask: { file: "mask.png", encoding: "png-alpha8" } });
  assert.deepEqual(f.events, ["mask"]);
});
