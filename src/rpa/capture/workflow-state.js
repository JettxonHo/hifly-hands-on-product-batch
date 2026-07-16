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
  "real_live_disabled"
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
  for (const key of ["raw_steps_path", "manifest_path", "report_path", "replay_error", "dry_run_error", "updated_at"]) {
    if (capture[key] !== undefined) value[key] = capture[key];
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
  return value;
}

const SAFE_RISK_FLAGS = new Set([
  "auth_required",
  "may_consume_points",
  "replayability_unknown",
  "api_unavailable"
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

function publicRequestPlan(entry) {
  if (!entry || typeof entry !== "object") return null;
  const result = {};
  if (typeof entry.step_id === "string") result.step_id = entry.step_id;
  if (typeof entry.phase === "string") result.phase = entry.phase;
  if (typeof entry.method === "string") result.method = entry.method;
  if (typeof entry.host === "string" && /^[A-Za-z0-9.-]+$/.test(entry.host)) result.host = entry.host;
  if (typeof entry.path === "string") {
    const path = entry.path.split(/[?#]/, 1)[0];
    if (/^\/(?!\/)/.test(path)) result.path = path;
  }
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
