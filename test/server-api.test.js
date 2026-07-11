import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

import { buildApp } from "../src/server/app.js";
import { createBatchStore } from "../src/core/batch-store.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";

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

async function importInto(app, session, batchId, imageName = "SKU-1.png") {
  const image = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
  const form = multipart([
    { name: "batchId", value: batchId },
    {
      name: "files", filename: "products.csv", contentType: "text/csv",
      value: `sku,product_name,selling_points,category,image_path\nSKU-1,Alpha,Useful,beauty,${imageName}\n`
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

async function importOne(app, session, batchId) {
  await createBatch(app, session, batchId);
  const response = await importInto(app, session, batchId);
  assert.equal(response.statusCode, 200);
  return response.json().batch;
}

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
