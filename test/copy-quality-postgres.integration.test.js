import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
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
  assert.equal((await pool.query("SELECT max(version)::integer version FROM copy_quality_schema_migrations")).rows[0].version, 2);

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
    qualityMaxAttempts: 3, rewriteMaxAttempts: 3, attemptPolicy: "legacy",
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

  const strictAt = "2000-01-01T00:00:00.000Z";
  const legacyHistoricalId = randomUUID();
  await pool.query(`INSERT INTO copy_quality_runs(id,organization_id,copy_version_id,product_revision_id,profile_version,rule_version,input_snapshot,status,attempts,max_attempts,quality_result_id,failure_code,lease_token,started_at,heartbeat_at,lease_expires_at,completed_at,created_at,updated_at)
    VALUES ($1,$2,$3,$4,'legacy-profile','legacy-rules',$5,'failed',1,3,NULL,'QUALITY_EVALUATION_FAILED',NULL,NULL,NULL,NULL,$6,$6,$6)`,
  [legacyHistoricalId, actor.organizationId, copy.id, revision.id, JSON.stringify({ copy_version: copy, product_revision: revision }), strictAt]);
  const legacyHistorical = await repository.getRun(actor.organizationId, legacyHistoricalId);
  assert.equal(legacyHistorical.attempt_policy, "legacy");
  assert.equal(legacyHistorical.provider_dispatch_count, null);
  assert.equal(legacyHistorical.provider_http_request_count, null);
  const strictRun = {
    id: randomUUID(), organization_id: actor.organizationId, copy_version_id: copy.id,
    product_revision_id: revision.id, profile_version: "strict-profile", rule_version: "strict-rules",
    input_snapshot: { copy_version: copy, product_revision: revision }, status: "queued", attempts: 0,
    max_attempts: 1, attempt_policy: "provider_at_most_once_v1", quality_result_id: null,
    failure_code: null, lease_token: null, started_at: null, heartbeat_at: null, lease_expires_at: null,
    completed_at: null, created_at: strictAt, updated_at: strictAt, provider_name: null, provider_kind: null,
    provider_model: null, provider_dispatch_count: 0, provider_http_request_count: 0, provider_request_state: "not_started",
    provider_request_outcome: null, provider_dispatch_reserved_at: null, provider_request_started_at: null, provider_request_completed_at: null,
    provider_usage_status: "not_applicable", provider_input_tokens: null, provider_output_tokens: null,
    provider_total_tokens: null, provider_charge_status: "not_applicable", provider_charge_amount: null,
    provider_charge_currency: null, provider_local_cost_status: "not_calculated", provider_local_cost_amount: null,
    provider_local_cost_currency: null
  };
  await assert.rejects(repository.createRun({ receiptKey: "quality-pg-strict-over-legacy", fingerprint: "strict-over-legacy",
    run: { ...strictRun, id: randomUUID(), copy_version_id: rewriteDetails.copy_version.id },
    audit: { id: randomUUID(), organization_id: actor.organizationId, event_type: "copy.quality_requested",
      copy_version_id: rewriteDetails.copy_version.id, quality_run_id: strictRun.id, created_at: strictAt } }),
  { code: "QUALITY_ONE_ATTEMPT_LEGACY_RUN_ACTIVE" });
  const [strictCreated, strictDuplicate] = await Promise.all([
    repository.createRun({ receiptKey: "quality-pg-strict-1", fingerprint: "strict-1", run: strictRun,
      audit: { id: randomUUID(), organization_id: actor.organizationId, event_type: "copy.quality_requested",
        copy_version_id: copy.id, quality_run_id: strictRun.id, created_at: strictAt } }),
    repository.createRun({ receiptKey: "quality-pg-strict-2", fingerprint: "strict-2", run: { ...strictRun, id: randomUUID(), created_at: strictAt },
      audit: { id: randomUUID(), organization_id: actor.organizationId, event_type: "copy.quality_requested",
        copy_version_id: copy.id, quality_run_id: strictRun.id, created_at: strictAt } })
  ]);
  assert.equal(strictDuplicate.id, strictCreated.id);
  assert.equal((await repository.getRun(actor.organizationId, strictCreated.id)).created_at, strictAt);
  const strictLease = await repository.claimNextRun({ now: strictAt, leaseExpiresAt: new Date(Date.parse(strictAt) + 1_000).toISOString(), leaseToken: randomUUID() });
  await repository.beginProviderRequest({ runId: strictLease.id, leaseToken: strictLease.lease_token,
    providerName: "DeepSeek", providerKind: "deepseek_hybrid", model: "deepseek-v4-flash", now: strictAt });
  await repository.markProviderHttpRequestStarted({ runId: strictLease.id, leaseToken: strictLease.lease_token, now: strictAt });
  await assert.rejects(pool.query("UPDATE copy_quality_runs SET provider_http_request_count=2 WHERE id=$1", [strictLease.id]), /copy_quality_provider_(request_count|http_not_over_dispatch)_ck/);
  await repository.recordProviderResponse({ runId: strictLease.id, leaseToken: strictLease.lease_token,
    outcome: "unknown", usage: { status: "unknown", inputTokens: null, outputTokens: null, totalTokens: null },
    charge: { status: "unknown", amount: null, currency: null }, now: strictAt });
  await assert.rejects(repository.completeRun({ runId: strictLease.id, leaseToken: strictLease.lease_token,
    result: { id: randomUUID(), organization_id: actor.organizationId, quality_run_id: strictLease.id,
      copy_version_id: copy.id, profile_version: "strict-profile", rule_version: "strict-rules", conclusion: "passed", created_at: strictAt },
    findingRows: [], audit: { id: randomUUID(), organization_id: actor.organizationId, event_type: "copy.quality_succeeded",
      copy_version_id: copy.id, quality_run_id: strictLease.id, created_at: strictAt }, now: strictAt }),
  { code: "QUALITY_PROVIDER_RESPONSE_NOT_READY" });
  const expiredAt = new Date(Date.parse(strictAt) + 2_000).toISOString();
  const reclaimed = await repository.claimNextRun({ now: expiredAt, leaseExpiresAt: new Date(Date.parse(expiredAt) + 1_000).toISOString(), leaseToken: randomUUID() });
  assert.notEqual(reclaimed?.id, strictLease.id);
  const strictFinal = await repository.getRun(actor.organizationId, strictLease.id);
  assert.equal(strictFinal.status, "failed");
  assert.equal(strictFinal.failure_code, "QUALITY_PROVIDER_OUTCOME_UNKNOWN");
  assert.equal(strictFinal.provider_http_request_count, 1);
  assert.equal(strictFinal.provider_dispatch_count, 1);
  assert.equal(strictFinal.provider_usage_status, "unknown");
  assert.equal(strictFinal.provider_charge_status, "unknown");
});

test("copy quality migration closes pre-upgrade active legacy runs without inventing counts", { skip: !connectionString }, async (t) => {
  const schema = `copy_quality_upgrade_${randomUUID().replaceAll("-", "")}`;
  const adminPool = createIdentityPool({ connectionString });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = createIdentityPool({ connectionString: isolatedUrl(connectionString, schema) });
  t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`); await adminPool.end(); });
  await runIdentityMigrations(pool); await runAssetMigrations(pool); await runProjectContentMigrations(pool); await runCopyGenerationMigrations(pool);
  await pool.query("CREATE TABLE copy_quality_schema_migrations (version integer PRIMARY KEY, name text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  await pool.query(await readFile(new URL("../src/copy-quality/migrations/001_vsa_a05_copy_quality.sql", import.meta.url), "utf8"));
  await pool.query("INSERT INTO copy_quality_schema_migrations(version,name) VALUES (1,'001_vsa_a05_copy_quality.sql')");

  const seeded = await seedInitialAdmin(createPostgresIdentityRepository({ pool, ownsPool: false }), {
    organizationId: "org_quality_upgrade", organizationName: "Quality Upgrade", adminEmail: "quality-upgrade@example.test",
    adminDisplayName: "Quality Upgrade Admin", adminTempPassword: "Temporary-Quality-Upgrade-9!"
  });
  const organizationId = "org_quality_upgrade", memberId = seeded.member.id;
  const projectId = randomUUID(), productId = randomUUID(), revisionId = randomUUID(), copyId = randomUUID();
  const at = "2000-01-01T00:00:00.000Z";
  await pool.query(`INSERT INTO project_content_projects(id,organization_id,name,description,delivery_date,created_by_member_id,created_at,updated_at)
    VALUES ($1,$2,'升级项目',NULL,NULL,$3,$4,$4)`, [projectId, organizationId, memberId, at]);
  await pool.query(`INSERT INTO project_content_products(id,organization_id,project_id,current_revision_id,created_by_member_id,created_at,updated_at)
    VALUES ($1,$2,$3,NULL,$4,$5,$5)`, [productId, organizationId, projectId, memberId, at]);
  await pool.query(`INSERT INTO project_content_product_revisions(id,organization_id,project_id,product_id,status,revision_number,product_name,product_description,primary_category,content_brief,asset_version_ids,selling_points,parent_revision_id,created_by_member_id,created_at,updated_at,ready_at)
    VALUES ($1,$2,$3,$4,'ready',1,'升级商品',NULL,'general',NULL,'[]'::jsonb,$5::jsonb,NULL,$6,$7,$7,$7)`,
  [revisionId, organizationId, projectId, productId, JSON.stringify([{ text: "卖点", confirmed: true }]), memberId, at]);
  await pool.query("UPDATE project_content_products SET current_revision_id=$2 WHERE id=$1", [productId, revisionId]);
  await pool.query(`INSERT INTO copy_versions(id,organization_id,project_id,product_id,product_revision_id,generation_job_id,intent,status,version_number,row_version,body,parent_copy_version_id,created_by_member_id,created_at,updated_at,frozen_at)
    VALUES ($1,$2,$3,$4,$5,NULL,'product_recommendation','frozen',1,2,'升级文案',NULL,$6,$7,$7,$7)`,
  [copyId, organizationId, projectId, productId, revisionId, memberId, at]);
  const inputSnapshot = JSON.stringify({ copy_version: { id: copyId, body: "升级文案" }, product_revision: { id: revisionId, product_name: "升级商品" } });
  const runningId = randomUUID(), queuedId = randomUUID();
  await pool.query(`INSERT INTO copy_quality_runs(id,organization_id,copy_version_id,product_revision_id,profile_version,rule_version,input_snapshot,status,attempts,max_attempts,quality_result_id,failure_code,lease_token,started_at,heartbeat_at,lease_expires_at,completed_at,created_at,updated_at)
    VALUES ($1,$2,$3,$4,'legacy-profile','legacy-rules',$5,'running',1,3,NULL,NULL,$6,$7,$7,$7,NULL,$7,$7)`,
  [runningId, organizationId, copyId, revisionId, inputSnapshot, randomUUID(), at]);
  await pool.query(`INSERT INTO copy_quality_runs(id,organization_id,copy_version_id,product_revision_id,profile_version,rule_version,input_snapshot,status,attempts,max_attempts,quality_result_id,failure_code,lease_token,started_at,heartbeat_at,lease_expires_at,completed_at,created_at,updated_at)
    VALUES ($1,$2,$3,$4,'legacy-profile-queued','legacy-rules-queued',$5,'queued',0,3,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$6,$6)`,
  [queuedId, organizationId, copyId, revisionId, inputSnapshot, at]);

  await runCopyQualityMigrations(pool);
  const repository = createPostgresCopyQualityRepository({ pool });
  await repository.initialize();
  const running = await repository.getRun(organizationId, runningId);
  const queued = await repository.getRun(organizationId, queuedId);
  assert.equal(running.status, "failed");
  assert.equal(running.failure_code, "QUALITY_PROVIDER_OUTCOME_UNKNOWN");
  assert.equal(running.provider_request_state, "unknown");
  assert.equal(running.provider_request_outcome, "unknown");
  assert.equal(running.provider_dispatch_count, null);
  assert.equal(running.provider_http_request_count, null);
  assert.equal(queued.status, "failed");
  assert.equal(queued.failure_code, "QUALITY_ONE_ATTEMPT_NOT_DISPATCHED");
  assert.equal(queued.provider_request_state, "terminal");
  assert.equal(queued.provider_request_outcome, "not_dispatched");
  assert.equal(queued.provider_dispatch_count, null);
  assert.equal(queued.provider_http_request_count, null);
  await assert.rejects(repository.createRun({ receiptKey: "upgrade-strict-after-unknown", fingerprint: "upgrade-strict-after-unknown", run: {
    id: randomUUID(), organization_id: organizationId, copy_version_id: copyId, product_revision_id: revisionId,
    profile_version: "strict-profile", rule_version: "strict-rules", input_snapshot: { copy_version: { id: copyId } },
    status: "queued", attempts: 0, max_attempts: 1, attempt_policy: "provider_at_most_once_v1",
    provider_dispatch_count: 0, provider_http_request_count: 0, provider_request_state: "not_started",
    provider_usage_status: "not_applicable", provider_charge_status: "not_applicable", provider_local_cost_status: "not_calculated",
    created_at: at, updated_at: at
  }, audit: { id: randomUUID(), organization_id: organizationId, event_type: "copy.quality_requested",
    copy_version_id: copyId, quality_run_id: randomUUID(), created_at: at } }),
  { code: "QUALITY_ONE_ATTEMPT_LEGACY_OUTCOME_UNKNOWN" });
});
