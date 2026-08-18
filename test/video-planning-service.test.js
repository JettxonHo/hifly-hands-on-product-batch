import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryVideoPlanningRepository } from "../src/video-planning/memory-video-planning-repository.js";
import { createControlledPreflightEvaluator } from "../src/video-planning/controlled-preflight-evaluator.js";
import { createVideoPlanningService } from "../src/video-planning/video-planning-service.js";
import { createPreflightWorker } from "../src/video-planning/preflight-worker.js";

const actor = { organizationId: "org-a", actorMemberId: "member-a", actorRole: "member", productId: "product-a" };

function world({ agentOnline = false, productionOrdersEnabled = false, evaluate, upstreamOverrides = {} } = {}) {
  const upstream = {
    product_revision_id: "revision-a",
    copy_version_id: "copy-a",
    avatar_selection_id: "selection-a",
    avatar_asset_version_id: "avatar-version-a",
    current_valid: true,
    ...upstreamOverrides
  };
  const capability = { snapshot_version: "phase-1-controlled-v1",
    verified_capabilities: [{ code: "mandarin_speech", evidence_reference: "seed:mandarin_speech" }] };
  const repository = createMemoryVideoPlanningRepository();
  const service = createVideoPlanningService({ repository,
    upstreamPort: { async resolveCurrent() { return structuredClone(upstream); } },
    capabilitySnapshotPort: { async resolve() { return structuredClone(capability); } },
    agentReadinessPort: { async isOnline() { return agentOnline; } },
    productionOrdersEnabled,
    now: () => Date.parse("2026-08-07T12:00:00.000Z") });
  const worker = createPreflightWorker({ service, evaluator: createControlledPreflightEvaluator({ evaluate }) });
  return { repository, service, worker, upstream, capability };
}

async function createAndPreflight(state, suffix = "one", outputInstructions = "竖版商品种草口播，突出核心卖点。") {
  const created = await state.service.createPlan({ ...actor, outputInstructions, expectedHeadRevision: 0,
    idempotencyKey: `create-${suffix}` });
  const requested = await state.service.requestPreflight({ ...actor, planId: created.current_plan.id,
    expectedRevision: created.current_plan.row_version, idempotencyKey: `preflight-${suffix}` });
  await state.worker.runNext();
  return state.service.getWorkspace(actor);
}

test("creates a plan with the canonical Hifly presentation size", async () => {
  const state = world();
  const created = await state.service.createPlan({ ...actor, outputInstructions: "首版制作说明",
    presentationSizeCode: "small", expectedHeadRevision: 0, idempotencyKey: "create-presentation-size" });
  assert.equal(created.current_plan.presentation_size_code, "small");
});

test("creates an immutable draft snapshot and derives edits from frozen plans", async () => {
  const state = world();
  const first = await state.service.createPlan({ ...actor, outputInstructions: "首版制作说明", expectedHeadRevision: 0,
    idempotencyKey: "create-plan" });
  assert.equal(first.current_plan.status, "draft");
  assert.deepEqual(first.current_plan.upstream_snapshot, {
    product_revision_id: "revision-a", copy_version_id: "copy-a", avatar_selection_id: "selection-a",
    avatar_asset_version_id: "avatar-version-a"
  });
  assert.equal(first.current_plan.capability_config_snapshot.snapshot_version, "phase-1-controlled-v1");

  const replay = await state.service.createPlan({ ...actor, outputInstructions: "首版制作说明", expectedHeadRevision: 0,
    idempotencyKey: "create-plan" });
  assert.equal(replay.current_plan.id, first.current_plan.id);
  await assert.rejects(state.service.createPlan({ ...actor, outputInstructions: "不同内容", expectedHeadRevision: 0,
    idempotencyKey: "create-plan" }), { code: "IDEMPOTENCY_CONFLICT" });

  const queued = await state.service.requestPreflight({ ...actor, planId: first.current_plan.id,
    expectedRevision: first.current_plan.row_version, idempotencyKey: "freeze" });
  assert.equal(queued.current_plan.status, "frozen");
  await assert.rejects(state.service.saveDraft({ ...actor, planId: first.current_plan.id,
    outputInstructions: "不能原地覆盖", expectedRevision: queued.current_plan.row_version }),
  { code: "VIDEO_PLAN_IMMUTABLE" });

  const derived = await state.service.deriveDraft({ ...actor, planId: first.current_plan.id,
    outputInstructions: "基于首版修改", expectedHeadRevision: 1, idempotencyKey: "derive" });
  assert.notEqual(derived.current_plan.id, first.current_plan.id);
  assert.equal(derived.current_plan.parent_plan_version_id, first.current_plan.id);
  assert.equal(derived.versions.find((item) => item.id === first.current_plan.id).status, "superseded");
});

test("preflight warning remains reviewable when Local Agent is offline and passed never auto-approves", async () => {
  const state = world({ agentOnline: false });
  let workspace = await createAndPreflight(state);
  assert.equal(workspace.preflight.current_run.status, "succeeded");
  assert.equal(workspace.preflight.current_result.status, "warning");
  assert.equal(workspace.preflight.current_result.groups.production_readiness.status, "warning");
  assert.match(workspace.preflight.current_result.groups.production_readiness.checks[0].message, /不影响方案审核/);
  assert.equal(workspace.review.current_review, null);
  assert.equal(workspace.review.gate.can_submit, true);

  workspace = await state.service.submitReview({ ...actor, planId: workspace.current_plan.id,
    idempotencyKey: "submit-review" });
  assert.equal(workspace.review.current_review.status, "pending");
  assert.equal(workspace.preflight.current_result.status, "warning");
  workspace = await state.service.approveReview({ ...actor, reviewId: workspace.review.current_review.id,
    expectedRevision: 1, idempotencyKey: "approve-review" });
  assert.equal(workspace.review.current_review.status, "approved");
  assert.equal(workspace.production_order_available, false);
});

test("production order availability is projected only for an enabled current approved valid plan", async () => {
  const state = world({ productionOrdersEnabled: true });
  let workspace = await createAndPreflight(state, "production-available");
  assert.equal(workspace.production_order_available, false);
  assert.equal(workspace.production_order_notice, "当前方案尚未满足生产工单创建条件。");

  workspace = await state.service.submitReview({ ...actor, planId: workspace.current_plan.id, idempotencyKey: "production-submit" });
  workspace = await state.service.approveReview({ ...actor, reviewId: workspace.review.current_review.id,
    expectedRevision: 1, idempotencyKey: "production-approve" });
  assert.equal(workspace.production_order_available, true);
  assert.equal(workspace.production_order_notice, "当前方案已批准，可以进入生产工单。");

  const historicalState = world({ productionOrdersEnabled: true });
  let historical = await createAndPreflight(historicalState, "production-history");
  historical = await historicalState.service.submitReview({ ...actor, planId: historical.current_plan.id, idempotencyKey: "history-submit" });
  historical = await historicalState.service.approveReview({ ...actor, reviewId: historical.review.current_review.id,
    expectedRevision: 1, idempotencyKey: "history-approve" });
  await historicalState.service.deriveDraft({ ...actor, planId: historical.current_plan.id,
    outputInstructions: "基于已批准方案创建新版本", expectedHeadRevision: historical.head_revision, idempotencyKey: "history-derive" });
  const historicalWorkspace = await historicalState.service.getWorkspace({ ...actor, planId: historical.current_plan.id });
  assert.equal(historicalWorkspace.production_order_available, false);

  state.upstream.copy_version_id = "copy-invalidated";
  const invalidated = await state.service.getWorkspace(actor);
  assert.equal(invalidated.preflight.current_result.status, "invalidated");
  assert.equal(invalidated.production_order_available, false);
});

test("production-enabled empty workspace is safe before the first plan exists", async () => {
  const state = world({ productionOrdersEnabled: true });
  const workspace = await state.service.getWorkspace(actor);
  assert.equal(workspace.current_plan, null);
  assert.equal(workspace.production_order_available, false);
  assert.equal(workspace.production_order_notice, "当前方案尚未满足生产工单创建条件。");
});

test("technical preflight failure does not create a blocked business result", async () => {
  const state = world({ evaluate: async () => { throw Object.assign(new Error("offline evaluator"),
    { code: "PREFLIGHT_EVALUATION_FAILED" }); } });
  const created = await state.service.createPlan({ ...actor, outputInstructions: "完整说明", expectedHeadRevision: 0,
    idempotencyKey: "create-tech-fail" });
  await state.service.requestPreflight({ ...actor, planId: created.current_plan.id,
    expectedRevision: created.current_plan.row_version, idempotencyKey: "run-tech-fail" });
  await state.worker.runNext();
  const workspace = await state.service.getWorkspace(actor);
  assert.equal(workspace.preflight.current_run.status, "failed");
  assert.equal(workspace.preflight.current_run.failure_code, "PREFLIGHT_EVALUATION_FAILED");
  assert.equal(workspace.preflight.current_result, null);
  assert.equal(workspace.review.gate.can_submit, false);
});

test("business hard blocks are separate results and prevent review", async () => {
  const state = world({ evaluate: async () => ({ groups: {
    upstream_validity: { status: "blocked", checks: [{ code: "copy_invalid", status: "blocked", message: "文案批准已失效" }] },
    plan_completeness: { status: "passed", checks: [] },
    production_readiness: { status: "passed", checks: [] }
  } }) });
  const workspace = await createAndPreflight(state, "blocked");
  assert.equal(workspace.preflight.current_run.status, "succeeded");
  assert.equal(workspace.preflight.current_result.status, "blocked");
  await assert.rejects(state.service.submitReview({ ...actor, planId: workspace.current_plan.id,
    idempotencyKey: "blocked-submit" }), { code: "VIDEO_PLAN_REVIEW_GATE_BLOCKED" });
});

test("review has one pending cycle, commands are idempotent, and changes require a new plan", async () => {
  const state = world({ agentOnline: true });
  let workspace = await createAndPreflight(state, "review");
  const submitted = await state.service.submitReview({ ...actor, planId: workspace.current_plan.id,
    idempotencyKey: "submit-once" });
  const replay = await state.service.submitReview({ ...actor, planId: workspace.current_plan.id,
    idempotencyKey: "submit-once" });
  assert.equal(replay.review.current_review.id, submitted.review.current_review.id);
  await assert.rejects(state.service.submitReview({ ...actor, planId: workspace.current_plan.id,
    idempotencyKey: "submit-again" }), { code: "VIDEO_PLAN_REVIEW_ACTIVE_EXISTS" });
  workspace = await state.service.requestChanges({ ...actor, reviewId: submitted.review.current_review.id,
    expectedRevision: 1, reason: "补充更明确的镜头节奏", idempotencyKey: "changes" });
  assert.equal(workspace.review.current_review.status, "changes_requested");
  await assert.rejects(state.service.submitReview({ ...actor, planId: workspace.current_plan.id,
    idempotencyKey: "same-plan-resubmit" }), { code: "VIDEO_PLAN_REVIEW_GATE_BLOCKED" });
  await assert.rejects(state.service.approveReview({ ...actor, reviewId: submitted.review.current_review.id,
    expectedRevision: 2, idempotencyKey: "approve-old" }), { code: "VIDEO_PLAN_REVIEW_CONFLICT" });
});

test("review decisions replay the current server projection and reject conflicting payloads", async () => {
  const state = world({ agentOnline: true });
  let workspace = await createAndPreflight(state, "decision-replay");
  workspace = await state.service.submitReview({ ...actor, planId: workspace.current_plan.id,
    idempotencyKey: "decision-replay-submit" });
  const reviewId = workspace.review.current_review.id;
  const approved = await state.service.approveReview({ ...actor, reviewId, expectedRevision: 1,
    idempotencyKey: "decision-replay-approve" });
  const replayed = await state.service.approveReview({ ...actor, reviewId, expectedRevision: 1,
    idempotencyKey: "decision-replay-approve" });
  assert.equal(replayed.review.current_review.id, approved.review.current_review.id);
  assert.equal(replayed.review.current_review.status, "approved");
  await assert.rejects(state.service.approveReview({ ...actor, reviewId, expectedRevision: 2,
    idempotencyKey: "decision-replay-approve" }), { code: "IDEMPOTENCY_CONFLICT" });

  state.capability.verified_capabilities[0].evidence_reference = "seed:mandarin-speech-v2";
  const currentReplay = await state.service.approveReview({ ...actor, reviewId, expectedRevision: 1,
    idempotencyKey: "decision-replay-approve" });
  assert.equal(currentReplay.preflight.current_result.status, "invalidated");
  assert.equal(currentReplay.review.current_review.status, "revoked");
});

test("request changes decision is safely replayed after the review leaves pending", async () => {
  const state = world({ agentOnline: true });
  let workspace = await createAndPreflight(state, "changes-replay");
  workspace = await state.service.submitReview({ ...actor, planId: workspace.current_plan.id,
    idempotencyKey: "changes-replay-submit" });
  const input = { ...actor, reviewId: workspace.review.current_review.id, expectedRevision: 1,
    reason: "补充镜头节奏", idempotencyKey: "changes-replay" };
  const changed = await state.service.requestChanges(input);
  const replayed = await state.service.requestChanges(input);
  assert.equal(changed.review.current_review.status, "changes_requested");
  assert.equal(replayed.review.current_review.status, "changes_requested");
});

test("relevant upstream changes invalidate preflight and revoke approval while metadata does not", async () => {
  const state = world({ agentOnline: true });
  let workspace = await createAndPreflight(state, "invalidate");
  workspace = await state.service.submitReview({ ...actor, planId: workspace.current_plan.id,
    idempotencyKey: "invalidate-submit" });
  workspace = await state.service.approveReview({ ...actor, reviewId: workspace.review.current_review.id,
    expectedRevision: 1, idempotencyKey: "invalidate-approve" });
  assert.equal(workspace.review.current_review.status, "approved");

  await state.service.reconcilePlan({ ...actor, planId: workspace.current_plan.id,
    changeKind: "display_metadata", idempotencyKey: "metadata-only" });
  workspace = await state.service.getWorkspace(actor);
  assert.equal(workspace.review.current_review.status, "approved");

  state.upstream.copy_version_id = "copy-b";
  await state.service.reconcilePlan({ ...actor, planId: workspace.current_plan.id,
    changeKind: "copy_version", idempotencyKey: "copy-changed" });
  workspace = await state.service.getWorkspace(actor);
  assert.equal(workspace.preflight.current_result.status, "invalidated");
  assert.equal(workspace.review.current_review.status, "revoked");
  await assert.rejects(state.service.approveReview({ ...actor, reviewId: workspace.review.current_review.id,
    expectedRevision: workspace.review.current_review.row_version, idempotencyKey: "restore-revoked" }),
  { code: "VIDEO_PLAN_REVIEW_CONFLICT" });
});

test("capability Evidence changes invalidate approval while display metadata does not", async () => {
  const state = world({ agentOnline: true, upstreamOverrides: { display_name: "人物甲" } });
  let workspace = await createAndPreflight(state, "capability-invalidate");
  workspace = await state.service.submitReview({ ...actor, planId: workspace.current_plan.id,
    idempotencyKey: "capability-submit" });
  workspace = await state.service.approveReview({ ...actor, reviewId: workspace.review.current_review.id,
    expectedRevision: 1, idempotencyKey: "capability-approve" });
  state.upstream.display_name = "人物甲（新展示名）";
  workspace = await state.service.getWorkspace(actor);
  assert.equal(workspace.review.current_review.status, "approved");

  state.capability.verified_capabilities.push({ code: "handheld_product",
    evidence_reference: "seed:handheld-product" });
  workspace = await state.service.getWorkspace(actor);
  assert.equal(workspace.preflight.current_result.status, "invalidated");
  assert.equal(workspace.preflight.current_result.invalidation_reason, "capability_snapshot_changed");
  assert.equal(workspace.review.current_review.status, "revoked");
});

test("draft optimistic concurrency and organization scope reject silent or cross-org updates", async () => {
  const state = world();
  const created = await state.service.createPlan({ ...actor, outputInstructions: "原说明", expectedHeadRevision: 0,
    idempotencyKey: "create-concurrency" });
  const saved = await state.service.saveDraft({ ...actor, planId: created.current_plan.id,
    outputInstructions: "新说明", expectedRevision: 1 });
  assert.equal(saved.current_plan.row_version, 2);
  await assert.rejects(state.service.saveDraft({ ...actor, planId: created.current_plan.id,
    outputInstructions: "静默覆盖", expectedRevision: 1 }), { code: "VIDEO_PLAN_CONFLICT" });
  await assert.rejects(state.service.getWorkspace({ ...actor, organizationId: "org-other", planId: created.current_plan.id }),
  { code: "VIDEO_PLAN_NOT_FOUND" });
});

test("exposes a formal current approved plan port for downstream production commands", async () => {
  const state = world({ agentOnline: false });
  let workspace = await createAndPreflight(state, "production-port");
  workspace = await state.service.submitReview({ ...actor, planId: workspace.current_plan.id,
    idempotencyKey: "production-port-submit" });
  workspace = await state.service.approveReview({ ...actor, reviewId: workspace.review.current_review.id,
    expectedRevision: 1, idempotencyKey: "production-port-approve" });

  const resolved = await state.service.resolveCurrentApprovedPlan(actor);
  assert.equal(resolved.current_valid, true);
  assert.equal(resolved.plan.id, workspace.current_plan.id);
  assert.equal(resolved.plan_review.id, workspace.review.current_review.id);
  assert.equal(resolved.preflight_result.status, "warning");
  assert.equal(resolved.gate.can_create, true);

  state.upstream.copy_version_id = "copy-invalidated";
  const invalidated = await state.service.resolveCurrentApprovedPlan(actor);
  assert.equal(invalidated.current_valid, false);
  assert.deepEqual(invalidated.gate.reasons, ["plan_review_not_approved", "preflight_invalidated", "upstream_changed"]);
});
