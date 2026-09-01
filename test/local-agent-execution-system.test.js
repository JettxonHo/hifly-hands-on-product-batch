import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createLocalAgentExecutionService } from "../src/local-agent-execution/local-agent-execution-service.js";
import { HIFLY_VERIFICATION_RESULT, createEvidenceRecord } from "../src/execution-contracts/hifly-hands-on-product-evidence.js";
import { createMemoryManualExecutionRepository } from "../src/manual-execution/memory-manual-execution-repository.js";
import { createMemoryWorkVerificationRepository } from "../src/work-verification/memory-work-verification-repository.js";
import { createVerifiedOutputAssetPort } from "../src/work-verification/verified-output-asset-port.js";
import { createWorkVerificationService } from "../src/work-verification/work-verification-service.js";

const ORGANIZATION_ID = "org-agent-system";
const AGENT_ID = "agent-system-1";
const MEMBER_ID = "member-order-owner";
const ORDER_ID = "order-agent-system";
const PACKAGE_ID = "package-agent-system";

const clone = (value) => value == null ? value : structuredClone(value);

function createWorld({ maxCandidateBytes = 1024 } = {}) {
  let clock = Date.parse("2026-08-10T00:00:00.000Z");
  const order = {
    id: ORDER_ID, organization_id: ORGANIZATION_ID, status: "waiting_for_executor", row_version: 1,
    product_id: "product-agent-system", video_plan_version_id: "plan-agent-system", created_by_member_id: MEMBER_ID,
    input_snapshot: {
      video_plan_version: { id: "plan-agent-system" },
      approved_copy_snapshot: { copy_version_id: "copy-agent-system" },
      avatar_selection_snapshot: { avatar_asset_version_id: "avatar-agent-system" },
      production_config_snapshot: { mode: "fake" }
    }, status_history: []
  };
  const packageRecord = {
    id: PACKAGE_ID, organization_id: ORGANIZATION_ID, production_order_id: ORDER_ID, package_version: 1,
    manifest_hash: "manifest-agent-system", package_hash: "package-agent-system", status: "ready",
    manifest: { accepted_media_types: ["video/mp4"], expected_quantity: 1 }
  };
  const executionRepository = createMemoryManualExecutionRepository();
  const candidateStore = createMemoryObjectStore();
  const verificationRepository = createMemoryWorkVerificationRepository();
  const assetRepository = createMemoryAssetRepository();

  const transitionOrder = async (input) => {
    if (input.organizationId !== ORGANIZATION_ID || input.orderId !== ORDER_ID || order.row_version !== input.expectedRevision || !input.fromStatuses.includes(order.status)) return null;
    const previous = clone(order);
    order.status = input.toStatus;
    order.row_version += 1;
    order.updated_at = input.at;
    order.status_history = [...(order.status_history || []), { from_status: previous.status, to_status: order.status, at: input.at,
      actor_member_id: input.actorMemberId || null, actor_agent_id: input.actorAgentId || null, reason: input.reason || null }];
    input.transactionClient?.onRollback?.(() => Object.assign(order, previous));
    return clone(order);
  };
  const orderPort = {
    async getOrder(input) { return input.organizationId === ORGANIZATION_ID && input.orderId === ORDER_ID ? clone(order) : null; },
    async getOrderForAgent(input) { assert.equal(input.actorAgentId, AGENT_ID); return input.organizationId === ORGANIZATION_ID && input.orderId === ORDER_ID ? clone(order) : null; },
    async listOrdersForAgent(input) { assert.equal(input.actorAgentId, AGENT_ID); return input.organizationId === ORGANIZATION_ID ? [clone(order)] : []; },
    async transitionOrder(input) { return transitionOrder(input); },
    async transitionOrderForAgent(input) { assert.equal(input.actorAgentId, AGENT_ID); return transitionOrder({ ...input, actorMemberId: null }); }
  };
  const packagePort = {
    async getPackage(input) { return input.organizationId === ORGANIZATION_ID && input.packageId === PACKAGE_ID ? clone(packageRecord) : null; },
    async getPackageForAgent(input) { assert.equal(input.agentId, AGENT_ID); return input.organizationId === ORGANIZATION_ID && input.packageId === PACKAGE_ID ? clone(packageRecord) : null; },
    async listPackagesForAgent(input) { assert.equal(input.agentId, AGENT_ID); return input.organizationId === ORGANIZATION_ID && input.productionOrderId === ORDER_ID ? [clone(packageRecord)] : []; },
    async downloadPackageForAgent() { return { body: Buffer.from("package"), contentType: "application/zip" }; }
  };
  const verificationService = createWorkVerificationService({ repository: verificationRepository, orderPort,
    executionPort: executionRepository, packagePort, objectStore: candidateStore,
    verifiedOutputAssetPort: createVerifiedOutputAssetPort({ repository: assetRepository }), now: () => clock });
  let verificationRequests = 0;
  const service = createLocalAgentExecutionService({ repository: executionRepository, orderPort, packagePort, candidateStore,
    maxCandidateBytes, organizationId: ORGANIZATION_ID, agentId: AGENT_ID, leaseMs: 10_000, now: () => clock,
    verificationPort: {
      async requestVerification(input) { verificationRequests += 1; return verificationService.requestVerification(input); },
      async getLatestVerificationJob(organizationId, productionOrderId) { return verificationRepository.getLatestVerificationJob(organizationId, productionOrderId); }
    }
  });
  return { service, executionRepository, verificationRepository, candidateStore, order, packageRecord,
    advance(ms) { clock += ms; }, verificationService, get verificationRequests() { return verificationRequests; } };
}

async function runningWorld(options = {}) {
  const world = createWorld(options);
  const claimed = await world.service.claimTask({ idempotencyKey: "system-claim" });
  await world.service.startTask({ attemptId: claimed.attempt.id, idempotencyKey: "system-start" });
  return { world, attemptId: claimed.attempt.id };
}

test("agent result report queues A12 exactly once and only verification creates Work/order success", async () => {
  const { world, attemptId } = await runningWorld();
  const body = Buffer.from("fake-mp4");
  const checksum = createHash("sha256").update(body).digest("hex");
  const authorization = await world.service.createCandidateUploadAuthorization({ attemptId, role: "primary_video",
    originalFilename: "result.mp4", mediaType: "video/mp4", size: body.length, checksum, idempotencyKey: "system-authorize" });
  const candidateId = authorization.candidate.id;
  await world.service.uploadCandidateObject({ candidateId, body, contentType: "video/mp4", idempotencyKey: "system-upload" });
  const completed = await world.service.completeCandidateUpload({ attemptId, candidateId, idempotencyKey: "system-complete" });
  assert.equal(completed.candidate.status, "uploaded");

  const reportInput = { attemptId, reportId: "a0000000-0000-4000-8000-000000000010", outcome: "completed", primaryCandidateId: candidateId, idempotencyKey: "system-report" };
  const report = await world.service.submitReport(reportInput);
  assert.equal(report.replayed, false);
  assert.equal(report.attempt.status, "succeeded");
  assert.equal(report.report.submitted_by, null);
  assert.equal(report.report.submitted_by_agent_id, AGENT_ID);
  assert.equal(world.order.status, "running");
  const jobs = await world.verificationRepository.listVerificationJobs(ORGANIZATION_ID, ORDER_ID);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].requested_by_member_id, MEMBER_ID);
  assert.equal(report.report.submitted_by_agent_id, AGENT_ID);
  assert.equal(world.verificationRequests, 1);

  const replay = await world.service.submitReport(reportInput);
  assert.equal(replay.replayed, true);
  assert.equal(world.verificationRequests, 1);
  assert.equal((await world.verificationRepository.listVerificationJobs(ORGANIZATION_ID, ORDER_ID)).length, 1);

  const verified = await world.verificationService.runNextVerificationJob();
  assert.equal(verified.job.verification_status, "passed");
  assert.equal((await world.verificationRepository.listWorks(ORGANIZATION_ID, ORDER_ID)).length, 1);
  assert.equal(world.order.status, "succeeded");
  const candidate = await world.executionRepository.getCandidate(ORGANIZATION_ID, candidateId);
  assert.equal(candidate.uploaded_by_member_id, null);
  assert.equal(candidate.uploaded_by_agent_id, AGENT_ID);
  const audits = await world.executionRepository.listAuditEvents(ORGANIZATION_ID);
  assert.ok(audits.some((event) => event.event_type === "local_agent.report_submitted" && event.actor_agent_id === AGENT_ID));
});

test("agent result binding and media/size gates reject unsafe inputs", async () => {
  const { world, attemptId } = await runningWorld({ maxCandidateBytes: 4 });
  const checksum = "a".repeat(64);
  await assert.rejects(() => world.service.submitReport({ attemptId, reportId: "not-a-uuid", outcome: "failed", errorCode: "LOCAL_EXECUTOR_ERROR", idempotencyKey: "invalid-report-id" }), { code: "LOCAL_AGENT_REPORT_ID_INVALID" });
  await assert.rejects(() => world.service.createCandidateUploadAuthorization({ organizationId: "other-org", executorAgentId: AGENT_ID,
    attemptId, role: "primary_video", originalFilename: "bad.mp4", mediaType: "video/mp4", size: 4, checksum, idempotencyKey: "wrong-org" }), { code: "LOCAL_AGENT_CONTEXT_REQUIRED" });
  await assert.rejects(() => world.service.createCandidateUploadAuthorization({ attemptId: "other-attempt", role: "primary_video",
    originalFilename: "bad.mp4", mediaType: "video/mp4", size: 4, checksum, idempotencyKey: "wrong-attempt" }), { code: "LOCAL_AGENT_ATTEMPT_NOT_FOUND" });
  await assert.rejects(() => world.service.createCandidateUploadAuthorization({ attemptId, role: "primary_video",
    originalFilename: "bad.webm", mediaType: "video/webm", size: 4, checksum, idempotencyKey: "wrong-media" }), { code: "LOCAL_AGENT_CANDIDATE_MEDIA_TYPE_INVALID" });
  await assert.rejects(() => world.service.createCandidateUploadAuthorization({ attemptId, role: "primary_video",
    originalFilename: "large.mp4", mediaType: "video/mp4", size: 5, checksum, idempotencyKey: "too-large" }), { code: "LOCAL_AGENT_CANDIDATE_SIZE_INVALID" });
  world.packageRecord.manifest_hash = "changed-manifest";
  await assert.rejects(() => world.service.createCandidateUploadAuthorization({ attemptId, role: "primary_video",
    originalFilename: "bad.mp4", mediaType: "video/mp4", size: 4, checksum, idempotencyKey: "wrong-package" }), { code: "LOCAL_AGENT_PACKAGE_MISMATCH" });
});

test("expired lease and controlled failure reports never create verification or Work", async () => {
  const requiresAction = await runningWorld();
  requiresAction.world.advance(11_000);
  await assert.rejects(() => requiresAction.world.service.createCandidateUploadAuthorization({ attemptId: requiresAction.attemptId, role: "primary_video",
    originalFilename: "expired.mp4", mediaType: "video/mp4", size: 4, checksum: "a".repeat(64), idempotencyKey: "expired-authorize" }), { code: "LOCAL_AGENT_LEASE_EXPIRED" });
  assert.equal(requiresAction.world.order.status, "requires_action");

  const action = await runningWorld();
  const actionReport = await action.world.service.submitReport({ attemptId: action.attemptId, reportId: "a0000000-0000-4000-8000-000000000011",
    outcome: "requires_action", reasonCode: "LOGIN_REQUIRED", failureStage: "post_handheld_pre_video", idempotencyKey: "requires-action-report", message: "remote secret text",
    evidence: [createEvidenceRecord({ field: "handheld_aspect_ratio", expected: "9:16", actual: "1600x2848",
      evidenceSource: "generated_artifact_natural_dimensions", verificationStage: "post_handheld_pre_video",
      paidBoundary: "after_paid_action_1_before_paid_action_2", result: HIFLY_VERIFICATION_RESULT.FAIL_EXACT_MATCH })] });
  assert.equal(actionReport.report.requires_action_reason, "本地执行器需要人工重新登录。");
  assert.equal("message" in actionReport.report, false);
  assert.equal(actionReport.report.supporting_outputs[0].kind, "production_evidence");
  assert.equal(actionReport.report.supporting_outputs[0].evidence[0].actual, "1600x2848");
  assert.equal(actionReport.report.failure_stage, "post_handheld_pre_video");
  assert.equal(action.world.order.status, "requires_action");
  assert.equal((await action.world.verificationRepository.listVerificationJobs(ORGANIZATION_ID, ORDER_ID)).length, 0);

  for (const [reasonCode, expectedReason] of [
    ["AVATAR_MAPPING_REQUIRED", "人物映射缺失，需要人工补充后再执行。"],
    ["PACKAGE_ITEM_COUNT_UNSUPPORTED", "交接包包含不支持的商品数量，需要人工核对。"]
  ]) {
    const mapped = await runningWorld();
    const mappedReport = await mapped.world.service.submitReport({ attemptId: mapped.attemptId,
      reportId: `a0000000-0000-4000-8000-00000000001${reasonCode === "AVATAR_MAPPING_REQUIRED" ? "3" : "4"}`,
      outcome: "requires_action", reasonCode, message: "untrusted remote detail", idempotencyKey: `mapped-${reasonCode}` });
    assert.equal(mappedReport.report.requires_action_reason, expectedReason);
    assert.equal("message" in mappedReport.report, false);
    assert.equal(mappedReport.attempt.status, "requires_action");
    assert.equal(mapped.world.order.status, "requires_action");
  }

  const failed = await runningWorld();
  const failedReport = await failed.world.service.submitReport({ attemptId: failed.attemptId, reportId: "a0000000-0000-4000-8000-000000000012",
    outcome: "failed", errorCode: "PROVIDER_EXECUTION_FAILED", idempotencyKey: "failed-report", errorMessage: "untrusted remote error" });
  assert.equal(failedReport.report.failure_stage, "provider_execution");
  assert.equal(failedReport.report.retryability, "not_retryable");
  assert.equal("errorMessage" in failedReport.report, false);
  assert.equal(failed.world.order.status, "failed");
  assert.equal((await failed.world.verificationRepository.listVerificationJobs(ORGANIZATION_ID, ORDER_ID)).length, 0);

  const localFailed = await runningWorld();
  const localFailedReport = await localFailed.world.service.submitReport({ attemptId: localFailed.attemptId,
    reportId: "a0000000-0000-4000-8000-000000000015", outcome: "failed", errorCode: "LOCAL_EXECUTION_FAILED",
    errorMessage: "untrusted remote detail", idempotencyKey: "local-failed-report" });
  assert.equal(localFailedReport.report.failure_stage, "local_executor");
  assert.equal(localFailedReport.report.retryability, "not_retryable");
  assert.equal("errorMessage" in localFailedReport.report, false);
  assert.equal(localFailedReport.attempt.status, "failed");
  assert.equal(localFailed.world.order.status, "failed");
});
