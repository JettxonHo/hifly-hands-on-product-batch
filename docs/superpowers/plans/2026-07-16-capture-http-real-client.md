# Capture HTTP Real Client Dry-Run Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe `real_dry_run` mode for `capture_http` that builds and validates real-request plans without sending network requests or consuming Hifly points.

**Architecture:** Keep Playwright as the default production backend and keep current `capture_http` mock replay unchanged. Add a client factory that chooses between existing mock replay and a new dry-run client; the dry-run client resolves manifest request templates into a request plan, rejects risky templates, returns recorded `produces` for variable chaining, and never calls network APIs. Expose dry-run status through capture APIs and the GUI as a separate state from offline replay.

**Tech Stack:** Node.js ES modules, `node --test`, `node:assert/strict`, Fastify inject tests, existing GUI vanilla JS, no new dependencies.

## Global Constraints

- `executionBackend: "playwright"` remains the default production path.
- `captureHttpMode` defaults to `mock`; invalid values fail safely with `CAPTURE_HTTP_MODE_INVALID`.
- `real_dry_run` must not call `fetch`, `http`, `https`, `net`, Playwright, or any Hifly network endpoint.
- `real_live` is not implemented in this plan. If configured, it must fail with `CAPTURE_HTTP_REAL_LIVE_DISABLED`.
- Do not submit raw HAR, cookie, authorization, CSRF token, login state, signatures, batch data, downloaded videos, logs, screenshots, `outputs/`, or `node_modules`.
- Preserve current mock replay behavior and current GUI batch creation/import/Playwright execution behavior.
- Each implementation task must update `docs/PROJECT_HANDOFF.md` if it changes the handoff state materially.
- Verification before each commit: use the exact targeted `node --test` command listed in that task, then run `npm run check` and `git diff --check`.

## File Structure

- Create `src/rpa/capture/step-runtime.js`: shared placeholder substitution and `produces` extraction used by mock and dry-run clients.
- Modify `src/rpa/capture/mock-http-client.js`: delegate substitution/extraction to `step-runtime.js`; behavior stays the same.
- Modify `src/rpa/capture/manifest.js`: accept optional `request_template` and `risk` fields, validate them, and reject sensitive request-template headers.
- Create `src/rpa/capture/dry-run-http-client.js`: build per-step request-plan entries without network access.
- Create `src/rpa/capture/http-client-factory.js`: choose `mock`, `real_dry_run`, or reject `real_live`.
- Modify `src/executors/capture-http-executor.js`: use the factory and expose dry-run request-plan summaries in rpa-state.
- Modify `src/rpa/capture/workflow-state.js`: add dry-run statuses.
- Modify `src/server/routes/capture.js`: add `POST /api/batches/:batchId/capture/dry-run`.
- Modify `web/api.js` and `web/app.js`: add a “真实请求预演” button and dry-run status rendering.
- Modify `config.example.json`: document `rpa.captureHttpMode`.
- Add/modify tests under `test/` as specified below.
- Update `docs/PROJECT_HANDOFF.md` after implementation slices that matter.

---

### Task 1: Extract Shared Capture Step Runtime Helpers

**Files:**
- Create: `src/rpa/capture/step-runtime.js`
- Modify: `src/rpa/capture/mock-http-client.js`
- Test: `test/rpa-capture-step-runtime.test.js`
- Regression: `test/rpa-capture-mock-http.test.js`

**Interfaces:**
- Produces: `substituteCaptureValue(value, variables)`, `assertStepPlaceholders(step, variables)`, `extractProducedVariables(produces, body)`.
- Consumes: existing manifest step shape from `src/rpa/capture/manifest.js`.

- [ ] **Step 1: Write the failing test**

Create `test/rpa-capture-step-runtime.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import {
  assertStepPlaceholders,
  extractProducedVariables,
  substituteCaptureValue
} from "../src/rpa/capture/step-runtime.js";

test("substituteCaptureValue replaces placeholders in nested values", () => {
  assert.deepEqual(
    substituteCaptureValue({
      url: "https://example.test/{{remote_id}}",
      body: { asset: "{{asset_id}}", keep: 123 },
      list: ["{{remote_id}}"]
    }, { remote_id: "work-1", asset_id: "asset-1" }),
    {
      url: "https://example.test/work-1",
      body: { asset: "asset-1", keep: 123 },
      list: ["work-1"]
    }
  );
});

test("assertStepPlaceholders rejects missing variables", () => {
  assert.throws(
    () => assertStepPlaceholders({ id: "submit", placeholders: ["{{asset_id}}"] }, {}),
    /Missing variable for step submit: asset_id/
  );
});

test("extractProducedVariables reads response body paths", () => {
  assert.deepEqual(
    extractProducedVariables(
      { remote_id: "$response.body.data.list.0.id" },
      { data: { list: [{ id: 634505 }] } }
    ),
    { remote_id: 634505 }
  );
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
node --test test/rpa-capture-step-runtime.test.js
```

Expected: FAIL with module not found for `step-runtime.js`.

- [ ] **Step 3: Add the shared helper**

Create `src/rpa/capture/step-runtime.js`:

```js
export function substituteCaptureValue(value, variables) {
  if (typeof value === "string") {
    return value.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (match, name) =>
      Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : match
    );
  }
  if (Array.isArray(value)) return value.map((entry) => substituteCaptureValue(entry, variables));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, substituteCaptureValue(child, variables)])
    );
  }
  return value;
}

export function assertStepPlaceholders(step, variables) {
  for (const placeholder of step.placeholders || []) {
    const name = placeholder.replace(/^\{\{|\}\}$/g, "");
    if (!Object.prototype.hasOwnProperty.call(variables, name)) {
      throw Object.assign(new Error(`Missing variable for step ${step.id}: ${name}`), {
        code: "CAPTURE_MISSING_VARIABLE"
      });
    }
  }
}

export function extractProducedVariables(produces, body) {
  const result = {};
  for (const [name, path] of Object.entries(produces || {})) {
    if (typeof path !== "string" || !path.startsWith("$response.body.")) {
      throw Object.assign(new Error(`unsupported produces path for ${name}: ${path}`), {
        code: "CAPTURE_PRODUCES_PATH"
      });
    }
    const segments = path.replace("$response.body.", "").split(".");
    let current = body;
    for (const segment of segments) {
      if (current == null || typeof current !== "object" || !(segment in current)) {
        throw Object.assign(new Error(`produces path not found for ${name}: ${path}`), {
          code: "CAPTURE_PRODUCES_MISSING"
        });
      }
      current = current[segment];
    }
    result[name] = current;
  }
  return result;
}
```

- [ ] **Step 4: Refactor mock client to use the helper**

Replace local `substitute` and `extractProduced` in `src/rpa/capture/mock-http-client.js` with imports:

```js
import { findStep } from "./manifest.js";
import {
  assertStepPlaceholders,
  extractProducedVariables,
  substituteCaptureValue
} from "./step-runtime.js";
```

Inside `request()` use:

```js
assertStepPlaceholders(step, variables);
const body = substituteCaptureValue(step.response.body, variables);
const produced = extractProducedVariables(step.produces, body);
return { status: step.response.status, body, produced };
```

- [ ] **Step 5: Verify task tests**

Run:

```bash
node --test test/rpa-capture-step-runtime.test.js test/rpa-capture-mock-http.test.js
npm run check
git diff --check
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/rpa/capture/step-runtime.js src/rpa/capture/mock-http-client.js test/rpa-capture-step-runtime.test.js
git commit -m "refactor(rpa capture): share step runtime helpers"
```

---

### Task 2: Extend Manifest Parsing for Request Templates and Risk Metadata

**Files:**
- Modify: `src/rpa/capture/manifest.js`
- Test: `test/rpa-capture-manifest.test.js`

**Interfaces:**
- Consumes: `findSensitiveKeys()` from `src/rpa/capture/sensitive.js`.
- Produces: parsed step fields `request_template` and `risk`.

- [ ] **Step 1: Add failing tests**

Append to `test/rpa-capture-manifest.test.js`:

```js
test("preserves optional request_template and risk metadata", () => {
  const manifest = parseCaptureManifest({
    ...SAMPLE,
    steps: [{
      ...SAMPLE.steps[0],
      request_template: {
        headers: { "content-type": "application/json" },
        body: { image: "{{product_image_path}}" }
      },
      risk: {
        requires_auth: true,
        may_consume_points: false,
        replayability: "unknown"
      }
    }]
  });
  assert.deepEqual(manifest.steps[0].request_template, {
    headers: { "content-type": "application/json" },
    body: { image: "{{product_image_path}}" }
  });
  assert.deepEqual(manifest.steps[0].risk, {
    requires_auth: true,
    may_consume_points: false,
    replayability: "unknown"
  });
});

test("rejects sensitive request_template headers", () => {
  assert.throws(
    () => parseCaptureManifest({
      ...SAMPLE,
      steps: [{
        ...SAMPLE.steps[0],
        request_template: { headers: { cookie: "sid=secret" } }
      }]
    }),
    /manifest contains sensitive keys/
  );
});

test("rejects invalid replayability values", () => {
  assert.throws(
    () => parseCaptureManifest({
      ...SAMPLE,
      steps: [{
        ...SAMPLE.steps[0],
        risk: { replayability: "maybe" }
      }]
    }),
    /risk.replayability is invalid/
  );
});
```

- [ ] **Step 2: Run the failing tests**

Run:

```bash
node --test test/rpa-capture-manifest.test.js
```

Expected: FAIL because `request_template` and `risk` are not preserved or validated.

- [ ] **Step 3: Implement validation**

In `src/rpa/capture/manifest.js`, add:

```js
const REPLAYABILITY_VALUES = new Set(["unknown", "replayable", "api_unavailable"]);
```

Add helper functions above `validateStep()`:

```js
function validateRequestTemplate(template, index) {
  if (template === undefined) return null;
  if (!template || typeof template !== "object" || Array.isArray(template)) {
    fail(`steps[${index}].request_template must be an object`);
  }
  const result = {};
  if (template.headers !== undefined) {
    if (!template.headers || typeof template.headers !== "object" || Array.isArray(template.headers)) {
      fail(`steps[${index}].request_template.headers must be an object`);
    }
    result.headers = { ...template.headers };
  }
  if (template.body !== undefined) result.body = structuredClone(template.body);
  return result;
}

function validateRisk(risk, index) {
  if (risk === undefined) return {
    requires_auth: false,
    may_consume_points: false,
    replayability: "unknown"
  };
  if (!risk || typeof risk !== "object" || Array.isArray(risk)) fail(`steps[${index}].risk must be an object`);
  const replayability = risk.replayability ?? "unknown";
  if (!REPLAYABILITY_VALUES.has(replayability)) fail(`steps[${index}].risk.replayability is invalid`);
  return {
    requires_auth: risk.requires_auth === true,
    may_consume_points: risk.may_consume_points === true,
    replayability
  };
}
```

In `validateStep()`, include:

```js
const request_template = validateRequestTemplate(step.request_template, index);
const risk = validateRisk(step.risk, index);
```

Return these fields:

```js
...(request_template ? { request_template } : {}),
risk
```

The existing `findSensitiveKeys(data, "")` call must remain before step normalization so `request_template.headers.cookie` is rejected.

- [ ] **Step 4: Verify task tests**

Run:

```bash
node --test test/rpa-capture-manifest.test.js test/rpa-capture-redact.test.js test/har-extractor.test.js
npm run check
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/rpa/capture/manifest.js test/rpa-capture-manifest.test.js
git commit -m "feat(rpa capture): parse request templates"
```

---

### Task 3: Add Dry-Run HTTP Client and Client Factory

**Files:**
- Create: `src/rpa/capture/dry-run-http-client.js`
- Create: `src/rpa/capture/http-client-factory.js`
- Test: `test/rpa-capture-dry-run-client.test.js`
- Test: `test/rpa-capture-http-client-factory.test.js`

**Interfaces:**
- Consumes: `findStep()` from `manifest.js`; `assertStepPlaceholders`, `substituteCaptureValue`, `extractProducedVariables` from `step-runtime.js`; `createMockHttpClient()` from `mock-http-client.js`.
- Produces: `createDryRunHttpClient({ manifest })`, `createCaptureHttpClient({ mode, manifest })`, `CAPTURE_HTTP_MODES`.

- [ ] **Step 1: Write failing dry-run client tests**

Create `test/rpa-capture-dry-run-client.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { parseCaptureManifest } from "../src/rpa/capture/manifest.js";
import { createDryRunHttpClient } from "../src/rpa/capture/dry-run-http-client.js";

const MANIFEST = parseCaptureManifest({
  schema_version: 1,
  source: "hifly_goods",
  captured_at: "2026-07-16T00:00:00Z",
  sanitized: true,
  steps: [{
    id: "submit_video",
    phase: "remote_submit",
    method: "POST",
    url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos/{{asset_id}}",
    placeholders: ["{{asset_id}}"],
    request_template: {
      headers: { "content-type": "application/json" },
      body: { gen_id: "{{asset_id}}" }
    },
    risk: { requires_auth: true, may_consume_points: true, replayability: "unknown" },
    response: { status: 200, body: { data: { list: [{ id: 634505 }] } } },
    produces: { remote_id: "$response.body.data.list.0.id" }
  }]
});

test("dry-run builds a resolved request plan without network access", async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("network should not be called");
  };
  try {
    const client = createDryRunHttpClient({ manifest: MANIFEST });
    const result = await client.request({ stepId: "submit_video", variables: { asset_id: "asset-1" } });
    assert.equal(fetchCalled, false);
    assert.equal(result.status, 200);
    assert.deepEqual(result.produced, { remote_id: 634505 });
    assert.deepEqual(result.request_plan, {
      step_id: "submit_video",
      phase: "remote_submit",
      method: "POST",
      host: "hiflyworks-api.lingverse.co",
      path: "/api/app/v1/one_stop/goods_in_hand/videos/asset-1",
      url: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos/asset-1",
      headers: { "content-type": "application/json" },
      body: { gen_id: "asset-1" },
      placeholders: ["asset_id"],
      risk_flags: ["auth_required", "may_consume_points", "replayability_unknown"]
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dry-run rejects unresolved placeholders", async () => {
  const client = createDryRunHttpClient({ manifest: MANIFEST });
  await assert.rejects(
    () => client.request({ stepId: "submit_video", variables: {} }),
    { code: "CAPTURE_HTTP_UNRESOLVED_PLACEHOLDER" }
  );
});

test("dry-run marks api_unavailable steps", async () => {
  const manifest = parseCaptureManifest({
    ...MANIFEST,
    steps: [{ ...MANIFEST.steps[0], risk: { replayability: "api_unavailable" } }]
  });
  const client = createDryRunHttpClient({ manifest });
  await assert.rejects(
    () => client.request({ stepId: "submit_video", variables: { asset_id: "asset-1" } }),
    { code: "CAPTURE_HTTP_API_UNAVAILABLE" }
  );
});
```

- [ ] **Step 2: Write failing factory tests**

Create `test/rpa-capture-http-client-factory.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";

import { parseCaptureManifest } from "../src/rpa/capture/manifest.js";
import { CAPTURE_HTTP_MODES, createCaptureHttpClient } from "../src/rpa/capture/http-client-factory.js";

const MANIFEST = parseCaptureManifest({
  schema_version: 1,
  source: "hifly_goods",
  captured_at: "2026-07-16T00:00:00Z",
  sanitized: true,
  steps: [{
    id: "poll",
    phase: "remote_query",
    method: "GET",
    url_template: "https://example.test/{{remote_id}}",
    placeholders: ["{{remote_id}}"],
    response: { status: 200, body: { data: { ok: true } } }
  }]
});

test("factory defaults to mock mode", async () => {
  assert.deepEqual(CAPTURE_HTTP_MODES, ["mock", "real_dry_run", "real_live"]);
  const client = createCaptureHttpClient({ manifest: MANIFEST });
  const result = await client.request({ stepId: "poll", variables: { remote_id: "work-1" } });
  assert.equal(result.status, 200);
  assert.equal(result.request_plan, undefined);
});

test("factory creates dry-run mode", async () => {
  const client = createCaptureHttpClient({ mode: "real_dry_run", manifest: MANIFEST });
  const result = await client.request({ stepId: "poll", variables: { remote_id: "work-1" } });
  assert.equal(result.request_plan.url, "https://example.test/work-1");
});

test("factory rejects invalid mode", () => {
  assert.throws(
    () => createCaptureHttpClient({ mode: "surprise", manifest: MANIFEST }),
    { code: "CAPTURE_HTTP_MODE_INVALID" }
  );
});

test("factory refuses real_live until explicitly implemented later", () => {
  assert.throws(
    () => createCaptureHttpClient({ mode: "real_live", manifest: MANIFEST }),
    { code: "CAPTURE_HTTP_REAL_LIVE_DISABLED" }
  );
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
node --test test/rpa-capture-dry-run-client.test.js test/rpa-capture-http-client-factory.test.js
```

Expected: FAIL because the new modules do not exist.

- [ ] **Step 4: Implement dry-run client**

Create `src/rpa/capture/dry-run-http-client.js`:

```js
import { findStep } from "./manifest.js";
import {
  assertStepPlaceholders,
  extractProducedVariables,
  substituteCaptureValue
} from "./step-runtime.js";

function unresolvedPlaceholders(value) {
  const text = JSON.stringify(value);
  return text.match(/\{\{[A-Za-z0-9_]+\}\}/g) || [];
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

function fail(code, message) {
  throw Object.assign(new Error(message || code), { code });
}

function requestTemplate(step) {
  const template = step.request_template || {};
  return {
    headers: template.headers ? { ...template.headers } : {},
    body: template.body === undefined ? null : structuredClone(template.body)
  };
}

export function createDryRunHttpClient({ manifest }) {
  if (!manifest || !Array.isArray(manifest.steps)) {
    throw new TypeError("createDryRunHttpClient requires a parsed manifest");
  }
  return {
    async request({ stepId, variables = {} }) {
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
      const headers = substituteCaptureValue(template.headers, variables);
      const body = substituteCaptureValue(template.body, variables);
      const unresolved = unresolvedPlaceholders({ resolvedUrl, headers, body });
      if (unresolved.length > 0) {
        fail("CAPTURE_HTTP_UNRESOLVED_PLACEHOLDER", `Unresolved placeholders: ${unresolved.join(", ")}`);
      }
      const url = new URL(resolvedUrl);
      const responseBody = substituteCaptureValue(step.response.body, variables);
      const produced = extractProducedVariables(step.produces, responseBody);
      return {
        status: step.response.status,
        body: responseBody,
        produced,
        request_plan: {
          step_id: step.id,
          phase: step.phase,
          method: step.method,
          host: url.hostname,
          path: `${url.pathname}${url.search}`,
          url: url.href,
          headers,
          body,
          placeholders: placeholderNames(step.placeholders),
          risk_flags: riskFlags(step.risk)
        }
      };
    }
  };
}
```

- [ ] **Step 5: Implement client factory**

Create `src/rpa/capture/http-client-factory.js`:

```js
import { createDryRunHttpClient } from "./dry-run-http-client.js";
import { createMockHttpClient } from "./mock-http-client.js";

export const CAPTURE_HTTP_MODES = Object.freeze(["mock", "real_dry_run", "real_live"]);

function fail(code, message) {
  throw Object.assign(new Error(message || code), { code });
}

export function normalizeCaptureHttpMode(mode = "mock") {
  const value = mode || "mock";
  if (!CAPTURE_HTTP_MODES.includes(value)) {
    fail("CAPTURE_HTTP_MODE_INVALID", `Unsupported captureHttpMode: ${value}`);
  }
  return value;
}

export function createCaptureHttpClient({ mode = "mock", manifest } = {}) {
  const normalized = normalizeCaptureHttpMode(mode);
  if (normalized === "mock") return createMockHttpClient({ manifest });
  if (normalized === "real_dry_run") return createDryRunHttpClient({ manifest });
  fail("CAPTURE_HTTP_REAL_LIVE_DISABLED", "real_live is not implemented or authorized");
}
```

- [ ] **Step 6: Verify task tests**

Run:

```bash
node --test test/rpa-capture-dry-run-client.test.js test/rpa-capture-http-client-factory.test.js test/rpa-capture-mock-http.test.js
npm run check
git diff --check
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/rpa/capture/dry-run-http-client.js src/rpa/capture/http-client-factory.js test/rpa-capture-dry-run-client.test.js test/rpa-capture-http-client-factory.test.js
git commit -m "feat(rpa capture): add dry-run http client"
```

---

### Task 4: Wire Dry-Run Mode Into Capture HTTP Executor

**Files:**
- Modify: `src/executors/capture-http-executor.js`
- Test: `test/capture-http-executor.test.js`
- Test: `test/execution-backend-config.test.js`

**Interfaces:**
- Consumes: `createCaptureHttpClient({ mode, manifest })` from `http-client-factory.js`.
- Produces: executor summary `request_plan` in rpa-state when `captureHttpMode === "real_dry_run"`.

- [ ] **Step 1: Add failing executor test**

Append to `test/capture-http-executor.test.js`:

```js
test("capture_http executor supports real_dry_run without network access", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-http-dry-run-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifestPath = path.join(root, "manifest.json");
  await mkdir(path.join(root, "batches", "batch-dry-run"), { recursive: true });
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
  const task = { task_id: "task-1", sku: "SKU", product_name: "Dry Run", image_path: "product.png" };
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
```

If `test/capture-http-executor.test.js` does not already import these helpers, add:

```js
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readRpaState } from "../src/rpa/rpa-state.js";
```

- [ ] **Step 2: Add backend config test**

Append to `test/execution-backend-config.test.js`:

```js
test("capture_http executor preserves configured dry-run mode", () => {
  const executor = createExecutorForBackend(process.cwd(), {
    executionBackend: "yingdao_rpa",
    rpa: { mode: "capture_http", manifestPath: "rpa/capture/fixtures/hifly-goods-sample.json", captureHttpMode: "real_dry_run" }
  });
  assert.equal(executor.backend, "yingdao_rpa");
  assert.equal(executor.mode, "capture_http");
  assert.equal(executor.captureHttpMode, "real_dry_run");
});
```

- [ ] **Step 3: Run failing tests**

Run:

```bash
node --test test/capture-http-executor.test.js test/execution-backend-config.test.js
```

Expected: FAIL because executor still hardcodes mock client and does not expose dry-run mode or request plans.

- [ ] **Step 4: Wire factory into executor**

In `src/executors/capture-http-executor.js`, replace:

```js
import { createMockHttpClient } from "../rpa/capture/mock-http-client.js";
```

with:

```js
import { createCaptureHttpClient, normalizeCaptureHttpMode } from "../rpa/capture/http-client-factory.js";
```

Inside `createCaptureHttpExecutor`, add:

```js
const captureHttpMode = normalizeCaptureHttpMode(rpa.captureHttpMode || "mock");
```

In `ensureClient()`, replace:

```js
clientCache = createMockHttpClient({ manifest: manifestCache });
```

with:

```js
clientCache = createCaptureHttpClient({ mode: captureHttpMode, manifest: manifestCache });
```

In `replayPhase`, collect request-plan entries:

```js
async function replayPhase(phase, variables) {
  await ensureClient();
  const vars = { ...variables };
  const requestPlan = [];
  for (const step of selectStepsByPhase(manifestCache, phase)) {
    const result = await clientCache.request({ stepId: step.id, variables: vars, phase });
    Object.assign(vars, result.produced);
    if (result.request_plan) requestPlan.push(result.request_plan);
  }
  return { variables: vars, requestPlan };
}
```

Then update call sites:

```js
const assetReplay = await replayPhase("asset_generation", {
  product_image_path: packageData.product_image_path,
  person_image_path: packageData.person_image_path
});
const produced = assetReplay.variables;
```

For each rpa-state write, include:

```js
capture_http_mode: captureHttpMode,
request_plan: assetReplay.requestPlan
```

For later phases, merge existing state request plans before writing:

```js
async function appendRequestPlan(dir, taskId, entries) {
  if (entries.length === 0) return [];
  const current = await readRpaState(dir, taskId);
  return [...(current?.request_plan || []), ...entries];
}
```

Use `appendRequestPlan` in `submitVideo`, `querySubmission`, and `downloadArtifact`.

Return the executor with:

```js
return assertExecutorAdapter(Object.assign(executor, { captureHttpMode }));
```

- [ ] **Step 5: Verify task tests**

Run:

```bash
node --test test/capture-http-executor.test.js test/execution-backend-config.test.js test/batch-runner.test.js
npm run check
git diff --check
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/executors/capture-http-executor.js test/capture-http-executor.test.js test/execution-backend-config.test.js
git commit -m "feat(rpa capture): wire dry-run executor mode"
```

---

### Task 5: Add Capture Dry-Run API and Workflow State

**Files:**
- Modify: `src/rpa/capture/workflow-state.js`
- Modify: `src/server/routes/capture.js`
- Test: `test/server-capture-api.test.js`

**Interfaces:**
- Produces: `POST /api/batches/:batchId/capture/dry-run`.
- Consumes: `runOfflineCaptureReplay` pattern, `createDryRunHttpClient`, `loadCaptureManifest`.

- [ ] **Step 1: Add failing API test**

Append to `test/server-capture-api.test.js`:

```js
test("dry-run capture API stores request plan summary", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-dry-run-api-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await buildApp({ root, openBrowser: async () => {} });
  t.after(() => app.close());
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-dry-run-api",
    status: "completed",
    items: [],
    artifacts: [],
    capture: {
      enabled: true,
      status: "redacted",
      manifest_path: "batches/batch-dry-run-api/capture/manifest.json"
    }
  });
  await mkdir(path.join(root, "batches", "batch-dry-run-api", "capture"), { recursive: true });
  await writeFile(path.join(root, "batches", "batch-dry-run-api", "capture", "manifest.json"), JSON.stringify({
    schema_version: 1,
    source: "hifly_goods",
    captured_at: "2026-07-16T00:00:00Z",
    sanitized: true,
    steps: [{
      id: "poll",
      phase: "remote_query",
      method: "GET",
      url_template: "https://example.test/{{remote_id}}",
      placeholders: ["{{remote_id}}"],
      response: { status: 200, body: { data: { ok: true } } }
    }]
  }));
  const session = await app.inject({ method: "GET", url: "/api/session", headers: { host: "127.0.0.1:4317" } });
  const token = session.json().token;
  const response = await app.inject({
    method: "POST",
    url: "/api/batches/batch-dry-run-api/capture/dry-run",
    headers: {
      host: "127.0.0.1:4317",
      origin: "http://127.0.0.1:4317",
      cookie: session.headers["set-cookie"],
      "x-local-session-token": token,
      "content-type": "application/json"
    },
    payload: { variables: { remote_id: "work-1" } }
  });
  assert.equal(response.statusCode, 200);
  const capture = response.json().batch.capture;
  assert.equal(capture.status, "dry_run_passed");
  assert.equal(capture.dry_run_summary.executed_step_count, 1);
  assert.equal(capture.dry_run_summary.request_plan[0].url, "https://example.test/work-1");
});
```

- [ ] **Step 2: Run failing test**

Run:

```bash
node --test test/server-capture-api.test.js
```

Expected: FAIL with route not found or invalid workflow state.

- [ ] **Step 3: Add workflow states**

In `src/rpa/capture/workflow-state.js`, add:

```js
"dry_run_passed",
"dry_run_failed",
"real_live_disabled"
```

to the allowed state list.

- [ ] **Step 4: Add dry-run route**

In `src/server/routes/capture.js`, import:

```js
import { CAPTURE_PHASES, loadCaptureManifest, selectStepsByPhase } from "../../rpa/capture/manifest.js";
import { createDryRunHttpClient } from "../../rpa/capture/dry-run-http-client.js";
```

Because `CAPTURE_PHASES` is already imported indirectly in other modules, avoid duplicate imports by merging with existing manifest import.

Add route after `/capture/replay`:

```js
  app.post("/api/batches/:batchId/capture/dry-run", async (request) => {
    const batchId = assertBatchId(request.params.batchId);
    const batch = await readCaptureBatch(batchId);
    if (!batch.capture?.manifest_path) throw captureError("CAPTURE_MANIFEST_MISSING", 409);

    const root = path.dirname(batchRoot);
    const manifestPath = resolveProjectRelative(root, batch.capture.manifest_path);
    try {
      const manifest = await loadCaptureManifest(manifestPath);
      const client = createDryRunHttpClient({ manifest });
      const variables = {
        product_image_path: "product-image.jpg",
        person_image_path: "person-image.jpg",
        remote_id: "dry-run-remote",
        ...(request.body?.variables && typeof request.body.variables === "object" ? request.body.variables : {})
      };
      const requestPlan = [];
      const executed = [];
      for (const phase of CAPTURE_PHASES) {
        for (const step of selectStepsByPhase(manifest, phase)) {
          const result = await client.request({ stepId: step.id, variables });
          Object.assign(variables, result.produced);
          if (result.request_plan) requestPlan.push(result.request_plan);
          executed.push(step.id);
        }
      }
      const updated = await store.update(batchId, (current) => ({
        ...current,
        capture: updateCaptureState(current.capture, {
          enabled: true,
          status: "dry_run_passed",
          dry_run_error: null,
          dry_run_summary: {
            executed_step_count: executed.length,
            request_plan: requestPlan
          }
        })
      }));
      return { batch: publicBatch(updated) };
    } catch (error) {
      const updated = await store.update(batchId, (current) => ({
        ...current,
        capture: updateCaptureState(current.capture, {
          enabled: true,
          status: "dry_run_failed",
          dry_run_error: error.message
        })
      }));
      return { batch: publicBatch(updated) };
    }
  });
```

- [ ] **Step 5: Verify task tests**

Run:

```bash
node --test test/server-capture-api.test.js test/offline-replay.test.js
npm run check
git diff --check
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/rpa/capture/workflow-state.js src/server/routes/capture.js test/server-capture-api.test.js
git commit -m "feat(gui capture): add dry-run API"
```

---

### Task 6: Expose Dry-Run in GUI and Configuration Docs

**Files:**
- Modify: `web/api.js`
- Modify: `web/app.js`
- Modify: `config.example.json`
- Modify: `docs/rpa/capture-runbook.md`
- Modify: `docs/PROJECT_HANDOFF.md`
- Test: `test/gui-smoke.test.js`
- Test: `test/server-capture-api.test.js`

**Interfaces:**
- Consumes: `POST /api/batches/:batchId/capture/dry-run`.
- Produces: GUI action button “真实请求预演” and visible dry-run status copy.

- [ ] **Step 1: Add failing GUI smoke assertion**

In `test/gui-smoke.test.js`, add a focused test that serves a batch with `capture.status = "redacted"` and asserts the dry-run button exists. Use the existing GUI smoke server pattern. The essential assertion:

```js
await assertVisible(page.getByRole("button", { name: "真实请求预演" }));
```

Also assert copy that distinguishes no network:

```js
await assertVisible(page.getByText("仅构造请求计划，不访问飞影"));
```

- [ ] **Step 2: Run failing GUI test**

Run:

```bash
node --test test/gui-smoke.test.js
```

Expected: FAIL because the button/copy does not exist yet.

- [ ] **Step 3: Add web API method**

In `web/api.js`, add:

```js
dryRunCapture: (batchId) => request(`/api/batches/${encodeURIComponent(batchId)}/capture/dry-run`, {
  method: "POST",
  body: JSON.stringify({})
}),
```

- [ ] **Step 4: Render dry-run states and button**

In `web/app.js`, extend the capture status label map:

```js
dry_run_passed: "真实请求预演通过",
dry_run_failed: "真实请求预演失败",
real_live_disabled: "真实请求已禁用"
```

In the capture detail rendering, add summary lines:

```js
capture.dry_run_summary?.executed_step_count ? `预演步骤数：${capture.dry_run_summary.executed_step_count}` : "",
capture.dry_run_error ? `预演错误：${capture.dry_run_error}` : "",
"仅构造请求计划，不访问飞影"
```

Add action button:

```js
captureActionButton(
  batch.batch_id,
  "真实请求预演",
  "dryRun",
  ["redacted", "replay_passed", "dry_run_failed"].includes(capture.status)
)
```

In the action map near existing `extract` / `redact` / `replay`, add:

```js
dryRun: api.dryRunCapture
```

- [ ] **Step 5: Update config example and runbook**

In `config.example.json`, under `rpa`, add:

```json
"captureHttpMode": "mock"
```

In `docs/rpa/capture-runbook.md`, add a short section after offline replay:

```markdown
## 真实请求预演（real_dry_run，无积分）

`real_dry_run` 只根据 sanitized manifest 构造请求计划，不访问飞影、不消耗积分、不下载真实视频。GUI 中的“真实请求预演”按钮用于验证 URL、method、占位符和风险标记是否能被安全解析。通过并不代表真实 HTTP 出片已经完成。
```

In `docs/PROJECT_HANDOFF.md`, add the current implementation status, tests run, and note no new points were consumed.

- [ ] **Step 6: Verify GUI and full checks**

Run:

```bash
node --test test/gui-smoke.test.js test/server-capture-api.test.js
npm run check
git diff --check
npm test
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add web/api.js web/app.js config.example.json docs/rpa/capture-runbook.md docs/PROJECT_HANDOFF.md test/gui-smoke.test.js
git commit -m "feat(gui capture): expose dry-run workflow"
```

---

## Final Verification Before PR Update

- [ ] Run full tests:

```bash
npm test
npm run check
git diff --check
```

- [ ] Confirm no forbidden files are staged:

```bash
git status --short
git diff --cached --name-only
```

Forbidden: `batches/`, `rpa/capture/raw/`, `downloads/`, `logs/`, `screenshots/`, `outputs/`, `config.local.json`, `node_modules/`, `.har`.

- [ ] Push branch:

```bash
git push origin codex/yingdao-rpa-version
```

## Self-Review Checklist

- Spec coverage: three modes, dry-run no-network behavior, GUI status, error taxonomy, config docs, Playwright fallback.
- Placeholder scan: no unfinished-marker phrases or vague edge-case instructions.
- Type consistency: `captureHttpMode`, `real_dry_run`, `request_plan`, `dry_run_summary`, and error codes match across tasks.
- Scope: no `real_live` network implementation in this plan.
- Safety: no raw HAR, login state, batch artifacts, or videos are committed.
