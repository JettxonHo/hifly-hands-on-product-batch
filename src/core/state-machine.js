const TRANSITIONS = Object.freeze({
  needs_input: { VALIDATION_FAILED: "validation_failed", VALIDATE: "pending" },
  validation_failed: { VALIDATION_FAILED: "validation_failed", VALIDATE: "pending" },
  pending: { CONFIRM: "confirmed", EDIT: "pending" },
  confirmed: { START_ASSET: "generating_asset", EDIT: "pending", STOP_SAFE: "pending" },
  generating_asset: {
    CONFIRM_ASSET: "asset_confirmed",
    FAIL_PRE_SUBMIT: "failed_pre_submit",
    INTERRUPT_UNKNOWN: "interrupted_unknown",
    STOP_SAFE: "pending"
  },
  asset_confirmed: {
    MARK_SUBMITTED: "submitted",
    FAIL_PRE_SUBMIT: "failed_pre_submit",
    INTERRUPT_UNKNOWN: "interrupted_unknown",
    STOP_SAFE: "pending"
  },
  submitted: {
    MARK_DOWNLOAD_PENDING: "download_pending",
    FAIL_REMOTE: "failed_remote",
    INTERRUPT_UNKNOWN: "interrupted_unknown"
  },
  download_pending: {
    COMPLETE: "completed",
    FAIL_REMOTE: "failed_remote",
    INTERRUPT_UNKNOWN: "interrupted_unknown"
  },
  completed: {},
  failed_pre_submit: { RETRY_GENERATION: "pending", EDIT: "pending" },
  failed_remote: { RETRY_GENERATION: "pending", EDIT: "pending" },
  interrupted_unknown: {
    RECONCILE_REMOTE_ABSENT: "failed_pre_submit",
    RECONCILE_SUBMITTED: "submitted",
    RECONCILE_DOWNLOAD_PENDING: "download_pending"
  }
});

const INVALIDATES_CONFIRMATION = new Set([
  "EDIT",
  "RETRY_GENERATION",
  "STOP_SAFE",
  "VALIDATE",
  "VALIDATION_FAILED",
  "RECONCILE_REMOTE_ABSENT"
]);

const ACTIVE = new Set([
  "generating_asset",
  "asset_confirmed",
  "submitted",
  "download_pending"
]);
const FAILED = new Set(["failed_pre_submit", "failed_remote", "validation_failed"]);
const NEEDS_INPUT = new Set(["needs_input"]);
const PENDING = new Set(["pending", "confirmed"]);

export function transitionTask(task, event) {
  if (!task || typeof task !== "object") throw new TypeError("task is required");
  if (!event || typeof event.type !== "string") throw new TypeError("event.type is required");

  const nextStatus = TRANSITIONS[task.status]?.[event.type];
  if (!nextStatus) {
    throw new Error(`Event ${event.type} is not allowed from status ${task.status}`);
  }

  const next = {
    ...task,
    ...(event.changes ?? {}),
    status: nextStatus
  };

  if (INVALIDATES_CONFIRMATION.has(event.type)) {
    next.execution_key = null;
    next.confirmed_at = null;
  }
  if (event.type === "CONFIRM") {
    if (!event.executionKey) throw new Error("CONFIRM requires executionKey");
    next.execution_key = event.executionKey;
    next.confirmed_at = event.confirmedAt ?? new Date().toISOString();
  }

  return next;
}

export function summarizeBatch(items) {
  if (!Array.isArray(items) || items.length === 0) return "empty";
  if (items.some((item) => item.status === "interrupted_unknown")) return "interrupted_unknown";
  if (items.some((item) => ACTIVE.has(item.status))) return "active";
  if (items.some((item) => item.paused_auth === true)) return "paused_auth";
  if (items.some((item) => FAILED.has(item.status))) return "failed";
  if (items.some((item) => NEEDS_INPUT.has(item.status))) return "needs_input";
  if (items.some((item) => PENDING.has(item.status))) return "pending";
  if (items.every((item) => item.status === "completed")) return "completed";
  return "unknown";
}

export const TASK_TRANSITIONS = TRANSITIONS;
