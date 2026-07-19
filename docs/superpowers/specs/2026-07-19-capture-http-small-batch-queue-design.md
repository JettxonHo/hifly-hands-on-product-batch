# Capture HTTP Small-Batch Queue Design

## Status

Accepted for local implementation on 2026-07-19.

## Context

Playwright is the current production path and already covers the business workflow. Capture HTTP has completed a single-item real live run, but it is not ready to replace Playwright for batch production. The next useful step is a guarded small-batch queue that can be validated locally without contacting Hifly or consuming points.

## Decision

Add a capture HTTP small-batch queue as an experimental, opt-in workflow. The first implementation is local-only and uses fake/mock transport semantics. It must not send real HTTP requests, must not use runtime Hifly authentication, and must not change the default Playwright execution path.

## User-Facing Behavior

- GUI keeps normal "开始生成" on Playwright.
- Capture panel adds a small-batch dry-run queue action when capture is enabled and a manifest exists.
- The action is labelled as no-network and no-points.
- The queue runs one item per product, serially.
- If any item fails, the queue stops and records the failed item.
- The same batch can be retried from failed or interrupted queue state without re-entering products.
- Real HTTP small-batch remains unavailable until separately designed, reviewed, and authorized.

## Data Model

Capture state gains a `queue` object:

```json
{
  "mode": "fake",
  "status": "not_started | running | completed | failed | interrupted",
  "total": 3,
  "completed": 1,
  "failed": 0,
  "current_task_id": "task-1",
  "started_at": "2026-07-19T00:00:00.000Z",
  "updated_at": "2026-07-19T00:01:00.000Z",
  "last_error": {
    "code": "CAPTURE_HTTP_QUEUE_FAILED",
    "message": "Unable to complete the capture HTTP queue."
  }
}
```

Public API returns only normalized queue fields and stable error codes. It must not expose manifest internals, request bodies, cookies, URLs, local absolute paths, or transport details.

## API

Add:

```http
POST /api/batches/:batchId/capture/queue-run
```

Request:

```json
{
  "confirm": true,
  "mode": "fake",
  "resume": true
}
```

Rules:

- `confirm` must be `true`.
- `mode` must be `fake` in this implementation.
- Batch must have capture enabled and `manifest_path`.
- Batch must contain at least one item.
- Items already completed by a previous queue run are skipped on resume.
- Failed/interrupted queue items can be reset by running with `resume: true`.
- Real live flags are rejected on this endpoint.

## Item State

The queue uses existing item statuses where possible:

- Pending queue item starts from `pending`, `failed_remote`, or `interrupted_unknown`.
- During fake queue execution, item may be written as `generating_asset`, `asset_confirmed`, `submitted`, then `completed`.
- Completed fake artifacts are batch-local placeholders registered through the existing artifact mechanism.
- Failure writes `status = failed_remote`, `error_phase = capture_http_queue`, and a safe generic `error_message`.

## Safety

- No real Hifly network calls.
- No runtime auth provider is used.
- No real live transport is used.
- No points can be consumed by this endpoint.
- Playwright execution routes and default GUI start button are unchanged.
- Artifact output remains inside the batch `artifacts/` directory and registered by artifact id.

## Testing

- API test: queue rejects missing confirmation and non-fake mode.
- API test: queue runs three items serially with fake capture executor and registers three artifacts.
- API test: failed item can resume without recreating the batch.
- GUI smoke test: capture panel shows small-batch fake queue action and no-points copy.
- Regression: existing live-run single-item route remains limit-one and unchanged.

## Non-Goals

- No real HTTP batch execution.
- No parallel execution.
- No automatic switch from Playwright to capture HTTP.
- No new Hifly point-consuming behavior.
