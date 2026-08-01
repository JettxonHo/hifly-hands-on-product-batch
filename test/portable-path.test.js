import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  toPortableRelativePath,
  relativePortablePath,
  fromPortablePath,
  assertSafeRelative
} from "../src/core/portable-path.js";

test("toPortableRelativePath converts backslash to forward slash", () => {
  assert.equal(toPortableRelativePath("artifacts\\video.mp4"), "artifacts/video.mp4");
  assert.equal(toPortableRelativePath("downloads\\sub\\file.mp4"), "downloads/sub/file.mp4");
  assert.equal(toPortableRelativePath("rpa\\inputs\\person.jpg"), "rpa/inputs/person.jpg");
});

test("toPortableRelativePath preserves forward slash paths", () => {
  assert.equal(toPortableRelativePath("artifacts/video.mp4"), "artifacts/video.mp4");
  assert.equal(toPortableRelativePath("downloads/sub/file.mp4"), "downloads/sub/file.mp4");
});

test("toPortableRelativePath handles empty and null", () => {
  assert.equal(toPortableRelativePath(""), "");
  assert.equal(toPortableRelativePath(null), null);
  assert.equal(toPortableRelativePath(undefined), undefined);
});

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

test("persisted fields never contain backslash on any platform", () => {
  // Simulate what Windows path.relative would produce
  const windowsStyle = "artifacts\\task-1-video.mp4";
  const portable = toPortableRelativePath(windowsStyle);
  assert.equal(portable.includes("\\"), false);
  assert.equal(portable, "artifacts/task-1-video.mp4");
});
