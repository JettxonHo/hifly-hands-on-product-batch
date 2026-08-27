import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createHiflyPublicAvatarThumbnailSource } from "../src/providers/hifly-public-avatar-thumbnail-source.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const PNG_SHA256 = createHash("sha256").update(PNG).digest("hex");

test("public avatar thumbnail source returns validated bytes and a provider-neutral checksum", async () => {
  const calls = [];
  const source = createHiflyPublicAvatarThumbnailSource({
    async read(input) {
      calls.push(input);
      return { provider_key: input.provider_key, title: input.title, bytes: PNG, media_type: "image/png",
        size: PNG.length, checksum_sha256: PNG_SHA256 };
    }
  });

  const result = await source.read({ provider_key: "hifly-public:101", title: "林小满" });

  assert.deepEqual(result, {
    bytes: PNG,
    media_type: "image/png",
    size: PNG.length,
    checksum_sha256: PNG_SHA256
  });
  assert.deepEqual(calls, [{ provider_key: "hifly-public:101", title: "林小满" }]);
  assert.equal(JSON.stringify(result).includes("hifly.cc"), false);
  assert.equal(JSON.stringify(result).includes("token"), false);
});

test("public avatar thumbnail source fails closed for missing, mismatched, corrupt, and oversized sources", async () => {
  const cases = [
    ["missing", async () => null, "HIFLY_PUBLIC_AVATAR_THUMBNAIL_UNAVAILABLE"],
    ["mismatched", async (input) => ({ provider_key: input.provider_key, title: input.title, bytes: PNG, media_type: "image/jpeg", size: PNG.length, checksum_sha256: PNG_SHA256 }), "HIFLY_PUBLIC_AVATAR_THUMBNAIL_MEDIA_MISMATCH"],
    ["corrupt", async (input) => ({ provider_key: input.provider_key, title: input.title, bytes: Buffer.from("not-an-image"), media_type: "image/png", size: 11, checksum_sha256: "0".repeat(64) }), "HIFLY_PUBLIC_AVATAR_THUMBNAIL_INVALID"],
    ["oversized", async (input) => ({ provider_key: input.provider_key, title: input.title, bytes: Buffer.concat([PNG, Buffer.alloc(10)]), media_type: "image/png", size: PNG.length + 10, checksum_sha256: "0".repeat(64) }), "HIFLY_PUBLIC_AVATAR_THUMBNAIL_INVALID"]
  ];
  for (const [name, read, code] of cases) {
    const source = createHiflyPublicAvatarThumbnailSource({ read, maxBytes: PNG.length });
    await assert.rejects(source.read({ provider_key: "hifly-public:101", title: "林小满" }), { code }, name);
  }
});

test("public avatar thumbnail source rejects provider identity drift before reading", async () => {
  let calls = 0;
  const source = createHiflyPublicAvatarThumbnailSource({
    async read(input) { calls += 1; return { provider_key: input.provider_key, title: input.title, bytes: PNG, media_type: "image/png", size: PNG.length, checksum_sha256: PNG_SHA256 }; }
  });

  await assert.rejects(source.read({ provider_key: "other:101", title: "林小满" }), { code: "HIFLY_PUBLIC_AVATAR_THUMBNAIL_ID_INVALID" });
  await assert.rejects(source.read({ provider_key: "hifly-public:101", title: "" }), { code: "HIFLY_PUBLIC_AVATAR_THUMBNAIL_ID_INVALID" });
  assert.equal(calls, 0);
});

test("public avatar thumbnail source accepts colon and Unicode identities but rejects controls", async () => {
  const source = createHiflyPublicAvatarThumbnailSource({
    async read(input) {
      return { provider_key: input.provider_key, title: input.title, bytes: PNG, media_type: "image/png",
        size: PNG.length, checksum_sha256: PNG_SHA256 };
    }
  });
  const result = await source.read({ provider_key: "hifly-public:人物:甲", title: "林小满" });
  assert.equal(result.checksum_sha256, PNG_SHA256);
  await assert.rejects(source.read({ provider_key: "hifly-public:人物\u0000甲", title: "林小满" }),
    { code: "HIFLY_PUBLIC_AVATAR_THUMBNAIL_ID_INVALID" });
  await assert.rejects(source.read({ provider_key: "hifly-public:人物\u0080甲", title: "林小满" }),
    { code: "HIFLY_PUBLIC_AVATAR_THUMBNAIL_ID_INVALID" });
  await assert.rejects(source.read({ provider_key: "hifly-public:", title: "林小满" }),
    { code: "HIFLY_PUBLIC_AVATAR_THUMBNAIL_ID_INVALID" });
});

test("public avatar thumbnail source rejects late or cross-item provider bytes", async () => {
  const source = createHiflyPublicAvatarThumbnailSource({
    async read(input) {
      return { provider_key: input.provider_key === "hifly-public:101" ? "hifly-public:102" : input.provider_key,
        title: input.title, bytes: PNG, media_type: "image/png", size: PNG.length, checksum_sha256: PNG_SHA256 };
    }
  });
  await assert.rejects(source.read({ provider_key: "hifly-public:101", title: "林小满" }), { code: "HIFLY_PUBLIC_AVATAR_THUMBNAIL_ID_MISMATCH" });
});

test("public avatar thumbnail source rejects claimed size and checksum drift", async () => {
  const source = createHiflyPublicAvatarThumbnailSource({
    async read(input) {
      return { provider_key: input.provider_key, title: input.title, bytes: PNG, media_type: "image/png",
        size: PNG.length + 1, checksum_sha256: "f".repeat(64) };
    }
  });
  await assert.rejects(source.read({ provider_key: "hifly-public:101", title: "林小满" }), { code: "HIFLY_PUBLIC_AVATAR_THUMBNAIL_INVALID" });
});
