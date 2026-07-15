import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createYingdaoRpaExecutor } from "../src/executors/yingdao-rpa-executor.js";
import { readRpaState, writeRpaState } from "../src/rpa/rpa-state.js";

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

test("createAsset writes package and resolves after asset_confirmed state", async () => {
  const f = await fixture();
  try {
    const pending = f.executor.createAsset(f.task, {
      batchId: "batch-1",
      checkpoint: async () => {}
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const state = await readRpaState(f.batchDirectory, "task-1");
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
