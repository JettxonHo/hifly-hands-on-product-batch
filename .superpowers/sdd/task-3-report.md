# Task 3 Report: Expose Real-Live Disabled Status

## Status

Reviewer fix complete; pending commit.

## Reviewer Fix (2026-07-17)

- `publicLiveError()` now projects only an explicit whitelist of stable live error codes. Unknown strings, URL/token/path-bearing values, and non-string legacy values are normalized to `CAPTURE_HTTP_REAL_LIVE_DISABLED` with the fixed safe message.
- Added list/detail API regression coverage for legacy `live_error.code` values containing a Hiflyworks URL and an object with token/path fields. Neither public response exposes the URL, token, or path.
- No 飞影 access, real HTTP, or points consumption occurred.

## Changes

- Added `POST /api/batches/:batchId/capture/live-status`, which records the stable `real_live_disabled` capture state without loading a manifest or invoking an HTTP client.
- Added a safe public projection for `capture.live_error`; it preserves only a stable code and the fixed authorization message.
- Added a permanently disabled GUI control labelled `真实 HTTP 生成（会访问飞影，可能消耗积分）`, separate from the no-network `真实请求预演` action.
- Added API and GUI regression coverage for the disabled state and public-response redaction boundary.

## Verification

- `node --test test/server-capture-api.test.js test/gui-smoke.test.js`: 15/15 passed.
- `npm run check`: passed, 63 JavaScript files checked.
- `git diff --check`: passed with no output.

## Self-Review

- The route is local-only: it reads and updates the batch store and does not load manifests, instantiate a capture client, or call a transport.
- The API response uses `publicBatch()` and `publicCaptureState()`, so raw live errors, paths, cookies, and other request details are not exposed.
- The real-live GUI control has no click handler and remains disabled even when the workbench is not busy.

## Safety

- Accessed 飞影: no.
- Sent real HTTP: no.
- Consumed 飞影积分: no.
- Touched `docs/resume/`, raw HAR, batches, outputs, logs, screenshots, `config.local.json`, or `node_modules`: no.

## Follow-Up

- `real_live` remains deliberately unavailable until separate explicit authorization and one-item execution controls are introduced.

---

# Task 3 Report: RPA Callback Route And State Guards

## Status

DONE

## Changes

- Added `src/rpa/callbacks.js` with localhost, callback-token, task ID, execution-key, status-order, duplicate, and regression guards for `applyRpaCallback`.
- Added `src/server/routes/rpa-callbacks.js` with `POST /api/rpa/callback`.
- Registered the callback route before static files in `src/server/app.js` and added the minimal `INVALID_RPA_CALLBACK` / `TASK_NOT_FOUND` client error codes.
- Added `test/rpa-callbacks.test.js` covering valid submission, invalid token/non-local source/stale execution key, duplicate callbacks, and status regression.

## Commit

`ebc0c3e feat: accept rpa callbacks safely`

## TDD And Verification

1. `node --test test/rpa-callbacks.test.js`
   - Red: failed as expected with `ERR_MODULE_NOT_FOUND` for `src/rpa/callbacks.js` before implementation.
2. `node --test test/rpa-callbacks.test.js`
   - Green: 3 tests passed, 0 failed.
3. `node --test test/rpa-callbacks.test.js test/server-api.test.js`
   - Passed: 35 tests passed, 0 failed.
4. `npm run check`
   - Passed: checked 48 JavaScript files.
5. `git diff --check` and `git diff --cached --check`
   - Passed with no whitespace errors.

## Concerns

- None for Task 3 scope.
- No GUI, real Yingdao RPA, Feiying automation, or credit-consuming generation was started. `docs/resume/` remained untracked and was not included in the commit.

## Reviewer Fix Report (2026-07-16)

### Changes

- Limited the request-security session bypass to `POST /api/rpa/callback`; it retains strict local Host and JSON/content-type checks, while the callback boundary continues to require localhost source and `X-RPA-Callback-Token`.
- Replaced numeric callback status ordering with the explicit transition matrix from the RPA design. Illegal forward jumps, regressions, and terminal-state transitions are ignored without writing state.
- Validated callback artifact paths before any state write: `relative_path` must be a non-empty, safe batch-relative path, never absolute, traversal-based, or outside the batch directory.
- Added callback HTTP tests for token-only routing, unchanged session protection on other POST routes, `400 INVALID_RPA_CALLBACK` and `404 TASK_NOT_FOUND` error responses, and unsafe artifact rejection.

### Commit

- `3cff441` (`fix: harden rpa callback guards`)

### Verification

- `node --test test/rpa-callbacks.test.js test/server-api.test.js`: PASS, 39/39 tests.
- `npm run check`: PASS, checked 48 JavaScript files.
- `git diff --check` and `git diff --cached --check`: PASS.

### Concerns

- No GUI, real Yingdao RPA, Feiying automation, or credit-consuming generation was started. `docs/resume/` remains untracked and excluded.

---

# Task 3 Capture Report: Dry-Run HTTP Client and Client Factory

## Status

DONE

## Implemented

- Added `createDryRunHttpClient({ manifest })`, which validates capture variables, resolves URL/header/body templates, records request risk flags, replays the sanitized response body, and never performs a network request.
- Added `createCaptureHttpClient({ mode, manifest })` and `CAPTURE_HTTP_MODES` with safe `mock` default, `real_dry_run` support, and an explicit `real_live` disable gate.
- Added focused tests covering the dry-run request plan, unresolved placeholders, unavailable APIs, factory mode selection, invalid modes, and the live-mode gate.

## Verification

- Red test command: `node --test test/rpa-capture-dry-run-client.test.js test/rpa-capture-http-client-factory.test.js`
  - Failed as expected before implementation because both new modules were absent.
- `node --test test/rpa-capture-dry-run-client.test.js test/rpa-capture-http-client-factory.test.js test/rpa-capture-mock-http.test.js`
  - Passed: 12 tests, 0 failures.
- `npm run check`
  - Passed: checked 62 JavaScript files.
- `git diff --check`
  - Passed with no output.

## Safety

- No HTTP request or real fly-high workflow was run.
- No points were consumed.
- `real_live` remains unavailable and throws `CAPTURE_HTTP_REAL_LIVE_DISABLED`.

## Commit

- `9dedb60 feat(rpa capture): add dry-run http client`

## Reviewer Fix Report (2026-07-16)

### Files Changed

- `docs/PROJECT_HANDOFF.md`
- `.superpowers/sdd/task-3-report.md`

### Verification

- `node --test test/rpa-capture-dry-run-client.test.js test/rpa-capture-http-client-factory.test.js test/rpa-capture-mock-http.test.js`: PASS, 12/12 tests.
- `npm run check`: PASS.
- `git diff --check`: PASS.

### Commit

- `e1398eeb7388e510e5322647e46b0f1d229e53b5` (`docs: record capture http dry-run client progress`)

### Concerns

- None. No Feiying access, no HTTP live execution, and no points consumed.
