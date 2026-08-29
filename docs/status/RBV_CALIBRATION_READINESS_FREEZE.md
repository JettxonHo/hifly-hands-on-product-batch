# RBV-CAL-001 Calibration Readiness Freeze

> Issue：[#261 RBV-002 Calibration Readiness Freeze](https://github.com/JettxonHo/hifly-hands-on-product-batch/issues/261)
> Goal：[`RBV-GOAL-001`](../../GOAL.md)
> Decision：[`D-037`](../product/DECISION_LOG.md#d-037-real-batch-production-validation)
> Contract：[`REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md`](../product/REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md)
> Exact base/main：`135ac176dc48162395707550a991d075287702c2`
> Branch：`codex/rbv-calibration-readiness-freeze`

本记录是脱敏的 Calibration Readiness Freeze，不是 Calibration Run、Provider 报告或生产就绪声明。上一阶段 Stage 1「合同与人工门禁」已完成历史；当前只激活 Readiness Freeze。五个 SKU 均为 `BLOCKED`，唯一当前 verdict 为 `BLOCKED_PRE_REAL_RUN`，不得以文档、测试、fixture 或工程基线伪造可运行状态。

## 1. Machine-checkable freeze metadata

| field | value | evidence / boundary |
|---|---|---|
| readiness_id | RBV-CAL-001 | frozen record |
| issue | 261 | RBV-002 |
| goal_id | RBV-GOAL-001 | D-037 chain |
| active_stage | Readiness Freeze | current stage |
| previous_stage | Stage 1 Contract (Issue #259 / PR #260) | completed historical |
| roster_count | 5 | SKU-CAL-001 … SKU-CAL-005 |
| operator_id | OP-CAL-001 | Owner nominated operator |
| batch_hard_cap_points | 6000 | maximum exposure only |
| per_sku_max_points | 1200 | maximum exposure only |
| concurrency | 1 | sequential only |
| automatic_retry | false | no implicit retry or rerun |
| run_date | 2026-08-29 | owner-confirmed date |
| timezone | Asia/Shanghai | owner-confirmed timezone |
| run_window | Owner confirmation → 2026-08-29T23:59:59+08:00 | window is not authorization |
| non_author_operator | pending | does not block Calibration readiness; blocks Repeatable |
| max_exposure_semantics | maximum exposure, not spend authorization | points are not permission to spend |
| verdict | BLOCKED_PRE_REAL_RUN | unique current verdict |

`6000` and `1200` are hard exposure ceilings; max exposure is not spend authorization, a charge, or permission to call a Provider. Any cost ambiguity, missing authorization, or first failure stops at the Owner Gate. No retry, parallel run, sample shrinking, Provider substitution, or authorization reuse is implied.

## 2. Source aliases and evidence boundary

The external product sample root is referred to only by the alias `RBV_PRODUCT_INPUT_SAMPLES`; the repository records relative paths and public source-page references, never a private absolute path. The alias contains the owner-provided `README.md`, `SOURCES.md`, `manifest.json`, nine test-input images, and the retained cleanser source-square image used for provenance. These files remain outside Git and are not copied into this repository.

The private evidence root is referred to only by `RBV_PRIVATE_EVIDENCE_ROOT`. The candidate person reference is the relative path `avatar/rbv-avatar-placeholder-frontend-v1.png`. The evidence tree is outside Git and contains no run payload, cookie, token, profile, Provider response, video, customer material, or other real evidence.

| evidence_alias | relative_ref | status |
|---|---|---|
| RBV_PRIVATE_EVIDENCE_ROOT | calibration/RBV-CAL-001/inputs/ | empty skeleton, mode 0700 |
| RBV_PRIVATE_EVIDENCE_ROOT | calibration/RBV-CAL-001/provider/ | empty skeleton, mode 0700 |
| RBV_PRIVATE_EVIDENCE_ROOT | calibration/RBV-CAL-001/runtime/ | empty skeleton, mode 0700 |
| RBV_PRIVATE_EVIDENCE_ROOT | calibration/RBV-CAL-001/outputs/ | empty skeleton, mode 0700 |
| RBV_PRIVATE_EVIDENCE_ROOT | calibration/RBV-CAL-001/cost/ | empty skeleton, mode 0700 |
| RBV_PRIVATE_EVIDENCE_ROOT | calibration/RBV-CAL-001/qc/ | empty skeleton, mode 0700 |
| RBV_PRIVATE_EVIDENCE_ROOT | calibration/RBV-CAL-001/delivery/ | empty skeleton, mode 0700 |
| evidence_status | no real evidence | no Provider, login, upload, generation, download, delivery, or points action |

The seven directories above were created outside Git with mode `0700`; no evidence file was created. All Git references use aliases plus relative refs only.

## 3. Candidate person and Provider input

| field | value | status / boundary |
|---|---|---|
| person_alias | RBV_PRIVATE_EVIDENCE_ROOT | private evidence alias only |
| person_relative_ref | avatar/rbv-avatar-placeholder-frontend-v1.png | relative ref only |
| person_source | AI-generated candidate from frontend prototype | candidate, not an approved Provider avatar |
| person_format | PNG | read-only metadata check |
| person_dimensions | 1122x1402 | read-only metadata check |
| person_bytes | 1666036 | read-only metadata check |
| person_mode | 0600 | private file permission |
| person_sha256 | 0887c7e4748caf2f9735e7d7d1afd6788d2f3b6e4d3a9a53a9c88f1767093b10 | read-only metadata check |
| person_git_boundary | outside_git | no copy into repository |
| person_owner_status | Owner nominated | internal permission still pending |
| person_rights_status | BLOCKED_PERSON_INTERNAL_PERMISSION_PENDING | usage scope not confirmed |
| person_upload_status | BLOCKED_PERSON_LIVE_UPLOAD_UNAUTHORIZED | live upload unauthorized; no internal permission |
| provider_input_status | BLOCKED_PROVIDER_UPLOAD_UNAUTHORIZED | no Provider request or page write |
| hifly_avatar_creation | not required | no Hifly avatar creation performed |
| engineering_upload_baseline | direct person + product image upload exists in Playwright baseline | baseline only, not run authorization |

The candidate person is not a license or upload approval. The current runtime model is not used as evidence of person or Provider readiness. No login, SSH/noVNC, browser Profile, Hifly avatar creation, person upload, product upload, generation, polling, download, or points action was performed.

## 4. Per-SKU readiness records

Each record keeps source-aligned identity separate from the manifest fixture name and selling points. `material_status` is metadata-only; `rights_status`, person, Provider input, and gate status remain blocked. `evidence_alias` and `evidence_ref` are the only evidence references recorded in Git.

### SKU-CAL-001

| field | value | evidence / notes |
|---|---|---|
| sku | SKU-CAL-001 | frozen roster item |
| source_aligned_candidate_name | Lean 450mL 不锈钢随行保温杯 | source-aligned candidate only, not Owner-authoritative |
| manifest_fixture_name | 随行杯 | test fixture name; not source authority |
| category | 日用品 | source/manifest category |
| fact_source | RBV_PRODUCT_INPUT_SAMPLES/manifest.json + SOURCES.md | source page: allprint.io/products/roostevabast-terasest-joogipudel-lean-1 |
| source_page_ref | https://allprint.io/products/roostevabast-terasest-joogipudel-lean-1 | public page reference, license not verified |
| identity_status | source_aligned_candidate_only_not_authoritative | source identity requires human confirmation |
| facts_status | BLOCKED_FACTS_FIXTURE_NOT_SOURCE_AUTHORITY | fixture name/selling points require source confirmation |
| material_count | 1 | one test input image |
| material_formats | 1 × JPEG | `01_thermos/thermos_portrait.jpg` |
| material_dimensions | 1 × 1800x2400 | portrait source metadata |
| material_composition | portrait（竖图） | unprocessed source composition |
| material_status | metadata_only_rights_pending | metadata does not establish permission |
| rights_status | BLOCKED_RIGHTS_UNVERIFIED | webpage image license and internal AI-test permission not verified |
| internal_permission_status | BLOCKED_INTERNAL_AI_TEST_PERMISSION_UNVERIFIED | internal use permission is not recorded |
| manual_review_target | source identity and claims | verify source-aligned product facts and selling points |
| candidate_person | RBV_PRIVATE_EVIDENCE_ROOT/avatar/rbv-avatar-placeholder-frontend-v1.png | candidate person, relative ref |
| person_status | BLOCKED_PERSON_INTERNAL_PERMISSION_PENDING | Owner nomination is not upload permission |
| provider_input_status | BLOCKED_PROVIDER_UPLOAD_UNAUTHORIZED | no live Provider input |
| max_points | 1200 | maximum exposure, not spend authorization |
| evidence_alias | RBV_PRIVATE_EVIDENCE_ROOT | Git-safe alias |
| evidence_ref | calibration/RBV-CAL-001/inputs/SKU-CAL-001 | relative ref, no real evidence |
| status | BLOCKED | readiness status |
| gate_status | BLOCKED | pre-run gate |
| blockers | WEB_IMAGE_LICENSE_UNVERIFIED; FIXTURE_NAME_SELLING_POINT_NOT_SOURCE_AUTHORITY; PERSON_INTERNAL_UPLOAD_PERMISSION_UNAUTHORIZED; PROVIDER_UPLOAD_GENERATE_UNAUTHORIZED | stop before any real action |

### SKU-CAL-002

| field | value | evidence / notes |
|---|---|---|
| sku | SKU-CAL-002 | frozen roster item |
| source_aligned_candidate_name | 四麦 ENC 真无线入耳式蓝牙耳机 | source-aligned candidate only, source current verification pending |
| manifest_fixture_name | 轻听蓝牙耳机 | test fixture name; not source authority |
| category | 数码 | source/manifest category |
| fact_source | RBV_PRODUCT_INPUT_SAMPLES/manifest.json + SOURCES.md | source page: globalsources.com/TWS-earbud/quad-mic-ENC-TWS-Earbuds-1212089959p.htm |
| source_page_ref | https://www.globalsources.com/TWS-earbud/quad-mic-ENC-TWS-Earbuds-1212089959p.htm | public page reference, license not verified |
| identity_status | source_aligned_candidate_only_not_authoritative | source identity requires human confirmation |
| facts_status | BLOCKED_FACTS_FIXTURE_NOT_SOURCE_AUTHORITY | fixture name/selling points require source confirmation |
| material_count | 1 | one test input image |
| material_formats | 1 × PNG | `02_earbuds/earbuds_square.png` |
| material_dimensions | 1 × 3000x3000 | square source metadata |
| material_composition | square（方图） | unprocessed source composition |
| material_status | metadata_only_rights_pending | metadata does not establish permission |
| rights_status | BLOCKED_RIGHTS_UNVERIFIED | webpage image license and internal AI-test permission not verified |
| internal_permission_status | BLOCKED_INTERNAL_AI_TEST_PERMISSION_UNVERIFIED | internal use permission is not recorded |
| manual_review_target | source identity and claims | verify source-aligned product facts and selling points |
| candidate_person | RBV_PRIVATE_EVIDENCE_ROOT/avatar/rbv-avatar-placeholder-frontend-v1.png | candidate person, relative ref |
| person_status | BLOCKED_PERSON_INTERNAL_PERMISSION_PENDING | Owner nomination is not upload permission |
| provider_input_status | BLOCKED_PROVIDER_UPLOAD_UNAUTHORIZED | no live Provider input |
| max_points | 1200 | maximum exposure, not spend authorization |
| evidence_alias | RBV_PRIVATE_EVIDENCE_ROOT | Git-safe alias |
| evidence_ref | calibration/RBV-CAL-001/inputs/SKU-CAL-002 | relative ref, no real evidence |
| status | BLOCKED | readiness status |
| gate_status | BLOCKED | pre-run gate |
| blockers | WEB_IMAGE_LICENSE_UNVERIFIED; FIXTURE_NAME_SELLING_POINT_NOT_SOURCE_AUTHORITY; PERSON_INTERNAL_UPLOAD_PERMISSION_UNAUTHORIZED; PROVIDER_UPLOAD_GENERATE_UNAUTHORIZED | source/current verification and authorization remain open |

### SKU-CAL-003

| field | value | evidence / notes |
|---|---|---|
| sku | SKU-CAL-003 | frozen roster item |
| source_aligned_candidate_name | Ducky One 3 Aura 全尺寸热插拔 RGB 机械键盘 | source-aligned candidate only, not Owner-authoritative |
| manifest_fixture_name | 曜石全尺寸热插拔RGB机械键盘 | test fixture name; not source authority |
| category | 数码 | source/manifest category |
| fact_source | RBV_PRODUCT_INPUT_SAMPLES/manifest.json + SOURCES.md | source page: mechanicalkeyboards.com/products/Ducky-One-3-Aura-Black |
| source_page_ref | https://mechanicalkeyboards.com/products/Ducky-One-3-Aura-Black?variant=47607985144108 | public page reference, license not verified |
| identity_status | source_aligned_candidate_only_not_authoritative | source identity requires human confirmation |
| facts_status | BLOCKED_FACTS_FIXTURE_NOT_SOURCE_AUTHORITY | fixture name/selling points require source confirmation |
| material_count | 1 | one test input image |
| material_formats | 1 × JPEG | `03_keyboard/keyboard_landscape.jpg` |
| material_dimensions | 1 × 2400x1600 | landscape source metadata |
| material_composition | landscape（横图） | unprocessed source composition |
| material_status | metadata_only_rights_pending | metadata does not establish permission |
| rights_status | BLOCKED_RIGHTS_UNVERIFIED | webpage image license and internal AI-test permission not verified |
| internal_permission_status | BLOCKED_INTERNAL_AI_TEST_PERMISSION_UNVERIFIED | internal use permission is not recorded |
| manual_review_target | source identity and claims | verify source-aligned product facts and selling points |
| candidate_person | RBV_PRIVATE_EVIDENCE_ROOT/avatar/rbv-avatar-placeholder-frontend-v1.png | candidate person, relative ref |
| person_status | BLOCKED_PERSON_INTERNAL_PERMISSION_PENDING | Owner nomination is not upload permission |
| provider_input_status | BLOCKED_PROVIDER_UPLOAD_UNAUTHORIZED | no live Provider input |
| max_points | 1200 | maximum exposure, not spend authorization |
| evidence_alias | RBV_PRIVATE_EVIDENCE_ROOT | Git-safe alias |
| evidence_ref | calibration/RBV-CAL-001/inputs/SKU-CAL-003 | relative ref, no real evidence |
| status | BLOCKED | readiness status |
| gate_status | BLOCKED | pre-run gate |
| blockers | WEB_IMAGE_LICENSE_UNVERIFIED; FIXTURE_NAME_SELLING_POINT_NOT_SOURCE_AUTHORITY; PERSON_INTERNAL_UPLOAD_PERMISSION_UNAUTHORIZED; PROVIDER_UPLOAD_GENERATE_UNAUTHORIZED | stop before any real action |

### SKU-CAL-004

| field | value | evidence / notes |
|---|---|---|
| sku | SKU-CAL-004 | frozen roster item |
| source_aligned_candidate_name | LastObject 可重复使用洁面分装瓶 | source-aligned candidate only, not Owner-authoritative |
| manifest_fixture_name | 森氧净澈洁面乳 | test fixture name; not source authority |
| category | 个护 | source/manifest category |
| fact_source | RBV_PRODUCT_INPUT_SAMPLES/manifest.json + SOURCES.md | source page: lastobject.co.uk/products/facial-cleanser-bottle |
| source_page_ref | https://lastobject.co.uk/products/facial-cleanser-bottle | public page reference, license not verified |
| identity_status | BLOCKED_SOURCE_OBJECT_MISMATCH | source is Facial Cleanser Bottle, not 洁面乳; fixture name is not source authority |
| facts_status | BLOCKED_FACTS_SOURCE_MISMATCH | source object is Facial Cleanser Bottle, not the fixture product |
| material_count | 1 | portrait test input; source square retained only in external sample root |
| material_formats | 1 × JPEG | `04_cleanser/cleanser_portrait.jpg` |
| material_dimensions | 1 × 1728x2160 | portrait test input; source square is 2160x2160 |
| material_composition | portrait（竖图） | centered crop from source square |
| material_status | metadata_only_rights_pending | metadata does not establish permission |
| rights_status | BLOCKED_RIGHTS_UNVERIFIED | webpage image license and internal AI-test permission not verified |
| internal_permission_status | BLOCKED_INTERNAL_AI_TEST_PERMISSION_UNVERIFIED | internal use permission is not recorded |
| manual_review_target | source object correction | reconcile Facial Cleanser Bottle source with the 洁面乳 fixture and claims |
| candidate_person | RBV_PRIVATE_EVIDENCE_ROOT/avatar/rbv-avatar-placeholder-frontend-v1.png | candidate person, relative ref |
| person_status | BLOCKED_PERSON_INTERNAL_PERMISSION_PENDING | Owner nomination is not upload permission |
| provider_input_status | BLOCKED_PROVIDER_UPLOAD_UNAUTHORIZED | no live Provider input |
| max_points | 1200 | maximum exposure, not spend authorization |
| evidence_alias | RBV_PRIVATE_EVIDENCE_ROOT | Git-safe alias |
| evidence_ref | calibration/RBV-CAL-001/inputs/SKU-CAL-004 | relative ref, no real evidence |
| status | BLOCKED | readiness status |
| gate_status | BLOCKED | pre-run gate |
| blockers | WEB_IMAGE_LICENSE_UNVERIFIED; SOURCE_OBJECT_MISMATCH_FACIAL_CLEANSER_BOTTLE_NOT_CLEANSER; FIXTURE_NAME_SELLING_POINT_NOT_SOURCE_AUTHORITY; PERSON_INTERNAL_UPLOAD_PERMISSION_UNAUTHORIZED; PROVIDER_UPLOAD_GENERATE_UNAUTHORIZED | source object is not the fixture product claim |

### SKU-CAL-005

| field | value | evidence / notes |
|---|---|---|
| sku | SKU-CAL-005 | frozen roster item |
| source_aligned_candidate_name | Highland Tactical Meadow XL 户外徒步背包（黑色） | source-aligned candidate only, not Owner-authoritative |
| manifest_fixture_name | 拓野大容量轻量防撕裂户外徒步露营双肩背包 | test fixture name; not source authority |
| category | 户外 | source/manifest category |
| fact_source | RBV_PRODUCT_INPUT_SAMPLES/manifest.json + SOURCES.md | source page: hltactical.com/products/meadow-xl-hiking-backpack |
| source_page_ref | https://hltactical.com/products/meadow-xl-hiking-backpack | public page reference, license not verified |
| identity_status | BLOCKED_SOURCE_OBJECT_MEADOW_XL | source object is Meadow XL; fixture identity requires human confirmation |
| manual_revision | prebuilt fixture, not real manual evidence | manifest revision is not a live operator correction |
| facts_status | BLOCKED_FACTS_FIXTURE_NOT_SOURCE_AUTHORITY | fixture name/selling points and revision require source confirmation |
| material_count | 5 | five same-product angles |
| material_formats | 5 × JPEG | `05_backpack/` five files |
| material_dimensions | 5 × 2000x2000 | all five source metadata entries |
| material_composition | multi-angle（Front/3Q/Side/Back/Inside） | same-product multi-view set |
| material_status | metadata_only_rights_pending | metadata does not establish permission |
| rights_status | BLOCKED_RIGHTS_UNVERIFIED | webpage image license and internal AI-test permission not verified |
| internal_permission_status | BLOCKED_INTERNAL_AI_TEST_PERMISSION_UNVERIFIED | internal use permission is not recorded |
| manual_review_target | name and claim review | source alignment plus fixture claim review |
| candidate_person | RBV_PRIVATE_EVIDENCE_ROOT/avatar/rbv-avatar-placeholder-frontend-v1.png | candidate person, relative ref |
| person_status | BLOCKED_PERSON_INTERNAL_PERMISSION_PENDING | Owner nomination is not upload permission |
| provider_input_status | BLOCKED_PROVIDER_UPLOAD_UNAUTHORIZED | no live Provider input |
| max_points | 1200 | maximum exposure, not spend authorization |
| evidence_alias | RBV_PRIVATE_EVIDENCE_ROOT | Git-safe alias |
| evidence_ref | calibration/RBV-CAL-001/inputs/SKU-CAL-005 | relative ref, no real evidence |
| status | BLOCKED | readiness status |
| gate_status | BLOCKED | pre-run gate |
| blockers | WEB_IMAGE_LICENSE_UNVERIFIED; SOURCE_OBJECT_MEADOW_XL; FIXTURE_NAME_SELLING_POINT_NOT_SOURCE_AUTHORITY; REVISION_PREBUILT_FIXTURE_NOT_REAL_MANUAL_EVIDENCE; PERSON_INTERNAL_UPLOAD_PERMISSION_UNAUTHORIZED; PROVIDER_UPLOAD_GENERATE_UNAUTHORIZED | manifest revision is a prebuilt fixture, not real manual evidence |

## 5. Current real-run blocker matrix

The readiness record intentionally blocks the current run even though a direct person-plus-product upload path exists as an engineering baseline. The following gates are unverified or unauthorized:

| blocker_code | status | consequence |
|---|---|---|
| LOGIN_RUNTIME_UNVERIFIED | BLOCKED | no login, Profile, SSH/noVNC, or runtime probing |
| UPSTREAM_PRODUCT_FACTS_UNVERIFIED | BLOCKED | no product facts are promoted from fixture values |
| UPSTREAM_COPY_NOT_VERIFIED | BLOCKED | no copy is treated as approved input |
| AVATAR_SELECTION_NOT_VERIFIED | BLOCKED | no candidate selection is confirmed |
| VIDEO_PLAN_NOT_VERIFIED | BLOCKED | no frozen/approved plan is available |
| ORDER_READINESS_NOT_VERIFIED | BLOCKED | no ProductionOrder or handoff is created |
| PERSON_INTERNAL_UPLOAD_PERMISSION_UNAUTHORIZED | BLOCKED | nominated image cannot be uploaded |
| PROVIDER_UPLOAD_GENERATE_UNAUTHORIZED | BLOCKED | no Provider or Hifly write action |
| POINTS_SPEND_UNAUTHORIZED | BLOCKED | exposure ceiling is not a spend authorization |
| WEB_IMAGE_LICENSE_UNVERIFIED | BLOCKED | all five product image sets require rights confirmation |

| action | authorization_status |
|---|---|
| login | unauthorized; fail-closed |
| upload | unauthorized; fail-closed |
| generation | unauthorized; fail-closed |
| Provider | unauthorized; fail-closed |
| points | unauthorized; fail-closed |
| deploy | unauthorized; fail-closed |

Existing Playwright direct person + product upload support is recorded as `existing_engineering_baseline`, not as live readiness. No Hifly avatar is required for this candidate, and no avatar creation is performed. GUI remains Deferred / Secondary; Cloud Executor P0 is historical/non-current, its current runtime state was not probed in this Stage, and this Stage does not enable or modify it.

## 6. Stop rules and unique verdict

Stop immediately at `BLOCKED_PRE_REAL_RUN` if any SKU right, fixture/source alignment, person permission, Provider input, login/runtime, upstream state, budget, window, or evidence boundary is not confirmed. This record has all five SKU gate statuses set to `BLOCKED`; no fake or fixture value can upgrade a rights, fact, manual-correction, or Provider gate.

The only permitted next step is an independently reviewed Owner Gate decision. Until then:

- do not create or claim a ProductionOrder or ExecutionAttempt;
- do not log in, upload a person or product, submit/generate/poll/download a Provider job, or spend points;
- do not create a Hifly avatar, deploy, publish, retry, parallelize, shrink the roster, or reuse authorization;
- keep Evidence outside Git and retain only aliases plus relative refs in repository documents.

Final verdict: `BLOCKED_PRE_REAL_RUN`.
