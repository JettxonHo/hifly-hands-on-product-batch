import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createBatchStore } from "../src/core/batch-store.js";
import { acquireExecutionLock } from "../src/core/execution-lock.js";
import { createExecutionSnapshot } from "../src/core/execution-snapshot.js";
import { runBatch } from "../src/core/batch-runner.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";

async function recoveryFixture({ status, executor, remoteEvidence } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-recovery-"));
  const image = path.join(root, "product.png");
  await writeFile(image, "product-image");
  const store = createBatchStore(path.join(root, "batches"));
  const execution = {
    projectRoot: root,
    version: "points-v1",
    assetPointsPerItem: 150,
    videoPointsEstimate: 350,
    confirmedAt: "2026-07-11T00:00:00.000Z"
  };
  const sourceItem = {
    task_id: "task-1",
    sku: "SKU-1",
    product_name: "Alpha",
    image_path: image,
  };
  const snapshot = await createExecutionSnapshot([sourceItem], execution);
  const item = {
    ...sourceItem,
    status,
    execution_key: snapshot.executionKey,
    confirmed_at: execution.confirmedAt,
    remote_evidence: remoteEvidence,
    submit_checkpoint: { phase: "remote_submit_pre", observed_at: "2026-07-11T00:00:00.000Z" }
  };
  await store.create({ batch_id: "batch-1", items: [item], execution_snapshot: snapshot });
  const lock = await acquireExecutionLock({
    root: path.join(root, "locks"),
    batchId: "batch-1",
    instanceId: "fixture-recovery",
    heartbeatIntervalMs: 10_000
  });
  return {
    batchId: "batch-1",
    items: [item],
    config: { execution },
    paths: { projectRoot: root, downloadDir: path.join(root, "downloads") },
    executor,
    store,
    lock,
    cleanup: async () => {
      await lock.release().catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  };
}

test("crash at submit boundary never auto-regenerates", async () => {
  const executor = createFakeExecutor({ remoteId: "remote-1" });
  const fixture = await recoveryFixture({ status: "asset_confirmed", executor });
  try {
    const recovered = await runBatch(fixture);

    assert.equal(recovered.items[0].status, "interrupted_unknown");
    assert.equal(executor.callCounts.submitVideo, 0);
    assert.equal(executor.callCounts.createAsset, 0);
  } finally {
    await fixture.cleanup();
  }
});

test("recovers a known remote id without resubmitting", async () => {
  const executor = createFakeExecutor({ remoteCandidates: [{ remote_id: "remote-1" }, { remote_id: "other-work" }] });
  const fixture = await recoveryFixture({
    status: "interrupted_unknown",
    executor,
    remoteEvidence: { remote_id: "remote-1", match_method: "remote_id", evidence_source: "direct_submission" }
  });
  try {
    const recovered = await runBatch(fixture);

    assert.equal(recovered.items[0].status, "completed");
    assert.deepEqual(executor.calls.map((call) => call.method), [
      "reconcileSubmission", "querySubmission", "downloadArtifact"
    ]);
    assert.equal(executor.calls[0].remoteEvidence.remote_id, "remote-1");
  } finally {
    await fixture.cleanup();
  }
});

test("ambiguous remote candidates remain interrupted and are never resubmitted", async () => {
  const executor = createFakeExecutor({ remoteCandidates: [{ remote_id: "remote-1" }, { remote_id: "remote-2" }] });
  const fixture = await recoveryFixture({ status: "interrupted_unknown", executor });
  try {
    const recovered = await runBatch(fixture);

    assert.equal(recovered.items[0].status, "interrupted_unknown");
    assert.deepEqual(executor.calls.map((call) => call.method), ["reconcileSubmission"]);
  } finally {
    await fixture.cleanup();
  }
});

test("legacy bare remote-id evidence remains interrupted", async () => {
  const executor = createFakeExecutor({ remoteCandidates: [{ remote_id: "remote-1" }] });
  const fixture = await recoveryFixture({
    status: "interrupted_unknown",
    executor,
    remoteEvidence: { remote_id: "remote-1" }
  });
  try {
    const recovered = await runBatch(fixture);

    assert.equal(recovered.items[0].status, "interrupted_unknown");
    assert.deepEqual(executor.calls.map((call) => call.method), ["reconcileSubmission"]);
  } finally {
    await fixture.cleanup();
  }
});

test("list-delta remote-id evidence remains interrupted", async () => {
  const executor = createFakeExecutor({ remoteCandidates: [{ remote_id: "remote-1" }] });
  const fixture = await recoveryFixture({
    status: "interrupted_unknown",
    executor,
    remoteEvidence: { remote_id: "remote-1", evidence_source: "list_delta" }
  });
  try {
    const recovered = await runBatch(fixture);

    assert.equal(recovered.items[0].status, "interrupted_unknown");
    assert.deepEqual(executor.calls.map((call) => call.method), ["reconcileSubmission"]);
  } finally {
    await fixture.cleanup();
  }
});

test("a sole new post-checkpoint work with a stable remote identity remains interrupted", async () => {
  const executor = createFakeExecutor({ remoteCandidates: [{ remote_id: "newly-created-work" }] });
  const fixture = await recoveryFixture({ status: "interrupted_unknown", executor });
  try {
    const recovered = await runBatch(fixture);

    assert.equal(recovered.items[0].status, "interrupted_unknown");
    assert.deepEqual(executor.calls.map((call) => call.method), ["reconcileSubmission"]);
  } finally {
    await fixture.cleanup();
  }
});

test("persisted list-delta evidence cannot resume into a download", async () => {
  const executor = createFakeExecutor({ remoteId: "remote-1" });
  const fixture = await recoveryFixture({
    status: "download_pending",
    executor,
    remoteEvidence: {
      remote_id: "remote-1",
      before_work_keys: ["existing-work"],
      after_work_keys: ["existing-work", "remote-1"]
    }
  });
  try {
    const recovered = await runBatch(fixture);

    assert.equal(recovered.items[0].status, "interrupted_unknown");
    assert.deepEqual(executor.calls, []);
  } finally {
    await fixture.cleanup();
  }
});

for (const [status, remoteEvidence, method] of [
  ["interrupted_unknown", undefined, "reconcileSubmission"],
  ["submitted", { remote_id: "remote-1", match_method: "remote_id" }, "querySubmission"],
  ["download_pending", { remote_id: "remote-1", match_method: "remote_id" }, "downloadArtifact"]
]) {
  test(`snapshot mismatch blocks ${method} recovery work`, async () => {
    const executor = createFakeExecutor({ remoteId: "remote-1" });
    const fixture = await recoveryFixture({ status, executor, remoteEvidence });
    try {
      await fixture.store.update("batch-1", (batch) => ({
        ...batch,
        items: batch.items.map((item) => ({ ...item, product_name: "Mutated after confirmation" }))
      }));

      await assert.rejects(runBatch(fixture), /execution key/i);
      assert.deepEqual(executor.calls, []);
    } finally {
      await fixture.cleanup();
    }
  });
}
