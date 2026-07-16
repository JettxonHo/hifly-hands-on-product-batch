# GUI Capture Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the local GUI drive the capture workflow from HAR recording through raw-step extraction, redaction, and offline replay, while keeping Playwright as the production fallback until capture HTTP is fully validated.

**Architecture:** Capture is an opt-in batch capability. Capture-enabled batches still generate real videos through Playwright, but use a one-run browser context configured with `recordHar`; after the run, server-side capture routes extract raw steps, redact them into a sanitized manifest, and run offline `capture_http` replay. Default GUI execution remains Playwright.

**Tech Stack:** Node.js ESM, Fastify, Playwright HAR recording, existing batch store, existing `src/rpa/capture/*` redaction/manifest/mock replay modules, browser GUI in `web/`.

## Global Constraints

- Do not change the default production backend away from `executionBackend: "playwright"`.
- Do not submit raw HAR, cookies, authorization, tokens, login state, batch data, logs, screenshots, downloaded videos, `outputs/`, or `node_modules/`.
- Do not delete or rewrite the existing Playwright executor, Yingdao RPA bridge, or `capture_http` mock executor.
- Capture processing after a real run must not trigger a new Hifly generation or consume new points.
- GUI support must cover single entry, bulk entry, table import, person strategies, script strategies, execution status, retry, and downloads.
- Real Hifly runs still require explicit user confirmation before points are consumed.

---

## File Structure

- Modify `src/core/batch-store.js`: no schema migration; preserve arbitrary `capture` field via existing JSON update path.
- Create `src/rpa/capture/workflow-state.js`: normalize, validate, and update public capture status objects.
- Create `src/rpa/capture/har-extractor.js`: parse local HAR and write conservative raw-step drafts.
- Create `src/rpa/capture/offline-replay.js`: run manifest through mock replay and return a public result.
- Modify `src/server/routes/batches.js`: accept and expose `capture.enabled` safely.
- Modify `src/server/routes/imports.js`: accept capture option from multipart imports.
- Modify `src/server/routes/executions.js`: pass capture settings to execution coordination.
- Modify `src/server/start.js`: support per-run Playwright executor creation for capture-enabled batches.
- Create `src/server/routes/capture.js`: GUI API for extract, redact, and replay steps.
- Modify `src/server/app.js`: register capture routes and add capture error codes.
- Modify `web/api.js`, `web/index.html`, `web/app.js`, `web/styles.css`: GUI controls and status display.
- Add tests in `test/capture-workflow-state.test.js`, `test/har-extractor.test.js`, `test/offline-replay.test.js`, `test/server-capture-api.test.js`, and extend existing server/gui tests.
- Update `docs/PROJECT_HANDOFF.md`, `docs/rpa/capture-runbook.md`, and `docs/CALIBRATION.md`.

---

### Task 1: Capture State Model

**Files:**
- Create: `src/rpa/capture/workflow-state.js`
- Test: `test/capture-workflow-state.test.js`

**Interfaces:**
- Produces: `createInitialCaptureState({ enabled })`, `updateCaptureState(capture, patch)`, `publicCaptureState(capture)`, `CAPTURE_STATUSES`.

- [ ] **Step 1: Write the failing tests**

```js
// test/capture-workflow-state.test.js
import test from "node:test";
import assert from "node:assert/strict";

import {
  createInitialCaptureState,
  publicCaptureState,
  updateCaptureState
} from "../src/rpa/capture/workflow-state.js";

test("capture state is disabled by default", () => {
  assert.deepEqual(createInitialCaptureState({}), { enabled: false, status: "disabled" });
});

test("enabled capture state starts as not_started", () => {
  const state = createInitialCaptureState({ enabled: true });
  assert.equal(state.enabled, true);
  assert.equal(state.status, "not_started");
  assert.match(state.updated_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("public capture state hides raw absolute paths", () => {
  const state = updateCaptureState(createInitialCaptureState({ enabled: true }), {
    status: "recorded",
    har_path: "/Users/ketchup/private.har",
    raw_steps_path: "batches/b1/capture/raw-steps.json"
  });
  assert.equal(publicCaptureState(state).har_path, "[local raw capture]");
  assert.equal(publicCaptureState(state).raw_steps_path, "batches/b1/capture/raw-steps.json");
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `node --test test/capture-workflow-state.test.js`

Expected: FAIL because `src/rpa/capture/workflow-state.js` does not exist.

- [ ] **Step 3: Implement the state helper**

```js
// src/rpa/capture/workflow-state.js
export const CAPTURE_STATUSES = new Set([
  "disabled",
  "not_started",
  "recording",
  "recorded",
  "extracted",
  "redacted",
  "replay_passed",
  "replay_failed"
]);

function now() {
  return new Date().toISOString();
}

function assertStatus(status) {
  if (!CAPTURE_STATUSES.has(status)) {
    throw Object.assign(new Error(`Invalid capture status: ${status}`), { code: "INVALID_CAPTURE_STATUS" });
  }
}

export function createInitialCaptureState({ enabled = false } = {}) {
  if (!enabled) return { enabled: false, status: "disabled" };
  return { enabled: true, status: "not_started", updated_at: now() };
}

export function updateCaptureState(capture = {}, patch = {}) {
  const status = patch.status ?? capture.status ?? (capture.enabled ? "not_started" : "disabled");
  assertStatus(status);
  return {
    ...capture,
    ...patch,
    enabled: patch.enabled ?? capture.enabled ?? status !== "disabled",
    status,
    updated_at: now()
  };
}

export function publicCaptureState(capture) {
  if (!capture || typeof capture !== "object") return { enabled: false, status: "disabled" };
  const value = { ...capture };
  if (value.har_path) value.har_path = "[local raw capture]";
  return value;
}
```

- [ ] **Step 4: Verify**

Run: `node --test test/capture-workflow-state.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rpa/capture/workflow-state.js test/capture-workflow-state.test.js
git commit -m "feat: add capture workflow state"
```

---

### Task 2: Persist Capture Option In GUI Batches

**Files:**
- Modify: `src/server/routes/batches.js`
- Modify: `src/server/routes/imports.js`
- Test: `test/server-api.test.js`

**Interfaces:**
- Consumes: `createInitialCaptureState`, `publicCaptureState`.
- Produces: public batch JSON includes `capture`.

- [ ] **Step 1: Write failing server API tests**

Add tests that create a batch with `{ capture: { enabled: true } }`, import a multipart batch with field `capture_enabled=true`, and assert public batch includes `capture.status === "not_started"`.

Run: `node --test test/server-api.test.js`

Expected: FAIL with `INVALID_BATCH` or missing `capture`.

- [ ] **Step 2: Modify batch route**

In `src/server/routes/batches.js`, import helpers:

```js
import { createInitialCaptureState, publicCaptureState } from "../../rpa/capture/workflow-state.js";
```

Allow `capture` in the `POST /api/batches` body whitelist, create `capture: createInitialCaptureState({ enabled: request.body.capture?.enabled === true })`, and expose `capture: publicCaptureState(rest.capture)` in `publicBatch`.

- [ ] **Step 3: Modify import route**

In `src/server/routes/imports.js`, accept multipart field `capture_enabled`; convert `"true"` to `{ enabled: true }`; pass the resulting `capture` to the created batch object.

- [ ] **Step 4: Verify**

Run: `node --test test/server-api.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/batches.js src/server/routes/imports.js test/server-api.test.js
git commit -m "feat: persist capture option on batches"
```

---

### Task 3: Capture-Aware Playwright Execution

**Files:**
- Modify: `src/server/start.js`
- Modify: `src/server/routes/executions.js`
- Test: `test/execution-backend-config.test.js`
- Test: `test/server-api.test.js`

**Interfaces:**
- Produces: `createExecutorForBackend(root, config, options)` accepts `{ recordHarPath }`.
- Produces: coordinator can select a per-run executor for capture-enabled batches.

- [ ] **Step 1: Write failing tests**

Add a test that calls `createExecutorForBackend(root, config, { recordHarPath: "rpa/capture/raw/sample.har" })` for Playwright and asserts the returned executor exposes `backend === "playwright"` and `recordHarPath === "rpa/capture/raw/sample.har"`.

Add a coordinator/server test with a fake executor factory proving capture-enabled execution receives a HAR path while ordinary execution does not.

- [ ] **Step 2: Refactor Playwright executor creation**

Add a helper in `src/server/start.js`:

```js
function playwrightContextOptions(config, options = {}) {
  return {
    headless: config.browser.headless,
    slowMo: config.browser.slowMoMs,
    viewport: config.browser.viewport,
    acceptDownloads: true,
    args: ["--disable-session-crashed-bubble", "--no-default-browser-check"],
    ...(options.recordHarPath ? { recordHar: { path: resolvedPath(config.__rootDir ?? process.cwd(), options.recordHarPath), content: "embed" } } : {})
  };
}
```

Use this from `createLazyHiflyExecutor`.

- [ ] **Step 3: Add per-run executor factory**

In `createExecutionCoordinator`, accept `executorFactory`. For capture-enabled batches, call `executorFactory({ batch, batchDirectory, capture: batch.capture })`; otherwise use existing `executor`. Close the per-run executor in `finally`.

- [ ] **Step 4: Mark capture recording state**

Before `runBatch`, update the batch capture state to `recording` with a generated relative HAR path like `rpa/capture/raw/<batchId>.har`. After `runBatch` returns or the executor closes, set status to `recorded` if the file exists.

- [ ] **Step 5: Verify**

Run: `node --test test/execution-backend-config.test.js test/server-api.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/start.js src/server/routes/executions.js test/execution-backend-config.test.js test/server-api.test.js
git commit -m "feat: record har for capture batches"
```

---

### Task 4: HAR Extraction Service

**Files:**
- Create: `src/rpa/capture/har-extractor.js`
- Create: `src/server/routes/capture.js`
- Modify: `src/server/app.js`
- Test: `test/har-extractor.test.js`
- Test: `test/server-capture-api.test.js`

**Interfaces:**
- Produces: `extractRawStepsFromHar({ harPath, allowedHosts })`.
- Produces: `POST /api/batches/:batchId/capture/extract`.

- [ ] **Step 1: Write failing extractor tests**

Create a small in-test HAR object with one `https://hifly.cc/api/goods/upload` JSON response and one static asset. Assert extractor keeps only the API request and writes step-like data.

- [ ] **Step 2: Implement extractor**

Parse HAR JSON, filter entries by `new URL(request.url).hostname` in `["hifly.cc"]`, skip static extensions, parse JSON response content, and return:

```js
{
  source: "hifly_goods",
  captured_at: new Date().toISOString(),
  steps: [
    {
      id: "candidate_001",
      phase: "unclassified",
      method,
      url_template,
      request: { headers },
      response: { status, body }
    }
  ]
}
```

- [ ] **Step 3: Implement route**

`POST /api/batches/:batchId/capture/extract` reads the batch capture HAR path, writes `batches/<batchId>/capture/raw-steps.json`, updates capture status to `extracted`, and returns public batch.

- [ ] **Step 4: Verify**

Run: `node --test test/har-extractor.test.js test/server-capture-api.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/rpa/capture/har-extractor.js src/server/routes/capture.js src/server/app.js test/har-extractor.test.js test/server-capture-api.test.js
git commit -m "feat: extract capture steps from har"
```

---

### Task 5: Redact And Offline Replay Routes

**Files:**
- Create: `src/rpa/capture/offline-replay.js`
- Modify: `src/server/routes/capture.js`
- Test: `test/offline-replay.test.js`
- Test: `test/server-capture-api.test.js`

**Interfaces:**
- Consumes: `redactCaptureSource`, `parseCaptureManifest`, `createMockHttpClient`.
- Produces: `POST /api/batches/:batchId/capture/redact`.
- Produces: `POST /api/batches/:batchId/capture/replay`.

- [ ] **Step 1: Write failing tests**

Add route tests that start from a raw steps file, call redaction, assert `capture.status === "redacted"` and manifest exists; then call replay and assert `capture.status === "replay_passed"`.

- [ ] **Step 2: Implement redaction route**

Read `capture.raw_steps_path`, call `redactCaptureSource`, write `batches/<batchId>/capture/manifest.json` and `redaction-report.json`, update capture status to `redacted`.

- [ ] **Step 3: Implement offline replay helper**

`runOfflineCaptureReplay({ manifestPath })` loads manifest, creates mock client, injects placeholder variables `product_image_path` and `person_image_path`, runs all phases in order, and returns produced variables.

- [ ] **Step 4: Implement replay route**

Read `capture.manifest_path`, call `runOfflineCaptureReplay`, update status to `replay_passed` or `replay_failed` with `replay_error`.

- [ ] **Step 5: Verify**

Run: `node --test test/offline-replay.test.js test/server-capture-api.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/rpa/capture/offline-replay.js src/server/routes/capture.js test/offline-replay.test.js test/server-capture-api.test.js
git commit -m "feat: add capture redaction and replay routes"
```

---

### Task 6: GUI Capture Controls

**Files:**
- Modify: `web/index.html`
- Modify: `web/api.js`
- Modify: `web/app.js`
- Modify: `web/styles.css`
- Test: `test/gui-smoke.test.js`

**Interfaces:**
- Consumes: `/api/batches`, `/api/imports`, `/api/batches/:id/capture/extract`, `/redact`, `/replay`.

- [ ] **Step 1: Write failing GUI smoke test**

Extend GUI smoke to check that the queue detail renders a capture status area and buttons for extract/redact/replay when a batch has `capture.enabled=true`.

- [ ] **Step 2: Add GUI inputs**

Add checkbox controls named `captureEnabled` to single, bulk, and import panels with label `同时录制抓包产物`.

- [ ] **Step 3: Send capture option**

In `web/app.js`, include `capture: { enabled: form.captureEnabled.checked }` in JSON batch creation and append `capture_enabled=true` for multipart import when checked.

- [ ] **Step 4: Render capture state and buttons**

In `renderBatchDetail`, append a capture panel showing status and path fields. Wire buttons to new `HiflyApi.extractCapture`, `redactCapture`, and `replayCapture`.

- [ ] **Step 5: Verify**

Run: `node --test test/gui-smoke.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/index.html web/api.js web/app.js web/styles.css test/gui-smoke.test.js
git commit -m "feat: expose capture workflow in gui"
```

---

### Task 7: Documentation And Handoff

**Files:**
- Modify: `docs/PROJECT_HANDOFF.md`
- Modify: `docs/rpa/capture-runbook.md`
- Modify: `docs/CALIBRATION.md`

**Interfaces:**
- Produces: clear operating instructions for GUI capture workflow.

- [ ] **Step 1: Update runbook**

Document the new GUI path: enable capture, run one item with points confirmation, use extract/redact/replay buttons, and do not rerun real generation for processing failures.

- [ ] **Step 2: Update calibration**

Add that HAR recording requires a fresh Playwright context for capture-enabled runs.

- [ ] **Step 3: Update handoff**

Record current implementation status, remaining tests, whether any real points were consumed, and any key batch IDs.

- [ ] **Step 4: Verify docs and tests**

Run:

```bash
npm run check
node --test test/capture-workflow-state.test.js test/har-extractor.test.js test/offline-replay.test.js test/server-capture-api.test.js test/server-api.test.js test/gui-smoke.test.js
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add docs/PROJECT_HANDOFF.md docs/rpa/capture-runbook.md docs/CALIBRATION.md
git commit -m "docs: document gui capture workflow"
```

---

## Self-Review

- Spec coverage: the plan covers GUI entry options, batch persistence, HAR recording, extraction, redaction, offline replay, GUI status/actions, retry-safe post-processing, and documentation.
- Default backend safety: Tasks keep `playwright` as default and only add capture as opt-in batch behavior.
- Placeholder scan: no implementation step requires undefined future behavior; true HTTP replay is explicitly excluded from this plan.
- Type consistency: capture state fields match the spec: `enabled`, `status`, `har_path`, `raw_steps_path`, `manifest_path`, `report_path`, `replay_error`, `updated_at`.
