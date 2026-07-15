import path from "node:path";
import { writeFile } from "node:fs/promises";
import { assertExecutorAdapter } from "../core/executor-adapter.js";
import { createRpaTaskPackage, writeRpaTaskPackage } from "../rpa/task-package.js";
import { registerRpaCallbackToken, revokeRpaCallbackToken } from "../rpa/callback-token-registry.js";
import { readRpaState, writeRpaState } from "../rpa/rpa-state.js";
import { loadCaptureManifest, selectStepsByPhase } from "../rpa/capture/manifest.js";
import { createMockHttpClient } from "../rpa/capture/mock-http-client.js";

function batchDirectory(root, batchId) {
  if (typeof batchId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(batchId)) {
    throw new TypeError("context.batchId must be a valid local batch id");
  }
  return path.join(root, "batches", batchId);
}

function directEvidence(remoteEvidence) {
  return { ...remoteEvidence, evidence_source: "direct_submission" };
}

export function createCaptureHttpExecutor({ root, config = {} } = {}) {
  if (!root) throw new TypeError("createCaptureHttpExecutor requires root");
  const rpa = config.rpa || {};
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
      clientCache = createMockHttpClient({ manifest: manifestCache });
    }
    return clientCache;
  }

  async function replayPhase(phase, variables) {
    await ensureClient();
    const vars = { ...variables };
    for (const step of selectStepsByPhase(manifestCache, phase)) {
      const result = await clientCache.request({ stepId: step.id, variables: vars });
      Object.assign(vars, result.produced);
    }
    return vars;
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
      const produced = await replayPhase("asset_generation", {
        product_image_path: packageData.product_image_path,
        person_image_path: packageData.person_image_path
      });
      const asset = { asset_id: produced.asset_id || `capture-asset-${task.task_id}` };
      await writeRpaState(dir, task.task_id, { status: "asset_confirmed", asset, phase: "asset_generation" });
      revokeRpaCallbackToken(tokenScope);
      return asset;
    },

    async submitVideo(task, asset, context = {}) {
      const dir = batchDirectory(root, context.batchId);
      await context.checkpoint?.({ phase: "remote_submit_pre", evidence: { source: "capture_http" } });
      const produced = await replayPhase("remote_submit", { asset_id: asset?.asset_id });
      const remoteEvidence = directEvidence({
        remote_id: produced.remote_id,
        work_key: produced.remote_id,
        label: manifestCache?.captured_at || null
      });
      await writeRpaState(dir, task.task_id, {
        status: "submitted",
        phase: "remote_submit",
        remote_evidence: remoteEvidence
      });
      return { status: "submitted", remoteEvidence };
    },

    async querySubmission(remoteEvidence) {
      await replayPhase("remote_query", { remote_id: remoteEvidence?.remote_id });
      return { status: "ready", remoteEvidence };
    },

    async downloadArtifact(remoteEvidence, destination, context = {}) {
      const dir = batchDirectory(root, context.batchId);
      const produced = await replayPhase("download", { remote_id: remoteEvidence?.remote_id });
      const filename = produced.artifact_filename || `${remoteEvidence?.remote_id}.mp4`;
      const absolutePath = path.join(dir, filename);
      await writeFile(absolutePath, `capture-http placeholder artifact for ${remoteEvidence?.remote_id}\n`);
      const artifact = {
        artifact_id: String(remoteEvidence?.remote_id),
        relative_path: path.relative(dir, absolutePath)
      };
      await writeRpaState(dir, context.taskId || remoteEvidence?.task_id, {
        status: "completed",
        phase: "download",
        remote_evidence: remoteEvidence,
        artifact
      });
      return artifact;
    },

    async reconcileSubmission(task, checkpoint, context = {}) {
      const dir = batchDirectory(root, context.batchId);
      const state = await readRpaState(dir, task.task_id);
      return { candidates: state?.remote_evidence ? [state.remote_evidence] : [] };
    }
  };

  return assertExecutorAdapter(executor);
}
