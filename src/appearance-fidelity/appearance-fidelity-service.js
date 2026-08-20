import { createHash, randomUUID } from 'node:crypto';
import { fileTypeFromBuffer } from 'file-type';

const ACTIVE_CAPTURE_STATUSES = new Set(['awaiting_authorization', 'queued', 'running']);
const SOURCE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_CANDIDATE_BYTES = 10 * 1024 * 1024;
const HIFLY_PROVIDER_REFERENCE_TYPE = 'hifly-generation-reference';
const PROVIDER_REFERENCE_METHOD = 'provider_adapter.observeReference';
const PROVIDER_OBSERVATION_SEAM_VERSION = 'appearance-fidelity-observation-v1';
const PROVIDER_OBSERVATION_POLICY_VERSION = 'same-gate-observed-at-v1';

function contractError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function idempotencyPayload(input) {
  return stableJson({
    actor_member_id: input.actorMemberId,
    avatar_selection_id: input.avatarSelectionId,
    copy_version_id: input.copyVersionId,
    expected_workspace_revision: input.expectedWorkspaceRevision,
    organization_id: input.organizationId,
    product_id: input.productId,
    product_revision_id: input.productRevisionId,
    source_asset_version_id: input.sourceAssetVersionId,
    video_plan_version_id: input.videoPlanVersionId,
  });
}

function commandIdempotencyPayload(operation, input) {
  return stableJson({
    actor_member_id: input.actorMemberId,
    actor_role: input.actorRole,
    expected_revision: input.expectedRevision,
    max_candidate_generations: input.maxCandidateGenerations,
    operation,
    organization_id: input.organizationId,
    request_id: input.requestId,
  });
}

function upstreamFingerprint(input, snapshot) {
  return stableJson({
    avatar_asset_version_id: snapshot.avatar_asset_version_id,
    avatar_selection_id: snapshot.avatar_selection_id,
    copy_review_id: snapshot.copy_review_id,
    copy_version_id: snapshot.copy_version_id,
    organization_id: input.organizationId,
    plan_review_id: snapshot.plan_review_id,
    preflight_result_id: snapshot.preflight_result_id,
    presentation_size_code: snapshot.presentation_size_code,
    product_id: input.productId,
    product_revision_id: input.productRevisionId,
    source_asset_version_id: input.sourceAssetVersionId,
    video_plan_version_id: snapshot.video_plan_version_id,
    workspace_revision: snapshot.workspace_revision,
  });
}

function hasValue(value) {
  return typeof value === 'string' && value.length > 0;
}

function upstreamGateReasons(snapshot, input) {
  const reasons = [];
  if (!snapshot || snapshot.current_valid !== true) reasons.push('upstream_not_current');
  if (snapshot?.workspace_revision !== input.expectedWorkspaceRevision) reasons.push('workspace_revision_stale');
  if (snapshot?.product_id !== input.productId) reasons.push('product_not_current');
  if (snapshot?.product_revision_id !== input.productRevisionId) reasons.push('product_revision_not_current');
  if (!Array.isArray(snapshot?.source_asset_version_ids) ||
      !snapshot.source_asset_version_ids.includes(input.sourceAssetVersionId)) {
    reasons.push('source_asset_not_current');
  }
  if (snapshot?.copy_version_id !== input.copyVersionId) reasons.push('copy_version_not_current');
  if (!hasValue(snapshot?.copy_review_id)) reasons.push('copy_review_not_current');
  if (snapshot?.avatar_selection_id !== input.avatarSelectionId) reasons.push('avatar_selection_not_current');
  if (!hasValue(snapshot?.avatar_asset_version_id)) reasons.push('avatar_asset_not_current');
  if (snapshot?.video_plan_version_id !== input.videoPlanVersionId) reasons.push('video_plan_not_current');
  if (!hasValue(snapshot?.plan_review_id)) reasons.push('plan_review_not_current');
  if (!hasValue(snapshot?.preflight_result_id)) reasons.push('preflight_not_current');
  if (!hasValue(snapshot?.presentation_size_code)) reasons.push('presentation_size_unavailable');
  return [...new Set(reasons)];
}

function verifiedSourceAsset(sourceAsset, input) {
  const mediaType = typeof sourceAsset?.media_type === 'string'
    ? sourceAsset.media_type.toLowerCase()
    : null;
  if (
    sourceAsset?.asset_version_id !== input.sourceAssetVersionId ||
    sourceAsset.kind !== 'product_image' ||
    sourceAsset.asset_status !== 'active' ||
    sourceAsset.version_status !== 'available' ||
    !SOURCE_MEDIA_TYPES.has(mediaType) ||
    !Buffer.isBuffer(sourceAsset.bytes)
  ) {
    return null;
  }

  const size = sourceAsset.bytes.length;
  const checksumSha256 = createHash('sha256').update(sourceAsset.bytes).digest('hex');
  if (sourceAsset.size !== size ||
      typeof sourceAsset.checksum_sha256 !== 'string' ||
      sourceAsset.checksum_sha256.toLowerCase() !== checksumSha256) {
    return null;
  }

  return {
    checksumSha256,
    mediaType,
    size,
  };
}

function sameStructuredValue(left, right) {
  try {
    return stableJson(left) === stableJson(right);
  } catch {
    return false;
  }
}

function isPlainRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !Buffer.isBuffer(value);
}

function verifiedProviderReference(type, reference) {
  if (type !== HIFLY_PROVIDER_REFERENCE_TYPE || !isPlainRecord(reference)) return null;
  const keys = Object.keys(reference);
  if (keys.length !== 1 || keys[0] !== 'generation_id') return null;
  if (typeof reference.generation_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(reference.generation_id)) {
    return null;
  }
  return { generation_id: reference.generation_id };
}

function validTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function pageOf(records, input, kind) {
  const limit = input.limit == null ? 50 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw contractError('APPEARANCE_PAGINATION_INVALID', 'list limit must be between 1 and 100');
  }
  let offset = 0;
  if (input.cursor != null && input.cursor !== '') {
    try {
      const decoded = JSON.parse(Buffer.from(String(input.cursor), 'base64url').toString('utf8'));
      if (decoded?.kind !== kind || !Number.isInteger(decoded.offset) || decoded.offset < 0) throw new Error('invalid cursor');
      offset = decoded.offset;
    } catch {
      throw contractError('APPEARANCE_PAGINATION_INVALID', 'list cursor is invalid');
    }
  }
  const page = records.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    page,
    nextCursor: nextOffset < records.length
      ? Buffer.from(JSON.stringify({ kind, offset: nextOffset }), 'utf8').toString('base64url')
      : null,
  };
}

function referenceFingerprint(reference) {
  return createHash('sha256').update(stableJson(reference)).digest('hex');
}

function controlledFailureCode(error, fallback) {
  const code = error?.code;
  if (typeof code === 'string' &&
      /^(?:APPEARANCE_|PROVIDER_|CANDIDATE_|SOURCE_|UPSTREAM_)[A-Z0-9_]+$/.test(code)) {
    return code;
  }
  return fallback;
}

function publicCandidate(record) {
  return {
    id: record.id,
    capture_request_id: record.capture_request_id,
    product_id: record.product_id,
    product_revision_id: record.product_revision_id,
    source_asset_version_id: record.source_asset_version_id,
    source_asset_media_type: record.source_asset_media_type,
    source_asset_size: record.source_asset_size,
    source_asset_checksum_sha256: record.source_asset_checksum_sha256,
    copy_version_id: record.copy_version_id,
    copy_review_id: record.copy_review_id,
    avatar_selection_id: record.avatar_selection_id,
    avatar_asset_version_id: record.avatar_asset_version_id,
    video_plan_version_id: record.video_plan_version_id,
    plan_review_id: record.plan_review_id,
    preflight_result_id: record.preflight_result_id,
    presentation_size_code: record.presentation_size_code,
    candidate_asset_id: record.candidate_asset_id,
    candidate_asset_version_id: record.candidate_asset_version_id,
    media_type: record.media_type,
    size: record.size,
    checksum_sha256: record.checksum_sha256,
    provider: record.provider,
    provider_reference_type: record.provider_reference_type,
    generation_context_version: record.generation_context_version,
    created_at: record.created_at,
  };
}

function publicCandidateState(record) {
  const projection = {
    candidate_id: record.candidate_id,
    state: record.state,
    row_version: record.row_version,
    reason_code: record.reason_code,
    observed_at: record.observed_at,
    updated_at: record.updated_at,
  };
  if (record.superseded_by_candidate_id != null) {
    projection.superseded_by_candidate_id = record.superseded_by_candidate_id;
  }
  return projection;
}

function publicProviderReferenceObservation(record, nowValue) {
  const validUntil = Date.parse(record.valid_until);
  const currentAt = Date.parse(nowValue);
  return {
    id: record.id,
    candidate_id: record.candidate_id,
    status: record.status,
    observed_at: record.observed_at,
    valid_until: record.valid_until,
    expired: Number.isFinite(validUntil) && Number.isFinite(currentAt)
      ? currentAt >= validUntil
      : true,
    reason_code: record.reason_code,
  };
}

function captureInputFromRecord(record, systemActorId) {
  return {
    organizationId: record.organization_id,
    actorMemberId: systemActorId,
    productId: record.product_id,
    productRevisionId: record.product_revision_id,
    sourceAssetVersionId: record.source_asset_version_id,
    copyVersionId: record.copy_version_id,
    avatarSelectionId: record.avatar_selection_id,
    videoPlanVersionId: record.video_plan_version_id,
    expectedWorkspaceRevision: record.workspace_revision,
  };
}

function upstreamBindingsFromRecord(record) {
  return {
    organization_id: record.organization_id,
    product_id: record.product_id,
    product_revision_id: record.product_revision_id,
    source_asset_version_id: record.source_asset_version_id,
    ...structuredClone(record.upstream_snapshot),
  };
}

async function validateGeneratedCandidate(response, request) {
  if (!response || typeof response !== 'object') {
    throw contractError('CANDIDATE_RESPONSE_INVALID', 'provider candidate response is invalid');
  }
  if (response.request_id !== request.id) {
    throw contractError(
      'CANDIDATE_REQUEST_BINDING_MISMATCH',
      'provider candidate is bound to another capture request',
    );
  }
  if (response.source_checksum !== request.source_asset_checksum_sha256) {
    throw contractError(
      'CANDIDATE_SOURCE_BINDING_MISMATCH',
      'provider candidate is bound to another source asset',
    );
  }
  if (!Buffer.isBuffer(response.bytes) || response.bytes.length < 1) {
    throw contractError('CANDIDATE_BYTES_MISSING', 'provider candidate bytes are required');
  }
  if (response.bytes.length > MAX_CANDIDATE_BYTES) {
    throw contractError('CANDIDATE_SIZE_NOT_ALLOWED', 'provider candidate is too large');
  }

  const mediaType = typeof response.media_type === 'string'
    ? response.media_type.toLowerCase()
    : null;
  if (!SOURCE_MEDIA_TYPES.has(mediaType)) {
    throw contractError('CANDIDATE_MEDIA_TYPE_NOT_ALLOWED', 'provider candidate media type is not allowed');
  }

  let detected;
  try {
    detected = await fileTypeFromBuffer(response.bytes);
  } catch {
    detected = null;
  }
  if (!detected || detected.mime !== mediaType) {
    throw contractError('CANDIDATE_MEDIA_TYPE_MISMATCH', 'provider candidate bytes do not match their media type');
  }
  if (!hasValue(response.generation_context_version)) {
    throw contractError(
      'CANDIDATE_GENERATION_CONTEXT_MISSING',
      'provider candidate generation context is missing',
    );
  }
  const providerReference = verifiedProviderReference(
    response.provider_reference_type,
    response.provider_reference,
  );
  if (!providerReference) {
    throw contractError('PROVIDER_REFERENCE_INVALID', 'provider candidate reference is invalid');
  }

  return {
    requestId: response.request_id,
    sourceChecksum: response.source_checksum,
    bytes: Buffer.from(response.bytes),
    mediaType,
    checksumSha256: createHash('sha256').update(response.bytes).digest('hex'),
    generationContextVersion: response.generation_context_version,
    providerReferenceType: response.provider_reference_type,
    providerReference,
  };
}

function validateObservation(response, generated, trustedObservedAt) {
  if (!response || typeof response !== 'object') {
    throw contractError('PROVIDER_REFERENCE_OBSERVATION_INVALID', 'provider reference observation is invalid');
  }
  if (response.request_id !== generated.requestId) {
    throw contractError(
      'PROVIDER_REFERENCE_REQUEST_BINDING_MISMATCH',
      'provider reference observation is bound to another capture request',
    );
  }
  if (response.source_checksum !== generated.sourceChecksum) {
    throw contractError(
      'PROVIDER_REFERENCE_SOURCE_BINDING_MISMATCH',
      'provider reference observation is bound to another source asset',
    );
  }
  if (response.generation_context_version !== generated.generationContextVersion ||
      response.provider_reference_type !== generated.providerReferenceType ||
      !sameStructuredValue(response.provider_reference, generated.providerReference)) {
    throw contractError(
      'PROVIDER_REFERENCE_BINDING_MISMATCH',
      'provider reference observation does not match the generated candidate',
    );
  }
  if (response.status === 'unknown') {
    throw contractError('PROVIDER_REFERENCE_UNKNOWN', 'provider reference availability is unknown');
  }
  if (response.status === 'unavailable') {
    throw contractError('PROVIDER_REFERENCE_UNAVAILABLE', 'provider reference is unavailable');
  }
  const providerObservedAt = Date.parse(response.observed_at);
  const providerValidUntil = Date.parse(response.valid_until);
  const trustedAt = Date.parse(trustedObservedAt);
  if (response.status !== 'available' || !validTimestamp(response.observed_at) ||
      !validTimestamp(response.valid_until) || !Number.isFinite(trustedAt) ||
      providerObservedAt > trustedAt || providerValidUntil !== providerObservedAt) {
    throw contractError('PROVIDER_REFERENCE_OBSERVATION_INVALID', 'provider reference observation is invalid');
  }

  return {
    status: 'available',
    observedAt: trustedObservedAt,
    validUntil: trustedObservedAt,
    reasonCode: null,
    method: PROVIDER_REFERENCE_METHOD,
    seamVersion: PROVIDER_OBSERVATION_SEAM_VERSION,
    policyVersion: PROVIDER_OBSERVATION_POLICY_VERSION,
    referenceFingerprint: referenceFingerprint(generated.providerReference),
  };
}

function registeredCandidateIsValid(registered, organizationId, staged) {
  const asset = registered?.asset;
  const version = registered?.asset_version;
  return Boolean(
    asset && version &&
    asset.organization_id === organizationId &&
    version.organization_id === organizationId &&
    version.asset_id === asset.id &&
    version.id &&
    version.status === 'available' &&
    version.object_key === staged.object_key &&
    version.verified_content_type === staged.media_type &&
    version.verified_size === staged.size &&
    version.verified_checksum_sha256 === staged.checksum_sha256,
  );
}

function timestamp(now) {
  const value = now();
  return typeof value === 'string' ? value : new Date(value).toISOString();
}

function publicCaptureRequest(record) {
  const projection = {
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
    status_history: record.status_history.map((entry) => ({
      status: entry.status,
      row_version: entry.row_version,
      at: entry.at,
    })),
  };

  if (record.authorized_by_member_id != null) {
    projection.authorized_by_member_id = record.authorized_by_member_id;
  }
  if (record.authorized_at != null) {
    projection.authorized_at = record.authorized_at;
  }
  if (record.appearance_candidate_id != null) {
    projection.appearance_candidate_id = record.appearance_candidate_id;
  }
  if (record.failure_code != null) {
    projection.failure_code = record.failure_code;
  }
  return projection;
}

export function createAppearanceFidelityService({
  repository,
  upstreamPort,
  sourceAssetPort,
  providerAdapter,
  candidateAssetPort,
  now = Date.now,
}) {
  if (!repository?.findByIdempotencyKey || !repository?.findActiveCaptureRequest ||
      !repository?.createCaptureRequest || !repository?.getCaptureRequest ||
      !repository?.listCaptureRequests || !repository?.transitionCaptureRequest ||
      !repository?.claimNextCapture || !repository?.completeCapture || !repository?.failCapture ||
      !repository?.getCandidate || !repository?.listCandidates ||
      !upstreamPort?.resolveCurrent ||
      !sourceAssetPort?.readVerifiedProductImage ||
      !candidateAssetPort?.stageVerifiedCandidate ||
      !candidateAssetPort?.registerStagedCandidate ||
      !candidateAssetPort?.createDownloadAuthorization ||
      !candidateAssetPort?.downloadObject ||
      !candidateAssetPort?.discardStagedCandidate ||
      !providerAdapter || !now) {
    throw new TypeError('appearance fidelity service dependencies are required');
  }

  async function failClaimedCapture(request, systemActorId, failureCode) {
    const failed = await repository.failCapture({
      organizationId: request.organization_id,
      requestId: request.id,
      expectedRevision: request.row_version,
      failureCode,
      actorSystemId: systemActorId,
      now: timestamp(now),
    });
    return {
      capture_request: publicCaptureRequest(failed),
      candidate: null,
      candidate_state: null,
      provider_reference_observation: null,
    };
  }

  return {
    async createCaptureRequest(input) {
      const payload = idempotencyPayload(input);
      const existingForKey = await repository.findByIdempotencyKey({
        organizationId: input.organizationId,
        actorMemberId: input.actorMemberId,
        idempotencyKey: input.idempotencyKey,
      });

      if (existingForKey) {
        if (existingForKey.idempotency_payload !== payload) {
          throw contractError('IDEMPOTENCY_CONFLICT', 'idempotency key payload changed');
        }
        return {
          capture_request: publicCaptureRequest(existingForKey),
          replayed: true,
        };
      }

      let snapshot;
      try {
        snapshot = await upstreamPort.resolveCurrent({ ...input });
      } catch {
        throw contractError(
          'APPEARANCE_CAPTURE_GATE_BLOCKED',
          'upstream snapshot is unavailable',
          ['upstream_unavailable'],
        );
      }
      const upstreamReasons = upstreamGateReasons(snapshot, input);
      if (upstreamReasons.length > 0) {
        throw contractError(
          'APPEARANCE_CAPTURE_GATE_BLOCKED',
          'upstream snapshot does not match the requested bindings',
          upstreamReasons,
        );
      }

      let sourceAsset;
      try {
        sourceAsset = await sourceAssetPort.readVerifiedProductImage({
          organizationId: input.organizationId,
          actorMemberId: input.actorMemberId,
          productId: input.productId,
          productRevisionId: input.productRevisionId,
          sourceAssetVersionId: input.sourceAssetVersionId,
        });
      } catch {
        throw contractError(
          'APPEARANCE_CAPTURE_GATE_BLOCKED',
          'source asset is unavailable or failed its integrity contract',
          ['source_asset_unavailable'],
        );
      }
      const sourceIntegrity = verifiedSourceAsset(sourceAsset, input);
      if (!sourceIntegrity) {
        throw contractError(
          'APPEARANCE_CAPTURE_GATE_BLOCKED',
          'source asset is unavailable or failed its integrity contract',
          ['source_asset_unavailable'],
        );
      }

      const fingerprint = upstreamFingerprint(input, snapshot);
      const activeCapture = await repository.findActiveCaptureRequest({
        organizationId: input.organizationId,
        upstreamFingerprint: fingerprint,
        activeStatuses: ACTIVE_CAPTURE_STATUSES,
      });
      if (activeCapture) {
        throw contractError(
          'APPEARANCE_CAPTURE_CONFLICT',
          'an active capture request already exists for the upstream binding',
        );
      }

      const at = timestamp(now);
      const record = await repository.createCaptureRequest({
        organization_id: input.organizationId,
        requested_by_member_id: input.actorMemberId,
        idempotency_key: input.idempotencyKey,
        idempotency_payload: payload,
        upstream_fingerprint: fingerprint,
        upstream_snapshot: structuredClone(snapshot),
        workspace_revision: snapshot.workspace_revision,
        status: 'awaiting_authorization',
        row_version: 1,
        max_candidate_generations: 1,
        product_id: input.productId,
        product_revision_id: input.productRevisionId,
        source_asset_version_id: input.sourceAssetVersionId,
        source_asset_kind: sourceAsset.kind,
        source_asset_status: sourceAsset.asset_status,
        source_asset_version_status: sourceAsset.version_status,
        source_asset_media_type: sourceIntegrity.mediaType,
        source_asset_size: sourceIntegrity.size,
        source_asset_checksum_sha256: sourceIntegrity.checksumSha256,
        copy_version_id: snapshot.copy_version_id,
        copy_review_id: snapshot.copy_review_id,
        avatar_selection_id: snapshot.avatar_selection_id,
        avatar_asset_version_id: snapshot.avatar_asset_version_id,
        video_plan_version_id: snapshot.video_plan_version_id,
        plan_review_id: snapshot.plan_review_id,
        preflight_result_id: snapshot.preflight_result_id,
        presentation_size_code: snapshot.presentation_size_code,
        created_at: at,
        updated_at: at,
        status_history: [
          {
            status: 'awaiting_authorization',
            row_version: 1,
            at,
          },
        ],
      });

      return {
        capture_request: publicCaptureRequest(record),
        replayed: record.replayed === true,
      };
    },

    async getCaptureRequest(input) {
      const record = await repository.getCaptureRequest({
        organizationId: input.organizationId,
        requestId: input.requestId,
      });
      if (!record) {
        throw contractError(
          'APPEARANCE_CAPTURE_REQUEST_NOT_FOUND',
          'capture request is not available',
        );
      }
      return { capture_request: publicCaptureRequest(record) };
    },

    async listCaptureRequests(input) {
      const records = await repository.listCaptureRequests({
        organizationId: input.organizationId,
        productId: input.productId,
        status: input.status,
      });
      const { page, nextCursor } = pageOf(records, input, 'capture-requests');
      return { capture_requests: page.map(publicCaptureRequest), next_cursor: nextCursor };
    },

    async authorizeCaptureRequest(input) {
      if (input.actorRole !== 'admin') {
        throw contractError(
          'APPEARANCE_FIDELITY_FORBIDDEN',
          'only an admin may authorize a capture request',
        );
      }
      const fingerprint = commandIdempotencyPayload('authorize', input);
      const at = timestamp(now);
      const transition = await repository.transitionCaptureRequest({
        operation: 'authorize',
        organizationId: input.organizationId,
        actorMemberId: input.actorMemberId,
        requestId: input.requestId,
        expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
        fingerprint,
        maxCandidateGenerations: input.maxCandidateGenerations,
        fromStatuses: ['awaiting_authorization'],
        status: 'queued',
        patch: {
          authorized_by_member_id: input.actorMemberId,
          authorized_at: at,
          updated_at: at,
        },
      });

      return {
        capture_request: publicCaptureRequest(transition.record),
        replayed: transition.replayed === true,
      };
    },

    async cancelCaptureRequest(input) {
      const record = await repository.getCaptureRequest({
        organizationId: input.organizationId,
        requestId: input.requestId,
      });
      if (!record) {
        throw contractError(
          'APPEARANCE_CAPTURE_REQUEST_NOT_FOUND',
          'capture request is not available',
        );
      }

      const isAdmin = input.actorRole === 'admin';
      const isCreator = input.actorRole === 'member' &&
        record.requested_by_member_id === input.actorMemberId;
      if (!isAdmin && !isCreator) {
        throw contractError(
          'APPEARANCE_FIDELITY_FORBIDDEN',
          'only the request creator or an admin may cancel a capture request',
        );
      }

      const fingerprint = commandIdempotencyPayload('cancel', input);
      const at = timestamp(now);
      const transition = await repository.transitionCaptureRequest({
        operation: 'cancel',
        organizationId: input.organizationId,
        actorMemberId: input.actorMemberId,
        requestId: input.requestId,
        expectedRevision: input.expectedRevision,
        idempotencyKey: input.idempotencyKey,
        fingerprint,
        fromStatuses: ['awaiting_authorization', 'queued'],
        status: 'cancelled',
        patch: {
          updated_at: at,
        },
      });

      return {
        capture_request: publicCaptureRequest(transition.record),
        replayed: transition.replayed === true,
      };
    },

    async runNextCapture({ systemActorId } = {}) {
      const claimed = await repository.claimNextCapture({
        systemActorId,
        now: timestamp(now),
      });
      if (!claimed) return null;

      let staged = null;
      let completed = false;
      try {
        if (claimed.max_candidate_generations !== 1) {
          throw contractError(
            'APPEARANCE_CAPTURE_CONFLICT',
            'capture authorization permits exactly one candidate generation',
          );
        }
        const requestInput = captureInputFromRecord(claimed, systemActorId);
        let currentSnapshot;
        try {
          currentSnapshot = await upstreamPort.resolveCurrent(requestInput);
        } catch {
          throw contractError(
            'UPSTREAM_CHANGED_AFTER_AUTHORIZATION',
            'current upstream could not be revalidated',
          );
        }
        if (!sameStructuredValue(currentSnapshot, claimed.upstream_snapshot) ||
            upstreamGateReasons(currentSnapshot, requestInput).length > 0) {
          throw contractError(
            'UPSTREAM_CHANGED_AFTER_AUTHORIZATION',
            'current upstream no longer matches the authorized capture',
          );
        }

        let sourceAsset;
        try {
          sourceAsset = await sourceAssetPort.readVerifiedProductImage(requestInput);
        } catch {
          throw contractError(
            'SOURCE_CHANGED_AFTER_AUTHORIZATION',
            'current source asset could not be revalidated',
          );
        }
        const sourceIntegrity = verifiedSourceAsset(sourceAsset, requestInput);
        if (!sourceIntegrity ||
            sourceAsset.kind !== claimed.source_asset_kind ||
            sourceAsset.asset_status !== claimed.source_asset_status ||
            sourceAsset.version_status !== claimed.source_asset_version_status ||
            sourceIntegrity.mediaType !== claimed.source_asset_media_type ||
            sourceIntegrity.size !== claimed.source_asset_size ||
            sourceIntegrity.checksumSha256 !== claimed.source_asset_checksum_sha256) {
          throw contractError(
            'SOURCE_CHANGED_AFTER_AUTHORIZATION',
            'current source asset no longer matches the authorized capture',
          );
        }

        const sourceBytes = Buffer.from(sourceAsset.bytes);
        let generatedResponse;
        try {
          if (typeof providerAdapter.generateCandidate !== 'function') {
            throw contractError('PROVIDER_ADAPTER_UNAVAILABLE', 'provider adapter cannot generate a candidate');
          }
          generatedResponse = await providerAdapter.generateCandidate({
            request_id: claimed.id,
            source_bytes: sourceBytes,
            source_checksum: sourceIntegrity.checksumSha256,
            upstream_bindings: upstreamBindingsFromRecord(claimed),
            max_candidate_generations: claimed.max_candidate_generations,
          });
        } catch (error) {
          throw contractError(
            controlledFailureCode(error, 'PROVIDER_ADAPTER_FAILED'),
            'provider candidate generation failed',
          );
        }
        const generated = await validateGeneratedCandidate(generatedResponse, claimed);

        let observationResponse;
        try {
          if (typeof providerAdapter.observeReference !== 'function') {
            throw contractError('PROVIDER_ADAPTER_UNAVAILABLE', 'provider adapter cannot observe a candidate reference');
          }
          observationResponse = await providerAdapter.observeReference({
            request_id: generated.requestId,
            source_checksum: generated.sourceChecksum,
            generation_context_version: generated.generationContextVersion,
            provider_reference_type: generated.providerReferenceType,
            provider_reference: structuredClone(generated.providerReference),
          });
        } catch (error) {
          throw contractError(
            controlledFailureCode(error, 'PROVIDER_ADAPTER_FAILED'),
            'provider candidate observation failed',
          );
        }
        const observation = validateObservation(observationResponse, generated, timestamp(now));

        const candidateId = randomUUID();
        try {
          staged = await candidateAssetPort.stageVerifiedCandidate({
            organizationId: claimed.organization_id,
            actorSystemId: systemActorId,
            candidateId,
            captureRequestId: claimed.id,
            body: Buffer.from(generated.bytes),
            mediaType: generated.mediaType,
          });
        } catch (error) {
          throw contractError(
            controlledFailureCode(error, 'CANDIDATE_ASSET_STAGE_FAILED'),
            'candidate asset staging failed',
          );
        }
        if (!staged ||
            staged.candidate_id !== candidateId ||
            staged.capture_request_id !== claimed.id ||
            staged.media_type !== generated.mediaType ||
            staged.size !== generated.bytes.length ||
            staged.checksum_sha256 !== generated.checksumSha256) {
          throw contractError('CANDIDATE_ASSET_STAGE_INVALID', 'candidate asset staging returned invalid metadata');
        }

        const captureAt = timestamp(now);
        const candidate = {
          id: candidateId,
          organization_id: claimed.organization_id,
          capture_request_id: claimed.id,
          product_id: claimed.product_id,
          product_revision_id: claimed.product_revision_id,
          source_asset_version_id: claimed.source_asset_version_id,
          source_asset_media_type: claimed.source_asset_media_type,
          source_asset_size: claimed.source_asset_size,
          source_asset_checksum_sha256: claimed.source_asset_checksum_sha256,
          copy_version_id: claimed.copy_version_id,
          copy_review_id: claimed.copy_review_id,
          avatar_selection_id: claimed.avatar_selection_id,
          avatar_asset_version_id: claimed.avatar_asset_version_id,
          video_plan_version_id: claimed.video_plan_version_id,
          plan_review_id: claimed.plan_review_id,
          preflight_result_id: claimed.preflight_result_id,
          presentation_size_code: claimed.presentation_size_code,
          media_type: generated.mediaType,
          size: generated.bytes.length,
          checksum_sha256: generated.checksumSha256,
          provider: 'hifly',
          provider_reference_type: generated.providerReferenceType,
          provider_reference: structuredClone(generated.providerReference),
          generation_context_version: generated.generationContextVersion,
          created_at: captureAt,
        };
        const candidateState = {
          candidate_id: candidate.id,
          organization_id: claimed.organization_id,
          state: 'available',
          row_version: 1,
          reason_code: null,
          observed_at: observation.observedAt,
          updated_at: observation.observedAt,
          superseded_by_candidate_id: null,
        };
        const providerReferenceObservation = {
          id: randomUUID(),
          organization_id: claimed.organization_id,
          candidate_id: candidate.id,
          reference_fingerprint: observation.referenceFingerprint,
          status: observation.status,
          method: observation.method,
          seam_version: observation.seamVersion,
          policy_version: observation.policyVersion,
          observed_at: observation.observedAt,
          valid_until: observation.validUntil,
          reason_code: observation.reasonCode,
          created_at: captureAt,
        };

        let completion;
        try {
          completion = await repository.completeCapture({
            organizationId: claimed.organization_id,
            requestId: claimed.id,
            expectedRevision: claimed.row_version,
            candidate,
            candidateState,
            providerReferenceObservation,
            registerCandidateAsset: async (transactionClient) => {
              let registered;
              try {
                registered = await candidateAssetPort.registerStagedCandidate({
                  organizationId: claimed.organization_id,
                  actorSystemId: systemActorId,
                  staged: structuredClone(staged),
                  transactionClient,
                });
              } catch (error) {
                throw contractError(
                  controlledFailureCode(error, 'CANDIDATE_ASSET_REGISTER_FAILED'),
                  'candidate asset registration failed',
                );
              }
              if (!registeredCandidateIsValid(registered, claimed.organization_id, staged)) {
                throw contractError(
                  'CANDIDATE_ASSET_REGISTER_INVALID',
                  'candidate asset registration returned invalid metadata',
                );
              }
              return registered;
            },
            now: captureAt,
            actorSystemId: systemActorId,
          });
        } catch (error) {
          throw contractError(
            controlledFailureCode(error, 'APPEARANCE_CAPTURE_COMPLETION_FAILED'),
            'appearance capture completion failed',
          );
        }
        completed = true;

        return {
          capture_request: publicCaptureRequest(completion.record),
          candidate: publicCandidate(completion.candidate),
          candidate_state: publicCandidateState(completion.candidateState),
          provider_reference_observation: publicProviderReferenceObservation(
            completion.providerReferenceObservation,
            captureAt,
          ),
        };
      } catch (error) {
        if (!completed && staged) {
          try {
            await candidateAssetPort.discardStagedCandidate({
              organizationId: claimed.organization_id,
              actorSystemId: systemActorId,
              staged: structuredClone(staged),
            });
          } catch {
            // The capture remains terminal even if best-effort object compensation fails.
          }
        }
        const failureCode = controlledFailureCode(error, 'APPEARANCE_CAPTURE_FAILED');
        return failClaimedCapture(claimed, systemActorId, failureCode);
      }
    },

    async getCandidate(input) {
      const bundle = await repository.getCandidate({
        organizationId: input.organizationId,
        candidateId: input.candidateId,
      });
      if (!bundle) {
        throw contractError('APPEARANCE_CANDIDATE_NOT_FOUND', 'candidate is not available');
      }
      return {
        candidate: publicCandidate(bundle.candidate),
        candidate_state: publicCandidateState(bundle.candidateState),
        provider_reference_status: publicProviderReferenceObservation(
          bundle.providerReferenceObservation,
          timestamp(now),
        ),
      };
    },

    async listCandidates(input = {}) {
      if (input.candidateId != null) {
        const bundle = await repository.getCandidate({
          organizationId: input.organizationId,
          candidateId: input.candidateId,
        });
        if (!bundle || (input.productId != null && bundle.candidate.product_id !== input.productId)) {
          throw contractError('APPEARANCE_CANDIDATE_NOT_FOUND', 'candidate is not available');
        }
        return { candidates: [publicCandidate(bundle.candidate)], next_cursor: null };
      }
      const records = await repository.listCandidates({
        organizationId: input.organizationId,
        productId: input.productId,
        state: input.state,
      });
      const { page, nextCursor } = pageOf(records, input, 'candidates');
      return { candidates: page.map(publicCandidate), next_cursor: nextCursor };
    },

    async createCandidateDownloadAuthorization(input) {
      const bundle = await repository.getCandidate({
        organizationId: input.organizationId,
        candidateId: input.candidateId,
      });
      if (!bundle) {
        throw contractError('APPEARANCE_CANDIDATE_NOT_FOUND', 'candidate is not available');
      }
      return candidateAssetPort.createDownloadAuthorization({
        organizationId: input.organizationId,
        assetVersionId: bundle.candidate.candidate_asset_version_id,
      });
    },

    async downloadCandidateObject(input) {
      const bundle = await repository.getCandidate({
        organizationId: input.organizationId,
        candidateId: input.candidateId,
      });
      if (!bundle) {
        throw contractError('APPEARANCE_CANDIDATE_NOT_FOUND', 'candidate is not available');
      }
      return candidateAssetPort.downloadObject({
        organizationId: input.organizationId,
        assetVersionId: bundle.candidate.candidate_asset_version_id,
        token: input.token,
      });
    },
  };
}
