import { listPoolImageFiles } from "./core/person-pool-files.js";
import { resolvePersonStrategies } from "./core/person-strategy.js";

export function assignPersonImages(products, config, logger) {
  return resolvePersonStrategies(products, config, {
    person_strategy: config.personPool?.strategy || "auto_pool"
  }, logger);
}

export function listPersonPoolFiles(config, category) {
  // Containment (lexical + canonical realpath), regular-file filtering, and
  // project-root-relative POSIX path generation all live in the shared
  // person-pool-files helper.
  return listPoolImageFiles(config, normalizePathSegment(category));
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
