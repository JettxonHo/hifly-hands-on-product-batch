# Task 4 Report: Wire Dry-Run Mode Into Capture HTTP Executor

## Status

DONE

## Commit

- `dcd774b feat(rpa capture): wire dry-run executor mode`

## Changes

- `src/executors/capture-http-executor.js` now normalizes `captureHttpMode`, creates clients through `createCaptureHttpClient`, and exposes the selected mode on the executor.
- Replay phases now return produced variables plus dry-run request-plan entries. The executor persists `capture_http_mode` and accumulates `request_plan` entries across asset generation, submission, query, and download in RPA state.
- Submission evidence carries the batch and task identifiers so direct executor calls can append query-stage plans to the correct state file.
- Added coverage that exercises all four dry-run phases without network access and verifies the persisted request plan and risk flags.
- Added backend-selection coverage for preserving `real_dry_run` mode.

## Test Adaptation

The brief's sample import block conflicted with the existing test imports because all required helpers were already imported, so no import changes were needed. The sample task image path was adapted to a file under the temporary batch's `uploads/` directory because `createRpaTaskPackage` correctly rejects product images outside the batch directory.

## Verification

- `node --test test/capture-http-executor.test.js test/execution-backend-config.test.js test/batch-runner.test.js` - 70 passed, 0 failed.
- `npm run check` - passed; checked 62 JavaScript files.
- `git diff --check` - passed with no output.

## Safety

- No network requests were made.
- No real Fly credits were consumed.
- Only the three task-owned source/test files were committed. Pre-existing changes to Task 1/2 reports and `docs/resume/` were left untouched.

## Reviewer Fix Report

- Files changed: `docs/PROJECT_HANDOFF.md`, `.superpowers/sdd/task-4-report.md`.
- Check result: `git diff --check` passed with no output.
- Commit SHA: `9cf437bb2ca25c0314dc9170d7cb5e09427e3f94` (`docs: record capture http executor dry-run progress`).
- Concerns: none.
