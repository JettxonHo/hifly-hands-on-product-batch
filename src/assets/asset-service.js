import { createHash, randomBytes, randomUUID } from "node:crypto";
import { fileTypeFromBuffer } from "file-type";

const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_KINDS = new Set(["product_image", "avatar_image"]);
const APPEARANCE_CANDIDATE_KIND = "appearance_candidate_image";
const APPEARANCE_CANDIDATE_EXTENSIONS = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (code) => { throw Object.assign(new Error(code), { code }); };
const validCandidatePart = (value) => typeof value === "string" && /^[A-Za-z0-9._-]{1,120}$/.test(value);

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
  const appearanceCandidateDownloads = new Map();

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
  const sourceProductImagePort = {
    async readVerifiedProductImage({ organizationId, assetVersionId, sourceAssetVersionId }) {
      assetVersionId = assetVersionId || sourceAssetVersionId;
      const version = await repository.getAssetVersion(organizationId, assetVersionId);
      if (!version || version.id !== assetVersionId || version.organization_id !== organizationId || !version.asset_id) {
        fail("ASSET_SOURCE_UNAVAILABLE");
      }

      let asset;
      try {
        asset = await repository.getAsset(organizationId, version.asset_id);
      } catch (error) {
        if (error?.code === "ASSET_NOT_FOUND" || error?.code === "ASSET_VERSION_NOT_FOUND") fail("ASSET_SOURCE_UNAVAILABLE");
        throw error;
      }
      if (!asset || asset.id !== version.asset_id || asset.organization_id !== organizationId ||
          version.organization_id !== asset.organization_id || asset.status !== "active" ||
          asset.kind !== "product_image" || version.status !== "available") {
        fail("ASSET_SOURCE_UNAVAILABLE");
      }

      const contentType = version.verified_content_type;
      const size = version.verified_size;
      const checksumSha256 = version.verified_checksum_sha256;
      if (!ALLOWED_TYPES.has(contentType) || !Number.isInteger(size) || size < 1 ||
          !/^[a-f0-9]{64}$/.test(checksumSha256 || "") || typeof version.object_key !== "string" || !version.object_key) {
        fail("ASSET_SOURCE_UNAVAILABLE");
      }

      let head;
      try {
        head = await objectStore.head(version.object_key);
      } catch {
        fail("ASSET_SOURCE_UNAVAILABLE");
      }
      if (!head || head.metadata?.organizationId !== organizationId || head.size !== size) {
        fail("ASSET_SOURCE_UNAVAILABLE");
      }

      let bytes;
      try {
        bytes = await objectStore.get(version.object_key);
      } catch {
        fail("ASSET_SOURCE_UNAVAILABLE");
      }
      if (!Buffer.isBuffer(bytes) || bytes.length !== size) fail("ASSET_SOURCE_UNAVAILABLE");

      let detected;
      try {
        detected = await fileTypeFromBuffer(bytes);
      } catch {
        fail("ASSET_SOURCE_UNAVAILABLE");
      }
      if (!detected || detected.mime !== contentType ||
          createHash("sha256").update(bytes).digest("hex") !== checksumSha256) {
        fail("ASSET_SOURCE_UNAVAILABLE");
      }

      return {
        asset_id: asset.id,
        asset_version_id: version.id,
        kind: asset.kind,
        asset_status: asset.status,
        version_status: version.status,
        bytes,
        media_type: contentType,
        size,
        checksum_sha256: checksumSha256
      };
    }
  };
  const appearanceCandidateAssetPort = {
    async stageVerifiedCandidate({ organizationId, candidateId, captureRequestId, body, mediaType }) {
      if (!validCandidatePart(organizationId) || !validCandidatePart(candidateId) || !validCandidatePart(captureRequestId)) {
        fail("INVALID_APPEARANCE_CANDIDATE");
      }
      if (!Buffer.isBuffer(body) || body.length < 1 || body.length > MAX_IMAGE_BYTES) {
        fail("APPEARANCE_CANDIDATE_SIZE_NOT_ALLOWED");
      }

      let detected;
      try {
        detected = await fileTypeFromBuffer(body);
      } catch {
        fail("APPEARANCE_CANDIDATE_TYPE_NOT_ALLOWED");
      }
      if (!detected || !ALLOWED_TYPES.has(detected.mime) || detected.mime !== mediaType) {
        fail("APPEARANCE_CANDIDATE_TYPE_NOT_ALLOWED");
      }

      const safeFilename = `candidate.${APPEARANCE_CANDIDATE_EXTENSIONS.get(detected.mime)}`;
      const objectKey = `${organizationId}/appearance-candidates/${candidateId}/${safeFilename}`;
      const checksumSha256 = createHash("sha256").update(body).digest("hex");
      await objectStore.put({
        key: objectKey,
        body,
        contentType: detected.mime,
        metadata: { organizationId, candidateId, captureRequestId }
      });
      return {
        candidate_id: candidateId,
        capture_request_id: captureRequestId,
        original_filename: safeFilename,
        object_key: objectKey,
        media_type: detected.mime,
        size: body.length,
        checksum_sha256: checksumSha256
      };
    },
    async registerStagedCandidate({ organizationId, actorSystemId = null, staged, transactionClient = null }) {
      if (!staged || staged.object_key !== `${organizationId}/appearance-candidates/${staged.candidate_id}/${staged.original_filename}` ||
          !validCandidatePart(staged.candidate_id) || !validCandidatePart(staged.capture_request_id) ||
          !APPEARANCE_CANDIDATE_EXTENSIONS.has(staged.media_type) ||
          staged.original_filename !== `candidate.${APPEARANCE_CANDIDATE_EXTENSIONS.get(staged.media_type)}` ||
          !Number.isInteger(staged.size) || staged.size < 1 || staged.size > MAX_IMAGE_BYTES ||
          !/^[a-f0-9]{64}$/.test(staged.checksum_sha256 || "")) {
        fail("INVALID_APPEARANCE_CANDIDATE");
      }
      return repository.registerAppearanceCandidate({ organizationId, actorSystemId, staged, now: timestamp(), transactionClient });
    },
    async createDownloadAuthorization({ organizationId, assetVersionId }) {
      const version = await repository.getAssetVersion(organizationId, assetVersionId);
      const asset = await repository.getAsset(organizationId, version.asset_id);
      if (asset.kind !== APPEARANCE_CANDIDATE_KIND || asset.status !== "active" || version.status !== "available") {
        fail("ASSET_VERSION_NOT_AVAILABLE");
      }
      const token = randomBytes(24).toString("base64url");
      const expiresAt = new Date(now() + downloadTtlMs).toISOString();
      const metadata = {
        filename: version.original_filename,
        media_type: version.verified_content_type,
        size: version.verified_size,
        checksum_sha256: version.verified_checksum_sha256
      };
      appearanceCandidateDownloads.set(token, { organizationId, assetVersionId: version.id, objectKey: version.object_key, expiresAt, ...metadata });
      return { token, expires_at: expiresAt, asset_version_id: version.id, ...metadata };
    },
    async downloadObject({ organizationId, assetVersionId, token }) {
      const grant = appearanceCandidateDownloads.get(token);
      if (!grant || grant.organizationId !== organizationId || grant.assetVersionId !== assetVersionId || Date.parse(grant.expiresAt) <= now()) {
        fail("DOWNLOAD_AUTHORIZATION_NOT_FOUND");
      }
      const body = await objectStore.get(grant.objectKey);
      if (!Buffer.isBuffer(body) || body.length !== grant.size || createHash("sha256").update(body).digest("hex") !== grant.checksum_sha256) {
        fail(body ? "ASSET_CONTENT_INVALID" : "OBJECT_MISSING");
      }
      return { body, asset_version_id: grant.assetVersionId, filename: grant.filename, media_type: grant.media_type, size: grant.size, checksum_sha256: grant.checksum_sha256 };
    },
    async discardStagedCandidate({ organizationId, staged }) {
      if (!staged || !validCandidatePart(staged.candidate_id) || !APPEARANCE_CANDIDATE_EXTENSIONS.has(staged.media_type) ||
          staged.original_filename !== `candidate.${APPEARANCE_CANDIDATE_EXTENSIONS.get(staged.media_type)}` ||
          staged.object_key !== `${organizationId}/appearance-candidates/${staged.candidate_id}/${staged.original_filename}`) {
        fail("INVALID_APPEARANCE_CANDIDATE");
      }
      await objectStore.remove(staged.object_key);
      return { status: "discarded", object_key: staged.object_key };
    }
  };
  const verifiedOutputAssetPort = {
    registerVerifiedOutput: (input) => repository.registerVerifiedOutput(input)
  };

  async function getPublicAsset(organizationId, assetId) {
    const asset = await repository.getAsset(organizationId, assetId);
    if (asset.kind === APPEARANCE_CANDIDATE_KIND) fail("ASSET_NOT_FOUND");
    return asset;
  }

  async function getPublicAssetVersion(organizationId, assetVersionId) {
    const version = await repository.getAssetVersion(organizationId, assetVersionId);
    const asset = await repository.getAsset(organizationId, version.asset_id);
    if (asset.kind === APPEARANCE_CANDIDATE_KIND) fail("ASSET_VERSION_NOT_FOUND");
    return version;
  }

  async function authorizeAvatarPreview({ organizationId, assetVersionId, transactionClient = null }) {
    if (typeof repository.authorizeAvatarPreviewMaterial !== "function") fail("ASSET_VERSION_NOT_AVAILABLE");
    return repository.authorizeAvatarPreviewMaterial({ organizationId, assetVersionId, transactionClient,
      mintGrant({ assetVersion }) {
        const token = randomBytes(24).toString("base64url");
        const expiresAt = new Date(now() + downloadTtlMs).toISOString();
        const metadata = {
          original_filename: assetVersion.original_filename,
          verified_content_type: assetVersion.verified_content_type,
          verified_size: assetVersion.verified_size,
          verified_checksum_sha256: assetVersion.verified_checksum_sha256
        };
        downloads.set(token, { organizationId, objectKey: assetVersion.object_key,
          contentType: assetVersion.verified_content_type, expiresAt, ...metadata });
        return { token, expires_at: expiresAt, asset_version_id: assetVersion.id, ...metadata };
      }
    });
  }

  return {
    createUploadAuthorization, uploadObject, completeUpload, runNextVerificationJob, recoverVerificationJobs,
    authorizeAvatarPreview,
    getAssetVersion: ({ organizationId, assetVersionId }) => getPublicAssetVersion(organizationId, assetVersionId),
    getAsset: ({ organizationId, assetId }) => getPublicAsset(organizationId, assetId),
    listAssets: async ({ organizationId }) => (await repository.listAssets(organizationId)).filter((asset) => asset.kind !== APPEARANCE_CANDIDATE_KIND),
    updateAssetMetadata: async ({ organizationId, assetId, expectedRevision, displayName, actorMemberId = null }) => {
      await getPublicAsset(organizationId, assetId);
      return repository.updateAssetMetadata({ organizationId, assetId, expectedRevision, displayName: normalizeDisplayName(displayName), actorMemberId, now: timestamp() });
    },
    disableAsset: async ({ organizationId, assetId, expectedRevision, actorMemberId = null }) => {
      await getPublicAsset(organizationId, assetId);
      return repository.updateAssetStatus({ organizationId, assetId, expectedRevision, actorMemberId, status: "disabled", now: timestamp() });
    },
    deleteAsset: async ({ organizationId, assetId, expectedRevision, actorMemberId = null }) => {
      await getPublicAsset(organizationId, assetId);
      return repository.updateAssetStatus({ organizationId, assetId, expectedRevision, actorMemberId, status: "deleted", now: timestamp() });
    },
    createDownloadAuthorization: async ({ organizationId, assetVersionId }) => {
      const version = await getPublicAssetVersion(organizationId, assetVersionId).catch((error) => {
        if (error?.code === "ASSET_VERSION_NOT_FOUND") fail("ASSET_VERSION_NOT_AVAILABLE");
        throw error;
      });
      if (version.status !== "available") fail("ASSET_VERSION_NOT_AVAILABLE");
      const token = randomBytes(24).toString("base64url");
      const expiresAt = new Date(now() + downloadTtlMs).toISOString();
      const metadata = {
        original_filename: version.original_filename,
        verified_content_type: version.verified_content_type,
        verified_size: version.verified_size,
        verified_checksum_sha256: version.verified_checksum_sha256
      };
      downloads.set(token, { organizationId, objectKey: version.object_key, contentType: version.verified_content_type, expiresAt, ...metadata });
      return { token, expires_at: expiresAt, asset_version_id: version.id, ...metadata };
    },
    downloadObject: async ({ organizationId, token }) => {
      const grant = downloads.get(token);
      if (!grant || grant.organizationId !== organizationId || Date.parse(grant.expiresAt) <= now()) fail("DOWNLOAD_AUTHORIZATION_NOT_FOUND");
      const body = await objectStore.get(grant.objectKey);
      if (!body) fail("OBJECT_MISSING");
      return {
        body,
        contentType: grant.contentType,
        original_filename: grant.original_filename,
        verified_content_type: grant.verified_content_type,
        verified_size: grant.verified_size,
        verified_checksum_sha256: grant.verified_checksum_sha256
      };
    },
    assetReferencePort, sourceProductImagePort, appearanceCandidateAssetPort, verifiedOutputAssetPort
  };
}
