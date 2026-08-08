import assert from "node:assert/strict";
import test from "node:test";

import { createWorkVerificationWorker } from "../src/work-verification/work-verification-worker.js";

test("work verification worker polls and reports worker errors without losing the loop", async () => {
  const calls = [];
  const errors = [];
  let next = 0;
  const service = {
    async runNextVerificationJob(input) {
      calls.push(input);
      next += 1;
      if (next === 1) throw Object.assign(new Error("temporary"), { code: "TEMPORARY" });
      return { job: { id: `job-${next}` } };
    },
    async heartbeatVerificationJob() {}
  };
  const worker = createWorkVerificationWorker({ service, pollIntervalMs: 2, leaseMs: 90, heartbeatIntervalMs: 17, onError: (error) => errors.push(error.code) });
  worker.start();
  await new Promise((resolve) => setTimeout(resolve, 15));
  worker.stop();
  assert.ok(calls.length >= 2);
  assert.ok(calls.every((input) => input.leaseMs === 90));
  assert.ok(calls.every((input) => input.heartbeatIntervalMs === 17));
  assert.deepEqual(errors, ["TEMPORARY"]);
  worker.stop();
});
