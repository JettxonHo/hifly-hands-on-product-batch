import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { resolvePersonStrategies } from "../src/core/person-strategy.js";

async function withPool(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "person-strategy-"));
  try {
    await fs.mkdir(path.join(root, "toy"), { recursive: true });
    await fs.mkdir(path.join(root, "default"), { recursive: true });
    await fs.writeFile(path.join(root, "toy", "toy-a.jpg"), "x");
    await fs.writeFile(path.join(root, "toy", "toy-b.jpg"), "x");
    await fs.writeFile(path.join(root, "default", "host.jpg"), "x");
    return await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("explicit person image wins over batch strategy", async () => {
  await withPool(async (poolRoot) => {
    const products = resolvePersonStrategies([
      { sku: "A", category: "toy", person_image_path: "uploads/person.jpg" }
    ], {
      personPool: { enabled: true, rootDir: poolRoot, defaultCategory: "default", fallbackToRecommended: true }
    }, { person_strategy: "hifly_recommended" });
    assert.equal(products[0].__resolved_person_image_path, "uploads/person.jpg");
    assert.equal(products[0].resolved_person_source, "explicit");
  });
});

test("auto_pool rotates category images and falls back to default", async () => {
  await withPool(async (poolRoot) => {
    const products = resolvePersonStrategies([
      { sku: "A", category: "toy" },
      { sku: "B", category: "toy" },
      { sku: "C", category: "beauty" }
    ], {
      personPool: { enabled: true, rootDir: poolRoot, defaultCategory: "default", fallbackToRecommended: true }
    }, { person_strategy: "auto_pool" });
    assert.match(products[0].__resolved_person_image_path, /toy-a\.jpg$/);
    assert.match(products[1].__resolved_person_image_path, /toy-b\.jpg$/);
    assert.match(products[2].__resolved_person_image_path, /default\/host\.jpg$/);
    assert.equal(products[0].resolved_person_source, "category_pool");
    assert.equal(products[2].resolved_person_source, "default_pool");
  });
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
