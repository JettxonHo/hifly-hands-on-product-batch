import { createHash } from "node:crypto";

import {
  requireHiflyHandsOnProductV1
} from "../execution-contracts/hifly-hands-on-product-v1.js";
import { requirePresentationSizeCode } from "../video-planning/presentation-size.js";

export const MANUAL_HANDOFF_CONTRACT_TYPE = "manual_handoff";
export const MANUAL_HANDOFF_CONTRACT_VERSION = "1.0";
export const MANUAL_HANDOFF_PACKAGE_STATES = ["generating", "ready", "generation_failed", "superseded", "expired", "revoked"];
export const MANUAL_HANDOFF_RETRIEVAL_MODES = ["embedded", "short_lived_fetch", "provider_existing"];

const forbiddenKey = /^(?:password|secret|cookie|token|profile|localstorage|credential|private[_-]?key|access[_-]?key|signed[_-]?url|permanent[_-]?url|session[_-]?token|authorization[_-]?token|object[_-]?key|storage[_-]?path|local[_-]?path)$/i;
const forbiddenText = /(?:\b(?:password|secret|cookie|token)\s*[:=]\s*[^\s,;]+|https?:\/\/[^\s)]+|file:\/\/[^\s)]+|\/(?:Users|private\/tmp|home|var\/folders)\/[^\s)]+|[A-Za-z]:\\Users\\[^\s)]+)/gi;

export const failure = (code, details = null) => Object.assign(new Error(code), { code, details });

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return createHash("sha256").update(Buffer.isBuffer(value) ? value : String(value)).digest("hex");
}

/**
 * Computes the existing manual-handoff package fingerprint from ordered
 * embedded entries. ZIP member order is part of the established package
 * semantics, so callers must pass entries in archive order.
 */
export function computeManualHandoffPackageHash({ manifest, assets = [] } = {}) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw new TypeError("manifest is required");
  const entries = Array.isArray(assets)
    ? assets.map((entry) => Array.isArray(entry) ? [entry[0], entry[1]] : [entry?.name, entry?.body])
    : Object.entries(assets || {});
  const manifestWithPlaceholder = { ...manifest, package_hash: null };
  const provisionalPackageHash = sha256(canonicalJson({
    manifest: manifestWithPlaceholder,
    assets: entries.map(([name]) => name).sort()
  }));
  const provisionalReadme = renderManualHandoffReadme({ ...manifestWithPlaceholder, package_hash: provisionalPackageHash });
  const packageHash = sha256(canonicalJson({
    manifest: manifestWithPlaceholder,
    readme: provisionalReadme,
    assets: entries.map(([name, body]) => [name, sha256(body)])
  }));
  return { packageHash, provisionalPackageHash, provisionalReadme };
}

function cleanText(value) {
  return typeof value === "string" ? value.replace(forbiddenText, "[已移除敏感内容]").trim() : "";
}

function safeKey(key) {
  return forbiddenKey.test(key) || /(?:^|_)(?:password|secret|cookie|token|profile|credential|private_key|access_key|signed_url|permanent_url|local_path|storage_path)$/i.test(key);
}

export function sanitizePackageValue(value, { organizationId } = {}) {
  if (typeof value === "string") return cleanText(value);
  if (Array.isArray(value)) return value.map((item) => sanitizePackageValue(item, { organizationId }));
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, child] of Object.entries(value)) {
    if (safeKey(key)) continue;
    if (/^(?:organization[_-]?id|org[_-]?id)$/i.test(key) && child != null && child !== organizationId) throw failure("MANUAL_HANDOFF_CROSS_ORGANIZATION_DATA");
    result[key] = sanitizePackageValue(child, { organizationId });
  }
  return result;
}

function firstString(...values) { return values.find((value) => typeof value === "string" && value.trim())?.trim() || null; }
function list(value, fallback = []) { return Array.isArray(value) ? value.map(cleanText).filter(Boolean) : fallback; }

function normalizeAssetReferences(snapshot, organizationId) {
  const values = snapshot.asset_references || snapshot.assets || snapshot.product_revision?.asset_references || [];
  if (!Array.isArray(values)) return [];
  return values.map((reference) => {
    const safe = sanitizePackageValue(reference, { organizationId });
    if (!MANUAL_HANDOFF_RETRIEVAL_MODES.includes(safe.retrieval_mode)) throw failure("MANUAL_HANDOFF_ASSET_MODE_INVALID");
    if (!safe.asset_id || !safe.asset_version_id || !safe.role || !safe.media_type || !safe.checksum) throw failure("MANUAL_HANDOFF_ASSET_REFERENCE_INVALID");
    return {
      asset_id: safe.asset_id, asset_version_id: safe.asset_version_id, role: safe.role,
      display_name: cleanText(safe.display_name || safe.role), media_type: safe.media_type,
      size: Number.isInteger(safe.size) ? safe.size : null, checksum: safe.checksum,
      retrieval_mode: safe.retrieval_mode, access_scope: safe.access_scope || "organization"
    };
  });
}

export function buildManualHandoffManifest({ order, packageId, packageVersion, createdAt, createdByMemberId, supersedesPackageId = null } = {}) {
  if (!order?.id || !order.organization_id || !packageId) throw failure("MANUAL_HANDOFF_INPUT_SNAPSHOT_REQUIRED");
  const organizationId = order.organization_id;
  const snapshot = order.input_snapshot || {};
  const plan = snapshot.video_plan_version || snapshot.video_plan || {};
  const upstream = snapshot.upstream_snapshot || plan.upstream_snapshot || {};
  const copy = snapshot.approved_copy_snapshot || snapshot.copy_snapshot || {};
  const avatar = snapshot.avatar_selection_snapshot || snapshot.avatar_snapshot || {};
  const product = snapshot.product_revision_snapshot || snapshot.product_revision || {};
  const copyBody = cleanText(copy.copy_body || copy.body || "");
  const assetReferences = normalizeAssetReferences(snapshot, organizationId);
  const capabilities = avatar.capabilities || avatar.verified_capability_snapshot?.verified_capabilities || [];
  if (!copy.copy_version_id || !copyBody || !Number.isInteger(copy.version_number) || copy.status !== "frozen" ||
    !copy.review?.id || copy.review.status !== "approved") throw failure("MANUAL_HANDOFF_INPUT_SNAPSHOT_REQUIRED");
  if (!product.id || !product.product_name || product.status !== "ready" || !Array.isArray(product.asset_version_ids) ||
    product.asset_version_ids.length === 0 || product.asset_version_ids.some((id) => !assetReferences.some((asset) => asset.asset_version_id === id))) {
    throw failure("MANUAL_HANDOFF_INPUT_SNAPSHOT_REQUIRED");
  }
  if (!avatar.avatar_asset_id || !avatar.asset_version_id && !avatar.avatar_asset_version_id || !avatar.display_name ||
    !avatar.source_type || !avatar.authorization_status || !avatar.capability_status || !Array.isArray(capabilities) || capabilities.length === 0) {
    throw failure("MANUAL_HANDOFF_INPUT_SNAPSHOT_REQUIRED");
  }
  const hiflyHandsOnProductV1Raw = snapshot.hifly_hands_on_product_v1 || null;
  let hiflyHandsOnProductV1 = null;
  if (hiflyHandsOnProductV1Raw) {
    if (order.video_plan_version_id && plan.id && order.video_plan_version_id !== plan.id) {
      throw failure("HIFLY_HANDS_ON_PRODUCT_V1_PLAN_BINDING_MISMATCH");
    }
    hiflyHandsOnProductV1 = requireHiflyHandsOnProductV1(hiflyHandsOnProductV1Raw, {
      plan: { video_plan_version_id: plan.id || order.video_plan_version_id,
        plan_review_id: snapshot.plan_review?.id || null },
      product: { revision_id: product.id || null,
        primary_asset_version_id: hiflyHandsOnProductV1Raw.product?.primary_asset_version_id,
        checksum_sha256: hiflyHandsOnProductV1Raw.product?.checksum_sha256 },
      copy: { version_id: copy.copy_version_id || upstream.copy_version_id },
      avatar: { selection_id: avatar.avatar_selection_id || upstream.avatar_selection_id,
        avatar_version_id: avatar.asset_version_id || avatar.avatar_asset_version_id || upstream.avatar_asset_version_id,
        material_version_id: hiflyHandsOnProductV1Raw.avatar?.material_version_id,
        checksum_sha256: hiflyHandsOnProductV1Raw.avatar?.checksum_sha256 }
    });
    const primary = assetReferences.find((reference) => reference.asset_version_id === hiflyHandsOnProductV1.product.primary_asset_version_id);
    if (!primary || primary.role !== "product_image" || primary.media_type !== hiflyHandsOnProductV1.product.media_type ||
        primary.size !== hiflyHandsOnProductV1.product.size || primary.checksum !== hiflyHandsOnProductV1.product.checksum_sha256 ||
        sha256(copyBody) !== hiflyHandsOnProductV1.copy.body_hash || plan.presentation_size_code !== hiflyHandsOnProductV1.production.presentation_size_code) {
      throw failure("HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_MISMATCH");
    }
  }
  const presentationSizeCode = requirePresentationSizeCode(plan.presentation_size_code);
  const videoPlanSnapshot = sanitizePackageValue({ ...plan, presentation_size_code: presentationSizeCode }, { organizationId });
  const configuration = sanitizePackageValue(snapshot.configuration_snapshot || snapshot.capability_config_snapshot || plan.capability_config_snapshot || {}, { organizationId });
  const primaryOutput = sanitizePackageValue(snapshot.primary_output || plan.primary_output || {
    role: "primary_video", accepted_media_types: ["video/*"], expected_quantity: 1
  }, { organizationId });
  const executionSteps = list(snapshot.execution_steps, ["确认交接包中的固定输入", "按作业说明完成一次人工生产"]);
  const constraints = list(snapshot.business_constraints);
  const expectedBehavior = list(snapshot.expected_behavior, ["按固定输入完成指定输出"]);
  const limitations = list(snapshot.known_limitations);
  const confirmations = list(snapshot.human_confirmation_points, ["开始前核对包版本与完整性摘要"]);
  const base = {
    contract_type: MANUAL_HANDOFF_CONTRACT_TYPE,
    contract_version: MANUAL_HANDOFF_CONTRACT_VERSION,
    package_id: packageId,
    package_version: packageVersion,
    package_status: "ready",
    created_at: createdAt,
    created_by: createdByMemberId,
    ...(supersedesPackageId ? { supersedes_package_id: supersedesPackageId } : {}),
    organization_id: organizationId,
    project_id: firstString(order.project_id, snapshot.project_id, plan.project_id),
    product_id: order.product_id || snapshot.product_id || plan.product_id,
    production_order_id: order.id,
    execution_purpose: order.execution_purpose,
    video_plan_version_id: order.video_plan_version_id || plan.id || null,
    copy_version_id: firstString(copy.copy_version_id, upstream.copy_version_id),
    avatar_asset_version_id: firstString(avatar.asset_version_id, avatar.avatar_asset_version_id, upstream.avatar_asset_version_id),
    product_revision: sanitizePackageValue(product, { organizationId }),
    copy_snapshot: {
      copy_version_id: firstString(copy.copy_version_id, upstream.copy_version_id),
      version_number: copy.version_number,
      status: copy.status,
      intent: cleanText(copy.intent),
      copy_body: copyBody,
      copy_hash: firstString(copy.copy_hash) || sha256(copyBody),
      approved_review_id: firstString(copy.review.id, copy.approved_review_id, snapshot.plan_review?.copy_review_id),
      approved_at: firstString(copy.review.decided_at, copy.approved_at, snapshot.plan_review?.approved_at),
      review: sanitizePackageValue(copy.review, { organizationId })
    },
    avatar_snapshot: {
      avatar_selection_id: firstString(avatar.avatar_selection_id, upstream.avatar_selection_id),
      avatar_asset_id: firstString(avatar.avatar_asset_id, upstream.avatar_asset_id),
      avatar_asset_version_id: firstString(avatar.asset_version_id, avatar.avatar_asset_version_id, upstream.avatar_asset_version_id),
      status: avatar.status,
      version_number: avatar.version_number,
      confirmed_at: avatar.confirmed_at || null,
      display_name: cleanText(avatar.display_name),
      source_type: cleanText(avatar.source_type),
      authorization_status: cleanText(avatar.authorization_status),
      authorization_expires_at: avatar.authorization_expires_at || null,
      authorization_scope: cleanText(avatar.authorization_scope || "current_organization"),
      capability_status: cleanText(avatar.capability_status),
      materials_accessible: avatar.materials_accessible !== false,
      capabilities: sanitizePackageValue(capabilities, { organizationId }),
      authorization_summary: cleanText(avatar.authorization_summary || "按冻结授权事实执行"),
      verified_capability_snapshot: sanitizePackageValue(avatar.verified_capability_snapshot || { verified_capabilities: capabilities }, { organizationId })
    },
    ...(hiflyHandsOnProductV1 ? { hifly_hands_on_product_v1: hiflyHandsOnProductV1 } : {}),
    ...(hiflyHandsOnProductV1 ? { plan_review: sanitizePackageValue(snapshot.plan_review || {}, { organizationId }) } : {}),
    video_plan_snapshot: videoPlanSnapshot,
    configuration_snapshot: configuration,
    execution_steps: executionSteps,
    business_constraints: constraints,
    expected_behavior: expectedBehavior,
    known_limitations: limitations,
    human_confirmation_points: confirmations,
    primary_output: primaryOutput,
    supporting_outputs: sanitizePackageValue(snapshot.supporting_outputs || [], { organizationId }),
    file_naming_rule: cleanText(snapshot.file_naming_rule || plan.file_naming_rule || "{product}-primary.mp4"),
    accepted_media_types: Array.isArray(primaryOutput.accepted_media_types) ? primaryOutput.accepted_media_types : ["video/*"],
    expected_quantity: Number.isInteger(primaryOutput.expected_quantity) ? primaryOutput.expected_quantity : 1,
    minimum_validation_requirements: list(snapshot.minimum_validation_requirements, ["输出文件可读取且符合约定类型"]),
    asset_references: assetReferences,
    generated_by_system: true,
    access_scope: "organization_members_with_order_access",
    retention_notice: "已下载到本地的副本不会被远程删除，请按企业清理与保留政策处理",
    manifest_hash: null,
    package_hash: null
  };
  const manifestHash = sha256(canonicalJson({ ...base, manifest_hash: null, package_hash: null }));
  return { ...base, manifest_hash: manifestHash };
}

const presentationSizeLabels = Object.freeze({
  smart_fit: "智能适配", extra_large: "超大", large: "大", medium: "中", small: "小", extra_small: "超小"
});

function presentationSizeLabel(code) {
  return `${presentationSizeLabels[code]}（${code}）`;
}

function formatPhysicalDimensions(value) {
  if (!value || typeof value !== "object" || !Number.isFinite(value.height) || !Number.isFinite(value.width) || !value.unit) return "未知";
  return `${value.height} × ${value.width}${Number.isFinite(value.depth) ? ` × ${value.depth}` : ""} ${value.unit}`;
}

function formatQuantity(value) {
  return value && typeof value === "object" && Number.isFinite(value.value) && value.unit
    ? `${value.value} ${value.unit}` : "未知";
}

export function renderManualHandoffReadme(manifest) {
  const optionalListSection = (title, values) => Array.isArray(values) && values.length
    ? ["", `## ${title}`, ...values.map((item) => `- ${item}`)]
    : [];
  const lines = [
    "# 人工交接包",
    "",
    `包版本：${manifest.package_version}`,
    `包编号：${manifest.package_id}`,
    `完整性摘要：${manifest.manifest_hash.slice(0, 8).toUpperCase()}-${manifest.package_hash ? manifest.package_hash.slice(0, 8).toUpperCase() : "待生成"}`,
    "",
    "## 固定输入",
    `- 商品：${manifest.product_revision.product_name}`,
    `- 实物尺寸：${formatPhysicalDimensions(manifest.product_revision.physical_dimensions)}`,
    `- 容量：${formatQuantity(manifest.product_revision.physical_dimensions?.capacity)}`,
    `- 重量：${formatQuantity(manifest.product_revision.physical_dimensions?.weight)}`,
    `- 文案版本：${manifest.copy_snapshot.copy_version_id}（v${manifest.copy_snapshot.version_number}）`,
    "文案正文：",
    manifest.copy_snapshot.copy_body,
    `- 人物：${manifest.avatar_snapshot.display_name}`,
    `- 来源：${manifest.avatar_snapshot.source_type}`,
    `- 授权：${manifest.avatar_snapshot.authorization_status}${manifest.avatar_snapshot.authorization_summary ? `（${manifest.avatar_snapshot.authorization_summary}）` : ""}`,
    `- 视频方案：${manifest.video_plan_snapshot.output_instructions}`,
    `- 商品呈现大小：${presentationSizeLabel(manifest.video_plan_snapshot.presentation_size_code)}`,
    "- 外观核对：呈现大小不保证瓶盖、包装、标签或商品形态保真，成片仍须人工检查。",
    "",
    "## 作业说明",
    ...manifest.execution_steps.map((step) => `- ${step}`),
    "",
    "## 业务约束",
    ...(manifest.business_constraints.length ? manifest.business_constraints.map((item) => `- ${item}`) : ["- 无额外约束"]),
    "",
    "## 输出要求",
    `- 主要产物：${manifest.expected_quantity} 个`,
    `- 文件命名：${manifest.file_naming_rule}`,
    `- 接受类型：${manifest.accepted_media_types.join("、")}`,
    ...manifest.minimum_validation_requirements.map((item) => `- 核对：${item}`),
    ...optionalListSection("预期行为", manifest.expected_behavior),
    ...optionalListSection("已知限制", manifest.known_limitations),
    ...optionalListSection("人工确认", manifest.human_confirmation_points),
    "",
    "## 素材",
    ...(manifest.asset_references.length ? manifest.asset_references.map((asset) => `- ${asset.display_name}：${asset.retrieval_mode === "embedded" ? "已随包附带" : asset.retrieval_mode === "short_lived_fetch" ? "使用时通过系统短时授权获取" : "已在执行环境中，按说明确认"}`) : ["- 无需额外素材"]),
    "",
    "## 重要提示",
    "- `manifest.json` 是本包的权威执行清单，README.md 仅由它派生。",
    "- 包内作业说明由系统从权威清单派生；如说明与清单不一致，此包视为异常，请勿继续生产并联系管理员。",
    "- 下载交接包不代表开始执行；人工领取与开始执行由后续阶段处理。",
    "- 请妥善保管本地副本，并按企业清理与保留政策处理。"
  ];
  return `${lines.join("\n")}\n`;
}

export function summarizeManualHandoffManifest(manifest) {
  return {
    execution_steps: [...manifest.execution_steps],
    business_constraints: [...manifest.business_constraints],
    expected_behavior: [...manifest.expected_behavior],
    output_requirements: {
      expected_quantity: manifest.expected_quantity,
      file_naming_rule: manifest.file_naming_rule,
      accepted_media_types: [...manifest.accepted_media_types],
      minimum_validation_requirements: [...manifest.minimum_validation_requirements]
    },
    assets: manifest.asset_references.map((asset) => ({ display_name: asset.display_name, role: asset.role, retrieval_mode: asset.retrieval_mode })),
    retention_notice: manifest.retention_notice,
    integrity_summary: `${manifest.manifest_hash.slice(0, 8).toUpperCase()}-${manifest.package_hash.slice(0, 8).toUpperCase()}`
  };
}
