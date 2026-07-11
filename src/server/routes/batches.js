import { randomUUID } from "node:crypto";

const BATCH_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const INTERNAL_ITEM_FIELDS = new Set([
  "image_path",
  "person_image_path",
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
    if (Object.keys(request.body).some((key) => key !== "batchId")) {
      throw Object.assign(new Error("Only batchId is accepted"), { code: "INVALID_BATCH" });
    }
    const batchId = request.body.batchId === undefined ? `batch-${randomUUID()}` : assertBatchId(request.body.batchId);
    const batch = await store.create({ batch_id: batchId, status: "needs_input", items: [], uploads: [] });
    reply.code(201);
    return { batch: publicBatch(batch) };
  });
}
