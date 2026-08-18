import { createHash, randomUUID } from "node:crypto";

const clean = (value) => typeof value === "string" ? value.trim() : "";
const failure = (code, details = null) => Object.assign(new Error(code), { code, details });
const stableJson = (value) => Array.isArray(value) ? `[${value.map(stableJson).join(",")}]` :
  value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}` : JSON.stringify(value);
const sha256 = (value) => createHash("sha256").update(Buffer.isBuffer(value) ? value : String(value)).digest("hex");
const DEFAULT_LEASE_MS = 30_000;
const MAX_LEASE_MS = 30 * 60 * 1000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5_000;
const PROGRESS_PHASE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const READINESS_STATUSES = new Set(["disabled", "fail_closed", "unconfigured", "requires_login", "storage_blocked",
  "available", "busy", "requires_action"]);
const SAFE_REASON = /^[A-Z][A-Z0-9_]{0,63}$/;

function validateIdentity({ organizationId, executorCloudId }) {
  if (!clean(organizationId) || !clean(executorCloudId)) throw failure("CLOUD_EXECUTOR_CONTEXT_REQUIRED");
  return { organizationId: organizationId.trim(), executorCloudId: executorCloudId.trim() };
}

function validateDuration(value, name, max = MAX_LEASE_MS) {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new TypeError(`${name} must be bounded`);
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

function readyPackage(packages) {
  return (packages || []).find((value) => value?.status === "ready") || null;
}

function hasExpiredLease(attempt, at) {
  return ["claimed", "running"].includes(attempt?.status) && attempt.lease_expires_at && Date.parse(attempt.lease_expires_at) <= at;
}

function publicReadiness(state) {
  if (state === true || state?.ready === true) return { ready: true };
  const status = READINESS_STATUSES.has(state?.status) ? state.status : "requires_action";
  const reason = typeof state?.reason === "string" && SAFE_REASON.test(state.reason) ? state.reason : null;
  return { ready: false, status, ...(reason ? { reason } : {}) };
}

export function createCloudExecutorReadiness({ enabled = false, mode = "fail_closed", configured = false,
  check = null } = {}) {
  return {
    async check(input = {}) {
      if (enabled !== true) return { ready: false, status: "disabled" };
      if (!["fake", "playwright"].includes(mode)) return { ready: false, status: "fail_closed" };
      if (configured !== true) return { ready: false, status: "unconfigured" };
      if (typeof check === "function") return check(input);
      return { ready: true, status: "available" };
    }
  };
}

export function createCloudExecutorService({ repository, orderPort, packagePort, candidateStore, verificationPort = null,
  executor = null, readinessPort = null, enabled = false, mode = "fail_closed", organizationId, executorCloudId,
  leaseMs = DEFAULT_LEASE_MS, heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS, now = Date.now } = {}) {
  if (!repository?.getReceipt || !repository?.claimAttempt || !repository?.startAttempt || !repository?.getAttempt ||
    !repository?.listAttempts || !repository?.heartbeatCloudAttempt || !repository?.expireCloudAttempt ||
    !repository?.createCandidateUpload || !repository?.markCandidateUploaded || !repository?.saveReport) {
    throw new TypeError("cloud executor repository is required");
  }
  if (!orderPort?.listOrdersForCloudExecutor || !orderPort?.getOrderForCloudExecutor || !orderPort?.transitionOrderForCloudExecutor) {
    throw new TypeError("cloud executor production order port is required");
  }
  if (!packagePort?.listPackagesForCloudExecutor || !packagePort?.getPackageForCloudExecutor) {
    throw new TypeError("cloud executor handoff package port is required");
  }
  if (mode === "playwright" && typeof packagePort.downloadPackageForCloudExecutor !== "function") {
    throw new TypeError("cloud executor handoff package archive port is required");
  }
  if (!candidateStore?.put || !candidateStore?.head || !candidateStore?.get) throw new TypeError("cloud executor candidate store is required");
  validateDuration(leaseMs, "leaseMs");
  validateDuration(heartbeatIntervalMs, "heartbeatIntervalMs");
  const identity = { organizationId: clean(organizationId), executorCloudId: clean(executorCloudId) };
  const readiness = readinessPort || createCloudExecutorReadiness({ enabled, mode,
    configured: Boolean(identity.organizationId && identity.executorCloudId) });
  if (typeof readiness.check !== "function") throw new TypeError("cloud executor readiness port is required");

  const timestamp = () => new Date(now()).toISOString();
  const verificationTriggers = new Set();
  let halted = false;

  function cloudContext(input = {}) {
    const scoped = validateIdentity({ organizationId: input.organizationId || identity.organizationId,
      executorCloudId: input.executorCloudId || input.cloudExecutorId || identity.executorCloudId });
    if (scoped.organizationId !== identity.organizationId || scoped.executorCloudId !== identity.executorCloudId) {
      throw failure("CLOUD_EXECUTOR_CONTEXT_REQUIRED");
    }
    return scoped;
  }

  async function listOrders() {
    const values = await orderPort.listOrdersForCloudExecutor({ ...identity });
    return (values || []).filter((value) => value?.organization_id === identity.organizationId);
  }

  async function getOrder(orderId) {
    const value = await orderPort.getOrderForCloudExecutor({ ...identity, orderId });
    if (!value || value.organization_id !== identity.organizationId) throw failure("CLOUD_EXECUTOR_ORDER_NOT_FOUND");
    return value;
  }

  async function transitionOrder(input) {
    return orderPort.transitionOrderForCloudExecutor({ ...input, ...identity, actorCloudExecutorId: identity.executorCloudId });
  }

  async function listPackages(orderId) {
    const values = await packagePort.listPackagesForCloudExecutor({ ...identity, productionOrderId: orderId });
    return (values || []).filter((value) => value?.organization_id === identity.organizationId && value.production_order_id === orderId);
  }

  async function getPackage(packageId) {
    const value = await packagePort.getPackageForCloudExecutor({ ...identity, packageId });
    if (!value || value.organization_id !== identity.organizationId) throw failure("CLOUD_EXECUTOR_PACKAGE_NOT_FOUND");
    return value;
  }

  async function downloadPackageArchive(packageId) {
    const value = await packagePort.downloadPackageForCloudExecutor({ ...identity, packageId });
    if (!Buffer.isBuffer(value?.body)) throw failure("CLOUD_EXECUTOR_PACKAGE_ARCHIVE_INVALID");
    return { body: value.body, contentType: clean(value.contentType) || null };
  }

  function attemptOwned(attempt) {
    if (!attempt || attempt.organization_id !== identity.organizationId || attempt.executor_type !== "cloud_executor" ||
      attempt.executor_cloud_id !== identity.executorCloudId || attempt.operator_id != null || attempt.executor_agent_id != null) {
      throw failure("CLOUD_EXECUTOR_ATTEMPT_NOT_FOUND");
    }
    return attempt;
  }

  async function expireLease(attempt) {
    const order = await getOrder(attempt.production_order_id);
    const at = timestamp();
    const transition = ["claimed", "running"].includes(order.status) ? {
      organizationId: identity.organizationId, orderId: order.id, expectedRevision: order.row_version,
      fromStatuses: ["claimed", "running"], toStatus: "requires_action", at,
      reason: "Cloud Executor 租约失效，等待人工处理"
    } : null;
    const saved = await repository.expireCloudAttempt({
      organizationId: identity.organizationId, executorCloudId: identity.executorCloudId, attemptId: attempt.id,
      expectedRevision: attempt.row_version, now: at,
      patch: { status: "requires_action", lease_expires_at: null, heartbeat_at: at, progress_phase: "lease_expired",
        updated_at: at, status_history: [...(attempt.status_history || []), { status: "requires_action", at,
          actor_cloud_executor_id: identity.executorCloudId, reason: "lease_expired" }] },
      orderTransition: transition,
      transitionOrder: transition ? () => transitionOrder(transition) : null,
      audit: { id: randomUUID(), organization_id: identity.organizationId, actor_cloud_executor_id: identity.executorCloudId,
        attempt_id: attempt.id, production_order_id: attempt.production_order_id, package_id: attempt.package_id,
        event_type: "cloud_executor.lease_expired", metadata: { executor_cloud_id: identity.executorCloudId }, created_at: at }
    });
    halted = true;
    return saved;
  }

  async function expireOwnActiveAttempt() {
    const attempts = await repository.listAttempts(identity.organizationId);
    const active = attempts.find((value) => ["claimed", "running"].includes(value.status));
    if (!active) return null;
    if (active.executor_type !== "cloud_executor" || active.executor_cloud_id !== identity.executorCloudId) return { busy: true, attempt: active };
    if (hasExpiredLease(active, now())) return { expired: true, ...(await expireLease(active)) };
    return { busy: true, attempt: active };
  }

  async function heartbeat(attempt, progressPhase = "executing") {
    const phase = clean(progressPhase);
    if (!PROGRESS_PHASE_PATTERN.test(phase)) throw failure("CLOUD_EXECUTOR_PROGRESS_INVALID");
    const current = await repository.getAttempt(identity.organizationId, attempt.id);
    attemptOwned(current);
    if (!['claimed', 'running'].includes(current.status)) throw failure("CLOUD_EXECUTOR_ATTEMPT_CONFLICT");
    const at = timestamp();
    return repository.heartbeatCloudAttempt({
      organizationId: identity.organizationId, executorCloudId: identity.executorCloudId, attemptId: current.id,
      expectedRevision: current.row_version, now: at, leaseExpiresAt: new Date(now() + leaseMs).toISOString(),
      progressPhase: phase,
      receiptKey: `${identity.organizationId}:${identity.executorCloudId}:cloud-executor:heartbeat:${current.id}:${at}`,
      fingerprint: stableJson({ operation: "heartbeat", attempt_id: current.id, progress_phase: phase, at }),
      audit: { id: randomUUID(), organization_id: identity.organizationId, actor_cloud_executor_id: identity.executorCloudId,
        attempt_id: current.id, production_order_id: current.production_order_id, package_id: current.package_id,
        event_type: "cloud_executor.heartbeat", metadata: { executor_cloud_id: identity.executorCloudId, progress_phase: phase }, created_at: at }
    });
  }

  async function startAttempt(attempt, order) {
    const at = timestamp();
    const fingerprint = stableJson({ operation: "start", attempt_id: attempt.id, package_id: attempt.package_id });
    const receiptKey = `${identity.organizationId}:${identity.executorCloudId}:cloud-executor:start:${attempt.id}`;
    const prior = await repository.getReceipt(receiptKey, fingerprint);
    if (prior) return { attempt: attemptOwned(await repository.getAttempt(identity.organizationId, prior.attempt_id)), replayed: true };
    const saved = await repository.startAttempt({ receiptKey, fingerprint, attemptId: attempt.id,
      organizationId: identity.organizationId, expectedRevision: attempt.row_version,
      patch: { status: "running", started_at: at, lease_expires_at: new Date(now() + leaseMs).toISOString(), heartbeat_at: at,
        progress_phase: "started", updated_at: at,
        status_history: [...(attempt.status_history || []), { status: "running", at, actor_cloud_executor_id: identity.executorCloudId }] },
      orderTransition: { organizationId: identity.organizationId, orderId: order.id, expectedRevision: order.row_version,
        fromStatuses: ["claimed"], toStatus: "running", at, actorCloudExecutorId: identity.executorCloudId,
        reason: "Cloud Executor 开始执行" },
      transitionOrder: () => transitionOrder({ organizationId: identity.organizationId, orderId: order.id, expectedRevision: order.row_version,
        fromStatuses: ["claimed"], toStatus: "running", at, reason: "Cloud Executor 开始执行" }),
      audit: { id: randomUUID(), organization_id: identity.organizationId, actor_cloud_executor_id: identity.executorCloudId,
        attempt_id: attempt.id, production_order_id: order.id, package_id: attempt.package_id,
        event_type: "cloud_executor.started", metadata: { executor_cloud_id: identity.executorCloudId }, created_at: at }
    });
    return { attempt: attemptOwned(saved.attempt), replayed: saved.replayed };
  }

  async function triggerVerification({ order, attempt, report, candidate }) {
    if (!verificationPort?.requestVerification) throw failure("CLOUD_EXECUTOR_VERIFICATION_UNAVAILABLE");
    if (!clean(order.created_by_member_id)) throw failure("CLOUD_EXECUTOR_VERIFICATION_OWNER_REQUIRED");
    const triggerKey = `${identity.organizationId}:${identity.executorCloudId}:cloud-executor:verification:${report.id}`;
    if (verificationTriggers.has(triggerKey)) return { replayed: true };
    if (verificationPort.getLatestVerificationJob) {
      const latest = await verificationPort.getLatestVerificationJob(identity.organizationId, order.id);
      if (latest && latest.execution_attempt_id === attempt.id && latest.report_id === report.id && latest.candidate_id === candidate.id) {
        verificationTriggers.add(triggerKey);
        return { job: latest, replayed: true };
      }
    }
    const result = await verificationPort.requestVerification({
      organizationId: identity.organizationId, actorMemberId: order.created_by_member_id, actorRole: "member",
      productionOrderId: order.id, executionAttemptId: attempt.id, reportId: report.id, candidateId: candidate.id,
      idempotencyKey: triggerKey
    });
    verificationTriggers.add(triggerKey);
    await verificationPort.wake?.();
    return result;
  }

  async function candidateForResult(attempt, packageRecord, result) {
    const body = result?.body;
    if (!Buffer.isBuffer(body) || body.length < 1) throw failure("CLOUD_EXECUTOR_OUTPUT_INVALID");
    const mediaType = clean(result.mediaType) || "video/mp4";
    const checksum = clean(result.checksum).toLowerCase() || sha256(body);
    if (!/^[a-f0-9]{64}$/.test(checksum) || (result.checksum && checksum !== sha256(body))) throw failure("CLOUD_EXECUTOR_OUTPUT_INVALID");
    const id = randomUUID();
    const at = timestamp();
    return {
      id, organization_id: identity.organizationId, production_order_id: attempt.production_order_id,
      execution_attempt_id: attempt.id, package_id: packageRecord.id, package_version: attempt.package_version,
      manifest_hash: attempt.manifest_hash, role: "primary_video", original_filename: clean(result.originalFilename) || "cloud-executor-output.mp4",
      media_type: mediaType, size: body.length, checksum, status: "upload_pending", row_version: 1,
      upload_token_digest: `cloud-executor:${identity.executorCloudId}:${id}`,
      object_key: `cloud-executor/${identity.organizationId}/${attempt.id}/${id}.mp4`,
      uploaded_by_member_id: null, uploaded_by_agent_id: null, uploaded_by_cloud_executor_id: identity.executorCloudId,
      created_at: at, updated_at: at, uploaded_at: null,
      audit: { id: randomUUID(), organization_id: identity.organizationId, actor_cloud_executor_id: identity.executorCloudId,
        attempt_id: attempt.id, production_order_id: attempt.production_order_id, package_id: packageRecord.id,
        event_type: "cloud_executor.candidate_upload_authorized", metadata: { candidate_id: id, role: "primary_video" }, created_at: at },
      body
    };
  }

  async function saveCandidate(candidate) {
    const { body, ...record } = candidate;
    const fingerprint = stableJson({ operation: "candidate", attempt_id: record.execution_attempt_id, candidate_id: record.id, checksum: record.checksum });
    const receiptKey = `${identity.organizationId}:${identity.executorCloudId}:cloud-executor:candidate:${record.id}`;
    const saved = await repository.createCandidateUpload({ receiptKey, fingerprint, candidate: record });
    try {
      await candidateStore.put({ key: record.object_key, body, contentType: record.media_type,
        metadata: { organizationId: identity.organizationId, candidateOutputId: record.id } });
    } catch (error) {
      if (!['OBJECT_ALREADY_EXISTS', 'EEXIST'].includes(error?.code)) throw failure("CLOUD_EXECUTOR_CANDIDATE_STORE_FAILED");
      const existing = await candidateStore.get(record.object_key);
      if (!Buffer.isBuffer(existing) || existing.length !== body.length || sha256(existing) !== record.checksum) throw failure("CLOUD_EXECUTOR_CANDIDATE_INTEGRITY_MISMATCH");
    }
    const at = timestamp();
    const completed = await repository.markCandidateUploaded({ organizationId: identity.organizationId, candidateId: record.id,
      now: at, receiptKey: `${receiptKey}:complete`, fingerprint: stableJson({ operation: "candidate_complete", candidate_id: record.id }),
      audit: { id: randomUUID(), organization_id: identity.organizationId, actor_cloud_executor_id: identity.executorCloudId,
        attempt_id: record.execution_attempt_id, production_order_id: record.production_order_id, package_id: record.package_id,
        candidate_id: record.id, event_type: "cloud_executor.candidate_uploaded", metadata: { candidate_id: record.id }, created_at: at }
    });
    return { candidate: completed.candidate || completed, body, replayed: saved.replayed && completed.replayed };
  }

  async function saveReport({ attempt, order, candidate = null, outcome, failureStage = null, requiresActionReason = null,
    progressPhase = null }) {
    const at = timestamp();
    const reports = await repository.listReports?.(identity.organizationId, attempt.id) || [];
    const report = {
      id: randomUUID(), organization_id: identity.organizationId, report_version: Math.max(0, ...reports.map((value) => value.report_version || 0)) + 1,
      production_order_id: attempt.production_order_id, execution_attempt_id: attempt.id, package_id: attempt.package_id,
      package_version: attempt.package_version, manifest_hash: attempt.manifest_hash, submitted_by: null,
      submitted_by_agent_id: null, submitted_by_cloud_executor_id: identity.executorCloudId, submitted_at: at,
      supersedes_report_id: null, outcome, started_at: attempt.started_at, completed_at: at, operator_note: "", deviations: [],
      primary_output: candidate ? { upload_reference: candidate.id, original_filename: candidate.original_filename,
        media_type: candidate.media_type, size: candidate.size, checksum: candidate.checksum, role: "primary_video" } : null,
      supporting_outputs: [], error_category: ["failed", "requires_action"].includes(outcome) ? "cloud_executor" : null,
      failure_stage: failureStage, requires_action_reason: outcome === "requires_action" ? (requiresActionReason || "Cloud Executor requires human action") : null,
      retryability: ["failed", "requires_action"].includes(outcome) ? "not_retryable" : null,
      upstream_return_target: null
    };
    const fingerprint = stableJson({ operation: "report", report_id: report.id, attempt_id: attempt.id,
      outcome, primary_output: report.primary_output, failure_stage: report.failure_stage });
    const receiptKey = `${identity.organizationId}:${identity.executorCloudId}:cloud-executor:report:${report.id}`;
    const targetStatus = outcome === "completed" ? "succeeded" : outcome;
    const saved = await repository.saveReport({ receiptKey, fingerprint, report, attemptId: attempt.id,
      organizationId: identity.organizationId, expectedRevision: attempt.row_version,
      orderTransition: outcome !== "completed" ? { organizationId: identity.organizationId, orderId: order.id, expectedRevision: order.row_version,
        fromStatuses: ["running"], toStatus: targetStatus, at, actorCloudExecutorId: identity.executorCloudId,
        reason: requiresActionReason || "Cloud Executor 执行失败" } : null,
      transitionOrder: outcome !== "completed" ? () => transitionOrder({ organizationId: identity.organizationId, orderId: order.id,
        expectedRevision: order.row_version, fromStatuses: ["running"], toStatus: targetStatus, at,
        reason: requiresActionReason || "Cloud Executor 执行失败" }) : null,
      patchAttempt: { previous_status: attempt.status, status: targetStatus, completed_at: at, lease_expires_at: null,
        heartbeat_at: at, progress_phase: progressPhase || targetStatus, updated_at: at,
        status_history: [...(attempt.status_history || []), { status: targetStatus, at, actor_cloud_executor_id: identity.executorCloudId,
          reason: requiresActionReason || null }] },
      candidatePatches: candidate ? [{ id: candidate.id, values: { status: "pending_verification" } }] : [],
      audit: { id: randomUUID(), organization_id: identity.organizationId, actor_cloud_executor_id: identity.executorCloudId,
        attempt_id: attempt.id, production_order_id: attempt.production_order_id, package_id: attempt.package_id,
        report_id: report.id, event_type: "cloud_executor.report_submitted", metadata: { report_id: report.id, outcome }, created_at: at }
    });
    return { report: saved.report, attempt: saved.attempt, replayed: saved.replayed };
  }

  async function runAttempt(claimedAttempt, claimedOrder, packageRecord) {
    let started;
    let finishHeartbeats = null;
    try {
      started = await startAttempt(claimedAttempt, claimedOrder);
      const attempt = started.attempt;
      const executionOrder = await getOrder(claimedOrder.id);
      let heartbeatError = null;
      let progressError = null;
      let heartbeatsClosed = false;
      let heartbeatWork = Promise.resolve();
      let timer = null;
      const queueHeartbeat = (phase) => {
        if (heartbeatsClosed) return Promise.reject(failure("CLOUD_EXECUTOR_LEASE_LOST"));
        const pending = heartbeatWork.then(() => heartbeat(attempt, phase));
        heartbeatWork = pending.catch(() => undefined);
        return pending;
      };
      const reportProgress = async ({ phase, evidence = null } = {}) => {
        try {
          const saved = await queueHeartbeat(phase);
          return { ...saved, evidence };
        } catch (error) {
          progressError ||= error;
          throw error;
        }
      };
      let heartbeatFinish = null;
      finishHeartbeats = () => {
        if (!heartbeatFinish) heartbeatFinish = (async () => {
          try {
            heartbeatsClosed = true;
            clearInterval(timer);
            await heartbeatWork;
            if (heartbeatError || progressError) throw failure("CLOUD_EXECUTOR_LEASE_LOST");
            const current = attemptOwned(await repository.getAttempt(identity.organizationId, attempt.id));
            if (current.status !== "running") throw failure("CLOUD_EXECUTOR_LEASE_LOST");
            return current;
          } catch {
            throw failure("CLOUD_EXECUTOR_LEASE_LOST");
          }
        })();
        return heartbeatFinish;
      };
      timer = setInterval(() => queueHeartbeat("executing").catch((error) => { heartbeatError ||= error; }), heartbeatIntervalMs);
      timer.unref?.();
      try {
        if (!['fake', 'playwright'].includes(mode) || typeof executor?.run !== "function") throw failure("CLOUD_EXECUTOR_FAIL_CLOSED");
        const packageArchive = mode === "playwright" ? await downloadPackageArchive(packageRecord.id) : null;
        const result = await executor.run({ organizationId: identity.organizationId, executorCloudId: identity.executorCloudId,
          order: executionOrder, attempt, package: packageRecord,
          ...(packageArchive ? { packageArchive } : {}), progress: reportProgress, checkpoint: reportProgress });
        if (heartbeatError || progressError) throw failure("CLOUD_EXECUTOR_LEASE_LOST");
        if (result?.status === "requires_action" || result?.outcome === "requires_action") {
          const currentAttempt = await finishHeartbeats();
          const requiresAction = await saveReport({ attempt: currentAttempt, order: executionOrder, outcome: "requires_action",
            failureStage: clean(result?.failureStage) || "unknown_post_submit",
            requiresActionReason: clean(result?.requiresActionReason) || "Cloud Executor requires human action",
            progressPhase: clean(result?.failureStage) || "unknown_post_submit" });
          halted = true;
          return { status: "requires_action", stopped: true, attempt: publicAttempt(requiresAction.attempt),
            report: publicReport(requiresAction.report), replayed: requiresAction.replayed };
        }
        if (!result || result.ok === false || result.status === "failed" || result.failure) {
          const currentAttempt = await finishHeartbeats();
          const failed = await saveReport({ attempt: currentAttempt, order: executionOrder, outcome: "failed",
            failureStage: clean(result?.failureStage) || (mode === "playwright" ? "playwright_execution" : "fake_execution") });
          halted = true;
          return { status: "failed", stopped: true, attempt: publicAttempt(failed.attempt), report: publicReport(failed.report), replayed: failed.replayed };
        }
        const candidate = await candidateForResult(attempt, packageRecord, result);
        const uploaded = await saveCandidate(candidate);
        const currentAttempt = await finishHeartbeats();
        const completed = await saveReport({ attempt: currentAttempt, order: executionOrder, candidate: uploaded.candidate, outcome: "completed" });
        const verification = await triggerVerification({ order: executionOrder, attempt: completed.attempt, report: completed.report, candidate: uploaded.candidate });
        return { status: "succeeded", attempt: publicAttempt(completed.attempt), report: publicReport(completed.report),
          candidate: publicCandidate(uploaded.candidate), verification, replayed: completed.replayed };
      } finally {
        heartbeatsClosed = true;
        clearInterval(timer);
      }
    } catch (error) {
      halted = true;
      let terminalError = error;
      let terminalAttempt = null;
      if (finishHeartbeats) {
        try {
          terminalAttempt = await finishHeartbeats();
        } catch {
          terminalError = failure("CLOUD_EXECUTOR_LEASE_LOST");
        }
      }
      if (terminalError?.code === "CLOUD_EXECUTOR_LEASE_LOST") {
        try {
          const current = await repository.getAttempt(identity.organizationId, claimedAttempt.id);
          if (current && ["claimed", "running"].includes(current.status) && hasExpiredLease(current, now())) await expireLease(current);
        } catch {
          // Lease-loss cleanup is best effort; it must not reopen terminal reporting or replace the stable error.
        }
      } else if (started?.attempt?.status === "running" && terminalAttempt) {
        const current = terminalAttempt;
        const order = await getOrder(claimedOrder.id);
        if (current?.status === "running" && order.status === "running") {
          if (terminalError?.code === "CLOUD_EXECUTOR_POST_SUBMIT_UNKNOWN" || terminalError?.outcome === "requires_action") {
            const requiresAction = await saveReport({ attempt: current, order, outcome: "requires_action",
              failureStage: "unknown_post_submit", requiresActionReason: terminalError.message, progressPhase: "unknown_post_submit" });
            return { status: "requires_action", stopped: true, attempt: publicAttempt(requiresAction.attempt),
              report: publicReport(requiresAction.report), replayed: requiresAction.replayed };
          }
          const failed = await saveReport({ attempt: current, order, outcome: "failed",
            failureStage: mode === "playwright" ? "playwright_execution" : "fake_execution" });
          return { status: "failed", stopped: true, attempt: publicAttempt(failed.attempt), report: publicReport(failed.report), replayed: failed.replayed };
        }
      }
      throw terminalError;
    }
  }

  async function runOnce(input = {}) {
    if (enabled !== true) return { status: "disabled", ready: false, claimed: false };
    if (!["fake", "playwright"].includes(mode)) return { status: "fail_closed", ready: false, claimed: false };
    if (!identity.organizationId || !identity.executorCloudId) return { status: "unconfigured", ready: false, claimed: false };
    cloudContext(input);
    if (halted) return { status: "halted", stopped: true };
    const state = publicReadiness(await readiness.check({ ...identity }));
    if (!state.ready) return { status: state.status, ready: false, ...(state.reason ? { reason: state.reason } : {}) };
    const active = await expireOwnActiveAttempt();
    if (active?.expired) return { status: "requires_action", stopped: true, attempt: publicAttempt(active.attempt) };
    if (active?.busy) return { status: "busy", attempt: publicAttempt(active.attempt) };
    const orders = await listOrders();
    let selected = null;
    for (const order of orders) {
      if (order.status !== "waiting_for_executor") continue;
      const packageRecord = readyPackage(await listPackages(order.id));
      if (packageRecord) { selected = { order, packageRecord }; break; }
    }
    if (!selected) return { status: "standby", claimed: false };
    const at = timestamp();
    const attempt = {
      id: randomUUID(), organization_id: identity.organizationId, production_order_id: selected.order.id,
      package_id: selected.packageRecord.id, package_version: selected.packageRecord.package_version,
      manifest_hash: selected.packageRecord.manifest_hash, package_hash: selected.packageRecord.package_hash || null,
      executor_type: "cloud_executor", operator_id: null, executor_agent_id: null, executor_cloud_id: identity.executorCloudId,
      status: "claimed", row_version: 1, claimed_at: at, started_at: null, completed_at: null,
      lease_expires_at: new Date(now() + leaseMs).toISOString(), heartbeat_at: at, progress_phase: "claimed",
      created_at: at, updated_at: at, status_history: [{ status: "claimed", at, actor_cloud_executor_id: identity.executorCloudId }]
    };
    const fingerprint = stableJson({ operation: "claim", production_order_id: selected.order.id, package_id: selected.packageRecord.id,
      package_version: selected.packageRecord.package_version, manifest_hash: selected.packageRecord.manifest_hash,
      executor_cloud_id: identity.executorCloudId });
    const receiptKey = `${identity.organizationId}:${identity.executorCloudId}:cloud-executor:claim:${selected.order.id}`;
    const saved = await repository.claimAttempt({ receiptKey, fingerprint, attempt,
      orderTransition: { organizationId: identity.organizationId, orderId: selected.order.id, expectedRevision: selected.order.row_version,
        fromStatuses: ["waiting_for_executor"], toStatus: "claimed", at, actorCloudExecutorId: identity.executorCloudId,
        reason: "Cloud Executor 领取任务" },
      transitionOrder: () => transitionOrder({ organizationId: identity.organizationId, orderId: selected.order.id,
        expectedRevision: selected.order.row_version, fromStatuses: ["waiting_for_executor"], toStatus: "claimed", at,
        reason: "Cloud Executor 领取任务" }),
      audit: { id: randomUUID(), organization_id: identity.organizationId, actor_cloud_executor_id: identity.executorCloudId,
        attempt_id: attempt.id, production_order_id: selected.order.id, package_id: selected.packageRecord.id,
        event_type: "cloud_executor.claimed", metadata: { executor_cloud_executor_id: identity.executorCloudId,
          package_version: selected.packageRecord.package_version, manifest_hash: selected.packageRecord.manifest_hash }, created_at: at }
    });
    if (!saved?.attempt) throw failure("CLOUD_EXECUTOR_CLAIM_FAILED");
    return runAttempt(saved.attempt, await getOrder(selected.order.id), selected.packageRecord);
  }

  return { runOnce, heartbeat, expireLease, publicAttempt, publicCandidate, publicReport,
    get status() { return halted ? "halted" : "standby"; } };
}

export { DEFAULT_LEASE_MS, DEFAULT_HEARTBEAT_INTERVAL_MS, MAX_LEASE_MS };
