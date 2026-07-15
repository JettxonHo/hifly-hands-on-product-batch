import path from "node:path";
import { assertExecutorAdapter } from "../core/executor-adapter.js";
import { createRpaTaskPackage, writeRpaTaskPackage } from "../rpa/task-package.js";
import { readRpaState, writeRpaState } from "../rpa/rpa-state.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutError(phase) {
  const error = new Error(`Yingdao RPA timed out at ${phase}`);
  error.code = "YINGDAO_RPA_TIMEOUT";
  return error;
}

function directEvidence(remoteEvidence) {
  return {
    ...remoteEvidence,
    evidence_source: "direct_submission"
  };
}

export function createYingdaoRpaExecutor({ root, config = {} } = {}) {
  if (!root) throw new TypeError("createYingdaoRpaExecutor requires root");

  const rpa = config.rpa || {};
  const pollIntervalMs = rpa.pollIntervalMs ?? 1000;
  const callbackBaseUrl = rpa.callbackBaseUrl ?? "http://127.0.0.1:4317";

  function batchDirectory(batchId) {
    return path.join(root, "batches", batchId);
  }

  async function waitFor(batchDir, taskId, predicate, timeoutMs, phase) {
    const started = Date.now();
    while (Date.now() - started <= timeoutMs) {
      const state = await readRpaState(batchDir, taskId);
      if (state && predicate(state)) return state;
      await sleep(pollIntervalMs);
    }
    throw timeoutError(phase);
  }

  const executor = {
    async createAsset(task, context = {}) {
      const dir = batchDirectory(context.batchId);
      const packageData = createRpaTaskPackage({
        batch: { batch_id: context.batchId, person_strategy: "auto_pool", script_strategy: "mixed" },
        task,
        batchDirectory: dir,
        callbackBaseUrl
      });
      const packagePath = await writeRpaTaskPackage({ batchDirectory: dir, taskId: task.task_id, packageData });
      await writeRpaState(dir, task.task_id, {
        status: "generating_asset",
        callback_token: packageData.callback_token,
        package_path: packagePath
      });
      const state = await waitFor(
        dir,
        task.task_id,
        (candidate) => ["asset_confirmed", "failed_pre_submit", "interrupted_unknown"].includes(candidate.status),
        rpa.assetTimeoutMs ?? config.batch?.defaultTimeoutMs ?? 600000,
        "asset_generation"
      );
      if (state.status !== "asset_confirmed") {
        throw new Error(state.error?.message || `RPA asset failed with ${state.status}`);
      }
      return state.asset || { asset_id: `rpa-asset-${task.task_id}` };
    },

    async submitVideo(task, asset, context = {}) {
      const dir = batchDirectory(context.batchId);
      await context.checkpoint?.({ phase: "remote_submit_pre", evidence: { source: "yingdao_rpa" } });
      const state = await waitFor(
        dir,
        task.task_id,
        (candidate) => ["submitted", "failed_remote", "interrupted_unknown"].includes(candidate.status),
        rpa.submitTimeoutMs ?? config.batch?.generationTimeoutMs ?? 1200000,
        "remote_submit"
      );
      if (state.status !== "submitted" || !state.remote_evidence?.remote_id) {
        return { status: "ambiguous", candidates: state.remote_candidates || [] };
      }
      return { status: "submitted", remoteEvidence: directEvidence(state.remote_evidence) };
    },

    async querySubmission(remoteEvidence, context = {}) {
      const dir = batchDirectory(context.batchId);
      const taskId = context.taskId || remoteEvidence.task_id;
      const state = await waitFor(
        dir,
        taskId,
        (candidate) => ["download_pending", "completed", "failed_remote", "interrupted_unknown"].includes(candidate.status),
        rpa.queryTimeoutMs ?? 120000,
        "remote_query"
      ).catch(() => null);
      if (!state) return { status: "submitted", remoteEvidence };
      if (state.status === "failed_remote") return { status: "failed" };
      if (state.status === "interrupted_unknown") return { status: "unknown" };
      return { status: "ready", remoteEvidence };
    },

    async downloadArtifact(remoteEvidence, destination, context = {}) {
      const dir = batchDirectory(context.batchId);
      const taskId = context.taskId || remoteEvidence.task_id;
      const state = await waitFor(
        dir,
        taskId,
        (candidate) => candidate.status === "completed" && candidate.artifact,
        rpa.downloadTimeoutMs ?? config.batch?.generationTimeoutMs ?? 1200000,
        "download"
      );
      return state.artifact;
    },

    async reconcileSubmission(task, checkpoint, context = {}) {
      const dir = batchDirectory(context.batchId);
      const state = await readRpaState(dir, task.task_id);
      const evidence = state?.remote_evidence ? [state.remote_evidence] : [];
      return { candidates: evidence };
    }
  };

  return assertExecutorAdapter(executor);
}
