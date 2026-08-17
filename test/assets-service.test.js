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

function world({ now = () => Date.parse("2026-08-06T08:00:00Z") } = {}) {
  const repository = createMemoryAssetRepository();
  const objectStore = createMemoryObjectStore();
  const service = createAssetService({ repository, objectStore, now });
  return { repository, objectStore, service };
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
