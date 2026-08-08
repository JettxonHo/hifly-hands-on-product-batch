import { randomUUID } from "node:crypto";

const clean = (value) => typeof value === "string" ? value.trim() : "";
const failure = (code, details = null) => Object.assign(new Error(code), { code, details });
const stableJson = (value) => Array.isArray(value) ? `[${value.map(stableJson).join(",")}]` :
  value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}` : JSON.stringify(value);

function context(input) {
  if (!clean(input.organizationId) || !clean(input.actorMemberId) || !clean(input.productId)) throw failure("VIDEO_PLAN_CONTEXT_REQUIRED");
  if (!["member", "admin"].includes(input.actorRole)) throw failure("VIDEO_PLAN_FORBIDDEN");
}
function key(value) { if (!clean(value) || value.length > 128) throw failure("INVALID_IDEMPOTENCY_KEY"); }
function instructions(value) {
  const normalized = clean(value);
  if (!normalized || normalized.length > 4000) throw failure("VIDEO_PLAN_OUTPUT_INSTRUCTIONS_REQUIRED");
  return normalized;
}
function snapshotFrom(upstream) {
  return { product_revision_id: upstream.product_revision_id, copy_version_id: upstream.copy_version_id,
    avatar_selection_id: upstream.avatar_selection_id, avatar_asset_version_id: upstream.avatar_asset_version_id };
}
function sameUpstream(snapshot, current) {
  return current?.current_valid === true && Object.entries(snapshot).every(([name, value]) => current[name] === value);
}
function sameCapability(snapshot, current) {
  return validCapabilitySnapshot(current) && stableJson(snapshot) === stableJson(current);
}
function validCapabilitySnapshot(value) {
  return value && clean(value.snapshot_version) && Array.isArray(value.verified_capabilities) &&
    value.verified_capabilities.length > 0 && value.verified_capabilities.every((item) =>
      clean(item.code) && clean(item.evidence_reference));
}
function audit({ input, type, planId, reviewId = null, runId = null, at, metadata = {} }) {
  return { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId,
    event_type: type, video_plan_version_id: planId, plan_review_id: reviewId, preflight_run_id: runId,
    metadata, created_at: at };
}

export function createVideoPlanningService({ repository, upstreamPort, capabilitySnapshotPort, agentReadinessPort,
  productionOrdersEnabled = false, now = Date.now } = {}) {
  if (!repository || !upstreamPort?.resolveCurrent || !capabilitySnapshotPort?.resolve || !agentReadinessPort?.isOnline) {
    throw new TypeError("repository and video planning ports are required");
  }
  const timestamp = () => new Date(now()).toISOString();
  const receiptKey = (input, command) => `${input.organizationId}:${input.actorMemberId}:${command}:${input.idempotencyKey}`;

  async function requirePlan(input, planId) {
    const plan = await repository.getPlan(input.organizationId, planId);
    if (!plan || plan.product_id !== input.productId) throw failure("VIDEO_PLAN_NOT_FOUND");
    return plan;
  }

  async function maybeInvalidate(input, plan) {
    if (!plan || plan.status === "draft") return;
    const current = await upstreamPort.resolveCurrent(input);
    let reasonCode = null;
    if (!sameUpstream(plan.upstream_snapshot, current)) reasonCode = "upstream_changed";
    else {
      const capability = await capabilitySnapshotPort.resolve({ ...input, upstream: current });
      if (!sameCapability(plan.capability_config_snapshot, capability)) reasonCode = "capability_snapshot_changed";
    }
    if (reasonCode) {
      await repository.invalidate({ organizationId: input.organizationId, planId: plan.id,
        reasonCode, actorMemberId: input.actorMemberId, now: timestamp(),
        audit: audit({ input, type: "video_plan.invalidated", planId: plan.id, at: timestamp() }) });
    }
  }

  async function workspace(input, requestedPlanId = null, { reconcile = true } = {}) {
    context(input);
    const head = await repository.getHead(input.organizationId, input.productId);
    const planId = requestedPlanId || head?.current_plan_id || null;
    const current = planId ? await requirePlan(input, planId) : null;
    if (reconcile && current) await maybeInvalidate(input, current);
    const plan = planId ? await requirePlan(input, planId) : null;
    const versions = await repository.listPlans(input.organizationId, input.productId);
    const preflight = plan ? await repository.getPreflightState(input.organizationId, plan.id) :
      { current_run: null, current_result: null, history: [] };
    const reviews = plan ? await repository.listReviews(input.organizationId, plan.id) : [];
    const currentReview = reviews.at(-1) || null;
    const result = preflight.current_result;
    const canSubmit = plan?.status === "frozen" && ["passed", "warning"].includes(result?.status) && !currentReview;
    const productionOrderAvailable = productionOrdersEnabled === true && plan?.id === head?.current_plan_id &&
      plan.status === "frozen" && currentReview?.status === "approved" && ["passed", "warning"].includes(result?.status);
    const productionOrderNotice = productionOrdersEnabled === true
      ? productionOrderAvailable ? "当前方案已批准，可以进入生产工单。" : "当前方案尚未满足生产工单创建条件。"
      : "创建生产工单尚未开放。";
    return { current_plan: plan, head_revision: head?.row_version || 0, versions, preflight,
      review: { current_review: currentReview, history: reviews,
        gate: { can_submit: canSubmit, can_decide: currentReview?.status === "pending",
          reasons: canSubmit ? [] : [!plan ? "plan_missing" : plan.status !== "frozen" ? "plan_not_frozen" :
            !["passed", "warning"].includes(result?.status) ? "preflight_not_reviewable" :
              currentReview?.status === "pending" ? "review_pending" : currentReview?.status === "approved" ? "review_approved" : "review_unavailable"] } },
      production_order_available: productionOrderAvailable,
      production_order_notice: productionOrderNotice };
  }

  async function resolveCurrentApprovedPlan(input) {
    context(input);
    const head = await repository.getHead(input.organizationId, input.productId);
    const requestedPlanId = clean(input.videoPlanVersionId || input.planId);
    const planId = requestedPlanId || head?.current_plan_id || null;
    if (!planId) return { current_valid: false, plan: null, plan_review: null, preflight_result: null,
      gate: { can_create: false, reasons: ["approved_plan_missing"] } };
    const currentWorkspace = await workspace(input, planId, { reconcile: true });
    const plan = currentWorkspace.current_plan;
    if (!plan) return { current_valid: false, plan: null, plan_review: null, preflight_result: null,
      gate: { can_create: false, reasons: ["approved_plan_missing"] } };
    const reasons = [];
    if (requestedPlanId && head?.current_plan_id !== requestedPlanId) reasons.push("plan_not_current");
    if (plan.status !== "frozen") reasons.push("plan_not_frozen");
    if (currentWorkspace.review.current_review?.status !== "approved") reasons.push("plan_review_not_approved");
    const preflightResult = currentWorkspace.preflight.current_result;
    if (preflightResult?.status === "invalidated") reasons.push("preflight_invalidated");
    else if (!["passed", "warning"].includes(preflightResult?.status)) reasons.push("preflight_not_reviewable");
    const currentUpstream = await upstreamPort.resolveCurrent(input);
    if (!sameUpstream(plan.upstream_snapshot, currentUpstream)) reasons.push("upstream_changed");
    else {
      const capability = await capabilitySnapshotPort.resolve({ ...input, upstream: currentUpstream });
      if (!sameCapability(plan.capability_config_snapshot, capability)) reasons.push("capability_snapshot_changed");
    }
    const uniqueReasons = [...new Set(reasons)];
    return { current_valid: uniqueReasons.length === 0, plan, plan_review: currentWorkspace.review.current_review,
      preflight_result: preflightResult, upstream: currentUpstream,
      gate: { can_create: uniqueReasons.length === 0, reasons: uniqueReasons } };
  }

  async function replay(input, command, fingerprint) {
    const found = await repository.getReceipt(receiptKey(input, command), fingerprint);
    return found?.current_plan || found?.review || found?.preflight ? found : null;
  }

  async function upstreamForNewPlan(input) {
    const current = await upstreamPort.resolveCurrent(input);
    if (!current?.current_valid || !clean(current.product_revision_id) || !clean(current.copy_version_id) ||
      !clean(current.avatar_selection_id) || !clean(current.avatar_asset_version_id)) {
      throw failure("VIDEO_PLAN_UPSTREAM_BLOCKED", ["current_approved_copy_and_confirmed_avatar_required"]);
    }
    const capability = await capabilitySnapshotPort.resolve({ ...input, upstream: current });
    if (!validCapabilitySnapshot(capability)) throw failure("VIDEO_PLAN_CAPABILITY_SNAPSHOT_REQUIRED");
    return { current, capability: structuredClone(capability) };
  }

  async function createPlan(input) {
    context(input); key(input.idempotencyKey);
    const output = instructions(input.outputInstructions);
    if (!Number.isInteger(input.expectedHeadRevision) || input.expectedHeadRevision < 0) throw failure("VIDEO_PLAN_CONFLICT");
    const fingerprint = stableJson({ product_id: input.productId, output_instructions: output,
      expected_head_revision: input.expectedHeadRevision });
    const prior = await replay(input, "create", fingerprint); if (prior) return prior;
    const { current, capability } = await upstreamForNewPlan(input), at = timestamp();
    const versions = await repository.listPlans(input.organizationId, input.productId);
    const plan = { id: randomUUID(), organization_id: input.organizationId, product_id: input.productId,
      version_number: versions.length + 1, status: "draft", row_version: 1,
      upstream_snapshot: snapshotFrom(current), capability_config_snapshot: capability,
      output_instructions: output, parent_plan_version_id: null, created_by_member_id: input.actorMemberId,
      created_at: at, updated_at: at, frozen_at: null };
    const rKey = receiptKey(input, "create");
    await repository.createPlan({ receiptKey: rKey, fingerprint, plan, expectedHeadRevision: input.expectedHeadRevision,
      audit: audit({ input, type: "video_plan.created", planId: plan.id, at }) });
    const result = await workspace(input, plan.id, { reconcile: false });
    await repository.updateReceiptResult(rKey, result); return result;
  }

  async function deriveDraft(input) {
    context(input); key(input.idempotencyKey);
    const output = instructions(input.outputInstructions);
    if (!Number.isInteger(input.expectedHeadRevision) || input.expectedHeadRevision < 1) throw failure("VIDEO_PLAN_CONFLICT");
    const fingerprint = stableJson({ source_plan_id: input.planId, output_instructions: output,
      expected_head_revision: input.expectedHeadRevision });
    const prior = await replay(input, "derive", fingerprint); if (prior) return prior;
    const source = await requirePlan(input, input.planId), { current, capability } = await upstreamForNewPlan(input);
    const versions = await repository.listPlans(input.organizationId, input.productId), at = timestamp();
    const plan = { ...source, id: randomUUID(), version_number: versions.length + 1, status: "draft", row_version: 1,
      upstream_snapshot: snapshotFrom(current), capability_config_snapshot: capability, output_instructions: output,
      parent_plan_version_id: source.id, created_by_member_id: input.actorMemberId, created_at: at,
      updated_at: at, frozen_at: null };
    const rKey = receiptKey(input, "derive");
    const saved = await repository.deriveDraft({ receiptKey: rKey, fingerprint, sourcePlanId: source.id,
      expectedHeadRevision: input.expectedHeadRevision, plan,
      audit: audit({ input, type: "video_plan.derived", planId: plan.id, at, metadata: { parent_plan_version_id: source.id } }) });
    if (!saved) throw failure("VIDEO_PLAN_NOT_FOUND");
    const result = await workspace(input, plan.id, { reconcile: false }); await repository.updateReceiptResult(rKey, result); return result;
  }

  async function saveDraft(input) {
    context(input); const output = instructions(input.outputInstructions), at = timestamp();
    const saved = await repository.saveDraft({ organizationId: input.organizationId, planId: input.planId,
      expectedRevision: input.expectedRevision, outputInstructions: output, updatedAt: at,
      audit: audit({ input, type: "video_plan.draft_saved", planId: input.planId, at }) });
    if (!saved) throw failure("VIDEO_PLAN_NOT_FOUND");
    return workspace(input, saved.id, { reconcile: false });
  }

  async function requestPreflight(input) {
    context(input); key(input.idempotencyKey);
    const plan = await requirePlan(input, input.planId);
    const fingerprint = stableJson({ plan_id: plan.id, expected_revision: input.expectedRevision });
    const prior = await replay(input, "preflight", fingerprint); if (prior) return prior;
    if (!clean(plan.output_instructions)) throw failure("VIDEO_PLAN_PREFLIGHT_BLOCKED");
    const at = timestamp(), run = { id: randomUUID(), organization_id: input.organizationId,
      video_plan_version_id: plan.id, status: "queued", input_snapshot: { upstream_snapshot: plan.upstream_snapshot,
        capability_config_snapshot: plan.capability_config_snapshot, output_instructions: plan.output_instructions },
      preflight_result_id: null, failure_code: null, lease_token: null, created_by_member_id: input.actorMemberId,
      started_at: null, completed_at: null, created_at: at, updated_at: at };
    const rKey = receiptKey(input, "preflight");
    const saved = await repository.createRun({ receiptKey: rKey, fingerprint, run, planId: plan.id,
      expectedRevision: input.expectedRevision,
      audit: audit({ input, type: "video_plan.preflight_requested", planId: plan.id, runId: run.id, at }) });
    if (!saved) throw failure("VIDEO_PLAN_NOT_FOUND");
    const result = await workspace(input, plan.id, { reconcile: false }); await repository.updateReceiptResult(rKey, result); return result;
  }

  async function reviewProjection(input, receipt = null) {
    const reviewId = receipt?.review_id || receipt?.review?.current_review?.id || input.reviewId;
    const review = reviewId ? await repository.getReview(input.organizationId, reviewId) : null;
    return workspace(input, review?.video_plan_version_id || input.planId, { reconcile: true });
  }

  async function submitReview(input) {
    context(input); key(input.idempotencyKey);
    const plan = await requirePlan(input, input.planId), fingerprint = stableJson({ plan_id: plan.id });
    const prior = await replay(input, "review-submit", fingerprint); if (prior) return prior;
    const current = await workspace(input, plan.id);
    if (current.review.current_review?.status === "pending") throw failure("VIDEO_PLAN_REVIEW_ACTIVE_EXISTS");
    if (!current.review.gate.can_submit) throw failure("VIDEO_PLAN_REVIEW_GATE_BLOCKED", current.review.gate.reasons);
    const at = timestamp(), review = { id: randomUUID(), organization_id: input.organizationId,
      video_plan_version_id: plan.id, status: "pending", row_version: 1,
      author_member_id: input.actorMemberId, reviewer_member_id: null, review_mode: null,
      decision_reason: null, created_at: at, updated_at: at, decided_at: null, revoked_at: null,
      revoke_reason_code: null };
    const rKey = receiptKey(input, "review-submit");
    await repository.createReview({ receiptKey: rKey, fingerprint, review,
      audit: audit({ input, type: "video_plan.review_submitted", planId: plan.id, reviewId: review.id, at }) });
    const result = await workspace(input, plan.id, { reconcile: false }); await repository.updateReceiptResult(rKey, result); return result;
  }

  async function decide(input, status) {
    context(input); key(input.idempotencyKey);
    const reason = clean(input.reason);
    if (status === "changes_requested" && !reason) throw failure("VIDEO_PLAN_REVIEW_REASON_REQUIRED");
    const fingerprint = stableJson({ review_id: clean(input.reviewId), expected_revision: input.expectedRevision, status, reason });
    const prior = await repository.getReceipt(receiptKey(input, `review-${status}`), fingerprint);
    if (prior) return reviewProjection(input, prior);
    const review = await repository.getReview(input.organizationId, input.reviewId);
    if (!review) throw failure("VIDEO_PLAN_REVIEW_NOT_FOUND");
    if (review.status !== "pending" || review.row_version !== input.expectedRevision) throw failure("VIDEO_PLAN_REVIEW_CONFLICT");
    if (status === "approved") {
      const current = await workspace({ ...input, productId: (await repository.getPlan(input.organizationId,
        review.video_plan_version_id))?.product_id }, review.video_plan_version_id);
      if (!current.review.gate.can_decide || !["passed", "warning"].includes(current.preflight.current_result?.status)) {
        throw failure("VIDEO_PLAN_REVIEW_GATE_BLOCKED", current.review.gate.reasons);
      }
    }
    const plan = await repository.getPlan(input.organizationId, review.video_plan_version_id);
    const effectiveInput = { ...input, productId: plan?.product_id };
    const at = timestamp(), rKey = receiptKey(input, `review-${status}`);
    const changed = await repository.transitionReview({ receiptKey: rKey, fingerprint,
      organizationId: input.organizationId, reviewId: review.id, expectedRevision: input.expectedRevision,
      fromStatuses: ["pending"], patch: { status, reviewer_member_id: input.actorMemberId,
        review_mode: input.actorMemberId === review.author_member_id ? "self_review" : "standard",
        decision_reason: reason || null, decided_at: at, updated_at: at },
      audit: audit({ input: effectiveInput, type: status === "approved" ? "video_plan.review_approved" :
        "video_plan.review_changes_requested", planId: review.video_plan_version_id, reviewId: review.id, at }) });
    if (!changed) throw failure("VIDEO_PLAN_REVIEW_NOT_FOUND");
    const result = await workspace(effectiveInput, review.video_plan_version_id);
    await repository.updateReceiptResult(rKey, result); return result;
  }

  return {
    createPlan, saveDraft, deriveDraft, requestPreflight, submitReview,
    approveReview(input) { return decide(input, "approved"); },
    requestChanges(input) { return decide(input, "changes_requested"); },
    async getWorkspace(input) { return workspace(input, input.planId || null); },
    resolveCurrentApprovedPlan,
    async claimNextPreflight() {
      const at = timestamp(), leaseToken = randomUUID();
      const run = await repository.claimNextRun({ now: at, leaseToken });
      if (!run) return null;
      const plan = await repository.getPlan(run.organization_id, run.video_plan_version_id);
      const input = { organizationId: run.organization_id, actorMemberId: run.created_by_member_id,
        actorRole: "member", productId: plan.product_id };
      return { run, currentUpstream: await upstreamPort.resolveCurrent(input),
        agentOnline: await agentReadinessPort.isOnline(input) };
    },
    async completePreflight({ run, evaluation }) {
      const groups = evaluation?.groups;
      const names = ["upstream_validity", "plan_completeness", "production_readiness"];
      if (!groups || names.some((name) => !groups[name] || !["passed", "warning", "blocked"].includes(groups[name].status) ||
        !Array.isArray(groups[name].checks))) throw failure("PREFLIGHT_EVALUATION_INVALID");
      const statuses = names.map((name) => groups[name].status);
      const status = statuses.includes("blocked") ? "blocked" : statuses.includes("warning") ? "warning" : "passed";
      const at = timestamp(), result = { id: randomUUID(), organization_id: run.organization_id,
        video_plan_version_id: run.video_plan_version_id, preflight_run_id: run.id, status,
        groups: structuredClone(groups), created_at: at, invalidated_at: null, invalidation_reason: null };
      await repository.completeRun({ runId: run.id, leaseToken: run.lease_token, result, now: at,
        audit: { id: randomUUID(), organization_id: run.organization_id, actor_member_id: null,
          event_type: "video_plan.preflight_completed", video_plan_version_id: run.video_plan_version_id,
          preflight_run_id: run.id, metadata: { result_status: status }, created_at: at } });
      return result;
    },
    async failPreflight({ run, failureCode }) {
      const at = timestamp(); return repository.failRun({ runId: run.id, leaseToken: run.lease_token,
        failureCode: clean(failureCode) || "PREFLIGHT_EVALUATION_FAILED", now: at,
        audit: { id: randomUUID(), organization_id: run.organization_id, actor_member_id: null,
          event_type: "video_plan.preflight_failed", video_plan_version_id: run.video_plan_version_id,
          preflight_run_id: run.id, metadata: { failure_code: clean(failureCode) || "PREFLIGHT_EVALUATION_FAILED" }, created_at: at } });
    },
    async reconcilePlan(input) {
      context(input); key(input.idempotencyKey);
      const fingerprint = stableJson({ plan_id: input.planId, change_kind: clean(input.changeKind) });
      const rKey = receiptKey(input, "reconcile"), replayed = await repository.getReceipt(rKey, fingerprint);
      if (replayed) return replayed;
      const plan = await requirePlan(input, input.planId);
      await maybeInvalidate(input, plan);
      const result = await workspace(input, plan.id, { reconcile: false });
      await repository.recordReceipt(rKey, fingerprint, result); return result;
    }
  };
}
