function actor(request) {
  return { organizationId: request.identity.organization.id, actorMemberId: request.identity.member.id,
    actorRole: request.identity.membership.role };
}
function plan(value) {
  if (!value) return null;
  const { organization_id, ...safe } = value;
  return safe;
}
function run(value) {
  if (!value) return null;
  const { organization_id, lease_token, input_snapshot, ...safe } = value;
  return safe;
}
function result(value) {
  if (!value) return null;
  const { organization_id, ...safe } = value;
  return safe;
}
function review(value) {
  if (!value) return null;
  const { organization_id, ...safe } = value;
  return safe;
}
function workspace(value) {
  return { current_plan: plan(value.current_plan), head_revision: value.head_revision,
    versions: value.versions.map(plan),
    preflight: { current_run: run(value.preflight.current_run), current_result: result(value.preflight.current_result),
      history: value.preflight.history.map((item) => ({ ...run(item), result: result(item.result) })) },
    review: { current_review: review(value.review.current_review), history: value.review.history.map(review), gate: value.review.gate },
    production_order_available: value.production_order_available === true, production_order_notice: value.production_order_notice };
}

export async function registerVideoPlanningRoutes(app, { service }) {
  app.get("/api/products/:productId/video-plan-workspace", async (request) => workspace(await service.getWorkspace({
    ...actor(request), productId: request.params.productId, planId: request.query?.planVersionId
  })));
  app.post("/api/products/:productId/video-plans", async (request, reply) => reply.code(201).send(workspace(await service.createPlan({
    ...actor(request), productId: request.params.productId, outputInstructions: request.body?.output_instructions,
    presentationSizeCode: request.body?.presentation_size_code,
    expectedHeadRevision: request.body?.expected_head_revision, idempotencyKey: request.headers["idempotency-key"]
  }))));
  app.patch("/api/products/:productId/video-plans/:planId", async (request) => workspace(await service.saveDraft({
    ...actor(request), productId: request.params.productId, planId: request.params.planId,
    outputInstructions: request.body?.output_instructions, presentationSizeCode: request.body?.presentation_size_code,
    expectedRevision: request.body?.expected_revision
  })));
  app.post("/api/products/:productId/video-plans/:planId/derive", async (request, reply) => reply.code(201).send(workspace(await service.deriveDraft({
    ...actor(request), productId: request.params.productId, planId: request.params.planId,
    outputInstructions: request.body?.output_instructions, expectedHeadRevision: request.body?.expected_head_revision,
    presentationSizeCode: request.body?.presentation_size_code,
    idempotencyKey: request.headers["idempotency-key"]
  }))));
  app.post("/api/products/:productId/video-plans/:planId/preflight", async (request, reply) => reply.code(202).send(workspace(await service.requestPreflight({
    ...actor(request), productId: request.params.productId, planId: request.params.planId,
    expectedRevision: request.body?.expected_revision, idempotencyKey: request.headers["idempotency-key"]
  }))));
  app.post("/api/products/:productId/video-plans/:planId/reviews", async (request, reply) => reply.code(201).send(workspace(await service.submitReview({
    ...actor(request), productId: request.params.productId, planId: request.params.planId,
    idempotencyKey: request.headers["idempotency-key"]
  }))));
  app.post("/api/products/:productId/plan-reviews/:reviewId/approve", async (request) => workspace(await service.approveReview({
    ...actor(request), productId: request.params.productId, reviewId: request.params.reviewId,
    expectedRevision: request.body?.expected_revision, idempotencyKey: request.headers["idempotency-key"]
  })));
  app.post("/api/products/:productId/plan-reviews/:reviewId/request-changes", async (request) => workspace(await service.requestChanges({
    ...actor(request), productId: request.params.productId, reviewId: request.params.reviewId,
    expectedRevision: request.body?.expected_revision, reason: request.body?.reason,
    idempotencyKey: request.headers["idempotency-key"]
  })));
}
