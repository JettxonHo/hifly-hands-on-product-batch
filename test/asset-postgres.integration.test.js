import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createAssetService } from "../src/assets/asset-service.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createPostgresAssetRepository } from "../src/assets/postgres-asset-repository.js";
import { runAssetMigrations } from "../src/assets/postgres.js";
import { createIdentityPool, runIdentityMigrations } from "../src/identity/postgres.js";
import { createPostgresIdentityRepository } from "../src/identity/postgres-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { buildApp } from "../src/server/app.js";
import { ADMIN_EMAIL, ADMIN_TEMP_PASSWORD } from "./helpers/identity-world.js";

const connectionString = process.env.IDENTITY_TEST_DATABASE_URL;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const CHECKSUM = createHash("sha256").update(PNG).digest("hex");

test("clean PostgreSQL asset migration and repository contract", { skip: !connectionString }, async (t) => {
  const pool = createIdentityPool({ connectionString });
  t.after(() => pool.end());
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await runIdentityMigrations(pool);
  assert.equal((await pool.query("SELECT max(version)::integer version FROM identity_schema_migrations")).rows[0].version, 1);
  await runAssetMigrations(pool);
  assert.equal((await pool.query("SELECT max(version)::integer version FROM identity_schema_migrations")).rows[0].version, 1);
  assert.equal((await pool.query("SELECT max(version)::integer version FROM asset_schema_migrations")).rows[0].version, 2);

  const tables = (await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'asset_%' ORDER BY tablename")).rows.map((row) => row.tablename);
  assert.deepEqual(tables, [
    "asset_assets", "asset_async_jobs", "asset_audit_events", "asset_idempotency_receipts",
    "asset_references", "asset_schema_migrations", "asset_upload_authorization_receipts", "asset_upload_sessions", "asset_versions"
  ]);

  const identityRepository = createPostgresIdentityRepository({ pool, ownsPool: false });
  const seeded = await seedInitialAdmin(identityRepository, {
    organizationId: "org_pg", organizationName: "PostgreSQL Organization", adminEmail: ADMIN_EMAIL,
    adminDisplayName: "PostgreSQL Admin", adminTempPassword: ADMIN_TEMP_PASSWORD
  });
  const repository = createPostgresAssetRepository({ pool });
  await repository.initialize();
  const objectStore = createMemoryObjectStore();
  const service = createAssetService({ repository, objectStore });
  const authorizationInput = {
    organizationId: "org_pg", actorMemberId: seeded.member.id, idempotencyKey: "pg-authorize",
    filename: "product.png", contentType: "image/png", size: PNG.length, checksumSha256: CHECKSUM
  };
  const authorizations = await Promise.all([service.createUploadAuthorization(authorizationInput), service.createUploadAuthorization(authorizationInput)]);
  const created = authorizations[0];
  assert.equal(authorizations[1].asset.id, created.asset.id);
  assert.equal(authorizations[1].asset_version.id, created.asset_version.id);
  assert.notEqual(authorizations[1].upload.token, created.upload.token);
  assert.equal((await pool.query("SELECT count(*)::integer count FROM asset_assets")).rows[0].count, 1);
  assert.equal((await pool.query("SELECT count(*)::integer count FROM asset_audit_events WHERE event_type='asset.upload_authorized'")).rows[0].count, 1);
  await assert.rejects(service.createUploadAuthorization({ ...authorizationInput, size: PNG.length + 1 }), { code: "IDEMPOTENCY_CONFLICT" });
  await service.uploadObject({ organizationId: "org_pg", uploadToken: authorizations[1].upload.token, body: PNG, contentType: "image/png" });
  const request = { organizationId: "org_pg", uploadSessionId: created.upload_session_id, idempotencyKey: "pg-complete" };
  const completed = await Promise.all([service.completeUpload(request), service.completeUpload(request)]);
  assert.deepEqual(completed[0], completed[1]);
  assert.equal((await pool.query("SELECT count(*)::integer count FROM asset_async_jobs")).rows[0].count, 1);
  await service.runNextVerificationJob();
  assert.equal((await service.getAssetVersion({ organizationId: "org_pg", assetVersionId: created.asset_version.id })).status, "available");
  const versionInput = (key) => ({ ...authorizationInput, idempotencyKey: key, assetId: created.asset.id, filename: `${key}.png` });
  const newVersions = await Promise.all([
    service.createUploadAuthorization(versionInput("pg-version-2")),
    service.createUploadAuthorization(versionInput("pg-version-3"))
  ]);
  assert.deepEqual(newVersions.map((item) => item.asset_version.version_number).sort(), [2, 3]);
  assert.equal((await pool.query("SELECT count(*)::integer count FROM asset_assets")).rows[0].count, 1);
  assert.deepEqual(
    (await service.listAssets({ organizationId: "org_pg" }))[0].versions.map((version) => version.version_number),
    [3, 2, 1]
  );
  const renamed = await service.updateAssetMetadata({
    organizationId: "org_pg", assetId: created.asset.id, expectedRevision: 1, displayName: "PostgreSQL 主图", actorMemberId: seeded.member.id
  });
  assert.equal(renamed.display_name, "PostgreSQL 主图");
  assert.equal((await pool.query("SELECT count(*)::integer count FROM asset_versions WHERE asset_id=$1", [created.asset.id])).rows[0].count, 3);

  const disposable = await service.createUploadAuthorization({
    ...authorizationInput, idempotencyKey: "pg-disposable", filename: "disposable.png"
  });
  const deleted = await service.deleteAsset({
    organizationId: "org_pg", assetId: disposable.asset.id, expectedRevision: 1, actorMemberId: seeded.member.id
  });
  assert.equal(deleted.status, "deleted");
  await assert.rejects(service.disableAsset({
    organizationId: "org_pg", assetId: disposable.asset.id, expectedRevision: 2, actorMemberId: seeded.member.id
  }), { code: "ASSET_NOT_ACTIVE" });

  const transactionClient = await pool.connect();
  try {
    await transactionClient.query("BEGIN");
    await service.assetReferencePort.bindAvailableVersion({
      organizationId: "org_pg", assetVersionId: created.asset_version.id, referenceType: "product_revision",
      referenceId: "rollback-revision", role: "product_image", transactionClient
    });
    await transactionClient.query("ROLLBACK");
  } finally {
    transactionClient.release();
  }
  assert.equal((await pool.query("SELECT count(*)::integer count FROM asset_references WHERE reference_id='rollback-revision'")).rows[0].count, 0);
  await assert.rejects(pool.query("UPDATE asset_versions SET object_key='overwritten' WHERE id=$1", [created.asset_version.id]), /immutable/);
  assert.equal((await pool.query("SELECT token_digest FROM asset_upload_sessions WHERE id=$1", [created.upload_session_id])).rows[0].token_digest === created.upload.token, false);

  const app = await buildApp({
    root: await mkdtemp(path.join(os.tmpdir(), "hifly-assets-shared-pool-")), executor: createFakeExecutor(),
    identity: { enabled: true, databaseUrl: connectionString, trustedHosts: ["app.test"], trustedOrigins: ["https://app.test"], cookieSecure: false, seed: { enabled: false } },
    assets: { enabled: true, adapter: "local", localRoot: ".local-assets", worker: { autoStart: false } }
  });
  t.after(() => app.close());
  assert.equal(typeof app.assets.assetReferencePort.bindAvailableVersion, "function");
});
