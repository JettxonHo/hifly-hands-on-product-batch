function actor(request) {
  return { organizationId: request.identity.organization.id, actorMemberId: request.identity.member.id,
    actorRole: request.identity.membership.role };
}

function idempotency(request, body = {}) {
  return body.idempotency_key || body.idempotencyKey || request.headers["idempotency-key"];
}

function safeOrder(value) {
  if (!value) return null;
  const { organization_id: _organizationId, input_snapshot: _inputSnapshot, ...safe } = value;
  return safe;
}

function withoutOrganization(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const { organization_id: _organizationId, lease_token: _leaseToken, object_key: _objectKey, ...safe } = value;
  return safe;
}

function safeWorkspace(value) {
  return {
    ...value,
    order: safeOrder(value.order),
    job: withoutOrganization(value.job),
    work: withoutOrganization(value.work),
    works: (value.works || []).map(withoutOrganization)
  };
}

export async function registerWorkVerificationRoutes(app, { service }) {
  app.get("/api/production-orders/:orderId/work-verification", async (request) => safeWorkspace(await service.getVerificationWorkspace({
    ...actor(request), productionOrderId: request.params.orderId
  })));

  app.post("/api/production-orders/:orderId/work-verification", async (request, reply) => {
    const body = request.body || {};
    const result = await service.requestVerification({ ...actor(request), productionOrderId: request.params.orderId,
      executionAttemptId: body.execution_attempt_id || body.executionAttemptId,
      reportId: body.report_id || body.reportId,
      candidateId: body.candidate_id || body.candidateId,
      idempotencyKey: idempotency(request, body) });
    reply.code(result.replayed ? 200 : 202).send(result);
  });

  app.get("/api/work-verification-jobs/:jobId", async (request) => ({
    job: withoutOrganization(await service.getVerificationJob({ ...actor(request), jobId: request.params.jobId }))
  }));

  app.post("/api/work-verification-jobs/:jobId/retry", async (request, reply) => {
    const body = request.body || {};
    const result = await service.retryVerification({ ...actor(request), jobId: request.params.jobId,
      idempotencyKey: idempotency(request, body) });
    reply.code(result.replayed ? 200 : 202).send(result);
  });

  app.post("/api/work-verification-jobs/:jobId/recover", async (request, reply) => {
    const body = request.body || {};
    const result = await service.recoverVerification({ ...actor(request), jobId: request.params.jobId,
      resolutionNote: body.resolution_note || body.resolutionNote,
      idempotencyKey: idempotency(request, body) });
    reply.code(result.replayed ? 200 : 202).send(result);
  });
}
