const clean = (value) => typeof value === "string" ? value.trim() : "";

const failure = (code) => Object.assign(new Error(code), { code });

export const READINESS_STATUSES = Object.freeze([
  "disabled",
  "unconfigured",
  "requires_login",
  "storage_blocked",
  "available",
  "busy",
  "requires_action"
]);

const READINESS_SET = new Set(READINESS_STATUSES);
const ATTEMPT_STATUSES = new Set(["claimed", "running", "requires_action", "succeeded", "failed", "cancel_requested", "cancelled"]);
const ORDER_STATUSES = new Set(["draft", "ready", "waiting_for_executor", "claimed", "running", "requires_action", "succeeded", "failed", "cancel_requested", "cancelled"]);
const DELIVERY_STATUSES = new Set(["not_available", "pending_review", "deliverable", "rework_required", "delivered"]);
const WORK_STATUSES = new Set(["available"]);
const EXECUTION_PURPOSES = new Set(["first_production", "rework", "supplemental_version", "reproduction"]);

const PROGRESS_LABELS = Object.freeze({
  standby: "待命",
  claimed: "已领取",
  started: "已开始",
  preparing: "准备执行",
  uploading: "上传素材",
  submitting: "提交结果",
  waiting_provider: "等待云端生成",
  downloading: "下载作品",
  finalizing: "整理结果",
  executing: "执行中",
  requires_action: "需要人工处理",
  succeeded: "执行成功",
  failed: "执行失败"
});

const PROGRESS_PHASES = new Set(Object.keys(PROGRESS_LABELS));

const FAILURE_PROJECTIONS = Object.freeze({
  requires_login: { code: "CLOUD_EXECUTOR_LOGIN_REQUIRED", stage: "login", message: "云端登录态已失效，需要重新登录飞影；不会自动重试。" },
  storage_blocked: { code: "CLOUD_EXECUTOR_STORAGE_BLOCKED", stage: "storage", message: "云端磁盘空间不足，已暂停新执行；不会自动重试。" },
  lease_expired: { code: "CLOUD_EXECUTOR_LEASE_EXPIRED", stage: "lease", message: "云端执行租约已失效，需要人工处理；不会自动重试。" },
  unknown_post_submit: { code: "CLOUD_EXECUTOR_UNKNOWN_SUBMIT", stage: "provider_submission", message: "提交后的云端状态无法确认，需要人工核对；不会自动重试。" },
  execution: { code: "CLOUD_EXECUTOR_EXECUTION_FAILED", stage: "execution", message: "Cloud Executor 执行失败；不会自动重试。" }
});

function timestamp(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString();
}

function latestByTime(values) {
  return values.filter(Boolean).slice().sort((left, right) =>
    String(left.updated_at || left.created_at || left.submitted_at || "").localeCompare(String(right.updated_at || right.created_at || right.submitted_at || "")) ||
    String(left.id || "").localeCompare(String(right.id || ""))).at(-1) || null;
}

function publicStatus(value, fallback = "requires_action") {
  return typeof value === "string" && ORDER_STATUSES.has(value) ? value : fallback;
}

function publicAttemptStatus(value) {
  return typeof value === "string" && ATTEMPT_STATUSES.has(value) ? value : "requires_action";
}

function projectProgressPhase(value) {
  const phase = clean(value).toLowerCase();
  if (!phase) return null;
  if (PROGRESS_PHASES.has(phase)) return phase;
  if (["standby", "idle", "ready"].includes(phase)) return "standby";
  if (phase === "claimed") return "claimed";
  if (phase.startsWith("start")) return "started";
  if (["pre_submit", "before_submit"].includes(phase)) return "preparing";
  if (phase.startsWith("prep")) return "preparing";
  if (phase.startsWith("upload")) return "uploading";
  if (phase === "submitted" || phase.includes("provider")) return "waiting_provider";
  if (phase.startsWith("submit")) return "submitting";
  if (phase === "wait_download") return "downloading";
  if (phase.startsWith("wait")) return "waiting_provider";
  if (phase.startsWith("download")) return "downloading";
  if (phase.startsWith("final")) return "finalizing";
  if (["succeeded", "completed", "complete", "success"].includes(phase)) return "succeeded";
  if (["failed", "failure", "error"].includes(phase)) return "failed";
  if (["requires_action", "lease_expired", "unknown_post_submit"].includes(phase)) return "requires_action";
  return "executing";
}

function progressProjection(value, updatedAt = null) {
  const phase = projectProgressPhase(value);
  return phase ? { phase, label: PROGRESS_LABELS[phase], updated_at: timestamp(updatedAt) } : null;
}

function failureKind(value) {
  const phase = clean(value).toLowerCase();
  if (!phase) return "execution";
  if (phase.includes("login") || phase.includes("auth")) return "requires_login";
  if (phase.includes("storage") || phase.includes("disk")) return "storage_blocked";
  if (phase.includes("lease") || phase.includes("heartbeat")) return "lease_expired";
  if (phase.includes("post_submit") || (phase.includes("unknown") && phase.includes("submit"))) return "unknown_post_submit";
  return "execution";
}

function failureProjection({ report = null, attempt = null } = {}) {
  const source = report?.failure_stage || report?.error_category || attempt?.progress_phase || attempt?.status;
  const projection = FAILURE_PROJECTIONS[failureKind(source)];
  return { code: projection.code, stage: projection.stage, message: projection.message, retryable: false };
}

function readinessReason(status, connection) {
  if (connection === "offline") return "CLOUD_EXECUTOR_OFFLINE";
  return {
    requires_login: "CLOUD_EXECUTOR_REQUIRES_LOGIN",
    storage_blocked: "CLOUD_EXECUTOR_STORAGE_BLOCKED",
    requires_action: "CLOUD_EXECUTOR_REQUIRES_ACTION"
  }[status] || null;
}

function publicOrder(order) {
  if (!order || typeof order !== "object") return null;
  return {
    id: clean(order.id) || null,
    status: publicStatus(order.status),
    execution_purpose: EXECUTION_PURPOSES.has(order.execution_purpose) ? order.execution_purpose : null,
    created_at: timestamp(order.created_at),
    updated_at: timestamp(order.updated_at)
  };
}

function publicAttempt(attempt, heartbeat = null) {
  if (!attempt || typeof attempt !== "object") return null;
  const progress = projectProgressPhase(attempt.progress_phase) || projectProgressPhase(heartbeat?.progress_phase);
  return {
    id: clean(attempt.id) || null,
    status: publicAttemptStatus(attempt.status),
    progress_phase: progress,
    heartbeat_at: timestamp(attempt.heartbeat_at) || timestamp(heartbeat?.reported_at),
    started_at: timestamp(attempt.started_at),
    completed_at: timestamp(attempt.completed_at),
    updated_at: timestamp(attempt.updated_at)
  };
}

function publicWork(work) {
  if (!work || typeof work !== "object" || !clean(work.id)) return null;
  const status = WORK_STATUSES.has(work.status) ? work.status : "unavailable";
  const deliveryStatus = DELIVERY_STATUSES.has(work.delivery_status) ? work.delivery_status : "pending_review";
  return {
    id: work.id.trim(),
    status,
    delivery_status: deliveryStatus,
    preview_available: true,
    download_available: true
  };
}

function publicVerification(job, executionStatus, work) {
  if (executionStatus !== "succeeded") return { status: "not_started" };
  const raw = clean(job?.verification_status || job?.status).toLowerCase();
  const status = raw === "passed" || raw === "succeeded" ? "passed" :
    raw === "failed" ? "failed" : raw === "requires_action" ? "requires_action" : raw ? "pending" : "pending";
  const result = { status };
  if (job?.id && status !== "passed") result.job_id = clean(job.id);
  if (work?.id && status === "passed") result.job_id = job?.id ? clean(job.id) : undefined;
  return Object.fromEntries(Object.entries(result).filter(([, value]) => value !== undefined && value !== null));
}

function emptyProjection(status, reasonCode = null) {
  const result = {
    worker: { connection: "offline", last_heartbeat_at: null },
    readiness: { status },
    worker_state: "offline",
    current_order: null,
    current_attempt: null,
    progress: null,
    execution: { status: "pending" },
    verification: { status: "not_started" },
    work: null,
    delivery: { status: "not_available" },
    failure: null
  };
  if (reasonCode) result.readiness.reason_code = reasonCode;
  return result;
}

export function createCloudExecutorControlPlane({
  enabled = false,
  mode = "fail_closed",
  configured = false,
  organizationId = null,
  executorCloudId = null,
  repository = null,
  orderPort = null,
  verificationPort = null,
  deliveryPort = null,
  heartbeatTimeoutMs = 15_000,
  now = Date.now
} = {}) {
  const identity = { organizationId: clean(organizationId), executorCloudId: clean(executorCloudId) };
  const active = enabled === true && mode !== "fail_closed";
  const readyForState = active && configured === true && Boolean(identity.organizationId && identity.executorCloudId);
  let heartbeat = null;

  if (!Number.isFinite(heartbeatTimeoutMs) || heartbeatTimeoutMs < 1) throw new TypeError("heartbeatTimeoutMs must be positive");
  if (typeof now !== "function") throw new TypeError("now must be a function");

  function scoped(input = {}) {
    return clean(input.organizationId) === identity.organizationId;
  }

  function currentTime() {
    return Number(now());
  }

  function heartbeatOnline() {
    if (!heartbeat) return false;
    const age = currentTime() - Date.parse(heartbeat.reported_at);
    return Number.isFinite(age) && age >= 0 && age <= heartbeatTimeoutMs;
  }

  async function listAttempts() {
    if (typeof repository?.listAttempts !== "function") return [];
    try {
      const values = await repository.listAttempts(identity.organizationId);
      return (values || []).filter((value) => value?.organization_id === identity.organizationId &&
        value.executor_type === "cloud_executor" && value.executor_cloud_id === identity.executorCloudId);
    } catch {
      return [];
    }
  }

  async function listReports(attempt) {
    if (!attempt || typeof repository?.listReports !== "function") return [];
    try {
      return (await repository.listReports(identity.organizationId, attempt.id) || []).filter((value) => value?.organization_id === identity.organizationId);
    } catch {
      return [];
    }
  }

  async function getOrder(attempt, input) {
    if (!attempt || typeof orderPort?.getOrder !== "function") return null;
    try {
      const order = await orderPort.getOrder({ organizationId: identity.organizationId, orderId: attempt.production_order_id,
        actorMemberId: input.actorMemberId, actorRole: input.actorRole });
      return order?.organization_id === identity.organizationId ? order : null;
    } catch {
      return null;
    }
  }

  async function getVerification(input, attempt, executionStatus) {
    if (executionStatus !== "succeeded" || !attempt || typeof verificationPort?.getVerificationWorkspace !== "function") {
      return { job: null, work: null };
    }
    try {
      const workspace = await verificationPort.getVerificationWorkspace({ organizationId: identity.organizationId,
        actorMemberId: input.actorMemberId, actorRole: input.actorRole, productionOrderId: attempt.production_order_id });
      return { job: workspace?.job || null, work: workspace?.work || workspace?.works?.at(-1) || null };
    } catch {
      return { job: null, work: null };
    }
  }

  async function getWork(input, attempt, fallback) {
    if (!attempt || typeof deliveryPort?.getWork !== "function") return fallback;
    try {
      const value = await deliveryPort.getWork({ organizationId: identity.organizationId, actorMemberId: input.actorMemberId,
        actorRole: input.actorRole, workId: fallback?.id });
      return value || fallback;
    } catch {
      return fallback;
    }
  }

  async function reportHeartbeat({ organizationId: scopedOrganizationId, executorCloudId: scopedExecutorId,
    readinessStatus = "available", progressPhase = null } = {}) {
    if (!readyForState || clean(scopedOrganizationId) !== identity.organizationId || clean(scopedExecutorId) !== identity.executorCloudId) {
      throw failure("CLOUD_EXECUTOR_CONTEXT_REQUIRED");
    }
    if (!READINESS_SET.has(readinessStatus)) throw failure("CLOUD_EXECUTOR_READINESS_INVALID");
    const progress = progressPhase == null ? null : projectProgressPhase(progressPhase);
    if (progressPhase != null && !progress) throw failure("CLOUD_EXECUTOR_PROGRESS_INVALID");
    heartbeat = { reported_at: new Date(currentTime()).toISOString(), readiness_status: readinessStatus, progress_phase: progress };
    return { status: "online", reported_at: heartbeat.reported_at };
  }

  async function getStatus(input = {}) {
    if (!scoped(input) || !active) return emptyProjection("disabled");
    if (!readyForState) return emptyProjection("unconfigured", "CLOUD_EXECUTOR_UNCONFIGURED");

    const online = heartbeatOnline();
    const attempts = await listAttempts();
    const activeAttempt = attempts.filter((value) => ["claimed", "running"].includes(value.status)).sort((left, right) =>
      String(left.updated_at || left.created_at || "").localeCompare(String(right.updated_at || right.created_at || ""))).at(-1) || null;
    const latestAttempt = activeAttempt || attempts.filter((value) => value.status !== "superseded").sort((left, right) =>
      String(left.updated_at || left.created_at || "").localeCompare(String(right.updated_at || right.created_at || ""))).at(-1) || null;
    const reports = await listReports(latestAttempt);
    const report = latestByTime(reports);
    const attemptStatus = latestAttempt?.status || null;
    const executionStatus = attemptStatus === "succeeded" ? "succeeded" :
      attemptStatus === "failed" ? "failed" : attemptStatus === "requires_action" ? "requires_action" : "pending";
    const order = await getOrder(latestAttempt, input);
    const verificationData = await getVerification(input, latestAttempt, executionStatus);
    const verificationStatus = publicVerification(verificationData.job, executionStatus, verificationData.work);
    const rawWork = verificationStatus.status === "passed" ? await getWork(input, latestAttempt, verificationData.work) : null;
    const work = verificationStatus.status === "passed" ? publicWork(rawWork) : null;
    const connection = online ? "online" : "offline";
    let readinessStatus = online ? heartbeat.readiness_status : "requires_action";
    if (!READINESS_SET.has(readinessStatus) || ["disabled", "unconfigured"].includes(readinessStatus)) readinessStatus = "requires_action";
    if (activeAttempt) readinessStatus = "busy";
    else if (executionStatus === "failed" || executionStatus === "requires_action") readinessStatus = "requires_action";
    else if (!online) readinessStatus = "requires_action";
    else if (readinessStatus === "busy") readinessStatus = "available";

    const projection = {
      worker: { connection, last_heartbeat_at: online ? heartbeat.reported_at : timestamp(heartbeat?.reported_at) },
      readiness: { status: readinessStatus },
      worker_state: activeAttempt ? "busy" : executionStatus === "failed" ? "failed" : executionStatus === "requires_action" ? "requires_action" : connection === "offline" ? "offline" : "standby",
      current_order: publicOrder(order),
      current_attempt: publicAttempt(latestAttempt, heartbeat),
      progress: progressProjection(latestAttempt?.progress_phase || heartbeat?.progress_phase, latestAttempt?.updated_at || heartbeat?.reported_at),
      execution: { status: executionStatus },
      verification: verificationStatus,
      work,
      delivery: { status: work?.delivery_status || "not_available" },
      failure: null
    };
    if (online && readinessStatus === "requires_login") projection.failure = { ...FAILURE_PROJECTIONS.requires_login, retryable: false };
    else if (online && readinessStatus === "storage_blocked") projection.failure = { ...FAILURE_PROJECTIONS.storage_blocked, retryable: false };
    else if (executionStatus === "failed" || executionStatus === "requires_action") projection.failure = failureProjection({ report, attempt: latestAttempt });
    else if (!online && latestAttempt?.status === "requires_action") projection.failure = failureProjection({ report, attempt: latestAttempt });
    const reasonCode = readinessReason(readinessStatus, connection);
    if (reasonCode) projection.readiness.reason_code = reasonCode;
    return projection;
  }

  return { reportHeartbeat, getStatus, projectProgressPhase };
}

export { PROGRESS_LABELS };
