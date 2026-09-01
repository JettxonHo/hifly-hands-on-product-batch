const clean = (value) => typeof value === "string" ? value.trim() : "";

export const HIFLY_VERIFICATION_RESULT = Object.freeze({
  PROVEN: "PROVEN",
  PARTIAL: "PARTIAL",
  NOT_PROVEN: "NOT_PROVEN",
  GAP: "GAP",
  FAIL: "FAIL",
  DISPROVEN: "DISPROVEN",
  NOT_CAPTURED: "NOT_CAPTURED",
  NOT_OBSERVABLE: "NOT_OBSERVABLE",
  NOT_REQUIRED: "NOT_REQUIRED",
  PASS_EXACT_MATCH: "PASS_EXACT_MATCH",
  FAIL_EXACT_MATCH: "FAIL_EXACT_MATCH"
});

const RESULT_VALUES = new Set(Object.values(HIFLY_VERIFICATION_RESULT));

export const HIFLY_HANDS_ON_PRODUCT_EVIDENCE_STATUS = Object.freeze({
  hands_on_product: HIFLY_VERIFICATION_RESULT.PROVEN,
  avatar: HIFLY_VERIFICATION_RESULT.PARTIAL,
  product: HIFLY_VERIFICATION_RESULT.PARTIAL,
  copy: HIFLY_VERIFICATION_RESULT.NOT_PROVEN,
  voice: HIFLY_VERIFICATION_RESULT.NOT_PROVEN,
  handheld_aspect_ratio: HIFLY_VERIFICATION_RESULT.NOT_PROVEN,
  final_video_aspect_ratio: HIFLY_VERIFICATION_RESULT.NOT_PROVEN,
  stage1_to_stage2_dimension_behavior: HIFLY_VERIFICATION_RESULT.NOT_PROVEN
});

const EVIDENCE_FIELDS = Object.freeze([
  "field",
  "expected",
  "actual",
  "evidence_source",
  "verification_stage",
  "paid_boundary",
  "result"
]);

const evidenceError = (code, details = null) => Object.assign(new Error(code), { code, details });

function clone(value) {
  if (value === undefined) return null;
  try {
    return structuredClone(value);
  } catch {
    throw evidenceError("HIFLY_EVIDENCE_VALUE_INVALID");
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function normalizedField(value) {
  const field = clean(value);
  if (!field) throw evidenceError("HIFLY_EVIDENCE_FIELD_REQUIRED", ["field"]);
  return field;
}

function normalizedResult(value) {
  const result = clean(value);
  if (!RESULT_VALUES.has(result)) throw evidenceError("HIFLY_EVIDENCE_RESULT_INVALID", [result]);
  return result;
}

function normalizedContext(value, name) {
  const context = clean(value);
  if (!context) throw evidenceError("HIFLY_EVIDENCE_CONTEXT_REQUIRED", [name]);
  return context;
}

function inputValue(value, snakeCaseName) {
  return value !== undefined ? value : null;
}

/**
 * Create the small, serializable evidence record shared by all production
 * gates. Values are cloned and frozen so a later UI/provider object cannot
 * mutate the recorded fact. This helper intentionally does not infer claims
 * from missing values.
 */
export function createEvidenceRecord({
  field,
  expected,
  actual,
  evidenceSource,
  evidence_source,
  verificationStage,
  verification_stage,
  paidBoundary,
  paid_boundary,
  result
} = {}) {
  const record = {
    field: normalizedField(field),
    expected: clone(inputValue(expected, "expected")),
    actual: clone(inputValue(actual, "actual")),
    evidence_source: normalizedContext(evidenceSource ?? evidence_source, "evidence_source"),
    verification_stage: normalizedContext(verificationStage ?? verification_stage, "verification_stage"),
    paid_boundary: normalizedContext(paidBoundary ?? paid_boundary, "paid_boundary"),
    result: normalizedResult(result)
  };
  return deepFreeze(record);
}

function parseAspectRatio(value) {
  const ratio = clean(value);
  const match = /^(\d+):(\d+)$/.exec(ratio);
  if (!match || Number(match[1]) < 1 || Number(match[2]) < 1) {
    throw evidenceError("HIFLY_EVIDENCE_ASPECT_RATIO_INVALID", ["expected"]);
  }
  return { ratio, numerator: Number(match[1]), denominator: Number(match[2]) };
}

/**
 * Verify dimensions observed from a generated artifact. For the RBV V1
 * target 9:16 this is deliberately the exact integer comparison
 * `width * 16 === height * 9`; no tolerance or rounding is applied.
 */
export function verifyExactAspectRatio({
  width,
  height,
  expected = "9:16",
  evidenceSource = "generated_artifact_natural_dimensions",
  verificationStage = "post_handheld_pre_video",
  paidBoundary = "after_paid_action_1_before_paid_action_2"
} = {}) {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw evidenceError("HIFLY_EVIDENCE_DIMENSIONS_INVALID", ["width", "height"]);
  }
  const parsed = parseAspectRatio(expected);
  const exact = width * parsed.denominator === height * parsed.numerator;
  const evidence = createEvidenceRecord({
    field: "aspect_ratio",
    expected: parsed.ratio,
    actual: `${width}x${height}`,
    evidenceSource,
    verificationStage,
    paidBoundary,
    result: exact ? HIFLY_VERIFICATION_RESULT.PASS_EXACT_MATCH : HIFLY_VERIFICATION_RESULT.FAIL_EXACT_MATCH
  });
  return deepFreeze({
    ...evidence,
    actual_width: width,
    actual_height: height,
    actual_aspect_ratio: `${width}:${height}`,
    exact_match: exact
  });
}

export const evaluateExactAspectRatio = verifyExactAspectRatio;

function recordLike(value) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    EVIDENCE_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function normalizeRecord(value) {
  if (!recordLike(value)) return null;
  try {
    return createEvidenceRecord(value);
  } catch {
    return null;
  }
}

/**
 * Validate a verifier response at the provider boundary. A bare boolean (or
 * an `{ ok: true }` convenience value) is intentionally not accepted: callers
 * must return field-level evidence that can be projected into a requires_action
 * result without guessing what was actually verified.
 */
export function inspectStructuredVerificationResult(value, requiredFields = []) {
  const fields = Array.from(new Set((Array.isArray(requiredFields) ? requiredFields : [])
    .map(clean).filter(Boolean)));
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value === "boolean") {
    return { valid: false, code: "CONTRACT_STRUCTURED_EVIDENCE_REQUIRED", fields };
  }

  const rawEvidence = value.evidence;
  if (!Array.isArray(rawEvidence)) {
    return { valid: false, code: "CONTRACT_STRUCTURED_EVIDENCE_REQUIRED", fields };
  }
  const evidence = rawEvidence.map(normalizeRecord);
  if (evidence.some((record) => !record)) {
    return { valid: false, code: "CONTRACT_STRUCTURED_EVIDENCE_INVALID", fields };
  }

  const missingFields = fields.filter((field) => !evidence.some((record) => record.field === field));
  if (missingFields.length) {
    return { valid: false, code: "CONTRACT_STRUCTURED_EVIDENCE_INCOMPLETE", fields: missingFields, evidence };
  }

  const status = clean(value.status || value.outcome || (value.verified === true ? "verified" : ""));
  const verified = ["verified", "passed", "succeeded"].includes(status) || value.result === HIFLY_VERIFICATION_RESULT.PROVEN;
  const failedEvidence = evidence.filter((record) => ![
    HIFLY_VERIFICATION_RESULT.PROVEN,
    HIFLY_VERIFICATION_RESULT.PASS_EXACT_MATCH,
    HIFLY_VERIFICATION_RESULT.NOT_REQUIRED
  ].includes(record.result));
  if (!verified || failedEvidence.length) {
    return {
      valid: false,
      code: "CONTRACT_STRUCTURED_EVIDENCE_NOT_VERIFIED",
      fields: failedEvidence.length ? failedEvidence.map((record) => record.field) : fields,
      evidence,
      status: status || null
    };
  }
  return { valid: true, status, evidence, fields };
}

export function requireStructuredVerificationResult(value, requiredFields = []) {
  const inspected = inspectStructuredVerificationResult(value, requiredFields);
  if (!inspected.valid) throw evidenceError(inspected.code, inspected.fields || requiredFields);
  return deepFreeze(inspected);
}

export function buildHiflyHandsOnProductEvidenceStatus(overrides = {}) {
  const source = overrides && typeof overrides === "object" && !Array.isArray(overrides) ? overrides : {};
  return deepFreeze({ ...HIFLY_HANDS_ON_PRODUCT_EVIDENCE_STATUS, ...source });
}

/**
 * Apply the FAST-MVP product gate. Fine-print unreadability is represented as
 * NOT_OBSERVABLE/NOT_REQUIRED and is not a hard block. Only consumer-visible
 * identity/corruption failures listed by the contract can block the route.
 */
export function evaluateProductFidelity({
  productPresent = null,
  productIdentity = null,
  majorShape = null,
  majorColor = null,
  grossVisualCorruption = false,
  wrongSubstitution = false,
  consumerVisibleContradiction = false,
  finePrintObservable = false,
  finePrintMatches = null
} = {}) {
  const hardBlock = productPresent === false || productIdentity === false || majorShape === false ||
    majorColor === false || grossVisualCorruption === true || wrongSubstitution === true ||
    consumerVisibleContradiction === true;
  const result = hardBlock
    ? HIFLY_VERIFICATION_RESULT.FAIL
    : productPresent === true && productIdentity === true && majorShape !== false && majorColor !== false
      ? HIFLY_VERIFICATION_RESULT.PROVEN
      : HIFLY_VERIFICATION_RESULT.PARTIAL;
  const finePrintResult = finePrintObservable
    ? finePrintMatches === true ? HIFLY_VERIFICATION_RESULT.PROVEN
      : finePrintMatches === false ? HIFLY_VERIFICATION_RESULT.FAIL
        : HIFLY_VERIFICATION_RESULT.NOT_OBSERVABLE
    : HIFLY_VERIFICATION_RESULT.NOT_REQUIRED;
  return deepFreeze({
    result,
    hard_block: hardBlock,
    fine_print_result: finePrintResult,
    evidence: [
      createEvidenceRecord({ field: "product_fidelity", expected: "consumer_visible_identity", actual: { productPresent, productIdentity, majorShape, majorColor }, evidenceSource: "operator_or_output_observation", verificationStage: "post_output_qc", paidBoundary: "after_paid_action_2", result }),
      createEvidenceRecord({ field: "fine_print_fidelity", expected: "consumer_readable_only", actual: finePrintObservable ? finePrintMatches : null, evidenceSource: "operator_or_output_observation", verificationStage: "post_output_qc", paidBoundary: "after_paid_action_2", result: finePrintResult })
    ]
  });
}

export const buildProductionEvidenceRecord = createEvidenceRecord;
export const createHiflyProductionEvidenceRecord = createEvidenceRecord;
