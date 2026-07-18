# Capture HTTP real_live Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a gated `real_live` capture HTTP scaffold that is testable with fake transport but cannot send real Hifly network requests or consume points by default.

**Architecture:** Extend the capture HTTP client factory with a `real_live` client that reuses the existing step runtime and request-plan construction, but routes all network behavior through an injected transport. The executor and GUI expose only disabled/not-authorized status in this phase; Playwright remains the default production path and `mock` / `real_dry_run` behavior must not regress.

**Tech Stack:** Node.js ESM, built-in `node:test`, Fastify injection tests, existing capture manifest/runtime modules, local GUI vanilla JS.

## Global Constraints

- Default `executionBackend` remains `playwright`; do not switch production execution to `capture_http`.
- `real_live` must not call real `fetch`, `http`, `https`, `net`, browser APIs, or Hifly endpoints in this phase.
- No new Hifly access, no real HTTP, no point consumption, no real video generation.
- Do not persist runtime auth, cookies, authorization headers, tokens, secrets, raw request bodies, raw URLs, or raw responses to batch JSON, logs, docs, or git.
- Do not commit raw HAR, batches, outputs, downloads, logs, screenshots, `config.local.json`, `node_modules`, or `docs/resume/`.
- Public batch APIs continue to expose only safe summaries: step id, phase, method, host, placeholders, and risk flags.
- Artifact writes must keep the existing basename, symlink, exclusive-open, and containment protections.
- All live errors must be stable `{ code, message }` values and must not include local paths, URLs, headers, bodies, cookies, tokens, or original exception messages.
- Tests must prove fake transport can be used without network and disabled/unauthorized modes do not call transport.

---

## File Structure

- Create `src/rpa/capture/real-live-http-client.js`: gated live client, disabled transport, fake-transport-friendly request flow, stable errors.
- Modify `src/rpa/capture/http-client-factory.js`: pass config/runtimeAuth/transport/options into `real_live`; preserve `mock` and `real_dry_run`.
- Modify `src/executors/capture-http-executor.js`: pass real-live options from config/context to client factory without persisting secrets.
- Modify `src/server/routes/capture.js`: expose a safe disabled/not-authorized API endpoint or status path for GUI real-live readiness, without executing network.
- Modify `web/app.js`: show clear disabled/pending authorization copy separate from “真实请求预演”.
- Modify `docs/rpa/capture-runbook.md` and `docs/PROJECT_HANDOFF.md`: document scaffold status and no-network boundary.
- Add tests:
  - `test/rpa-capture-real-live-client.test.js`
  - Extend `test/rpa-capture-http-client-factory.test.js`
  - Extend `test/capture-http-executor.test.js`
  - Extend `test/server-capture-api.test.js`
  - Extend `test/gui-smoke.test.js`

---

### Task 1: Add gated real_live client and transport boundary

**Files:**
- Create: `src/rpa/capture/real-live-http-client.js`
- Modify: `src/rpa/capture/http-client-factory.js`
- Test: `test/rpa-capture-real-live-client.test.js`
- Test: `test/rpa-capture-http-client-factory.test.js`

**Interfaces:**
- Consumes: `findStep(manifest, stepId)`, `assertStepPlaceholders(step, variables)`, `substituteCaptureValue(value, variables)`, `extractProducedVariables(produces, responseBody)`.
- Produces:
  - `createRealLiveHttpClient({ manifest, config, runtimeAuth, transport })`
  - client method `request({ stepId, variables = {}, context = {} })`
  - factory support `createCaptureHttpClient({ mode: "real_live", manifest, config, runtimeAuth, transport })`

- [ ] **Step 1: Write failing client tests**

Create `test/rpa-capture-real-live-client.test.js` with tests for disabled, unauthorized, point-risk, auth-required, host allowlist, and fake transport success:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { createRealLiveHttpClient } from "../src/rpa/capture/real-live-http-client.js";

function manifestWith(stepPatch = {}) {
  return {
    schema_version: 1,
    sanitized: true,
    source: "test",
    captured_at: "2026-07-17T00:00:00.000Z",
    steps: [{
      id: "submit_video",
      phase: "remote_submit",
      method: "POST",
      url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos",
      placeholders: ["{{asset_id}}"],
      request_template: { headers: { "content-type": "application/json" }, body: { gen_id: "{{asset_id}}" } },
      response: { status: 200, body: { code: 0, data: { list: [{ id: 123, status: 1 }] } } },
      produces: { remote_id: "$response.body.data.list.0.id" },
      risk: { requires_auth: true, may_consume_points: true, replayability: "unknown" },
      ...stepPatch
    }]
  };
}

test("real_live is disabled by default before any transport call", async () => {
  let called = false;
  const client = createRealLiveHttpClient({
    manifest: manifestWith(),
    transport: { request: async () => { called = true; return { status: 200, body: {} }; } }
  });
  await assert.rejects(
    client.request({ stepId: "submit_video", variables: { asset_id: "asset-1" }, context: { allowRealLive: true, acknowledgePointRisk: true } }),
    { code: "CAPTURE_HTTP_REAL_LIVE_DISABLED" }
  );
  assert.equal(called, false);
});

test("real_live requires per-run authorization", async () => {
  let called = false;
  const client = createRealLiveHttpClient({
    manifest: manifestWith(),
    config: { enabled: true },
    runtimeAuth: { headers: { cookie: "in-memory-only" } },
    transport: { request: async () => { called = true; return { status: 200, body: {} }; } }
  });
  await assert.rejects(
    client.request({ stepId: "submit_video", variables: { asset_id: "asset-1" }, context: { acknowledgePointRisk: true } }),
    { code: "CAPTURE_HTTP_REAL_LIVE_NOT_AUTHORIZED" }
  );
  assert.equal(called, false);
});

test("real_live requires point-risk acknowledgement for point-consuming steps", async () => {
  let called = false;
  const client = createRealLiveHttpClient({
    manifest: manifestWith(),
    config: { enabled: true },
    runtimeAuth: { headers: { cookie: "in-memory-only" } },
    transport: { request: async () => { called = true; return { status: 200, body: {} }; } }
  });
  await assert.rejects(
    client.request({ stepId: "submit_video", variables: { asset_id: "asset-1" }, context: { allowRealLive: true } }),
    { code: "CAPTURE_HTTP_POINT_RISK_NOT_ACKNOWLEDGED" }
  );
  assert.equal(called, false);
});

test("real_live requires runtime auth for auth-required steps", async () => {
  let called = false;
  const client = createRealLiveHttpClient({
    manifest: manifestWith(),
    config: { enabled: true },
    transport: { request: async () => { called = true; return { status: 200, body: {} }; } }
  });
  await assert.rejects(
    client.request({ stepId: "submit_video", variables: { asset_id: "asset-1" }, context: { allowRealLive: true, acknowledgePointRisk: true } }),
    { code: "CAPTURE_HTTP_AUTH_REQUIRED" }
  );
  assert.equal(called, false);
});

test("real_live rejects hosts outside the allowlist before transport", async () => {
  let called = false;
  const client = createRealLiveHttpClient({
    manifest: manifestWith({ url_template: "https://example.invalid/api?asset={{asset_id}}" }),
    config: { enabled: true, allowedHosts: ["hiflyworks-api.lingverse.co"] },
    runtimeAuth: { headers: { cookie: "in-memory-only" } },
    transport: { request: async () => { called = true; return { status: 200, body: {} }; } }
  });
  await assert.rejects(
    client.request({ stepId: "submit_video", variables: { asset_id: "asset-1" }, context: { allowRealLive: true, acknowledgePointRisk: true } }),
    { code: "CAPTURE_HTTP_HOST_NOT_ALLOWED" }
  );
  assert.equal(called, false);
});

test("real_live fake transport produces variables without using network APIs", async () => {
  const calls = [];
  const client = createRealLiveHttpClient({
    manifest: manifestWith({ risk: { requires_auth: false, may_consume_points: false, replayability: "unknown" } }),
    config: { enabled: true },
    transport: {
      request: async (request) => {
        calls.push(request);
        return { status: 200, headers: {}, body: { code: 0, data: { list: [{ id: 987, status: 1 }] } } };
      }
    }
  });
  const result = await client.request({
    stepId: "submit_video",
    variables: { asset_id: "asset-1" },
    context: { allowRealLive: true, acknowledgePointRisk: true }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos");
  assert.deepEqual(calls[0].body, { gen_id: "asset-1" });
  assert.equal(result.produced.remote_id, 987);
  assert.equal(result.request_plan.host, "hiflyworks-api.lingverse.co");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test test/rpa-capture-real-live-client.test.js
```

Expected: FAIL because `src/rpa/capture/real-live-http-client.js` does not exist.

- [ ] **Step 3: Implement the real_live client**

Create `src/rpa/capture/real-live-http-client.js`:

```js
import { findStep } from "./manifest.js";
import {
  assertStepPlaceholders,
  extractProducedVariables,
  substituteCaptureValue
} from "./step-runtime.js";

const DEFAULT_ALLOWED_HOSTS = new Set(["hiflyworks-api.lingverse.co"]);

function fail(code, message) {
  throw Object.assign(new Error(message || code), { code });
}

function placeholderNames(placeholders = []) {
  return placeholders.map((placeholder) => placeholder.replace(/^\{\{|\}\}$/g, ""));
}

function riskFlags(risk = {}) {
  const flags = [];
  if (risk.requires_auth === true) flags.push("auth_required");
  if (risk.may_consume_points === true) flags.push("may_consume_points");
  if (risk.replayability === "unknown") flags.push("replayability_unknown");
  if (risk.replayability === "api_unavailable") flags.push("api_unavailable");
  return flags;
}

function requestTemplate(step) {
  const template = step.request_template || {};
  return {
    headers: template.headers ? { ...template.headers } : {},
    body: template.body === undefined ? null : structuredClone(template.body)
  };
}

function hasRuntimeAuth(runtimeAuth) {
  return Boolean(
    runtimeAuth &&
    typeof runtimeAuth === "object" &&
    (
      runtimeAuth.headers && Object.keys(runtimeAuth.headers).length > 0 ||
      Array.isArray(runtimeAuth.cookies) && runtimeAuth.cookies.length > 0
    )
  );
}

function mergeRuntimeHeaders(headers, runtimeAuth) {
  return {
    ...headers,
    ...(runtimeAuth?.headers && typeof runtimeAuth.headers === "object" ? runtimeAuth.headers : {})
  };
}

function assertLiveGate({ config, context, step, url, runtimeAuth }) {
  if (config?.enabled !== true) {
    fail("CAPTURE_HTTP_REAL_LIVE_DISABLED", "real_live is disabled.");
  }
  if (context?.allowRealLive !== true) {
    fail("CAPTURE_HTTP_REAL_LIVE_NOT_AUTHORIZED", "real_live requires explicit per-run authorization.");
  }
  if (step.risk?.may_consume_points === true && context?.acknowledgePointRisk !== true) {
    fail("CAPTURE_HTTP_POINT_RISK_NOT_ACKNOWLEDGED", "This capture step may consume Hifly points.");
  }
  if (step.risk?.requires_auth === true && !hasRuntimeAuth(runtimeAuth)) {
    fail("CAPTURE_HTTP_AUTH_REQUIRED", "This capture step requires runtime authentication.");
  }
  const allowed = new Set(Array.isArray(config?.allowedHosts) ? config.allowedHosts : [...DEFAULT_ALLOWED_HOSTS]);
  if (!allowed.has(url.hostname)) {
    fail("CAPTURE_HTTP_HOST_NOT_ALLOWED", `Host is not allowed for real_live: ${url.hostname}`);
  }
}

function assertNoUnresolved(value) {
  const text = JSON.stringify(value);
  const unresolved = text.match(/\{\{[A-Za-z0-9_]+\}\}/g) || [];
  if (unresolved.length > 0) {
    fail("CAPTURE_HTTP_UNRESOLVED_PLACEHOLDER", `Unresolved placeholders: ${unresolved.join(", ")}`);
  }
}

export function createDisabledLiveTransport() {
  return {
    async request() {
      fail("CAPTURE_HTTP_REAL_LIVE_DISABLED", "No real_live transport is configured.");
    }
  };
}

export function createRealLiveHttpClient({
  manifest,
  config = {},
  runtimeAuth = null,
  transport = createDisabledLiveTransport()
} = {}) {
  if (!manifest || !Array.isArray(manifest.steps)) {
    throw new TypeError("createRealLiveHttpClient requires a parsed manifest");
  }
  if (!transport || typeof transport.request !== "function") {
    throw new TypeError("real_live transport must provide request()");
  }
  return {
    async request({ stepId, variables = {}, context = {} }) {
      const step = findStep(manifest, stepId);
      if (!step) fail("CAPTURE_STEP_NOT_FOUND", `Unknown capture step: ${stepId}`);
      if (step.risk?.replayability === "api_unavailable") {
        fail("CAPTURE_HTTP_API_UNAVAILABLE", `Capture step is not replayable: ${stepId}`);
      }
      try {
        assertStepPlaceholders(step, variables);
      } catch (error) {
        if (error?.code === "CAPTURE_MISSING_VARIABLE") {
          fail("CAPTURE_HTTP_UNRESOLVED_PLACEHOLDER", error.message);
        }
        throw error;
      }
      const resolvedUrl = substituteCaptureValue(step.url_template, variables);
      const template = requestTemplate(step);
      const templateHeaders = substituteCaptureValue(template.headers, variables);
      const body = substituteCaptureValue(template.body, variables);
      assertNoUnresolved({ resolvedUrl, templateHeaders, body });
      const url = new URL(resolvedUrl);
      assertLiveGate({ config, context, step, url, runtimeAuth });
      const headers = mergeRuntimeHeaders(templateHeaders, runtimeAuth);
      const response = await transport.request({
        step,
        method: step.method,
        url: url.href,
        headers,
        body,
        timeoutMs: config.timeoutMs || 30000
      });
      const responseBody = response?.body ?? {};
      const produced = extractProducedVariables(step.produces, responseBody);
      return {
        status: response?.status ?? step.response.status,
        body: responseBody,
        produced,
        request_plan: {
          step_id: step.id,
          phase: step.phase,
          method: step.method,
          host: url.hostname,
          path: `${url.pathname}${url.search}`,
          url: url.href,
          headers: templateHeaders,
          body,
          placeholders: placeholderNames(step.placeholders),
          risk_flags: riskFlags(step.risk)
        }
      };
    }
  };
}
```

- [ ] **Step 4: Wire the factory**

Modify `src/rpa/capture/http-client-factory.js` to import and use the client:

```js
import { createDryRunHttpClient } from "./dry-run-http-client.js";
import { createMockHttpClient } from "./mock-http-client.js";
import { createRealLiveHttpClient } from "./real-live-http-client.js";

export const CAPTURE_HTTP_MODES = Object.freeze(["mock", "real_dry_run", "real_live"]);

function fail(code, message) {
  throw Object.assign(new Error(message || code), { code });
}

export function normalizeCaptureHttpMode(mode) {
  const value = mode === undefined ? "mock" : mode;
  if (!CAPTURE_HTTP_MODES.includes(value)) {
    fail("CAPTURE_HTTP_MODE_INVALID", `Unsupported captureHttpMode: ${value}`);
  }
  return value;
}

export function createCaptureHttpClient({ mode, manifest, config, runtimeAuth, transport } = {}) {
  const normalized = normalizeCaptureHttpMode(mode);
  if (normalized === "mock") return createMockHttpClient({ manifest });
  if (normalized === "real_dry_run") return createDryRunHttpClient({ manifest });
  if (normalized === "real_live") return createRealLiveHttpClient({ manifest, config, runtimeAuth, transport });
  fail("CAPTURE_HTTP_MODE_INVALID", `Unsupported captureHttpMode: ${mode}`);
}
```

- [ ] **Step 5: Add factory regression tests**

Extend `test/rpa-capture-http-client-factory.test.js`:

```js
test("factory creates gated real_live mode", async () => {
  const manifest = {
    schema_version: 1,
    sanitized: true,
    source: "test",
    captured_at: "2026-07-17T00:00:00.000Z",
    steps: [{
      id: "live_step",
      phase: "remote_query",
      method: "GET",
      url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/status?id={{remote_id}}",
      placeholders: ["{{remote_id}}"],
      response: { status: 200, body: { data: { id: 12 } } },
      produces: {},
      risk: { requires_auth: false, may_consume_points: false, replayability: "unknown" }
    }]
  };
  let called = false;
  const client = createCaptureHttpClient({
    mode: "real_live",
    manifest,
    config: { enabled: true },
    transport: { request: async () => { called = true; return { status: 200, body: { data: { id: 12 } } }; } }
  });
  await client.request({ stepId: "live_step", variables: { remote_id: "r-1" }, context: { allowRealLive: true } });
  assert.equal(called, true);
});
```

- [ ] **Step 6: Run Task 1 tests**

Run:

```bash
node --test test/rpa-capture-real-live-client.test.js test/rpa-capture-http-client-factory.test.js
npm run check
git diff --check
```

Expected: all pass.

- [ ] **Step 7: Commit Task 1**

```bash
git add src/rpa/capture/real-live-http-client.js src/rpa/capture/http-client-factory.js test/rpa-capture-real-live-client.test.js test/rpa-capture-http-client-factory.test.js
git commit -m "feat(rpa capture): add gated real-live client"
```

---

### Task 2: Pass real_live options through the executor without persisting secrets

**Files:**
- Modify: `src/executors/capture-http-executor.js`
- Test: `test/capture-http-executor.test.js`

**Interfaces:**
- Consumes: `createCaptureHttpClient({ mode, manifest, config, runtimeAuth, transport })` from Task 1.
- Produces: executor support for `config.rpa.realLive`, `config.rpa.realLiveTransport`, and per-call `context.realLive` options.

- [ ] **Step 1: Write failing executor tests**

Add tests to `test/capture-http-executor.test.js`:

```js
test("capture_http real_live refuses to run without per-run authorization before transport", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-http-real-live-disabled-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const batchDirectory = path.join(root, "batches", "batch-real-live-disabled");
  await mkdir(batchDirectory, { recursive: true });
  const manifestPath = path.join(root, "manifest.json");
  await writeFile(manifestPath, JSON.stringify({
    schema_version: 1,
    sanitized: true,
    source: "test",
    captured_at: "2026-07-17T00:00:00.000Z",
    steps: [{
      id: "submit_video",
      phase: "asset_generation",
      method: "POST",
      url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos",
      request_template: { body: { product: "{{product_image_path}}" } },
      placeholders: ["{{product_image_path}}"],
      response: { status: 200, body: { data: { gen_id: "asset-1" } } },
      produces: { asset_id: "$response.body.data.gen_id" },
      risk: { requires_auth: false, may_consume_points: true, replayability: "unknown" }
    }]
  }), "utf8");
  let called = false;
  const executor = createCaptureHttpExecutor({
    root,
    config: {
      rpa: {
        mode: "capture_http",
        manifestPath,
        captureHttpMode: "real_live",
        realLive: { enabled: true },
        realLiveTransport: { request: async () => { called = true; return { status: 200, body: {} }; } }
      }
    }
  });
  const task = taskFixture({ task_id: "task-real-live-disabled", execution_key: "key-real-live-disabled" });
  await assert.rejects(
    executor.createAsset(task, { batchId: "batch-real-live-disabled" }),
    { code: "CAPTURE_HTTP_REAL_LIVE_NOT_AUTHORIZED" }
  );
  assert.equal(called, false);
});
```

Add a second test proving fake transport can run only with explicit context:

```js
test("capture_http real_live fake transport runs only with explicit authorization", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-http-real-live-fake-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const batchDirectory = path.join(root, "batches", "batch-real-live-fake");
  await mkdir(batchDirectory, { recursive: true });
  const manifestPath = path.join(root, "manifest.json");
  await writeFile(manifestPath, JSON.stringify({
    schema_version: 1,
    sanitized: true,
    source: "test",
    captured_at: "2026-07-17T00:00:00.000Z",
    steps: [{
      id: "create_asset",
      phase: "asset_generation",
      method: "POST",
      url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/upload_url",
      placeholders: ["{{product_image_path}}"],
      request_template: { body: { product: "{{product_image_path}}" } },
      response: { status: 200, body: { data: { gen_id: "asset-from-live" } } },
      produces: { asset_id: "$response.body.data.gen_id" },
      risk: { requires_auth: false, may_consume_points: false, replayability: "unknown" }
    }]
  }), "utf8");
  const calls = [];
  const executor = createCaptureHttpExecutor({
    root,
    config: {
      rpa: {
        mode: "capture_http",
        manifestPath,
        captureHttpMode: "real_live",
        realLive: { enabled: true },
        realLiveTransport: {
          request: async (request) => {
            calls.push(request);
            return { status: 200, body: { data: { gen_id: "asset-from-live" } } };
          }
        }
      }
    }
  });
  const task = taskFixture({ task_id: "task-real-live-fake", execution_key: "key-real-live-fake" });
  const asset = await executor.createAsset(task, {
    batchId: "batch-real-live-fake",
    realLive: { allowRealLive: true, acknowledgePointRisk: true }
  });
  assert.equal(asset.asset_id, "asset-from-live");
  assert.equal(calls.length, 1);
  const state = await readRpaState(batchDirectory, task.task_id);
  assert.equal(state.capture_http_mode, "real_live");
  assert.equal(JSON.stringify(state).includes("cookie"), false);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test test/capture-http-executor.test.js
```

Expected: second test fails until executor passes `realLive` context/config to the client.

- [ ] **Step 3: Modify executor client construction**

In `src/executors/capture-http-executor.js`, update `ensureClient()` and `replayPhase()`:

```js
async function ensureClient({ runtimeAuth = null, transport = null } = {}) {
  if (!clientCache || captureHttpMode === "real_live") {
    if (!manifestCache) {
      if (!rpa.manifestPath) {
        throw Object.assign(new Error("rpa.manifestPath is required for capture_http mode"), {
          code: "CAPTURE_MANIFEST_MISSING"
        });
      }
      const resolved = path.isAbsolute(rpa.manifestPath) ? rpa.manifestPath : path.resolve(root, rpa.manifestPath);
      manifestCache = await loadCaptureManifest(resolved);
    }
    const client = createCaptureHttpClient({
      mode: captureHttpMode,
      manifest: manifestCache,
      config: rpa.realLive || {},
      runtimeAuth,
      transport: transport || rpa.realLiveTransport
    });
    if (captureHttpMode === "real_live") return client;
    clientCache = client;
  }
  return clientCache;
}
```

Update `replayPhase` signature and call:

```js
async function replayPhase(phase, variables, { dir = null, taskId = null, realLive = null } = {}) {
  const client = await ensureClient({
    runtimeAuth: realLive?.runtimeAuth || null,
    transport: realLive?.transport || null
  });
  const state = dir && taskId ? await readRpaState(dir, taskId) : null;
  const persistedVariables = { ...savedCaptureVariables(state) };
  const vars = { ...persistedVariables, ...variables };
  const requestPlan = [];
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
    Object.assign(vars, result.produced);
    Object.assign(persistedVariables, result.produced);
    if (result.request_plan) requestPlan.push(result.request_plan);
  }
  return { variables: vars, persistedVariables, requestPlan };
}
```

Pass `context.realLive` through every executor method:

```js
const assetReplay = await replayPhase("asset_generation", {
  product_image_path: packageData.product_image_path,
  person_image_path: packageData.person_image_path
}, { dir, taskId: task.task_id, realLive: context.realLive });
```

Use the same `realLive: context.realLive` pattern for `remote_submit`, `remote_query`, and `download`.

- [ ] **Step 4: Run Task 2 tests**

Run:

```bash
node --test test/capture-http-executor.test.js
npm run check
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/executors/capture-http-executor.js test/capture-http-executor.test.js
git commit -m "feat(rpa capture): thread real-live authorization through executor"
```

---

### Task 3: Expose safe real_live disabled status in API and GUI

**Files:**
- Modify: `src/server/routes/capture.js`
- Modify: `web/app.js`
- Test: `test/server-capture-api.test.js`
- Test: `test/gui-smoke.test.js`

**Interfaces:**
- Consumes: existing local-session protected capture routes.
- Produces: `POST /api/batches/:batchId/capture/live-status`, returning public batch with `capture.status = "real_live_disabled"` or equivalent stable capture state without network.

- [ ] **Step 1: Write failing server API test**

Add to `test/server-capture-api.test.js`:

```js
test("real-live status API records disabled state without network or sensitive details", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-real-live-status-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { app, session } = await fixtureWithRoot(root);
  const batchId = "batch-real-live-status";
  await mkdir(path.join(root, "batches", batchId), { recursive: true });
  await writeFile(path.join(root, "batches", batchId, "batch.json"), JSON.stringify({
    batch_id: batchId,
    status: "completed",
    capture: {
      enabled: true,
      status: "dry_run_passed",
      manifest_path: `batches/${batchId}/capture/manifest.json`,
      dry_run_summary: { executed_step_count: 1, request_plan: [] }
    },
    items: []
  }), "utf8");
  const response = await app.inject({
    method: "POST",
    url: `/api/batches/${batchId}/capture/live-status`,
    headers: headers(session),
    payload: {}
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.batch.capture.status, "real_live_disabled");
  assert.equal(body.batch.capture.live_error.code, "CAPTURE_HTTP_REAL_LIVE_DISABLED");
  assert.equal(JSON.stringify(body).includes(root), false);
  assert.equal(JSON.stringify(body).includes("cookie"), false);
});
```

If `fixtureWithRoot` does not exist, use the existing test fixture pattern from this file and keep the helper local to the test file.

- [ ] **Step 2: Add capture status support**

If `real_live_disabled` already exists in `CAPTURE_STATUSES`, reuse it. Otherwise add it to `src/rpa/capture/workflow-state.js`:

```js
"real_live_disabled"
```

Add safe projection for `live_error` in `publicCaptureState()`:

```js
if (value.live_error) {
  value.live_error = {
    code: value.live_error.code || "CAPTURE_HTTP_REAL_LIVE_DISABLED",
    message: "real_live is disabled until explicitly authorized."
  };
}
```

- [ ] **Step 3: Implement the server route**

In `src/server/routes/capture.js`, add:

```js
function realLiveDisabledFailure() {
  return {
    code: "CAPTURE_HTTP_REAL_LIVE_DISABLED",
    message: "real_live is disabled until explicitly authorized."
  };
}

app.post("/api/batches/:batchId/capture/live-status", async (request) => {
  const batchId = assertBatchId(request.params.batchId);
  await readCaptureBatch(batchId);
  const updated = await store.update(batchId, (current) => ({
    ...current,
    capture: updateCaptureState(current.capture, {
      enabled: true,
      status: "real_live_disabled",
      live_error: realLiveDisabledFailure()
    })
  }));
  return { batch: publicBatch(updated) };
});
```

- [ ] **Step 4: Write GUI smoke test**

Extend `test/gui-smoke.test.js` with a fixture batch in `dry_run_passed` and assert the GUI shows disabled copy:

```js
test("capture GUI distinguishes real-live disabled from dry-run", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-gui-real-live-disabled-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await buildApp({ root, executor: createFakeExecutor() });
  const batchId = "batch-real-live-disabled";
  await mkdir(path.join(root, "batches", batchId), { recursive: true });
  await writeFile(path.join(root, "batches", batchId, "batch.json"), JSON.stringify({
    batch_id: batchId,
    status: "completed",
    capture: {
      enabled: true,
      status: "dry_run_passed",
      manifest_path: `batches/${batchId}/capture/manifest.json`,
      dry_run_summary: { executed_step_count: 7, request_plan: [] }
    },
    items: []
  }), "utf8");
  const page = await renderWorkbench(app);
  assert.match(await page.textContent("body"), /真实请求预演/);
  assert.match(await page.textContent("body"), /真实 HTTP 生成/);
  assert.match(await page.textContent("body"), /会访问飞影，可能消耗积分/);
});
```

Use the existing GUI smoke helpers in this file; keep selector style consistent with neighboring tests.

- [ ] **Step 5: Update GUI copy**

In `web/app.js`, in the capture workflow rendering function, add a disabled real-live line/button after the dry-run action:

```js
html += `<button type="button" disabled title="当前阶段未启用真实 HTTP 生成">真实 HTTP 生成（会访问飞影，可能消耗积分）</button>`;
html += `<p class="muted">当前阶段仅支持真实请求预演；真实 HTTP 生成需单独授权后只跑 1 条。</p>`;
```

If the file uses DOM builders instead of string templates in that section, add the equivalent button and muted copy using the existing pattern.

- [ ] **Step 6: Run Task 3 tests**

Run:

```bash
node --test test/server-capture-api.test.js test/gui-smoke.test.js
npm run check
git diff --check
```

Expected: all pass.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/server/routes/capture.js src/rpa/capture/workflow-state.js web/app.js test/server-capture-api.test.js test/gui-smoke.test.js
git commit -m "feat(gui capture): expose real-live disabled status"
```

---

### Task 4: Update docs and handoff for real_live scaffold

**Files:**
- Modify: `docs/rpa/capture-runbook.md`
- Modify: `docs/PROJECT_HANDOFF.md`
- Modify: `config.example.json`
- Test: `npm run check`

**Interfaces:**
- Consumes: Tasks 1-3 behavior and config names.
- Produces: documented operator boundary for `real_live` scaffold.

- [ ] **Step 1: Update config example**

In `config.example.json`, add safe disabled defaults under `rpa`:

```json
"captureHttpMode": "mock",
"realLive": {
  "enabled": false,
  "allowedHosts": ["hiflyworks-api.lingverse.co"],
  "timeoutMs": 30000
}
```

Keep JSON valid and preserve existing fields.

- [ ] **Step 2: Update runbook**

In `docs/rpa/capture-runbook.md`, add a section after “真实请求预演（real_dry_run，无积分）”:

```md
## 真实 HTTP 生成脚手架（real_live，当前禁用）

`real_live` 目前只是受控脚手架：代码可以在测试中通过 fake transport 验证变量链，但默认配置不会访问飞影，也不会消耗积分。

启用真实 HTTP 出片前必须另行满足：

1. 用户明确授权访问飞影并可能消耗积分。
2. 只跑 1 条商品。
3. 配置 `rpa.realLive.enabled=true`。
4. 本次执行上下文提供 `allowRealLive=true`。
5. 若步骤可能消耗积分，本次执行上下文提供 `acknowledgePointRisk=true`。
6. runtimeAuth 只来自内存，不写入 manifest、batch、日志或 git。

当前 GUI 默认只展示禁用状态，不提供可点击的真实生成入口。
```

- [ ] **Step 3: Update handoff**

Add a top section to `docs/PROJECT_HANDOFF.md`:

```md
## 2026-07-17 Capture HTTP real_live 受控脚手架已设计/实现（无网络、无新增积分）

- `real_live` 只作为受控脚手架存在，默认禁用；未授权时不会调用 transport。
- fake transport 测试可验证变量链，但没有真实飞影访问。
- GUI 明确区分“真实请求预演”和“真实 HTTP 生成（会访问飞影，可能消耗积分）”。
- 下一步真实联调必须另行获得用户授权，只跑 1 条。
```

Adjust wording if Task 4 is written after implementation; keep facts precise.

- [ ] **Step 4: Run docs validation**

Run:

```bash
npm run check
git diff --check
```

Expected: pass.

- [ ] **Step 5: Commit Task 4**

```bash
git add config.example.json docs/rpa/capture-runbook.md docs/PROJECT_HANDOFF.md
git commit -m "docs: document capture real-live scaffold"
```

---

### Task 5: Final verification and branch review

**Files:**
- No production changes unless review finds issues.
- Review package under `.superpowers/sdd/` is scratch and should not be committed unless already tracked intentionally.

**Interfaces:**
- Consumes: Tasks 1-4 commits.
- Produces: final verified branch ready to push.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
node --test test/rpa-capture-real-live-client.test.js test/rpa-capture-http-client-factory.test.js test/capture-http-executor.test.js test/server-capture-api.test.js test/gui-smoke.test.js
```

Expected: all pass.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run check
git diff --check
```

Expected:

- `npm test` passes all tests.
- `npm run check` reports all JavaScript files checked.
- `git diff --check` exits 0.

- [ ] **Step 3: Final code review**

Use a review subagent or manual code-review skill. Provide the full diff from the branch point before Task 1 to HEAD. Required review focus:

- `real_live` cannot call transport unless all gates pass.
- Disabled and unauthorized paths do not call fake transport.
- No runtime auth is persisted.
- GUI copy cannot be mistaken for no-cost dry-run.
- Playwright, `mock`, and `real_dry_run` are unchanged.

- [ ] **Step 4: Fix any Critical/Important review findings**

If review finds Critical or Important issues, dispatch a single fix task covering all findings, rerun the relevant targeted tests, and repeat review.

- [ ] **Step 5: Push**

Run:

```bash
git status --short --branch
git push origin codex/yingdao-rpa-version
```

Expected: branch is pushed; untracked `docs/resume/` and unrelated `.superpowers/sdd/task-*.md` changes are not committed.
