const DEFAULT_SYSTEM_ACTOR_ID = 'appearance-fidelity-system';

function isFailedResult(result) {
  return result?.capture_request?.status === 'failed' || result?.status === 'failed';
}

export function createAppearanceCaptureWorker({
  service,
  systemActorId = DEFAULT_SYSTEM_ACTOR_ID,
  pollIntervalMs = 1000,
  autoStart = false,
  onError = () => undefined,
} = {}) {
  if (typeof service?.runNextCapture !== 'function') {
    throw new TypeError('appearance fidelity capture service is required');
  }
  if (!Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 1) {
    throw new TypeError('pollIntervalMs must be a positive safe integer');
  }
  if (typeof autoStart !== 'boolean') {
    throw new TypeError('autoStart must be boolean');
  }

  let timer = null;
  let running = false;
  let stopped = true;
  let halted = false;

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function stop() {
    stopped = true;
    clearTimer();
  }

  async function runNext() {
    if (running || halted) return null;
    running = true;
    try {
      const result = await service.runNextCapture({ systemActorId });
      if (isFailedResult(result)) {
        halted = true;
        stop();
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

  async function tick() {
    if (stopped || halted) return;
    try {
      await runNext();
    } finally {
      if (!stopped && !halted) {
        timer = setTimeout(() => { void tick(); }, pollIntervalMs);
        timer.unref?.();
      }
    }
  }

  function start() {
    if (!stopped || halted) return;
    stopped = false;
    timer = setTimeout(() => { void tick(); }, 0);
    timer.unref?.();
  }

  const worker = {
    runNext,
    start,
    stop,
    autoStart,
    pollIntervalMs,
    systemActorId,
    get halted() { return halted; },
    get running() { return running; },
    get stopped() { return stopped; },
  };

  if (autoStart) start();
  return worker;
}
