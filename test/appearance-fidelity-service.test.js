import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createAppearanceFidelityService } from '../src/appearance-fidelity/appearance-fidelity-service.js';
import { createDisabledProviderAdapter } from '../src/appearance-fidelity/disabled-provider-adapter.js';
import { createAppearanceCaptureWorker } from '../src/appearance-fidelity/capture-worker.js';
import { createMemoryAppearanceFidelityRepository } from '../src/appearance-fidelity/memory-appearance-fidelity-repository.js';

const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const PNG_SHA256 = '431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460';
const GIF_BYTES = Buffer.from('R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=', 'base64');
const CANDIDATE_GENERATION_CONTEXT_VERSION = 'appearance-fidelity-context-v1';
const PROVIDER_REFERENCE_TYPE = 'hifly-generation-reference';
const PRIVATE_PROVIDER_REFERENCE = Object.freeze({
  generation_id: 'private-generation-1',
});
const OBSERVATION_AT = '2026-08-20T08:00:00.000Z';

const IDS = Object.freeze({
  organizationId: 'org-fidelity-1',
  actorMemberId: 'member-fidelity-1',
  adminMemberId: 'member-fidelity-admin-1',
  otherMemberId: 'member-fidelity-other-1',
  productId: 'product-1',
  productRevisionId: 'product-revision-7',
  sourceAssetId: 'source-product-image-3',
  sourceAssetVersionId: 'source-product-image-version-3',
  copyVersionId: 'copy-version-4',
  copyReviewId: 'copy-review-4',
  avatarSelectionId: 'avatar-selection-2',
  avatarAssetVersionId: 'avatar-asset-version-5',
  videoPlanVersionId: 'video-plan-version-6',
  planReviewId: 'plan-review-6',
  preflightResultId: 'preflight-result-6',
});

const EXPECTED_INPUT_FIELDS = [
  'organizationId',
  'actorMemberId',
  'productId',
  'productRevisionId',
  'sourceAssetVersionId',
  'copyVersionId',
  'avatarSelectionId',
  'videoPlanVersionId',
  'expectedWorkspaceRevision',
  'idempotencyKey',
];

const EXPECTED_UPSTREAM_FIELDS = [
  'current_valid',
  'workspace_revision',
  'product_id',
  'product_revision_id',
  'source_asset_version_ids',
  'copy_version_id',
  'copy_review_id',
  'avatar_selection_id',
  'avatar_asset_version_id',
  'video_plan_version_id',
  'plan_review_id',
  'preflight_result_id',
  'presentation_size_code',
];

const EXPECTED_PUBLIC_REQUEST_FIELDS = [
  'id',
  'status',
  'row_version',
  'max_candidate_generations',
  'product_id',
  'product_revision_id',
  'source_asset_version_id',
  'copy_version_id',
  'copy_review_id',
  'avatar_selection_id',
  'avatar_asset_version_id',
  'video_plan_version_id',
  'plan_review_id',
  'preflight_result_id',
  'presentation_size_code',
  'requested_by_member_id',
  'created_at',
  'updated_at',
  'status_history',
];

function createInput(overrides = {}) {
  return {
    organizationId: IDS.organizationId,
    actorMemberId: IDS.actorMemberId,
    productId: IDS.productId,
    productRevisionId: IDS.productRevisionId,
    sourceAssetVersionId: IDS.sourceAssetVersionId,
    copyVersionId: IDS.copyVersionId,
    avatarSelectionId: IDS.avatarSelectionId,
    videoPlanVersionId: IDS.videoPlanVersionId,
    expectedWorkspaceRevision: 12,
    idempotencyKey: 'appearance-capture-key-1',
    ...overrides,
  };
}

function createCurrentValidSnapshot(overrides = {}) {
  const snapshot = {
    current_valid: true,
    workspace_revision: 12,
    product_id: IDS.productId,
    product_revision_id: IDS.productRevisionId,
    source_asset_version_ids: ['source-product-image-version-other', IDS.sourceAssetVersionId],
    copy_version_id: IDS.copyVersionId,
    copy_review_id: IDS.copyReviewId,
    avatar_selection_id: IDS.avatarSelectionId,
    avatar_asset_version_id: IDS.avatarAssetVersionId,
    video_plan_version_id: IDS.videoPlanVersionId,
    plan_review_id: IDS.planReviewId,
    preflight_result_id: IDS.preflightResultId,
    presentation_size_code: 'small',
    ...overrides,
  };
  assert.deepEqual(Object.keys(snapshot).sort(), [...EXPECTED_UPSTREAM_FIELDS].sort());
  return snapshot;
}

function createVerifiedProductImage(overrides = {}) {
  const source = {
    asset_id: IDS.sourceAssetId,
    asset_version_id: IDS.sourceAssetVersionId,
    kind: 'product_image',
    asset_status: 'active',
    version_status: 'available',
    bytes: PNG_BYTES,
    media_type: 'image/png',
    size: PNG_BYTES.length,
    checksum_sha256: PNG_SHA256,
    ...overrides,
  };
  assert.deepEqual(Object.keys(source).sort(), [
    'asset_id',
    'asset_version_id',
    'kind',
    'asset_status',
    'version_status',
    'bytes',
    'media_type',
    'size',
    'checksum_sha256',
  ].sort());
  return source;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function controlledError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function createDeterministicCandidateAssetPort({ registerError = null, invalidRegisteredMetadata = false } = {}) {
  const stagedObjects = new Map();
  const registeredAssets = new Map();
  const registeredVersions = new Map();
  const calls = {
    stageVerifiedCandidate: [],
    registerStagedCandidate: [],
    discardStagedCandidate: [],
    createDownloadAuthorization: [],
    downloadObject: [],
  };
  const downloads = new Map();
  let nextAssetNumber = 1;

  return {
    calls,
    stagedObjects,
    registeredAssets,
    registeredVersions,
    async stageVerifiedCandidate(input) {
      calls.stageVerifiedCandidate.push({
        ...input,
        body: Buffer.isBuffer(input.body) ? Buffer.from(input.body) : input.body,
      });
      const staged = {
        candidate_id: input.candidateId,
        capture_request_id: input.captureRequestId,
        original_filename: 'candidate.png',
        object_key: `${input.organizationId}/appearance-candidates/${input.candidateId}/candidate.png`,
        media_type: input.mediaType,
        size: input.body.length,
        checksum_sha256: sha256(input.body),
      };
      stagedObjects.set(staged.object_key, Buffer.from(input.body));
      return structuredClone(staged);
    },
    async registerStagedCandidate(input) {
      calls.registerStagedCandidate.push({
        organizationId: input.organizationId,
        actorSystemId: input.actorSystemId,
        staged: structuredClone(input.staged),
        transactionClient: input.transactionClient,
      });
      if (registerError) throw controlledError(registerError);
      const assetNumber = nextAssetNumber;
      nextAssetNumber += 1;
      const asset = {
        id: `candidate-asset-${assetNumber}`,
        organization_id: input.organizationId,
        kind: 'appearance_candidate_image',
        status: 'active',
        revision_number: 1,
      };
      const assetVersion = {
        id: `candidate-asset-version-${assetNumber}`,
        asset_id: asset.id,
        organization_id: input.organizationId,
        status: 'available',
        object_key: input.staged.object_key,
        original_filename: input.staged.original_filename,
        expected_content_type: input.staged.media_type,
        expected_size: input.staged.size,
        expected_checksum_sha256: input.staged.checksum_sha256,
        verified_content_type: input.staged.media_type,
        verified_size: input.staged.size,
        verified_checksum_sha256: input.staged.checksum_sha256,
      };
      registeredAssets.set(asset.id, structuredClone(asset));
      registeredVersions.set(assetVersion.id, structuredClone(assetVersion));
      input.transactionClient?.onRollback?.(() => registeredAssets.delete(asset.id));
      input.transactionClient?.onRollback?.(() => registeredVersions.delete(assetVersion.id));
      return {
        asset,
        asset_version: invalidRegisteredMetadata
          ? { ...assetVersion, verified_checksum_sha256: 'invalid-candidate-checksum' }
          : assetVersion,
      };
    },
    async discardStagedCandidate(input) {
      calls.discardStagedCandidate.push(structuredClone(input));
      stagedObjects.delete(input.staged.object_key);
      return { status: 'discarded', object_key: input.staged.object_key };
    },
    async createDownloadAuthorization(input) {
      calls.createDownloadAuthorization.push(structuredClone(input));
      const version = registeredVersions.get(input.assetVersionId);
      if (!version || version.organization_id !== input.organizationId) throw controlledError('ASSET_VERSION_NOT_FOUND');
      const token = `candidate-download-${downloads.size + 1}`;
      downloads.set(token, { organizationId: input.organizationId, assetVersionId: version.id, objectKey: version.object_key });
      return {
        token,
        expires_at: '2026-08-20T08:05:00.000Z',
        asset_version_id: version.id,
        filename: version.original_filename,
        media_type: version.verified_content_type,
        size: version.verified_size,
        checksum_sha256: version.verified_checksum_sha256,
      };
    },
    async downloadObject(input) {
      calls.downloadObject.push(structuredClone(input));
      const grant = downloads.get(input.token);
      if (!grant || grant.organizationId !== input.organizationId || grant.assetVersionId !== input.assetVersionId) {
        throw controlledError('DOWNLOAD_AUTHORIZATION_NOT_FOUND');
      }
      const body = stagedObjects.get(grant.objectKey);
      return {
        body: Buffer.from(body),
        asset_version_id: grant.assetVersionId,
        filename: 'candidate.png',
        media_type: 'image/png',
        size: body.length,
        checksum_sha256: sha256(body),
      };
    },
  };
}

function createDeterministicProviderAdapter({
  generateError = null,
  responseOverrides = {},
  observeStatus = 'available',
  observeOverrides = {},
} = {}) {
  const calls = {
    generateCandidate: [],
    observeReference: [],
    order: [],
  };
  let generatedResponse = null;

  return {
    calls,
    async generateCandidate(input) {
      calls.order.push('generateCandidate');
      calls.generateCandidate.push(input);
      if (generateError) throw controlledError(generateError);
      generatedResponse = {
        request_id: input.request_id,
        source_checksum: input.source_checksum,
        bytes: Buffer.from(PNG_BYTES),
        media_type: 'image/png',
        generation_context_version: CANDIDATE_GENERATION_CONTEXT_VERSION,
        provider_reference_type: PROVIDER_REFERENCE_TYPE,
        provider_reference: structuredClone(PRIVATE_PROVIDER_REFERENCE),
        ...responseOverrides,
      };
      return generatedResponse;
    },
    async observeReference(input) {
      calls.order.push('observeReference');
      calls.observeReference.push(input);
      const generated = generatedResponse || {};
      return {
        request_id: generated.request_id,
        source_checksum: generated.source_checksum,
        generation_context_version: generated.generation_context_version,
        provider_reference_type: generated.provider_reference_type,
        provider_reference: structuredClone(generated.provider_reference),
        status: observeStatus,
        observed_at: OBSERVATION_AT,
        valid_until: OBSERVATION_AT,
        ...observeOverrides,
      };
    },
  };
}

function expectedUpstreamBindings() {
  return {
    organization_id: IDS.organizationId,
    product_id: IDS.productId,
    product_revision_id: IDS.productRevisionId,
    source_asset_version_id: IDS.sourceAssetVersionId,
    ...createCurrentValidSnapshot(),
  };
}

function createWorld({
  currentOverrides = {},
  sourceOverrides = {},
  providerAdapter: configuredProviderAdapter = null,
  candidateAssetPort: configuredCandidateAssetPort = null,
  initialNow = OBSERVATION_AT,
} = {}) {
  const repository = createMemoryAppearanceFidelityRepository();
  let currentSnapshot = createCurrentValidSnapshot(currentOverrides);
  let sourceAsset = createVerifiedProductImage(sourceOverrides);
  let currentNow = initialNow;
  const upstreamCalls = [];
  const sourceAssetCalls = [];
  const providerCalls = [];
  const upstreamPort = {
    async resolveCurrent(input) {
      upstreamCalls.push(structuredClone(input));
      return currentSnapshot;
    },
  };
  const sourceAssetPort = {
    async readVerifiedProductImage(input) {
      sourceAssetCalls.push(structuredClone(input));
      return sourceAsset;
    },
  };
  const providerAdapter = new Proxy({}, {
    get(_target, property) {
      return (...args) => {
        providerCalls.push({ method: String(property), args });
      };
    },
  });
  const candidateAssetPort = configuredCandidateAssetPort || createDeterministicCandidateAssetPort();
  const activeProviderAdapter = configuredProviderAdapter || providerAdapter;
  const service = createAppearanceFidelityService({
    repository,
    upstreamPort,
    sourceAssetPort,
    providerAdapter: activeProviderAdapter,
    candidateAssetPort,
    now: () => currentNow,
  });

  return {
    repository,
    service,
    upstreamCalls,
    sourceAssetCalls,
    providerCalls,
    providerAdapter: activeProviderAdapter,
    candidateAssetPort,
    setCurrent(overrides) {
      currentSnapshot = { ...currentSnapshot, ...overrides };
    },
    setSource(overrides) {
      sourceAsset = { ...sourceAsset, ...overrides };
    },
    setNow(value) {
      currentNow = value;
    },
  };
}

async function assertGateBlocked(service, input, reasons) {
  await assert.rejects(service.createCaptureRequest(input), (error) => {
    assert.equal(error.code, 'APPEARANCE_CAPTURE_GATE_BLOCKED');
    assert.deepEqual(error.details, reasons);
    return true;
  });
}

function authorizeInput(request, overrides = {}) {
  return {
    organizationId: IDS.organizationId,
    actorMemberId: IDS.adminMemberId,
    actorRole: 'admin',
    requestId: request.id,
    expectedRevision: request.row_version,
    maxCandidateGenerations: 1,
    idempotencyKey: 'appearance-capture-authorize-1',
    ...overrides,
  };
}

function cancelInput(request, overrides = {}) {
  return {
    organizationId: IDS.organizationId,
    actorMemberId: IDS.actorMemberId,
    actorRole: 'member',
    requestId: request.id,
    expectedRevision: request.row_version,
    idempotencyKey: 'appearance-capture-cancel-1',
    ...overrides,
  };
}

function statusHistoryProjection(request) {
  return request.status_history.map(({ status, row_version, at }) => ({ status, row_version, at }));
}

async function seedCaptureRequest(world, status) {
  const at = '2026-08-20T08:00:00.000Z';
  const rowVersion = {
    running: 3,
    succeeded: 4,
    failed: 4,
    cancelled: 3,
  }[status];
  const statusHistory = [
    { status: 'awaiting_authorization', row_version: 1, at },
    { status: 'queued', row_version: 2, at },
  ];
  if (status === 'running' || status === 'succeeded' || status === 'failed') {
    statusHistory.push({ status: 'running', row_version: 3, at });
  }
  if (status === 'succeeded' || status === 'failed') {
    statusHistory.push({ status, row_version: 4, at });
  }
  if (status === 'cancelled') statusHistory.push({ status, row_version: 3, at });

  await world.repository.createCaptureRequest({
    organization_id: IDS.organizationId,
    requested_by_member_id: IDS.actorMemberId,
    idempotency_key: `seed-${status}`,
    idempotency_payload: JSON.stringify({ status }),
    upstream_fingerprint: `seed-${status}`,
    upstream_snapshot: createCurrentValidSnapshot(),
    workspace_revision: 12,
    status,
    row_version: rowVersion,
    max_candidate_generations: 1,
    product_id: IDS.productId,
    product_revision_id: IDS.productRevisionId,
    source_asset_version_id: IDS.sourceAssetVersionId,
    source_asset_kind: 'product_image',
    source_asset_status: 'active',
    source_asset_version_status: 'available',
    source_asset_media_type: 'image/png',
    source_asset_size: PNG_BYTES.length,
    source_asset_checksum_sha256: PNG_SHA256,
    copy_version_id: IDS.copyVersionId,
    copy_review_id: IDS.copyReviewId,
    avatar_selection_id: IDS.avatarSelectionId,
    avatar_asset_version_id: IDS.avatarAssetVersionId,
    video_plan_version_id: IDS.videoPlanVersionId,
    plan_review_id: IDS.planReviewId,
    preflight_result_id: IDS.preflightResultId,
    presentation_size_code: 'small',
    authorized_by_member_id: status === 'cancelled' ? null : IDS.adminMemberId,
    authorized_at: status === 'cancelled' ? null : at,
    created_at: at,
    updated_at: at,
    status_history: statusHistory,
  });

  const [record] = await world.repository.listCaptureRequests();
  return record;
}

test('creates an unpaid capture request with the exact upstream binding and replay/conflict guarantees', async () => {
  assert.deepEqual(Object.keys(createInput()).sort(), [...EXPECTED_INPUT_FIELDS].sort());

  const world = createWorld();
  const input = createInput();
  const created = await world.service.createCaptureRequest(input);

  assert.equal(created.replayed, false);
  assert.deepEqual(Object.keys(created.capture_request).sort(), [...EXPECTED_PUBLIC_REQUEST_FIELDS].sort());
  assert.deepEqual(created.capture_request, {
    id: created.capture_request.id,
    status: 'awaiting_authorization',
    row_version: 1,
    max_candidate_generations: 1,
    product_id: IDS.productId,
    product_revision_id: IDS.productRevisionId,
    source_asset_version_id: IDS.sourceAssetVersionId,
    copy_version_id: IDS.copyVersionId,
    copy_review_id: IDS.copyReviewId,
    avatar_selection_id: IDS.avatarSelectionId,
    avatar_asset_version_id: IDS.avatarAssetVersionId,
    video_plan_version_id: IDS.videoPlanVersionId,
    plan_review_id: IDS.planReviewId,
    preflight_result_id: IDS.preflightResultId,
    presentation_size_code: 'small',
    requested_by_member_id: IDS.actorMemberId,
    created_at: '2026-08-20T08:00:00.000Z',
    updated_at: '2026-08-20T08:00:00.000Z',
    status_history: [
      {
        status: 'awaiting_authorization',
        row_version: 1,
        at: '2026-08-20T08:00:00.000Z',
      },
    ],
  });
  assert.equal(Object.hasOwn(created.capture_request, 'organization_id'), false);
  assert.equal(Object.keys(created.capture_request).some((key) => key.includes('provider')), false);
  assert.equal(Object.keys(created.capture_request).some((key) => key.includes('private')), false);

  const replayed = await world.service.createCaptureRequest(input);
  assert.equal(replayed.capture_request.id, created.capture_request.id);
  assert.equal(replayed.replayed, true);

  await assert.rejects(
    world.service.createCaptureRequest(createInput({ copyVersionId: 'copy-version-changed' })),
    { code: 'IDEMPOTENCY_CONFLICT' },
  );

  await assert.rejects(
    world.service.createCaptureRequest(createInput({ idempotencyKey: 'appearance-capture-key-2' })),
    { code: 'APPEARANCE_CAPTURE_CONFLICT' },
  );

  assert.equal((await world.repository.listCaptureRequests()).length, 1);
  assert.deepEqual(world.providerCalls, []);
});

test('blocks stale workspace and source-version membership with reasons before any provider call', async () => {
  const staleWorkspace = createWorld({ currentOverrides: { workspace_revision: 13 } });
  await assertGateBlocked(
    staleWorkspace.service,
    createInput({ idempotencyKey: 'appearance-capture-stale-workspace' }),
    ['workspace_revision_stale'],
  );
  assert.deepEqual(staleWorkspace.providerCalls, []);

  const staleSourceMembership = createWorld({
    currentOverrides: { source_asset_version_ids: ['source-product-image-version-current'] },
  });
  await assertGateBlocked(
    staleSourceMembership.service,
    createInput({ idempotencyKey: 'appearance-capture-stale-source' }),
    ['source_asset_not_current'],
  );
  assert.deepEqual(staleSourceMembership.providerCalls, []);
});

test('allows JPEG source media and blocks GIF media or wrong size before any provider call', async () => {
  const jpeg = createWorld({ sourceOverrides: { media_type: 'image/jpeg' } });
  const created = await jpeg.service.createCaptureRequest(
    createInput({ idempotencyKey: 'appearance-capture-jpeg' }),
  );
  assert.equal(created.capture_request.status, 'awaiting_authorization');
  assert.deepEqual(jpeg.providerCalls, []);

  const gif = createWorld({ sourceOverrides: { media_type: 'image/gif' } });
  await assertGateBlocked(
    gif.service,
    createInput({ idempotencyKey: 'appearance-capture-gif' }),
    ['source_asset_unavailable'],
  );
  assert.deepEqual(gif.providerCalls, []);

  const wrongSize = createWorld({ sourceOverrides: { size: PNG_BYTES.length + 1 } });
  await assertGateBlocked(
    wrongSize.service,
    createInput({ idempotencyKey: 'appearance-capture-wrong-size' }),
    ['source_asset_unavailable'],
  );
  assert.deepEqual(wrongSize.providerCalls, []);
});

test('authorizes and cancels capture requests through role, revision, idempotency, and terminal-state gates', async () => {
  const world = createWorld();
  const created = (await world.service.createCaptureRequest(createInput())).capture_request;

  const fetched = await world.service.getCaptureRequest({
    organizationId: IDS.organizationId,
    requestId: created.id,
  });
  assert.deepEqual(fetched.capture_request, created);

  const listed = await world.service.listCaptureRequests({
    organizationId: IDS.organizationId,
    productId: IDS.productId,
  });
  assert.deepEqual(listed.capture_requests.map(({ id }) => id), [created.id]);
  const otherOrganizationList = await world.service.listCaptureRequests({ organizationId: 'org-fidelity-other' });
  assert.deepEqual(otherOrganizationList.capture_requests, []);

  await assert.rejects(
    world.service.getCaptureRequest({ organizationId: 'org-fidelity-other', requestId: created.id }),
    { code: 'APPEARANCE_CAPTURE_REQUEST_NOT_FOUND' },
  );
  await assert.rejects(
    world.service.getCaptureRequest({ organizationId: IDS.organizationId, requestId: 'missing-capture-request' }),
    { code: 'APPEARANCE_CAPTURE_REQUEST_NOT_FOUND' },
  );

  await assert.rejects(
    world.service.authorizeCaptureRequest(authorizeInput(created, {
      organizationId: 'org-fidelity-other',
      idempotencyKey: 'appearance-capture-authorize-cross-org',
    })),
    { code: 'APPEARANCE_CAPTURE_REQUEST_NOT_FOUND' },
  );
  await assert.rejects(
    world.service.cancelCaptureRequest(cancelInput(created, {
      organizationId: 'org-fidelity-other',
      actorMemberId: IDS.adminMemberId,
      actorRole: 'admin',
      idempotencyKey: 'appearance-capture-cancel-cross-org',
    })),
    { code: 'APPEARANCE_CAPTURE_REQUEST_NOT_FOUND' },
  );

  await assert.rejects(
    world.service.authorizeCaptureRequest(authorizeInput(created, {
      actorMemberId: IDS.actorMemberId,
      actorRole: 'member',
      idempotencyKey: 'appearance-capture-authorize-member',
    })),
    { code: 'APPEARANCE_FIDELITY_FORBIDDEN' },
  );
  await assert.rejects(
    world.service.authorizeCaptureRequest(authorizeInput(created, {
      maxCandidateGenerations: 2,
      idempotencyKey: 'appearance-capture-authorize-two-generations',
    })),
  );
  assert.equal((await world.service.getCaptureRequest({
    organizationId: IDS.organizationId,
    requestId: created.id,
  })).capture_request.status, 'awaiting_authorization');

  const authorization = authorizeInput(created);
  const authorized = await world.service.authorizeCaptureRequest(authorization);
  assert.equal(authorized.replayed, false);
  assert.equal(authorized.capture_request.status, 'queued');
  assert.equal(authorized.capture_request.row_version, created.row_version + 1);
  assert.equal(authorized.capture_request.authorized_by_member_id, IDS.adminMemberId);
  assert.equal(authorized.capture_request.authorized_at, '2026-08-20T08:00:00.000Z');
  assert.deepEqual(statusHistoryProjection(authorized.capture_request), [
    { status: 'awaiting_authorization', row_version: 1, at: '2026-08-20T08:00:00.000Z' },
    { status: 'queued', row_version: 2, at: '2026-08-20T08:00:00.000Z' },
  ]);
  assert.deepEqual((await world.repository.listEvents()).map(eventName), [
    'appearance.capture_requested',
    'appearance.capture_authorized',
  ]);
  assert.deepEqual((await world.repository.listAuditEvents()).map(eventName), [
    'appearance.capture_requested',
    'appearance.capture_authorized',
  ]);

  const authorizationReplay = await world.service.authorizeCaptureRequest(authorization);
  assert.equal(authorizationReplay.replayed, true);
  assert.deepEqual(authorizationReplay.capture_request, authorized.capture_request);
  await assert.rejects(
    world.service.authorizeCaptureRequest({
      ...authorization,
      expectedRevision: authorized.capture_request.row_version,
    }),
    { code: 'IDEMPOTENCY_CONFLICT' },
  );
  await assert.rejects(
    world.service.authorizeCaptureRequest(authorizeInput(authorized.capture_request, {
      expectedRevision: created.row_version,
      idempotencyKey: 'appearance-capture-authorize-stale',
    })),
    { code: 'APPEARANCE_CAPTURE_CONFLICT' },
  );
  assert.deepEqual(world.providerCalls, []);

  const allowedCancellationCases = [
    { label: 'creator-awaiting', actorMemberId: IDS.actorMemberId, actorRole: 'member', queued: false },
    { label: 'admin-awaiting', actorMemberId: IDS.adminMemberId, actorRole: 'admin', queued: false },
    { label: 'creator-queued', actorMemberId: IDS.actorMemberId, actorRole: 'member', queued: true },
    { label: 'admin-queued', actorMemberId: IDS.adminMemberId, actorRole: 'admin', queued: true },
  ];
  for (const cancellationCase of allowedCancellationCases) {
    const cancellationWorld = createWorld();
    let request = (await cancellationWorld.service.createCaptureRequest(
      createInput({ idempotencyKey: `appearance-capture-${cancellationCase.label}` }),
    )).capture_request;
    if (cancellationCase.queued) {
      request = (await cancellationWorld.service.authorizeCaptureRequest(authorizeInput(request, {
        idempotencyKey: `appearance-capture-authorize-${cancellationCase.label}`,
      }))).capture_request;
    }

    const command = cancelInput(request, {
      actorMemberId: cancellationCase.actorMemberId,
      actorRole: cancellationCase.actorRole,
      idempotencyKey: `appearance-capture-cancel-${cancellationCase.label}`,
    });
    const cancelled = await cancellationWorld.service.cancelCaptureRequest(command);
    assert.equal(cancelled.replayed, false);
    assert.equal(cancelled.capture_request.status, 'cancelled');
    assert.equal(cancelled.capture_request.row_version, request.row_version + 1);
    assert.deepEqual(statusHistoryProjection(cancelled.capture_request).at(-1), {
      status: 'cancelled',
      row_version: request.row_version + 1,
      at: '2026-08-20T08:00:00.000Z',
    });
    assert.equal((await cancellationWorld.repository.listEvents()).map(eventName).at(-1), 'appearance.capture_cancelled');
    assert.equal((await cancellationWorld.repository.listAuditEvents()).map(eventName).at(-1), 'appearance.capture_cancelled');

    const cancellationReplay = await cancellationWorld.service.cancelCaptureRequest(command);
    assert.equal(cancellationReplay.replayed, true);
    assert.deepEqual(cancellationReplay.capture_request, cancelled.capture_request);
    assert.deepEqual(cancellationWorld.providerCalls, []);
  }

  for (const queued of [false, true]) {
    const forbiddenWorld = createWorld();
    let request = (await forbiddenWorld.service.createCaptureRequest(
      createInput({ idempotencyKey: `appearance-capture-forbidden-${queued ? 'queued' : 'awaiting'}` }),
    )).capture_request;
    if (queued) {
      request = (await forbiddenWorld.service.authorizeCaptureRequest(authorizeInput(request, {
        idempotencyKey: `appearance-capture-authorize-forbidden-${queued ? 'queued' : 'awaiting'}`,
      }))).capture_request;
    }
    await assert.rejects(
      forbiddenWorld.service.cancelCaptureRequest(cancelInput(request, {
        actorMemberId: IDS.otherMemberId,
        actorRole: 'member',
        idempotencyKey: `appearance-capture-cancel-forbidden-${queued ? 'queued' : 'awaiting'}`,
      })),
      { code: 'APPEARANCE_FIDELITY_FORBIDDEN' },
    );
    const unchanged = await forbiddenWorld.service.getCaptureRequest({
      organizationId: IDS.organizationId,
      requestId: request.id,
    });
    assert.equal(unchanged.capture_request.status, request.status);
    assert.equal(unchanged.capture_request.row_version, request.row_version);
  }

  for (const status of ['running', 'succeeded', 'failed', 'cancelled']) {
    const conflictWorld = createWorld();
    const request = await seedCaptureRequest(conflictWorld, status);
    await assert.rejects(
      conflictWorld.service.cancelCaptureRequest(cancelInput(request, {
        idempotencyKey: `appearance-capture-cancel-${status}`,
      })),
      { code: 'APPEARANCE_CAPTURE_CONFLICT' },
    );
    await assert.rejects(
      conflictWorld.service.authorizeCaptureRequest(authorizeInput(request, {
        idempotencyKey: `appearance-capture-authorize-${status}`,
      })),
      { code: 'APPEARANCE_CAPTURE_CONFLICT' },
    );
    const unchanged = await conflictWorld.service.getCaptureRequest({
      organizationId: IDS.organizationId,
      requestId: request.id,
    });
    assert.equal(unchanged.capture_request.status, status);
    assert.equal(unchanged.capture_request.row_version, request.row_version);
  }

  const terminalWorld = createWorld();
  await seedCaptureRequest(terminalWorld, 'succeeded');
  assert.equal(terminalWorld.service.retryCaptureRequest, undefined);
  assert.equal(terminalWorld.service.resumeCaptureRequest, undefined);
});

test('Fidelity-B command idempotency keys are scoped to the exact actor', async () => {
  const world = createWorld();
  const first = (await world.service.createCaptureRequest(createInput({
    idempotencyKey: 'appearance-create-actor-scope-1',
  }))).capture_request;
  world.setCurrent({ copy_version_id: 'copy-version-actor-scope-2', copy_review_id: 'copy-review-actor-scope-2' });
  const second = (await world.service.createCaptureRequest(createInput({
    copyVersionId: 'copy-version-actor-scope-2',
    idempotencyKey: 'appearance-create-actor-scope-2',
  }))).capture_request;

  const firstCancelled = await world.service.cancelCaptureRequest(cancelInput(first, {
    actorMemberId: IDS.adminMemberId,
    actorRole: 'admin',
    idempotencyKey: 'shared-admin-command-key',
  }));
  const secondCancelled = await world.service.cancelCaptureRequest(cancelInput(second, {
    actorMemberId: IDS.otherMemberId,
    actorRole: 'admin',
    idempotencyKey: 'shared-admin-command-key',
  }));

  assert.equal(firstCancelled.capture_request.status, 'cancelled');
  assert.equal(secondCancelled.capture_request.status, 'cancelled');
});

async function createAuthorizedCapture(world, inputOverrides = {}, authorizationOverrides = {}) {
  const created = (await world.service.createCaptureRequest(
    createInput(inputOverrides),
  )).capture_request;
  return (await world.service.authorizeCaptureRequest(
    authorizeInput(created, authorizationOverrides),
  )).capture_request;
}

function eventName(event) {
  return event.event_type || event.type || event.name;
}

function assertNoPrivateCandidateProjection(value) {
  for (const key of ['provider_reference', 'reference_fingerprint', 'method', 'object_key']) {
    assert.equal(Object.hasOwn(value, key), false, `public projection leaked ${key}`);
  }
  const serialized = JSON.stringify(value);
  assert.equal(serialized.includes(PRIVATE_PROVIDER_REFERENCE.generation_id), false);
}

test('Fidelity-B claims one authorized capture and atomically persists the exact candidate evidence', async () => {
  const providerAdapter = createDeterministicProviderAdapter();
  const candidateAssetPort = createDeterministicCandidateAssetPort();
  const world = createWorld({ providerAdapter, candidateAssetPort });
  const request = await createAuthorizedCapture(world);

  const results = await Promise.all([
    world.service.runNextCapture({ systemActorId: 'appearance-fidelity-system' }),
    world.service.runNextCapture({ systemActorId: 'appearance-fidelity-system' }),
  ]);

  const claimed = results.find((result) => result?.capture_request?.status === 'succeeded');
  assert.ok(claimed, 'one concurrent runner must complete the claimed request');
  assert.equal(providerAdapter.calls.generateCandidate.length, 1);
  assert.equal(providerAdapter.calls.observeReference.length, 1);
  assert.deepEqual(providerAdapter.calls.order, ['generateCandidate', 'observeReference']);

  const generateInput = providerAdapter.calls.generateCandidate[0];
  assert.equal(generateInput.request_id, request.id);
  assert.equal(Buffer.isBuffer(generateInput.source_bytes), true);
  assert.deepEqual(generateInput.source_bytes, PNG_BYTES);
  assert.equal(generateInput.source_checksum, PNG_SHA256);
  assert.deepEqual(generateInput.upstream_bindings, expectedUpstreamBindings());
  assert.equal(generateInput.max_candidate_generations, 1);

  const observeInput = providerAdapter.calls.observeReference[0];
  assert.deepEqual({
    request_id: observeInput.request_id,
    source_checksum: observeInput.source_checksum,
    generation_context_version: observeInput.generation_context_version,
    provider_reference_type: observeInput.provider_reference_type,
    provider_reference: observeInput.provider_reference,
  }, {
    request_id: request.id,
    source_checksum: PNG_SHA256,
    generation_context_version: CANDIDATE_GENERATION_CONTEXT_VERSION,
    provider_reference_type: PROVIDER_REFERENCE_TYPE,
    provider_reference: PRIVATE_PROVIDER_REFERENCE,
  });

  assert.equal(candidateAssetPort.calls.stageVerifiedCandidate.length, 1);
  assert.equal(candidateAssetPort.calls.registerStagedCandidate.length, 1);
  assert.equal(candidateAssetPort.calls.stageVerifiedCandidate[0].captureRequestId, request.id);
  assert.equal(candidateAssetPort.calls.stageVerifiedCandidate[0].mediaType, 'image/png');
  assert.deepEqual(candidateAssetPort.calls.stageVerifiedCandidate[0].body, PNG_BYTES);
  assert.equal(
    candidateAssetPort.calls.registerStagedCandidate[0].staged.capture_request_id,
    request.id,
  );

  assert.equal(claimed.capture_request.status, 'succeeded');
  assert.equal(claimed.capture_request.appearance_candidate_id, claimed.candidate.id);
  assert.equal(claimed.candidate.capture_request_id, request.id);
  assert.equal(claimed.candidate.source_asset_version_id, IDS.sourceAssetVersionId);
  assert.equal(claimed.candidate.product_id, IDS.productId);
  assert.equal(claimed.candidate.product_revision_id, IDS.productRevisionId);
  assert.equal(claimed.candidate.media_type, 'image/png');
  assert.equal(claimed.candidate.size, PNG_BYTES.length);
  assert.equal(claimed.candidate.checksum_sha256, PNG_SHA256);
  assert.equal(claimed.candidate.generation_context_version, CANDIDATE_GENERATION_CONTEXT_VERSION);
  assert.equal(claimed.candidate.provider_reference_type, PROVIDER_REFERENCE_TYPE);
  assert.equal(Object.hasOwn(claimed.candidate, 'state'), false);
  assert.equal(Object.hasOwn(claimed.candidate, 'row_version'), false);
  assertNoPrivateCandidateProjection(claimed.candidate);

  assert.equal(claimed.candidate_state.candidate_id, claimed.candidate.id);
  assert.equal(claimed.candidate_state.state, 'available');
  assert.equal(claimed.candidate_state.row_version, 1);
  assert.equal(claimed.candidate_state.observed_at, OBSERVATION_AT);
  assert.equal(claimed.candidate_state.updated_at, OBSERVATION_AT);
  assert.equal(claimed.candidate_state.reason_code, null);

  assert.equal(claimed.provider_reference_observation.status, 'available');
  assert.equal(claimed.provider_reference_observation.observed_at, OBSERVATION_AT);
  assert.equal(claimed.provider_reference_observation.valid_until, OBSERVATION_AT);
  assertNoPrivateCandidateProjection(claimed.provider_reference_observation);

  const persistedRequest = await world.repository.getCaptureRequest({
    organizationId: IDS.organizationId,
    requestId: request.id,
  });
  assert.equal(persistedRequest.status, 'succeeded');
  assert.equal(persistedRequest.appearance_candidate_id, claimed.candidate.id);
  assert.equal(persistedRequest.failure_code, null);

  const observationsBeforeRead = await world.repository.listProviderReferenceObservations();
  assert.equal(observationsBeforeRead.length, 1);
  assert.equal(new Set(observationsBeforeRead.map(({ id }) => id)).size, 1);
  const eventsBeforeRead = await world.repository.listEvents();
  const auditEventsBeforeRead = await world.repository.listAuditEvents();
  assert.equal(new Set(eventsBeforeRead.map(({ id }) => id)).size, eventsBeforeRead.length);
  assert.equal(new Set(auditEventsBeforeRead.map(({ id }) => id)).size, auditEventsBeforeRead.length);
  assert.ok(eventsBeforeRead.map(eventName).includes('appearance.capture_claimed'));
  assert.ok(auditEventsBeforeRead.map(eventName).includes('appearance.capture_succeeded'));

  const listed = await world.service.listCandidates({ organizationId: IDS.organizationId });
  assert.equal(listed.candidates.length, 1);
  assertNoPrivateCandidateProjection(listed.candidates[0]);

  world.setNow('2026-08-20T08:00:00.001Z');
  const fetched = await world.service.getCandidate({
    organizationId: IDS.organizationId,
    candidateId: claimed.candidate.id,
  });
  assertNoPrivateCandidateProjection(fetched.candidate);
  assertNoPrivateCandidateProjection(fetched.provider_reference_status);
  assert.equal(fetched.provider_reference_status.observed_at, OBSERVATION_AT);
  assert.equal(fetched.provider_reference_status.valid_until, OBSERVATION_AT);
  assert.equal(fetched.provider_reference_status.expired, true);
  assert.deepEqual(await world.repository.listProviderReferenceObservations(), observationsBeforeRead);
  assert.deepEqual(await world.repository.listEvents(), eventsBeforeRead);
  assert.deepEqual(await world.repository.listAuditEvents(), auditEventsBeforeRead);
});

test('Fidelity-B rejects Provider references containing URLs, credentials, or Profile paths before persistence', async () => {
  for (const providerReference of [
    { generation_id: 'private-generation-url', candidate_url: 'https://provider.invalid/private/candidate.png' },
    { generation_id: 'private-generation-token', access_token: 'provider-secret' },
    { generation_id: 'private-generation-cookie', cookie: 'provider-session=value' },
    { generation_id: 'private-generation-profile', profile_path: '/private/provider/profile' },
  ]) {
    const world = createWorld({
      providerAdapter: createDeterministicProviderAdapter({
        responseOverrides: { provider_reference: providerReference },
      }),
      candidateAssetPort: createDeterministicCandidateAssetPort(),
    });
    const request = await createAuthorizedCapture(world, {
      idempotencyKey: `appearance-private-reference-${providerReference.generation_id}`,
    }, {
      idempotencyKey: `appearance-private-reference-authorize-${providerReference.generation_id}`,
    });

    const result = await world.service.runNextCapture({ systemActorId: 'appearance-fidelity-system' });

    assert.equal(result.capture_request.status, 'failed');
    assert.equal(result.capture_request.failure_code, 'PROVIDER_REFERENCE_INVALID');
    assert.equal((await world.repository.listCandidates()).length, 0);
    assert.equal(
      (await world.repository.getCaptureRequest({ organizationId: IDS.organizationId, requestId: request.id })).status,
      'failed',
    );
  }
});

test('Fidelity-B rejects a future Provider observation instead of extending the zero-duration gate', async () => {
  const world = createWorld({
    providerAdapter: createDeterministicProviderAdapter({
      observeOverrides: {
        observed_at: '2036-08-20T08:00:00.000Z',
        valid_until: '2036-08-20T08:00:00.000Z',
      },
    }),
    candidateAssetPort: createDeterministicCandidateAssetPort(),
  });
  await createAuthorizedCapture(world, {
    idempotencyKey: 'appearance-future-observation',
  }, {
    idempotencyKey: 'appearance-future-observation-authorize',
  });

  const result = await world.service.runNextCapture({ systemActorId: 'appearance-fidelity-system' });

  assert.equal(result.capture_request.status, 'failed');
  assert.equal(result.capture_request.failure_code, 'PROVIDER_REFERENCE_OBSERVATION_INVALID');
  assert.equal((await world.repository.listCandidates()).length, 0);
  assert.equal((await world.repository.listProviderReferenceObservations()).length, 0);
});

test('Fidelity-B candidate reads are organization scoped with unified not-found behavior', async () => {
  const world = createWorld({
    providerAdapter: createDeterministicProviderAdapter(),
    candidateAssetPort: createDeterministicCandidateAssetPort(),
  });
  const request = await createAuthorizedCapture(world);
  const result = await world.service.runNextCapture({ systemActorId: 'appearance-fidelity-system' });
  assert.equal(result.capture_request.status, 'succeeded');

  const own = await world.service.getCandidate({
    organizationId: IDS.organizationId,
    candidateId: result.candidate.id,
  });
  assert.equal(own.candidate.capture_request_id, request.id);
  assert.equal((await world.service.listCandidates({ organizationId: IDS.organizationId })).candidates.length, 1);
  assert.deepEqual(
    (await world.service.listCandidates({ organizationId: 'org-fidelity-other' })).candidates,
    [],
  );

  for (const input of [
    { organizationId: 'org-fidelity-other', candidateId: result.candidate.id },
    { organizationId: IDS.organizationId, candidateId: 'missing-appearance-candidate' },
  ]) {
    await assert.rejects(
      world.service.getCandidate(input),
      { code: 'APPEARANCE_CANDIDATE_NOT_FOUND' },
    );
    await assert.rejects(
      world.service.listCandidates(input),
      { code: 'APPEARANCE_CANDIDATE_NOT_FOUND' },
    );
  }
});

test('Fidelity-B list cursors are opaque and candidate downloads bind the exact candidate AssetVersion', async () => {
  const candidateAssetPort = createDeterministicCandidateAssetPort();
  const world = createWorld({
    providerAdapter: createDeterministicProviderAdapter(),
    candidateAssetPort,
  });
  const firstRequest = await createAuthorizedCapture(world, {
    idempotencyKey: 'appearance-capture-page-1',
  }, {
    idempotencyKey: 'appearance-capture-authorize-page-1',
  });
  const first = await world.service.runNextCapture({ systemActorId: 'appearance-fidelity-system' });

  world.setCurrent({ copy_version_id: 'copy-version-page-2', copy_review_id: 'copy-review-page-2' });
  const secondRequest = await createAuthorizedCapture(world, {
    copyVersionId: 'copy-version-page-2',
    idempotencyKey: 'appearance-capture-page-2',
  }, {
    idempotencyKey: 'appearance-capture-authorize-page-2',
  });
  const second = await world.service.runNextCapture({ systemActorId: 'appearance-fidelity-system' });

  const requestPage1 = await world.service.listCaptureRequests({ organizationId: IDS.organizationId, productId: IDS.productId, limit: 1 });
  assert.equal(requestPage1.capture_requests.length, 1);
  assert.equal(typeof requestPage1.next_cursor, 'string');
  const requestPage2 = await world.service.listCaptureRequests({ organizationId: IDS.organizationId, productId: IDS.productId, limit: 1, cursor: requestPage1.next_cursor });
  assert.equal(requestPage2.capture_requests.length, 1);
  assert.deepEqual(new Set([requestPage1.capture_requests[0].id, requestPage2.capture_requests[0].id]), new Set([firstRequest.id, secondRequest.id]));
  assert.equal(requestPage2.next_cursor, null);

  const candidatePage1 = await world.service.listCandidates({ organizationId: IDS.organizationId, productId: IDS.productId, limit: 1 });
  assert.equal(candidatePage1.candidates.length, 1);
  assert.equal(typeof candidatePage1.next_cursor, 'string');
  const candidatePage2 = await world.service.listCandidates({ organizationId: IDS.organizationId, productId: IDS.productId, limit: 1, cursor: candidatePage1.next_cursor });
  assert.equal(candidatePage2.candidates.length, 1);
  assert.deepEqual(new Set([candidatePage1.candidates[0].id, candidatePage2.candidates[0].id]), new Set([first.candidate.id, second.candidate.id]));

  const grant = await world.service.createCandidateDownloadAuthorization({
    organizationId: IDS.organizationId,
    candidateId: first.candidate.id,
  });
  assert.equal(grant.asset_version_id, first.candidate.candidate_asset_version_id);
  const downloaded = await world.service.downloadCandidateObject({
    organizationId: IDS.organizationId,
    candidateId: first.candidate.id,
    token: grant.token,
  });
  assert.deepEqual(downloaded.body, PNG_BYTES);
  assert.equal(downloaded.checksum_sha256, PNG_SHA256);

  await assert.rejects(
    world.service.downloadCandidateObject({
      organizationId: IDS.organizationId,
      candidateId: second.candidate.id,
      token: grant.token,
    }),
    { code: 'DOWNLOAD_AUTHORIZATION_NOT_FOUND' },
  );
  await assert.rejects(
    world.service.createCandidateDownloadAuthorization({ organizationId: 'org-other', candidateId: first.candidate.id }),
    { code: 'APPEARANCE_CANDIDATE_NOT_FOUND' },
  );
});

test('Fidelity-B failures are terminal, controlled, non-retryable, and discard staged objects', async () => {
  const failureCases = [
    {
      name: 'disabled adapter throw',
      provider: { generateError: 'PROVIDER_ADAPTER_DISABLED' },
      expectedFailureCode: 'PROVIDER_ADAPTER_DISABLED',
    },
    {
      name: 'URL-only candidate without bytes',
      provider: {
        responseOverrides: {
          bytes: undefined,
          candidate_url: 'https://provider.invalid/private/candidate.png',
        },
      },
      expectedFailureCode: 'CANDIDATE_BYTES_MISSING',
    },
    {
      name: 'request binding mismatch',
      provider: { responseOverrides: { request_id: 'different-capture-request' } },
      expectedFailureCode: 'CANDIDATE_REQUEST_BINDING_MISMATCH',
    },
    {
      name: 'source checksum binding mismatch',
      provider: { responseOverrides: { source_checksum: 'different-source-checksum' } },
      expectedFailureCode: 'CANDIDATE_SOURCE_BINDING_MISMATCH',
    },
    {
      name: 'GIF media mismatch',
      provider: { responseOverrides: { bytes: GIF_BYTES, media_type: 'image/gif' } },
      expectedFailureCode: 'CANDIDATE_MEDIA_TYPE_NOT_ALLOWED',
    },
    {
      name: 'unknown reference observation',
      provider: { observeStatus: 'unknown' },
      expectedFailureCode: 'PROVIDER_REFERENCE_UNKNOWN',
    },
    {
      name: 'unavailable reference observation',
      provider: { observeStatus: 'unavailable' },
      expectedFailureCode: 'PROVIDER_REFERENCE_UNAVAILABLE',
    },
    {
      name: 'candidate storage/register failure',
      provider: {},
      candidateAsset: { registerError: 'CANDIDATE_ASSET_REGISTER_FAILED' },
      expectedFailureCode: 'CANDIDATE_ASSET_REGISTER_FAILED',
      expectsDiscard: true,
    },
  ];

  for (const failureCase of failureCases) {
    const providerAdapter = createDeterministicProviderAdapter(failureCase.provider);
    const candidateAssetPort = createDeterministicCandidateAssetPort(failureCase.candidateAsset);
    const world = createWorld({ providerAdapter, candidateAssetPort });
    const request = await createAuthorizedCapture(world, {
      idempotencyKey: `appearance-capture-failure-${failureCase.name.replace(/\W+/g, '-')}`,
    }, {
      idempotencyKey: `appearance-capture-authorize-failure-${failureCase.name.replace(/\W+/g, '-')}`,
    });

    const result = await world.service.runNextCapture({ systemActorId: 'appearance-fidelity-system' });
    assert.equal(result.capture_request.status, 'failed', failureCase.name);
    assert.equal(result.capture_request.failure_code, failureCase.expectedFailureCode, failureCase.name);
    assert.equal(result.candidate ?? null, null, failureCase.name);

    const stored = await world.repository.listCaptureRequests({ organizationId: IDS.organizationId });
    assert.equal(stored.length, 1, failureCase.name);
    assert.equal(stored[0].status, 'failed', failureCase.name);
    assert.equal(stored[0].failure_code, failureCase.expectedFailureCode, failureCase.name);
    assert.deepEqual(
      (await world.service.listCandidates({ organizationId: IDS.organizationId })).candidates,
      [],
      failureCase.name,
    );
    assert.equal(world.service.retryCaptureRequest, undefined, failureCase.name);
    assert.equal(world.service.resumeCaptureRequest, undefined, failureCase.name);

    const firstProviderCallCount = providerAdapter.calls.generateCandidate.length;
    await world.service.runNextCapture({ systemActorId: 'appearance-fidelity-system' });
    assert.equal(providerAdapter.calls.generateCandidate.length, firstProviderCallCount, failureCase.name);

    if (failureCase.expectsDiscard) {
      assert.equal(candidateAssetPort.calls.stageVerifiedCandidate.length, 1, failureCase.name);
      assert.equal(candidateAssetPort.calls.registerStagedCandidate.length, 1, failureCase.name);
      assert.equal(candidateAssetPort.calls.discardStagedCandidate.length, 1, failureCase.name);
      assert.equal(candidateAssetPort.stagedObjects.size, 0, failureCase.name);
    } else {
      assert.equal(candidateAssetPort.calls.discardStagedCandidate.length, 0, failureCase.name);
    }

    const events = await world.repository.listEvents();
    const audits = await world.repository.listAuditEvents();
    assert.ok(events.map(eventName).includes('appearance.capture_failed'), failureCase.name);
    assert.ok(audits.map(eventName).includes('appearance.capture_failed'), failureCase.name);
    assert.equal(new Set(events.map(({ id }) => id)).size, events.length, failureCase.name);
    assert.equal(new Set(audits.map(({ id }) => id)).size, audits.length, failureCase.name);
  }
});

test('Fidelity-B rolls back candidate Asset rows when completion rejects registered metadata', async () => {
  const candidateAssetPort = createDeterministicCandidateAssetPort({ invalidRegisteredMetadata: true });
  const world = createWorld({
    providerAdapter: createDeterministicProviderAdapter(),
    candidateAssetPort,
  });
  await createAuthorizedCapture(world, {
    idempotencyKey: 'appearance-capture-atomic-asset-rollback',
  }, {
    idempotencyKey: 'appearance-capture-authorize-atomic-asset-rollback',
  });

  const result = await world.service.runNextCapture({ systemActorId: 'appearance-fidelity-system' });

  assert.equal(result.capture_request.status, 'failed');
  assert.equal(result.capture_request.failure_code, 'CANDIDATE_ASSET_REGISTER_INVALID');
  assert.equal(candidateAssetPort.calls.registerStagedCandidate.length, 1);
  assert.equal(candidateAssetPort.calls.discardStagedCandidate.length, 1);
  assert.equal(candidateAssetPort.stagedObjects.size, 0);
  assert.equal(candidateAssetPort.registeredAssets.size, 0);
  assert.equal(candidateAssetPort.registeredVersions.size, 0);
  assert.deepEqual(
    (await world.service.listCandidates({ organizationId: IDS.organizationId })).candidates,
    [],
  );
  assert.deepEqual(await world.repository.listProviderReferenceObservations(), []);
});

test('Fidelity-B revalidates frozen upstream and source before any provider call', async () => {
  const changedSourceBytes = Buffer.concat([PNG_BYTES, Buffer.from([0])]);
  const changedSourceChecksum = sha256(changedSourceBytes);
  const cases = [
    {
      label: 'upstream changed',
      mutate(world) {
        world.setCurrent({ copy_version_id: 'copy-version-after-authorization' });
      },
      expectedFailureCode: 'UPSTREAM_CHANGED_AFTER_AUTHORIZATION',
    },
    {
      label: 'source changed',
      mutate(world) {
        world.setSource({
          bytes: changedSourceBytes,
          size: changedSourceBytes.length,
          checksum_sha256: changedSourceChecksum,
        });
      },
      expectedFailureCode: 'SOURCE_CHANGED_AFTER_AUTHORIZATION',
    },
  ];

  for (const failureCase of cases) {
    const providerAdapter = createDeterministicProviderAdapter();
    const world = createWorld({ providerAdapter });
    const request = await createAuthorizedCapture(world, {
      idempotencyKey: `appearance-capture-${failureCase.label.replace(/\W+/g, '-')}`,
    }, {
      idempotencyKey: `appearance-capture-authorize-${failureCase.label.replace(/\W+/g, '-')}`,
    });
    failureCase.mutate(world);

    const result = await world.service.runNextCapture({ systemActorId: 'appearance-fidelity-system' });
    assert.equal(result.capture_request.status, 'failed', failureCase.label);
    assert.equal(result.capture_request.failure_code, failureCase.expectedFailureCode, failureCase.label);
    assert.equal(result.candidate ?? null, null, failureCase.label);
    assert.equal(providerAdapter.calls.generateCandidate.length, 0, failureCase.label);
    assert.equal(providerAdapter.calls.observeReference.length, 0, failureCase.label);
    assert.equal(world.candidateAssetPort.calls.stageVerifiedCandidate.length, 0, failureCase.label);

    const stored = await world.repository.getCaptureRequest({
      organizationId: IDS.organizationId,
      requestId: request.id,
    });
    assert.equal(stored.status, 'failed', failureCase.label);
    assert.equal(stored.failure_code, failureCase.expectedFailureCode, failureCase.label);
  }
});

test('Fidelity-B default provider adapter is disabled and performs zero network calls', async () => {
  const originalFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error('network must not be reached by the disabled adapter');
  };

  try {
    const adapter = createDisabledProviderAdapter();
    assert.equal(adapter.enabled, false);
    assert.equal(adapter.mode, 'fail_closed');

    await assert.rejects(
      adapter.generateCandidate({ request_id: 'capture-disabled' }),
      { code: 'PROVIDER_ADAPTER_DISABLED' },
    );
    await assert.rejects(
      adapter.observeReference({ request_id: 'capture-disabled' }),
      { code: 'PROVIDER_ADAPTER_DISABLED' },
    );
    assert.equal(networkCalls, 0);
  } finally {
    if (originalFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = originalFetch;
  }
});

test('Fidelity-B capture worker is stopped by default and runs one short task at a time', async () => {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  const service = {
    async runNextCapture(input) {
      calls.push(input);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await blocked;
      active -= 1;
      return { capture_request: { id: 'capture-success', status: 'succeeded' } };
    },
  };

  const worker = createAppearanceCaptureWorker({
    service,
    systemActorId: 'appearance-fidelity-system',
    pollIntervalMs: 1,
  });

  assert.equal(worker.autoStart, false);
  assert.equal(worker.stopped, true);
  assert.equal(calls.length, 0);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 0);

  const first = worker.runNext();
  await Promise.resolve();
  assert.equal(await worker.runNext(), null);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { systemActorId: 'appearance-fidelity-system' });

  release();
  await first;
  assert.equal(maxActive, 1);
  assert.equal(worker.leaseMs, undefined);
  assert.equal(worker.heartbeatIntervalMs, undefined);

  worker.stop();
});

test('Fidelity-B capture worker stops after one failed request without retry or resume', async () => {
  let callCount = 0;
  const service = {
    async runNextCapture() {
      callCount += 1;
      return {
        capture_request: {
          id: 'capture-failed-once',
          status: 'failed',
          failure_code: 'PROVIDER_ADAPTER_DISABLED',
        },
        candidate: null,
      };
    },
  };
  const worker = createAppearanceCaptureWorker({ service, pollIntervalMs: 1 });

  worker.start();
  for (let attempt = 0; attempt < 20 && callCount === 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(callCount, 1);
  assert.equal(worker.stopped, true);
  assert.equal(worker.retryCaptureRequest, undefined);
  assert.equal(worker.resumeCaptureRequest, undefined);

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(callCount, 1);
  worker.stop();
});
