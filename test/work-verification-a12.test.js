import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createMemoryWorkVerificationRepository } from "../src/work-verification/memory-work-verification-repository.js";
import { createVerifiedOutputAssetPort } from "../src/work-verification/verified-output-asset-port.js";
import { createWorkVerificationService } from "../src/work-verification/work-verification-service.js";

const actor = { organizationId: "org-a", actorMemberId: "member-a", actorRole: "member" };

function makeWorld({ transitionOrder = null, executionPortPatch = {}, packagePortPatch = {} } = {}) {
  const body = Buffer.from("candidate-video");
  const checksum = createHash("sha256").update(body).digest("hex");
  const order = {
    id: "order-a", organization_id: actor.organizationId, product_id: "product-a", status: "running", row_version: 4,
    video_plan_version_id: "plan-a", execution_purpose: "first_production",
    input_snapshot: {
      approved_copy_snapshot: { copy_version_id: "copy-a" }, product_revision_snapshot: { id: "revision-a" },
      avatar_selection_snapshot: { asset_version_id: "avatar-version-a" }, capability_config_snapshot: { preset: "test" }
    }, status_history: []
  };
  const attempt = { id: "attempt-a", organization_id: actor.organizationId, production_order_id: order.id, package_id: "package-a", package_version: 2,
    manifest_hash: "manifest-a", executor_type: "manual", operator_id: actor.actorMemberId, status: "succeeded", row_version: 2 };
  const report = { id: "report-a", organization_id: actor.organizationId, report_version: 1, production_order_id: order.id,
    execution_attempt_id: attempt.id, package_id: attempt.package_id, package_version: attempt.package_version, manifest_hash: attempt.manifest_hash,
    outcome: "completed", primary_output: { upload_reference: "candidate-a", checksum, media_type: "video/mp4", size: body.length, role: "primary_video" }, deviations: [] };
  const candidate = { id: "candidate-a", organization_id: actor.organizationId, production_order_id: order.id, execution_attempt_id: attempt.id,
    package_id: attempt.package_id, package_version: attempt.package_version, manifest_hash: attempt.manifest_hash, role: "primary_video",
    original_filename: "candidate.mp4", media_type: "video/mp4", size: body.length, checksum, status: "pending_verification", object_key: "candidate-a.mp4" };
  const packageRecord = { id: attempt.package_id, organization_id: actor.organizationId, production_order_id: order.id,
    package_version: attempt.package_version, manifest_hash: attempt.manifest_hash, manifest: { accepted_media_types: ["video/mp4"], expected_quantity: 1 } };
  const objectStore = createMemoryObjectStore();
  const orderPort = {
    async getOrder({ organizationId, orderId }) { return organizationId === order.organization_id && orderId === order.id ? structuredClone(order) : null; },
    async transitionOrder(input) {
      if (transitionOrder) return transitionOrder(input);
      if (input.expectedRevision !== order.row_version || !input.fromStatuses.includes(order.status)) return null;
      const previous = structuredClone(order);
      order.status = input.toStatus; order.row_version += 1;
      input.transactionClient?.onRollback?.(() => Object.assign(order, previous));
      return structuredClone(order);
    }
  };
  const executionPort = {
    async getAttempt(organizationId, attemptId) { return organizationId === actor.organizationId && attemptId === attempt.id ? structuredClone(attempt) : null; },
    async getReport(organizationId, reportId) { return organizationId === actor.organizationId && reportId === report.id ? structuredClone(report) : null; },
    async listReports(organizationId, attemptId) { return organizationId === actor.organizationId && attemptId === attempt.id ? [structuredClone(report)] : []; },
    async getCandidate(organizationId, candidateId) { return organizationId === actor.organizationId && candidateId === candidate.id ? structuredClone(candidate) : null; },
    async listCandidates(organizationId, attemptId) { return organizationId === actor.organizationId && attemptId === attempt.id ? [structuredClone(candidate)] : []; },
    async markCandidateVerification() {},
    ...executionPortPatch
  };
  const packagePort = { async getPackage({ organizationId, packageId }) { return organizationId === actor.organizationId && packageId === packageRecord.id ? structuredClone(packageRecord) : null; }, ...packagePortPatch };
  return { order, attempt, report, candidate, packageRecord, body, objectStore, orderPort, executionPort, packagePort };
}

async function setup(options = {}) {
  const state = makeWorld(options);
  await state.objectStore.put({ key: state.candidate.object_key, body: state.body, contentType: state.candidate.media_type,
    metadata: { organizationId: actor.organizationId, candidateOutputId: state.candidate.id } });
  const assetRepository = options.assetRepository || createMemoryAssetRepository();
  const repository = options.repository || createMemoryWorkVerificationRepository(options.repositoryOptions);
  const service = createWorkVerificationService({ repository, verifiedOutputAssetPort: options.verifiedOutputAssetPort || createVerifiedOutputAssetPort({ repository: assetRepository }), ...state,
    maxAttempts: options.maxAttempts ?? 3, now: options.now || (() => Date.parse("2026-08-09T00:00:00.000Z")) });
  return { ...state, assetRepository, repository, service };
}

test("passed verification registers a canonical work_video AssetVersion and Work references it", async () => {
  const state = await setup();
  await state.service.requestVerification({ ...actor, productionOrderId: state.order.id, executionAttemptId: state.attempt.id, reportId: state.report.id, candidateId: state.candidate.id, idempotencyKey: "asset-reference" });
  await state.service.runNextVerificationJob();
  const workspace = await state.service.getVerificationWorkspace({ ...actor, productionOrderId: state.order.id });
  const assets = await state.assetRepository.listAssets(actor.organizationId);
  assert.equal(assets.length, 1);
  assert.equal(assets[0].kind, "work_video");
  assert.equal(assets[0].versions[0].status, "available");
  assert.equal(workspace.work.primary_asset_version_id, assets[0].versions[0].id);
  assert.equal(workspace.work.copy_version_id, "copy-a");
  assert.equal(workspace.work.avatar_asset_version_id, "avatar-version-a");
  assert.deepEqual(workspace.work.production_config_snapshot, { preset: "test" });
  assert.equal("receipt_key" in (await state.service.getVerificationJob({ ...actor, jobId: workspace.job.id })), false);
});

test("asset registration failure leaves Work and order untouched", async () => {
  const state = await setup({ verifiedOutputAssetPort: { async registerVerifiedOutput() { throw Object.assign(new Error("injected"), { code: "ASSET_INSERT_INJECTED" }); } } });
  await state.service.requestVerification({ ...actor, productionOrderId: state.order.id, executionAttemptId: state.attempt.id, reportId: state.report.id, candidateId: state.candidate.id, idempotencyKey: "asset-failure" });
  await state.service.runNextVerificationJob();
  assert.equal((await state.repository.listWorks(actor.organizationId)).length, 0);
  assert.equal(state.order.status, "running");
  const workspace = await state.service.getVerificationWorkspace({ ...actor, productionOrderId: state.order.id });
  assert.equal(workspace.job.failure_kind, "technical");
  assert.equal(workspace.job.failure_code, "ASSET_INSERT_INJECTED");
});

test("Work insert failure rolls back canonical AssetVersion and leaves the order running", async () => {
  const state = await setup({ repositoryOptions: { failureInjector: { work_insert: true } } });
  await state.service.requestVerification({ ...actor, productionOrderId: state.order.id, executionAttemptId: state.attempt.id, reportId: state.report.id, candidateId: state.candidate.id, idempotencyKey: "work-failure" });
  const result = await state.service.runNextVerificationJob();
  assert.equal(result.job.failure_kind, "technical");
  assert.equal(result.job.failure_code, "WORK_VERIFICATION_WORK_INSERT_INJECTED");
  assert.equal((await state.repository.listWorks(actor.organizationId)).length, 0);
  assert.equal((await state.assetRepository.listAssets(actor.organizationId)).length, 0);
  assert.equal(state.order.status, "running");
});

test("order transition failure rolls back canonical AssetVersion and Work", async () => {
  const state = await setup({ transitionOrder: async () => { throw Object.assign(new Error("injected"), { code: "ORDER_TRANSITION_INJECTED" }); } });
  await state.service.requestVerification({ ...actor, productionOrderId: state.order.id, executionAttemptId: state.attempt.id, reportId: state.report.id, candidateId: state.candidate.id, idempotencyKey: "order-failure" });
  await state.service.runNextVerificationJob();
  assert.equal((await state.repository.listWorks(actor.organizationId)).length, 0);
  assert.equal((await state.assetRepository.listAssets(actor.organizationId)).length, 0);
  assert.equal(state.order.status, "running");
});

test("memory transaction restores an order mutated before a transition failure", async () => {
  const state = await setup();
  state.orderPort.transitionOrder = async (input) => {
    const previous = structuredClone(state.order);
    state.order.status = "succeeded";
    state.order.row_version += 1;
    input.transactionClient?.onRollback?.(() => Object.assign(state.order, previous));
    throw Object.assign(new Error("injected after mutation"), { code: "ORDER_TRANSITION_INJECTED_AFTER_MUTATION" });
  };
  await state.service.requestVerification({ ...actor, productionOrderId: state.order.id, executionAttemptId: state.attempt.id, reportId: state.report.id, candidateId: state.candidate.id, idempotencyKey: "order-mutation-failure" });
  await state.service.runNextVerificationJob();
  assert.equal(state.order.status, "running");
  assert.equal(state.order.row_version, 4);
  assert.equal((await state.repository.listWorks(actor.organizationId)).length, 0);
  assert.equal((await state.assetRepository.listAssets(actor.organizationId)).length, 0);
});

test("business requires_action is projected separately and can be recovered with a bounded retry", async () => {
  const projections = [];
  const state = await setup({
    executionPortPatch: {
      async markCandidateVerification(input) {
        projections.push({ status: input.verificationStatus, failureKind: input.failureKind, failureCode: input.failureCode });
        Object.assign(state.candidate, {
          verification_status: input.verificationStatus,
          verification_failure_kind: input.failureKind,
          verification_failure_code: input.failureCode
        });
      }
    }
  });
  state.report.deviations = [{ code: "input_changed", message: "changed" }];
  await state.service.requestVerification({ ...actor, productionOrderId: state.order.id, executionAttemptId: state.attempt.id, reportId: state.report.id, candidateId: state.candidate.id, idempotencyKey: "requires-action" });
  let result = await state.service.runNextVerificationJob();
  assert.equal(result.job.status, "succeeded");
  assert.equal(result.job.verification_status, "requires_action");
  assert.equal(result.job.failure_kind, "business");
  assert.equal(result.job.failure_code, "WORK_VERIFICATION_CORE_INPUT_DEVIATION");
  assert.equal(state.order.status, "running");
  assert.equal(state.candidate.verification_status, "requires_action");

  state.report.deviations = [];
  await state.service.recoverVerification({ ...actor, jobId: result.job.id, resolutionNote: "人工确认输入仍以批准版本为准", idempotencyKey: "recover-requires-action" });
  result = await state.service.runNextVerificationJob();
  assert.equal(result.job.verification_status, "passed");
  assert.equal(state.order.status, "succeeded");
  assert.deepEqual(projections.map((item) => item.status), ["queued", "running", "requires_action", "queued", "running", "passed"]);
  assert.ok((await state.repository.listAuditEvents(actor.organizationId)).some((event) => event.event_type === "work_verification.recovery_requested"));
});

test("authoritative report/package mismatch is a business failure, not a technical retry", async () => {
  const projections = [];
  const state = await setup({ executionPortPatch: {
    async markCandidateVerification(input) {
      projections.push({ status: input.verificationStatus, failureKind: input.failureKind, failureCode: input.failureCode });
      Object.assign(state.candidate, { verification_status: input.verificationStatus, verification_failure_kind: input.failureKind, verification_failure_code: input.failureCode });
    }
  } });
  state.report.package_version = 99;
  const requested = await state.service.requestVerification({ ...actor, productionOrderId: state.order.id, executionAttemptId: state.attempt.id, reportId: state.report.id, candidateId: state.candidate.id, idempotencyKey: "business-report-mismatch" });
  const result = await state.service.runNextVerificationJob();
  assert.equal(result.job.id, requested.job.id);
  assert.equal(result.job.status, "succeeded");
  assert.equal(result.job.verification_status, "failed");
  assert.equal(result.job.failure_kind, "business");
  assert.equal(result.job.failure_code, "WORK_VERIFICATION_REPORT_NOT_COMPLETED");
  assert.equal(state.order.status, "running");
  assert.equal((await state.repository.listWorks(actor.organizationId)).length, 0);
  assert.deepEqual(projections.at(-1), { status: "failed", failureKind: "business", failureCode: "WORK_VERIFICATION_REPORT_NOT_COMPLETED" });
});

test("technical failure is retryable but maxAttempts prevents infinite retries", async () => {
  const state = await setup();
  const originalHead = state.objectStore.head;
  state.objectStore.head = async () => { throw Object.assign(new Error("temporary object store outage"), { code: "OBJECT_STORE_UNAVAILABLE" }); };
  await state.service.requestVerification({ ...actor, productionOrderId: state.order.id, executionAttemptId: state.attempt.id, reportId: state.report.id, candidateId: state.candidate.id, idempotencyKey: "technical-retry" });
  let result = await state.service.runNextVerificationJob();
  assert.equal(result.job.status, "failed");
  assert.equal(result.job.verification_status, "failed");
  assert.equal(result.job.failure_kind, "technical");
  assert.equal(result.job.attempts, 1);
  state.objectStore.head = originalHead;
  await assert.doesNotReject(() => state.service.retryVerification({ ...actor, jobId: result.job.id, idempotencyKey: "technical-retry-once" }));
  result = await state.service.runNextVerificationJob();
  assert.equal(result.job.verification_status, "passed");
  assert.equal(result.job.attempts, 2);
  assert.ok((await state.repository.listAuditEvents(actor.organizationId)).some((event) => event.event_type === "work_verification.retry_requested"));

  const exhausted = await setup({ maxAttempts: 1 });
  const exhaustedHead = exhausted.objectStore.head;
  exhausted.objectStore.head = async () => { throw Object.assign(new Error("outage"), { code: "OBJECT_STORE_UNAVAILABLE" }); };
  const request = await exhausted.service.requestVerification({ ...actor, productionOrderId: exhausted.order.id, executionAttemptId: exhausted.attempt.id, reportId: exhausted.report.id, candidateId: exhausted.candidate.id, idempotencyKey: "technical-exhausted" });
  const failed = await exhausted.service.runNextVerificationJob({ leaseMs: 10 });
  assert.equal(failed.job.attempts, 1);
  await assert.rejects(() => exhausted.service.retryVerification({ ...actor, jobId: request.job.id, idempotencyKey: "technical-exhausted-retry" }), { code: "WORK_VERIFICATION_RETRY_EXHAUSTED" });
  exhausted.objectStore.head = exhaustedHead;
});

test("candidate projection records terminal lease exhaustion as technical failure", async () => {
  let clock = Date.parse("2026-08-09T00:00:00.000Z");
  const projections = [];
  const state = await setup({ maxAttempts: 1, now: () => clock, executionPortPatch: {
    async markCandidateVerification(input) {
      projections.push({ status: input.verificationStatus, failureKind: input.failureKind, failureCode: input.failureCode });
      Object.assign(state.candidate, { verification_status: input.verificationStatus, verification_failure_kind: input.failureKind, verification_failure_code: input.failureCode });
    }
  } });
  const requested = await state.service.requestVerification({ ...actor, productionOrderId: state.order.id, executionAttemptId: state.attempt.id, reportId: state.report.id, candidateId: state.candidate.id, idempotencyKey: "lease-exhaustion" });
  const claimed = await state.repository.claimNextVerificationJob({ now: new Date(clock).toISOString(), leaseExpiresAt: new Date(clock + 1000).toISOString(), leaseToken: "lease-expiring" });
  assert.equal(claimed.id, requested.job.id);
  clock += 2000;
  assert.equal(await state.service.runNextVerificationJob(), null);
  const job = await state.repository.getVerificationJob(actor.organizationId, claimed.id);
  assert.equal(job.failure_kind, "technical");
  assert.equal(job.failure_code, "WORK_VERIFICATION_RETRY_EXHAUSTED");
  assert.equal(state.candidate.verification_status, "failed");
  assert.deepEqual(projections.at(-1), { status: "failed", failureKind: "technical", failureCode: "WORK_VERIFICATION_RETRY_EXHAUSTED" });
});

test("same candidate requests converge on one verification job and one Work", async () => {
  const state = await setup();
  const input = { ...actor, productionOrderId: state.order.id, executionAttemptId: state.attempt.id, reportId: state.report.id, candidateId: state.candidate.id };
  const requests = await Promise.all([state.service.requestVerification({ ...input, idempotencyKey: "same-a" }), state.service.requestVerification({ ...input, idempotencyKey: "same-b" })]);
  assert.equal(new Set(requests.map((item) => item.job.id)).size, 1);
  const runs = await Promise.all([state.service.runNextVerificationJob(), state.service.runNextVerificationJob()]);
  assert.equal(runs.filter(Boolean).length, 1);
  assert.equal((await state.repository.listWorks(actor.organizationId)).length, 1);
  assert.equal((await state.assetRepository.listAssets(actor.organizationId)).flatMap((item) => item.versions).length, 1);
});

test("verification enforces organization scope and member/admin roles", async () => {
  const state = await setup();
  const input = { productionOrderId: state.order.id, executionAttemptId: state.attempt.id, reportId: state.report.id, candidateId: state.candidate.id, idempotencyKey: "scope" };
  await assert.rejects(() => state.service.requestVerification({ ...actor, actorRole: "viewer", ...input }), { code: "WORK_VERIFICATION_FORBIDDEN" });
  await assert.rejects(() => state.service.requestVerification({ ...actor, organizationId: "org-other", ...input }), { code: "PRODUCTION_ORDER_NOT_FOUND" });
  await assert.rejects(() => state.service.getVerificationWorkspace({ ...actor, organizationId: "org-other", productionOrderId: state.order.id }), { code: "PRODUCTION_ORDER_NOT_FOUND" });
});

test("lease heartbeat extends a running job and expiry requeues it within maxAttempts", async () => {
  const state = await setup();
  const requested = await state.service.requestVerification({ ...actor, productionOrderId: state.order.id, executionAttemptId: state.attempt.id, reportId: state.report.id, candidateId: state.candidate.id, idempotencyKey: "lease" });
  const first = await state.repository.claimNextVerificationJob({ now: "2026-08-09T00:00:00.000Z", leaseExpiresAt: "2026-08-09T00:00:10.000Z", leaseToken: "lease-a" });
  assert.equal(first.id, requested.job.id);
  const heartbeated = await state.repository.heartbeatVerificationJob({ jobId: first.id, leaseToken: "lease-a", now: "2026-08-09T00:00:05.000Z", leaseExpiresAt: "2026-08-09T00:00:15.000Z" });
  assert.equal(heartbeated.lease_expires_at, "2026-08-09T00:00:15.000Z");
  assert.equal(await state.repository.claimNextVerificationJob({ now: "2026-08-09T00:00:14.000Z", leaseExpiresAt: "2026-08-09T00:00:24.000Z", leaseToken: "lease-b" }), null);
  const reclaimed = await state.repository.claimNextVerificationJob({ now: "2026-08-09T00:00:16.000Z", leaseExpiresAt: "2026-08-09T00:00:26.000Z", leaseToken: "lease-b" });
  assert.equal(reclaimed.id, first.id);
  assert.equal(reclaimed.attempts, 2);
});
