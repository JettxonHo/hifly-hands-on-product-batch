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
