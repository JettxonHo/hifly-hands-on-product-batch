import assert from "node:assert/strict";
import test from "node:test";

import { createAssetService } from "../src/assets/asset-service.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { runAssetMigrations } from "../src/assets/postgres.js";
import { createPostgresAssetRepository } from "../src/assets/postgres-asset-repository.js";
import { createCopyGenerationService } from "../src/copy-generation/copy-generation-service.js";
import { createPostgresCopyGenerationRepository } from "../src/copy-generation/postgres-copy-generation-repository.js";
import { runCopyGenerationMigrations } from "../src/copy-generation/postgres.js";
import { createPostgresIdentityRepository } from "../src/identity/postgres-identity-repository.js";
import { createIdentityPool, runIdentityMigrations } from "../src/identity/postgres.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createPostgresProjectContentRepository } from "../src/project-content/postgres-project-content-repository.js";
import { runProjectContentMigrations } from "../src/project-content/postgres.js";
import { createProjectContentService } from "../src/project-content/project-content-service.js";

const connectionString = process.env.TEST_DATABASE_URL || process.env.IDENTITY_TEST_DATABASE_URL;

async function availableProductRevision(pool, memberId) {
  const assetRepository = createPostgresAssetRepository({ pool });
  const assetService = createAssetService({ repository: assetRepository, objectStore: createMemoryObjectStore() });
  const projectRepository = createPostgresProjectContentRepository({ pool });
  const projectService = createProjectContentService({ repository: projectRepository, assetReferencePort: assetService.assetReferencePort });
  const actor = { organizationId: "org_copy_pg", actorMemberId: memberId };
  const project = await projectService.createProject({ ...actor, idempotencyKey: "copy-pg-project", name: "文案项目" });
  const created = await projectService.createProduct({ ...actor, projectId: project.id, idempotencyKey: "copy-pg-product", productName: "云朵抱枕" });
  const now = new Date().toISOString();
  const assetId = "71dc540c-19a4-4c52-87a2-a43879e67511", versionId = "8312565f-f18f-4892-866b-41d004b6fe12";
  await pool.query(`INSERT INTO asset_assets(id,organization_id,kind,display_name,status,row_version,created_by_member_id,created_at,updated_at)
    VALUES ($1,$2,'product_image','product.png','active',1,$3,$4,$4)`, [assetId, actor.organizationId, memberId, now]);
  await pool.query(`INSERT INTO asset_versions(id,asset_id,organization_id,version_number,status,object_key,original_filename,expected_content_type,expected_size,expected_checksum_sha256,verified_content_type,verified_size,verified_checksum_sha256,verified_at,created_at,updated_at)
    VALUES ($1,$2,$3,1,'available',$4,'product.png','image/png',42,$5,'image/png',42,$5,$6,$6,$6)`, [versionId, assetId, actor.organizationId, `${actor.organizationId}/${assetId}/${versionId}`, "a".repeat(64), now]);
  let draft = await projectService.saveRevision({ ...actor, productRevisionId: created.revision.id, expectedRevision: 1, productName: "云朵抱枕", sellingPoints: [{ text: "柔软亲肤" }], assetVersionIds: [versionId] });
  draft = await projectService.confirmSellingPoint({ ...actor, productRevisionId: draft.id, pointId: draft.selling_points[0].id, expectedRevision: draft.revision_number });
  const ready = await projectService.readyRevision({ ...actor, productRevisionId: draft.id, expectedRevision: draft.revision_number, idempotencyKey: "copy-pg-ready" });
  return { actor, ready, productRevisionPort: projectService.productRevisionPort };
}

test("clean PostgreSQL copy migration preserves jobs, lease recovery, and frozen copy history", { skip: !connectionString }, async (t) => {
  const pool = createIdentityPool({ connectionString });
  t.after(() => pool.end());
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await runIdentityMigrations(pool);
  await runAssetMigrations(pool);
  await runProjectContentMigrations(pool);
  await runCopyGenerationMigrations(pool);
  assert.equal((await pool.query("SELECT max(version)::integer version FROM copy_generation_schema_migrations")).rows[0].version, 1);

  const identityRepository = createPostgresIdentityRepository({ pool, ownsPool: false });
  const seeded = await seedInitialAdmin(identityRepository, {
    organizationId: "org_copy_pg", organizationName: "Copy PG", adminEmail: "copy@example.test",
    adminDisplayName: "Copy Admin", adminTempPassword: "Temporary-Copy-9!"
  });
  const input = await availableProductRevision(pool, seeded.member.id);
  let clock = Date.parse("2026-08-06T12:00:00.000Z");
  const repository = createPostgresCopyGenerationRepository({ pool });
  await repository.initialize();
  const service = createCopyGenerationService({ repository, productRevisionPort: input.productRevisionPort, now: () => clock });
  const requested = await service.requestGeneration({ ...input.actor, productRevisionId: input.ready.id, intent: "product_recommendation", idempotencyKey: "copy-pg-generate" });
  const stale = await service.claimNextGenerationJob({ leaseMs: 1000 });
  clock += 1100;
  const recovered = await service.claimNextGenerationJob({ leaseMs: 1000 });
  assert.equal(recovered.id, stale.id);
  assert.equal(recovered.attempts, 2);
  await assert.rejects(service.completeGenerationJob({ job: stale, body: "迟到结果" }), { code: "COPY_GENERATION_LEASE_LOST" });
  const copy = await service.completeGenerationJob({ job: recovered, body: "云朵抱枕，柔软亲肤。" });
  assert.equal((await service.getGenerationJob({ ...input.actor, jobId: requested.job.id })).status, "succeeded");
  const frozen = await service.freezeCopyVersion({ ...input.actor, copyVersionId: copy.id, expectedRevision: copy.row_version, idempotencyKey: "copy-pg-freeze" });
  await assert.rejects(pool.query("UPDATE copy_versions SET body='覆盖冻结正文' WHERE id=$1", [frozen.id]), /immutable/);
});
