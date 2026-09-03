"use strict";

const { action } = require("photoshop");
const { entrypoints } = require("uxp");
const { normalizeActionInfo } = require("./lib/pure.js");
const { createCenterTestRoi, runInModal } = require("./lib/photoshop-bridge.js");

const ACTION_METHOD = "sam31SelectionActionHandler";
const ACTION_NAME = "SAM 3.1 文本选区";
let panelRoot = null;

function status(message, isError) {
  const element = panelRoot && panelRoot.querySelector("#status");
  if (!element) return;
  element.textContent = message;
  element.style.color = isError ? "#ff9b9b" : "inherit";
}

function panelInfo(mode) {
  const prompt = panelRoot ? panelRoot.querySelector("#prompt").value : "pants";
  const threshold = panelRoot ? panelRoot.querySelector("#threshold").value : 0.5;
  return normalizeActionInfo({ prompt, threshold, prototypeMode: mode || "layer-alpha" });
}

async function executeFromPanel(mode) {
  const info = panelInfo(mode);
  status("正在读取活动图层……", false);
  try {
    const result = await runInModal(null, info);
    status(`完成\n${JSON.stringify(result.diagnostics, null, 2)}`, false);
    return result;
  } catch (error) {
    status(error && error.message ? error.message : String(error), true);
    throw error;
  }
}

async function executeAndRecord() {
  const info = panelInfo("layer-alpha");
  const result = await executeFromPanel("layer-alpha");
  await action.recordAction(
    { name: ACTION_NAME, methodName: ACTION_METHOD },
    info
  );
  status(`已执行并请求录入动作\n${JSON.stringify(result.diagnostics, null, 2)}`, false);
}

async function recordForcedFailure() {
  const info = panelInfo("forced-error");
  await action.recordAction(
    { name: ACTION_NAME, methodName: ACTION_METHOD },
    info
  );
  status(`已录入失败测试步骤\n${JSON.stringify(info, null, 2)}`, false);
}

// Photoshop Action Recording requires the method to exist in the plugin global scope.
globalThis.sam31SelectionActionHandler = async function sam31SelectionActionHandler(
  executionContext,
  rawInfo
) {
  const info = normalizeActionInfo(rawInfo);
  status(`正在重放：${info.prompt} / ${info.threshold.toFixed(2)}\n${JSON.stringify(info, null, 2)}`, false);
  try {
    await runInModal(executionContext, info);
    status(`动作重放完成：${info.prompt} / ${info.threshold.toFixed(2)}\n${JSON.stringify(info, null, 2)}`, false);
    // Photoshop uses the return value to replace info when the user invokes Record Again.
    return info;
  } catch (error) {
    status(`动作重放失败\n${error && error.message ? error.message : String(error)}`, true);
    throw error;
  }
};

function wirePanel(root) {
  panelRoot = root;
  const slider = root.querySelector("#threshold");
  const output = root.querySelector("#thresholdValue");
  slider.addEventListener("input", () => {
    output.textContent = Number(slider.value).toFixed(2);
  });
  root.querySelector("#roi").addEventListener("click", async () => {
    try {
      const bounds = await require("photoshop").core.executeAsModal(
        () => createCenterTestRoi(),
        { commandName: "建立 SAM 3.1 PoC 测试 ROI" }
      );
      status(`已建立测试 ROI\n${JSON.stringify(bounds)}`, false);
    } catch (error) {
      status(error && error.message ? error.message : String(error), true);
    }
  });
  root.querySelector("#run").addEventListener("click", () => executeFromPanel("layer-alpha").catch(() => {}));
  root.querySelector("#record").addEventListener("click", () => executeAndRecord().catch(() => {}));
  root.querySelector("#recordFail").addEventListener("click", () => recordForcedFailure().catch(() => {}));
  root.querySelector("#fail").addEventListener("click", () => executeFromPanel("forced-error").catch(() => {}));
}

entrypoints.setup({
  panels: {
    sam31PocPanel: {
      create(rootNode) {
        wirePanel(rootNode);
      },
      show(rootNode) {
        if (!panelRoot) wirePanel(rootNode);
      }
    }
  },
  commands: {
    runLayerAlphaPoc: () => runInModal(null, normalizeActionInfo({ prompt: "pants" })),
    runForcedFailurePoc: () => runInModal(null, normalizeActionInfo({
      prompt: "pants",
      prototypeMode: "forced-error"
    }))
  }
});
