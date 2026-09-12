"use strict";

const ADDON_NAME = "sam31-supervisor.uxpaddon";
let addon;
let addonPromise;

async function loadAddon() {
  if (addon) return addon;
  if (addonPromise) return addonPromise;
  addonPromise = (async () => {
    let loaded;
    try {
      // UXP Hybrid addons are resolved asynchronously even though they use
      // CommonJS require syntax. Adobe's SDK examples deliberately await it.
      loaded = await require(ADDON_NAME);
    } catch (error) {
      const unavailable = new Error("本机后端桥接尚未安装或无法加载。请安装配套 Windows 后端后重试。");
      unavailable.code = "BACKEND_BRIDGE_UNAVAILABLE";
      unavailable.cause = error;
      throw unavailable;
    }
    if (!loaded || typeof loaded.infer !== "function") {
      const invalid = new Error("本机后端桥接版本无效，请重新安装。");
      invalid.code = "BACKEND_BRIDGE_INVALID";
      throw invalid;
    }
    addon = loaded;
    return addon;
  })();
  try {
    return await addonPromise;
  } catch (error) {
    addonPromise = null;
    throw error;
  }
}

async function infer(sessionRootNativePath, request) {
  const bridge = await loadAddon();
  let raw;
  try {
    raw = await bridge.infer(sessionRootNativePath, JSON.stringify(request));
  } catch (error) {
    const code = error && error.code ? String(error.code) : "";
    const message = error && error.message ? String(error.message) : String(error);
    if (code === "CANCELLED" || /cancelled/i.test(message)) {
      const cancelled = new Error("任务已取消，原选区保持不变。");
      cancelled.code = "CANCELLED";
      cancelled.cause = error;
      throw cancelled;
    }
    throw error;
  }
  let response;
  try {
    response = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch (error) {
    const invalid = new Error("本机后端返回了无法解析的响应。");
    invalid.code = "BACKEND_PROTOCOL_ERROR";
    invalid.cause = error;
    throw invalid;
  }
  if (response && response.status === "error") {
    // V1 service errors omit schemaVersion; accept an absent field, never an
    // explicitly incompatible one. Correlate the ID before trusting NO_OBJECT.
    if ((response.schemaVersion != null && response.schemaVersion !== 1) || response.requestId !== request.requestId ||
        !response.error || typeof response.error.code !== "string") {
      const invalid = new Error("本机后端返回了不匹配或无效的错误响应。");
      invalid.code = "BACKEND_PROTOCOL_ERROR";
      throw invalid;
    }
    const serviceError = new Error(response.error && response.error.message ? response.error.message : "本机后端执行失败。");
    serviceError.code = response.error && response.error.code;
    serviceError.requestId = response.requestId;
    serviceError.retryable = Boolean(response.error && response.error.retryable);
    throw serviceError;
  }
  return response;
}

async function cancel(requestId) {
  if (!addon || typeof addon.cancel !== "function") return false;
  return Boolean(await addon.cancel(String(requestId)));
}

module.exports = { cancel, infer, loadAddon };
