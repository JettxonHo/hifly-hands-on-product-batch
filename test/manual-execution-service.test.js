import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createManualExecutionService } from "../src/manual-execution/manual-execution-service.js";
import { createMemoryManualExecutionRepository } from "../src/manual-execution/memory-manual-execution-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";

const actor = { organizationId: "org-a", actorMemberId: "member-a", actorRole: "member" };

function world({ maxCandidateBytes } = {}) {
  const repository = createMemoryManualExecutionRepository();
  const order = {
    id: "order-a", organization_id: "org-a", product_id: "product-a", status: "waiting_for_executor",
    execution_purpose: "first_production", row_version: 1, input_snapshot: {}, status_history: []
  };
  const packageRecord = {
    id: "package-a", organization_id: "org-a", production_order_id: order.id,
    package_version: 2, status: "ready", manifest_hash: "manifest-hash-a", package_hash: "package-hash-a",
    manifest: { accepted_media_types: ["video/mp4"], expected_quantity: 1 }
  };
  const orderPort = {
    async getOrder(input) {
      return input.organizationId === order.organization_id && input.orderId === order.id ? structuredClone(order) : null;
    },
    async transitionOrder(input) {
      if (input.organizationId !== order.organization_id || input.orderId !== order.id) return null;
      if (order.row_version !== input.expectedRevision || !input.fromStatuses.includes(order.status)) {
        throw Object.assign(new Error("PRODUCTION_ORDER_CONFLICT"), { code: "PRODUCTION_ORDER_CONFLICT" });
      }
      order.status = input.toStatus;
      order.row_version += 1;
      order.status_history.push({ status: input.toStatus, at: input.at });
      return structuredClone(order);
    }
  };
  const packagePort = {
    async getPackage(input) {
      return input.organizationId === packageRecord.organization_id && input.packageId === packageRecord.id
        ? structuredClone(packageRecord) : null;
    },
    async listPackages(input) {
      return input.organizationId === packageRecord.organization_id && input.productionOrderId === order.id
        ? [structuredClone(packageRecord)] : [];
    }
  };
  const service = createManualExecutionService({ repository, orderPort, packagePort, candidateStore: createMemoryObjectStore(), maxCandidateBytes,
    now: () => Date.parse("2026-08-08T10:00:00.000Z") });
  return { repository, service, order, packageRecord };
}

async function runningWorld(options = {}) {
  const state = world(options);
  const claimed = await state.service.claimManualTask({ ...actor, productionOrderId: state.order.id, packageId: state.packageRecord.id, idempotencyKey: "claim-running" });
  const started = await state.service.confirmStart({ ...actor, attemptId: claimed.attempt.id, idempotencyKey: "start-running" });
  return { ...state, attempt: started.attempt };
}

async function primaryCandidate(state, suffix = "candidate") {
  const body = Buffer.from(`${suffix}-video`);
  const checksum = createHash("sha256").update(body).digest("hex");
  const authorization = await state.service.createCandidateUploadAuthorization({ ...actor, attemptId: state.attempt.id, role: "primary_video",
    originalFilename: `${suffix}.mp4`, mediaType: "video/mp4", size: body.length, checksum, idempotencyKey: `upload-${suffix}` });
  await state.service.uploadCandidateObject({ ...actor, uploadToken: authorization.upload_token, body, contentType: "video/mp4" });
  const completed = await state.service.completeCandidateUpload({ ...actor, attemptId: state.attempt.id, candidateId: authorization.candidate.id,
    uploadToken: authorization.upload_token, idempotencyKey: `complete-${suffix}` });
  return completed.candidate;
}

test("claim creates a manual attempt bound to the exact ready package, and start is a separate step", async () => {
  const { service, repository, order, packageRecord } = world();

  const claimed = await service.claimManualTask({ ...actor, productionOrderId: order.id, packageId: packageRecord.id, idempotencyKey: "claim-a" });
  assert.equal(claimed.attempt.status, "claimed");
  assert.equal(claimed.attempt.executor_type, "manual");
  assert.equal(claimed.attempt.production_order_id, order.id);
  assert.equal(claimed.attempt.package_id, packageRecord.id);
  assert.equal(claimed.attempt.package_version, packageRecord.package_version);
  assert.equal(claimed.attempt.manifest_hash, packageRecord.manifest_hash);
  assert.equal(claimed.attempt.operator_id, actor.actorMemberId);
  assert.equal(claimed.attempt.agent_id, undefined);
  assert.equal(claimed.attempt.provider_task_reference, undefined);
  assert.equal((await repository.listAttempts(actor.organizationId, order.id)).length, 1);
  assert.equal(order.status, "claimed");
  await assert.rejects(service.submitReport({ ...actor, attemptId: claimed.attempt.id, reportId: "before-start", idempotencyKey: "before-start",
    outcome: "requires_action", requiresActionReason: "尚未确认开始" }), { code: "MANUAL_EXECUTION_REPORT_BLOCKED" });

  const started = await service.confirmStart({ ...actor, attemptId: claimed.attempt.id, idempotencyKey: "start-a" });
  assert.equal(started.attempt.status, "running");
  assert.equal(started.attempt.started_at, "2026-08-08T10:00:00.000Z");
  assert.equal(order.status, "running");

  const replay = await service.confirmStart({ ...actor, attemptId: claimed.attempt.id, idempotencyKey: "start-a" });
  assert.equal(replay.replayed, true);
  assert.equal(replay.attempt.id, claimed.attempt.id);
});

test("a second member cannot claim a second active attempt, and a revoked package never creates one", async () => {
  const worldOne = world();
  await worldOne.service.claimManualTask({ ...actor, productionOrderId: worldOne.order.id, packageId: worldOne.packageRecord.id, idempotencyKey: "claim-a" });
  await assert.rejects(worldOne.service.claimManualTask({ organizationId: "org-a", actorMemberId: "member-b", actorRole: "member", productionOrderId: worldOne.order.id, packageId: worldOne.packageRecord.id, idempotencyKey: "claim-b" }), { code: "MANUAL_EXECUTION_ATTEMPT_ACTIVE" });

  const worldTwo = world();
  worldTwo.packageRecord.status = "revoked";
  await assert.rejects(worldTwo.service.claimManualTask({ ...actor, productionOrderId: worldTwo.order.id, packageId: worldTwo.packageRecord.id, idempotencyKey: "claim-revoked" }), { code: "MANUAL_EXECUTION_PACKAGE_NOT_READY" });
  assert.equal((await worldTwo.repository.listAttempts(actor.organizationId, worldTwo.order.id)).length, 0);

  const worldThree = world();
  const claimed = await worldThree.service.claimManualTask({ ...actor, productionOrderId: worldThree.order.id, packageId: worldThree.packageRecord.id, idempotencyKey: "claim-before-revoke" });
  worldThree.packageRecord.status = "revoked";
  const claimReplay = await worldThree.service.claimManualTask({ ...actor, productionOrderId: worldThree.order.id, packageId: worldThree.packageRecord.id, idempotencyKey: "claim-before-revoke" });
  assert.equal(claimReplay.replayed, true);
  await assert.rejects(worldThree.service.confirmStart({ ...actor, attemptId: claimed.attempt.id, idempotencyKey: "start-after-revoke" }), { code: "MANUAL_EXECUTION_PACKAGE_NOT_READY" });
  assert.equal(worldThree.order.status, "claimed");
  assert.equal((await worldThree.repository.getAttempt(actor.organizationId, claimed.attempt.id)).status, "claimed");
});

test("candidate upload is controlled, report completion is immutable, and it never completes the order", async () => {
  const { service, order, packageRecord } = world();
  const claimed = await service.claimManualTask({ ...actor, productionOrderId: order.id, packageId: packageRecord.id, idempotencyKey: "claim-report" });
  const started = await service.confirmStart({ ...actor, attemptId: claimed.attempt.id, idempotencyKey: "start-report" });
  const body = Buffer.from("candidate-video");
  const upload = await service.createCandidateUploadAuthorization({ ...actor, attemptId: started.attempt.id, role: "primary_video",
    originalFilename: "clip.mp4", mediaType: "video/mp4", size: body.length, checksum: createHash("sha256").update(body).digest("hex"), idempotencyKey: "upload-report" });
  const uploadReplay = await service.createCandidateUploadAuthorization({ ...actor, attemptId: started.attempt.id, role: "primary_video",
    originalFilename: "clip.mp4", mediaType: "video/mp4", size: body.length, checksum: createHash("sha256").update(body).digest("hex"), idempotencyKey: "upload-report" });
  assert.equal(uploadReplay.replayed, true);
  assert.notEqual(uploadReplay.upload_token, upload.upload_token);
  await service.uploadCandidateObject({ ...actor, uploadToken: uploadReplay.upload_token, body, contentType: "video/mp4" });
  const candidate = await service.completeCandidateUpload({ ...actor, attemptId: started.attempt.id, candidateId: upload.candidate.id,
    uploadToken: uploadReplay.upload_token, idempotencyKey: "complete-upload-report" });
  assert.equal(candidate.candidate.status, "uploaded");

  const report = await service.submitReport({ ...actor, attemptId: started.attempt.id, reportId: "report-a", idempotencyKey: "report-a-key",
    outcome: "completed", primaryCandidateId: candidate.candidate.id, deviations: [] });
  assert.equal(report.report.outcome, "completed");
  assert.equal(report.report.report_version, 1);
  assert.equal(report.report.primary_output.checksum, upload.candidate.checksum);
  assert.equal(report.attempt.status, "succeeded");
  assert.equal(order.status, "running");
  assert.notEqual(order.status, "succeeded");
  assert.equal((await service.listCandidates({ ...actor, attemptId: started.attempt.id }))[0].status, "pending_verification");

  const correction = await service.submitReport({ ...actor, attemptId: started.attempt.id, reportId: "report-a-correction", idempotencyKey: "report-a-correction-key",
    supersedesReportId: report.report.id, outcome: "requires_action", requiresActionReason: "需要人工确认输出偏差", deviations: [{ code: "output_name_changed", note: "文件名与说明不同" }] });
  assert.equal(correction.report.report_version, 2);
  assert.equal(correction.report.supersedes_report_id, report.report.id);
  assert.equal(correction.attempt.status, "requires_action");
  assert.equal(order.status, "requires_action");
  const reports = await service.listReports({ ...actor, attemptId: started.attempt.id });
  assert.equal(reports.length, 2);
  assert.equal(reports.find((item) => item.id === report.report.id).outcome, "completed");

  const reportReplay = await service.submitReport({ ...actor, attemptId: started.attempt.id, reportId: "report-a", idempotencyKey: "report-a-key",
    outcome: "completed", primaryCandidateId: candidate.candidate.id, deviations: [] });
  assert.equal(reportReplay.replayed, true);
  await assert.rejects(service.submitReport({ ...actor, attemptId: started.attempt.id, reportId: "report-a", idempotencyKey: "report-a-conflicting-key",
    outcome: "failed", errorCategory: "different", failureStage: "人工制作", retryability: "not_retryable" }), { code: "IDEMPOTENCY_CONFLICT" });
});

test("requires_action can be rechecked, retryable failure re-enters through a new attempt, and cancellation needs an explicit request", async () => {
  const { service, order, packageRecord } = world();
  const claimed = await service.claimManualTask({ ...actor, productionOrderId: order.id, packageId: packageRecord.id, idempotencyKey: "claim-reentry" });
  const started = await service.confirmStart({ ...actor, attemptId: claimed.attempt.id, idempotencyKey: "start-reentry" });
  const action = await service.submitReport({ ...actor, attemptId: started.attempt.id, reportId: "report-action", idempotencyKey: "report-action-key",
    outcome: "requires_action", requiresActionReason: "需要人工确认页面提示", deviations: [] });
  assert.equal(action.attempt.status, "requires_action");
  assert.equal(order.status, "requires_action");

  const recovered = await service.recheckAttempt({ ...actor, attemptId: started.attempt.id, idempotencyKey: "recheck-action", resolutionNote: "已确认输入仍与交接包一致" });
  assert.equal(recovered.attempt.status, "running");
  assert.equal(order.status, "running");
  const failed = await service.submitReport({ ...actor, attemptId: started.attempt.id, reportId: "report-failed", idempotencyKey: "report-failed-key",
    supersedesReportId: action.report.id, outcome: "failed", errorCategory: "technical", failureStage: "人工制作", retryability: "retryable", operatorNote: "外部页面暂时不可用" });
  assert.equal(failed.attempt.status, "failed");
  assert.equal(order.status, "requires_action");

  const reentered = await service.reenterFailedAttempt({ ...actor, attemptId: started.attempt.id, idempotencyKey: "reenter-failed" });
  assert.equal(reentered.attempt.status, "superseded");
  assert.equal(order.status, "waiting_for_executor");
  assert.equal((await service.getExecutionWorkspace({ ...actor, productionOrderId: order.id })).current_attempt, null);
  const next = await service.claimManualTask({ ...actor, productionOrderId: order.id, packageId: packageRecord.id, idempotencyKey: "claim-reentry-next" });
  assert.notEqual(next.attempt.id, started.attempt.id);

  await assert.rejects(service.submitReport({ ...actor, attemptId: next.attempt.id, reportId: "cancel-without-request", idempotencyKey: "cancel-without-request",
    outcome: "cancelled" }), { code: "MANUAL_EXECUTION_CANCEL_NOT_REQUESTED" });
  const cancel = await service.requestOrderCancellation({ ...actor, productionOrderId: order.id, idempotencyKey: "cancel-order" });
  assert.equal(cancel.order.status, "cancel_requested");
  assert.equal(cancel.attempt.status, "cancel_requested");
  const cancelled = await service.submitReport({ ...actor, attemptId: next.attempt.id, reportId: "cancelled", idempotencyKey: "cancelled",
    outcome: "cancelled", operatorNote: "已确认停止" });
  assert.equal(cancelled.attempt.status, "cancelled");
  assert.equal(order.status, "cancelled");
});

test("candidate authorization rejects cross-attempt candidates, bad bytes, and non-operators without leaking records", async () => {
  const first = world();
  const claimed = await first.service.claimManualTask({ ...actor, productionOrderId: first.order.id, packageId: first.packageRecord.id, idempotencyKey: "claim-boundary" });
  const started = await first.service.confirmStart({ ...actor, attemptId: claimed.attempt.id, idempotencyKey: "start-boundary" });
  const body = Buffer.from("candidate-boundary");
  const checksum = createHash("sha256").update(body).digest("hex");
  const upload = await first.service.createCandidateUploadAuthorization({ ...actor, attemptId: started.attempt.id, role: "primary_video",
    originalFilename: "clip.mp4", mediaType: "video/mp4", size: body.length, checksum, idempotencyKey: "upload-boundary" });
  await assert.rejects(first.service.uploadCandidateObject({ ...actor, uploadToken: upload.upload_token, body: Buffer.from("wrong"), contentType: "video/mp4" }), { code: "MANUAL_EXECUTION_CANDIDATE_INTEGRITY_MISMATCH" });
  await assert.rejects(first.service.completeCandidateUpload({ organizationId: "org-b", actorMemberId: "member-b", actorRole: "member",
    attemptId: started.attempt.id, candidateId: upload.candidate.id, uploadToken: upload.upload_token, idempotencyKey: "complete-cross-org" }), { code: "MANUAL_EXECUTION_CANDIDATE_NOT_FOUND" });

  const second = world();
  const secondClaim = await second.service.claimManualTask({ ...actor, productionOrderId: second.order.id, packageId: second.packageRecord.id, idempotencyKey: "claim-second" });
  await assert.rejects(first.service.submitReport({ ...actor, attemptId: secondClaim.attempt.id, reportId: "cross-attempt", idempotencyKey: "cross-attempt",
    outcome: "completed", primaryCandidateId: upload.candidate.id }), { code: "MANUAL_EXECUTION_ATTEMPT_NOT_FOUND" });
});

test("waiting order cancellation is idempotent and leaves no attempt behind", async () => {
  const { service, order } = world();
  const first = await service.requestOrderCancellation({ ...actor, productionOrderId: order.id, idempotencyKey: "cancel-waiting" });
  assert.equal(first.order.status, "cancelled");
  const replay = await service.requestOrderCancellation({ ...actor, productionOrderId: order.id, idempotencyKey: "cancel-waiting" });
  assert.equal(replay.replayed, true);
  assert.equal(replay.order.status, "cancelled");
});

test("report replay is checked before terminal state gates, while new reports require the latest correction", async () => {
  const state = await runningWorld();
  const candidate = await primaryCandidate(state, "report-gate");
  const first = await state.service.submitReport({ ...actor, attemptId: state.attempt.id, reportId: "report-gate-1", idempotencyKey: "report-gate-1-key",
    outcome: "completed", completedAt: "2026-08-08T10:01:00.000Z", primaryCandidateId: candidate.id, deviations: [] });
  const replay = await state.service.submitReport({ ...actor, attemptId: state.attempt.id, reportId: first.report.id, idempotencyKey: "report-gate-1-key",
    outcome: "completed", completedAt: "2026-08-08T10:01:00.000Z", primaryCandidateId: candidate.id, deviations: [] });
  assert.equal(replay.replayed, true);
  await assert.rejects(state.service.submitReport({ ...actor, attemptId: state.attempt.id, reportId: "report-gate-missing", idempotencyKey: "report-gate-missing-key",
    outcome: "requires_action", requiresActionReason: "后续核验发现需要处理" }), { code: "MANUAL_EXECUTION_REPORT_CORRECTION_REQUIRED" });

  const correction = await state.service.submitReport({ ...actor, attemptId: state.attempt.id, reportId: "report-gate-2", idempotencyKey: "report-gate-2-key",
    supersedesReportId: first.report.id, outcome: "requires_action", requiresActionReason: "后续核验发现需要处理" });
  assert.equal(correction.report.report_version, 2);
  await assert.rejects(state.service.submitReport({ ...actor, attemptId: state.attempt.id, reportId: "report-gate-old", idempotencyKey: "report-gate-old-key",
    supersedesReportId: first.report.id, outcome: "requires_action", requiresActionReason: "再次处理" }), { code: "MANUAL_EXECUTION_REPORT_NOT_LATEST" });
  await assert.rejects(state.service.submitReport({ ...actor, attemptId: state.attempt.id, reportId: "report-gate-3", idempotencyKey: "report-gate-3-key",
    outcome: "requires_action", requiresActionReason: "没有声明更正来源" }), { code: "MANUAL_EXECUTION_REPORT_CORRECTION_REQUIRED" });
  const latestCorrection = await state.service.submitReport({ ...actor, attemptId: state.attempt.id, reportId: "report-gate-3", idempotencyKey: "report-gate-3-key",
    supersedesReportId: correction.report.id, outcome: "requires_action", requiresActionReason: "已补充处理说明" });
  assert.equal(latestCorrection.report.report_version, 3);
});

test("report corrections cannot write cancelled or superseded attempts, and terminal failures require explicit correction", async () => {
  const cancelled = await runningWorld();
  await cancelled.service.requestOrderCancellation({ ...actor, productionOrderId: cancelled.order.id, idempotencyKey: "cancel-report-state" });
  const stopped = await cancelled.service.submitReport({ ...actor, attemptId: cancelled.attempt.id, reportId: "cancel-report-state-1", idempotencyKey: "cancel-report-state-1-key", outcome: "cancelled" });
  assert.equal(stopped.attempt.status, "cancelled");
  await assert.rejects(cancelled.service.submitReport({ ...actor, attemptId: cancelled.attempt.id, reportId: "cancel-report-state-2", idempotencyKey: "cancel-report-state-2-key", outcome: "completed" }), { code: "MANUAL_EXECUTION_REPORT_CORRECTION_REQUIRED" });
  await assert.rejects(cancelled.service.submitReport({ ...actor, attemptId: cancelled.attempt.id, reportId: "cancel-report-state-3", idempotencyKey: "cancel-report-state-3-key", supersedesReportId: stopped.report.id, outcome: "completed" }), { code: "MANUAL_EXECUTION_REPORT_CORRECTION_BLOCKED" });

  const failed = await runningWorld();
  const failedReport = await failed.service.submitReport({ ...actor, attemptId: failed.attempt.id, reportId: "failed-report-state-1", idempotencyKey: "failed-report-state-1-key",
    outcome: "failed", errorCategory: "input_or_business", failureStage: "人工制作", retryability: "not_retryable" });
  await assert.rejects(failed.service.submitReport({ ...actor, attemptId: failed.attempt.id, reportId: "failed-report-state-2", idempotencyKey: "failed-report-state-2-key",
    outcome: "failed", errorCategory: "input_or_business", failureStage: "人工制作", retryability: "not_retryable" }), { code: "MANUAL_EXECUTION_REPORT_CORRECTION_REQUIRED" });
  const failedCorrection = await failed.service.submitReport({ ...actor, attemptId: failed.attempt.id, reportId: "failed-report-state-2", idempotencyKey: "failed-report-state-2-key",
    supersedesReportId: failedReport.report.id, outcome: "failed", errorCategory: "input_or_business", failureStage: "人工制作（补充）", retryability: "not_retryable" });
  assert.equal(failedCorrection.attempt.status, "failed");

  const superseded = await runningWorld();
  await superseded.service.submitReport({ ...actor, attemptId: superseded.attempt.id, reportId: "superseded-report-state-1", idempotencyKey: "superseded-report-state-1-key",
    outcome: "failed", errorCategory: "technical", failureStage: "人工制作", retryability: "retryable" });
  await superseded.service.reenterFailedAttempt({ ...actor, attemptId: superseded.attempt.id, idempotencyKey: "superseded-reentry" });
  await assert.rejects(superseded.service.submitReport({ ...actor, attemptId: superseded.attempt.id, reportId: "superseded-report-state-2", idempotencyKey: "superseded-report-state-2-key",
    supersedesReportId: "superseded-report-state-1", outcome: "failed", errorCategory: "technical", failureStage: "人工制作", retryability: "retryable" }), { code: "MANUAL_EXECUTION_REPORT_CORRECTION_BLOCKED" });
});

test("report fingerprint includes completedAt and permission boundaries remain explicit", async () => {
  const state = await runningWorld();
  const candidate = await primaryCandidate(state, "fingerprint");
  const first = await state.service.submitReport({ ...actor, attemptId: state.attempt.id, reportId: "fingerprint-report", idempotencyKey: "fingerprint-key",
    outcome: "completed", completedAt: "2026-08-08T10:02:00.000Z", primaryCandidateId: candidate.id, deviations: [] });
  await assert.rejects(state.service.submitReport({ ...actor, attemptId: state.attempt.id, reportId: first.report.id, idempotencyKey: "fingerprint-key",
    outcome: "completed", completedAt: "2026-08-08T10:02:01.000Z", primaryCandidateId: candidate.id, deviations: [] }), { code: "IDEMPOTENCY_CONFLICT" });

  const permission = await runningWorld();
  const otherMember = { organizationId: actor.organizationId, actorMemberId: "member-b", actorRole: "member" };
  await assert.rejects(permission.service.confirmStart({ ...otherMember, attemptId: permission.attempt.id, idempotencyKey: "other-member-start" }), { code: "MANUAL_EXECUTION_FORBIDDEN" });
  await assert.rejects(permission.service.createCandidateUploadAuthorization({ ...otherMember, attemptId: permission.attempt.id, role: "primary_video",
    originalFilename: "other.mp4", mediaType: "video/mp4", size: 3, checksum: "a".repeat(64), idempotencyKey: "other-member-upload" }), { code: "MANUAL_EXECUTION_FORBIDDEN" });
  await assert.rejects(permission.service.submitReport({ ...otherMember, attemptId: permission.attempt.id, reportId: "other-member-report", idempotencyKey: "other-member-report-key",
    outcome: "requires_action", requiresActionReason: "越权提交" }), { code: "MANUAL_EXECUTION_FORBIDDEN" });
  const admin = { organizationId: actor.organizationId, actorMemberId: "admin-a", actorRole: "admin" };
  const adminCandidate = await permission.service.createCandidateUploadAuthorization({ ...admin, attemptId: permission.attempt.id, role: "primary_video",
    originalFilename: "admin.mp4", mediaType: "video/mp4", size: 3, checksum: "b".repeat(64), idempotencyKey: "admin-upload" });
  assert.equal(adminCandidate.candidate.uploaded_by_member_id, admin.actorMemberId);
  const adminReport = await permission.service.submitReport({ ...admin, attemptId: permission.attempt.id, reportId: "admin-report", idempotencyKey: "admin-report-key",
    outcome: "requires_action", requiresActionReason: "管理员记录待处理事项" });
  assert.equal(adminReport.attempt.status, "requires_action");
  await assert.rejects(permission.service.getExecutionWorkspace({ organizationId: "org-b", actorMemberId: "member-b", actorRole: "member", productionOrderId: permission.order.id }), { code: "PRODUCTION_ORDER_NOT_FOUND" });
});

test("candidate authorization enforces the configured bounded size", async () => {
  const state = await runningWorld({ maxCandidateBytes: 1024 });
  await assert.rejects(state.service.createCandidateUploadAuthorization({ ...actor, attemptId: state.attempt.id, role: "primary_video",
    originalFilename: "too-large.mp4", mediaType: "video/mp4", size: 1025, checksum: "c".repeat(64), idempotencyKey: "too-large" }), { code: "MANUAL_EXECUTION_CANDIDATE_SIZE_INVALID" });
});
