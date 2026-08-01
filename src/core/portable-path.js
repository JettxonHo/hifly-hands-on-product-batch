import path from "node:path";

/**
 * Convert an OS-native relative path to a portable POSIX relative path.
 *
 * Rules:
 * - The input MUST already be verified as a safe relative path (no `..`, not absolute).
 * - This function only normalizes separators; it does NOT perform security validation.
 * - Callers must validate BEFORE calling this function.
 *
 * @param {string} relativePath - A relative path using OS-native separators.
 * @returns {string} The same path with POSIX `/` separators.
 */
export function toPortableRelativePath(relativePath) {
  if (!relativePath) return relativePath;
  // path.relative and path.join on Windows produce backslash-separated paths.
  // Split on both separators and rejoin with POSIX slash.
  return relativePath.split(/[\\/]+/).join("/");
}

/**
 * Compute a portable relative path from `from` to `to`, both absolute.
 * Performs security validation: rejects `..` traversal and absolute results.
 *
 * @param {string} from - Absolute base directory.
 * @param {string} to - Absolute target path.
 * @returns {string} POSIX-separated relative path.
 * @throws {Error} If the result escapes the base directory.
 */
export function relativePortablePath(from, to) {
  const relative = path.relative(from, to);
  assertSafeRelative(relative);
  return toPortableRelativePath(relative);
}

/**
 * Resolve a portable relative path against an absolute root, returning an OS-native absolute path.
 * Performs security validation: rejects `..` traversal and absolute inputs.
 *
 * @param {string} root - Absolute root directory.
 * @param {string} portableRelative - POSIX-separated relative path.
 * @returns {string} OS-native absolute path.
 * @throws {Error} If the relative path is unsafe.
 */
export function fromPortablePath(root, portableRelative) {
  assertSafeRelative(portableRelative);
  // Normalize POSIX separators to OS-native for path.join
  const nativeRelative = portableRelative.split("/").join(path.sep);
  return path.join(root, nativeRelative);
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
