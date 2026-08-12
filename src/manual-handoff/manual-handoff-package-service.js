import { randomBytes, randomUUID } from "node:crypto";

import {
  MANUAL_HANDOFF_CONTRACT_TYPE,
  MANUAL_HANDOFF_CONTRACT_VERSION,
  MANUAL_HANDOFF_PACKAGE_STATES,
  buildManualHandoffManifest,
  canonicalJson,
  failure,
  renderManualHandoffReadme,
  sha256,
  summarizeManualHandoffManifest
} from "./manual-handoff-package.js";
import { buildManualHandoffZip, MANUAL_HANDOFF_PACKAGE_CONTENT_TYPE } from "./manual-handoff-package-store.js";

const clean = (value) => typeof value === "string" ? value.trim() : "";
const stable = (value) => canonicalJson(value);

function validateActor(input) {
  if (!clean(input.organizationId) || !clean(input.actorMemberId)) throw failure("MANUAL_HANDOFF_CONTEXT_REQUIRED");
  if (!['member', 'admin'].includes(input.actorRole)) throw failure("MANUAL_HANDOFF_FORBIDDEN");
}

function validateKey(value, code = "INVALID_IDEMPOTENCY_KEY") {
  if (!clean(value) || value.length > 128) throw failure(code);
  return value.trim();
}

function safeFailureReason(error) {
  if (error?.code === "MANUAL_HANDOFF_ASSET_INTEGRITY_MISMATCH") return "交接包所需素材完整性校验失败，请检查素材状态后重试。";
  if (error?.code === "MANUAL_HANDOFF_ASSET_UNAVAILABLE" || error?.code === "MANUAL_HANDOFF_ASSET_REFERENCE_INVALID") return "交接包所需素材当前不可用，请检查素材状态后重试。";
  if (error?.code === "MANUAL_HANDOFF_INPUT_SNAPSHOT_REQUIRED") return "交接包输入快照不完整，请返回视频方案补齐固定输入。";
  if (error?.code === "MANUAL_HANDOFF_CROSS_ORGANIZATION_DATA") return "交接包输入不在当前企业可用范围内，未生成交接包。";
  return "交接包生成未完成，请稍后重试。";
}

function packageStorageKey(value) {
  return `manual-handoff/${value.organization_id}/${value.production_order_id}/${value.id}.zip`;
}

function publicPackage(value) {
  if (!value) return null;
  const { organization_id: _organizationId, storage_key: _storageKey, generation_request_id: _generationRequestId,
    source_order: _sourceOrder, manifest: _manifest, readme: _readme, ...safe } = value;
  const manifest = value.manifest;
  return {
    ...safe,
    package_id: value.id,
    content_summary: manifest ? summarizeManualHandoffManifest(manifest) : null,
    integrity_summary: value.manifest_hash && value.package_hash ? `${value.manifest_hash.slice(0, 8).toUpperCase()}-${value.package_hash.slice(0, 8).toUpperCase()}` : null
  };
}

function publicJob(value) {
  if (!value) return null;
  return { id: value.id, type: value.type, status: value.status, package_id: value.package_id, attempts: value.attempts, max_attempts: value.max_attempts, created_at: value.created_at, updated_at: value.updated_at, completed_at: value.completed_at || null };
}

export function createManualHandoffPackageService({ repository, orderPort, packageStore, archiveBuilder = null,
  assetResolver = null, now = Date.now, grantTtlMs = 300_000, maxAttempts = 3 } = {}) {
  if (!repository?.createGenerationRequest || !repository?.getPackage || !repository?.getJob) throw new TypeError("manual handoff repository is required");
  if (!orderPort?.getOrder) throw new TypeError("production order port is required");
  if (!packageStore?.put || !packageStore?.get) throw new TypeError("manual handoff package store is required");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new TypeError("maxAttempts must be a positive integer");
  if (!Number.isInteger(grantTtlMs) || grantTtlMs < 1000) throw new TypeError("grantTtlMs must be at least one second");
  const timestamp = () => new Date(now()).toISOString();

  async function scopedOrder(input) {
    validateActor(input);
    if (!clean(input.productionOrderId || input.orderId)) throw failure("MANUAL_HANDOFF_ORDER_NOT_FOUND");
    const order = await orderPort.getOrder({ organizationId: input.organizationId, actorMemberId: input.actorMemberId, actorRole: input.actorRole, orderId: input.productionOrderId || input.orderId });
    if (!order || order.organization_id !== input.organizationId) throw failure("MANUAL_HANDOFF_ORDER_NOT_FOUND");
    return order;
  }

  async function buildManifest(input) {
    validateActor(input);
    const value = input.order || await scopedOrder(input);
    if (value.organization_id !== input.organizationId) throw failure("MANUAL_HANDOFF_CROSS_ORGANIZATION_DATA");
    return buildManualHandoffManifest({ order: value, packageId: input.packageId || randomUUID(), packageVersion: input.packageVersion || 1,
      createdAt: input.createdAt || timestamp(), createdByMemberId: input.createdByMemberId || input.actorMemberId, supersedesPackageId: input.supersedesPackageId || null });
  }

  async function requestGeneration(input) {
    const order = await scopedOrder(input);
    const generationRequestId = validateKey(input.generationRequestId || input.idempotencyKey, "MANUAL_HANDOFF_GENERATION_REQUEST_REQUIRED");
    const contractVersion = clean(input.contractVersion) || MANUAL_HANDOFF_CONTRACT_VERSION;
    if (contractVersion !== MANUAL_HANDOFF_CONTRACT_VERSION) throw failure("MANUAL_HANDOFF_CONTRACT_VERSION_UNSUPPORTED");
    const requestedPackageVersion = input.packageVersion == null ? null : Number(input.packageVersion);
    if (requestedPackageVersion != null && (!Number.isInteger(requestedPackageVersion) || requestedPackageVersion < 1)) throw failure("MANUAL_HANDOFF_PACKAGE_VERSION_INVALID");
    const receiptKey = `${input.organizationId}:${order.id}:${contractVersion}:${generationRequestId}`;
    const requestFingerprint = stable({ production_order_id: order.id, contract_version: contractVersion, package_version: requestedPackageVersion, generation_request_id: generationRequestId });
    const prior = await repository.getGenerationReceipt?.(receiptKey, requestFingerprint, {
      organizationId: input.organizationId, productionOrderId: order.id, contractVersion, generationRequestId
    });
    if (prior) return { package: publicPackage(await repository.getPackage(input.organizationId, prior.package_id)), job: publicJob(await repository.getJob(input.organizationId, prior.job_id)), replayed: true };
    const packageVersion = requestedPackageVersion || await repository.nextPackageVersion(input.organizationId, order.id, contractVersion);
    const priorPackages = await repository.listPackages(input.organizationId, order.id);
    const currentPackage = priorPackages.find((value) => value.package_version === packageVersion);
    if (currentPackage) throw failure("MANUAL_HANDOFF_PACKAGE_VERSION_CONFLICT");
    const at = timestamp();
    const packageId = randomUUID();
    const jobId = randomUUID();
    const value = {
      id: packageId, organization_id: input.organizationId, production_order_id: order.id,
      contract_type: MANUAL_HANDOFF_CONTRACT_TYPE, contract_version: contractVersion, package_version: packageVersion,
      status: "generating", manifest: null, readme: null, manifest_hash: null, package_hash: null,
      storage_key: packageStorageKey({ organization_id: input.organizationId, production_order_id: order.id, id: packageId }),
      generation_request_id: generationRequestId, generation_job_id: jobId, created_by_member_id: input.actorMemberId,
      created_at: at, updated_at: at, row_version: 1, failure_reason: null, supersedes_package_id: priorPackages[0]?.id || null,
      status_history: [{ from_status: null, to_status: "generating", at, actor_member_id: input.actorMemberId, reason: null }]
    };
    const job = {
      id: jobId, organization_id: input.organizationId, type: "manual_handoff_package_generation", package_id: packageId,
      production_order_id: order.id, storage_key: value.storage_key, package_version: packageVersion,
      status: "queued", attempts: 0, max_attempts: maxAttempts, order_snapshot: structuredClone(order),
      failure_reason: null, lease_token: null, lease_expires_at: null, started_at: null, heartbeat_at: null,
      completed_at: null, created_at: at, updated_at: at
    };
    const result = await repository.createGenerationRequest({
      receiptKey, fingerprint: requestFingerprint, package: value, job,
      supersedePackageIds: priorPackages.filter((candidate) => ["generating", "ready", "generation_failed", "expired"].includes(candidate.status)).map((candidate) => candidate.id),
      audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, package_id: packageId, job_id: jobId, event_type: "manual_handoff.generation_requested", metadata: { package_version: packageVersion }, created_at: at }
    });
    return { package: publicPackage(result.package), job: publicJob(result.job), replayed: result.replayed };
  }

  async function buildArtifacts(job) {
    const packageRecord = await repository.getPackage(job.organization_id, job.package_id);
    if (!packageRecord) throw failure("MANUAL_HANDOFF_PACKAGE_NOT_FOUND");
    const manifest = buildManualHandoffManifest({ order: job.order_snapshot, packageId: job.package_id, packageVersion: packageRecord.package_version,
      createdAt: job.created_at, createdByMemberId: job.order_snapshot.created_by_member_id || null, supersedesPackageId: packageRecord.supersedes_package_id || null });
    const embeddedAssets = {};
    for (const reference of manifest.asset_references.filter((item) => item.retrieval_mode === "embedded")) {
      let body = job.order_snapshot.input_snapshot?.asset_references?.find((item) => item.asset_version_id === reference.asset_version_id)?.body;
      if (!Buffer.isBuffer(body) && assetResolver?.getEmbeddedAsset) body = await assetResolver.getEmbeddedAsset({ organizationId: job.organization_id, assetVersionId: reference.asset_version_id });
      if (typeof body === "string") body = Buffer.from(body, "base64");
      if (body instanceof Uint8Array && !Buffer.isBuffer(body)) body = Buffer.from(body);
      if (!Buffer.isBuffer(body)) throw failure("MANUAL_HANDOFF_ASSET_UNAVAILABLE");
      if (!Number.isInteger(reference.size) || body.length !== reference.size || sha256(body) !== reference.checksum) {
        throw failure("MANUAL_HANDOFF_ASSET_INTEGRITY_MISMATCH");
      }
      embeddedAssets[`assets/${reference.asset_version_id}`] = body;
    }
    const builder = archiveBuilder || (async ({ finalManifest, assets }) => buildManualHandoffZip([
      { name: "manifest.json", body: `${JSON.stringify(finalManifest, null, 2)}\n` },
      { name: "README.md", body: renderManualHandoffReadme(finalManifest) },
      ...Object.entries(assets).map(([name, body]) => ({ name, body }))
    ]));
    const manifestWithPlaceholder = { ...manifest, package_hash: null };
    const provisionalReadme = renderManualHandoffReadme({ ...manifestWithPlaceholder, package_hash: sha256(stable({ manifest: manifestWithPlaceholder, assets: Object.keys(embeddedAssets).sort() })) });
    const contentFingerprint = stable({ manifest: manifestWithPlaceholder, readme: provisionalReadme, assets: Object.entries(embeddedAssets).map(([name, body]) => [name, sha256(body)]) });
    const packageHash = sha256(contentFingerprint);
    const finalManifest = { ...manifest, package_hash: packageHash };
    const readme = renderManualHandoffReadme(finalManifest);
    const body = await builder({ finalManifest, manifest: finalManifest, readme, assets: embeddedAssets });
    if (!Buffer.isBuffer(body)) throw failure("MANUAL_HANDOFF_ARCHIVE_BUILD_FAILED");
    return { manifest: finalManifest, readme, body, manifestHash: finalManifest.manifest_hash, packageHash };
  }

  async function getPackage(input) {
    validateActor(input);
    const value = await repository.reconcileDownloadExpiry?.({ organizationId: input.organizationId, packageId: input.packageId, now: timestamp() });
    const result = value || await repository.getPackage(input.organizationId, input.packageId);
    if (!result) throw failure("MANUAL_HANDOFF_PACKAGE_NOT_FOUND");
    return result;
  }

  async function getPackageForAgent(input) {
    if (!clean(input.organizationId) || !clean(input.agentId) || !clean(input.packageId)) throw failure("MANUAL_HANDOFF_CONTEXT_REQUIRED");
    const result = await repository.getPackage(input.organizationId, input.packageId);
    if (!result || result.organization_id !== input.organizationId) throw failure("MANUAL_HANDOFF_PACKAGE_NOT_FOUND");
    return result;
  }

  async function getGenerationJob(input) {
    validateActor(input);
    const result = await repository.getJob(input.organizationId, input.jobId);
    if (!result) throw failure("MANUAL_HANDOFF_JOB_NOT_FOUND");
    return result;
  }

  async function listPackages(input) {
    const order = await scopedOrder(input);
    return (await repository.listPackages(input.organizationId, order.id)).map(publicPackage);
  }

  async function listPackagesForAgent(input) {
    if (!clean(input.organizationId) || !clean(input.agentId) || !clean(input.productionOrderId)) throw failure("MANUAL_HANDOFF_CONTEXT_REQUIRED");
    return repository.listPackages(input.organizationId, input.productionOrderId);
  }

  async function getPackageForCloudExecutor(input) {
    if (!clean(input.organizationId) || !clean(input.executorCloudId) || !clean(input.packageId)) throw failure("MANUAL_HANDOFF_CONTEXT_REQUIRED");
    const result = await repository.getPackage(input.organizationId, input.packageId);
    if (!result || result.organization_id !== input.organizationId) throw failure("MANUAL_HANDOFF_PACKAGE_NOT_FOUND");
    return result;
  }

  async function listPackagesForCloudExecutor(input) {
    if (!clean(input.organizationId) || !clean(input.executorCloudId) || !clean(input.productionOrderId)) throw failure("MANUAL_HANDOFF_CONTEXT_REQUIRED");
    return repository.listPackages(input.organizationId, input.productionOrderId);
  }

  async function getOrder(input) {
    return scopedOrder(input);
  }

  async function claimNextGenerationJob({ leaseMs = 30_000 } = {}) {
    const at = timestamp();
    return repository.claimNextJob(at, new Date(Date.parse(at) + leaseMs).toISOString(), randomUUID());
  }

  async function heartbeatGenerationJob({ job, leaseMs = 30_000 }) {
    const at = timestamp();
    return repository.heartbeatJob({ jobId: job.id, leaseToken: job.lease_token, now: at, leaseExpiresAt: new Date(Date.parse(at) + leaseMs).toISOString() });
  }

  async function completeGenerationJob({ job }) {
    const artifacts = await buildArtifacts(job);
    const at = timestamp();
    try {
      await packageStore.put({ key: job.storage_key || packageStorageKey(job), body: artifacts.body, contentType: MANUAL_HANDOFF_PACKAGE_CONTENT_TYPE, metadata: { organizationId: job.organization_id, packageId: job.package_id } });
    } catch (error) {
      if (error?.code !== "OBJECT_ALREADY_EXISTS") throw error;
    }
    return repository.completeJob({ jobId: job.id, leaseToken: job.lease_token, manifest: artifacts.manifest, readme: artifacts.readme,
      manifestHash: artifacts.manifestHash, packageHash: artifacts.packageHash, storageKey: job.storage_key || packageStorageKey(job), now: at,
      audit: { id: randomUUID(), organization_id: job.organization_id, package_id: job.package_id, job_id: job.id, event_type: "manual_handoff.generation_succeeded", metadata: { package_version: artifacts.manifest.package_version }, created_at: at } });
  }

  async function failGenerationJob({ job, error }) {
    const at = timestamp();
    const reason = safeFailureReason(error);
    return repository.failJob({ jobId: job.id, leaseToken: job.lease_token, failureReason: reason, now: at,
      audit: { id: randomUUID(), organization_id: job.organization_id, package_id: job.package_id, job_id: job.id, event_type: "manual_handoff.generation_failed", metadata: { reason }, created_at: at } });
  }

  async function retryGeneration(input) {
    const value = await getPackage(input);
    if (value.status !== "generation_failed") throw failure("MANUAL_HANDOFF_RETRY_BLOCKED");
    const key = validateKey(input.generationRequestId || input.idempotencyKey, "MANUAL_HANDOFF_GENERATION_REQUEST_REQUIRED");
    const retryRequestId = `${value.id}:${key}`;
    const at = timestamp();
    const result = await repository.retryJob({ organizationId: input.organizationId, packageId: value.id, productionOrderId: value.production_order_id,
      contractVersion: value.contract_version, generationRequestId: retryRequestId, receiptKey: `${input.organizationId}:manual-handoff:retry:${retryRequestId}`,
      fingerprint: stable({ package_id: value.id, package_version: value.package_version }), now: at,
      audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, package_id: value.id, event_type: "manual_handoff.generation_retried", metadata: {}, created_at: at } });
    if (!result) throw failure("MANUAL_HANDOFF_PACKAGE_NOT_FOUND");
    return { package: publicPackage(result.package), job: publicJob(result.job), replayed: result.replayed };
  }

  async function authorizeDownload(input) {
    const value = await getPackage(input);
    if (["generating", "generation_failed"].includes(value.status)) throw failure("MANUAL_HANDOFF_PACKAGE_NOT_READY");
    if (["revoked", "superseded"].includes(value.status)) throw failure("MANUAL_HANDOFF_PACKAGE_NOT_DOWNLOADABLE");
    const at = timestamp();
    if (value.status === "expired") {
      const restored = await repository.transitionPackage({ organizationId: input.organizationId, packageId: value.id, status: "ready", reason: "下载授权重新获取", actorMemberId: input.actorMemberId, now: at });
      if (!restored || restored.status !== "ready") throw failure("MANUAL_HANDOFF_PACKAGE_NOT_DOWNLOADABLE");
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now() + grantTtlMs).toISOString();
    const grant = await repository.createDownloadGrant({ organizationId: input.organizationId, packageId: value.id, memberId: input.actorMemberId, token, expiresAt, now: at,
      audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, package_id: value.id, event_type: "manual_handoff.download_authorized", metadata: { package_version: value.package_version, expires_at: expiresAt }, created_at: at } });
    return { token, expires_at: grant.expires_at, package: await repository.getPackage(input.organizationId, value.id) };
  }

  async function downloadPackage(input) {
    const value = await getPackage(input);
    if (["generating", "generation_failed"].includes(value.status)) throw failure("MANUAL_HANDOFF_PACKAGE_NOT_READY");
    if (["revoked", "superseded"].includes(value.status)) throw failure("MANUAL_HANDOFF_PACKAGE_NOT_DOWNLOADABLE");
    const grant = await repository.getDownloadGrant({ organizationId: input.organizationId, packageId: value.id, memberId: input.actorMemberId, token: input.authorizationToken, now: timestamp() });
    if (!grant) {
      if (value.status === "ready") await repository.transitionPackage({ organizationId: input.organizationId, packageId: value.id, status: "expired", reason: "下载授权已过期", actorMemberId: null, now: timestamp() }).catch(() => undefined);
      throw failure("MANUAL_HANDOFF_DOWNLOAD_AUTHORIZATION_EXPIRED");
    }
    const body = await packageStore.get(value.storage_key);
    if (!body) throw failure("MANUAL_HANDOFF_PACKAGE_OBJECT_MISSING");
    await repository.consumeDownloadGrant({ grantId: grant.id, now: timestamp() });
    await repository.appendAudit?.({ id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, package_id: value.id, event_type: "manual_handoff.downloaded", metadata: { package_version: value.package_version }, created_at: timestamp() });
    return { body, contentType: MANUAL_HANDOFF_PACKAGE_CONTENT_TYPE, package: value };
  }

  async function downloadPackageForAgent(input) {
    const value = await getPackageForAgent(input);
    if (["generating", "generation_failed"].includes(value.status)) throw failure("MANUAL_HANDOFF_PACKAGE_NOT_READY");
    if (["revoked", "superseded", "expired"].includes(value.status)) throw failure("MANUAL_HANDOFF_PACKAGE_NOT_DOWNLOADABLE");
    const body = await packageStore.get(value.storage_key);
    if (!body) throw failure("MANUAL_HANDOFF_PACKAGE_OBJECT_MISSING");
    await repository.appendAudit?.({ id: randomUUID(), organization_id: input.organizationId, actor_member_id: null,
      package_id: value.id, event_type: "manual_handoff.agent_downloaded", metadata: { agent_id: input.agentId, package_version: value.package_version }, created_at: timestamp() });
    return { body, contentType: MANUAL_HANDOFF_PACKAGE_CONTENT_TYPE, package: value };
  }

  async function transitionPackage(input) {
    validateActor(input);
    if (!MANUAL_HANDOFF_PACKAGE_STATES.includes(input.status)) throw failure("MANUAL_HANDOFF_PACKAGE_STATE_INVALID");
    if (input.status === "revoked" && input.actorRole !== "admin") throw failure("MANUAL_HANDOFF_FORBIDDEN");
    const at = timestamp();
    const value = await repository.transitionPackage({ organizationId: input.organizationId, packageId: input.packageId, status: input.status, reason: clean(input.reason) || "包状态已更新", actorMemberId: input.actorMemberId, now: at });
    if (!value) throw failure("MANUAL_HANDOFF_PACKAGE_NOT_FOUND");
    return value;
  }

  return {
    requestGeneration,
    getOrder,
    getPackage,
    getPackageForAgent,
    listPackages,
    listPackagesForAgent,
    getPackageForCloudExecutor,
    listPackagesForCloudExecutor,
    getGenerationJob,
    claimNextGenerationJob,
    heartbeatGenerationJob,
    completeGenerationJob,
    failGenerationJob,
    retryGeneration,
    buildManifest,
    authorizeDownload,
    downloadPackage,
    downloadPackageForAgent,
    transitionPackage,
    publicPackage,
    packageStorageKey
  };
}
