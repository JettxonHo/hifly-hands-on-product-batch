import path from "node:path";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { assertExecutorAdapter } from "../core/executor-adapter.js";
import { createRpaTaskPackage, writeRpaTaskPackage } from "../rpa/task-package.js";
import { registerRpaCallbackToken, revokeRpaCallbackToken } from "../rpa/callback-token-registry.js";
import { readRpaState, writeRpaState } from "../rpa/rpa-state.js";
import { loadCaptureManifest, selectStepsByPhase } from "../rpa/capture/manifest.js";
import { createCaptureHttpClient, normalizeCaptureHttpMode } from "../rpa/capture/http-client-factory.js";

const SENSITIVE_PLAN_NAME = /token|secret|password|cookie|authorization|session|csrf|xsrf|ticket|sign|auth/i;
const SAFE_RISK_FLAGS = new Set([
  "auth_required",
  "may_consume_points",
  "replayability_unknown",
  "api_unavailable"
]);

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

function persistableRequestPlan(entry) {
  if (!entry || typeof entry !== "object") return null;
  const safe = {};
  if (typeof entry.step_id === "string") safe.step_id = entry.step_id;
  if (typeof entry.phase === "string") safe.phase = entry.phase;
  if (typeof entry.method === "string") safe.method = entry.method;
  if (typeof entry.host === "string" && /^[A-Za-z0-9.-]+$/.test(entry.host)) safe.host = entry.host;
  if (Array.isArray(entry.placeholders)) {
    safe.placeholders = entry.placeholders.filter((name) =>
      typeof name === "string" && !SENSITIVE_PLAN_NAME.test(name)
    );
  }
  if (Array.isArray(entry.risk_flags)) {
    safe.risk_flags = entry.risk_flags.filter((flag) => SAFE_RISK_FLAGS.has(flag));
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

function artifactFilename(value, remoteId) {
  const fallback = `${remoteId || "capture-artifact"}.mp4`;
  if (typeof value !== "string" || value.trim() === "") return fallback;
  const filename = value.trim();
  if (filename !== path.basename(filename) || filename !== path.win32.basename(filename) || filename === "." || filename === "..") {
    throw Object.assign(new Error("Capture artifact filename must be a basename"), {
      code: "CAPTURE_ARTIFACT_FILENAME_INVALID"
    });
  }
  return path.extname(filename) ? filename : `${filename}.mp4`;
}

function artifactPathError(message) {
  return Object.assign(new Error(message), { code: "CAPTURE_ARTIFACT_PATH_UNSAFE" });
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function safeArtifactPath(batchDirectory, filename) {
  const artifactDirectory = path.join(batchDirectory, "artifacts");
  const absolutePath = path.resolve(artifactDirectory, filename);
  if (!isWithin(artifactDirectory, absolutePath) || absolutePath === artifactDirectory) {
    throw artifactPathError("Capture artifact path escapes the artifact directory");
  }
  await mkdir(artifactDirectory, { recursive: true, mode: 0o700 });
  const [artifactDirectoryStat, realBatchDirectory, realArtifactDirectory] = await Promise.all([
    lstat(artifactDirectory),
    realpath(batchDirectory),
    realpath(artifactDirectory)
  ]);
  if (!artifactDirectoryStat.isDirectory() || artifactDirectoryStat.isSymbolicLink() || !isWithin(realBatchDirectory, realArtifactDirectory)) {
    throw artifactPathError("Capture artifact directory must be a real directory inside the batch");
  }
  try {
    await lstat(absolutePath);
    throw artifactPathError("Capture artifact destination must not already exist");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return absolutePath;
}

async function writePlaceholderArtifact(absolutePath, remoteId) {
  let handle;
  try {
    handle = await open(absolutePath, "wx", 0o600);
    await handle.writeFile(`capture-http placeholder artifact for ${remoteId}\n`);
  } catch (error) {
    if (error?.code === "EEXIST" || error?.code === "ELOOP") {
      throw artifactPathError("Capture artifact destination cannot be safely created");
    }
    throw error;
  } finally {
    await handle?.close();
  }
}

export function createCaptureHttpExecutor({ root, config = {} } = {}) {
  if (!root) throw new TypeError("createCaptureHttpExecutor requires root");
  const rpa = config.rpa ?? {};
  const captureHttpMode = normalizeCaptureHttpMode(rpa.captureHttpMode);
  let callbackBaseUrl = rpa.callbackBaseUrl ?? "http://127.0.0.1:4317";
  let manifestCache = null;
  let clientCache = null;

  async function ensureClient({ runtimeAuth = null, transport = null } = {}) {
    if (!clientCache || captureHttpMode === "real_live") {
      if (!manifestCache) {
        if (!rpa.manifestPath) {
          throw Object.assign(new Error("rpa.manifestPath is required for capture_http mode"), {
            code: "CAPTURE_MANIFEST_MISSING"
          });
        }
        const resolved = path.isAbsolute(rpa.manifestPath) ? rpa.manifestPath : path.resolve(root, rpa.manifestPath);
        manifestCache = await loadCaptureManifest(resolved);
      }
      const client = createCaptureHttpClient({
        mode: captureHttpMode,
        manifest: manifestCache,
        config: rpa.realLive || {},
        runtimeAuth,
        transport: transport || rpa.realLiveTransport
      });
      if (captureHttpMode === "real_live") return client;
      clientCache = client;
    }
    return clientCache;
  }

  async function replayPhase(phase, variables, { dir = null, taskId = null, realLive = null } = {}) {
    const client = await ensureClient({
      runtimeAuth: realLive?.runtimeAuth || null,
      transport: realLive?.transport || null
    });
    const state = dir && taskId ? await readRpaState(dir, taskId) : null;
    const persistedVariables = { ...savedCaptureVariables(state) };
    const vars = { ...persistedVariables, ...variables };
    const requestPlan = [];
    for (const step of selectStepsByPhase(manifestCache, phase)) {
      const result = await client.request({
        stepId: step.id,
        variables: vars,
        phase,
        context: {
          allowRealLive: realLive?.allowRealLive === true,
          acknowledgePointRisk: realLive?.acknowledgePointRisk === true
        }
      });
      Object.assign(vars, result.produced);
      Object.assign(persistedVariables, result.produced);
      const safePlan = persistableRequestPlan(result.request_plan);
      if (safePlan) requestPlan.push(safePlan);
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
      }, { dir, taskId: task.task_id, realLive: context.realLive });
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
      const submitReplay = await replayPhase("remote_submit", { asset_id: asset?.asset_id }, {
        dir,
        taskId: task.task_id,
        realLive: context.realLive
      });
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
      const queryReplay = await replayPhase("remote_query", { remote_id: remoteEvidence?.remote_id }, {
        dir,
        taskId,
        realLive: context.realLive
      });
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
      const downloadReplay = await replayPhase("download", { remote_id: remoteEvidence?.remote_id }, {
        dir,
        taskId,
        realLive: context.realLive
      });
      const produced = downloadReplay.variables;
      const filename = artifactFilename(produced.artifact_filename, remoteEvidence?.remote_id);
      const absolutePath = await safeArtifactPath(dir, filename);
      await writePlaceholderArtifact(absolutePath, remoteEvidence?.remote_id);
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
