"use strict";

function errorSummary(message) {
  const text = String(message || "未知错误");
  if (/运行时配置|runtime configuration|runtime is not installed/i.test(text)) {
    return "无法读取本地运行时。请确认插件与后端均为 0.9.2 或更新版本，再重启 PS；详细路径见下方。";
  }
  if (/did not become ready|failed its health check|Unable to launch/i.test(text)) {
    return "本地后端启动失败。请检查配套后端安装是否完整。";
  }
  if (/No object|NO_OBJECT/i.test(text)) return "没有找到满足阈值的对象，原选区保持不变。";
  if (/CUDA|out of memory/i.test(text)) return "GPU 推理失败或显存不足，请释放显存后重试。";
  return text.length > 160 ? text.slice(0, 160) + "……（展开查看详情）" : text;
}

module.exports = { errorSummary };
