import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

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

export async function registerCaptureRoutes(app, { batchRoot, store }) {
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
}
