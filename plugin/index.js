"use strict";

const photoshop = require("photoshop");
const { entrypoints } = require("uxp");
const { normalizeActionInfo } = require("./lib/action-info.js");
const { cancelActive, runSelection } = require("./lib/coordinator.js");
const { errorSummary } = require("./lib/ui-messages.js");
const manifest = require("./manifest.json");

const ACTION_METHOD = "frSamSelectionActionHandler";
const ACTION_NAME = "FR SAM 文本选区";
let panelRoot = null;
let busy = false;

function completionMessage(response, prefix) {
  if (response.fallback && response.fallback.mode === "selectAll") {
    return `${prefix}：未找到满足阈值的对象，已全选整个画布，可继续后续操作。`;
  }
  return `${prefix}：${response.selected.prompt} / ${Number(response.selected.score).toFixed(3)}`;
}

function setStatus(message, isError) {
  const element = panelRoot && panelRoot.querySelector("#status");
  if (!element) return;
  element.textContent = isError ? errorSummary(message) : message;
  element.title = message;
  element.classList.toggle("error", Boolean(isError));
  const region = panelRoot.querySelector(".status-region");
  if (region) region.classList.toggle("is-error", Boolean(isError));
  const detail = panelRoot.querySelector("#errorDetail");
  detail.textContent = isError ? message : "";
  detail.hidden = true;
  const toggle = panelRoot.querySelector("#showDetail");
  toggle.hidden = !isError;
  toggle.textContent = "查看错误详情";
}

function setBusy(busy) {
  if (!panelRoot) return;
  const main = panelRoot.querySelector("main");
  if (main) main.classList.toggle("is-busy", busy);
  panelRoot.querySelector("#run").disabled = busy;
  panelRoot.querySelector("#record").disabled = busy;
  panelRoot.querySelector("#prompt").disabled = busy;
  panelRoot.querySelector("#threshold").disabled = busy;
  const cancel = panelRoot.querySelector("#cancel");
  cancel.hidden = !busy;
  cancel.disabled = !busy;
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
    infer: { message: "正在运行本地 SAM 推理……", value: 0.30 },
    read: { message: "正在校验推理结果……", value: 0.85 },
    commit: { message: "正在写回 Photoshop 选区……", value: 0.95 },
    complete: { message: "选区写回完成。", value: 1.0 }
  };
  const options = {
    legacySafeIo,
    isCancelled: () => Boolean(executionContext && executionContext.isCancelled),
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

async function executeFromPanel(record, suppliedInfo) {
  if (busy) return;
  busy = true;
  setBusy(true);
  setStatus("正在读取活动图层并启动本地推理……", false);
  try {
    const info = suppliedInfo || panelInfo();
    if (manifest.requiredPermissions.localFileSystem !== "fullAccess") {
      throw new Error("插件安装包缺少文件访问权限，请升级到 0.9.2 或更新版本并重启 Photoshop。");
    }
    const response = await executeSelection(null, info);
    if (record) {
      await photoshop.action.recordAction({ name: ACTION_NAME, methodName: ACTION_METHOD }, info);
    }
    const suffix = record ? "，并已请求录入动作" : "";
    setStatus(completionMessage(response, `完成${suffix}`), false);
    return response;
  } catch (error) {
    const cancelled = error && error.code === "CANCELLED";
    setStatus(error && error.message ? error.message : String(error), !cancelled);
    throw error;
  } finally {
    busy = false;
    setBusy(false);
  }
}

globalThis.frSamSelectionActionHandler = async function frSamSelectionActionHandler(executionContext, rawInfo) {
  if (busy) throw new Error("已有一个 FR SAM 任务正在运行。");
  busy = true;
  setBusy(true);
  try {
    const info = normalizeActionInfo(rawInfo);
    if (executionContext) executionContext.onCancel = () => { cancelActive().catch(() => {}); };
    setStatus(`正在重放：${info.prompt} / ${info.threshold.toFixed(2)}`, false);
    const response = await executeSelection(executionContext, info, false);
    setStatus(completionMessage(response, "动作完成"), false);
    return info;
  } catch (error) {
    setStatus(`动作失败：${error && error.message ? error.message : String(error)}`, true);
    throw error;
  } finally {
    busy = false;
    setBusy(false);
  }
};

function wirePanel(root) {
  panelRoot = root;
  root.querySelector("#version").textContent = `v${manifest.version}`;
  root.querySelector("#showRules").addEventListener("click", () => {
    const list = root.querySelector("#rulesList");
    list.hidden = !list.hidden;
    root.querySelector("#showRules").textContent = list.hidden ? "查看使用规则" : "收起使用规则";
  });
  root.querySelector("#showDetail").addEventListener("click", () => {
    const detail = root.querySelector("#errorDetail");
    detail.hidden = !detail.hidden;
    root.querySelector("#showDetail").textContent = detail.hidden ? "查看错误详情" : "收起错误详情";
  });
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
    runRecordedDefaults: () => executeFromPanel(false, normalizeActionInfo({ prompt: "pants", threshold: 0.5 }))
  }
});
