# Issue #193 Product dimensions and Hifly native goods-size controls

> Date: 2026-08-18
> Role: IMPLEMENTER / `luna-worker`, completed and independently consolidated by Sol controller-side development
> Config: `~/.codex/agents/luna-worker.toml` (`gpt-5.6-luna`, max)
> Config status: `CONFIG_VERIFIED`
> Runtime model: `UNVERIFIED_RUNTIME_MODEL`
> Base: `origin/main@48eb7be729ef3c5ac1b3fdadd01ca1ff853d552d`
> Branch: `codex/issue193-product-goods-size`

## Scope and external boundaries

- Implement Issue #193 only in the independent worktree.
- No mutable or paid Hifly action, Worker start, deployment, SSH, production data, points, config/profile/batch/output/log/capture changes. The only Provider access was the read-only HTML/static-resource evidence gate described below.
- Normal repository implementation, validation, commit, push, and Draft PR actions are in scope; merge, Ready, deployment, and Issue closure are not.
- `docs/PROJECT_HANDOFF.md` is intentionally not modified.

## TDD record

### RED 1 — ProductRevision service public seam

- Test: `test/project-content-service.test.js`
- Name: `saving a product revision preserves structured physical dimensions as an explicit fact`
- Command: `node --test --test-name-pattern='structured physical dimensions' test/project-content-service.test.js`
- Result: **RED**
- Evidence: `saved.physical_dimensions` was `undefined`; expected `{ height: 18, width: 12, depth: 4, unit: "cm", capacity: 500 }`.

### GREEN 1

- Minimal implementation: ProductRevision service now carries `physical_dimensions` through create/save snapshot fields while preserving the existing value when the command omits the new field.
- Command: `node --test --test-name-pattern='structured physical dimensions' test/project-content-service.test.js`
- Result: **GREEN**, 1 pass / 0 fail.

### RED 2 — ProductRevision proportional validation

- Test: `test/project-content-service.test.js`
- Name: `physical dimensions require height, width, and unit when an axis is supplied`
- Command: `node --test --test-name-pattern='physical dimensions require' test/project-content-service.test.js`
- Result: **RED**
- Evidence: the current service accepted `{ height: 18, unit: "cm" }` instead of rejecting it with `INVALID_PHYSICAL_DIMENSIONS`.

### GREEN 2

- Minimal implementation: `normalizePhysicalDimensions` now treats any supplied axis as requiring positive finite `height` and `width` plus a non-empty `unit`; optional `depth` is positive finite when present.
- Command: `node --test --test-name-pattern='structured physical dimensions|physical dimensions require' test/project-content-service.test.js`
- Result: **GREEN**, 2 pass / 0 fail.

### RED 3 — Explicit quantity and axis unit boundary

- Test: `test/project-content-service.test.js`
- Name: `physical dimensions reject unsupported axis and quantity units`
- Command: `node --test --test-name-pattern='structured physical dimensions|physical dimensions require|reject unsupported|empty physical dimensions' test/project-content-service.test.js`
- Result: **RED** (3 pass / 1 fail)
- Evidence: the current normalizer accepted unsupported `inch` and `gallon` units; the same run confirmed empty `{}` normalizes to `null` and omitted input preserves the current fact.

### GREEN 3

- Minimal implementation: axis units are restricted to `mm`, `cm`, `m`; capacity and weight are normalized only from positive finite `{ value, unit }` quantities with `ml/l` and `g/kg` respectively. No arbitrary values are cloned.
- Command: `node --test --test-name-pattern='structured physical dimensions|physical dimensions require|reject unsupported|empty physical dimensions' test/project-content-service.test.js`
- Result: **GREEN**, 4 pass / 0 fail.

### GREEN 4 — Optional facts remain independent

- Test: `capacity-only and weight-only facts do not fabricate physical axes`
- Command: `node --test --test-name-pattern='physical dimensions|capacity-only' test/project-content-service.test.js`
- Result: **GREEN**, 5 pass / 0 fail. No additional production change was needed; both forms persist without height/width/depth.

### RED 5 — ProductRevision API public seam

- Test: `test/project-content-api.test.js`
- Name: `authenticated API creates, restores, edits, confirms, and readies a product snapshot`
- Command: `node --test --test-name-pattern='authenticated API creates' test/project-content-api.test.js`
- Result: **RED**
- Evidence: the PATCH response returned `physical_dimensions: null` because the route did not forward the new field.

### GREEN 5

- Minimal implementation: the ProductRevision PATCH route now forwards `physical_dimensions` only when the field is present, preserving omitted-input behavior.
- Command: `node --test --test-name-pattern='authenticated API creates' test/project-content-api.test.js`
- Result: **GREEN**, 1 pass / 0 fail.

### GREEN 6 — ProductRevision PostgreSQL persistence

- Implementation: added nullable JSONB `physical_dimensions` migration v2, object-shape constraint, frozen/superseded immutability guard, and repository insert/update persistence.
- Updated integration coverage checks migration version 2, JSONB round-trip, omitted-field preservation, and direct frozen-row immutability.
- Command: `node --test test/project-content-service.test.js test/project-content-api.test.js test/project-content-postgres.integration.test.js`
- Result: **GREEN** for 19 runnable tests / 0 fail; PostgreSQL integration was skipped because `PROJECT_CONTENT_TEST_DATABASE_URL` is unset.

### RED 7 — Product UI public browser seam

- Test: `test/project-content-browser.test.js`
- Name: `system Chrome completes and restores the project-content flow`
- Command: `node --test --test-name-pattern='system Chrome completes' test/project-content-browser.test.js`
- Result: **RED**
- Evidence: browser timed out waiting for the new `实物尺寸` heading after product creation (`Timeout 30000ms`).

### GREEN 7

- Minimal implementation: added the keyboard-accessible `实物尺寸` section with explicit labels, metric axis-unit options (`mm/cm/m`), capacity/weight quantity controls, load/save projection, responsive grid styling, and the warning that presentation scale is configured separately in VideoPlan.
- Command: `node --test --test-name-pattern='system Chrome completes' test/project-content-browser.test.js`
- Result: **GREEN**, 1 pass / 0 fail. The first rerun exposed only an incorrect test label literal (`容量数值` vs the rendered `容量数值（可选）`); after correcting that test selector, the browser seam passed.

### RED 8 — VideoPlan canonical presentation size persistence

- Test: `test/video-planning-service.test.js`
- Name: `creates a plan with the canonical Hifly presentation size`
- Command: `node --test --test-name-pattern='canonical Hifly presentation size' test/video-planning-service.test.js`
- Result: **RED**
- Evidence: the service created the plan without `presentation_size_code`; expected the requested canonical code `small`.

### GREEN 8

- Minimal implementation: added the six-code business enum (`smart_fit`, `extra_large`, `large`, `medium`, `small`, `extra_small`) with Chinese labels and default-compatible normalization; create/save/derive/preflight now carry `presentation_size_code`. Provider numeric values remain outside this module.
- Command: `node --test --test-name-pattern='canonical Hifly presentation size' test/video-planning-service.test.js`
- Result: **GREEN**, 1 pass / 0 fail.

### RED 9 — Production input snapshot public projection

- Test: `test/production-order-api.test.js`
- Name: `production order API requires identity, creates an offline waiting order, and restores list/detail/workspace`
- Command: `node --test --test-name-pattern='production order API requires identity' test/production-order-api.test.js`
- Result: **RED**
- Evidence: the persisted order contained the product revision snapshot internally, but the public route projection omitted `product_revision_snapshot`; the new assertion could not observe physical dimensions. The plan snapshot also now asserts the canonical `presentation_size_code`.

### GREEN 9

- Minimal implementation: the production-order public snapshot now exposes `product_revision_snapshot` while removing its organization identifier; existing structured order cloning already preserved physical dimensions and the plan’s canonical presentation code.
- Command: `node --test --test-name-pattern='production order API requires identity' test/production-order-api.test.js`
- Result: **GREEN**, 1 pass / 0 fail.

### RED 10 — Production input snapshot browser projection

- Test: `test/production-order-browser.test.js`
- Name: `production workspace supports empty/create/re-entry flows at desktop and 390px without A10 buttons`
- Command: `node --test --test-name-pattern='production workspace supports empty' test/production-order-browser.test.js`
- Result: **RED**
- Evidence: the browser snapshot showed only generic product/plan cards; it did not visibly separate the fixed `实物尺寸` fact from the `画面呈现比例` setting.

### GREEN 10

- Minimal implementation: the production snapshot UI now renders fixed physical dimensions, optional capacity/weight facts, and the canonical presentation label/code in a separate responsive fact group. The generic Works/Cloud panels remain independent.
- Command: `node --test --test-name-pattern='production workspace supports empty' test/production-order-browser.test.js`
- Result: **GREEN**, 1 pass / 0 fail across its desktop and 390px flow.

### RED 11 — Manual handoff presentation setting gate

- Test: `test/manual-handoff-package-service.test.js`
- Name: `manual handoff rejects a plan without a canonical presentation size`
- Command: `node --test --test-name-pattern='plan without a canonical presentation size' test/manual-handoff-package-service.test.js`
- Result: **RED**
- Evidence: a handoff manifest could be built from a frozen plan with no `presentation_size_code`; expected `VIDEO_PLAN_PRESENTATION_SIZE_REQUIRED` before any execution handoff.

### GREEN 11

- Minimal implementation: the handoff manifest requires one canonical presentation-size code, preserves it in the immutable plan snapshot, and records the ProductRevision dimensions plus an explicit appearance-fidelity warning in the operator README.
- Command: `node --test --test-name-pattern='plan without a canonical presentation size' test/manual-handoff-package-service.test.js`
- Result: **GREEN**, 1 pass / 0 fail.

### RED/GREEN 12 — Local and Cloud executor package contract

- Public seam: `compilePackageToBatchItem` and the existing Cloud Playwright adapter fixture.
- RED: a canonical `medium` plan setting was absent from the compiled task, while missing/unsupported values did not produce the new controlled requires-action codes.
- GREEN: compiled tasks carry `presentation_size_code`; missing or unsupported input fails before executor calls with `LOCAL_AGENT_PRESENTATION_SIZE_REQUIRED` or `LOCAL_AGENT_PRESENTATION_SIZE_UNSUPPORTED`. The Cloud adapter regression proves `extra_small` reaches the Playwright task.
- Focused result: 141/141 service, compiler, adapter, Cloud, production-order, and batch tests passed.

### RED/GREEN 13 — Paid-action pre-submit selection

- Public seam: `HiflyHandsOnProductPage.createHandsOnImage` and `selectAndVerifyGoodsSize` through existing page doubles.
- RED: the current adapter uploaded the person and product and then clicked the paid modal generate action without selecting or proving the requested native size.
- GREEN: immediately before `clickModalGenerate`, the adapter selects the exact localized native option and verifies the provider's `actived` state. Unsupported code, missing control, or unverifiable selected state fails closed. Retry/reopen repeats the selection proof before any paid click.
- No live Provider request or paid generation was used for this test.

## Read-only Hifly evidence gate

- Existing sanitized capture evidence proved only the default request field `goods_size: 0`.
- A read-only inspection of the current `https://hifly.cc/goods` HTML and same-origin static JS/CSS on 2026-08-18 proved the full mapping:
  - `smart_fit` / 智能适配 = `0`
  - `extra_large` / 超大 = `50`
  - `large` / 大 = `40`
  - `medium` / 中 = `30`
  - `small` / 小 = `20`
  - `extra_small` / 超小 = `10`
- The same provider bundle sends the selected value as `goods_size`. The rendered control uses an exact localized image `alt`, while its parent receives `actived`; the current CSS styles that active state.
- Evidence was recorded on Issue #193. No modal generation, service-side mutation, video generation, or points were triggered.

## Implementation summary

- ProductRevision stores optional structured metric dimensions and optional capacity/weight facts. Empty input remains unknown; no image-derived inference exists.
- VideoPlan versions store one canonical native presentation-size code. Save, derive, preflight, PostgreSQL persistence, frozen immutability, and idempotency fingerprints preserve it.
- Production public input snapshots expose the organization-scrubbed ProductRevision snapshot and render physical facts separately from presentation size.
- Manual handoff and Local/Cloud package compilation preserve the size code and fail closed if a usable execution input is absent.
- The Playwright adapter verifies the requested provider control immediately before the paid modal action. Appearance fidelity remains a separate Works review responsibility.
- The first default full-suite run exposed a legacy Local Agent fixture without the newly required plan field; its failure path retained a heartbeat timer. Updating that fixture to the known legacy default `smart_fit` restored the focused 15/15 CLI test without changing production behavior.

## Visual and responsive evidence

- Real system Chrome covered Project, Plan, and Production at 1440, 768, and 390 widths, with no page-level horizontal overflow.
- Screenshots are temporary under `/private/tmp/hifly-issue193-screens-20260818` and are not committed.
- Verified PNG dimensions:
  - Project: `1440×1595`, `768×1892`, `390×2601`
  - Plan: `1440×1344`, `768×2419`, `390×2718`
  - Production: `1440×1707`, `768×2340`, `390×2811`
- The Project page exposes explicit labeled fact inputs; Plan exposes the native six-option selector and a fidelity warning; Production renders immutable physical facts and the canonical presentation setting as separate concepts.
- This is local browser evidence with fake application data. It is not deployment, Provider, paid-generation, or customer-adoption evidence.

## Final local verification

- `node --test test/local-agent-cli.test.js`: 15/15 pass after updating the legacy package fixture to the known `smart_fit` default.
- `IDENTITY_BROWSER_EXECUTABLE=... node --test test/manual-handoff-package-api.test.js test/manual-handoff-package-browser.test.js test/manual-handoff-package-real-chain.test.js test/vsa-a14-acceptance-browser.test.js`: 6/6 pass.
- `IDENTITY_BROWSER_EXECUTABLE=... node --test test/project-content-browser.test.js test/video-planning-browser.test.js test/production-order-browser.test.js`: 3/3 pass with the responsive screenshots above.
- Default `npm test`: 1050 tests / 1036 pass / 14 existing environment-gated skips / 0 fail. Skips are PostgreSQL integration or optional browser/environment gates that require their dedicated CI/runtime configuration; no failure was converted to a skip by this change.
- `npm run check`: 230 JavaScript files checked.
- `git diff --check`: pass.

## Remaining evidence gates

- PostgreSQL integrations require the repository CI database environment; local runs without the relevant database URLs skip those existing environment-gated cases.
- A future deployment must apply both new migrations before App/Worker use.
- Any paid Provider acceptance requires a separately controlled zero-attempt order and explicit execution authorization. Size selection must be observed before the paid action, and the resulting Work must still be reviewed for cap, package, label, and shape fidelity.
- Work `8899a538-1ba7-47cd-870c-2a43cbb8ac39` remains `rework_required`; this implementation does not reinterpret or clear that production truth.
