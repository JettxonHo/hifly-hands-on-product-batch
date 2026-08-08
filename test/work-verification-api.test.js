import assert from "node:assert/strict";
import test from "node:test";

import { activateAdmin, identityApp, identityHeaders } from "./helpers/identity-world.js";

function serviceDouble() {
  const calls = [];
  const job = { id: "job-api", organization_id: "org_test", production_order_id: "order-api", verification_status: "queued", status: "queued" };
  const service = {
    calls,
    async getVerificationWorkspace(input) {
      return { order: { id: input.productionOrderId, organization_id: input.organizationId, status: "running", input_snapshot: { secret: "server-only" } }, job, work: null, works: [] };
    },
    async requestVerification(input) {
      calls.push(input);
      return { job: { ...job }, work: null, replayed: false };
    },
    async getVerificationJob() { return { ...job }; },
    async retryVerification() { return { job: { ...job, verification_status: "queued" }, replayed: false }; },
    async recoverVerification() { return { job: { ...job, verification_status: "queued" }, replayed: false }; }
  };
  return service;
}

test("artifact verification API is disabled by default and exposes only server-resolved input", async (t) => {
  const disabled = await identityApp(t);
  const disabledAuth = await activateAdmin(disabled.app);
  const disabledRuntime = await disabled.app.inject({ method: "GET", url: "/api/runtime", headers: identityHeaders({ cookies: disabledAuth.cookies }) });
  assert.equal(disabledRuntime.statusCode, 200);
  assert.equal(disabledRuntime.json().artifactVerificationEnabled, false);
  assert.equal((await disabled.app.inject({ method: "GET", url: "/api/production-orders/order-api/work-verification", headers: identityHeaders({ cookies: disabledAuth.cookies }) })).statusCode, 404);

  const service = serviceDouble();
  const enabled = await identityApp(t, { artifactVerification: {
    enabled: true, service, workerInstance: { start() {}, stop() {} }
  } });
  const auth = await activateAdmin(enabled.app);
  const read = identityHeaders({ cookies: auth.cookies });
  const mutation = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  assert.equal((await enabled.app.inject({ method: "GET", url: "/api/runtime", headers: read })).json().artifactVerificationEnabled, true);

  const workspace = await enabled.app.inject({ method: "GET", url: "/api/production-orders/order-api/work-verification", headers: read });
  assert.equal(workspace.statusCode, 200);
  assert.equal("input_snapshot" in workspace.json().order, false);
  const requested = await enabled.app.inject({ method: "POST", url: "/api/production-orders/order-api/work-verification",
    headers: { ...mutation, "idempotency-key": "api-verify" },
    payload: { execution_attempt_id: "attempt-api", report_id: "report-api", candidate_id: "candidate-api",
      video_plan_version_id: "client-plan-must-be-ignored", primary_output_checksum: "client-checksum-must-be-ignored" } });
  assert.equal(requested.statusCode, 202);
  assert.deepEqual(service.calls[0], {
    organizationId: "org_test", actorMemberId: auth.body.member.id, actorRole: "admin", productionOrderId: "order-api",
    executionAttemptId: "attempt-api", reportId: "report-api", candidateId: "candidate-api", idempotencyKey: "api-verify"
  });
  const job = await enabled.app.inject({ method: "GET", url: "/api/work-verification-jobs/job-api", headers: read });
  assert.equal(job.statusCode, 200);
  assert.equal(job.json().job.id, "job-api");
});
