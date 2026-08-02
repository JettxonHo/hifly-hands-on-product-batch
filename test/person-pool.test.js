import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listPersonPoolFiles } from "../src/person-pool.js";

async function withPoolProject(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "person-pool-"));
  try {
    const poolRoot = path.join(root, "assets", "person_pool");
    await fs.mkdir(path.join(poolRoot, "toy"), { recursive: true });
    await fs.writeFile(path.join(poolRoot, "toy", "toy-a.jpg"), "x");
    await fs.writeFile(path.join(poolRoot, "toy", "toy-b.jpg"), "x");
    // Non-allowed extension: must never be enumerated.
    await fs.writeFile(path.join(poolRoot, "toy", "notes.txt"), "x");
    return await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("listPersonPoolFiles returns POSIX paths relative to the project root for a relative rootDir", async () => {
  await withPoolProject(async (root) => {
    const files = listPersonPoolFiles({
      __rootDir: root,
      personPool: { rootDir: "assets/person_pool" }
    }, "toy");
    assert.deepEqual(files, [
      "assets/person_pool/toy/toy-a.jpg",
      "assets/person_pool/toy/toy-b.jpg"
    ]);
  });
});

test("listPersonPoolFiles accepts an absolute inside-root rootDir identically to the relative form", async () => {
  await withPoolProject(async (root) => {
    const relativeFiles = listPersonPoolFiles({
      __rootDir: root,
      personPool: { rootDir: "assets/person_pool" }
    }, "toy");
    const absoluteFiles = listPersonPoolFiles({
      __rootDir: root,
      personPool: { rootDir: path.join(root, "assets", "person_pool") }
    }, "toy");
    // Both configuration forms persist exactly the same project-root-relative
    // POSIX paths; no absolute path ever reaches the batch.
    assert.deepEqual(absoluteFiles, relativeFiles);
    assert.deepEqual(absoluteFiles, [
      "assets/person_pool/toy/toy-a.jpg",
      "assets/person_pool/toy/toy-b.jpg"
    ]);
  });
});

test("listPersonPoolFiles rejects an absolute outside-root rootDir before enumeration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "person-pool-project-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "person-pool-outside-"));
  try {
    // Populate the external directory: if enumeration ran before validation,
    // stolen.jpg would appear in the returned paths.
    await fs.mkdir(path.join(outside, "toy"), { recursive: true });
    await fs.writeFile(path.join(outside, "toy", "stolen.jpg"), "x");
    assert.throws(
      () => listPersonPoolFiles({ __rootDir: root, personPool: { rootDir: outside } }, "toy"),
      /traversal/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("listPersonPoolFiles rejects a traversal rootDir before reading any directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "person-pool-traversal-"));
  try {
    const projectRoot = path.join(root, "project");
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(path.join(root, "evil", "toy"), { recursive: true });
    await fs.writeFile(path.join(root, "evil", "toy", "stolen.jpg"), "x");
    assert.throws(
      () => listPersonPoolFiles({
        __rootDir: projectRoot,
        personPool: { rootDir: path.join("..", "evil") }
      }, "toy"),
      /traversal/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("listPersonPoolFiles requires an absolute project root", async () => {
  assert.throws(
    () => listPersonPoolFiles({ personPool: { rootDir: "assets/person_pool" } }, "toy"),
    /absolute project root/
  );
});
