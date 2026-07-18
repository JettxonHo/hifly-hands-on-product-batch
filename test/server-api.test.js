import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
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

  let batch = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await app.inject({
      method: "GET",
      url: "/api/batches/batch-capture-run",
      headers: { host: HOST }
    });
    batch = response.json().batch;
    if (batch.status === "completed" && batch.capture.status === "recorded") break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  assert.equal(factoryCalls.length, 1);
  assert.match(factoryCalls[0], /^rpa\/capture\/raw\/batch-capture-run-/);
  assert.equal(batch.status, "completed");
  assert.equal(batch.capture.enabled, true);
  assert.equal(batch.capture.status, "recorded");
  assert.equal(batch.capture.har_path, "[local raw capture]");
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
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  await createBatch(app, session, "batch-corrupt");
  await writeFile(path.join(root, "batches", "batch-corrupt", "batch.json"), "{not-json", "utf8");

  const response = await app.inject({ method: "GET", url: "/api/batches/batch-corrupt", headers: { host: HOST } });

  assert.equal(response.statusCode, 500);
  assert.deepEqual(response.json(), { error: "INTERNAL_ERROR" });
});
