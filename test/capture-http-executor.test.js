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

test("capture_http executor supports real_dry_run without network access", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-http-dry-run-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifestPath = path.join(root, "manifest.json");
  const batchDirectory = path.join(root, "batches", "batch-dry-run");
  const productImagePath = path.join(batchDirectory, "uploads", "product.png");
  await mkdir(path.dirname(productImagePath), { recursive: true });
  await writeFile(productImagePath, "image-bytes");
  await writeFile(manifestPath, JSON.stringify({
    schema_version: 1,
    source: "hifly_goods",
    captured_at: "2026-07-16T00:00:00Z",
    sanitized: true,
    steps: [
      {
        id: "asset",
        phase: "asset_generation",
        method: "POST",
        url_template: "https://hiflyworks-api.lingverse.co/assets",
        response: { status: 200, body: { data: { gen_id: "asset-1" } } },
        produces: { asset_id: "$response.body.data.gen_id" }
      },
      {
        id: "submit",
        phase: "remote_submit",
        method: "POST",
        url_template: "https://hiflyworks-api.lingverse.co/videos/{{asset_id}}",
        placeholders: ["{{asset_id}}"],
        request_template: { body: { gen_id: "{{asset_id}}" } },
        risk: { requires_auth: true, may_consume_points: true, replayability: "unknown" },
        response: { status: 200, body: { data: { list: [{ id: 634505 }] } } },
        produces: { remote_id: "$response.body.data.list.0.id" }
      },
      {
        id: "poll",
        phase: "remote_query",
        method: "GET",
        url_template: "https://hiflyworks-api.lingverse.co/videos/{{remote_id}}",
        placeholders: ["{{remote_id}}"],
        response: { status: 200, body: { data: { ok: true } } }
      },
      {
        id: "download",
        phase: "download",
        method: "GET",
        url_template: "https://hiflyworks-api.lingverse.co/videos/{{remote_id}}/download",
        placeholders: ["{{remote_id}}"],
        response: { status: 200, body: { data: { title: "dry-run-video" } } },
        produces: { artifact_filename: "$response.body.data.title" }
      }
    ]
  }, null, 2));

  const executor = createCaptureHttpExecutor({
    root,
    config: { rpa: { mode: "capture_http", manifestPath, captureHttpMode: "real_dry_run" } }
  });
  const task = { task_id: "task-1", sku: "SKU", product_name: "Dry Run", image_path: productImagePath };
  const asset = await executor.createAsset(task, { batchId: "batch-dry-run" });
  const submitted = await executor.submitVideo(task, asset, { batchId: "batch-dry-run" });
  const ready = await executor.querySubmission(submitted.remoteEvidence);
  const artifact = await executor.downloadArtifact(ready.remoteEvidence, null, { batchId: "batch-dry-run", taskId: task.task_id });
  const state = await readRpaState(path.join(root, "batches", "batch-dry-run"), task.task_id);
  assert.equal(artifact.artifact_id, "634505");
  assert.equal(state.status, "completed");
  assert.equal(state.capture_http_mode, "real_dry_run");
  assert.equal(state.request_plan.length, 4);
  assert.equal(state.request_plan[1].risk_flags.includes("may_consume_points"), true);
});
