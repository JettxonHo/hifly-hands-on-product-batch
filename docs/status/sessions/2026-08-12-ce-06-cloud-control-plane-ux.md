# 2026-08-12 CE-06 Cloud Executor control-plane UX

## Scope and authorization

- Issue: #141
- Role: `IMPLEMENTER`; requested custom agent: `luna-worker`; configured model:
  `gpt-5.6-luna`; reasoning: `max`; configuration: `CONFIG_VERIFIED`;
  runtime model: `UNVERIFIED_RUNTIME_MODEL`.
- Branch: `codex/ce-06-cloud-control-plane-ux`; base: `main@1d6bc65`.
- Scope is CE-06 only. No Hifly/provider browser login, real provider HTTP,
  DeepSeek, points, production claim, deployment, or server action was
  authorized or performed.

## Implemented

- Added `src/cloud-executor/control-plane.js` with a provider-neutral,
  allowlisted projection over the existing cloud attempt/report, A12
  verification, and Work/Delivery services. It reports connection, readiness,
  current order/attempt, bounded progress, controlled failure, execution
  result, A12 state, Work, and delivery as separate fields. Raw exceptions,
  storage keys, Profile/server paths, VNC values, secrets, and bearer tokens are
  not projected.
- Added authenticated `GET /api/cloud-executor/status` and optional internal
  `POST /internal/cloud-executor/v1/heartbeat`. The internal port is disabled
  unless explicitly configured with a timing-safe Bearer guard; heartbeat
  presence is ephemeral and does not own the long-running browser lifecycle.
- Added the production-facing Cloud Executor status section to
  `web/production.html`, `web/production.js`, and `web/production.css`. It leads
  with Chinese operational guidance for offline, re-login, low disk, standby,
  busy/progress, requires_action, failure, A12 verification, and delivery.
  Historical/manual surfaces remain below it. Verified Work links reuse the
  existing authenticated `/works.html` preview/download workflow.
- Added API leak tests and browser DOM assertions. Browser fixtures cover 1440
  and 390 viewports, abnormal states, safe Work links, and horizontal overflow.

## Validation

- Focused command:
  `node --test test/state-machine.test.js test/server-api.test.js
  test/batch-runner.test.js test/cloud-executor-control-plane.test.js
  test/production-order-browser.test.js` — 167/167 passed.
- `npm run check` passed and checked 225 JavaScript files; `git diff --check`
  passed.
- Full `npm test -- --test-reporter=dot` completed with 998 tests, 983 passed,
  14 skipped, and 1 failed. The long TAP output was truncated before the
  failing test name was retained; this is an explicitly disclosed release
  risk, not a claimed green gate. A second reporter run was stopped when the
  user requested no more long-running full-suite work.
- `npm audit --omit=dev --audit-level=high` against the official npm registry
  reported 7 existing dependency vulnerabilities (5 high, 2 moderate); no
  dependency change was made for CE-06. The configured mirror audit endpoint
  is unsupported (`NOT_IMPLEMENTED`).
- Screenshots are optional local evidence only (the browser test accepts
  `A09_SCREENSHOT_DIR`); no screenshots are committed.

## Remaining boundary

CE-07 still must prove the independent Cloud Executor Worker deployment,
authenticated heartbeat/readiness wiring, disabled/fail-closed standby,
persistent volume and Profile/media restart recovery, and resource/disk
observations in the target cloud environment. CE-06 fake/in-memory/browser
evidence is not runtime/deployment proof. CE-08 remains the separately
authorized real pure-cloud Hifly acceptance; points consumed: 0.
