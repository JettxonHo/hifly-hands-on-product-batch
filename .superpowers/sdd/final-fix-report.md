# Capture HTTP Final-Fix Report

## Scope

Final-review fixes for `f9b9b45..fe4e2c5`. This work used only local fixtures, Fastify injection, and Playwright GUI smoke tests. It did not access Hifly, send real HTTP requests, or consume points.

## Changed Files

- `src/rpa/capture/workflow-state.js`
- `src/rpa/capture/redact.js`
- `src/rpa/capture/har-extractor.js`
- `src/rpa/capture/http-client-factory.js`
- `src/executors/capture-http-executor.js`
- `src/server/routes/capture.js`
- `web/app.js`
- `test/server-capture-api.test.js`
- `test/har-extractor.test.js`
- `test/rpa-capture-redact.test.js`
- `test/rpa-capture-http-client-factory.test.js`
- `test/capture-http-executor.test.js`
- `test/gui-smoke.test.js`
- `docs/rpa/capture-runbook.md`
- `docs/PROJECT_HANDOFF.md`

## Findings Addressed

1. Public capture state is now a whitelist projection. Legacy full request plans cannot expose URL, query, resolved path, headers, body, variables, secret-like placeholders, or unknown risk flags through batch list/detail APIs. `request_plan.path` is omitted because legacy persisted plans may hold a resolved dynamic path that cannot be proven template-derived.
2. HAR extraction now emits request templates, substitutes known upstream response values with declared placeholders, and attaches conservative risk metadata. Redaction retains non-sensitive request-template headers/body and removes sensitive keys.
3. The dry-run API no longer supplies a synthetic `remote_id`; a manifest that needs an unproduced `remote_id` fails as `dry_run_failed`.
4. Only omitted/`undefined` capture HTTP mode defaults to `mock`. Empty string, `null`, `false`, and `0` now fail with `CAPTURE_HTTP_MODE_INVALID`.
5. Executor request-plan accumulation now retains earlier entries when a phase has no entries.
6. GUI copy explicitly states no Hifly access and no point consumption. The capture runbook now describes `mock`, `real_dry_run`, and disabled `real_live`, plus the request-template/public-API boundary.

## Verification

```text
node --test test/server-capture-api.test.js test/har-extractor.test.js test/rpa-capture-redact.test.js test/rpa-capture-dry-run-client.test.js test/rpa-capture-http-client-factory.test.js test/capture-http-executor.test.js test/gui-smoke.test.js test/offline-replay.test.js
34 passed, 0 failed

npm run check
Checked 62 JavaScript file(s)

git diff --check
exit 0

npm test
295 passed, 0 failed
```

## Hifly Points

Consumed: no. No real Hifly page, request, or generation was used.

## Final-Review Follow-up: Variable and Error-State Fixes

- `capture_http` now persists only produced variables in the local RPA state and merges them before each phase. This preserves `asset_id` alongside `remote_id` for hiflyworks polling/download templates, including across executor method calls.
- Added a synthetic local hiflyworks HAR regression that performs extract -> redact -> `real_dry_run` executor and verifies the complete request plan through `asset_generation`, `remote_submit`, `remote_query`, and `download`.
- Dry-run failures now persist a stable `{ code, message }` object, public projection re-sanitizes legacy values, and failure clears the old `dry_run_summary` so a prior success cannot be displayed beside a failure.
- Updated the runbook: public summaries no longer expose path, and later phases may use all prior produced variables.

Verification:

```text
node --test test/capture-http-executor.test.js test/server-capture-api.test.js test/har-extractor.test.js test/rpa-capture-redact.test.js
22 passed, 0 failed

npm run check
Checked 62 JavaScript file(s)

git diff --check
exit 0

npm test
297 passed, 0 failed
```

No Hifly page or HTTP request was accessed; no points were consumed. No batch, output, log, screenshot, real raw HAR, configuration, dependency, or `docs/resume/` file was changed.

## P1 Follow-up: Legacy Resolved Path Redaction

- Fixed the P1 final-review regression in `publicCaptureState()`: public request-plan summaries no longer include `entry.path`, because old dry-run records can store resolved paths such as `/jobs/legacy-secret-value?token=abc`.
- Updated the batch list/detail API regression fixture to use that real legacy shape and assert the response contains neither the dynamic segment, query token, nor the full resolved path.
- Verification: `node --test test/server-capture-api.test.js` and `git diff --check` (both passed locally). No Hifly access, real HTTP, or point consumption.
