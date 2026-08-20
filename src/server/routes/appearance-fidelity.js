function actor(request) {
  return {
    organizationId: request.identity.organization.id,
    actorMemberId: request.identity.member.id,
    actorRole: request.identity.membership.role,
  };
}

function memberActor(request) {
  const { actorRole: _actorRole, ...identity } = actor(request);
  return identity;
}

function requiredString(value, code = 'APPEARANCE_CAPTURE_CONTEXT_REQUIRED') {
  if (typeof value !== 'string' || value.trim() === '') {
    throw Object.assign(new Error(code), { code });
  }
  return value.trim();
}

function requiredRevision(value) {
  const revision = typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')
    ? Number(value)
    : NaN;
  if (!Number.isInteger(revision) || revision < 0) {
    throw Object.assign(new Error('APPEARANCE_CAPTURE_CONTEXT_REQUIRED'), { code: 'APPEARANCE_CAPTURE_CONTEXT_REQUIRED' });
  }
  return revision;
}

function idempotencyKey(request) {
  const value = requiredString(request.headers['idempotency-key'], 'INVALID_IDEMPOTENCY_KEY');
  if (value.length > 128) throw Object.assign(new Error('INVALID_IDEMPOTENCY_KEY'), { code: 'INVALID_IDEMPOTENCY_KEY' });
  return value;
}

function captureRequestProjection(record) {
  const projected = {
    id: record.id,
    status: record.status,
    row_version: record.row_version,
    max_candidate_generations: record.max_candidate_generations,
    product_id: record.product_id,
    product_revision_id: record.product_revision_id,
    source_asset_version_id: record.source_asset_version_id,
    copy_version_id: record.copy_version_id,
    copy_review_id: record.copy_review_id,
    avatar_selection_id: record.avatar_selection_id,
    avatar_asset_version_id: record.avatar_asset_version_id,
    video_plan_version_id: record.video_plan_version_id,
    plan_review_id: record.plan_review_id,
    preflight_result_id: record.preflight_result_id,
    presentation_size_code: record.presentation_size_code,
    requested_by_member_id: record.requested_by_member_id,
    created_at: record.created_at,
    updated_at: record.updated_at,
    status_history: Array.isArray(record.status_history)
      ? record.status_history.map(({ status, row_version, at }) => ({ status, row_version, at }))
      : [],
  };
  for (const key of ['authorized_by_member_id', 'authorized_at', 'appearance_candidate_id', 'failure_code']) {
    if (record[key] != null) projected[key] = record[key];
  }
  return projected;
}

function candidateProjection(record) {
  const keys = [
    'id', 'capture_request_id', 'product_id', 'product_revision_id', 'source_asset_version_id',
    'source_asset_media_type', 'source_asset_size', 'source_asset_checksum_sha256', 'copy_version_id',
    'copy_review_id', 'avatar_selection_id', 'avatar_asset_version_id', 'video_plan_version_id',
    'plan_review_id', 'preflight_result_id', 'presentation_size_code', 'candidate_asset_id',
    'candidate_asset_version_id', 'media_type', 'size', 'checksum_sha256', 'provider',
    'provider_reference_type', 'generation_context_version', 'created_at',
  ];
  return Object.fromEntries(keys.filter((key) => record?.[key] !== undefined).map((key) => [key, record[key]]));
}

function stateProjection(record) {
  if (!record) return null;
  const keys = ['candidate_id', 'state', 'row_version', 'reason_code', 'observed_at', 'updated_at', 'superseded_by_candidate_id'];
  return Object.fromEntries(keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
}

function observationProjection(record) {
  if (!record) return null;
  const keys = ['id', 'candidate_id', 'status', 'observed_at', 'valid_until', 'expired', 'reason_code'];
  return Object.fromEntries(keys.filter((key) => record[key] !== undefined).map((key) => [key, record[key]]));
}

function attachmentDisposition(filename) {
  const cleaned = String(filename || 'candidate')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '_')
    .trim() || 'candidate';
  const encoded = encodeURIComponent(cleaned)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="candidate"; filename*=UTF-8''${encoded}`;
}

function candidateEnvelope(result) {
  return {
    candidate: candidateProjection(result.candidate),
    candidate_state: stateProjection(result.candidate_state),
    provider_reference_status: observationProjection(result.provider_reference_status),
  };
}

export async function registerAppearanceFidelityRoutes(app, { service, worker = null }) {
  app.post('/api/products/:productId/appearance-capture-requests', async (request, reply) => {
    const body = request.body || {};
    const result = await service.createCaptureRequest({
      ...memberActor(request),
      productId: requiredString(request.params.productId),
      productRevisionId: requiredString(body.product_revision_id),
      sourceAssetVersionId: requiredString(body.source_asset_version_id),
      copyVersionId: requiredString(body.copy_version_id),
      avatarSelectionId: requiredString(body.avatar_selection_id),
      videoPlanVersionId: requiredString(body.video_plan_version_id),
      expectedWorkspaceRevision: requiredRevision(body.expected_workspace_revision),
      idempotencyKey: idempotencyKey(request),
    });
    reply.code(result.replayed ? 200 : 201).send({ capture_request: captureRequestProjection(result.capture_request), replayed: result.replayed === true });
  });

  app.get('/api/products/:productId/appearance-capture-requests', async (request) => {
    const result = await service.listCaptureRequests({
      ...memberActor(request),
      productId: requiredString(request.params.productId),
      status: request.query?.status,
      limit: request.query?.limit,
      cursor: request.query?.cursor,
    });
    return { capture_requests: result.capture_requests.map(captureRequestProjection), next_cursor: result.next_cursor ?? null };
  });

  app.get('/api/appearance-capture-requests/:requestId', async (request) => {
    const result = await service.getCaptureRequest({ ...memberActor(request), requestId: requiredString(request.params.requestId) });
    return { capture_request: captureRequestProjection(result.capture_request) };
  });

  app.post('/api/appearance-capture-requests/:requestId/authorize', async (request, reply) => {
    const body = request.body || {};
    const max = Number(body.max_candidate_generations);
    if (max !== 1) throw Object.assign(new Error('APPEARANCE_CAPTURE_CONFLICT'), { code: 'APPEARANCE_CAPTURE_CONFLICT' });
    const result = await service.authorizeCaptureRequest({
      ...actor(request),
      requestId: requiredString(request.params.requestId),
      expectedRevision: requiredRevision(body.expected_revision),
      maxCandidateGenerations: max,
      idempotencyKey: idempotencyKey(request),
    });
    worker?.wake?.();
    reply.code(result.replayed ? 200 : 202).send({ capture_request: captureRequestProjection(result.capture_request), replayed: result.replayed === true });
  });

  app.post('/api/appearance-capture-requests/:requestId/cancel', async (request) => {
    const body = request.body || {};
    const result = await service.cancelCaptureRequest({
      ...actor(request),
      requestId: requiredString(request.params.requestId),
      expectedRevision: requiredRevision(body.expected_revision),
      idempotencyKey: idempotencyKey(request),
    });
    return { capture_request: captureRequestProjection(result.capture_request), replayed: result.replayed === true };
  });

  app.get('/api/products/:productId/appearance-candidates', async (request) => {
    const result = await service.listCandidates({
      ...memberActor(request),
      productId: requiredString(request.params.productId),
      state: request.query?.state,
      limit: request.query?.limit,
      cursor: request.query?.cursor,
    });
    return { candidates: result.candidates.map(candidateProjection), next_cursor: result.next_cursor ?? null };
  });

  app.get('/api/appearance-candidates/:candidateId', async (request) => {
    const result = await service.getCandidate({ ...memberActor(request), candidateId: requiredString(request.params.candidateId) });
    return candidateEnvelope(result);
  });

  app.post('/api/appearance-candidates/:candidateId/download-authorizations', async (request, reply) => {
    const candidateId = requiredString(request.params.candidateId);
    const result = await service.createCandidateDownloadAuthorization({ ...memberActor(request), candidateId });
    reply.code(201).send({ download: {
      url: `/api/appearance-candidates/${encodeURIComponent(candidateId)}/downloads/${encodeURIComponent(result.token)}`,
      expires_at: result.expires_at,
      filename: result.filename,
      media_type: result.media_type,
      size: result.size,
      checksum_sha256: result.checksum_sha256,
    } });
  });

  app.get('/api/appearance-candidates/:candidateId/downloads/:token', async (request, reply) => {
    const result = await service.downloadCandidateObject({
      ...memberActor(request),
      candidateId: requiredString(request.params.candidateId),
      token: requiredString(request.params.token),
    });
    reply.type(result.media_type).header('Content-Disposition', attachmentDisposition(result.filename)).send(result.body);
  });
}
