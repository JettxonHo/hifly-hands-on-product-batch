import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { runAssetMigrations } from "../src/assets/postgres.js";
import { createCopyGenerationService } from "../src/copy-generation/copy-generation-service.js";
import { createPostgresCopyGenerationRepository } from "../src/copy-generation/postgres-copy-generation-repository.js";
import { runCopyGenerationMigrations } from "../src/copy-generation/postgres.js";
import { createControlledQualityEvaluator } from "../src/copy-quality/controlled-evaluator.js";
import { createCopyQualityService } from "../src/copy-quality/copy-quality-service.js";
import { createCopyQualityWorker } from "../src/copy-quality/copy-quality-worker.js";
import { createCopyRewriteWorker } from "../src/copy-quality/copy-rewrite-worker.js";
import { createPostgresCopyQualityRepository } from "../src/copy-quality/postgres-copy-quality-repository.js";
import { runCopyQualityMigrations } from "../src/copy-quality/postgres.js";
import { createPostgresIdentityRepository } from "../src/identity/postgres-identity-repository.js";
import { createIdentityPool, runIdentityMigrations } from "../src/identity/postgres.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createPostgresProjectContentRepository } from "../src/project-content/postgres-project-content-repository.js";
import { runProjectContentMigrations } from "../src/project-content/postgres.js";
import { createProjectContentService } from "../src/project-content/project-content-service.js";

const connectionString = process.env.TEST_DATABASE_URL || process.env.IDENTITY_TEST_DATABASE_URL;

function isolatedUrl(value, schema) {
  const url = new URL(value);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
}

test("clean isolated PostgreSQL quality migration preserves immutable results and append-only resolutions", { skip: !connectionString }, async (t) => {
  const schema = `copy_quality_${randomUUID().replaceAll("-", "")}`;
  const adminPool = createIdentityPool({ connectionString });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = createIdentityPool({ connectionString: isolatedUrl(connectionString, schema) });
  t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`); await adminPool.end(); });
  await runIdentityMigrations(pool); await runAssetMigrations(pool); await runProjectContentMigrations(pool);
  await runCopyGenerationMigrations(pool); await runCopyQualityMigrations(pool);
  assert.equal((await pool.query("SELECT max(version)::integer version FROM copy_quality_schema_migrations")).rows[0].version, 1);

  const seeded = await seedInitialAdmin(createPostgresIdentityRepository({ pool, ownsPool: false }), {
    organizationId: "org_quality_pg", organizationName: "Quality PG", adminEmail: "quality@example.test",
    adminDisplayName: "Quality Admin", adminTempPassword: "Temporary-Quality-9!"
  });
  const actor = { organizationId: "org_quality_pg", actorMemberId: seeded.member.id };
  const at = new Date().toISOString();
  const assetId = "d554b848-871d-4805-8d34-d8e322f94127", versionId = "1b236ad2-f7f9-4573-8cee-8904ea7b3750";
  await pool.query(`INSERT INTO asset_assets(id,organization_id,kind,display_name,status,row_version,created_by_member_id,created_at,updated_at)
    VALUES ($1,$2,'product_image','product.png','active',1,$3,$4,$4)`, [assetId,actor.organizationId,seeded.member.id,at]);
  await pool.query(`INSERT INTO asset_versions(id,asset_id,organization_id,version_number,status,object_key,original_filename,expected_content_type,expected_size,expected_checksum_sha256,verified_content_type,verified_size,verified_checksum_sha256,verified_at,created_at,updated_at)
    VALUES ($1,$2,$3,1,'available',$4,'product.png','image/png',42,$5,'image/png',42,$5,$6,$6,$6)`, [versionId,assetId,actor.organizationId,`${actor.organizationId}/${assetId}/${versionId}`,"a".repeat(64),at]);
  const projectRepository = createPostgresProjectContentRepository({ pool });
  const projectService = createProjectContentService({ repository: projectRepository, assetReferencePort: {
    async bindAvailableVersion({ organizationId, assetVersionId, referenceId, role }) {
      const row = (await pool.query("SELECT * FROM asset_versions WHERE organization_id=$1 AND id=$2 AND status='available'", [organizationId,assetVersionId])).rows[0];
      if (!row) throw Object.assign(new Error("ASSET_VERSION_NOT_AVAILABLE"), { code: "ASSET_VERSION_NOT_AVAILABLE" });
      await pool.query("INSERT INTO asset_references(id,organization_id,asset_id,asset_version_id,reference_type,reference_id,role,created_at) VALUES ($1,$2,$3,$4,'product_revision',$5,$6,$7)", [randomUUID(),organizationId,row.asset_id,assetVersionId,referenceId,role,at]);
      return { reference: row };
    }
  } });
  const project = await projectService.createProject({ ...actor, idempotencyKey: "quality-pg-project", name: "质检项目" });
  const created = await projectService.createProduct({ ...actor, projectId: project.id, idempotencyKey: "quality-pg-product", productName: "云朵抱枕" });
  let revision = await projectService.saveRevision({ ...actor, productRevisionId: created.revision.id, expectedRevision: 1, productName: "云朵抱枕", sellingPoints: [{ text: "柔软亲肤" }], assetVersionIds: [versionId] });
  revision = await projectService.confirmSellingPoint({ ...actor, productRevisionId: revision.id, pointId: revision.selling_points[0].id, expectedRevision: revision.revision_number });
  revision = await projectService.readyRevision({ ...actor, productRevisionId: revision.id, expectedRevision: revision.revision_number, idempotencyKey: "quality-pg-ready" });

  const copyService = createCopyGenerationService({ repository: createPostgresCopyGenerationRepository({ pool }), productRevisionPort: projectService.productRevisionPort });
  await copyService.requestGeneration({ ...actor, productRevisionId: revision.id, intent: "product_recommendation", idempotencyKey: "quality-pg-copy" });
  const copyJob = await copyService.claimNextGenerationJob();
  const copy = await copyService.completeGenerationJob({ job: copyJob, body: "云朵抱枕，柔软亲肤。" });
  const repository = createPostgresCopyQualityRepository({ pool });
  await repository.initialize();
  let policy = { profileVersion: "commerce-cn-v1", ruleVersion: "rules-2026-08" };
  const service = createCopyQualityService({ repository, copyService,
    profileResolver: { async resolve() { return { ...policy }; } } });
  const worker = createCopyQualityWorker({ service, evaluator: createControlledQualityEvaluator({ async evaluate() { return { checks_complete: true, findings: [{
    code: "TONE_REVIEW", kind: "review", severity: "medium", title: "语气待判断", matched_text: "全网最好",
    message: "请人工判断", evidence_reference: "copy:text:12-16", rule_source: "brand_policy",
    suggestion: "改为有事实依据的体验描述"
  }] }; } }) });
  const [first, duplicate] = await Promise.all([
    service.startQualityCheck({ ...actor, copyVersionId: copy.id, expectedRevision: copy.row_version, profileVersion: "commerce-cn-v1", ruleVersion: "rules-2026-08", idempotencyKey: "quality-pg-1" }),
    service.startQualityCheck({ ...actor, copyVersionId: copy.id, expectedRevision: copy.row_version, profileVersion: "commerce-cn-v1", ruleVersion: "rules-2026-08", idempotencyKey: "quality-pg-2" })
  ]);
  assert.equal(first.quality_run.id, duplicate.quality_run.id);
  policy = { profileVersion: "commerce-cn-v2", ruleVersion: "rules-2026-09" };
  await worker.runNext();
  const policyFailed = await service.getQualityRun({ ...actor, qualityRunId: first.quality_run.id });
  assert.equal(policyFailed.quality_run.failure_code, "COPY_QUALITY_POLICY_CHANGED");
  assert.equal(policyFailed.quality_result, null);
  const retried = await service.retryQualityCheck({ ...actor, qualityRunId: first.quality_run.id,
    idempotencyKey: "quality-pg-policy-retry" });
  assert.equal(retried.quality_run.profile_version, "commerce-cn-v2");
  assert.equal(retried.quality_run.rule_version, "rules-2026-09");
  await worker.runNext();
  const details = await service.getQualityRun({ ...actor, qualityRunId: retried.quality_run.id });
  assert.equal(details.quality_findings[0].severity, "medium");
  assert.equal(details.quality_findings[0].matched_text, "全网最好");
  assert.equal(details.quality_findings[0].evidence_reference, "copy:text:12-16");
  assert.equal(details.quality_findings[0].rule_source, "brand_policy");
  assert.equal(details.quality_findings[0].suggestion, "改为有事实依据的体验描述");
  const accepted = await service.resolveFinding({ ...actor, findingId: details.quality_findings[0].id, resolution: "accepted_with_reason", reason: "品牌可接受", idempotencyKey: "quality-pg-resolution" });
  assert.equal((await pool.query("SELECT count(*)::integer count FROM copy_quality_finding_resolutions")).rows[0].count, 1);
  const rewriteRequest = { ...actor, copyVersionId: copy.id, findingId: details.quality_findings[0].id,
    scope: "matched_text", instruction: "保留卖点并修正语气", idempotencyKey: "quality-pg-rewrite" };
  const [rewrite, replay] = await Promise.all([
    service.requestCopyRewrite(rewriteRequest), service.requestCopyRewrite(rewriteRequest)
  ]);
  assert.equal(rewrite.rewrite_job.id, replay.rewrite_job.id);
  assert.equal((await pool.query("SELECT count(*)::integer count FROM copy_rewrite_jobs")).rows[0].count, 1);
  const rewriteWorker = createCopyRewriteWorker({ service, rewriter: {
    async rewrite() { return { body: "云朵抱枕，柔软亲肤，已按质检建议完整改写。" }; }
  } });
  await Promise.all([rewriteWorker.runNext(), rewriteWorker.runNext()]);
  const rewriteDetails = await service.getRewriteJob({ ...actor, rewriteJobId: rewrite.rewrite_job.id });
  assert.equal(rewriteDetails.rewrite_job.status, "succeeded");
  assert.equal(rewriteDetails.quality_run.status, "queued");
  assert.equal((await pool.query("SELECT count(*)::integer count FROM copy_versions")).rows[0].count, 2);
  await assert.rejects(pool.query("UPDATE copy_quality_results SET conclusion='passed' WHERE id=$1", [details.quality_result.id]), /immutable/);
  await assert.rejects(pool.query("UPDATE copy_quality_findings SET title='覆盖原始记录' WHERE id=$1", [details.quality_findings[0].id]), /immutable/);
  await assert.rejects(pool.query("UPDATE copy_quality_finding_resolutions SET reason='覆盖处理记录' WHERE id=$1", [accepted.resolution.id]), /immutable/);
  await assert.rejects(pool.query("DELETE FROM copy_quality_finding_resolutions WHERE id=$1", [accepted.resolution.id]), /immutable/);
  const child = await projectService.saveRevision({ ...actor, productRevisionId: revision.id,
    expectedRevision: revision.revision_number, productName: "云朵抱枕待确认事实",
    sellingPoints: revision.selling_points, assetVersionIds: revision.asset_version_ids });
  assert.equal(child.status, "draft");
  const invalidated = await service.getQualityRun({ ...actor, qualityRunId: retried.quality_run.id });
  assert.equal(invalidated.quality_result.conclusion, "needs_review");
  assert.equal(invalidated.quality_result.current_valid, false);
  assert.equal(invalidated.quality_result.invalidation_reason, "product_revision_changed");
});
