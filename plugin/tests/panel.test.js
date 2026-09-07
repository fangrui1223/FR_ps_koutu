"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");

function harness(infer = async () => ({ selected: { prompt: "pants", score: 0.9 } })) {
  const elements = new Map();
  const root = { querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, {
      hidden: false, disabled: false, textContent: "", value: selector === "#prompt" ? "pants" : "0.50",
      classList: { toggle() {} }, addEventListener() {}
    });
    return elements.get(selector);
  } };
  const filename = path.resolve(__dirname, "../index.js");
  const localRequire = createRequire(filename);
  let setup;
  let calls = 0;
  const photoshop = { core: { executeAsModal: async (fn) => fn() }, action: { recordAction: async () => {} } };
  const context = { require(name) {
    if (name === "photoshop") return photoshop;
    if (name === "uxp") return { entrypoints: { setup(value) { setup = value; } } };
    if (name === "./lib/coordinator.js") return {
      cancelActive: async () => true,
      runSelection: async (...args) => { calls++; return infer(...args); }
    };
    return localRequire(name);
  } };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), context, { filename });
  return { context, root, setup, get calls() { return calls; } };
}

test("invalid panel prompt is visible and restores controls", async () => {
  const h = harness();
  h.setup.panels.sam31SelectionPanel.create(h.root);
  h.root.querySelector("#prompt").value = "裤子";
  await assert.rejects(h.context.executeFromPanel(false), /只支持英文/);
  assert.match(h.root.querySelector("#status").textContent, /只支持英文/);
  assert.equal(h.root.querySelector("#run").disabled, false);
  assert.equal(h.root.querySelector("#cancel").hidden, true);
  assert.equal(h.calls, 0);
});

test("duplicate panel clicks cannot overlap and controls recover after failure", async () => {
  let reject;
  const h = harness(() => new Promise((_, fail) => { reject = fail; }));
  h.setup.panels.sam31SelectionPanel.create(h.root);
  const first = h.context.executeFromPanel(false);
  const rejected = assert.rejects(first, /test failure/);
  await h.context.executeFromPanel(false);
  assert.equal(h.calls, 1);
  assert.equal(h.root.querySelector("#prompt").disabled, true);
  reject(Error("test failure"));
  await rejected;
  assert.equal(h.root.querySelector("#prompt").disabled, false);
});

test("default command works before opening panel", async () => {
  const h = harness();
  const response = await h.setup.commands.runRecordedDefaults();
  assert.equal(response.selected.prompt, "pants");
  assert.equal(h.calls, 1);
});

test("invalid recorded action is visible and does not leave panel busy", async () => {
  const h = harness();
  h.setup.panels.sam31SelectionPanel.create(h.root);
  await assert.rejects(h.context.frSamSelectionActionHandler(null, { schemaVersion: 999 }), /不支持/);
  assert.match(h.root.querySelector("#status").textContent, /不支持/);
  await h.context.executeFromPanel(false);
  assert.equal(h.calls, 1);
});
