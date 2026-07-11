import test from "node:test";
import assert from "node:assert/strict";
import {
  EXECUTION_EVENT_FIELDS,
  EXECUTOR_METHODS,
  assertExecutorAdapter,
  emitExecutionEvent
} from "../src/core/executor-adapter.js";

function validAdapter() {
  return Object.fromEntries(EXECUTOR_METHODS.map((method) => [method, async () => {}]));
}

test("adapter requires every recovery method", () => {
  assert.throws(
    () => assertExecutorAdapter({ createAsset() {} }),
    /submitVideo/
  );
});

test("adapter rejects non-function methods and returns a valid adapter", () => {
  const adapter = validAdapter();
  assert.equal(assertExecutorAdapter(adapter), adapter);

  adapter.querySubmission = true;
  assert.throws(() => assertExecutorAdapter(adapter), /querySubmission/);
});

test("execution events require every standard field", () => {
  const event = {
    type: "task.phase_changed",
    batchId: "batch-1",
    taskId: "task-1",
    executionKey: "exec-1",
    phase: "asset_generation",
    timestamp: "2026-07-11T00:00:00.000Z"
  };
  const received = [];

  assert.equal(emitExecutionEvent((value) => received.push(value), event), event);
  assert.deepEqual(received, [event]);

  for (const field of EXECUTION_EVENT_FIELDS) {
    const invalid = { ...event };
    delete invalid[field];
    assert.throws(() => emitExecutionEvent(() => {}, invalid), new RegExp(field));
  }
});

test("execution event callback is optional but must be callable when provided", () => {
  const event = {
    type: "task.phase_changed",
    batchId: "batch-1",
    taskId: "task-1",
    executionKey: "exec-1",
    phase: "download",
    timestamp: "2026-07-11T00:00:00.000Z"
  };

  assert.equal(emitExecutionEvent(undefined, event), event);
  assert.throws(() => emitExecutionEvent("not-a-function", event), /onEvent/);
});
