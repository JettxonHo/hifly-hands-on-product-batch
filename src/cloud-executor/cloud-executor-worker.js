export function createCloudExecutorWorker({ service, pollIntervalMs = 1000, onError = () => undefined } = {}) {
  if (!service?.runOnce) throw new TypeError("cloud executor service is required");
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1) throw new TypeError("pollIntervalMs must be positive");
  let timer = null;
  let running = false;
  let stopped = true;
  let halted = false;

  async function runNext({ scheduled = false } = {}) {
    if (running || halted || (scheduled && stopped)) return null;
    running = true;
    try {
      const result = await service.runOnce();
      if (["failed", "requires_action", "halted"].includes(result?.status) || result?.stopped === true) {
        halted = result?.status !== "requires_action" || result?.stopped === true;
        if (halted) stop();
      }
      return result;
    } catch (error) {
      halted = true;
      stop();
      onError(error);
      return null;
    } finally {
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
  }

  return {
    runNext: () => runNext(),
    start,
    wake: () => { if (!stopped) void runNext({ scheduled: true }); },
    stop,
    get halted() { return halted; },
    get stopped() { return stopped; },
    pollIntervalMs
  };
}
