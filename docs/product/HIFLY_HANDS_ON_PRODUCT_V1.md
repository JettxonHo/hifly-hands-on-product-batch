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
    "mode": "hands_on_product", "aspect_ratio": "9:16",
    "voice_source": "hifly_native", "scene_mode": "single_scene",
    "camera_mode": "fixed_simple", "presentation_size_code": "smart_fit",
    "b_roll": false, "additional_characters": false, "external_tts": false,
    "standalone_lipsync": false, "copy_ai_generation": false
  }
}
```

The immutable snapshot is created only when the production snapshot port is explicitly configured with `productionContractId=HIFLY_HANDS_ON_PRODUCT_V1`; no route input or natural-language plan text opts into it. Production configuration supplies that marker. Legacy/demo callers without the marker retain their historical contractless snapshot behavior.

`buildHiflyHandsOnProductV1` deep-freezes the result. `requireHiflyHandsOnProductV1` validates the fixed invariants and can cross-check caller-provided expected lineage. Canonical JSON and SHA-256 are used only for this execution-integrity contract.

## Propagation and fail-closed boundaries

- ProductionOrder input snapshots contain `hifly_hands_on_product_v1` when the explicit production marker is enabled.
- Manual handoff validates the exact plan/review/product/copy/avatar lineage, copies the contract verbatim into `manifest.json`, and includes it in `manifest_hash`.
- The package compiler checks the exact product reference and copy body hash, reads the embedded product bytes and mapped avatar bytes, and compares verified size/checksum before emitting a task. The task carries the contract and exact lineage.
- Execution snapshots include the contract only for V1 tasks. Legacy task digests do not gain a `null` field.
- Cloud Playwright validates the contract before browser/delegate construction. With no proven verifier it stops browser-zero; with an injected future verifier it constructs one page/delegate, passes that same `page`/`hiflyPage` to the verifier, and invokes it before `runBatch`/`createAsset`/`submitVideo`; a failed verifier closes the context and returns an Owner-gated stop.

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
| 9:16 | Historical capture exists, but no proven current Playwright set/read-back | `LIVE_RECORDING_REQUIRED` |
| Hifly native voice | Historical output is not a machine-verifiable setter/read-back contract | `LIVE_RECORDING_REQUIRED` |
| Generate action boundary | Existing pre-submit checkpoint and paid-action seam | `SUFFICIENT_EXISTING_EVIDENCE` |
| Download/output | Historical Hifly → artifact → A12/Work chain | `SUFFICIENT_EXISTING_EVIDENCE` |

`NEW_CODEX_RECORDING_REQUIRED=YES` for the ratio and native-voice fields only. A future bounded recording should capture DOM/state, selector, request/response and set/read-back values, and stop immediately before any point-consuming Generate click whenever the fields can be established without generating. No recording or live generation is performed by Issue #278.

## P1 truth

`presentation_size_code=smart_fit` is **CLOSED / CONTRACT_MACHINE_ENFORCED** by the existing native select and double read-back seam. `copy_ai_generation=false` is **CONTRACT_MACHINE_ENFORCED** by the existing script/toggle set and read-back before inner Generate. `scene_mode=single_scene`, `camera_mode=fixed_simple`, `b_roll=false` and `additional_characters=false` are **RECORDED_ONLY / POST_OUTPUT_QC_REQUIRED**. `external_tts=false` and `standalone_lipsync=false` are **RECORDED_ONLY** from the current path and are not claims about future provider capabilities. Output appearance and quality remain a separate post-output human/QC gate.

## Stage verdict

`CONTRACT_IMPLEMENTATION = GAP`: the provider-free structural/identity candidate is GREEN, but production remains BLOCKED until a proven pre-point verifier can set and read back `aspect_ratio=9:16` and `voice_source=hifly_native`.

## External-effects boundary

This candidate performs no Provider or Hifly request, no login, no browser production run, no asset upload, no Generate click, no ProductionOrder/Handoff/Attempt creation, no Cloud claim, no deployment and no points spend. Tests use memory repositories, temporary files and injected fakes only.
