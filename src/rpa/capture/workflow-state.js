export const CAPTURE_STATUSES = new Set([
  "disabled",
  "not_started",
  "recording",
  "recorded",
  "extracted",
  "redacted",
  "replay_passed",
  "replay_failed",
  "dry_run_passed",
  "dry_run_failed",
  "real_live_disabled",
  "real_live_running",
  "real_live_completed",
  "real_live_failed"
]);

function now() {
  return new Date().toISOString();
}

function assertStatus(status) {
  if (!CAPTURE_STATUSES.has(status)) {
    throw Object.assign(new Error(`Invalid capture status: ${status}`), { code: "INVALID_CAPTURE_STATUS" });
  }
}

export function createInitialCaptureState({ enabled = false } = {}) {
  if (!enabled) return { enabled: false, status: "disabled" };
  return { enabled: true, status: "not_started", updated_at: now() };
}

export function updateCaptureState(capture = {}, patch = {}) {
  const status = patch.status ?? capture.status ?? (capture.enabled ? "not_started" : "disabled");
  assertStatus(status);
  return {
    ...capture,
    ...patch,
    enabled: patch.enabled ?? capture.enabled ?? status !== "disabled",
    status,
    updated_at: now()
  };
}

export function publicCaptureState(capture) {
  if (!capture || typeof capture !== "object") return { enabled: false, status: "disabled" };
  const value = {
    enabled: capture.enabled === true,
    status: CAPTURE_STATUSES.has(capture.status) ? capture.status : "disabled"
  };
  if (capture.har_path) value.har_path = "[local raw capture]";
  for (const key of ["raw_steps_path", "manifest_path", "report_path"]) {
    if (isSafeProjectRelativePath(capture[key])) value[key] = capture[key];
  }
  if (capture.updated_at !== undefined) value.updated_at = capture.updated_at;
  if (capture.replay_error !== undefined && capture.replay_error !== null) {
    value.replay_error = publicReplayError();
  }
  if (capture.dry_run_error !== undefined && capture.dry_run_error !== null) {
    value.dry_run_error = publicDryRunError();
  }
  if (capture.live_error !== undefined && capture.live_error !== null) {
    value.live_error = publicLiveError(capture.live_error, capture.status);
  }
  if (capture.extract_summary && Number.isInteger(capture.extract_summary.step_count)) {
    value.extract_summary = { step_count: capture.extract_summary.step_count };
  }
  if (capture.redaction_summary && Number.isInteger(capture.redaction_summary.removed_count)) {
    value.redaction_summary = { removed_count: capture.redaction_summary.removed_count };
  }
  if (capture.replay_summary && typeof capture.replay_summary === "object") {
    value.replay_summary = {
      remote_id: capture.replay_summary.remote_id ?? null,
      artifact_filename: capture.replay_summary.artifact_filename ?? null
    };
  }
  if (capture.dry_run_summary && typeof capture.dry_run_summary === "object") {
    value.dry_run_summary = publicDryRunSummary(capture.dry_run_summary);
  }
  if (capture.live_summary && typeof capture.live_summary === "object") {
    value.live_summary = publicLiveSummary(capture.live_summary);
  }
  if (capture.queue && typeof capture.queue === "object") {
    const queue = publicQueueSummary(capture.queue);
    if (queue) value.queue = queue;
  }
  return value;
}

function isSafeProjectRelativePath(value) {
  return typeof value === "string" && value.length > 0 &&
    !/^(?:[\\/]|[A-Za-z]:[\\/])/.test(value) &&
    !value.split(/[\\/]+/).some((part) => part === "" || part === "..");
}

const SAFE_RISK_FLAGS = new Set([
  "auth_required",
  "may_consume_points",
  "replayability_unknown",
  "api_unavailable"
]);

const SAFE_LIVE_ERROR_CODES = new Set([
  "CAPTURE_HTTP_REAL_LIVE_DISABLED",
  "CAPTURE_HTTP_REAL_LIVE_NOT_AUTHORIZED",
  "CAPTURE_HTTP_POINT_RISK_NOT_ACKNOWLEDGED",
  "CAPTURE_HTTP_AUTH_REQUIRED",
  "CAPTURE_HTTP_HOST_NOT_ALLOWED",
  "CAPTURE_HTTP_LIVE_RUN_FAILED",
  "CAPTURE_HTTP_TRANSPORT_FAILED",
  "CAPTURE_HTTP_API_UNAVAILABLE",
  "CAPTURE_HTTP_ARTIFACT_MISSING",
  "CAPTURE_HTTP_STATUS_NOT_OK",
  "CAPTURE_HTTP_UNEXPECTED_CONTENT_TYPE",
  "CAPTURE_HTTP_REMOTE_REJECTED",
  "CAPTURE_HTTP_UPLOAD_URL_UNAVAILABLE",
  "CAPTURE_HTTP_UPLOAD_ARTIFACT_MISSING",
  "CAPTURE_HTTP_UPLOAD_FAILED",
  "CAPTURE_HTTP_ARTIFACT_URL_UNAVAILABLE",
  "CAPTURE_HTTP_ARTIFACT_DOWNLOAD_FAILED"
]);

const SAFE_QUEUE_STATUSES = new Set([
  "not_started",
  "running",
  "completed",
  "failed",
  "interrupted"
]);

const SAFE_QUEUE_ERROR_CODES = new Set([
  "CAPTURE_HTTP_QUEUE_FAILED",
  "CAPTURE_HTTP_QUEUE_NOT_READY",
  "CAPTURE_HTTP_QUEUE_MODE_INVALID",
  "CAPTURE_HTTP_AUTH_REQUIRED",
  "CAPTURE_HTTP_API_UNAVAILABLE",
  "CAPTURE_HTTP_ARTIFACT_MISSING",
  "CAPTURE_ARTIFACT_PATH_UNSAFE",
  "CAPTURE_ARTIFACT_FILENAME_INVALID"
]);

function isSensitiveName(value) {
  return /token|secret|password|cookie|authorization|session|csrf|xsrf|ticket|sign|auth/i.test(value);
}

function publicDryRunSummary(summary) {
  const result = {};
  if (Number.isInteger(summary.executed_step_count) && summary.executed_step_count >= 0) {
    result.executed_step_count = summary.executed_step_count;
  }
  if (Array.isArray(summary.request_plan)) {
    result.request_plan = summary.request_plan.map(publicRequestPlan).filter(Boolean);
  }
  return result;
}

function publicDryRunError() {
  return {
    code: "CAPTURE_DRY_RUN_FAILED",
    message: "Unable to construct the dry-run request plan."
  };
}

function publicReplayError() {
  return {
    code: "CAPTURE_REPLAY_FAILED",
    message: "Unable to complete the offline replay."
  };
}

function publicLiveError(error, status) {
  if (status === "real_live_disabled") {
    return {
      code: "CAPTURE_HTTP_REAL_LIVE_DISABLED",
      message: "real_live is disabled until explicitly authorized."
    };
  }
  const code = typeof error?.code === "string" && SAFE_LIVE_ERROR_CODES.has(error.code)
    ? error.code
    : "CAPTURE_HTTP_LIVE_RUN_FAILED";
  return {
    code,
    message: code === "CAPTURE_HTTP_REAL_LIVE_DISABLED"
      ? "real_live is disabled until explicitly authorized."
      : "Unable to complete the real HTTP live run."
  };
}

function publicLiveSummary(summary) {
  const result = {};
  if (typeof summary.remote_id === "string" || typeof summary.remote_id === "number") {
    result.remote_id = String(summary.remote_id);
  }
  if (isSafeProjectRelativePath(summary.artifact_path)) {
    result.artifact_path = summary.artifact_path;
  }
  if (typeof summary.sku === "string") result.sku = summary.sku;
  if (summary.completed_at !== undefined) result.completed_at = summary.completed_at;
  return result;
}

function publicQueueSummary(queue) {
  const result = {};
  if (queue.mode === "fake") result.mode = "fake";
  if (SAFE_QUEUE_STATUSES.has(queue.status)) result.status = queue.status;
  for (const key of ["total", "completed", "failed"]) {
    if (Number.isInteger(queue[key]) && queue[key] >= 0) result[key] = queue[key];
  }
  if (typeof queue.current_task_id === "string" && /^[A-Za-z0-9._:-]+$/.test(queue.current_task_id)) {
    result.current_task_id = queue.current_task_id;
  }
  for (const key of ["started_at", "updated_at"]) {
    if (typeof queue[key] === "string") result[key] = queue[key];
  }
  if (queue.last_error && typeof queue.last_error === "object") {
    result.last_error = {
      code: typeof queue.last_error.code === "string" && SAFE_QUEUE_ERROR_CODES.has(queue.last_error.code)
        ? queue.last_error.code
        : "CAPTURE_HTTP_QUEUE_FAILED",
      message: "Unable to complete the capture HTTP queue."
    };
  }
  return Object.keys(result).length > 0 ? result : null;
}

function publicRequestPlan(entry) {
  if (!entry || typeof entry !== "object") return null;
  const result = {};
  if (typeof entry.step_id === "string") result.step_id = entry.step_id;
  if (typeof entry.phase === "string") result.phase = entry.phase;
  if (typeof entry.method === "string") result.method = entry.method;
  if (typeof entry.host === "string" && /^[A-Za-z0-9.-]+$/.test(entry.host)) result.host = entry.host;
  // Legacy summaries may persist a resolved path here, so it cannot be safely published.
  if (Array.isArray(entry.placeholders)) {
    result.placeholders = entry.placeholders.filter((name) =>
      typeof name === "string" && !isSensitiveName(name)
    );
  }
  if (Array.isArray(entry.risk_flags)) {
    result.risk_flags = entry.risk_flags.filter((flag) => SAFE_RISK_FLAGS.has(flag));
  }
  return Object.keys(result).length > 0 ? result : null;
}
