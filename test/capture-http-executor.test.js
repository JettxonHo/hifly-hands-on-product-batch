import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createCaptureHttpExecutor } from "../src/executors/capture-http-executor.js";
import { readRpaState } from "../src/rpa/rpa-state.js";
import { extractRawStepsFromHar } from "../src/rpa/capture/har-extractor.js";
import { redactCaptureSource } from "../src/rpa/capture/redact.js";

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

function hiflyworksEntry({ url, method = "POST", body, requestBody = null }) {
  return {
    request: {
      method,
      url,
      headers: [{ name: "content-type", value: "application/json" }],
      ...(requestBody ? { postData: { mimeType: "application/json", text: JSON.stringify(requestBody) } } : {})
    },
    response: {
      status: 200,
      headers: [{ name: "content-type", value: "application/json" }],
      content: { mimeType: "application/json", text: JSON.stringify(body) }
    }
  };
}

function hiflyworksHar() {
  const api = "https://hiflyworks-api.lingverse.co/api/app/v1";
  return {
    log: {
      version: "1.2",
      creator: { name: "test", version: "1" },
      entries: [
        hiflyworksEntry({
          url: `${api}/upload_url`,
          requestBody: { extension: "png", media_type: "image" },
          body: { code: 0, data: { oss_key: "goods/key.png" } }
        }),
        hiflyworksEntry({
          url: `${api}/one_stop/goods_in_hand/goods_holding_image_generation`,
          requestBody: { goods_image_oss_key: "goods/key.png" },
          body: { code: 0, data: {} }
        }),
        hiflyworksEntry({
          url: `${api}/one_stop/goods_in_hand/goods_holding_image_generation?identifier=sample`,
          method: "GET",
          body: { code: 0, data: { status: 3, gen_id: "asset-1" } }
        }),
        hiflyworksEntry({
          url: `${api}/one_stop/goods_in_hand/videos`,
          requestBody: { gen_id: "asset-1" },
          body: { code: 0, data: {} }
        }),
        hiflyworksEntry({
          url: `${api}/one_stop/goods_in_hand/videos?id=asset-1&remote_id=remote-1`,
          method: "GET",
          body: { code: 0, data: { list: [{ id: "remote-1", status: 1 }] } }
        }),
        hiflyworksEntry({
          url: `${api}/one_stop/goods_in_hand/videos?id=asset-1&remote_id=remote-1`,
          method: "GET",
          body: { code: 0, data: { list: [{ id: "remote-1", status: 1 }] } }
        }),
        hiflyworksEntry({
          url: `${api}/one_stop/goods_in_hand/videos?id=asset-1&remote_id=remote-1`,
          method: "GET",
          body: { code: 0, data: { list: [{ id: "remote-1", status: 2, title: "output.mp4", url: "https://example.invalid/output.mp4" }] } }
        })
      ]
    }
  };
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

test("capture_http executor rejects falsy configured modes", () => {
  for (const captureHttpMode of ["", null, false, 0]) {
    assert.throws(
      () => createCaptureHttpExecutor({ root: process.cwd(), config: { rpa: { manifestPath: FIXTURE, captureHttpMode } } }),
      { code: "CAPTURE_HTTP_MODE_INVALID" },
      `mode ${String(captureHttpMode)} must be rejected`
    );
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
        url_template: "https://hiflyworks-api.lingverse.co/videos/{{asset_id}}/{{remote_id}}",
        placeholders: ["{{asset_id}}", "{{remote_id}}"],
        response: { status: 200, body: { data: { ok: true } } }
      },
      {
        id: "download",
        phase: "download",
        method: "GET",
        url_template: "https://hiflyworks-api.lingverse.co/videos/{{asset_id}}/{{remote_id}}/download",
        placeholders: ["{{asset_id}}", "{{remote_id}}"],
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

test("capture_http executor preserves variables across a redacted hiflyworks HAR pipeline", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-http-hiflyworks-pipeline-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const batchId = "batch-hiflyworks-pipeline";
  const taskId = "task-1";
  const batchDirectory = path.join(root, "batches", batchId);
  const harPath = path.join(root, "synthetic-hiflyworks.har");
  const manifestPath = path.join(root, "manifest.json");
  const productImagePath = path.join(batchDirectory, "uploads", "product.png");
  await mkdir(path.dirname(productImagePath), { recursive: true });
  await Promise.all([
    writeFile(productImagePath, "image-bytes"),
    writeFile(harPath, JSON.stringify(hiflyworksHar()))
  ]);
  const raw = await extractRawStepsFromHar({ harPath });
  const { sanitized } = redactCaptureSource(raw);
  await writeFile(manifestPath, JSON.stringify(sanitized));

  const executor = createCaptureHttpExecutor({
    root,
    config: { rpa: { manifestPath, captureHttpMode: "real_dry_run" } }
  });
  const task = { task_id: taskId, sku: "SKU", product_name: "Pipeline", image_path: productImagePath };
  const context = { batchId, taskId };
  const asset = await executor.createAsset(task, context);
  const submitted = await executor.submitVideo(task, asset, context);
  const ready = await executor.querySubmission(submitted.remoteEvidence, context);
  await executor.downloadArtifact(ready.remoteEvidence, null, context);

  const state = await readRpaState(batchDirectory, taskId);
  assert.deepEqual(state.request_plan.map((entry) => entry.phase), [
    "asset_generation",
    "asset_generation",
    "asset_generation",
    "remote_submit",
    "remote_submit",
    "remote_query",
    "download"
  ]);
  assert.equal(state.capture_variables.asset_id, "asset-1");
  assert.equal(state.capture_variables.remote_id, "remote-1");
  const queryPlan = state.request_plan.find((entry) => entry.step_id === "poll_video_status");
  const downloadPlan = state.request_plan.find((entry) => entry.step_id === "download_video");
  for (const entry of [queryPlan, downloadPlan]) {
    assert.equal(entry.url.includes("id=asset-1"), true);
    assert.equal(entry.url.includes("remote_id=remote-1"), true);
    assert.equal(entry.url.includes("%7B%7B"), false);
    assert.equal(entry.url.includes("{{"), false);
  }
});

test("capture_http executor keeps accumulated plans when a phase has no steps", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-http-plan-retain-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifestPath = path.join(root, "manifest.json");
  const batchDirectory = path.join(root, "batches", "batch-plan-retain");
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
        url_template: "https://example.test/assets",
        response: { status: 200, body: { data: { gen_id: "asset-1" } } },
        produces: { asset_id: "$response.body.data.gen_id" }
      },
      {
        id: "submit",
        phase: "remote_submit",
        method: "POST",
        url_template: "https://example.test/videos/{{asset_id}}",
        placeholders: ["{{asset_id}}"],
        response: { status: 200, body: { data: { id: "remote-1" } } },
        produces: { remote_id: "$response.body.data.id" }
      },
      {
        id: "download",
        phase: "download",
        method: "GET",
        url_template: "https://example.test/videos/{{remote_id}}/download",
        placeholders: ["{{remote_id}}"],
        response: { status: 200, body: { data: { title: "plan.mp4" } } },
        produces: { artifact_filename: "$response.body.data.title" }
      }
    ]
  }));
  const executor = createCaptureHttpExecutor({
    root,
    config: { rpa: { manifestPath, captureHttpMode: "real_dry_run" } }
  });
  const task = { task_id: "task-1", sku: "SKU", product_name: "Plan", image_path: productImagePath };
  const context = { batchId: "batch-plan-retain", taskId: task.task_id };
  const asset = await executor.createAsset(task, context);
  const submitted = await executor.submitVideo(task, asset, context);
  await executor.querySubmission(submitted.remoteEvidence, context);
  await executor.downloadArtifact(submitted.remoteEvidence, null, context);
  const state = await readRpaState(batchDirectory, task.task_id);
  assert.deepEqual(state.request_plan.map((entry) => entry.step_id), ["asset", "submit", "download"]);
});
