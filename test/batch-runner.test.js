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
import { HiflyHandsOnProductPage } from "../src/hifly-page.js";

async function fixtureRun({ executor, initialStatus = "confirmed" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-runner-"));
  const image = path.join(root, "product.png");
  await writeFile(image, "product-image");

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
    selling_points: "Useful",
    category: "beauty",
    image_path: image,
    image_path: image
  };
  const snapshot = await createExecutionSnapshot([sourceItem], execution);
  const item = {
    ...sourceItem,
    status: initialStatus,
    execution_key: snapshot.executionKey,
    confirmed_at: execution.confirmedAt
  };
  const backing = createBatchStore(path.join(root, "batches"));
  await backing.create({ batch_id: "batch-1", items: [item], status: "pending", execution_snapshot: snapshot });
  const lock = await acquireExecutionLock({
    root: path.join(root, "locks"),
    batchId: "batch-1",
    instanceId: "fixture-runner",
    heartbeatIntervalMs: 10_000
  });
  const history = new Map([[item.task_id, [item.status]]]);
  const store = {
    ...backing,
    async update(batchId, updater) {
      const before = await backing.read(batchId);
      const next = await backing.update(batchId, updater);
      for (const nextItem of next.items) {
        const beforeItem = before.items.find((candidate) => candidate.task_id === nextItem.task_id);
        if (beforeItem?.status !== nextItem.status) {
          const taskHistory = history.get(nextItem.task_id) ?? [beforeItem?.status].filter(Boolean);
          taskHistory.push(nextItem.status);
          history.set(nextItem.task_id, taskHistory);
        }
      }
      return next;
    },
    statusHistory(taskId) {
      return history.get(taskId);
    }
  };

  return {
    batchId: "batch-1",
    items: [item],
    config: { execution },
    paths: { projectRoot: root, downloadDir: path.join(root, "downloads") },
    executor: executor ?? createFakeExecutor({ remoteId: "remote-1" }),
    store,
    lock,
    cleanup: async () => {
      await lock.release().catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  };
}

test("persists checkpoints around submit and download", async () => {
  const fixture = await fixtureRun({ executor: createFakeExecutor({ remoteId: "remote-1" }) });
  try {
    const result = await runBatch(fixture);

    assert.deepEqual(fixture.store.statusHistory("task-1"), [
      "confirmed", "generating_asset", "asset_confirmed",
      "submitted", "download_pending", "completed"
    ]);
    assert.equal(result.items[0].remote_evidence.remote_id, "remote-1");
    assert.equal(result.items[0].output_path, "downloads/remote-1.mp4");
    assert.equal(result.items[0].submit_checkpoint.phase, "remote_submit_pre");
  } finally {
    await fixture.cleanup();
  }
});

test("rejects a confirmed execution whose snapshot no longer matches", async () => {
  const fixture = await fixtureRun();
  try {
    await fixture.store.update("batch-1", (batch) => ({
      ...batch,
      items: batch.items.map((item) => ({ ...item, product_name: "Changed after confirmation" }))
    }));

    await assert.rejects(runBatch(fixture), /execution key/i);
    assert.deepEqual(fixture.executor.calls, []);
  } finally {
    await fixture.cleanup();
  }
});

for (const status of [
  "confirmed",
  "generating_asset",
  "asset_confirmed",
  "submitted",
  "download_pending",
  "interrupted_unknown"
]) {
  test(`a ${status} task without an execution key cannot invoke an executor`, async () => {
    const fixture = await fixtureRun({ initialStatus: status });
    try {
      await fixture.store.update("batch-1", (batch) => ({
        ...batch,
        items: batch.items.map((item) => ({ ...item, execution_key: null }))
      }));

      await assert.rejects(runBatch(fixture), /execution key is required/i);
      assert.deepEqual(fixture.executor.calls, []);
    } finally {
      await fixture.cleanup();
    }
  });
}

test("download-pending retry only downloads the known artifact", async () => {
  const executor = createFakeExecutor({ remoteId: "remote-1" });
  const fixture = await fixtureRun({ executor, initialStatus: "download_pending" });
  try {
    await fixture.store.update("batch-1", (batch) => ({
      ...batch,
      items: batch.items.map((item) => ({
        ...item,
        remote_evidence: { remote_id: "remote-1", match_method: "remote_id", evidence_source: "direct_submission" }
      }))
    }));

    const result = await runBatch(fixture);

    assert.equal(result.items[0].status, "completed");
    assert.deepEqual(executor.calls.map((call) => call.method), ["downloadArtifact"]);
  } finally {
    await fixture.cleanup();
  }
});

test("submit-boundary failure remains unknown after its checkpoint", async () => {
  const executor = createFakeExecutor({ failAt: "submitVideo" });
  const fixture = await fixtureRun({ executor });
  try {
    const result = await runBatch(fixture);

    assert.equal(result.items[0].status, "interrupted_unknown");
    assert.equal(result.items[0].submit_checkpoint.phase, "remote_submit_pre");
    assert.equal(executor.callCounts.submitVideo, 1);
    assert.equal(executor.callCounts.createAsset, 1);
  } finally {
    await fixture.cleanup();
  }
});

test("a lock without live ownership verification cannot invoke an executor", async () => {
  const fixture = await fixtureRun();
  try {
    fixture.lock = { metadata: { batchId: "batch-1" } };

    await assert.rejects(runBatch(fixture), /acquired lock/i);
    assert.deepEqual(fixture.executor.calls, []);
  } finally {
    await fixture.cleanup();
  }
});

test("stale or mismatched lock ownership cannot invoke an executor", async () => {
  const fixture = await fixtureRun();
  try {
    const metadata = fixture.lock.metadata;
    fixture.lock = {
      metadata,
      async inspect() {
        return { ...metadata, batchId: "other-batch" };
      },
      async heartbeat() {
        throw new Error("stale lock");
      }
    };

    await assert.rejects(runBatch(fixture), /lock/i);
    assert.deepEqual(fixture.executor.calls, []);
  } finally {
    await fixture.cleanup();
  }
});

test("an unacquired stale lock heartbeat cannot invoke an executor", async () => {
  const fixture = await fixtureRun();
  try {
    const metadata = {
      ...fixture.lock.metadata,
      heartbeatAt: new Date(Date.now() - 60_000).toISOString()
    };
    fixture.lock = {
      metadata,
      async inspect() {
        return metadata;
      },
      async heartbeat() {
        return metadata;
      }
    };

    await assert.rejects(runBatch(fixture), /genuine acquired lock/i);
    assert.deepEqual(fixture.executor.calls, []);
  } finally {
    await fixture.cleanup();
  }
});

test("a fresh duck-typed lock cannot invoke an executor", async () => {
  const fixture = await fixtureRun();
  try {
    const metadata = { ...fixture.lock.metadata };
    fixture.lock = {
      metadata,
      async inspect() {
        return metadata;
      },
      async heartbeat() {
        return metadata;
      }
    };

    await assert.rejects(runBatch(fixture), /genuine acquired lock/i);
    assert.deepEqual(fixture.executor.calls, []);
  } finally {
    await fixture.cleanup();
  }
});

test("a changed lock blocks submit after asset generation", async () => {
  const fixture = await fixtureRun();
  const executor = createFakeExecutor({ remoteId: "remote-1" });
  const createAsset = executor.createAsset;
  executor.createAsset = async (...args) => {
    const asset = await createAsset(...args);
    const metadata = await fixture.lock.inspect();
    await writeFile(fixture.lock.lockPath, JSON.stringify({ ...metadata, batchId: "other-batch" }));
    return asset;
  };
  fixture.executor = executor;
  try {
    await assert.rejects(runBatch(fixture), /lock/i);
    assert.deepEqual(executor.calls.map((call) => call.method), ["createAsset"]);
  } finally {
    await fixture.cleanup();
  }
});

test("a changed persisted snapshot blocks submit after asset generation", async () => {
  const fixture = await fixtureRun();
  const executor = createFakeExecutor({ remoteId: "remote-1" });
  const createAsset = executor.createAsset;
  executor.createAsset = async (...args) => {
    const asset = await createAsset(...args);
    await fixture.store.update("batch-1", (batch) => ({
      ...batch,
      items: batch.items.map((item) => ({ ...item, product_name: "Mutated while running" }))
    }));
    return asset;
  };
  fixture.executor = executor;
  try {
    await assert.rejects(runBatch(fixture), /execution key/i);
    assert.deepEqual(executor.calls.map((call) => call.method), ["createAsset"]);
  } finally {
    await fixture.cleanup();
  }
});

test("a failed download remains pending and its retry only downloads", async () => {
  const fixture = await fixtureRun({
    initialStatus: "download_pending",
    executor: createFakeExecutor({ downloadFailure: true })
  });
  try {
    await fixture.store.update("batch-1", (batch) => ({
      ...batch,
      items: batch.items.map((item) => ({
        ...item,
        remote_evidence: { remote_id: "remote-1", match_method: "remote_id", evidence_source: "direct_submission" }
      }))
    }));

    const failed = await runBatch(fixture);
    assert.equal(failed.items[0].status, "download_pending");
    assert.deepEqual(fixture.executor.calls.map((call) => call.method), ["downloadArtifact"]);

    const retry = createFakeExecutor({ remoteId: "remote-1" });
    fixture.executor = retry;
    const recovered = await runBatch(fixture);
    assert.equal(recovered.items[0].status, "completed");
    assert.deepEqual(retry.calls.map((call) => call.method), ["downloadArtifact"]);
  } finally {
    await fixture.cleanup();
  }
});

test("a pre-submit auth pause does not submit or download", async () => {
  const executor = createFakeExecutor({ pauseAt: "createAsset" });
  const fixture = await fixtureRun({ executor });
  try {
    const result = await runBatch(fixture);

    assert.equal(result.items[0].status, "generating_asset");
    assert.equal(result.items[0].paused_auth, true);
    assert.deepEqual(executor.calls.map((call) => call.method), ["createAsset"]);
  } finally {
    await fixture.cleanup();
  }
});

test("a completed prior item does not invalidate the next confirmed item's snapshot", async () => {
  const executor = createFakeExecutor({ remoteId: "remote-2" });
  const fixture = await fixtureRun({ executor });
  try {
    const first = fixture.items[0];
    const secondSource = {
      task_id: "task-2",
      sku: "SKU-2",
      product_name: "Beta",
      selling_points: "Fast",
      category: "beauty",
      image_path: first.image_path
    };
    const snapshot = await createExecutionSnapshot([first, secondSource], fixture.config.execution);
    await fixture.store.update("batch-1", (batch) => ({
      ...batch,
      execution_snapshot: snapshot,
      items: [
        {
          ...first,
          status: "completed",
          execution_key: snapshot.executionKey,
          remote_evidence: { remote_id: "remote-1" },
          output_path: "downloads/remote-1.mp4"
        },
        {
          ...secondSource,
          status: "confirmed",
          execution_key: snapshot.executionKey,
          confirmed_at: fixture.config.execution.confirmedAt
        }
      ]
    }));

    const result = await runBatch(fixture);

    assert.deepEqual(result.items.map((item) => item.status), ["completed", "completed"]);
    assert.deepEqual(executor.calls.map((call) => call.method), [
      "createAsset", "submitVideo", "querySubmission", "downloadArtifact"
    ]);
  } finally {
    await fixture.cleanup();
  }
});

test("download clicks the current stable work identity after list reordering", async () => {
  const selectors = [];
  let clicked = false;
  const stableButton = {
    async waitFor() {},
    async click() {
      clicked = true;
    }
  };
  const latestPanel = {
    locator(selector) {
      selectors.push(selector);
      if (selector === "button.download") {
        return {
          nth() {
            throw new Error("download must not select a stale list index");
          }
        };
      }
      return { first: () => stableButton };
    }
  };
  const page = {
    getByText() {
      return { first: () => ({ waitFor: async () => {} }) };
    },
    locator(selector) {
      assert.equal(selector, ".auto-main-right");
      return { first: () => latestPanel };
    }
  };
  const adapter = new HiflyHandsOnProductPage(page, { batch: { defaultTimeoutMs: 10 } }, { info() {} });

  await adapter.clickWorkDownload({ remote_id: "wanted-work", index: 0 }, 10);

  assert.equal(clicked, true);
  assert.ok(selectors.some((selector) => selector.includes("wanted-work")));
});

test("submitVideo leaves a sole stable-id post-checkpoint list delta ambiguous", async () => {
  const adapter = new HiflyHandsOnProductPage({}, { batch: { defaultTimeoutMs: 10 } }, { info() {} });
  let observations = 0;
  const checkpoints = [];
  adapter.listLatestWorks = async () => observations++ === 0
    ? [{ work_key: "existing-work" }]
    : [{ work_key: "existing-work" }, { work_key: "remote-new", remote_id: "remote-new" }];
  adapter.captureStep = async () => {};
  adapter.clickSubmitButton = async () => {};

  const result = await adapter.submitVideo({}, {
    checkpoint: async (value) => checkpoints.push(value)
  });

  assert.equal(result.status, "ambiguous");
  assert.equal(result.remoteEvidence, undefined);
  assert.deepEqual(result.candidates, [{ work_key: "remote-new", remote_id: "remote-new" }]);
  assert.equal(checkpoints[0].phase, "remote_submit_pre");
});

test("createHandsOnImage edits a stale generated modal before uploading the current product", async () => {
  const calls = [];
  const adapter = new HiflyHandsOnProductPage({}, {
    batch: { defaultTimeoutMs: 10 },
    behavior: { useRecommendedPersonWhenMissing: true },
    personPool: { fallbackToRecommended: true },
    hiflyUi: {
      uploadPersonText: "上传人物",
      uploadProductText: "上传商品"
    }
  }, { info() {} });

  adapter.openHandsOnModal = async () => calls.push("open");
  adapter.captureStep = async (_product, step) => calls.push(`capture:${step}`);
  adapter.hasGeneratedImageReady = async () => calls.push("ready") && true;
  adapter.resetGeneratedHandsOnImage = async () => calls.push("reset-stale");
  adapter.selectRecommendedPerson = async () => calls.push("select-person");
  adapter.uploadModalFile = async (label, filePath) => calls.push(`upload:${label}:${filePath}`);
  adapter.clickModalGenerate = async () => calls.push("generate");
  adapter.confirmGeneratedHandsOnImage = async () => calls.push("confirm");
  adapter.clickModalConfirm = async () => {
    throw new Error("stale generated result must not be confirmed before re-upload");
  };

  await adapter.createHandsOnImage({
    sku: "SKU001",
    image_path: "/tmp/current-product.png"
  });

  assert.deepEqual(calls, [
    "open",
    "capture:modal-open",
    "ready",
    "reset-stale",
    "capture:modal-reset",
    "select-person",
    "upload:上传商品:/tmp/current-product.png",
    "capture:modal-ready",
    "generate",
    "capture:modal-after-generate",
    "confirm"
  ]);
});

test("resetGeneratedHandsOnImage retries by coordinates when edit click does not reveal upload controls", async () => {
  const actions = [];
  let attempts = 0;
  const uploadButton = {
    async waitFor() {
      attempts += 1;
      if (attempts === 1) throw new Error("upload controls still hidden");
      actions.push("upload-visible");
    }
  };
  const editButton = {
    async waitFor() {
      actions.push("edit-visible");
    },
    async click() {
      actions.push("edit-click");
    },
    async boundingBox() {
      actions.push("edit-box");
      return { x: 10, y: 20, width: 100, height: 40 };
    }
  };
  const dialog = {
    getByRole(_role, options) {
      const name = String(options?.name || "");
      return name.includes("上传商品") ? { first: () => uploadButton } : { first: () => editButton };
    }
  };
  const page = {
    mouse: {
      async click(x, y) {
        actions.push(`mouse:${x}:${y}`);
      }
    },
    async waitForTimeout(ms) {
      actions.push(`wait:${ms}`);
    }
  };
  const adapter = new HiflyHandsOnProductPage(page, {
    batch: { defaultTimeoutMs: 10 },
    hiflyUi: { uploadProductText: "上传商品" }
  }, { info() {} });
  adapter.dialogLocator = () => dialog;

  await adapter.resetGeneratedHandsOnImage();

  assert.deepEqual(actions, [
    "edit-visible",
    "edit-click",
    "edit-box",
    "mouse:60:40",
    "upload-visible",
    "wait:500"
  ]);
});
