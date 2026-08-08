import { createHash, randomUUID } from "node:crypto";

import { createMemoryAssetRepository } from "../assets/memory-asset-repository.js";
import { createVerifiedOutputAssetPort } from "./verified-output-asset-port.js";

const clean = (value) => typeof value === "string" ? value.trim() : "";
const failure = (code, details = null) => Object.assign(new Error(code), { code, details });
const stableJson = (value) => Array.isArray(value) ? `[${value.map(stableJson).join(",")}]` :
  value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}` : JSON.stringify(value);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const VERIFICATION_STATES = new Set(["queued", "running", "passed", "failed", "requires_action"]);
const BUSINESS_INPUT_FAILURES = new Set([
  "WORK_VERIFICATION_ATTEMPT_INVALID",
  "WORK_VERIFICATION_REPORT_NOT_COMPLETED",
  "WORK_VERIFICATION_PRIMARY_OUTPUT_REQUIRED",
  "WORK_VERIFICATION_CANDIDATE_INVALID",
  "WORK_VERIFICATION_REPORT_OUTPUT_MISMATCH",
  "WORK_VERIFICATION_PACKAGE_MISMATCH",
  "WORK_VERIFICATION_SOURCE_SNAPSHOT_REQUIRED"
]);

function validateActor(input) {
  if (!clean(input.organizationId) || !clean(input.actorMemberId)) throw failure("WORK_VERIFICATION_CONTEXT_REQUIRED");
  if (!["member", "admin"].includes(input.actorRole)) throw failure("WORK_VERIFICATION_FORBIDDEN");
}

function validateKey(value) {
  if (!clean(value) || value.length > 128) throw failure("INVALID_IDEMPOTENCY_KEY");
  return value.trim();
}

function validateResolutionNote(value) {
  const note = clean(value);
  if (!note) throw failure("WORK_VERIFICATION_RECOVERY_NOTE_REQUIRED");
  if (note.length > 2000) throw failure("WORK_VERIFICATION_RECOVERY_NOTE_INVALID");
  return note;
}

function timestamp(now) { return new Date(now()).toISOString(); }

function publicJob(value) {
  if (!value) return null;
  const { organization_id: _organizationId, lease_token: _leaseToken, receipt_key: _receiptKey, ...safe } = value;
  return safe;
}

function publicWork(value) {
  if (!value) return null;
  const { organization_id: _organizationId, object_key: _objectKey, ...safe } = value;
  return safe;
}

function acceptsMediaType(actual, accepted) {
  return accepted.some((pattern) => pattern === actual || (pattern.endsWith("/*") && actual.startsWith(pattern.slice(0, -1))));
}

function latestReport(reports) {
  return reports.filter(Boolean).slice().sort((left, right) =>
    (left.report_version || 0) - (right.report_version || 0) || String(left.submitted_at || "").localeCompare(String(right.submitted_at || "")) || left.id.localeCompare(right.id)).at(-1) || null;
}

function isCoreInputDeviation(report) {
  return (report.deviations || []).some((item) => {
    const code = typeof item === "string" ? item : item?.code;
    return ["input_changed", "core_input_changed", "core_input_modified", "approved_input_changed"].includes(code);
  });
}

function sourceSnapshot(order) {
  const input = order.input_snapshot || {};
  const plan = input.video_plan_version || {};
  const copy = input.approved_copy_snapshot || {};
  const avatar = input.avatar_selection_snapshot || {};
  const videoPlanVersionId = order.video_plan_version_id || plan.id || null;
  const copyVersionId = copy.copy_version_id || copy.id || input.copy_version_id || null;
  const avatarAssetVersionId = avatar.avatar_asset_version_id || avatar.asset_version_id || input.avatar_asset_version_id || null;
  if (!videoPlanVersionId || !copyVersionId || !avatarAssetVersionId) throw failure("WORK_VERIFICATION_SOURCE_SNAPSHOT_REQUIRED");
  return {
    video_plan_version_id: videoPlanVersionId,
    copy_version_id: copyVersionId,
    avatar_asset_version_id: avatarAssetVersionId,
    production_config_snapshot: structuredClone(input.production_config_snapshot || input.capability_config_snapshot || plan.capability_config_snapshot || {})
  };
}

export function createWorkVerificationService({ repository, orderPort, executionPort, packagePort, objectStore,
  verifiedOutputAssetPort = null, outputAssetPort = null, now = Date.now, maxAttempts = 3 } = {}) {
  if (!repository?.createVerificationRequest || !repository?.claimNextVerificationJob || !repository?.completeVerificationJob || !repository?.failVerificationJob) {
    throw new TypeError("work verification repository is required");
  }
  if (!orderPort?.getOrder || !orderPort?.transitionOrder) throw new TypeError("production order port is required");
  if (!executionPort?.getAttempt || !executionPort?.getReport || !executionPort?.listReports || !executionPort?.getCandidate || !executionPort?.listCandidates) {
    throw new TypeError("manual execution port is required");
  }
  if (!packagePort?.getPackage) throw new TypeError("manual handoff package port is required");
  if (!objectStore?.head || !objectStore?.get) throw new TypeError("candidate object store is required");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new TypeError("maxAttempts must be a positive integer");
  const fallbackAssetRepository = verifiedOutputAssetPort || outputAssetPort ? null : createMemoryAssetRepository();
  const canonicalOutputPort = verifiedOutputAssetPort || outputAssetPort || createVerifiedOutputAssetPort({ repository: fallbackAssetRepository });

  async function scopedOrder(input) {
    validateActor(input);
    if (!clean(input.productionOrderId || input.orderId)) throw failure("PRODUCTION_ORDER_NOT_FOUND");
    const order = await orderPort.getOrder({ ...input, orderId: input.productionOrderId || input.orderId });
    if (!order || order.organization_id !== input.organizationId) throw failure("PRODUCTION_ORDER_NOT_FOUND");
    return order;
  }

  async function latestRequestInput(input) {
    const order = await scopedOrder(input);
    const attempt = await executionPort.getAttempt(input.organizationId, input.executionAttemptId);
    const reports = attempt ? await executionPort.listReports(input.organizationId, attempt.id) : [];
    const report = latestReport(reports);
    if (!attempt || attempt.organization_id !== input.organizationId || attempt.production_order_id !== order.id || attempt.status !== "succeeded" ||
      !report || report.id !== input.reportId || report.organization_id !== input.organizationId || report.production_order_id !== order.id ||
      report.execution_attempt_id !== attempt.id || report.outcome !== "completed") throw failure("WORK_VERIFICATION_REPORT_NOT_LATEST");
    const candidateId = report.primary_output?.upload_reference;
    if (!candidateId || candidateId !== input.candidateId) throw failure("WORK_VERIFICATION_PRIMARY_OUTPUT_REQUIRED");
    const candidate = await executionPort.getCandidate(input.organizationId, candidateId);
    if (!candidate || candidate.organization_id !== input.organizationId || candidate.production_order_id !== order.id || candidate.execution_attempt_id !== attempt.id ||
      candidate.role !== "primary_video" || !["uploaded", "pending_verification"].includes(candidate.status)) throw failure("WORK_VERIFICATION_CANDIDATE_NOT_FOUND");
    return { order, attempt, report, candidate };
  }

  async function authoritativeInput(job) {
    const input = { organizationId: job.organization_id, actorMemberId: job.requested_by_member_id, actorRole: job.requested_by_role, productionOrderId: job.production_order_id };
    const order = await scopedOrder(input);
    const attempt = await executionPort.getAttempt(job.organization_id, job.execution_attempt_id);
    if (!attempt || attempt.organization_id !== job.organization_id || attempt.production_order_id !== order.id || attempt.status !== "succeeded") throw failure("WORK_VERIFICATION_ATTEMPT_INVALID");
    const reports = await executionPort.listReports(job.organization_id, attempt.id);
    const report = latestReport(reports);
    if (!report || report.organization_id !== job.organization_id || report.id !== job.report_id || report.production_order_id !== order.id ||
      report.execution_attempt_id !== attempt.id || report.package_id !== attempt.package_id || report.package_version !== attempt.package_version ||
      report.manifest_hash !== attempt.manifest_hash || report.outcome !== "completed") throw failure("WORK_VERIFICATION_REPORT_NOT_COMPLETED");
    const candidateId = report.primary_output?.upload_reference;
    if (!candidateId || candidateId !== job.candidate_id) throw failure("WORK_VERIFICATION_PRIMARY_OUTPUT_REQUIRED");
    const candidate = await executionPort.getCandidate(job.organization_id, candidateId);
    if (!candidate || candidate.organization_id !== job.organization_id || candidate.production_order_id !== order.id || candidate.execution_attempt_id !== attempt.id ||
      candidate.package_id !== attempt.package_id || candidate.package_version !== attempt.package_version || candidate.manifest_hash !== attempt.manifest_hash ||
      candidate.role !== "primary_video" || !["uploaded", "pending_verification"].includes(candidate.status)) throw failure("WORK_VERIFICATION_CANDIDATE_INVALID");
    const reportedOutput = report.primary_output;
    if (reportedOutput.role !== "primary_video" || reportedOutput.media_type !== candidate.media_type || Number(reportedOutput.size) !== Number(candidate.size)) {
      throw failure("WORK_VERIFICATION_REPORT_OUTPUT_MISMATCH");
    }
    const packageRecord = await packagePort.getPackage({ organizationId: job.organization_id, packageId: attempt.package_id });
    if (!packageRecord || packageRecord.organization_id !== job.organization_id || packageRecord.production_order_id !== order.id ||
      packageRecord.package_version !== attempt.package_version || packageRecord.manifest_hash !== attempt.manifest_hash) throw failure("WORK_VERIFICATION_PACKAGE_MISMATCH");
    return { input, order, attempt, report, candidate, packageRecord, source: sourceSnapshot(order) };
  }

  async function verify(job) {
    let source;
    try {
      source = await authoritativeInput(job);
    } catch (error) {
      if (!BUSINESS_INPUT_FAILURES.has(error?.code)) throw error;
      return { checks: [], result: { verificationStatus: "failed", failureKind: "business", failureCode: error.code,
        failureReason: "固定执行报告、候选产物或交接包关系不满足核验门禁。" } };
    }
    const { order, attempt, report, candidate, packageRecord } = source;
    const checks = [];
    const failBusiness = (code, reason) => ({ ...source, checks, result: { verificationStatus: "failed", failureKind: "business", failureCode: code, failureReason: reason } });
    if (isCoreInputDeviation(report)) return { ...source, checks, result: { verificationStatus: "requires_action", failureKind: "business", failureCode: "WORK_VERIFICATION_CORE_INPUT_DEVIATION", failureReason: "核心输入发生偏差，不能自动登记作品。" } };
    const candidates = await executionPort.listCandidates(job.organization_id, attempt.id);
    const primaries = candidates.filter((value) => value.role === "primary_video" && value.status !== "removed");
    if (primaries.length !== 1 || primaries[0].id !== candidate.id) return failBusiness("WORK_VERIFICATION_PRIMARY_OUTPUT_COUNT_INVALID", "主要视频产物数量不符合要求。");
    checks.push({ code: "primary_output_unique", passed: true });
    const accepted = packageRecord.manifest?.accepted_media_types || packageRecord.manifest?.primary_output?.accepted_media_types || ["video/*"];
    if (!acceptsMediaType(candidate.media_type, accepted)) return failBusiness("WORK_VERIFICATION_MEDIA_TYPE_INVALID", "文件类型不符合输出要求。");
    checks.push({ code: "media_type", passed: true });
    const head = await objectStore.head(candidate.object_key);
    if (!head) return failBusiness("WORK_VERIFICATION_OBJECT_MISSING", "候选文件不存在。");
    if (head.metadata?.organizationId !== job.organization_id || head.metadata?.candidateOutputId !== candidate.id) return failBusiness("WORK_VERIFICATION_OBJECT_OWNERSHIP_INVALID", "候选文件归属与登记信息不一致。");
    const body = await objectStore.get(candidate.object_key);
    if (!Buffer.isBuffer(body)) return failBusiness("WORK_VERIFICATION_OBJECT_MISSING", "候选文件不存在。");
    if (head.contentType !== candidate.media_type || body.length !== candidate.size || head.size !== candidate.size) return failBusiness("WORK_VERIFICATION_SIZE_OR_MEDIA_MISMATCH", "文件类型或大小与登记摘要不一致。");
    if (sha256(body) !== String(candidate.checksum).toLowerCase() || String(report.primary_output?.checksum).toLowerCase() !== String(candidate.checksum).toLowerCase()) return failBusiness("WORK_VERIFICATION_CHECKSUM_MISMATCH", "文件内容与登记摘要不一致。");
    checks.push({ code: "object_integrity", passed: true });
    return { ...source, checks, result: { verificationStatus: "passed", failureKind: null, failureCode: null, failureReason: null } };
  }

  async function candidateProjection(job, input) {
    if (!executionPort.markCandidateVerification) return;
    return executionPort.markCandidateVerification({ organizationId: job.organization_id, candidateId: job.candidate_id, verificationJobId: job.id,
      ...input });
  }

  async function requestVerification(input, { recoveryFromJobId = null, resolutionNote = null } = {}) {
    validateActor(input);
    const idempotencyKey = validateKey(input.idempotencyKey);
    if (!clean(input.executionAttemptId) || !clean(input.reportId) || !clean(input.candidateId)) throw failure("WORK_VERIFICATION_CONTEXT_REQUIRED");
    const source = await latestRequestInput(input);
    const { order, attempt, report, candidate } = source;
    const fingerprint = stableJson({ production_order_id: order.id, execution_attempt_id: attempt.id, report_id: report.id, candidate_id: candidate.id, checksum: candidate.checksum });
    const receiptKey = `${input.organizationId}:work-verification:${idempotencyKey}`;
    const at = timestamp(now);
    const job = {
      id: randomUUID(), organization_id: input.organizationId, type: "artifact_verification", production_order_id: order.id,
      execution_attempt_id: attempt.id, report_id: report.id, candidate_id: candidate.id,
      primary_output_checksum: String(candidate.checksum).toLowerCase(), requested_by_member_id: input.actorMemberId, requested_by_role: input.actorRole,
      status: "queued", verification_status: "queued", failure_kind: null, failure_code: null, failure_reason: null,
      attempts: 0, max_attempts: maxAttempts, lease_token: null, lease_expires_at: null, started_at: null, heartbeat_at: null,
      completed_at: null, work_id: null, checks: [], receipt_key: receiptKey, created_at: at, updated_at: at
    };
    const saved = await repository.createVerificationRequest({ receiptKey, fingerprint, job,
      audit: recoveryFromJobId ? { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId,
        production_order_id: order.id, event_type: "work_verification.recovery_requested",
        metadata: { source_job_id: recoveryFromJobId, resolution_note: resolutionNote }, created_at: at } : null });
    if (!saved.replayed || saved.job?.verification_status === "queued") await candidateProjection(saved.job, { verificationStatus: "queued", failureKind: null, failureCode: null, now: at });
    return { job: publicJob(saved.job), work: publicWork(saved.work), replayed: saved.replayed };
  }

  async function heartbeatVerificationJob({ job, leaseMs = 30_000 } = {}) {
    if (!repository.heartbeatVerificationJob || !job) return null;
    const current = now();
    return repository.heartbeatVerificationJob({ jobId: job.id, leaseToken: job.lease_token, now: new Date(current).toISOString(), leaseExpiresAt: new Date(current + leaseMs).toISOString() });
  }

  async function runNextVerificationJob({ leaseMs = 30_000, heartbeatIntervalMs = null } = {}) {
    const current = now();
    const at = new Date(current).toISOString();
    const leaseToken = randomUUID();
    const job = await repository.claimNextVerificationJob({ now: at, leaseExpiresAt: new Date(current + leaseMs).toISOString(), leaseToken,
      onExpired: (expired, details) => candidateProjection(expired, { verificationStatus: expired.verification_status,
        failureKind: details.failureKind, failureCode: details.failureCode, now: details.now, transactionClient: details.transactionClient }) });
    if (!job) return null;
    let heartbeat = null;
    if (repository.heartbeatVerificationJob) {
      const heartbeatDelay = Number.isInteger(heartbeatIntervalMs) && heartbeatIntervalMs > 0 ? heartbeatIntervalMs : Math.max(1000, Math.floor(leaseMs / 3));
      heartbeat = setInterval(() => heartbeatVerificationJob({ job, leaseMs }).catch(() => undefined), heartbeatDelay);
      heartbeat.unref?.();
    }
    try {
      await candidateProjection(job, { verificationStatus: "running", failureKind: null, failureCode: null, now: at });
      const verified = await verify(job);
      const result = verified.result;
      const work = result.verificationStatus === "passed" ? {
        id: randomUUID(), organization_id: job.organization_id, production_order_id: verified.order.id, execution_attempt_id: verified.attempt.id,
        manual_execution_report_id: verified.report.id, package_id: verified.attempt.package_id, package_version: verified.attempt.package_version,
        manifest_hash: verified.attempt.manifest_hash, video_plan_version_id: verified.source.video_plan_version_id, copy_version_id: verified.source.copy_version_id,
        avatar_asset_version_id: verified.source.avatar_asset_version_id, production_config_snapshot: structuredClone(verified.source.production_config_snapshot),
        package_manifest_snapshot: structuredClone(verified.packageRecord.manifest || {}), primary_candidate_id: verified.candidate.id,
        primary_output_checksum: String(verified.candidate.checksum).toLowerCase(), primary_output_media_type: verified.candidate.media_type,
        primary_output_size: verified.candidate.size, status: "available", created_at: timestamp(now), updated_at: timestamp(now)
      } : null;
      const saved = await repository.completeVerificationJob({ jobId: job.id, leaseToken, now: timestamp(now), ...result, checks: verified.checks, work,
        assetRegistration: result.verificationStatus === "passed" ? ({ transactionClient }) => canonicalOutputPort.registerVerifiedOutput({ organizationId: job.organization_id,
          actorMemberId: job.requested_by_member_id, candidate: verified.candidate, now: timestamp(now), transactionClient }) : null,
        candidateProjection: ({ verificationStatus, failureKind, failureCode, now: projectionNow, transactionClient }) => candidateProjection(job,
          { verificationStatus, failureKind, failureCode, now: projectionNow, transactionClient }),
        orderTransition: result.verificationStatus === "passed" ? {
          organizationId: job.organization_id,
          orderId: verified.order.id,
          expectedRevision: verified.order.row_version,
          fromStatuses: ["running", "requires_action"],
          toStatus: "succeeded",
          at: timestamp(now),
          actorMemberId: job.requested_by_member_id,
          reason: "候选产物核验通过并登记 Work"
        } : null,
        transitionOrder: result.verificationStatus === "passed" ? ({ transactionClient } = {}) => orderPort.transitionOrder({ organizationId: job.organization_id,
          actorMemberId: job.requested_by_member_id, actorRole: job.requested_by_role, orderId: verified.order.id, expectedRevision: verified.order.row_version,
          fromStatuses: ["running", "requires_action"], toStatus: "succeeded", at: timestamp(now), reason: "候选产物核验通过并登记 Work", transactionClient }) : null,
        audit: { id: randomUUID(), organization_id: job.organization_id, actor_member_id: job.requested_by_member_id, production_order_id: verified.order?.id || job.production_order_id,
          event_type: `work_verification.${result.verificationStatus}`, metadata: { job_id: job.id, candidate_id: verified.candidate?.id || job.candidate_id, work_id: work?.id || null, failure_code: result.failureCode || null }, created_at: timestamp(now) } });
      return { job: publicJob(saved.job), work: publicWork(saved.work) };
    } catch (error) {
      const reason = error?.code || "WORK_VERIFICATION_FAILED";
      const saved = await repository.failVerificationJob({ jobId: job.id, leaseToken, now: timestamp(now), failureCode: reason,
        failureReason: "产物核验未完成，请重试或返回人工处理。", candidateProjection: ({ verificationStatus, failureKind, failureCode, now: projectionNow, transactionClient }) => candidateProjection(job,
          { verificationStatus, failureKind, failureCode, now: projectionNow, transactionClient }),
        audit: { id: randomUUID(), organization_id: job.organization_id, actor_member_id: job.requested_by_member_id, production_order_id: job.production_order_id,
          event_type: "work_verification.technical_failed", metadata: { job_id: job.id, failure_code: reason }, created_at: timestamp(now) } }).catch((failureError) => {
        if (failureError?.code === "WORK_VERIFICATION_LEASE_LOST") throw error;
        throw failureError;
      });
      return { job: publicJob(saved.job), work: null };
    } finally { if (heartbeat) clearInterval(heartbeat); }
  }

  async function retryVerification(input) {
    validateActor(input);
    const key = validateKey(input.idempotencyKey);
    const job = await repository.getVerificationJob(input.organizationId, input.jobId);
    if (!job) throw failure("WORK_VERIFICATION_JOB_NOT_FOUND");
    const fingerprint = stableJson({ job_id: job.id, mode: "technical_retry" });
    const saved = await repository.retryVerificationJob({ organizationId: input.organizationId, jobId: job.id, receiptKey: `${input.organizationId}:work-verification:retry:${key}`, fingerprint, now: timestamp(now),
      candidateProjection: ({ verificationStatus, failureKind, failureCode, now: projectionNow, transactionClient }) => candidateProjection(job,
        { verificationStatus, failureKind, failureCode, now: projectionNow, transactionClient }),
      audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, production_order_id: job.production_order_id,
        job_id: job.id, candidate_id: job.candidate_id, event_type: "work_verification.retry_requested", metadata: { failure_code: job.failure_code }, created_at: timestamp(now) } });
    return { job: publicJob(saved.job), replayed: saved.replayed };
  }

  async function recoverVerification(input) {
    validateActor(input);
    const key = validateKey(input.idempotencyKey);
    const resolutionNote = validateResolutionNote(input.resolutionNote);
    const job = await repository.getVerificationJob(input.organizationId, input.jobId);
    if (!job) throw failure("WORK_VERIFICATION_JOB_NOT_FOUND");
    if (job.status !== "succeeded" || !["requires_action", "failed"].includes(job.verification_status) ||
      (job.verification_status === "failed" && job.failure_kind !== "business")) throw failure("WORK_VERIFICATION_RECOVERY_BLOCKED");
    const order = await scopedOrder({ ...input, productionOrderId: job.production_order_id });
    const attempt = await executionPort.getAttempt(input.organizationId, job.execution_attempt_id);
    const report = latestReport(attempt ? await executionPort.listReports(input.organizationId, attempt.id) : []);
    const candidateId = report?.primary_output?.upload_reference;
    const candidate = candidateId ? await executionPort.getCandidate(input.organizationId, candidateId) : null;
    const sameAuthoritativeInput = report?.id === job.report_id && candidate?.id === job.candidate_id &&
      String(candidate?.checksum || "").toLowerCase() === String(job.primary_output_checksum || "").toLowerCase();
    if (!report || report.outcome !== "completed" || !candidate || sameAuthoritativeInput) throw failure("WORK_VERIFICATION_CORRECTION_REQUIRED");
    const saved = await requestVerification({ ...input, productionOrderId: order.id, executionAttemptId: attempt.id,
      reportId: report.id, candidateId: candidate.id, idempotencyKey: `recovery:${key}` }, { recoveryFromJobId: job.id, resolutionNote });
    return { job: saved.job, work: saved.work, replayed: saved.replayed };
  }

  async function getVerificationWorkspace(input) {
    const order = await scopedOrder(input);
    const job = await repository.getLatestVerificationJob(input.organizationId, order.id);
    const works = await repository.listWorks(input.organizationId, order.id);
    return { order, job: publicJob(job), work: publicWork(works.at(-1) || null), works: works.map(publicWork) };
  }

  async function getVerificationJob(input) {
    validateActor(input);
    const job = await repository.getVerificationJob(input.organizationId, input.jobId);
    if (!job) throw failure("WORK_VERIFICATION_JOB_NOT_FOUND");
    return publicJob(job);
  }

  return { requestVerification, runNextVerificationJob, heartbeatVerificationJob, retryVerification, recoverVerification,
    getVerificationWorkspace, getVerificationJob, publicJob, publicWork };
}

export { VERIFICATION_STATES };
