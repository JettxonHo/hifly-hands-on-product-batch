import assert from "node:assert/strict";
import test from "node:test";

import {
  HIFLY_HANDS_ON_PRODUCT_EVIDENCE_STATUS,
  HIFLY_HANDS_ON_PRODUCT_HISTORICAL_EVIDENCE_STATUS,
  HIFLY_PRE_PAID_REQUIREMENTS,
  HIFLY_VERIFICATION_RESULT,
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
  assert.equal(HIFLY_HANDS_ON_PRODUCT_HISTORICAL_EVIDENCE_STATUS.hands_on_product, HIFLY_VERIFICATION_RESULT.PROVEN);
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
      evidenceSource: "test_fixture",
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
    evidenceSource: "test_fixture",
    verificationStage: "pre_paid",
    paidBoundary: "before_paid_action_1",
    result: HIFLY_VERIFICATION_RESULT.PROVEN
  })] }, HIFLY_PRE_PAID_REQUIREMENTS).code, "CONTRACT_STRUCTURED_EVIDENCE_INVALID");
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
});
