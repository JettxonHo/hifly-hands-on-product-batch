import fs from "node:fs";
import path from "node:path";
import { resolveFromRoot } from "./config.js";
import { resolvePersonStrategies } from "./core/person-strategy.js";
import { relativePortablePath } from "./core/portable-path.js";

const DEFAULT_EXTENSIONS = [".jpg", ".jpeg", ".png"];

export function assignPersonImages(products, config, logger) {
  return resolvePersonStrategies(products, config, {
    person_strategy: config.personPool?.strategy || "auto_pool"
  }, logger);
}

export function listPersonPoolFiles(config, category) {
  const rootDir = config.personPool?.rootDir || "assets/person_pool";
  const projectRoot = assertProjectRoot(config);
  const poolDir = path.join(resolveFromRoot(config, rootDir), normalizePathSegment(category));

  // Fail closed before touching the filesystem: the configured pool location
  // must resolve inside the project root. A traversal relative rootDir and an
  // absolute rootDir outside the project are both rejected here, before
  // existsSync/readdirSync ever read a directory outside the project.
  relativePortablePath(projectRoot, poolDir);

  if (!fs.existsSync(poolDir)) return [];

  const allowed = new Set(
    (config.personPool?.allowedExtensions || DEFAULT_EXTENSIONS)
      .map((extension) => extension.toLowerCase())
  );

  return fs.readdirSync(poolDir)
    .filter((fileName) => allowed.has(path.extname(fileName).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
    // Persisted paths are always recomputed relative to the project root:
    // the configured rootDir is a filesystem locator, not a persistable path.
    .map((fileName) => relativePortablePath(projectRoot, path.join(poolDir, fileName)));
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

function assertProjectRoot(config) {
  const projectRoot = config?.__rootDir;
  if (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot)) {
    throw new Error("person pool requires config.__rootDir to be an absolute project root");
  }
  return projectRoot;
}
