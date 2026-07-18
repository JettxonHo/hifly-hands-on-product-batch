import fs from "node:fs";
import path from "node:path";
import { resolveFromRoot } from "./config.js";
import { resolvePersonStrategies } from "./core/person-strategy.js";

const DEFAULT_EXTENSIONS = [".jpg", ".jpeg", ".png"];

export function assignPersonImages(products, config, logger) {
  return resolvePersonStrategies(products, config, {
    person_strategy: config.personPool?.strategy || "auto_pool"
  }, logger);
}

export function listPersonPoolFiles(config, category) {
  const rootDir = config.personPool?.rootDir || "assets/person_pool";
  const absoluteDir = path.join(resolveFromRoot(config, rootDir), normalizePathSegment(category));
  const relativeDir = path.join(rootDir, normalizePathSegment(category));

  if (!fs.existsSync(absoluteDir)) return [];

  const allowed = new Set(
    (config.personPool?.allowedExtensions || DEFAULT_EXTENSIONS)
      .map((extension) => extension.toLowerCase())
  );

  return fs.readdirSync(absoluteDir)
    .filter((fileName) => allowed.has(path.extname(fileName).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
    .map((fileName) => path.join(relativeDir, fileName));
}

export function normalizeCategory(category, config) {
  const trimmed = String(category || "").trim();
  return trimmed ? normalizePathSegment(trimmed) : defaultCategory(config);
}

function defaultCategory(config) {
  return normalizePathSegment(config.personPool?.defaultCategory || "default");
}

function normalizePathSegment(value) {
  return String(value || "default")
    .trim()
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .toLowerCase();
}
