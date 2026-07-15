import path from "node:path";
import { assertExecutorAdapter } from "../core/executor-adapter.js";
import { createRpaTaskPackage, writeRpaTaskPackage } from "../rpa/task-package.js";
import {
  registerRpaCallbackToken,
  revokeRpaCallbackToken
} from "../rpa/callback-token-registry.js";
import { readRpaState, writeRpaState } from "../rpa/rpa-state.js";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function timeoutError(phase) {
  const error = new Error(`Yingdao RPA timed out at ${phase}`);
  error.code = "YINGDAO_RPA_TIMEOUT";
  return error;
}

function stateError(state) {
  const error = new Error(state.error?.message || `RPA execution ended with ${state.status}`);
  if (state.status === "failed_remote") error.code = "YINGDAO_RPA_FAILED_REMOTE";
  if (state.status === "interrupted_unknown") error.code = "YINGDAO_RPA_INTERRUPTED_UNKNOWN";
  return error;
}

function directEvidence(remoteEvidence) {
  return {
    ...remoteEvidence,
    evidence_source: "direct_submission"
  };
}

function batchStrategies(context, config, task) {
  const sources = [
    context.batch,
    context.batchOptions,
    context.batchMetadata,
    config.execution?.batch,
    config.execution?.batchMetadata,
    config.execution?.batchOptions,
    task
  ];
  const strategy = (field, fallback) => {
    for (const source of sources) {
      if (typeof source?.[field] === "string" && source[field].length > 0) return source[field];
    }
    return fallback;
  };
  return {
    person_strategy: strategy("person_strategy", "auto_pool"),
    script_strategy: strategy("script_strategy", "mixed")
  };
}

export function createYingdaoRpaExecutor({ root, config = {} } = {}) {
  if (!root) throw new TypeError("createYingdaoRpaExecutor requires root");

  const rpa = config.rpa || {};
  const pollIntervalMs = rpa.pollIntervalMs ?? 1000;
  let callbackBaseUrl = rpa.callbackBaseUrl ?? "http://127.0.0.1:4317";

  function batchDirectory(batchId) {
    if (typeof batchId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(batchId)) {
      throw new TypeError("context.batchId must be a valid local batch id");
    }
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

  async function waitForTask(batchDir, task, predicate, timeoutMs, phase) {
    try {
      return await waitFor(batchDir, task.task_id, predicate, timeoutMs, phase);
    } catch (error) {
      if (error?.code === "YINGDAO_RPA_TIMEOUT") {
        revokeRpaCallbackToken({
          batchDirectory: batchDir,
          taskId: task.task_id,
          executionKey: task.execution_key
        });
      }
      throw error;
    }
  }

  const executor = {
    setCallbackBaseUrl(value) {
      callbackBaseUrl = value;
    },

    async createAsset(task, context = {}) {
      const dir = batchDirectory(context.batchId);
      const packageData = createRpaTaskPackage({
        batch: { batch_id: context.batchId, ...batchStrategies(context, config, task) },
        task,
        batchDirectory: dir,
        callbackBaseUrl
      });
      const packagePath = path.join(dir, "rpa", "tasks", `${task.task_id}.json`);
      const tokenScope = {
        batchDirectory: dir,
        taskId: task.task_id,
        executionKey: task.execution_key,
        token: packageData.callback_token
      };
      registerRpaCallbackToken(tokenScope);
      try {
        await writeRpaState(dir, task.task_id, {
          status: "generating_asset",
          callback_token: packageData.callback_token,
          package_path: packagePath
        });
        await writeRpaTaskPackage({ batchDirectory: dir, taskId: task.task_id, packageData });
      } catch (error) {
        revokeRpaCallbackToken(tokenScope);
        throw error;
      }
      const state = await waitForTask(
        dir,
        task,
        (candidate) => ["asset_confirmed", "failed_pre_submit", "failed_remote", "interrupted_unknown"].includes(candidate.status),
        rpa.assetTimeoutMs ?? config.batch?.defaultTimeoutMs ?? 600000,
        "asset_generation"
      );
      if (state.status !== "asset_confirmed") {
        throw stateError(state);
      }
      return state.asset || { asset_id: `rpa-asset-${task.task_id}` };
    },

    async submitVideo(task, asset, context = {}) {
      const dir = batchDirectory(context.batchId);
      await context.checkpoint?.({ phase: "remote_submit_pre", evidence: { source: "yingdao_rpa" } });
      const state = await waitForTask(
        dir,
        task,
        (candidate) => ["submitted", "failed_remote", "interrupted_unknown"].includes(candidate.status),
        rpa.submitTimeoutMs ?? config.batch?.generationTimeoutMs ?? 1200000,
        "remote_submit"
      );
      if (state.status === "failed_remote") {
        return { status: "failed", error: state.error };
      }
      if (state.status !== "submitted" || !state.remote_evidence?.remote_id) {
        return { status: "ambiguous", candidates: state.remote_candidates || [] };
      }
      return { status: "submitted", remoteEvidence: directEvidence(state.remote_evidence) };
    },

    async querySubmission(remoteEvidence, context = {}) {
      const dir = batchDirectory(context.batchId);
      const taskId = context.taskId || remoteEvidence.task_id;
      const task = { task_id: taskId, execution_key: context.executionKey };
      const state = await waitForTask(
        dir,
        task,
        (candidate) => ["download_pending", "completed", "failed_remote", "interrupted_unknown"].includes(candidate.status),
        rpa.queryTimeoutMs ?? 120000,
        "remote_query"
      );
      if (state.status === "failed_remote") return { status: "failed" };
      if (state.status === "interrupted_unknown") return { status: "unknown" };
      return { status: "ready", remoteEvidence };
    },

    async downloadArtifact(remoteEvidence, destination, context = {}) {
      const dir = batchDirectory(context.batchId);
      const taskId = context.taskId || remoteEvidence.task_id;
      const task = { task_id: taskId, execution_key: context.executionKey };
      const state = await waitForTask(
        dir,
        task,
        (candidate) => ["completed", "failed_remote", "interrupted_unknown"].includes(candidate.status),
        rpa.downloadTimeoutMs ?? config.batch?.generationTimeoutMs ?? 1200000,
        "download"
      );
      if (state.status !== "completed" || !state.artifact) throw stateError(state);
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
