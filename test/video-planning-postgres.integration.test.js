import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { runAssetMigrations } from "../src/assets/postgres.js";
import { runAvatarSelectionMigrations } from "../src/avatar-selection/postgres.js";
import { runCopyGenerationMigrations } from "../src/copy-generation/postgres.js";
import { runCopyQualityMigrations } from "../src/copy-quality/postgres.js";
import { runCopyReviewMigrations } from "../src/copy-review/postgres.js";
import { createPostgresIdentityRepository } from "../src/identity/postgres-identity-repository.js";
import { createIdentityPool, runIdentityMigrations } from "../src/identity/postgres.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { runProjectContentMigrations } from "../src/project-content/postgres.js";
import { createPostgresVideoPlanningRepository } from "../src/video-planning/postgres-video-planning-repository.js";
import { runVideoPlanningMigrations } from "../src/video-planning/postgres.js";

const connectionString = process.env.TEST_DATABASE_URL || process.env.IDENTITY_TEST_DATABASE_URL;
const isolatedUrl = (value, schema) => { const url = new URL(value); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); };

async function holdReceiptLock(pool, receiptKey) {
  const client = await pool.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`video-receipt:${receiptKey}`]);
  return async () => {
    await client.query("COMMIT");
    client.release();
  };
}

test("clean PostgreSQL video planning migration preserves versions and serializes heads/reviews", { skip: !connectionString }, async (t) => {
  const schema = `video_planning_${randomUUID().replaceAll("-", "")}`;
  const adminPool = createIdentityPool({ connectionString }); await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = createIdentityPool({ connectionString: isolatedUrl(connectionString, schema) });
  t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`); await adminPool.end(); });
  await runIdentityMigrations(pool); await runAssetMigrations(pool); await runProjectContentMigrations(pool); await runCopyGenerationMigrations(pool);
  await runCopyQualityMigrations(pool); await runCopyReviewMigrations(pool); await runAvatarSelectionMigrations(pool);
  await runVideoPlanningMigrations(pool);
  assert.equal((await pool.query("SELECT max(version)::integer version FROM video_planning_schema_migrations")).rows[0].version, 2);

  const seeded = await seedInitialAdmin(createPostgresIdentityRepository({ pool, ownsPool: false }), {
    organizationId: "org-plan-pg", organizationName: "Plan PG", adminEmail: "plan-pg@example.test",
    adminDisplayName: "Plan Admin", adminTempPassword: "Temporary-Plan-PG-9!" });
  const ids = { project: randomUUID(), product: randomUUID() }, at = "2026-08-07T12:00:00.000Z";
  await pool.query("INSERT INTO project_content_projects(id,organization_id,name,created_by_member_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5)",
    [ids.project,"org-plan-pg","方案项目",seeded.member.id,at]);
  await pool.query("INSERT INTO project_content_products(id,organization_id,project_id,created_by_member_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5)",
    [ids.product,"org-plan-pg",ids.project,seeded.member.id,at]);

  const repository = createPostgresVideoPlanningRepository({ pool }); await repository.initialize();
  const planId = randomUUID(), plan = { id: planId, organization_id: "org-plan-pg", product_id: ids.product,
    version_number: 1, status: "draft", row_version: 1,
    upstream_snapshot: { product_revision_id: randomUUID(), copy_version_id: randomUUID(),
      avatar_selection_id: randomUUID(), avatar_asset_version_id: randomUUID() },
    capability_config_snapshot: { snapshot_version: "verified-v1", verified_capabilities: [{ code: "speech", evidence_reference: "seed:speech" }] },
    output_instructions: "竖版口播", presentation_size_code: "large", parent_plan_version_id: null, created_by_member_id: seeded.member.id,
    created_at: at, updated_at: at, frozen_at: null };
  const audit = { id: randomUUID(), organization_id: "org-plan-pg", actor_member_id: seeded.member.id,
    event_type: "video_plan.created", video_plan_version_id: planId, created_at: at };
  await repository.createPlan({ receiptKey: "pg-create", fingerprint: "same", plan, expectedHeadRevision: 0, audit });
  assert.equal((await repository.getHead("org-plan-pg", ids.product)).row_version, 1);
  assert.equal((await repository.getPlan("org-plan-pg", planId)).presentation_size_code, "large");
  await assert.rejects(repository.createPlan({ receiptKey: "pg-create", fingerprint: "different", plan,
    expectedHeadRevision: 0, audit }), { code: "IDEMPOTENCY_CONFLICT" });

  const runId = randomUUID();
  await repository.createRun({ receiptKey: "pg-run", fingerprint: "run", planId, expectedRevision: 1,
    run: { id: runId, organization_id: "org-plan-pg", video_plan_version_id: planId, status: "queued",
      input_snapshot: { upstream_snapshot: plan.upstream_snapshot, capability_config_snapshot: plan.capability_config_snapshot,
        output_instructions: plan.output_instructions, presentation_size_code: plan.presentation_size_code }, preflight_result_id: null, failure_code: null, lease_token: null,
      created_by_member_id: seeded.member.id, started_at: null, completed_at: null, created_at: at, updated_at: at },
    audit: { ...audit, id: randomUUID(), event_type: "video_plan.preflight_requested", preflight_run_id: runId } });
  assert.equal((await repository.getPlan("org-plan-pg", planId)).status, "frozen");
  const leaseToken = randomUUID();
  await repository.claimNextRun({ now: at, leaseToken });
  const resultId = randomUUID();
  await repository.completeRun({ runId, leaseToken, now: at,
    result: { id: resultId, organization_id: "org-plan-pg", video_plan_version_id: planId,
      preflight_run_id: runId, status: "warning", groups: { production_readiness: { status: "warning", checks: [] } },
      created_at: at, invalidated_at: null, invalidation_reason: null },
    audit: { ...audit, id: randomUUID(), event_type: "video_plan.preflight_completed", preflight_run_id: runId } });
  await assert.rejects(repository.saveDraft({ organizationId: "org-plan-pg", planId, expectedRevision: 2,
    outputInstructions: "不可覆盖", updatedAt: at, audit }), { code: "VIDEO_PLAN_IMMUTABLE" });

  const reviewBase = { organization_id: "org-plan-pg", video_plan_version_id: planId, status: "pending", row_version: 1,
    author_member_id: seeded.member.id, reviewer_member_id: null, review_mode: null, decision_reason: null,
    created_at: at, updated_at: at, decided_at: null, revoked_at: null, revoke_reason_code: null };
  const outcomes = await Promise.allSettled([1,2].map((index) => repository.createReview({
    receiptKey: `pg-review-${index}`, fingerprint: `review-${index}`, review: { ...reviewBase, id: randomUUID() },
    gate: { productId: ids.product, planId, expectedPlanRevision: 2,
      expectedPreflightRunId: runId, expectedPreflightResultId: resultId },
    audit: { ...audit, id: randomUUID(), event_type: "video_plan.review_submitted" } })));
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(outcomes.find((item) => item.status === "rejected").reason.code, "VIDEO_PLAN_REVIEW_ACTIVE_EXISTS");

  const pendingReview = (await repository.listReviews("org-plan-pg", planId))[0];
  const plan2 = { ...plan, id: randomUUID(), version_number: 2, status: "draft", row_version: 1,
    parent_plan_version_id: planId, output_instructions: "第二版", created_at: at, updated_at: at, frozen_at: null };
  const releaseApprove = await holdReceiptLock(pool, "pg-stale-approve");
  const staleApprove = assert.rejects(repository.transitionReview({ receiptKey: "pg-stale-approve", fingerprint: "stale-approve",
    organizationId: "org-plan-pg", reviewId: pendingReview.id, expectedRevision: 1, fromStatuses: ["pending"],
    gate: { productId: ids.product, planId, expectedPlanRevision: 2,
      expectedPreflightRunId: runId, expectedPreflightResultId: resultId },
    patch: { status: "approved", reviewer_member_id: seeded.member.id, review_mode: "self_review",
      decision_reason: null, decided_at: at, updated_at: at },
    audit: { ...audit, id: randomUUID(), event_type: "video_plan.review_approved", plan_review_id: pendingReview.id }
  }), { code: "VIDEO_PLAN_REVIEW_CONFLICT" });
  await repository.deriveDraft({ receiptKey: "pg-derive-two", fingerprint: "derive-two", sourcePlanId: planId,
    expectedHeadRevision: 1, plan: plan2,
    audit: { ...audit, id: randomUUID(), event_type: "video_plan.derived", video_plan_version_id: plan2.id } });
  await releaseApprove();
  await staleApprove;
  assert.equal((await repository.getReview("org-plan-pg", pendingReview.id)).status, "pending");

  const run2Id = randomUUID();
  await repository.createRun({ receiptKey: "pg-run-two", fingerprint: "run-two", planId: plan2.id, expectedRevision: 1,
    run: { id: run2Id, organization_id: "org-plan-pg", video_plan_version_id: plan2.id, status: "queued",
      input_snapshot: { upstream_snapshot: plan2.upstream_snapshot, capability_config_snapshot: plan2.capability_config_snapshot,
        output_instructions: plan2.output_instructions, presentation_size_code: plan2.presentation_size_code },
      preflight_result_id: null, failure_code: null, lease_token: null, created_by_member_id: seeded.member.id,
      started_at: null, completed_at: null, created_at: at, updated_at: at },
    audit: { ...audit, id: randomUUID(), event_type: "video_plan.preflight_requested", video_plan_version_id: plan2.id,
      preflight_run_id: run2Id } });
  const lease2 = randomUUID();
  await repository.claimNextRun({ now: at, leaseToken: lease2 });
  const result2Id = randomUUID();
  await repository.completeRun({ runId: run2Id, leaseToken: lease2, now: at,
    result: { id: result2Id, organization_id: "org-plan-pg", video_plan_version_id: plan2.id,
      preflight_run_id: run2Id, status: "passed", groups: { production_readiness: { status: "passed", checks: [] } },
      created_at: at, invalidated_at: null, invalidation_reason: null },
    audit: { ...audit, id: randomUUID(), event_type: "video_plan.preflight_completed", video_plan_version_id: plan2.id,
      preflight_run_id: run2Id } });
  const plan3 = { ...plan2, id: randomUUID(), version_number: 3, status: "draft", row_version: 1,
    parent_plan_version_id: plan2.id, output_instructions: "第三版", created_at: at, updated_at: at, frozen_at: null };
  const releaseSubmit = await holdReceiptLock(pool, "pg-stale-submit");
  const staleSubmit = assert.rejects(repository.createReview({ receiptKey: "pg-stale-submit", fingerprint: "stale-submit",
    review: { ...reviewBase, id: randomUUID(), video_plan_version_id: plan2.id },
    gate: { productId: ids.product, planId: plan2.id, expectedPlanRevision: 2,
      expectedPreflightRunId: run2Id, expectedPreflightResultId: result2Id },
    audit: { ...audit, id: randomUUID(), event_type: "video_plan.review_submitted", video_plan_version_id: plan2.id }
  }), { code: "VIDEO_PLAN_REVIEW_CONFLICT" });
  await repository.deriveDraft({ receiptKey: "pg-derive-three", fingerprint: "derive-three", sourcePlanId: plan2.id,
    expectedHeadRevision: 2, plan: plan3,
    audit: { ...audit, id: randomUUID(), event_type: "video_plan.derived", video_plan_version_id: plan3.id } });
  await releaseSubmit();
  await staleSubmit;
  assert.equal((await repository.listReviews("org-plan-pg", plan2.id)).length, 0);
  assert.ok((await repository.listAuditEvents()).length >= 3);
});
