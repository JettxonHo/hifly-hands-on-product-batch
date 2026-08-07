import { randomUUID } from "node:crypto";

const failure = (code, details = null) => Object.assign(new Error(code), { code, details });
const clean = (value) => typeof value === "string" ? value.trim() : "";
const stableJson = (value) => Array.isArray(value) ? `[${value.map(stableJson).join(",")}]` :
  value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}` : JSON.stringify(value);

function context(input) {
  if (!clean(input.organizationId) || !clean(input.actorMemberId)) throw failure("COPY_REVIEW_CONTEXT_REQUIRED");
}

function key(value) {
  if (!clean(value) || value.length > 128) throw failure("INVALID_IDEMPOTENCY_KEY");
  return value;
}

function reviewer(input) {
  if (input.actorRole !== "admin") throw failure("COPY_REVIEW_FORBIDDEN");
}

export function createCopyReviewService({ repository, copyService, qualityService, now = () => Date.now(),
  approvalBarrier = async () => {}, approvalReturnBarrier = async () => {} } = {}) {
  if (!repository || !copyService || !qualityService) throw new TypeError("repository, copyService, and qualityService are required");
  const timestamp = () => new Date(now()).toISOString();

  async function gate(input) {
    const copy = await copyService.getCopyVersion(input);
    const reasons = [];
    if (copy.status !== "frozen") reasons.push(copy.status === "superseded" ? "copy_version_superseded" : "copy_version_not_frozen");
    const quality = await qualityService.getApprovalCandidate(input);
    if (!quality) reasons.push("quality_result_missing");
    else {
      if (quality.current_valid !== true) reasons.push(quality.invalidation_reason || "quality_result_invalidated");
      if (quality.effective_conclusion !== "passed") reasons.push(`quality_${quality.effective_conclusion || quality.conclusion || "invalid"}`);
      if (quality.product_revision_id && quality.product_revision_id !== copy.product_revision_id) reasons.push("product_revision_changed");
    }
    return { allowed: reasons.length === 0, reasons: [...new Set(reasons)], copy, quality };
  }

  function boundGate(review, currentGate) {
    const reasons = [...currentGate.reasons];
    if (currentGate.quality && review.quality_result_id !== currentGate.quality.id) reasons.push("quality_result_replaced");
    if (review.product_revision_id !== currentGate.copy.product_revision_id) reasons.push("product_revision_changed");
    if (currentGate.quality && (review.profile_version !== currentGate.quality.profile_version ||
      review.rule_version !== currentGate.quality.rule_version)) reasons.push("quality_policy_changed");
    return { allowed: currentGate.allowed && reasons.length === 0, reasons: [...new Set(reasons)] };
  }

  function event({ review, actorMemberId, fromStatus, toStatus, reason = null, reasonCode = null, at }) {
    return { id: randomUUID(), organization_id: review.organization_id, human_review_id: review.id,
      copy_version_id: review.copy_version_id, actor_member_id: actorMemberId, from_status: fromStatus,
      to_status: toStatus, reason, reason_code: reasonCode, created_at: at };
  }

  function audit({ review, actorMemberId, type, at, metadata = {} }) {
    return { id: randomUUID(), organization_id: review.organization_id, actor_member_id: actorMemberId,
      event_type: type, human_review_id: review.id, copy_version_id: review.copy_version_id,
      metadata, created_at: at };
  }

  async function revokeInvalidApproval(input, review, currentGate, sourceReceiptKey = null) {
    const reviewGate = review ? boundGate(review, currentGate) : currentGate;
    if (review?.status !== "approved" || reviewGate.allowed) return review;
    const at = timestamp(), reasonCode = reviewGate.reasons[0] || "upstream_invalidated";
    try {
      const revoked = await repository.transition({
        receiptKey: `${review.organization_id}:review-auto-revoke:${review.id}:${review.row_version}`,
        fingerprint: stableJson({ review_id: review.id, revision: review.row_version, reason_code: reasonCode }),
        resultReceiptKey: sourceReceiptKey,
        reviewId: review.id, organizationId: review.organization_id, expectedRevision: review.row_version,
        fromStatuses: ["approved"], patch: { status: "revoked", revoked_at: at, revoke_reason: null,
          revoke_reason_code: reasonCode }, event: event({ review, actorMemberId: input.actorMemberId,
            fromStatus: "approved", toStatus: "revoked", reasonCode, at }),
        audit: audit({ review, actorMemberId: input.actorMemberId, type: "copy.review_revoked_by_invalidation", at,
          metadata: { reason_code: reasonCode } })
      });
      return revoked;
    } catch (error) {
      if (error?.code !== "COPY_REVIEW_CONFLICT") throw error;
      const current = await repository.getReview(review.organization_id, review.id);
      if (sourceReceiptKey && current?.status === "revoked") await repository.updateReceiptResult(sourceReceiptKey, current);
      return current;
    }
  }

  async function projection(input, sourceReceiptKey = null) {
    const reviews = await repository.listReviews(input.organizationId, input.copyVersionId);
    let current = reviews.at(-1) || null;
    const currentGate = await gate(input);
    current = await revokeInvalidApproval(input, current, currentGate, sourceReceiptKey);
    const decisionGate = current ? boundGate(current, currentGate) : currentGate;
    const refreshed = current && reviews.at(-1)?.row_version !== current.row_version ?
      await repository.listReviews(input.organizationId, input.copyVersionId) : reviews;
    return { current_review: current, reviews: refreshed,
      history: await repository.listEvents(input.organizationId, input.copyVersionId),
      gate: { can_submit: currentGate.allowed && !["pending", "approved"].includes(current?.status),
        can_approve: decisionGate.allowed && current?.status === "pending", reasons: decisionGate.reasons } };
  }

  async function receiptProjection(input, resultHead) {
    const reviews = await repository.listReviews(input.organizationId, resultHead.copy_version_id);
    const projectedReviews = reviews.map((review) => review.id === resultHead.id ? resultHead : review);
    return { current_review: resultHead, reviews: projectedReviews,
      history: await repository.listEvents(input.organizationId, resultHead.copy_version_id),
      gate: { can_submit: ["changes_requested", "revoked"].includes(resultHead.status),
        can_approve: resultHead.status === "pending", reasons: [] } };
  }

  async function preflight(input, kind, fingerprint) {
    const receiptKey = `${input.organizationId}:${kind}:${input.idempotencyKey}`;
    const resultHead = await repository.getReceipt(receiptKey, fingerprint);
    return { receiptKey, result: resultHead ? await receiptProjection(input, resultHead) : null };
  }

  async function getReviewForCommand(input) {
    const review = await repository.getReview(input.organizationId, input.reviewId);
    if (!review) throw failure("COPY_REVIEW_NOT_FOUND");
    return review;
  }

  async function reconcileCopyVersion(input) {
    if (!clean(input.organizationId) || !clean(input.copyVersionId)) throw failure("COPY_REVIEW_CONTEXT_REQUIRED");
    const reviews = await repository.listReviews(input.organizationId, input.copyVersionId);
    const current = reviews.at(-1) || null;
    if (current?.status !== "approved") return current;
    const gateInput = { organizationId: input.organizationId,
      actorMemberId: clean(input.actorMemberId) || "copy-review-coordinator", copyVersionId: input.copyVersionId };
    const currentGate = await gate(gateInput);
    return revokeInvalidApproval({ actorMemberId: clean(input.actorMemberId) || null }, current, currentGate);
  }

  async function reconcileProductRevision(input) {
    if (!clean(input.organizationId) || !clean(input.productRevisionId)) throw failure("COPY_REVIEW_CONTEXT_REQUIRED");
    const gateInput = { organizationId: input.organizationId,
      actorMemberId: clean(input.actorMemberId) || "copy-review-coordinator", productRevisionId: input.productRevisionId };
    const copies = await copyService.listCopyVersions(gateInput);
    for (const copy of copies) await reconcileCopyVersion({ ...input, copyVersionId: copy.id });
  }

  async function decide(input, { status, reasonRequired = false }) {
    context(input); reviewer(input); key(input.idempotencyKey);
    const reason = clean(input.reason);
    const fingerprint = stableJson({ review_id: input.reviewId, expected_revision: input.expectedRevision, status, reason });
    const receipt = await preflight(input, "review-decision", fingerprint);
    if (receipt.result) return receipt.result;
    if (reasonRequired && !reason) throw failure("COPY_REVIEW_REASON_REQUIRED");
    const review = await getReviewForCommand(input);
    if (status === "approved") {
      const currentGate = await gate({ ...input, copyVersionId: review.copy_version_id });
      const approvalGate = boundGate(review, currentGate);
      if (!approvalGate.allowed) throw failure("COPY_REVIEW_GATE_BLOCKED", approvalGate.reasons);
      await approvalBarrier({ organizationId: input.organizationId, reviewId: review.id, copyVersionId: review.copy_version_id });
    }
    const at = timestamp();
    const decided = await repository.transition({ receiptKey: receipt.receiptKey, fingerprint,
      reviewId: review.id, organizationId: input.organizationId, expectedRevision: input.expectedRevision,
      fromStatuses: ["pending"], patch: { status, reviewer_member_id: input.actorMemberId,
        review_mode: input.actorMemberId === review.author_member_id ? "self_review" : "standard",
        decision_reason: reason || null, decided_at: at },
      event: event({ review, actorMemberId: input.actorMemberId, fromStatus: "pending", toStatus: status, reason: reason || null, at }),
      audit: audit({ review, actorMemberId: input.actorMemberId,
        type: status === "approved" ? "copy.review_approved" : "copy.review_changes_requested", at }) });
    if (status === "approved") {
      const finalGate = await gate({ ...input, copyVersionId: review.copy_version_id });
      await revokeInvalidApproval(input, decided, finalGate, receipt.receiptKey);
      await approvalReturnBarrier({ organizationId: input.organizationId, reviewId: review.id,
        copyVersionId: review.copy_version_id });
      return projection({ ...input, copyVersionId: review.copy_version_id }, receipt.receiptKey);
    }
    return projection({ ...input, copyVersionId: review.copy_version_id });
  }

  return {
    async submitReview(input) {
      context(input); key(input.idempotencyKey);
      const fingerprint = stableJson({ copy_version_id: input.copyVersionId });
      const receipt = await preflight(input, "review-submit", fingerprint);
      if (receipt.result) return receipt.result;
      await projection(input);
      const currentGate = await gate(input);
      if (!currentGate.allowed) throw failure("COPY_REVIEW_GATE_BLOCKED", currentGate.reasons);
      const at = timestamp();
      const review = { id: randomUUID(), organization_id: input.organizationId, copy_version_id: currentGate.copy.id,
        author_member_id: input.actorMemberId, quality_result_id: currentGate.quality.id,
        product_revision_id: currentGate.copy.product_revision_id, profile_version: currentGate.quality.profile_version,
        rule_version: currentGate.quality.rule_version, created_at: at };
      const head = { ...review, status: "pending", row_version: 1, reviewer_member_id: null,
        review_mode: null, decision_reason: null, decided_at: null, revoked_at: null,
        revoke_reason: null, revoke_reason_code: null, updated_at: at };
      await repository.createReview({ receiptKey: receipt.receiptKey, fingerprint,
        review, head, event: event({ review, actorMemberId: input.actorMemberId, fromStatus: "not_submitted", toStatus: "pending", at }),
        audit: audit({ review, actorMemberId: input.actorMemberId, type: "copy.review_submitted", at }) });
      return projection(input);
    },
    async approveReview(input) { return decide(input, { status: "approved" }); },
    async requestChanges(input) { return decide(input, { status: "changes_requested", reasonRequired: true }); },
    async revokeReview(input) {
      context(input); reviewer(input); key(input.idempotencyKey);
      const reason = clean(input.reason);
      const fingerprint = stableJson({ review_id: input.reviewId, expected_revision: input.expectedRevision, reason });
      const receipt = await preflight(input, "review-revoke", fingerprint);
      if (receipt.result) return receipt.result;
      if (!reason) throw failure("COPY_REVIEW_REASON_REQUIRED");
      const review = await getReviewForCommand(input), at = timestamp();
      await repository.transition({ receiptKey: receipt.receiptKey, fingerprint,
        reviewId: review.id, organizationId: input.organizationId, expectedRevision: input.expectedRevision,
        fromStatuses: ["approved"], patch: { status: "revoked", revoked_at: at, revoke_reason: reason,
          revoke_reason_code: "manual_revoke" }, event: event({ review, actorMemberId: input.actorMemberId,
            fromStatus: "approved", toStatus: "revoked", reason, reasonCode: "manual_revoke", at }),
        audit: audit({ review, actorMemberId: input.actorMemberId, type: "copy.review_revoked", at }) });
      return projection({ ...input, copyVersionId: review.copy_version_id });
    },
    async getReviewState(input) { context(input); return projection(input); },
    async getCurrentApprovedGate(input) {
      context(input);
      const state = await projection(input);
      return { approved: state.current_review?.status === "approved" && state.gate.reasons.length === 0,
        review_id: state.current_review?.status === "approved" ? state.current_review.id : null,
        reasons: state.gate.reasons };
    },
    reconcileCopyVersion,
    reconcileProductRevision
  };
}
