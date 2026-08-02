import test from "node:test";
import assert from "node:assert/strict";

import {
  createInitialCaptureState,
  publicCaptureState,
  updateCaptureState
} from "../src/rpa/capture/workflow-state.js";

test("capture state is disabled by default", () => {
  assert.deepEqual(createInitialCaptureState({}), { enabled: false, status: "disabled" });
});

test("enabled capture state starts as not_started", () => {
  const state = createInitialCaptureState({ enabled: true });

  assert.equal(state.enabled, true);
  assert.equal(state.status, "not_started");
  assert.match(state.updated_at, /^\d{4}-\d{2}-\d{2}T/);
});

test("public capture state hides raw har paths", () => {
  const state = updateCaptureState(createInitialCaptureState({ enabled: true }), {
    status: "recorded",
    har_path: "/Users/ketchup/private.har",
    raw_steps_path: "batches/b1/capture/raw-steps.json"
  });

  assert.equal(publicCaptureState(state).har_path, "[local raw capture]");
  assert.equal(publicCaptureState(state).raw_steps_path, "batches/b1/capture/raw-steps.json");
});

test("public capture state exposes only safe project-relative capture paths", () => {
  const publicState = publicCaptureState({
    enabled: true,
    status: "redacted",
    raw_steps_path: "/Users/ketchup/raw-steps.json",
    manifest_path: "C:\\Users\\ketchup\\manifest.json",
    report_path: "batches/../capture/report.json"
  });

  for (const key of ["raw_steps_path", "manifest_path", "report_path"]) {
    assert.equal(key in publicState, false);
  }
});

test("public capture state exposes only safe queue summary fields", () => {
  const publicState = publicCaptureState({
    enabled: true,
    status: "dry_run_passed",
    queue: {
      mode: "fake",
      status: "failed",
      total: 3,
      completed: 1,
      failed: 1,
      current_task_id: "task-2",
      started_at: "2026-07-19T00:00:00.000Z",
      updated_at: "2026-07-19T00:01:00.000Z",
      last_error: {
        code: "CAPTURE_HTTP_AUTH_REQUIRED",
        message: "/Users/ketchup/private token=secret"
      },
      request_plan: [{ headers: { cookie: "secret" } }],
      manifest_path: "/Users/ketchup/private/manifest.json"
    }
  });

  assert.deepEqual(publicState.queue, {
    mode: "fake",
    status: "failed",
    total: 3,
    completed: 1,
    failed: 1,
    current_task_id: "task-2",
    started_at: "2026-07-19T00:00:00.000Z",
    updated_at: "2026-07-19T00:01:00.000Z",
    last_error: {
      code: "CAPTURE_HTTP_AUTH_REQUIRED",
      message: "Unable to complete the capture HTTP queue."
    }
  });
  assert.equal(JSON.stringify(publicState).includes("secret"), false);
  assert.equal(JSON.stringify(publicState).includes("/Users/ketchup"), false);
  assert.equal(JSON.stringify(publicState).includes("request_plan"), false);
});

test("invalid capture status is rejected", () => {
  assert.throws(
    () => updateCaptureState(createInitialCaptureState({ enabled: true }), { status: "surprise" }),
    /Invalid capture status/
  );
});

test("recording terminal states are accepted as valid capture statuses", () => {
  for (const status of ["recording_interrupted", "recording_failed"]) {
    const state = updateCaptureState(createInitialCaptureState({ enabled: true }), { status });
    assert.equal(state.status, status);
    assert.equal(publicCaptureState(state).status, status);
  }
});

test("public recording error exposes only the safe code, never sensitive detail", () => {
  const interrupted = publicCaptureState({
    enabled: true,
    status: "recording_interrupted",
    recording_error: { code: "CAPTURE_RECORDING_INTERRUPTED", message: "cookie=secret /Users/ketchup/x.har" }
  });
  assert.deepEqual(interrupted.recording_error, {
    code: "CAPTURE_RECORDING_INTERRUPTED",
    message: "Capture recording was interrupted before the execution completed."
  });

  const failed = publicCaptureState({
    enabled: true,
    status: "recording_failed",
    recording_error: { code: "CAPTURE_HAR_FLUSH_FAILED", message: "open /Users/ketchup/private.har: EPERM token=abc" }
  });
  assert.deepEqual(failed.recording_error, {
    code: "CAPTURE_HAR_FLUSH_FAILED",
    message: "Unable to complete the capture HAR flush."
  });

  // An unknown/unsafe code is normalised to the generic flush-failure code.
  const unknown = publicCaptureState({
    enabled: true,
    status: "recording_failed",
    recording_error: { code: "ENOENT", message: "/Users/ketchup/private.har" }
  });
  assert.equal(unknown.recording_error.code, "CAPTURE_HAR_FLUSH_FAILED");
  assert.equal(JSON.stringify(unknown).includes("/Users/ketchup"), false);
  assert.equal(JSON.stringify(unknown).includes("cookie"), false);
  assert.equal(JSON.stringify(unknown).includes("token"), false);
});
