# Cloud Executor P0 Implementation Plan

> Execution order: CE-01 → CE-08, strictly serial
> Real Hifly boundary: prohibited through CE-07; CE-08 requires separate explicit point authorization

## Global gates

Every implementation Issue uses its own `codex/` branch and PR. The implementer is the exact custom agent `luna-worker` (`gpt-5.6-luna`, reasoning `max`); Sol independently reviews. Each PR runs focused tests, `npm run check`, `npm test`, and `git diff --check`. Completed subagents are closed immediately.

Do not edit applied migrations, remove Local Agent code, expose secrets/paths, or enable real execution by default.

## CE-01 — Contract, Goal, design and Issues

Deliver the product contract, this design and plan, D-034, rebaselined Goal/status/governance, and CE-02 through CE-08 Issues. The diff contains no production code. Validate links and `git diff --check`; merge only after CI.

## CE-02 — Runtime identity and fake serial Worker

**Primary scope**: additive manual-execution migration/repositories, new `src/cloud-executor/` service and worker entrypoint, production configuration/startup, focused tests.

1. Add `cloud_executor` without weakening manual/local identity invariants.
2. Default Worker to disabled/fail_closed.
3. Claim at most one eligible ready order.
4. Preserve lease, heartbeat and one-active-attempt rules across restart.
5. Complete a fake result through candidate/report/A12 once.
6. Fake failure stops and does not claim the next order.
7. No browser, Hifly or real external call.

## CE-03 — Compose existing Hifly Playwright core

Inject the existing Hifly executor/page modules; do not duplicate selectors or flow. Supply cloud workspace/profile config and controlled progress/checkpoints. Distinguish pre-submit, submitted and uncertain outcome; never auto retry Provider submission. Tests use fakes only and do not visit Hifly.

## CE-04 — Persistent Profile and controlled login

Add Worker readiness/login command plus Chrome/Xvfb and loopback/private noVNC deployment contract. Profile resides on a persistent mount. Login mode does not claim. Missing/expired login reports `requires_login` before claim. Runtime validation is login/standby only, without upload, generation or points.

## CE-05 — Persistent media, disk gate and authenticated download

Add persistent workspace/storage port, artifact route integration, configurable disk threshold and restart recovery tests. Public records expose artifact ids and controlled metadata only. Low disk blocks claim as `storage_blocked`. Do not add OSS/COS or a generalized storage framework.

## CE-06 — Control-plane UX

Project Worker online/readiness/current order/progress/requires_action/failure and verified video preview/download into `web/production.*`. Replace Local Agent startup as the primary production guidance while preserving historical/manual paths. Test 1440px, 390px and abnormal states.

## CE-07 — Alibaba Cloud pilot deployment

1. Back up PostgreSQL and record rollback image.
2. Apply migrations explicitly.
3. Create persistent directories/volumes.
4. Deploy one disabled Worker plus Chrome/Xvfb.
5. Verify all services healthy.
6. Verify no-side-effect standby/no claim.
7. Verify controlled login readiness without generation.
8. Restart Worker and prove Profile/marker persistence.
9. Record memory peak, free memory, disk and threshold state.

No real Hifly generation is authorized in CE-07.

## CE-08 — One real pure-cloud acceptance

Separate authorization is required immediately before execution. Use one new uniquely eligible zero-attempt ProductionOrder with handoff ready, cloud materials, Worker/login/storage ready, and Local Agent stopped. Run once and stop on first failure without retry.

Evidence must include attempt/checkpoints, Hifly work reference/time and point observation, persistent cloud artifact, A12 passed result, Work id, authenticated preview/download and restart persistence. Only this success permits “P0 可投入内部试运行”.

## Stop conditions

Stop immediately on login loss, unknown submit outcome, duplicate active attempt, low disk, missing material, Provider failure, candidate upload failure or A12 failure. Do not create another attempt or consume another point authorization automatically.
