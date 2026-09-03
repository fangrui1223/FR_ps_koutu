"use strict";

const MAX_CANDIDATES = 5;
const MODEL_ID = "sam3.1-multiplex-fp16";
const SCHEMA_VERSION = 1;

function parsePromptCandidates(rawPrompt) {
  if (typeof rawPrompt !== "string") throw new Error("提示词必须是字符串。");
  const candidates = [];
  const seen = new Set();
  for (const raw of rawPrompt.split(",")) {
    const value = raw.trim().replace(/\s+/g, " ");
    if (!value) continue;
    if (value.length > 120) throw new Error("每个提示词不能超过 120 个字符。");
    if (!/^[A-Za-z0-9][A-Za-z0-9 '\-/]*$/.test(value)) {
      throw new Error("提示词只支持英文、数字、空格、撇号、连字符和斜杠。");
    }
    const key = value.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(value);
    }
  }
  if (candidates.length === 0) throw new Error("请输入至少一个英文提示词。");
  if (candidates.length > MAX_CANDIDATES) throw new Error(`提示词候选最多 ${MAX_CANDIDATES} 个。`);
  return candidates;
}

function normalizeThreshold(rawThreshold) {
  const threshold = Number(rawThreshold);
  if (!Number.isFinite(threshold) || threshold < 0.05 || threshold > 0.95) {
    throw new Error("置信度阈值必须在 0.05 到 0.95 之间。");
  }
  return Math.round(threshold * 100) / 100;
}

function migrateActionInfo(rawInfo) {
  const info = rawInfo || {};
  const sourceVersion = info.schemaVersion == null ? 0 : Number(info.schemaVersion);
  if (!Number.isInteger(sourceVersion) || sourceVersion < 0 || sourceVersion > SCHEMA_VERSION) {
    throw new Error(`不支持的动作参数版本：${info.schemaVersion}。`);
  }

  // v0 是正式版本化前录制的数据：字段名与 v1 相同，但没有 schemaVersion。
  if (sourceVersion === 0) {
    return {
      schemaVersion: SCHEMA_VERSION,
      modelId: info.modelId,
      prompt: info.prompt,
      threshold: info.threshold
    };
  }

  return { ...info, schemaVersion: SCHEMA_VERSION };
}

function normalizeActionInfo(rawInfo) {
  const info = migrateActionInfo(rawInfo);
  if (info.modelId != null && info.modelId !== MODEL_ID) {
    throw new Error(`动作需要未安装的模型：${info.modelId}。`);
  }
  const prompts = parsePromptCandidates(info.prompt == null ? "pants" : info.prompt);
  return {
    schemaVersion: SCHEMA_VERSION,
    modelId: MODEL_ID,
    prompt: prompts.join(", "),
    threshold: normalizeThreshold(info.threshold == null ? 0.5 : info.threshold)
  };
}

module.exports = {
  MAX_CANDIDATES,
  MODEL_ID,
  SCHEMA_VERSION,
  migrateActionInfo,
  normalizeActionInfo,
  normalizeThreshold,
  parsePromptCandidates
};
