"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../tools/Repair-PhotoshopRuntimeConfig.jsx"), "utf8").replace(/^#target photoshop\s*/, "");
const ini = ["schemaVersion=2", "installRoot=C:/Apps/FR", "python=runtime/python.exe", "backend=backend", "model=D:/Models/model.safetensors", "officialSam3=vendor/sam3"].join("\r\n");

function fixture(options = {}) {
  const normalize = value => String(value).replace(/\\/g, "/").toLowerCase();
  const target = "C:/Users/Test/AppData/Local/FR/FR SAM Text Selection/runtime-v2.ini";
  const folders = new Set(["C:/Apps/FR", "C:/Apps/FR/backend", "C:/Apps/FR/vendor/sam3", "C:/Users/Test/AppData/Local"].map(normalize));
  const files = new Map([["D:/config.ini", options.ini ?? ini], ["C:/Apps/FR/runtime/python.exe", "python"], ["D:/Models/model.safetensors", "model"]].map(([p, v]) => [normalize(p), v]));
  const writes = [];
  if (options.missing) { files.delete(normalize(options.missing)); folders.delete(normalize(options.missing)); }
  if (options.existing) files.set(normalize(target), "existing configuration");
  function File(value) { this.fsName = String(value); this.error = "test file error"; }
  Object.defineProperty(File.prototype, "exists", { get() { return files.has(normalize(this.fsName)); } });
  File.prototype.open = function (mode) { assert.equal(mode, "r"); return this.exists; };
  File.prototype.read = function () { return files.get(normalize(this.fsName)); };
  File.prototype.close = function () {};
  File.prototype.copy = function (destination) {
    writes.push(destination);
    if (options.copyFailure) return false;
    files.set(normalize(destination), options.corrupt ? "corrupt" : this.read());
    return true;
  };
  function Folder(value) { this.fsName = String(value); this.error = "test folder error"; }
  Object.defineProperty(Folder.prototype, "exists", { get() { return folders.has(normalize(this.fsName)); } });
  Folder.prototype.create = function () { writes.push(this.fsName); folders.add(normalize(this.fsName)); return true; };
  return {
    writes, content: () => files.get(normalize(target)),
    run: () => vm.runInNewContext(source, { File, Folder, $: {
      global: { __frSamRepairConfigSource: options.noSource ? undefined : "D:/config.ini" },
      getenv: () => options.noLocal ? "" : "C:/Users/Test/AppData/Local"
    } })
  };
}

test("restores validated config and checks the Photoshop-visible copy", () => {
  const f = fixture();
  assert.match(f.run(), /^PASS: Photoshop can read /);
  assert.equal(f.content(), ini);
  assert.equal(f.writes.length, 3);
});
test("never overwrites an existing runtime configuration", () => {
  const f = fixture({ existing: true });
  assert.throws(f.run, /refusing to overwrite/);
  assert.equal(f.content(), "existing configuration");
  assert.deepEqual(f.writes, []);
});
test("requires explicit source and current-user LocalAppData", () => {
  for (const options of [{ noSource: true }, { noLocal: true }]) {
    const f = fixture(options); assert.throws(f.run); assert.deepEqual(f.writes, []);
  }
});
test("rejects missing installed components before writing", () => {
  for (const missing of ["D:/Models/model.safetensors", "C:/Apps/FR", "C:/Apps/FR/runtime/python.exe", "C:/Apps/FR/backend", "C:/Apps/FR/vendor/sam3"]) {
    const f = fixture({ missing }); assert.throws(f.run, /not visible/); assert.deepEqual(f.writes, []);
  }
});
test("rejects invalid schema, duplicate, missing and unknown fields", () => {
  for (const invalid of [ini.replace("schemaVersion=2", "schemaVersion=1"), ini + "\npython=other.exe", ini + "\nunknown=field", ini.replace("officialSam3=vendor/sam3", ""), ini + "\nbroken line"]) {
    const f = fixture({ ini: invalid }); assert.throws(f.run); assert.deepEqual(f.writes, []);
  }
});
test("rejects absolute and parent-traversal component paths", () => {
  for (const invalid of ["../python.exe", "runtime/../../python.exe", "C:/python.exe", "/python.exe", "..\\python.exe"]) {
    const f = fixture({ ini: ini.replace("runtime/python.exe", invalid) });
    assert.throws(f.run, /Unsafe relative/); assert.deepEqual(f.writes, []);
  }
});
test("copy failure and content mismatch are never reported as success", () => {
  assert.throws(fixture({ copyFailure: true }).run, /Cannot copy/);
  assert.throws(fixture({ corrupt: true }).run, /differs from/);
});
