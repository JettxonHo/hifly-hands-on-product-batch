# Local GUI Acceptance Report

Date: 2026-07-12
Branch: `feature/local-gui-workbench`
Scope: Task 9 acceptance for the local Hifly "手里有货" batch GUI workbench.

## Verdict

APPROVE for no-credit local acceptance.

Real Hifly small-batch regression was not run because this task did not receive fresh explicit approval to consume Hifly credits. No command in this acceptance pass accessed Hifly or submitted a real generation job.

## Independent Review

Subagent Dewey completed an independent read-only acceptance review.

- Verdict: APPROVE
- Critical findings: none
- Important findings: none
- Blocking minor findings: none
- Note: `MEMORY.md` is untracked and intentionally not part of the package or Task 9 commit.

After Dewey's main review, mobile visual acceptance found the tab bar could be cleaner at 390px width. The only follow-up code change was `web/styles.css`, changing mobile tabs to a two-column grid. Dewey re-reviewed that small CSS change and returned APPROVE with no Critical, Important, or Minor findings.

## Verification Evidence

Commands run locally:

```bash
npm test
npm run check
npm run validate
npm run package
git diff --check
tar -tzf outputs/hifly-hands-on-product-batch.tar.gz | rg '(^|/)(workspace|batches|config\.local\.json|playwright/(\.auth|profile)|downloads|logs|screenshots|outputs)(/|$)'
```

Results:

- `npm test`: passed, 111 tests total, 107 passed, 0 failed, 4 skipped.
- Skips were local TCP/browser smoke tests blocked by sandbox, not Hifly tests.
- `npm run check`: passed, checked 37 JavaScript files.
- `npm run validate`: passed, validated 3 product rows from `products/products.csv`.
- `npm run package`: passed, generated `outputs/hifly-hands-on-product-batch.tar.gz`.
- `git diff --check`: passed.
- Tar forbidden-item scan: no matches.

Visual evidence:

- Desktop screenshot: `/private/tmp/hifly-task9-desktop.png`
- Mobile screenshot: `/private/tmp/hifly-task9-mobile.png`
- Desktop viewport: 1440x900, 4 buttons, 4 tabs.
- Mobile viewport: 390x844, 4 buttons, 4 tabs.
- Tab texts detected in both screenshots: `新建商品`, `批量导入`, `待执行任务`, `运行记录`.

## Acceptance Matrix

| Requirement | Evidence |
| --- | --- |
| Illegal Host, Origin, and token rejection | `test/server-security.test.js`; `src/server/request-security.js` |
| Malicious upload, file size, pixel, and type limits | `test/upload-service.test.js`; `src/server/upload-service.js` |
| Ambiguous upload matching | `test/match-uploads.test.js` |
| Global execution lock and concurrent execution rejection | `test/execution-lock.test.js`; `test/server-api.test.js` |
| Duplicate idempotency key rejection | `test/server-api.test.js` |
| Confirmed execution snapshot mismatch | `test/batch-runner.test.js`; `src/core/batch-runner.js` |
| Submit-boundary crash safety | `test/recovery.test.js`; `test/batch-runner.test.js` |
| Ambiguous remote work remains interrupted | `test/recovery.test.js`; `src/core/batch-runner.js` |
| Download-only retry | `test/batch-runner.test.js` |
| Server stop/restart recovery behavior | `test/server-api.test.js`; `test/recovery.test.js` |
| Package excludes local state and login state | `test/startup.test.js`; tar forbidden-item scan |
| GUI docs support customer/operator direct upload | `README.md`; `docs/ENVIRONMENT.md`; `docs/新人培训使用手册.html` |
| GUI visual acceptance at desktop and mobile sizes | `/private/tmp/hifly-task9-desktop.png`; `/private/tmp/hifly-task9-mobile.png` |

## Package Check

The package includes:

- `web/`
- `src/`
- `scripts/check-js.mjs`
- `scripts/package-artifacts.mjs`
- `docs/ENVIRONMENT.md`
- `docs/SOP.md`
- `docs/新人培训使用手册.html`
- `test/`
- example config and product sheets

The package excludes:

- `workspace/`
- `batches/`
- `config.local.json`
- `playwright/.auth/`
- `playwright/profile/`
- `downloads/`
- `logs/`
- `screenshots/`
- `outputs/`

## Residual Risk

- Real Hifly regression remains unverified in this Task 9 pass because it would consume credits and requires explicit approval.
- Local TCP bind and browser smoke tests are covered by code and tests, but 4 related tests skipped in this sandbox.
- Windows behavior is covered by cross-platform Node APIs, documentation, and package tests, but no Windows host was available in this session for a real Windows launch.
