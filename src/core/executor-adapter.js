export const EXECUTOR_METHODS = Object.freeze([
  "createAsset",
  "submitVideo",
  "querySubmission",
  "downloadArtifact",
  "reconcileSubmission"
]);

export const EXECUTION_EVENT_FIELDS = Object.freeze([
  "type",
  "batchId",
  "taskId",
  "executionKey",
  "phase",
  "timestamp"
]);

export function assertExecutorAdapter(adapter) {
  if (!adapter || typeof adapter !== "object") {
    throw new TypeError("executor adapter must be an object");
  }

  for (const method of EXECUTOR_METHODS) {
    if (typeof adapter[method] !== "function") {
      throw new TypeError(`executor adapter requires function "${method}"`);
    }
  }

  return adapter;
}

export function emitExecutionEvent(onEvent, event) {
  if (!event || typeof event !== "object") {
    throw new TypeError("execution event must be an object");
  }

  for (const field of EXECUTION_EVENT_FIELDS) {
    if (event[field] === undefined || event[field] === null || event[field] === "") {
      throw new TypeError(`execution event requires "${field}"`);
    }
  }

  if (onEvent !== undefined && typeof onEvent !== "function") {
    throw new TypeError("onEvent must be a function");
  }

  onEvent?.(event);
  return event;
}
