"use strict";

const photoshop = require("photoshop");
const { entrypoints } = require("uxp");
const { normalizeActionInfo } = require("./lib/action-info.js");
const { cancelActive, runSelection } = require("./lib/coordinator.js");

const ACTION_METHOD = "sam31SelectionActionHandler";
const ACTION_NAME = "SAM 3.1 文本选区";
let panelRoot = null;

function setStatus(message, isError) {
  const element = panelRoot && panelRoot.querySelector("#status");
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("error", Boolean(isError));
}

function setBusy(busy) {
  if (!panelRoot) return;
  panelRoot.querySelector("#run").disabled = busy;
  panelRoot.querySelector("#record").disabled = busy;
  panelRoot.querySelector("#cancel").disabled = !busy;
}

function panelInfo() {
  return normalizeActionInfo({
    prompt: panelRoot.querySelector("#prompt").value,
    threshold: panelRoot.querySelector("#threshold").value
  });
}

async function executeSelection(executionContext, info, legacySafeIo = false) {
  const stages = {
    capture: { message: "正在读取活动图层……", value: 0.05 },
    prepare: { message: "正在准备本地请求……", value: 0.20 },
    infer: { message: "正在运行本地 SAM 3.1 推理……", value: 0.30 },
    read: { message: "正在校验推理结果……", value: 0.85 },
    commit: { message: "正在写回 Photoshop 选区……", value: 0.95 },
    complete: { message: "选区写回完成。", value: 1.0 }
  };
  const options = {
    legacySafeIo,
    onStage(stage) {
      const detail = stages[stage];
      if (!detail) return;
      setStatus(detail.message, false);
      if (executionContext && typeof executionContext.reportProgress === "function") {
        executionContext.reportProgress({ commandName: detail.message, value: detail.value });
      }
    }
  };
  if (!(executionContext && executionContext.hostControl)) {
    options.executeCapture = (capture) => photoshop.core.executeAsModal(capture, { commandName: `${ACTION_NAME} · 读取` });
    options.executeCommit = (commit) => photoshop.core.executeAsModal(commit, { commandName: ACTION_NAME });
  }
  return runSelection(info, options);
}

async function executeFromPanel(record) {
  const info = panelInfo();
  setBusy(true);
  setStatus("正在读取活动图层并启动本地推理……", false);
  try {
    const response = await executeSelection(null, info);
    if (record) {
      await photoshop.action.recordAction({ name: ACTION_NAME, methodName: ACTION_METHOD }, info);
    }
    const suffix = record ? "，并已请求录入动作" : "";
    setStatus(`完成${suffix}：${response.selected.prompt} / ${Number(response.selected.score).toFixed(3)}`, false);
    return response;
  } catch (error) {
    const cancelled = error && error.code === "CANCELLED";
    setStatus(error && error.message ? error.message : String(error), !cancelled);
    throw error;
  } finally {
    setBusy(false);
  }
}

globalThis.sam31SelectionActionHandler = async function sam31SelectionActionHandler(executionContext, rawInfo) {
  const info = normalizeActionInfo(rawInfo);
  setStatus(`正在重放：${info.prompt} / ${info.threshold.toFixed(2)}`, false);
  try {
    const response = await executeSelection(executionContext, info, false);
    setStatus(`动作完成：${response.selected.prompt} / ${Number(response.selected.score).toFixed(3)}`, false);
    return info;
  } catch (error) {
    setStatus(`动作失败：${error && error.message ? error.message : String(error)}`, true);
    throw error;
  }
};

function wirePanel(root) {
  panelRoot = root;
  const slider = root.querySelector("#threshold");
  const output = root.querySelector("#thresholdValue");
  slider.addEventListener("input", () => { output.textContent = Number(slider.value).toFixed(2); });
  root.querySelector("#run").addEventListener("click", () => executeFromPanel(false).catch(() => {}));
  root.querySelector("#record").addEventListener("click", () => executeFromPanel(true).catch(() => {}));
  root.querySelector("#cancel").addEventListener("click", async () => {
    const cancelled = await cancelActive();
    setStatus(cancelled ? "已请求取消，原选区将在命令结束前保持不变。" : "当前没有可取消的任务。", false);
  });
}

entrypoints.setup({
  panels: {
    sam31SelectionPanel: {
      create(rootNode) { wirePanel(rootNode); },
      show(rootNode) { if (!panelRoot) wirePanel(rootNode); }
    }
  },
  commands: {
    runRecordedDefaults: () => executeSelection(null, normalizeActionInfo({ prompt: "pants", threshold: 0.5 }))
  }
});
