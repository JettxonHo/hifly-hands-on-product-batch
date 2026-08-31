# Issue #273 — Copy Quality One-Attempt Contract Correction

> 日期：2026-08-31
> 分支：`codex/rbv-quality-one-attempt`
> 基准：`b79dde707461cc785100e0f07d39fda140fad21a`
> Stage：`QUALITY_ONE_ATTEMPT_CONTRACT_CORRECTION`
> 结论：provider-free candidate；等待独立 Review 与 Owner Gate

## Scope and stop boundary

本轮只修正 Quality 的 at-most-once dispatch、持久化 usage/charge truth、lease/reclaim/retry fail-closed 与 parent-preserving freeze seam。没有真实 DeepSeek/Hifly/Provider、登录、部署、积分、真实 QualityRun 或下游对象写入。Issue #273 保持开放。

## RED evidence before implementation

- `node --test test/copy-quality-one-attempt.test.js`（初始 4 tests）证明旧 DeepSeek malformed/schema path 各调用 2 次；run 没有 `attempt_policy`；retry endpoint 没有阻断。
- 旧路径代码证据：`deepseek-evaluator.js` 的 `attempt < 2` correction loop；Quality claim 对 expired running row 按 `max_attempts` reclaim；`retryQualityCheck` 调用 `startQualityCheck` 产生新 logical run；copy freeze 自动 supersede parent。
- 首次 PostgreSQL dispatch-split integration RED 仅为测试断言过度依赖 CHECK evaluation 顺序（实际正确拒绝，命中 `copy_quality_provider_http_not_over_dispatch_ck`）；断言放宽后 GREEN。非 implementation failure。
- Independent review RED reproductions on the first candidate also confirmed four P1s: strict start could return an active legacy run, swallowed Provider errors could be completed as passed, strict cancellation/invalidated UI exposed a new start path, and the default freeze fingerprint changed across deployment. Each became a focused regression before the final GREEN matrix below.

## Implemented correction

- `copy-quality-service.js`：strict default `provider_at_most_once_v1` + `qualityMaxAttempts=1`；Rewrite 独立 `rewriteMaxAttempts`；durable `providerRequest` callback；dispatch reservation → HTTP invocation marker → response/outcome persistence；nullable usage/token/charge and local-cost state；strict retry error。
- `copy-quality-worker.js`：把 durable provider seam 传给 evaluator；任何 evaluator error 只终止当前 run。
- `deepseek-evaluator.js` / `hybrid-evaluator.js`：DeepSeek semantic evaluator 必须经 `providerRequest`，删除 malformed/schema correction retry，返回稳定 malformed/schema errors；hybrid 透传 seam。
- `memory-copy-quality-repository.js` / `postgres-copy-quality-repository.js`：strict per-copy logical-run uniqueness；atomic dispatch and HTTP counts; response/audit persistence; strict lease expiration to not-dispatched/unknown; no reclaim after dispatch; stale completion rejected.
- `002_issue_273_quality_one_attempt.sql`：历史行默认 `legacy`；新增 attempt policy, provider identity/model, dispatch and HTTP invocation count (`HTTP <= dispatch <= 1`), lifecycle/outcome timestamps, usage/charge/local-cost status and nullable fields, nonnegative/reporting consistency checks, strict per-copy unique index。
- `copy-generation-service.js` + memory/PG repository：additive `supersedeParent` flag；Quality uses false, explicit freeze remains default true；parent v1 status/body/row_version preserved by Quality start。
- Public route, production selector, operator workspace and `web/copy.js` expose sanitized provider facts and remove executable strict retry/start actions. No raw request/response/key/prompt is projected.

### Independent review follow-up corrections

- A strict start never downgrades to an active legacy run: memory/PG repositories fail closed with `QUALITY_ONE_ATTEMPT_LEGACY_RUN_ACTIVE`. Migration 002 leaves historical dispatch/HTTP counts nullable (`NULL`/UNKNOWN) and terminalizes pre-upgrade queued/running legacy rows so the new Worker cannot reclaim them. Any migrated terminal legacy row with unknown provider outcome is also blocked from a new strict start, and its retry is forbidden.
- Completion is gated on the durable provider state `response_received` whenever a dispatch exists. A swallowed provider error, terminal outcome, or unknown outcome cannot be overwritten by `succeeded/passed`; memory/PG completion reject with `QUALITY_PROVIDER_RESPONSE_NOT_READY` before result insertion.
- Strict cancellation after any dispatch is rejected (`QUALITY_ONE_ATTEMPT_CANCEL_BLOCKED`). Cancellation before dispatch persists `terminal/not_dispatched`; workspace and Copy UI Owner-gate strict failed, timed-out, cancelled, and invalidated terminal states with no start/retry action.
- The default `supersedeParent=true` freeze keeps the legacy idempotency fingerprint; only the additive parent-preserving false path adds its flag, so pre-upgrade freeze receipts replay safely.

## Scenario A–J evidence

| Scenario | Evidence | Result |
|---|---|---|
| A Success | fake provider callback, dispatch=1, HTTP=1, result succeeds, usage reported, charge unknown | PASS |
| B malformed JSON | DeepSeek direct + worker callback tests; one call, `parse_failure`, no result/retry | PASS |
| C schema mismatch | callback/DeepSeek envelope tests; one call, `schema_failure` | PASS |
| D semantic validation | callback returns then evaluator semantic-invalid; one call, `semantic_failure` | PASS |
| E timeout/network after invocation | fake ambiguous transport; HTTP=1, outcome/usage/charge unknown, terminal | PASS |
| F before-send ambiguity | dispatch reservation without HTTP marker; HTTP=0, `not_dispatched`, no permit replacement | PASS |
| G worker crash | reservation/lease expiry and stale completion injection; no second call | PASS |
| H lease expiration/reclaim | strict expired rows terminalized as not-dispatched or unknown; strict id never reclaimed | PASS |
| I duplicate worker/execution | concurrent run claims and concurrent provider reservation; exactly one dispatch/HTTP | PASS |
| J lifecycle | strict Quality freezes v2 but parent v1 remains frozen and unchanged; strict workspace no retry/start | PASS |

## Validation

- `node --test test/copy-quality-one-attempt.test.js` — 27 pass (including legacy-active/legacy-unknown rejection, swallowed-provider completion gate, marker fault, and strict cancel guard).
- `node --test test/copy-quality-api.test.js` — 8 pass (strict projection, migrated-unknown rejection, invalid terminal result, second-key replay, retry/cancel 409, sanitized fields).
- `node --test test/copy-quality-browser.test.js` — 2 pass (legacy regression + strict Owner-gated failed/cancelled/legacy-unknown/invalid stops at desktop and 390px; retry/start hidden).
- `node --test test/copy-generation-service.test.js` — 11 pass (default freeze idempotency receipt compatibility).
- `node --test test/copy-quality-evaluators.test.js test/copy-quality-service.test.js test/operator-workspace-service.test.js` — all pass.
- `node --test test/production-start.test.js` — 15 pass (selector wiring includes `deepseek_hybrid` providerKind).
- `npm run check` — 249 JavaScript files pass syntax checks; `git diff --check` pass.
- PostgreSQL: temporary container `hifly-quality-one-attempt-pg` (`postgres:16.14-bookworm`, host `127.0.0.1:55438`) with isolated schema; `TEST_DATABASE_URL=postgres://… node --test test/copy-quality-postgres.integration.test.js` — 2 pass. Covered migration v2, legacy nullable counts, active/terminal legacy fail-closed, concurrent strict unique run, count/check rejection, usage/charge UNKNOWN, completion response gate, strict lease no-reclaim. Container is test-only and must be removed after final validation.
- The test-only PostgreSQL container and its volume were removed after the final integration run; no existing containers or project services were changed.
- A stale full `npm test` process started before final dispatch changes was verified as PID 40978 (PPID 40965), 0% CPU/no output for ~9m, and terminated by the owner; record as harness non-green, not product failure. No unrelated processes touched.

## Accepted bounded limitation

Freeze and QualityRun creation remain separate repositories/transactions. If run persistence fails after the Quality freeze commits, v2 can remain frozen with no QualityRun; this is explicitly zero-provider and fail-closed (no retryable run, no dispatch/HTTP/audit provider events). A follow-up atomic cross-domain unit-of-work would be broader than Issue #273.

## Additional validation

- `npm run validate` — `Validated 3 product row(s) from products/products.csv.`; no Provider/Hifly access.
- `npm_config_registry=https://registry.npmjs.org npm audit --omit=dev --audit-level=high` — official registry reports `2 moderate severity vulnerabilities`, both `uuid <11.1.1` transitively via `exceljs`; `npm audit fix --force` proposes `exceljs@3.4.0` (breaking), so no dependency mutation was made in this bounded Stage. The default mirror audit endpoint returned 404 `NOT_IMPLEMENTED`; the official npm registry result is the recorded security check.
- `git diff --check` — pass; final allowlist audit — 33 changed/untracked files, unexpected=none (authorized universe 34 paths; one allowed path is unused).

## Provider/cost truth

External Provider calls `0`; DeepSeek calls `0`; Provider tokens `0`; Provider cost `¥0`; Hifly requests `0`; 飞影积分 delta `0`; Production Attempts `0`; usage/charge unknown `NO` for this engineering Stage because no request was sent. This is provider-free evidence only and does not authorize real Quality Evaluation.

## Next gate

Independent Review must inspect actual diff and focused tests. After review/CI, stop at `NEXT_GATE: OWNER_AUTHORIZATION_REQUIRED_FOR_SINGLE_REAL_COPY_V2_QUALITY_EVALUATION`; do not execute the provider call in this Stage.
