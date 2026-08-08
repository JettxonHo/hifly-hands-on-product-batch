export function createWorkVerificationWorker({ service, pollIntervalMs = 1000, leaseMs = 30_000, heartbeatIntervalMs = Math.max(1000, Math.floor(leaseMs / 3)), onError = () => undefined } = {}) {
  if (!service?.runNextVerificationJob || !service?.heartbeatVerificationJob) throw new TypeError("work verification service is required");
  let timer = null;
  let running = false;
  let stopped = true;

  async function runNext() {
    if (running || stopped) return null;
    running = true;
    try { return await service.runNextVerificationJob({ leaseMs, heartbeatIntervalMs }); }
    catch (error) { onError(error); return null; }
    finally { running = false; }
  }

  function schedule() {
    if (stopped) return;
    timer = setTimeout(async () => { await runNext(); schedule(); }, pollIntervalMs);
    timer.unref?.();
  }

  return {
    start() { if (!stopped) return; stopped = false; void runNext(); schedule(); },
    wake() { void runNext(); },
    stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; },
    pollIntervalMs,
    leaseMs,
    heartbeatIntervalMs
  };
}
