import { randomUUID } from "node:crypto";

import { assertExecutorAdapter, emitExecutionEvent } from "./executor-adapter.js";
import { assertExecutionLockOwnership } from "./execution-lock.js";
import { createExecutionSnapshot } from "./execution-snapshot.js";
import { summarizeBatch, TASK_TRANSITIONS, transitionTask } from "./state-machine.js";
import { sanitizeEvidenceRecords } from "../execution-contracts/hifly-hands-on-product-evidence.js";

function now() {
  return new Date().toISOString();
}

function findTask(batch, taskId) {
  const task = batch.items?.find((item) => item.task_id === taskId);
  if (!task) throw new Error(`Task ${taskId} is not part of the batch`);
  return task;
}

function isPause(error) {
  return ["PAUSED_AUTH", "LOGIN_REQUIRED"].includes(error?.code);
}

function isRecoverableRpaInterruption(error) {
  return ["YINGDAO_RPA_TIMEOUT", "YINGDAO_RPA_INTERRUPTED_UNKNOWN"].includes(error?.code);
}

function isRpaRemoteFailure(error) {
  return error?.code === "YINGDAO_RPA_FAILED_REMOTE";
}

function hasStableRemoteIdentity(value) {
  return value && typeof value === "object" &&
    (typeof value.remote_id === "string" && value.remote_id.length > 0 ||
      typeof value.remote_url === "string" && value.remote_url.length > 0);
}

function isListDeltaEvidence(value) {
  return value && typeof value === "object" &&
    (value.evidence_source === "list_delta" ||
      Array.isArray(value.before_work_keys) ||
      Array.isArray(value.after_work_keys) ||
      Array.isArray(value.post_observation));
}

function isTrustedSubmissionEvidence(value) {
  return value && typeof value === "object" &&
    value.evidence_source === "direct_submission" &&
    hasStableRemoteIdentity(value) &&
    !isListDeltaEvidence(value);
}

function isSubmittedEvidence(value) {
  return value && typeof value === "object" && value.status !== "ambiguous" &&
    isTrustedSubmissionEvidence(value.remoteEvidence);
}

const SIDE_EFFECTING_STATUSES = new Set([
  "confirmed",
  "generating_asset",
  "asset_confirmed",
  "submitted",
  "download_pending",
  "interrupted_unknown"
]);
const RESOLVED_GENERATION_FIELDS = [
  "resolved_person_image_path",
  "resolved_person_source",
  "resolved_script_mode"
];

class ExecutorSafetyError extends Error {
  constructor(cause) {
    super(cause.message, { cause });
    this.name = "ExecutorSafetyError";
  }
}

function snapshotOptions(config, paths, confirmedAt, persistedSnapshot) {
  const execution = config.executionSnapshot ?? config.execution ?? {};
  const persistedEstimate = persistedSnapshot?.estimate ?? {};
  return {
    ...execution,
    version: execution.version ?? persistedEstimate.version,
    assetPointsPerItem: execution.assetPointsPerItem ?? persistedEstimate.assetPointsPerItem,
    videoPointsEstimate: execution.videoPointsEstimate ?? persistedEstimate.videoPointsEstimate,
    projectRoot: paths?.projectRoot ?? execution.projectRoot,
    confirmedAt: persistedSnapshot?.confirmedAt ?? execution.confirmedAt ?? confirmedAt
  };
}

function preserveResolvedGenerationFields(currentTask, nextTask) {
  const preserved = { ...nextTask };
  for (const field of RESOLVED_GENERATION_FIELDS) {
    if (preserved[field] === undefined && currentTask[field] !== undefined) {
      preserved[field] = currentTask[field];
    }
  }
  return preserved;
}

async function assertExecutionSnapshot(batch, config, paths) {
  const missingKey = batch.items.some((item) =>
    SIDE_EFFECTING_STATUSES.has(item.status) && (typeof item.execution_key !== "string" || item.execution_key.length === 0)
  );
  if (missingKey) throw new Error("Execution key is required for side-effecting task status");

  const executionBound = batch.items.filter((item) => typeof item.execution_key === "string" && item.execution_key.length > 0);
  if (executionBound.length === 0) return;

  const snapshot = await createExecutionSnapshot(
    executionBound,
    snapshotOptions(config, paths, executionBound[0].confirmed_at, batch.execution_snapshot)
  );
  const persistedKey = batch.execution_snapshot?.executionKey;
  if (persistedKey && persistedKey !== snapshot.executionKey ||
    executionBound.some((item) => item.execution_key !== snapshot.executionKey)) {
    throw new Error("Execution key does not match the current snapshot");
  }
}

function checkpointEvidence(task) {
  return task.remote_evidence ?? task.submit_checkpoint?.evidence ?? {};
}

function stableReconciliationEvidence(task, candidate) {
  const known = checkpointEvidence(task);
  if (!isTrustedSubmissionEvidence(known) || !hasStableRemoteIdentity(candidate)) return null;
  if (known.remote_id && candidate?.remote_id && known.remote_id !== candidate.remote_id) return null;
  if (known.remote_url && candidate?.remote_url && known.remote_url !== candidate.remote_url) return null;

  const remoteEvidence = {
    ...known,
    ...candidate,
    remote_id: candidate?.remote_id ?? known.remote_id ?? null,
    remote_url: candidate?.remote_url ?? known.remote_url ?? null
  };
  return isTrustedSubmissionEvidence(remoteEvidence) ? remoteEvidence : null;
}

export async function runBatch({
  batchId,
  items,
  config = {},
  paths = {},
  signal,
  onEvent,
  executor,
  store,
  lock
}) {
  if (typeof batchId !== "string" || batchId.length === 0) throw new TypeError("batchId is required");
  if (!store || typeof store.read !== "function" || typeof store.update !== "function") {
    throw new TypeError("store.read and store.update are required");
  }
  assertExecutorAdapter(executor);
  await assertExecutionLockOwnership(lock, { batchId });

  let batch;
  try {
    batch = await store.read(batchId);
  } catch (error) {
    if (error?.code !== "ENOENT" || typeof store.create !== "function") throw error;
    batch = await store.create({ batch_id: batchId, items: structuredClone(items ?? []) });
  }
  if (!Array.isArray(batch.items) || batch.items.length === 0) throw new Error("At least one batch item is required");

  const startedAt = now();
  const instanceId = randomUUID();

  function emit(task, type, phase, evidence) {
    return emitExecutionEvent(onEvent, {
      type,
      batchId,
      taskId: task.task_id,
      executionKey: task.execution_key ?? "unconfirmed",
      phase,
      timestamp: now(),
      ...(evidence === undefined ? {} : { evidence })
    });
  }

  async function updateTask(taskId, updater) {
    batch = await store.update(batchId, (current) => {
      const currentTask = findTask(current, taskId);
      const nextTask = preserveResolvedGenerationFields(currentTask, updater(currentTask));
      const nextItems = current.items.map((item) => item.task_id === taskId ? nextTask : item);
      return { ...current, items: nextItems, status: summarizeBatch(nextItems) };
    });
    return findTask(batch, taskId);
  }

  async function transition(task, event, phase) {
    const next = await updateTask(task.task_id, (current) => transitionTask(current, event));
    emit(next, "task.phase_changed", phase, { status: next.status });
    return next;
  }  async function annotate(task, changes, phase) {
    const next = await updateTask(task.task_id, (current) => ({ ...current, ...changes }));
    emit(next, "task.checkpoint_persisted", phase, changes);
    return next;
  }

  function contextFor(task, phase) {
    return {
      batchId,
      taskId: task.task_id,
      projectRoot: paths.projectRoot,
      executionKey: task.execution_key,
      batchOptions: config.execution?.batchOptions,
      instanceId,
      signal,
      emit: ({ type, phase: eventPhase, evidence }) => emit(task, type, eventPhase ?? phase, evidence),
      checkpoint: async ({ phase: checkpointPhase, evidence }) => annotate(task, {
        submit_checkpoint: {
          phase: checkpointPhase,
          observed_at: now(),
          evidence
        }
      }, checkpointPhase)
    };
  }

  async function invoke(task, method, args, phase) {
    try {
      await assertExecutionLockOwnership(lock, { batchId });
      const current = await store.read(batchId);
      await assertExecutionSnapshot(current, config, paths);
      const currentTask = findTask(current, task.task_id);
      if (currentTask.execution_key !== task.execution_key) {
        throw new Error("Execution key does not match the current task");
      }
    } catch (error) {
      throw new ExecutorSafetyError(error);
    }
    emit(task, "executor.call_started", phase);
    const result = await executor[method](...args, contextFor(task, phase));
    emit(task, "executor.call_finished", phase, result);
    return result;
  }

  async function pauseOrFailPreSubmit(task, error, phase) {
    if (error?.outcome === "requires_action") {
      const changes = {
        paused_auth: true,
        requires_action: true,
        requires_action_reason: error.code || "EXECUTION_REQUIRES_ACTION",
        contract_evidence: Array.isArray(error.evidence) ? sanitizeEvidenceRecords(error.evidence) : undefined,
        error_message: error.code || error.message,
        error_phase: error.failureStage || phase
      };
      // A post-handheld verifier has already consumed Stage 1 and has a
      // terminal evidence decision. Keep it precise and non-retryable rather
      // than leaving a generating_asset row for recovery to reinterpret as an
      // unknown submission.
      if (error.failureStage === "post_handheld_pre_video" && Array.isArray(error.evidence)) {
        return transition(task, {
          type: "FAIL_PRE_SUBMIT",
          changes: {
            ...changes,
            execution_key: null,
            confirmed_at: null,
            retryability: "not_retryable"
          }
        }, phase);
      }
      return annotate(task, changes, phase);
    }
    if (isPause(error)) {
      return annotate(task, { paused_auth: true, error_message: error.message }, phase);
    }
    if (isRecoverableRpaInterruption(error)) {
      return interruptUnknown(task, error, phase);
    }
    if (isRpaRemoteFailure(error)) {
      return transition(task, {
        type: "FAIL_REMOTE",
        changes: { error_message: error.message, error_phase: phase }
      }, phase);
    }
    return transition(task, {
      type: "FAIL_PRE_SUBMIT",
      changes: { error_message: error.message, error_phase: phase }
    }, phase);
  }

  // INTERRUPT_UNKNOWN provenance (CI-002): classify how the interrupt arose so a
  // test/CI collector can attribute an interrupted_unknown to a concrete source
  // without recording any sensitive evidence (no cookies/tokens/paths/evidence).
  function classifyInterruptSource(error, phase) {
    if (phase === "recovery") return "recovery";
    if (error?.code === "YINGDAO_RPA_TIMEOUT") return "executor_timeout";
    if (error?.code === "YINGDAO_RPA_INTERRUPTED_UNKNOWN") return "executor_interrupted_unknown";
    if (phase === "remote_query" || phase === "remote_reconcile") return "reconcile_ambiguous";
    return "explicit";
  }

  async function interruptUnknown(task, error, phase, changes = {}) {
    const provenance = {
      // executionId is not threaded into runBatch; the executionKey is the
      // persisted, non-sensitive identity of the execution that wrote this state.
      transitionSource: classifyInterruptSource(error, phase),
      errorCode: error?.code ?? null
    };
    if (task.status === "interrupted_unknown") {
      emit(task, "task.transition_provenance", phase, {
        status: "interrupted_unknown",
        previousStatus: task.status,
        eventType: "INTERRUPT_UNKNOWN",
        ...provenance
      });
      return annotate(task, {
        ...changes,
        error_message: error?.message ?? task.error_message,
        error_phase: phase
      }, phase);
    }
    // Terminal guard: INTERRUPT_UNKNOWN has no valid out-edge from a terminal or
    // pre-execution status. Refuse to overwrite such a task so a stale writer
    // (one holding an outdated active snapshot) cannot clobber a terminal state.
    if (!TASK_TRANSITIONS[task.status]?.INTERRUPT_UNKNOWN) {
      emit(task, "task.transition_rejected", phase, {
        status: task.status,
        previousStatus: task.status,
        eventType: "INTERRUPT_UNKNOWN",
        reason: "no_out_edge",
        ...provenance
      });
      return task;
    }
    const previousStatus = task.status;
    const next = await transition(task, {
      type: "INTERRUPT_UNKNOWN",
      changes: {
        ...changes,
        error_message: error?.message ?? "Remote submission state is unknown",
        error_phase: phase
      }
    }, phase);
    emit(next, "task.transition_provenance", phase, {
      status: "interrupted_unknown",
      previousStatus,
      eventType: "INTERRUPT_UNKNOWN",
      ...provenance
    });
    return next;
  }

  async function download(task) {
    try {
      const artifact = await invoke(task, "downloadArtifact", [task.remote_evidence, paths.downloadDir], "download");
      if (!artifact?.artifact_id || !artifact?.relative_path) throw new Error("downloadArtifact returned no artifact reference");
      if (typeof store.registerArtifact === "function") {
        try {
          await store.registerArtifact(batchId, artifact);
        } catch (error) {
          if (!/already exists/i.test(error.message)) throw error;
        }
      }
      return transition(task, {
        type: "COMPLETE",
        changes: { output_path: artifact.relative_path, error_message: null }
      }, "download");
    } catch (error) {
      if (error instanceof ExecutorSafetyError) throw error;
      if (isRecoverableRpaInterruption(error)) return interruptUnknown(task, error, "download");
      if (isRpaRemoteFailure(error)) {
        return transition(task, {
          type: "FAIL_REMOTE",
          changes: { error_message: error.message, error_phase: "download" }
        }, "download");
      }
      return annotate(task, { error_message: error.message, error_phase: "download" }, "download");
    }
  }

  async function advanceSubmitted(task) {
    if ((task.status === "submitted" || task.status === "download_pending") && !isTrustedSubmissionEvidence(task.remote_evidence)) {
      return interruptUnknown(task, new Error("Explicit direct submission evidence is required"), "remote_evidence");
    }
    if (task.status === "submitted") {
      let result;
      try {
        result = await invoke(task, "querySubmission", [task.remote_evidence], "remote_query");
      } catch (error) {
        if (error instanceof ExecutorSafetyError) throw error;
        return interruptUnknown(task, error, "remote_query");
      }
      if (result?.status === "failed") {
        return transition(task, { type: "FAIL_REMOTE", changes: { error_message: "Remote generation failed" } }, "remote_query");
      }
      if (result?.status === "ambiguous" || result?.status === "unknown") {
        return interruptUnknown(task, new Error("Remote submission could not be uniquely identified"), "remote_query");
      }
      if (result?.status !== "ready") return task;
      task = await transition(task, { type: "MARK_DOWNLOAD_PENDING" }, "remote_ready");
    }
    if (task.status === "download_pending") return download(task);
    return task;
  }

  async function submitKnownAsset(task, asset) {
    let result;
    try {
      result = await invoke(task, "submitVideo", [task, asset], "remote_submit");
    } catch (error) {
      if (error instanceof ExecutorSafetyError) throw error;
      return interruptUnknown(task, error, "remote_submit");
    }
    if (result?.status === "failed") {
      task = await transition(task, {
        type: "MARK_SUBMITTED",
        changes: { submitted_at: now(), paused_auth: false }
      }, "remote_submit");
      return transition(task, {
        type: "FAIL_REMOTE",
        changes: { error_message: result.error?.message ?? "Remote generation failed" }
      }, "remote_submit");
    }
    if (!isSubmittedEvidence(result)) {
      return interruptUnknown(task, new Error("Remote submission did not produce unique evidence"), "remote_submit", {
        remote_candidates: result?.candidates ?? []
      });
    }
    task = await transition(task, {
      type: "MARK_SUBMITTED",
      changes: { remote_evidence: result.remoteEvidence, submitted_at: now(), paused_auth: false }
    }, "remote_submit");
    return advanceSubmitted(task);
  }

  async function executeConfirmed(task) {
    if (signal?.aborted) return transition(task, { type: "STOP_SAFE" }, "safe_stop");
    task = await transition(task, { type: "START_ASSET" }, "asset_generation");
    let asset;
    try {
      asset = await invoke(task, "createAsset", [task], "asset_generation");
    } catch (error) {
      if (error instanceof ExecutorSafetyError) throw error;
      return pauseOrFailPreSubmit(task, error, "asset_generation");
    }
    task = await transition(task, {
      type: "CONFIRM_ASSET",
      changes: { asset_evidence: asset, paused_auth: false }
    }, "asset_confirmation");
    if (signal?.aborted) return transition(task, { type: "STOP_SAFE" }, "safe_stop");
    return submitKnownAsset(task, asset);
  }

  async function reconcile(task) {
    let result;
    try {
      result = await invoke(task, "reconcileSubmission", [task, task], "remote_reconcile");
    } catch (error) {
      if (error instanceof ExecutorSafetyError) throw error;
      return annotate(task, { error_message: error.message, error_phase: "remote_reconcile" }, "remote_reconcile");
    }
    const candidates = Array.isArray(result?.candidates) ? result.candidates : [];
    const remoteEvidence = candidates.length === 1 ? stableReconciliationEvidence(task, candidates[0]) : null;
    if (!remoteEvidence) {
      return annotate(task, { remote_candidates: candidates, error_message: "Remote submission remains ambiguous" }, "remote_reconcile");
    }
    task = await transition(task, {
      type: "RECONCILE_SUBMITTED",
      changes: { remote_evidence: remoteEvidence, remote_candidates: undefined, error_message: null }
    }, "remote_reconcile");
    return advanceSubmitted(task);
  }

  await assertExecutionSnapshot(batch, config, paths);

  const interruptedDuringRecovery = new Set();
  for (const task of [...batch.items]) {
    if (task.status === "generating_asset" || task.status === "asset_confirmed") {
      await interruptUnknown(task, new Error("Execution stopped before remote submission could be confirmed"), "recovery");
      interruptedDuringRecovery.add(task.task_id);
    }
  }

  for (const original of [...batch.items]) {
    let task = findTask(batch, original.task_id);
    if (task.status === "confirmed") await executeConfirmed(task);
    else if (task.status === "interrupted_unknown" && !interruptedDuringRecovery.has(task.task_id)) await reconcile(task);
    else if (task.status === "submitted" || task.status === "download_pending") await advanceSubmitted(task);
  }

  batch = await store.read(batchId);
  return { status: summarizeBatch(batch.items), items: batch.items, startedAt, finishedAt: now() };
}
