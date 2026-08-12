import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_KINDS = new Set(["product_image", "avatar_image"]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };

function validateCreate(input) {
  if (typeof input.filename !== "string" || !input.filename.trim() || input.filename.length > 255) fail("INVALID_ASSET_PAYLOAD");
  if (!ALLOWED_TYPES.has(input.contentType)) fail("ASSET_TYPE_NOT_ALLOWED");
  if (!Number.isInteger(input.size) || input.size < 1 || input.size > MAX_IMAGE_BYTES) fail("ASSET_SIZE_NOT_ALLOWED");
  if (!/^[a-f0-9]{64}$/.test(input.checksumSha256 || "")) fail("INVALID_ASSET_CHECKSUM");
  if (input.assetId != null && !UUID.test(input.assetId)) fail("INVALID_ASSET_ID");
  if (typeof input.actorMemberId !== "string" || !input.actorMemberId) fail("INVALID_ASSET_ACTOR");
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 1 || input.idempotencyKey.length > 128) fail("INVALID_IDEMPOTENCY_KEY");
  const assetKind = input.assetKind == null ? "product_image" : input.assetKind;
  if (!ALLOWED_KINDS.has(assetKind)) fail("ASSET_KIND_NOT_ALLOWED");
  return assetKind;
}

function uploadFingerprint(input) {
  return JSON.stringify({
    asset_id: input.assetId || null,
    filename: input.filename.trim(),
    content_type: input.contentType,
    size: input.size,
    checksum_sha256: input.checksumSha256,
    asset_kind: input.assetKind == null ? "product_image" : input.assetKind
  });
}

function normalizeDisplayName(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 120) fail("INVALID_ASSET_DISPLAY_NAME");
  return value.trim();
}

export function createAssetService({ repository, objectStore, now = Date.now, uploadTtlMs = 600000, downloadTtlMs = 300000 } = {}) {
  if (!repository || !objectStore) throw new TypeError("repository and objectStore are required");
  const timestamp = () => new Date(now()).toISOString();
  const downloads = new Map();

  async function createUploadAuthorization(input) {
    const assetKind = validateCreate(input);
    const createdAt = timestamp();
    const assetId = input.assetId || randomUUID();
    const versionId = randomUUID();
    const sessionId = randomUUID();
    const token = randomBytes(24).toString("base64url");
    const objectKey = `${input.organizationId}/${assetId}/${versionId}`;
    const asset = input.assetId ? null : { id: assetId, organization_id: input.organizationId, kind: assetKind, display_name: input.filename.trim(), status: "active", revision_number: 1, created_by_member_id: input.actorMemberId, created_at: createdAt, updated_at: createdAt };
    const version = {
      id: versionId, asset_id: assetId, organization_id: input.organizationId, version_number: input.assetId ? null : 1,
      status: "upload_pending", object_key: objectKey, original_filename: input.filename.trim(),
      expected_content_type: input.contentType, expected_size: input.size,
      expected_checksum_sha256: input.checksumSha256, created_at: createdAt, updated_at: createdAt
    };
    const session = {
      id: sessionId, organization_id: input.organizationId, asset_version_id: versionId, object_key: objectKey,
      token_digest: createHash("sha256").update(token).digest("hex"), status: "upload_pending", expires_at: new Date(now() + uploadTtlMs).toISOString(), created_at: createdAt
    };
    const result = await repository.authorizeUpload({
      organizationId: input.organizationId, actorMemberId: input.actorMemberId, idempotencyKey: input.idempotencyKey,
      fingerprint: uploadFingerprint(input), tokenDigest: session.token_digest, asset, version, session, now: createdAt,
      assetKind,
      audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, event_type: "asset.upload_authorized", asset_id: assetId, asset_version_id: versionId, created_at: createdAt }
    });
    return {
      asset: result.asset, asset_version: result.asset_version, upload_session_id: result.upload_session.id,
      object_key: result.asset_version.object_key,
      upload: { token, method: "PUT", expires_at: result.upload_session.expires_at }
    };
  }

  async function uploadObject({ organizationId, uploadToken, body, contentType }) {
    if (!Buffer.isBuffer(body)) fail("INVALID_UPLOAD_BODY");
    const session = await repository.findUploadSessionByToken(organizationId, uploadToken);
    if (!session) fail("UPLOAD_SESSION_NOT_FOUND");
    if (Date.parse(session.expires_at) <= now()) fail("UPLOAD_AUTHORIZATION_EXPIRED");
    const version = await repository.getAssetVersion(organizationId, session.asset_version_id);
    if (contentType !== version.expected_content_type) fail("UPLOAD_CONTENT_TYPE_MISMATCH");
    if (body.length > MAX_IMAGE_BYTES) fail("ASSET_SIZE_NOT_ALLOWED");
    await objectStore.put({ key: session.object_key, body, contentType, metadata: { organizationId, uploadSessionId: session.id } });
    await repository.markUploaded(organizationId, session.id, timestamp());
    return { status: "uploaded", upload_session_id: session.id };
  }

  async function completeUpload({ organizationId, uploadSessionId, idempotencyKey, actorMemberId = null }) {
    if (typeof idempotencyKey !== "string" || idempotencyKey.length < 1 || idempotencyKey.length > 128) fail("INVALID_IDEMPOTENCY_KEY");
    return repository.completeUpload({ organizationId, uploadSessionId, idempotencyKey, actorMemberId, fingerprint: `upload_session_id=${uploadSessionId}`, now: timestamp() });
  }

  async function runNextVerificationJob() {
    const job = await repository.claimNextVerificationJob(timestamp());
    if (!job) return null;
    const version = await repository.getAssetVersion(job.organization_id, job.asset_version_id);
    const head = await objectStore.head(version.object_key);
    let failureCode = null;
    let buffer = null;
    if (!head) failureCode = "OBJECT_MISSING";
    else if (head.metadata?.organizationId !== version.organization_id) failureCode = "OWNERSHIP_MISMATCH";
    else {
      buffer = await objectStore.get(version.object_key);
      const detected = buffer ? await fileTypeFromBuffer(buffer) : null;
      if (!detected || detected.mime !== version.expected_content_type) failureCode = "FILE_TYPE_MISMATCH";
      else if (head.size !== version.expected_size || buffer.length !== version.expected_size) failureCode = "SIZE_MISMATCH";
      else if (createHash("sha256").update(buffer).digest("hex") !== version.expected_checksum_sha256) failureCode = "CHECKSUM_MISMATCH";
    }
    return repository.finishVerification({
      jobId: job.id, versionStatus: failureCode ? "verification_failed" : "available", failureCode,
      verification: failureCode ? null : { contentType: version.expected_content_type, size: buffer.length, checksumSha256: version.expected_checksum_sha256 },
      now: timestamp()
    });
  }

  async function recoverVerificationJobs() {
    let count = 0;
    while (await runNextVerificationJob()) count += 1;
    return count;
  }

  const assetReferencePort = {
    async bindAvailableVersion(input) {
      if (input.referenceType !== "product_revision" || input.role !== "product_image" || typeof input.referenceId !== "string" || !input.referenceId) fail("INVALID_ASSET_REFERENCE");
      const result = await repository.bindReference({ ...input, now: timestamp() });
      return {
        reference: result.reference,
        asset: { id: result.asset.id, status: result.asset.status, organization_id: result.asset.organization_id },
        asset_version: { id: result.asset_version.id, status: result.asset_version.status, version_number: result.asset_version.version_number },
        verification: { content_type: result.asset_version.verified_content_type, size: result.asset_version.verified_size, checksum_sha256: result.asset_version.verified_checksum_sha256 }
      };
    }
  };
  const verifiedOutputAssetPort = {
    registerVerifiedOutput: (input) => repository.registerVerifiedOutput(input)
  };

  return {
    createUploadAuthorization, uploadObject, completeUpload, runNextVerificationJob, recoverVerificationJobs,
    getAssetVersion: ({ organizationId, assetVersionId }) => repository.getAssetVersion(organizationId, assetVersionId),
    getAsset: ({ organizationId, assetId }) => repository.getAsset(organizationId, assetId),
    listAssets: ({ organizationId }) => repository.listAssets(organizationId),
    updateAssetMetadata: ({ organizationId, assetId, expectedRevision, displayName, actorMemberId = null }) => repository.updateAssetMetadata({ organizationId, assetId, expectedRevision, displayName: normalizeDisplayName(displayName), actorMemberId, now: timestamp() }),
    disableAsset: ({ organizationId, assetId, expectedRevision, actorMemberId = null }) => repository.updateAssetStatus({ organizationId, assetId, expectedRevision, actorMemberId, status: "disabled", now: timestamp() }),
    deleteAsset: ({ organizationId, assetId, expectedRevision, actorMemberId = null }) => repository.updateAssetStatus({ organizationId, assetId, expectedRevision, actorMemberId, status: "deleted", now: timestamp() }),
    createDownloadAuthorization: async ({ organizationId, assetVersionId }) => {
      const version = await repository.getAssetVersion(organizationId, assetVersionId);
      if (version.status !== "available") fail("ASSET_VERSION_NOT_AVAILABLE");
      const token = randomBytes(24).toString("base64url");
      const expiresAt = new Date(now() + downloadTtlMs).toISOString();
      downloads.set(token, { organizationId, objectKey: version.object_key, contentType: version.verified_content_type, expiresAt });
      return { token, expires_at: expiresAt, asset_version_id: version.id };
    },
    downloadObject: async ({ organizationId, token }) => {
      const grant = downloads.get(token);
      if (!grant || grant.organizationId !== organizationId || Date.parse(grant.expiresAt) <= now()) fail("DOWNLOAD_AUTHORIZATION_NOT_FOUND");
      const body = await objectStore.get(grant.objectKey);
      if (!body) fail("OBJECT_MISSING");
      return { body, contentType: grant.contentType };
    },
    assetReferencePort, verifiedOutputAssetPort
  };
}
