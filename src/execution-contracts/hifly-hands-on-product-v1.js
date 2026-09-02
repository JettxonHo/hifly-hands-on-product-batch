import { createHash } from "node:crypto";

export const HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_ID = "HIFLY_HANDS_ON_PRODUCT_V1";
export const HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_VERSION = "1";

export const HIFLY_HANDS_ON_PRODUCT_V1_PRODUCTION = Object.freeze({
  mode: "hands_on_product",
  target_aspect_ratio: "9:16",
  handheld_aspect_ratio_policy: "record_only",
  voice_source: "hifly_native",
  voice_identity_policy: "ui_visible_state_allowed",
  scene_mode: "single_scene",
  camera_mode: "fixed_simple",
  presentation_size_code: "smart_fit",
  b_roll: false,
  additional_characters: false,
  external_tts: false,
  standalone_lipsync: false,
  copy_ai_generation: false
});

const SHA256 = /^[a-f0-9]{64}$/;
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES = Object.freeze({
  REQUIRED: "HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_REQUIRED",
  INVALID: "HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_INVALID",
  VERSION_UNSUPPORTED: "HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_VERSION_UNSUPPORTED",
  PLAN_INVALID: "HIFLY_HANDS_ON_PRODUCT_V1_PLAN_INVALID",
  COPY_REQUIRED: "HIFLY_HANDS_ON_PRODUCT_V1_COPY_REQUIRED",
  COPY_INVALID: "HIFLY_HANDS_ON_PRODUCT_V1_COPY_INVALID",
  PRODUCT_INVALID: "HIFLY_HANDS_ON_PRODUCT_V1_PRODUCT_INVALID",
  AVATAR_INVALID: "HIFLY_HANDS_ON_PRODUCT_V1_AVATAR_INVALID",
  MODE_INVALID: "HIFLY_HANDS_ON_PRODUCT_V1_MODE_INVALID",
  ASPECT_RATIO_INVALID: "HIFLY_HANDS_ON_PRODUCT_V1_ASPECT_RATIO_INVALID",
  HANDHELD_RATIO_POLICY_INVALID: "HIFLY_HANDS_ON_PRODUCT_V1_HANDHELD_RATIO_POLICY_INVALID",
  VOICE_SOURCE_INVALID: "HIFLY_HANDS_ON_PRODUCT_V1_VOICE_SOURCE_INVALID",
  PRESENTATION_SIZE_INVALID: "HIFLY_HANDS_ON_PRODUCT_V1_PRESENTATION_SIZE_INVALID",
  BINDING_MISMATCH: "HIFLY_HANDS_ON_PRODUCT_V1_BINDING_MISMATCH"
});

const fail = (code, details = null) => Object.assign(new Error(code), { code, details });
const clean = (value) => typeof value === "string" ? value.trim() : "";
const HANDHELD_RATIO_POLICIES = new Set(["record_only", "require_exact"]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function requiredId(value, field, code) {
  const result = clean(value);
  if (!result) throw fail(code, [field]);
  return result;
}

function checksum(value, field, code) {
  const result = clean(value).toLowerCase();
  if (!SHA256.test(result)) throw fail(code, [field]);
  return result;
}

function verifiedMedia(value, field, code) {
  const mediaType = clean(value);
  if (!MEDIA_TYPES.has(mediaType)) throw fail(code, [field]);
  return mediaType;
}

function verifiedSize(value, field, code) {
  if (!Number.isInteger(value) || value < 1) throw fail(code, [field]);
  return value;
}

function normalizeBindings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const plan = source.plan || {};
  const product = source.product || {};
  const copy = source.copy || {};
  const avatar = source.avatar || {};
  return {
    plan: {
      video_plan_version_id: clean(plan.video_plan_version_id),
      plan_review_id: clean(plan.plan_review_id)
    },
    product: {
      revision_id: clean(product.revision_id),
      primary_asset_version_id: clean(product.primary_asset_version_id),
      checksum_sha256: clean(product.checksum_sha256).toLowerCase()
    },
    copy: { version_id: clean(copy.version_id) },
    avatar: {
      selection_id: clean(avatar.selection_id),
      avatar_version_id: clean(avatar.avatar_version_id),
      material_version_id: clean(avatar.material_version_id),
      checksum_sha256: clean(avatar.checksum_sha256).toLowerCase()
    }
  };
}

function expectedPairs(value) {
  const bindings = normalizeBindings(value);
  return [
    ["plan.video_plan_version_id", bindings.plan.video_plan_version_id],
    ["plan.plan_review_id", bindings.plan.plan_review_id],
    ["product.revision_id", bindings.product.revision_id],
    ["product.primary_asset_version_id", bindings.product.primary_asset_version_id],
    ["product.checksum_sha256", bindings.product.checksum_sha256],
    ["copy.version_id", bindings.copy.version_id],
    ["avatar.selection_id", bindings.avatar.selection_id],
    ["avatar.avatar_version_id", bindings.avatar.avatar_version_id],
    ["avatar.material_version_id", bindings.avatar.material_version_id],
    ["avatar.checksum_sha256", bindings.avatar.checksum_sha256]
  ].filter(([, item]) => item);
}

function assertExpectedBindings(contract, expectedBindings) {
  if (!expectedBindings) return;
  const expected = expectedPairs(expectedBindings);
  const actual = expectedPairs(contract);
  const mismatches = expected.filter(([field, value]) => actual.find(([candidate]) => candidate === field)?.[1] !== value);
  if (mismatches.length) throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.BINDING_MISMATCH, mismatches.map(([field]) => field));
}

function assertExactKeys(value, allowed, field) {
  const unknown = Object.keys(value || {}).filter((key) => !allowed.has(key));
  if (unknown.length) throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.INVALID, [`${field}.${unknown[0]}`]);
}

function planFacts(value) {
  const plan = value?.plan || {};
  const id = requiredId(plan.video_plan_version_id, "plan.video_plan_version_id", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.PLAN_INVALID);
  const reviewId = requiredId(plan.plan_review_id, "plan.plan_review_id", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.PLAN_INVALID);
  if (plan.status !== "frozen" || plan.review_status !== "approved" || plan.current !== true) {
    throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.PLAN_INVALID, ["plan"]);
  }
  return { video_plan_version_id: id, plan_review_id: reviewId };
}

function productFacts(value) {
  const product = value?.product || {};
  return {
    revision_id: requiredId(product.revision_id, "product.revision_id", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.PRODUCT_INVALID),
    primary_asset_version_id: requiredId(product.primary_asset_version_id, "product.primary_asset_version_id", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.PRODUCT_INVALID),
    checksum_sha256: checksum(product.checksum_sha256, "product.checksum_sha256", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.PRODUCT_INVALID),
    media_type: verifiedMedia(product.media_type, "product.media_type", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.PRODUCT_INVALID),
    size: verifiedSize(product.size, "product.size", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.PRODUCT_INVALID)
  };
}

function copyFacts(value) {
  const copy = value?.copy || {};
  const body = copy.body;
  const suppliedHash = copy.body_hash === undefined ? "" : clean(copy.body_hash).toLowerCase();
  if ((typeof body !== "string" || !body.trim()) && !SHA256.test(suppliedHash)) {
    throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.COPY_REQUIRED, ["copy.body"]);
  }
  const bodyHash = typeof body === "string" && body.trim() ? createHash("sha256").update(body).digest("hex") : suppliedHash;
  if (suppliedHash && suppliedHash !== bodyHash) {
    throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.COPY_INVALID, ["copy.body_hash"]);
  }
  if (copy.status !== "frozen" || copy.review_status !== "approved") {
    throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.COPY_INVALID, ["copy"]);
  }
  return {
    version_id: requiredId(copy.version_id, "copy.version_id", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.COPY_INVALID),
    mode: "frozen_copy", transform: "none", language: "zh-CN", body_hash: bodyHash
  };
}

function avatarFacts(value) {
  const avatar = value?.avatar || {};
  if (avatar.status !== "confirmed" || avatar.current !== true) {
    throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.AVATAR_INVALID, ["avatar"]);
  }
  return {
    selection_id: requiredId(avatar.selection_id, "avatar.selection_id", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.AVATAR_INVALID),
    avatar_version_id: requiredId(avatar.avatar_version_id, "avatar.avatar_version_id", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.AVATAR_INVALID),
    material_version_id: requiredId(avatar.material_version_id, "avatar.material_version_id", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.AVATAR_INVALID),
    checksum_sha256: checksum(avatar.checksum_sha256, "avatar.checksum_sha256", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.AVATAR_INVALID),
    media_type: verifiedMedia(avatar.media_type, "avatar.media_type", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.AVATAR_INVALID),
    size: verifiedSize(avatar.size, "avatar.size", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.AVATAR_INVALID)
  };
}

function productionFacts(value) {
  const requested = value?.production?.handheld_aspect_ratio_policy;
  const policy = requested === undefined
    ? HIFLY_HANDS_ON_PRODUCT_V1_PRODUCTION.handheld_aspect_ratio_policy
    : clean(requested);
  if (!HANDHELD_RATIO_POLICIES.has(policy)) {
    throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.HANDHELD_RATIO_POLICY_INVALID, ["production.handheld_aspect_ratio_policy"]);
  }
  return { ...HIFLY_HANDS_ON_PRODUCT_V1_PRODUCTION, handheld_aspect_ratio_policy: policy };
}

export function canonicalizeHiflyHandsOnProductV1(value) {
  return canonical(value);
}

export function hashHiflyHandsOnProductV1(value) {
  return createHash("sha256").update(canonicalizeHiflyHandsOnProductV1(value)).digest("hex");
}

export function buildHiflyHandsOnProductV1(structuredFacts = {}) {
  if (!structuredFacts || typeof structuredFacts !== "object" || Array.isArray(structuredFacts)) {
    throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.INVALID);
  }
  const contract = {
    contract_id: HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_ID,
    contract_version: HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_VERSION,
    plan: planFacts(structuredFacts),
    product: productFacts(structuredFacts),
    copy: copyFacts(structuredFacts),
    avatar: avatarFacts(structuredFacts),
    production: productionFacts(structuredFacts)
  };
  const result = deepFreeze(contract);
  assertExpectedBindings(result, structuredFacts.expected_bindings);
  return result;
}

function assertContractShape(contract) {
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.REQUIRED);
  assertExactKeys(contract, new Set(["contract_id", "contract_version", "plan", "product", "copy", "avatar", "production"]), "contract");
  if (contract.contract_id !== HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_ID) throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.INVALID, ["contract_id"]);
  if (contract.contract_version !== HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_VERSION) throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.VERSION_UNSUPPORTED, ["contract_version"]);
  const requiredString = (value, field, code) => {
    if (typeof value !== "string" || !value.trim()) throw fail(code, [field]);
  };
  const plan = contract.plan;
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.PLAN_INVALID, ["plan"]);
  assertExactKeys(plan, new Set(["video_plan_version_id", "plan_review_id"]), "plan");
  requiredString(plan.video_plan_version_id, "plan.video_plan_version_id", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.PLAN_INVALID);
  requiredString(plan.plan_review_id, "plan.plan_review_id", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.PLAN_INVALID);
  const copy = contract.copy;
  if (!copy || typeof copy !== "object" || Array.isArray(copy)) throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.COPY_INVALID, ["copy"]);
  assertExactKeys(copy, new Set(["version_id", "mode", "transform", "language", "body_hash"]), "copy");
  requiredString(copy.version_id, "copy.version_id", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.COPY_INVALID);
  const product = contract.product;
  if (!product || typeof product !== "object" || Array.isArray(product)) throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.PRODUCT_INVALID, ["product"]);
  assertExactKeys(product, new Set(["revision_id", "primary_asset_version_id", "checksum_sha256", "media_type", "size"]), "product");
  requiredString(product.revision_id, "product.revision_id", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.PRODUCT_INVALID);
  requiredString(product.primary_asset_version_id, "product.primary_asset_version_id", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.PRODUCT_INVALID);
  const avatar = contract.avatar;
  if (!avatar || typeof avatar !== "object" || Array.isArray(avatar)) throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.AVATAR_INVALID, ["avatar"]);
  assertExactKeys(avatar, new Set(["selection_id", "avatar_version_id", "material_version_id", "checksum_sha256", "media_type", "size"]), "avatar");
  requiredString(avatar.selection_id, "avatar.selection_id", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.AVATAR_INVALID);
  requiredString(avatar.avatar_version_id, "avatar.avatar_version_id", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.AVATAR_INVALID);
  requiredString(avatar.material_version_id, "avatar.material_version_id", HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.AVATAR_INVALID);
  const production = contract.production;
  if (!production || typeof production !== "object") throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.INVALID, ["production"]);
  assertExactKeys(production, new Set(Object.keys(HIFLY_HANDS_ON_PRODUCT_V1_PRODUCTION)), "production");
  for (const [key, expected] of Object.entries(HIFLY_HANDS_ON_PRODUCT_V1_PRODUCTION)) {
    if (key === "handheld_aspect_ratio_policy") continue;
    if (production[key] !== expected) {
      const code = key === "mode" ? HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.MODE_INVALID
        : key === "target_aspect_ratio" ? HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.ASPECT_RATIO_INVALID
          : key === "voice_source" ? HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.VOICE_SOURCE_INVALID
            : HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.INVALID;
      throw fail(code, [`production.${key}`]);
    }
  }
  if (!HANDHELD_RATIO_POLICIES.has(production.handheld_aspect_ratio_policy)) {
    throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.HANDHELD_RATIO_POLICY_INVALID, ["production.handheld_aspect_ratio_policy"]);
  }
  if (contract.copy?.mode !== "frozen_copy" || contract.copy?.transform !== "none" || contract.copy?.language !== "zh-CN" || !SHA256.test(contract.copy?.body_hash || "")) {
    throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.COPY_INVALID, ["copy"]);
  }
  if (!MEDIA_TYPES.has(contract.product?.media_type) || !Number.isInteger(contract.product?.size) || contract.product.size < 1 || !SHA256.test(contract.product?.checksum_sha256 || "")) {
    throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.PRODUCT_INVALID, ["product"]);
  }
  if (!MEDIA_TYPES.has(contract.avatar?.media_type) || !Number.isInteger(contract.avatar?.size) || contract.avatar.size < 1 || !SHA256.test(contract.avatar?.checksum_sha256 || "")) {
    throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.AVATAR_INVALID, ["avatar"]);
  }
  return contract;
}

export function requireHiflyHandsOnProductV1(contract, expectedBindings = null) {
  let value;
  try {
    value = structuredClone(contract);
  } catch {
    throw fail(HIFLY_HANDS_ON_PRODUCT_V1_ERROR_CODES.INVALID);
  }
  assertContractShape(value);
  assertExpectedBindings(value, expectedBindings);
  return deepFreeze(value);
}
