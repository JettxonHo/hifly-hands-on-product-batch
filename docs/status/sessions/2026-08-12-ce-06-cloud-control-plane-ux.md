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
- Implementation commit: `141dcc8`; READY PR [#149](https://github.com/JettxonHo/hifly-hands-on-product-batch/pull/149),
  `Closes #141`, open/non-draft, not merged or approved.

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
- Sol review follow-up wires a Web-only production control-plane config through
  `production-config` and `production-start`. It reuses
  `CLOUD_EXECUTOR_ENABLED`, `CLOUD_EXECUTOR_MODE`, `CLOUD_EXECUTOR_ID`, and
  `CLOUD_EXECUTOR_ORGANIZATION_ID`, and adds
  `CLOUD_EXECUTOR_HEARTBEAT_TOKEN` plus
  `CLOUD_EXECUTOR_HEARTBEAT_TIMEOUT_MS`. Enabled configuration requires the
  Organization, executor ID, and bearer token. The Web config deliberately has
  no Worker, poll, claim, browser, or `runOnce` field.
- The retained architecture test now permits the control-plane decorator and
  status route while proving that even injected `worker.autoStart` cannot poll
  or start a Worker. API tests prove anonymous status reads return
  `401 AUTH_REQUIRED`, cross-Organization reads stop before repository access,
  and runtime/public JSON never includes the heartbeat token.
- Second independent review follow-up adds bounded Cloud status polling to the
  production page. Production uses a five-second interval and backs off to ten
  seconds after a read failure; failures render the controlled offline state
  and continue recovery. A self-scheduling timeout plus one shared in-flight
  request prevents timer stacking and concurrent reads. `pagehide` and
  `beforeunload` stop future polls. Polling renders only the Cloud section and
  never reloads the production workspace.

## Validation

- Focused command:
  `node --test test/state-machine.test.js test/server-api.test.js
  test/batch-runner.test.js test/cloud-executor-control-plane.test.js
  test/production-order-browser.test.js` — 167/167 passed.
- `npm run check` passed and checked 225 JavaScript files; `git diff --check`
  passed.
- The original full-suite failure was the stale production architecture
  assertion identified by Sol. After the follow-up, the requested focused
  command over `production-start`, `cloud-executor-control-plane`, and
  `production-order-browser` passed 22/22; `npm run check` checked 225 files;
  `NODE_OPTIONS=--test-reporter=dot npm test` exited 0; and
  `git diff --check` passed.
- The final browser acceptance changes route state without `page.reload()` and
  observes automatic busy, later progress, read-failure/offline, recovery,
  requires_action/failure, A12-passed, and delivered Work-link updates. It
  retains 1440/390 no-overflow assertions, proves max concurrent status reads
  is one with a deliberately slow fixture, and proves navigation stops polls.
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
