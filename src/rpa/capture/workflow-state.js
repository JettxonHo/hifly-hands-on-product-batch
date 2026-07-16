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
  const value = { ...capture };
  if (value.har_path) value.har_path = "[local raw capture]";
  return value;
}
