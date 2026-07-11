import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getProjectRoot, resolveProjectPath } from "../src/core/project-root.js";

test("project root is independent of process.cwd", () => {
  const root = getProjectRoot();
  const originalCwd = process.cwd();
  const temporaryCwd = fs.mkdtempSync(path.join(os.tmpdir(), "hifly-root-test-"));

  try {
    process.chdir(temporaryCwd);
    assert.equal(getProjectRoot(), root);
    assert.equal(resolveProjectPath("products"), path.join(root, "products"));
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(temporaryCwd, { recursive: true, force: true });
  }
});
