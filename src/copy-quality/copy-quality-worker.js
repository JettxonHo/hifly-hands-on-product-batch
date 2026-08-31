export function createCopyQualityWorker({ service, evaluator, pollIntervalMs = 500, leaseMs = 30_000,
  heartbeatIntervalMs = Math.max(1000, Math.floor(leaseMs / 3)), onError = () => undefined } = {}) {
  if (!service || !evaluator?.evaluate) throw new TypeError("service and evaluator are required");
  let timer, stopped = true;

  async function runNext() {
    const run = await service.claimNextQualityRun({ leaseMs });
    if (!run) return null;
    const heartbeat = setInterval(() => service.heartbeatQualityRun({ run, leaseMs }).catch(onError), heartbeatIntervalMs);
    heartbeat.unref?.();
    try {
      const evaluation = await evaluator.evaluate({ qualityRun: run,
        copyVersion: run.input_snapshot.copy_version, productRevision: run.input_snapshot.product_revision,
        profileVersion: run.profile_version, ruleVersion: run.rule_version,
        providerRequest: (request) => service.executeProviderRequest({ run, ...request }) });
      const nonempty = (value) => typeof value === "string" && value.trim().length > 0;
      if (typeof evaluation?.checks_complete !== "boolean" || !Array.isArray(evaluation.findings) ||
        evaluation.findings.some((finding) => !["review", "hard_block", "fact_gate"].includes(finding?.kind) ||
          !["low", "medium", "high", "critical"].includes(finding?.severity) ||
          !["code", "title", "matched_text", "message", "suggestion"].every((field) => nonempty(finding?.[field])) ||
          !/^[A-Za-z0-9_.:-]{1,160}$/.test(finding?.evidence_reference || "") ||
          !/^[A-Za-z0-9_.:-]{1,120}$/.test(finding?.rule_source || ""))) {
        throw Object.assign(new Error("QUALITY_EVALUATION_INVALID"), { code: "QUALITY_EVALUATION_INVALID" });
      }
      await service.completeQualityRun({ run, evaluation });
    } catch (error) {
      if (error?.code !== "QUALITY_RUN_LEASE_LOST") {
        await service.failQualityRun({ run, failureCode: error?.code || "QUALITY_EVALUATION_FAILED" }).catch((failure) => {
          if (failure?.code !== "QUALITY_RUN_LEASE_LOST") throw failure;
        });
        onError(error);
      }
    } finally {
      clearInterval(heartbeat);
    }
    return run;
  }

  async function tick() {
    if (stopped) return;
    try { await runNext(); } finally { if (!stopped) timer = setTimeout(tick, pollIntervalMs); }
  }

  return {
    evaluatorKind: evaluator.kind || "unknown",
    runNext,
    start() { if (!stopped) return; stopped = false; timer = setTimeout(tick, 0); },
    stop() { stopped = true; if (timer) clearTimeout(timer); timer = undefined; }
  };
}
