import test from "node:test";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createExecutionSnapshot } from "../src/core/execution-snapshot.js";
import { buildHiflyHandsOnProductV1 } from "../src/execution-contracts/hifly-hands-on-product-v1.js";

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

test("execution snapshot includes V1 contract only when present and validates it", async () => {
  await withImages(async ({ product, person }) => {
    const base = { task_id: "v1", sku: "V1", product_name: "Product", image_path: product, person_image_path: person };
    const config = { version: "v1", assetPointsPerItem: 0, videoPointsEstimate: 0 };
    const legacy = await createExecutionSnapshot([base], config);
    const productChecksum = createHash("sha256").update(await readFile(product)).digest("hex");
    const personChecksum = createHash("sha256").update(await readFile(person)).digest("hex");
    const contract = buildHiflyHandsOnProductV1({
      plan: { video_plan_version_id: "plan-snapshot", plan_review_id: "review-snapshot", status: "frozen", review_status: "approved", current: true },
      product: { revision_id: "revision-snapshot", primary_asset_version_id: "asset-snapshot", checksum_sha256: productChecksum, media_type: "image/png", size: (await readFile(product)).length },
      copy: { version_id: "copy-snapshot", status: "frozen", review_status: "approved", body: "copy" },
      avatar: { selection_id: "selection-snapshot", avatar_version_id: "avatar-snapshot", material_version_id: "material-snapshot", checksum_sha256: personChecksum, media_type: "image/png", size: (await readFile(person)).length, status: "confirmed", current: true }
    });
    const versioned = await createExecutionSnapshot([{ ...base, hifly_hands_on_product_v1: contract }], config);
    assert.equal("hifly_hands_on_product_v1" in legacy.items[0], false);
    assert.deepEqual(versioned.items[0].hifly_hands_on_product_v1, contract);
    assert.equal(Object.isFrozen(versioned.items[0].hifly_hands_on_product_v1), true);
    assert.equal(Object.isFrozen(versioned.items[0].hifly_hands_on_product_v1.plan), true);
    assert.notEqual(versioned.digest, legacy.digest);
    await assert.rejects(createExecutionSnapshot([{ ...base, hifly_hands_on_product_v1: { contract_id: "wrong" } }], config), { code: "HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_INVALID" });
    const drifted = structuredClone(contract); drifted.product.checksum_sha256 = "f".repeat(64);
    await assert.rejects(createExecutionSnapshot([{ ...base, hifly_hands_on_product_v1: drifted }], config), { code: "HIFLY_HANDS_ON_PRODUCT_V1_PRODUCT_INTEGRITY_MISMATCH" });
    const wrongSize = structuredClone(contract); wrongSize.product.size += 1;
    await assert.rejects(createExecutionSnapshot([{ ...base, hifly_hands_on_product_v1: wrongSize }], config), { code: "HIFLY_HANDS_ON_PRODUCT_V1_PRODUCT_INTEGRITY_MISMATCH" });
    const wrongAvatarSize = structuredClone(contract); wrongAvatarSize.avatar.size += 1;
    await assert.rejects(createExecutionSnapshot([{ ...base, hifly_hands_on_product_v1: wrongAvatarSize }], config), { code: "HIFLY_HANDS_ON_PRODUCT_V1_AVATAR_INTEGRITY_MISMATCH" });
  });
});
