import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createMemoryManualExecutionRepository } from "../src/manual-execution/memory-manual-execution-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createMemoryManualHandoffPackageStore } from "../src/manual-handoff/manual-handoff-package-store.js";
import { createMemoryManualHandoffRepository } from "../src/manual-handoff/memory-manual-handoff-repository.js";
import { createMemoryProductionOrderRepository } from "../src/production-orders/memory-production-order-repository.js";
import { activateAdmin, identityApp, identityHeaders } from "./helpers/identity-world.js";

function options({ maxCandidateBytes = 256 * 1024 * 1024 } = {}) {
  const productionRepository = createMemoryProductionOrderRepository();
  const packageRecord = { id: "package-api", organization_id: "org_test", production_order_id: null, package_version: 1,
    status: "ready", manifest_hash: "manifest-api", package_hash: "package-api", manifest: { accepted_media_types: ["video/mp4"] } };
  return {
    packageRecord,
    videoPlanning: { enabled: true, repository: { async initialize() {}, async close() {} }, worker: { autoStart: false },
      upstreamPort: { async resolveCurrent() { return null; } }, capabilitySnapshotPort: { async resolve() { return null; } },
      agentReadinessPort: { async isOnline() { return false; } } },
    productionOrders: { enabled: true, repository: productionRepository,
      planPort: { async resolveCurrentApprovedPlan({ organizationId, productId }) { return { current_valid: true,
        plan: { id: "plan-api", organization_id: organizationId, product_id: productId, status: "frozen", upstream_snapshot: {}, capability_config_snapshot: {}, output_instructions: "视频" },
        plan_review: { status: "approved" }, preflight_result: { status: "warning" } }; } },
      inputSnapshotPort: { async freezeForOrder() { return { approved_copy_snapshot: {}, product_revision_snapshot: {}, asset_references: [], avatar_selection_snapshot: {} }; } },
      agentReadinessPort: { async isOnline() { return false; } } },
    productionRepository,
    manualHandoff: { enabled: true, repository: createMemoryManualHandoffRepository(), packageStore: createMemoryManualHandoffPackageStore(), worker: { autoStart: false } },
    manualExecution: { enabled: true, repository: createMemoryManualExecutionRepository(), candidateStore: createMemoryObjectStore(),
      maxCandidateBytes,
      packagePort: { async getPackage() { return structuredClone(packageRecord); },
        async listPackages() { return [structuredClone(packageRecord)]; } } }
  };
}

test("manual execution API claims, starts, uploads, and reports without completing the order", async (t) => {
  const configured = options();
  const { app } = await identityApp(t, configured);
  const auth = await activateAdmin(app);
  const read = identityHeaders({ cookies: auth.cookies });
  const mutation = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  const order = await app.productionOrders.service.createProductionOrder({ organizationId: "org_test", actorMemberId: auth.body.member.id,
    actorRole: "admin", productId: "product-api", executionPurpose: "first_production", videoPlanVersionId: "plan-api", idempotencyKey: "api-order" });
  configured.packageRecord.production_order_id = order.order.id;

  const runtime = await app.inject({ method: "GET", url: "/api/runtime", headers: read });
  assert.equal(runtime.json().manualExecutionEnabled, true);
  assert.equal(runtime.json().manualExecutionMaxCandidateBytes, 256 * 1024 * 1024);
  const initial = await app.inject({ method: "GET", url: `/api/production-orders/${order.order.id}/manual-execution`, headers: read });
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.json().current_attempt, null);
  assert.equal("organization_id" in initial.json().order, false);

  const claim = await app.inject({ method: "POST", url: `/api/production-orders/${order.order.id}/manual-execution/claim`, headers: { ...mutation, "idempotency-key": "api-claim" },
    payload: { package_id: configured.packageRecord.id } });
  assert.equal(claim.statusCode, 201);
  const attemptId = claim.json().attempt.id;
  const start = await app.inject({ method: "POST", url: `/api/manual-execution-attempts/${attemptId}/start`, headers: { ...mutation, "idempotency-key": "api-start" }, payload: {} });
  assert.equal(start.statusCode, 200);

  const body = Buffer.from("api-candidate");
  const checksum = createHash("sha256").update(body).digest("hex");
  const authorization = await app.inject({ method: "POST", url: `/api/manual-execution-attempts/${attemptId}/candidates/upload-authorizations`, headers: { ...mutation, "idempotency-key": "api-upload" },
    payload: { role: "primary_video", original_filename: "api.mp4", media_type: "video/mp4", size: body.length, checksum } });
  assert.equal(authorization.statusCode, 201);
  const candidateId = authorization.json().candidate.id;
  const uploadHeaders = { ...mutation, "content-type": "video/mp4", "x-manual-upload-token": authorization.json().upload_token };
  const incomplete = await app.inject({ method: "POST", url: `/api/manual-execution-attempts/${attemptId}/candidates/${candidateId}/complete`, headers: { ...mutation, "idempotency-key": "api-complete-before-upload" },
    payload: { upload_token: authorization.json().upload_token } });
  assert.equal(incomplete.statusCode, 422);
  assert.equal(incomplete.json().error, "MANUAL_EXECUTION_UPLOAD_NOT_COMPLETED");
  const uploaded = await app.inject({ method: "PUT", url: `/api/manual-execution-candidate-uploads/${candidateId}`, headers: uploadHeaders, payload: body });
  assert.equal(uploaded.statusCode, 200);
  const complete = await app.inject({ method: "POST", url: `/api/manual-execution-attempts/${attemptId}/candidates/${candidateId}/complete`, headers: { ...mutation, "idempotency-key": "api-complete" },
    payload: { upload_token: authorization.json().upload_token } });
  assert.equal(complete.statusCode, 200);
  const report = await app.inject({ method: "POST", url: `/api/manual-execution-attempts/${attemptId}/reports`, headers: { ...mutation, "idempotency-key": "api-report" },
    payload: { report_id: "a0000000-0000-4000-8000-000000000001", outcome: "completed", completed_at: "2026-08-08T10:03:00.000Z", primary_candidate_id: candidateId, deviations: [] } });
  assert.equal(report.statusCode, 201);
  assert.equal(report.json().attempt.status, "succeeded");
  assert.equal(report.json().report.completed_at, "2026-08-08T10:03:00.000Z");
  const reportConflict = await app.inject({ method: "POST", url: `/api/manual-execution-attempts/${attemptId}/reports`, headers: { ...mutation, "idempotency-key": "api-report" },
    payload: { report_id: "a0000000-0000-4000-8000-000000000001", outcome: "completed", completedAt: "2026-08-08T10:04:00.000Z", primary_candidate_id: candidateId, deviations: [] } });
  assert.equal(reportConflict.statusCode, 409);
  assert.equal(reportConflict.json().error, "IDEMPOTENCY_CONFLICT");
  assert.equal((await app.productionOrders.service.getOrder({ organizationId: "org_test", actorMemberId: auth.body.member.id, actorRole: "admin", orderId: order.order.id })).status, "running");
  const workspace = await app.inject({ method: "GET", url: `/api/production-orders/${order.order.id}/manual-execution`, headers: read });
  assert.equal(workspace.json().candidates[0].status, "pending_verification");
  assert.equal(workspace.json().reports[0].outcome, "completed");
});

test("manual execution routes remain absent unless explicitly enabled", async (t) => {
  const { app } = await identityApp(t);
  const auth = await activateAdmin(app);
  const response = await app.inject({ method: "GET", url: "/api/production-orders/not-an-order/manual-execution", headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(response.statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: "/api/runtime", headers: identityHeaders({ cookies: auth.cookies }) })).json().manualExecutionEnabled, false);
});

test("manual candidate route accepts a payload above the global 20 MiB limit within its explicit bound", async (t) => {
  const maxCandidateBytes = 22 * 1024 * 1024;
  const configured = options({ maxCandidateBytes });
  const { app } = await identityApp(t, configured);
  const auth = await activateAdmin(app);
  const read = identityHeaders({ cookies: auth.cookies });
  const mutation = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  const order = await app.productionOrders.service.createProductionOrder({ organizationId: "org_test", actorMemberId: auth.body.member.id,
    actorRole: "admin", productId: "product-large-api", executionPurpose: "first_production", videoPlanVersionId: "plan-api", idempotencyKey: "api-large-order" });
  configured.packageRecord.production_order_id = order.order.id;
  const claim = await app.inject({ method: "POST", url: `/api/production-orders/${order.order.id}/manual-execution/claim`, headers: { ...mutation, "idempotency-key": "api-large-claim" },
    payload: { package_id: configured.packageRecord.id } });
  const attemptId = claim.json().attempt.id;
  await app.inject({ method: "POST", url: `/api/manual-execution-attempts/${attemptId}/start`, headers: { ...mutation, "idempotency-key": "api-large-start" }, payload: {} });
  const body = Buffer.alloc(20 * 1024 * 1024 + 1, 7);
  const checksum = createHash("sha256").update(body).digest("hex");
  const authorization = await app.inject({ method: "POST", url: `/api/manual-execution-attempts/${attemptId}/candidates/upload-authorizations`, headers: { ...mutation, "idempotency-key": "api-large-upload" },
    payload: { role: "primary_video", original_filename: "large-api.mp4", media_type: "video/mp4", size: body.length, checksum } });
  assert.equal(authorization.statusCode, 201);
  const uploaded = await app.inject({ method: "PUT", url: `/api/manual-execution-candidate-uploads/${authorization.json().candidate.id}`,
    headers: { ...mutation, "content-type": "video/mp4", "x-manual-upload-token": authorization.json().upload_token }, payload: body });
  assert.equal(uploaded.statusCode, 200);
});

test("manual candidate route rejects a body above its configured bound with 413", async (t) => {
  const maxCandidateBytes = 1024 * 1024;
  const { app } = await identityApp(t, options({ maxCandidateBytes }));
  const auth = await activateAdmin(app);
  const body = Buffer.alloc(maxCandidateBytes + 1, 3);
  const response = await app.inject({ method: "PUT", url: "/api/manual-execution-candidate-uploads/not-a-candidate",
    headers: { ...identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true }), "content-type": "video/mp4", "x-manual-upload-token": "not-a-token" }, payload: body });
  assert.equal(response.statusCode, 413);
  assert.equal(response.json().error, "MANUAL_EXECUTION_CANDIDATE_SIZE_INVALID");
});
