import assert from "node:assert/strict";
import test from "node:test";

import {
  HIFLY_HANDS_ON_PRODUCT_EVIDENCE_STATUS,
  HIFLY_HANDS_ON_PRODUCT_HISTORICAL_EVIDENCE_STATUS,
  HIFLY_MAX_EVIDENCE_RECORDS,
  HIFLY_PRE_PAID_REQUIREMENTS,
  HIFLY_VERIFICATION_RESULT,
  buildHistoricalHiflyHandsOnProductEvidenceStatus,
  buildHiflyHandsOnProductEvidenceStatus,
  createEvidenceRecord,
  evaluateProductFidelity,
  inspectStructuredVerificationResult,
  sanitizeEvidenceRecords,
  verifyExactAspectRatio
} from "../src/execution-contracts/hifly-hands-on-product-evidence.js";

test("exact 9:16 verification records the observed dimensions and fails 1600x2848", () => {
  const evidence = verifyExactAspectRatio({
    width: 1600,
    height: 2848,
    expected: "9:16",
    evidenceSource: "generated_artifact_natural_dimensions",
    verificationStage: "post_handheld_pre_video",
    paidBoundary: "after_paid_action_1_before_paid_action_2"
  });

  assert.equal(evidence.field, "handheld_aspect_ratio");
  assert.equal(evidence.expected, "9:16");
  assert.equal(evidence.actual_width, 1600);
  assert.equal(evidence.actual_height, 2848);
  assert.equal(evidence.actual, "1600x2848");
  assert.equal(evidence.evidence_source, "generated_artifact_natural_dimensions");
  assert.equal(evidence.verification_stage, "post_handheld_pre_video");
  assert.equal(evidence.paid_boundary, "after_paid_action_1_before_paid_action_2");
  assert.equal(evidence.result, HIFLY_VERIFICATION_RESULT.FAIL_EXACT_MATCH);
});

test("near-9:16 observation is record-only by default and requires an explicit immutable policy to stop", () => {
  const recordOnly = verifyExactAspectRatio({
    width: 1600,
    height: 2848,
    expected: "9:16",
    evidenceSource: "generated_artifact_natural_dimensions",
    verificationStage: "post_handheld_pre_video",
    paidBoundary: "after_paid_action_1_before_paid_action_2"
  });
  assert.equal(recordOnly.field, "handheld_aspect_ratio");
  assert.equal(recordOnly.enforcement, "record_only");
  assert.equal(recordOnly.requires_action, false);
  assert.equal(recordOnly.result, HIFLY_VERIFICATION_RESULT.FAIL_EXACT_MATCH);

  const required = verifyExactAspectRatio({
    width: 1600,
    height: 2848,
    expected: "9:16",
    enforcementPolicy: Object.freeze({ handheld_aspect_ratio: "require_exact" }),
    evidenceSource: "generated_artifact_natural_dimensions",
    verificationStage: "post_handheld_pre_video",
    paidBoundary: "after_paid_action_1_before_paid_action_2"
  });
  assert.equal(required.enforcement, "require_exact");
  assert.equal(required.requires_action, true);
  assert.throws(() => verifyExactAspectRatio({
    width: 1600,
    height: 2848,
    enforcementPolicy: "require_exact"
  }), { code: "HIFLY_EVIDENCE_ENFORCEMENT_POLICY_NOT_IMMUTABLE" });
  assert.throws(() => verifyExactAspectRatio({
    width: 1600,
    height: 2848,
    enforcementPolicy: { handheld_aspect_ratio: "require_exact" }
  }), { code: "HIFLY_EVIDENCE_ENFORCEMENT_POLICY_NOT_IMMUTABLE" });
});

test("ratio verification rejects unsafe cross-product arithmetic", () => {
  assert.throws(() => verifyExactAspectRatio({
    width: Number.MAX_SAFE_INTEGER,
    height: Number.MAX_SAFE_INTEGER,
    expected: "9:16"
  }), { code: "HIFLY_EVIDENCE_RATIO_OVERFLOW" });
});

test("evidence records require the production contract fields", () => {
  const record = createEvidenceRecord({
    field: "voice",
    expected: "hifly_native",
    actual: null,
    evidenceSource: "not_captured",
    verificationStage: "pre_paid",
    paidBoundary: "before_paid_action_1",
    result: HIFLY_VERIFICATION_RESULT.NOT_PROVEN
  });

  assert.deepEqual(record, {
    field: "voice",
    expected: "hifly_native",
    actual: null,
    evidence_source: "not_captured",
    verification_stage: "pre_paid",
    paid_boundary: "before_paid_action_1",
    result: HIFLY_VERIFICATION_RESULT.NOT_PROVEN
  });
});

test("default evidence statuses preserve independent dimensions and unreadable fine print is not a hard block", () => {
  assert.deepEqual(buildHiflyHandsOnProductEvidenceStatus(), HIFLY_HANDS_ON_PRODUCT_EVIDENCE_STATUS);
  assert.equal(HIFLY_HANDS_ON_PRODUCT_EVIDENCE_STATUS.hands_on_product, HIFLY_VERIFICATION_RESULT.NOT_PROVEN);
  assert.equal(HIFLY_HANDS_ON_PRODUCT_EVIDENCE_STATUS.avatar, HIFLY_VERIFICATION_RESULT.NOT_PROVEN);
  assert.equal(HIFLY_HANDS_ON_PRODUCT_EVIDENCE_STATUS.product, HIFLY_VERIFICATION_RESULT.NOT_PROVEN);
  assert.equal(HIFLY_HANDS_ON_PRODUCT_EVIDENCE_STATUS.ui_visible_voice, HIFLY_VERIFICATION_RESULT.NOT_CAPTURED);
  assert.equal(HIFLY_HANDS_ON_PRODUCT_HISTORICAL_EVIDENCE_STATUS.hands_on_product, HIFLY_VERIFICATION_RESULT.PROVEN);
  assert.equal(buildHistoricalHiflyHandsOnProductEvidenceStatus().avatar, HIFLY_VERIFICATION_RESULT.PARTIAL);
  assert.equal(HIFLY_HANDS_ON_PRODUCT_HISTORICAL_EVIDENCE_STATUS.product, HIFLY_VERIFICATION_RESULT.PARTIAL);
  assert.equal(HIFLY_HANDS_ON_PRODUCT_HISTORICAL_EVIDENCE_STATUS.ui_input_copy_match, HIFLY_VERIFICATION_RESULT.PROVEN);
  assert.equal(HIFLY_HANDS_ON_PRODUCT_HISTORICAL_EVIDENCE_STATUS.handheld_aspect_ratio, HIFLY_VERIFICATION_RESULT.DISPROVEN);
  assert.equal(HIFLY_HANDS_ON_PRODUCT_HISTORICAL_EVIDENCE_STATUS.final_audio_copy_correspondence, HIFLY_VERIFICATION_RESULT.NOT_PROVEN);
  assert.equal(HIFLY_HANDS_ON_PRODUCT_HISTORICAL_EVIDENCE_STATUS.ui_visible_voice, HIFLY_VERIFICATION_RESULT.PARTIAL);
  assert.equal(HIFLY_HANDS_ON_PRODUCT_HISTORICAL_EVIDENCE_STATUS.voice_id, HIFLY_VERIFICATION_RESULT.NOT_CAPTURED);
  assert.equal(buildHiflyHandsOnProductEvidenceStatus({ hands_on_product: HIFLY_VERIFICATION_RESULT.PROVEN }).hands_on_product, HIFLY_VERIFICATION_RESULT.NOT_PROVEN);
  const fidelity = evaluateProductFidelity({
    productPresent: true,
    productIdentity: true,
    majorShape: true,
    majorColor: true,
    grossVisualCorruption: false,
    wrongSubstitution: false,
    consumerVisibleContradiction: false,
    finePrintObservable: false,
    finePrintMatches: false
  });
  assert.equal(fidelity.result, HIFLY_VERIFICATION_RESULT.PROVEN);
  assert.equal(fidelity.hard_block, false);
  assert.equal(fidelity.fine_print_result, HIFLY_VERIFICATION_RESULT.NOT_REQUIRED);
  assert.equal(evaluateProductFidelity({ productPresent: true, productIdentity: true, majorShape: true, majorColor: true }).result, HIFLY_VERIFICATION_RESULT.PARTIAL);
});

test("structured verifier inspection rejects booleans and requires every requested field", () => {
  assert.equal(inspectStructuredVerificationResult(true, ["target_aspect_ratio"]).code, "CONTRACT_STRUCTURED_EVIDENCE_REQUIRED");
  const partial = inspectStructuredVerificationResult({
    status: "verified",
    evidence: [createEvidenceRecord({
      field: "target_aspect_ratio",
      expected: "9:16",
      actual: "9:16",
      evidenceSource: "production_contract",
      verificationStage: "pre_paid",
      paidBoundary: "before_paid_action_1",
      result: HIFLY_VERIFICATION_RESULT.PROVEN
    })]
  }, ["target_aspect_ratio", "voice_source"]);
  assert.equal(partial.code, "CONTRACT_STRUCTURED_EVIDENCE_INCOMPLETE");
  assert.deepEqual(partial.fields, ["voice_source"]);
});

test("pre-paid verifier evidence is bound to expected values and controlled context", () => {
  const valid = (overrides = {}) => [
    createEvidenceRecord({
      field: "target_aspect_ratio",
      expected: "9:16",
      actual: "9:16",
      evidenceSource: "hifly_dom_readback",
      verificationStage: "pre_paid",
      paidBoundary: "before_paid_action_1",
      result: HIFLY_VERIFICATION_RESULT.PROVEN,
      ...overrides.target
    }),
    createEvidenceRecord({
      field: "voice_source",
      expected: "hifly_native",
      actual: "hifly_native",
      evidenceSource: "hifly_dom_readback",
      verificationStage: "pre_paid",
      paidBoundary: "before_paid_action_1",
      result: HIFLY_VERIFICATION_RESULT.PARTIAL,
      ...overrides.voice
    })
  ];
  assert.equal(inspectStructuredVerificationResult({ status: "verified", evidence: valid() }, HIFLY_PRE_PAID_REQUIREMENTS).valid, true);
  assert.equal(inspectStructuredVerificationResult({ status: "verified", evidence: valid({ target: { expected: "16:9" } }) }, HIFLY_PRE_PAID_REQUIREMENTS).code, "CONTRACT_STRUCTURED_EVIDENCE_EXPECTED_MISMATCH");
  assert.equal(inspectStructuredVerificationResult({ status: "verified", evidence: valid({ voice: { verificationStage: "post_handheld_pre_video" } }) }, HIFLY_PRE_PAID_REQUIREMENTS).code, "CONTRACT_STRUCTURED_EVIDENCE_CONTEXT_MISMATCH");
  assert.equal(inspectStructuredVerificationResult({ status: "verified", evidence: valid({ voice: { result: HIFLY_VERIFICATION_RESULT.NOT_REQUIRED } }) }, HIFLY_PRE_PAID_REQUIREMENTS).code, "CONTRACT_STRUCTURED_EVIDENCE_RESULT_NOT_ALLOWED");
  assert.equal(inspectStructuredVerificationResult({ status: "verified", evidence: valid({ voice: { actual: { display: "原生声音" }, result: HIFLY_VERIFICATION_RESULT.PARTIAL } }) }, HIFLY_PRE_PAID_REQUIREMENTS).valid, true);
  assert.equal(inspectStructuredVerificationResult({ status: "verified", evidence: [...valid(), valid()[0]] }, HIFLY_PRE_PAID_REQUIREMENTS).code, "CONTRACT_STRUCTURED_EVIDENCE_DUPLICATE");
  assert.equal(inspectStructuredVerificationResult({ status: "verified", evidence: [...valid(), createEvidenceRecord({
    field: "copy",
    expected: "frozen",
    actual: "frozen",
    evidenceSource: "production_contract",
    verificationStage: "pre_paid",
    paidBoundary: "before_paid_action_1",
    result: HIFLY_VERIFICATION_RESULT.PROVEN
  })] }, HIFLY_PRE_PAID_REQUIREMENTS).code, "CONTRACT_STRUCTURED_EVIDENCE_INVALID");
});

test("partial native voice evidence rejects contradictory values and accepts only trimmed UI state", () => {
  const target = createEvidenceRecord({
    field: "target_aspect_ratio",
    expected: "9:16",
    actual: "9:16",
    evidenceSource: "production_contract",
    verificationStage: "pre_paid",
    paidBoundary: "before_paid_action_1",
    result: HIFLY_VERIFICATION_RESULT.PROVEN
  });
  const voice = (actual) => createEvidenceRecord({
    field: "voice_source",
    expected: "hifly_native",
    actual,
    evidenceSource: "hifly_ui_display",
    verificationStage: "pre_paid",
    paidBoundary: "before_paid_action_1",
    result: HIFLY_VERIFICATION_RESULT.PARTIAL
  });
  const inspect = (actual) => inspectStructuredVerificationResult({ status: "verified", evidence: [target, voice(actual)] }, HIFLY_PRE_PAID_REQUIREMENTS);
  assert.equal(inspect("hifly_native").valid, true);
  assert.equal(inspect({ display: " 原生声音 ", group: " 默认组 ", style: " 标准 " }).valid, true);
  assert.equal(inspect({ display: " 原生声音 ", group: " ", style: null }).valid, true);
  assert.equal(voice({ source: " hifly_native ", display: " Native " }).actual.source, "hifly_native");
  assert.equal(voice({ source: " hifly_native ", display: " Native " }).actual.display, "Native");
  assert.equal(inspect("external_tts").code, "CONTRACT_STRUCTURED_EVIDENCE_VALUE_INVALID");
  assert.equal(inspect({ source: "external_tts", display: "Native" }).code, "CONTRACT_STRUCTURED_EVIDENCE_VALUE_INVALID");
  assert.equal(inspect({ display: "   " }).code, "CONTRACT_STRUCTURED_EVIDENCE_VALUE_INVALID");
  assert.equal(HIFLY_PRE_PAID_REQUIREMENTS.voice_source.allowed_sources.includes("test_fixture"), false);
});

test("evidence sanitization rejects uncontrolled contexts and bounded-value leaks", () => {
  assert.throws(() => createEvidenceRecord({
    field: "target_aspect_ratio",
    expected: "9:16",
    actual: "9:16",
    evidenceSource: "https://provider.example/raw",
    verificationStage: "pre_paid",
    paidBoundary: "before_paid_action_1",
    result: HIFLY_VERIFICATION_RESULT.PROVEN
  }), { code: "HIFLY_EVIDENCE_CONTEXT_INVALID" });
  assert.throws(() => createEvidenceRecord({
    field: "target_aspect_ratio",
    expected: "9:16",
    actual: "x".repeat(129),
    evidenceSource: "hifly_dom_readback",
    verificationStage: "pre_paid",
    paidBoundary: "before_paid_action_1",
    result: HIFLY_VERIFICATION_RESULT.PROVEN
  }), { code: "HIFLY_EVIDENCE_VALUE_INVALID" });
  assert.throws(() => createEvidenceRecord({
    field: "target_aspect_ratio",
    expected: "9:16",
    actual: "9:16",
    evidenceSource: "hifly_dom_readback",
    verificationStage: "pre_paid",
    paidBoundary: "before_paid_action_1",
    result: HIFLY_VERIFICATION_RESULT.PROVEN,
    extra: "ignored"
  }), { code: "HIFLY_EVIDENCE_VALUE_INVALID" });
  const valid = createEvidenceRecord({
    field: "target_aspect_ratio",
    expected: "9:16",
    actual: "9:16",
    evidenceSource: "hifly_dom_readback",
    verificationStage: "pre_paid",
    paidBoundary: "before_paid_action_1",
    result: HIFLY_VERIFICATION_RESULT.PROVEN
  });
  assert.deepEqual(sanitizeEvidenceRecords([valid, { field: "target_aspect_ratio", actual: "raw" }]), [valid]);
  assert.throws(() => createEvidenceRecord({
    field: "voice_id", expected: "provider-id", actual: "Bearer abc123",
    evidenceSource: "hifly_ui_display", verificationStage: "pre_paid", paidBoundary: "before_paid_action_1",
    result: HIFLY_VERIFICATION_RESULT.PROVEN
  }), { code: "HIFLY_EVIDENCE_VALUE_INVALID" });
  assert.throws(() => createEvidenceRecord({
    field: "voice_id", expected: "provider-id", actual: "https://provider.example/voice",
    evidenceSource: "hifly_ui_display", verificationStage: "pre_paid", paidBoundary: "before_paid_action_1",
    result: HIFLY_VERIFICATION_RESULT.PROVEN
  }), { code: "HIFLY_EVIDENCE_VALUE_INVALID" });
  assert.equal(createEvidenceRecord({
    field: "voice_id", expected: "provider-id", actual: "voice_123",
    evidenceSource: "hifly_ui_display", verificationStage: "pre_paid", paidBoundary: "before_paid_action_1",
    result: HIFLY_VERIFICATION_RESULT.PROVEN
  }).actual, "voice_123");

  const fields = ["hands_on_product", "avatar", "product", "copy", "voice", "ui_visible_voice",
    "provider_voice_name", "submitted_voice_name", "voice_id", "tts_voice_id", "display_name", "group_id",
    "target_aspect_ratio", "handheld_aspect_ratio", "final_video_aspect_ratio", "stage1_to_stage2_dimension_behavior",
    "ui_input_copy_match"];
  const many = fields.map((field, index) => createEvidenceRecord({
    field,
    expected: ["target_aspect_ratio", "handheld_aspect_ratio", "final_video_aspect_ratio"].includes(field) ? "9:16" : "observed",
    actual: field === "target_aspect_ratio" ? "9:16"
      : ["handheld_aspect_ratio", "final_video_aspect_ratio"].includes(field) ? "1600x2848"
        : field === "ui_input_copy_match" ? true
          : ["voice_id", "tts_voice_id", "group_id"].includes(field) ? `voice-${index}` : `observed-${index}`,
    evidenceSource: "hifly_ui_display", verificationStage: "pre_paid", paidBoundary: "before_paid_action_1",
    result: HIFLY_VERIFICATION_RESULT.PROVEN
  }));
  assert.equal(HIFLY_MAX_EVIDENCE_RECORDS, 16);
  assert.equal(sanitizeEvidenceRecords(many).length, HIFLY_MAX_EVIDENCE_RECORDS);
  assert.deepEqual(sanitizeEvidenceRecords([...many, many[0]], [], { strict: true }), []);
  assert.deepEqual(sanitizeEvidenceRecords(many, [], { strict: true }), []);
});
