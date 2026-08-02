import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { runBatch } from "../../core/batch-runner.js";
import { acquireExecutionLock } from "../../core/execution-lock.js";
import { createExecutionSnapshot } from "../../core/execution-snapshot.js";
import { createIdempotencyRegistry } from "../../core/idempotency-registry.js";
import { resolvePersonStrategies } from "../../core/person-strategy.js";
import { validateProducts } from "../../core/product-validation.js";
import { resolveScriptStrategies } from "../../core/script-strategy.js";
import { summarizeBatch, transitionTask } from "../../core/state-machine.js";
import { updateCaptureState } from "../../rpa/capture/workflow-state.js";
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

function captureHarPath(batchId) {
  return `rpa/capture/raw/${batchId}-${Date.now()}.har`;
}

async function fileExists(filePath) {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export function createExecutionCoordinator({
  batchRoot,
  executor,
  executorFactory = null,
  store,
  config = {},
  logger,
  lockOptions = {},
  pointsEstimate = {},
  idempotencyMaxEntries,
  idempotencyTtlMs,
  now
}) {
  let active = null;
  let stopping = false;
  const idempotencyOptions = {};
  if (Number.isInteger(idempotencyMaxEntries)) idempotencyOptions.maxEntries = idempotencyMaxEntries;
  if (typeof idempotencyTtlMs === "number" && Number.isFinite(idempotencyTtlMs)) idempotencyOptions.ttlMs = idempotencyTtlMs;
  if (typeof now === "function") idempotencyOptions.now = now;
  const idempotency = createIdempotencyRegistry(idempotencyOptions);

  async function start(body) {
    const { batchId, idempotencyKey } = requestFields(body);
    // Idempotency is checked BEFORE the stopping/executor guards: a key that was
    // already accepted and is still within its TTL (including after a safe-stop)
    // must be rejected as a duplicate rather than re-started — this is what
    // prevents a late retry from double-spending points.
    if (idempotency.check(idempotencyKey)) throw executionError("DUPLICATE_IDEMPOTENCY_KEY", 409);
    if (stopping) throw executionError("SERVER_STOPPING", 503);
    if (!executor) throw executionError("EXECUTOR_UNAVAILABLE", 503);
    if (active) throw executionError("EXECUTION_IN_PROGRESS", 409);
    // Reserve the key SYNCHRONOUSLY before any await: this closes the window
    // between the duplicate check and acceptance so two concurrent same-key
    // requests cannot both pass (the second gets 409 DUPLICATE_IDEMPOTENCY_KEY,
    // not EXECUTION_IN_PROGRESS). reserve() also applies capacity backpressure:
    // if the registry is full it throws IDEMPOTENCY_REGISTRY_FULL (503) WITHOUT
    // starting the executor or evicting any unexpired receipt. If lock/prep fails
    // below, the key is released so a retry is not blocked.
    idempotency.reserve(idempotencyKey, { batchId });

    const batchDirectory = path.join(batchRoot, batchId);
    const controller = new AbortController();
    const execution = { id: idempotencyKey, batchId, controller, lock: null, done: null, ready: null };
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
        idempotency.release(idempotencyKey);
        if (error?.code === "EXECUTION_LOCKED") throw executionError("EXECUTION_IN_PROGRESS", 409);
        throw error;
      }

      let batch;
      try {
        batch = await prepareExecution({ batchId, batchDirectory, store, config, logger, pointsEstimate });
      } catch (error) {
        await lock.release().catch(() => {});
        idempotency.release(idempotencyKey);
        throw error;
      }

      // Prep succeeded: the execution is accepted. Back-fill the receipt with the
      // persisted snapshot executionId (the opaque identity returned to clients,
      // NOT the caller's idempotencyKey). It stays active (and therefore never
      // expires) until settle, when the full TTL starts from the settle moment.
      idempotency.accept(idempotencyKey, { executionId: batch.execution_snapshot?.executionKey ?? null });
      return { batch, lock, controller };
    })();
    execution.done = execution.ready.then(async ({ batch, lock, controller }) => {
      const workspaceRoot = path.dirname(batchRoot);
      const captureEnabled = batch.capture?.enabled === true;
      const recordHarPath = captureEnabled ? captureHarPath(batchId) : null;
      let runExecutor = executor;
      let shouldCloseRunExecutor = false;
      if (captureEnabled) {
        await mkdir(path.join(workspaceRoot, "rpa", "capture", "raw"), { recursive: true, mode: 0o700 });
        await store.update(batchId, (current) => ({
          ...current,
          capture: updateCaptureState(current.capture, {
            enabled: true,
            status: "recording",
            har_path: recordHarPath
          })
        }));
        if (executorFactory) {
          runExecutor = await executorFactory({
            batch,
            batchDirectory,
            capture: { ...batch.capture, har_path: recordHarPath },
            recordHarPath
          });
          shouldCloseRunExecutor = runExecutor !== executor;
        }
      }

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
        executor: runExecutor,
        store,
        lock
      }).catch(async (error) => {
        await store.update(batchId, (current) => ({ ...current, execution_error: error.message }));
      }).finally(async () => {
        // Executor close (HAR flush) is part of the terminal boundary. If it throws,
        // record the error explicitly instead of silently swallowing it, and do NOT
        // mark capture recorded (the HAR may be incomplete).
        let closeError = null;
        if (shouldCloseRunExecutor) {
          try {
            await runExecutor?.close?.();
          } catch (error) {
            closeError = error;
          }
        }
        if (captureEnabled) {
          const harRecorded = !closeError && recordHarPath &&
            await fileExists(path.join(workspaceRoot, recordHarPath));
          // Terminal capture states (CI-002): a settled execution must not leave
          // capture stuck at "recording". Normal completion + intact HAR -> recorded;
          // a safe-stopped execution -> recording_interrupted; a close/HAR-flush
          // failure -> recording_failed. Terminal-transition guard: only mark
          // recorded when every item reached a real terminal "completed" state.
          await store.update(batchId, (current) => {
            const allCompleted = Array.isArray(current.items) && current.items.length > 0 &&
              current.items.every((item) => item.status === "completed");
            if (harRecorded && allCompleted) {
              return {
                ...current,
                capture: updateCaptureState(current.capture, { enabled: true, status: "recorded", recording_error: null })
              };
            }
            if (closeError) {
              return {
                ...current,
                capture: updateCaptureState(current.capture, {
                  enabled: true,
                  status: "recording_failed",
                  recording_error: { code: "CAPTURE_HAR_FLUSH_FAILED" }
                })
              };
            }
            // No close error, but not every item completed: the execution was
            // safely interrupted before finishing.
            return {
              ...current,
              capture: updateCaptureState(current.capture, {
                enabled: true,
                status: "recording_interrupted",
                recording_error: { code: "CAPTURE_RECORDING_INTERRUPTED" }
              })
            };
          });
        }
        if (closeError) {
          await store.update(batchId, (current) => ({
            ...current,
            execution_error: current.execution_error ?? `capture executor close failed: ${closeError.message}`
          })).catch(() => {});
        }
        await lock.release().catch(() => {});
      });
    }).finally(() => {
      if (active === execution) active = null;
      // Settle (don't release): the key stays in the registry for its TTL so a
      // retry within the window is rejected as a duplicate (409) instead of
      // starting a second execution that could double-spend points. The persisted
      // execution snapshot remains the durable record used by waitForCompletion
      // after settle/restart. settle() is a no-op if the key was already released
      // by a lock/prep failure.
      idempotency.settle(idempotencyKey);
    });
    let ready;
    try {
      ready = await execution.ready;
    } catch (error) {
      await execution.done.catch(() => {});
      throw error;
    }
    // Bind the execution to its persisted snapshot key so waitForCompletion can
    // verify the executionId<->batchId binding even after the in-memory handle is
    // gone (settled / server restart). The executionId returned to clients is the
    // opaque snapshot executionKey, not the caller-supplied idempotencyKey.
    execution.id = ready.batch.execution_snapshot?.executionKey ?? idempotencyKey;
    return { batch: publicBatch(ready.batch), executionId: execution.id };
  }

  // Terminal-completion contract (CI-002 / direction A):
  // resolves only after business execution finished AND capture/HAR flush finished
  // AND the capture executor was closed AND the terminal state was persisted AND
  // the execution lock was released. Callers must await this instead of polling
  // for two independently-persisted states (completed && capture.recorded).
  //
  // Identity contract (direction B): executionId is bound to a specific batchId.
  // The route carries both; this function verifies the binding against the live
  // execution first, then against the persisted execution snapshot so a settled
  // execution still resolves after restart. An unknown executionId (or one that
  // does not belong to batchId) returns 404 EXECUTION_NOT_FOUND — it NEVER falls
  // back to treating the id as a batchId.
  async function waitForCompletion(batchId, executionId) {
    assertBatchId(batchId);
    const execution = active;
    if (execution && execution.batchId === batchId) {
      if (execution.id !== executionId) {
        // This batch has a different in-flight execution: the id does not match.
        throw executionError("EXECUTION_NOT_FOUND", 404);
      }
      await execution.done;
      const batch = await store.read(batchId);
      return { batch: publicBatch(batch), executionId };
    }
    // Nothing in flight for this batch: verify against the persisted snapshot so a
    // settled execution still resolves (including after a server restart, where the
    // in-memory active handle is gone). The snapshot binds the execution to the batch.
    const batch = await store.read(batchId);
    const snapshotKey = batch.execution_snapshot?.executionKey;
    if (typeof snapshotKey !== "string" || snapshotKey !== executionId) {
      throw executionError("EXECUTION_NOT_FOUND", 404);
    }
    return { batch: publicBatch(batch), executionId };
  }

  async function stop() {
    stopping = true;
    active?.controller?.abort();
    await active?.done;
  }

  return { start, stop, waitForCompletion };
}

export async function registerExecutionRoutes(app, { coordinator }) {
  app.post("/api/executions", async (request, reply) => {
    const result = await coordinator.start(request.body);
    reply.code(202);
    return result;
  });

  // Terminal-completion boundary: awaits the execution's full terminal transition
  // (business completion + capture/HAR flush + executor close + terminal persist),
  // then returns the persisted batch snapshot. Clients/tests should await this
  // instead of polling two independently-persisted states.
  //
  // Idempotent, body-less GET (no JSON body, so no global parser change). The
  // executionId is bound to batchId and verified against the persisted execution
  // snapshot; an unknown or mismatched id returns 404 EXECUTION_NOT_FOUND.
  app.get("/api/executions/:batchId/:executionId/wait", async (request) => {
    const result = await coordinator.waitForCompletion(request.params.batchId, request.params.executionId);
    return result;
  });
}
