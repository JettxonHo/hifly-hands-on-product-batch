import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import {
  toPortableRelativePath,
  relativePortablePath,
  fromPortablePath,
  assertSafeRelative
} from "../src/core/portable-path.js";

// 7.1 Basic normalization -------------------------------------------------

test("toPortableRelativePath converts backslash to forward slash", () => {
  assert.equal(toPortableRelativePath("artifacts\\video.mp4"), "artifacts/video.mp4");
  assert.equal(toPortableRelativePath("downloads\\sub\\file.mp4"), "downloads/sub/file.mp4");
  assert.equal(toPortableRelativePath("rpa\\inputs\\person.jpg"), "rpa/inputs/person.jpg");
});

test("toPortableRelativePath preserves forward slash paths", () => {
  assert.equal(toPortableRelativePath("artifacts/video.mp4"), "artifacts/video.mp4");
  assert.equal(toPortableRelativePath("downloads/sub/file.mp4"), "downloads/sub/file.mp4");
});

test("toPortableRelativePath keeps Unicode filenames and legitimate spaces unchanged", () => {
  assert.equal(toPortableRelativePath("中文目录\\图片.png"), "中文目录/图片.png");
  assert.equal(toPortableRelativePath("folder name/file name.png"), "folder name/file name.png");
  assert.equal(
    toPortableRelativePath("person-pool\\category\\未命名 作品.mp4"),
    "person-pool/category/未命名 作品.mp4"
  );
});

// 7.2 Types and empty values ----------------------------------------------

test("toPortableRelativePath rejects empty and non-string values", () => {
  // Non-strings fail with a boundary TypeError, never a downstream fs error.
  assert.throws(() => toPortableRelativePath(null), TypeError);
  assert.throws(() => toPortableRelativePath(undefined), TypeError);
  assert.throws(() => toPortableRelativePath(0), TypeError);
  assert.throws(() => toPortableRelativePath(false), TypeError);
  assert.throws(() => toPortableRelativePath({}), TypeError);
  assert.throws(() => toPortableRelativePath([]), TypeError);
  assert.throws(() => toPortableRelativePath(null), /Portable path must be a string/);
  // "" and "." are not valid paths: absence is expressed by null or an
  // omitted field, never by an empty or dot portable path.
  assert.throws(() => toPortableRelativePath(""), /must not be empty/);
  assert.throws(() => toPortableRelativePath("."), /bare "\." segment/);
});

// 7.3 Traversal -------------------------------------------------------------

test("toPortableRelativePath rejects traversal in POSIX and Windows spellings", () => {
  assert.throws(() => toPortableRelativePath("../secret"), /traversal/);
  assert.throws(() => toPortableRelativePath("..\\secret"), /traversal/);
  assert.throws(() => toPortableRelativePath("folder/../secret"), /traversal/);
  assert.throws(() => toPortableRelativePath("folder\\..\\secret"), /traversal/);
  assert.throws(() => toPortableRelativePath("folder/../../secret"), /traversal/);
});

// 7.4 Absolute paths ----------------------------------------------------------

test("toPortableRelativePath rejects absolute POSIX, Windows, and UNC forms", () => {
  assert.throws(() => toPortableRelativePath("/var/data/file"), /relative/);
  assert.throws(() => toPortableRelativePath("/absolute/path"), /relative/);
  assert.throws(() => toPortableRelativePath("C:\\data\\file"), /relative/);
  assert.throws(() => toPortableRelativePath("C:/data/file"), /relative/);
  assert.throws(() => toPortableRelativePath("c:/data/file"), /relative/);
  assert.throws(() => toPortableRelativePath("\\\\server\\share\\file"), /relative/);
  assert.throws(() => toPortableRelativePath("//server/share/file"), /relative/);
  // A single leading backslash normalizes to "/rooted/file" and is rejected too.
  assert.throws(() => toPortableRelativePath("\\rooted\\file"), /relative/);
});

// 7.5 Segments -----------------------------------------------------------------

test("toPortableRelativePath rejects empty and dot segments instead of repairing them", () => {
  assert.throws(() => toPortableRelativePath("folder//file"), /empty segments/);
  assert.throws(() => toPortableRelativePath("folder\\\\file"), /empty segments/);
  assert.throws(() => toPortableRelativePath("artifacts//file.mp4"), /empty segments/);
  assert.throws(() => toPortableRelativePath("artifacts\\\\file.mp4"), /empty segments/);
  assert.throws(() => toPortableRelativePath("artifacts/./file.mp4"), /"\." segments/);
  assert.throws(() => toPortableRelativePath("folder/./file"), /"\." segments/);
  assert.throws(() => toPortableRelativePath("folder/"), /empty segments/);
  assert.throws(() => toPortableRelativePath("artifacts/"), /empty segments/);
});

test("toPortableRelativePath accepts valid relative paths", () => {
  assert.equal(toPortableRelativePath("folder/file"), "folder/file");
  assert.equal(toPortableRelativePath("folder name/file name.png"), "folder name/file name.png");
  assert.equal(toPortableRelativePath("中文目录/图片.png"), "中文目录/图片.png");
});

// relativePortablePath / fromPortablePath -----------------------------------

test("relativePortablePath produces POSIX path from absolute paths", () => {
  const root = path.resolve("/project/root");
  const target = path.resolve("/project/root/artifacts/video.mp4");
  const result = relativePortablePath(root, target);
  assert.equal(result, "artifacts/video.mp4");
  assert.equal(result.includes("\\"), false);
});

test("relativePortablePath rejects traversal", () => {
  const root = path.resolve("/project/root");
  const target = path.resolve("/project/secret");
  assert.throws(() => relativePortablePath(root, target), /traversal/);
});

test("relativePortablePath rejects a same-directory result (root === target)", () => {
  const root = path.resolve("/project/root");
  // path.relative yields "" when both arguments resolve to the same directory;
  // the portable format has no legal empty or "." representation for "root itself".
  assert.throws(() => relativePortablePath(root, root), /must not be empty/);
});

test("assertSafeRelative rejects absolute POSIX paths", () => {
  assert.throws(() => assertSafeRelative("/absolute/path"), /relative/);
});

test("assertSafeRelative rejects Windows absolute paths", () => {
  assert.throws(() => assertSafeRelative("C:\\absolute\\path"), /relative/);
  assert.throws(() => assertSafeRelative("c:/absolute/path"), /relative/);
});

test("assertSafeRelative rejects UNC paths", () => {
  assert.throws(() => assertSafeRelative("\\\\server\\share"), /relative/);
});

test("assertSafeRelative rejects traversal segments", () => {
  assert.throws(() => assertSafeRelative("../secret"), /traversal/);
  assert.throws(() => assertSafeRelative("..\\secret"), /traversal/);
  assert.throws(() => assertSafeRelative("artifacts/../secret"), /traversal/);
});

test("assertSafeRelative rejects empty segments", () => {
  assert.throws(() => assertSafeRelative("artifacts//video.mp4"), /empty/);
});

test("assertSafeRelative accepts valid relative paths", () => {
  assert.doesNotThrow(() => assertSafeRelative("artifacts/video.mp4"));
  assert.doesNotThrow(() => assertSafeRelative("downloads/sub/file.mp4"));
  assert.doesNotThrow(() => assertSafeRelative("rpa/inputs/person.jpg"));
});

test("fromPortablePath resolves POSIX relative to OS-native absolute", () => {
  const root = path.resolve("/project/root");
  const result = fromPortablePath(root, "artifacts/video.mp4");
  assert.equal(result, path.join(root, "artifacts", "video.mp4"));
});

test("fromPortablePath rejects traversal in portable path", () => {
  const root = path.resolve("/project/root");
  assert.throws(() => fromPortablePath(root, "../secret"), /traversal/);
});

test("fromPortablePath rejects absolute, UNC, and empty portable paths", () => {
  const root = path.resolve("/project/root");
  assert.throws(() => fromPortablePath(root, "/absolute/path"), /relative/);
  assert.throws(() => fromPortablePath(root, "C:/data/file"), /relative/);
  assert.throws(() => fromPortablePath(root, "//server/share/file"), /relative/);
  assert.throws(() => fromPortablePath(root, ""), /must not be empty/);
  assert.throws(() => fromPortablePath(root, "."), /bare "\." segment/);
});

// 7.6 Round trip --------------------------------------------------------------

test("round trip: OS path → portable → resolve back stays within root", () => {
  const root = path.resolve("/project/root");
  const absoluteTarget = path.join(root, "downloads", "sub", "video.mp4");
  const portable = relativePortablePath(root, absoluteTarget);
  assert.equal(portable, "downloads/sub/video.mp4");
  const resolved = fromPortablePath(root, portable);
  assert.equal(resolved, absoluteTarget);
  // Verify containment
  const rel = path.relative(root, resolved);
  assert.equal(rel.startsWith(".."), false);
  assert.equal(path.isAbsolute(rel), false);
});

test("round trip on a real OS-native tmp root behaves identically on any platform", () => {
  // Uses the host tmpdir so the root is a genuine absolute path on both
  // Ubuntu ("/tmp/...") and Windows ("C:\\Users\\...") without mounting drives.
  const root = path.resolve(os.tmpdir(), "portable-path-roundtrip");
  const absoluteTarget = path.join(root, "artifacts", "sub dir", "未命名.mp4");
  const portable = relativePortablePath(root, absoluteTarget);
  assert.equal(portable, "artifacts/sub dir/未命名.mp4");
  assert.equal(portable.includes("\\"), false);
  const resolved = fromPortablePath(root, portable);
  assert.equal(resolved, absoluteTarget);
  const rel = path.relative(root, resolved);
  assert.equal(rel.startsWith(".."), false);
  assert.equal(path.isAbsolute(rel), false);
});

// 7.7 Cross-drive / UNC / root escape (deterministic, no real drive mounts) ---

test("drive, UNC, and rooted inputs are rejected identically on every platform", () => {
  // Pure string validation runs on the normalized POSIX form, so these rules
  // do not depend on the host OS path semantics.
  const unsafe = [
    "C:\\absolute\\path",
    "C:/absolute/path",
    "\\\\server\\share",
    "//server/share",
    "\\rooted\\file",
    "/var/data/file"
  ];
  for (const value of unsafe) {
    assert.throws(() => toPortableRelativePath(value), /relative/, `expected rejection: ${value}`);
    assert.throws(() => fromPortablePath(path.resolve("/project/root"), value), /relative/);
  }
});

test("relativePortablePath fails closed when the target leaves the root", () => {
  const root = path.resolve("/project/root");
  // Sibling escape: path.relative emits ".." traversal on every platform.
  assert.throws(() => relativePortablePath(root, path.resolve("/project/other/file.mp4")));
  // Windows drive-crossing shape: rejected as traversal on POSIX hosts and as
  // an absolute drive result on Windows hosts — fail-closed on both.
  assert.throws(() => relativePortablePath(root, "D:\\other\\file.mp4"));
});

// Persistence format regression ------------------------------------------------

test("persisted fields never contain backslash on any platform", () => {
  // Simulate what Windows path.relative would produce
  const windowsStyle = "artifacts\\task-1-video.mp4";
  const portable = toPortableRelativePath(windowsStyle);
  assert.equal(portable.includes("\\"), false);
  assert.equal(portable, "artifacts/task-1-video.mp4");
});
