function actor(request) {
  return { organizationId: request.identity.organization.id, actorMemberId: request.identity.member.id,
    actorRole: request.identity.membership.role };
}

function idempotency(request, body = {}) {
  return body.idempotency_key || body.idempotencyKey || request.headers["idempotency-key"];
}

function commandStatus(result) { return result.replayed ? 200 : 201; }

export async function registerWorkDeliveryRoutes(app, { service }) {
  app.get("/api/works", async (request) => ({ works: await service.listWorks({ ...actor(request),
    projectId: request.query?.projectId || request.query?.project_id || null,
    deliveryStatus: request.query?.deliveryStatus || request.query?.delivery_status || null }) }));

  app.get("/api/works/:workId", async (request) => ({ work: await service.getWork({ ...actor(request), workId: request.params.workId }) }));

  app.post("/api/works/:workId/inspections/pass", async (request, reply) => {
    const body = request.body || {};
    const result = await service.markDeliverable({ ...actor(request), workId: request.params.workId,
      expectedInspectionId: body.expected_inspection_id || body.expectedInspectionId || null,
      expectedRevision: body.expected_revision ?? body.expectedRevision ?? null,
      idempotencyKey: idempotency(request, body) });
    reply.code(commandStatus(result)).send(result);
  });

  app.post("/api/works/:workId/inspections/rework", async (request, reply) => {
    const body = request.body || {};
    const result = await service.requestRework({ ...actor(request), workId: request.params.workId,
      category: body.category, reason: body.reason, targetUpstreamStage: body.target_upstream_stage || body.targetUpstreamStage,
      expectedInspectionId: body.expected_inspection_id || body.expectedInspectionId || null,
      expectedRevision: body.expected_revision ?? body.expectedRevision ?? null,
      idempotencyKey: idempotency(request, body) });
    reply.code(commandStatus(result)).send(result);
  });

  app.post("/api/works/:workId/deliveries", async (request, reply) => {
    const body = request.body || {};
    const result = await service.createDelivery({ ...actor(request), workId: request.params.workId,
      deliveryMethod: body.delivery_method || body.deliveryMethod, note: body.note,
      deliveredAt: body.delivered_at || body.deliveredAt, recipientReference: body.recipient_reference || body.recipientReference,
      expectedInspectionId: body.expected_inspection_id || body.expectedInspectionId || null,
      expectedRevision: body.expected_revision ?? body.expectedRevision ?? null,
      idempotencyKey: idempotency(request, body) });
    reply.code(commandStatus(result)).send(result);
  });

  app.post("/api/works/:workId/download-authorizations", async (request, reply) => {
    const result = await service.createDownloadAuthorization({ ...actor(request), workId: request.params.workId });
    reply.code(201).send({ download: { url: `/api/works/${encodeURIComponent(request.params.workId)}/downloads/${encodeURIComponent(result.token)}`, expires_at: result.expires_at } });
  });

  app.get("/api/works/:workId/downloads/:token", async (request, reply) => {
    const result = await service.downloadObject?.({ ...actor(request), workId: request.params.workId, token: request.params.token });
    if (!result) throw Object.assign(new Error("WORK_DELIVERY_DOWNLOAD_UNAVAILABLE"), { code: "WORK_DELIVERY_DOWNLOAD_UNAVAILABLE" });
    reply.type(result.contentType).send(result.body);
  });
}
