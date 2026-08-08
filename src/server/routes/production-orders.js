function actor(request) {
  return { organizationId: request.identity.organization.id, actorMemberId: request.identity.member.id,
    actorRole: request.identity.membership.role };
}

function withoutOrganization(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { organization_id: _organizationId, ...safe } = value;
  return safe;
}

function publicPlan(value) {
  return value ? withoutOrganization(value) : null;
}

function publicReview(value) {
  return value ? withoutOrganization(value) : null;
}

function publicPreflight(value) {
  return value ? withoutOrganization(value) : null;
}

function publicSnapshot(value) {
  if (!value) return null;
  return {
    video_plan_version: publicPlan(value.video_plan_version),
    plan_review: publicReview(value.plan_review),
    preflight_result: publicPreflight(value.preflight_result),
    upstream_snapshot: value.upstream_snapshot,
    approved_copy_snapshot: value.approved_copy_snapshot,
    avatar_selection_snapshot: value.avatar_selection_snapshot,
    capability_config_snapshot: value.capability_config_snapshot,
    output_instructions: value.output_instructions
  };
}

function publicOrder(value) {
  if (!value) return null;
  const { organization_id: _organizationId, input_snapshot, ...safe } = value;
  return { ...safe, input_snapshot: publicSnapshot(input_snapshot) };
}

function publicWorkspace(value) {
  return {
    current_plan: publicPlan(value.current_plan),
    current_plan_review: publicReview(value.current_plan_review),
    current_preflight_result: publicPreflight(value.current_preflight_result),
    gate: value.gate,
    execution_environment: value.execution_environment,
    orders: value.orders.map(publicOrder),
    selected_order: publicOrder(value.selected_order)
  };
}

export async function registerProductionOrderRoutes(app, { service }) {
  app.get("/api/products/:productId/production-workspace", async (request) => publicWorkspace(await service.getWorkspace({
    ...actor(request), productId: request.params.productId, orderId: request.query?.orderId
  })));

  app.get("/api/products/:productId/production-orders", async (request) => ({
    orders: (await service.listOrders({ ...actor(request), productId: request.params.productId })).map(publicOrder)
  }));

  app.get("/api/production-orders/:orderId", async (request) => ({
    order: publicOrder(await service.getOrder({ ...actor(request), orderId: request.params.orderId }))
  }));

  app.post("/api/products/:productId/production-orders", async (request, reply) => {
    const result = await service.createProductionOrder({ ...actor(request), productId: request.params.productId,
      videoPlanVersionId: request.body?.video_plan_version_id, executionPurpose: request.body?.execution_purpose,
      idempotencyKey: request.headers["idempotency-key"] });
    reply.code(201).send({ order: publicOrder(result.order), replayed: result.replayed, execution_environment: result.execution_environment });
  });
}
