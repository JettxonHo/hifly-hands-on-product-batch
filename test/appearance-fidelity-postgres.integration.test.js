import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { createAppearanceFidelityService } from "../src/appearance-fidelity/appearance-fidelity-service.js";
import { createPostgresAppearanceFidelityRepository } from "../src/appearance-fidelity/postgres-appearance-fidelity-repository.js";
import { runAppearanceFidelityMigrations } from "../src/appearance-fidelity/postgres.js";
import { createAssetService } from "../src/assets/asset-service.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createPostgresAssetRepository } from "../src/assets/postgres-asset-repository.js";
import { runAssetMigrations } from "../src/assets/postgres.js";
import { createPostgresIdentityRepository } from "../src/identity/postgres-identity-repository.js";
import { createIdentityPool, runIdentityMigrations } from "../src/identity/postgres.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";

const connectionString = process.env.APPEARANCE_FIDELITY_TEST_DATABASE_URL || process.env.IDENTITY_TEST_DATABASE_URL;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const CHECKSUM = createHash("sha256").update(PNG).digest("hex");
const AT = "2026-08-20T08:00:00.000Z";

function isolatedUrl(value, schema) {
  const url = new URL(value);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

function createProvider() {
  let generated;
  const calls = { generate: 0, observe: 0 };
  return {
    calls,
    async generateCandidate(input) {
      calls.generate += 1;
      generated = {
        request_id: input.request_id,
        source_checksum: input.source_checksum,
        bytes: Buffer.from(PNG),
        media_type: "image/png",
        generation_context_version: "appearance-fidelity-context-v1",
        provider_reference_type: "hifly-generation-reference",
        provider_reference: { generation_id: "private-generation-1" }
      };
      return generated;
    },
    async observeReference(input) {
      calls.observe += 1;
      return {
        ...input,
        status: "available",
        observed_at: AT,
        valid_until: AT
      };
    }
  };
}

async function seedSourceAsset(assetService, organizationId, actorMemberId) {
  const authorization = await assetService.createUploadAuthorization({
    organizationId,
    actorMemberId,
    idempotencyKey: "appearance-source-upload",
    filename: "source.png",
    contentType: "image/png",
    size: PNG.length,
    checksumSha256: CHECKSUM
  });
  await assetService.uploadObject({
    organizationId,
    uploadToken: authorization.upload.token,
    body: PNG,
    contentType: "image/png"
  });
  await assetService.completeUpload({
    organizationId,
    uploadSessionId: authorization.upload_session_id,
    idempotencyKey: "appearance-source-complete",
    actorMemberId
  });
  await assetService.runNextVerificationJob();
  return authorization.asset_version.id;
}

function upstreamSnapshot({ productId, revisionId, sourceAssetVersionId, copyVersionId, avatarSelectionId, planId, ids }) {
  return {
    current_valid: true,
    workspace_revision: 12,
    product_id: productId,
    product_revision_id: revisionId,
    source_asset_version_ids: [sourceAssetVersionId],
    copy_version_id: copyVersionId,
    copy_review_id: ids.copyReviewId,
    avatar_selection_id: avatarSelectionId,
    avatar_asset_version_id: ids.avatarAssetVersionId,
    video_plan_version_id: planId,
    plan_review_id: ids.planReviewId,
    preflight_result_id: ids.preflightResultId,
    presentation_size_code: "small"
  };
}

test("PostgreSQL Fidelity-B seam claims and atomically captures one candidate", { skip: !connectionString }, async (t) => {
  const schema = `appearance_fidelity_${randomUUID().replaceAll("-", "")}`;
  const adminPool = createIdentityPool({ connectionString });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = createIdentityPool({ connectionString: isolatedUrl(connectionString, schema), max: 8 });
  t.after(async () => {
    await pool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  await runIdentityMigrations(pool);
  await runAssetMigrations(pool);
  const identity = createPostgresIdentityRepository({ pool, ownsPool: false });
  const seeded = await seedInitialAdmin(identity, {
    organizationId: "org-appearance-pg",
    organizationName: "Appearance PG",
    adminEmail: "appearance-pg@example.test",
    adminDisplayName: "Appearance PG Admin",
    adminTempPassword: "Temporary-Appearance-PG-9!"
  });
  const organizationId = "org-appearance-pg";
  const sourceAssetRepository = createPostgresAssetRepository({ pool });
  await sourceAssetRepository.initialize();
  const assetService = createAssetService({ repository: sourceAssetRepository, objectStore: createMemoryObjectStore(), now: () => Date.parse(AT) });
  const sourceAssetVersionId = await seedSourceAsset(assetService, organizationId, seeded.member.id);

  await runAppearanceFidelityMigrations(pool);
  await runAppearanceFidelityMigrations(pool);
  assert.equal((await pool.query("SELECT max(version)::integer AS version FROM appearance_fidelity_schema_migrations")).rows[0].version, 1);
  assert.match((await pool.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace=current_schema()::regnamespace AND conname='asset_assets_kind_check'")).rows[0].definition, /appearance_candidate_image/);
  const sourceForCapture = await assetService.sourceProductImagePort.readVerifiedProductImage({ organizationId, assetVersionId: sourceAssetVersionId });
  assert.equal(sourceForCapture.asset_version_id, sourceAssetVersionId);
  assert.equal(sourceForCapture.kind, "product_image");

  const ids = {
    productId: randomUUID(),
    revisionId: randomUUID(),
    copyVersionId: randomUUID(),
    avatarSelectionId: randomUUID(),
    planId: randomUUID(),
    copyReviewId: randomUUID(),
    avatarAssetVersionId: randomUUID(),
    planReviewId: randomUUID(),
    preflightResultId: randomUUID()
  };
  const snapshot = upstreamSnapshot({ ...ids, sourceAssetVersionId, ids });
  const appearanceRepository = createPostgresAppearanceFidelityRepository({ pool });
  await appearanceRepository.initialize();
  const provider = createProvider();
  const service = createAppearanceFidelityService({
    repository: appearanceRepository,
    upstreamPort: { async resolveCurrent() { return snapshot; } },
    sourceAssetPort: {
      readVerifiedProductImage(input) {
        return assetService.sourceProductImagePort.readVerifiedProductImage({ ...input, assetVersionId: input.sourceAssetVersionId });
      }
    },
    providerAdapter: provider,
    candidateAssetPort: assetService.appearanceCandidateAssetPort,
    now: () => AT
  });
  const requestInput = {
    organizationId,
    actorMemberId: seeded.member.id,
    productId: ids.productId,
    productRevisionId: ids.revisionId,
    sourceAssetVersionId,
    copyVersionId: ids.copyVersionId,
    avatarSelectionId: ids.avatarSelectionId,
    videoPlanVersionId: ids.planId,
    expectedWorkspaceRevision: 12,
    idempotencyKey: "appearance-request-pg"
  };

  const created = (await service.createCaptureRequest(requestInput)).capture_request;
  const createdReplay = await service.createCaptureRequest(requestInput);
  assert.equal(createdReplay.replayed, true);
  await assert.rejects(
    service.createCaptureRequest({ ...requestInput, productId: randomUUID() }),
    { code: "IDEMPOTENCY_CONFLICT" }
  );

  const authorized = (await service.authorizeCaptureRequest({
    organizationId,
    actorMemberId: seeded.member.id,
    actorRole: "admin",
    requestId: created.id,
    expectedRevision: created.row_version,
    maxCandidateGenerations: 1,
    idempotencyKey: "appearance-authorize-pg"
  })).capture_request;
  const authorizedReplay = await service.authorizeCaptureRequest({
    organizationId,
    actorMemberId: seeded.member.id,
    actorRole: "admin",
    requestId: created.id,
    expectedRevision: created.row_version,
    maxCandidateGenerations: 1,
    idempotencyKey: "appearance-authorize-pg"
  });
  assert.equal(authorizedReplay.replayed, true);
  assert.equal(authorizedReplay.capture_request.id, authorized.id);
  await assert.rejects(
    service.authorizeCaptureRequest({
      organizationId,
      actorMemberId: seeded.member.id,
      actorRole: "admin",
      requestId: created.id,
      expectedRevision: created.row_version,
      maxCandidateGenerations: 1,
      idempotencyKey: "appearance-authorize-pg-stale"
    }),
    { code: "APPEARANCE_CAPTURE_CONFLICT" }
  );

  const [first, second] = await Promise.all([
    service.runNextCapture({ systemActorId: "appearance-fidelity-system" }),
    service.runNextCapture({ systemActorId: "appearance-fidelity-system" })
  ]);
  const result = first?.candidate ? first : second;
  assert.ok(result?.candidate);
  assert.equal(provider.calls.generate, 1);
  assert.equal(provider.calls.observe, 1);
  assert.equal(result.capture_request.status, "succeeded");
  assert.equal(result.capture_request.row_version, authorized.row_version + 2);
  assert.equal(result.candidate_state.state, "available");
  assert.equal(result.candidate_state.row_version, 1);
  assert.equal(result.provider_reference_observation.status, "available");
  assert.equal(result.provider_reference_observation.valid_until, AT);

  const candidateAsset = await assetService.getAsset({ organizationId, assetId: result.candidate.candidate_asset_id });
  const candidateVersion = await assetService.getAssetVersion({ organizationId, assetVersionId: result.candidate.candidate_asset_version_id });
  assert.equal(candidateAsset.kind, "appearance_candidate_image");
  assert.equal(candidateVersion.status, "available");
  assert.equal(candidateVersion.object_key, `${organizationId}/appearance-candidates/${result.candidate.id}/candidate.png`);
  assert.equal(candidateVersion.verified_checksum_sha256, CHECKSUM);

  const fetched = await service.getCandidate({ organizationId, candidateId: result.candidate.id });
  assert.equal(fetched.candidate.id, result.candidate.id);
  assert.equal(fetched.candidate_state.state, "available");
  assert.equal(fetched.provider_reference_status.status, "available");
  assert.deepEqual((await service.listCandidates({ organizationId: "org-appearance-other" })).candidates, []);
  await assert.rejects(
    service.getCandidate({ organizationId: "org-appearance-other", candidateId: result.candidate.id }),
    { code: "APPEARANCE_CANDIDATE_NOT_FOUND" }
  );
  const events = await appearanceRepository.listEvents(organizationId);
  const auditEvents = await appearanceRepository.listAuditEvents(organizationId);
  assert.ok(events.some((event) => event.event_type === "appearance.capture_claimed"));
  assert.ok(events.some((event) => event.event_type === "appearance.capture_succeeded"));
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);
  assert.equal(new Set(auditEvents.map((event) => event.id)).size, auditEvents.length);

  await assert.rejects(
    pool.query("UPDATE appearance_candidates SET generation_context_version='mutated' WHERE id=$1", [result.candidate.id]),
    /append-only/
  );
  await assert.rejects(
    pool.query("UPDATE appearance_provider_reference_observations SET reason_code='mutated' WHERE candidate_id=$1", [result.candidate.id]),
    /append-only/
  );
  await assert.rejects(
    pool.query("UPDATE appearance_capture_requests SET status='queued' WHERE id=$1", [result.capture_request.id]),
    /state cannot move backward|terminal request state is immutable|revision must increase/
  );
  await pool.query(
    "UPDATE appearance_candidate_states SET state='reference_unavailable', row_version=2, reason_code='provider_reference_unavailable' WHERE candidate_id=$1",
    [result.candidate.id]
  );
  await assert.rejects(
    pool.query("UPDATE appearance_candidate_states SET state='available', row_version=3 WHERE candidate_id=$1", [result.candidate.id]),
    /candidate state cannot regress/
  );

  const competing = await Promise.allSettled([
    service.createCaptureRequest({ ...requestInput, idempotencyKey: "appearance-active-pg-1" }),
    service.createCaptureRequest({ ...requestInput, idempotencyKey: "appearance-active-pg-2" })
  ]);
  assert.equal(competing.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(competing.filter((item) => item.status === "rejected")[0].reason.code, "APPEARANCE_CAPTURE_CONFLICT");
  const competingWinner = competing.find((item) => item.status === "fulfilled").value.capture_request;
  await service.cancelCaptureRequest({
    organizationId,
    actorMemberId: seeded.member.id,
    actorRole: "admin",
    requestId: competingWinner.id,
    expectedRevision: competingWinner.row_version,
    idempotencyKey: "appearance-active-cancel-pg"
  });

  const runningInput = { ...requestInput, idempotencyKey: "appearance-rollback-pg" };
  const runningCreated = (await service.createCaptureRequest(runningInput)).capture_request;
  const runningAuthorized = (await service.authorizeCaptureRequest({
    organizationId,
    actorMemberId: seeded.member.id,
    actorRole: "admin",
    requestId: runningCreated.id,
    expectedRevision: runningCreated.row_version,
    maxCandidateGenerations: 1,
    idempotencyKey: "appearance-rollback-authorize-pg"
  })).capture_request;
  const running = await appearanceRepository.claimNextCapture({ systemActorId: "appearance-fidelity-system", now: AT });
  assert.equal(running.id, runningAuthorized.id);
  const rollbackCandidateId = randomUUID();
  const staged = await assetService.appearanceCandidateAssetPort.stageVerifiedCandidate({
    organizationId,
    candidateId: rollbackCandidateId,
    captureRequestId: running.id,
    body: PNG,
    mediaType: "image/png"
  });
  const rollbackCandidate = {
    id: rollbackCandidateId,
    organization_id: organizationId,
    capture_request_id: running.id,
    product_id: running.product_id,
    product_revision_id: running.product_revision_id,
    source_asset_version_id: running.source_asset_version_id,
    source_asset_media_type: running.source_asset_media_type,
    source_asset_size: running.source_asset_size,
    source_asset_checksum_sha256: running.source_asset_checksum_sha256,
    copy_version_id: running.copy_version_id,
    copy_review_id: running.copy_review_id,
    avatar_selection_id: running.avatar_selection_id,
    avatar_asset_version_id: running.avatar_asset_version_id,
    video_plan_version_id: running.video_plan_version_id,
    plan_review_id: running.plan_review_id,
    preflight_result_id: running.preflight_result_id,
    presentation_size_code: running.presentation_size_code,
    media_type: "image/png",
    size: PNG.length,
    checksum_sha256: CHECKSUM,
    provider: "hifly",
    provider_reference_type: "hifly-generation-reference",
    provider_reference: { generation_id: "rollback-generation" },
    generation_context_version: "appearance-fidelity-context-v1",
    created_at: AT
  };
  await assert.rejects(
    appearanceRepository.completeCapture({
      organizationId,
      requestId: running.id,
      expectedRevision: running.row_version,
      candidate: rollbackCandidate,
      candidateState: {
        candidate_id: rollbackCandidateId,
        organization_id: organizationId,
        state: "available",
        row_version: 1,
        reason_code: null,
        observed_at: AT,
        updated_at: AT,
        superseded_by_candidate_id: null
      },
      providerReferenceObservation: {
        id: randomUUID(),
        organization_id: organizationId,
        candidate_id: rollbackCandidateId,
        reference_fingerprint: CHECKSUM,
        status: "available",
        method: "provider_adapter.observeReference",
        seam_version: "appearance-fidelity-observation-v1",
        policy_version: "same-gate-observed-at-v1",
        observed_at: AT,
        valid_until: AT,
        reason_code: null,
        created_at: AT
      },
      registerCandidateAsset: async (transactionClient) => {
        await assetService.appearanceCandidateAssetPort.registerStagedCandidate({
          organizationId,
          actorSystemId: "appearance-fidelity-system",
          staged,
          transactionClient
        });
        throw new Error("ROLLBACK_AFTER_ASSET_INSERT");
      },
      now: AT,
      actorSystemId: "appearance-fidelity-system"
    }),
    { message: "ROLLBACK_AFTER_ASSET_INSERT" }
  );
  assert.equal((await appearanceRepository.listCandidates({ organizationId })).length, 1);
  assert.equal((await pool.query("SELECT count(*)::integer AS count FROM asset_assets WHERE organization_id=$1 AND kind='appearance_candidate_image'", [organizationId])).rows[0].count, 1);
  assert.equal((await appearanceRepository.getCaptureRequest({ organizationId, requestId: running.id })).status, "running");
  await assetService.appearanceCandidateAssetPort.discardStagedCandidate({ organizationId, staged });
});
