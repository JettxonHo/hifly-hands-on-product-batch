import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCaptureHttpExecutor } from "../src/executors/capture-http-executor.js";
import { readRpaState } from "../src/rpa/rpa-state.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "..", "rpa", "capture", "fixtures", "hifly-goods-sample.json");

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-exec-"));
  const batchId = "batch-cap-1";
  const batchDirectory = path.join(root, "batches", batchId);
  await mkdir(path.join(batchDirectory, "uploads"), { recursive: true });
  const imagePath = path.join(batchDirectory, "uploads", "product.png");
  await writeFile(imagePath, "image-bytes");
  return { root, batchId, batchDirectory, imagePath, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("capture_http executor drives full asset -> submit -> download flow offline", async () => {
  const f = await fixture();
  try {
    const executor = createCaptureHttpExecutor({
      root: f.root,
      config: { rpa: { mode: "capture_http", manifestPath: FIXTURE, callbackBaseUrl: "http://127.0.0.1:4317" } }
    });
    const task = {
      task_id: "task-cap-1",
      execution_key: "key-1",
      sku: "SKU-1",
      product_name: "Alpha",
      selling_points: "useful",
      category: "toy",
      image_path: f.imagePath,
      resolved_person_image_path: f.imagePath,
      resolved_script_mode: "hifly_ai"
    };
    const context = { batchId: f.batchId, taskId: task.task_id, executionKey: task.execution_key };

    const asset = await executor.createAsset(task, context);
    assert.equal(asset.asset_id, "asset-sample-001");

    const submitted = await executor.submitVideo(task, asset, context);
    assert.equal(submitted.status, "submitted");
    assert.equal(submitted.remoteEvidence.evidence_source, "direct_submission");
    assert.equal(submitted.remoteEvidence.remote_id, "632410");

    const queried = await executor.querySubmission(submitted.remoteEvidence, context);
    assert.equal(queried.status, "ready");

    const artifact = await executor.downloadArtifact(submitted.remoteEvidence, f.batchDirectory, context);
    assert.equal(artifact.artifact_id, "632410");
    assert.equal(path.isAbsolute(artifact.relative_path), false);
    const fileBuffer = await readFile(path.join(f.batchDirectory, artifact.relative_path));
    assert.ok(fileBuffer.length > 0);

    const state = await readRpaState(f.batchDirectory, task.task_id);
    assert.equal(state.status, "completed");
    assert.equal(state.artifact.relative_path, artifact.relative_path);
  } finally {
    await f.cleanup();
  }
});

test("capture_http executor satisfies the adapter contract", () => {
  const executor = createCaptureHttpExecutor({ root: process.cwd(), config: { rpa: { manifestPath: FIXTURE } } });
  for (const method of ["createAsset", "submitVideo", "querySubmission", "downloadArtifact", "reconcileSubmission"]) {
    assert.equal(typeof executor[method], "function");
  }
});
