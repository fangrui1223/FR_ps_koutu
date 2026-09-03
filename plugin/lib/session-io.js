"use strict";

const { storage } = require("uxp");
const formats = storage.formats;
let sessionFolderPromise;

function requestId() {
  const random = Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, "0");
  return `ps-${Date.now().toString(36)}-${random}`;
}

async function sessionFolder() {
  if (!sessionFolderPromise) {
    sessionFolderPromise = (async () => {
      const temporary = await storage.localFileSystem.getTemporaryFolder();
      const name = `sam31-selection-${Date.now().toString(36)}-${Math.floor(Math.random() * 0x1000000).toString(16)}`;
      return temporary.createFolder(name);
    })();
  }
  return sessionFolderPromise;
}

async function writeBinary(folder, name, bytes) {
  const file = await folder.createFile(name, { overwrite: true });
  await file.write(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { format: formats.binary });
  return file;
}

async function deleteFolderContents(folder) {
  const entries = await folder.getEntries();
  for (const entry of entries) {
    if (entry.isFolder) await deleteFolderContents(entry);
    await entry.delete();
  }
}

async function removeFolder(folder) {
  if (!folder) return;
  await deleteFolderContents(folder);
  await folder.delete();
}

async function allocate() {
  const root = await sessionFolder();
  const id = requestId();
  const folder = await root.createFolder(id);
  return { root, id, folder, nativeRoot: root.nativePath };
}

async function prepare(capture, info, buildInferRequest, allocated) {
  const workspace = allocated || await allocate();
  const { root, id, folder } = workspace;
  try {
    if (capture.input.data) await writeBinary(folder, "input.rgba8", capture.input.data);
    if (capture.roi && capture.roi.data) await writeBinary(folder, "roi.gray8", capture.roi.data);
    const request = buildInferRequest({
      requestId: id,
      prompt: info.prompt,
      threshold: info.threshold,
      documentWidth: capture.bounds.right,
      documentHeight: capture.bounds.bottom,
      sourcePath: capture.sourcePath,
      inputBounds: capture.input.bounds,
      inputFile: capture.input.fileName,
      inputEncoding: capture.input.encoding,
      roiBounds: capture.roi && capture.roi.bounds,
      roiFile: capture.roi && capture.roi.fileName,
      roiEncoding: capture.roi && capture.roi.encoding,
      outputFile: capture.legacySafe ? "mask.png" : "mask.gray8",
      outputEncoding: capture.legacySafe ? "png-alpha8" : "gray8"
    });
    return { root, folder, request, nativeRoot: root.nativePath };
  } catch (error) {
    await removeFolder(folder).catch(() => {});
    throw error;
  }
}

async function readMask(prepared) {
  const output = prepared.request.output;
  const name = output.file.split("/").pop();
  const file = await prepared.folder.getEntry(name);
  if (output.encoding === "png-alpha8") return { encoding: output.encoding, file };
  const data = await file.read({ format: formats.binary });
  return new Uint8Array(data);
}

async function cleanup(prepared) {
  if (!prepared || !prepared.folder) return;
  await removeFolder(prepared.folder);
}

module.exports = { allocate, cleanup, prepare, readMask, requestId, sessionFolder, writeBinary };
