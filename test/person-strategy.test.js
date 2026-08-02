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

test("auto_pool fails closed when the pool root is not a safe relative path", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "person-strategy-unsafe-"));
  try {
    // Absolute pool root: exists on disk, so enumeration reaches the boundary;
    // the old API silently persisted absolute paths, the safe API rejects them.
    await fs.mkdir(path.join(root, "toy"), { recursive: true });
    await fs.writeFile(path.join(root, "toy", "toy-a.jpg"), "x");
    assert.throws(
      () => resolvePersonStrategies([{ sku: "A", category: "toy" }], {
        personPool: { enabled: true, rootDir: root, defaultCategory: "default" }
      }, { person_strategy: "auto_pool" }),
      /relative/
    );
    // Traversal pool root: exists relative to the project root and must be
    // rejected at the portable-path boundary before anything is persisted.
    const projectRoot = path.join(root, "project");
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(path.join(root, "evil", "toy"), { recursive: true });
    await fs.writeFile(path.join(root, "evil", "toy", "toy-a.jpg"), "x");
    assert.throws(
      () => resolvePersonStrategies([{ sku: "A", category: "toy" }], {
        __rootDir: projectRoot,
        personPool: { enabled: true, rootDir: path.join("..", "evil"), defaultCategory: "default" }
      }, { person_strategy: "auto_pool" }),
      /traversal/
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
