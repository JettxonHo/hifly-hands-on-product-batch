import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createYingdaoRpaExecutor } from "../src/executors/yingdao-rpa-executor.js";
import { readRpaState, rpaWorstCaseRenameBackoffMs, writeRpaState } from "../src/rpa/rpa-state.js";

async function waitForRpaState(batchDirectory, taskId, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await readRpaState(batchDirectory, taskId);
    if (state) return state;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for RPA state: ${taskId}`);
}

async function fixture(rpa = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "yingdao-executor-"));
  const batchDirectory = path.join(root, "batches", "batch-1");
  await mkdir(path.join(batchDirectory, "uploads"), { recursive: true });
  const image = path.join(batchDirectory, "uploads", "product.png");
  await writeFile(image, "image");
  const task = {
    task_id: "task-1",
    execution_key: "key-1",
    sku: "SKU-1",
    image_path: image,
    status: "confirmed",
    resolved_script_mode: "hifly_ai"
  };
  const executor = createYingdaoRpaExecutor({
    root,
    config: {
      rpa: {
        callbackBaseUrl: "http://127.0.0.1:4317",
        assetTimeoutMs: 500,
        submitTimeoutMs: 500,
        queryTimeoutMs: 500,
        downloadTimeoutMs: 500,
        pollIntervalMs: 10,
        ...rpa
      }
    }
  });
  return { root, batchDirectory, task, executor };
}

test("createAsset writes package with batch strategies and resolves after asset_confirmed state", async () => {
  const f = await fixture();
  try {
    f.executor.setCallbackBaseUrl("http://127.0.0.1:4399");
    const pending = f.executor.createAsset(f.task, {
      batchId: "batch-1",
      batch: { person_strategy: "fixed_upload", script_strategy: "provided_script" },
      checkpoint: async () => {}
    });
    const state = await waitForRpaState(f.batchDirectory, "task-1");
    const packageData = JSON.parse(await readFile(state.package_path, "utf8"));
    assert.equal(packageData.person_strategy, "fixed_upload");
    assert.equal(packageData.script_strategy, "provided_script");
    assert.equal(packageData.callback_url, "http://127.0.0.1:4399/api/rpa/callback");
    await writeRpaState(f.batchDirectory, "task-1", {
      callback_token: state.callback_token,
      status: "asset_confirmed",
      asset: { asset_id: "rpa-asset-task-1" }
    });
    const asset = await pending;
    assert.equal(asset.asset_id, "rpa-asset-task-1");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("createAsset surfaces failed_remote without waiting for its timeout", async () => {
  const f = await fixture({ assetTimeoutMs: 500, pollIntervalMs: 5 });
  try {
    const started = Date.now();
    const pending = f.executor.createAsset(f.task, { batchId: "batch-1" });
    const observed = pending.then(
      () => null,
      (error) => error
    );
    const state = await waitForRpaState(f.batchDirectory, "task-1");
    await writeRpaState(f.batchDirectory, "task-1", {
      callback_token: state.callback_token,
      status: "failed_remote",
      error: { message: "Remote asset generation failed" }
    });
    const error = await observed;
    assert.equal(error?.code, "YINGDAO_RPA_FAILED_REMOTE");
    assert.match(error.message, /Remote asset generation failed/);
    assert.ok(Date.now() - started < 500);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("createAsset preserves interrupted_unknown from rpa state", async () => {
  const f = await fixture({ assetTimeoutMs: 500, pollIntervalMs: 5 });
  try {
    const pending = f.executor.createAsset(f.task, { batchId: "batch-1" });
    const state = await waitForRpaState(f.batchDirectory, "task-1");
    await writeRpaState(f.batchDirectory, "task-1", {
      callback_token: state.callback_token,
      status: "interrupted_unknown",
      error: { message: "RPA asset state is unknown" }
    });

    await assert.rejects(
      pending,
      (error) => error.code === "YINGDAO_RPA_INTERRUPTED_UNKNOWN" && /state is unknown/.test(error.message)
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("submitVideo returns direct submission evidence from rpa state", async () => {
  const f = await fixture();
  try {
    await writeRpaState(f.batchDirectory, "task-1", { callback_token: "token", status: "asset_confirmed" });
    const pending = f.executor.submitVideo(f.task, { asset_id: "asset" }, {
      batchId: "batch-1",
      checkpoint: async () => {}
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await writeRpaState(f.batchDirectory, "task-1", {
      callback_token: "token",
      status: "submitted",
      remote_evidence: { evidence_source: "yingdao_rpa", remote_id: "632410", work_key: "632410" }
    });
    const result = await pending;
    assert.equal(result.status, "submitted");
    assert.equal(result.remoteEvidence.remote_id, "632410");
    assert.equal(result.remoteEvidence.evidence_source, "direct_submission");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("submitVideo maps failed_remote state to a remote failure result", async () => {
  const f = await fixture();
  try {
    await writeRpaState(f.batchDirectory, "task-1", {
      callback_token: "token",
      status: "failed_remote",
      error: { message: "Yingdao reported remote failure" }
    });

    const result = await f.executor.submitVideo(f.task, { asset_id: "asset" }, {
      batchId: "batch-1",
      checkpoint: async () => {}
    });

    assert.equal(result.status, "failed");
    assert.equal(result.error.message, "Yingdao reported remote failure");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("downloadArtifact returns artifact from completed rpa state", async () => {
  const f = await fixture();
  try {
    await writeRpaState(f.batchDirectory, "task-1", {
      callback_token: "token",
      status: "completed",
      artifact: { artifact_id: "632410", relative_path: "batches/batch-1/632410.mp4" }
    });
    const artifact = await f.executor.downloadArtifact(
      { remote_id: "632410", task_id: "task-1" },
      f.batchDirectory,
      { batchId: "batch-1", taskId: "task-1" }
    );
    assert.equal(artifact.artifact_id, "632410");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("querySubmission and reconcileSubmission reflect local remote state", async () => {
  const f = await fixture();
  try {
    await writeRpaState(f.batchDirectory, "task-1", {
      callback_token: "token",
      status: "failed_remote",
      remote_evidence: { remote_id: "632410", work_key: "632410" }
    });
    const remoteEvidence = { remote_id: "632410", task_id: "task-1" };
    const query = await f.executor.querySubmission(remoteEvidence, { batchId: "batch-1", taskId: "task-1" });
    const reconciliation = await f.executor.reconcileSubmission(f.task, {}, { batchId: "batch-1" });
    assert.equal(query.status, "failed");
    assert.deepEqual(reconciliation.candidates, [{ remote_id: "632410", work_key: "632410" }]);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("querySubmission rethrows non-timeout RPA state read errors", async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.batchDirectory, "rpa", "state"), { recursive: true });
    await writeFile(path.join(f.batchDirectory, "rpa", "state", "task-1.json"), "not-json");

    await assert.rejects(
      () => f.executor.querySubmission({ remote_id: "632410", task_id: "task-1" }, { batchId: "batch-1", taskId: "task-1" }),
      SyntaxError
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("querySubmission and downloadArtifact surface configured RPA timeouts", async () => {
  const f = await fixture({ queryTimeoutMs: 20, downloadTimeoutMs: 20, pollIntervalMs: 5 });
  try {
    await writeRpaState(f.batchDirectory, "task-1", { status: "submitted" });
    await assert.rejects(
      () => f.executor.querySubmission(
        { remote_id: "632410", task_id: "task-1" },
        { batchId: "batch-1", taskId: "task-1" }
      ),
      (error) => error.code === "YINGDAO_RPA_TIMEOUT" && /remote_query/.test(error.message)
    );

    await writeRpaState(f.batchDirectory, "task-1", { status: "download_pending" });
    await assert.rejects(
      () => f.executor.downloadArtifact(
        { remote_id: "632410", task_id: "task-1" },
        f.batchDirectory,
        { batchId: "batch-1", taskId: "task-1" }
      ),
      (error) => error.code === "YINGDAO_RPA_TIMEOUT" && /download/.test(error.message)
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("createAsset times out using the configured short timeout", async () => {
  const f = await fixture({ assetTimeoutMs: 20, pollIntervalMs: 5 });
  try {
    await assert.rejects(
      () => f.executor.createAsset(f.task, { batchId: "batch-1" }),
      (error) => error.code === "YINGDAO_RPA_TIMEOUT" && /asset_generation/.test(error.message)
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

// --- CI-003 / Issue #49 deterministic regressions ----------------------------
// The Windows CI flake (run 30892244289 attempt 1) came from two contract
// defects:
//   1. createAsset published the generating_asset state (carrying
//      package_path) BEFORE the package file existed, leaving observers no
//      happens-before boundary (they had to guess-poll with ENOENT retries);
//   2. the flaky test gave the executor a 500ms asset budget, smaller than
//      the implementation's own legal rename retry window
//      (rpaWorstCaseRenameBackoffMs() = 810ms).
// These tests pin both boundaries deterministically via the injected clock —
// no real sleeps, no dependency on real Windows file locks.

function createFakeClock(startMs = 0) {
  let now = startMs;
  return {
    now: () => now,
    advance: (ms) => {
      now += ms;
    }
  };
}

test("createAsset publishes the package file before the generating_asset state (CI-003)", async () => {
  const f = await fixture({ assetTimeoutMs: 50, pollIntervalMs: 5 });
  try {
    const pending = f.executor.createAsset(f.task, { batchId: "batch-1" });
    const state = await waitForRpaState(f.batchDirectory, "task-1");
    // Happens-before invariant: the moment package_path becomes visible in
    // the state, the package file must already exist in full. Pre-fix the
    // state was written first and this observation could hit ENOENT
    // (empirically 10/300 iterations on the unfixed code); any read error
    // here is now a real defect, not a race.
    const packageData = JSON.parse(await readFile(state.package_path, "utf8"));
    assert.equal(packageData.task_id, f.task.task_id);
    await assert.rejects(
      pending,
      (error) => error.code === "YINGDAO_RPA_TIMEOUT" && /asset_generation/.test(error.message)
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("createAsset survives a legitimate rename-contention window inside the derived asset budget (CI-003)", async () => {
  const clock = createFakeClock();
  const derivedBudgetMs = rpaWorstCaseRenameBackoffMs() + 1000;
  const f = await fixture({ assetTimeoutMs: derivedBudgetMs, pollIntervalMs: 1, clockMs: clock.now });
  try {
    const pending = f.executor.createAsset(f.task, { batchId: "batch-1" });
    await waitForRpaState(f.batchDirectory, "task-1");
    // Simulate the elapsed time a legitimate Windows EPERM/EBUSY rename retry
    // sequence can consume while the asset_confirmed state is published:
    // 600ms sits inside the implementation's own 810ms retry window.
    clock.advance(600);
    const state = await readRpaState(f.batchDirectory, "task-1");
    await writeRpaState(f.batchDirectory, "task-1", {
      callback_token: state.callback_token,
      status: "asset_confirmed",
      asset: { asset_id: "rpa-asset-contention" }
    });
    const asset = await pending;
    assert.equal(asset.asset_id, "rpa-asset-contention");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("the pre-CI-003 500ms asset budget false-fails under the same legitimate contention (CI-003 reproduction)", async () => {
  const clock = createFakeClock();
  const f = await fixture({ assetTimeoutMs: 500, pollIntervalMs: 1, clockMs: clock.now });
  try {
    const pending = f.executor.createAsset(f.task, { batchId: "batch-1" });
    const observed = pending.then(
      () => null,
      (error) => error
    );
    await waitForRpaState(f.batchDirectory, "task-1");
    // The identical 600ms contention that fits inside the legal rename retry
    // window already exceeds the old hard-coded 500ms test budget: the
    // executor rejects before asset_confirmed can ever be observed — exactly
    // the spurious YINGDAO_RPA_TIMEOUT at asset_generation seen on Windows CI
    // run 30892244289 attempt 1 (test duration 567ms there).
    clock.advance(600);
    const error = await observed;
    assert.equal(error?.code, "YINGDAO_RPA_TIMEOUT");
    assert.match(error.message, /asset_generation/);
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});
