import { createHash, randomUUID } from "node:crypto";

import { acceptsMediaType } from "../manual-execution/manual-execution-service.js";

const clean = (value) => typeof value === "string" ? value.trim() : "";
const failure = (code, details = null) => Object.assign(new Error(code), { code, details });
const stableJson = (value) => Array.isArray(value) ? `[${value.map(stableJson).join(",")}]` :
  value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}` : JSON.stringify(value);
const DEFAULT_LEASE_MS = 30_000;
const MAX_LEASE_MS = 30 * 60 * 1000;
const PROGRESS_PHASE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const REPORT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_MAX_CANDIDATE_BYTES = 256 * 1024 * 1024;
const MAX_CANDIDATE_BYTES = 512 * 1024 * 1024;
const CONTROLLED_REASONS = Object.freeze({
  LOGIN_REQUIRED: "本地执行器需要人工重新登录。",
  HUMAN_INTERVENTION_REQUIRED: "本地执行器需要人工处理。",
  PROVIDER_PAGE_CHANGED: "执行页面发生变化，需要人工核对。",
  AVATAR_MAPPING_REQUIRED: "人物映射缺失，需要人工补充后再执行。",
  PACKAGE_ITEM_COUNT_UNSUPPORTED: "交接包包含不支持的商品数量，需要人工核对。"
});
const CONTROLLED_FAILURES = Object.freeze({
  PROVIDER_EXECUTION_FAILED: { stage: "provider_execution", message: "执行器未能完成视频生成。" },
  PROVIDER_RESULT_MISSING: { stage: "artifact_download", message: "执行器未能取得视频结果。" },
  LOCAL_EXECUTOR_ERROR: { stage: "local_executor", message: "本地执行器发生受控错误。" },
  LOCAL_EXECUTION_FAILED: { stage: "local_executor", message: "本地执行器未能完成执行。" }
});

function validateKey(value) {
  const key = clean(value);
  if (!key || key.length > 128) throw failure("INVALID_IDEMPOTENCY_KEY");
  return key;
}

function publicAttempt(value) {
  if (!value) return null;
  const { organization_id: _organizationId, ...safe } = value;
  return safe;
}

function publicCandidate(value) {
  if (!value) return null;
  const { organization_id: _organizationId, upload_token_digest: _tokenDigest, object_key: _objectKey,
    audit: _audit, ...safe } = value;
  return { ...safe, upload_reference: value.id };
}

function publicReport(value) {
  if (!value) return null;
  const { organization_id: _organizationId, ...safe } = value;
  return safe;
}

function sha256(value) {
  return createHash("sha256").update(Buffer.isBuffer(value) ? value : String(value)).digest("hex");
}

function controlledReason(value) {
  const reason = clean(value);
  return CONTROLLED_REASONS[reason] || null;
}

function controlledFailure(value) {
  const code = clean(value);
  return CONTROLLED_FAILURES[code] || null;
}

export function createLocalAgentReadiness({ organizationId, agentId, leaseMs = DEFAULT_LEASE_MS, now = Date.now } = {}) {
  if (!clean(organizationId) || !clean(agentId)) throw new TypeError("local agent readiness identity is required");
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > MAX_LEASE_MS) throw new TypeError("readiness leaseMs must be bounded");
  const configured = { organizationId: organizationId.trim(), agentId: agentId.trim() };
  const receipts = new Map();
  let lastSeenAt = null;

  function validate(input = {}) {
    const scopedOrganizationId = clean(input.organizationId || configured.organizationId);
    const scopedAgentId = clean(input.executorAgentId || input.agentId || configured.agentId);
    if (scopedOrganizationId !== configured.organizationId || scopedAgentId !== configured.agentId) throw failure("LOCAL_AGENT_CONTEXT_REQUIRED");
    return { organizationId: scopedOrganizationId, agentId: scopedAgentId };
  }

  function isOnline(input = {}) {
    const { organizationId: scopedOrganizationId } = validate(input);
    return scopedOrganizationId === configured.organizationId && lastSeenAt !== null && now() - lastSeenAt < leaseMs;
  }

  async function heartbeat(input = {}) {
    const { organizationId: scopedOrganizationId, agentId: scopedAgentId } = validate(input);
    const idempotencyKey = validateKey(input.idempotencyKey);
    const fingerprint = stableJson({ operation: "agent_heartbeat", organization_id: scopedOrganizationId, agent_id: scopedAgentId });
    const receiptKey = `${scopedOrganizationId}:${scopedAgentId}:local-agent:agent-heartbeat:${idempotencyKey}`;
    const previous = receipts.get(receiptKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
      return { ...previous.value, replayed: true };
    }
    const at = now();
    lastSeenAt = at;
    const value = { status: "online", agent_id: scopedAgentId,
      last_seen_at: new Date(at).toISOString(), expires_at: new Date(at + leaseMs).toISOString() };
    receipts.set(receiptKey, { fingerprint, value });
    return { ...value, replayed: false };
  }

  return { heartbeat, isOnline };
}

function validateAgentInput(input, configured) {
  const organizationId = clean(input.organizationId || configured.organizationId);
  const agentId = clean(input.executorAgentId || configured.agentId);
  if (!organizationId || !agentId || organizationId !== configured.organizationId || agentId !== configured.agentId) {
    throw failure("LOCAL_AGENT_CONTEXT_REQUIRED");
  }
  return { organizationId, agentId };
}

export function validateLocalAgentProgressPhase(value) {
  const phase = clean(value);
  if (!PROGRESS_PHASE_PATTERN.test(phase)) throw failure("LOCAL_AGENT_PROGRESS_INVALID");
  return phase;
}

export function createLocalAgentExecutionService({ repository, orderPort, packagePort, candidateStore = null,
  maxCandidateBytes = DEFAULT_MAX_CANDIDATE_BYTES, verificationPort = null, readinessPort = null,
  organizationId, agentId, leaseMs = DEFAULT_LEASE_MS, now = Date.now } = {}) {
  if (!repository?.getReceipt || !repository?.claimAttempt || !repository?.startAttempt || !repository?.getAttempt || !repository?.listAttempts) {
    throw new TypeError("local agent execution repository is required");
  }
  if (!orderPort?.getOrderForAgent || !orderPort?.listOrdersForAgent || !orderPort?.transitionOrderForAgent) {
    throw new TypeError("local agent production order port is required");
  }
  if (!packagePort?.getPackageForAgent || !packagePort?.listPackagesForAgent || !packagePort?.downloadPackageForAgent) throw new TypeError("local agent handoff package port is required");
  if (!clean(organizationId) || !clean(agentId)) throw new TypeError("local agent identity is required");
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > MAX_LEASE_MS) throw new TypeError("leaseMs must be bounded");
  if (!Number.isSafeInteger(maxCandidateBytes) || maxCandidateBytes < 1 || maxCandidateBytes > MAX_CANDIDATE_BYTES) {
    throw new TypeError("maxCandidateBytes must be a positive bounded byte count");
  }

  const configured = { organizationId: organizationId.trim(), agentId: agentId.trim() };
  const timestamp = () => new Date(now()).toISOString();
  const readiness = readinessPort || createLocalAgentReadiness({ ...configured, leaseMs, now });
  if (typeof readiness.heartbeat !== "function" || typeof readiness.isOnline !== "function") {
    throw new TypeError("local agent readiness port is required");
  }
  const verificationTriggers = new Set();

  function context(input = {}) {
    return validateAgentInput(input, configured);
  }

  async function getOrder({ organizationId: scopedOrganizationId, orderId }) {
    const order = await orderPort.getOrderForAgent({ organizationId: scopedOrganizationId, orderId, actorAgentId: configured.agentId });
    if (!order || order.organization_id !== scopedOrganizationId) throw failure("LOCAL_AGENT_ORDER_NOT_FOUND");
    return order;
  }

  async function listOrders(scopedOrganizationId) {
    const values = await orderPort.listOrdersForAgent({ organizationId: scopedOrganizationId, actorAgentId: configured.agentId });
    return (values || []).filter((value) => value?.organization_id === scopedOrganizationId);
  }

  async function getPackage(scopedOrganizationId, packageId) {
    const value = await packagePort.getPackageForAgent({ organizationId: scopedOrganizationId, packageId, agentId: configured.agentId });
    if (!value || value.organization_id !== scopedOrganizationId) throw failure("LOCAL_AGENT_PACKAGE_NOT_FOUND");
    return value;
  }

  async function transitionOrder(input) {
    return orderPort.transitionOrderForAgent({ ...input, actorMemberId: null, actorAgentId: configured.agentId });
  }

  function attemptOwned(attempt, scopedOrganizationId) {
    if (!attempt || attempt.organization_id !== scopedOrganizationId || attempt.executor_type !== "local_agent" || attempt.executor_agent_id !== configured.agentId || attempt.operator_id != null) {
      throw failure("LOCAL_AGENT_ATTEMPT_NOT_FOUND");
    }
    return attempt;
  }

  async function packageForAttempt(attempt) {
    const value = await getPackage(configured.organizationId, attempt.package_id);
    if (value.production_order_id !== attempt.production_order_id || value.package_version !== attempt.package_version ||
      value.manifest_hash !== attempt.manifest_hash || value.status !== "ready") throw failure("LOCAL_AGENT_PACKAGE_MISMATCH");
    return value;
  }

  async function expireLease(attempt, { receiptKey = null, fingerprint = null } = {}) {
    if (!repository.expireAgentAttempt) throw failure("LOCAL_AGENT_LEASE_EXPIRED");
    const at = timestamp();
    const order = await getOrder({ organizationId: configured.organizationId, orderId: attempt.production_order_id });
    const result = await repository.expireAgentAttempt({
      receiptKey, fingerprint, organizationId: configured.organizationId, agentId: configured.agentId,
      attemptId: attempt.id, expectedRevision: attempt.row_version, now: at,
      orderTransition: order.status === "running" || order.status === "claimed" ? {
        organizationId: configured.organizationId, orderId: order.id, expectedRevision: order.row_version,
        fromStatuses: ["claimed", "running"], toStatus: "requires_action", at,
        actorMemberId: null, actorAgentId: configured.agentId, reason: "Local Agent 租约失效，等待人工处理"
      } : null,
      transitionOrder: () => transitionOrder({ organizationId: configured.organizationId, orderId: order.id, expectedRevision: order.row_version,
        fromStatuses: ["claimed", "running"], toStatus: "requires_action", at, reason: "Local Agent 租约失效，等待人工处理" }),
      patch: {
        status: "requires_action", lease_expires_at: null, heartbeat_at: at, progress_phase: "lease_expired",
        updated_at: at, status_history: [...(attempt.status_history || []), { status: "requires_action", at, actor_agent_id: configured.agentId, reason: "lease_expired" }]
      },
      audit: { id: randomUUID(), organization_id: configured.organizationId, actor_member_id: null, actor_agent_id: configured.agentId,
        attempt_id: attempt.id, production_order_id: attempt.production_order_id, package_id: attempt.package_id,
        event_type: "local_agent.lease_expired", metadata: { agent_id: configured.agentId }, created_at: at }
    });
    return result;
  }

  async function ensureLease(attempt) {
    if (["claimed", "running"].includes(attempt.status) && attempt.lease_expires_at && Date.parse(attempt.lease_expires_at) <= now()) {
      await expireLease(attempt);
      throw failure("LOCAL_AGENT_LEASE_EXPIRED");
    }
  }

  async function runningAttempt(input = {}) {
    const { organizationId: scopedOrganizationId } = context(input);
    const currentAttempt = await repository.getAttempt(scopedOrganizationId, input.attemptId);
    const attempt = attemptOwned(currentAttempt, scopedOrganizationId);
    if (attempt.status !== "running") throw failure("LOCAL_AGENT_RESULT_BLOCKED");
    await ensureLease(attempt);
    const order = await getOrder({ organizationId: scopedOrganizationId, orderId: attempt.production_order_id });
    if (order.status !== "running") throw failure("LOCAL_AGENT_ORDER_CONFLICT");
    const packageRecord = await packageForAttempt(attempt);
    return { scopedOrganizationId, attempt, order, packageRecord };
  }

  async function candidateForAttempt(scopedOrganizationId, attempt, candidateId) {
    const candidate = await repository.getCandidate(scopedOrganizationId, candidateId);
    if (!candidate) throw failure("LOCAL_AGENT_CANDIDATE_NOT_FOUND");
    if (candidate.organization_id !== scopedOrganizationId || candidate.production_order_id !== attempt.production_order_id ||
      candidate.execution_attempt_id !== attempt.id || candidate.package_id !== attempt.package_id ||
      candidate.package_version !== attempt.package_version || candidate.manifest_hash !== attempt.manifest_hash ||
      candidate.role !== "primary_video") throw failure("LOCAL_AGENT_CANDIDATE_MISMATCH");
    return candidate;
  }

  async function triggerVerification({ order, attempt, report, candidate }) {
    if (!verificationPort?.requestVerification) throw failure("LOCAL_AGENT_VERIFICATION_UNAVAILABLE");
    if (!clean(order.created_by_member_id)) throw failure("LOCAL_AGENT_VERIFICATION_OWNER_REQUIRED");
    const triggerKey = `${configured.organizationId}:${configured.agentId}:local-agent:verification:${report.id}`;
    if (verificationTriggers.has(triggerKey)) return { replayed: true };
    if (verificationPort.getLatestVerificationJob) {
      const latest = await verificationPort.getLatestVerificationJob(configured.organizationId, order.id);
      if (latest && latest.execution_attempt_id === attempt.id && latest.report_id === report.id && latest.candidate_id === candidate.id) {
        verificationTriggers.add(triggerKey);
        return { job: latest, replayed: true };
      }
    }
    const result = await verificationPort.requestVerification({
      organizationId: configured.organizationId,
      actorMemberId: order.created_by_member_id,
      actorRole: "member",
      productionOrderId: order.id,
      executionAttemptId: attempt.id,
      reportId: report.id,
      candidateId: candidate.id,
      idempotencyKey: triggerKey
    });
    verificationTriggers.add(triggerKey);
    await verificationPort.wake?.();
    return result;
  }

  async function heartbeatAgent(input = {}) {
    context(input);
    return readiness.heartbeat(input);
  }

  async function isOnline(input = {}) {
    context(input);
    return readiness.isOnline(input);
  }

  async function claimTask(input = {}) {
    const { organizationId: scopedOrganizationId, agentId: scopedAgentId } = context(input);
    const idempotencyKey = validateKey(input.idempotencyKey);
    const fingerprint = stableJson({ operation: "claim", organization_id: scopedOrganizationId, agent_id: scopedAgentId });
    const receiptKey = `${scopedOrganizationId}:${scopedAgentId}:local-agent:claim:${idempotencyKey}`;
    const replay = await repository.getReceipt(receiptKey, fingerprint);
    if (replay) return { attempt: publicAttempt(await repository.getAttempt(scopedOrganizationId, replay.attempt_id)), replayed: true };

    for (const order of await listOrders(scopedOrganizationId)) {
      const active = (await repository.listAttempts(scopedOrganizationId, order.id)).find((value) => ["claimed", "running"].includes(value.status));
      if (active) {
        const ownExpired = active.executor_type === "local_agent" && active.executor_agent_id === scopedAgentId &&
          active.lease_expires_at && Date.parse(active.lease_expires_at) <= now();
        if (ownExpired) await expireLease(active);
        continue;
      }
      if (order.status !== "waiting_for_executor") continue;
      const packages = await packagePort.listPackagesForAgent({ organizationId: scopedOrganizationId, productionOrderId: order.id, agentId: scopedAgentId });
      const packageRecord = (packages || []).find((value) => value?.status === "ready");
      if (!packageRecord) continue;
      const at = timestamp();
      const attempt = {
        id: randomUUID(), organization_id: scopedOrganizationId, production_order_id: order.id,
        package_id: packageRecord.id, package_version: packageRecord.package_version, manifest_hash: packageRecord.manifest_hash,
        package_hash: packageRecord.package_hash || null, executor_type: "local_agent", operator_id: null,
        executor_agent_id: scopedAgentId, status: "claimed", row_version: 1, claimed_at: at, started_at: null,
        completed_at: null, lease_expires_at: new Date(now() + leaseMs).toISOString(), heartbeat_at: at,
        progress_phase: "claimed", created_at: at, updated_at: at,
        status_history: [{ status: "claimed", at, actor_agent_id: scopedAgentId }]
      };
      try {
        const saved = await repository.claimAttempt({ receiptKey, fingerprint, attempt,
          orderTransition: { organizationId: scopedOrganizationId, orderId: order.id, expectedRevision: order.row_version,
            fromStatuses: ["waiting_for_executor"], toStatus: "claimed", at, actorMemberId: null, actorAgentId: scopedAgentId,
            reason: "Local Agent 领取任务" },
          transitionOrder: () => transitionOrder({ organizationId: scopedOrganizationId, orderId: order.id, expectedRevision: order.row_version,
            fromStatuses: ["waiting_for_executor"], toStatus: "claimed", at, reason: "Local Agent 领取任务" }),
          audit: { id: randomUUID(), organization_id: scopedOrganizationId, actor_member_id: null, actor_agent_id: scopedAgentId,
            attempt_id: attempt.id, production_order_id: order.id, package_id: packageRecord.id, event_type: "local_agent.claimed",
            metadata: { agent_id: scopedAgentId, package_version: packageRecord.package_version, manifest_hash: packageRecord.manifest_hash }, created_at: at }
        });
        return { attempt: publicAttempt(saved.attempt), replayed: saved.replayed };
      } catch (error) {
        if (["LOCAL_AGENT_ATTEMPT_ACTIVE", "PRODUCTION_ORDER_CONFLICT", "MANUAL_EXECUTION_ATTEMPT_ACTIVE"].includes(error?.code)) continue;
        throw error;
      }
    }
    return { attempt: null, replayed: false };
  }

  async function startTask(input = {}) {
    const { organizationId: scopedOrganizationId, agentId: scopedAgentId } = context(input);
    const idempotencyKey = validateKey(input.idempotencyKey);
    const attempt = attemptOwned(await repository.getAttempt(scopedOrganizationId, input.attemptId), scopedOrganizationId);
    const fingerprint = stableJson({ operation: "start", attempt_id: attempt.id, package_id: attempt.package_id });
    const receiptKey = `${scopedOrganizationId}:${scopedAgentId}:local-agent:start:${idempotencyKey}`;
    const replay = await repository.getReceipt(receiptKey, fingerprint);
    if (replay) return { attempt: publicAttempt(await repository.getAttempt(scopedOrganizationId, replay.attempt_id)), replayed: true };
    if (attempt.status !== "claimed") throw failure("LOCAL_AGENT_ATTEMPT_CONFLICT");
    await ensureLease(attempt);
    const order = await getOrder({ organizationId: scopedOrganizationId, orderId: attempt.production_order_id });
    if (order.status !== "claimed") throw failure("LOCAL_AGENT_ORDER_CONFLICT");
    await packageForAttempt(attempt);
    const at = timestamp();
    const saved = await repository.startAttempt({ receiptKey, fingerprint, attemptId: attempt.id, organizationId: scopedOrganizationId,
      expectedRevision: attempt.row_version,
      patch: { status: "running", started_at: at, lease_expires_at: new Date(now() + leaseMs).toISOString(), heartbeat_at: at,
        progress_phase: "started", updated_at: at, status_history: [...(attempt.status_history || []), { status: "running", at, actor_agent_id: scopedAgentId }] },
      orderTransition: { organizationId: scopedOrganizationId, orderId: order.id, expectedRevision: order.row_version,
        fromStatuses: ["claimed"], toStatus: "running", at, actorMemberId: null, actorAgentId: scopedAgentId, reason: "Local Agent 开始执行" },
      transitionOrder: () => transitionOrder({ organizationId: scopedOrganizationId, orderId: order.id, expectedRevision: order.row_version,
        fromStatuses: ["claimed"], toStatus: "running", at, reason: "Local Agent 开始执行" }),
      audit: { id: randomUUID(), organization_id: scopedOrganizationId, actor_member_id: null, actor_agent_id: scopedAgentId,
        attempt_id: attempt.id, production_order_id: order.id, package_id: attempt.package_id, event_type: "local_agent.started",
        metadata: { agent_id: scopedAgentId }, created_at: at }
    });
    return { attempt: publicAttempt(saved.attempt), replayed: saved.replayed };
  }

  async function heartbeatTask(input = {}) {
    const { organizationId: scopedOrganizationId, agentId: scopedAgentId } = context(input);
    const idempotencyKey = validateKey(input.idempotencyKey);
    const attempt = attemptOwned(await repository.getAttempt(scopedOrganizationId, input.attemptId), scopedOrganizationId);
    const progressPhase = input.progressPhase === undefined
      ? validateLocalAgentProgressPhase(attempt.progress_phase || "running")
      : validateLocalAgentProgressPhase(input.progressPhase);
    const fingerprint = stableJson({ operation: "heartbeat", attempt_id: attempt.id, progress_phase: progressPhase });
    const receiptKey = `${scopedOrganizationId}:${scopedAgentId}:local-agent:heartbeat:${idempotencyKey}`;
    const replay = await repository.getReceipt(receiptKey, fingerprint);
    if (replay) return { attempt: publicAttempt(await repository.getAttempt(scopedOrganizationId, replay.attempt_id)), replayed: true };
    if (!['claimed', 'running'].includes(attempt.status)) throw failure("LOCAL_AGENT_ATTEMPT_CONFLICT");
    await ensureLease(attempt);
    const at = timestamp();
    if (!repository.heartbeatAttempt) throw new TypeError("local agent heartbeat repository method is required");
    const saved = await repository.heartbeatAttempt({ receiptKey, fingerprint, organizationId: scopedOrganizationId, agentId: scopedAgentId,
      attemptId: attempt.id, expectedRevision: attempt.row_version, now: at, leaseExpiresAt: new Date(now() + leaseMs).toISOString(),
      progressPhase, audit: { id: randomUUID(), organization_id: scopedOrganizationId, actor_member_id: null, actor_agent_id: scopedAgentId,
        attempt_id: attempt.id, production_order_id: attempt.production_order_id, package_id: attempt.package_id, event_type: "local_agent.heartbeat",
        metadata: { agent_id: scopedAgentId, progress_phase: progressPhase }, created_at: at }
    });
    return { attempt: publicAttempt(saved.attempt), replayed: saved.replayed };
  }

  async function downloadPackage(input = {}) {
    const { organizationId: scopedOrganizationId } = context(input);
    const attempt = attemptOwned(await repository.getAttempt(scopedOrganizationId, input.attemptId), scopedOrganizationId);
    if (!["claimed", "running"].includes(attempt.status)) throw failure("LOCAL_AGENT_ATTEMPT_CONFLICT");
    await ensureLease(attempt);
    await packageForAttempt(attempt);
    if (typeof packagePort.downloadPackageForAgent !== "function") throw failure("LOCAL_AGENT_PACKAGE_DOWNLOAD_UNAVAILABLE");
    const downloaded = await packagePort.downloadPackageForAgent({ organizationId: scopedOrganizationId,
      packageId: attempt.package_id, agentId: configured.agentId });
    if (!downloaded?.body || !Buffer.isBuffer(downloaded.body)) throw failure("LOCAL_AGENT_PACKAGE_NOT_FOUND");
    return { body: downloaded.body, contentType: downloaded.contentType || "application/zip" };
  }

  async function createCandidateUploadAuthorization(input = {}) {
    const { scopedOrganizationId, attempt, packageRecord } = await runningAttempt(input);
    const idempotencyKey = validateKey(input.idempotencyKey);
    if (input.role !== "primary_video") throw failure("LOCAL_AGENT_CANDIDATE_ROLE_INVALID");
    const originalFilename = clean(input.originalFilename);
    const mediaType = clean(input.mediaType);
    const size = input.size;
    const checksum = clean(input.checksum).toLowerCase();
    if (!originalFilename || originalFilename.length > 255 || originalFilename.includes("/") || originalFilename.includes("\\") ||
      mediaType !== "video/mp4" || !Number.isSafeInteger(size) || size < 1 || size > maxCandidateBytes || !/^[a-f0-9]{64}$/.test(checksum)) {
      if (Number.isSafeInteger(size) && size > maxCandidateBytes) throw failure("LOCAL_AGENT_CANDIDATE_SIZE_INVALID");
      if (mediaType && mediaType !== "video/mp4") throw failure("LOCAL_AGENT_CANDIDATE_MEDIA_TYPE_INVALID");
      throw failure("LOCAL_AGENT_CANDIDATE_INVALID");
    }
    const acceptedTypes = packageRecord.manifest?.accepted_media_types || packageRecord.manifest?.primary_output?.accepted_media_types || ["video/mp4"];
    if (!acceptsMediaType(mediaType, acceptedTypes)) throw failure("LOCAL_AGENT_CANDIDATE_MEDIA_TYPE_INVALID");
    const fingerprint = stableJson({ operation: "candidate_authorize", attempt_id: attempt.id, package_id: attempt.package_id,
      role: input.role, original_filename: originalFilename, media_type: mediaType, size, checksum });
    const receiptKey = `${scopedOrganizationId}:${configured.agentId}:local-agent:candidate-authorize:${idempotencyKey}`;
    const replay = await repository.getReceipt(receiptKey, fingerprint);
    if (replay) return { candidate: publicCandidate(await repository.getCandidate(scopedOrganizationId, replay.candidate_id)), replayed: true };
    const candidates = await repository.listCandidates(scopedOrganizationId, attempt.id);
    if (candidates.some((candidate) => candidate.role === "primary_video" && candidate.status !== "removed")) {
      throw failure("LOCAL_AGENT_PRIMARY_OUTPUT_EXISTS");
    }
    const at = timestamp();
    const candidate = {
      id: randomUUID(), organization_id: scopedOrganizationId, production_order_id: attempt.production_order_id,
      execution_attempt_id: attempt.id, package_id: attempt.package_id, package_version: attempt.package_version,
      manifest_hash: attempt.manifest_hash, role: "primary_video", original_filename: originalFilename, media_type: mediaType,
      size, checksum, status: "upload_pending", row_version: 1,
      upload_token_digest: sha256(`${scopedOrganizationId}:${configured.agentId}:${attempt.id}:${idempotencyKey}`),
      object_key: `manual-execution/${scopedOrganizationId}/${attempt.id}/${randomUUID()}`,
      uploaded_by_member_id: null, uploaded_by_agent_id: configured.agentId, created_at: at, updated_at: at, uploaded_at: null,
      audit: { id: randomUUID(), organization_id: scopedOrganizationId, actor_member_id: null, actor_agent_id: configured.agentId,
        attempt_id: attempt.id, production_order_id: attempt.production_order_id, package_id: attempt.package_id,
        event_type: "local_agent.candidate_upload_authorized", metadata: { candidate_id: null, role: "primary_video" }, created_at: at }
    };
    candidate.audit.metadata.candidate_id = candidate.id;
    const saved = await repository.createCandidateUpload({ receiptKey, fingerprint, candidate });
    return { candidate: publicCandidate(saved.candidate), replayed: saved.replayed };
  }

  async function uploadCandidateObject(input = {}) {
    const { organizationId: scopedOrganizationId } = context(input);
    let attemptId = clean(input.attemptId);
    if (!attemptId) {
      const candidate = await repository.getCandidate(scopedOrganizationId, input.candidateId);
      if (!candidate) throw failure("LOCAL_AGENT_CANDIDATE_NOT_FOUND");
      attemptId = candidate.execution_attempt_id;
    }
    const { attempt } = await runningAttempt({ ...input, attemptId });
    const candidate = await candidateForAttempt(scopedOrganizationId, attempt, input.candidateId);
    const idempotencyKey = validateKey(input.idempotencyKey);
    const body = input.body;
    if (candidate.status !== "upload_pending") throw failure("LOCAL_AGENT_CANDIDATE_CONFLICT");
    if (!Buffer.isBuffer(body) || body.length < 1 || body.length > maxCandidateBytes) {
      if (Buffer.isBuffer(body) && body.length > maxCandidateBytes) throw failure("LOCAL_AGENT_CANDIDATE_SIZE_INVALID");
      throw failure("LOCAL_AGENT_CANDIDATE_INTEGRITY_MISMATCH");
    }
    if (input.contentType !== "video/mp4" || body.length !== candidate.size || sha256(body) !== candidate.checksum) {
      throw failure("LOCAL_AGENT_CANDIDATE_INTEGRITY_MISMATCH");
    }
    const fingerprint = stableJson({ operation: "candidate_upload", attempt_id: attempt.id, candidate_id: candidate.id,
      content_type: input.contentType, size: body.length, checksum: candidate.checksum });
    const receiptKey = `${scopedOrganizationId}:${configured.agentId}:local-agent:candidate-upload:${idempotencyKey}`;
    const replay = await repository.getReceipt(receiptKey, fingerprint);
    if (replay) return { candidate: publicCandidate(await repository.getCandidate(scopedOrganizationId, replay.candidate_id)), status: "uploaded", replayed: true };
    if (!candidateStore?.put || !candidateStore?.head || !candidateStore?.get) throw failure("LOCAL_AGENT_CANDIDATE_STORE_UNAVAILABLE");
    try {
      await candidateStore.put({ key: candidate.object_key, body, contentType: "video/mp4",
        metadata: { organizationId: scopedOrganizationId, candidateOutputId: candidate.id } });
    } catch (error) {
      if (![
        "OBJECT_ALREADY_EXISTS", "EEXIST"
      ].includes(error?.code)) throw failure("LOCAL_AGENT_CANDIDATE_STORE_FAILED");
      const existingHead = await candidateStore.head(candidate.object_key);
      const existingBody = await candidateStore.get(candidate.object_key);
      if (!existingHead || !Buffer.isBuffer(existingBody) || existingHead.contentType !== "video/mp4" ||
        existingBody.length !== candidate.size || sha256(existingBody) !== candidate.checksum) {
        throw failure("LOCAL_AGENT_CANDIDATE_INTEGRITY_MISMATCH");
      }
    }
    if (typeof repository.recordCandidateUpload !== "function") throw failure("LOCAL_AGENT_CANDIDATE_REPOSITORY_UNAVAILABLE");
    const saved = await repository.recordCandidateUpload({ receiptKey, fingerprint, organizationId: scopedOrganizationId,
      candidateId: candidate.id, now: timestamp() });
    return { candidate: publicCandidate(saved.candidate), status: "uploaded", replayed: saved.replayed };
  }

  async function completeCandidateUpload(input = {}) {
    const { scopedOrganizationId, attempt } = await runningAttempt(input);
    const candidate = await candidateForAttempt(scopedOrganizationId, attempt, input.candidateId);
    const idempotencyKey = validateKey(input.idempotencyKey);
    if (!candidateStore?.head || !(await candidateStore.head(candidate.object_key))) throw failure("LOCAL_AGENT_UPLOAD_NOT_COMPLETED");
    const at = timestamp();
    const saved = await repository.markCandidateUploaded({ organizationId: scopedOrganizationId, candidateId: candidate.id, now: at,
      receiptKey: `${scopedOrganizationId}:${configured.agentId}:local-agent:candidate-complete:${idempotencyKey}`,
      fingerprint: stableJson({ operation: "candidate_complete", attempt_id: attempt.id, candidate_id: candidate.id }),
      audit: { id: randomUUID(), organization_id: scopedOrganizationId, actor_member_id: null, actor_agent_id: configured.agentId,
        attempt_id: attempt.id, production_order_id: attempt.production_order_id, package_id: attempt.package_id,
        candidate_id: candidate.id, event_type: "local_agent.candidate_completed", metadata: { candidate_id: candidate.id }, created_at: at } });
    return { candidate: publicCandidate(saved.candidate || saved), replayed: saved.replayed ?? false };
  }

  async function submitReport(input = {}) {
    const { organizationId: scopedOrganizationId, agentId: scopedAgentId } = context(input);
    const idempotencyKey = validateKey(input.idempotencyKey);
    const reportId = clean(input.reportId);
    if (!REPORT_ID_PATTERN.test(reportId)) throw failure("LOCAL_AGENT_REPORT_ID_INVALID");
    const outcome = clean(input.outcome);
    if (!["completed", "requires_action", "failed"].includes(outcome)) throw failure("LOCAL_AGENT_REPORT_OUTCOME_INVALID");
    const attempt = attemptOwned(await repository.getAttempt(scopedOrganizationId, input.attemptId), scopedOrganizationId);
    const order = await getOrder({ organizationId: scopedOrganizationId, orderId: attempt.production_order_id });
    await packageForAttempt(attempt);
    const primaryCandidateId = clean(input.primaryCandidateId);
    const primaryCandidate = primaryCandidateId ? await candidateForAttempt(scopedOrganizationId, attempt, primaryCandidateId) : null;
    const reason = outcome === "requires_action" ? controlledReason(input.reasonCode) : null;
    const failureContext = outcome === "failed" ? controlledFailure(input.errorCode) : null;
    if (outcome === "requires_action" && !reason) throw failure("LOCAL_AGENT_REPORT_ERROR_INVALID");
    if (outcome === "failed" && !failureContext) throw failure("LOCAL_AGENT_REPORT_ERROR_INVALID");
    if (outcome === "completed" && !primaryCandidate) throw failure("LOCAL_AGENT_PRIMARY_OUTPUT_REQUIRED");
    const priorReports = await repository.listReports(scopedOrganizationId, attempt.id);
    const at = timestamp();
    const output = primaryCandidate ? { upload_reference: primaryCandidate.id, original_filename: primaryCandidate.original_filename,
      media_type: primaryCandidate.media_type, size: primaryCandidate.size, checksum: primaryCandidate.checksum, role: "primary_video" } : null;
    const report = {
      id: reportId, organization_id: scopedOrganizationId, report_version: Math.max(0, ...priorReports.map((value) => value.report_version || 0)) + 1,
      production_order_id: attempt.production_order_id, execution_attempt_id: attempt.id, package_id: attempt.package_id,
      package_version: attempt.package_version, manifest_hash: attempt.manifest_hash, submitted_by: null, submitted_by_agent_id: scopedAgentId,
      submitted_at: at, supersedes_report_id: null, outcome, started_at: attempt.started_at,
      completed_at: outcome === "completed" ? at : null, operator_note: "", deviations: [], primary_output: output,
      supporting_outputs: [], error_category: outcome === "failed" ? "local_agent" : null,
      failure_stage: failureContext?.stage || null, requires_action_reason: reason,
      retryability: outcome === "failed" ? "not_retryable" : null, upstream_return_target: null
    };
    const fingerprint = stableJson({ operation: "report", report_id: report.id, attempt_id: attempt.id, package_id: attempt.package_id,
      outcome: report.outcome, primary_output: report.primary_output, reason: report.requires_action_reason,
      failure_stage: report.failure_stage, retryability: report.retryability });
    const receiptKey = `${scopedOrganizationId}:${scopedAgentId}:local-agent:report:${idempotencyKey}`;
    const prior = await repository.getReceipt(receiptKey, fingerprint);
    if (prior) {
      const savedReport = await repository.getReport(scopedOrganizationId, prior.report_id);
      const savedAttempt = await repository.getAttempt(scopedOrganizationId, prior.attempt_id);
      let verification = null;
      if (savedReport?.outcome === "completed") {
        const savedCandidateId = savedReport.primary_output?.upload_reference;
        const savedCandidate = await candidateForAttempt(scopedOrganizationId, savedAttempt, savedCandidateId);
        verification = await triggerVerification({ order, attempt: savedAttempt, report: savedReport, candidate: savedCandidate });
      }
      return { report: publicReport(savedReport), attempt: publicAttempt(savedAttempt), verification, replayed: true };
    }
    if (priorReports.some((value) => value.id === reportId)) throw failure("LOCAL_AGENT_REPORT_CONFLICT");
    if (attempt.status !== "running") throw failure("LOCAL_AGENT_RESULT_BLOCKED");
    await ensureLease(attempt);
    if (order.status !== "running") throw failure("LOCAL_AGENT_ORDER_CONFLICT");
    if (outcome === "completed" && primaryCandidate.status !== "uploaded") throw failure("LOCAL_AGENT_PRIMARY_OUTPUT_REQUIRED");
    if (outcome === "completed" && (!verificationPort?.requestVerification || !clean(order.created_by_member_id))) {
      throw failure(!verificationPort?.requestVerification ? "LOCAL_AGENT_VERIFICATION_UNAVAILABLE" : "LOCAL_AGENT_VERIFICATION_OWNER_REQUIRED");
    }
    const targetStatus = outcome === "completed" ? "succeeded" : outcome === "requires_action" ? "requires_action" : "failed";
    const orderTarget = outcome === "completed" ? null : targetStatus;
    const candidatePatches = outcome === "completed" ? [{ id: primaryCandidate.id, values: { status: "pending_verification" } }] : [];
    const saved = await repository.saveReport({ receiptKey, fingerprint, report, attemptId: attempt.id, organizationId: scopedOrganizationId,
      orderTransition: orderTarget ? { organizationId: scopedOrganizationId, orderId: order.id, expectedRevision: order.row_version,
        fromStatuses: ["running"], toStatus: orderTarget, at, actorMemberId: null, actorAgentId: scopedAgentId,
        reason: `Local Agent 执行报告：${outcome}` } : null,
      expectedRevision: attempt.row_version,
      patchAttempt: { previous_status: attempt.status, status: targetStatus, completed_at: report.completed_at,
        lease_expires_at: null, heartbeat_at: at, progress_phase: targetStatus, updated_at: at,
        status_history: [...(attempt.status_history || []), { status: targetStatus, at, actor_member_id: null, actor_agent_id: scopedAgentId }] },
      candidatePatches,
      transitionOrder: orderTarget ? () => transitionOrder({ organizationId: scopedOrganizationId, orderId: order.id,
        expectedRevision: order.row_version, fromStatuses: ["running"], toStatus: orderTarget, at, reason: `Local Agent 执行报告：${outcome}` }) : null,
      audit: { id: randomUUID(), organization_id: scopedOrganizationId, actor_member_id: null, actor_agent_id: scopedAgentId,
        attempt_id: attempt.id, production_order_id: attempt.production_order_id, package_id: attempt.package_id,
        report_id: report.id, event_type: "local_agent.report_submitted", metadata: { report_id: report.id, outcome }, created_at: at } });
    let verification = null;
    if (outcome === "completed") verification = await triggerVerification({ order, attempt: saved.attempt, report: saved.report, candidate: primaryCandidate });
    return { report: publicReport(saved.report), attempt: publicAttempt(saved.attempt), verification, replayed: saved.replayed };
  }

  return { claimTask, startTask, heartbeatTask, heartbeatAgent, isOnline, downloadPackage,
    createCandidateUploadAuthorization, uploadCandidateObject, completeCandidateUpload, submitReport, publicAttempt, getPackage };
}

export { DEFAULT_LEASE_MS, MAX_LEASE_MS, DEFAULT_MAX_CANDIDATE_BYTES, MAX_CANDIDATE_BYTES };
