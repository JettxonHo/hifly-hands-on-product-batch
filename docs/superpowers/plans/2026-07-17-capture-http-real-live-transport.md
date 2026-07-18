# Capture HTTP real_live Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the GUI to run one authorized real HTTP capture workflow against Hifly, using Playwright only to provide in-memory login cookies and using capture HTTP for generation, polling, and download.

**Architecture:** Keep Playwright as the default production fallback and add a `real_live` execution lane under the existing capture workflow. Runtime auth is read from the existing Playwright profile into memory only, passed to `createCaptureHttpExecutor()`, and sent through a Node `fetch` transport; all persisted state remains safe summaries only. GUI exposes a real-live button only for one-item, dry-run-passed capture batches, with a confirmation gate for point risk.

**Tech Stack:** Node.js ESM, built-in `node:test`, Fastify injection tests, Playwright persistent profile cookie extraction, Node `fetch`/`AbortController`, existing vanilla JS GUI.

## Global Constraints

- Default `executionBackend` remains `playwright`; do not switch production execution to `capture_http`.
- Playwright is used only as runtime-auth provider for this path, not for page-click generation.
- Real HTTP execution must run only after explicit one-run GUI/API confirmation: `allowRealLive=true`, `acknowledgePointRisk=true`, `limitItems=1`.
- No runtime auth, cookie, authorization, token, raw request URL/path/query, raw request body, raw response body, raw HAR, batch data, logs, screenshots, outputs, videos, or `config.local.json` may be committed.
- Public batch APIs must expose only stable statuses, stable errors, safe relative artifact paths, and request-plan summaries.
- A live run must be limited to one item until a future reviewed plan expands it.
- If auth is missing, host is outside allowlist, a manifest step is not replayable, or a transport error occurs, stop immediately and leave Playwright fallback intact.
- Real Feiying/Hifly execution consumes points; only run the final real 1-item test after explicit user approval in that execution turn.

---

## File Structure

- Create `src/rpa/capture/fetch-live-transport.js`: real network transport using `fetch`, with HTTPS-only checks, timeout, response parsing, and artifact support.
- Create `src/rpa/capture/playwright-runtime-auth.js`: opens existing Playwright profile and extracts allowlisted cookies into in-memory `runtimeAuth.headers.cookie`.
- Modify `src/rpa/capture/real-live-http-client.js`: support transport artifact responses and stable transport error wrapping.
- Modify `src/executors/capture-http-executor.js`: write real artifact bytes for `real_live` downloads while keeping safe persisted request plans.
- Modify `src/rpa/capture/workflow-state.js`: add public-safe live statuses and `live_summary`.
- Modify `src/server/routes/capture.js`: add `POST /api/batches/:batchId/capture/live-run` with local authorization gates, auth provider, real transport factory injection seams, and public-safe state updates.
- Modify `src/server/app.js` / server construction only if needed to inject live-run dependencies in tests.
- Modify `web/api.js`: add `runLiveCapture(batchId, payload)`.
- Modify `web/app.js`: enable real-live button for eligible batches, show confirmation, call live-run API, and display live status/summary/errors.
- Modify `config.example.json`: keep disabled default but document `realLive.enabled=false`; no real secrets.
- Modify `docs/rpa/capture-runbook.md` and `docs/PROJECT_HANDOFF.md`: document real-live execution boundary and test result.
- Add/extend tests:
  - `test/rpa-fetch-live-transport.test.js`
  - `test/playwright-runtime-auth.test.js`
  - `test/capture-http-executor.test.js`
  - `test/server-capture-api.test.js`
  - `test/gui-smoke.test.js`

---

### Task 1: Add real fetch transport behind a strict network boundary

**Files:**
- Create: `src/rpa/capture/fetch-live-transport.js`
- Test: `test/rpa-fetch-live-transport.test.js`

**Interfaces:**
- Produces: `createFetchLiveTransport({ fetchImpl = globalThis.fetch, allowedProtocols = ["https:"], maxBytes = 200 * 1024 * 1024 } = {})`
- Produces: `transport.request({ method, url, headers, body, timeoutMs }) -> { status, headers, body, artifact? }`
- Later tasks pass this transport into `createCaptureHttpExecutor()` through `context.realLive.transport`.

- [ ] **Step 1: Write failing transport tests**

Create `test/rpa-fetch-live-transport.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { createFetchLiveTransport } from "../src/rpa/capture/fetch-live-transport.js";

test("fetch live transport rejects non-https URLs before fetch", async () => {
  let called = false;
  const transport = createFetchLiveTransport({
    fetchImpl: async () => {
      called = true;
      return new Response("{}");
    }
  });
  await assert.rejects(
    transport.request({ method: "GET", url: "http://hiflyworks-api.lingverse.co/api", headers: {}, body: null }),
    { code: "CAPTURE_HTTP_TRANSPORT_URL_REJECTED" }
  );
  assert.equal(called, false);
});

test("fetch live transport sends JSON request and parses JSON response", async () => {
  const calls = [];
  const transport = createFetchLiveTransport({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ code: 0, data: { id: 123 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  const result = await transport.request({
    method: "POST",
    url: "https://hiflyworks-api.lingverse.co/api/app/v1/test",
    headers: { "content-type": "application/json", cookie: "sid=memory" },
    body: { hello: "world" },
    timeoutMs: 1000
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://hiflyworks-api.lingverse.co/api/app/v1/test");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.cookie, "sid=memory");
  assert.equal(calls[0].init.body, JSON.stringify({ hello: "world" }));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { code: 0, data: { id: 123 } });
});

test("fetch live transport returns binary artifact for non-json responses", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const transport = createFetchLiveTransport({
    fetchImpl: async () => new Response(bytes, {
      status: 200,
      headers: { "content-type": "video/mp4", "content-disposition": "attachment; filename=\"demo.mp4\"" }
    })
  });
  const result = await transport.request({
    method: "GET",
    url: "https://hiflyworks-api.lingverse.co/download/demo.mp4",
    headers: {},
    body: null,
    timeoutMs: 1000
  });
  assert.equal(result.status, 200);
  assert.deepEqual([...result.artifact.bytes], [1, 2, 3, 4]);
  assert.equal(result.artifact.filename, "demo.mp4");
  assert.deepEqual(result.body, { artifact_filename: "demo.mp4" });
});

test("fetch live transport wraps fetch failures without leaking request details", async () => {
  const transport = createFetchLiveTransport({
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED https://secret.example/token=abc");
    }
  });
  await assert.rejects(
    transport.request({
      method: "GET",
      url: "https://hiflyworks-api.lingverse.co/api",
      headers: { cookie: "sid=memory" },
      body: null,
      timeoutMs: 1000
    }),
    (error) => {
      assert.equal(error.code, "CAPTURE_HTTP_TRANSPORT_FAILED");
      assert.equal(error.message.includes("secret"), false);
      assert.equal(error.message.includes("sid=memory"), false);
      return true;
    }
  );
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test test/rpa-fetch-live-transport.test.js
```

Expected: FAIL with module-not-found for `fetch-live-transport.js`.

- [ ] **Step 3: Implement transport**

Create `src/rpa/capture/fetch-live-transport.js`:

```js
function fail(code, message) {
  throw Object.assign(new Error(message || code), { code });
}

function parseContentDispositionFilename(value) {
  if (typeof value !== "string") return null;
  const star = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) return decodeURIComponent(star[1].trim());
  const quoted = value.match(/filename="([^"]+)"/i);
  if (quoted) return quoted[1].trim();
  const plain = value.match(/filename=([^;]+)/i);
  return plain ? plain[1].trim() : null;
}

function isJsonContentType(value) {
  return typeof value === "string" && /(?:^|;|\s)application\/json(?:;|\s|$)/i.test(value);
}

function requestBody(body, headers) {
  if (body == null) return undefined;
  const contentType = Object.entries(headers || {}).find(([key]) => key.toLowerCase() === "content-type")?.[1];
  if (typeof body === "string" || body instanceof Uint8Array || body instanceof ArrayBuffer) return body;
  if (isJsonContentType(contentType) || typeof body === "object") return JSON.stringify(body);
  return body;
}

function headersObject(headers) {
  return Object.fromEntries(headers.entries());
}

export function createFetchLiveTransport({
  fetchImpl = globalThis.fetch,
  allowedProtocols = ["https:"],
  maxBytes = 200 * 1024 * 1024
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch live transport requires fetchImpl");
  const protocols = new Set(allowedProtocols);
  return {
    async request({ method, url, headers = {}, body = null, timeoutMs = 30000 }) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        fail("CAPTURE_HTTP_TRANSPORT_URL_REJECTED", "Live transport URL is invalid.");
      }
      if (!protocols.has(parsed.protocol)) {
        fail("CAPTURE_HTTP_TRANSPORT_URL_REJECTED", "Live transport only accepts HTTPS URLs.");
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(parsed.href, {
          method,
          headers,
          body: requestBody(body, headers),
          signal: controller.signal
        });
        const responseHeaders = headersObject(response.headers);
        const contentType = response.headers.get("content-type") || "";
        if (isJsonContentType(contentType)) {
          const parsedBody = await response.json();
          return { status: response.status, headers: responseHeaders, body: parsedBody };
        }
        const buffer = new Uint8Array(await response.arrayBuffer());
        if (buffer.byteLength > maxBytes) {
          fail("CAPTURE_HTTP_ARTIFACT_TOO_LARGE", "Downloaded artifact exceeds the configured limit.");
        }
        const filename = parseContentDispositionFilename(response.headers.get("content-disposition")) || null;
        return {
          status: response.status,
          headers: responseHeaders,
          body: { artifact_filename: filename },
          artifact: { bytes: buffer, filename }
        };
      } catch (error) {
        if (error?.code) throw error;
        fail("CAPTURE_HTTP_TRANSPORT_FAILED", "Live HTTP request failed.");
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
```

- [ ] **Step 4: Verify Task 1**

Run:

```bash
node --test test/rpa-fetch-live-transport.test.js
npm run check
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/rpa/capture/fetch-live-transport.js test/rpa-fetch-live-transport.test.js
git commit -m "feat(rpa capture): add fetch live transport"
```

---

### Task 2: Add Playwright runtime-auth provider

**Files:**
- Create: `src/rpa/capture/playwright-runtime-auth.js`
- Test: `test/playwright-runtime-auth.test.js`

**Interfaces:**
- Produces: `createPlaywrightRuntimeAuthProvider({ chromium, profileDir, allowedDomains = ["hiflyworks-api.lingverse.co", "hifly.cc"], logger } = {})`
- Produces: `provider.getRuntimeAuth() -> { headers: { cookie: string }, cookie_count: number }`
- Later API task uses provider output as `context.realLive.runtimeAuth`.

- [ ] **Step 1: Write failing runtime-auth tests**

Create `test/playwright-runtime-auth.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { createPlaywrightRuntimeAuthProvider } from "../src/rpa/capture/playwright-runtime-auth.js";

function fakeChromium(cookies) {
  return {
    async launchPersistentContext(profileDir) {
      assert.equal(profileDir, "/tmp/profile");
      return {
        async cookies() {
          return cookies;
        },
        async close() {}
      };
    }
  };
}

test("runtime auth provider builds an in-memory cookie header for allowed domains", async () => {
  const provider = createPlaywrightRuntimeAuthProvider({
    chromium: fakeChromium([
      { name: "sid", value: "abc", domain: ".hifly.cc" },
      { name: "api", value: "def", domain: "hiflyworks-api.lingverse.co" },
      { name: "other", value: "nope", domain: "example.com" }
    ]),
    profileDir: "/tmp/profile"
  });
  const auth = await provider.getRuntimeAuth();
  assert.equal(auth.cookie_count, 2);
  assert.equal(auth.headers.cookie.includes("sid=abc"), true);
  assert.equal(auth.headers.cookie.includes("api=def"), true);
  assert.equal(auth.headers.cookie.includes("other=nope"), false);
});

test("runtime auth provider fails closed when no allowed cookies exist", async () => {
  const provider = createPlaywrightRuntimeAuthProvider({
    chromium: fakeChromium([{ name: "other", value: "nope", domain: "example.com" }]),
    profileDir: "/tmp/profile"
  });
  await assert.rejects(provider.getRuntimeAuth(), { code: "CAPTURE_HTTP_RUNTIME_AUTH_UNAVAILABLE" });
});

test("runtime auth provider does not log cookie values", async () => {
  const logs = [];
  const provider = createPlaywrightRuntimeAuthProvider({
    chromium: fakeChromium([{ name: "sid", value: "secret-cookie", domain: ".hifly.cc" }]),
    profileDir: "/tmp/profile",
    logger: { info: (message) => logs.push(message), warn: (message) => logs.push(message) }
  });
  await provider.getRuntimeAuth();
  assert.equal(logs.join("\\n").includes("secret-cookie"), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test test/playwright-runtime-auth.test.js
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Implement provider**

Create `src/rpa/capture/playwright-runtime-auth.js`:

```js
function fail(code, message) {
  throw Object.assign(new Error(message || code), { code });
}

function domainMatches(cookieDomain, allowedDomain) {
  const domain = String(cookieDomain || "").replace(/^\./, "").toLowerCase();
  const allowed = String(allowedDomain || "").toLowerCase();
  return domain === allowed || allowed.endsWith(`.${domain}`) || domain.endsWith(`.${allowed}`);
}

function cookiePair(cookie) {
  if (!cookie?.name || cookie.value == null) return null;
  return `${encodeURIComponent(cookie.name)}=${encodeURIComponent(cookie.value)}`;
}

export function createPlaywrightRuntimeAuthProvider({
  chromium,
  profileDir,
  allowedDomains = ["hiflyworks-api.lingverse.co", "hifly.cc"],
  logger = console
} = {}) {
  if (!chromium || typeof chromium.launchPersistentContext !== "function") {
    throw new TypeError("runtime auth provider requires chromium.launchPersistentContext");
  }
  if (!profileDir) throw new TypeError("runtime auth provider requires profileDir");
  const allowed = new Set(allowedDomains);
  return {
    async getRuntimeAuth() {
      let context;
      try {
        context = await chromium.launchPersistentContext(profileDir, { headless: true });
        const cookies = await context.cookies();
        const pairs = cookies
          .filter((cookie) => [...allowed].some((domain) => domainMatches(cookie.domain, domain)))
          .map(cookiePair)
          .filter(Boolean);
        if (pairs.length === 0) {
          fail("CAPTURE_HTTP_RUNTIME_AUTH_UNAVAILABLE", "No Hifly runtime cookies are available.");
        }
        logger.info?.(`Loaded ${pairs.length} Hifly runtime cookie(s) for capture HTTP.`);
        return {
          headers: { cookie: pairs.join("; ") },
          cookie_count: pairs.length
        };
      } finally {
        await context?.close?.();
      }
    }
  };
}
```

- [ ] **Step 4: Verify Task 2**

Run:

```bash
node --test test/playwright-runtime-auth.test.js
npm run check
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/rpa/capture/playwright-runtime-auth.js test/playwright-runtime-auth.test.js
git commit -m "feat(rpa capture): load runtime auth from playwright profile"
```

---

### Task 3: Support real artifact bytes in capture HTTP executor

**Files:**
- Modify: `src/rpa/capture/real-live-http-client.js`
- Modify: `src/executors/capture-http-executor.js`
- Test: `test/capture-http-executor.test.js`
- Test: `test/rpa-capture-real-live-client.test.js`

**Interfaces:**
- Consumes: Task 1 `transport.request()` may return `artifact: { bytes: Uint8Array, filename: string | null }`.
- Produces: real-live `downloadArtifact()` writes artifact bytes when available; mock and dry-run still write placeholders.

- [ ] **Step 1: Add failing client artifact test**

Append to `test/rpa-capture-real-live-client.test.js`:

```js
test("real_live returns transport artifact metadata for download steps", async () => {
  const manifest = manifestWith({
    id: "download_video",
    phase: "download",
    method: "GET",
    url_template: "https://hiflyworks-api.lingverse.co/download/{{remote_id}}",
    placeholders: ["{{remote_id}}"],
    request_template: {},
    response: { status: 200, body: { artifact_filename: "demo.mp4" } },
    produces: { artifact_filename: "$response.body.artifact_filename" },
    risk: { requires_auth: false, may_consume_points: false, replayability: "unknown" }
  });
  const client = createRealLiveHttpClient({
    manifest,
    config: { enabled: true },
    transport: {
      request: async () => ({
        status: 200,
        body: { artifact_filename: "demo.mp4" },
        artifact: { bytes: new Uint8Array([7, 8, 9]), filename: "demo.mp4" }
      })
    }
  });
  const result = await client.request({
    stepId: "download_video",
    variables: { remote_id: "remote-1" },
    context: { allowRealLive: true, acknowledgePointRisk: true }
  });
  assert.deepEqual([...result.artifact.bytes], [7, 8, 9]);
  assert.equal(result.produced.artifact_filename, "demo.mp4");
});
```

- [ ] **Step 2: Add failing executor artifact test**

Append to `test/capture-http-executor.test.js`:

```js
test("capture_http real_live download writes transport artifact bytes without persisting raw request", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-http-live-artifact-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const batchId = "batch-live-artifact";
  const batchDirectory = path.join(root, "batches", batchId);
  const manifestPath = path.join(root, "manifest.json");
  await mkdir(batchDirectory, { recursive: true });
  await writeFile(manifestPath, JSON.stringify({
    schema_version: 1,
    sanitized: true,
    source: "test",
    captured_at: "2026-07-17T00:00:00.000Z",
    steps: [{
      id: "download_video",
      phase: "download",
      method: "GET",
      url_template: "https://hiflyworks-api.lingverse.co/download/{{remote_id}}",
      placeholders: ["{{remote_id}}"],
      response: { status: 200, body: { artifact_filename: "live.mp4" } },
      produces: { artifact_filename: "$response.body.artifact_filename" },
      risk: { requires_auth: true, may_consume_points: false, replayability: "unknown" }
    }]
  }));
  const executor = createCaptureHttpExecutor({
    root,
    config: { rpa: { manifestPath, captureHttpMode: "real_live", realLive: { enabled: true } } }
  });
  const remoteEvidence = { remote_id: "remote-live", task_id: "task-live", batch_id: batchId };
  const artifact = await executor.downloadArtifact(remoteEvidence, null, {
    batchId,
    taskId: "task-live",
    realLive: {
      allowRealLive: true,
      acknowledgePointRisk: true,
      runtimeAuth: { headers: { cookie: "sid=memory" } },
      transport: {
        request: async () => ({
          status: 200,
          body: { artifact_filename: "live.mp4" },
          artifact: { bytes: new Uint8Array([10, 11, 12]), filename: "live.mp4" }
        })
      }
    }
  });
  assert.equal(artifact.relative_path, path.join("artifacts", "live.mp4"));
  const bytes = await readFile(path.join(batchDirectory, artifact.relative_path));
  assert.deepEqual([...bytes], [10, 11, 12]);
  const state = await readRpaState(batchDirectory, "task-live");
  const persisted = JSON.stringify(state);
  assert.equal(persisted.includes("sid=memory"), false);
  assert.equal(persisted.includes("/download/remote-live"), false);
  assert.equal(state.status, "completed");
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
node --test test/rpa-capture-real-live-client.test.js test/capture-http-executor.test.js
```

Expected: FAIL because `result.artifact` is absent or executor writes placeholder bytes.

- [ ] **Step 4: Implement artifact propagation**

Modify `src/rpa/capture/real-live-http-client.js` return object:

```js
      return {
        status: response?.status ?? step.response.status,
        body: responseBody,
        artifact: response?.artifact || null,
        produced,
        request_plan: {
```

Modify `src/executors/capture-http-executor.js`:

```js
async function writeArtifactBytes(absolutePath, bytes, remoteId) {
  if (!bytes) return writePlaceholderArtifact(absolutePath, remoteId);
  let handle;
  try {
    handle = await open(absolutePath, "wx", 0o600);
    await handle.writeFile(bytes);
  } catch (error) {
    if (error?.code === "EEXIST" || error?.code === "ELOOP") {
      throw artifactPathError("Capture artifact destination cannot be safely created");
    }
    throw error;
  } finally {
    await handle?.close();
  }
}
```

Update `replayPhase()` return:

```js
    let artifact = null;
    for (const step of selectStepsByPhase(manifestCache, phase)) {
      const result = await client.request({
        stepId: step.id,
        variables: vars,
        phase,
        context: {
          allowRealLive: realLive?.allowRealLive === true,
          acknowledgePointRisk: realLive?.acknowledgePointRisk === true
        }
      });
      if (result.artifact) artifact = result.artifact;
      Object.assign(vars, result.produced);
      Object.assign(persistedVariables, result.produced);
      const safePlan = persistableRequestPlan(result.request_plan);
      if (safePlan) requestPlan.push(safePlan);
    }
    return { variables: vars, persistedVariables, requestPlan, artifact };
```

Update `downloadArtifact()`:

```js
      const filename = artifactFilename(downloadReplay.artifact?.filename || produced.artifact_filename, remoteEvidence?.remote_id);
      const absolutePath = await safeArtifactPath(dir, filename);
      await writeArtifactBytes(absolutePath, downloadReplay.artifact?.bytes, remoteEvidence?.remote_id);
```

- [ ] **Step 5: Verify Task 3**

Run:

```bash
node --test test/rpa-capture-real-live-client.test.js test/capture-http-executor.test.js
npm run check
git diff --check
```

Expected: all pass.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/rpa/capture/real-live-http-client.js src/executors/capture-http-executor.js test/rpa-capture-real-live-client.test.js test/capture-http-executor.test.js
git commit -m "feat(rpa capture): persist live transport artifacts"
```

---

### Task 4: Add live-run state and API with injected no-network test seams

**Files:**
- Modify: `src/rpa/capture/workflow-state.js`
- Modify: `src/server/routes/capture.js`
- Modify: `src/server/app.js` if route dependency injection currently cannot pass providers
- Test: `test/server-capture-api.test.js`

**Interfaces:**
- Consumes: Task 1 `createFetchLiveTransport()`
- Consumes: Task 2 `createPlaywrightRuntimeAuthProvider()`
- Consumes: Task 3 executor artifact support
- Produces: `POST /api/batches/:batchId/capture/live-run`
- Produces public capture statuses: `real_live_running`, `real_live_completed`, `real_live_failed`

- [ ] **Step 1: Write failing API tests**

Append to `test/server-capture-api.test.js`:

```js
test("live-run rejects missing confirmation before auth or transport", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-live-no-confirm",
    status: "completed",
    items: [{ task_id: "task-1", sku: "SKU", product_name: "Live", status: "pending" }],
    uploads: [],
    capture: { enabled: true, status: "dry_run_passed", manifest_path: "batches/batch-live-no-confirm/capture/manifest.json" }
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/batches/batch-live-no-confirm/capture/live-run",
    headers: headers(session),
    payload: { allowRealLive: false, acknowledgePointRisk: true, limitItems: 1 }
  });
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, "CAPTURE_HTTP_REAL_LIVE_NOT_AUTHORIZED");
});

test("live-run executes one item with injected auth and transport without exposing secrets", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-live-run-api-"));
  const calls = [];
  const app = await buildApp({
    root,
    executor: createFakeExecutor(),
    captureLive: {
      enabled: true,
      authProvider: {
        getRuntimeAuth: async () => ({ headers: { cookie: "sid=memory-only" }, cookie_count: 1 })
      },
      transport: {
        request: async (request) => {
          calls.push(request);
          if (request.step.id === "asset") {
            return { status: 200, body: { data: { asset_id: "asset-live" } } };
          }
          if (request.step.id === "submit") {
            return { status: 200, body: { data: { work_id: "remote-live" } } };
          }
          if (request.step.id === "poll") {
            return { status: 200, body: { data: { ok: true } } };
          }
          return {
            status: 200,
            body: { artifact_filename: "remote-live.mp4" },
            artifact: { bytes: new Uint8Array([1, 2, 3]), filename: "remote-live.mp4" }
          };
        }
      }
    }
  });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const sessionResponse = await app.inject({ method: "GET", url: "/api/session", headers: { host: HOST } });
  const requestHeaders = headers({ cookie: sessionResponse.headers["set-cookie"], token: sessionResponse.json().token });
  const batchId = "batch-live-run";
  const manifestRelativePath = `batches/${batchId}/capture/manifest.json`;
  const manifestPath = path.join(root, manifestRelativePath);
  const productImagePath = path.join(root, "batches", batchId, "uploads", "product.png");
  await mkdir(path.dirname(productImagePath), { recursive: true });
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(productImagePath, "image");
  await writeFile(manifestPath, JSON.stringify({
    schema_version: 1,
    sanitized: true,
    source: "test",
    captured_at: "2026-07-17T00:00:00.000Z",
    steps: [
      {
        id: "asset",
        phase: "asset_generation",
        method: "POST",
        url_template: "https://hiflyworks-api.lingverse.co/assets",
        placeholders: ["{{product_image_path}}"],
        request_template: { body: { product: "{{product_image_path}}" } },
        response: { status: 200, body: { data: { asset_id: "asset-live" } } },
        produces: { asset_id: "$response.body.data.asset_id" },
        risk: { requires_auth: true, may_consume_points: true, replayability: "unknown" }
      },
      {
        id: "submit",
        phase: "remote_submit",
        method: "POST",
        url_template: "https://hiflyworks-api.lingverse.co/videos",
        placeholders: ["{{asset_id}}"],
        request_template: { body: { gen_id: "{{asset_id}}" } },
        response: { status: 200, body: { data: { work_id: "remote-live" } } },
        produces: { remote_id: "$response.body.data.work_id" },
        risk: { requires_auth: true, may_consume_points: true, replayability: "unknown" }
      },
      {
        id: "poll",
        phase: "remote_query",
        method: "GET",
        url_template: "https://hiflyworks-api.lingverse.co/videos/{{remote_id}}",
        placeholders: ["{{remote_id}}"],
        response: { status: 200, body: { data: { ok: true } } },
        risk: { requires_auth: true, may_consume_points: false, replayability: "unknown" }
      },
      {
        id: "download",
        phase: "download",
        method: "GET",
        url_template: "https://hiflyworks-api.lingverse.co/videos/{{remote_id}}/download",
        placeholders: ["{{remote_id}}"],
        response: { status: 200, body: { artifact_filename: "remote-live.mp4" } },
        produces: { artifact_filename: "$response.body.artifact_filename" },
        risk: { requires_auth: true, may_consume_points: false, replayability: "unknown" }
      }
    ]
  }));
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: batchId,
    status: "completed",
    uploads: [],
    items: [{
      task_id: "task-live-run",
      sku: "LIVE-1",
      product_name: "Live Product",
      image_path: productImagePath,
      status: "pending"
    }],
    capture: { enabled: true, status: "dry_run_passed", manifest_path: manifestRelativePath }
  });
  const response = await app.inject({
    method: "POST",
    url: `/api/batches/${batchId}/capture/live-run`,
    headers: requestHeaders,
    payload: { allowRealLive: true, acknowledgePointRisk: true, limitItems: 1 }
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.batch.capture.status, "real_live_completed");
  assert.equal(body.batch.capture.live_summary.remote_id, "remote-live");
  assert.equal(body.batch.capture.live_summary.artifact_relative_path, "artifacts/remote-live.mp4");
  assert.equal(JSON.stringify(body).includes("sid=memory-only"), false);
  assert.equal(JSON.stringify(body).includes("/videos/remote-live/download"), false);
  assert.equal(calls.length, 4);
  const artifact = await readFile(path.join(root, "batches", batchId, "artifacts", "remote-live.mp4"));
  assert.deepEqual([...artifact], [1, 2, 3]);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node --test test/server-capture-api.test.js
```

Expected: FAIL because `/capture/live-run` does not exist or route injection is unsupported.

- [ ] **Step 3: Extend workflow state**

Modify `src/rpa/capture/workflow-state.js`:

```js
const CAPTURE_STATUSES = new Set([
  "disabled",
  "not_started",
  "recording",
  "recorded",
  "extracted",
  "redacted",
  "replay_passed",
  "replay_failed",
  "dry_run_passed",
  "dry_run_failed",
  "real_live_disabled",
  "real_live_running",
  "real_live_completed",
  "real_live_failed"
]);
```

Extend public projection to include safe summary:

```js
if (state.live_summary && typeof state.live_summary === "object") {
  result.live_summary = {};
  if (Number.isInteger(state.live_summary.executed_step_count)) result.live_summary.executed_step_count = state.live_summary.executed_step_count;
  if (typeof state.live_summary.remote_id === "string") result.live_summary.remote_id = state.live_summary.remote_id;
  if (isSafeProjectRelativePath(state.live_summary.artifact_relative_path)) {
    result.live_summary.artifact_relative_path = state.live_summary.artifact_relative_path;
  }
}
```

- [ ] **Step 4: Add route dependency seam**

Modify `src/server/app.js` so `buildApp()` accepts a `captureLive` option and passes it to `registerCaptureRoutes()`:

```js
await registerCaptureRoutes(app, {
  batchRoot,
  store,
  captureLive
});
```

Keep default `captureLive` undefined.

- [ ] **Step 5: Implement live-run route**

Modify imports in `src/server/routes/capture.js`:

```js
import { createCaptureHttpExecutor } from "../../executors/capture-http-executor.js";
import { createFetchLiveTransport } from "../../rpa/capture/fetch-live-transport.js";
import { createPlaywrightRuntimeAuthProvider } from "../../rpa/capture/playwright-runtime-auth.js";
import { loadConfig, resolveFromRoot } from "../../config.js";
import { chromium } from "playwright";
```

Add helpers:

```js
function liveFailure(code = "CAPTURE_HTTP_REAL_LIVE_FAILED") {
  return { code, message: "Unable to complete the real HTTP capture run." };
}

function assertLivePayload(body) {
  if (body?.allowRealLive !== true) throw captureError("CAPTURE_HTTP_REAL_LIVE_NOT_AUTHORIZED", 409);
  if (body?.acknowledgePointRisk !== true) throw captureError("CAPTURE_HTTP_POINT_RISK_NOT_ACKNOWLEDGED", 409);
  if (body?.limitItems !== 1) throw captureError("CAPTURE_HTTP_SINGLE_ITEM_REQUIRED", 409);
}
```

Implement route:

```js
app.post("/api/batches/:batchId/capture/live-run", async (request) => {
  const batchId = assertBatchId(request.params.batchId);
  assertLivePayload(request.body);
  const batch = await readCaptureBatch(batchId);
  if (!batch.capture?.manifest_path) throw captureError("CAPTURE_MANIFEST_MISSING", 409);
  const runnableItems = (batch.items || []).filter((item) => item.status !== "completed");
  if (runnableItems.length !== 1) throw captureError("CAPTURE_HTTP_SINGLE_ITEM_REQUIRED", 409);
  const task = runnableItems[0];
  const root = path.dirname(batchRoot);
  const generationConfig = loadConfig(root);
  const liveConfig = {
    ...(generationConfig.rpa?.realLive || {}),
    enabled: captureLive?.enabled === true || generationConfig.rpa?.realLive?.enabled === true
  };
  if (liveConfig.enabled !== true) throw captureError("CAPTURE_HTTP_REAL_LIVE_DISABLED", 409);
  const authProvider = captureLive?.authProvider || createPlaywrightRuntimeAuthProvider({
    chromium,
    profileDir: resolveFromRoot(generationConfig, generationConfig.browser.profileDir)
  });
  const runtimeAuth = await authProvider.getRuntimeAuth();
  const transport = captureLive?.transport || createFetchLiveTransport();
  await store.update(batchId, (current) => ({
    ...current,
    capture: updateCaptureState(current.capture, { enabled: true, status: "real_live_running", live_error: null })
  }));
  try {
    const executor = createCaptureHttpExecutor({
      root,
      config: {
        ...generationConfig,
        rpa: {
          ...(generationConfig.rpa || {}),
          mode: "capture_http",
          manifestPath: batch.capture.manifest_path,
          captureHttpMode: "real_live",
          realLive: liveConfig
        }
      }
    });
    const context = {
      batchId,
      taskId: task.task_id,
      realLive: {
        allowRealLive: true,
        acknowledgePointRisk: true,
        runtimeAuth,
        transport
      }
    };
    const asset = await executor.createAsset(task, context);
    const submitted = await executor.submitVideo(task, asset, context);
    const ready = await executor.querySubmission(submitted.remoteEvidence, context);
    const artifact = await executor.downloadArtifact(ready.remoteEvidence, null, context);
    const updated = await store.update(batchId, (current) => ({
      ...current,
      status: "completed",
      capture: updateCaptureState(current.capture, {
        enabled: true,
        status: "real_live_completed",
        live_error: null,
        live_summary: {
          executed_step_count: 4,
          remote_id: ready.remoteEvidence.remote_id,
          artifact_relative_path: artifact.relative_path
        }
      })
    }));
    return { batch: publicBatch(updated) };
  } catch (error) {
    const updated = await store.update(batchId, (current) => ({
      ...current,
      capture: updateCaptureState(current.capture, {
        enabled: true,
        status: "real_live_failed",
        live_error: liveFailure(error?.code)
      })
    }));
    return { batch: publicBatch(updated) };
  }
});
```

If `loadConfig(root)` is not currently exported as named above, use the existing config module’s exported names and adapt exactly; do not duplicate config parsing.

- [ ] **Step 6: Verify Task 4**

Run:

```bash
node --test test/server-capture-api.test.js test/capture-http-executor.test.js test/rpa-fetch-live-transport.test.js test/playwright-runtime-auth.test.js
npm run check
git diff --check
```

Expected: all pass.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/rpa/capture/workflow-state.js src/server/routes/capture.js src/server/app.js test/server-capture-api.test.js
git commit -m "feat(gui capture): add live-run API"
```

---

### Task 5: Expose real-live execution in GUI

**Files:**
- Modify: `web/api.js`
- Modify: `web/app.js`
- Test: `test/gui-smoke.test.js`

**Interfaces:**
- Consumes: Task 4 `POST /api/batches/:batchId/capture/live-run`
- Produces: GUI button and confirmation flow for a one-item real-live run.

- [ ] **Step 1: Write failing GUI smoke test**

Append to `test/gui-smoke.test.js`:

```js
test("capture GUI enables real-live action only with risk confirmation", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-gui-live-"));
  let liveRunCalls = 0;
  let server = null;
  let browser = null;
  t.after(async () => {
    await browser?.close();
    await server?.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-gui-live",
    status: "completed",
    items: [{ task_id: "task-live", sku: "LIVE", product_name: "真实 HTTP 商品", status: "pending" }],
    uploads: [],
    capture: {
      enabled: true,
      status: "dry_run_passed",
      manifest_path: "batches/batch-gui-live/capture/manifest.json",
      dry_run_summary: { executed_step_count: 4, request_plan: [] }
    }
  });
  try {
    server = await startServer({
      root,
      executor: createFakeExecutor(),
      openBrowser: async () => {},
      handleSignals: false,
      captureLive: {
        enabled: true,
        authProvider: { getRuntimeAuth: async () => ({ headers: { cookie: "sid=memory" }, cookie_count: 1 }) },
        transport: { request: async () => { liveRunCalls += 1; return { status: 200, body: {} }; } }
      }
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("sandbox disallows local TCP listening");
      return;
    }
    throw error;
  }
  try {
    browser = await chromium.launch();
  } catch (error) {
    if (error?.message?.includes("Executable doesn't exist") || error?.message?.includes("browserType.launch")) {
      t.skip("Playwright browser is unavailable in this environment");
      return;
    }
    throw error;
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(server.url);
  await assertVisible(page.getByRole("heading", { name: "待执行任务" }));
  const liveButton = page.getByRole("button", { name: "真实 HTTP 生成（会访问飞影，可能消耗积分）" });
  await assertVisible(liveButton);
  await liveButton.click();
  await assertVisible(page.getByText("此操作会真实访问飞影并可能消耗积分"));
  page.on("dialog", (dialog) => dialog.dismiss());
  assert.equal(liveRunCalls, 0);
});
```

If existing GUI uses `window.confirm` instead of a custom modal, replace the dialog section with:

```js
page.once("dialog", async (dialog) => {
  assert.match(dialog.message(), /真实访问飞影.*消耗积分/);
  await dialog.dismiss();
});
await liveButton.click();
assert.equal(liveRunCalls, 0);
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
node --test test/gui-smoke.test.js
```

Expected: FAIL because the button remains disabled or API method is missing.

- [ ] **Step 3: Add API method**

Modify `web/api.js`:

```js
window.HiflyApi = {
  ensureSession,
  getRuntime: () => request("/api/runtime"),
  getBatches: () => request("/api/batches"),
  createBatch: (payload = {}) => request("/api/batches", {
    method: "POST",
    body: JSON.stringify(typeof payload === "string" ? { batchId: payload } : payload)
  }),
  importBatch: (formData, options = {}) => {
    if (options.person_strategy !== undefined) formData.append("person_strategy", options.person_strategy);
    if (options.script_strategy !== undefined) formData.append("script_strategy", options.script_strategy);
    if (options.capture?.enabled === true) formData.append("capture_enabled", "true");
    return request("/api/imports", { method: "POST", body: formData });
  },
  retryBatch: ({ batchId, allowUnknown = false }) => request(`/api/batches/${encodeURIComponent(batchId)}/retry`, {
    method: "POST",
    body: JSON.stringify({ confirm: true, ...(allowUnknown ? { allowUnknown: true } : {}) })
  }),
  extractCapture: (batchId) => request(`/api/batches/${encodeURIComponent(batchId)}/capture/extract`, {
    method: "POST",
    body: JSON.stringify({})
  }),
  redactCapture: (batchId) => request(`/api/batches/${encodeURIComponent(batchId)}/capture/redact`, {
    method: "POST",
    body: JSON.stringify({})
  }),
  replayCapture: (batchId) => request(`/api/batches/${encodeURIComponent(batchId)}/capture/replay`, {
    method: "POST",
    body: JSON.stringify({})
  }),
  dryRunCapture: (batchId) => request(`/api/batches/${encodeURIComponent(batchId)}/capture/dry-run`, {
    method: "POST",
    body: JSON.stringify({})
  }),
  runLiveCapture: (batchId) => request(`/api/batches/${encodeURIComponent(batchId)}/capture/live-run`, {
    method: "POST",
    body: JSON.stringify({
      allowRealLive: true,
      acknowledgePointRisk: true,
      limitItems: 1
    })
  }),
  startExecution: ({ batchId, idempotencyKey }) => request("/api/executions", {
    method: "POST",
    body: JSON.stringify({ batchId, idempotencyKey, confirm: true })
  })
};
```

Use the file’s existing `request()` and export style exactly.

- [ ] **Step 4: Replace disabled button with gated button**

Modify `web/app.js`:

```js
function canRunRealLive(batch) {
  const capture = batch.capture || {};
  const activeItems = (batch.items || []).filter((item) => item.status !== "completed");
  return ["dry_run_passed", "real_live_failed"].includes(capture.status) && activeItems.length === 1;
}

function realLiveButton(batch) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost-button danger-button";
  const enabled = canRunRealLive(batch);
  button.dataset.disabled = enabled ? "false" : "true";
  button.disabled = state.busy || !enabled;
  button.title = enabled ? "本次只执行 1 条商品" : "需真实请求预演通过，且批次只能包含 1 条待执行商品";
  setText(button, "真实 HTTP 生成（会访问飞影，可能消耗积分）");
  button.addEventListener("click", () => runCaptureAction(batch.batch_id, "liveRun"));
  return button;
}
```

Replace `disabledRealLiveButton()` call with `realLiveButton(batch)`.

- [ ] **Step 5: Add confirmation inside runCaptureAction**

Modify `runCaptureAction()`:

```js
async function runCaptureAction(batchId, action) {
  const methods = {
    extract: api.extractCapture,
    redact: api.redactCapture,
    replay: api.replayCapture,
    dryRun: api.dryRunCapture,
    liveRun: api.runLiveCapture
  };
  if (action === "liveRun") {
    const approved = window.confirm("此操作会真实访问飞影并可能消耗积分。本次只执行 1 条商品。确认继续？");
    if (!approved) return;
  }
  setBusy(true);
  try {
    const payload = await methods[action](batchId);
    state.selectedBatchId = payload.batch.batch_id;
    await refreshBatches({ silent: true });
    showToast(`抓包工作流已更新：${captureStatusLabel(payload.batch.capture?.status)}`);
  } catch (error) {
    showToast(`抓包处理失败：${error.message}`);
  } finally {
    setBusy(false);
  }
}
```

- [ ] **Step 6: Display live status**

In capture panel summary loop, add:

```js
capture.live_summary?.executed_step_count ? `真实 HTTP 步骤数：${capture.live_summary.executed_step_count}` : "",
capture.live_summary?.remote_id ? `真实 HTTP 远端 ID：${capture.live_summary.remote_id}` : "",
capture.live_summary?.artifact_relative_path ? `真实 HTTP 产物：${capture.live_summary.artifact_relative_path}` : "",
capture.live_error ? `真实 HTTP 错误：${capture.live_error.message || "Unable to complete the real HTTP capture run."}` : "",
```

Extend `captureStatusLabel()` with:

```js
real_live_running: "真实 HTTP 生成中",
real_live_completed: "真实 HTTP 已完成",
real_live_failed: "真实 HTTP 失败"
```

- [ ] **Step 7: Verify Task 5**

Run:

```bash
node --test test/gui-smoke.test.js test/server-capture-api.test.js
npm run check
git diff --check
```

Expected: all pass.

- [ ] **Step 8: Commit Task 5**

```bash
git add web/api.js web/app.js test/gui-smoke.test.js
git commit -m "feat(gui capture): enable real-live run control"
```

---

### Task 6: Update docs, handoff, and operator runbook

**Files:**
- Modify: `docs/rpa/capture-runbook.md`
- Modify: `docs/PROJECT_HANDOFF.md`
- Modify: `config.example.json`

**Interfaces:**
- Consumes: Tasks 1-5 behavior.
- Produces: persistent handoff and operator docs for real-live execution.

- [ ] **Step 1: Update config example**

Keep `realLive.enabled` false, but add comments are not allowed in JSON. Ensure values remain:

```json
"realLive": {
  "enabled": false,
  "allowedHosts": ["hiflyworks-api.lingverse.co"],
  "timeoutMs": 30000
}
```

No secrets or cookies.

- [ ] **Step 2: Update runbook**

In `docs/rpa/capture-runbook.md`, update the real-live section:

```md
## 真实 HTTP 生成（real_live，需授权，可能消耗积分）

真实 HTTP 生成现在由 GUI 触发，但只允许已完成 `real_dry_run` 的单商品批次。Playwright 仅用于从现有 profile 临时读取登录 cookie，cookie 只在内存中使用，不写入 batch、manifest、日志或 git。

执行前必须确认：

1. 用户明确同意访问飞影并可能消耗积分。
2. 批次只有 1 条待执行商品。
3. `rpa.realLive.enabled=true` 只放在本地 `config.local.json`，不要提交。
4. GUI 二次确认真实 HTTP 风险。
5. 失败时先查看 GUI 稳定错误，不要重复从头生成。
```

- [ ] **Step 3: Update handoff**

Add a top section to `docs/PROJECT_HANDOFF.md`:

```md
## 2026-07-17 Capture HTTP real_live transport/API/GUI 已实现（真实联调待授权）

- 已新增 Node fetch transport、Playwright profile runtime-auth provider、`/capture/live-run` API 和 GUI 真实 HTTP 生成入口。
- 默认 `rpa.realLive.enabled=false`，未授权或配置未启用不会访问飞影。
- 真实执行仍限制为 1 条商品；Playwright 只提供内存 cookie，不点页面。
- 本轮本地测试未访问飞影、未发真实 HTTP、未消耗积分。真实 1 条联调仍需用户在执行当轮确认。
```

- [ ] **Step 4: Verify Task 6**

Run:

```bash
npm run check
git diff --check
```

Expected: pass.

- [ ] **Step 5: Commit Task 6**

```bash
git add config.example.json docs/rpa/capture-runbook.md docs/PROJECT_HANDOFF.md
git commit -m "docs: document capture real-live execution"
```

---

### Task 7: Final verification, review, push, and one-item live test gate

**Files:**
- No production changes unless review finds issues.
- May update `docs/PROJECT_HANDOFF.md` after real live test.

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: branch ready for GitHub and a clearly gated real 1-item live test.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
node --test test/rpa-fetch-live-transport.test.js test/playwright-runtime-auth.test.js test/rpa-capture-real-live-client.test.js test/capture-http-executor.test.js test/server-capture-api.test.js test/gui-smoke.test.js
```

Expected: all pass.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run check
git diff --check
```

Expected: all pass.

- [ ] **Step 3: Code review**

Use `code-review-and-quality` or subagent review. Review focus:

- No live network request can occur without GUI/API confirmation and `realLive.enabled=true`.
- Runtime cookies never persist.
- Public API never exposes raw URL, headers, body, response body, cookie, token, or absolute path.
- GUI wording clearly states point risk.
- Playwright fallback, mock, and `real_dry_run` still work.

- [ ] **Step 4: Push branch**

Run:

```bash
git status --short --branch
git push origin codex/yingdao-rpa-version
```

Expected: branch pushed; unrelated `.superpowers/sdd/task-6-report.md` and `docs/resume/` remain uncommitted.

- [ ] **Step 5: Ask for live test authorization**

Before running any real live test, ask:

```text
现在可以进行 1 条真实 HTTP 出片联调。它会访问飞影并可能消耗积分。是否允许只跑 1 条？
```

Do not run live test until the user explicitly approves in that turn.

- [ ] **Step 6: Run one-item live test after approval**

Prerequisites:

- GUI running.
- `config.local.json` locally has `rpa.realLive.enabled=true`.
- A single-item capture batch is `dry_run_passed`.
- User explicitly approved point risk.

Use GUI button first. If GUI cannot be used, use the local API with the current session token, never passing cookie/header runtimeAuth from the client.

Record in `docs/PROJECT_HANDOFF.md`:

```md
## 2026-07-17 Capture HTTP real_live 1 条真实联调结果

- Batch:
- SKU:
- Manifest:
- Remote ID:
- Artifact relative path:
- Result:
- Points: may have been consumed; final number should be checked in Hifly.
- Notes:
```

- [ ] **Step 7: Commit live-test handoff record if a live test was run**

```bash
git add docs/PROJECT_HANDOFF.md
git commit -m "docs: record capture real-live validation"
git push origin codex/yingdao-rpa-version
```

Do not commit batches, downloads, logs, screenshots, HAR, or `config.local.json`.

---

## Self-Review

- Spec coverage: The plan covers real transport, Playwright runtime auth, artifact writing, live-run API, GUI execution, docs, final review, and the explicit one-item live test gate.
- Placeholder scan: The plan contains no TBD/TODO placeholders. The only conditional note is an implementation adaptation for existing config exports, which points to the exact module and expected behavior.
- Type consistency: `runtimeAuth`, `transport.request()`, `realLive` context, `live_summary`, and `/capture/live-run` names are consistent across tasks.
- Safety check: No task asks workers to commit secrets, raw HAR, batches, downloads, logs, screenshots, outputs, `config.local.json`, or runtime cookies. The real live test is explicitly gated after implementation and push.
