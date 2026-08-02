import path from "node:path";

/**
 * Convert OS-native path separators to portable POSIX "/" separators.
 *
 * UNSAFE: this performs separator conversion ONLY. It does not validate
 * types, empty values, traversal, absolute paths, or empty segments, and it
 * must never be used directly at a persistence boundary. It is private to
 * this module; callers must use the safe public API below, which validates
 * after normalizing.
 *
 * @param {string} value
 * @returns {string} The same path with every backslash replaced by "/".
 */
function normalizePortableSeparatorsUnsafe(value) {
  return value.replaceAll("\\", "/");
}

/**
 * Convert an OS-native relative path to a validated portable POSIX relative path.
 *
 * Safe by default (fail-closed):
 * - The value MUST be a string; null, undefined, numbers, booleans, and
 *   objects are rejected.
 * - Backslash separators are normalized to "/" BEFORE validation.
 * - Empty strings and "." are rejected: an absent optional path must be
 *   represented by a null or omitted field, never by "" or ".".
 * - Absolute paths (POSIX, Windows drive-letter, and UNC) are rejected.
 * - Traversal (".."), dot ("."), and empty ("a//b", "a/") segments are
 *   rejected.
 * - Nothing is silently repaired: no trimming, no collapsing of duplicate
 *   separators, no treating "." as a path, and no truncating absolute paths
 *   into relative ones.
 *
 * Validation is OS-independent (it runs on the normalized POSIX form), so
 * Ubuntu and Windows enforce identical rules.
 *
 * @param {string} relativePath - A relative path using OS-native separators.
 * @returns {string} The validated path with POSIX "/" separators.
 * @throws {TypeError} If the value is not a string.
 * @throws {Error} If the path is not a safe relative path.
 */
export function toPortableRelativePath(relativePath) {
  if (typeof relativePath !== "string") {
    throw new TypeError(`Portable path must be a string, received ${describeValue(relativePath)}`);
  }
  const normalized = normalizePortableSeparatorsUnsafe(relativePath);
  assertSafePortableNormalized(normalized);
  return normalized;
}

/**
 * Compute a portable relative path from `from` to `to`, both absolute.
 * Performs security validation: rejects `..` traversal, absolute results,
 * Windows drive crossings, and a same-directory result (""): the portable
 * format has no representation for "the root itself".
 *
 * @param {string} from - Absolute base directory.
 * @param {string} to - Absolute target path.
 * @returns {string} POSIX-separated relative path.
 * @throws {Error} If the result escapes the base directory or is empty.
 */
export function relativePortablePath(from, to) {
  // path.relative emits traversal ("..") or absolute (drive-crossing) results
  // when `to` is not inside `from`; toPortableRelativePath rejects all of
  // those, plus the empty same-directory result.
  return toPortableRelativePath(path.relative(from, to));
}

/**
 * Resolve a portable relative path against an absolute root, returning an OS-native absolute path.
 * Performs security validation: the portable path must pass the same safe
 * boundary as toPortableRelativePath, so "..", absolute inputs, UNC, and
 * Windows drive escapes are rejected and the result cannot leave the root.
 *
 * @param {string} root - Absolute root directory.
 * @param {string} portableRelative - POSIX-separated relative path.
 * @returns {string} OS-native absolute path.
 * @throws {Error} If the relative path is unsafe.
 */
export function fromPortablePath(root, portableRelative) {
  const portable = toPortableRelativePath(portableRelative);
  return path.join(root, portable.split("/").join(path.sep));
}

/**
 * Validate that a relative path is safe (no traversal, not absolute, no empty segments).
 *
 * @param {string} relativePath
 * @throws {Error} If the path is unsafe.
 */
export function assertSafeRelative(relativePath) {
  if (!relativePath || relativePath === ".") return;
  // Reject absolute paths (POSIX and Windows)
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Path must be relative: ${relativePath}`);
  }
  // Reject Windows drive-letter paths
  if (/^[a-zA-Z]:/.test(relativePath)) {
    throw new Error(`Path must be relative: ${relativePath}`);
  }
  // Reject UNC paths
  if (relativePath.startsWith("\\\\")) {
    throw new Error(`Path must be relative: ${relativePath}`);
  }
  // Reject consecutive separators (empty segments)
  if (/[\\/]{2}/.test(relativePath)) {
    throw new Error(`Path must not contain empty segments: ${relativePath}`);
  }
  // Reject path traversal
  const segments = relativePath.split(/[\\/]+/);
  for (const segment of segments) {
    if (segment === "..") {
      throw new Error(`Path must not contain traversal: ${relativePath}`);
    }
    if (segment === "") {
      throw new Error(`Path must not contain empty segments: ${relativePath}`);
    }
  }
}

function describeValue(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

// Validates the normalized (POSIX "/" separator) form. Rules are explicit and
// OS-independent so both CI platforms fail closed on identical inputs.
function assertSafePortableNormalized(normalized) {
  if (normalized === "") {
    throw new Error("Portable path must not be empty");
  }
  if (normalized === ".") {
    throw new Error('Portable path must not be a bare "." segment');
  }
  // Reject absolute paths: POSIX rooted (which also covers UNC "//server/..."),
  // and Windows drive-letter forms (which normalization turns into "C:/...").
  if (normalized.startsWith("/") || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error(`Path must be relative: ${normalized}`);
  }
  for (const segment of normalized.split("/")) {
    if (segment === "..") {
      throw new Error(`Path must not contain traversal: ${normalized}`);
    }
    if (segment === ".") {
      throw new Error(`Path must not contain "." segments: ${normalized}`);
    }
    if (segment === "") {
      throw new Error(`Path must not contain empty segments: ${normalized}`);
    }
  }
}
