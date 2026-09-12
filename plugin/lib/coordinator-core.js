"use strict";

function createCoordinator(dependencies) {
  const {
    backend,
    buildInferRequest,
    photoshopIo,
    sessionIo,
    validateSuccessResponse
  } = dependencies;
  let activeRun = null;

  function throwIfCancelled(run) {
    if (run && (run.cancelled || (run.isCancelled && run.isCancelled()))) {
      const error = new Error("任务已取消，原选区保持不变。");
      error.code = "CANCELLED";
      throw error;
    }
  }

  async function runSelection(info, options = {}) {
    if (activeRun) throw new Error("已有一个 FR SAM 任务正在运行。");
    const run = { requestId: null, cancelled: false, isCancelled: options.isCancelled };
    activeRun = run;
    let capture = null;
    let prepared = null;
    const reportStage = (stage) => {
      if (typeof options.onStage === "function") options.onStage(stage);
    };
    try {
      if (typeof sessionIo.allocate === "function") prepared = await sessionIo.allocate();
      reportStage("capture");
      const captureDocument = () => photoshopIo.captureDocument({
        folder: prepared && prepared.folder,
        legacySafe: Boolean(options.legacySafeIo)
      });
      if (typeof options.executeCapture === "function") capture = await options.executeCapture(captureDocument);
      else capture = await captureDocument();
      throwIfCancelled(run);
      reportStage("prepare");
      prepared = await sessionIo.prepare(capture, info, buildInferRequest, prepared);
      run.requestId = prepared.request.requestId;
      throwIfCancelled(run);
      reportStage("infer");
      let rawResponse;
      let selectAllFallback = false;
      try {
        rawResponse = await backend.infer(prepared.nativeRoot, prepared.request);
      } catch (error) {
        throwIfCancelled(run);
        if (!error || error.code !== "NO_OBJECT" || error.requestId !== run.requestId) throw error;
        selectAllFallback = true;
      }
      throwIfCancelled(run);
      // A fallback is a host selection policy, not a fabricated model detection.
      const response = selectAllFallback
        ? { status: "ok", requestId: run.requestId, fallback: { code: "NO_OBJECT", mode: "selectAll" } }
        : validateSuccessResponse(rawResponse, prepared.request);
      let mask;
      if (!selectAllFallback) {
        reportStage("read");
        mask = await sessionIo.readMask(prepared);
      }
      throwIfCancelled(run);
      reportStage("commit");
      const commit = async () => {
        throwIfCancelled(run);
        if (typeof photoshopIo.assertCaptureUnchanged === "function") photoshopIo.assertCaptureUnchanged(capture);
        if (selectAllFallback) {
          return photoshopIo.commitFullCanvasSelection(capture.doc, () => throwIfCancelled(run));
        }
        return photoshopIo.commitSelection(
          capture.doc,
          mask,
          response.mask.width,
          response.mask.height,
          response.mask.bounds,
          () => throwIfCancelled(run)
        );
      };
      if (typeof options.executeCommit === "function") await options.executeCommit(commit);
      else await commit();
      reportStage("complete");
      return response;
    } finally {
      if (activeRun === run) activeRun = null;
      if (prepared) await sessionIo.cleanup(prepared).catch(() => {});
    }
  }

  async function cancelActive() {
    if (!activeRun) return false;
    const run = activeRun;
    run.cancelled = true;
    if (!run.requestId) return true;
    try {
      await backend.cancel(run.requestId);
    } catch (error) {
      // Local cancellation remains authoritative even if the backend cannot be
      // interrupted quickly enough. The commit guards above still preserve the
      // existing Photoshop selection.
    }
    return true;
  }

  return { cancelActive, runSelection };
}

module.exports = { createCoordinator };
