export function createManualHandoffPackageWorker({ service, pollIntervalMs = 1000, leaseMs = 30_000, heartbeatIntervalMs = Math.max(1000, Math.floor(leaseMs / 3)), onError = () => undefined } = {}) {
  if (!service?.claimNextGenerationJob || !service?.completeGenerationJob) throw new TypeError("manual handoff service is required");
  let timer = null;
  async function runNext() {
    const job = await service.claimNextGenerationJob({ leaseMs });
    if (!job) return null;
    const heartbeat = setInterval(() => service.heartbeatGenerationJob({ job, leaseMs }).catch(onError), heartbeatIntervalMs);
    heartbeat.unref?.();
    try { await service.completeGenerationJob({ job }); }
    catch (error) {
      if (error?.code !== "MANUAL_HANDOFF_LEASE_LOST") await service.failGenerationJob({ job, error }).catch((failure) => { if (failure?.code !== "MANUAL_HANDOFF_LEASE_LOST") throw failure; });
      onError(error);
    } finally { clearInterval(heartbeat); }
    return service.getGenerationJob({ organizationId: job.organization_id, actorMemberId: "manual-handoff-worker", actorRole: "admin", jobId: job.id });
  }
  function start() { if (!timer) { timer = setInterval(() => runNext().catch(onError), pollIntervalMs); timer.unref?.(); } }
  function stop() { if (timer) clearInterval(timer); timer = null; }
  return { runNext, start, stop };
}
