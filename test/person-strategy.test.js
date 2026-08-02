import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolvePersonStrategies } from "../src/core/person-strategy.js";

async function withPool(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "person-strategy-"));
  try {
    const poolRoot = path.join(root, "assets", "person_pool");
    await fs.mkdir(path.join(poolRoot, "toy"), { recursive: true });
    await fs.mkdir(path.join(poolRoot, "default"), { recursive: true });
    await fs.writeFile(path.join(poolRoot, "toy", "toy-a.jpg"), "x");
    await fs.writeFile(path.join(poolRoot, "toy", "toy-b.jpg"), "x");
    await fs.writeFile(path.join(poolRoot, "default", "host.jpg"), "x");
    return await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("explicit person image wins over batch strategy", async () => {
  await withPool(async (root) => {
    const products = resolvePersonStrategies([
      { sku: "A", category: "toy", person_image_path: "uploads/person.jpg" }
    ], {
      __rootDir: root,
      personPool: { enabled: true, rootDir: "assets/person_pool", defaultCategory: "default", fallbackToRecommended: true }
    }, { person_strategy: "hifly_recommended" });
    assert.equal(products[0].__resolved_person_image_path, "uploads/person.jpg");
    assert.equal(products[0].resolved_person_source, "explicit");
  });
});

test("auto_pool rotates category images and falls back to default", async () => {
  await withPool(async (root) => {
    const products = resolvePersonStrategies([
      { sku: "A", category: "toy" },
      { sku: "B", category: "toy" },
      { sku: "C", category: "beauty" }
    ], {
      __rootDir: root,
      personPool: { enabled: true, rootDir: "assets/person_pool", defaultCategory: "default", fallbackToRecommended: true }
    }, { person_strategy: "auto_pool" });
    // Persisted person-pool paths stay portable POSIX relative paths.
    assert.equal(products[0].__resolved_person_image_path, "assets/person_pool/toy/toy-a.jpg");
    assert.equal(products[1].__resolved_person_image_path, "assets/person_pool/toy/toy-b.jpg");
    assert.equal(products[2].__resolved_person_image_path, "assets/person_pool/default/host.jpg");
    assert.equal(products[0].resolved_person_source, "category_pool");
    assert.equal(products[2].resolved_person_source, "default_pool");
  });
});

test("auto_pool keeps legacy Chinese filename ordering", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "person-strategy-chinese-"));
  try {
    const poolRoot = path.join(root, "assets", "person_pool");
    await fs.mkdir(path.join(poolRoot, "toy"), { recursive: true });
    for (const fileName of ["张.jpg", "阿.jpg", "李.jpg"]) {
      await fs.writeFile(path.join(poolRoot, "toy", fileName), "x");
    }
    const products = resolvePersonStrategies([
      { sku: "A", category: "toy" },
      { sku: "B", category: "toy" },
      { sku: "C", category: "toy" }
    ], {
      __rootDir: root,
      personPool: { enabled: true, rootDir: "assets/person_pool", defaultCategory: "default" }
    }, { person_strategy: "auto_pool" });
    assert.deepEqual(
      products.map((product) => path.basename(product.__resolved_person_image_path)),
      ["阿.jpg", "李.jpg", "张.jpg"]
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("auto_pool resolves mixed-case categories against a relative pool root", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "person-strategy-relative-"));
  try {
    await fs.mkdir(path.join(root, "assets", "person_pool", "toy"), { recursive: true });
    await fs.writeFile(path.join(root, "assets", "person_pool", "toy", "toy-a.jpg"), "x");
    const [product] = resolvePersonStrategies([
      { sku: "A", category: "Toy" }
    ], {
      __rootDir: root,
      personPool: {
        enabled: true,
        rootDir: "assets/person_pool",
        defaultCategory: "default",
        fallbackToRecommended: true
      }
    }, { person_strategy: "auto_pool" });
    assert.equal(product.__resolved_person_image_path, "assets/person_pool/toy/toy-a.jpg");
    assert.equal(product.resolved_person_source, "category_pool");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("hifly_recommended leaves path empty and records source", async () => {
  const products = resolvePersonStrategies([
    { sku: "A", category: "toy" }
  ], {
    behavior: { useRecommendedPersonWhenMissing: true },
    personPool: { enabled: true, fallbackToRecommended: true }
  }, { person_strategy: "hifly_recommended" });
  assert.equal(products[0].__resolved_person_image_path, undefined);
  assert.equal(products[0].resolved_person_source, "hifly_recommended");
});

test("fixed_upload applies the fixed batch person unless item has explicit person", async () => {
  const products = resolvePersonStrategies([
    { sku: "A", category: "toy" },
    { sku: "B", category: "toy", person_image_path: "uploads/own.jpg" }
  ], {}, {
    person_strategy: "fixed_upload",
    fixed_person_image_path: "uploads/fixed.jpg"
  });
  assert.equal(products[0].__resolved_person_image_path, "uploads/fixed.jpg");
  assert.equal(products[0].resolved_person_source, "fixed_upload");
  assert.equal(products[1].__resolved_person_image_path, "uploads/own.jpg");
  assert.equal(products[1].resolved_person_source, "explicit");
});

test("auto_pool accepts an absolute inside-root pool root identically to the relative form", async () => {
  await withPool(async (root) => {
    const [relativeProduct] = resolvePersonStrategies([{ sku: "A", category: "toy" }], {
      __rootDir: root,
      personPool: { enabled: true, rootDir: "assets/person_pool", defaultCategory: "default" }
    }, { person_strategy: "auto_pool" });
    const [absoluteProduct] = resolvePersonStrategies([{ sku: "A", category: "toy" }], {
      __rootDir: root,
      personPool: { enabled: true, rootDir: path.join(root, "assets", "person_pool"), defaultCategory: "default" }
    }, { person_strategy: "auto_pool" });
    assert.equal(relativeProduct.__resolved_person_image_path, "assets/person_pool/toy/toy-a.jpg");
    // An absolute rootDir that resolves inside the project root persists the
    // exact same project-root-relative POSIX path as the relative form.
    assert.equal(absoluteProduct.__resolved_person_image_path, relativeProduct.__resolved_person_image_path);
  });
});

test("auto_pool rejects a category directory symlinked or junctioned outside the project", async () => {
  const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "person-strategy-symlink-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "person-pool-outside-"));
  try {
    const outsideToy = path.join(outside, "toy");
    await fs.mkdir(outsideToy);
    await fs.writeFile(path.join(outsideToy, "stolen.jpg"), "x");
    const poolRoot = path.join(projectRoot, "assets", "person_pool");
    await fs.mkdir(poolRoot, { recursive: true });
    await fs.symlink(outsideToy, path.join(poolRoot, "toy"), process.platform === "win32" ? "junction" : "dir");

    // Lexically inside the project, canonically outside: fail closed before
    // enumeration; stolen.jpg can never become a resolved person path.
    assert.throws(
      () => resolvePersonStrategies([{ sku: "A", category: "toy" }], {
        __rootDir: projectRoot,
        personPool: { enabled: true, rootDir: "assets/person_pool", defaultCategory: "default" }
      }, { person_strategy: "auto_pool" }),
      /symlinks or junctions/
    );
  } finally {
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("auto_pool never selects a symlinked image entry", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "person-strategy-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "person-pool-outside-"));
  try {
    const toy = path.join(root, "assets", "person_pool", "toy");
    await fs.mkdir(toy, { recursive: true });
    await fs.writeFile(path.join(toy, "toy-b.jpg"), "x");
    const externalImage = path.join(outside, "stolen.jpg");
    await fs.writeFile(externalImage, "x");
    await fs.symlink(externalImage, path.join(toy, "linked.jpg"));

    const [product] = resolvePersonStrategies([{ sku: "A", category: "toy" }], {
      __rootDir: root,
      personPool: { enabled: true, rootDir: "assets/person_pool", defaultCategory: "default" }
    }, { person_strategy: "auto_pool" });
    // The regular file is selected; the symlinked image is not a candidate.
    assert.equal(product.__resolved_person_image_path, "assets/person_pool/toy/toy-b.jpg");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});

test("auto_pool rejects a pool root outside the project before enumeration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "person-strategy-outside-"));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), "person-pool-outside-"));
  try {
    const projectRoot = path.join(root, "project");
    await fs.mkdir(projectRoot, { recursive: true });
    // Populate the external directories: if enumeration ran before
    // validation, these files would leak into the resolved products.
    await fs.mkdir(path.join(outside, "toy"), { recursive: true });
    await fs.writeFile(path.join(outside, "toy", "stolen.jpg"), "x");
    await fs.mkdir(path.join(root, "evil", "toy"), { recursive: true });
    await fs.writeFile(path.join(root, "evil", "toy", "stolen.jpg"), "x");

    // Absolute pool root outside the project: rejected, nothing enumerated.
    assert.throws(
      () => resolvePersonStrategies([{ sku: "A", category: "toy" }], {
        __rootDir: projectRoot,
        personPool: { enabled: true, rootDir: outside, defaultCategory: "default" }
      }, { person_strategy: "auto_pool" }),
      /traversal/
    );
    // Traversal relative pool root: rejected, nothing enumerated.
    assert.throws(
      () => resolvePersonStrategies([{ sku: "A", category: "toy" }], {
        __rootDir: projectRoot,
        personPool: { enabled: true, rootDir: path.join("..", "evil"), defaultCategory: "default" }
      }, { person_strategy: "auto_pool" }),
      /traversal/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  }
});
