import { READINESS_STATUSES } from "./control-plane.js";

const clean = (value) => typeof value === "string" ? value.trim() : "";
const readinessSet = new Set(READINESS_STATUSES);

export const CLOUD_EXECUTOR_HEARTBEAT_PROGRESS = Object.freeze([
  "standby",
  "claimed",
  "started",
  "preparing",
  "uploading",
  "submitting",
  "waiting_provider",
  "downloading",
  "finalizing",
  "executing",
  "requires_action",
  "succeeded",
  "failed"
]);

const progressSet = new Set(CLOUD_EXECUTOR_HEARTBEAT_PROGRESS);

const failure = (code, details = null) => Object.assign(new Error(code), { code, details });

function validateState({ readinessStatus, progressPhase }) {
  if (!readinessSet.has(readinessStatus)) throw failure("CLOUD_EXECUTOR_HEARTBEAT_STATE_INVALID");
  if (progressPhase !== undefined && progressPhase !== null && !progressSet.has(progressPhase)) {
    throw failure("CLOUD_EXECUTOR_HEARTBEAT_STATE_INVALID");
  }
  return {
    readiness_status: readinessStatus,
    ...(progressPhase == null ? {} : { progress_phase: progressPhase })
  };
}

function heartbeatUrl(value) {
  const selected = clean(value);
  let parsed;
  try { parsed = new URL(selected); } catch { throw failure("CLOUD_EXECUTOR_HEARTBEAT_URL_INVALID"); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.pathname !== "/internal/cloud-executor/v1/heartbeat" ||
    parsed.username || parsed.password || parsed.hash || parsed.search) {
    throw failure("CLOUD_EXECUTOR_HEARTBEAT_URL_INVALID");
  }
  return parsed.toString();
}

function timeoutSignal(timeoutMs) {
  if (typeof AbortController !== "function") return { signal: undefined, cancel() {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

export function createCloudExecutorHeartbeatClient({ enabled = false, url = null, token = null,
  timeoutMs = 15_000, fetchImpl = globalThis.fetch } = {}) {
  if (enabled !== true) {
    return {
      async report() { return { status: "disabled", skipped: true }; }
    };
  }
  if (!clean(token) || typeof fetchImpl !== "function") throw failure("CLOUD_EXECUTOR_HEARTBEAT_CONFIG_REQUIRED");
  const endpoint = heartbeatUrl(url);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw failure("CLOUD_EXECUTOR_HEARTBEAT_TIMEOUT_INVALID");
  }
  const authorization = `Bearer ${token.trim()}`;

  return {
    async report({ readinessStatus = "available", progressPhase = null } = {}) {
      const body = validateState({ readinessStatus, progressPhase });
      const timeout = timeoutSignal(timeoutMs);
      let response;
      try {
        response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            authorization,
            "content-type": "application/json"
          },
          body: JSON.stringify(body),
          signal: timeout.signal
        });
      } catch (error) {
        throw failure("CLOUD_EXECUTOR_HEARTBEAT_FAILED", { status: null, cause: error?.code || "fetch_failed" });
      } finally {
        timeout.cancel();
      }
      if (!response?.ok) {
        throw failure("CLOUD_EXECUTOR_HEARTBEAT_FAILED", { status: Number.isInteger(response?.status) ? response.status : null });
      }
      let payload = null;
      try { payload = await response.json(); } catch { payload = null; }
      return {
        status: clean(payload?.status) || "online",
        ...(clean(payload?.reported_at) ? { reported_at: payload.reported_at.trim() } : {})
      };
    }
  };
}

export function createCloudExecutorStandbyHeartbeat({ heartbeatPort, intervalMs = 5_000,
  onError = () => undefined } = {}) {
  if (typeof heartbeatPort?.report !== "function") throw new TypeError("cloud executor heartbeat port is required");
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000) throw new TypeError("heartbeat interval must be at least one second");
  let timer = null;
  let state = null;

  async function report() {
    try {
      await heartbeatPort.report(state);
    } catch {
      onError(Object.assign(new Error("CLOUD_EXECUTOR_HEARTBEAT_FAILED"), { code: "CLOUD_EXECUTOR_HEARTBEAT_FAILED" }));
    }
  }

  return {
    async start(value) {
      if (timer) return;
      state = validateState(value);
      const publicState = {
        readinessStatus: state.readiness_status,
        ...(state.progress_phase ? { progressPhase: state.progress_phase } : {})
      };
      state = publicState;
      await report();
      timer = setInterval(() => { void report(); }, intervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
