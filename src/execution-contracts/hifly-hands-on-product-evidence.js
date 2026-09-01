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

export const HIFLY_ASPECT_RATIO_ENFORCEMENT = Object.freeze({
  RECORD_ONLY: "record_only",
  REQUIRE_EXACT: "require_exact"
});

const RESULT_VALUES = new Set(Object.values(HIFLY_VERIFICATION_RESULT));

export const HIFLY_HANDS_ON_PRODUCT_EVIDENCE_STATUS = Object.freeze({
  hands_on_product: HIFLY_VERIFICATION_RESULT.NOT_PROVEN,
  avatar: HIFLY_VERIFICATION_RESULT.NOT_PROVEN,
  product: HIFLY_VERIFICATION_RESULT.NOT_PROVEN,
  copy: HIFLY_VERIFICATION_RESULT.NOT_PROVEN,
  voice: HIFLY_VERIFICATION_RESULT.NOT_PROVEN,
  ui_visible_voice: HIFLY_VERIFICATION_RESULT.NOT_CAPTURED,
  voice_id: HIFLY_VERIFICATION_RESULT.NOT_CAPTURED,
  tts_voice_id: HIFLY_VERIFICATION_RESULT.NOT_CAPTURED,
  provider_voice_name: HIFLY_VERIFICATION_RESULT.NOT_CAPTURED,
  submitted_voice_name: HIFLY_VERIFICATION_RESULT.NOT_CAPTURED,
  display_name: HIFLY_VERIFICATION_RESULT.NOT_CAPTURED,
  group_id: HIFLY_VERIFICATION_RESULT.NOT_CAPTURED,
  ui_input_copy_match: HIFLY_VERIFICATION_RESULT.NOT_PROVEN,
  final_audio_copy_correspondence: HIFLY_VERIFICATION_RESULT.NOT_PROVEN,
  target_aspect_ratio: HIFLY_VERIFICATION_RESULT.NOT_PROVEN,
  handheld_aspect_ratio: HIFLY_VERIFICATION_RESULT.NOT_PROVEN,
  final_video_aspect_ratio: HIFLY_VERIFICATION_RESULT.NOT_PROVEN,
  stage1_to_stage2_dimension_behavior: HIFLY_VERIFICATION_RESULT.NOT_PROVEN
});

export const HIFLY_HANDS_ON_PRODUCT_HISTORICAL_EVIDENCE_STATUS = Object.freeze({
  ...HIFLY_HANDS_ON_PRODUCT_EVIDENCE_STATUS,
  hands_on_product: HIFLY_VERIFICATION_RESULT.PROVEN,
  avatar: HIFLY_VERIFICATION_RESULT.PARTIAL,
  product: HIFLY_VERIFICATION_RESULT.PARTIAL,
  ui_input_copy_match: HIFLY_VERIFICATION_RESULT.PROVEN,
  handheld_aspect_ratio: HIFLY_VERIFICATION_RESULT.DISPROVEN,
  ui_visible_voice: HIFLY_VERIFICATION_RESULT.PARTIAL
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

const EVIDENCE_INPUT_FIELDS = new Set([
  ...EVIDENCE_FIELDS,
  "evidenceSource",
  "verificationStage",
  "paidBoundary"
]);

const CONTROLLED_FIELDS = new Set([
  "hands_on_product",
  "avatar",
  "product",
  "copy",
  "voice",
  "ui_visible_voice",
  "voice_source",
  "voice_id",
  "tts_voice_id",
  "provider_voice_name",
  "submitted_voice_name",
  "display_name",
  "group_id",
  "target_aspect_ratio",
  "handheld_aspect_ratio",
  "final_video_aspect_ratio",
  "stage1_to_stage2_dimension_behavior",
  "ui_input_copy_match",
  "final_audio_copy_correspondence",
  "product_fidelity",
  "fine_print_fidelity",
  "product_presence",
  "product_identity",
  "major_shape",
  "major_color"
]);

const CONTROLLED_SOURCES = new Set([
  "production_contract",
  "hifly_dom_readback",
  "hifly_network_response",
  "hifly_ui_display",
  "generated_artifact_natural_dimensions",
  "generated_artifact_natural_dimensions_unavailable",
  "operator_or_output_observation",
  "historical_run",
  "not_captured",
  "test_fixture"
]);

const CONTROLLED_STAGES = new Set([
  "pre_paid",
  "pre_point",
  "post_handheld_pre_video",
  "post_final_video",
  "post_output_qc",
  "historical_run"
]);

const CONTROLLED_PAID_BOUNDARIES = new Set([
  "not_paid",
  "before_paid_action_1",
  "after_paid_action_1_before_paid_action_2",
  "after_paid_action_2",
  "historical_run"
]);
export const HIFLY_MAX_EVIDENCE_RECORDS = 16;
const OPAQUE_VOICE_ID_FIELDS = new Set(["voice_id", "tts_voice_id", "group_id"]);
const VOICE_NAME_FIELDS = new Set(["provider_voice_name", "submitted_voice_name"]);

function normalizeRequiredFields(value) {
  const requested = Array.isArray(value)
    ? value
    : value && typeof value === "object" ? Object.keys(value) : [];
  const recognized = Array.from(new Set(requested.map(clean).filter((field) => CONTROLLED_FIELDS.has(field))));
  // Error details can originate at an untrusted verifier boundary. Never let
  // an unknown field become an evidence record; fall back to the narrow
  // pre-paid contract instead so the caller receives a deterministic stop.
  const fields = recognized.length || requested.length === 0
    ? recognized.length ? recognized : Object.keys(HIFLY_PRE_PAID_REQUIREMENTS)
    : Object.keys(HIFLY_PRE_PAID_REQUIREMENTS);
  return fields.slice(0, HIFLY_MAX_EVIDENCE_RECORDS);
}

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

export const HIFLY_PRE_PAID_REQUIREMENTS = deepFreeze({
  target_aspect_ratio: {
    expected: "9:16",
    actual_shape: "exact_aspect_ratio",
    verification_stage: "pre_paid",
    paid_boundary: "before_paid_action_1",
    allowed_sources: ["production_contract", "hifly_dom_readback", "hifly_network_response"],
    allowed_results: [HIFLY_VERIFICATION_RESULT.PROVEN]
  },
  voice_source: {
    expected: "hifly_native",
    actual_shape: "voice_source",
    verification_stage: "pre_paid",
    paid_boundary: "before_paid_action_1",
    allowed_sources: ["production_contract", "hifly_dom_readback", "hifly_network_response", "hifly_ui_display"],
    allowed_results: [HIFLY_VERIFICATION_RESULT.PROVEN, HIFLY_VERIFICATION_RESULT.PARTIAL]
  }
});

export const HIFLY_STRUCTURED_VERIFICATION_ERROR_CODES = Object.freeze([
  "CONTRACT_FIELD_NOT_MACHINE_VERIFIABLE",
  "CONTRACT_STRUCTURED_EVIDENCE_REQUIRED",
  "CONTRACT_STRUCTURED_EVIDENCE_INVALID",
  "CONTRACT_STRUCTURED_EVIDENCE_INCOMPLETE",
  "CONTRACT_STRUCTURED_EVIDENCE_DUPLICATE",
  "CONTRACT_STRUCTURED_EVIDENCE_CONTEXT_MISMATCH",
  "CONTRACT_STRUCTURED_EVIDENCE_EXPECTED_MISMATCH",
  "CONTRACT_STRUCTURED_EVIDENCE_VALUE_INVALID",
  "CONTRACT_STRUCTURED_EVIDENCE_RESULT_NOT_ALLOWED",
  "CONTRACT_STRUCTURED_EVIDENCE_NOT_VERIFIED"
]);

export function buildUnavailableEvidence(fields = Object.keys(HIFLY_PRE_PAID_REQUIREMENTS)) {
  const required = normalizeRequiredFields(fields);
  return required.map((field) => createEvidenceRecord({
    field,
    expected: HIFLY_PRE_PAID_REQUIREMENTS[field]?.expected ?? null,
    actual: null,
    evidenceSource: "not_captured",
    verificationStage: "pre_paid",
    paidBoundary: "before_paid_action_1",
    result: HIFLY_VERIFICATION_RESULT.NOT_PROVEN
  }));
}

function normalizedField(value) {
  const field = clean(value);
  if (!field) throw evidenceError("HIFLY_EVIDENCE_FIELD_REQUIRED", ["field"]);
  if (!CONTROLLED_FIELDS.has(field)) throw evidenceError("HIFLY_EVIDENCE_FIELD_INVALID", [field]);
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
  const allowed = name === "evidence_source" ? CONTROLLED_SOURCES
    : name === "verification_stage" ? CONTROLLED_STAGES : CONTROLLED_PAID_BOUNDARIES;
  if (!allowed.has(context)) throw evidenceError("HIFLY_EVIDENCE_CONTEXT_INVALID", [name, context]);
  return context;
}

function boundedText(value, field, side) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > 128 || /[\u0000-\u001f\u007f]/.test(text) ||
    /(?:[a-z][a-z0-9+.-]*:\/\/|(?:^|[\\/])(?:Users|private|tmp|var|home)(?:[\\/]|$)|(?:token|cookie|secret|password|authorization)\s*=|^Bearer\s+)/i.test(text)) {
    throw evidenceError("HIFLY_EVIDENCE_VALUE_INVALID", [field, side]);
  }
  return text;
}

function boundedOptionalText(value, field, side) {
  const text = typeof value === "string" ? value.trim() : "";
  if (typeof value !== "string" || text.length > 128 || /[\u0000-\u001f\u007f]/.test(text) ||
    /(?:[a-z][a-z0-9+.-]*:\/\/|(?:^|[\\/])(?:Users|private|tmp|var|home)(?:[\\/]|$)|(?:token|cookie|secret|password|authorization)\s*=|^Bearer\s+)/i.test(text)) {
    throw evidenceError("HIFLY_EVIDENCE_VALUE_INVALID", [field, side]);
  }
  return text;
}

function isRatioString(value) {
  try {
    parseAspectRatio(value);
    return true;
  } catch {
    return false;
  }
}

function isDimensionString(value) {
  const match = typeof value === "string" && /^(\d+)x(\d+)$/.exec(value);
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0;
}

function boundedScalar(value, field, side) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw evidenceError("HIFLY_EVIDENCE_VALUE_INVALID", [field, side]);
    return value;
  }
  if (typeof value === "string") {
    return boundedText(value, field, side);
  }
  if (Array.isArray(value)) throw evidenceError("HIFLY_EVIDENCE_VALUE_INVALID", [field, side]);
  if (value && typeof value === "object") {
    if (field === "product_fidelity") {
      const allowed = new Set(["productPresent", "productIdentity", "majorShape", "majorColor",
        "grossVisualCorruption", "wrongSubstitution", "consumerVisibleContradiction"]);
      const keys = Object.keys(value);
      if (keys.some((key) => !allowed.has(key)) || keys.some((key) => value[key] !== null && typeof value[key] !== "boolean")) {
        throw evidenceError("HIFLY_EVIDENCE_VALUE_INVALID", [field, side]);
      }
      return { ...value };
    }
    if (field === "voice_source") {
      const allowed = new Set(["source", "display", "group", "style"]);
      const keys = Object.keys(value);
      if (!keys.length || keys.some((key) => !allowed.has(key)) ||
        keys.some((key) => value[key] !== null && (typeof value[key] !== "string" ||
          (() => { try { boundedOptionalText(value[key], field, side); return false; } catch { return true; } })()))) {
        throw evidenceError("HIFLY_EVIDENCE_VALUE_INVALID", [field, side]);
      }
      return Object.fromEntries(keys.map((key) => [key, value[key] === null ? null : boundedOptionalText(value[key], field, side)]));
    }
    throw evidenceError("HIFLY_EVIDENCE_VALUE_INVALID", [field, side]);
  }
  throw evidenceError("HIFLY_EVIDENCE_VALUE_INVALID", [field, side]);
}

function fieldValue(value, field, side) {
  const bounded = boundedScalar(value, field, side);
  if (bounded === null) return null;
  const ratioField = ["target_aspect_ratio", "handheld_aspect_ratio", "final_video_aspect_ratio"].includes(field);
  if (ratioField && side === "expected" && (typeof bounded !== "string" || !isRatioString(bounded))) {
    throw evidenceError("HIFLY_EVIDENCE_VALUE_INVALID", [field, side]);
  }
  if (field === "target_aspect_ratio" && side === "actual" &&
    (typeof bounded !== "string" || !isRatioString(bounded))) {
    throw evidenceError("HIFLY_EVIDENCE_VALUE_INVALID", [field, side]);
  }
  if (field === "handheld_aspect_ratio" && side === "actual" &&
    (typeof bounded !== "string" || !isDimensionString(bounded))) {
    throw evidenceError("HIFLY_EVIDENCE_VALUE_INVALID", [field, side]);
  }
  if (field === "final_video_aspect_ratio" && side === "actual" && typeof bounded === "string" &&
    !isRatioString(bounded) && !isDimensionString(bounded)) {
    throw evidenceError("HIFLY_EVIDENCE_VALUE_INVALID", [field, side]);
  }
  if (OPAQUE_VOICE_ID_FIELDS.has(field) &&
    (typeof bounded !== "string" || !/^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,127}$/u.test(bounded))) {
    throw evidenceError("HIFLY_EVIDENCE_VALUE_INVALID", [field, side]);
  }
  if (VOICE_NAME_FIELDS.has(field) && typeof bounded !== "string") {
    throw evidenceError("HIFLY_EVIDENCE_VALUE_INVALID", [field, side]);
  }
  if (["product_presence", "product_identity", "major_shape", "major_color", "fine_print_fidelity",
    "ui_input_copy_match", "final_audio_copy_correspondence"].includes(field) && side === "actual" &&
    typeof bounded !== "boolean") {
    throw evidenceError("HIFLY_EVIDENCE_VALUE_INVALID", [field, side]);
  }
  return bounded;
}

/**
 * Create the small, serializable evidence record shared by all production
 * gates. Values are cloned and frozen so a later UI/provider object cannot
 * mutate the recorded fact. This helper intentionally does not infer claims
 * from missing values.
 */
export function createEvidenceRecord(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw evidenceError("HIFLY_EVIDENCE_VALUE_INVALID");
  }
  const unknown = Object.keys(input).filter((key) => !EVIDENCE_INPUT_FIELDS.has(key));
  if (unknown.length) throw evidenceError("HIFLY_EVIDENCE_VALUE_INVALID", [unknown[0]]);
  const {
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
  } = input;
  const record = {
    field: normalizedField(field),
    expected: clone(fieldValue(expected, normalizedField(field), "expected")),
    actual: clone(fieldValue(actual, normalizedField(field), "actual")),
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
  if (!match || !Number.isSafeInteger(Number(match[1])) || !Number.isSafeInteger(Number(match[2])) ||
    Number(match[1]) < 1 || Number(match[2]) < 1) {
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
  enforcementPolicy = null,
  field = "handheld_aspect_ratio",
  evidenceSource = "generated_artifact_natural_dimensions",
  verificationStage = "post_handheld_pre_video",
  paidBoundary = "after_paid_action_1_before_paid_action_2"
} = {}) {
  if (!Number.isSafeInteger(width) || width < 1 || !Number.isSafeInteger(height) || height < 1) {
    throw evidenceError("HIFLY_EVIDENCE_DIMENSIONS_INVALID", ["width", "height"]);
  }
  const parsed = parseAspectRatio(expected);
  const left = width * parsed.denominator;
  const right = height * parsed.numerator;
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    throw evidenceError("HIFLY_EVIDENCE_RATIO_OVERFLOW", ["width", "height"]);
  }
  const exact = left === right;
  let enforcement = HIFLY_ASPECT_RATIO_ENFORCEMENT.RECORD_ONLY;
  if (enforcementPolicy !== null && enforcementPolicy !== undefined) {
    if (!enforcementPolicy || typeof enforcementPolicy !== "object" || Array.isArray(enforcementPolicy) ||
      !Object.isFrozen(enforcementPolicy)) {
      throw evidenceError("HIFLY_EVIDENCE_ENFORCEMENT_POLICY_NOT_IMMUTABLE", ["enforcementPolicy"]);
    }
    const policyKeys = Object.keys(enforcementPolicy);
    if (policyKeys.some((key) => !["handheld_aspect_ratio", "handheld_aspect_ratio_policy"].includes(key))) {
      throw evidenceError("HIFLY_EVIDENCE_ENFORCEMENT_POLICY_INVALID", ["enforcementPolicy"]);
    }
    enforcement = clean(enforcementPolicy.handheld_aspect_ratio || enforcementPolicy.handheld_aspect_ratio_policy);
    if (!Object.values(HIFLY_ASPECT_RATIO_ENFORCEMENT).includes(enforcement)) {
      throw evidenceError("HIFLY_EVIDENCE_ENFORCEMENT_POLICY_INVALID", ["enforcementPolicy.handheld_aspect_ratio"]);
    }
  }
  const requiresAction = !exact && enforcement === HIFLY_ASPECT_RATIO_ENFORCEMENT.REQUIRE_EXACT;
  const evidence = createEvidenceRecord({
    field,
    expected: parsed.ratio,
    actual: `${width}x${height}`,
    evidenceSource,
    verificationStage,
    paidBoundary,
    result: exact ? HIFLY_VERIFICATION_RESULT.PASS_EXACT_MATCH : HIFLY_VERIFICATION_RESULT.FAIL_EXACT_MATCH
  });
  return deepFreeze({
    ...evidence,
    target_aspect_ratio: parsed.ratio,
    actual_width: width,
    actual_height: height,
    actual_aspect_ratio: `${width}:${height}`,
    exact_match: exact,
    enforcement,
    requires_action: requiresAction
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
    // Project before validation so rich internal ratio results (dimensions,
    // enforcement flags) cannot leak into persisted/report evidence.
    return createEvidenceRecord(Object.fromEntries(EVIDENCE_FIELDS.map((field) => [field, value[field]])));
  } catch {
    return null;
  }
}

function requirementList(value) {
  if (Array.isArray(value)) {
    return Array.from(new Set(value.map(clean).filter(Boolean))).map((field) => ({ field }));
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).map(([field, requirement]) => ({
    field,
    expected: requirement?.expected,
    actual_shape: requirement?.actual_shape ?? requirement?.actualShape,
    verification_stage: requirement?.verification_stage,
    paid_boundary: requirement?.paid_boundary,
    allowed_sources: requirement?.allowed_sources,
    allowed_results: requirement?.allowed_results
  }));
}

function equalValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function voiceActualMatches(record, requirement) {
  const partial = record.result === HIFLY_VERIFICATION_RESULT.PARTIAL &&
    requirement.allowed_results?.includes(HIFLY_VERIFICATION_RESULT.PARTIAL);
  if (typeof record.actual === "string") return record.actual === requirement.expected;
  if (!record.actual || typeof record.actual !== "object" || Array.isArray(record.actual)) return false;
  const source = record.actual.source;
  const uiFields = [record.actual.display, record.actual.group, record.actual.style];
  const hasSource = typeof source === "string" && source.length > 0;
  const hasUiState = uiFields.some((value) => typeof value === "string" && value.length > 0);
  const sourceMatches = source === null || source === undefined || source === requirement.expected;
  return sourceMatches && (hasSource || hasUiState) && (partial || source === requirement.expected);
}

function requirementActualMatches(record, requirement) {
  if (!Object.hasOwn(requirement, "expected")) return true;
  if (record.actual === null || record.actual === undefined) return false;
  if (requirement.actual_shape === "exact_aspect_ratio" || record.field === "target_aspect_ratio") {
    return typeof record.actual === "string" && isRatioString(record.actual) && record.actual === requirement.expected;
  }
  if (requirement.actual_shape === "voice_source" || record.field === "voice_source") return voiceActualMatches(record, requirement);
  return true;
}

function requirementContextMatches(record, requirement) {
  if (Array.isArray(requirement.allowed_sources) && !requirement.allowed_sources.includes(record.evidence_source)) return false;
  if (requirement.verification_stage && record.verification_stage !== requirement.verification_stage) return false;
  if (requirement.paid_boundary && record.paid_boundary !== requirement.paid_boundary) return false;
  return true;
}

export function sanitizeEvidenceRecords(value, requiredFields = [], options = {}) {
  const strict = options?.strict === true;
  const dedupe = options?.dedupe !== false;
  if (!Array.isArray(value) || value.length > HIFLY_MAX_EVIDENCE_RECORDS && strict) return [];
  const normalized = Array.isArray(value) ? value.map(normalizeRecord) : [];
  if (strict && normalized.some((record) => !record)) return [];
  const records = normalized.filter(Boolean);
  const required = Array.isArray(requiredFields) ? requiredFields.map(clean).filter(Boolean) : Object.keys(requiredFields || {});
  const filtered = records.filter((record) => !required.length || required.includes(record.field));
  if (!dedupe) return filtered.slice(0, HIFLY_MAX_EVIDENCE_RECORDS);
  const seen = new Set();
  const unique = [];
  for (const record of filtered) {
    if (seen.has(record.field)) {
      if (strict) return [];
      continue;
    }
    seen.add(record.field);
    unique.push(record);
  }
  return unique.slice(0, HIFLY_MAX_EVIDENCE_RECORDS);
}

export function completeEvidenceForFields(value, fields = Object.keys(HIFLY_PRE_PAID_REQUIREMENTS)) {
  const required = normalizeRequiredFields(fields);
  const safe = sanitizeEvidenceRecords(value, required);
  const unavailable = buildUnavailableEvidence(required);
  return required.map((field, index) => safe.find((record) => record.field === field) || unavailable[index]);
}

/**
 * Validate a verifier response at the provider boundary. A bare boolean (or
 * an `{ ok: true }` convenience value) is intentionally not accepted: callers
 * must return field-level evidence that can be projected into a requires_action
 * result without guessing what was actually verified.
 */
export function inspectStructuredVerificationResult(value, requiredFields = []) {
  const requirements = requirementList(requiredFields);
  const fields = requirements.map((requirement) => requirement.field);
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value === "boolean") {
    return { valid: false, code: "CONTRACT_STRUCTURED_EVIDENCE_REQUIRED", fields };
  }

  const rawEvidence = value.evidence;
  if (!Array.isArray(rawEvidence)) {
    return { valid: false, code: "CONTRACT_STRUCTURED_EVIDENCE_REQUIRED", fields };
  }
  const evidence = sanitizeEvidenceRecords(rawEvidence, [], { dedupe: false });
  if (evidence.length !== rawEvidence.length) {
    return { valid: false, code: "CONTRACT_STRUCTURED_EVIDENCE_INVALID", fields };
  }

  const extraFields = fields.length ? evidence.filter((record) => !fields.includes(record.field)) : [];
  if (extraFields.length) {
    return {
      valid: false,
      code: "CONTRACT_STRUCTURED_EVIDENCE_INVALID",
      fields: extraFields.map((record) => record.field),
      evidence
    };
  }

  const duplicateFields = fields.filter((field) => evidence.filter((record) => record.field === field).length > 1);
  if (duplicateFields.length) {
    return { valid: false, code: "CONTRACT_STRUCTURED_EVIDENCE_DUPLICATE", fields: duplicateFields, evidence };
  }
  const missingFields = fields.filter((field) => !evidence.some((record) => record.field === field));
  if (missingFields.length) {
    return { valid: false, code: "CONTRACT_STRUCTURED_EVIDENCE_INCOMPLETE", fields: missingFields, evidence };
  }

  const status = clean(value.status || value.outcome || (value.verified === true ? "verified" : ""));
  const explicitlyFailed = value.verified === false || ["failed", "error", "timeout", "unverified", "rejected"].includes(status);
  const verified = !explicitlyFailed && (["verified", "passed", "succeeded"].includes(status) || value.result === HIFLY_VERIFICATION_RESULT.PROVEN);
  const contextMismatch = requirements.filter((requirement) => {
    const record = evidence.find((candidate) => candidate.field === requirement.field);
    return record && !requirementContextMatches(record, requirement);
  });
  if (contextMismatch.length) {
    return {
      valid: false,
      code: "CONTRACT_STRUCTURED_EVIDENCE_CONTEXT_MISMATCH",
      fields: contextMismatch.map((requirement) => requirement.field),
      evidence,
      status: status || null
    };
  }
  const expectedMismatch = requirements.filter((requirement) => {
    const record = evidence.find((candidate) => candidate.field === requirement.field);
    return record && Object.hasOwn(requirement, "expected") && !equalValue(record.expected, requirement.expected);
  });
  if (expectedMismatch.length) {
    return {
      valid: false,
      code: "CONTRACT_STRUCTURED_EVIDENCE_EXPECTED_MISMATCH",
      fields: expectedMismatch.map((requirement) => requirement.field),
      evidence,
      status: status || null
    };
  }
  const shapeMismatch = requirements.filter((requirement) => {
    const record = evidence.find((candidate) => candidate.field === requirement.field);
    return record && !requirementActualMatches(record, requirement);
  });
  if (shapeMismatch.length) {
    return {
      valid: false,
      code: "CONTRACT_STRUCTURED_EVIDENCE_VALUE_INVALID",
      fields: shapeMismatch.map((requirement) => requirement.field),
      evidence,
      status: status || null
    };
  }
  const disallowedResults = requirements.filter((requirement) => {
    const record = evidence.find((candidate) => candidate.field === requirement.field);
    const allowed = requirement.allowed_results || [HIFLY_VERIFICATION_RESULT.PROVEN, HIFLY_VERIFICATION_RESULT.PASS_EXACT_MATCH];
    return record && !allowed.includes(record.result);
  });
  if (disallowedResults.length) {
    return {
      valid: false,
      code: "CONTRACT_STRUCTURED_EVIDENCE_RESULT_NOT_ALLOWED",
      fields: disallowedResults.map((requirement) => requirement.field),
      evidence,
      status: status || null
    };
  }
  if (!verified) {
    return {
      valid: false,
      code: "CONTRACT_STRUCTURED_EVIDENCE_NOT_VERIFIED",
      fields,
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

export function buildHiflyHandsOnProductEvidenceStatus() {
  return deepFreeze({ ...HIFLY_HANDS_ON_PRODUCT_EVIDENCE_STATUS });
}

export function buildHistoricalHiflyHandsOnProductEvidenceStatus() {
  return deepFreeze({ ...HIFLY_HANDS_ON_PRODUCT_HISTORICAL_EVIDENCE_STATUS });
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
  grossVisualCorruption = null,
  wrongSubstitution = null,
  consumerVisibleContradiction = null,
  finePrintObservable = false,
  finePrintMatches = null
} = {}) {
  const hardBlock = productPresent === false || productIdentity === false || majorShape === false ||
    majorColor === false || grossVisualCorruption === true || wrongSubstitution === true ||
    consumerVisibleContradiction === true;
  const result = hardBlock
    ? HIFLY_VERIFICATION_RESULT.FAIL
    : productPresent === true && productIdentity === true && majorShape === true && majorColor === true &&
      grossVisualCorruption === false && wrongSubstitution === false && consumerVisibleContradiction === false
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
      createEvidenceRecord({ field: "product_fidelity", expected: "consumer_visible_identity", actual: {
        productPresent, productIdentity, majorShape, majorColor, grossVisualCorruption,
        wrongSubstitution, consumerVisibleContradiction
      }, evidenceSource: "operator_or_output_observation", verificationStage: "post_output_qc", paidBoundary: "after_paid_action_2", result }),
      createEvidenceRecord({ field: "fine_print_fidelity", expected: "consumer_readable_only", actual: finePrintObservable ? finePrintMatches : null, evidenceSource: "operator_or_output_observation", verificationStage: "post_output_qc", paidBoundary: "after_paid_action_2", result: finePrintResult })
    ]
  });
}

export const buildProductionEvidenceRecord = createEvidenceRecord;
export const createHiflyProductionEvidenceRecord = createEvidenceRecord;
