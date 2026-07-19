# Capture HTTP Real Small-Batch Design

## Status

Proposed. This design is documentation only. It does not implement real HTTP
batch generation. Any implementation requires a separate, explicitly authorized
plan and per-run user authorization that may consume Hifly points.

## Context

Playwright remains the production default for batch generation. Capture HTTP
has two already-merged capabilities on `main`:

- A single real Hifly live run has succeeded once (`remote_id = 640509`) via
  `POST /api/batches/:batchId/capture/live-run`, which is strictly limited to
  one item and requires `confirm`, `allowRealLive`, `acknowledgePointRisk`, and
  `limitItems = 1`.
- A fake/mock small-batch preview exists via
  `POST /api/batches/:batchId/capture/queue-run`. It is serial, stops on first
  failure, supports `resume`, skips already completed items, writes per-item
  `output_path`, registers artifacts, and exposes a public-safe `queue`
  projection. It never contacts Hifly and never consumes points.

The gap this design closes: there is no authorized, real-HTTP, multi-item batch
mode. Naively reusing the single-item `live-run` per item, or flipping the fake
queue to `real_live`, would risk unbounded point consumption, duplicate submits
on retry, and silent auth/API drift. This design defines the safety gates and
shape for a real small-batch mode that stays disabled until a future authorized
implementation lands.

Non-goals:

- Do not switch default batch generation from Playwright to capture HTTP.
- Do not implement real capture HTTP batch generation in this design pass.
- Do not run real Hifly generation unless the user explicitly authorizes point
  risk in the session that executes it.

## Required Safety Gates

Every gate maps to an existing or new mechanism so a future implementation is
constrained by code, not by operator discipline.

1. **Explicit user authorization per run.** A real batch run requires the same
   triple confirmation as the single-item live run
   (`confirm`, `allowRealLive`, `acknowledgePointRisk`) plus an explicit
   `pointBudget`. A new config flag `rpa.realLive.batch.enabled` MUST default to
   `false`; the endpoint MUST return `CAPTURE_HTTP_REAL_BATCH_DISABLED` when the
   flag is off, before any Hifly request.

2. **Operator-visible point budget.** The request MUST carry an integer
   `pointBudget` (max items to attempt this run) capped by
   `rpa.realLive.batch.maxItems` (default `3`, hard ceiling). The public queue
   projection MUST surface `point_budget`, `max_items`, attempted count, and
   completed count so the operator can see exposure before and after the run.

3. **Serial execution only.** Items run one at a time within a single request,
   reusing the existing `queue-run` loop shape. No parallel requests, no
   concurrent items.

4. **Stop on first failure.** The first item that fails MUST halt the run and
   set `queue.status = "failed"` with a stable `last_error`, exactly like the
   fake queue. Later items remain in their pre-run state and are not attempted.

5. **Per-item idempotency / duplicate-submit guard.** Each task carries an
   idempotency marker persisted before its `remote_submit` phase. A repeated
   authorized run for a task that already produced a stable `remote_id` and
   registered artifact MUST skip submit and reuse the existing evidence instead
   of re-calling Hifly. Completed items (with `output_path` and registered
   artifact) are always skipped, as in the fake queue's `completedQueueItem`.

6. **Resume only from safe failed/interrupted states.** Real-batch resume
   accepts the same recoverable set as the fake queue
   (`failed_remote`, `failed_pre_submit`, `interrupted_unknown`) plus
   `generating_asset`/`submitted` only when no stable `remote_id` exists yet.
   Resume MUST NOT re-submit an item that already has a `remote_id`.

7. **Runtime auth never written to disk.** Runtime auth (cookies, bearer token)
   comes from `createPlaywrightRuntimeAuthProvider` in memory only and is passed
   as `realLive.runtimeAuth` to the executor, exactly as the single-item
   `live-run` does. Batch JSON, RPA state, manifest, logs, and API responses
   MUST NOT contain runtime cookies or bearer values. The existing
   `persistableRequestPlan` whitelist and `publicBatch` projection stay in
   force and are extended to the new `queue.mode = "real_live"` projection.

8. **CDN/artifact URL never written to public batch JSON.** Download uses the
   existing in-memory allowlisted-host transport (`createFetchLiveTransport`).
   CDN URLs, signed query strings, and resolved request URLs MUST NOT be
   persisted; only the batch-relative `output_path` and a stable `remote_id`
   are recorded, matching the single-item `live_summary` discipline.

## API Shape

Add one disabled-by-default endpoint. Keep `queue-run` (fake) and `live-run`
(single real) unchanged.

- `POST /api/batches/:batchId/capture/real-batch-run`
  - Request body (strict allowlist):
    - `confirm: true` (required)
    - `allowRealLive: true` (required)
    - `acknowledgePointRisk: true` (required)
    - `pointBudget: integer >= 1` (required)
    - `resume: boolean` (optional, default `false`)
  - Any extra key, missing confirmation, or `pointBudget` above
    `rpa.realLive.batch.maxItems` is rejected with a stable code before any
    Hifly request.
  - Preconditions: `batch.capture.enabled === true`, a manifest exists, and
    `batch.capture.status` is one of `dry_run_passed`, `real_batch_failed`.
  - Per run: take at most `pointBudget` eligible items (recoverable set when
    `resume`, otherwise `pending`/`confirmed`), execute serially with the
    `real_live` executor + runtime auth + live transport, stop on first
    failure, register artifacts, write per-item `output_path`.
  - Public result: `capture.queue` with `mode: "real_live"`, `status`, counts,
    `current_task_id`, `point_budget`, `max_items`, timestamps, and a stable
    `last_error` code/message. No request bodies, URLs, cookies, or absolute
    paths.

New public-stable error codes (added to the GUI/API whitelist):

- `CAPTURE_HTTP_REAL_BATCH_DISABLED`
- `CAPTURE_HTTP_REAL_BATCH_NOT_AUTHORIZED`
- `CAPTURE_HTTP_REAL_BATCH_BUDGET_INVALID`
- `CAPTURE_HTTP_REAL_BATCH_NOT_READY`
- `CAPTURE_HTTP_REAL_BATCH_DUPLICATE_SUBMIT`
- `CAPTURE_HTTP_REAL_BATCH_FAILED` (generic safe message, mirrors
  `safeQueueErrorMessage`)

New capture workflow states: `real_batch_running`, `real_batch_completed`,
`real_batch_failed`.

## GUI Shape

The GUI MUST keep four visually distinct surfaces so an operator cannot confuse
them:

1. **Playwright default batch production** — the normal "开始生成" path, unchanged.
2. **Capture HTTP single live run** — existing single-item control, unchanged.
3. **Capture HTTP fake small-batch preview** — existing "抓包 HTTP 小批量预演"
   button and "小批量预演只使用本地 mock，不访问飞影、不消耗积分" copy,
   unchanged.
4. **Capture HTTP real small-batch** — a new control, disabled unless
   `rpa.realLive.batch.enabled` is on. Its copy MUST state point risk
   explicitly, require a `pointBudget` input, and gate the action behind a
   confirmation dialog that names "会访问飞影，可能消耗积分" and the hard
   `max_items` ceiling.

Run-record and queue panels MUST label `real_batch_*` states distinctly from
fake preview (`queue`) and single live (`live_summary`) so a real batch is
never mistaken for a no-network preview.

## Tests Before Real Hifly

All tests use a fake runtime auth provider and a fake live transport (no real
Hifly, no points). They MUST be green before any real run is authorized.

- Success: a 2-item batch reaches `real_batch_completed` with both items
  `completed`, distinct `output_path`s, registered artifacts, and a public
  projection with no URLs/cookies/absolute paths.
- Stop on first failure: item 1 fails in `asset_generation`; item 2 is not
  attempted; `queue.status = "failed"`; only item 1 carries `failed_remote`.
- Auth expired: transport raises `CAPTURE_HTTP_REMOTE_REJECTED`; the run halts
  with that stable code; runtime auth never persisted.
- Duplicate submit prevention: a task that already has a stable `remote_id` and
  registered artifact is skipped on a second authorized run; no second submit
  call is made; the fake transport records zero extra POSTs for that task.
- Download missing: `downloadArtifact` returns no bytes; the run halts with
  `CAPTURE_HTTP_ARTIFACT_MISSING`; no `output_path` is written for that item.
- Resume: after a failure, an authorized `resume: true` run re-attempts only
  the failed/interrupted items, preserves completed items, and respects
  `pointBudget`.
- Budget enforcement: `pointBudget` above `max_items` is rejected; a run with
  more eligible items than `pointBudget` attempts only `pointBudget` items and
  leaves the rest untouched.
- Disabled gate: with `rpa.realLive.batch.enabled` off, the endpoint returns
  `CAPTURE_HTTP_REAL_BATCH_DISABLED` and makes no transport call.

## Real Hifly Validation

Only after explicit user authorization, and only after the tests above pass:

1. One item first. Record batch id, SKU, output path, `remote_id`, and the
   point-risk acknowledgement.
2. If and only if the one-item run succeeds, run at most three items. Same
   records per item.
3. Treat fake-queue success as necessary but not sufficient evidence: a passing
   fake preview does not authorize a real run.

## Risks

- **Overconfidence from fake preview.** A green fake queue proves state-machine
  safety, not Hifly compatibility. Real validation is gated and bounded.
- **Auth drift.** Hifly login state may expire mid-batch. `CAPTURE_HTTP_REMOTE_REJECTED`
  must halt the run; resume must not re-submit items with stable `remote_id`.
- **Point overrun.** Bounded by `pointBudget` and hard `max_items`; duplicate
  submit must never double-charge for an already-submitted item.
- **Duplicate submit on retry.** The idempotency marker is the only protection
  against double charges when an operator retries after a partial failure.

## Verification Strategy

- P2 implementation: fake transport tests above, then static checks
  (`npm run check`, `npm test`, `git diff --check`).
- Real Hifly: only the authorized one-item, then at-most-three-item runs, with
  records per item. Default production stays Playwright.
