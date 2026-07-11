import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createExecutionSnapshot } from "../src/core/execution-snapshot.js";

async function withImages(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-snapshot-"));
  const product = path.join(root, "product.png");
  const person = path.join(root, "person.png");
  await writeFile(product, "product-image-v1");
  await writeFile(person, "person-image-v1");
  try {
    return await run({ root, product, person });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("snapshot is idempotent across item and property order", async () => {
  await withImages(async ({ product, person }) => {
    const firstItems = [
      { task_id: "b", sku: "B", product_name: "Beta", image_path: product, duration_seconds: 20 },
      { task_id: "a", sku: "A", product_name: "Alpha", image_path: product, resolved_person_image_path: person }
    ];
    const secondItems = [
      { resolved_person_image_path: person, image_path: product, product_name: "Alpha", sku: "A", task_id: "a" },
      { duration_seconds: 20, image_path: product, product_name: "Beta", sku: "B", task_id: "b" }
    ];
    const estimate = {
      version: "points-2026-07",
      assetPointsPerItem: 150,
      videoPointsEstimate: 350,
      confirmedAt: "2026-07-11T08:00:00.000Z"
    };

    const first = await createExecutionSnapshot(firstItems, estimate);
    const second = await createExecutionSnapshot(secondItems, estimate);

    assert.equal(first.digest, second.digest);
    assert.equal(first.executionKey, second.executionKey);
    assert.equal(first.estimate.known, true);
    assert.equal(first.estimate.total, 1000);
    assert.deepEqual(first.items.map((item) => item.task_id), ["a", "b"]);
  });
});

test("changing image bytes changes the content digest", async () => {
  await withImages(async ({ product }) => {
    const items = [{ task_id: "a", sku: "A", product_name: "Alpha", image_path: product }];
    const config = { version: "v1", assetPointsPerItem: 150, videoPointsEstimate: 350 };
    const before = await createExecutionSnapshot(items, config);
    await writeFile(product, "product-image-v2");
    const after = await createExecutionSnapshot(items, config);

    assert.notEqual(before.digest, after.digest);
    assert.notEqual(before.executionKey, after.executionKey);
  });
});

test("unknown point components are never represented as zero", async () => {
  await withImages(async ({ product }) => {
    const snapshot = await createExecutionSnapshot(
      [{ task_id: "a", sku: "A", image_path: product }],
      { version: "v1", assetPointsPerItem: 150 }
    );

    assert.equal(snapshot.estimate.known, false);
    assert.equal(snapshot.estimate.total, null);
    assert.deepEqual(snapshot.estimate.unknownComponents, ["videoPointsEstimate"]);
  });
});

test("non-execution fields do not alter the snapshot", async () => {
  await withImages(async ({ product }) => {
    const config = { version: "v1", assetPointsPerItem: 150, videoPointsEstimate: 350 };
    const base = { task_id: "a", sku: "A", product_name: "Alpha", image_path: product };
    const first = await createExecutionSnapshot([base], config);
    const second = await createExecutionSnapshot([
      { ...base, status: "failed_pre_submit", error_message: "temporary", retry_count: 9 }
    ], config);

    assert.equal(first.executionKey, second.executionKey);
  });
});
