import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const EXECUTION_FIELDS = Object.freeze([
  "task_id",
  "sku",
  "product_name",
  "selling_points",
  "category",
  "image_path",
  "person_image_path",
  "resolved_person_image_path",
  "resolved_person_source",
  "script",
  "resolved_script_mode",
  "avatar",
  "voice",
  "duration_seconds"
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function digestImage(filePath, projectRoot) {
  if (filePath == null || filePath === "") return null;
  const resolved = path.isAbsolute(filePath) ? filePath : path.resolve(projectRoot, filePath);
  return sha256(await readFile(resolved));
}

function normalizeTask(task) {
  const normalized = {};
  for (const field of EXECUTION_FIELDS) normalized[field] = task[field] ?? null;
  return normalized;
}

function createEstimate(itemCount, config) {
  const values = {
    assetPointsPerItem: config.assetPointsPerItem,
    videoPointsEstimate: config.videoPointsEstimate
  };
  const unknownComponents = Object.entries(values)
    .filter(([, value]) => typeof value !== "number" || !Number.isFinite(value) || value < 0)
    .map(([name]) => name);
  const known = unknownComponents.length === 0;

  return {
    known,
    version: config.version ?? null,
    itemCount,
    assetPointsPerItem: typeof values.assetPointsPerItem === "number" ? values.assetPointsPerItem : null,
    videoPointsEstimate: typeof values.videoPointsEstimate === "number" ? values.videoPointsEstimate : null,
    total: known ? itemCount * (values.assetPointsPerItem + values.videoPointsEstimate) : null,
    unknownComponents
  };
}

export async function createExecutionSnapshot(items, estimateConfig = {}) {
  if (!Array.isArray(items) || items.length === 0) throw new Error("At least one task is required");
  const projectRoot = estimateConfig.projectRoot ?? process.cwd();
  const taskIds = new Set();
  const normalizedItems = [];

  for (const item of items) {
    if (typeof item?.task_id !== "string" || item.task_id.length === 0) throw new Error("Each task requires task_id");
    if (taskIds.has(item.task_id)) throw new Error(`Duplicate task_id: ${item.task_id}`);
    taskIds.add(item.task_id);
    const normalized = normalizeTask(item);
    normalized.image_digest = await digestImage(item.image_path, projectRoot);
    normalized.person_image_digest = await digestImage(
      item.resolved_person_image_path || item.person_image_path,
      projectRoot
    );
    normalizedItems.push(normalized);
  }

  normalizedItems.sort((left, right) => left.task_id.localeCompare(right.task_id));
  const digest = sha256(canonicalJson(normalizedItems));
  const estimate = createEstimate(normalizedItems.length, estimateConfig);
  const confirmedAt = estimateConfig.confirmedAt ?? null;
  const executionKey = sha256(canonicalJson({ digest, estimate, confirmedAt }));

  return { executionKey, digest, estimate, confirmedAt, items: normalizedItems };
}

export const SNAPSHOT_EXECUTION_FIELDS = EXECUTION_FIELDS;
