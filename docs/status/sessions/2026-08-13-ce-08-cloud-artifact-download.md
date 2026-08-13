# 2026-08-13 CE-08 Cloud Executor artifact download fallback

## Scope and authorization

- Issue: CE-08 / #143; baseline: `main@dc4ca9f`.
- Role: `IMPLEMENTER`; requested custom agent: `luna-worker`; configured model:
  `gpt-5.6-luna`; reasoning: `max`; configuration: `CONFIG_VERIFIED`;
  runtime model: `UNVERIFIED_RUNTIME_MODEL`.
- Branch: `codex/ce08-cloud-artifact-download`.
- This session is limited to the Web app's read path for A12-registered Cloud
  Executor output objects and its production volume contract. No Fly/Hifly
  page, real HTTP, Cloud Executor worker, claim, attempt mutation, generation,
  or points action was authorized or performed.

## Implemented

- Added a small object-store composition in
  `src/assets/local-object-store.js`: reads check the app's primary local store
  first and then a configured fallback; `put` and `remove` remain primary-only.
- Wired the composition only for production-style local assets in
  `src/server/app.js`. Explicitly injected object stores and existing Local
  Agent/manual paths keep their prior semantics.
- Added `CLOUD_EXECUTOR_OUTPUTS_DIR`-derived read-only fallback configuration in
  `src/server/production-config.js` and mounted the named output volume read
  only in the app service while leaving the Cloud Executor writer writable in
  `docker-compose.production.yml`.
- Added the public authenticated Work download regression and deployment
  configuration regressions in the two Cloud Executor test files.

## Red/green and validation

- Strict red: before the implementation, the new authenticated Work seam
  returned `404` instead of `200` for a candidate whose bytes existed only in
  the Cloud Executor output store.
- Deployment red: before the production configuration and Compose changes,
  the new deployment seam had two failing assertions for the app fallback
  environment/configuration.
- Green: `node --test test/cloud-executor-persistent-media.test.js
  test/cloud-executor-deployment.test.js` — `23/23` passed.
- `npm run check` — 229 JavaScript files checked.
- `npm test` — `1,017` tests, `1,003` passed, `14` skipped, `0` failed.
- `POSTGRES_PASSWORD='test-only-compose-password' docker compose -f
  docker-compose.production.yml config` — passed.
- `node --check` on the three changed JavaScript source files — passed.
- `git diff --check` — passed.

## Handoff

- Implementation commit: the final commit is the branch HEAD at handoff; its
  exact hash is included in the result package.
- Runtime/deployment proof of the actual shared volume and live Work download
  remains outside this session and must be performed by the authorized
  deployment owner.
