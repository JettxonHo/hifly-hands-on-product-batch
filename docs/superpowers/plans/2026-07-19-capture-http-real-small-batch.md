# Capture HTTP Real Small-Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a disabled-by-default, serial, stop-on-failure, resumable real HTTP small-batch mode on top of the existing capture HTTP queue and single-item live run, gated by explicit point-risk authorization.

**Architecture:** Reuse the merged `queue-run` loop shape (serial, stop-on-first-failure, resume, completed-skip, public-safe `queue` projection) and feed it the `real_live` executor + runtime auth + live transport already used by the single-item `live-run`. Add a per-item idempotency marker so retries never double-submit. Keep the new mode off behind `rpa.realLive.batch.enabled` (default `false`) and a per-run `pointBudget`. Default production stays Playwright.

**Tech Stack:** Node.js, Fastify, node:test, existing capture HTTP modules (`src/rpa/capture/*`, `src/executors/capture-http-executor.js`, `src/server/routes/capture.js`), existing fake live transport fixtures.

## Global Constraints

- Default production generation remains Playwright; do not change `executionBackend` or the default `captureHttpMode`.
- The real batch mode MUST be disabled by default (`rpa.realLive.batch.enabled = false`). The endpoint returns `CAPTURE_HTTP_REAL_BATCH_DISABLED` and makes no transport call when disabled.
- Do not run real Hifly generation or real HTTP live requests unless the user explicitly authorizes point risk in the executing session. All tests in Tasks 1–4 use fake runtime auth + fake transport only.
- Runtime auth (cookies, bearer token) is in-memory only; it MUST NOT be written to batch JSON, RPA state, manifest, logs, or API responses. CDN/signed URLs and resolved request URLs MUST NOT be persisted; only batch-relative `output_path` and stable `remote_id` are recorded.
- Per run: serial execution only, stop on first failure, resume only from the recoverable set, never re-submit an item that already has a stable `remote_id`.
- Hard ceiling `rpa.realLive.batch.maxItems` defaults to `3`. `pointBudget` per run must be an integer `>= 1` and `<= maxItems`.
- Do not commit `config.local.json`, login state, `batches/`, HAR/logs/videos/outputs/node_modules, screenshots, raw capture, or unrelated dirty files.
- Update `docs/PROJECT_HANDOFF.md` after completing each task that changes behavior.

---

### Task 1: API Gate and Config Flag (Disabled by Default)

**Files:**
- Modify: `src/server/routes/capture.js` — add `realBatchRunFields` validator and a `POST /api/batches/:batchId/capture/real-batch-run` route that only enforces the gate in this task.
- Modify: `src/rpa/capture/workflow-state.js` — add `real_batch_running`, `real_batch_completed`, `real_batch_failed` to the allowed status set and to the public-safe projection.
- Test: `test/server-capture-api.test.js` — add disabled-gate and field-validation cases.

**Interfaces:**
- Consumes: `registerCaptureRoutes(app, { batchRoot, store, generationConfig, captureLive })` already wired in `src/server/app.js`; `generationConfig.rpa.realLive.batch`.
- Produces: `POST /api/batches/:batchId/capture/real-batch-run` returning `CAPTURE_HTTP_REAL_BATCH_DISABLED` (503) when disabled, and field-validation errors before any state change.

- [ ] **Step 1: Write the failing tests**

Append to `test/server-capture-api.test.js`:

```js
test("real-batch-run is disabled by default and rejects before any state change", async () => {
  const { app, store, root } = await buildCaptureApp({}); // generationConfig has no rpa.realLive.batch
  await store.create({ batch_id: "batch-real-disabled", status: "completed", uploads: [], artifacts: [], items: [],
    capture: { enabled: true, status: "dry_run_passed", manifest_path: "batches/batch-real-disabled/capture/manifest.json" } });
  const res = await app.inject({ method: "POST", url: "/api/batches/batch-real-disabled/capture/real-batch-run",
    body: { confirm: true, allowRealLive: true, acknowledgePointRisk: true, pointBudget: 1 } });
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).code, "CAPTURE_HTTP_REAL_BATCH_DISABLED");
  const after = await store.read("batch-real-disabled");
  assert.equal(after.capture.status, "dry_run_passed"); // unchanged
});

test("real-batch-run validates authorization fields and point budget", async () => {
  const { app, store } = await buildCaptureApp({ rpa: { realLive: { batch: { enabled: true, maxItems: 3 } } } });
  await store.create({ batch_id: "batch-real-gate", status: "completed", uploads: [], artifacts: [], items: [],
    capture: { enabled: true, status: "dry_run_passed", manifest_path: "batches/batch-real-gate/capture/manifest.json" } });
  const base = { confirm: true, allowRealLive: true, acknowledgePointRisk: true };
  for (const [body, code] of [
    [{ ...base, pointBudget: 1, extra: 1 }, "INVALID_CAPTURE_REAL_BATCH_REQUEST"],
    [{ allowRealLive: true, acknowledgePointRisk: true, pointBudget: 1 }, "CAPTURE_HTTP_REAL_BATCH_NOT_AUTHORIZED"],
    [{ ...base, pointBudget: 0 }, "CAPTURE_HTTP_REAL_BATCH_BUDGET_INVALID"],
    [{ ...base, pointBudget: 4 }, "CAPTURE_HTTP_REAL_BATCH_BUDGET_INVALID"]
  ]) {
    const res = await app.inject({ method: "POST", url: "/api/batches/batch-real-gate/capture/real-batch-run", body });
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).code, code);
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/server-capture-api.test.js`
Expected: the two new tests FAIL (route returns 404 or wrong code).

- [ ] **Step 3: Implement the gate and field validator**

In `src/server/routes/capture.js`, add helpers and the route body that ONLY does gating in this task:

```js
function realBatchDisabledFailure() {
  return { code: "CAPTURE_HTTP_REAL_BATCH_DISABLED", message: "real small-batch is disabled until explicitly authorized." };
}
function realBatchNotAuthorizedFailure() {
  return { code: "CAPTURE_HTTP_REAL_BATCH_NOT_AUTHORIZED", message: "real small-batch requires explicit point-risk authorization." };
}
function realBatchBudgetInvalidFailure() {
  return { code: "CAPTURE_HTTP_REAL_BATCH_BUDGET_INVALID", message: "pointBudget must be an integer between 1 and maxItems." };
}

function realBatchRunFields(body, maxItems) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw captureError("INVALID_CAPTURE_REAL_BATCH_REQUEST");
  const allowed = new Set(["confirm", "allowRealLive", "acknowledgePointRisk", "pointBudget", "resume"]);
  for (const key of Object.keys(body)) if (!allowed.has(key)) throw captureError("INVALID_CAPTURE_REAL_BATCH_REQUEST");
  if (body.confirm !== true || body.allowRealLive !== true || body.acknowledgePointRisk !== true) {
    throw captureError("CAPTURE_HTTP_REAL_BATCH_NOT_AUTHORIZED");
  }
  if (!Number.isInteger(body.pointBudget) || body.pointBudget < 1 || body.pointBudget > maxItems) {
    throw captureError("CAPTURE_HTTP_REAL_BATCH_BUDGET_INVALID");
  }
  return { pointBudget: body.pointBudget, resume: body.resume === true };
}
```

Register the route (Task 1 returns the disabled gate only):

```js
app.post("/api/batches/:batchId/capture/real-batch-run", async (request) => {
  const batchId = assertBatchId(request.params.batchId);
  const batchConfig = generationConfig.rpa?.realLive?.batch || {};
  if (batchConfig.enabled !== true) throw Object.assign(new Error("CAPTURE_HTTP_REAL_BATCH_DISABLED"), { code: "CAPTURE_HTTP_REAL_BATCH_DISABLED", statusCode: 503 });
  const fields = realBatchRunFields(request.body, batchConfig.maxItems ?? 3);
  await readCaptureBatch(batchId); // throws CAPTURE_NOT_ENABLED if capture off
  // Execution is implemented in Task 2. Task 1 stops here with not-ready until then.
  throw captureError("CAPTURE_HTTP_REAL_BATCH_NOT_READY", 501);
  void fields;
});
```

In `src/rpa/capture/workflow-state.js`, extend the status allowlist and public projection to accept `real_batch_running`, `real_batch_completed`, `real_batch_failed` (no new persisted fields yet; mirror the `queue` projection rules).

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/server-capture-api.test.js`
Expected: PASS (disabled returns 503 with the right code; validation cases return their codes; not-ready path is not reached by Task 1 tests).

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/capture.js src/rpa/capture/workflow-state.js test/server-capture-api.test.js
git commit -m "feat(capture): add disabled real-batch-run gate"
```

### Task 2: Fake-Transport Real-Batch State Machine

**Files:**
- Modify: `src/server/routes/capture.js` — replace the Task 1 not-ready stub with a serial loop modeled on `queue-run`, using `liveRunConfig` + runtime auth + live transport and a `mode: "real_live"` queue projection.
- Test: `test/server-capture-api.test.js` — success (2 items), stop-on-first-failure, auth expired, download missing, budget enforcement.

**Interfaces:**
- Consumes: `createCaptureHttpExecutor({ root, config: liveRunConfig(...) })` (already supports `real_live`), `captureLive.authProvider.getRuntimeAuth()`, `captureLive.transport` (fake in tests), `taskWithApprovedImagePath`, `summarizeBatch`, `completedQueueItem`, `runnableQueueItem`.
- Produces: `capture.queue` with `mode: "real_live"`, per-item `output_path`, registered artifacts, and `real_batch_*` capture status.

- [ ] **Step 1: Write the failing tests**

Use a fake transport that records calls and can be told to fail per phase:

```js
function fakeLiveTransport({ failPhase, perTaskRemoteId }) {
  const calls = [];
  let taskCounter = 0;
  return {
    calls,
    async request({ stepId, phase }) {
      calls.push({ stepId, phase });
      if (failPhase && phase === failPhase) {
        const err = new Error("simulated");
        err.code = phase === "asset_generation" ? "CAPTURE_HTTP_REMOTE_REJECTED" : "CAPTURE_HTTP_ARTIFACT_MISSING";
        throw err;
      }
      if (stepId === "download_video") return { artifact: { filename: `video-${perTaskRemoteId}.mp4`, bytes: Buffer.from("bytes") } };
      return {};
    }
  };
}
```

Test: with `rpa.realLive.batch.enabled` and a 2-item `dry_run_passed` batch, an authorized `pointBudget: 2` run reaches `real_batch_completed`, both items `completed` with distinct `output_path`, and the public response contains no URL/cookie/absolute path (assert via `publicBatch` shape). Test stop-on-first-failure: `failPhase: "asset_generation"` halts on item 1, item 2 stays `pending`, `queue.status === "failed"`, `last_error.code === "CAPTURE_HTTP_REAL_BATCH_FAILED"`. Test budget: `pointBudget: 1` with 2 eligible items attempts only the first.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/server-capture-api.test.js`
Expected: FAIL (route still returns not-ready).

- [ ] **Step 3: Implement the serial real-batch loop**

In `src/server/routes/capture.js`, replace the Task 1 stub body. Mirror `queue-run`: compute eligible items (recoverable set when `fields.resume`, else `pending`/`confirmed`), cap by `fields.pointBudget`, set `queue.mode = "real_live"` + `status: "running"`, then loop serially: `executor.createAsset` → `submitVideo` → `querySubmission` → `downloadArtifact`, register artifact, write `output_path`, increment completed. On any error, mark the current item `failed_remote` with `error_phase: "capture_http_real_batch"` and a safe message, set `queue.status: "failed"` with `last_error: realBatchFailure(error?.code)`, and stop. On full success set `real_batch_completed`. Get runtime auth via `captureLive.authProvider.getRuntimeAuth()` exactly as `live-run` does; reject with `CAPTURE_HTTP_RUNTIME_AUTH_UNAVAILABLE` (503) if absent. Use `liveRunConfig(generationConfig, manifestPath)` for the executor.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/server-capture-api.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/capture.js test/server-capture-api.test.js
git commit -m "feat(capture): serial real-batch state machine with fake transport"
```

### Task 3: Duplicate-Submit Guard and Resume

**Files:**
- Modify: `src/server/routes/capture.js` — before each item's submit, skip if the task already has a stable `remote_id` AND a registered artifact; enforce resume-set rules.
- Modify: `src/rpa/capture/workflow-state.js` — allow `real_batch_failed` as an entry state and keep the `queue` projection stable across resume.
- Test: `test/server-capture-api.test.js` — duplicate-submit prevention, resume after failure.

**Interfaces:**
- Consumes: `batch.items[].remote_evidence.remote_id`, `store.registerArtifact`, registered-artifact membership.
- Produces: a skipped item reuses existing `output_path`/evidence; resume re-attempts only the failed/interrupted set.

- [ ] **Step 1: Write the failing tests**

```js
test("real-batch resume skips already-submitted items and does not re-submit", async () => {
  const transport = fakeLiveTransport({});
  const { app, store } = await buildCaptureApp({ rpa: { realLive: { batch: { enabled: true, maxItems: 3 } } } }, transport);
  // Seed a batch where item-1 already has remote_id + registered artifact, item-2 is failed_remote.
  await store.create({ /* item-1: completed with remote_evidence.remote_id and a registered artifact; item-2: failed_remote */ });
  const res = await app.inject({ method: "POST", url: "/api/batches/.../capture/real-batch-run",
    body: { confirm: true, allowRealLive: true, acknowledgePointRisk: true, pointBudget: 2, resume: true } });
  assert.equal(JSON.parse(res.body).batch.capture.status, "real_batch_completed");
  // transport.calls must contain no submit POST for item-1 (only item-2's run).
  assert.equal(transport.calls.some((c) => c.phase === "remote_submit" && /* item-1 marker */ false), false);
});

test("real-batch refuses to re-submit an item that already has a remote_id", async () => {
  // item with remote_evidence.remote_id but no artifact yet: resume must not call submit again;
  // if no safe path exists, fail with CAPTURE_HTTP_REAL_BATCH_DUPLICATE_SUBMIT rather than re-submit.
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/server-capture-api.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the guard and resume rules**

In the loop, for each eligible item: if `item.remote_evidence?.remote_id` exists AND the batch has a registered artifact matching `item.output_path`, skip submit/download and reuse existing evidence (count as completed). If `item.remote_evidence?.remote_id` exists but there is no registered artifact, throw `CAPTURE_HTTP_REAL_BATCH_DUPLICATE_SUBMIT` (do NOT re-submit). Extend `runnableQueueItem`-style eligibility for real-batch resume to the recoverable set (`failed_remote`, `failed_pre_submit`, `interrupted_unknown`), never including items with a stable `remote_id` unless they are in the safe re-download path.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/server-capture-api.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/routes/capture.js src/rpa/capture/workflow-state.js test/server-capture-api.test.js
git commit -m "feat(capture): duplicate-submit guard and real-batch resume"
```

### Task 4: GUI Copy and Explicit Authorization Controls

**Files:**
- Modify: `web/index.html`, `web/app.js`, `web/styles.css` — add a real-batch control visible only when the runtime exposes `rpa.realLive.batch.enabled`; require a `pointBudget` input and a confirmation dialog naming point risk and the `max_items` ceiling.
- Modify: `src/server/routes/batches.js` (or runtime endpoint) — expose `realBatchEnabled` and `realBatchMaxItems` in the public-safe runtime info.
- Test: `test/gui-smoke.test.js` — disabled-by-default hides the control; enabled shows it with point-risk copy and a `pointBudget` input.

**Interfaces:**
- Consumes: public runtime info (`realBatchEnabled`, `realBatchMaxItems`), `POST /api/batches/:batchId/capture/real-batch-run`.
- Produces: an operator-visible, point-risk-labelled control distinct from the fake preview and single live run.

- [ ] **Step 1: Write the failing test**

```js
test("real-batch GUI control is hidden when disabled and shows point-risk copy when enabled", async (t) => {
  // disabled runtime: assert no "真实小批量生成" control is visible.
  // enabled runtime: assert the control is visible, shows "会访问飞影，可能消耗积分",
  //   shows the max_items ceiling, and has a pointBudget input; the action opens a confirmation dialog.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/gui-smoke.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the GUI control**

Add the control behind `realBatchEnabled`, with copy that separates it from "抓包 HTTP 小批量预演（不消耗积分）", a numeric `pointBudget` input bounded by `realBatchMaxItems`, and a confirmation dialog that sends `{ confirm, allowRealLive, acknowledgePointRisk, pointBudget }`. Render `real_batch_*` states in the queue/run-record panels distinctly from fake preview and single live.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/gui-smoke.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add web/index.html web/app.js web/styles.css src/server/routes/batches.js test/gui-smoke.test.js
git commit -m "feat(gui): real small-batch authorization control"
```

### Task 5: Docs and One-Item Authorized Validation Checklist

**Files:**
- Modify: `docs/SOP.md`, `docs/rpa/capture-runbook.md`, `docs/PROJECT_HANDOFF.md`.
- Create: `docs/rpa/capture-real-batch-checklist.md` — the authorized one-item (then ≤3) validation checklist.

**Interfaces:**
- Consumes: this plan and its spec.
- Produces: operator-facing procedure and handoff record.

- [ ] **Step 1: Write the SOP and runbook updates**

Document that Playwright stays the default, that real small-batch is opt-in and point-consuming, the `pointBudget`/`maxItems` meaning, and the recoverable resume set.

- [ ] **Step 2: Write the authorized validation checklist**

`docs/rpa/capture-real-batch-checklist.md` lists: get explicit session authorization, run fake-transport tests green first, run ONE item, record batch id/SKU/output path/remote_id/point-risk, then at most three items, and the stop conditions (`CAPTURE_HTTP_REMOTE_REJECTED`, `CAPTURE_HTTP_ARTIFACT_MISSING`, `CAPTURE_HTTP_REAL_BATCH_DUPLICATE_SUBMIT`).

- [ ] **Step 3: Record final verification and update handoff**

Run `npm run check`, `npm test`, `git diff --check`; append a `docs/PROJECT_HANDOFF.md` entry recording P2 real-batch is implemented-but-disabled-by-default and remains off until authorized.

- [ ] **Step 4: Commit**

```bash
git add docs/SOP.md docs/rpa/capture-runbook.md docs/rpa/capture-real-batch-checklist.md docs/PROJECT_HANDOFF.md
git commit -m "docs(capture): real small-batch SOP and validation checklist"
```

## Self-Review Checklist

- Every real Hifly or point-consuming action requires explicit session authorization; Tasks 1–4 use fake transport only.
- The real batch mode is disabled by default and bounded by `pointBudget` + hard `maxItems`.
- Serial execution, stop-on-first-failure, resume, and duplicate-submit guard are each covered by a test.
- Runtime auth and CDN/signed URLs are never persisted; only `output_path` + `remote_id`.
- Default production stays Playwright; `queue-run` (fake) and `live-run` (single) are unchanged.
- `docs/PROJECT_HANDOFF.md` is updated with actual verification results.
