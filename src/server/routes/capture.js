import { mkdir } from "node:fs/promises";
import path from "node:path";

import { extractRawStepsFromHar } from "../../rpa/capture/har-extractor.js";
import { updateCaptureState } from "../../rpa/capture/workflow-state.js";
import { assertBatchId, publicBatch } from "./batches.js";

function captureError(code, statusCode = 400) {
  return Object.assign(new Error(code), { code, statusCode });
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

export async function registerCaptureRoutes(app, { batchRoot, store }) {
  app.post("/api/batches/:batchId/capture/extract", async (request) => {
    const batchId = assertBatchId(request.params.batchId);
    const batch = await store.read(batchId);
    if (batch.capture?.enabled !== true) throw captureError("CAPTURE_NOT_ENABLED", 409);
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
}
