import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createAssetService } from "../src/assets/asset-service.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createPostgresAssetRepository } from "../src/assets/postgres-asset-repository.js";
import { runAssetMigrations } from "../src/assets/postgres.js";
import { createIdentityPool, runIdentityMigrations } from "../src/identity/postgres.js";
import { createPostgresIdentityRepository } from "../src/identity/postgres-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createPostgresProjectContentRepository } from "../src/project-content/postgres-project-content-repository.js";
import { createProjectContentService } from "../src/project-content/project-content-service.js";
import { runProjectContentMigrations } from "../src/project-content/postgres.js";
import { createOperatorWorkspaceService } from "../src/operator-workspace/operator-workspace-service.js";

const connectionString = process.env.PROJECT_CONTENT_TEST_DATABASE_URL;

async function insertAssetVersion(pool, organizationId, memberId, status) {
  const assetId = randomUUID();
  const versionId = randomUUID();
  const now = "2026-08-06T02:00:00.000Z";
  await pool.query(`INSERT INTO asset_assets(id,organization_id,kind,display_name,status,row_version,created_by_member_id,created_at,updated_at)
    VALUES ($1,$2,'product_image','product.png','active',1,$3,$4,$4)`, [assetId, organizationId, memberId, now]);
  await pool.query(`INSERT INTO asset_versions(id,asset_id,organization_id,version_number,status,object_key,original_filename,expected_content_type,expected_size,expected_checksum_sha256,verified_content_type,verified_size,verified_checksum_sha256,verified_at,created_at,updated_at)
    VALUES ($1,$2,$3,1,$4,$5,'product.png','image/png',42,$6,$7,$8,$9,$10,$11,$11)`, [versionId, assetId, organizationId, status, `${organizationId}/${assetId}/${versionId}`, "a".repeat(64), status === "available" ? "image/png" : null, status === "available" ? 42 : null, status === "available" ? "a".repeat(64) : null, status === "available" ? now : null, now]);
  return versionId;
}

test("clean PostgreSQL project-content migration and shared A03 transaction rollback", { skip: !connectionString }, async (t) => {
  const pool = createIdentityPool({ connectionString });
  t.after(() => pool.end());
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await runIdentityMigrations(pool);
  await runAssetMigrations(pool);
  await runProjectContentMigrations(pool);
  assert.equal((await pool.query("SELECT max(version)::integer version FROM project_content_schema_migrations")).rows[0].version, 2);

  const identityRepository = createPostgresIdentityRepository({ pool, ownsPool: false });
  const seeded = await seedInitialAdmin(identityRepository, {
    organizationId: "org_pg", organizationName: "Project Content", adminEmail: "content@example.test",
    adminDisplayName: "Content Admin", adminTempPassword: "Temporary-Content-9!"
  });
  const assetRepository = createPostgresAssetRepository({ pool });
  const assetService = createAssetService({ repository: assetRepository, objectStore: createMemoryObjectStore() });
  const repository = createPostgresProjectContentRepository({ pool });
  await repository.initialize();
  const service = createProjectContentService({ repository, assetReferencePort: assetService.assetReferencePort });
  const actor = { organizationId: "org_pg", actorMemberId: seeded.member.id };
  const project = await service.createProject({ ...actor, idempotencyKey: "pg-project", name: "计划" });
  const { product, revision } = await service.createProduct({ ...actor, projectId: project.id, idempotencyKey: "pg-product", productName: "商品" });
  const operatorWorkspace = createOperatorWorkspaceService({ projectContentService: service });
  const projection = await operatorWorkspace.getWorkspace({ ...actor, projectId: project.id, productId: product.id, stage: "product_content" });
  assert.deepEqual(projection.project, { id: project.id, name: "计划" });
  assert.deepEqual(projection.product, { id: product.id, name: "商品", current_revision_id: revision.id });
  assert.deepEqual(projection.stages[0].current_object, { type: "product_revision", id: revision.id });
  assert.equal(projection.stages[0].read_status, "ok");
  assert.equal(projection.stages[1].read_status, "not_loaded");
  assert.deepEqual(projection.stages[1].blocker_codes, []);
  await assert.rejects(
    operatorWorkspace.getWorkspace({ ...actor, projectId: project.id, productId: randomUUID(), stage: "product_content" }),
    { code: "OPERATOR_WORKSPACE_NOT_FOUND" }
  );
  await assert.rejects(
    operatorWorkspace.getWorkspace({ organizationId: "org_other", actorMemberId: actor.actorMemberId, projectId: project.id, productId: product.id, stage: "product_content" }),
    { code: "OPERATOR_WORKSPACE_NOT_FOUND" }
  );
  assert.equal(revision.physical_dimensions, null);
  assert.equal((await pool.query("SELECT physical_dimensions IS NULL is_null FROM project_content_product_revisions WHERE id=$1", [revision.id])).rows[0].is_null, true);
  const available = await insertAssetVersion(pool, actor.organizationId, actor.actorMemberId, "available");
  const unavailable = await insertAssetVersion(pool, actor.organizationId, actor.actorMemberId, "verifying");
  let draft = await service.saveRevision({ ...actor, productRevisionId: revision.id, expectedRevision: 1, productName: "商品", physicalDimensions: { height: 18, width: 12, unit: "cm", weight: { value: 250, unit: "g" } }, sellingPoints: [{ text: "卖点" }], assetVersionIds: [available, unavailable] });
  assert.deepEqual(draft.physical_dimensions, { height: 18, width: 12, unit: "cm", weight: { value: 250, unit: "g" } });
  assert.deepEqual((await pool.query("SELECT physical_dimensions FROM project_content_product_revisions WHERE id=$1", [draft.id])).rows[0].physical_dimensions, draft.physical_dimensions);
  draft = await service.saveRevision({ ...actor, productRevisionId: draft.id, expectedRevision: draft.revision_number, productName: "商品", physicalDimensions: null, sellingPoints: draft.selling_points, assetVersionIds: [available, unavailable] });
  assert.equal(draft.physical_dimensions, null);
  assert.equal((await pool.query("SELECT physical_dimensions IS NULL is_null FROM project_content_product_revisions WHERE id=$1", [draft.id])).rows[0].is_null, true);
  draft = await service.saveRevision({ ...actor, productRevisionId: draft.id, expectedRevision: draft.revision_number, productName: "商品", physicalDimensions: { height: 18, width: 12, unit: "cm", weight: { value: 250, unit: "g" } }, sellingPoints: draft.selling_points, assetVersionIds: [available, unavailable] });
  draft = await service.confirmSellingPoint({ ...actor, productRevisionId: draft.id, pointId: draft.selling_points[0].id, expectedRevision: draft.revision_number });
  await assert.rejects(service.readyRevision({ ...actor, productRevisionId: draft.id, expectedRevision: draft.revision_number, idempotencyKey: "pg-ready-fail" }), { code: "ASSET_VERSION_NOT_AVAILABLE" });
  assert.equal((await service.getRevision({ ...actor, productRevisionId: draft.id })).status, "draft");
  assert.equal((await pool.query("SELECT count(*)::integer count FROM asset_references WHERE reference_id=$1", [draft.id])).rows[0].count, 0);
  assert.equal((await pool.query("SELECT count(*)::integer count FROM project_content_idempotency_receipts WHERE receipt_key LIKE '%pg-ready-fail'" )).rows[0].count, 0);

  draft = await service.saveRevision({ ...actor, productRevisionId: draft.id, expectedRevision: draft.revision_number, productName: "商品", sellingPoints: draft.selling_points, assetVersionIds: [available] });
  const ready = await service.readyRevision({ ...actor, productRevisionId: draft.id, expectedRevision: draft.revision_number, idempotencyKey: "pg-ready-ok" });
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.physical_dimensions, { height: 18, width: 12, unit: "cm", weight: { value: 250, unit: "g" } });
  assert.equal((await pool.query("SELECT count(*)::integer count FROM asset_references WHERE reference_id=$1", [ready.id])).rows[0].count, 1);
  await assert.rejects(pool.query("UPDATE project_content_product_revisions SET product_name='覆盖' WHERE id=$1", [ready.id]), /immutable/);
  await assert.rejects(pool.query("UPDATE project_content_product_revisions SET physical_dimensions='{}'::jsonb WHERE id=$1", [ready.id]), /immutable/);
});
