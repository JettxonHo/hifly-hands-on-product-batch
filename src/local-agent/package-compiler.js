import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  requireHiflyHandsOnProductV1
} from "../execution-contracts/hifly-hands-on-product-v1.js";
import { canonicalJson, computeManualHandoffPackageHash, renderManualHandoffReadme } from "../manual-handoff/manual-handoff-package.js";
import { extractManualHandoffArchive } from "../manual-handoff/manual-handoff-package-store.js";
import { requirePresentationSizeCode } from "../video-planning/presentation-size.js";
import { localAgentError } from "./errors.js";

const PRODUCT_IMAGE_ROLES = new Set(["product_image", "product_main_image"]);
const MAPPING_KEYS = [
  "avatar_asset_version_paths",
  "avatarMappings",
  "avatar_mappings",
  "mappings"
];

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function packageIntegrityError(details = null) {
  return localAgentError("MANUAL_HANDOFF_PACKAGE_INTEGRITY_MISMATCH", { details });
}

export async function verifyHandoffPackageIntegrity({ body, manifest: suppliedManifest = null, expectedAttempt = null, expectedPackage = null, expectedOrder = null } = {}) {
  if (!Buffer.isBuffer(body)) throw packageIntegrityError();
  let entries;
  try { entries = await extractManualHandoffArchive(body); } catch { throw packageIntegrityError(); }
  let archivedManifest;
  try {
    const raw = entries["manifest.json"];
    archivedManifest = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw || ""));
  } catch { throw packageIntegrityError(); }
  if (!archivedManifest || typeof archivedManifest !== "object" || Array.isArray(archivedManifest)) throw packageIntegrityError(["manifest"]);
  if (suppliedManifest != null && (typeof suppliedManifest !== "object" || Array.isArray(suppliedManifest) || canonicalJson(archivedManifest) !== canonicalJson(suppliedManifest))) {
    throw packageIntegrityError(["manifest"]);
  }
  const manifest = archivedManifest;

  const expectedIdentity = [
    ["package_id", [
      ["expectedPackage.id", expectedPackage?.id], ["expectedPackage.package_id", expectedPackage?.package_id],
      ["expectedAttempt.package_id", expectedAttempt?.package_id], ["expectedOrder.package_id", expectedOrder?.package_id]
    ]],
    ["production_order_id", [
      ["expectedPackage.production_order_id", expectedPackage?.production_order_id], ["expectedPackage.order_id", expectedPackage?.order_id],
      ["expectedAttempt.production_order_id", expectedAttempt?.production_order_id], ["expectedAttempt.order_id", expectedAttempt?.order_id],
      ["expectedOrder.id", expectedOrder?.id], ["expectedOrder.production_order_id", expectedOrder?.production_order_id], ["expectedOrder.order_id", expectedOrder?.order_id]
    ]],
    ["package_version", [
      ["expectedPackage.package_version", expectedPackage?.package_version], ["expectedAttempt.package_version", expectedAttempt?.package_version],
      ["expectedOrder.package_version", expectedOrder?.package_version]
    ]],
    ["manifest_hash", [
      ["expectedPackage.manifest_hash", expectedPackage?.manifest_hash], ["expectedAttempt.manifest_hash", expectedAttempt?.manifest_hash],
      ["expectedOrder.manifest_hash", expectedOrder?.manifest_hash]
    ]],
    ["package_hash", [
      ["expectedPackage.package_hash", expectedPackage?.package_hash], ["expectedAttempt.package_hash", expectedAttempt?.package_hash],
      ["expectedOrder.package_hash", expectedOrder?.package_hash]
    ]]
  ];
  for (const [field, values] of expectedIdentity) {
    const present = values.filter(([, value]) => value !== null && value !== undefined);
    for (const [source, value] of present) {
      if (manifest[field] !== value) throw packageIntegrityError([field, source]);
    }
    if (present.length > 1 && present.some(([, value]) => value !== present[0][1])) throw packageIntegrityError([field]);
  }

  const expectedAssetNames = (Array.isArray(manifest.asset_references) ? manifest.asset_references : [])
    .filter((reference) => reference?.retrieval_mode === "embedded")
    .map((reference) => `assets/${text(reference?.asset_version_id)}`)
    .filter((name) => !name.endsWith("/"));
  const entryNames = Object.keys(entries);
  const allowedNames = new Set(["manifest.json", "README.md", ...expectedAssetNames]);
  for (const name of entryNames) {
    if (allowedNames.has(name)) continue;
    if (name.endsWith("/") && expectedAssetNames.some((assetName) => assetName.startsWith(name))) continue;
    throw packageIntegrityError(["entry", name]);
  }
  for (const name of expectedAssetNames) if (!Object.prototype.hasOwnProperty.call(entries, name)) throw packageIntegrityError(["entry", name]);

  const expectedManifestHash = expectedPackage?.manifest_hash ?? expectedAttempt?.manifest_hash ?? expectedOrder?.manifest_hash ?? null;
  const expectedPackageHash = expectedPackage?.package_hash ?? expectedAttempt?.package_hash ?? expectedOrder?.package_hash ?? null;
  if (!manifest.manifest_hash && !manifest.package_hash && !expectedManifestHash && !expectedPackageHash) {
    return { manifest, manifest_hash: null, package_hash: null };
  }
  const manifestWithPlaceholders = { ...manifest, manifest_hash: null, package_hash: null };
  const manifestHash = sha256(canonicalJson(manifestWithPlaceholders));
  if (manifest.manifest_hash !== manifestHash || expectedManifestHash && expectedManifestHash !== manifestHash) {
    throw packageIntegrityError(["manifest_hash"]);
  }
  if (expectedPackageHash || manifest.package_hash) {
    if (!manifest.package_hash || expectedPackageHash && expectedPackageHash !== manifest.package_hash) throw packageIntegrityError(["package_hash"]);
    const assetEntries = Object.entries(entries).filter(([name]) => name.startsWith("assets/") && !name.endsWith("/"));
    const { packageHash } = computeManualHandoffPackageHash({ manifest, assets: assetEntries });
    const archivedReadme = entries["README.md"];
    const finalReadme = renderManualHandoffReadme(manifest);
    if ((Buffer.isBuffer(archivedReadme) ? archivedReadme.toString("utf8") : String(archivedReadme || "")) !== finalReadme) {
      throw packageIntegrityError(["readme"]);
    }
    if (manifest.package_hash !== packageHash || expectedPackageHash && expectedPackageHash !== packageHash) throw packageIntegrityError(["package_hash"]);
  }
  return { manifest, manifest_hash: manifestHash, package_hash: manifest.package_hash || null };
}

function listText(value) {
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  return text(value);
}

function packagePath(root, entryName) {
  const raw = typeof entryName === "string" ? entryName : "";
  const normalized = raw.replaceAll("\\", "/");
  const segments = normalized.split("/");
  if (!normalized || normalized.includes("\0") || normalized.startsWith("/") ||
    path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized) || segments.includes("..")) {
    throw localAgentError("LOCAL_AGENT_ZIP_SLIP");
  }
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  const relative = path.relative(resolvedRoot, target);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw localAgentError("LOCAL_AGENT_ZIP_SLIP");
  }
  return target;
}

function mappingObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  for (const key of MAPPING_KEYS) {
    if (value[key] && typeof value[key] === "object" && !Array.isArray(value[key])) return value[key];
  }
  return value;
}

export async function loadAvatarMappings(configPath, { readFileImpl = readFile } = {}) {
  if (!text(configPath)) return {};
  let parsed;
  try {
    parsed = JSON.parse(await readFileImpl(configPath, "utf8"));
  } catch (error) {
    throw localAgentError("AVATAR_MAPPING_REQUIRED", { outcome: "requires_action" });
  }
  const source = mappingObject(parsed);
  return Object.fromEntries(Object.entries(source).filter(([, value]) => typeof value === "string" && value.trim()));
}

export async function extractHandoffPackage(body, extractionRoot) {
  if (!Buffer.isBuffer(body) || !text(extractionRoot)) throw localAgentError("LOCAL_AGENT_PACKAGE_INVALID");
  const entries = await extractManualHandoffArchive(body);
  const targets = Object.entries(entries).map(([name, value]) => ({
    name,
    value,
    target: packagePath(extractionRoot, name)
  }));
  await mkdir(extractionRoot, { recursive: true });
  for (const entry of targets) {
    await mkdir(path.dirname(entry.target), { recursive: true });
    if (entry.name.endsWith("/")) {
      await mkdir(entry.target, { recursive: true });
      continue;
    }
    await writeFile(entry.target, Buffer.isBuffer(entry.value) ? entry.value : Buffer.from(String(entry.value)));
  }

  const manifestEntry = targets.find((entry) => entry.name === "manifest.json");
  if (!manifestEntry) throw localAgentError("LOCAL_AGENT_PACKAGE_INVALID");
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestEntry.target, "utf8"));
  } catch {
    throw localAgentError("LOCAL_AGENT_PACKAGE_INVALID");
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) throw localAgentError("LOCAL_AGENT_PACKAGE_INVALID");
  return { manifest, directory: path.resolve(extractionRoot), entries: targets.map((entry) => entry.name) };
}

function declaredItemCount(manifest) {
  for (const field of ["items", "products", "product_items", "product_revisions"]) {
    if (Array.isArray(manifest[field])) return manifest[field].length;
  }
  return 1;
}

function avatarVersionId(manifest) {
  return text(manifest.avatar_asset_version_id) ||
    text(manifest.avatar_snapshot?.avatar_asset_version_id) ||
    text(manifest.avatar_snapshot?.asset_version_id);
}

function handsOnProductContract(manifest) {
  return manifest?.hifly_hands_on_product_v1 || null;
}

function avatarPathFor(mappings, versionId) {
  if (mappings instanceof Map) return text(mappings.get(versionId));
  return text(mappings?.[versionId]);
}

async function assertLocalFile(filePath, code) {
  try {
    const value = await stat(filePath);
    if (!value.isFile()) throw new Error("not a file");
  } catch {
    throw localAgentError(code, { outcome: code === "AVATAR_MAPPING_REQUIRED" ? "requires_action" : "failed" });
  }
}

async function assertContractAsset(filePath, expected, code) {
  let body;
  try { body = await readFile(filePath); } catch { throw localAgentError(code); }
  if (!Buffer.isBuffer(body) || body.length !== expected.size || createHash("sha256").update(body).digest("hex") !== expected.checksum_sha256) {
    throw localAgentError(code);
  }
  return body;
}

function productAsset(manifest, contract = null) {
  const references = Array.isArray(manifest.asset_references) ? manifest.asset_references : [];
  if (contract) return references.find((reference) => text(reference?.asset_version_id) === contract.product.primary_asset_version_id);
  return references.find((reference) => PRODUCT_IMAGE_ROLES.has(text(reference?.role)));
}

function productUploadExtension(reference) {
  if (reference?.media_type === "image/png") return ".png";
  if (reference?.media_type === "image/jpeg") return ".jpg";
  if (reference?.media_type === "image/webp") return ".webp";
  throw localAgentError("LOCAL_AGENT_PACKAGE_INVALID");
}

export async function compilePackageToBatchItem({ manifest, extractionRoot, avatarMappings = {}, taskId } = {}) {
  if (!manifest || typeof manifest !== "object" || !text(extractionRoot)) throw localAgentError("LOCAL_AGENT_PACKAGE_INVALID");
  const itemCount = declaredItemCount(manifest);
  if (itemCount !== 1) {
    throw localAgentError("PACKAGE_ITEM_COUNT_UNSUPPORTED", { outcome: "requires_action" });
  }

  const rawContract = handsOnProductContract(manifest);
  const contract = rawContract ? requireHiflyHandsOnProductV1(rawContract) : null;
  const avatarId = contract?.avatar?.avatar_version_id || avatarVersionId(manifest);
  const avatarPath = avatarPathFor(avatarMappings, avatarId);
  if (!avatarId || !avatarPath) throw localAgentError("AVATAR_MAPPING_REQUIRED", { outcome: "requires_action" });
  await assertLocalFile(avatarPath, "AVATAR_MAPPING_REQUIRED");
  if (contract) {
    await assertContractAsset(avatarPath, contract.avatar, "HIFLY_HANDS_ON_PRODUCT_V1_AVATAR_INTEGRITY_MISMATCH");
  }

  const reference = productAsset(manifest, contract);
  const assetVersionId = text(reference?.asset_version_id);
  if (!assetVersionId) throw localAgentError("LOCAL_AGENT_PACKAGE_INVALID");
  const packagedImagePath = packagePath(extractionRoot, path.posix.join("assets", assetVersionId));
  await assertLocalFile(packagedImagePath, "LOCAL_AGENT_PACKAGE_INVALID");
  if (contract) {
    const product = manifest.product_revision || manifest.product_revision_snapshot || {};
    const copy = manifest.copy_snapshot || manifest.approved_copy_snapshot || {};
    const plan = manifest.video_plan_snapshot || manifest.video_plan_version || {};
    const copyBody = text(copy.copy_body || copy.body);
    if (!PRODUCT_IMAGE_ROLES.has(text(reference?.role)) || assetVersionId !== contract.product.primary_asset_version_id ||
        text(manifest.video_plan_version_id) !== contract.plan.video_plan_version_id ||
        text(plan.id) !== contract.plan.video_plan_version_id ||
        plan.status !== "frozen" || text(manifest.plan_review?.id) !== contract.plan.plan_review_id || manifest.plan_review?.status !== "approved" ||
        text(manifest.copy_version_id || copy.copy_version_id) !== contract.copy.version_id ||
        text(copy.copy_version_id) !== contract.copy.version_id || copy.status !== "frozen" || sha256(copyBody) !== contract.copy.body_hash ||
        text(product.id) !== contract.product.revision_id ||
        product.status !== "ready" ||
        text(manifest.avatar_asset_version_id || manifest.avatar_snapshot?.avatar_asset_version_id) !== contract.avatar.avatar_version_id ||
        text(manifest.avatar_snapshot?.avatar_selection_id) !== contract.avatar.selection_id || manifest.avatar_snapshot?.status !== "confirmed" ||
        contract.production.mode !== "hands_on_product" || contract.production.target_aspect_ratio !== "9:16" ||
        !["record_only", "require_exact"].includes(contract.production.handheld_aspect_ratio_policy) ||
        contract.production.voice_source !== "hifly_native" || contract.production.voice_identity_policy !== "ui_visible_state_allowed" ||
        contract.production.presentation_size_code !== "smart_fit" ||
        contract.production.copy_ai_generation !== false ||
        text(reference?.media_type) !== contract.product.media_type || Number(reference?.size) !== contract.product.size ||
        text(reference?.checksum) !== contract.product.checksum_sha256) {
      throw localAgentError("HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_MISMATCH");
    }
    await assertContractAsset(packagedImagePath, contract.product, "HIFLY_HANDS_ON_PRODUCT_V1_PRODUCT_INTEGRITY_MISMATCH");
  }
  const imagePath = `${packagedImagePath}${productUploadExtension(reference)}`;
  await copyFile(packagedImagePath, imagePath);

  const product = manifest.product_revision || manifest.product_revision_snapshot || {};
  const copy = manifest.copy_snapshot || manifest.approved_copy_snapshot || {};
  const plan = manifest.video_plan_snapshot || manifest.video_plan_version || {};
  let presentationSizeCode;
  try {
    presentationSizeCode = requirePresentationSizeCode(plan.presentation_size_code);
  } catch (error) {
    throw localAgentError(error?.code === "VIDEO_PLAN_PRESENTATION_SIZE_REQUIRED"
      ? "LOCAL_AGENT_PRESENTATION_SIZE_REQUIRED"
      : "LOCAL_AGENT_PRESENTATION_SIZE_UNSUPPORTED", { outcome: "requires_action" });
  }
  const productName = text(product.product_name) || text(manifest.product_id);
  if (!productName) throw localAgentError("LOCAL_AGENT_PACKAGE_INVALID");

  const compiled = {
    task_id: text(taskId) || text(manifest.production_order_id) || text(manifest.package_id) || "local-agent-task",
    sku: text(product.sku) || text(manifest.product_id) || "local-agent-product",
    product_name: productName,
    selling_points: listText(product.selling_points || product.key_selling_points),
    category: text(product.category),
    image_path: imagePath,
    person_image_path: avatarPath,
    resolved_person_image_path: avatarPath,
    resolved_person_source: "local_agent_mapping",
    script: text(copy.copy_body || copy.body),
    resolved_script_mode: "frozen_copy",
    avatar: { asset_version_id: avatarId },
    voice: plan.voice || null,
    duration_seconds: Number.isFinite(plan.duration_seconds) ? plan.duration_seconds : null,
    presentation_size_code: presentationSizeCode
  };
  if (contract) {
    compiled.hifly_hands_on_product_v1 = contract;
    compiled.contract_id = contract.contract_id;
    compiled.video_plan_version_id = contract.plan.video_plan_version_id;
    compiled.plan_review_id = contract.plan.plan_review_id;
    compiled.product_revision_id = contract.product.revision_id;
    compiled.product_asset_version_id = contract.product.primary_asset_version_id;
    compiled.copy_version_id = contract.copy.version_id;
    compiled.avatar_selection_id = contract.avatar.selection_id;
    compiled.avatar_version_id = contract.avatar.avatar_version_id;
    compiled.avatar_material_version_id = contract.avatar.material_version_id;
    compiled.target_aspect_ratio = contract.production.target_aspect_ratio;
    compiled.handheld_aspect_ratio_policy = contract.production.handheld_aspect_ratio_policy;
    compiled.voice_source = contract.production.voice_source;
    compiled.voice_identity_policy = contract.production.voice_identity_policy;
    compiled.production_mode = contract.production.mode;
  }
  return compiled;
}

export const compileHandoffPackage = compilePackageToBatchItem;
