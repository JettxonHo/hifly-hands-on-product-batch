export function createVerificationWorker({ service, pollIntervalMs = 1000, onError = () => {} }) {
  let timer = null;
  let running = false;
  let stopped = true;
  async function drain() {
    if (running || stopped) return;
    running = true;
    try { await service.recoverVerificationJobs(); } catch (error) { onError(error); } finally { running = false; }
  }
  function schedule() {
    if (stopped) return;
    timer = setTimeout(async () => { await drain(); schedule(); }, pollIntervalMs);
    timer.unref?.();
  }
  return {
    start() { if (!stopped) return; stopped = false; void drain(); schedule(); },
    wake() { void drain(); },
    stop() { stopped = true; if (timer) clearTimeout(timer); timer = null; }
  };
}
