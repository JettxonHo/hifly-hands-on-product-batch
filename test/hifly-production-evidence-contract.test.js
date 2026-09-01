import assert from "node:assert/strict";
import test from "node:test";

import {
  HIFLY_HANDS_ON_PRODUCT_EVIDENCE_STATUS,
  HIFLY_VERIFICATION_RESULT,
  buildHiflyHandsOnProductEvidenceStatus,
  createEvidenceRecord,
  evaluateProductFidelity,
  inspectStructuredVerificationResult,
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

  assert.equal(evidence.field, "aspect_ratio");
  assert.equal(evidence.expected, "9:16");
  assert.equal(evidence.actual_width, 1600);
  assert.equal(evidence.actual_height, 2848);
  assert.equal(evidence.actual, "1600x2848");
  assert.equal(evidence.evidence_source, "generated_artifact_natural_dimensions");
  assert.equal(evidence.verification_stage, "post_handheld_pre_video");
  assert.equal(evidence.paid_boundary, "after_paid_action_1_before_paid_action_2");
  assert.equal(evidence.result, HIFLY_VERIFICATION_RESULT.FAIL_EXACT_MATCH);
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
  const fidelity = evaluateProductFidelity({
    productPresent: true,
    productIdentity: true,
    majorShape: true,
    majorColor: true,
    finePrintObservable: false,
    finePrintMatches: false
  });
  assert.equal(fidelity.result, HIFLY_VERIFICATION_RESULT.PROVEN);
  assert.equal(fidelity.hard_block, false);
  assert.equal(fidelity.fine_print_result, HIFLY_VERIFICATION_RESULT.NOT_REQUIRED);
});

test("structured verifier inspection rejects booleans and requires every requested field", () => {
  assert.equal(inspectStructuredVerificationResult(true, ["aspect_ratio"]).code, "CONTRACT_STRUCTURED_EVIDENCE_REQUIRED");
  const partial = inspectStructuredVerificationResult({
    status: "verified",
    evidence: [createEvidenceRecord({
      field: "aspect_ratio",
      expected: "9:16",
      actual: "9:16",
      evidenceSource: "test_fixture",
      verificationStage: "pre_paid",
      paidBoundary: "before_paid_action_1",
      result: HIFLY_VERIFICATION_RESULT.PROVEN
    })]
  }, ["aspect_ratio", "voice_source"]);
  assert.equal(partial.code, "CONTRACT_STRUCTURED_EVIDENCE_INCOMPLETE");
  assert.deepEqual(partial.fields, ["voice_source"]);
});
