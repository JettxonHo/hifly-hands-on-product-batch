import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createRpaTaskPackage,
  writeRpaTaskPackage
} from "../src/rpa/task-package.js";
import { readRpaState, writeRpaState } from "../src/rpa/rpa-state.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "rpa-package-"));
  const batchDirectory = path.join(root, "batch-1");
  await mkdir(path.join(batchDirectory, "uploads"), { recursive: true });
  const imagePath = path.join(batchDirectory, "uploads", "product.png");
  await writeFile(imagePath, "image");
  return { root, batchDirectory, imagePath };
}

test("creates package with safe batch download dir and callback token", async () => {
  const f = await fixture();
  try {
    const pkg = createRpaTaskPackage({
      batch: { batch_id: "batch-1", person_strategy: "auto_pool", script_strategy: "mixed" },
      task: {
        task_id: "task-1",
        execution_key: "key-1",
        sku: "SKU-1",
        product_name: "Alpha",
        selling_points: "Useful",
        category: "toy",
        image_path: f.imagePath,
        resolved_script_mode: "hifly_ai"
      },
      batchDirectory: f.batchDirectory,
      callbackBaseUrl: "http://127.0.0.1:4317"
    });
    assert.equal(pkg.schema_version, 1);
    assert.equal(pkg.batch_id, "batch-1");
    assert.equal(pkg.download_dir, f.batchDirectory);
    assert.match(pkg.callback_url, /^http:\/\/127\.0\.0\.1:4317\/api\/rpa\/callback$/);
    assert.equal(typeof pkg.callback_token, "string");
    assert.equal(pkg.callback_token.length > 20, true);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("rejects product paths outside the batch directory", async () => {
  const f = await fixture();
  try {
    assert.throws(() => createRpaTaskPackage({
      batch: { batch_id: "batch-1" },
      task: { task_id: "task-1", execution_key: "key-1", sku: "SKU-1", image_path: path.join(f.root, "outside.png") },
      batchDirectory: f.batchDirectory,
      callbackBaseUrl: "http://127.0.0.1:4317"
    }), /outside batch directory/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("rejects product symlinks that resolve outside the batch directory", async () => {
  const f = await fixture();
  try {
    const outsidePath = path.join(f.root, "outside.png");
    const linkedPath = path.join(f.batchDirectory, "uploads", "linked-product.png");
    await writeFile(outsidePath, "outside");
    await symlink(outsidePath, linkedPath);
    assert.throws(() => createRpaTaskPackage({
      batch: { batch_id: "batch-1" },
      task: { task_id: "task-1", execution_key: "key-1", sku: "SKU-1", image_path: linkedPath },
      batchDirectory: f.batchDirectory,
      callbackBaseUrl: "http://127.0.0.1:4317"
    }), /outside batch directory/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("rejects person image symlinks that resolve outside the batch directory", async () => {
  const f = await fixture();
  try {
    const outsidePath = path.join(f.root, "outside-person.png");
    const linkedPath = path.join(f.batchDirectory, "uploads", "linked-person.png");
    await writeFile(outsidePath, "outside");
    await symlink(outsidePath, linkedPath);
    assert.throws(() => createRpaTaskPackage({
      batch: { batch_id: "batch-1" },
      task: {
        task_id: "task-1",
        execution_key: "key-1",
        sku: "SKU-1",
        image_path: f.imagePath,
        person_image_path: linkedPath
      },
      batchDirectory: f.batchDirectory,
      callbackBaseUrl: "http://127.0.0.1:4317"
    }), /outside batch directory/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("rejects unsafe task ids and mismatched package task ids", async () => {
  const f = await fixture();
  try {
    const pkg = createRpaTaskPackage({
      batch: { batch_id: "batch-1" },
      task: { task_id: "task-1", execution_key: "key-1", sku: "SKU-1", image_path: f.imagePath },
      batchDirectory: f.batchDirectory,
      callbackBaseUrl: "http://127.0.0.1:4317"
    });
    await assert.rejects(() => writeRpaTaskPackage({
      batchDirectory: f.batchDirectory,
      taskId: "../escape",
      packageData: pkg
    }), /Invalid RPA task id/);
    await assert.rejects(() => writeRpaTaskPackage({
      batchDirectory: f.batchDirectory,
      taskId: "task-2",
      packageData: pkg
    }), /task_id must match taskId/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("accepts only localhost http callback URLs", async () => {
  const f = await fixture();
  try {
    assert.throws(() => createRpaTaskPackage({
      batch: { batch_id: "batch-1" },
      task: { task_id: "task-1", execution_key: "key-1", sku: "SKU-1", image_path: f.imagePath },
      batchDirectory: f.batchDirectory,
      callbackBaseUrl: "https://127.0.0.1:4317"
    }), /callback base URL must use http/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("writes package and rpa state under rpa directory", async () => {
  const f = await fixture();
  try {
    const pkg = createRpaTaskPackage({
      batch: { batch_id: "batch-1" },
      task: { task_id: "task-1", execution_key: "key-1", sku: "SKU-1", image_path: f.imagePath },
      batchDirectory: f.batchDirectory,
      callbackBaseUrl: "http://127.0.0.1:4317"
    });
    const packagePath = await writeRpaTaskPackage({ batchDirectory: f.batchDirectory, taskId: "task-1", packageData: pkg });
    assert.equal(JSON.parse(await readFile(packagePath, "utf8")).task_id, "task-1");
    await writeRpaState(f.batchDirectory, "task-1", { status: "submitted", remote_evidence: { remote_id: "1" } });
    const state = await readRpaState(f.batchDirectory, "task-1");
    assert.equal(state.status, "submitted");
    assert.equal(state.remote_evidence.remote_id, "1");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
