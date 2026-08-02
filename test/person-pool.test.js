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

test("listPersonPoolFiles rejects a category directory symlinked or junctioned outside the project", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "person-pool-symlink-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "person-pool-outside-"));
  try {
    // External directory with a would-be candidate image.
    const outsideToy = path.join(outside, "toy");
    await fs.mkdir(outsideToy);
    await fs.writeFile(path.join(outsideToy, "stolen.jpg"), "x");
    // project/assets/person_pool/toy → outside/toy (junction on Windows,
    // directory symlink elsewhere). Lexically inside, canonically outside:
    // must be rejected before readdirSync, never enumerated.
    const poolRoot = path.join(projectRoot, "assets", "person_pool");
    await fs.mkdir(poolRoot, { recursive: true });
    await fs.symlink(outsideToy, path.join(poolRoot, "toy"), process.platform === "win32" ? "junction" : "dir");

    assert.throws(
      () => listPersonPoolFiles({
        __rootDir: projectRoot,
        personPool: { rootDir: "assets/person_pool" }
      }, "toy"),
      /symlinks or junctions/
    );
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("listPersonPoolFiles excludes symlinked image entries from candidates", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "person-pool-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "person-pool-outside-"));
  try {
    const toy = path.join(root, "assets", "person_pool", "toy");
    await fs.mkdir(toy, { recursive: true });
    await fs.writeFile(path.join(toy, "toy-a.jpg"), "x");
    // A symlinked image with an allowed extension: never a candidate.
    const externalImage = path.join(outside, "stolen.jpg");
    await fs.writeFile(externalImage, "x");
    await fs.symlink(externalImage, path.join(toy, "linked.jpg"));

    const files = listPersonPoolFiles({
      __rootDir: root,
      personPool: { rootDir: "assets/person_pool" }
    }, "toy");
    // Only the regular file is returned; linked.jpg is ignored, not an error.
    assert.deepEqual(files, ["assets/person_pool/toy/toy-a.jpg"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
