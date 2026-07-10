import fs from "node:fs";
import path from "node:path";
import { resolveFromRoot } from "./config.js";

const DEFAULT_EXTENSIONS = [".jpg", ".jpeg", ".png"];

export function assignPersonImages(products, config, logger) {
  if (!config.personPool?.enabled) return products;

  const counters = new Map();

  return products.map((product) => {
    if (product.person_image_path) return product;

    const category = normalizeCategory(product.category, config);
    const files = listPersonPoolFiles(config, category);
    const fallbackFiles = category === defaultCategory(config)
      ? []
      : listPersonPoolFiles(config, defaultCategory(config));
    const candidates = files.length > 0 ? files : fallbackFiles;

    if (candidates.length === 0) {
      logger?.info("person_pool_fallback_to_recommended", {
        sku: product.sku,
        category
      });
      return product;
    }

    const counterKey = files.length > 0 ? category : defaultCategory(config);
    const nextIndex = counters.get(counterKey) ?? 0;
    counters.set(counterKey, nextIndex + 1);

    const chosenPath = candidates[nextIndex % candidates.length];
    logger?.info("person_pool_assigned", {
      sku: product.sku,
      category,
      personImagePath: chosenPath
    });

    return {
      ...product,
      __resolved_person_image_path: chosenPath
    };
  });
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
