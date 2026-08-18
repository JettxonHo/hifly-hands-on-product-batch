# Issue #191 Production terminal truth recovery

Date: 2026-08-18

## Scope and baseline

- Exact base: `origin/main@3566a1b95a02c5efd483e4872ad15723d0861eac`.
- Issue: #191, Worker offline should not hide persisted terminal Work truth on Production.
- Worktree: `/private/tmp/hifly-issue191-production-terminal-truth`.
- Branch: `codex/issue191-production-terminal-truth`.
- This session changes only Production frontend projection, its public browser regression, CURRENT, ROADMAP, and this record.
- No deployment, SSH, Hifly access, Worker/Local Agent start, production-data mutation, video generation, or points action occurred.

## Product/API gate

No API or backend expansion is required. Existing organization-scoped public reads already provide the selected order's durable
truth:

1. Production workspace returns the selected persisted ProductionOrder.
2. Manual execution workspace returns its persisted attempt, candidates, and reports.
3. Work verification workspace returns its A12 job and registered Work ID.
4. `GET /api/works/:workId` returns the exact Work inspection and delivery projection.

The defect was frontend-only: `renderTaskSummary()` required the selected order to equal transient
`cloudExecutor.current_order`. Once the Worker stopped and `current_order` became `null`, the page ignored the selected order's
persisted terminal state and rendered the activation gate instead.

## TDD evidence

- Public seam: real system Chrome on Production with a persisted `succeeded` selected order, succeeded attempt, A12 passed,
  Work `pending_review`, Cloud Executor offline, and `current_order=null`.
- RED: expected `作品待检查`; actual `生产门禁未通过`.
- GREEN: Production reads the exact registered Work through the existing organization-scoped Works API and uses the selected
  order's persisted execution/A12/Work projection when the order is already `succeeded`.
- Added matrix coverage for A12 `not_started`, queued/running, failed/requires_action, passed without a registered Work, and
  Work `pending_review`, `rework_required`, `deliverable`, and `delivered` while the Worker remains offline.
- Scoped Refresh reloads the same selected-order projection and preserves the terminal recommendation.
- Review RED 1: a persisted succeeded order with Work `pending_review` and an expired handoff package rendered the package
  authorization recovery instead of Work truth. GREEN: succeeded-order terminal truth now precedes package lifecycle and remains
  visible with an expired package or with manual handoff disabled; the waiting-order expired-package recovery remains unchanged.
- Review RED 2: after A12 returned a registered Work but exact Work reading failed, the summary rendered `正在登记作品`.
  GREEN: Work reading has its own controlled error state, keeps the next order closed, recommends only scoped Refresh, and returns
  to `作品待检查` after the exact Work read recovers.
- Review RED 3: after the same succeeded order first rendered Work `pending_review`, a failed outer A12 read retained the prior
  verification object and never reached the required error state. GREEN: outer A12 failure clears verification and Work state,
  renders `核验状态读取失败`, exposes only scoped Refresh, and restores the exact same Work only after a successful read.
  A response whose `verification.order.id` differs from the selected order follows the same fail-visible path and cannot cross-bind.

## Safety boundary

- Persistent terminal recovery is restricted to a selected order whose stored status is `succeeded`.
- Handoff package `absent` / `generating` / `generation_failed` / `expired` / `superseded` / `revoked` / `ready` remains an
  activation concern for non-terminal orders and cannot override an already-persisted succeeded-order Work state.
- A12 and Work projections are accepted only for the selected order. Failed or mismatched A12 reads clear prior delivery state,
  disable Works navigation, and do not auto-retry for a succeeded order; the operator must use scoped Refresh.
- `waiting_for_executor + ready package` still falls through the existing activation fail-closed path.
- The organization-wide unique eligible order, zero initial attempts, active attempts=0, claimed/running/failed/requires_action,
  cancellation, stop-on-failure, no automatic retry, and no Web Worker-control contracts were not changed.
- A Work delivery record still does not prove authenticated real-byte download acceptance and does not open the next order.

## Validation

- Focused real Chrome GREEN: `test/operator-workbench-v2-production-browser.test.js` passed 1/1 with the full persisted
  A12/Work matrix while Cloud Executor remained offline and `current_order=null`.
- Affected Production/API regression: Production V2, ProductionOrder browser/API, Cloud Executor control plane, Work
  verification API, and Work delivery API passed 17/17.
- Final default `npm test`, with the repository's normal parallelism and the local Chrome executable made explicit: 1050 total /
  1036 pass / 14 existing environment-gated skips / 0 fail in 121.8 seconds. The skips are the repository's optional PostgreSQL
  integration cases; fixed-head CI remains the required PostgreSQL evidence gate. An earlier run without the explicit local Chrome
  executable stopped making progress in three unrelated existing browser files and was terminated after more than five minutes;
  it produced no failed assertion and is retained as a local browser-runner observation rather than product evidence.
- `npm run check`: 230 JavaScript files checked. `git diff --check`: pass.
- Strict allowlist: `web/production.js`, `test/operator-workbench-v2-production-browser.test.js`, `docs/status/CURRENT.md`,
  `docs/ROADMAP.md`, and this session record.
- Real Chrome viewport evidence was written only to the local temporary directory: 1440x1000, 768x1024, and 390x844 PNGs.
  The browser seam confirmed no page-level horizontal overflow, at most one recommended action, visible keyboard focus, and
  reduced-motion behavior. No screenshot is committed.
- Fixed-head Ubuntu, Windows, and identity-postgres CI results are recorded in the Draft PR result package after GitHub completes
  them; repository tests and browser fixtures are not deployment or Provider evidence.

## Next gate

The repository fix only becomes current truth after the accompanying implementation and this record merge into `main`. Issue
#190 is already merged but remains undeployed. After both repository fixes are merged, deployment and real-admin internal
revalidation are a separate later gate; they are not a prerequisite for starting or completing #191.
