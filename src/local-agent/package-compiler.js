import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

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

function productAsset(manifest) {
  const references = Array.isArray(manifest.asset_references) ? manifest.asset_references : [];
  return references.find((reference) => PRODUCT_IMAGE_ROLES.has(text(reference?.role)));
}

function productUploadExtension(reference) {
  if (reference?.media_type === "image/png") return ".png";
  if (reference?.media_type === "image/jpeg") return ".jpg";
  throw localAgentError("LOCAL_AGENT_PACKAGE_INVALID");
}

export async function compilePackageToBatchItem({ manifest, extractionRoot, avatarMappings = {}, taskId } = {}) {
  if (!manifest || typeof manifest !== "object" || !text(extractionRoot)) throw localAgentError("LOCAL_AGENT_PACKAGE_INVALID");
  const itemCount = declaredItemCount(manifest);
  if (itemCount !== 1) {
    throw localAgentError("PACKAGE_ITEM_COUNT_UNSUPPORTED", { outcome: "requires_action" });
  }

  const avatarId = avatarVersionId(manifest);
  const avatarPath = avatarPathFor(avatarMappings, avatarId);
  if (!avatarId || !avatarPath) throw localAgentError("AVATAR_MAPPING_REQUIRED", { outcome: "requires_action" });
  await assertLocalFile(avatarPath, "AVATAR_MAPPING_REQUIRED");

  const reference = productAsset(manifest);
  const assetVersionId = text(reference?.asset_version_id);
  if (!assetVersionId) throw localAgentError("LOCAL_AGENT_PACKAGE_INVALID");
  const packagedImagePath = packagePath(extractionRoot, path.posix.join("assets", assetVersionId));
  await assertLocalFile(packagedImagePath, "LOCAL_AGENT_PACKAGE_INVALID");
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

  return {
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
}

export const compileHandoffPackage = compilePackageToBatchItem;
