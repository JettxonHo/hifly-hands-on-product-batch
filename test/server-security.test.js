import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildApp } from "../src/server/app.js";
import { createBatchStore } from "../src/core/batch-store.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { startServer } from "../src/server/start.js";

const HOST = "127.0.0.1:4317";
const ORIGIN = `http://${HOST}`;

async function buildTestApp() {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-server-security-"));
  const app = await buildApp({ root, executor: createFakeExecutor() });
  return { app, root };
}

async function session(app) {
  const response = await app.inject({ method: "GET", url: "/api/session", headers: { host: HOST } });
  assert.equal(response.statusCode, 200);
  return {
    cookie: response.headers["set-cookie"].split(";")[0],
    token: response.json().token,
  };
}

function mutationHeaders(current, extra = {}) {
  return {
    host: HOST,
    origin: ORIGIN,
    cookie: current.cookie,
    "x-local-session-token": current.token,
    "content-type": "application/json",
    ...extra,
  };
}

test("sets the local-only CSP and a strict HttpOnly session bootstrap cookie", async (t) => {
  const { app, root } = await buildTestApp();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const response = await app.inject({ method: "GET", url: "/api/session", headers: { host: HOST } });

  assert.equal(response.statusCode, 200);
  assert.equal(
    response.headers["content-security-policy"],
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'"
  );
  assert.match(response.headers["set-cookie"], /HttpOnly/);
  assert.match(response.headers["set-cookie"], /SameSite=Strict/);
  assert.match(response.json().token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
});

test("rejects cross-origin execution request", async (t) => {
  const { app, root } = await buildTestApp();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const response = await app.inject({
    method: "POST", url: "/api/executions",
    headers: { host: HOST, origin: "https://evil.example", "content-type": "application/json" },
    payload: { batchId: "b1" }
  });

  assert.equal(response.statusCode, 403);
});

test("rejects invalid Host, Origin null, and missing or mismatched session proof", async (t) => {
  const { app, root } = await buildTestApp();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const current = await session(app);

  for (const headers of [
    mutationHeaders(current, { host: "localhost:4317" }),
    mutationHeaders(current, { origin: "null" }),
    { host: HOST, origin: ORIGIN, "content-type": "application/json" },
    mutationHeaders({ ...current, token: "wrong" }),
  ]) {
    const response = await app.inject({
      method: "POST", url: "/api/batches", headers, payload: {}
    });
    assert.equal(response.statusCode, 403);
  }
});

test("rejects invalid local ports and non-listener hosts when configured", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-server-host-"));
  const app = await buildApp({
    root,
    executor: createFakeExecutor(),
    allowedHost: HOST
  });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const invalidPort = await app.inject({ method: "GET", url: "/api/session", headers: { host: "127.0.0.1:65536" } });
  const wrongPort = await app.inject({ method: "GET", url: "/api/session", headers: { host: "127.0.0.1:4318" } });
  const allowed = await app.inject({ method: "GET", url: "/api/session", headers: { host: HOST } });

  assert.equal(invalidPort.statusCode, 403);
  assert.equal(wrongPort.statusCode, 403);
  assert.equal(allowed.statusCode, 200);
});

test("rejects mutation content types other than JSON or multipart", async (t) => {
  const { app, root } = await buildTestApp();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const current = await session(app);

  const response = await app.inject({
    method: "POST",
    url: "/api/batches",
    headers: mutationHeaders(current, { "content-type": "text/plain" }),
    payload: "{}"
  });

  assert.equal(response.statusCode, 415);
});

test("serves only manifest-authorized artifacts from the requested batch", async (t) => {
  const { app, root } = await buildTestApp();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({ batch_id: "batch-a", items: [] });
  await store.create({ batch_id: "batch-b", items: [] });
  await mkdir(path.join(root, "batches", "batch-a", "downloads"));
  await writeFile(path.join(root, "batches", "batch-a", "downloads", "proof.txt"), "authorized");
  await writeFile(path.join(root, "batches", "batch-a", "downloads", "未命名.mp4"), "video");
  await store.registerArtifact("batch-a", { artifact_id: "proof", relative_path: "downloads/proof.txt" });
  await store.registerArtifact("batch-a", { artifact_id: "unicode", relative_path: "downloads/未命名.mp4" });

  const allowed = await app.inject({ method: "GET", url: "/api/artifacts/batch-a/proof", headers: { host: HOST } });
  const unicode = await app.inject({ method: "GET", url: "/api/artifacts/batch-a/unicode", headers: { host: HOST } });
  const crossBatch = await app.inject({ method: "GET", url: "/api/artifacts/batch-b/proof", headers: { host: HOST } });
  const traversal = await app.inject({ method: "GET", url: "/api/artifacts/batch-a/../proof", headers: { host: HOST } });

  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.body, "authorized");
  assert.equal(allowed.headers["content-disposition"], "attachment; filename=\"proof.txt\"; filename*=UTF-8''proof.txt");
  assert.equal(unicode.statusCode, 200);
  assert.equal(unicode.headers["content-disposition"], "attachment; filename=\"___.mp4\"; filename*=UTF-8''%E6%9C%AA%E5%91%BD%E5%90%8D.mp4");
  assert.equal(crossBatch.statusCode, 404);
  assert.equal(traversal.statusCode, 404);
});

test("startServer imports, binds localhost, and falls back when browser open fails", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-server-start-"));
  let server = null;
  let openedUrl = null;
  t.after(async () => {
    await server?.close();
    await rm(root, { recursive: true, force: true });
  });
  try {
    server = await startServer({
      root,
      executor: createFakeExecutor(),
      openBrowser: async (url) => {
        openedUrl = url;
        throw new Error("no browser in test");
      },
      handleSignals: false
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("sandbox disallows local TCP listening");
      return;
    }
    throw error;
  }

  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.equal(openedUrl, server.url);

  const response = await server.app.inject({
    method: "GET",
    url: "/api/session",
    headers: { host: `127.0.0.1:${server.port}` }
  });
  assert.equal(response.statusCode, 200);
});
