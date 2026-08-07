function actor(request) {
  return { organizationId: request.identity.organization.id, actorMemberId: request.identity.member.id,
    actorRole: request.identity.membership.role };
}

function publicReview(review) {
  return review ? {
    id: review.id, copy_version_id: review.copy_version_id, author_member_id: review.author_member_id,
    quality_result_id: review.quality_result_id, product_revision_id: review.product_revision_id,
    profile_version: review.profile_version, rule_version: review.rule_version, status: review.status,
    row_version: review.row_version, reviewer_member_id: review.reviewer_member_id,
    review_mode: review.review_mode, decision_reason: review.decision_reason, decided_at: review.decided_at,
    revoked_at: review.revoked_at, revoke_reason: review.revoke_reason,
    revoke_reason_code: review.revoke_reason_code, created_at: review.created_at, updated_at: review.updated_at
  } : null;
}

function publicEvent(event) {
  return { id: event.id, human_review_id: event.human_review_id, copy_version_id: event.copy_version_id,
    actor_member_id: event.actor_member_id, from_status: event.from_status, to_status: event.to_status,
    reason: event.reason, reason_code: event.reason_code, created_at: event.created_at };
}

function projection(value) {
  return { current_review: publicReview(value.current_review), reviews: value.reviews.map(publicReview),
    history: value.history.map(publicEvent), gate: value.gate };
}

export async function registerCopyReviewRoutes(app, { service }) {
  app.get("/api/copy-versions/:copyVersionId/review", async (request) => projection(await service.getReviewState({
    ...actor(request), copyVersionId: request.params.copyVersionId
  })));
  app.get("/api/copy-versions/:copyVersionId/approved-gate", async (request) => service.getCurrentApprovedGate({
    ...actor(request), copyVersionId: request.params.copyVersionId
  }));
  app.post("/api/copy-versions/:copyVersionId/reviews", async (request, reply) => {
    const value = await service.submitReview({ ...actor(request), copyVersionId: request.params.copyVersionId,
      idempotencyKey: request.headers["idempotency-key"] });
    reply.code(201).send(projection(value));
  });
  app.post("/api/copy-reviews/:reviewId/approve", async (request) => projection(await service.approveReview({
    ...actor(request), reviewId: request.params.reviewId, expectedRevision: request.body?.expected_revision,
    idempotencyKey: request.headers["idempotency-key"]
  })));
  app.post("/api/copy-reviews/:reviewId/request-changes", async (request) => projection(await service.requestChanges({
    ...actor(request), reviewId: request.params.reviewId, expectedRevision: request.body?.expected_revision,
    reason: request.body?.reason, idempotencyKey: request.headers["idempotency-key"]
  })));
  app.post("/api/copy-reviews/:reviewId/revoke", async (request) => projection(await service.revokeReview({
    ...actor(request), reviewId: request.params.reviewId, expectedRevision: request.body?.expected_revision,
    reason: request.body?.reason, idempotencyKey: request.headers["idempotency-key"]
  })));
}
