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

test("invalid capture status is rejected", () => {
  assert.throws(
    () => updateCaptureState(createInitialCaptureState({ enabled: true }), { status: "surprise" }),
    /Invalid capture status/
  );
});
