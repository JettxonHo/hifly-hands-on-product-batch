import { createHash, randomBytes, randomUUID } from "node:crypto";

const clean = (value) => typeof value === "string" ? value.trim() : "";
const failure = (code, details = null) => Object.assign(new Error(code), { code, details });
const stableJson = (value) => Array.isArray(value) ? `[${value.map(stableJson).join(",")}]` :
  value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}` : JSON.stringify(value);
const sha256 = (value) => createHash("sha256").update(Buffer.isBuffer(value) ? value : String(value)).digest("hex");
const tokenDigest = (value) => sha256(value);
const CANDIDATE_ROLES = ["primary_video", "supporting_output"];
const REPORT_OUTCOMES = ["completed", "requires_action", "failed", "cancelled"];
const DEFAULT_MAX_CANDIDATE_BYTES = 256 * 1024 * 1024;
const MAX_CANDIDATE_BYTES = 512 * 1024 * 1024;

function validateActor(input) {
  if (!clean(input.organizationId) || !clean(input.actorMemberId)) throw failure("MANUAL_EXECUTION_CONTEXT_REQUIRED");
  if (!["member", "admin"].includes(input.actorRole)) throw failure("MANUAL_EXECUTION_FORBIDDEN");
}

function validateKey(value) {
  if (!clean(value) || value.length > 128) throw failure("INVALID_IDEMPOTENCY_KEY");
  return value.trim();
}

function publicAttempt(value) {
  if (!value) return null;
  const { organization_id: _organizationId, ...safe } = value;
  return safe;
}

function publicCandidate(value) {
  if (!value) return null;
  const { organization_id: _organizationId, upload_token_digest: _tokenDigest, object_key: _objectKey, audit: _audit, ...safe } = value;
  return { ...safe, upload_reference: value.id };
}

function publicReport(value) {
  if (!value) return null;
  const { organization_id: _organizationId, ...safe } = value;
  return safe;
}

export function acceptsMediaType(actual, accepted) {
  return accepted.some((pattern) => pattern === actual || (pattern.endsWith("/*") && actual.startsWith(`${pattern.slice(0, -1)}`)));
}

function normalizeDeviations(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw failure("MANUAL_EXECUTION_REPORT_INVALID");
  return value.map((item) => {
    if (typeof item === "string" && item.trim()) return { code: item.trim(), note: "" };
    if (!item || typeof item !== "object" || !clean(item.code)) throw failure("MANUAL_EXECUTION_REPORT_INVALID");
    return { code: clean(item.code), note: clean(item.note) };
  });
}

export function createManualExecutionService({ repository, orderPort, packagePort, candidateStore, maxCandidateBytes = DEFAULT_MAX_CANDIDATE_BYTES, now = Date.now } = {}) {
  if (!repository?.getReceipt || !repository?.claimAttempt || !repository?.startAttempt || !repository?.getAttempt || !repository?.getReport || !repository?.cancelWaitingOrder || !repository?.listAttempts) {
    throw new TypeError("manual execution repository is required");
  }
  if (!orderPort?.getOrder || !orderPort?.transitionOrder) throw new TypeError("production order transition port is required");
  if (!packagePort?.getPackage || !packagePort?.listPackages) throw new TypeError("manual handoff package port is required");
  if (!candidateStore?.put || !candidateStore?.head || !candidateStore?.get) throw new TypeError("candidate upload store is required");
  if (!Number.isSafeInteger(maxCandidateBytes) || maxCandidateBytes < 1 || maxCandidateBytes > MAX_CANDIDATE_BYTES) {
    throw new TypeError("maxCandidateBytes must be a positive bounded byte count");
  }
  const timestamp = () => new Date(now()).toISOString();

  async function scopedOrder(input) {
    validateActor(input);
    if (!clean(input.productionOrderId || input.orderId)) throw failure("PRODUCTION_ORDER_NOT_FOUND");
    const order = await orderPort.getOrder({ ...input, orderId: input.productionOrderId || input.orderId });
    if (!order || order.organization_id !== input.organizationId) throw failure("PRODUCTION_ORDER_NOT_FOUND");
    return order;
  }

  async function scopedPackage(input, order, { allowNonReady = false } = {}) {
    const packageId = input.packageId || (await packagePort.listPackages({ ...input, productionOrderId: order.id })).find((item) => item.status === "ready")?.id;
    if (!clean(packageId)) throw failure("MANUAL_EXECUTION_PACKAGE_NOT_READY");
    const value = await packagePort.getPackage({ ...input, packageId });
    if (!value || value.id !== packageId || value.organization_id !== input.organizationId || value.production_order_id !== order.id) throw failure("MANUAL_EXECUTION_PACKAGE_NOT_FOUND");
    if ((!allowNonReady && value.status !== "ready") || !clean(value.manifest_hash) || !Number.isInteger(value.package_version)) throw failure("MANUAL_EXECUTION_PACKAGE_NOT_READY");
    return value;
  }

  async function claimManualTask(input) {
    validateActor(input);
    const idempotencyKey = validateKey(input.idempotencyKey);
    const order = await scopedOrder(input);
    const packageRecord = await scopedPackage(input, order, { allowNonReady: true });
    const fingerprint = stableJson({ production_order_id: order.id, package_id: packageRecord.id, package_version: packageRecord.package_version, manifest_hash: packageRecord.manifest_hash });
    const receiptKey = `${input.organizationId}:${input.actorMemberId}:manual-execution:claim:${idempotencyKey}`;
    const prior = await repository.getReceipt(receiptKey, fingerprint);
    if (prior) return { attempt: publicAttempt(await repository.getAttempt(input.organizationId, prior.attempt_id)), replayed: true };
    if (packageRecord.status !== "ready") throw failure("MANUAL_EXECUTION_PACKAGE_NOT_READY");
    const active = (await repository.listAttempts(input.organizationId, order.id)).find((attempt) => ["claimed", "running"].includes(attempt.status));
    if (active) throw failure("MANUAL_EXECUTION_ATTEMPT_ACTIVE");
    if (order.status !== "waiting_for_executor") throw failure("MANUAL_EXECUTION_ORDER_NOT_CLAIMABLE");
    const at = timestamp();
    const attempt = {
      id: randomUUID(), organization_id: input.organizationId, production_order_id: order.id,
      package_id: packageRecord.id, package_version: packageRecord.package_version, manifest_hash: packageRecord.manifest_hash,
      package_hash: packageRecord.package_hash || null, executor_type: "manual", operator_id: input.actorMemberId,
      status: "claimed", row_version: 1, claimed_at: at, started_at: null, completed_at: null, created_at: at, updated_at: at,
      status_history: [{ status: "claimed", at, actor_member_id: input.actorMemberId }]
    };
    const saved = await repository.claimAttempt({ receiptKey, fingerprint, attempt,
      orderTransition: { organizationId: input.organizationId, orderId: order.id, expectedRevision: order.row_version,
        fromStatuses: ["waiting_for_executor"], toStatus: "claimed", at,
        actorMemberId: input.actorMemberId, reason: "人工执行者领取任务" },
      transitionOrder: () => orderPort.transitionOrder({ organizationId: input.organizationId, actorRole: input.actorRole, orderId: order.id,
        expectedRevision: order.row_version, fromStatuses: ["waiting_for_executor"], toStatus: "claimed", at,
        actorMemberId: input.actorMemberId, reason: "人工执行者领取任务" }),
      audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, attempt_id: attempt.id,
        production_order_id: order.id, package_id: packageRecord.id, event_type: "manual_execution.claimed",
        metadata: { package_version: packageRecord.package_version, manifest_hash: packageRecord.manifest_hash }, created_at: at } });
    return { attempt: publicAttempt(saved.attempt), replayed: saved.replayed };
  }

  async function confirmStart(input) {
    validateActor(input);
    const idempotencyKey = validateKey(input.idempotencyKey);
    if (!clean(input.attemptId)) throw failure("MANUAL_EXECUTION_ATTEMPT_NOT_FOUND");
    const attempt = await repository.getAttempt(input.organizationId, input.attemptId);
    if (!attempt) throw failure("MANUAL_EXECUTION_ATTEMPT_NOT_FOUND");
    if (attempt.operator_id !== input.actorMemberId) throw failure("MANUAL_EXECUTION_FORBIDDEN");
    const fingerprint = stableJson({ attempt_id: attempt.id, package_id: attempt.package_id, package_version: attempt.package_version });
    const receiptKey = `${input.organizationId}:${input.actorMemberId}:manual-execution:start:${idempotencyKey}`;
    const prior = await repository.getReceipt(receiptKey, fingerprint);
    if (prior) return { attempt: publicAttempt(await repository.getAttempt(input.organizationId, prior.attempt_id)), replayed: true };
    if (attempt.status !== "claimed") throw failure("MANUAL_EXECUTION_ATTEMPT_CONFLICT");
    const order = await scopedOrder({ ...input, productionOrderId: attempt.production_order_id });
    if (order.status !== "claimed") throw failure("MANUAL_EXECUTION_ORDER_CONFLICT");
    await scopedPackage({ ...input, packageId: attempt.package_id }, order);
    const at = timestamp();
    const saved = await repository.startAttempt({ receiptKey, fingerprint, attemptId: attempt.id, organizationId: input.organizationId,
      orderTransition: { organizationId: input.organizationId, orderId: order.id, expectedRevision: order.row_version,
        fromStatuses: ["claimed"], toStatus: "running", at,
        actorMemberId: input.actorMemberId, reason: "人工执行者确认开始" },
      expectedRevision: attempt.row_version, patch: { status: "running", started_at: at, updated_at: at,
        status_history: [...attempt.status_history, { status: "running", at, actor_member_id: input.actorMemberId }] },
      transitionOrder: () => orderPort.transitionOrder({ organizationId: input.organizationId, actorRole: input.actorRole, orderId: order.id,
        expectedRevision: order.row_version, fromStatuses: ["claimed"], toStatus: "running", at,
        actorMemberId: input.actorMemberId, reason: "人工执行者确认开始" }),
      audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, attempt_id: attempt.id,
        production_order_id: order.id, package_id: attempt.package_id, event_type: "manual_execution.started", metadata: {}, created_at: at } });
    return { attempt: publicAttempt(saved.attempt), replayed: saved.replayed };
  }

  async function scopedAttempt(input, { allowAdmin = true } = {}) {
    validateActor(input);
    if (!clean(input.attemptId)) throw failure("MANUAL_EXECUTION_ATTEMPT_NOT_FOUND");
    const attempt = await repository.getAttempt(input.organizationId, input.attemptId);
    if (!attempt) throw failure("MANUAL_EXECUTION_ATTEMPT_NOT_FOUND");
    if (allowAdmin ? attempt.operator_id !== input.actorMemberId && input.actorRole !== "admin" : attempt.operator_id !== input.actorMemberId) {
      throw failure("MANUAL_EXECUTION_FORBIDDEN");
    }
    return attempt;
  }

  async function createCandidateUploadAuthorization(input) {
    const attempt = await scopedAttempt(input, { allowAdmin: true });
    const idempotencyKey = validateKey(input.idempotencyKey);
    if (attempt.status !== "running") throw failure("MANUAL_EXECUTION_UPLOAD_BLOCKED");
    if (!CANDIDATE_ROLES.includes(input.role)) throw failure("MANUAL_EXECUTION_CANDIDATE_ROLE_INVALID");
    const originalFilename = clean(input.originalFilename);
    const mediaType = clean(input.mediaType);
    if (!originalFilename || originalFilename.length > 255 || originalFilename.includes("/") || originalFilename.includes("\\") ||
      !mediaType || !Number.isSafeInteger(input.size) || input.size < 1 || input.size > maxCandidateBytes || !/^[a-f0-9]{64}$/i.test(input.checksum || "")) {
      if (Number.isSafeInteger(input.size) && input.size > maxCandidateBytes) throw failure("MANUAL_EXECUTION_CANDIDATE_SIZE_INVALID");
      throw failure("MANUAL_EXECUTION_CANDIDATE_INVALID");
    }
    const packageRecord = await packagePort.getPackage({ ...input, packageId: attempt.package_id });
    if (!packageRecord || packageRecord.id !== attempt.package_id || packageRecord.organization_id !== input.organizationId || packageRecord.production_order_id !== attempt.production_order_id || packageRecord.package_version !== attempt.package_version || packageRecord.manifest_hash !== attempt.manifest_hash) {
      throw failure("MANUAL_EXECUTION_PACKAGE_MISMATCH");
    }
    const at = timestamp();
    const token = randomBytes(32).toString("base64url");
    const fingerprint = stableJson({ attempt_id: attempt.id, role: input.role, original_filename: originalFilename,
      media_type: mediaType, size: input.size, checksum: input.checksum.toLowerCase() });
    const receiptKey = `${input.organizationId}:${input.actorMemberId}:manual-execution:candidate-upload:${idempotencyKey}`;
    const replay = await repository.getReceipt(receiptKey, fingerprint);
    if (replay) {
      let authorizedCandidate = await repository.getCandidate(input.organizationId, replay.candidate_id);
      let uploadToken = token;
      if (authorizedCandidate?.status === "upload_pending" && repository.rotateCandidateUploadToken) {
        authorizedCandidate = await repository.rotateCandidateUploadToken({ organizationId: input.organizationId, candidateId: authorizedCandidate.id,
          tokenDigest: tokenDigest(token), now: at });
      } else {
        uploadToken = null;
      }
      return { candidate: publicCandidate(authorizedCandidate), upload_token: uploadToken, replayed: true };
    }
    const candidates = await repository.listCandidates(input.organizationId, attempt.id);
    if (input.role === "primary_video" && candidates.some((candidate) => candidate.role === "primary_video" && candidate.status !== "removed")) {
      throw failure("MANUAL_EXECUTION_PRIMARY_OUTPUT_EXISTS");
    }
    const acceptedTypes = packageRecord.manifest?.accepted_media_types || packageRecord.manifest?.primary_output?.accepted_media_types || ["video/*"];
    if (!acceptsMediaType(mediaType, acceptedTypes)) throw failure("MANUAL_EXECUTION_CANDIDATE_MEDIA_TYPE_INVALID");
    const candidate = {
      id: randomUUID(), organization_id: input.organizationId, production_order_id: attempt.production_order_id,
      execution_attempt_id: attempt.id, package_id: attempt.package_id, package_version: attempt.package_version,
      manifest_hash: attempt.manifest_hash, role: input.role, original_filename: originalFilename, media_type: mediaType,
      size: input.size, checksum: input.checksum.toLowerCase(), status: "upload_pending", row_version: 1,
      upload_token_digest: tokenDigest(token), object_key: `manual-execution/${input.organizationId}/${attempt.id}/${randomUUID()}`,
      uploaded_by_member_id: input.actorMemberId, created_at: at, updated_at: at, uploaded_at: null,
      audit: null
    };
    candidate.audit = { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, attempt_id: attempt.id,
      production_order_id: attempt.production_order_id, package_id: attempt.package_id, event_type: "manual_execution.candidate_upload_authorized",
      metadata: { candidate_id: candidate.id, role: input.role }, created_at: at };
    const saved = await repository.createCandidateUpload({ receiptKey, fingerprint, candidate });
    let authorizedCandidate = saved.candidate;
    let uploadToken = token;
    if (saved.replayed && authorizedCandidate?.status === "upload_pending" && repository.rotateCandidateUploadToken) {
      authorizedCandidate = await repository.rotateCandidateUploadToken({ organizationId: input.organizationId, candidateId: authorizedCandidate.id,
        tokenDigest: tokenDigest(token), now: at });
    } else if (saved.replayed) {
      // A completed authorization is still replayable, but its credential is
      // no longer usable after the candidate leaves upload_pending.
      uploadToken = null;
    }
    return { candidate: publicCandidate(authorizedCandidate), upload_token: uploadToken, replayed: saved.replayed };
  }

  async function candidateByToken(input) {
    validateActor(input);
    const token = clean(input.uploadToken);
    if (!token) throw failure("MANUAL_EXECUTION_UPLOAD_AUTHORIZATION_REQUIRED");
    const candidate = await repository.findCandidateByTokenDigest(input.organizationId, tokenDigest(token));
    if (!candidate || (candidate.uploaded_by_member_id !== input.actorMemberId && input.actorRole !== "admin")) throw failure("MANUAL_EXECUTION_CANDIDATE_NOT_FOUND");
    return candidate;
  }

  async function uploadCandidateObject(input) {
    const candidate = await candidateByToken(input);
    if (candidate.status !== "upload_pending") throw failure("MANUAL_EXECUTION_CANDIDATE_CONFLICT");
    if (!Buffer.isBuffer(input.body) || input.contentType !== candidate.media_type || input.body.length !== candidate.size || sha256(input.body) !== candidate.checksum) {
      throw failure("MANUAL_EXECUTION_CANDIDATE_INTEGRITY_MISMATCH");
    }
    try {
      await candidateStore.put({ key: candidate.object_key, body: input.body, contentType: candidate.media_type,
        metadata: { organizationId: input.organizationId, candidateOutputId: candidate.id } });
    } catch (error) {
      if (!["OBJECT_ALREADY_EXISTS", "EEXIST"].includes(error?.code)) throw error;
      const existing = await candidateStore.get(candidate.object_key);
      if (!existing || sha256(existing) !== candidate.checksum) throw failure("MANUAL_EXECUTION_CANDIDATE_INTEGRITY_MISMATCH");
    }
    return { status: "uploaded", candidate: publicCandidate(candidate) };
  }

  async function completeCandidateUpload(input) {
    const candidate = await candidateByToken(input);
    if (!clean(input.candidateId) || candidate.id !== input.candidateId || (clean(input.attemptId) && candidate.execution_attempt_id !== input.attemptId)) throw failure("MANUAL_EXECUTION_CANDIDATE_NOT_FOUND");
    const idempotencyKey = validateKey(input.idempotencyKey);
    const attempt = await scopedAttempt({ ...input, attemptId: candidate.execution_attempt_id }, { allowAdmin: true });
    if (!candidateStore || !(await candidateStore.head(candidate.object_key))) throw failure("MANUAL_EXECUTION_UPLOAD_NOT_COMPLETED");
    const saved = await repository.markCandidateUploaded({ organizationId: input.organizationId, candidateId: candidate.id, now: timestamp(),
      receiptKey: `${input.organizationId}:${input.actorMemberId}:manual-execution:candidate-complete:${idempotencyKey}`,
      fingerprint: stableJson({ candidate_id: candidate.id, attempt_id: attempt.id }),
      audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, attempt_id: attempt.id,
        production_order_id: attempt.production_order_id, package_id: attempt.package_id, event_type: "manual_execution.candidate_uploaded",
        metadata: { candidate_id: candidate.id }, created_at: timestamp() } });
    return { candidate: publicCandidate(saved.candidate || saved), replayed: saved.replayed ?? (saved.status === "uploaded" && candidate.status === "uploaded") };
  }

  async function submitReport(input) {
    const attempt = await scopedAttempt(input, { allowAdmin: true });
    const reportId = clean(input.reportId) || clean(input.idempotencyKey);
    const idempotencyKey = validateKey(input.idempotencyKey || reportId);
    if (!clean(reportId)) throw failure("MANUAL_EXECUTION_REPORT_ID_REQUIRED");
    if (!REPORT_OUTCOMES.includes(input.outcome)) throw failure("MANUAL_EXECUTION_REPORT_OUTCOME_INVALID");
    const deviations = normalizeDeviations(input.deviations);
    if (deviations.length && !deviations.every((item) => item.note || item.code)) throw failure("MANUAL_EXECUTION_REPORT_INVALID");
    const requiresActionReason = clean(input.requiresActionReason) || null;
    const errorCategory = clean(input.errorCategory) || null;
    const failureStage = clean(input.failureStage) || null;
    const retryability = clean(input.retryability) || null;
    if (input.outcome === "requires_action" && !requiresActionReason) throw failure("MANUAL_EXECUTION_REQUIRES_ACTION_REASON_REQUIRED");
    if (input.outcome === "failed" && (!errorCategory || !failureStage || !["retryable", "not_retryable"].includes(retryability))) {
      throw failure("MANUAL_EXECUTION_FAILURE_CONTEXT_REQUIRED");
    }
    const completedAtInput = ["completed", "cancelled"].includes(input.outcome) ? clean(input.completedAt) || null : null;
    if (completedAtInput && Number.isNaN(Date.parse(completedAtInput))) throw failure("MANUAL_EXECUTION_REPORT_INVALID");
    const supersedesReportId = clean(input.supersedesReportId) || null;
    const priorReports = await repository.listReports(input.organizationId, attempt.id);
    const superseded = supersedesReportId ? priorReports.find((report) => report.id === supersedesReportId) : null;
    if (supersedesReportId && !superseded) throw failure("MANUAL_EXECUTION_REPORT_NOT_FOUND");
    if (superseded && superseded.execution_attempt_id !== attempt.id) throw failure("MANUAL_EXECUTION_REPORT_MISMATCH");
    const primaryCandidateId = clean(input.primaryCandidateId) || null;
    const primaryCandidate = primaryCandidateId ? await repository.getCandidate(input.organizationId, primaryCandidateId) : null;
    const supportingIds = input.supportingCandidateIds == null ? [] : input.supportingCandidateIds;
    if (!Array.isArray(supportingIds)) throw failure("MANUAL_EXECUTION_REPORT_INVALID");
    const supportingCandidates = [];
    for (const candidateId of supportingIds) {
      const candidate = await repository.getCandidate(input.organizationId, candidateId);
      if (!candidate) throw failure("MANUAL_EXECUTION_CANDIDATE_NOT_FOUND");
      if (candidate.execution_attempt_id !== attempt.id || candidate.package_id !== attempt.package_id || candidate.package_version !== attempt.package_version || candidate.manifest_hash !== attempt.manifest_hash) throw failure("MANUAL_EXECUTION_CANDIDATE_MISMATCH");
      if (candidate.role !== "supporting_output") throw failure("MANUAL_EXECUTION_CANDIDATE_MISMATCH");
      supportingCandidates.push(candidate);
    }
    if (primaryCandidate && (primaryCandidate.execution_attempt_id !== attempt.id || primaryCandidate.package_id !== attempt.package_id || primaryCandidate.package_version !== attempt.package_version || primaryCandidate.manifest_hash !== attempt.manifest_hash)) throw failure("MANUAL_EXECUTION_CANDIDATE_MISMATCH");
    if (primaryCandidate && primaryCandidate.role !== "primary_video") throw failure("MANUAL_EXECUTION_CANDIDATE_MISMATCH");
    const at = timestamp();
    const output = (candidate) => candidate ? { upload_reference: candidate.id, original_filename: candidate.original_filename,
      media_type: candidate.media_type, size: candidate.size, checksum: candidate.checksum, role: candidate.role } : null;
    const report = {
      id: reportId, organization_id: input.organizationId, report_version: Math.max(0, ...priorReports.map((item) => item.report_version || 0)) + 1,
      production_order_id: attempt.production_order_id, execution_attempt_id: attempt.id, package_id: attempt.package_id,
      package_version: attempt.package_version, manifest_hash: attempt.manifest_hash, submitted_by: input.actorMemberId,
      submitted_at: at, supersedes_report_id: supersedesReportId, outcome: input.outcome, started_at: attempt.started_at,
      completed_at: ["completed", "cancelled"].includes(input.outcome) ? (completedAtInput || at) : null,
      operator_note: clean(input.operatorNote), deviations, primary_output: output(primaryCandidate),
      supporting_outputs: supportingCandidates.map(output), error_category: errorCategory,
      failure_stage: failureStage, requires_action_reason: requiresActionReason,
      retryability: input.outcome === "failed" ? retryability : null, upstream_return_target: clean(input.upstreamReturnTarget) || null
    };
    const fingerprint = stableJson({ report_id: report.id, organization_id: report.organization_id, attempt_id: attempt.id,
      production_order_id: report.production_order_id, package_id: report.package_id, package_version: report.package_version,
      manifest_hash: report.manifest_hash, submitted_by: report.submitted_by, outcome: report.outcome,
      started_at: report.started_at, completed_at: completedAtInput, supersedes_report_id: report.supersedes_report_id,
      operator_note: report.operator_note, deviations: report.deviations, primary_output: report.primary_output,
      supporting_outputs: report.supporting_outputs, error_category: report.error_category, failure_stage: report.failure_stage,
      requires_action_reason: report.requires_action_reason, retryability: report.retryability,
      upstream_return_target: report.upstream_return_target });
    const receiptKey = `${input.organizationId}:manual-execution:report:${report.id}`;
    const prior = await repository.getReceipt(receiptKey, fingerprint);
    if (prior) {
      return { report: publicReport(await repository.getReport(input.organizationId, prior.report_id)),
        attempt: publicAttempt(await repository.getAttempt(input.organizationId, prior.attempt_id)), replayed: true };
    }

    const latestReport = priorReports.at(-1) || null;
    if (latestReport) {
      if (!supersedesReportId) throw failure("MANUAL_EXECUTION_REPORT_CORRECTION_REQUIRED");
      if (supersedesReportId !== latestReport.id) throw failure("MANUAL_EXECUTION_REPORT_NOT_LATEST");
      if (["claimed", "cancelled", "superseded"].includes(attempt.status)) throw failure("MANUAL_EXECUTION_REPORT_CORRECTION_BLOCKED");
      if (attempt.status === "cancel_requested" && input.outcome !== "cancelled") throw failure("MANUAL_EXECUTION_CANCEL_CONFLICT");
      const allowedCorrection = (attempt.status === "running" && input.outcome !== "cancelled") ||
        (attempt.status === "requires_action" && input.outcome === "requires_action") ||
        (attempt.status === "failed" && input.outcome === "failed") ||
        (attempt.status === "succeeded" && ["completed", "requires_action"].includes(input.outcome)) ||
        (attempt.status === "cancel_requested" && input.outcome === "cancelled");
      if (!allowedCorrection) throw failure("MANUAL_EXECUTION_REPORT_CORRECTION_BLOCKED");
      if (attempt.status === "failed" && latestReport.retryability === "not_retryable" && retryability === "retryable") {
        throw failure("MANUAL_EXECUTION_REPORT_CORRECTION_BLOCKED");
      }
    } else if (input.outcome === "cancelled") {
      if (attempt.status !== "cancel_requested") throw failure("MANUAL_EXECUTION_CANCEL_NOT_REQUESTED");
    } else if (attempt.status === "claimed") {
      throw failure("MANUAL_EXECUTION_REPORT_BLOCKED");
    } else if (attempt.status !== "running") {
      throw failure("MANUAL_EXECUTION_REPORT_CORRECTION_BLOCKED");
    }

    // Idempotent replays are decided before this current-state gate: a
    // completed report moves its candidate to pending_verification.
    const candidateReadyStatuses = new Set(["uploaded", ...(latestReport ? ["pending_verification"] : [])]);
    if (input.outcome === "completed" && (!primaryCandidate || !candidateReadyStatuses.has(primaryCandidate.status))) throw failure("MANUAL_EXECUTION_PRIMARY_OUTPUT_REQUIRED");
    for (const candidate of supportingCandidates) {
      if (!candidateReadyStatuses.has(candidate.status)) throw failure("MANUAL_EXECUTION_CANDIDATE_NOT_READY");
    }
    if (input.outcome === "cancelled" && (await scopedOrder({ ...input, productionOrderId: attempt.production_order_id })).status !== "cancel_requested") throw failure("MANUAL_EXECUTION_CANCEL_NOT_REQUESTED");
    const targetStatus = input.outcome === "completed" ? "succeeded" : input.outcome === "requires_action" ? "requires_action" : input.outcome === "failed" ? "failed" : "cancelled";
    const order = await scopedOrder({ ...input, productionOrderId: attempt.production_order_id });
    const orderTarget = input.outcome === "requires_action" ? "requires_action" : input.outcome === "failed" ? (retryability === "retryable" ? "requires_action" : "failed") : input.outcome === "cancelled" ? "cancelled" : null;
    const candidatePatches = input.outcome === "completed" ? [primaryCandidate, ...supportingCandidates].filter((candidate) => candidate?.status === "uploaded").map((candidate) => ({ id: candidate.id, values: { status: "pending_verification" } })) : [];
    const effectiveOrderTarget = orderTarget && order.status !== orderTarget ? orderTarget : null;
    const saved = await repository.saveReport({ receiptKey, fingerprint, report, attemptId: attempt.id, organizationId: input.organizationId,
      orderTransition: effectiveOrderTarget ? { organizationId: input.organizationId, orderId: order.id, expectedRevision: order.row_version,
        fromStatuses: effectiveOrderTarget === "cancelled" ? ["cancel_requested"] : ["running", "claimed", "requires_action", "failed"],
        toStatus: effectiveOrderTarget, at, actorMemberId: input.actorMemberId, reason: `人工执行报告：${input.outcome}` } : null,
      expectedRevision: attempt.row_version, patchAttempt: { previous_status: attempt.status, status: targetStatus,
        completed_at: report.completed_at, updated_at: at, status_history: [...attempt.status_history, { status: targetStatus, at, actor_member_id: input.actorMemberId }] },
      candidatePatches, transitionOrder: effectiveOrderTarget ? () => orderPort.transitionOrder({ organizationId: input.organizationId, actorRole: input.actorRole, orderId: order.id,
        expectedRevision: order.row_version, fromStatuses: effectiveOrderTarget === "cancelled" ? ["cancel_requested"] : ["running", "claimed", "requires_action", "failed"],
        toStatus: effectiveOrderTarget, at, actorMemberId: input.actorMemberId, reason: `人工执行报告：${input.outcome}` }) : null,
      audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, attempt_id: attempt.id,
        production_order_id: attempt.production_order_id, package_id: attempt.package_id, event_type: "manual_execution.report_submitted",
        metadata: { report_id: report.id, report_version: report.report_version, outcome: report.outcome }, created_at: at } });
    return { report: publicReport(saved.report), attempt: publicAttempt(saved.attempt), replayed: saved.replayed };
  }

  async function listCandidates(input) {
    const attempt = await scopedAttempt(input, { allowAdmin: true });
    return (await repository.listCandidates(input.organizationId, attempt.id)).map(publicCandidate);
  }

  async function listReports(input) {
    const attempt = await scopedAttempt(input, { allowAdmin: true });
    return (await repository.listReports(input.organizationId, attempt.id)).map(publicReport);
  }

  async function getExecutionWorkspace(input) {
    const order = await scopedOrder(input);
    const attempts = await repository.listAttempts(input.organizationId, order.id);
    const currentAttempt = attempts.find((item) => ["claimed", "running", "requires_action", "failed", "cancel_requested"].includes(item.status)) ||
      attempts.slice().reverse().find((item) => item.status !== "superseded") || null;
    const [candidates, reports] = currentAttempt
      ? await Promise.all([repository.listCandidates(input.organizationId, currentAttempt.id), repository.listReports(input.organizationId, currentAttempt.id)])
      : [[], []];
    return {
      order: { ...order },
      current_attempt: publicAttempt(currentAttempt),
      attempts: attempts.map(publicAttempt),
      candidates: candidates.map(publicCandidate),
      reports: reports.map(publicReport)
    };
  }

  async function recheckAttempt(input) {
    const attempt = await scopedAttempt(input, { allowAdmin: true });
    const idempotencyKey = validateKey(input.idempotencyKey);
    const fingerprint = stableJson({ attempt_id: attempt.id, resolution_note: clean(input.resolutionNote) });
    const receiptKey = `${input.organizationId}:${input.actorMemberId}:manual-execution:recheck:${idempotencyKey}`;
    const prior = await repository.getReceipt(receiptKey, fingerprint);
    if (prior) return { attempt: publicAttempt(await repository.getAttempt(input.organizationId, prior.attempt_id)), replayed: true };
    if (attempt.status !== "requires_action" || !clean(input.resolutionNote)) throw failure("MANUAL_EXECUTION_RECHECK_BLOCKED");
    const order = await scopedOrder({ ...input, productionOrderId: attempt.production_order_id });
    if (order.status !== "requires_action") throw failure("MANUAL_EXECUTION_ORDER_CONFLICT");
    const at = timestamp();
    const saved = await repository.recoverAttempt({ receiptKey, fingerprint, attemptId: attempt.id, organizationId: input.organizationId,
      orderTransition: { organizationId: input.organizationId, orderId: order.id, expectedRevision: order.row_version,
        fromStatuses: ["requires_action"], toStatus: "running", at,
        actorMemberId: input.actorMemberId, reason: "人工处理完成并重新检查" },
      expectedRevision: attempt.row_version, patch: { status: "running", updated_at: at,
        status_history: [...attempt.status_history, { status: "running", at, actor_member_id: input.actorMemberId, reason: clean(input.resolutionNote) }] },
      transitionOrder: () => orderPort.transitionOrder({ organizationId: input.organizationId, actorRole: input.actorRole, orderId: order.id,
        expectedRevision: order.row_version, fromStatuses: ["requires_action"], toStatus: "running", at,
        actorMemberId: input.actorMemberId, reason: "人工处理完成并重新检查" }),
      audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, attempt_id: attempt.id,
        production_order_id: order.id, package_id: attempt.package_id, event_type: "manual_execution.rechecked",
        metadata: { resolution_note: clean(input.resolutionNote) }, created_at: at } });
    return { attempt: publicAttempt(saved.attempt), replayed: saved.replayed };
  }

  async function reenterFailedAttempt(input) {
    const attempt = await scopedAttempt(input, { allowAdmin: true });
    const idempotencyKey = validateKey(input.idempotencyKey);
    const reports = await repository.listReports(input.organizationId, attempt.id);
    const latest = reports.at(-1);
    const fingerprint = stableJson({ attempt_id: attempt.id, retryability: latest?.retryability || null });
    const receiptKey = `${input.organizationId}:${input.actorMemberId}:manual-execution:reentry:${idempotencyKey}`;
    const prior = await repository.getReceipt(receiptKey, fingerprint);
    if (prior) return { attempt: publicAttempt(await repository.getAttempt(input.organizationId, prior.attempt_id)), replayed: true };
    if (attempt.status !== "failed" || !latest || latest.outcome !== "failed" || latest.retryability !== "retryable") throw failure("MANUAL_EXECUTION_REENTRY_BLOCKED");
    const order = await scopedOrder({ ...input, productionOrderId: attempt.production_order_id });
    if (order.status !== "requires_action") throw failure("MANUAL_EXECUTION_ORDER_CONFLICT");
    const at = timestamp();
    const saved = await repository.supersedeFailedAttempt({ receiptKey, fingerprint, attemptId: attempt.id, organizationId: input.organizationId,
      orderTransition: { organizationId: input.organizationId, orderId: order.id, expectedRevision: order.row_version,
        fromStatuses: ["requires_action"], toStatus: "waiting_for_executor", at,
        actorMemberId: input.actorMemberId, reason: "可重试人工执行失败，允许重新领取" },
      expectedRevision: attempt.row_version, patch: { status: "superseded", updated_at: at,
        status_history: [...attempt.status_history, { status: "superseded", at, actor_member_id: input.actorMemberId, reason: "为可重试技术问题重新领取" }] },
      transitionOrder: () => orderPort.transitionOrder({ organizationId: input.organizationId, actorRole: input.actorRole, orderId: order.id,
        expectedRevision: order.row_version, fromStatuses: ["requires_action"], toStatus: "waiting_for_executor", at,
        actorMemberId: input.actorMemberId, reason: "可重试人工执行失败，允许重新领取" }),
      audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, attempt_id: attempt.id,
        production_order_id: order.id, package_id: attempt.package_id, event_type: "manual_execution.reentered",
        metadata: { superseded_attempt_id: attempt.id }, created_at: at } });
    return { attempt: publicAttempt(saved.attempt), replayed: saved.replayed };
  }

  async function requestOrderCancellation(input) {
    validateActor(input);
    const idempotencyKey = validateKey(input.idempotencyKey);
    const order = await scopedOrder(input);
    const attempts = await repository.listAttempts(input.organizationId, order.id);
    const active = attempts.find((attempt) => ["claimed", "running"].includes(attempt.status));
    const at = timestamp();
    const fingerprint = stableJson({ order_id: order.id, attempt_id: active?.id || null });
    const receiptKey = `${input.organizationId}:${input.actorMemberId}:manual-execution:cancel:${idempotencyKey}`;
    const prior = await repository.getReceipt(receiptKey, fingerprint);
    if (prior) {
      return { order: await orderPort.getOrder({ ...input, orderId: order.id }), attempt: prior.attempt_id ? publicAttempt(await repository.getAttempt(input.organizationId, prior.attempt_id)) : null, replayed: true };
    }
    if (["succeeded", "failed", "cancelled"].includes(order.status)) throw failure("MANUAL_EXECUTION_CANCEL_BLOCKED");
    if (!active) {
      if (order.status !== "waiting_for_executor") throw failure("MANUAL_EXECUTION_CANCEL_BLOCKED");
      const saved = await repository.cancelWaitingOrder({ receiptKey, fingerprint, organizationId: input.organizationId, orderId: order.id, now: at,
        orderTransition: { organizationId: input.organizationId, orderId: order.id, expectedRevision: order.row_version,
          fromStatuses: ["waiting_for_executor"], toStatus: "cancelled", at, actorMemberId: input.actorMemberId, reason: "人工取消未开始的工单" },
        transitionOrder: () => orderPort.transitionOrder({ organizationId: input.organizationId, actorRole: input.actorRole, orderId: order.id,
          expectedRevision: order.row_version, fromStatuses: ["waiting_for_executor"], toStatus: "cancelled", at,
          actorMemberId: input.actorMemberId, reason: "人工取消未开始的工单" }),
        audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, production_order_id: order.id,
          event_type: "manual_execution.order_cancelled", metadata: {}, created_at: at } });
      return { order: await orderPort.getOrder({ ...input, orderId: order.id }), attempt: null, replayed: saved.replayed };
    }
    if (!["claimed", "running"].includes(order.status)) throw failure("MANUAL_EXECUTION_CANCEL_BLOCKED");
    const saved = await repository.cancelAttempt({ receiptKey, fingerprint, attemptId: active.id, organizationId: input.organizationId,
      orderTransition: { organizationId: input.organizationId, orderId: order.id, expectedRevision: order.row_version,
        fromStatuses: ["claimed", "running"], toStatus: "cancel_requested", at,
        actorMemberId: input.actorMemberId, reason: "请求取消正在执行的工单" },
      expectedRevision: active.row_version, patch: { previous_status: active.status, status: "cancel_requested", updated_at: at,
        status_history: [...active.status_history, { status: "cancel_requested", at, actor_member_id: input.actorMemberId }] },
      transitionOrder: () => orderPort.transitionOrder({ organizationId: input.organizationId, actorRole: input.actorRole, orderId: order.id,
        expectedRevision: order.row_version, fromStatuses: ["claimed", "running"], toStatus: "cancel_requested", at,
        actorMemberId: input.actorMemberId, reason: "请求取消正在执行的工单" }),
      audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, attempt_id: active.id,
        production_order_id: order.id, package_id: active.package_id, event_type: "manual_execution.cancellation_requested", metadata: {}, created_at: at } });
    return { attempt: publicAttempt(saved.attempt), order: await orderPort.getOrder({ ...input, orderId: order.id }), replayed: saved.replayed };
  }

  return { claimManualTask, confirmStart, createCandidateUploadAuthorization, uploadCandidateObject, completeCandidateUpload,
    submitReport, listCandidates, listReports, getExecutionWorkspace, recheckAttempt, reenterFailedAttempt, requestOrderCancellation,
    getOrder: scopedOrder, publicAttempt, publicCandidate, publicReport };
}
