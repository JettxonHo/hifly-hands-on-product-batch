import fs from "node:fs";
import path from "node:path";
import { resolveFromRoot } from "../config.js";
import { relativePortablePath } from "./portable-path.js";

const DEFAULT_EXTENSIONS = [".jpg", ".jpeg", ".png"];

/**
 * Enumerate person-pool images in a category directory under strict
 * containment. This is the SINGLE shared implementation used by both
 * person-pool.js and person-strategy.js so the two production call sites
 * cannot drift.
 *
 * Safety flow (fail-closed at every stage):
 * 1. config.__rootDir must be an absolute project root (stable boundary error).
 * 2. The configured pool rootDir (relative or absolute) is resolved to an
 *    absolute filesystem path via resolveFromRoot; the category segment is
 *    appended.
 * 3. LEXICAL containment (relativePortablePath) rejects traversal, outside
 *    absolute paths, and cross-drive paths BEFORE any filesystem operation —
 *    external directories are never even stat'ed for these.
 * 4. Missing category directory → [].
 * 5. CANONICAL containment: the project root and the pool directory are
 *    canonicalized with realpath; the canonical pool must equal the canonical
 *    project root joined with the lexical relative path. Any intermediate
 *    directory symlink or Windows junction that redirects the pool (outside
 *    the project, or anywhere the lexical path does not denote) is rejected
 *    BEFORE readdirSync. The project root itself may be reached through a
 *    symlink — it is canonicalized consistently on both sides.
 * 6. Enumeration accepts ONLY regular files (dirent.isFile()) with an allowed
 *    extension: symlinked image entries, directories, sockets, and devices
 *    are never candidates and can never be selected or persisted.
 * 7. Persisted paths are recomputed as POSIX paths relative to the project
 *    root (relativePortablePath); the configured rootDir is a filesystem
 *    locator, never a persisted value.
 *
 * @param {object} config - Must carry an absolute __rootDir.
 * @param {string} categorySegment - Already-normalized category path segment.
 * @returns {string[]} Project-root-relative POSIX paths, zh-Hans-CN sorted.
 */
export function listPoolImageFiles(config, categorySegment) {
  const projectRoot = assertProjectRoot(config);
  const rootDir = config.personPool?.rootDir || "assets/person_pool";
  const poolDir = path.join(resolveFromRoot(config, rootDir), categorySegment);

  // Lexical containment before any filesystem operation.
  relativePortablePath(projectRoot, poolDir);

  if (!fs.existsSync(poolDir)) return [];

  // Canonical containment before readdirSync: intermediate symlinks/junctions
  // must not redirect the pool directory.
  assertCanonicalContainment(projectRoot, poolDir);

  const allowed = new Set(
    (config.personPool?.allowedExtensions || DEFAULT_EXTENSIONS)
      .map((extension) => extension.toLowerCase())
  );

  return fs.readdirSync(poolDir, { withFileTypes: true })
    // Regular files only: symlinked images are never candidates.
    .filter((dirent) => dirent.isFile() && allowed.has(path.extname(dirent.name).toLowerCase()))
    .map((dirent) => dirent.name)
    .sort((a, b) => a.localeCompare(b, "zh-Hans-CN"))
    .map((fileName) => relativePortablePath(projectRoot, path.join(poolDir, fileName)));
}

function assertProjectRoot(config) {
  const projectRoot = config?.__rootDir;
  if (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot)) {
    throw new Error("person pool requires config.__rootDir to be an absolute project root");
  }
  return projectRoot;
}

function assertCanonicalContainment(projectRoot, poolDir) {
  let canonicalProjectRoot;
  let canonicalPool;
  try {
    canonicalProjectRoot = fs.realpathSync(projectRoot);
    canonicalPool = fs.realpathSync(poolDir);
  } catch {
    throw new Error("Person pool path must resolve to a real directory inside the project root");
  }
  const lexicalRelative = path.relative(projectRoot, poolDir);
  const expectedCanonicalPool = path.join(canonicalProjectRoot, lexicalRelative);
  // Platform-aware equivalence (Windows case-insensitivity and separator
  // normalization): identical exactly when path.relative yields "".
  if (path.relative(expectedCanonicalPool, canonicalPool) !== "") {
    throw new Error("Person pool path must not traverse symlinks or junctions");
  }
}
