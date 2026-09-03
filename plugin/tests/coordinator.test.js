"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createCoordinator } = require("../lib/coordinator-core.js");

function createFixture(overrides = {}) {
  const events = [];
  const request = { requestId: "request-0001" };
  const response = {
    status: "ok",
    requestId: request.requestId,
    mask: {
      width: 2,
      height: 1,
      bounds: { left: 10, top: 20, right: 12, bottom: 21 }
    }
  };
  const prepared = { request, nativeRoot: "C:\\session", folder: {} };
  const mask = Uint8Array.from([255, 128]);
  const dependencies = {
    backend: {
      async infer() { events.push("infer"); return response; },
      async cancel(id) { events.push(`cancel:${id}`); return true; }
    },
    buildInferRequest() {},
    photoshopIo: {
      async captureDocument() { events.push("capture"); return { doc: { id: 7 } }; },
      async commitSelection(...args) {
        events.push("commit");
        assert.strictEqual(args[1], mask);
        if (typeof args[5] === "function") args[5]();
      }
    },
    sessionIo: {
      async prepare() { events.push("prepare"); return prepared; },
      async readMask() { events.push("readMask"); return mask; },
      async cleanup() { events.push("cleanup"); }
    },
    validateSuccessResponse(value) { events.push("validate"); return value; }
  };
  Object.assign(dependencies, overrides);
  return { dependencies, events, mask, prepared, request, response };
}

test("selection is committed only after every read and validation succeeds", async () => {
  const fixture = createFixture();
  const coordinator = createCoordinator(fixture.dependencies);
  assert.strictEqual(await coordinator.runSelection({ prompt: "pants" }), fixture.response);
  assert.deepStrictEqual(fixture.events, [
    "capture", "prepare", "infer", "validate", "readMask", "commit", "cleanup"
  ]);
});

test("panel execution can isolate capture and commit in short Photoshop modals", async () => {
  const fixture = createFixture();
  const coordinator = createCoordinator(fixture.dependencies);
  const response = await coordinator.runSelection({ prompt: "pants" }, {
    async executeCapture(capture) {
      fixture.events.push("enterCaptureModal");
      const value = await capture();
      fixture.events.push("leaveCaptureModal");
      return value;
    },
    async executeCommit(commit) {
      fixture.events.push("enterCommitModal");
      await commit();
      fixture.events.push("leaveCommitModal");
    }
  });
  assert.strictEqual(response, fixture.response);
  assert.deepStrictEqual(fixture.events, [
    "enterCaptureModal", "capture", "leaveCaptureModal", "prepare", "infer", "validate", "readMask",
    "enterCommitModal", "commit", "leaveCommitModal", "cleanup"
  ]);
});

test("coordinator reports deterministic stages around capture, inference, and commit", async () => {
  const stages = [];
  const fixture = createFixture();
  const coordinator = createCoordinator(fixture.dependencies);

  await coordinator.runSelection({ prompt: "pants", threshold: 0.5 }, {
    onStage(stage) { stages.push(stage); }
  });

  assert.deepEqual(stages, ["capture", "prepare", "infer", "read", "commit", "complete"]);
});

test("legacy-safe mode allocates the session before Photoshop capture", async () => {
  const fixture = createFixture();
  fixture.dependencies.sessionIo.allocate = async () => {
    fixture.events.push("allocate");
    return fixture.prepared;
  };
  fixture.dependencies.photoshopIo.captureDocument = async (options) => {
    fixture.events.push(`capture:${options.legacySafe}:${Boolean(options.folder)}`);
    return { doc: { id: 7 }, legacySafe: true };
  };
  await createCoordinator(fixture.dependencies).runSelection({ prompt: "pants" }, { legacySafeIo: true });
  assert.deepStrictEqual(fixture.events, [
    "allocate", "capture:true:true", "prepare", "infer", "validate", "readMask", "commit", "cleanup"
  ]);
});

test("backend failure preserves the existing selection and still cleans request files", async () => {
  const fixture = createFixture();
  const failure = new Error("backend failed");
  fixture.dependencies.backend.infer = async () => { fixture.events.push("infer"); throw failure; };
  const coordinator = createCoordinator(fixture.dependencies);
  await assert.rejects(() => coordinator.runSelection({ prompt: "pants" }), failure);
  assert.deepStrictEqual(fixture.events, ["capture", "prepare", "infer", "cleanup"]);
  assert.ok(!fixture.events.includes("commit"));
});

test("cleanup failure cannot turn a successful selection into an error", async () => {
  const fixture = createFixture();
  fixture.dependencies.sessionIo.cleanup = async () => { fixture.events.push("cleanup"); throw new Error("cleanup"); };
  const coordinator = createCoordinator(fixture.dependencies);
  assert.strictEqual(await coordinator.runSelection({ prompt: "pants" }), fixture.response);
  assert.ok(fixture.events.includes("commit"));
});

test("cancel is locally authoritative and never commits a late backend success", async () => {
  const fixture = createFixture();
  let release;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  fixture.dependencies.backend.infer = async () => {
    fixture.events.push("infer");
    markStarted();
    await new Promise((resolve) => { release = resolve; });
    return fixture.response;
  };
  const coordinator = createCoordinator(fixture.dependencies);
  assert.strictEqual(await coordinator.cancelActive(), false);
  const running = coordinator.runSelection({ prompt: "pants" });
  await started;
  assert.strictEqual(await coordinator.cancelActive(), true);
  release();
  await assert.rejects(running, /原选区保持不变/);
  assert.ok(fixture.events.includes("cancel:request-0001"));
  assert.ok(!fixture.events.includes("commit"));
  assert.ok(fixture.events.includes("cleanup"));
  assert.strictEqual(await coordinator.cancelActive(), false);
});

test("cancel still blocks commit when the backend cancel call fails", async () => {
  const fixture = createFixture();
  let release;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  fixture.dependencies.backend.infer = async () => {
    fixture.events.push("infer");
    markStarted();
    await new Promise((resolve) => { release = resolve; });
    return fixture.response;
  };
  fixture.dependencies.backend.cancel = async (id) => {
    fixture.events.push(`cancel:${id}`);
    throw new Error("backend cancel unavailable");
  };
  const coordinator = createCoordinator(fixture.dependencies);
  const running = coordinator.runSelection({ prompt: "pants" });
  await started;
  assert.strictEqual(await coordinator.cancelActive(), true);
  release();
  await assert.rejects(running, /原选区保持不变/);
  assert.ok(!fixture.events.includes("commit"));
});
