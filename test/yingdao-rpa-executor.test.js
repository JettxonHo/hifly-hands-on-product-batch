import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createYingdaoRpaExecutor } from "../src/executors/yingdao-rpa-executor.js";
import { applyRpaCallback } from "../src/rpa/callbacks.js";
import { isRpaCallbackTokenActive } from "../src/rpa/callback-token-registry.js";
import {
  RPA_RENAME_MAX_ATTEMPTS,
  readRpaState,
  rpaWorstCaseRenameBackoffMs,
  writeRpaState
} from "../src/rpa/rpa-state.js";

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
// Round 1 pinned the budget contract: the flaky test's 500ms asset budget was
// smaller than the implementation's own legal rename retry window
// (rpaWorstCaseRenameBackoffMs() = 810ms); the fake-clock budget tests below
// keep that proof.
// Round 2 pins the two-phase, callback-safe publication:
//   prepare      full package JSON in a watcher-invisible temp file;
//   state-ready  generating_asset state (status, callback_token,
//                package_path) persisted through the atomic state writer;
//   publish      atomic rename onto the final rpa/tasks/<task>.json path.
// The final path's atomic appearance is the publication signal: once visible,
// the package is complete and the state/token are ready, so an immediate
// callback is accepted. state.package_path is only the state-ready marker,
// NOT the publication signal. All tests are deterministic: injected barriers,
// clocks and rename seams — no real-time races, no Windows file locks.

function createFakeClock(startMs = 0) {
  let now = startMs;
  return {
    now: () => now,
    advance: (ms) => {
      now += ms;
    }
  };
}

async function waitForFile(filePath, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const info = await stat(filePath);
      if (info.isFile()) return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`Timed out waiting for file: ${filePath}`);
}

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function finalPackagePath(batchDirectory, taskId = "task-1") {
  return path.join(batchDirectory, "rpa", "tasks", `${taskId}.json`);
}

function tempPackageNames(entries) {
  return entries.filter((name) => name.startsWith(".rpa-package.") && name.endsWith(".tmp"));
}

test("state is ready before the final package is atomically published (CI-003)", async () => {
  let releaseGate = () => {};
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  const f = await fixture({ assetTimeoutMs: 2000, pollIntervalMs: 5, beforePackagePublish: () => gate });
  const finalPath = finalPackagePath(f.batchDirectory);
  try {
    const pending = f.executor.createAsset(f.task, { batchId: "batch-1" });
    pending.catch(() => {});

    // State-ready phase: the generating_asset state is persisted...
    const state = await waitForRpaState(f.batchDirectory, "task-1");
    assert.equal(state.status, "generating_asset");
    assert.equal(state.package_path, finalPath);
    // ...but the final package path is NOT visible yet: publication is held
    // at the barrier, so a watcher can never observe a package whose
    // callback state is not ready.
    assert.equal(await fileExists(finalPath), false, "final package must stay invisible while publication is held");

    // The prepared temp package holds the complete JSON and its name cannot
    // match the watcher's <taskId>.json pattern.
    const tasksDir = path.dirname(finalPath);
    const temps = tempPackageNames(await readdir(tasksDir));
    assert.equal(temps.length, 1, "exactly one prepared temp package");
    const tempPackage = JSON.parse(await readFile(path.join(tasksDir, temps[0]), "utf8"));
    assert.equal(tempPackage.task_id, f.task.task_id);
    assert.equal(tempPackage.callback_token, state.callback_token);

    // Release the barrier: the final path appears through the atomic publish.
    releaseGate();
    await waitForFile(finalPath);
    assert.deepEqual(JSON.parse(await readFile(finalPath, "utf8")), tempPackage);

    // Unblock the executor handshake.
    await writeRpaState(f.batchDirectory, "task-1", {
      callback_token: state.callback_token,
      status: "asset_confirmed",
      asset: { asset_id: "rpa-asset-gate" }
    });
    const asset = await pending;
    assert.equal(asset.asset_id, "rpa-asset-gate");
  } finally {
    releaseGate();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("final package visibility implies complete package and ready matching state (CI-003)", async () => {
  const f = await fixture({ assetTimeoutMs: 200, pollIntervalMs: 5 });
  const finalPath = finalPackagePath(f.batchDirectory);
  try {
    const pending = f.executor.createAsset(f.task, { batchId: "batch-1" });
    pending.catch(() => {});
    await waitForFile(finalPath);
    // The instant the final path appears: the JSON parses in one shot, the
    // state is already persisted, the tokens match, identity is intact.
    const packageData = JSON.parse(await readFile(finalPath, "utf8"));
    const state = await readRpaState(f.batchDirectory, "task-1");
    assert.ok(state, "state must be persisted before publication");
    assert.equal(state.status, "generating_asset");
    assert.equal(state.package_path, finalPath);
    assert.equal(state.callback_token, packageData.callback_token);
    assert.equal(packageData.task_id, f.task.task_id);
    assert.equal(packageData.execution_key, f.task.execution_key);
    await assert.rejects(
      pending,
      (error) => error.code === "YINGDAO_RPA_TIMEOUT" && /asset_generation/.test(error.message)
    );
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("an immediate callback right after publication is accepted (CI-003)", async () => {
  const f = await fixture({ assetTimeoutMs: 2000, pollIntervalMs: 5 });
  const finalPath = finalPackagePath(f.batchDirectory);
  try {
    const pending = f.executor.createAsset(f.task, { batchId: "batch-1" });
    pending.catch(() => {});
    await waitForFile(finalPath);
    // A watcher reading the package the instant it appears fires its
    // callback immediately. State and token were persisted in the
    // state-ready phase, so the existing in-process callback path accepts
    // it: no INVALID_RPA_CALLBACK, no external network.
    const packageData = JSON.parse(await readFile(finalPath, "utf8"));
    const result = await applyRpaCallback({
      batchDirectory: f.batchDirectory,
      currentTask: f.task,
      token: packageData.callback_token,
      requestIp: "127.0.0.1",
      callback: {
        schema_version: 1,
        batch_id: "batch-1",
        task_id: f.task.task_id,
        execution_key: f.task.execution_key,
        status: "asset_confirmed",
        phase: "asset_generation"
      }
    });
    assert.equal(result.accepted, true);
    assert.equal(result.duplicate, false);
    const asset = await pending;
    assert.ok(asset, "createAsset completes from the callback-driven state");
    assert.equal((await readRpaState(f.batchDirectory, "task-1")).status, "asset_confirmed");
  } finally {
    await rm(f.root, { recursive: true, force: true });
  }
});

test("the final package path is never partially written (CI-003)", async () => {
  let releaseGate = () => {};
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  const f = await fixture({ assetTimeoutMs: 2000, pollIntervalMs: 5, beforePackagePublish: () => gate });
  const finalPath = finalPackagePath(f.batchDirectory);
  try {
    const pending = f.executor.createAsset(f.task, { batchId: "batch-1" });
    pending.catch(() => {});
    await waitForRpaState(f.batchDirectory, "task-1");
    // While publication is held at the state-ready boundary, keep probing
    // the final path: it must never appear partially (or at all) until the
    // atomic rename. The barrier holds indefinitely, so these absence
    // assertions are timing-independent.
    for (let probe = 0; probe < 25; probe += 1) {
      assert.equal(await fileExists(finalPath), false, "final path must not exist before the atomic publish");
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    releaseGate();
    await waitForFile(finalPath);
    // The first read of the published file returns the complete JSON in one
    // shot: rename never exposes a partial write.
    const packageData = JSON.parse(await readFile(finalPath, "utf8"));
    assert.equal(packageData.task_id, f.task.task_id);
    const state = await readRpaState(f.batchDirectory, "task-1");
    await writeRpaState(f.batchDirectory, "task-1", {
      callback_token: state.callback_token,
      status: "asset_confirmed",
      asset: { asset_id: "rpa-atomic" }
    });
    const asset = await pending;
    assert.equal(asset.asset_id, "rpa-atomic");
  } finally {
    releaseGate();
    await rm(f.root, { recursive: true, force: true });
  }
});

test("publication failure cleans the temp package, revokes the token, and surfaces the original error (CI-003)", async () => {
  let renameCalls = 0;
  const renameImpl = async () => {
    renameCalls += 1;
    const error = new Error("simulated EPERM on final package rename");
    error.code = "EPERM";
    throw error;
  };
  const f = await fixture({
    assetTimeoutMs: 500,
    pollIntervalMs: 5,
    packagePublish: { delay: () => Promise.resolve(), renameImpl }
  });
  const finalPath = finalPackagePath(f.batchDirectory);
  try {
    await assert.rejects(
      f.executor.createAsset(f.task, { batchId: "batch-1" }),
      (error) => error.code === "EPERM" && /simulated EPERM on final package rename/.test(error.message)
    );
    assert.equal(renameCalls, RPA_RENAME_MAX_ATTEMPTS, "rename retry budget is bounded — no infinite retry");
    assert.equal(await fileExists(finalPath), false, "final package never appears as a runnable task");
    assert.deepEqual(tempPackageNames(await readdir(path.dirname(finalPath))), [], "temp package cleaned");
    // State-ready residue stays inert: status remains generating_asset, but
    // the token is revoked and no package exists. A future createAsset for
    // the same task overwrites it through the existing merge semantics; no
    // new state values or schema are introduced.
    const state = await readRpaState(f.batchDirectory, "task-1");
    assert.equal(state.status, "generating_asset");
    assert.equal(
      isRpaCallbackTokenActive({
        batchDirectory: f.batchDirectory,
        taskId: "task-1",
        executionKey: f.task.execution_key,
        token: state.callback_token
      }),
      false,
      "callback token revoked on publication failure"
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
    // Wait for the atomic publication: this also guarantees the executor has
    // already captured its wait deadline (the wait loop starts synchronously
    // after the publish rename resolves), keeping the fake-clock scenario
    // deterministic under the two-phase order.
    await waitForFile(finalPackagePath(f.batchDirectory));
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
    await waitForFile(finalPackagePath(f.batchDirectory));
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
