import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";

import { runBatch } from "../../core/batch-runner.js";
import { acquireExecutionLock } from "../../core/execution-lock.js";
import { createExecutionSnapshot } from "../../core/execution-snapshot.js";
import { resolvePersonStrategies } from "../../core/person-strategy.js";
import { validateProducts } from "../../core/product-validation.js";
import { resolveScriptStrategies } from "../../core/script-strategy.js";
import { summarizeBatch, transitionTask } from "../../core/state-machine.js";
import { assertBatchId, publicBatch } from "./batches.js";

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function executionError(code, statusCode) {
  return Object.assign(new Error(code), { code, statusCode });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

async function approvedImagePath(batch, batchDirectory, artifactId) {
  const upload = batch.uploads?.find((candidate) => candidate.artifact_id === artifactId && candidate.kind === "image");
  const manifest = batch.artifacts?.find((candidate) => candidate.artifact_id === artifactId);
  if (!upload || !manifest || manifest.relative_path !== `uploads/${upload.storage_name}` || !isSafeRelativePath(manifest.relative_path)) {
    throw executionError("UNAUTHORIZED_PRODUCT_IMAGE", 400);
  }
  const candidatePath = path.resolve(batchDirectory, manifest.relative_path);
  if (!contained(batchDirectory, candidatePath)) throw executionError("UNAUTHORIZED_PRODUCT_IMAGE", 400);
  const [realBatchDirectory, realImagePath, info] = await Promise.all([
    realpath(batchDirectory), realpath(candidatePath), lstat(candidatePath)
  ]);
  if (!contained(realBatchDirectory, realImagePath) || info.isSymbolicLink() || !info.isFile()) {
    throw executionError("UNAUTHORIZED_PRODUCT_IMAGE", 400);
  }
  return realImagePath;
}

async function resolveFixedPersonPath(batch, batchDirectory) {
  const artifactId = batch.fixed_person_image_artifact_id;
  if (!artifactId) return null;
  return approvedImagePath(batch, batchDirectory, artifactId);
}

function resolvePoolPersonPaths(items, config) {
  const root = config.__rootDir ?? process.cwd();
  return items.map((item) => {
    const isPoolSource = item.resolved_person_source === "category_pool" ||
      item.resolved_person_source === "default_pool";
    if (!isPoolSource ||
      !item.__resolved_person_image_path || path.isAbsolute(item.__resolved_person_image_path)) {
      return item;
    }
    return {
      ...item,
      __resolved_person_image_path: path.resolve(root, item.__resolved_person_image_path)
    };
  });
}

async function prepareExecution({ batchId, batchDirectory, store, config = {}, logger, pointsEstimate = {} }) {
  const batch = await store.read(batchId);
  if (!Array.isArray(batch.items) || batch.items.length === 0 || batch.items.some((item) => item.status !== "pending")) {
    throw executionError("BATCH_NOT_READY", 400);
  }
  let items = await Promise.all(batch.items.map(async (item) => ({
    ...item,
    image_path: await approvedImagePath(batch, batchDirectory, item.product_image_artifact_id)
  })));
  items = resolvePersonStrategies(items, config, {
    person_strategy: batch.person_strategy || "auto_pool",
    fixed_person_image_path: await resolveFixedPersonPath(batch, batchDirectory)
  }, logger);
  items = resolvePoolPersonPaths(items, config);
  items = resolveScriptStrategies(items, {
    script_strategy: batch.script_strategy || "mixed"
  });
  const validation = validateProducts({
    products: items,
    config,
    options: { script_strategy: batch.script_strategy || "mixed" }
  });
  if (!validation.valid) throw executionError(validation.errors[0].code, 400);
  const confirmedAt = new Date().toISOString();
  const batchOptions = {
    person_strategy: batch.person_strategy || "auto_pool",
    script_strategy: batch.script_strategy || "mixed",
    fixed_person_image_artifact_id: batch.fixed_person_image_artifact_id || null
  };
  const execution = {
    ...pointsEstimate,
    projectRoot: batchDirectory,
    confirmedAt,
    batchOptions
  };
  const snapshot = await createExecutionSnapshot(items, execution);
  return store.update(batchId, (current) => {
    const confirmedItems = items.map((item) => transitionTask(item, {
      type: "CONFIRM",
      executionKey: snapshot.executionKey,
      confirmedAt
    }));
    return {
      ...current,
      status: summarizeBatch(confirmedItems),
      estimated_points: snapshot.estimate,
      execution_snapshot: snapshot,
      items: confirmedItems
    };
  });
}

function requestFields(body) {
  if (!isPlainObject(body) || Object.keys(body).some((key) => !["batchId", "idempotencyKey", "confirm"].includes(key))) {
    throw executionError("INVALID_EXECUTION_REQUEST", 400);
  }
  const batchId = assertBatchId(body.batchId);
  if (!IDEMPOTENCY_KEY_PATTERN.test(body.idempotencyKey ?? "")) {
    throw executionError("INVALID_IDEMPOTENCY_KEY", 400);
  }
  if (body.confirm !== true) throw executionError("EXPLICIT_CONFIRMATION_REQUIRED", 400);
  return { batchId, idempotencyKey: body.idempotencyKey };
}

export function createExecutionCoordinator({ batchRoot, executor, store, config = {}, logger, lockOptions = {}, pointsEstimate = {} }) {
  let active = null;
  let stopping = false;
  const idempotencyKeys = new Set();

  async function start(body) {
    if (stopping) throw executionError("SERVER_STOPPING", 503);
    if (!executor) throw executionError("EXECUTOR_UNAVAILABLE", 503);
    const { batchId, idempotencyKey } = requestFields(body);
    if (idempotencyKeys.has(idempotencyKey)) throw executionError("DUPLICATE_IDEMPOTENCY_KEY", 409);
    if (active) throw executionError("EXECUTION_IN_PROGRESS", 409);

    const batchDirectory = path.join(batchRoot, batchId);
    const controller = new AbortController();
    const execution = { batchId, controller, lock: null, done: null, ready: null };
    active = execution;
    execution.ready = (async () => {
      let lock;
      try {
        lock = await acquireExecutionLock({
          root: batchRoot,
          batchId,
          instanceId: `server-${randomUUID()}`,
          ...lockOptions
        });
        execution.lock = lock;
      } catch (error) {
        if (error?.code === "EXECUTION_LOCKED") throw executionError("EXECUTION_IN_PROGRESS", 409);
        throw error;
      }

      let batch;
      try {
        batch = await prepareExecution({ batchId, batchDirectory, store, config, logger, pointsEstimate });
      } catch (error) {
        await lock.release().catch(() => {});
        throw error;
      }

      idempotencyKeys.add(idempotencyKey);
      return { batch, lock, controller };
    })();
    execution.done = execution.ready.then(async ({ batch, lock, controller }) => {
      await runBatch({
        batchId,
        items: batch.items,
        config: {
          execution: {
            projectRoot: batchDirectory,
            confirmedAt: batch.execution_snapshot.confirmedAt,
            batchOptions: {
              person_strategy: batch.person_strategy || "auto_pool",
              script_strategy: batch.script_strategy || "mixed",
              fixed_person_image_artifact_id: batch.fixed_person_image_artifact_id || null
            }
          }
        },
        paths: { projectRoot: batchDirectory, downloadDir: batchDirectory },
        signal: controller.signal,
        executor,
        store,
        lock
      }).catch(async (error) => {
        await store.update(batchId, (current) => ({ ...current, execution_error: error.message }));
      }).finally(async () => {
        await lock.release().catch(() => {});
      });
    }).finally(() => {
      if (active === execution) active = null;
    });
    let ready;
    try {
      ready = await execution.ready;
    } catch (error) {
      await execution.done.catch(() => {});
      throw error;
    }
    return { batch: publicBatch(ready.batch), executionId: idempotencyKey };
  }

  async function stop() {
    stopping = true;
    active?.controller?.abort();
    await active?.done;
  }

  return { start, stop };
}

export async function registerExecutionRoutes(app, { coordinator }) {
  app.post("/api/executions", async (request, reply) => {
    const result = await coordinator.start(request.body);
    reply.code(202);
    return result;
  });
}
