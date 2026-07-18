import test from "node:test";
import assert from "node:assert/strict";

import { summarizeBatch, transitionTask } from "../src/core/state-machine.js";

test("confirmed tasks follow the normal execution path", () => {
  let task = { task_id: "task-1", status: "confirmed", execution_key: "key-1" };

  for (const [type, status] of [
    ["START_ASSET", "generating_asset"],
    ["CONFIRM_ASSET", "asset_confirmed"],
    ["MARK_SUBMITTED", "submitted"],
    ["MARK_DOWNLOAD_PENDING", "download_pending"],
    ["COMPLETE", "completed"]
  ]) {
    task = transitionTask(task, { type });
    assert.equal(task.status, status);
  }
});

test("editing a confirmed task invalidates confirmation", () => {
  const next = transitionTask(
    { status: "confirmed", execution_key: "key-1", confirmed_at: "2026-07-11T00:00:00.000Z" },
    { type: "EDIT", changes: { product_name: "Updated" } }
  );

  assert.equal(next.status, "pending");
  assert.equal(next.execution_key, null);
  assert.equal(next.confirmed_at, null);
  assert.equal(next.product_name, "Updated");
});

test("interrupted unknown tasks cannot retry generation", () => {
  assert.throws(
    () => transitionTask({ status: "interrupted_unknown" }, { type: "RETRY_GENERATION" }),
    /not allowed/i
  );
});

test("interrupted unknown tasks can be force reset after explicit operator confirmation", () => {
  const next = transitionTask(
    {
      status: "interrupted_unknown",
      execution_key: "old-key",
      confirmed_at: "2026-07-14T00:00:00.000Z",
      error_message: "unknown remote result"
    },
    { type: "FORCE_RETRY_GENERATION", changes: { error_message: null } }
  );

  assert.equal(next.status, "pending");
  assert.equal(next.execution_key, null);
  assert.equal(next.confirmed_at, null);
  assert.equal(next.error_message, null);
});

test("remote reconciliation is required before an unknown task can retry", () => {
  const reconciled = transitionTask(
    { status: "interrupted_unknown", execution_key: "old-key" },
    { type: "RECONCILE_REMOTE_ABSENT" }
  );
  assert.equal(reconciled.status, "failed_pre_submit");

  const pending = transitionTask(reconciled, { type: "RETRY_GENERATION" });
  assert.equal(pending.status, "pending");
  assert.equal(pending.execution_key, null);
});

test("batch summary follows the documented priority", () => {
  const cases = [
    [[{ status: "completed" }, { status: "interrupted_unknown" }], "interrupted_unknown"],
    [[{ status: "failed_remote" }, { status: "submitted" }], "active"],
    [[{ status: "failed_remote" }, { status: "pending", paused_auth: true }], "paused_auth"],
    [[{ status: "completed" }, { status: "failed_pre_submit" }], "failed"],
    [[{ status: "completed" }, { status: "needs_input" }], "needs_input"],
    [[{ status: "completed" }, { status: "confirmed" }], "pending"],
    [[{ status: "completed" }, { status: "completed" }], "completed"]
  ];

  for (const [items, expected] of cases) {
    assert.equal(summarizeBatch(items), expected);
  }
});

test("invalid state transitions fail closed", () => {
  assert.throws(
    () => transitionTask({ status: "completed" }, { type: "START_ASSET" }),
    /not allowed/i
  );
});
