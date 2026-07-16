import path from "node:path";
import { writeFile } from "node:fs/promises";
import { assertExecutorAdapter } from "../core/executor-adapter.js";
import { createRpaTaskPackage, writeRpaTaskPackage } from "../rpa/task-package.js";
import { registerRpaCallbackToken, revokeRpaCallbackToken } from "../rpa/callback-token-registry.js";
import { readRpaState, writeRpaState } from "../rpa/rpa-state.js";
import { loadCaptureManifest, selectStepsByPhase } from "../rpa/capture/manifest.js";
import { createCaptureHttpClient, normalizeCaptureHttpMode } from "../rpa/capture/http-client-factory.js";

function batchDirectory(root, batchId) {
  if (typeof batchId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(batchId)) {
    throw new TypeError("context.batchId must be a valid local batch id");
  }
  return path.join(root, "batches", batchId);
}

function directEvidence(remoteEvidence) {
  return { ...remoteEvidence, evidence_source: "direct_submission" };
}

function savedCaptureVariables(state) {
  return state?.capture_variables && typeof state.capture_variables === "object" && !Array.isArray(state.capture_variables)
    ? state.capture_variables
    : {};
}

export function createCaptureHttpExecutor({ root, config = {} } = {}) {
  if (!root) throw new TypeError("createCaptureHttpExecutor requires root");
  const rpa = config.rpa ?? {};
  const captureHttpMode = normalizeCaptureHttpMode(rpa.captureHttpMode);
  let callbackBaseUrl = rpa.callbackBaseUrl ?? "http://127.0.0.1:4317";
  let manifestCache = null;
  let clientCache = null;

  async function ensureClient() {
    if (!clientCache) {
      if (!manifestCache) {
        if (!rpa.manifestPath) {
          throw Object.assign(new Error("rpa.manifestPath is required for capture_http mode"), {
            code: "CAPTURE_MANIFEST_MISSING"
          });
        }
        const resolved = path.isAbsolute(rpa.manifestPath) ? rpa.manifestPath : path.resolve(root, rpa.manifestPath);
        manifestCache = await loadCaptureManifest(resolved);
      }
      clientCache = createCaptureHttpClient({ mode: captureHttpMode, manifest: manifestCache });
    }
    return clientCache;
  }

  async function replayPhase(phase, variables, { dir = null, taskId = null } = {}) {
    await ensureClient();
    const state = dir && taskId ? await readRpaState(dir, taskId) : null;
    const persistedVariables = { ...savedCaptureVariables(state) };
    const vars = { ...persistedVariables, ...variables };
    const requestPlan = [];
    for (const step of selectStepsByPhase(manifestCache, phase)) {
      const result = await clientCache.request({ stepId: step.id, variables: vars, phase });
      Object.assign(vars, result.produced);
      Object.assign(persistedVariables, result.produced);
      if (result.request_plan) requestPlan.push(result.request_plan);
    }
    return { variables: vars, persistedVariables, requestPlan };
  }

  async function appendRequestPlan(dir, taskId, entries) {
    const current = await readRpaState(dir, taskId);
    return [...(current?.request_plan || []), ...entries];
  }

  const executor = {
    setCallbackBaseUrl(value) {
      callbackBaseUrl = value;
    },

    async createAsset(task, context = {}) {
      const dir = batchDirectory(root, context.batchId);
      const packageData = createRpaTaskPackage({
        batch: { batch_id: context.batchId },
        task,
        batchDirectory: dir,
        callbackBaseUrl
      });
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
          callback_token: packageData.callback_token
        });
        await writeRpaTaskPackage({ batchDirectory: dir, taskId: task.task_id, packageData });
      } catch (error) {
        revokeRpaCallbackToken(tokenScope);
        throw error;
      }
      const assetReplay = await replayPhase("asset_generation", {
        product_image_path: packageData.product_image_path,
        person_image_path: packageData.person_image_path
      }, { dir, taskId: task.task_id });
      const produced = assetReplay.variables;
      const asset = { asset_id: produced.asset_id || `capture-asset-${task.task_id}` };
      assetReplay.persistedVariables.asset_id = asset.asset_id;
      await writeRpaState(dir, task.task_id, {
        status: "asset_confirmed",
        asset,
        phase: "asset_generation",
        capture_http_mode: captureHttpMode,
        capture_variables: assetReplay.persistedVariables,
        request_plan: assetReplay.requestPlan
      });
      revokeRpaCallbackToken(tokenScope);
      return asset;
    },

    async submitVideo(task, asset, context = {}) {
      const dir = batchDirectory(root, context.batchId);
      await context.checkpoint?.({ phase: "remote_submit_pre", evidence: { source: "capture_http" } });
      const submitReplay = await replayPhase("remote_submit", { asset_id: asset?.asset_id }, { dir, taskId: task.task_id });
      const produced = submitReplay.variables;
      const remoteEvidence = directEvidence({
        remote_id: produced.remote_id,
        work_key: produced.remote_id,
        label: manifestCache?.captured_at || null,
        task_id: task.task_id,
        batch_id: context.batchId
      });
      await writeRpaState(dir, task.task_id, {
        status: "submitted",
        phase: "remote_submit",
        remote_evidence: remoteEvidence,
        capture_http_mode: captureHttpMode,
        capture_variables: submitReplay.persistedVariables,
        request_plan: await appendRequestPlan(dir, task.task_id, submitReplay.requestPlan)
      });
      return { status: "submitted", remoteEvidence };
    },

    async querySubmission(remoteEvidence, context = {}) {
      const batchId = context.batchId || remoteEvidence?.batch_id;
      const taskId = context.taskId || remoteEvidence?.task_id;
      const dir = batchId && taskId ? batchDirectory(root, batchId) : null;
      const queryReplay = await replayPhase("remote_query", { remote_id: remoteEvidence?.remote_id }, { dir, taskId });
      if (batchId && taskId) {
        await writeRpaState(dir, taskId, {
          phase: "remote_query",
          capture_http_mode: captureHttpMode,
          capture_variables: queryReplay.persistedVariables,
          request_plan: await appendRequestPlan(dir, taskId, queryReplay.requestPlan)
        });
      }
      return { status: "ready", remoteEvidence };
    },

    async downloadArtifact(remoteEvidence, destination, context = {}) {
      const dir = batchDirectory(root, context.batchId);
      const taskId = context.taskId || remoteEvidence?.task_id;
      const downloadReplay = await replayPhase("download", { remote_id: remoteEvidence?.remote_id }, { dir, taskId });
      const produced = downloadReplay.variables;
      const filename = produced.artifact_filename || `${remoteEvidence?.remote_id}.mp4`;
      const absolutePath = path.join(dir, filename);
      await writeFile(absolutePath, `capture-http placeholder artifact for ${remoteEvidence?.remote_id}\n`);
      const artifact = {
        artifact_id: String(remoteEvidence?.remote_id),
        relative_path: path.relative(dir, absolutePath)
      };
      await writeRpaState(dir, taskId, {
        status: "completed",
        phase: "download",
        remote_evidence: remoteEvidence,
        artifact,
        capture_http_mode: captureHttpMode,
        capture_variables: downloadReplay.persistedVariables,
        request_plan: await appendRequestPlan(dir, taskId, downloadReplay.requestPlan)
      });
      return artifact;
    },

    async reconcileSubmission(task, checkpoint, context = {}) {
      const dir = batchDirectory(root, context.batchId);
      const state = await readRpaState(dir, task.task_id);
      return { candidates: state?.remote_evidence ? [state.remote_evidence] : [] };
    }
  };

  return assertExecutorAdapter(Object.assign(executor, { captureHttpMode }));
}
