const HEARTBEAT_RESULT = Object.freeze({
  disabled: { readinessStatus: "disabled", progressPhase: "standby" },
  fail_closed: { readinessStatus: "disabled", progressPhase: "standby" },
  unconfigured: { readinessStatus: "unconfigured", progressPhase: "standby" },
  requires_login: { readinessStatus: "requires_login", progressPhase: "requires_action" },
  storage_blocked: { readinessStatus: "storage_blocked", progressPhase: "requires_action" },
  standby: { readinessStatus: "available", progressPhase: "standby" },
  busy: { readinessStatus: "busy", progressPhase: "executing" },
  succeeded: { readinessStatus: "available", progressPhase: "succeeded" },
  failed: { readinessStatus: "requires_action", progressPhase: "failed" },
  requires_action: { readinessStatus: "requires_action", progressPhase: "requires_action" },
  halted: { readinessStatus: "requires_action", progressPhase: "requires_action" }
});

function heartbeatState(result) {
  return HEARTBEAT_RESULT[result?.status] || HEARTBEAT_RESULT.requires_action;
}

export function createCloudExecutorWorker({ service, pollIntervalMs = 1000, heartbeatIntervalMs = 5000,
  concurrency = 1, heartbeatPort = null, onError = () => undefined } = {}) {
  if (!service?.runOnce) throw new TypeError("cloud executor service is required");
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1) throw new TypeError("pollIntervalMs must be positive");
  if (!Number.isSafeInteger(heartbeatIntervalMs) || heartbeatIntervalMs < 1) throw new TypeError("heartbeatIntervalMs must be positive");
  if (concurrency !== 1) throw Object.assign(new Error("CLOUD_EXECUTOR_CONCURRENCY_INVALID"), { code: "CLOUD_EXECUTOR_CONCURRENCY_INVALID" });
  if (heartbeatPort !== null && typeof heartbeatPort?.report !== "function") throw new TypeError("cloud executor heartbeat port is required");
  let timer = null;
  let heartbeatTimer = null;
  let running = false;
  let stopped = true;
  let halted = false;

  async function reportHeartbeat(state) {
    if (!heartbeatPort) return;
    try {
      await heartbeatPort.report(state);
    } catch (error) {
      const safe = Object.assign(new Error("CLOUD_EXECUTOR_HEARTBEAT_FAILED"), { code: "CLOUD_EXECUTOR_HEARTBEAT_FAILED" });
      onError(safe);
    }
  }

  async function runNext({ scheduled = false } = {}) {
    if (running || halted || (scheduled && stopped)) return null;
    running = true;
    if (heartbeatPort) {
      await reportHeartbeat({ readinessStatus: "busy", progressPhase: "executing" });
      heartbeatTimer = setInterval(() => { void reportHeartbeat({ readinessStatus: "busy", progressPhase: "executing" }); }, heartbeatIntervalMs);
      heartbeatTimer.unref?.();
    }
    try {
      const result = await service.runOnce();
      await reportHeartbeat(heartbeatState(result));
      if (["failed", "requires_action", "halted"].includes(result?.status) || result?.stopped === true) {
        halted = result?.status !== "requires_action" || result?.stopped === true;
        if (halted) stop();
      }
      return result;
    } catch (error) {
      halted = true;
      stop();
      await reportHeartbeat({ readinessStatus: "requires_action", progressPhase: "requires_action" });
      onError(error);
      return null;
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      running = false;
    }
  }

  function schedule() {
    if (stopped || halted) return;
    timer = setTimeout(async () => {
      await runNext({ scheduled: true });
      schedule();
    }, pollIntervalMs);
    timer.unref?.();
  }

  function start() {
    if (!stopped || halted) return;
    stopped = false;
    void runNext({ scheduled: true });
    schedule();
  }

  function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  return {
    runNext: () => runNext(),
    start,
    wake: () => { if (!stopped) void runNext({ scheduled: true }); },
    stop,
    get halted() { return halted; },
    get stopped() { return stopped; },
    pollIntervalMs,
    heartbeatIntervalMs,
    concurrency
  };
}
