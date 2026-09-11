import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createMemoryWorkVerificationRepository } from "../src/work-verification/memory-work-verification-repository.js";
import { createWorkVerificationService } from "../src/work-verification/work-verification-service.js";
import { sanitizeHiflySubmissionReceipt } from "../src/execution-contracts/hifly-hands-on-product-evidence.js";

const actor = { organizationId: "org-a", actorMemberId: "member-a", actorRole: "member" };

function world() {
  const body = Buffer.from("candidate-video");
  const checksum = createHash("sha256").update(body).digest("hex");
  const order = {
    id: "order-a", organization_id: actor.organizationId, product_id: "product-a", status: "running",
    row_version: 4, video_plan_version_id: "plan-a", execution_purpose: "first_production",
    input_snapshot: {
      approved_copy_snapshot: { copy_version_id: "copy-a" },
      product_revision_snapshot: { id: "revision-a" },
      avatar_selection_snapshot: { asset_version_id: "avatar-version-a" }
    }, status_history: []
  };
  const attempt = {
    id: "attempt-a", organization_id: actor.organizationId, production_order_id: order.id,
    package_id: "package-a", package_version: 2, manifest_hash: "manifest-a", executor_type: "manual",
    operator_id: actor.actorMemberId, status: "succeeded", row_version: 2
  };
  const report = {
    id: "report-a", organization_id: actor.organizationId, report_version: 1,
    production_order_id: order.id, execution_attempt_id: attempt.id, package_id: attempt.package_id,
    package_version: attempt.package_version, manifest_hash: attempt.manifest_hash, outcome: "completed",
    primary_output: { upload_reference: "candidate-a", checksum, media_type: "video/mp4", size: body.length, role: "primary_video" }
  };
  const candidate = {
    id: "candidate-a", organization_id: actor.organizationId, production_order_id: order.id,
    execution_attempt_id: attempt.id, package_id: attempt.package_id, package_version: attempt.package_version,
    manifest_hash: attempt.manifest_hash, role: "primary_video", original_filename: "candidate.mp4",
    media_type: "video/mp4", size: body.length, checksum, status: "pending_verification",
    object_key: "candidate-a.mp4"
  };
  const packageRecord = {
    id: attempt.package_id, organization_id: actor.organizationId, production_order_id: order.id,
    package_version: attempt.package_version, manifest_hash: attempt.manifest_hash,
    manifest: { accepted_media_types: ["video/mp4"], expected_quantity: 1 }
  };
  const objectStore = createMemoryObjectStore();
  const orderPort = {
    async getOrder({ organizationId, orderId }) {
      return organizationId === order.organization_id && orderId === order.id ? structuredClone(order) : null;
    },
    async transitionOrder(input) {
      if (input.organizationId !== order.organization_id || input.orderId !== order.id ||
        input.expectedRevision !== order.row_version || !input.fromStatuses.includes(order.status)) return null;
      order.status = input.toStatus;
      order.row_version += 1;
      return structuredClone(order);
    }
  };
  const executionPort = {
    async getAttempt(organizationId, attemptId) { return organizationId === actor.organizationId && attemptId === attempt.id ? structuredClone(attempt) : null; },
    async getReport(organizationId, reportId) { return organizationId === actor.organizationId && reportId === report.id ? structuredClone(report) : null; },
    async listReports(organizationId, attemptId) { return organizationId === actor.organizationId && attemptId === attempt.id ? [structuredClone(report)] : []; },
    async getCandidate(organizationId, candidateId) { return organizationId === actor.organizationId && candidateId === candidate.id ? structuredClone(candidate) : null; },
    async listCandidates(organizationId, attemptId) { return organizationId === actor.organizationId && attemptId === attempt.id ? [structuredClone(candidate)] : []; },
    async markCandidateVerification() {}
  };
  const packagePort = { async getPackage({ organizationId, packageId }) { return organizationId === actor.organizationId && packageId === packageRecord.id ? structuredClone(packageRecord) : null; } };
  return { order, attempt, report, candidate, packageRecord, body, objectStore, orderPort, executionPort, packagePort };
}

test("completed report verification creates one Work and then succeeds its ProductionOrder", async () => {
  const state = world();
  await state.objectStore.put({ key: state.candidate.object_key, body: state.body, contentType: state.candidate.media_type, metadata: { organizationId: actor.organizationId, candidateOutputId: state.candidate.id } });
  const repository = createMemoryWorkVerificationRepository();
  const service = createWorkVerificationService({ repository, ...state, now: () => Date.parse("2026-08-09T00:00:00.000Z") });

  const queued = await service.requestVerification({ ...actor, productionOrderId: state.order.id, executionAttemptId: state.attempt.id, reportId: state.report.id, candidateId: state.candidate.id, idempotencyKey: "verify-a" });
  assert.equal(queued.job.verification_status, "queued");

  await service.runNextVerificationJob();
  const result = await service.getVerificationWorkspace({ ...actor, productionOrderId: state.order.id });
  assert.equal(result.job.verification_status, "passed");
  assert.equal(result.work.production_order_id, state.order.id);
  assert.equal(result.work.execution_attempt_id, state.attempt.id);
  assert.equal(result.work.primary_output_checksum, state.candidate.checksum);
  assert.equal(state.order.status, "succeeded");
  assert.equal((await repository.listWorks(actor.organizationId)).length, 1);
});

test("worker-side authoritative package lookup forwards the verification actor context", async () => {
  const state = world();
  const packageCalls = [];
  state.packagePort.getPackage = async (input) => {
    packageCalls.push(input);
    if (input.actorMemberId !== actor.actorMemberId || input.actorRole !== actor.actorRole) return null;
    return structuredClone(state.packageRecord);
  };
  await state.objectStore.put({ key: state.candidate.object_key, body: state.body, contentType: state.candidate.media_type, metadata: { organizationId: actor.organizationId, candidateOutputId: state.candidate.id } });
  const repository = createMemoryWorkVerificationRepository();
  const service = createWorkVerificationService({ repository, ...state, now: () => Date.parse("2026-08-09T00:00:00.000Z") });

  await service.requestVerification({ ...actor, productionOrderId: state.order.id, executionAttemptId: state.attempt.id, reportId: state.report.id, candidateId: state.candidate.id, idempotencyKey: "actor-context" });
  const result = await service.runNextVerificationJob();

  assert.equal(result.job.verification_status, "passed");
  assert.deepEqual(packageCalls, [{
    organizationId: actor.organizationId,
    actorMemberId: actor.actorMemberId,
    actorRole: actor.actorRole,
    packageId: state.attempt.package_id
  }]);
});

test("A12 retains a valid Cloud receipt through the Report link and leaves historical reports compatible", async () => {
  for (const includeReceipt of [false, true]) {
    const state = world();
    Object.assign(state.attempt, { executor_type: "cloud_executor", operator_id: null, executor_cloud_id: "cloud-a" });
    state.report.submitted_by_cloud_executor_id = "cloud-a";
    const receipt = sanitizeHiflySubmissionReceipt({ evidence_source: "causal_submission_receipt", receipt_id: "observation-a",
      remote_id: "hifly-a", observed_at: "2026-09-11T00:00:00.000Z" }, state.attempt.id);
    if (includeReceipt) state.report.supporting_outputs = [receipt];
    await state.objectStore.put({ key: state.candidate.object_key, body: state.body, contentType: state.candidate.media_type,
      metadata: { organizationId: actor.organizationId, candidateOutputId: state.candidate.id } });
    const repository = createMemoryWorkVerificationRepository();
    const service = createWorkVerificationService({ repository, ...state });
    await service.requestVerification({ ...actor, productionOrderId: state.order.id, executionAttemptId: state.attempt.id,
      reportId: state.report.id, candidateId: state.candidate.id, idempotencyKey: "receipt-verify" });
    const result = await service.runNextVerificationJob();
    assert.equal(result.job.verification_status, "passed");
    assert.equal(result.work.manual_execution_report_id, state.report.id);
    if (includeReceipt) assert.deepEqual((await state.executionPort.getReport(actor.organizationId, result.work.manual_execution_report_id)).supporting_outputs, [receipt]);
  }
});

test("A12 rejects untrusted, duplicate, cross-attempt or non-Cloud Hifly receipt entries", async () => {
  for (const mutation of [
    (state) => { state.report.supporting_outputs[0].evidence_source = "direct_submission"; },
    (state) => { state.report.supporting_outputs.push(structuredClone(state.report.supporting_outputs[0])); },
    (state) => { state.report.supporting_outputs[0].execution_attempt_id = "another-attempt"; },
    (state) => { state.report.supporting_outputs[0].remote_url = "https://example.invalid/?token=private"; },
    (state) => { state.attempt.executor_type = "manual"; },
    (state) => { state.report.submitted_by_cloud_executor_id = "another-cloud"; }
  ]) {
    const state = world();
    Object.assign(state.attempt, { executor_type: "cloud_executor", operator_id: null, executor_cloud_id: "cloud-a" });
    state.report.submitted_by_cloud_executor_id = "cloud-a";
    state.report.supporting_outputs = [sanitizeHiflySubmissionReceipt({ evidence_source: "causal_submission_receipt", receipt_id: "observation-a",
      remote_id: "hifly-a", observed_at: "2026-09-11T00:00:00.000Z" }, state.attempt.id)];
    mutation(state);
    const repository = createMemoryWorkVerificationRepository();
    const service = createWorkVerificationService({ repository, ...state });
    await service.requestVerification({ ...actor, productionOrderId: state.order.id, executionAttemptId: state.attempt.id,
      reportId: state.report.id, candidateId: state.candidate.id, idempotencyKey: "invalid-receipt" });
    const result = await service.runNextVerificationJob();
    assert.equal(result.job.verification_status, "failed");
    assert.equal(result.job.failure_code, "WORK_VERIFICATION_HIFLY_RECEIPT_INVALID");
    assert.equal((await repository.listWorks(actor.organizationId)).length, 0);
  }
});
