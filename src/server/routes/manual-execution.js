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

function safeWorkspace(value) {
  return { ...value, order: safeOrder(value.order) };
}

function contentType(request) {
  return String(request.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
}

export async function registerManualExecutionRoutes(app, { service }) {
  app.get("/api/production-orders/:orderId/manual-execution", async (request) => safeWorkspace(await service.getExecutionWorkspace({
    ...actor(request), productionOrderId: request.params.orderId
  })));

  app.post("/api/production-orders/:orderId/manual-execution/claim", async (request, reply) => {
    const body = request.body || {};
    const result = await service.claimManualTask({ ...actor(request), productionOrderId: request.params.orderId,
      packageId: body.package_id || body.packageId, idempotencyKey: idempotency(request, body) });
    reply.code(result.replayed ? 200 : 201).send({ attempt: result.attempt, replayed: result.replayed });
  });

  app.post("/api/manual-execution-attempts/:attemptId/start", async (request) => {
    const body = request.body || {};
    return service.confirmStart({ ...actor(request), attemptId: request.params.attemptId, idempotencyKey: idempotency(request, body) });
  });

  app.post("/api/manual-execution-attempts/:attemptId/candidates/upload-authorizations", async (request, reply) => {
    const body = request.body || {};
    const result = await service.createCandidateUploadAuthorization({ ...actor(request), attemptId: request.params.attemptId,
      role: body.role, originalFilename: body.original_filename || body.originalFilename, mediaType: body.media_type || body.mediaType,
      size: body.size, checksum: body.checksum, idempotencyKey: idempotency(request, body) });
    reply.code(result.replayed ? 200 : 201).send(result);
  });

  app.put("/api/manual-execution-candidate-uploads/:candidateId", async (request) => service.uploadCandidateObject({
    ...actor(request), candidateId: request.params.candidateId,
    uploadToken: request.headers["x-manual-upload-token"] || request.query?.upload_token || request.query?.uploadToken,
    body: request.body, contentType: contentType(request)
  }));

  app.post("/api/manual-execution-attempts/:attemptId/candidates/:candidateId/complete", async (request) => {
    const body = request.body || {};
    return service.completeCandidateUpload({ ...actor(request), attemptId: request.params.attemptId, candidateId: request.params.candidateId,
      uploadToken: body.upload_token || body.uploadToken || request.headers["x-manual-upload-token"], idempotencyKey: idempotency(request, body) });
  });

  app.post("/api/manual-execution-attempts/:attemptId/reports", async (request, reply) => {
    const body = request.body || {};
    const result = await service.submitReport({ ...actor(request), ...body, attemptId: request.params.attemptId,
      reportId: body.report_id || body.reportId, idempotencyKey: idempotency(request, body),
      primaryCandidateId: body.primary_candidate_id || body.primaryCandidateId,
      supportingCandidateIds: body.supporting_candidate_ids || body.supportingCandidateIds,
      supersedesReportId: body.supersedes_report_id || body.supersedesReportId,
      requiresActionReason: body.requires_action_reason || body.requiresActionReason,
      errorCategory: body.error_category || body.errorCategory, failureStage: body.failure_stage || body.failureStage,
      operatorNote: body.operator_note || body.operatorNote, upstreamReturnTarget: body.upstream_return_target || body.upstreamReturnTarget });
    reply.code(result.replayed ? 200 : 201).send(result);
  });

  app.post("/api/manual-execution-attempts/:attemptId/reports/:reportId/corrections", async (request, reply) => {
    const body = request.body || {};
    const result = await service.submitReport({ ...actor(request), ...body, attemptId: request.params.attemptId,
      reportId: body.report_id || body.reportId, idempotencyKey: idempotency(request, body), supersedesReportId: request.params.reportId,
      requiresActionReason: body.requires_action_reason || body.requiresActionReason,
      primaryCandidateId: body.primary_candidate_id || body.primaryCandidateId,
      supportingCandidateIds: body.supporting_candidate_ids || body.supportingCandidateIds });
    reply.code(result.replayed ? 200 : 201).send(result);
  });

  app.post("/api/manual-execution-attempts/:attemptId/recheck", async (request) => {
    const body = request.body || {};
    return service.recheckAttempt({ ...actor(request), attemptId: request.params.attemptId,
      idempotencyKey: idempotency(request, body), resolutionNote: body.resolution_note || body.resolutionNote });
  });

  app.post("/api/manual-execution-attempts/:attemptId/reenter", async (request) => {
    const body = request.body || {};
    return service.reenterFailedAttempt({ ...actor(request), attemptId: request.params.attemptId, idempotencyKey: idempotency(request, body) });
  });

  app.post("/api/production-orders/:orderId/cancel", async (request) => {
    const body = request.body || {};
    const result = await service.requestOrderCancellation({ ...actor(request), productionOrderId: request.params.orderId,
      idempotencyKey: idempotency(request, body) });
    return { ...result, order: safeOrder(result.order) };
  });
}
