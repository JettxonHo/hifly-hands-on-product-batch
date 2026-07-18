import { randomUUID } from "node:crypto";

import { summarizeBatch, transitionTask } from "../../core/state-machine.js";
import { createInitialCaptureState, publicCaptureState } from "../../rpa/capture/workflow-state.js";

const BATCH_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PERSON_STRATEGIES = new Set(["auto_pool", "fixed_upload", "hifly_recommended"]);
const SCRIPT_STRATEGIES = new Set(["hifly_ai", "provided_script", "mixed"]);
const INTERNAL_ITEM_FIELDS = new Set([
  "image_path",
  "person_image_path",
  "__resolved_person_image_path",
  "resolved_person_image_path"
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validBatchId(value) {
  return typeof value === "string" && BATCH_ID_PATTERN.test(value) && value !== "." && value !== "..";
}

function publicItem(item) {
  const value = {};
  for (const [key, field] of Object.entries(item ?? {})) {
    if (!INTERNAL_ITEM_FIELDS.has(key)) value[key] = key === "error_message" ? sanitizeMessage(field) : field;
  }
  return value;
}

function sanitizeMessage(value) {
  if (typeof value !== "string") return value;
  return value.replace(/(?:[A-Za-z]:[\\/]|\/)[^\s"'<>]*/g, "[local path]");
}

function batchError(code, statusCode = 400) {
  return Object.assign(new Error(code), { code, statusCode });
}

export function normalizeBatchStrategies(body = {}) {
  const person_strategy = body.person_strategy === undefined ? "auto_pool" : body.person_strategy;
  const script_strategy = body.script_strategy === undefined ? "mixed" : body.script_strategy;
  if (!PERSON_STRATEGIES.has(person_strategy)) throw batchError("INVALID_BATCH", 400);
  if (!SCRIPT_STRATEGIES.has(script_strategy)) throw batchError("INVALID_BATCH", 400);
  return {
    person_strategy,
    script_strategy
  };
}

function publicExecutionSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== "object") return snapshot;
  return {
    ...snapshot,
    items: Array.isArray(snapshot.items) ? snapshot.items.map(publicItem) : snapshot.items
  };
}

export function publicBatch(batch) {
  const { artifacts = [], uploads = [], items = [], ...rest } = batch;
  return {
    ...rest,
    capture: publicCaptureState(rest.capture),
    person_strategy: rest.person_strategy === undefined ? "auto_pool" : rest.person_strategy,
    script_strategy: rest.script_strategy === undefined ? "mixed" : rest.script_strategy,
    fixed_person_image_artifact_id: rest.fixed_person_image_artifact_id === undefined ? null : rest.fixed_person_image_artifact_id,
    execution_error: sanitizeMessage(rest.execution_error),
    execution_snapshot: publicExecutionSnapshot(rest.execution_snapshot),
    items: items.map(publicItem),
    uploads: uploads.map(({ artifact_id, logical_name, extension, kind, size }) => ({
      artifact_id, logical_name, extension, kind, size
    })),
    artifacts: artifacts.map(({ artifact_id }) => ({ artifact_id }))
  };
}

export function assertBatchId(batchId) {
  if (!validBatchId(batchId)) throw Object.assign(new Error("Invalid batchId"), { code: "INVALID_BATCH_ID" });
  return batchId;
}

export async function registerBatchRoutes(app, { store }) {
  app.get("/api/batches", async () => ({ batches: (await store.list()).map(publicBatch) }));

  app.get("/api/batches/:batchId", async (request) => ({
    batch: publicBatch(await store.read(assertBatchId(request.params.batchId)))
  }));

  app.post("/api/batches", async (request, reply) => {
    if (!isPlainObject(request.body)) throw Object.assign(new Error("JSON object required"), { code: "INVALID_BATCH" });
    if (Object.keys(request.body).some((key) => ![
      "batchId",
      "person_strategy",
      "script_strategy",
      "capture"
    ].includes(key))) {
      throw Object.assign(new Error("Only batchId is accepted"), { code: "INVALID_BATCH" });
    }
    const batchId = request.body.batchId === undefined ? `batch-${randomUUID()}` : assertBatchId(request.body.batchId);
    const strategies = normalizeBatchStrategies(request.body);
    const batch = await store.create({
      batch_id: batchId,
      status: "needs_input",
      items: [],
      uploads: [],
      capture: createInitialCaptureState({ enabled: request.body.capture?.enabled === true }),
      ...strategies
    });
    reply.code(201);
    return { batch: publicBatch(batch) };
  });

  app.post("/api/batches/:batchId/retry", async (request) => {
    const batchId = assertBatchId(request.params.batchId);
    if (!isPlainObject(request.body) || Object.keys(request.body).some((key) => !["confirm", "allowUnknown"].includes(key))) {
      throw batchError("INVALID_RETRY_REQUEST");
    }
    if (request.body.confirm !== true) throw batchError("EXPLICIT_CONFIRMATION_REQUIRED");

    const batch = await store.update(batchId, (current) => {
      const items = Array.isArray(current.items) ? current.items : [];
      const hasUnknown = items.some((item) => item.status === "interrupted_unknown");
      const retryable = items.length > 0 && items.every((item) =>
        item.status === "failed_pre_submit" ||
        item.status === "failed_remote" ||
        item.status === "interrupted_unknown"
      );
      if (!retryable || hasUnknown && request.body.allowUnknown !== true) {
        throw batchError("BATCH_NOT_RETRYABLE", 409);
      }
      const retriedItems = items.map((item) => transitionTask(item, {
        type: item.status === "interrupted_unknown" ? "FORCE_RETRY_GENERATION" : "RETRY_GENERATION",
        changes: {
          retry_count: Number(item.retry_count || 0) + 1,
          paused_auth: false,
          error_message: null,
          error_phase: null,
          asset_evidence: undefined,
          submit_checkpoint: undefined,
          remote_evidence: undefined,
          remote_candidates: undefined,
          output_path: undefined,
          submitted_at: undefined
        }
      }));
      return {
        ...current,
        status: summarizeBatch(retriedItems),
        execution_error: null,
        execution_snapshot: undefined,
        estimated_points: undefined,
        items: retriedItems
      };
    });
    return { batch: publicBatch(batch) };
  });
}
