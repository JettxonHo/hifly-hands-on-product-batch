import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm, writeFile, mkdir, symlink } from "node:fs/promises";
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

test("copies external person images into batch-local rpa inputs", async () => {
  const f = await fixture();
  try {
    const personImage = path.join(f.root, "person-pool", "host.jpg");
    await mkdir(path.dirname(personImage), { recursive: true });
    await writeFile(personImage, "person-image");

    const pkg = createRpaTaskPackage({
      batch: { batch_id: "batch-1", person_strategy: "auto_pool" },
      task: {
        task_id: "task-1",
        execution_key: "key-1",
        sku: "SKU-1",
        image_path: f.imagePath,
        __resolved_person_image_path: personImage
      },
      batchDirectory: f.batchDirectory,
      callbackBaseUrl: "http://127.0.0.1:4317"
    });

    assert.match(pkg.person_image_path, /rpa[\\/]inputs[\\/]task-1-person-[\w-]+\.jpg$/);
    assert.equal(pkg.person_image_path.startsWith(await realpath(f.batchDirectory)), true);
    assert.equal(await readFile(pkg.person_image_path, "utf8"), "person-image");
    assert.equal(JSON.stringify(pkg).includes(personImage), false);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("copies batch-local fixed person images into isolated rpa inputs", async () => {
  const f = await fixture();
  try {
    const personImage = path.join(f.batchDirectory, "uploads", "fixed-person.png");
    await writeFile(personImage, "person-image");

    const pkg = createRpaTaskPackage({
      batch: { batch_id: "batch-1", person_strategy: "fixed_upload" },
      task: {
        task_id: "task-1",
        execution_key: "key-1",
        sku: "SKU-1",
        image_path: f.imagePath,
        person_image_path: personImage
      },
      batchDirectory: f.batchDirectory,
      callbackBaseUrl: "http://127.0.0.1:4317"
    });

    assert.match(pkg.person_image_path, /rpa[\\/]inputs[\\/]task-1-person-[\w-]+\.png$/);
    assert.notEqual(pkg.person_image_path, personImage);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("rejects non-image person files outside the batch", async () => {
  const f = await fixture();
  try {
    const personFile = path.join(f.root, "person.txt");
    await writeFile(personFile, "not-an-image");

    assert.throws(() => createRpaTaskPackage({
      batch: { batch_id: "batch-1" },
      task: {
        task_id: "task-1",
        execution_key: "key-1",
        sku: "SKU-1",
        image_path: f.imagePath,
        person_image_path: personFile
      },
      batchDirectory: f.batchDirectory,
      callbackBaseUrl: "http://127.0.0.1:4317"
    }), /supported image file/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("rejects an rpa inputs directory symlink before copying a person image", async () => {
  const f = await fixture();
  try {
    const personImage = path.join(f.root, "person.jpg");
    const outsideDirectory = path.join(f.root, "outside-inputs");
    await writeFile(personImage, "person-image");
    await mkdir(path.join(f.batchDirectory, "rpa"));
    await mkdir(outsideDirectory);
    await symlink(outsideDirectory, path.join(f.batchDirectory, "rpa", "inputs"));

    assert.throws(() => createRpaTaskPackage({
      batch: { batch_id: "batch-1" },
      task: {
        task_id: "task-1",
        execution_key: "key-1",
        sku: "SKU-1",
        image_path: f.imagePath,
        person_image_path: personImage
      },
      batchDirectory: f.batchDirectory,
      callbackBaseUrl: "http://127.0.0.1:4317"
    }), /RPA inputs directory must be a regular directory/);
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
    const pkg = createRpaTaskPackage({
      batch: { batch_id: "batch-1" },
      task: { task_id: "task-1", execution_key: "key-1", sku: "SKU-1", image_path: f.imagePath },
      batchDirectory: f.batchDirectory,
      callbackBaseUrl: "http://[::1]:4317"
    });
    assert.equal(pkg.callback_url, "http://[::1]:4317/api/rpa/callback");
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
