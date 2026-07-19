# Capture HTTP Small-Batch Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a guarded no-network capture HTTP small-batch queue that can validate multi-item capture flow without replacing Playwright or consuming Hifly points.

**Architecture:** Extend capture workflow state with a public-safe queue summary, add a `queue-run` API that uses existing capture HTTP executor in mock/fake mode, and expose a clearly labelled GUI action. The real Hifly live-run path remains single-item and unchanged.

**Tech Stack:** Node.js, Fastify inject tests, existing capture HTTP executor, existing vanilla JS GUI.

## Global Constraints

- Default production generation remains Playwright.
- `queue-run` only supports `mode: "fake"` in this implementation.
- No runtime Hifly auth, real live transport, or real Hifly network access.
- Do not commit `config.local.json`, login state, `batches/`, HAR/logs/videos/outputs/node_modules, screenshots, or raw capture.
- Update `docs/PROJECT_HANDOFF.md` after implementation.

---

### Task 1: Capture Queue State Projection

**Files:**
- Modify: `src/rpa/capture/workflow-state.js`
- Test: `test/capture-workflow-state.test.js`

**Interfaces:**
- Produces: `publicCaptureState(capture).queue`

- [ ] Add a queue projection that returns only `mode`, `status`, counts, task id, timestamps, and stable `last_error`.
- [ ] Add tests that unsafe queue details are not published.
- [ ] Run: `node --test test/capture-workflow-state.test.js`

### Task 2: Fake Queue API

**Files:**
- Modify: `src/server/routes/capture.js`
- Test: `test/server-capture-api.test.js`

**Interfaces:**
- Consumes: `updateCaptureState()`
- Produces: `POST /api/batches/:batchId/capture/queue-run`

- [ ] Add request validation for `{ confirm: true, mode: "fake", resume?: boolean }`.
- [ ] Require capture enabled, manifest path, and one or more items.
- [ ] Use `createCaptureHttpExecutor()` with `captureHttpMode: "mock"` and process eligible items serially.
- [ ] Register fake artifacts through `store.registerArtifact()`.
- [ ] On success, set capture queue status `completed`.
- [ ] On failure, stop the queue, mark the item `failed_remote`, and set queue status `failed`.
- [ ] Run: `node --test test/server-capture-api.test.js`

### Task 3: GUI Action

**Files:**
- Modify: `web/api.js`
- Modify: `web/app.js`
- Test: `test/gui-smoke.test.js`

**Interfaces:**
- Consumes: `api.runCaptureQueue(batchId)`
- Produces: capture panel action "抓包 HTTP 小批量预演"

- [ ] Add `runCaptureQueue()` to the web API wrapper.
- [ ] Show queue summary in the capture panel.
- [ ] Add a button that is enabled only for capture-enabled batches with manifest/dry-run or failed queue state.
- [ ] Use confirmation copy that states no Hifly access and no point consumption.
- [ ] Run: `node --test test/gui-smoke.test.js`

### Task 4: Docs and Full Verification

**Files:**
- Modify: `docs/PROJECT_HANDOFF.md`
- Modify: `docs/SOP.md`
- Optional Modify: `docs/ENVIRONMENT.md`

**Interfaces:**
- Produces: durable handoff entry and SOP warning that capture small-batch is experimental.

- [ ] Record that implementation is no-network and no-points.
- [ ] Record verification commands and results.
- [ ] Run: `npm run check`
- [ ] Run: `npm test`
- [ ] Run: `git diff --check`
- [ ] Commit the relevant files only.
