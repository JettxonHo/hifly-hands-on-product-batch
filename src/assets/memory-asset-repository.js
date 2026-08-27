import { createHash, randomUUID } from "node:crypto";

const clone = (value) => value == null ? value : structuredClone(value);
const failure = (code) => Object.assign(new Error(code), { code });
const APPEARANCE_CANDIDATE_KIND = "appearance_candidate_image";
const AVATAR_PREVIEW_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const PUBLIC_AVATAR_PROVIDER_KEY = /^hifly-public:[^\u0000-\u001f\u007f-\u009f]{1,256}$/u;
function createSerialGate() {
  let tail = Promise.resolve();
  const acquire = async () => {
    const prior = tail;
    let release;
    tail = new Promise((resolve) => { release = resolve; });
    await prior;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
    };
  };
  const run = async (work) => {
    const release = await acquire();
    try { return await work(); }
    finally { release(); }
  };
  run.acquire = acquire;
  return run;
}

export function createMemoryAssetRepository() {
  const assets = new Map();
  const versions = new Map();
  const sessions = new Map();
  const jobs = new Map();
  const receipts = new Map();
  const authorizationReceipts = new Map();
  const references = new Map();
  const audits = [];
  const previewGate = createSerialGate();
  const transactionLocks = new WeakMap();
  async function acquireTransactionLock(transactionClient) {
    const existing = transactionLocks.get(transactionClient);
    if (existing) return existing.ready;
    const lock = { pending: new Map(), settled: false, released: false, release: null, ready: null };
    lock.ready = (async () => {
      lock.release = await previewGate.acquire();
      const settle = (commit) => {
        if (lock.settled) return;
        lock.settled = true;
        if (commit) {
          for (const [key, reference] of lock.pending) references.set(key, clone(reference));
        }
        lock.pending.clear();
        transactionLocks.delete(transactionClient);
      };
      const release = () => {
        if (lock.released) return;
        lock.released = true;
        if (!lock.settled) {
          lock.settled = true;
          lock.pending.clear();
          transactionLocks.delete(transactionClient);
        }
        lock.release();
      };
      if (typeof transactionClient.onFinalize === "function") {
        transactionClient.onCommit(() => settle(true));
        transactionClient.onRollback(() => settle(false));
        transactionClient.onFinalize(release);
      } else {
        transactionClient.onCommit(() => { settle(true); release(); });
        transactionClient.onRollback(() => { settle(false); release(); });
      }
      return lock;
    })();
    transactionLocks.set(transactionClient, lock);
    return lock.ready;
  }
  function owned(map, id, organizationId, code) {
    const value = map.get(id);
    if (!value || value.organization_id !== organizationId) throw failure(code);
    return value;
  }
  return {
    async initialize() {},
    async close() {},
    async authorizeUpload({ organizationId, actorMemberId, idempotencyKey, fingerprint, tokenDigest, asset, assetKind = "product_image", version, session, audit, now }) {
      const receiptKey = `${organizationId}:${actorMemberId}:${idempotencyKey}`;
      const receipt = authorizationReceipts.get(receiptKey);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
        const existingSession = sessions.get(receipt.upload_session_id);
        if (existingSession.status === "completed" || Date.parse(existingSession.expires_at) <= Date.parse(now)) throw failure("UPLOAD_AUTHORIZATION_NOT_REPLAYABLE");
        existingSession.token_digest = tokenDigest;
        return {
          asset: clone(assets.get(receipt.asset_id)),
          asset_version: clone(versions.get(receipt.asset_version_id)),
          upload_session: clone(existingSession)
        };
      }
      let targetAsset = asset;
      if (version.version_number == null) {
        targetAsset = owned(assets, version.asset_id, organizationId, "ASSET_NOT_FOUND");
        if (targetAsset.status !== "active") throw failure("ASSET_NOT_ACTIVE");
        if (targetAsset.kind !== assetKind) throw failure("ASSET_KIND_CONFLICT");
        version.version_number = Math.max(0, ...[...versions.values()].filter((item) => item.asset_id === targetAsset.id).map((item) => item.version_number)) + 1;
      } else {
        assets.set(asset.id, clone(asset));
      }
      versions.set(version.id, clone(version));
      sessions.set(session.id, clone(session));
      authorizationReceipts.set(receiptKey, { fingerprint, asset_id: targetAsset.id, asset_version_id: version.id, upload_session_id: session.id });
      audits.push(clone(audit));
      return { asset: clone(targetAsset), asset_version: clone(version), upload_session: clone(session) };
    },
    async getUploadSession(organizationId, id) { return clone(owned(sessions, id, organizationId, "UPLOAD_SESSION_NOT_FOUND")); },
    async findUploadSessionByToken(organizationId, token) {
      const digest = createHash("sha256").update(token).digest("hex");
      return clone([...sessions.values()].find((value) => value.organization_id === organizationId && value.token_digest === digest) || null);
    },
    async markUploaded(organizationId, id, uploadedAt) {
      const session = owned(sessions, id, organizationId, "UPLOAD_SESSION_NOT_FOUND");
      if (session.status !== "upload_pending") throw failure("UPLOAD_SESSION_NOT_PENDING");
      session.status = "uploaded"; session.uploaded_at = uploadedAt;
      const version = versions.get(session.asset_version_id); version.status = "uploading"; version.updated_at = uploadedAt;
      return clone(version);
    },
    async completeUpload({ organizationId, uploadSessionId, idempotencyKey, fingerprint, actorMemberId = null, now }) {
      const receiptKey = `${organizationId}:${idempotencyKey}`;
      const existing = receipts.get(receiptKey);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
        return clone(existing.response);
      }
      const session = owned(sessions, uploadSessionId, organizationId, "UPLOAD_SESSION_NOT_FOUND");
      if (session.status !== "uploaded" && session.status !== "completed") throw failure("UPLOAD_NOT_COMPLETED");
      const version = versions.get(session.asset_version_id);
      if (session.status === "uploaded") {
        session.status = "completed"; session.completed_at = now; version.status = "verifying"; version.updated_at = now;
      }
      let job = [...jobs.values()].find((value) => value.asset_version_id === version.id && value.type === "asset_verification");
      if (!job) {
        job = { id: randomUUID(), organization_id: organizationId, type: "asset_verification", asset_version_id: version.id, status: "queued", attempts: 0, created_at: now, updated_at: now };
        jobs.set(job.id, job);
      }
      const response = { asset_version: clone(version), job: clone(job) };
      receipts.set(receiptKey, { fingerprint, response: clone(response) });
      audits.push({ id: randomUUID(), organization_id: organizationId, actor_member_id: actorMemberId, event_type: "asset.upload_completed", asset_id: version.asset_id, asset_version_id: version.id, created_at: now });
      return response;
    },
    async getAssetVersion(organizationId, id) {
      return previewGate(async () => clone(owned(versions, id, organizationId, "ASSET_VERSION_NOT_FOUND")));
    },
    async getAsset(organizationId, id) {
      return previewGate(async () => clone(owned(assets, id, organizationId, "ASSET_NOT_FOUND")));
    },
    async authorizeAvatarPreviewMaterial({ organizationId, assetVersionId, mintGrant }) {
      if (typeof mintGrant !== "function") throw new TypeError("mintGrant is required");
      return previewGate(async () => {
        const version = owned(versions, assetVersionId, organizationId, "ASSET_VERSION_NOT_FOUND");
        const asset = owned(assets, version.asset_id, organizationId, "ASSET_NOT_FOUND");
        if (asset.status !== "active" || asset.kind !== "avatar_image" || version.status !== "available" ||
            !AVATAR_PREVIEW_MEDIA_TYPES.has(version.verified_content_type) ||
            !Number.isInteger(version.verified_size) || version.verified_size < 1 ||
            !/^[a-f0-9]{64}$/.test(version.verified_checksum_sha256 || "") ||
            typeof version.object_key !== "string" || !version.object_key) {
          throw failure("ASSET_VERSION_NOT_AVAILABLE");
        }
        return mintGrant({ asset: clone(asset), assetVersion: clone(version) });
      });
    },
    async listAssets(organizationId) {
      return previewGate(async () => [...assets.values()]
        .filter((asset) => asset.organization_id === organizationId && asset.status !== "deleted" && asset.kind !== APPEARANCE_CANDIDATE_KIND)
        .map((asset) => ({
          ...clone(asset),
          versions: [...versions.values()]
            .filter((version) => version.asset_id === asset.id)
            .sort((left, right) => right.version_number - left.version_number)
            .map(clone)
        })));
    },
    async registerAppearanceCandidate({ organizationId, actorSystemId = null, staged, now, transactionClient = null }) {
      const existing = [...versions.values()].find((version) => version.organization_id === organizationId && version.object_key === staged.object_key);
      if (existing) {
        const existingAsset = assets.get(existing.asset_id);
        if (!existingAsset || existingAsset.kind !== APPEARANCE_CANDIDATE_KIND || existing.status !== "available" ||
            existing.expected_content_type !== staged.media_type || existing.expected_size !== staged.size ||
            existing.expected_checksum_sha256 !== staged.checksum_sha256) {
          throw failure("APPEARANCE_CANDIDATE_ASSET_CONFLICT");
        }
        return { asset: clone(existingAsset), asset_version: clone(existing) };
      }

      const asset = {
        id: randomUUID(), organization_id: organizationId, kind: APPEARANCE_CANDIDATE_KIND,
        display_name: staged.original_filename, status: "active", revision_number: 1,
        created_by_member_id: null, created_at: now, updated_at: now
      };
      const version = {
        id: randomUUID(), asset_id: asset.id, organization_id: organizationId, version_number: 1, status: "available",
        object_key: staged.object_key, original_filename: staged.original_filename,
        expected_content_type: staged.media_type, expected_size: staged.size, expected_checksum_sha256: staged.checksum_sha256,
        verified_content_type: staged.media_type, verified_size: staged.size, verified_checksum_sha256: staged.checksum_sha256,
        verified_at: now, failure_code: null, created_at: now, updated_at: now
      };
      assets.set(asset.id, clone(asset));
      versions.set(version.id, clone(version));
      if (transactionClient?.onRollback) {
        transactionClient.onRollback(() => assets.delete(asset.id));
        transactionClient.onRollback(() => versions.delete(version.id));
      }
      const audit = {
        id: randomUUID(), organization_id: organizationId, actor_member_id: null,
        event_type: "asset.appearance_candidate_available", asset_id: asset.id, asset_version_id: version.id,
        metadata: { actor_system_id: actorSystemId, candidate_id: staged.candidate_id, capture_request_id: staged.capture_request_id }, created_at: now
      };
      audits.push(audit);
      if (transactionClient?.onRollback) transactionClient.onRollback(() => {
        const index = audits.findIndex((event) => event.id === audit.id);
        if (index >= 0) audits.splice(index, 1);
      });
      return { asset: clone(asset), asset_version: clone(version) };
    },
    async registerPublicAvatarThumbnail({ organizationId, providerKey, displayName, objectKey, mediaType,
      size, checksumSha256, now, transactionClient = null }) {
      const register = async () => {
      const normalizedProviderKey = typeof providerKey === "string" ? providerKey.trim() : "";
      if (!PUBLIC_AVATAR_PROVIDER_KEY.test(normalizedProviderKey) || !objectKey || !AVATAR_PREVIEW_MEDIA_TYPES.has(mediaType) ||
          !Number.isInteger(size) || size < 1 || !/^[a-f0-9]{64}$/.test(checksumSha256 || "")) {
        throw failure("INVALID_PUBLIC_AVATAR_THUMBNAIL");
      }
      const existing = [...versions.values()].find((version) => version.organization_id === organizationId && version.object_key === objectKey);
      if (existing) {
        const existingAsset = assets.get(existing.asset_id);
        if (!existingAsset || existingAsset.organization_id !== organizationId || existingAsset.kind !== "avatar_image" ||
            existingAsset.status !== "active" || existing.status !== "available" || existing.expected_content_type !== mediaType ||
            existing.expected_size !== size || existing.expected_checksum_sha256 !== checksumSha256) {
          throw failure("PUBLIC_AVATAR_THUMBNAIL_ASSET_CONFLICT");
        }
        return { asset: clone(existingAsset), asset_version: clone(existing), replayed: true };
      }

      const prefix = objectKey.slice(0, objectKey.lastIndexOf("/"));
      const prior = [...versions.values()].find((version) => version.organization_id === organizationId &&
        version.object_key.startsWith(`${prefix}/`));
      const asset = prior ? assets.get(prior.asset_id) : {
        id: randomUUID(), organization_id: organizationId, kind: "avatar_image", display_name: displayName,
        status: "active", revision_number: 1, created_by_member_id: null, created_at: now, updated_at: now
      };
      if (asset.status !== "active" || asset.kind !== "avatar_image") throw failure("PUBLIC_AVATAR_THUMBNAIL_ASSET_CONFLICT");
      const version = {
        id: randomUUID(), asset_id: asset.id, organization_id: organizationId,
        version_number: Math.max(0, ...[...versions.values()].filter((item) => item.asset_id === asset.id).map((item) => item.version_number)) + 1,
        status: "available", object_key: objectKey, original_filename: `${displayName}.${mediaType === "image/jpeg" ? "jpg" : mediaType === "image/webp" ? "webp" : "png"}`,
        expected_content_type: mediaType, expected_size: size, expected_checksum_sha256: checksumSha256,
        verified_content_type: mediaType, verified_size: size, verified_checksum_sha256: checksumSha256,
        verified_at: now, failure_code: null, created_at: now, updated_at: now
      };
      const priorAsset = assets.get(asset.id);
      assets.set(asset.id, clone(asset));
      versions.set(version.id, clone(version));
      if (transactionClient?.onRollback) {
        transactionClient.onRollback(() => {
          versions.delete(version.id);
          if (!priorAsset) assets.delete(asset.id);
          else assets.set(asset.id, priorAsset);
        });
      }
      const audit = { id: randomUUID(), organization_id: organizationId, actor_member_id: null,
        event_type: "asset.public_avatar_thumbnail_available", asset_id: asset.id, asset_version_id: version.id,
        metadata: { provider_key: normalizedProviderKey }, created_at: now };
      audits.push(audit);
      if (transactionClient?.onRollback) transactionClient.onRollback(() => {
        const index = audits.findIndex((event) => event.id === audit.id);
        if (index >= 0) audits.splice(index, 1);
      });
      return { asset: clone(asset), asset_version: clone(version), replayed: false };
      };
      if (!transactionClient) return previewGate(register);
      await acquireTransactionLock(transactionClient);
      return register();
    },
    async updatePublicAvatarThumbnailDisplayName({ organizationId, assetId, displayName, now, transactionClient = null }) {
      const update = async () => {
        const current = owned(assets, assetId, organizationId, "ASSET_NOT_FOUND");
        if (current.kind !== "avatar_image" || current.status !== "active") throw failure("ASSET_NOT_ACTIVE");
        const next = { ...current, display_name: displayName, revision_number: current.revision_number + 1, updated_at: now };
        assets.set(assetId, clone(next));
        if (transactionClient?.onRollback) transactionClient.onRollback(() => assets.set(assetId, clone(current)));
        return clone(next);
      };
      if (!transactionClient) return previewGate(update);
      await acquireTransactionLock(transactionClient);
      return update();
    },
    async registerVerifiedOutput({ organizationId, actorMemberId = null, candidate, now, transactionClient = null }) {
      const existing = [...versions.values()].find((version) => version.object_key === candidate.object_key);
      if (existing) {
        const existingAsset = assets.get(existing.asset_id);
        if (!existingAsset || existing.organization_id !== organizationId || existingAsset.organization_id !== organizationId ||
            existingAsset.kind !== "work_video" || existingAsset.status !== "active" || existing.status !== "available" ||
            existing.expected_content_type !== candidate.media_type || existing.expected_checksum_sha256 !== candidate.checksum ||
            existing.expected_size !== candidate.size) {
          throw failure("WORK_VERIFICATION_ASSET_CONFLICT");
        }
        return { asset: clone(existingAsset), asset_version: clone(existing) };
      }
      const asset = {
        id: randomUUID(), organization_id: organizationId, kind: "work_video", display_name: candidate.original_filename || "已核验作品",
        status: "active", revision_number: 1, created_by_member_id: actorMemberId, created_at: now, updated_at: now
      };
      const version = {
        id: randomUUID(), asset_id: asset.id, organization_id: organizationId, version_number: 1, status: "available",
        object_key: candidate.object_key, original_filename: candidate.original_filename, expected_content_type: candidate.media_type,
        expected_size: candidate.size, expected_checksum_sha256: candidate.checksum, verified_content_type: candidate.media_type,
        verified_size: candidate.size, verified_checksum_sha256: candidate.checksum, verified_at: now, failure_code: null,
        created_at: now, updated_at: now
      };
      assets.set(asset.id, clone(asset));
      versions.set(version.id, clone(version));
      if (transactionClient?.onRollback) transactionClient.onRollback(() => { assets.delete(asset.id); versions.delete(version.id); });
      audits.push({ id: randomUUID(), organization_id: organizationId, actor_member_id: actorMemberId, event_type: "asset.work_video_available",
        asset_id: asset.id, asset_version_id: version.id, metadata: { candidate_id: candidate.id }, created_at: now });
      if (transactionClient?.onRollback) transactionClient.onRollback(() => audits.pop());
      return { asset: clone(asset), asset_version: clone(version) };
    },
    async listPendingVerificationJobs() { return [...jobs.values()].filter((job) => ["queued", "running"].includes(job.status)).map(clone); },
    async claimNextVerificationJob(now) {
      const job = [...jobs.values()].find((value) => ["queued", "running"].includes(value.status));
      if (!job) return null;
      job.status = "running"; job.attempts += 1; job.updated_at = now;
      return clone(job);
    },
    async finishVerification({ jobId, versionStatus, failureCode = null, verification = null, now }) {
      return previewGate(async () => {
        const job = jobs.get(jobId);
        if (!job) throw failure("VERIFICATION_JOB_NOT_FOUND");
        const version = versions.get(job.asset_version_id);
        version.status = versionStatus; version.failure_code = failureCode; version.updated_at = now;
        if (verification) {
          version.verified_content_type = verification.contentType; version.verified_size = verification.size;
          version.verified_checksum_sha256 = verification.checksumSha256; version.verified_at = now;
        }
        job.status = "succeeded"; job.updated_at = now;
        audits.push({ id: randomUUID(), organization_id: version.organization_id, event_type: versionStatus === "available" ? "asset.version_available" : "asset.verification_failed", asset_id: version.asset_id, asset_version_id: version.id, metadata: failureCode ? { failure_code: failureCode } : {}, created_at: now });
        return clone(version);
      });
    },
    async updateAssetStatus({ organizationId, assetId, expectedRevision, status, actorMemberId = null, now }) {
      return previewGate(async () => {
        const asset = owned(assets, assetId, organizationId, "ASSET_NOT_FOUND");
        if (asset.revision_number !== expectedRevision) throw failure("ASSET_VERSION_CONFLICT");
        if (asset.status === "deleted" || (status === "disabled" && asset.status !== "active")) throw failure("ASSET_NOT_ACTIVE");
        if (status === "deleted" && [...references.values()].some((ref) => ref.asset_id === assetId)) throw failure("ASSET_HISTORY_REFERENCED");
        asset.status = status; asset.revision_number += 1; asset.updated_at = now;
        audits.push({ id: randomUUID(), organization_id: organizationId, actor_member_id: actorMemberId, event_type: `asset.${status}`, asset_id: assetId, created_at: now });
        return clone(asset);
      });
    },
    async updateAssetMetadata({ organizationId, assetId, expectedRevision, displayName, actorMemberId = null, now }) {
      return previewGate(async () => {
        const asset = owned(assets, assetId, organizationId, "ASSET_NOT_FOUND");
        if (asset.revision_number !== expectedRevision) throw failure("ASSET_VERSION_CONFLICT");
        if (asset.status !== "active") throw failure("ASSET_NOT_ACTIVE");
        asset.display_name = displayName; asset.revision_number += 1; asset.updated_at = now;
        audits.push({ id: randomUUID(), organization_id: organizationId, actor_member_id: actorMemberId, event_type: "asset.metadata_updated", asset_id: assetId, metadata: { display_name: displayName }, created_at: now });
        return clone(asset);
      });
    },
    async bindReference({ organizationId, assetVersionId, referenceType, referenceId, role, now, transactionClient = null }) {
      if (transactionClient != null && (typeof transactionClient !== "object" ||
          typeof transactionClient.onCommit !== "function" || typeof transactionClient.onRollback !== "function")) {
        throw new TypeError("transactionClient must provide onCommit and onRollback");
      }
      const transactional = transactionClient && typeof transactionClient === "object" &&
        typeof transactionClient.onCommit === "function" && typeof transactionClient.onRollback === "function";
      let transactionLock = null;
      let release = null;
      if (transactional) transactionLock = await acquireTransactionLock(transactionClient);
      else release = await previewGate.acquire();
      try {
        const version = owned(versions, assetVersionId, organizationId, "ASSET_VERSION_NOT_FOUND");
        const asset = assets.get(version.asset_id);
        if (asset.status !== "active") throw failure("ASSET_NOT_ACTIVE");
        if (asset.kind !== "product_image") throw failure("ASSET_VERSION_NOT_AVAILABLE");
        if (version.status !== "available") throw failure("ASSET_VERSION_NOT_AVAILABLE");
        const key = `${organizationId}:${assetVersionId}:${referenceType}:${referenceId}:${role}`;
        let reference = references.get(key) || transactionLock?.pending.get(key);
        if (!reference) {
          reference = { id: randomUUID(), organization_id: organizationId, asset_id: asset.id, asset_version_id: version.id, reference_type: referenceType, reference_id: referenceId, role, created_at: now };
          if (transactionLock) transactionLock.pending.set(key, clone(reference));
          else references.set(key, reference);
        }
        return { reference: clone(reference), asset: clone(asset), asset_version: clone(version) };
      } finally {
        if (!transactional) release?.();
      }
    },
    async listAuditEvents() { return previewGate(async () => clone(audits)); }
  };
}
