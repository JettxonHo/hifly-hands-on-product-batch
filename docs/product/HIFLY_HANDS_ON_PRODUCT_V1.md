# `HIFLY_HANDS_ON_PRODUCT_V1` bounded production contract

> 状态：provider-free / Hifly-free 工程候选；等待独立 Review 与 Owner Gate
> 关联：Issue #278、`RBV-GOAL-001`

本合同只覆盖已经有历史证据的飞影「手里有货」路径。它不是通用视频 DSL，也不开放独立口型、外部 TTS、B-roll、多角色或其他 production mode。所有事实必须来自结构化、当前且已批准的上游；契约 builder 不读取或解析 `output_instructions`。

## Contract shape

```json
{
  "contract_id": "HIFLY_HANDS_ON_PRODUCT_V1",
  "contract_version": "1",
  "plan": { "video_plan_version_id": "<exact>", "plan_review_id": "<exact>" },
  "product": {
    "revision_id": "<exact>",
    "primary_asset_version_id": "<exact>",
    "checksum_sha256": "<verified>",
    "media_type": "<verified image type>",
    "size": "<verified bytes>"
  },
  "copy": {
    "version_id": "<exact>", "mode": "frozen_copy", "transform": "none",
    "language": "zh-CN", "body_hash": "<sha256 of frozen body>"
  },
  "avatar": {
    "selection_id": "<exact>", "avatar_version_id": "<exact>",
    "material_version_id": "<registered exact>",
    "checksum_sha256": "<verified>", "media_type": "<verified image type>",
    "size": "<verified bytes>"
  },
  "production": {
    "mode": "hands_on_product", "target_aspect_ratio": "9:16",
    "handheld_aspect_ratio_policy": "record_only",
    "voice_source": "hifly_native", "scene_mode": "single_scene",
    "camera_mode": "fixed_simple", "presentation_size_code": "smart_fit",
    "b_roll": false, "additional_characters": false, "external_tts": false,
    "standalone_lipsync": false, "copy_ai_generation": false
  }
}
```

`production.target_aspect_ratio` is the intended target only. It is not a claim about
the dimensions of either a future handheld artifact or the final video. Those
observations are recorded separately through the narrow Production Evidence
Contract. Every record contains `field`, `expected`, `actual`,
`evidence_source`, `verification_stage`, `paid_boundary`, and `result`.

For a generated handheld artifact, the post-handheld/pre-video gate reads the
artifact's natural dimensions and applies the exact integer check
`width * 16 === height * 9`. The immutable per-run policy is
`record_only` by default; a near-9:16 result such as `1600x2848` is recorded as
`FAIL_EXACT_MATCH` and may continue. An explicit `require_exact` policy turns
the same evidence into `requires_action`, so UI Confirm and Stage 2 submit are
not reached. The historical real run explicitly required exact ratio and was
therefore correctly stopped after paid Stage 1; this revision does not rewrite
that historical result. It does not infer the final-video ratio:
`final_video_aspect_ratio` remains `NOT_PROVEN` until a final MP4 is observed.

The immutable snapshot is created only when the production snapshot port is explicitly configured with `productionContractId=HIFLY_HANDS_ON_PRODUCT_V1`; no route input or natural-language plan text opts into it. Production configuration supplies that marker. Legacy/demo callers without the marker retain their historical contractless snapshot behavior.

`buildHiflyHandsOnProductV1` deep-freezes the result. `requireHiflyHandsOnProductV1` validates the fixed invariants and can cross-check caller-provided expected lineage. Canonical JSON and SHA-256 are used only for this execution-integrity contract.

## Propagation and fail-closed boundaries

- ProductionOrder input snapshots contain `hifly_hands_on_product_v1` when the explicit production marker is enabled.
- Manual handoff validates the exact plan/review/product/copy/avatar lineage, copies the contract verbatim into `manifest.json`, and includes it in `manifest_hash`.
- The package compiler checks the exact product reference and copy body hash, reads the embedded product bytes and mapped avatar bytes, and compares verified size/checksum before emitting a task. The task carries the contract and exact lineage.
- Execution snapshots include the contract only for V1 tasks. Legacy task digests do not gain a `null` field.
- Cloud Playwright validates the contract before browser/delegate construction. With no proven verifier it stops browser-zero; with an injected structured verifier it constructs one page/delegate, passes that same `page`/`hiflyPage` to the verifier, and invokes it before `runBatch`/`createAsset`/`submitVideo`. Bare booleans and other unstructured success values are rejected, and a failed verifier returns a structured Owner-gated `requires_action` projection.
- Local Agent real V1 execution applies the same structured verifier contract after package compilation and before `createAsset`/`submitVideo`. A missing, bare, incomplete, or non-verified response stops before those executor calls. Legacy non-V1 packages retain their historical fake/real routing behavior.

Any identity, mapping, media, size, checksum, mode, version, ratio, voice, or copy-state mismatch stops before a point-consuming boundary. A generic verified capability never selects this route; the explicit contract plus exact registered material version/checksum does.

## Evidence coverage report

| Field / step | Existing evidence | Current status |
|---|---|---|
| Hands-on-Product entry/mode | Historical `/goods` page and Playwright page object | `SUFFICIENT_EXISTING_EVIDENCE` |
| Avatar upload | Historical single-chain Playwright execution | `SUFFICIENT_EXISTING_EVIDENCE` |
| Product upload | Historical single-chain Playwright execution and exact source-image evidence | `SUFFICIENT_EXISTING_EVIDENCE` |
| Frozen Chinese copy input | Existing real record, frozen CopyVersion, and handoff/compiler snapshots | `SUFFICIENT_EXISTING_EVIDENCE` |
| AI-copy disabled | Existing Hifly page toggle/script set + read-back before inner Generate, preserved as frozen-copy mode | `CONTRACT_MACHINE_ENFORCED` |
| Smart Fit | Existing native size mapping, select + double read-back pre-submit seam | `CONTRACT_MACHINE_ENFORCED` |
| 9:16 | Historical `1600x2848` artifact plus post-handheld natural-dimension seam | `RECORD_ONLY` by default; immutable `require_exact` gate available; final-video proof still required |
| Hifly native voice | Historical output is not a machine-verifiable setter/read-back contract | `LIVE_RECORDING_REQUIRED` |
| Generate action boundary | Existing pre-submit checkpoint and paid-action seam | `SUFFICIENT_EXISTING_EVIDENCE` |
| Download/output | Historical Hifly → artifact → A12/Work chain | `SUFFICIENT_EXISTING_EVIDENCE` |

`NEW_CODEX_RECORDING_REQUIRED=YES` for the native-voice identity fields only. Ratio target-vs-actual handling is now implemented as a post-handheld artifact gate, while a live recording is still required to establish any provider-side target normalization behavior. A future bounded recording should capture DOM/state, selector, request/response and set/read-back values, and stop immediately before any point-consuming Generate click whenever the fields can be established without generating. No recording or live generation is performed by this engineering stage.

## P1 truth

`production.target_aspect_ratio` is the immutable intended target. The
post-handheld natural-dimension check is **RECORD_ONLY** unless the immutable
`handheld_aspect_ratio_policy=require_exact` is selected for that run;
`presentation_size_code=smart_fit` is **CLOSED / CONTRACT_MACHINE_ENFORCED** by
the existing native select and double read-back seam. `copy_ai_generation=false`
is **CONTRACT_MACHINE_ENFORCED** by the existing script/toggle set and
read-back before inner Generate. `scene_mode=single_scene`,
`camera_mode=fixed_simple`, `b_roll=false` and `additional_characters=false`
are **RECORDED_ONLY / POST_OUTPUT_QC_REQUIRED**. `external_tts=false` and
`standalone_lipsync=false` are **RECORDED_ONLY** from the current path and are
not claims about future provider capabilities. Output appearance and quality
remain a separate post-output human/QC gate.

## Stage verdict

`CONTRACT_IMPLEMENTATION = GAP`: the provider-free structural/identity candidate and post-handheld exact-ratio stop are GREEN, but production remains BLOCKED until a proven structured pre-point verifier can establish the required native voice identity and a real final-video run can prove final ratio/audio behavior.

The historical evidence baseline keeps hands-on-product `PROVEN`, while a new
run without an evidence record starts as `NOT_PROVEN`. Avatar/product remain
`PARTIAL`; copy/voice/final ratio and Stage 1→Stage 2 dimension behavior remain
`NOT_PROVEN` until their own evidence is observed. Product fidelity is a
consumer-visible gate: missing/wrong product, major shape or color corruption,
gross corruption, wrong substitution, or a consumer-visible contradiction can
block. Unreadable fine print is recorded as `NOT_OBSERVABLE` or `NOT_REQUIRED`;
this contract does not add OCR.

The approved Copy v2 → Hifly UI input path remains distinct from submitted
production request → final Chinese narration correspondence. UI input matching
does not prove final audio. Likewise, the UI-visible voice display is not an
exact provider identity; unobserved `id`, `tts_voice_id`, `name`,
`display_name`, `group_id`, and submitted `voice_name` remain
`NOT_CAPTURED`/`NOT_PROVEN`.

## External-effects boundary

This candidate performs no Provider or Hifly request, no login, no browser production run, no asset upload, no Generate click, no ProductionOrder/Handoff/Attempt creation, no Cloud claim, no deployment and no points spend. Tests use memory repositories, temporary files and injected fakes only.
