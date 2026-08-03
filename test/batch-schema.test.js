import test from "node:test";
import assert from "node:assert/strict";

import {
  CURRENT_BATCH_SCHEMA_VERSION,
  batchSchemaError,
  migrateBatchDocument
} from "../src/core/batch-schema.js";

// A realistic legacy batch document: every field historical batches carry,
// plus an unknown historical field that must survive untouched. No
// schemaVersion — its complete absence is the legacy v0 marker.
function legacyBatch() {
  return {
    batch_id: "batch-legacy",
    status: "completed",
    items: [
      { task_id: "task-1", sku: "A", status: "completed", retry_count: 0 },
      { task_id: "task-2", sku: "B", status: "pending", retry_count: 1 }
    ],
    uploads: [{ artifact_id: "up-1", logical_name: "a.png", storage_name: "x.png", extension: ".png", kind: "image", size: 5 }],
    artifacts: [{ artifact_id: "video-1", relative_path: "artifacts/未命名.mp4" }],
    capture: { status: "recorded", enabled: true },
    execution_snapshot: { executionKey: "snap-1", items: [] },
    execution_error: null,
    person_strategy: "auto_pool",
    script_strategy: "mixed",
    fixed_person_image_artifact_id: null,
    import_summary: { rows: 2 },
    created_at: "2026-07-01T10:00:00.000Z",
    updated_at: "2026-07-01T11:30:00.000Z",
    legacy_unknown_field: { nested: ["keep", "me"] }
  };
}

test("migrateBatchDocument migrates a legacy (unversioned) document to v1", () => {
  const result = migrateBatchDocument(legacyBatch());
  assert.equal(result.migrated, true);
  assert.equal(result.fromVersion, 0);
  assert.equal(result.toVersion, CURRENT_BATCH_SCHEMA_VERSION);
  assert.equal(result.batch.schemaVersion, 1);
});

test("v0 → v1 adds exactly schemaVersion and preserves every existing field", () => {
  const legacy = legacyBatch();
  const { batch } = migrateBatchDocument(legacy);
  // migrated = complete deep copy of the legacy document + schemaVersion: 1
  assert.deepEqual(batch, { ...structuredClone(legacy), schemaVersion: 1 });
  // Timestamps are untouched by the migration.
  assert.equal(batch.created_at, legacy.created_at);
  assert.equal(batch.updated_at, legacy.updated_at);
  // Unknown historical fields survive.
  assert.deepEqual(batch.legacy_unknown_field, { nested: ["keep", "me"] });
});

test("migrateBatchDocument never mutates its input and returns a deep copy", () => {
  const legacy = legacyBatch();
  const frozenBefore = structuredClone(legacy);
  const { batch } = migrateBatchDocument(legacy);
  // Input unchanged.
  assert.deepEqual(legacy, frozenBefore);
  assert.equal("schemaVersion" in legacy, false);
  // Result is deep-owned: mutating it cannot reach the input.
  batch.items[0].status = "tampered";
  batch.legacy_unknown_field.nested.push("tampered");
  assert.deepEqual(legacy, frozenBefore);
});

test("a current-version document is accepted idempotently without migration", () => {
  const current = { ...legacyBatch(), schemaVersion: 1 };
  const result = migrateBatchDocument(current);
  assert.equal(result.migrated, false);
  assert.equal(result.fromVersion, 1);
  assert.equal(result.toVersion, 1);
  assert.equal(result.batch, current, "no rewrite needed — same document returned");
});

test("future schema versions are rejected, never downgraded", () => {
  for (const version of [2, 3, 99]) {
    assert.throws(
      () => migrateBatchDocument({ batch_id: "b", schemaVersion: version }),
      (error) =>
        error.code === "BATCH_SCHEMA_UNSUPPORTED" &&
        error.detectedVersion === version &&
        error.currentVersion === CURRENT_BATCH_SCHEMA_VERSION
    );
  }
});

test("invalid schemaVersion values are rejected fail-closed", () => {
  // Explicit 0 is invalid — only a completely missing field means legacy v0.
  for (const value of [0, -1, 1.5, "1", null, false, true, {}, []]) {
    assert.throws(
      () => migrateBatchDocument({ batch_id: "b", schemaVersion: value }),
      (error) => error.code === "BATCH_SCHEMA_INVALID" && error.currentVersion === CURRENT_BATCH_SCHEMA_VERSION,
      `expected BATCH_SCHEMA_INVALID for ${JSON.stringify(value)}`
    );
  }
});

test("non-object batch documents are rejected fail-closed", () => {
  for (const value of [null, "batch", 42, [1, 2], true]) {
    assert.throws(
      () => migrateBatchDocument(value),
      (error) => error.code === "BATCH_SCHEMA_INVALID"
    );
  }
});

test("a legacy document with an explicit schemaVersion 0 is rejected, not migrated", () => {
  assert.throws(
    () => migrateBatchDocument({ ...legacyBatch(), schemaVersion: 0 }),
    (error) => error.code === "BATCH_SCHEMA_INVALID" && error.detectedVersion === 0
  );
});

test("schema errors carry batchId attribution and stay redacted", () => {
  const legacy = legacyBatch();
  legacy.batch_id = "batch-secret-name";
  try {
    migrateBatchDocument({ ...legacy, schemaVersion: "1" }, { batchId: "batch-secret-name" });
    assert.fail("expected BATCH_SCHEMA_INVALID");
  } catch (error) {
    assert.equal(error.code, "BATCH_SCHEMA_INVALID");
    assert.equal(error.batchId, "batch-secret-name");
    // No batch content, local paths, uploads, scripts, or evidence leak into
    // the message — only the stable contract description.
    assert.equal(error.message.includes("task-1"), false);
    assert.equal(error.message.includes("未命名"), false);
    assert.equal(error.message.includes("/"), false);
    assert.equal(error.message.includes("\\"), false);
  }
});

test("batchSchemaError always exposes the version contract fields", () => {
  const error = batchSchemaError("BATCH_SCHEMA_MUTATION_NOT_ALLOWED", {
    batchId: "b",
    detectedVersion: "null",
    message: "x"
  });
  assert.equal(error.code, "BATCH_SCHEMA_MUTATION_NOT_ALLOWED");
  assert.equal(error.batchId, "b");
  assert.equal(error.detectedVersion, "null");
  assert.equal(error.currentVersion, CURRENT_BATCH_SCHEMA_VERSION);
});
