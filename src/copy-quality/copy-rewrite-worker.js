export function createCopyRewriteWorker({ service, rewriter, pollIntervalMs = 500, leaseMs = 30_000,
  heartbeatIntervalMs = Math.max(1000, Math.floor(leaseMs / 3)), onError = () => undefined } = {}) {
  if (!service || !rewriter?.rewrite) throw new TypeError("service and rewriter are required");
  let timer, stopped = true;

  async function runNext() {
    const job = await service.claimNextRewriteJob({ leaseMs });
    if (!job) return null;
    const heartbeat = setInterval(() => service.heartbeatRewriteJob({ job, leaseMs }).catch(onError), heartbeatIntervalMs);
    heartbeat.unref?.();
    try {
      await service.executeRewriteJob({ job, rewriter });
    } catch (error) {
      if (error?.code !== "COPY_REWRITE_LEASE_LOST") {
        await service.failRewriteJob({ job, failureCode: error?.code || "COPY_REWRITE_FAILED" }).catch((failure) => {
          if (failure?.code !== "COPY_REWRITE_LEASE_LOST") throw failure;
        });
        onError(error);
      }
    } finally {
      clearInterval(heartbeat);
    }
    return job;
  }

  async function tick() {
    if (stopped) return;
    try { await runNext(); } finally { if (!stopped) timer = setTimeout(tick, pollIntervalMs); }
  }

  return {
    rewriterKind: rewriter.kind || "unknown",
    runNext,
    start() { if (!stopped) return; stopped = false; timer = setTimeout(tick, 0); },
    stop() { stopped = true; if (timer) clearTimeout(timer); timer = undefined; }
  };
}
