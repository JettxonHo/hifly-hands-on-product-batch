export function createCopyGenerationWorker({ service, provider, pollIntervalMs = 1000, leaseMs = 30_000, heartbeatIntervalMs = Math.max(1000, Math.floor(leaseMs / 3)), onError = () => undefined } = {}) {
  if (!service || !provider?.generateCopy) throw new TypeError("service and provider are required");
  let timer = null;

  async function runNext() {
    const job = await service.claimNextGenerationJob({ leaseMs });
    if (!job) return null;
    const heartbeat = setInterval(() => service.heartbeatGenerationJob({ job, leaseMs }).catch(onError), heartbeatIntervalMs);
    heartbeat.unref?.();
    try {
      const result = await provider.generateCopy({ productRevision: job.input_snapshot, intent: job.intent });
      await service.completeGenerationJob({ job, body: result?.body });
    } catch (error) {
      if (error?.code !== "COPY_GENERATION_LEASE_LOST") {
        await service.failGenerationJob({ job, failureCode: error?.code || "COPY_GENERATION_FAILED" }).catch((failure) => {
          if (failure?.code !== "COPY_GENERATION_LEASE_LOST") throw failure;
        });
        onError(error);
      }
    } finally {
      clearInterval(heartbeat);
    }
    return service.getGenerationJob({ organizationId: job.organization_id, actorMemberId: "copy-generation-worker", jobId: job.id });
  }

  function start() {
    if (timer) return;
    timer = setInterval(() => runNext().catch(onError), pollIntervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { providerKind: provider.kind || "provider_neutral", runNext, start, stop };
}
