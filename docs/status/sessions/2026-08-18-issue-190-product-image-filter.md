# Issue #190 Project product-image candidate filter

> Date: 2026-08-18
> Role: IMPLEMENTER
> Runtime model: `UNVERIFIED_RUNTIME_MODEL`
> Base: `origin/main@6372cfc47861134e61f70bf674a88ab73cb69734`
> Branch: `codex/issue190-project-product-images`
> Lifecycle: Draft PR acceptance pending; only merge into `main` counts as repository-fixed, and deployment remains separate.

## Scope and boundaries

- Fix only Issue #190: Project's “商品图片” candidates must use the existing server-projected Asset `kind` truth.
- Preserve current-revision editing, historical revision read-only behavior, dirty protection, 409 recovery, scoped asset refresh,
  organization authorization, and active/available gates.
- No backend, API, database, migration, dependency, global UI, Taste, Issue #191, deployment, SSH, Hifly, Worker, Local Agent,
  production-data, video-generation, or points action.

## Product/API gate

- `GET /api/assets` already returns Asset `kind` through the existing public projection.
- The current domain truth is sufficient for a frontend-only filter: `product_image`, `avatar_image`, and `work_video` are
  distinguishable without inference. No public-contract expansion is required.

## TDD record

### RED — public Project browser seam

- File: `test/project-content-browser.test.js`
- Fixture: one `/api/assets` response containing active/available `product_image`, `avatar_image`, and `work_video` records.
- Command:
  `IDENTITY_BROWSER_EXECUTABLE='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node --test test/project-content-browser.test.js`
- Result: **RED**, 0 pass / 1 fail.
- Evidence: “人物立绘.png” was present in `#assetOptions`; expected count 0, actual count 1 at the public browser seam.

### GREEN — minimal implementation

- `web/project.js::loadAssets()` now filters Asset `kind === "product_image"` before applying the existing `active` Asset and
  `available` AssetVersion gates.
- The same browser seam proves the product image remains visible/selectable, avatar/work versions are absent, stale non-product
  selected IDs do not satisfy the Ready blocker, and the save payload contains no stale IDs.
- Focused command: same as RED.
- Result: **GREEN**, 1 pass / 0 fail / 0 skip.

## Regression evidence

- Assets and ProjectContent service/API group:
  `node --test test/assets-service.test.js test/assets-api.test.js test/project-content-service.test.js test/project-content-api.test.js`
  → 49 pass / 0 fail / 0 skip.
- Affected real-Chrome group:
  `test/project-content-browser.test.js`, `test/operator-task-flow-slice-a-browser.test.js`,
  `test/operator-workbench-v2-foundation-browser.test.js`, and `test/vsa-a14-acceptance-browser.test.js`
  → 9 pass / 0 fail / 0 skip.
- The existing browser flow still exercises current/historical revision behavior, dirty guards, 409 recovery, disabled/stale
  material refresh, Ready retry messaging, and 1440/768/390 no-overflow checks.
- `npm run check` → 230 JavaScript files checked.
- Default `npm test` → 1050 tests / 1036 pass / 14 existing environment-gated skips / 0 fail. The skipped group is the
  repository's optional PostgreSQL and host-browser coverage when their dedicated environment variables are absent; the affected
  Project browser seam was run explicitly with system Chrome and did not skip.
- `git diff --check` → pass.
- Strict allowlist → 5 files: `web/project.js`, `test/project-content-browser.test.js`, `docs/status/CURRENT.md`,
  `docs/ROADMAP.md`, and this session record.

## Evidence boundary and next gate

- This is local repository and real-system-Chrome evidence with controlled application data. It is not deployment, production
  UI revalidation, Hifly/Provider evidence, a new video, or points evidence.
- Issue #191 was not started. After #190 receives independent review and merges, #191 may begin from the resulting `main`.
  Deployment and internal revalidation remain a separate later gate after both repository fixes have merged; they are not a
  prerequisite for starting #191.
