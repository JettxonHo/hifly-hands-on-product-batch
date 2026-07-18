function simulatedError(method, kind) {
  const error = new Error(`Fake executor ${kind} at ${method}`);
  error.code = kind === "pause" ? "PAUSED_AUTH" : "SIMULATED_FAILURE";
  return error;
}

function candidateFor(remoteId) {
  return {
    remote_id: remoteId,
    remote_url: `https://example.invalid/works/${encodeURIComponent(remoteId)}`,
    match_method: "remote_id"
  };
}

export function createFakeExecutor(scenario = {}) {
  const calls = [];
  const callCounts = Object.fromEntries([
    "createAsset",
    "submitVideo",
    "querySubmission",
    "downloadArtifact",
    "reconcileSubmission"
  ].map((method) => [method, 0]));
  const remoteId = scenario.remoteId ?? "fake-remote-1";

  async function call(method, payload, context, { deferFailure = false } = {}) {
    calls.push({ method, ...payload });
    callCounts[method] = (callCounts[method] ?? 0) + 1;
    context?.emit?.({ type: "executor.fake_started", phase: method });
    if (scenario.pauseAt === method) throw simulatedError(method, "pause");
    if (!deferFailure && scenario.failAt === method) throw simulatedError(method, "failure");
  }

  return {
    calls,
    callCounts,

    async createAsset(task, context) {
      await call("createAsset", { task }, context);
      const asset = { asset_id: `asset-${task.task_id}` };
      context?.emit?.({ type: "executor.fake_finished", phase: "createAsset", evidence: asset });
      return asset;
    },

    async submitVideo(task, asset, context) {
      await call("submitVideo", { task, asset }, context, { deferFailure: true });
      const before = { work_ids: scenario.beforeWorkIds ?? [] };
      await context?.checkpoint?.({ phase: "remote_submit_pre", evidence: before });
      if (scenario.failAt === "submitVideo" || scenario.failAt === "submitVideoAfterCheckpoint") {
        throw simulatedError("submitVideo", "failure");
      }

      const candidates = scenario.remoteCandidates ?? [candidateFor(remoteId)];
      if (candidates.length !== 1) {
        return { status: "ambiguous", candidates };
      }
      const remoteEvidence = {
        ...candidateFor(remoteId),
        ...candidates[0],
        evidence_source: "direct_submission",
        submitted_at: new Date().toISOString()
      };
      context?.emit?.({ type: "executor.fake_finished", phase: "submitVideo", evidence: remoteEvidence });
      return { status: "submitted", remoteEvidence };
    },

    async querySubmission(remoteEvidence, context) {
      await call("querySubmission", { remoteEvidence }, context);
      const status = scenario.queryStatus ?? "ready";
      const result = { status, remoteEvidence };
      context?.emit?.({ type: "executor.fake_finished", phase: "querySubmission", evidence: result });
      return result;
    },

    async downloadArtifact(remoteEvidence, destination, context) {
      await call("downloadArtifact", { remoteEvidence, destination }, context);
      if (scenario.downloadFailure) throw simulatedError("downloadArtifact", "failure");
      const artifact = {
        artifact_id: `artifact-${remoteEvidence.remote_id ?? remoteId}`,
        relative_path: `downloads/${remoteEvidence.remote_id ?? remoteId}.mp4`
      };
      context?.emit?.({ type: "executor.fake_finished", phase: "downloadArtifact", evidence: artifact });
      return artifact;
    },

    async reconcileSubmission(task, checkpoint, context) {
      await call("reconcileSubmission", { task, checkpoint, remoteEvidence: checkpoint?.remote_evidence }, context);
      const allCandidates = scenario.remoteCandidates ?? (checkpoint?.remote_evidence?.remote_id
        ? [candidateFor(checkpoint.remote_evidence.remote_id)]
        : [candidateFor(remoteId)]);
      const knownRemoteId = checkpoint?.remote_evidence?.remote_id;
      const candidates = knownRemoteId
        ? allCandidates.filter((candidate) => candidate.remote_id === knownRemoteId)
        : allCandidates;
      const result = { candidates };
      context?.emit?.({ type: "executor.fake_finished", phase: "reconcileSubmission", evidence: result });
      return result;
    }
  };
}
