# 2026-08-12 CE-05 / Issue #140 Cloud persistent media

## Scope and authorization

- Role: `IMPLEMENTER`; requested custom agent: `luna-worker`; configured model:
  `gpt-5.6-luna`; reasoning: `max`; configuration: `CONFIG_VERIFIED`;
  runtime model: `UNVERIFIED_RUNTIME_MODEL`.
- Branch: `codex/ce-05-cloud-persistent-media`; baseline: `main@b78fe08`.
- Scope is CE-05 only. No real Hifly, browser, Provider, DeepSeek, HTTP,
  points, claim against production, or deployment action was authorized or
  performed.

## Implemented

- Moved the reusable Cloud workspace normalization into `workspace.js` and
  kept the existing Playwright adapter export compatible.
- Added persistent workspace readiness for `profile`, `assets`, `outputs`,
  and `evidence`, plus `statfs`/injected free-space checks and the controlled
  `storage_blocked` state.
- Added `CLOUD_EXECUTOR_MIN_FREE_BYTES` with a 1 GiB default while preserving
  `disabled`/`fail_closed` defaults.
- Standalone Cloud Executor runtime now initializes the persistent workspace
  and, when no store is injected, uses the existing local object-store contract
  rooted at `outputs`. Injected manual-execution candidate stores remain
  supported.
- Added CE-05 named-volume media contract. Profile remains in the CE-04
  login contract; no Cloud Executor file route was added.
- Added restart proof: a second runtime/store over one temporary root retains
  assets, output, evidence, and candidate bytes; existing A12 verified output
  registration and authenticated Work download return the original bytes.

## Validation

- Focused Cloud Executor suite: 38/38 green for CE-02/03/04 plus CE-05
  persistence, storage gate, and Work delivery tests.
- `npm run check`: passed (223 JavaScript files).
- `git diff --check`: passed.
- `npm test`: passed, 993 tests / 979 pass / 14 existing environment skips / 0 fail.

## Remaining boundary

CE-07 still must prove the actual disabled/fail-closed worker deployment,
volume/bind mounts, standby/readiness, and restart recovery in the target cloud
environment. CE-05 local tests are not deployment/runtime proof. CE-08 remains
the separately authorized real pure-cloud Hifly acceptance and no points were
consumed in this session.
