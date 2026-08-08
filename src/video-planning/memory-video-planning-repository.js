import { randomUUID } from "node:crypto";

const clone = (value) => value == null ? value : structuredClone(value);
const failure = (code) => Object.assign(new Error(code), { code });

export function createMemoryVideoPlanningRepository() {
  const plans = new Map(), heads = new Map(), runs = new Map(), results = new Map(), reviews = new Map(), reviewHeads = new Map();
  const reviewEvents = [];
  const receipts = new Map(), audits = [];
  const headKey = (organizationId, productId) => `${organizationId}:${productId}`;

  function receipt(receiptKey, fingerprint) {
    const found = receipts.get(receiptKey);
    if (!found) return null;
    if (found.fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
    return clone(found.result);
  }

  function appendAudit(event) { audits.push(clone(event)); }

  return {
    async initialize() {}, async close() {},
    async getReceipt(receiptKey, fingerprint) { return receipt(receiptKey, fingerprint); },
    async updateReceiptResult(receiptKey, result) {
      const found = receipts.get(receiptKey);
      if (found) found.result = clone(result);
    },
    async recordReceipt(receiptKey, fingerprint, result) {
      const replay = receipt(receiptKey, fingerprint);
      if (replay) return replay;
      receipts.set(receiptKey, { fingerprint, result: clone(result) });
      return clone(result);
    },
    async getHead(organizationId, productId) { return clone(heads.get(headKey(organizationId, productId)) || null); },
    async getPlan(organizationId, planId) {
      const plan = plans.get(planId);
      return clone(plan?.organization_id === organizationId ? plan : null);
    },
    async listPlans(organizationId, productId) {
      return [...plans.values()].filter((plan) => plan.organization_id === organizationId && plan.product_id === productId)
        .sort((a, b) => a.version_number - b.version_number).map(clone);
    },
    async createPlan({ receiptKey, fingerprint, plan, expectedHeadRevision, audit }) {
      const replay = receipt(receiptKey, fingerprint);
      if (replay) return replay;
      const key = headKey(plan.organization_id, plan.product_id), head = heads.get(key);
      if ((head?.row_version || 0) !== expectedHeadRevision) throw failure("VIDEO_PLAN_CONFLICT");
      plans.set(plan.id, clone(plan));
      heads.set(key, { organization_id: plan.organization_id, product_id: plan.product_id,
        current_plan_id: plan.id, row_version: (head?.row_version || 0) + 1, updated_at: plan.updated_at });
      receipts.set(receiptKey, { fingerprint, result: { plan_id: plan.id } });
      appendAudit(audit);
      return clone(plan);
    },
    async saveDraft({ organizationId, planId, expectedRevision, outputInstructions, updatedAt, audit }) {
      const plan = plans.get(planId);
      if (!plan || plan.organization_id !== organizationId) return null;
      if (plan.status !== "draft") throw failure("VIDEO_PLAN_IMMUTABLE");
      if (plan.row_version !== expectedRevision) throw failure("VIDEO_PLAN_CONFLICT");
      Object.assign(plan, { output_instructions: outputInstructions, row_version: plan.row_version + 1, updated_at: updatedAt });
      appendAudit(audit); return clone(plan);
    },
    async deriveDraft({ receiptKey, fingerprint, sourcePlanId, expectedHeadRevision, plan, audit }) {
      const replay = receipt(receiptKey, fingerprint);
      if (replay) return replay;
      const source = plans.get(sourcePlanId);
      if (!source || source.organization_id !== plan.organization_id) return null;
      const key = headKey(plan.organization_id, plan.product_id), head = heads.get(key);
      if (!head || head.current_plan_id !== sourcePlanId || head.row_version !== expectedHeadRevision) throw failure("VIDEO_PLAN_CONFLICT");
      if (source.status !== "frozen") throw failure("VIDEO_PLAN_DERIVE_BLOCKED");
      source.status = "superseded"; source.updated_at = plan.created_at;
      plans.set(plan.id, clone(plan));
      Object.assign(head, { current_plan_id: plan.id, row_version: head.row_version + 1, updated_at: plan.updated_at });
      receipts.set(receiptKey, { fingerprint, result: { plan_id: plan.id } }); appendAudit(audit);
      return clone(plan);
    },
    async createRun({ receiptKey, fingerprint, run, planId, expectedRevision, audit }) {
      const replay = receipt(receiptKey, fingerprint);
      if (replay) return replay;
      const plan = plans.get(planId);
      if (!plan || plan.organization_id !== run.organization_id) return null;
      if (plan.status === "draft") {
        if (plan.row_version !== expectedRevision) throw failure("VIDEO_PLAN_CONFLICT");
        Object.assign(plan, { status: "frozen", frozen_at: run.created_at, row_version: plan.row_version + 1, updated_at: run.created_at });
      } else if (plan.status !== "frozen") throw failure("VIDEO_PLAN_PREFLIGHT_BLOCKED");
      const active = [...runs.values()].find((item) => item.organization_id === run.organization_id &&
        item.video_plan_version_id === planId && ["queued", "running"].includes(item.status));
      const saved = active || (runs.set(run.id, clone(run)), run);
      receipts.set(receiptKey, { fingerprint, result: { run_id: saved.id } });
      appendAudit(audit); return clone(saved);
    },
    async claimNextRun({ now, leaseToken }) {
      const candidate = [...runs.values()].find((run) => run.status === "queued");
      if (!candidate) return null;
      Object.assign(candidate, { status: "running", lease_token: leaseToken, started_at: now, updated_at: now });
      return clone(candidate);
    },
    async completeRun({ runId, leaseToken, result, audit, now }) {
      const run = runs.get(runId);
      if (!run || run.status !== "running" || run.lease_token !== leaseToken) throw failure("PREFLIGHT_RUN_LEASE_LOST");
      results.set(result.id, clone(result));
      Object.assign(run, { status: "succeeded", preflight_result_id: result.id, failure_code: null,
        completed_at: now, lease_token: null, updated_at: now });
      appendAudit(audit); return { run: clone(run), result: clone(result) };
    },
    async failRun({ runId, leaseToken, failureCode, audit, now }) {
      const run = runs.get(runId);
      if (!run || run.status !== "running" || run.lease_token !== leaseToken) throw failure("PREFLIGHT_RUN_LEASE_LOST");
      Object.assign(run, { status: "failed", failure_code: failureCode, completed_at: now, lease_token: null, updated_at: now });
      appendAudit(audit); return clone(run);
    },
    async getPreflightState(organizationId, planId) {
      const history = [...runs.values()].filter((run) => run.organization_id === organizationId && run.video_plan_version_id === planId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)).map((run) => ({ ...clone(run), result: clone(results.get(run.preflight_result_id) || null) }));
      const current = history.at(-1) || null;
      return { current_run: current ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== "result")) : null,
        current_result: current?.result || null, history };
    },
    async listReviews(organizationId, planId) {
      return [...reviews.values()].filter((review) => review.organization_id === organizationId && review.video_plan_version_id === planId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at)).map((review) => clone({ ...review, ...reviewHeads.get(review.id) }));
    },
    async getReview(organizationId, reviewId) {
      const review = reviews.get(reviewId); return clone(review?.organization_id === organizationId ? { ...review, ...reviewHeads.get(reviewId) } : null);
    },
    async createReview({ receiptKey, fingerprint, review, audit }) {
      const replay = receipt(receiptKey, fingerprint);
      if (replay) return replay;
      const active = [...reviews.values()].find((item) => item.organization_id === review.organization_id &&
        item.video_plan_version_id === review.video_plan_version_id && reviewHeads.get(item.id)?.status === "pending");
      if (active) throw failure("VIDEO_PLAN_REVIEW_ACTIVE_EXISTS");
      const { status, row_version, reviewer_member_id, review_mode, decision_reason, updated_at,
        decided_at, revoked_at, revoke_reason_code, ...base } = review;
      reviews.set(review.id, clone(base)); reviewHeads.set(review.id, clone({ status, row_version, reviewer_member_id,
        review_mode, decision_reason, updated_at, decided_at, revoked_at, revoke_reason_code }));
      reviewEvents.push({ id: randomUUID(), organization_id: review.organization_id, plan_review_id: review.id,
        video_plan_version_id: review.video_plan_version_id, from_status: "not_submitted", to_status: "pending",
        actor_member_id: review.author_member_id, created_at: review.created_at });
      receipts.set(receiptKey, { fingerprint, result: { review_id: review.id } });
      appendAudit(audit); return clone(review);
    },
    async transitionReview({ receiptKey, fingerprint, organizationId, reviewId, expectedRevision,
      fromStatuses, patch, audit }) {
      const replay = receipt(receiptKey, fingerprint);
      if (replay) return replay;
      const review = reviews.get(reviewId), reviewHead = reviewHeads.get(reviewId);
      if (!review || review.organization_id !== organizationId) return null;
      if (reviewHead.row_version !== expectedRevision || !fromStatuses.includes(reviewHead.status)) throw failure("VIDEO_PLAN_REVIEW_CONFLICT");
      const fromStatus = reviewHead.status;
      Object.assign(reviewHead, patch, { row_version: reviewHead.row_version + 1, updated_at: patch.updated_at });
      reviewEvents.push({ id: randomUUID(), organization_id: review.organization_id, plan_review_id: review.id,
        video_plan_version_id: review.video_plan_version_id, from_status: fromStatus, to_status: patch.status,
        actor_member_id: patch.reviewer_member_id, reason: patch.decision_reason, created_at: patch.updated_at });
      receipts.set(receiptKey, { fingerprint, result: { review_id: review.id } }); appendAudit(audit);
      return clone({ ...review, ...reviewHead });
    },
    async invalidate({ organizationId, planId, reasonCode, actorMemberId, now, audit }) {
      const currentRun = [...runs.values()].filter((run) => run.organization_id === organizationId && run.video_plan_version_id === planId).at(-1);
      const result = currentRun?.preflight_result_id ? results.get(currentRun.preflight_result_id) : null;
      if (result && result.status !== "invalidated") Object.assign(result, { status: "invalidated", invalidated_at: now, invalidation_reason: reasonCode });
      for (const review of reviews.values()) {
        const reviewHead = reviewHeads.get(review.id);
        if (review.organization_id === organizationId && review.video_plan_version_id === planId && reviewHead.status === "approved") {
          Object.assign(reviewHead, { status: "revoked", revoke_reason_code: reasonCode, revoked_at: now,
            row_version: reviewHead.row_version + 1, updated_at: now });
          reviewEvents.push({ id: randomUUID(), organization_id: review.organization_id, plan_review_id: review.id,
            video_plan_version_id: review.video_plan_version_id, from_status: "approved", to_status: "revoked",
            actor_member_id: actorMemberId, reason_code: reasonCode, created_at: now });
        }
      }
      appendAudit({ ...audit, actor_member_id: actorMemberId });
    },
    async listAuditEvents() { return clone(audits); },
    async listReviewEvents() { return clone(reviewEvents); }
  };
}
