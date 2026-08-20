import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createAssetService } from "../src/assets/asset-service.js";
import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createLocalObjectStore } from "../src/assets/local-object-store.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const SHA256 = createHash("sha256").update(PNG).digest("hex");
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const WEBP = Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 \x00\x00\x00\x00", "binary");
const GIF = Buffer.from("GIF89a\x01\x00\x01\x00\x00\x00\x00", "ascii");
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function world({ now = () => Date.parse("2026-08-06T08:00:00Z"), trackPuts = false } = {}) {
  const repository = createMemoryAssetRepository();
  const objectStore = createMemoryObjectStore();
  const putCalls = [];
  if (trackPuts) {
    const put = objectStore.put.bind(objectStore);
    objectStore.put = async (input) => {
      putCalls.push({ ...input });
      return put(input);
    };
  }
  const service = createAssetService({ repository, objectStore, now });
  return { repository, objectStore, service, putCalls };
}

async function uploaded(world, overrides = {}) {
  const created = await world.service.createUploadAuthorization({
    organizationId: "org_a",
    actorMemberId: "member_a",
    idempotencyKey: `upload-${randomUUID()}`,
    filename: "product.png",
    contentType: "image/png",
    size: PNG.length,
    checksumSha256: SHA256,
    ...overrides
  });
  await world.service.uploadObject({
    organizationId: "org_a",
    uploadToken: created.upload.token,
    body: PNG,
    contentType: "image/png"
  });
  return created;
}

async function verified(world, overrides = {}) {
  const created = await uploaded(world, overrides);
  await world.service.completeUpload({
    organizationId: "org_a",
    uploadSessionId: created.upload_session_id,
    idempotencyKey: `verify-${randomUUID()}`
  });
  await world.service.runNextVerificationJob();
  return created;
}

test("upload authorization is idempotent and safely re-signs an unfinished session", async () => {
  const w = world();
  const input = {
    organizationId: "org_a", actorMemberId: "member_a", idempotencyKey: "authorize-1",
    filename: " product.png ", contentType: "image/png", size: PNG.length, checksumSha256: SHA256
  };
  const first = await w.service.createUploadAuthorization(input);
  const replay = await w.service.createUploadAuthorization({ ...input, filename: "product.png" });
  assert.equal(replay.asset.id, first.asset.id);
  assert.equal(replay.asset_version.id, first.asset_version.id);
  assert.equal(replay.upload_session_id, first.upload_session_id);
  assert.notEqual(replay.upload.token, first.upload.token);
  assert.equal((await w.service.listAssets({ organizationId: "org_a" })).length, 1);
  assert.equal((await w.repository.listAuditEvents()).filter((event) => event.event_type === "asset.upload_authorized").length, 1);
  await w.service.uploadObject({ organizationId: "org_a", uploadToken: replay.upload.token, body: PNG, contentType: "image/png" });
  await assert.rejects(w.service.createUploadAuthorization({ ...input, size: PNG.length + 1 }), { code: "IDEMPOTENCY_CONFLICT" });
  const otherActor = await w.service.createUploadAuthorization({ ...input, actorMemberId: "member_b" });
  assert.notEqual(otherActor.asset.id, first.asset.id);
});

test("new content creates concurrent unique versions on the same active Asset", async () => {
  const w = world();
  const first = await uploaded(w);
  const createVersion = (key) => w.service.createUploadAuthorization({
    organizationId: "org_a", actorMemberId: "member_a", idempotencyKey: key, assetId: first.asset.id,
    filename: `${key}.png`, contentType: "image/png", size: PNG.length, checksumSha256: SHA256
  });
  const [second, third] = await Promise.all([createVersion("version-2"), createVersion("version-3")]);
  assert.equal(second.asset.id, first.asset.id);
  assert.deepEqual([second.asset_version.version_number, third.asset_version.version_number].sort(), [2, 3]);
  const versions = (await w.service.listAssets({ organizationId: "org_a" }))[0].versions;
  assert.equal(versions.length, 3);
  assert.deepEqual(versions.map((version) => version.version_number), [3, 2, 1]);
  await w.service.disableAsset({ organizationId: "org_a", assetId: first.asset.id, expectedRevision: 1 });
  await assert.rejects(createVersion("disabled-version"), { code: "ASSET_NOT_ACTIVE" });
  const deleted = await uploaded(w);
  await w.service.deleteAsset({ organizationId: "org_a", assetId: deleted.asset.id, expectedRevision: 1 });
  await assert.rejects(w.service.createUploadAuthorization({
    organizationId: "org_a", actorMemberId: "member_a", idempotencyKey: "deleted-version", assetId: deleted.asset.id,
    filename: "deleted.png", contentType: "image/png", size: PNG.length, checksumSha256: SHA256
  }), { code: "ASSET_NOT_ACTIVE" });
  await assert.rejects(w.service.createUploadAuthorization({
    organizationId: "org_b", actorMemberId: "member_b", idempotencyKey: "cross-org-version", assetId: first.asset.id,
    filename: "cross.png", contentType: "image/png", size: PNG.length, checksumSha256: SHA256
  }), { code: "ASSET_NOT_FOUND" });
});

test("display name metadata uses optimistic concurrency without creating an AssetVersion", async () => {
  const w = world();
  const created = await uploaded(w);
  const updated = await w.service.updateAssetMetadata({
    organizationId: "org_a", assetId: created.asset.id, expectedRevision: 1, displayName: "主图 A", actorMemberId: "member_a"
  });
  assert.equal(updated.display_name, "主图 A");
  assert.equal(updated.revision_number, 2);
  assert.equal((await w.service.listAssets({ organizationId: "org_a" }))[0].versions.length, 1);
  await assert.rejects(w.service.updateAssetMetadata({
    organizationId: "org_a", assetId: created.asset.id, expectedRevision: 1, displayName: "stale"
  }), { code: "ASSET_VERSION_CONFLICT" });
});

test("upload completion enters verifying and does not make a version available", async () => {
  const w = world();
  const created = await uploaded(w);
  const completed = await w.service.completeUpload({
    organizationId: "org_a", uploadSessionId: created.upload_session_id, idempotencyKey: "complete-1"
  });
  assert.equal(completed.asset_version.status, "verifying");
  assert.equal((await w.service.getAssetVersion({ organizationId: "org_a", assetVersionId: created.asset_version.id })).status, "verifying");
  assert.equal((await w.repository.listPendingVerificationJobs()).length, 1);
});

test("successful server verification makes the immutable version available", async () => {
  const w = world();
  const created = await uploaded(w);
  await w.service.completeUpload({ organizationId: "org_a", uploadSessionId: created.upload_session_id, idempotencyKey: "complete-1" });
  await w.service.runNextVerificationJob();
  const version = await w.service.getAssetVersion({ organizationId: "org_a", assetVersionId: created.asset_version.id });
  assert.equal(version.status, "available");
  assert.equal(version.verified_content_type, "image/png");
  assert.equal(version.verified_size, PNG.length);
  assert.equal(version.verified_checksum_sha256, SHA256);
});

test("download authorization and download use the available version's verified metadata", async () => {
  const w = world();
  const created = await uploaded(w);
  await w.service.completeUpload({ organizationId: "org_a", uploadSessionId: created.upload_session_id, idempotencyKey: "download-complete" });
  await w.service.runNextVerificationJob();

  const grant = await w.service.createDownloadAuthorization({ organizationId: "org_a", assetVersionId: created.asset_version.id });
  assert.equal(grant.asset_version_id, created.asset_version.id);
  assert.equal(grant.original_filename, "product.png");
  assert.equal(grant.verified_content_type, "image/png");
  assert.equal(grant.verified_size, PNG.length);
  assert.equal(grant.verified_checksum_sha256, SHA256);
  assert.ok(grant.token);
  assert.ok(grant.expires_at);

  const downloaded = await w.service.downloadObject({ organizationId: "org_a", token: grant.token });
  assert.equal(downloaded.contentType, "image/png");
  assert.equal(downloaded.original_filename, grant.original_filename);
  assert.equal(downloaded.verified_content_type, grant.verified_content_type);
  assert.equal(downloaded.verified_size, grant.verified_size);
  assert.equal(downloaded.verified_checksum_sha256, grant.verified_checksum_sha256);
  assert.equal(downloaded.body.length, grant.verified_size);
  assert.equal(createHash("sha256").update(downloaded.body).digest("hex"), grant.verified_checksum_sha256);
});

test("download authorization metadata does not weaken organization isolation or expiry", async () => {
  let currentTime = Date.parse("2026-08-06T08:00:00Z");
  const w = world({ now: () => currentTime });
  const created = await uploaded(w);
  await w.service.completeUpload({ organizationId: "org_a", uploadSessionId: created.upload_session_id, idempotencyKey: "download-boundary-complete" });
  await w.service.runNextVerificationJob();
  const grant = await w.service.createDownloadAuthorization({ organizationId: "org_a", assetVersionId: created.asset_version.id });

  await assert.rejects(w.service.downloadObject({ organizationId: "org_b", token: grant.token }), { code: "DOWNLOAD_AUTHORIZATION_NOT_FOUND" });
  currentTime = Date.parse(grant.expires_at) + 1;
  await assert.rejects(w.service.downloadObject({ organizationId: "org_a", token: grant.token }), { code: "DOWNLOAD_AUTHORIZATION_NOT_FOUND" });
});

test("asset upload defaults to product_image and accepts explicit avatar_image without changing checksum verification", async () => {
  const w = world();
  const product = await w.service.createUploadAuthorization({
    organizationId: "org_kind", actorMemberId: "member_kind", idempotencyKey: "product-default",
    filename: "product.png", contentType: "image/png", size: PNG.length, checksumSha256: SHA256
  });
  assert.equal(product.asset.kind, "product_image");

  const avatar = await w.service.createUploadAuthorization({
    organizationId: "org_kind", actorMemberId: "member_kind", idempotencyKey: "avatar-kind",
    filename: "avatar.png", contentType: "image/png", size: PNG.length, checksumSha256: SHA256,
    assetKind: "avatar_image"
  });
  assert.equal(avatar.asset.kind, "avatar_image");
  await w.service.uploadObject({ organizationId: "org_kind", uploadToken: avatar.upload.token, body: PNG, contentType: "image/png" });
  await w.service.completeUpload({ organizationId: "org_kind", uploadSessionId: avatar.upload_session_id, idempotencyKey: "avatar-complete" });
  await w.service.runNextVerificationJob();
  assert.equal((await w.service.getAssetVersion({ organizationId: "org_kind", assetVersionId: avatar.asset_version.id })).status, "available");

  await assert.rejects(
    () => w.service.createUploadAuthorization({
      organizationId: "org_kind", actorMemberId: "member_kind", assetId: avatar.asset.id, idempotencyKey: "avatar-as-product",
      filename: "new.png", contentType: "image/png", size: PNG.length, checksumSha256: SHA256
    }),
    { code: "ASSET_KIND_CONFLICT" }
  );
  await assert.rejects(
    () => w.service.createUploadAuthorization({
      organizationId: "org_kind", actorMemberId: "member_kind", assetKind: "unsupported_image", idempotencyKey: "unsupported-kind",
      filename: "unsupported.png", contentType: "image/png", size: PNG.length, checksumSha256: SHA256
    }),
    { code: "ASSET_KIND_NOT_ALLOWED" }
  );
});

for (const scenario of [
  ["missing object", async (w, created) => w.objectStore.remove(created.object_key), "OBJECT_MISSING"],
  ["real file type mismatch", async (w, created) => w.objectStore.replace(created.object_key, Buffer.from("not an image")), "FILE_TYPE_MISMATCH"],
  ["size mismatch", async (w, created) => w.objectStore.replace(created.object_key, Buffer.concat([PNG, Buffer.from("x")])), "SIZE_MISMATCH"],
  ["checksum mismatch", async (w, created) => w.objectStore.replace(created.object_key, Buffer.from(PNG).fill(1, 20, 21)), "CHECKSUM_MISMATCH"],
  ["ownership mismatch", async (w, created) => w.objectStore.setMetadata(created.object_key, { organizationId: "org_b" }), "OWNERSHIP_MISMATCH"]
]) {
  test(`verification fails when ${scenario[0]}`, async () => {
    const w = world();
    const created = await uploaded(w);
    await w.service.completeUpload({ organizationId: "org_a", uploadSessionId: created.upload_session_id, idempotencyKey: "complete-1" });
    await scenario[1](w, created);
    await w.service.runNextVerificationJob();
    const version = await w.service.getAssetVersion({ organizationId: "org_a", assetVersionId: created.asset_version.id });
    assert.equal(version.status, "verification_failed");
    assert.equal(version.failure_code, scenario[2]);
  });
}

test("duplicate completion is replayed, conflicting reuse is rejected, and concurrency creates one job", async () => {
  const w = world();
  const created = await uploaded(w);
  const request = { organizationId: "org_a", uploadSessionId: created.upload_session_id, idempotencyKey: "complete-1" };
  const results = await Promise.all([w.service.completeUpload(request), w.service.completeUpload(request)]);
  assert.deepEqual(results[0], results[1]);
  assert.equal((await w.repository.listPendingVerificationJobs()).length, 1);
  await assert.rejects(w.service.completeUpload({ ...request, uploadSessionId: "different" }), { code: "IDEMPOTENCY_CONFLICT" });
});

test("organization isolation and client ownership fields cannot change ownership", async () => {
  const w = world();
  const created = await w.service.createUploadAuthorization({
    organizationId: "org_a", actorMemberId: "member_a", idempotencyKey: "ownership-upload", clientOrganizationId: "org_b", filename: "product.png", contentType: "image/png", size: PNG.length, checksumSha256: SHA256
  });
  assert.equal(created.asset.organization_id, "org_a");
  await assert.rejects(w.service.getAssetVersion({ organizationId: "org_b", assetVersionId: created.asset_version.id }), { code: "ASSET_VERSION_NOT_FOUND" });
  await assert.rejects(w.service.completeUpload({ organizationId: "org_b", uploadSessionId: created.upload_session_id, idempotencyKey: "x" }), { code: "UPLOAD_SESSION_NOT_FOUND" });
});

test("asset optimistic conflicts are visible; referenced delete is blocked while disable is allowed", async () => {
  const w = world();
  const created = await uploaded(w);
  await w.service.completeUpload({ organizationId: "org_a", uploadSessionId: created.upload_session_id, idempotencyKey: "complete-1" });
  await w.service.runNextVerificationJob();
  await w.service.assetReferencePort.bindAvailableVersion({
    organizationId: "org_a", assetVersionId: created.asset_version.id,
    referenceType: "product_revision", referenceId: "revision-1", role: "product_image"
  });
  await assert.rejects(w.service.deleteAsset({ organizationId: "org_a", assetId: created.asset.id, expectedRevision: 1 }), { code: "ASSET_HISTORY_REFERENCED" });
  const disabled = await w.service.disableAsset({ organizationId: "org_a", assetId: created.asset.id, expectedRevision: 1 });
  assert.equal(disabled.status, "disabled");
  await assert.rejects(w.service.disableAsset({ organizationId: "org_a", assetId: created.asset.id, expectedRevision: 1 }), { code: "ASSET_VERSION_CONFLICT" });

  const disposable = await uploaded(w);
  const deleted = await w.service.deleteAsset({ organizationId: "org_a", assetId: disposable.asset.id, expectedRevision: 1 });
  assert.equal(deleted.status, "deleted");
  await assert.rejects(
    w.service.disableAsset({ organizationId: "org_a", assetId: disposable.asset.id, expectedRevision: 2 }),
    { code: "ASSET_NOT_ACTIVE" }
  );
});

test("bindAvailableVersion is idempotent, organization-safe, and returns an immutable verification snapshot", async () => {
  const w = world();
  const created = await uploaded(w);
  await w.service.completeUpload({ organizationId: "org_a", uploadSessionId: created.upload_session_id, idempotencyKey: "complete-1" });
  await w.service.runNextVerificationJob();
  const input = { organizationId: "org_a", assetVersionId: created.asset_version.id, referenceType: "product_revision", referenceId: "rev-1", role: "product_image" };
  const first = await w.service.assetReferencePort.bindAvailableVersion(input);
  const second = await w.service.assetReferencePort.bindAvailableVersion(input);
  assert.deepEqual(second, first);
  assert.deepEqual(first.verification, { content_type: "image/png", size: PNG.length, checksum_sha256: SHA256 });
  await assert.rejects(w.service.assetReferencePort.bindAvailableVersion({ ...input, organizationId: "org_b" }), { code: "ASSET_VERSION_NOT_FOUND" });
});

test("a new service instance recovers persisted pending and verifying jobs", async () => {
  const w = world();
  const created = await uploaded(w);
  await w.service.completeUpload({ organizationId: "org_a", uploadSessionId: created.upload_session_id, idempotencyKey: "complete-1" });
  const restarted = createAssetService({ repository: w.repository, objectStore: w.objectStore });
  assert.equal(await restarted.recoverVerificationJobs(), 1);
  assert.equal((await restarted.getAssetVersion({ organizationId: "org_a", assetVersionId: created.asset_version.id })).status, "available");
});

test("local development object metadata survives an adapter restart for verification recovery", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-local-assets-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const repository = createMemoryAssetRepository();
  const firstStore = createLocalObjectStore({ root });
  await firstStore.initialize();
  const firstService = createAssetService({ repository, objectStore: firstStore });
  const created = await firstService.createUploadAuthorization({ organizationId: "org_a", actorMemberId: "member_a", idempotencyKey: "restart-upload", filename: "product.png", contentType: "image/png", size: PNG.length, checksumSha256: SHA256 });
  await firstService.uploadObject({ organizationId: "org_a", uploadToken: created.upload.token, body: PNG, contentType: "image/png" });
  await firstService.completeUpload({ organizationId: "org_a", uploadSessionId: created.upload_session_id, idempotencyKey: "restart-local" });
  const restarted = createAssetService({ repository, objectStore: createLocalObjectStore({ root }) });
  assert.equal(await restarted.recoverVerificationJobs(), 1);
  assert.equal((await restarted.getAssetVersion({ organizationId: "org_a", assetVersionId: created.asset_version.id })).status, "available");
});

test("source product image port returns exact verified bytes and enforces availability and organization isolation", async () => {
  const w = world();
  const created = await verified(w);
  const input = { organizationId: "org_a", assetVersionId: created.asset_version.id };
  const source = await w.service.sourceProductImagePort.readVerifiedProductImage(input);

  assert.deepEqual(source, {
    asset_id: created.asset.id,
    asset_version_id: created.asset_version.id,
    kind: "product_image",
    asset_status: "active",
    version_status: "available",
    bytes: PNG,
    media_type: "image/png",
    size: PNG.length,
    checksum_sha256: SHA256
  });
  await assert.rejects(
    w.service.sourceProductImagePort.readVerifiedProductImage({ ...input, organizationId: "org_b" }),
    { code: "ASSET_VERSION_NOT_FOUND" }
  );

  await w.service.disableAsset({ organizationId: "org_a", assetId: created.asset.id, expectedRevision: 1 });
  await assert.rejects(w.service.sourceProductImagePort.readVerifiedProductImage(input), { code: "ASSET_SOURCE_UNAVAILABLE" });
});

function candidateStageInput(overrides = {}) {
  return {
    organizationId: "org_a",
    candidateId: "candidate_a",
    captureRequestId: "capture_a",
    body: PNG,
    mediaType: "image/png",
    originalFilename: "../../provider-output\nContent-Disposition: attachment; filename=unsafe.png",
    ...overrides
  };
}

async function stageCandidate(w, overrides = {}) {
  return w.service.appearanceCandidateAssetPort.stageVerifiedCandidate(candidateStageInput(overrides));
}

test("appearance candidate staging verifies bytes and ignores untrusted filenames", async () => {
  const w = world({ trackPuts: true });
  const staged = await stageCandidate(w);
  const safeFilename = staged.original_filename;

  assert.match(safeFilename, /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/);
  assert.doesNotMatch(safeFilename, /[\\/\u0000-\u001f\u007f]/);
  assert.equal(staged.candidate_id, "candidate_a");
  assert.equal(staged.capture_request_id, "capture_a");
  assert.equal(staged.object_key, `org_a/appearance-candidates/candidate_a/${safeFilename}`);
  assert.equal(staged.media_type, "image/png");
  assert.equal(staged.size, PNG.length);
  assert.equal(staged.checksum_sha256, SHA256);
  assert.equal(w.putCalls.length, 1);
  assert.equal(w.putCalls[0].key, staged.object_key);
  assert.deepEqual(w.putCalls[0].body, PNG);
  assert.equal(w.putCalls[0].contentType, "image/png");
  assert.equal(w.putCalls[0].metadata.organizationId, "org_a");
  assert.equal(w.putCalls[0].metadata.candidateId, "candidate_a");
  assert.equal(w.putCalls[0].metadata.captureRequestId, "capture_a");
  assert.deepEqual(await w.objectStore.get(staged.object_key), PNG);

  const renamed = await stageCandidate(w, {
    candidateId: "candidate_b",
    captureRequestId: "capture_b",
    originalFilename: "ordinary-name.png"
  });
  assert.equal(renamed.original_filename, safeFilename);
  assert.equal(renamed.object_key, `org_a/appearance-candidates/candidate_b/${safeFilename}`);
  assert.equal(w.putCalls.length, 2);
  assert.equal(w.putCalls[1].key, renamed.object_key);
});

test("appearance candidate staging rejects untrusted or inconsistent image input before persistence", async () => {
  const cases = [
    { body: "https://provider.invalid/candidate.png", mediaType: "image/png" },
    { body: new Uint8Array(PNG), mediaType: "image/png" },
    { body: GIF, mediaType: "image/png" },
    { body: GIF, mediaType: "image/gif" },
    { body: Buffer.alloc(MAX_IMAGE_BYTES + 1), mediaType: "image/png" },
    { body: PNG, mediaType: "image/jpeg" }
  ];

  for (const [index, input] of cases.entries()) {
    const w = world({ trackPuts: true });
    await assert.rejects(
      w.service.appearanceCandidateAssetPort.stageVerifiedCandidate(candidateStageInput({
        ...input,
        candidateId: `candidate-invalid-${index}`,
        captureRequestId: `capture-invalid-${index}`
      }))
    );
    assert.equal(w.putCalls.length, 0);
    assert.deepEqual(await w.service.listAssets({ organizationId: "org_a" }), []);
  }
});

test("registering an appearance candidate creates an available internal asset hidden from generic asset APIs", async () => {
  const w = world();
  const staged = await stageCandidate(w);
  const registered = await w.service.appearanceCandidateAssetPort.registerStagedCandidate({
    organizationId: "org_a",
    actorSystemId: "cloud_executor",
    staged
  });
  const { asset, asset_version: version } = registered;

  assert.equal(asset.organization_id, "org_a");
  assert.equal(asset.kind, "appearance_candidate_image");
  assert.equal(asset.status, "active");
  assert.equal(asset.revision_number, 1);
  assert.equal(asset.display_name, staged.original_filename);
  assert.equal(version.organization_id, "org_a");
  assert.equal(version.asset_id, asset.id);
  assert.equal(version.version_number, 1);
  assert.equal(version.status, "available");
  assert.equal(version.object_key, staged.object_key);
  assert.equal(version.original_filename, staged.original_filename);
  assert.equal(version.expected_content_type, staged.media_type);
  assert.equal(version.expected_size, staged.size);
  assert.equal(version.expected_checksum_sha256, staged.checksum_sha256);
  assert.equal(version.verified_content_type, staged.media_type);
  assert.equal(version.verified_size, staged.size);
  assert.equal(version.verified_checksum_sha256, staged.checksum_sha256);
  assert.equal(version.failure_code, null);

  assert.deepEqual(await w.service.listAssets({ organizationId: "org_a" }), []);
  await assert.rejects(
    w.service.getAsset({ organizationId: "org_a", assetId: asset.id }),
    { code: "ASSET_NOT_FOUND" }
  );
  await assert.rejects(
    w.service.getAssetVersion({ organizationId: "org_a", assetVersionId: version.id }),
    { code: "ASSET_VERSION_NOT_FOUND" }
  );
  await assert.rejects(
    w.service.updateAssetMetadata({ organizationId: "org_a", assetId: asset.id, expectedRevision: 1, displayName: "改写候选" }),
    { code: "ASSET_NOT_FOUND" }
  );
  await assert.rejects(
    w.service.disableAsset({ organizationId: "org_a", assetId: asset.id, expectedRevision: 1 }),
    { code: "ASSET_NOT_FOUND" }
  );
  await assert.rejects(
    w.service.deleteAsset({ organizationId: "org_a", assetId: asset.id, expectedRevision: 1 }),
    { code: "ASSET_NOT_FOUND" }
  );
  await assert.rejects(
    w.service.createDownloadAuthorization({ organizationId: "org_a", assetVersionId: version.id }),
    { code: "ASSET_VERSION_NOT_AVAILABLE" }
  );
  assert.equal((await w.repository.getAsset("org_a", asset.id)).status, "active");
  assert.equal((await w.repository.getAssetVersion("org_a", version.id)).status, "available");
  await assert.rejects(
    w.service.createUploadAuthorization({
      organizationId: "org_a",
      actorMemberId: "member_a",
      idempotencyKey: "generic-appearance-candidate-upload",
      filename: "candidate.png",
      contentType: "image/png",
      size: PNG.length,
      checksumSha256: SHA256,
      assetKind: "appearance_candidate_image"
    })
  );
});

test("appearance candidate registration rollback removes memory asset and version rows", async () => {
  const w = world();
  const staged = await stageCandidate(w);
  const rollbacks = [];
  const registered = await w.service.appearanceCandidateAssetPort.registerStagedCandidate({
    organizationId: "org_a",
    actorSystemId: "cloud_executor",
    staged,
    transactionClient: { onRollback(callback) { rollbacks.push(callback); } }
  });

  assert.ok(rollbacks.length > 0);
  assert.equal((await w.repository.getAsset("org_a", registered.asset.id)).kind, "appearance_candidate_image");
  assert.equal((await w.repository.getAssetVersion("org_a", registered.asset_version.id)).status, "available");

  for (const rollback of rollbacks.reverse()) await rollback();
  await assert.rejects(w.service.getAsset({ organizationId: "org_a", assetId: registered.asset.id }), { code: "ASSET_NOT_FOUND" });
  await assert.rejects(w.service.getAssetVersion({ organizationId: "org_a", assetVersionId: registered.asset_version.id }), { code: "ASSET_VERSION_NOT_FOUND" });
  assert.deepEqual(await w.service.listAssets({ organizationId: "org_a" }), []);
});

test("appearance candidate download authorization returns safe metadata and exact bytes while generic download stays closed", async () => {
  const w = world();
  const staged = await stageCandidate(w);
  const registered = await w.service.appearanceCandidateAssetPort.registerStagedCandidate({
    organizationId: "org_a",
    actorSystemId: "cloud_executor",
    staged
  });
  const assetVersionId = registered.asset_version.id;
  const grant = await w.service.appearanceCandidateAssetPort.createDownloadAuthorization({
    organizationId: "org_a",
    assetVersionId
  });

  assert.equal(grant.asset_version_id, assetVersionId);
  assert.equal(grant.filename, staged.original_filename);
  assert.equal(grant.media_type, staged.media_type);
  assert.equal(grant.size, staged.size);
  assert.equal(grant.checksum_sha256, staged.checksum_sha256);
  assert.ok(grant.token);

  const downloaded = await w.service.appearanceCandidateAssetPort.downloadObject({ organizationId: "org_a", assetVersionId, token: grant.token });
  assert.deepEqual(downloaded.body, PNG);
  assert.equal(downloaded.filename, staged.original_filename);
  assert.equal(downloaded.media_type, staged.media_type);
  assert.equal(downloaded.size, staged.size);
  assert.equal(downloaded.checksum_sha256, staged.checksum_sha256);
  assert.equal(createHash("sha256").update(downloaded.body).digest("hex"), SHA256);

  await assert.rejects(w.service.appearanceCandidateAssetPort.downloadObject({
    organizationId: "org_a", assetVersionId: randomUUID(), token: grant.token
  }), { code: "DOWNLOAD_AUTHORIZATION_NOT_FOUND" });

  await assert.rejects(w.service.createDownloadAuthorization({ organizationId: "org_a", assetVersionId }));
});

test("discarding a staged appearance candidate removes its object", async () => {
  const w = world();
  const staged = await stageCandidate(w);
  assert.deepEqual(await w.objectStore.get(staged.object_key), PNG);

  await w.service.appearanceCandidateAssetPort.discardStagedCandidate({ organizationId: "org_a", staged });

  assert.equal(await w.objectStore.head(staged.object_key), null);
  assert.equal(await w.objectStore.get(staged.object_key), null);
});
