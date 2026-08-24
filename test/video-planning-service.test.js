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

function pauseNextRepositoryMutation(repository, method) {
  const original = repository[method].bind(repository);
  let release;
  let entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  repository[method] = async (...args) => {
    entered();
    await gate;
    return original(...args);
  };
  return { waiting, release };
}

test("creates a plan with the canonical Hifly presentation size", async () => {
  const state = world();
  const created = await state.service.createPlan({ ...actor, outputInstructions: "首版制作说明",
    presentationSizeCode: "small", expectedHeadRevision: 0, idempotencyKey: "create-presentation-size" });
  assert.equal(created.current_plan.presentation_size_code, "small");
});

test("create and derive replay committed receipts as current server projections", async () => {
  const state = world();
  const createInput = { ...actor, outputInstructions: "首版制作说明", expectedHeadRevision: 0,
    idempotencyKey: "create-current-projection" };
  const createPause = pauseNextRepositoryMutation(state.repository, "updateReceiptResult");
  const creating = state.service.createPlan(createInput);
  await createPause.waiting;
  const createReplay = await state.service.createPlan(createInput);
  createPause.release();
  const created = await creating;
  assert.equal(createReplay.current_plan.id, created.current_plan.id);
  assert.equal(createReplay.current_plan.status, "draft");
  assert.equal((await state.repository.listPlans(actor.organizationId, actor.productId)).length, 1);

  await state.service.requestPreflight({ ...actor, planId: created.current_plan.id,
    expectedRevision: created.current_plan.row_version, idempotencyKey: "create-current-projection-preflight" });
  await state.worker.runNext();
  const deriveInput = { ...actor, planId: created.current_plan.id, outputInstructions: "第二版制作说明",
    expectedHeadRevision: 1, idempotencyKey: "derive-current-projection" };
  const derivePause = pauseNextRepositoryMutation(state.repository, "updateReceiptResult");
  const deriving = state.service.deriveDraft(deriveInput);
  await derivePause.waiting;
  const deriveReplay = await state.service.deriveDraft(deriveInput);
  derivePause.release();
  const derived = await deriving;
  assert.equal(deriveReplay.current_plan.id, derived.current_plan.id);
  assert.equal(deriveReplay.head_revision, 2);
  assert.equal((await state.repository.listPlans(actor.organizationId, actor.productId)).length, 2);

  const createAfterDerive = await state.service.createPlan(createInput);
  assert.equal(createAfterDerive.current_plan.id, created.current_plan.id);
  assert.equal(createAfterDerive.current_plan.status, "superseded");
  assert.equal(createAfterDerive.head_revision, 2);
  await assert.rejects(state.service.deriveDraft({ ...deriveInput, outputInstructions: "不同的第二版" }),
    { code: "IDEMPOTENCY_CONFLICT" });
});

test("preflight replay returns the exact current run after asynchronous completion", async () => {
  const state = world();
  const created = await state.service.createPlan({ ...actor, outputInstructions: "首版制作说明",
    expectedHeadRevision: 0, idempotencyKey: "preflight-current-create" });
  const input = { ...actor, planId: created.current_plan.id, expectedRevision: created.current_plan.row_version,
    idempotencyKey: "preflight-current-run" };
  const queued = await state.service.requestPreflight(input);
  assert.equal(queued.preflight.current_run.status, "queued");
  await state.worker.runNext();
  const replay = await state.service.requestPreflight(input);
  assert.equal(replay.preflight.current_run.id, queued.preflight.current_run.id);
  assert.equal(replay.preflight.current_run.status, "succeeded");
  assert.equal(replay.preflight.current_result.preflight_run_id, queued.preflight.current_run.id);
  await assert.rejects(state.service.requestPreflight({ ...input, expectedRevision: input.expectedRevision + 1 }),
    { code: "IDEMPOTENCY_CONFLICT" });
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

test("review submission replays across the commit-to-projection window and reflects later head truth", async () => {
  const state = world({ agentOnline: true });
  const workspace = await createAndPreflight(state, "submit-replay-window");
  const input = { ...actor, planId: workspace.current_plan.id, idempotencyKey: "submit-replay-window" };
  const pause = pauseNextRepositoryMutation(state.repository, "updateReceiptResult");
  const first = state.service.submitReview(input);
  await pause.waiting;

  const replay = await state.service.submitReview(input);
  assert.equal(replay.review.current_review.status, "pending");
  assert.equal((await state.repository.listReviews(actor.organizationId, workspace.current_plan.id)).length, 1);
  pause.release();
  await first;

  await state.service.deriveDraft({ ...actor, planId: workspace.current_plan.id,
    outputInstructions: "回放后已经存在的新方案", expectedHeadRevision: workspace.head_revision,
    idempotencyKey: "submit-replay-window-derive" });
  const currentReplay = await state.service.submitReview(input);
  assert.equal(currentReplay.current_plan.status, "superseded");
  assert.equal(currentReplay.review.current_review.status, "pending");
});

test("memory preflight ordering uses the PostgreSQL timestamp and id tie-break consistently", async () => {
  const state = world({ agentOnline: true });
  const created = await state.service.createPlan({ ...actor, outputInstructions: "固定时钟方案",
    expectedHeadRevision: 0, idempotencyKey: "tie-create" });
  const at = "2026-08-07T12:00:00.000Z";
  const run = (id) => ({ id, organization_id: actor.organizationId, video_plan_version_id: created.current_plan.id,
    status: "queued", input_snapshot: {}, preflight_result_id: null, failure_code: null, lease_token: null,
    created_by_member_id: actor.actorMemberId, started_at: null, completed_at: null, created_at: at, updated_at: at });
  await state.repository.createRun({ receiptKey: "tie-run-z", fingerprint: "z", run: run("z-old-failed"),
    planId: created.current_plan.id, expectedRevision: created.current_plan.row_version, audit: { id: "audit-z" } });
  const failed = await state.repository.claimNextRun({ now: at, leaseToken: "lease-z" });
  await state.repository.failRun({ runId: failed.id, leaseToken: failed.lease_token,
    failureCode: "CONTROLLED_FAILURE", now: at, audit: { id: "audit-failed-z" } });
  await state.repository.createRun({ receiptKey: "tie-run-a", fingerprint: "a", run: run("a-new-succeeded"),
    planId: created.current_plan.id, expectedRevision: 0, audit: { id: "audit-a" } });
  const succeeded = await state.repository.claimNextRun({ now: at, leaseToken: "lease-a" });
  await state.repository.completeRun({ runId: succeeded.id, leaseToken: succeeded.lease_token, now: at,
    result: { id: "result-a", organization_id: actor.organizationId, video_plan_version_id: created.current_plan.id,
      preflight_run_id: succeeded.id, status: "passed", groups: {}, created_at: at,
      invalidated_at: null, invalidation_reason: null }, audit: { id: "audit-succeeded-a" } });

  const workspace = await state.service.getWorkspace(actor);
  assert.equal(workspace.preflight.current_run.id, "z-old-failed");
  assert.equal(workspace.preflight.current_run.status, "failed");
  await assert.rejects(state.service.submitReview({ ...actor, planId: created.current_plan.id,
    idempotencyKey: "tie-review" }), { code: "VIDEO_PLAN_REVIEW_GATE_BLOCKED" });
});

test("memory invalidation updates every reviewable result for the exact plan", async () => {
  const state = world({ agentOnline: true });
  let workspace = await createAndPreflight(state, "multi-result-invalidation");
  await state.service.requestPreflight({ ...actor, planId: workspace.current_plan.id,
    expectedRevision: workspace.current_plan.row_version, idempotencyKey: "multi-result-second" });
  await state.worker.runNext();
  state.upstream.copy_version_id = "copy-new";
  workspace = await state.service.getWorkspace(actor);

  const resultStatuses = workspace.preflight.history.filter((item) => item.result).map((item) => item.result.status);
  assert.deepEqual(resultStatuses, ["invalidated", "invalidated"]);
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

test("review submission cannot commit after derive replaces the exact frozen head", async () => {
  const state = world({ agentOnline: true });
  const workspace = await createAndPreflight(state, "submit-derive-race");
  const pause = pauseNextRepositoryMutation(state.repository, "createReview");
  const submitting = state.service.submitReview({ ...actor, planId: workspace.current_plan.id,
    idempotencyKey: "submit-derive-race-review" });
  await pause.waiting;
  await state.service.deriveDraft({ ...actor, planId: workspace.current_plan.id,
    outputInstructions: "并发创建的新方案", expectedHeadRevision: workspace.head_revision,
    idempotencyKey: "submit-derive-race-new-plan" });
  pause.release();

  await assert.rejects(submitting, { code: "VIDEO_PLAN_REVIEW_CONFLICT" });
  assert.equal((await state.repository.listReviews(actor.organizationId, workspace.current_plan.id)).length, 0);
  assert.equal((await state.repository.listAuditEvents()).some((event) =>
    event.event_type === "video_plan.review_submitted"), false);
});

test("review approval cannot commit after derive supersedes its exact pending head", async () => {
  const state = world({ agentOnline: true });
  let workspace = await createAndPreflight(state, "approve-derive-race");
  workspace = await state.service.submitReview({ ...actor, planId: workspace.current_plan.id,
    idempotencyKey: "approve-derive-race-submit" });
  const review = workspace.review.current_review;
  const pause = pauseNextRepositoryMutation(state.repository, "transitionReview");
  const approving = state.service.approveReview({ ...actor, reviewId: review.id,
    expectedRevision: review.row_version, idempotencyKey: "approve-derive-race-decision" });
  await pause.waiting;
  await state.service.deriveDraft({ ...actor, planId: workspace.current_plan.id,
    outputInstructions: "批准前并发创建的新方案", expectedHeadRevision: workspace.head_revision,
    idempotencyKey: "approve-derive-race-new-plan" });
  pause.release();

  await assert.rejects(approving, { code: "VIDEO_PLAN_REVIEW_CONFLICT" });
  assert.equal((await state.repository.getReview(actor.organizationId, review.id)).status, "pending");
  assert.equal((await state.repository.listReviewEvents()).filter((event) => event.to_status === "approved").length, 0);
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
