# Task 5 Implementation and Test Report

## Scope

Implemented the recoverable Hifly batch execution path without modifying files outside the assigned Task 5 surface. The pre-existing untracked `MEMORY.md` was left untouched. No commit or push was performed.

## Implementation

- Added `src/core/batch-runner.js`.
  - Requires a matching acquired execution lock and validates confirmed tasks against the current execution snapshot before work begins.
  - Atomically persists each state-machine transition and structured checkpoint event.
  - Drives the normal path: `confirmed -> generating_asset -> asset_confirmed -> submitted -> download_pending -> completed`.
  - Persists the pre-submit checkpoint through the executor context before the remote click.
  - Converts submit-boundary exceptions, restored `generating_asset`, and restored `asset_confirmed` tasks to `interrupted_unknown` without re-submitting.
  - Recovers known remote IDs through reconciliation only; ambiguous candidates remain `interrupted_unknown`.
  - Treats `download_pending` as download-only and leaves a failed download retryable in that state.

- Added `src/executors/fake-executor.js`.
  - Implements every adapter method without Playwright or remote calls.
  - Records method calls and supports `failAt`, `pauseAt`, `remoteCandidates`, and `downloadFailure` scenarios.
  - Models the submit checkpoint before a simulated submit-boundary failure.

- Added `src/executors/hifly-executor.js`.
  - Wraps `HiflyHandsOnProductPage` behind the existing adapter contract.

- Extended `src/hifly-page.js` with explicit prepare, submit, query, reconcile, and download operations.
  - Records pre-submit and post-submit work observations.
  - Prefers observable remote IDs and returns ambiguity when a single post-submit work cannot be established.
  - Requires a uniquely matched work candidate to download; it no longer assumes the final visible download control belongs to this task.

- Reworked `src/run-batch.js` to create a confirmed snapshot, acquire the global lock before launching Playwright, create the real executor, and invoke `runBatch`.

## Tests Added

- `test/batch-runner.test.js`
  - Normal checkpointed lifecycle and artifact persistence.
  - Snapshot mismatch rejection before executor calls.
  - Download-pending download-only retry.
  - Submit-boundary failure persists a checkpoint then becomes `interrupted_unknown`.

- `test/recovery.test.js`
  - Persisted `asset_confirmed` crash becomes `interrupted_unknown` with no generation or submit calls.
  - A remote ID precisely selects its matching candidate despite other candidates.
  - Multiple unqualified candidates remain `interrupted_unknown` and never submit.

## Verification

- `node --test test/batch-runner.test.js test/recovery.test.js`: 7 passed, 0 failed.
- `npm test`: 59 passed, 0 failed.
- `npm run validate`: validated 3 product rows.
- `npm run check`: exited 0.
- Explicit `node --check` passed for the runner, both executors, Hifly page, and CLI.
- `git diff --check`: no whitespace errors.

## Operational Note

The real Hifly adapter was intentionally not invoked against Hifly or Playwright, per task constraints. Its DOM selectors and observable work identifiers should be calibrated against the authenticated production page before a paid batch is run.

---

## Task 5 Fix Follow-up (2026-07-11)

### Findings Resolved

- P0: Submission and recovery now require stable remote identity evidence. A sole post-checkpoint work with only an index-derived `work_key` remains ambiguous in `HiflyHandsOnProductPage.submitVideo`, and runner reconciliation leaves the task `interrupted_unknown`. The runner still accepts a uniquely matching remote ID or URL, including task-bound checkpoint evidence that agrees with the matched candidate.
- P1: Downloads no longer reuse the previously observed list index. The adapter finds the current download control by remote ID across supported data attributes, with a remote-URL card fallback. A page-double regression fails if `nth(index)` is used.
- P1: `runBatch` validates an acquired lock with `inspect()` and `heartbeat()` before any executor use. It requires a complete owner identity (`batchId`, `instanceId`, and `pid`), exact ownership agreement, and a fresh inspected heartbeat. Metadata-only, forged/incomplete, stale, and mismatched locks all block executor calls.
- P1: Snapshot verification applies to every execution-bound item (every item retaining an execution key), before normal execution, reconciliation, remote query, or download-only recovery. It checks both the stored batch snapshot key when present and every task key against the current content snapshot. A completed earlier item remains part of a multi-item batch snapshot, so later confirmed work proceeds normally.
- P2: Added bounded fake-executor coverage for pre-submit auth pause and failed-download retry. A failed download remains `download_pending`; the retry calls only `downloadArtifact`.

### Regression Evidence

- `test/batch-runner.test.js`
  - Metadata-only, stale, and mismatched lock rejection before executor calls.
  - Failed-download retry stays download-only; pre-submit pause performs no submit/download.
  - A completed first item does not invalidate the second confirmed item's snapshot.
  - A reordered work-list page double proves stable-ID download selection without Playwright.
  - The page adapter itself returns `ambiguous` for a sole new work with no ID or URL.
- `test/recovery.test.js`
  - A sole post-checkpoint candidate with only `work_key` stays `interrupted_unknown`.
  - Snapshot drift blocks reconciliation, remote query, and download-only recovery before executor calls.

### Verification

- `node --test test/batch-runner.test.js test/recovery.test.js`: 19 passed, 0 failed.
- `node --test`: 71 passed, 0 failed.
- No Hifly visit, Playwright launch, or points-consuming operation was performed.
- No commit or push was performed. Unrelated worktree changes, including root `MEMORY.md`, were left untouched.

---

## Task 5 Security Fix Follow-up (2026-07-11)

### Security Changes

- List deltas from before/after latest-work observations are now diagnostic-only. `submitVideo` always returns `ambiguous` from this page path, even when exactly one new work has a stable remote ID or URL. List-only reconciliation also cannot promote an item to submitted state or drive a download; recovery requires a stable identity already recorded from the specific submission.
- Every executor call now revalidates the live global lock and rereads the persisted execution snapshot before invocation. Confirmed, asset, submitted, download, and interrupted recovery statuses require an execution key; missing or drifted keys reject before the executor is called.
- Lock authenticity is verified through a module-private acquired-handle capability. Duck-typed objects with copied metadata plus `inspect` and `heartbeat` methods cannot pass the runner gate.

### Calibration Need

The current production page adapter does not expose an identity returned or directly correlated to the specific submission. Before paid use, calibrate it against the authenticated UI to capture such a task-bound remote ID or URL; until then, submissions safely stop as `ambiguous` / `interrupted_unknown` and are never auto-resubmitted or downloaded from a list delta.

### Regression Evidence

- Added coverage for a sole new stable-ID list entry remaining ambiguous, recovery refusing list-only stable IDs, fresh forged lock handles, every side-effecting status with a missing key, and lock/snapshot changes after asset generation preventing a later submit call.
- Focused suite: `node --test test/execution-lock.test.js test/batch-runner.test.js test/recovery.test.js` passed 33 tests with 0 failures.

### Final Verification Update

- Added the legacy persisted list-delta download regression after the initial focused run. Final focused suite: `node --test test/execution-lock.test.js test/batch-runner.test.js test/recovery.test.js` passed 34 tests with 0 failures.
- Final `npm test`: 82 tests passed, 0 failed.
- `node --check src/core/execution-lock.js`, `node --check src/core/batch-runner.js`, and `node --check src/hifly-page.js` all exited successfully. `git diff --check` reported no whitespace errors.
- No Hifly visit, Playwright launch, point spend, commit, or push was performed. Root `MEMORY.md` and pre-existing unrelated changes remain untouched.

---

## Final Focused Security Fix (2026-07-11)

### Evidence Provenance

- Recovery now treats submission evidence as valid only when it has a stable remote identity and explicit `evidence_source: "direct_submission"`. Bare legacy `{ remote_id }` data remains `interrupted_unknown`; it cannot advance into query or download work.
- Any `list_delta` source or before/after work-list evidence remains non-authoritative, even when it includes a remote ID. The current page adapter continues to return `ambiguous` for DOM list-delta observations and does not manufacture direct-submission evidence.
- The fake executor's ordinary successful submit response now carries `evidence_source: "direct_submission"` so test-only direct results follow the same durable contract.

### Lock Ownership

- Replaced runner use of the mutable-handle verifier with exported `assertExecutionLockOwnership(handle, { batchId })`. Its identity, inspection, heartbeat functions, and freshness threshold are captured in module-private acquisition state; verification never reads mutable public handle fields or methods.
- Acquired lock handles and exposed metadata are frozen. Heartbeat and release retain their existing behavior through private closures.

### Regression Coverage

- Added recovery tests for bare legacy remote-ID evidence and `list_delta` remote-ID evidence; both remain `interrupted_unknown` and make no query/download call.
- Added a real acquired-handle mutation regression: replacing public metadata/methods is rejected, and a changed on-disk identity still fails private ownership validation.

### Verification

- `node --test test/execution-lock.test.js test/batch-runner.test.js test/recovery.test.js`: 37 passed, 0 failed.
- `node --check src/core/execution-lock.js && node --check src/core/batch-runner.js && node --check src/executors/fake-executor.js && node --check src/hifly-page.js`: exited 0.
- `npm test`: 85 passed, 0 failed.
- No live Hifly access, Playwright launch, points spend, commit, or push was performed. Root `MEMORY.md` was not touched.

---

## Task 5 Custom Script Automation (2026-07-15)

### Status

Completed.

### Changes

- `src/hifly-page.js`: `fillProduct` now delegates script handling to `applyScriptMode`.
- Custom mode requires a non-empty script and configured script label, disables the visible `AI 自动生成` switch, fills the script, and reads the field back to verify text before `prepareAsset` can complete.
- Missing switch, failed switch state transition, missing text field, or unverified script text throws before the outer video submission. The existing runner maps this asset-stage failure to `failed_pre_submit`.
- `hifly_ai` mode remains a no-op for script controls and keeps the existing Hifly AI path.
- `test/batch-runner.test.js`: added regression coverage for mode application order, default-mode preservation, script verification failure, and runner pre-submit failure without `submitVideo`.

### Verification

- `node --test test/batch-runner.test.js`: 52 passed, 0 failed.
- `npm run check`: passed; checked 43 JavaScript files.
- `git diff --check`: passed with no whitespace errors.

### Hifly Credits

No real Hifly flow was launched and no Hifly credits were consumed.
