import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

import { buildApp } from "../src/server/app.js";
import { createBatchStore } from "../src/core/batch-store.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { registerRpaCallbackToken } from "../src/rpa/callback-token-registry.js";
import { readRpaState, writeRpaState } from "../src/rpa/rpa-state.js";

const HOST = "127.0.0.1:4317";
const ORIGIN = `http://${HOST}`;

async function fixture(executor = createFakeExecutor(), options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-server-api-"));
  const app = await buildApp({ root, executor, ...options });
  const response = await app.inject({ method: "GET", url: "/api/session", headers: { host: HOST } });
  const session = {
    cookie: response.headers["set-cookie"].split(";")[0],
    token: response.json().token,
  };
  return { app, root, session, executor };
}

function headers(session, extra = {}) {
  return {
    host: HOST,
    origin: ORIGIN,
    cookie: session.cookie,
    "x-local-session-token": session.token,
    "content-type": "application/json",
    ...extra,
  };
}

async function createBatch(app, session, batchId) {
  const response = await app.inject({
    method: "POST", url: "/api/batches", headers: headers(session), payload: { batchId }
  });
  assert.equal(response.statusCode, 201);
  return response.json().batch;
}

async function createRpaCallbackTask(root, batchId = "batch-rpa-callback") {
  const store = createBatchStore(path.join(root, "batches"));
  const task = { task_id: "task-1", execution_key: "key-1", status: "asset_confirmed" };
  await store.create({ batch_id: batchId, status: "active", items: [task], uploads: [] });
  await writeRpaState(path.join(root, "batches", batchId), task.task_id, {
    callback_token: "token-1",
    status: task.status
  });
  registerRpaCallbackToken({
    batchDirectory: path.join(root, "batches", batchId),
    taskId: task.task_id,
    executionKey: task.execution_key,
    token: "token-1"
  });
  return { batchId, task };
}

function rpaCallbackPayload({ batchId, task, ...extra }) {
  return {
    schema_version: 1,
    batch_id: batchId,
    task_id: task.task_id,
    execution_key: task.execution_key,
    status: "submitted",
    phase: "remote_submit",
    ...extra
  };
}

function multipart(parts, boundary = "server-api-boundary") {
  const chunks = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (part.filename) {
      chunks.push(Buffer.from(
        `Content-Disposition: form-data; name="${part.name}"; filename="${part.filename}"\r\n` +
        `Content-Type: ${part.contentType}\r\n\r\n`
      ));
      chunks.push(Buffer.isBuffer(part.value) ? part.value : Buffer.from(part.value));
    } else {
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}`));
    }
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return { boundary, body: Buffer.concat(chunks) };
}

async function importInto(app, session, batchId, imageName = "SKU-1.png", metadata = {}, script = "") {
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
  const form = multipart([
    { name: "batchId", value: batchId },
    ...Object.entries(metadata).map(([name, value]) => ({ name, value })),
    {
      name: "files", filename: "products.csv", contentType: "text/csv",
      value: `sku,product_name,selling_points,category,image_path,script\nSKU-1,Alpha,Useful,beauty,${imageName},${script}\n`
    },
    { name: "files", filename: imageName, contentType: "image/png", value: image }
  ]);
  const response = await app.inject({
    method: "POST", url: "/api/imports",
    headers: headers(session, { "content-type": `multipart/form-data; boundary=${form.boundary}` }),
    payload: form.body
  });
  return response;
}

async function pngBuffer() {
  return sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
}

async function importOne(app, session, batchId) {
  await createBatch(app, session, batchId);
  const response = await importInto(app, session, batchId);
  assert.equal(response.statusCode, 200);
  return response.json().batch;
}

test("runtime endpoint exposes execution backend", async (t) => {
  const { app, root } = await fixture(createFakeExecutor(), {
    generationConfig: { executionBackend: "yingdao_rpa" }
  });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const response = await app.inject({ method: "GET", url: "/api/runtime", headers: { host: HOST } });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().executionBackend, "yingdao_rpa");
});

test("runtime endpoint defaults to playwright backend", async (t) => {
  const { app, root } = await fixture(createFakeExecutor());
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const response = await app.inject({ method: "GET", url: "/api/runtime", headers: { host: HOST } });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().executionBackend, "playwright");
});

test("batch projection maps completed item outputs to artifact ids without exposing artifact paths", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-output-artifact",
    status: "completed",
    uploads: [],
    artifacts: [{ artifact_id: "video-1", relative_path: "artifacts/video.mp4" }],
    items: [{
      task_id: "task-1",
      sku: "SKU-1",
      product_name: "Video Product",
      status: "completed",
      output_path: "artifacts/video.mp4"
    }]
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/batches/batch-output-artifact",
    headers: headers(session)
  });

  assert.equal(response.statusCode, 200);
  const batch = response.json().batch;
  assert.deepEqual(batch.artifacts, [{ artifact_id: "video-1" }]);
  assert.equal(batch.items[0].output_path, "artifacts/video.mp4");
  assert.equal(batch.items[0].output_artifact_id, "video-1");
  assert.equal(JSON.stringify(batch.artifacts).includes("artifacts/video.mp4"), false);
});

test("public batch projects remote_evidence through a safe allowlist only", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-remote-evidence",
    status: "completed",
    uploads: [],
    artifacts: [],
    items: [{
      task_id: "task-1",
      sku: "SKU-1",
      status: "completed",
      output_path: "artifacts/video.mp4",
      remote_evidence: {
        remote_id: "remote-1",
        work_key: "remote-1",
        label: "2026-07-20T00:00:00.000Z",
        task_id: "task-1",
        batch_id: "batch-remote-evidence",
        evidence_source: "direct_submission",
        url: "https://cdn.example.com/signed/abc?token=secret",
        signed_url: "https://cdn.example.com/signed/xyz",
        cookie: "session=secret",
        token: "bearer-secret",
        headers: { authorization: "Bearer x" }
      }
    }]
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/batches/batch-remote-evidence",
    headers: headers(session)
  });

  assert.equal(response.statusCode, 200);
  const evidence = response.json().batch.items[0].remote_evidence;
  assert.deepEqual(evidence, {
    remote_id: "remote-1",
    work_key: "remote-1",
    label: "2026-07-20T00:00:00.000Z",
    task_id: "task-1",
    batch_id: "batch-remote-evidence",
    evidence_source: "direct_submission"
  });
  for (const key of ["url", "signed_url", "cookie", "token", "headers"]) {
    assert.equal(key in (evidence || {}), false, `leaked field ${key}`);
  }
});

test("public batch drops URL-shaped values even inside allowlisted remote_evidence fields", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-remote-evidence-url",
    status: "completed",
    uploads: [],
    artifacts: [],
    items: [{
      task_id: "task-1",
      sku: "SKU-1",
      status: "completed",
      output_path: "artifacts/video.mp4",
      remote_evidence: {
        remote_id: "remote-1",
        work_key: "https://cdn.example.com/signed/video.mp4?token=secret",
        label: "2026-07-20T00:00:00.000Z",
        task_id: "task-1",
        batch_id: "batch-remote-evidence-url",
        evidence_source: "direct_submission"
      }
    }]
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/batches/batch-remote-evidence-url",
    headers: headers(session)
  });

  assert.equal(response.statusCode, 200);
  const evidence = response.json().batch.items[0].remote_evidence;
  assert.equal(evidence.work_key, undefined);
  assert.equal(evidence.remote_id, "remote-1");
  assert.equal(evidence.label, "2026-07-20T00:00:00.000Z");
  assert.equal(JSON.stringify(evidence).includes("cdn.example.com"), false);
  assert.equal(JSON.stringify(evidence).includes("token=secret"), false);
});

test("public batch drops scheme-relative and non-http URL-shaped remote_evidence values", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-evidence-url-schemes",
    status: "completed",
    uploads: [],
    artifacts: [],
    items: [{
      task_id: "task-1",
      sku: "SKU-1",
      status: "completed",
      output_path: "artifacts/video.mp4",
      remote_evidence: {
        remote_id: "//cdn.example.com/video.mp4?token=secret",
        work_key: "data:text/plain;base64,SGVsbG8=",
        label: "blob:abc123-no-slash",
        task_id: "javascript:alert(1)",
        batch_id: "0:label-fallback",
        evidence_source: "direct_submission"
      }
    }]
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/batches/batch-evidence-url-schemes",
    headers: headers(session)
  });

  assert.equal(response.statusCode, 200);
  const evidence = response.json().batch.items[0].remote_evidence;
  assert.equal(evidence.batch_id, "0:label-fallback");
  assert.equal(evidence.evidence_source, "direct_submission");
  for (const key of ["remote_id", "work_key", "label", "task_id"]) {
    assert.equal(key in (evidence || {}), false, `leaked URL-shaped field ${key}`);
  }
  assert.equal(JSON.stringify(evidence).includes("cdn.example.com"), false);
  assert.equal(JSON.stringify(evidence).includes("token=secret"), false);
  assert.equal(JSON.stringify(evidence).includes("base64"), false);
  assert.equal(JSON.stringify(evidence).includes("alert(1)"), false);
});

test("public batch projects remote_candidates through the same safe allowlist and URL filter", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-remote-candidates",
    status: "completed",
    uploads: [],
    artifacts: [],
    items: [{
      task_id: "task-1",
      sku: "SKU-1",
      status: "interrupted_unknown",
      remote_evidence: {
        remote_id: "kept-1",
        evidence_source: "direct_submission"
      },
      remote_candidates: [
        {
          remote_id: "cand-1",
          remote_url: "https://cdn.example.com/signed/cand-1?token=secret",
          work_key: "//cdn.example.com/cand-1?token=secret",
          label: "2026-07-20T00:00:00.000Z",
          token: "bearer-secret",
          headers: { authorization: "Bearer x" },
          index: 0
        },
        {
          remote_url: "https://cdn.example.com/cand-2?token=leak",
          work_key: "data:text/plain,leak"
        }
      ]
    }]
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/batches/batch-remote-candidates",
    headers: headers(session)
  });

  assert.equal(response.statusCode, 200);
  const item = response.json().batch.items[0];
  const candidates = item.remote_candidates;
  assert.ok(Array.isArray(candidates), "remote_candidates projected as array");
  assert.equal(candidates.length, 1, "only the candidate with a safe field survives");
  assert.deepEqual(candidates[0], {
    remote_id: "cand-1",
    label: "2026-07-20T00:00:00.000Z"
  });
  assert.equal("remote_url" in candidates[0], false);
  assert.equal("work_key" in candidates[0], false);
  assert.equal("token" in candidates[0], false);
  assert.equal("headers" in candidates[0], false);
  assert.equal("index" in candidates[0], false);
  assert.equal(JSON.stringify(item).includes("cdn.example.com"), false);
  assert.equal(JSON.stringify(item).includes("token=secret"), false);
  assert.equal(JSON.stringify(item).includes("bearer-secret"), false);
  assert.equal(JSON.stringify(item).includes("data:text/plain,leak"), false);
});

test("public batch keeps checkpoint progress scalars but drops works/work_keys evidence", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-submit-checkpoint",
    status: "active",
    uploads: [],
    artifacts: [],
    items: [{
      task_id: "task-1",
      sku: "SKU-1",
      status: "submitted",
      submit_checkpoint: {
        phase: "remote_submit_wait",
        observed_at: "2026-07-20T00:00:00.000Z",
        evidence: {
          observed_at: "2026-07-20T00:00:00.000Z",
          elapsed_ms: 5000,
          candidate_count: 1,
          work_keys: ["//cdn.example.com/signed/a?token=secret", "https://cdn.example.com/b"],
          works: [
            {
              remote_id: "w-1",
              remote_url: "https://cdn.example.com/signed/video?token=secret",
              work_key: "//cdn.example.com/c?token=secret",
              label: "2026-07-20T00:00:00.000Z"
            }
          ]
        }
      }
    }]
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/batches/batch-submit-checkpoint",
    headers: headers(session)
  });

  assert.equal(response.statusCode, 200);
  const item = response.json().batch.items[0];
  const checkpoint = item.submit_checkpoint;
  assert.ok(checkpoint, "submit_checkpoint retained for GUI progress");
  assert.equal(checkpoint.phase, "remote_submit_wait");
  assert.equal(checkpoint.observed_at, "2026-07-20T00:00:00.000Z");
  assert.equal(checkpoint.evidence.elapsed_ms, 5000);
  assert.equal(checkpoint.evidence.candidate_count, 1);
  assert.equal("works" in checkpoint.evidence, false);
  assert.equal("work_keys" in checkpoint.evidence, false);
  assert.equal(JSON.stringify(item).includes("cdn.example.com"), false);
  assert.equal(JSON.stringify(item).includes("token=secret"), false);
  assert.equal(JSON.stringify(item).includes("remote_url"), false);
});

test("public batch does not expose asset_evidence even if it carries a URL", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-asset-evidence",
    status: "active",
    uploads: [],
    artifacts: [],
    items: [{
      task_id: "task-1",
      sku: "SKU-1",
      status: "asset_confirmed",
      asset_evidence: {
        asset_id: "asset-1",
        upload_url: "https://cdn.example.com/upload?token=secret",
        remote_url: "//cdn.example.com/signed/asset?token=secret"
      }
    }]
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/batches/batch-asset-evidence",
    headers: headers(session)
  });

  assert.equal(response.statusCode, 200);
  const item = response.json().batch.items[0];
  assert.equal("asset_evidence" in item, false);
  assert.equal(JSON.stringify(item).includes("cdn.example.com"), false);
  assert.equal(JSON.stringify(item).includes("token=secret"), false);
});

test("accepts token-only localhost RPA callbacks while other POST routes require a session", async (t) => {
  const { app, root } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const { batchId, task } = await createRpaCallbackTask(root);

  const callback = await app.inject({
    method: "POST",
    url: "/api/rpa/callback",
    headers: {
      host: HOST,
      "content-type": "application/json",
      "x-rpa-callback-token": "token-1"
    },
    payload: rpaCallbackPayload({ batchId, task })
  });
  const protectedPost = await app.inject({
    method: "POST",
    url: "/api/batches",
    headers: { host: HOST, origin: ORIGIN, "content-type": "application/json" },
    payload: { batchId: "session-still-required" }
  });

  assert.equal(callback.statusCode, 200);
  assert.equal(callback.json().ok, true);
  assert.equal((await readRpaState(path.join(root, "batches", batchId), task.task_id)).status, "submitted");
  assert.equal(protectedPost.statusCode, 403);
  assert.equal(protectedPost.json().error, "SESSION_PROOF_REQUIRED");
});

test("returns client errors for invalid RPA callbacks and rejects unsafe artifacts", async (t) => {
  const { app, root } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const { batchId, task } = await createRpaCallbackTask(root);
  const callbackHeaders = {
    host: HOST,
    "content-type": "application/json",
    "x-rpa-callback-token": "token-1"
  };
  const unsafeArtifact = await app.inject({
    method: "POST",
    url: "/api/rpa/callback",
    headers: callbackHeaders,
    payload: rpaCallbackPayload({ batchId, task, artifact: { relative_path: "/tmp/outside.mp4" } })
  });
  const invalidToken = await app.inject({
    method: "POST",
    url: "/api/rpa/callback",
    headers: { ...callbackHeaders, "x-rpa-callback-token": "wrong-token" },
    payload: rpaCallbackPayload({ batchId, task })
  });
  const taskNotFound = await app.inject({
    method: "POST",
    url: "/api/rpa/callback",
    headers: callbackHeaders,
    payload: rpaCallbackPayload({ batchId, task: { ...task, task_id: "missing-task" } })
  });

  assert.equal(unsafeArtifact.statusCode, 400);
  assert.deepEqual(unsafeArtifact.json(), { error: "INVALID_RPA_CALLBACK" });
  assert.equal(invalidToken.statusCode, 400);
  assert.deepEqual(invalidToken.json(), { error: "INVALID_RPA_CALLBACK" });
  assert.equal(taskNotFound.statusCode, 404);
  assert.deepEqual(taskNotFound.json(), { error: "TASK_NOT_FOUND" });
  assert.equal((await readRpaState(path.join(root, "batches", batchId), task.task_id)).status, "asset_confirmed");
});

test("creates and lists server-owned batches without accepting disk paths", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const batch = await createBatch(app, session, "batch-one");
  const list = await app.inject({ method: "GET", url: "/api/batches", headers: { host: HOST } });
  const rejected = await app.inject({
    method: "POST", url: "/api/batches", headers: headers(session),
    payload: { batchId: "batch-two", root: "/tmp/not-allowed" }
  });

  assert.equal(batch.batch_id, "batch-one");
  assert.deepEqual(list.json().batches.map((item) => item.batch_id), ["batch-one"]);
  assert.equal(rejected.statusCode, 400);
});

test("creates batches with person and script strategies", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/batches",
    headers: headers(session),
    payload: {
      batchId: "batch-strategies",
      person_strategy: "hifly_recommended",
      script_strategy: "mixed"
    }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().batch.person_strategy, "hifly_recommended");
  assert.equal(response.json().batch.script_strategy, "mixed");
  assert.equal(response.json().batch.fixed_person_image_artifact_id, null);
});

test("creates batches with capture enabled", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/batches",
    headers: headers(session),
    payload: {
      batchId: "batch-capture-enabled",
      capture: { enabled: true }
    }
  });

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().batch.capture.enabled, true);
  assert.equal(response.json().batch.capture.status, "not_started");
  assert.match(response.json().batch.capture.updated_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("rejects fixed person artifact IDs supplied during batch creation", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/batches",
    headers: headers(session),
    payload: {
      batchId: "batch-forged-person-artifact",
      person_strategy: "fixed_upload",
      fixed_person_image_artifact_id: "artifact-person-1"
    }
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "INVALID_BATCH");
});

test("rejects invalid batch strategy values", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/batches",
    headers: headers(session),
    payload: {
      batchId: "batch-invalid-strategies",
      person_strategy: "surprise",
      script_strategy: "robot"
    }
  });

  assert.equal(response.statusCode, 400);
});

test("rejects supplied non-string and empty batch strategy values", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  for (const payload of [
    { person_strategy: false },
    { person_strategy: 0 },
    { person_strategy: "" },
    { script_strategy: false },
    { script_strategy: 0 },
    { script_strategy: "" }
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/batches",
      headers: headers(session),
      payload
    });

    assert.equal(response.statusCode, 400);
  }
});

test("exposes strategy defaults for legacy batches", async (t) => {
  const { app, root } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({ batch_id: "batch-legacy-strategies", status: "needs_input", items: [], uploads: [] });

  const response = await app.inject({ method: "GET", url: "/api/batches/batch-legacy-strategies", headers: { host: HOST } });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().batch.person_strategy, "auto_pool");
  assert.equal(response.json().batch.script_strategy, "mixed");
  assert.equal(response.json().batch.fixed_person_image_artifact_id, null);
});

test("imports a server-stored table and image without accepting source paths", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const batch = await importOne(app, session, "batch-import");

  assert.equal(batch.items.length, 1);
  assert.equal(batch.items[0].product_image_artifact_id.length > 0, true);
  assert.equal("image_path" in batch.items[0], false);
});

test("preserves capture option through multipart imports", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const created = await app.inject({
    method: "POST",
    url: "/api/batches",
    headers: headers(session),
    payload: { batchId: "batch-import-capture", capture: { enabled: true } }
  });
  assert.equal(created.statusCode, 201);

  const response = await importInto(app, session, "batch-import-capture", "SKU-1.png", {
    capture_enabled: "true"
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().batch.capture.enabled, true);
  assert.equal(response.json().batch.capture.status, "not_started");
});

test("persists scripts and strategies from single and bulk import payloads", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  await createBatch(app, session, "batch-single-script");
  const single = await importInto(app, session, "batch-single-script", "SKU-1.png", {
    person_strategy: "hifly_recommended",
    script_strategy: "provided_script"
  }, "单条口播文案");
  await createBatch(app, session, "batch-bulk-script");
  const imageOne = await pngBuffer();
  const imageTwo = await pngBuffer();
  const form = multipart([
    { name: "batchId", value: "batch-bulk-script" },
    { name: "person_strategy", value: "auto_pool" },
    { name: "script_strategy", value: "mixed" },
    {
      name: "files", filename: "products.csv", contentType: "text/csv",
      value: "sku,product_name,selling_points,category,image_path,script\nSKU-1,Alpha,Useful,beauty,SKU-1.png,批量口播一\nSKU-2,Beta,Useful,toy,SKU-2.png,批量口播二\n"
    },
    { name: "files", filename: "SKU-1.png", contentType: "image/png", value: imageOne },
    { name: "files", filename: "SKU-2.png", contentType: "image/png", value: imageTwo }
  ]);
  const bulk = await app.inject({
    method: "POST", url: "/api/imports",
    headers: headers(session, { "content-type": `multipart/form-data; boundary=${form.boundary}` }),
    payload: form.body
  });

  assert.equal(single.statusCode, 200);
  assert.equal(single.json().batch.person_strategy, "hifly_recommended");
  assert.equal(single.json().batch.script_strategy, "provided_script");
  assert.equal(single.json().batch.items[0].script, "单条口播文案");
  assert.equal(bulk.statusCode, 200);
  assert.equal(bulk.json().batch.person_strategy, "auto_pool");
  assert.equal(bulk.json().batch.script_strategy, "mixed");
  assert.deepEqual(bulk.json().batch.items.map((item) => item.script), ["批量口播一", "批量口播二"]);
});

test("binds one fixed person image uploaded with a fixed-upload import", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await createBatch(app, session, "batch-fixed-person");
  const product = await pngBuffer();
  const fixed = await pngBuffer();
  const form = multipart([
    { name: "batchId", value: "batch-fixed-person" },
    { name: "person_strategy", value: "fixed_upload" },
    { name: "fixed_person_file", filename: "person.png", contentType: "image/png", value: fixed },
    { name: "files", filename: "products.csv", contentType: "text/csv", value: "sku,product_name,selling_points,category,image_path\nSKU-1,Alpha,Useful,beauty,SKU-1.png\n" },
    { name: "files", filename: "SKU-1.png", contentType: "image/png", value: product }
  ]);
  const imported = await app.inject({
    method: "POST", url: "/api/imports",
    headers: headers(session, { "content-type": `multipart/form-data; boundary=${form.boundary}` }),
    payload: form.body
  });

  assert.equal(imported.statusCode, 200);
  const batch = imported.json().batch;
  assert.equal(batch.person_strategy, "fixed_upload");
  assert.equal(batch.fixed_person_image_artifact_id.length > 0, true);
  assert.equal(batch.uploads.find((upload) => upload.artifact_id === batch.fixed_person_image_artifact_id).kind, "image");
});

test("requires a fixed person image for fixed-upload imports", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await app.inject({
    method: "POST",
    url: "/api/batches",
    headers: headers(session),
    payload: { batchId: "batch-fixed-person-required", person_strategy: "fixed_upload" }
  });

  const response = await importInto(app, session, "batch-fixed-person-required");

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "FIXED_PERSON_FILE_REQUIRED");
});

test("does not let a forged stored fixed person artifact bypass upload", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-forged-fixed-person",
    status: "needs_input",
    items: [],
    uploads: [],
    person_strategy: "fixed_upload",
    script_strategy: "mixed",
    fixed_person_image_artifact_id: "artifact-forged"
  });

  const response = await importInto(app, session, "batch-forged-fixed-person");

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "FIXED_PERSON_FILE_REQUIRED");
});

test("rejects multiple fixed person files", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await createBatch(app, session, "batch-multiple-fixed-persons");
  const first = await pngBuffer();
  const second = await pngBuffer();
  const form = multipart([
    { name: "batchId", value: "batch-multiple-fixed-persons" },
    { name: "person_strategy", value: "fixed_upload" },
    { name: "fixed_person_file", filename: "person-one.png", contentType: "image/png", value: first },
    { name: "fixed_person_file", filename: "person-two.png", contentType: "image/png", value: second }
  ]);
  const response = await app.inject({
    method: "POST", url: "/api/imports",
    headers: headers(session, { "content-type": `multipart/form-data; boundary=${form.boundary}` }),
    payload: form.body
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "EXACTLY_ONE_FIXED_PERSON_FILE");
});

test("rejects non-image fixed person files", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await createBatch(app, session, "batch-invalid-fixed-person");
  const form = multipart([
    { name: "batchId", value: "batch-invalid-fixed-person" },
    { name: "person_strategy", value: "fixed_upload" },
    { name: "fixed_person_file", filename: "person.csv", contentType: "text/csv", value: "name\nnot-an-image\n" }
  ]);
  const response = await app.inject({
    method: "POST", url: "/api/imports",
    headers: headers(session, { "content-type": `multipart/form-data; boundary=${form.boundary}` }),
    payload: form.body
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "FIXED_PERSON_FILE_MUST_BE_IMAGE");
});

test("rejects fixed person files outside the fixed-upload strategy", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await createBatch(app, session, "batch-fixed-person-conflict");
  const product = await pngBuffer();
  const fixed = await pngBuffer();
  const form = multipart([
    { name: "batchId", value: "batch-fixed-person-conflict" },
    { name: "person_strategy", value: "auto_pool" },
    { name: "files", filename: "products.csv", contentType: "text/csv", value: "sku,product_name,selling_points,category,image_path\nSKU-1,Alpha,Useful,beauty,SKU-1.png\n" },
    { name: "fixed_person_file", filename: "person.png", contentType: "image/png", value: fixed },
    { name: "files", filename: "SKU-1.png", contentType: "image/png", value: product }
  ]);
  const response = await app.inject({
    method: "POST", url: "/api/imports",
    headers: headers(session, { "content-type": `multipart/form-data; boundary=${form.boundary}` }),
    payload: form.body
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "FIXED_PERSON_FILE_REQUIRES_FIXED_UPLOAD");
});

test("preserves batch strategies through multipart imports", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const created = await app.inject({
    method: "POST",
    url: "/api/batches",
    headers: headers(session),
    payload: {
      batchId: "batch-import-strategies",
      person_strategy: "hifly_recommended",
      script_strategy: "mixed"
    }
  });
  assert.equal(created.statusCode, 201);

  const response = await importInto(app, session, "batch-import-strategies", "SKU-1.png", {
    person_strategy: "hifly_recommended",
    script_strategy: "provided_script"
  }, "策略校验口播文案");

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().batch.person_strategy, "hifly_recommended");
  assert.equal(response.json().batch.script_strategy, "provided_script");
  assert.equal(response.json().batch.fixed_person_image_artifact_id, null);
});

test("rejects a provided-script batch with an empty imported script before it becomes pending", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const created = await app.inject({
    method: "POST",
    url: "/api/batches",
    headers: headers(session),
    payload: {
      batchId: "batch-import-creation-strategies",
      person_strategy: "hifly_recommended",
      script_strategy: "provided_script"
    }
  });
  assert.equal(created.statusCode, 201);

  const response = await importInto(app, session, "batch-import-creation-strategies");

  assert.equal(response.statusCode, 422);
  assert.equal(response.json().errors[0].code, "SCRIPT_REQUIRED");
  const batch = await app.inject({
    method: "GET",
    url: "/api/batches/batch-import-creation-strategies",
    headers: { host: HOST }
  });
  assert.equal(batch.json().batch.status, "needs_input");
  assert.deepEqual(batch.json().batch.items, []);
});

test("rejects invalid multipart strategy metadata", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await createBatch(app, session, "batch-invalid-import-strategies");

  const response = await importInto(app, session, "batch-invalid-import-strategies", "SKU-1.png", {
    person_strategy: ""
  });

  assert.equal(response.statusCode, 400);
});

test("rejects customer-provided person image paths during API import", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await createBatch(app, session, "batch-person-path");
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
  const form = multipart([
    { name: "batchId", value: "batch-person-path" },
    {
      name: "files", filename: "products.csv", contentType: "text/csv",
      value: "sku,product_name,selling_points,category,image_path,person_image_path\nSKU-1,Alpha,Useful,beauty,SKU-1.png,/private/tmp/secret.png\n"
    },
    { name: "files", filename: "SKU-1.png", contentType: "image/png", value: image }
  ]);

  const response = await app.inject({
    method: "POST", url: "/api/imports",
    headers: headers(session, { "content-type": `multipart/form-data; boundary=${form.boundary}` }),
    payload: form.body
  });
  const batch = await app.inject({ method: "GET", url: "/api/batches/batch-person-path", headers: { host: HOST } });

  assert.equal(response.statusCode, 422);
  assert.equal(response.json().errors[0].code, "PERSON_IMAGE_PATH_NOT_ALLOWED");
  assert.equal(batch.json().batch.items.length, 0);
});

test("failed duplicate imports do not mutate uploads or artifact manifests", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const imported = await importOne(app, session, "batch-import");
  const uploadDirectory = path.join(root, "batches", "batch-import", "uploads");
  const filesBefore = (await readdir(uploadDirectory)).sort();

  const duplicate = await importInto(app, session, "batch-import", "SKU-1-duplicate.png");
  const after = await app.inject({ method: "GET", url: "/api/batches/batch-import", headers: { host: HOST } });
  const filesAfter = (await readdir(uploadDirectory)).sort();

  assert.equal(duplicate.statusCode, 409);
  assert.equal(after.json().batch.uploads.length, imported.uploads.length);
  assert.equal(after.json().batch.artifacts.length, imported.artifacts.length);
  assert.deepEqual(filesAfter, filesBefore);
});

test("rejects duplicate execution keys before any second execution can start", async (t) => {
  const { app, root, session, executor } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await importOne(app, session, "batch-one");

  const first = await app.inject({
    method: "POST", url: "/api/executions", headers: headers(session),
    payload: { batchId: "batch-one", idempotencyKey: "execution-1", confirm: true }
  });
  const second = await app.inject({
    method: "POST", url: "/api/executions", headers: headers(session),
    payload: { batchId: "batch-one", idempotencyKey: "execution-1", confirm: true }
  });

  assert.equal(first.statusCode, 202);
  assert.equal(second.statusCode, 409);
});

test("execution responses and batch reads redact local snapshot paths", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await importOne(app, session, "batch-redact");

  const execution = await app.inject({
    method: "POST", url: "/api/executions", headers: headers(session),
    payload: { batchId: "batch-redact", idempotencyKey: "execution-1", confirm: true }
  });
  const batchRead = await app.inject({ method: "GET", url: "/api/batches/batch-redact", headers: { host: HOST } });

  assert.equal(execution.statusCode, 202);
  assert.equal(JSON.stringify(execution.json()).includes(root), false);
  assert.equal(JSON.stringify(batchRead.json()).includes(root), false);
});

// --- CI-002: original user path regression (GET polling) ----------------------
// The real GUI/API path polls GET /api/batches/:batchId until the batch reaches a
// terminal state. This regression keeps that path under test alongside the new
// completion-API boundary. It asserts STRICT completed + capture.recorded, never
// tolerates interrupted_unknown, and never widens the timeout. On any failure it
// dumps the full observed status timeline (with timestamps) plus the persisted
// item/batch/capture status, execution_error and any transition provenance.

test("capture execution observed via the original GET polling user path reaches completed + recorded", async (t) => {
  const { app, root, session } = await fixture(createFakeExecutor(), {
    executorFactory: ({ recordHarPath }) => {
      const executor = createFakeExecutor();
      executor.close = async () => {
        await mkdir(path.dirname(path.join(root, recordHarPath)), { recursive: true });
        await writeFile(path.join(root, recordHarPath), "{\"log\":{\"entries\":[]}}\n");
      };
      return executor;
    }
  });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const created = await app.inject({
    method: "POST", url: "/api/batches", headers: headers(session),
    payload: { batchId: "batch-capture-poll", capture: { enabled: true } }
  });
  assert.equal(created.statusCode, 201);
  await importInto(app, session, "batch-capture-poll", "SKU-1.png", { capture_enabled: "true" });

  const execution = await app.inject({
    method: "POST", url: "/api/executions", headers: headers(session),
    payload: { batchId: "batch-capture-poll", idempotencyKey: "execution-poll", confirm: true }
  });
  assert.equal(execution.statusCode, 202);

  // Poll the REAL user path: periodic GET /api/batches/:batchId. setTimeout(0)
  // yields a macrotask each cycle (fair scheduling, not a real-time sleep), so the
  // runBatch microtask chain is never starved. Record every observation.
  const timeline = [];
  const startedAt = Date.now();
  const deadline = startedAt + 5000; // the existing 5s budget — NOT widened
  let observed = null;
  for (;;) {
    const response = await app.inject({
      method: "GET", url: "/api/batches/batch-capture-poll", headers: headers(session)
    });
    assert.equal(response.statusCode, 200);
    observed = response.json().batch;
    timeline.push({
      at: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      batch: observed.status,
      capture: observed.capture?.status ?? null,
      items: (observed.items ?? []).map((item) => item.status)
    });
    if (observed.status === "completed" && observed.capture?.status === "recorded") break;
    if (Date.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const store = createBatchStore(path.join(root, "batches"));
  const persisted = await store.read("batch-capture-poll").catch(() => null);
  const diagnostics = () => JSON.stringify({
    timeline,
    finalObserved: observed && {
      batch: observed.status,
      capture: observed.capture?.status,
      execution_error: observed.execution_error ?? null,
      items: (observed.items ?? []).map((item) => item.status)
    },
    persisted: persisted && {
      batch: persisted.status,
      capture: persisted.capture?.status ?? null,
      execution_error: persisted.execution_error ?? null,
      items: (persisted.items ?? []).map((item) => item.status)
    }
  }, null, 2);

  // STRICT assertions: exactly completed + recorded, never interrupted_unknown.
  assert.equal(observed.status, "completed", `original polling path must reach completed.\n${diagnostics()}`);
  assert.equal(observed.capture?.status, "recorded", `original polling path must reach capture recorded.\n${diagnostics()}`);
  assert.equal(
    (observed.items ?? []).some((item) => item.status === "interrupted_unknown"), false,
    `interrupted_unknown is never an acceptable outcome.\n${diagnostics()}`
  );
});

test("original GET polling path still reaches completed + recorded when the writer's rename is contended (snapshot reader avoids the file-handle race)", async (t) => {
  // Owner scenario (5): the Windows flake came from polling readers opening
  // batch.json while the writer retried a contended rename. With GET served by the
  // committed snapshot (readCommitted), polling completes even when every writer
  // rename is contended several times — no interrupted_unknown, completed + recorded.
  // The rename fault is INJECTED (zero-time backoff), so this is deterministic and
  // does not depend on a real file lock on the host.
  const realRename = (await import("node:fs/promises")).rename;
  let renameCalls = 0;
  let failedRenames = 0;
  const renameImpl = async (...args) => {
    renameCalls += 1;
    // Fail ~2 of every 3 renames to simulate AV / Search-indexer contention, then
    // let the retry succeed within the RENAME_MAX_RETRIES budget (each individual
    // rename retries on consecutive call numbers, so it clears within <=3 attempts).
    if (renameCalls % 3 !== 0) {
      failedRenames += 1;
      const error = new Error("simulated EPERM on rename");
      error.code = "EPERM";
      throw error;
    }
    return realRename(...args);
  };
  const { app, root, session } = await fixture(createFakeExecutor(), {
    executorFactory: ({ recordHarPath }) => {
      const executor = createFakeExecutor();
      executor.close = async () => {
        await mkdir(path.dirname(path.join(root, recordHarPath)), { recursive: true });
        await writeFile(path.join(root, recordHarPath), "{\"log\":{\"entries\":[]}}\n");
      };
      return executor;
    },
    storeOptions: { delay: () => Promise.resolve(), renameImpl }
  });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const created = await app.inject({
    method: "POST", url: "/api/batches", headers: headers(session),
    payload: { batchId: "batch-capture-poll-fault", capture: { enabled: true } }
  });
  assert.equal(created.statusCode, 201);
  await importInto(app, session, "batch-capture-poll-fault", "SKU-1.png", { capture_enabled: "true" });

  const execution = await app.inject({
    method: "POST", url: "/api/executions", headers: headers(session),
    payload: { batchId: "batch-capture-poll-fault", idempotencyKey: "execution-poll-fault", confirm: true }
  });
  assert.equal(execution.statusCode, 202);

  // Poll the REAL user path under rename contention. The reader takes the snapshot,
  // so it never opens batch.json and never compounds the writer's retry window.
  const timeline = [];
  const startedAt = Date.now();
  const deadline = startedAt + 5000; // the existing 5s budget — NOT widened
  let observed = null;
  for (;;) {
    const response = await app.inject({
      method: "GET", url: "/api/batches/batch-capture-poll-fault", headers: headers(session)
    });
    assert.equal(response.statusCode, 200);
    observed = response.json().batch;
    timeline.push({
      elapsedMs: Date.now() - startedAt,
      batch: observed.status,
      capture: observed.capture?.status ?? null,
      items: (observed.items ?? []).map((item) => item.status)
    });
    if (observed.status === "completed" && observed.capture?.status === "recorded") break;
    if (Date.now() > deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  const diagnostics = () => JSON.stringify({
    timeline,
    renameCalls,
    failedRenames,
    finalObserved: observed && {
      batch: observed.status,
      capture: observed.capture?.status,
      execution_error: observed.execution_error ?? null,
      items: (observed.items ?? []).map((item) => item.status)
    }
  }, null, 2);

  assert.ok(failedRenames > 0, `the rename fault was actually exercised.\n${diagnostics()}`);
  assert.equal(observed.status, "completed", `polling under rename contention must still reach completed.\n${diagnostics()}`);
  assert.equal(observed.capture?.status, "recorded", `polling under rename contention must still reach capture recorded.\n${diagnostics()}`);
  assert.equal(
    (observed.items ?? []).some((item) => item.status === "interrupted_unknown"), false,
    `interrupted_unknown is never an acceptable outcome.\n${diagnostics()}`
  );
});

test("capture-enabled executions use a per-run HAR executor and mark capture recorded", async (t) => {
  const factoryCalls = [];
  const { app, root, session } = await fixture(createFakeExecutor(), {
    executorFactory: ({ recordHarPath }) => {
      factoryCalls.push(recordHarPath);
      const executor = createFakeExecutor();
      executor.close = async () => {
        await mkdir(path.dirname(path.join(root, recordHarPath)), { recursive: true });
        await writeFile(path.join(root, recordHarPath), "{\"log\":{\"entries\":[]}}\n");
      };
      return executor;
    }
  });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const created = await app.inject({
    method: "POST",
    url: "/api/batches",
    headers: headers(session),
    payload: { batchId: "batch-capture-run", capture: { enabled: true } }
  });
  assert.equal(created.statusCode, 201);
  await importInto(app, session, "batch-capture-run", "SKU-1.png", { capture_enabled: "true" });

  const execution = await app.inject({
    method: "POST",
    url: "/api/executions",
    headers: headers(session),
    payload: { batchId: "batch-capture-run", idempotencyKey: "execution-capture", confirm: true }
  });
  assert.equal(execution.statusCode, 202);
  const executionId = execution.json().executionId;

  // Await the terminal-completion boundary instead of polling two independently
  // persisted states. wait resolves only after runBatch finished AND the capture
  // executor was closed (HAR flushed) AND the terminal state was persisted.
  const settled = await app.inject({
    method: "GET",
    url: `/api/executions/batch-capture-run/${executionId}/wait`,
    headers: headers(session)
  });
  assert.equal(settled.statusCode, 200);
  const batch = settled.json().batch;

  assert.equal(factoryCalls.length, 1);
  assert.match(factoryCalls[0], /^rpa\/capture\/raw\/batch-capture-run-/);
  assert.equal(batch.status, "completed");
  assert.equal(batch.capture.enabled, true);
  assert.equal(batch.capture.status, "recorded");
  assert.equal(batch.capture.har_path, "[local raw capture]");
});

// --- CI-002: deterministic capture/shutdown lifecycle tests -----------------
// These tests reproduce completion/shutdown races with deferred barriers (NOT
// real-time sleeps) so each scenario has exactly one correct observable outcome.

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Build a capture-enabled app whose per-run executor close() is gated on a
// deferred barrier, then start an execution. Returns handles to drive the race.
async function captureExecutionFixture(t, { close } = {}) {
  const harFlushed = { value: false };
  const { app, root, session } = await fixture(createFakeExecutor(), {
    executorFactory: ({ recordHarPath }) => {
      const executor = createFakeExecutor();
      executor.close = async () => {
        await close?.({ root, recordHarPath });
        harFlushed.value = true;
      };
      return executor;
    }
  });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const created = await app.inject({
    method: "POST",
    url: "/api/batches",
    headers: headers(session),
    payload: { batchId: "batch-capture-run", capture: { enabled: true } }
  });
  assert.equal(created.statusCode, 201);
  await importInto(app, session, "batch-capture-run", "SKU-1.png", { capture_enabled: "true" });
  return { app, root, session, harFlushed };
}

async function startCaptureExecution(app, session) {
  const execution = await app.inject({
    method: "POST",
    url: "/api/executions",
    headers: headers(session),
    payload: { batchId: "batch-capture-run", idempotencyKey: "execution-capture", confirm: true }
  });
  assert.equal(execution.statusCode, 202);
  return execution.json().executionId;
}

async function writeHar(root, recordHarPath) {
  await mkdir(path.dirname(path.join(root, recordHarPath)), { recursive: true });
  await writeFile(path.join(root, recordHarPath), "{\"log\":{\"entries\":[]}}\n");
}

test("capture execution completes then server closes deterministically", async (t) => {
  const { app, root, session } = await captureExecutionFixture(t, {
    close: ({ root: r, recordHarPath }) => writeHar(r, recordHarPath)
  });
  const executionId = await startCaptureExecution(app, session);

  const settled = await app.inject({
    method: "GET",
    url: `/api/executions/batch-capture-run/${executionId}/wait`,
    headers: headers(session)
  });
  assert.equal(settled.statusCode, 200);
  assert.equal(settled.json().batch.status, "completed");
  assert.equal(settled.json().batch.capture.status, "recorded");

  // After the terminal boundary, closing the server must not disturb the
  // persisted terminal state (no flip back to recording / pending).
  await app.close();
  const store = createBatchStore(path.join(root, "batches"));
  const persisted = await store.read("batch-capture-run");
  assert.equal(persisted.status, "completed");
  assert.equal(persisted.capture.status, "recorded");
  assert.equal(persisted.items.every((item) => item.status === "completed"), true);
});

test("capture wait boundary blocks across a slow executor close", async (t) => {
  const closeGate = deferred();
  const closeStarted = deferred();
  const { app, session, harFlushed } = await captureExecutionFixture(t, {
    close: async ({ root: r, recordHarPath }) => {
      closeStarted.resolve();
      await closeGate.promise;
      await writeHar(r, recordHarPath);
    }
  });
  const executionId = await startCaptureExecution(app, session);

  // Issue wait first; it must block until the HAR flush completes. Wait until
  // the executor close (HAR flush) has actually started, then confirm wait has
  // not resolved early, then release the gate.
  const waitReturned = { early: false };
  const waitPromise = app.inject({
    method: "GET",
    url: `/api/executions/batch-capture-run/${executionId}/wait`,
    headers: headers(session)
  }).then((response) => {
    waitReturned.early = true;
    return response;
  });
  await closeStarted.promise;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(waitReturned.early, false, "wait must not resolve before the HAR flush completes");

  closeGate.resolve();
  const settled = await waitPromise;
  assert.equal(settled.statusCode, 200);
  assert.equal(settled.json().batch.capture.status, "recorded");
  assert.equal(harFlushed.value, true);
});

test("capture wait boundary blocks across a slow HAR flush", async (t) => {
  const flushGate = deferred();
  const closeStarted = deferred();
  const { app, session } = await captureExecutionFixture(t, {
    close: async ({ root: r, recordHarPath }) => {
      // close() is only called after runBatch returned, i.e. after every item
      // already reached "completed". So being inside close() with the flush
      // gated IS the deterministic "item completed but HAR not yet flushed"
      // window — no polling of that intermediate state is required.
      closeStarted.resolve();
      await flushGate.promise; // the HAR write itself is the slow step
      await writeHar(r, recordHarPath);
    }
  });
  const executionId = await startCaptureExecution(app, session);

  // Wait until the HAR flush has deterministically started (=> item completed,
  // capture still recording), then confirm wait blocks across it.
  await closeStarted.promise;
  const waitReturned = { early: false };
  const waitPromise = app.inject({
    method: "GET",
    url: `/api/executions/batch-capture-run/${executionId}/wait`,
    headers: headers(session)
  }).then((response) => {
    waitReturned.early = true;
    return response;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(waitReturned.early, false, "wait must not resolve before the HAR flush completes");

  flushGate.resolve();
  const settled = await waitPromise;
  assert.equal(settled.statusCode, 200);
  assert.equal(settled.json().batch.status, "completed");
  assert.equal(settled.json().batch.capture.status, "recorded");
});

test("server close racing completion still records capture", async (t) => {
  const closeGate = deferred();
  const closeStarted = deferred();
  const { app, root, session } = await captureExecutionFixture(t, {
    close: async ({ root: r, recordHarPath }) => {
      closeStarted.resolve();
      await closeGate.promise;
      await writeHar(r, recordHarPath);
    }
  });
  await startCaptureExecution(app, session);

  // Wait until the executor close (HAR flush) has started, then close the
  // server concurrently with the completion boundary. app.close() awaits the
  // terminal boundary, so the capture is fully recorded once close returns.
  await closeStarted.promise;
  const closePromise = app.close();
  closeGate.resolve();
  await closePromise;

  const store = createBatchStore(path.join(root, "batches"));
  const persisted = await store.read("batch-capture-run");
  assert.equal(persisted.status, "completed");
  assert.equal(persisted.capture.status, "recorded");
  assert.equal(persisted.items.every((item) => item.status === "completed"), true);
});

test("a completed item is never overwritten back to interrupted_unknown", async (t) => {
  const { app, root, session } = await captureExecutionFixture(t, {
    close: ({ root: r, recordHarPath }) => writeHar(r, recordHarPath)
  });
  const executionId = await startCaptureExecution(app, session);
  await app.inject({
    method: "GET",
    url: `/api/executions/batch-capture-run/${executionId}/wait`,
    headers: headers(session)
  });

  const store = createBatchStore(path.join(root, "batches"));
  const persisted = await store.read("batch-capture-run");
  assert.equal(persisted.items.every((item) => item.status === "completed"), true);
  // The completed terminal state has no outgoing transition: it cannot be
  // reverted to interrupted_unknown (or any non-terminal state) afterwards.
  assert.equal(persisted.items.some((item) => item.status === "interrupted_unknown"), false);
  assert.equal(persisted.status, "completed");
});

// --- CI-002: completion API identity contract --------------------------------
// GET /api/executions/:batchId/:executionId/wait binds executionId to batchId and
// verifies it against the persisted execution snapshot. An unknown or mismatched
// id returns 404 EXECUTION_NOT_FOUND (never falls back to treating the id as a
// batchId). A settled execution resolves via the snapshot, including after a
// server restart, and the in-memory registry does not grow without bound.

test("completion API resolves an active then a settled execution via the persisted snapshot", async (t) => {
  const { app, session } = await captureExecutionFixture(t, {
    close: ({ root: r, recordHarPath }) => writeHar(r, recordHarPath)
  });
  const executionId = await startCaptureExecution(app, session);

  // Await the terminal boundary (this covers the active-execution path).
  const settled = await app.inject({
    method: "GET",
    url: `/api/executions/batch-capture-run/${executionId}/wait`,
    headers: headers(session)
  });
  assert.equal(settled.statusCode, 200);
  assert.equal(settled.json().batch.capture.status, "recorded");

  // After settle there is no in-flight handle: a second wait must still resolve
  // (via the persisted execution snapshot) and return the same terminal snapshot.
  const again = await app.inject({
    method: "GET",
    url: `/api/executions/batch-capture-run/${executionId}/wait`,
    headers: headers(session)
  });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().batch.status, "completed");
  assert.equal(again.json().batch.capture.status, "recorded");
  // The returned executionId is the opaque snapshot key, not the caller's idempotencyKey.
  assert.notEqual(executionId, "execution-capture");
});

test("completion API returns 404 EXECUTION_NOT_FOUND for an unknown executionId", async (t) => {
  const { app, session } = await captureExecutionFixture(t, {
    close: ({ root: r, recordHarPath }) => writeHar(r, recordHarPath)
  });
  const executionId = await startCaptureExecution(app, session);
  await app.inject({
    method: "GET",
    url: `/api/executions/batch-capture-run/${executionId}/wait`,
    headers: headers(session)
  });

  const unknown = await app.inject({
    method: "GET",
    url: `/api/executions/batch-capture-run/never-ran/wait`,
    headers: headers(session)
  });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.json().error, "EXECUTION_NOT_FOUND");
});

test("completion API returns 404 when the executionId does not belong to the batch", async (t) => {
  const { app, session } = await captureExecutionFixture(t, {
    close: ({ root: r, recordHarPath }) => writeHar(r, recordHarPath)
  });
  const executionId = await startCaptureExecution(app, session);
  await app.inject({
    method: "GET",
    url: `/api/executions/batch-capture-run/${executionId}/wait`,
    headers: headers(session)
  });

  // A second batch with its own execution; then ask for batch-2 with batch-1's id.
  await createBatch(app, session, "batch-capture-run-2");
  await importInto(app, session, "batch-capture-run-2", "SKU-1.png", { capture_enabled: "true" });
  const other = await app.inject({
    method: "POST", url: "/api/executions", headers: headers(session),
    payload: { batchId: "batch-capture-run-2", idempotencyKey: "execution-capture-2", confirm: true }
  });
  assert.equal(other.statusCode, 202);
  await app.inject({
    method: "GET",
    url: `/api/executions/batch-capture-run-2/${other.json().executionId}/wait`,
    headers: headers(session)
  });

  const mismatched = await app.inject({
    method: "GET",
    url: `/api/executions/batch-capture-run-2/${executionId}/wait`,
    headers: headers(session)
  });
  assert.equal(mismatched.statusCode, 404);
  assert.equal(mismatched.json().error, "EXECUTION_NOT_FOUND");
});

test("completion API resolves a settled execution after a server restart", async (t) => {
  // First server: run a capture execution to its terminal boundary.
  const first = await captureExecutionFixture(t, {
    close: ({ root: r, recordHarPath }) => writeHar(r, recordHarPath)
  });
  const executionId = await startCaptureExecution(first.app, first.session);
  const settled = await first.app.inject({
    method: "GET",
    url: `/api/executions/batch-capture-run/${executionId}/wait`,
    headers: headers(first.session)
  });
  assert.equal(settled.statusCode, 200);
  assert.equal(settled.json().batch.capture.status, "recorded");
  const root = first.root;
  await first.app.close();

  // Second server over the SAME persisted root: the in-memory registry is empty,
  // but the wait must still resolve via the persisted execution snapshot.
  const restarted = await buildApp({ root, executor: createFakeExecutor() });
  t.after(async () => { await restarted.close(); });
  const sessionResp = await restarted.inject({ method: "GET", url: "/api/session", headers: { host: HOST } });
  const session2 = { cookie: sessionResp.headers["set-cookie"].split(";")[0], token: sessionResp.json().token };

  const after = await restarted.inject({
    method: "GET",
    url: `/api/executions/batch-capture-run/${executionId}/wait`,
    headers: headers(session2)
  });
  assert.equal(after.statusCode, 200);
  assert.equal(after.json().batch.status, "completed");
  assert.equal(after.json().batch.capture.status, "recorded");
});

// --- Idempotency: bounded TTL receipt registry with capacity backpressure ----
// A key that has been accepted is protected against a second execution: an ACTIVE
// receipt never expires (long-running executions keep their protection for their
// whole lifetime); a SETTLED receipt is protected for a full TTL measured from the
// SETTLE moment (not acceptance). Capacity is enforced by BACKPRESSURE — when the
// registry is full, a new key gets 503 IDEMPOTENCY_REGISTRY_FULL rather than
// evicting an unexpired receipt (never silently lose retry protection). Restart
// idempotency is a documented known limitation (in-memory only). These tests use
// an injected clock (no real-time sleep).

async function idemFixture(t, options = {}) {
  const { app, root, session } = await fixture(createFakeExecutor(), {
    executorFactory: ({ recordHarPath }) => {
      const executor = createFakeExecutor();
      executor.close = async () => {
        await mkdir(path.dirname(path.join(root, recordHarPath)), { recursive: true });
        await writeFile(path.join(root, recordHarPath), "{\"log\":{\"entries\":[]}}\n");
      };
      return executor;
    },
    ...options
  });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  return { app, root, session };
}

async function newCaptureBatch(app, session, batchId) {
  await createBatch(app, session, batchId);
  await importInto(app, session, batchId, "SKU-1.png", { capture_enabled: "true" });
}

function startKey(app, session, batchId, idempotencyKey) {
  return app.inject({
    method: "POST", url: "/api/executions", headers: headers(session),
    payload: { batchId, idempotencyKey, confirm: true }
  });
}

function awaitSettled(app, session, batchId, executionId) {
  return app.inject({
    method: "GET", url: `/api/executions/${batchId}/${executionId}/wait`, headers: headers(session)
  });
}

test("unique idempotency keys run back-to-back without false duplicates", async (t) => {
  const { app, session } = await idemFixture(t);
  for (let i = 1; i <= 3; i += 1) {
    const batchId = `batch-idem-uniq-${i}`;
    await newCaptureBatch(app, session, batchId);
    const exec = await startKey(app, session, batchId, `key-${i}`);
    assert.equal(exec.statusCode, 202, `unique key ${i} must be accepted`);
    const settled = await awaitSettled(app, session, batchId, exec.json().executionId);
    assert.equal(settled.statusCode, 200);
    assert.equal(settled.json().batch.capture.status, "recorded");
  }
});

test("a settled idempotency key is rejected as a duplicate within its TTL", async (t) => {
  const { app, session } = await idemFixture(t);
  await newCaptureBatch(app, session, "batch-idem-a");
  const first = await startKey(app, session, "batch-idem-a", "shared-key");
  assert.equal(first.statusCode, 202);
  await awaitSettled(app, session, "batch-idem-a", first.json().executionId);
  const retry = await startKey(app, session, "batch-idem-a", "shared-key");
  assert.equal(retry.statusCode, 409);
  assert.equal(retry.json().error, "DUPLICATE_IDEMPOTENCY_KEY");
});

test("a duplicate idempotency key is rejected even against a different batch within TTL", async (t) => {
  const { app, session } = await idemFixture(t);
  await newCaptureBatch(app, session, "batch-idem-x");
  await newCaptureBatch(app, session, "batch-idem-y");
  const first = await startKey(app, session, "batch-idem-x", "cross-key");
  assert.equal(first.statusCode, 202);
  await awaitSettled(app, session, "batch-idem-x", first.json().executionId);
  const retry = await startKey(app, session, "batch-idem-y", "cross-key");
  assert.equal(retry.statusCode, 409);
  assert.equal(retry.json().error, "DUPLICATE_IDEMPOTENCY_KEY");
});

test("a settled idempotency key's protection TTL is measured from the settle moment", async (t) => {
  const clock = { t: 1000 };
  const { app, session } = await idemFixture(t, { idempotencyTtlMs: 500, now: () => clock.t });
  await newCaptureBatch(app, session, "batch-idem-ttl-1");
  await newCaptureBatch(app, session, "batch-idem-ttl-2");
  const first = await startKey(app, session, "batch-idem-ttl-1", "ttl-key");
  assert.equal(first.statusCode, 202);
  // Advance the clock during the (fast) execution — the ACTIVE receipt does not
  // expire. The execution then settles at t=1400, so expiresAt = 1400 + 500 = 1900.
  clock.t = 1400;
  await awaitSettled(app, session, "batch-idem-ttl-1", first.json().executionId);

  // Just before the settle-TTL elapses: still a duplicate.
  clock.t = 1900 - 1;
  const within = await startKey(app, session, "batch-idem-ttl-2", "ttl-key");
  assert.equal(within.statusCode, 409, "within the settle-TTL the key is still a duplicate");

  // Once the settle-TTL elapses: reusable.
  clock.t = 1900;
  const after = await startKey(app, session, "batch-idem-ttl-2", "ttl-key");
  assert.equal(after.statusCode, 202, "after the settle-TTL the key is reusable");
});

test("a full registry rejects a new key with 503 backpressure (no eviction, no executor call)", async (t) => {
  let submitCalls = 0;
  const executor = createFakeExecutor();
  executor.submitVideo = async () => {
    submitCalls += 1;
    return { status: "ready", remoteEvidence: { evidence_source: "direct_submission", remote_id: "work-1" } };
  };
  const { app, root, session } = await fixture(executor, { idempotencyMaxEntries: 2 });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  // Two executions settle, filling the registry to capacity (maxEntries=2).
  for (const [key, batchId] of [["cap-1", "batch-idem-cap-1"], ["cap-2", "batch-idem-cap-2"]]) {
    await importOne(app, session, batchId);
    const exec = await startKey(app, session, batchId, key);
    assert.equal(exec.statusCode, 202);
    await awaitSettled(app, session, batchId, exec.json().executionId);
  }
  const submitsAfterTwo = submitCalls;

  // A third unique key is rejected with 503 backpressure — the registry is full.
  await importOne(app, session, "batch-idem-cap-3");
  const third = await startKey(app, session, "batch-idem-cap-3", "cap-3");
  assert.equal(third.statusCode, 503, "registry full -> 503 backpressure");
  assert.equal(third.json().error, "IDEMPOTENCY_REGISTRY_FULL");
  assert.equal(submitCalls, submitsAfterTwo, "no executor started for the rejected key");

  // The two settled receipts were NOT evicted: their keys are still protected.
  await importOne(app, session, "batch-idem-cap-1b");
  assert.equal((await startKey(app, session, "batch-idem-cap-1b", "cap-1")).statusCode, 409, "cap-1 still protected (not evicted)");
  await importOne(app, session, "batch-idem-cap-2b");
  assert.equal((await startKey(app, session, "batch-idem-cap-2b", "cap-2")).statusCode, 409, "cap-2 still protected (not evicted)");
  assert.equal(submitCalls, submitsAfterTwo, "no executor started for the duplicate retries");
});

test("a late retry with the original idempotency key after a safe-stop is rejected without re-invoking the executor", async (t) => {
  // Points-safety regression: after a safe-stop (item back to pending), a late
  // retry with the SAME key must 409 (not start a second execution), so the
  // executor is never called again and points cannot be double-spent.
  let submitCalls = 0;
  let releaseAsset;
  let assetStarted = false;
  const executor = createFakeExecutor();
  executor.createAsset = async () => {
    assetStarted = true;
    await new Promise((resolve) => { releaseAsset = resolve; });
    return { asset_id: "asset", preview_url: null };
  };
  executor.submitVideo = async () => {
    submitCalls += 1;
    return { status: "ready", remoteEvidence: { evidence_source: "direct_submission", remote_id: "work-1" } };
  };
  const { app, root, session } = await fixture(executor);
  t.after(async () => {
    releaseAsset?.();
    await app.stopExecutions?.();
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await importOne(app, session, "batch-idem-stop");
  const first = await startKey(app, session, "batch-idem-stop", "stop-key");
  assert.equal(first.statusCode, 202);
  while (!assetStarted) await new Promise((resolve) => setImmediate(resolve));
  const stopPromise = app.stopExecutions(); // safe-stop: item -> pending, key settled (retained)
  releaseAsset();
  await stopPromise;
  assert.equal(submitCalls, 0, "stopped before any submit");

  const retry = await startKey(app, session, "batch-idem-stop", "stop-key");
  assert.equal(retry.statusCode, 409, "late retry with the same key is rejected");
  assert.equal(retry.json().error, "DUPLICATE_IDEMPOTENCY_KEY");
  assert.equal(submitCalls, 0, "no second execution -> executor not called again (no double-spend)");
});

test("a safe-stopped execution whose ACTIVE phase exceeded the TTL still rejects a same-key retry", async (t) => {
  // Active receipts never expire: even if the execution runs far longer than the
  // TTL, a same-key retry after a safe-stop must still 409 (no double-spend). This
  // covers the active-receipt-expiry hole in a TTL-from-accept design.
  const clock = { t: 0 };
  let submitCalls = 0;
  let releaseAsset;
  let assetStarted = false;
  const executor = createFakeExecutor();
  executor.createAsset = async () => {
    assetStarted = true;
    await new Promise((resolve) => { releaseAsset = resolve; });
    return { asset_id: "asset", preview_url: null };
  };
  executor.submitVideo = async () => {
    submitCalls += 1;
    return { status: "ready", remoteEvidence: { evidence_source: "direct_submission", remote_id: "work-1" } };
  };
  const { app, root, session } = await fixture(executor, { idempotencyTtlMs: 100, now: () => clock.t });
  t.after(async () => {
    releaseAsset?.();
    await app.stopExecutions?.();
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await importOne(app, session, "batch-idem-stop-ttl");
  const first = await startKey(app, session, "batch-idem-stop-ttl", "stop-ttl-key");
  assert.equal(first.statusCode, 202);
  while (!assetStarted) await new Promise((resolve) => setImmediate(resolve));
  // The execution stays ACTIVE far longer than the TTL (100ms) — it must not expire.
  clock.t = 100000;
  const stopPromise = app.stopExecutions();
  releaseAsset();
  await stopPromise; // settles at clock.t=100000 -> settled TTL expiresAt = 100100
  assert.equal(submitCalls, 0, "stopped before any submit");

  // Same-key retry at t=100000: the receipt was active (never expired) through the
  // stop and is now settled with a TTL measured from the settle moment (100100),
  // so it is still protected.
  const retry = await startKey(app, session, "batch-idem-stop-ttl", "stop-ttl-key");
  assert.equal(retry.statusCode, 409, "active-over-TTL receipt still protects after safe-stop");
  assert.equal(retry.json().error, "DUPLICATE_IDEMPOTENCY_KEY");
  assert.equal(submitCalls, 0, "no second execution -> executor not called again (no double-spend)");
});

// --- CI-002: default JSON body parser semantics (global override reverted) ----
// The wait endpoint is a body-less GET, so no global JSON parser change is needed.
// These tests pin the stock Fastify parser behaviour for every JSON API.

test("the stock JSON parser rejects malformed and empty JSON bodies with 400", async (t) => {
  const { app, root, session } = await fixture(createFakeExecutor());
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  // Well-formed JSON works.
  const ok = await app.inject({
    method: "POST", url: "/api/batches", headers: headers(session),
    payload: { batchId: "batch-json-ok" }
  });
  assert.equal(ok.statusCode, 201);

  // Malformed JSON is a 400 parse error (stock parser, not a silent 500).
  const malformed = await app.inject({
    method: "POST", url: "/api/batches",
    headers: { ...headers(session), "content-type": "application/json" },
    payload: "{not json"
  });
  assert.equal(malformed.statusCode, 400);

  // Empty body with a JSON content-type is rejected by the stock parser
  // (FST_ERR_CTP_EMPTY_JSON_BODY), proving the global tolerant override is gone.
  const empty = await app.inject({
    method: "POST", url: "/api/batches",
    headers: { ...headers(session), "content-type": "application/json" },
    payload: ""
  });
  assert.equal(empty.statusCode, 400);
});

test("the body-less completion wait endpoint accepts a GET with no JSON body", async (t) => {
  const { app, session } = await captureExecutionFixture(t, {
    close: ({ root: r, recordHarPath }) => writeHar(r, recordHarPath)
  });
  const executionId = await startCaptureExecution(app, session);
  // GET carries no body and no JSON content-type, so it must not trip the parser.
  const settled = await app.inject({
    method: "GET",
    url: `/api/executions/batch-capture-run/${executionId}/wait`,
    headers: { host: HOST, origin: ORIGIN, cookie: session.cookie, "x-local-session-token": session.token }
  });
  assert.equal(settled.statusCode, 200);
  assert.equal(settled.json().batch.capture.status, "recorded");
});

test("a genuinely interrupted execution does not mark capture recorded", async (t) => {
  // Abort mid-execution (createAsset gated). The item safe-stops to pending
  // (never interrupted_unknown), so the terminal guard must NOT write
  // capture=recorded even though the executor close flushes a HAR.
  const createAssetGate = deferred();
  const createAssetStarted = deferred();
  const harFlushed = { value: false };
  const { app, root, session } = await fixture(createFakeExecutor(), {
    executorFactory: ({ recordHarPath }) => {
      const executor = createFakeExecutor();
      const baseCreateAsset = executor.createAsset.bind(executor);
      executor.createAsset = async (task, context) => {
        createAssetStarted.resolve();
        await createAssetGate.promise;
        return baseCreateAsset(task, context);
      };
      executor.close = async () => {
        await writeHar(root, recordHarPath);
        harFlushed.value = true;
      };
      return executor;
    }
  });
  t.after(async () => {
    createAssetGate.resolve();
    await app.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  await createBatch(app, session, "batch-capture-run");
  await importInto(app, session, "batch-capture-run", "SKU-1.png", { capture_enabled: "true" });
  await startCaptureExecution(app, session);

  // Wait until the execution is in-flight and blocked at the createAsset gate,
  // then close (abort) the server before releasing the gate.
  await createAssetStarted.promise;
  const closePromise = app.close();
  createAssetGate.resolve();
  await closePromise;

  const store = createBatchStore(path.join(root, "batches"));
  const persisted = await store.read("batch-capture-run");
  assert.equal(persisted.items[0].status, "pending");
  assert.notEqual(persisted.items[0].status, "interrupted_unknown");
  // The execution was safely interrupted before completion: capture must settle to
  // the explicit terminal "recording_interrupted" (never "recorded", never stuck
  // at "recording"), with a non-sensitive error code the GUI can render.
  assert.equal(persisted.capture.status, "recording_interrupted", "interrupted execution must not mark capture recorded");
  assert.equal(persisted.capture.recording_error.code, "CAPTURE_RECORDING_INTERRUPTED");
  assert.equal(harFlushed.value, true, "close still flushed the HAR during shutdown");
});

test("a failing executor close records an explicit error and skips recorded", async (t) => {
  const { app, root, session } = await captureExecutionFixture(t, {
    close: async () => {
      throw new Error("HAR flush exploded");
    }
  });
  const executionId = await startCaptureExecution(app, session);

  const settled = await app.inject({
    method: "GET",
    url: `/api/executions/batch-capture-run/${executionId}/wait`,
    headers: headers(session)
  });
  assert.equal(settled.statusCode, 200);
  const batch = settled.json().batch;
  // The HAR never flushed, so capture must NOT be recorded; it settles to the
  // explicit terminal "recording_failed" with a non-sensitive error code, and the
  // close error is surfaced on the batch instead of being swallowed.
  assert.equal(batch.capture.status, "recording_failed");
  assert.equal(batch.capture.recording_error.code, "CAPTURE_HAR_FLUSH_FAILED");
  assert.match(String(batch.execution_error), /capture executor close failed: HAR flush exploded/);

  const store = createBatchStore(path.join(root, "batches"));
  const persisted = await store.read("batch-capture-run");
  assert.equal(persisted.capture.status, "recording_failed");
  assert.equal(persisted.capture.recording_error.code, "CAPTURE_HAR_FLUSH_FAILED");
  assert.match(String(persisted.execution_error), /capture executor close failed/);
});

test("concurrent capture executions keep per-run executors isolated", async (t) => {
  const factoryCalls = [];
  const closeCounts = new Map();
  const { app, root, session } = await fixture(createFakeExecutor(), {
    executorFactory: ({ recordHarPath }) => {
      factoryCalls.push(recordHarPath);
      const executor = createFakeExecutor();
      executor.close = async () => {
        closeCounts.set(recordHarPath, (closeCounts.get(recordHarPath) ?? 0) + 1);
        await writeHar(root, recordHarPath);
      };
      return executor;
    }
  });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  // Run two capture executions back-to-back (the coordinator serializes active
  // executions, but each must build + close its own per-run executor).
  for (const [batchId, executionKey] of [["batch-capture-run", "execution-capture-1"], ["batch-capture-run-2", "execution-capture-2"]]) {
    const created = await app.inject({
      method: "POST",
      url: "/api/batches",
      headers: headers(session),
      payload: { batchId, capture: { enabled: true } }
    });
    assert.equal(created.statusCode, 201);
    await importInto(app, session, batchId, "SKU-1.png", { capture_enabled: "true" });
    const execution = await app.inject({
      method: "POST",
      url: "/api/executions",
      headers: headers(session),
      payload: { batchId, idempotencyKey: executionKey, confirm: true }
    });
    assert.equal(execution.statusCode, 202);
    const settled = await app.inject({
      method: "GET",
      url: `/api/executions/${batchId}/${execution.json().executionId}/wait`,
      headers: headers(session)
    });
    assert.equal(settled.statusCode, 200);
    assert.equal(settled.json().batch.capture.status, "recorded");
  }

  // Each execution built exactly one per-run executor with a distinct HAR path,
  // and each per-run executor was closed exactly once (no cross-contamination).
  assert.equal(factoryCalls.length, 2);
  assert.match(factoryCalls[0], /^rpa\/capture\/raw\/batch-capture-run-/);
  assert.match(factoryCalls[1], /^rpa\/capture\/raw\/batch-capture-run-2-/);
  assert.notEqual(factoryCalls[0], factoryCalls[1]);
  assert.equal(closeCounts.get(factoryCalls[0]), 1);
  assert.equal(closeCounts.get(factoryCalls[1]), 1);
});

test("auto-pool execution resolves pool images from the generation configuration root", async (t) => {
  const configRoot = await mkdtemp(path.join(os.tmpdir(), "hifly-generation-config-"));
  const poolPath = path.join(configRoot, "assets", "person_pool", "beauty", "host.png");
  await mkdir(path.dirname(poolPath), { recursive: true });
  await writeFile(poolPath, "person-image");
  const { app, root, session } = await fixture(undefined, {
    generationConfig: {
      __rootDir: configRoot,
      behavior: { useRecommendedPersonWhenMissing: false },
      personPool: {
        enabled: true,
        rootDir: "assets/person_pool",
        defaultCategory: "default",
        fallbackToRecommended: false
      }
    }
  });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
    await rm(configRoot, { recursive: true, force: true });
  });
  await importOne(app, session, "batch-auto-pool-root");

  const response = await app.inject({
    method: "POST", url: "/api/executions", headers: headers(session),
    payload: { batchId: "batch-auto-pool-root", idempotencyKey: "execution-auto-pool", confirm: true }
  });

  assert.equal(response.statusCode, 202);
});

test("batch reads redact internal fixed-person paths", async (t) => {
  const { app, root } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const internalPath = path.join(root, "batches", "batch-fixed-person-private", "uploads", "person.png");
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-fixed-person-private",
    status: "pending",
    items: [{
      task_id: "task-1",
      sku: "SKU-1",
      status: "pending",
      __resolved_person_image_path: internalPath,
      resolved_person_image_path: internalPath,
      resolved_person_source: "fixed_upload"
    }]
  });

  const response = await app.inject({
    method: "GET", url: "/api/batches/batch-fixed-person-private", headers: { host: HOST }
  });
  const item = response.json().batch.items[0];

  assert.equal(response.statusCode, 200);
  assert.equal("__resolved_person_image_path" in item, false);
  assert.equal("resolved_person_image_path" in item, false);
  assert.equal(JSON.stringify(response.json()).includes(internalPath), false);
});

test("server stop waits for execution preparation before returning", async (t) => {
  let unblock;
  const executor = createFakeExecutor();
  executor.createAsset = async () => {
    await new Promise((resolve) => { unblock = resolve; });
    return { asset_id: "asset", preview_url: null };
  };
  const { app, root, session } = await fixture(executor);
  t.after(async () => {
    unblock?.();
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await importOne(app, session, "batch-stop");

  const started = app.inject({
    method: "POST", url: "/api/executions", headers: headers(session),
    payload: { batchId: "batch-stop", idempotencyKey: "execution-1", confirm: true }
  });
  const response = await started;
  assert.equal(response.statusCode, 202);
  while (!unblock) await new Promise((resolve) => setImmediate(resolve));
  const stopPromise = app.stopExecutions();
  let stopped = false;
  stopPromise.then(() => { stopped = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false);
  unblock();
  await stopPromise;
  assert.equal(stopped, true);
});

test("server stop during asset generation prevents remote submission", async (t) => {
  let releaseAsset;
  let assetStarted = false;
  let submitCalls = 0;
  const executor = createFakeExecutor();
  executor.createAsset = async () => {
    assetStarted = true;
    await new Promise((resolve) => { releaseAsset = resolve; });
    return { asset_id: "asset", preview_url: null };
  };
  executor.submitVideo = async () => {
    submitCalls += 1;
    return { status: "ready", remoteEvidence: { evidence_source: "direct_submission", remote_id: "work-1" } };
  };
  const { app, root, session } = await fixture(executor);
  t.after(async () => {
    releaseAsset?.();
    await app.stopExecutions?.();
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await importOne(app, session, "batch-stop-before-submit");
  const response = await app.inject({
    method: "POST", url: "/api/executions", headers: headers(session),
    payload: { batchId: "batch-stop-before-submit", idempotencyKey: "execution-1", confirm: true }
  });
  assert.equal(response.statusCode, 202);
  while (!assetStarted) await new Promise((resolve) => setImmediate(resolve));
  const stopPromise = app.stopExecutions();
  releaseAsset();
  await stopPromise;
  const batch = await app.inject({ method: "GET", url: "/api/batches/batch-stop-before-submit", headers: { host: HOST } });

  assert.equal(submitCalls, 0);
  assert.equal(batch.json().batch.items[0].status, "pending");
});

test("execution error messages redact local filesystem paths", async (t) => {
  const { app, root } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = createBatchStore(path.join(root, "batches"));
  const localPath = path.join(os.tmpdir(), "secret.png");
  await store.create({
    batch_id: "batch-redact-errors",
    status: "failed",
    execution_error: `failed at ${localPath}`,
    items: [{
      sku: "SKU-1",
      task_id: "task-1",
      status: "failed_pre_submit",
      error_message: `failed at ${localPath}`
    }]
  });

  const batch = await app.inject({ method: "GET", url: "/api/batches/batch-redact-errors", headers: { host: HOST } });

  assert.equal(JSON.stringify(batch.json()).includes(os.tmpdir()), false);
  assert.equal(JSON.stringify(batch.json()).includes("[local path]"), true);
});

test("retries a failed pre-submit batch without re-importing products", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-retry",
    status: "failed",
    execution_error: "browser launch failed",
    execution_snapshot: { executionKey: "old" },
    items: [{
      task_id: "task-1",
      sku: "SKU-1",
      product_name: "Alpha",
      selling_points: "Useful",
      category: "beauty",
      status: "failed_pre_submit",
      retry_count: 1,
      execution_key: "old",
      confirmed_at: "2026-07-14T00:00:00.000Z",
      error_message: "browser launch failed",
      error_phase: "asset_generation",
      asset_evidence: { asset_id: "stale" }
    }]
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/batches/batch-retry/retry",
    headers: headers(session),
    payload: { confirm: true }
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().batch.status, "pending");
  assert.equal(response.json().batch.items[0].status, "pending");
  assert.equal(response.json().batch.items[0].retry_count, 2);
  assert.equal(response.json().batch.items[0].execution_key, null);
  assert.equal(response.json().batch.items[0].error_message, null);
  assert.equal("execution_snapshot" in response.json().batch, false);
});

test("force retries interrupted unknown batches only after explicit risk acknowledgement", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-unknown-retry",
    status: "interrupted_unknown",
    execution_snapshot: { executionKey: "old" },
    items: [{
      task_id: "task-1",
      sku: "SKU-1",
      product_name: "Alpha",
      selling_points: "Useful",
      category: "beauty",
      status: "interrupted_unknown",
      retry_count: 0,
      execution_key: "old",
      confirmed_at: "2026-07-14T00:00:00.000Z",
      error_message: "Remote submission did not produce unique evidence",
      error_phase: "remote_submit",
      asset_evidence: { asset_id: "asset" },
      submit_checkpoint: { phase: "remote_submit_pre" },
      remote_candidates: []
    }]
  });

  const rejected = await app.inject({
    method: "POST",
    url: "/api/batches/batch-unknown-retry/retry",
    headers: headers(session),
    payload: { confirm: true }
  });
  const accepted = await app.inject({
    method: "POST",
    url: "/api/batches/batch-unknown-retry/retry",
    headers: headers(session),
    payload: { confirm: true, allowUnknown: true }
  });

  assert.equal(rejected.statusCode, 409);
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.json().batch.status, "pending");
  assert.equal(accepted.json().batch.items[0].status, "pending");
  assert.equal(accepted.json().batch.items[0].retry_count, 1);
  assert.equal(accepted.json().batch.items[0].execution_key, null);
  assert.equal(accepted.json().batch.items[0].error_message, null);
  assert.equal("submit_checkpoint" in accepted.json().batch.items[0], false);
  assert.equal("remote_candidates" in accepted.json().batch.items[0], false);
});

test("upload limit failures are client errors, not internal errors", async (t) => {
  const byteFixture = await fixture(createFakeExecutor(), {
    uploadLimits: { maxImageBytes: 1024, maxBatchFiles: 2, maxBatchBytes: 64 }
  });
  const { app, root, session } = byteFixture;
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await createBatch(app, session, "batch-limits");
  const byteLimitForm = multipart([
    { name: "batchId", value: "batch-limits" },
    {
      name: "files", filename: "products.csv", contentType: "text/csv",
      value: "sku,product_name,selling_points,category,image_path\nSKU-1,Alpha,Useful,beauty,SKU-1.png\n"
    },
    { name: "files", filename: "SKU-1.png", contentType: "image/png", value: Buffer.alloc(65) }
  ]);

  const byteLimit = await app.inject({
    method: "POST", url: "/api/imports",
    headers: headers(session, { "content-type": `multipart/form-data; boundary=${byteLimitForm.boundary}` }),
    payload: byteLimitForm.body
  });
  const fileFixture = await fixture(createFakeExecutor(), {
    uploadLimits: { maxImageBytes: 1024, maxBatchFiles: 2, maxBatchBytes: 1024 * 1024 }
  });
  t.after(async () => {
    await fileFixture.app.close();
    await rm(fileFixture.root, { recursive: true, force: true });
  });
  await createBatch(fileFixture.app, fileFixture.session, "batch-file-limit");
  const fileLimitForm = multipart([
    { name: "batchId", value: "batch-file-limit" },
    { name: "files", filename: "a.csv", contentType: "text/csv", value: "a" },
    { name: "files", filename: "b.csv", contentType: "text/csv", value: "b" },
    { name: "files", filename: "c.csv", contentType: "text/csv", value: "c" }
  ]);
  const fileLimit = await fileFixture.app.inject({
    method: "POST", url: "/api/imports",
    headers: headers(fileFixture.session, { "content-type": `multipart/form-data; boundary=${fileLimitForm.boundary}` }),
    payload: fileLimitForm.body
  });

  assert.equal(byteLimit.statusCode, 400);
  assert.equal(byteLimit.json().error, "BATCH_BYTE_LIMIT");
  assert.equal(fileLimit.statusCode, 400);
  assert.equal(fileLimit.json().error, "BATCH_FILE_LIMIT");
});

test("rejects a second batch while the first execution owns the global lock", async (t) => {
  let unblock;
  const executor = createFakeExecutor();
  const originalCreateAsset = executor.createAsset;
  executor.createAsset = async (...args) => {
    await new Promise((resolve) => { unblock = resolve; });
    return originalCreateAsset(...args);
  };
  const { app, root, session } = await fixture(executor);
  t.after(async () => {
    unblock?.();
    await app.stopExecutions?.();
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await importOne(app, session, "batch-one");
  await importOne(app, session, "batch-two");

  const first = await app.inject({
    method: "POST", url: "/api/executions", headers: headers(session),
    payload: { batchId: "batch-one", idempotencyKey: "execution-1", confirm: true }
  });
  while (!unblock) await new Promise((resolve) => setImmediate(resolve));
  const second = await app.inject({
    method: "POST", url: "/api/executions", headers: headers(session),
    payload: { batchId: "batch-two", idempotencyKey: "execution-2", confirm: true }
  });

  assert.equal(first.statusCode, 202);
  assert.equal(second.statusCode, 409);
});

test("concurrent execution attempts leave the losing batch pending", async (t) => {
  let unblock;
  const executor = createFakeExecutor();
  const originalCreateAsset = executor.createAsset;
  executor.createAsset = async (...args) => {
    await new Promise((resolve) => { unblock = resolve; });
    return originalCreateAsset(...args);
  };
  const { app, root, session } = await fixture(executor);
  t.after(async () => {
    unblock?.();
    await app.stopExecutions?.();
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await importOne(app, session, "batch-one");
  await importOne(app, session, "batch-two");

  const [first, second] = await Promise.all([
    app.inject({
      method: "POST", url: "/api/executions", headers: headers(session),
      payload: { batchId: "batch-one", idempotencyKey: "execution-1", confirm: true }
    }),
    app.inject({
      method: "POST", url: "/api/executions", headers: headers(session),
      payload: { batchId: "batch-two", idempotencyKey: "execution-2", confirm: true }
    })
  ]);
  while (!unblock) await new Promise((resolve) => setImmediate(resolve));
  const loser = first.statusCode === 409 ? "batch-one" : "batch-two";
  const losingBatch = await app.inject({ method: "GET", url: `/api/batches/${loser}`, headers: { host: HOST } });

  assert.deepEqual([first.statusCode, second.statusCode].sort(), [202, 409]);
  assert.equal(losingBatch.json().batch.status, "pending");
  assert.equal(losingBatch.json().batch.items[0].status, "pending");
});

test("unexpected server errors are reported as 500 without leaking details", async (t) => {
  const { app, root } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  // Seed a corrupted batch.json DIRECTLY (not through the store), so the
  // in-process committed snapshot stays empty and GET /api/batches/:id cold-reads
  // batch.json, hits the JSON parse error, and the error handler maps it to a
  // redacted 500. A batch created through the store would be served from the
  // snapshot and would NOT surface an on-disk parse error — that is by design
  // (readCommitted prefers the committed snapshot); this test pins the error-
  // middleware redaction via the cold-read path instead.
  await mkdir(path.join(root, "batches", "batch-corrupt"), { recursive: true });
  await writeFile(path.join(root, "batches", "batch-corrupt", "batch.json"), "{not-json", "utf8");

  const response = await app.inject({ method: "GET", url: "/api/batches/batch-corrupt", headers: { host: HOST } });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: "INTERNAL_ERROR" });
});

// --- Batch schema startup migration (CORE-001 / Issue #20) -------------------

test("buildApp migrates legacy batches before it resolves and the API serves schemaVersion 1", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-server-api-schema-"));
  try {
    const legacy = {
      batch_id: "batch-legacy",
      status: "needs_input",
      items: [],
      uploads: [],
      artifacts: [],
      created_at: "2026-07-01T10:00:00.000Z",
      updated_at: "2026-07-01T10:00:00.000Z",
      historical_unknown_field: { keep: true }
    };
    await mkdir(path.join(root, "batches", "batch-legacy"), { recursive: true });
    await writeFile(
      path.join(root, "batches", "batch-legacy", "batch.json"),
      JSON.stringify(legacy, null, 2),
      "utf8"
    );

    // buildApp must not resolve until the startup migration has completed.
    const app = await buildApp({ root, executor: createFakeExecutor() });
    const onDisk = JSON.parse(await readFile(path.join(root, "batches", "batch-legacy", "batch.json"), "utf8"));
    assert.equal(onDisk.schemaVersion, 1, "legacy batch migrated before buildApp resolved");
    assert.equal(onDisk.created_at, legacy.created_at, "timestamps unchanged");
    assert.deepEqual(onDisk.historical_unknown_field, { keep: true });

    const sessionResponse = await app.inject({ method: "GET", url: "/api/session", headers: { host: HOST } });
    const session = {
      cookie: sessionResponse.headers["set-cookie"].split(";")[0],
      token: sessionResponse.json().token
    };
    const response = await app.inject({
      method: "GET", url: "/api/batches/batch-legacy", headers: headers(session)
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().batch.schemaVersion, 1, "API serves the current schema");
    assert.deepEqual(response.json().batch.historical_unknown_field, { keep: true });
    const listed = await app.inject({ method: "GET", url: "/api/batches", headers: headers(session) });
    assert.equal(listed.json().batches[0].schemaVersion, 1, "list serves the current schema");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("buildApp fails closed when an existing batch has an unsupported schema", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-server-api-schema-bad-"));
  try {
    await mkdir(path.join(root, "batches", "batch-future"), { recursive: true });
    await writeFile(
      path.join(root, "batches", "batch-future", "batch.json"),
      JSON.stringify({ batch_id: "batch-future", schemaVersion: 2 }, null, 2),
      "utf8"
    );
    await assert.rejects(
      buildApp({ root, executor: createFakeExecutor() }),
      (error) => error.code === "BATCH_SCHEMA_UNSUPPORTED" && error.batchId === "batch-future"
    );
    // The unsupported file stays untouched.
    const onDisk = JSON.parse(await readFile(path.join(root, "batches", "batch-future", "batch.json"), "utf8"));
    assert.equal(onDisk.schemaVersion, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
