import { createHash } from "node:crypto";

import { fileTypeFromBuffer } from "file-type";

const ALLOWED_MEDIA_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const PROVIDER_KEY = /^hifly-public:[^\u0000-\u001f\u007f-\u009f]{1,256}$/u;
const SHA256 = /^[a-f0-9]{64}$/;

const failure = (code) => Object.assign(new Error(code), { code });

function normalizeInput(input = {}) {
  const providerKey = typeof (input.provider_key ?? input.providerKey) === "string"
    ? String(input.provider_key ?? input.providerKey).trim()
    : "";
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!PROVIDER_KEY.test(providerKey) || !title || title.length > 120) {
    throw failure("HIFLY_PUBLIC_AVATAR_THUMBNAIL_ID_INVALID");
  }
  return { provider_key: providerKey, title };
}

function safeMediaType(value) {
  if (typeof value !== "string") return "";
  return value.split(";", 1)[0].trim().toLowerCase();
}

/**
 * Read-only thumbnail boundary for the public Hifly avatar catalog.
 *
 * `read` is deliberately the only provider-facing seam. It receives the
 * exact provider key/title and must return an identity-bound object containing
 * bytes plus a claimed media type. The returned value never contains the
 * provider URL, credentials, object key, or browser profile information.
 */
export function createHiflyPublicAvatarThumbnailSource({ read, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  if (typeof read !== "function") throw new TypeError("read is required");
  if (!Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_MAX_BYTES) {
    throw failure("HIFLY_PUBLIC_AVATAR_THUMBNAIL_LIMIT_INVALID");
  }

  async function readValidated(input = {}) {
    const identity = normalizeInput(input);
    let raw;
    try {
      raw = await read(identity);
    } catch {
      throw failure("HIFLY_PUBLIC_AVATAR_THUMBNAIL_UNAVAILABLE");
    }
    if (raw == null) throw failure("HIFLY_PUBLIC_AVATAR_THUMBNAIL_UNAVAILABLE");

    const returnedProviderKey = typeof raw?.provider_key === "string" ? raw.provider_key.trim() : "";
    const returnedTitle = typeof raw?.title === "string" ? raw.title.trim() : "";
    if (returnedProviderKey !== identity.provider_key || returnedTitle !== identity.title) {
      throw failure("HIFLY_PUBLIC_AVATAR_THUMBNAIL_ID_MISMATCH");
    }
    const bytes = raw?.bytes;
    const claimedMediaType = safeMediaType(raw?.media_type ?? raw?.mediaType);
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > maxBytes || !claimedMediaType || !ALLOWED_MEDIA_TYPES.has(claimedMediaType) ||
        !Number.isInteger(raw.size) || raw.size < 1 || !SHA256.test(String(raw.checksum_sha256 || ""))) {
      throw failure("HIFLY_PUBLIC_AVATAR_THUMBNAIL_INVALID");
    }

    let detected;
    try { detected = await fileTypeFromBuffer(bytes); }
    catch { throw failure("HIFLY_PUBLIC_AVATAR_THUMBNAIL_INVALID"); }
    if (!detected) throw failure("HIFLY_PUBLIC_AVATAR_THUMBNAIL_INVALID");
    if (detected.mime !== claimedMediaType) {
      throw failure("HIFLY_PUBLIC_AVATAR_THUMBNAIL_MEDIA_MISMATCH");
    }

    const size = bytes.length;
    const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
    if (raw.size !== size || String(raw.checksum_sha256) !== checksumSha256) {
      throw failure("HIFLY_PUBLIC_AVATAR_THUMBNAIL_INVALID");
    }
    return { bytes, media_type: claimedMediaType, size, checksum_sha256: checksumSha256 };
  }

  return { read: readValidated, readThumbnail: readValidated, getThumbnail: readValidated };
}

export function createDisabledHiflyPublicAvatarThumbnailSource() {
  return createHiflyPublicAvatarThumbnailSource({
    async read() { throw failure("HIFLY_PUBLIC_AVATAR_THUMBNAIL_UNAVAILABLE"); }
  });
}

export const createPublicAvatarThumbnailSource = createHiflyPublicAvatarThumbnailSource;
