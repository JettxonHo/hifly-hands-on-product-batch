import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

import { summarizeBatch } from "../../core/state-machine.js";
import { createCaptureHttpExecutor } from "../../executors/capture-http-executor.js";
import { createFetchLiveTransport } from "../../rpa/capture/fetch-live-transport.js";
import { createDryRunHttpClient } from "../../rpa/capture/dry-run-http-client.js";
import { extractRawStepsFromHar } from "../../rpa/capture/har-extractor.js";
import { CAPTURE_PHASES, loadCaptureManifest, parseCaptureManifest, selectStepsByPhase } from "../../rpa/capture/manifest.js";
import { runOfflineCaptureReplay } from "../../rpa/capture/offline-replay.js";
import { redactCaptureSource } from "../../rpa/capture/redact.js";
import { updateCaptureState } from "../../rpa/capture/workflow-state.js";
import { assertBatchId, publicBatch } from "./batches.js";

function captureError(code, statusCode = 400) {
  return Object.assign(new Error(code), { code, statusCode });
}

function dryRunFailure() {
  return {
    code: "CAPTURE_DRY_RUN_FAILED",
    message: "Unable to construct the dry-run request plan."
  };
}

function replayFailure() {
  return {
    code: "CAPTURE_REPLAY_FAILED",
    message: "Unable to complete the offline replay."
  };
}

function realLiveDisabledFailure() {
  return {
    code: "CAPTURE_HTTP_REAL_LIVE_DISABLED",
    message: "real_live is disabled until explicitly authorized."
  };
}

function realLiveFailure(code = "CAPTURE_HTTP_LIVE_RUN_FAILED") {
  return {
    code,
    message: "Unable to complete the real HTTP live run."
  };
}

function queueFailure(code = "CAPTURE_HTTP_QUEUE_FAILED") {
  return {
    code,
    message: "Unable to complete the capture HTTP queue."
  };
}

function isSafeRelativePath(value) {
  return typeof value === "string" && value.length > 0 &&
    !path.isAbsolute(value) && !path.win32.isAbsolute(value) &&
    !value.split(/[\\/]+/).some((part) => part === "" || part === "..");
}

function contained(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function resolveProjectRelative(root, relativePath) {
  if (!isSafeRelativePath(relativePath)) throw captureError("INVALID_CAPTURE_PATH");
  const absolute = path.resolve(root, relativePath);
  if (!contained(root, absolute)) throw captureError("INVALID_CAPTURE_PATH");
  return absolute;
}

function publicDryRunRequestPlan(step, requestPlan) {
  const templateUrl = new URL(step.url_template.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, ":$1"));
  return {
    step_id: requestPlan.step_id,
    phase: requestPlan.phase,
    method: requestPlan.method,
    host: templateUrl.hostname,
    path: templateUrl.pathname,
    placeholders: requestPlan.placeholders,
    risk_flags: requestPlan.risk_flags
  };
}

function liveRunFields(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw captureError("INVALID_CAPTURE_LIVE_RUN_REQUEST");
  if (body.confirm !== true || body.allowRealLive !== true || body.acknowledgePointRisk !== true) {
    throw captureError("CAPTURE_HTTP_REAL_LIVE_NOT_AUTHORIZED");
  }
  if (body.limitItems !== 1) throw captureError("CAPTURE_HTTP_LIVE_LIMIT_ONE");
  return {
    confirm: true,
    allowRealLive: true,
    acknowledgePointRisk: true,
    limitItems: 1
  };
}

function queueRunFields(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw captureError("INVALID_CAPTURE_QUEUE_RUN_REQUEST");
  const allowed = new Set(["confirm", "mode", "resume"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw captureError("INVALID_CAPTURE_QUEUE_RUN_REQUEST");
  }
  if (body.confirm !== true) throw captureError("EXPLICIT_CONFIRMATION_REQUIRED");
  if (body.mode !== "fake") throw captureError("CAPTURE_HTTP_QUEUE_MODE_INVALID");
  return {
    mode: "fake",
    resume: body.resume === true
  };
}

function realBatchRunFields(body, maxItems) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw captureError("INVALID_CAPTURE_REAL_BATCH_REQUEST");
  const allowed = new Set(["confirm", "allowRealLive", "acknowledgePointRisk", "pointBudget", "resume"]);
  for (const key of Object.keys(body)) {
    if (!allowed.has(key)) throw captureError("INVALID_CAPTURE_REAL_BATCH_REQUEST");
  }
  if (body.confirm !== true || body.allowRealLive !== true || body.acknowledgePointRisk !== true) {
    throw captureError("CAPTURE_HTTP_REAL_BATCH_NOT_AUTHORIZED");
  }
  const ceiling = Number.isInteger(maxItems) && maxItems >= 1 ? maxItems : 3;
  if (!Number.isInteger(body.pointBudget) || body.pointBudget < 1 || body.pointBudget > ceiling) {
    throw captureError("CAPTURE_HTTP_REAL_BATCH_BUDGET_INVALID");
  }
  return {
    pointBudget: body.pointBudget,
    resume: body.resume === true
  };
}

const SAFE_REAL_BATCH_ERROR_CODES = new Set([
  "CAPTURE_HTTP_REAL_BATCH_FAILED",
  "CAPTURE_HTTP_REAL_BATCH_DUPLICATE_SUBMIT",
  "CAPTURE_HTTP_MANIFEST_DRIFT",
  "CAPTURE_HTTP_REMOTE_REJECTED",
  "CAPTURE_HTTP_AUTH_REQUIRED",
  "CAPTURE_HTTP_API_UNAVAILABLE",
  "CAPTURE_HTTP_STATUS_NOT_OK",
  "CAPTURE_HTTP_ARTIFACT_MISSING",
  "CAPTURE_HTTP_ARTIFACT_DOWNLOAD_FAILED",
  "CAPTURE_HTTP_ARTIFACT_URL_UNAVAILABLE",
  "CAPTURE_HTTP_UPLOAD_FAILED",
  "CAPTURE_HTTP_UPLOAD_URL_UNAVAILABLE",
  "CAPTURE_HTTP_UPLOAD_ARTIFACT_MISSING"
]);

function realBatchFailure(code = "CAPTURE_HTTP_REAL_BATCH_FAILED") {
  const safeCode = typeof code === "string" && SAFE_REAL_BATCH_ERROR_CODES.has(code)
    ? code
    : "CAPTURE_HTTP_REAL_BATCH_FAILED";
  return {
    code: safeCode,
    message: "Unable to complete the real capture HTTP small-batch."
  };
}

function runnableRealBatchItem(item, { resume }) {
  if (completedQueueItem(item)) return false;
  if (["pending", "confirmed"].includes(item?.status)) return true;
  if (resume && ["failed_remote", "failed_pre_submit", "interrupted_unknown"].includes(item?.status)) return true;
  return false;
}

function realBatchQueue(items, {
  status,
  currentTaskId,
  completed,
  failed,
  pointBudget,
  maxItems,
  timestamp,
  lastError = null,
  prevQueue = null
}) {
  return {
    mode: "real_live",
    status,
    total: items.length,
    completed,
    failed,
    current_task_id: currentTaskId,
    point_budget: pointBudget,
    max_items: maxItems,
    started_at: (prevQueue?.mode === "real_live" && prevQueue?.started_at) || timestamp,
    updated_at: timestamp,
    last_error: lastError
  };
}

function itemHasSubmittedArtifact(batch, item) {
  if (!item?.remote_evidence?.remote_id) return false;
  if (typeof item.output_path !== "string" || item.output_path.length === 0) return false;
  return Array.isArray(batch.artifacts) && batch.artifacts.some((a) => a && a.relative_path === item.output_path);
}

function failedRealBatchItem(item) {
  return ["failed_remote", "failed_pre_submit", "interrupted_unknown"].includes(item?.status);
}

async function approvedImagePath(batch, batchDirectory, artifactId) {
  const upload = batch.uploads?.find((candidate) => candidate.artifact_id === artifactId && candidate.kind === "image");
  const manifest = batch.artifacts?.find((candidate) => candidate.artifact_id === artifactId);
  if (!upload || !manifest || manifest.relative_path !== `uploads/${upload.storage_name}` || !isSafeRelativePath(manifest.relative_path)) {
    throw captureError("UNAUTHORIZED_PRODUCT_IMAGE");
  }
  const candidatePath = path.resolve(batchDirectory, manifest.relative_path);
  if (!contained(batchDirectory, candidatePath)) throw captureError("UNAUTHORIZED_PRODUCT_IMAGE");
  const [realBatchDirectory, realImagePath, info] = await Promise.all([
    realpath(batchDirectory), realpath(candidatePath), lstat(candidatePath)
  ]);
  if (!contained(realBatchDirectory, realImagePath) || info.isSymbolicLink() || !info.isFile()) {
    throw captureError("UNAUTHORIZED_PRODUCT_IMAGE");
  }
  return candidatePath;
}

function taskWithApprovedImagePath(batch, batchDirectory, task) {
  return approvedImagePath(batch, batchDirectory, task.product_image_artifact_id).then((imagePath) => ({
    ...task,
    image_path: imagePath
  }));
}

function taskWithImagePath(batch, batchDirectory) {
  if (!Array.isArray(batch.items) || batch.items.length !== 1) {
    throw captureError("CAPTURE_HTTP_LIVE_LIMIT_ONE");
  }
  const task = batch.items[0];
  return approvedImagePath(batch, batchDirectory, task.product_image_artifact_id).then((imagePath) => ({
    ...task,
    image_path: imagePath
  }));
}

function queueRunConfig(generationConfig, manifestPath) {
  return {
    ...generationConfig,
    rpa: {
      ...(generationConfig.rpa || {}),
      mode: "capture_http",
      manifestPath,
      captureHttpMode: "mock"
    }
  };
}

function liveRunConfig(generationConfig, manifestPath) {
  return {
    ...generationConfig,
    rpa: {
      ...(generationConfig.rpa || {}),
      mode: "capture_http",
      manifestPath,
      captureHttpMode: "real_live",
      realLive: {
        ...(generationConfig.rpa?.realLive || {}),
        enabled: true
      }
    }
  };
}

function completedQueueItem(item) {
  return item?.status === "completed" && typeof item.output_path === "string" && item.output_path.length > 0;
}

function runnableQueueItem(item, { resume }) {
  if (completedQueueItem(item)) return false;
  if (["pending", "confirmed", "completed"].includes(item?.status)) return true;
  if (resume && ["failed_remote", "failed_pre_submit", "interrupted_unknown"].includes(item?.status)) return true;
  return false;
}

function safeQueueErrorMessage() {
  return "Capture HTTP small-batch preview failed. No Hifly request was sent.";
}

export async function registerCaptureRoutes(app, { batchRoot, store, generationConfig = {}, captureLive = {} }) {
  const activeRealBatchBatches = new Set();
  async function readCaptureBatch(batchId) {
    const batch = await store.read(batchId);
    if (batch.capture?.enabled !== true) throw captureError("CAPTURE_NOT_ENABLED", 409);
    return batch;
  }

  app.post("/api/batches/:batchId/capture/extract", async (request) => {
    const batchId = assertBatchId(request.params.batchId);
    const batch = await readCaptureBatch(batchId);
    if (!batch.capture?.har_path) throw captureError("CAPTURE_HAR_MISSING", 409);

    const root = path.dirname(batchRoot);
    const batchDirectory = path.join(batchRoot, batchId);
    const harPath = resolveProjectRelative(root, batch.capture.har_path);
    const rawStepsRelativePath = `batches/${batchId}/capture/raw-steps.json`;
    const rawStepsPath = resolveProjectRelative(root, rawStepsRelativePath);
    await mkdir(path.join(batchDirectory, "capture"), { recursive: true, mode: 0o700 });
    const raw = await extractRawStepsFromHar({ harPath, outputPath: rawStepsPath });
    if (raw.steps.length === 0) throw captureError("CAPTURE_NO_CANDIDATES", 422);

    const updated = await store.update(batchId, (current) => ({
      ...current,
      capture: updateCaptureState(current.capture, {
        enabled: true,
        status: "extracted",
        raw_steps_path: rawStepsRelativePath,
        extract_summary: { step_count: raw.steps.length }
      })
    }));
    return { batch: publicBatch(updated) };
  });

  app.post("/api/batches/:batchId/capture/redact", async (request) => {
    const batchId = assertBatchId(request.params.batchId);
    const batch = await readCaptureBatch(batchId);
    if (!batch.capture?.raw_steps_path) throw captureError("CAPTURE_RAW_STEPS_MISSING", 409);

    const root = path.dirname(batchRoot);
    const rawStepsPath = resolveProjectRelative(root, batch.capture.raw_steps_path);
    const manifestRelativePath = `batches/${batchId}/capture/manifest.json`;
    const reportRelativePath = `batches/${batchId}/capture/redaction-report.json`;
    const manifestPath = resolveProjectRelative(root, manifestRelativePath);
    const reportPath = resolveProjectRelative(root, reportRelativePath);
    const raw = JSON.parse(await readFile(rawStepsPath, "utf8"));
    const { sanitized, report } = redactCaptureSource(raw);
    parseCaptureManifest(sanitized);
    await mkdir(path.dirname(manifestPath), { recursive: true, mode: 0o700 });
    await Promise.all([
      writeFile(manifestPath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8"),
      writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8")
    ]);
    const updated = await store.update(batchId, (current) => ({
      ...current,
      capture: updateCaptureState(current.capture, {
        enabled: true,
        status: "redacted",
        manifest_path: manifestRelativePath,
        report_path: reportRelativePath,
        redaction_summary: { removed_count: report.removed.length }
      })
    }));
    return { batch: publicBatch(updated) };
  });

  app.post("/api/batches/:batchId/capture/replay", async (request) => {
    const batchId = assertBatchId(request.params.batchId);
    const batch = await readCaptureBatch(batchId);
    if (!batch.capture?.manifest_path) throw captureError("CAPTURE_MANIFEST_MISSING", 409);

    const root = path.dirname(batchRoot);
    const manifestPath = resolveProjectRelative(root, batch.capture.manifest_path);
    try {
      const replay = await runOfflineCaptureReplay({ manifestPath });
      const updated = await store.update(batchId, (current) => ({
        ...current,
        capture: updateCaptureState(current.capture, {
          enabled: true,
          status: "replay_passed",
          replay_error: null,
          replay_summary: {
            executed_step_count: replay.executed_steps.length,
            remote_id: replay.variables.remote_id ?? null,
            artifact_filename: replay.variables.artifact_filename ?? null
          }
        })
      }));
      return { batch: publicBatch(updated) };
    } catch (error) {
      const updated = await store.update(batchId, (current) => ({
        ...current,
        capture: updateCaptureState(current.capture, {
          enabled: true,
          status: "replay_failed",
          replay_error: replayFailure()
        })
      }));
      return { batch: publicBatch(updated) };
    }
  });

  app.post("/api/batches/:batchId/capture/dry-run", async (request) => {
    const batchId = assertBatchId(request.params.batchId);
    const batch = await readCaptureBatch(batchId);
    if (!batch.capture?.manifest_path) throw captureError("CAPTURE_MANIFEST_MISSING", 409);

    const root = path.dirname(batchRoot);
    const manifestPath = resolveProjectRelative(root, batch.capture.manifest_path);
    try {
      const manifest = await loadCaptureManifest(manifestPath);
      const client = createDryRunHttpClient({ manifest });
      const variables = {
        product_image_path: "product-image.jpg",
        person_image_path: "person-image.jpg",
        ...(request.body?.variables && typeof request.body.variables === "object" ? request.body.variables : {})
      };
      const requestPlan = [];
      const executed = [];
      for (const phase of CAPTURE_PHASES) {
        for (const step of selectStepsByPhase(manifest, phase)) {
          const result = await client.request({ stepId: step.id, variables });
          Object.assign(variables, result.produced);
          if (result.request_plan) requestPlan.push(publicDryRunRequestPlan(step, result.request_plan));
          executed.push(step.id);
        }
      }
      const updated = await store.update(batchId, (current) => ({
        ...current,
        capture: updateCaptureState(current.capture, {
          enabled: true,
          status: "dry_run_passed",
          dry_run_error: null,
          dry_run_summary: {
            executed_step_count: executed.length,
            request_plan: requestPlan
          }
        })
      }));
      return { batch: publicBatch(updated) };
    } catch (error) {
      const updated = await store.update(batchId, (current) => ({
        ...current,
        capture: updateCaptureState(current.capture, {
          enabled: true,
          status: "dry_run_failed",
          dry_run_error: dryRunFailure(),
          dry_run_summary: null
        })
      }));
      return { batch: publicBatch(updated) };
    }
  });

  app.post("/api/batches/:batchId/capture/live-status", async (request) => {
    const batchId = assertBatchId(request.params.batchId);
    await readCaptureBatch(batchId);
    const updated = await store.update(batchId, (current) => ({
      ...current,
      capture: updateCaptureState(current.capture, {
        enabled: true,
        status: "real_live_disabled",
        live_error: realLiveDisabledFailure()
      })
    }));
    return { batch: publicBatch(updated) };
  });

  app.post("/api/batches/:batchId/capture/queue-run", async (request) => {
    const batchId = assertBatchId(request.params.batchId);
    const fields = queueRunFields(request.body);
    const batch = await readCaptureBatch(batchId);
    if (!batch.capture?.manifest_path) throw captureError("CAPTURE_MANIFEST_MISSING", 409);
    if (!Array.isArray(batch.items) || batch.items.length === 0) throw captureError("CAPTURE_HTTP_QUEUE_NOT_READY", 409);

    const root = path.dirname(batchRoot);
    const manifestPath = batch.capture.manifest_path;
    resolveProjectRelative(root, manifestPath);
    const batchDirectory = path.join(batchRoot, batchId);
    const eligible = batch.items.filter((item) => runnableQueueItem(item, fields));
    if (eligible.length === 0) throw captureError("CAPTURE_HTTP_QUEUE_NOT_READY", 409);

    const startedAt = new Date().toISOString();
    let completedCount = batch.items.filter(completedQueueItem).length;
    await store.update(batchId, (current) => ({
      ...current,
      capture: updateCaptureState(current.capture, {
        enabled: true,
        queue: {
          mode: "fake",
          status: "running",
          total: current.items.length,
          completed: completedCount,
          failed: 0,
          current_task_id: eligible[0]?.task_id || null,
          started_at: startedAt,
          updated_at: startedAt,
          last_error: null
        }
      })
    }));

    const executor = createCaptureHttpExecutor({
      root,
      config: queueRunConfig(generationConfig, manifestPath)
    });

    let currentTaskId = null;
    try {
      for (const item of eligible) {
        currentTaskId = item.task_id;
        const currentStartedAt = new Date().toISOString();
        await store.update(batchId, (current) => ({
          ...current,
          status: "active",
          items: current.items.map((candidate) => candidate.task_id === item.task_id
            ? { ...candidate, status: "generating_asset", error_message: null, error_phase: null }
            : candidate),
          capture: updateCaptureState(current.capture, {
            enabled: true,
            queue: {
              ...(current.capture?.queue || {}),
              mode: "fake",
              status: "running",
              total: current.items.length,
              completed: completedCount,
              failed: 0,
              current_task_id: item.task_id,
              updated_at: currentStartedAt,
              last_error: null
            }
          })
        }));

        const task = await taskWithApprovedImagePath(batch, batchDirectory, item);
        const context = { batchId, taskId: task.task_id };
        const asset = await executor.createAsset(task, context);
        const submitted = await executor.submitVideo(task, asset, context);
        const queried = await executor.querySubmission(submitted.remoteEvidence, context);
        const artifact = await executor.downloadArtifact(queried.remoteEvidence, batchDirectory, context);
        if (typeof store.registerArtifact === "function") {
          try {
            await store.registerArtifact(batchId, artifact);
          } catch (error) {
            if (!/already exists/i.test(error.message)) throw error;
          }
        }
        completedCount += 1;
        const finishedAt = new Date().toISOString();
        await store.update(batchId, (current) => {
          const items = current.items.map((candidate) => candidate.task_id === item.task_id
            ? {
                ...candidate,
                status: "completed",
                output_path: artifact.relative_path,
                remote_evidence: submitted.remoteEvidence,
                error_message: null,
                error_phase: null
              }
            : candidate);
          return {
            ...current,
            status: summarizeBatch(items),
            items,
            capture: updateCaptureState(current.capture, {
              enabled: true,
              queue: {
                ...(current.capture?.queue || {}),
                mode: "fake",
                status: "running",
                total: items.length,
                completed: completedCount,
                failed: 0,
                current_task_id: item.task_id,
                updated_at: finishedAt,
                last_error: null
              }
            })
          };
        });
      }

      const completedAt = new Date().toISOString();
      const updated = await store.update(batchId, (current) => ({
        ...current,
        status: summarizeBatch(current.items),
        capture: updateCaptureState(current.capture, {
          enabled: true,
          queue: {
            ...(current.capture?.queue || {}),
            mode: "fake",
            status: "completed",
            total: current.items.length,
            completed: current.items.filter(completedQueueItem).length,
            failed: 0,
            current_task_id: null,
            updated_at: completedAt,
            last_error: null
          }
        })
      }));
      return { batch: publicBatch(updated) };
    } catch (error) {
      const failedTaskId = currentTaskId || eligible[0]?.task_id || null;
      const failedAt = new Date().toISOString();
      const updated = await store.update(batchId, (current) => {
        const items = current.items.map((candidate) => candidate.task_id === failedTaskId
          ? {
              ...candidate,
              status: "failed_remote",
              error_phase: "capture_http_queue",
              error_message: safeQueueErrorMessage()
            }
          : candidate);
        return {
          ...current,
          status: summarizeBatch(items),
          items,
          capture: updateCaptureState(current.capture, {
            enabled: true,
            queue: {
              ...(current.capture?.queue || {}),
              mode: "fake",
              status: "failed",
              total: items.length,
              completed: items.filter(completedQueueItem).length,
              failed: 1,
              current_task_id: failedTaskId,
              updated_at: failedAt,
              last_error: queueFailure(error?.code)
            }
          })
        };
      });
      return { batch: publicBatch(updated) };
    }
  });

  app.post("/api/batches/:batchId/capture/live-run", async (request) => {
    const batchId = assertBatchId(request.params.batchId);
    liveRunFields(request.body);
    const batch = await readCaptureBatch(batchId);
    if (!batch.capture?.manifest_path) throw captureError("CAPTURE_MANIFEST_MISSING", 409);
    if (!["dry_run_passed", "real_live_failed"].includes(batch.capture.status)) {
      throw captureError("CAPTURE_HTTP_LIVE_RUN_NOT_READY", 409);
    }

    const root = path.dirname(batchRoot);
    const manifestPath = batch.capture.manifest_path;
    resolveProjectRelative(root, manifestPath);
    const batchDirectory = path.join(batchRoot, batchId);
    const task = await taskWithImagePath(batch, batchDirectory);
    const authProvider = captureLive.authProvider;
    if (!authProvider || typeof authProvider.getRuntimeAuth !== "function") {
      throw captureError("CAPTURE_HTTP_RUNTIME_AUTH_UNAVAILABLE", 409);
    }
    let runtimeAuth;
    try {
      runtimeAuth = await authProvider.getRuntimeAuth();
    } catch {
      throw captureError("CAPTURE_HTTP_RUNTIME_AUTH_UNAVAILABLE", 409);
    }

    await store.update(batchId, (current) => ({
      ...current,
      capture: updateCaptureState(current.capture, {
        enabled: true,
        status: "real_live_running",
        live_error: null,
        live_summary: null
      })
    }));

    try {
      const executor = createCaptureHttpExecutor({
        root,
        config: liveRunConfig(generationConfig, manifestPath)
      });
      const realLive = {
        allowRealLive: true,
        acknowledgePointRisk: true,
        runtimeAuth,
        transport: captureLive.transport || createFetchLiveTransport()
      };
      const context = { batchId, taskId: task.task_id, realLive };
      const asset = await executor.createAsset(task, context);
      const submitted = await executor.submitVideo(task, asset, context);
      const queried = await executor.querySubmission(submitted.remoteEvidence, context);
      const artifact = await executor.downloadArtifact(queried.remoteEvidence, batchDirectory, context);
      if (typeof store.registerArtifact === "function") {
        try {
          await store.registerArtifact(batchId, artifact);
        } catch (error) {
          if (!/already exists/i.test(error.message)) throw error;
        }
      }
      const completedAt = new Date().toISOString();
      const updated = await store.update(batchId, (current) => ({
        ...current,
        status: "completed",
        items: current.items.map((item) => item.task_id === task.task_id
          ? {
              ...item,
              status: "completed",
              output_path: artifact.relative_path,
              remote_evidence: submitted.remoteEvidence,
              error_message: null,
              error_phase: null
            }
          : item),
        capture: updateCaptureState(current.capture, {
          enabled: true,
          status: "real_live_completed",
          live_error: null,
          live_summary: {
            sku: task.sku || "",
            remote_id: submitted.remoteEvidence?.remote_id ?? null,
            artifact_path: artifact.relative_path,
            completed_at: completedAt
          }
        })
      }));
      return { batch: publicBatch(updated) };
    } catch (error) {
      const updated = await store.update(batchId, (current) => ({
        ...current,
        capture: updateCaptureState(current.capture, {
          enabled: true,
          status: "real_live_failed",
          live_error: realLiveFailure(error?.code)
        })
      }));
      return { batch: publicBatch(updated) };
    }
  });

  app.get("/api/batches/:batchId/capture/real-batch-preflight", async (request) => {
    const batchId = assertBatchId(request.params.batchId);
    const batchConfig = generationConfig.rpa?.realLive?.batch || {};
    const enabled = batchConfig.enabled === true;
    const maxItems = Number.isInteger(batchConfig.maxItems) && batchConfig.maxItems >= 1 ? batchConfig.maxItems : 3;
    const authProvider = captureLive.authProvider;
    let runtimeAuthReady = Boolean(authProvider && typeof authProvider.getRuntimeAuth === "function");
    if (runtimeAuthReady) {
      try { await authProvider.getRuntimeAuth(); } catch { runtimeAuthReady = false; }
    }
    let batchReady = false;
    let batchStatus = null;
    let eligibleCount = 0;
    try {
      const batch = await store.read(batchId);
      batchStatus = batch?.capture?.status ?? null;
      batchReady = ["dry_run_passed", "real_batch_failed", "real_batch_running", "real_batch_completed"].includes(batchStatus)
        && Array.isArray(batch?.items) && batch.items.length > 0;
      eligibleCount = batchReady ? batch.items.filter((item) => runnableRealBatchItem(item, { resume: true })).length : 0;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return { enabled, maxItems, runtimeAuthReady, batchReady, batchStatus, eligibleCount };
  });

  app.post("/api/batches/:batchId/capture/real-batch-run", async (request) => {
    const batchId = assertBatchId(request.params.batchId);
    const batchConfig = generationConfig.rpa?.realLive?.batch || {};
    if (batchConfig.enabled !== true) throw captureError("CAPTURE_HTTP_REAL_BATCH_DISABLED");
    if (activeRealBatchBatches.has(batchId)) throw captureError("CAPTURE_HTTP_REAL_BATCH_IN_PROGRESS", 409);
    activeRealBatchBatches.add(batchId);
    try {
    const fields = realBatchRunFields(request.body, batchConfig.maxItems ?? 3);
    const batch = await readCaptureBatch(batchId);
    if (!batch.capture?.manifest_path) throw captureError("CAPTURE_MANIFEST_MISSING", 409);
    if (!["dry_run_passed", "real_batch_failed", "real_batch_running", "real_batch_completed"].includes(batch.capture.status)) {
      throw captureError("CAPTURE_HTTP_REAL_BATCH_NOT_READY", 409);
    }
    if (!Array.isArray(batch.items) || batch.items.length === 0) {
      throw captureError("CAPTURE_HTTP_REAL_BATCH_NOT_READY", 409);
    }

    const root = path.dirname(batchRoot);
    const manifestPath = batch.capture.manifest_path;
    resolveProjectRelative(root, manifestPath);
    const batchDirectory = path.join(batchRoot, batchId);
    const maxItems = batchConfig.maxItems ?? 3;
    const eligible = batch.items.filter((item) => runnableRealBatchItem(item, fields)).slice(0, fields.pointBudget);
    if (eligible.length === 0) throw captureError("CAPTURE_HTTP_REAL_BATCH_NOT_READY", 409);

    const authProvider = captureLive.authProvider;
    if (!authProvider || typeof authProvider.getRuntimeAuth !== "function") {
      throw captureError("CAPTURE_HTTP_RUNTIME_AUTH_UNAVAILABLE", 409);
    }
    let runtimeAuth;
    try {
      runtimeAuth = await authProvider.getRuntimeAuth();
    } catch {
      throw captureError("CAPTURE_HTTP_RUNTIME_AUTH_UNAVAILABLE", 409);
    }

    const startedAt = new Date().toISOString();
    let completedCount = batch.items.filter(completedQueueItem).length;
    await store.update(batchId, (current) => ({
      ...current,
      capture: updateCaptureState(current.capture, {
        enabled: true,
        status: "real_batch_running",
        live_error: null,
        live_summary: null,
        queue: realBatchQueue(current.items, {
          status: "running",
          currentTaskId: eligible[0]?.task_id || null,
          completed: completedCount,
          failed: 0,
          pointBudget: fields.pointBudget,
          maxItems,
          timestamp: startedAt,
          prevQueue: current.capture?.queue
        })
      })
    }));

    let currentTaskId = null;
    try {
      for (const item of eligible) {
        currentTaskId = item.task_id;

        if (item.remote_evidence?.remote_id) {
          if (itemHasSubmittedArtifact(batch, item)) {
            completedCount += 1;
            const reuseFinishedAt = new Date().toISOString();
            await store.update(batchId, (current) => {
              const items = current.items.map((candidate) => candidate.task_id === item.task_id
                ? {
                    ...candidate,
                    status: "completed",
                    output_path: item.output_path,
                    remote_evidence: item.remote_evidence,
                    error_message: null,
                    error_phase: null
                  }
                : candidate);
              return {
                ...current,
                status: summarizeBatch(items),
                items,
                capture: updateCaptureState(current.capture, {
                  enabled: true,
                  queue: realBatchQueue(items, {
                    status: "running",
                    currentTaskId: item.task_id,
                    completed: completedCount,
                    failed: 0,
                    pointBudget: fields.pointBudget,
                    maxItems,
                    timestamp: reuseFinishedAt,
                    prevQueue: current.capture?.queue
                  })
                })
              };
            });
            continue;
          }
          throw captureError("CAPTURE_HTTP_REAL_BATCH_DUPLICATE_SUBMIT");
        }

        const itemStartedAt = new Date().toISOString();
        await store.update(batchId, (current) => ({
          ...current,
          status: "active",
          items: current.items.map((candidate) => candidate.task_id === item.task_id
            ? { ...candidate, status: "generating_asset", error_message: null, error_phase: null }
            : candidate),
          capture: updateCaptureState(current.capture, {
            enabled: true,
            queue: realBatchQueue(current.items, {
              status: "running",
              currentTaskId: item.task_id,
              completed: completedCount,
              failed: 0,
              pointBudget: fields.pointBudget,
              maxItems,
              timestamp: itemStartedAt,
              prevQueue: current.capture?.queue
            })
          })
        }));

        const task = await taskWithApprovedImagePath(batch, batchDirectory, item);
        const context = {
          batchId,
          taskId: task.task_id,
          realLive: {
            allowRealLive: true,
            acknowledgePointRisk: true,
            runtimeAuth,
            transport: captureLive.transport
          }
        };
        const executor = createCaptureHttpExecutor({ root, config: liveRunConfig(generationConfig, manifestPath) });
        const asset = await executor.createAsset(task, context);
        const submitted = await executor.submitVideo(task, asset, context);
        await store.update(batchId, (current) => ({
          ...current,
          items: current.items.map((candidate) => candidate.task_id === item.task_id
            ? { ...candidate, remote_evidence: submitted.remoteEvidence }
            : candidate)
        }));
        const queried = await executor.querySubmission(submitted.remoteEvidence, context);
        const artifact = await executor.downloadArtifact(queried.remoteEvidence, batchDirectory, context);
        if (typeof store.registerArtifact === "function") {
          try {
            await store.registerArtifact(batchId, artifact);
          } catch (error) {
            if (!/already exists/i.test(error.message)) throw error;
          }
        }
        completedCount += 1;
        const itemFinishedAt = new Date().toISOString();
        await store.update(batchId, (current) => {
          const items = current.items.map((candidate) => candidate.task_id === item.task_id
            ? {
                ...candidate,
                status: "completed",
                output_path: artifact.relative_path,
                remote_evidence: submitted.remoteEvidence,
                error_message: null,
                error_phase: null
              }
            : candidate);
          return {
            ...current,
            status: summarizeBatch(items),
            items,
            capture: updateCaptureState(current.capture, {
              enabled: true,
              queue: realBatchQueue(items, {
                status: "running",
                currentTaskId: item.task_id,
                completed: completedCount,
                failed: 0,
                pointBudget: fields.pointBudget,
                maxItems,
                timestamp: itemFinishedAt,
                prevQueue: current.capture?.queue
              })
            })
          };
        });
      }

      const completedAt = new Date().toISOString();
      const updated = await store.update(batchId, (current) => ({
        ...current,
        status: summarizeBatch(current.items),
        capture: updateCaptureState(current.capture, {
          enabled: true,
          status: "real_batch_completed",
          queue: realBatchQueue(current.items, {
            status: "completed",
            currentTaskId: null,
            completed: current.items.filter(completedQueueItem).length,
            failed: current.items.filter(failedRealBatchItem).length,
            pointBudget: fields.pointBudget,
            maxItems,
            timestamp: completedAt,
            prevQueue: current.capture?.queue
          })
        })
      }));
      return { batch: publicBatch(updated) };
    } catch (error) {
      const failedTaskId = currentTaskId;
      const failedAt = new Date().toISOString();
      const updated = await store.update(batchId, (current) => {
        const items = current.items.map((candidate) => candidate.task_id === failedTaskId
          ? {
              ...candidate,
              status: "failed_remote",
              error_phase: "capture_http_real_batch",
              error_message: safeQueueErrorMessage()
            }
          : candidate);
        return {
          ...current,
          status: summarizeBatch(items),
          items,
          capture: updateCaptureState(current.capture, {
            enabled: true,
            status: "real_batch_failed",
            queue: realBatchQueue(items, {
              status: "failed",
              currentTaskId: failedTaskId,
              completed: items.filter(completedQueueItem).length,
              failed: items.filter(failedRealBatchItem).length,
              pointBudget: fields.pointBudget,
              maxItems,
              timestamp: failedAt,
              lastError: realBatchFailure(error?.code),
              prevQueue: current.capture?.queue
            })
          })
        };
      });
      return { batch: publicBatch(updated) };
    }
    } finally {
      activeRealBatchBatches.delete(batchId);
    }
  });
}
