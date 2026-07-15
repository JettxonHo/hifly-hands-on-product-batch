# Task 1 Report: Core Strategy Resolution

## Status

DONE

## Implemented

- Added `src/core/person-strategy.js` with explicit person-image precedence, fixed batch upload, category-pool rotation, default-pool fallback, Hifly recommendation fallback, and resolution metadata.
- Added `src/core/script-strategy.js` with `hifly_ai`, `provided_script`, and `mixed` modes plus `SCRIPT_REQUIRED` validation.
- Updated `src/person-pool.js` so `assignPersonImages` delegates to the core person resolver while preserving existing named exports used by product validation.
- Added the requested person and script strategy tests.

## TDD Evidence

The required red-phase command was run before implementation:

```text
node --test test/person-strategy.test.js test/script-strategy.test.js
```

Both test files failed with `ERR_MODULE_NOT_FOUND` for the two missing strategy modules, as expected.

## Verification

```text
node --test test/person-strategy.test.js test/script-strategy.test.js test/product-validation.test.js
11 passed, 0 failed

npm run check
Checked 43 JavaScript file(s).

git diff --check
passed

npm test
152 passed, 1 failed. The unrelated pre-existing failure is the GUI smoke test's strict `getByLabel('SKU')` selector, which resolves both the single-entry and bulk-entry SKU fields. The bulk-entry GUI smoke test passes.
```

No Hifly browser execution was performed and no real Hifly points were consumed.

## Scope and Concerns

The change is limited to the five Task 1 implementation/test files. Existing `listPersonPoolFiles`, `normalizeCategory`, and related exports remain available. Legacy no-override uploads continue to use the same resolved person path or Hifly recommendation branch; the resolver additionally records resolution metadata. The existing GUI smoke selector failure remains outside Task 1 scope.

## Commit

The implementation commit is recorded in the final task response.

## Reviewer Fixes

- Updated `src/core/person-strategy.js` to resolve filesystem reads through `resolveFromRoot(config, rootDir)` while retaining configured-root-relative paths in `__resolved_person_image_path` for later upload resolution.
- Restored legacy category normalization behavior by lowercasing normalized path segments.
- Added regression coverage for mixed-case `Toy` categories and relative person-pool roots.

## Reviewer-Fix Verification

```text
node --test test/person-strategy.test.js test/script-strategy.test.js test/product-validation.test.js
12 passed, 0 failed

npm run check
Checked 43 JavaScript file(s).

git diff --check
passed
```

No Hifly browser execution was performed and no real Hifly points were consumed.
