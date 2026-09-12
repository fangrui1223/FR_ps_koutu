"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function client(response) {
  const context = { module: { exports: {} }, require: () => ({ infer: async () => response }) };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, "../lib/backend-client.js"), "utf8"), context);
  return context.module.exports;
}
const request = { requestId: "current-request" };
const noObject = { requestId: request.requestId, status: "error", error: { code: "NO_OBJECT", message: "No candidate", retryable: false } };

test("validated NO_OBJECT includes its request ID and does not retry", async () => {
  await assert.rejects(client(JSON.stringify(noObject)).infer("root", request), error =>
    error.code === "NO_OBJECT" && error.requestId === request.requestId && error.retryable === false);
});
test("stale and malformed error responses cannot trigger full-canvas fallback", async () => {
  for (const response of [{ ...noObject, requestId: "old" }, { ...noObject, schemaVersion: 2 },
    { ...noObject, error: null }, { ...noObject, error: { message: "NO_OBJECT" } }, "{"]) {
    await assert.rejects(client(response).infer("root", request), { code: "BACKEND_PROTOCOL_ERROR" });
  }
});
test("technical errors retain their original code", async () => {
  await assert.rejects(client({ ...noObject, error: { code: "CUDA_ERROR", retryable: true } }).infer("root", request),
    error => error.code === "CUDA_ERROR" && error.retryable === true);
});
