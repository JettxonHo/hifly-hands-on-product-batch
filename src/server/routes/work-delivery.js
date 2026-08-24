function actor(request) {
  return { organizationId: request.identity.organization.id, actorMemberId: request.identity.member.id,
    actorRole: request.identity.membership.role };
}

function idempotency(request, body = {}) {
  return body.idempotency_key || body.idempotencyKey || request.headers["idempotency-key"];
}

function precondition(body) {
  const expectedInspectionId = body.expected_inspection_id || body.expectedInspectionId;
  const rawRevision = body.expected_revision ?? body.expectedRevision;
  const expectedRevision = typeof rawRevision === "number" || (typeof rawRevision === "string" && rawRevision.trim() !== "") ? Number(rawRevision) : NaN;
  if (typeof expectedInspectionId !== "string" || expectedInspectionId.trim() === "" || !Number.isInteger(expectedRevision) || expectedRevision < 1) {
    throw Object.assign(new Error("WORK_DELIVERY_INSPECTION_PRECONDITION_REQUIRED"), { code: "WORK_DELIVERY_INSPECTION_PRECONDITION_REQUIRED" });
  }
  return { expectedInspectionId: expectedInspectionId.trim(), expectedRevision };
}

function commandStatus(result) { return result.replayed ? 200 : 201; }

function owns(value, key) { return Object.prototype.hasOwnProperty.call(value || {}, key); }

function attachmentDisposition(filename) {
  const cleaned = String(filename || "download")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "_")
    .trim() || "download";
  const encoded = encodeURIComponent(cleaned)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="download"; filename*=UTF-8''${encoded}`;
}

export async function registerWorkDeliveryRoutes(app, { service }) {
  app.get("/api/works", async (request) => {
    const query = request.query || {};
    const input = { ...actor(request),
      projectId: query.projectId ?? query.project_id ?? null,
      deliveryStatus: query.deliveryStatus ?? query.delivery_status ?? null };
    const paged = ["page", "pageSize", "page_size", "anchorWorkId", "anchor_work_id"].some((key) => owns(query, key));
    if (paged) return service.listWorksPage({ ...input,
      page: query.page,
      pageSize: query.pageSize ?? query.page_size,
      anchorWorkId: query.anchorWorkId ?? query.anchor_work_id ?? null });
    return { works: await service.listWorks(input) };
  });

  app.get("/api/works/:workId", async (request) => ({ work: await service.getWork({ ...actor(request), workId: request.params.workId }) }));

  app.post("/api/works/:workId/inspections/pass", async (request, reply) => {
    const body = request.body || {};
    const expected = precondition(body);
    const result = await service.markDeliverable({ ...actor(request), workId: request.params.workId,
      ...expected,
      idempotencyKey: idempotency(request, body) });
    reply.code(commandStatus(result)).send(result);
  });

  app.post("/api/works/:workId/inspections/rework", async (request, reply) => {
    const body = request.body || {};
    const expected = precondition(body);
    const result = await service.requestRework({ ...actor(request), workId: request.params.workId,
      category: body.category, reason: body.reason, targetUpstreamStage: body.target_upstream_stage || body.targetUpstreamStage,
      ...expected,
      idempotencyKey: idempotency(request, body) });
    reply.code(commandStatus(result)).send(result);
  });

  app.post("/api/works/:workId/deliveries", async (request, reply) => {
    const body = request.body || {};
    const expected = precondition(body);
    const result = await service.createDelivery({ ...actor(request), workId: request.params.workId,
      deliveryMethod: body.delivery_method || body.deliveryMethod, note: body.note,
      deliveredAt: body.delivered_at || body.deliveredAt, recipientReference: body.recipient_reference || body.recipientReference,
      ...expected,
      idempotencyKey: idempotency(request, body) });
    reply.code(commandStatus(result)).send(result);
  });

  app.post("/api/works/:workId/download-authorizations", async (request, reply) => {
    const result = await service.createDownloadAuthorization({ ...actor(request), workId: request.params.workId });
    reply.code(201).send({ download: {
      url: `/api/works/${encodeURIComponent(request.params.workId)}/downloads/${encodeURIComponent(result.token)}`,
      expires_at: result.expires_at,
      filename: result.original_filename,
      media_type: result.verified_content_type,
      size: result.verified_size,
      checksum_sha256: result.verified_checksum_sha256
    } });
  });

  app.get("/api/works/:workId/downloads/:token", async (request, reply) => {
    const result = await service.downloadObject?.({ ...actor(request), workId: request.params.workId, token: request.params.token });
    if (!result) throw Object.assign(new Error("WORK_DELIVERY_DOWNLOAD_UNAVAILABLE"), { code: "WORK_DELIVERY_DOWNLOAD_UNAVAILABLE" });
    reply
      .type(result.verified_content_type)
      .header("Content-Disposition", attachmentDisposition(result.original_filename))
      .send(result.body);
  });
}
