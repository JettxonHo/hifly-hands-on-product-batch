export function createPreflightWorker({ service, evaluator, pollIntervalMs = 500, onError = () => undefined } = {}) {
  if (!service || !evaluator?.evaluate) throw new TypeError("service and evaluator are required");
  let timer, stopped = true;
  async function runNext() {
    const claimed = await service.claimNextPreflight();
    if (!claimed) return null;
    try {
      const evaluation = await evaluator.evaluate(claimed);
      await service.completePreflight({ run: claimed.run, evaluation });
    } catch (error) {
      await service.failPreflight({ run: claimed.run, failureCode: error?.code || "PREFLIGHT_EVALUATION_FAILED" })
        .catch((failure) => { if (failure?.code !== "PREFLIGHT_RUN_LEASE_LOST") throw failure; });
      onError(error);
    }
    return claimed.run;
  }
  async function tick() { if (stopped) return; try { await runNext(); } finally { if (!stopped) timer = setTimeout(tick, pollIntervalMs); } }
  return { evaluatorKind: evaluator.kind || "unknown", runNext,
    start() { if (!stopped) return; stopped = false; timer = setTimeout(tick, 0); },
    stop() { stopped = true; if (timer) clearTimeout(timer); timer = undefined; } };
}
