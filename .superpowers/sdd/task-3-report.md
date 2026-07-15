# Task 3 Report: GUI Strategy Controls And Script Entry

## Status

Completed.

## Changes

- Added person and script strategy controls to single, bulk, and import forms.
- Added single and per-row bulk script fields; generated CSV tables include `script`.
- Sent selected strategies explicitly to both batch creation and multipart import.
- Added API coverage for table-script persistence.

## Review Fixes

- Made `fixed_upload` usable: single, bulk, and table-import forms now require a batch-level fixed person image when that strategy is selected and submit it as `fixed_person_file`.
- The multipart import route accepts exactly one `fixed_person_file`, validates it through the existing upload service as an image, stores it as a batch upload/artifact, and binds its artifact ID to `fixed_person_image_artifact_id`.
- A fixed-person upload with any other person strategy now returns `400 FIXED_PERSON_FILE_REQUIRES_FIXED_UPLOAD`; fixed-person uploads are excluded from product-image matching.
- Expanded server API coverage for single-style and bulk-style script/strategy payload persistence, fixed-person artifact binding, and strategy/file conflict rejection.

## Verification

- `node --test test/server-api.test.js`: passed, 27 tests.
- `npm run check`: passed, 43 JavaScript files checked.
- `git diff --check`: passed.

## Hifly Usage

No GUI or real Hifly execution was started. No points were consumed.

## Concerns

Browser-level GUI helper coverage remains out of scope for this codebase; the server tests exercise the multipart payload contract used by single, bulk, and import submissions. Task 4 remains responsible for execution-time fixed-artifact path resolution and strategy freezing.
