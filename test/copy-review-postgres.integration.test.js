import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { runAssetMigrations } from "../src/assets/postgres.js";
import { runCopyGenerationMigrations } from "../src/copy-generation/postgres.js";
import { runCopyQualityMigrations } from "../src/copy-quality/postgres.js";
import { createPostgresCopyReviewRepository } from "../src/copy-review/postgres-copy-review-repository.js";
import { runCopyReviewMigrations } from "../src/copy-review/postgres.js";
import { createPostgresIdentityRepository } from "../src/identity/postgres-identity-repository.js";
import { createIdentityPool, runIdentityMigrations } from "../src/identity/postgres.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { runProjectContentMigrations } from "../src/project-content/postgres.js";

const connectionString = process.env.TEST_DATABASE_URL || process.env.IDENTITY_TEST_DATABASE_URL;

function isolatedUrl(value, schema) {
  const url = new URL(value); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString();
}

test("clean PostgreSQL review migration preserves cycles and serializes decisions", { skip: !connectionString }, async (t) => {
  const schema = `copy_review_${randomUUID().replaceAll("-", "")}`;
  const adminPool = createIdentityPool({ connectionString });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = createIdentityPool({ connectionString: isolatedUrl(connectionString, schema) });
  t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`); await adminPool.end(); });
  await runIdentityMigrations(pool); await runAssetMigrations(pool); await runProjectContentMigrations(pool);
  await runCopyGenerationMigrations(pool); await runCopyQualityMigrations(pool); await runCopyReviewMigrations(pool);
  assert.equal((await pool.query("SELECT max(version)::integer version FROM copy_review_schema_migrations")).rows[0].version, 1);

  const seeded = await seedInitialAdmin(createPostgresIdentityRepository({ pool, ownsPool: false }), {
    organizationId: "org_review_pg", organizationName: "Review PG", adminEmail: "review-pg@example.test",
    adminDisplayName: "Review Admin", adminTempPassword: "Temporary-Review-9!"
  });
  const ids = { project: randomUUID(), product: randomUUID(), revision: randomUUID(), copy: randomUUID(),
    run: randomUUID(), result: randomUUID(), review: randomUUID() };
  const at = "2026-08-07T08:00:00.000Z";
  await pool.query("INSERT INTO project_content_projects(id,organization_id,name,created_by_member_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5)", [ids.project,"org_review_pg","审核项目",seeded.member.id,at]);
  await pool.query("INSERT INTO project_content_products(id,organization_id,project_id,created_by_member_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5)", [ids.product,"org_review_pg",ids.project,seeded.member.id,at]);
  await pool.query(`INSERT INTO project_content_product_revisions(id,organization_id,project_id,product_id,status,revision_number,product_name,created_by_member_id,created_at,updated_at,ready_at)
    VALUES ($1,$2,$3,$4,'ready',1,'云朵抱枕',$5,$6,$6,$6)`, [ids.revision,"org_review_pg",ids.project,ids.product,seeded.member.id,at]);
  await pool.query("UPDATE project_content_products SET current_revision_id=$1 WHERE id=$2", [ids.revision,ids.product]);
  await pool.query(`INSERT INTO copy_versions(id,organization_id,project_id,product_id,product_revision_id,intent,status,version_number,row_version,body,created_by_member_id,created_at,updated_at,frozen_at)
    VALUES ($1,$2,$3,$4,$5,'product_recommendation','frozen',1,2,'柔软亲肤。',$6,$7,$7,$7)`, [ids.copy,"org_review_pg",ids.project,ids.product,ids.revision,seeded.member.id,at]);
  await pool.query(`INSERT INTO copy_quality_runs(id,organization_id,copy_version_id,product_revision_id,profile_version,rule_version,input_snapshot,status,attempts,max_attempts,created_at,updated_at)
    VALUES ($1,$2,$3,$4,'profile-v1','rules-v1','{}','succeeded',1,3,$5,$5)`, [ids.run,"org_review_pg",ids.copy,ids.revision,at]);
  await pool.query(`INSERT INTO copy_quality_results(id,organization_id,quality_run_id,copy_version_id,profile_version,rule_version,conclusion,created_at)
    VALUES ($1,$2,$3,$4,'profile-v1','rules-v1','passed',$5)`, [ids.result,"org_review_pg",ids.run,ids.copy,at]);
  await pool.query("UPDATE copy_quality_runs SET quality_result_id=$1,completed_at=$2 WHERE id=$3", [ids.result,at,ids.run]);

  const repository = createPostgresCopyReviewRepository({ pool }); await repository.initialize();
  const review = { id: ids.review, organization_id: "org_review_pg", copy_version_id: ids.copy,
    author_member_id: seeded.member.id, quality_result_id: ids.result, product_revision_id: ids.revision,
    profile_version: "profile-v1", rule_version: "rules-v1", created_at: at };
  const head = { ...review, status: "pending", row_version: 1, reviewer_member_id: null, review_mode: null,
    decision_reason: null, decided_at: null, revoked_at: null, revoke_reason: null, revoke_reason_code: null, updated_at: at };
  const transition = { id: randomUUID(), organization_id: "org_review_pg", human_review_id: ids.review,
    copy_version_id: ids.copy, actor_member_id: seeded.member.id, from_status: "not_submitted", to_status: "pending",
    reason: null, reason_code: null, created_at: at };
  const audit = { id: randomUUID(), organization_id: "org_review_pg", actor_member_id: seeded.member.id,
    event_type: "copy.review_submitted", human_review_id: ids.review, copy_version_id: ids.copy, created_at: at };
  const created = await repository.createReview({ receiptKey: "pg-submit", fingerprint: "submit", review, head, event: transition, audit });
  assert.equal(created.status, "pending");
  assert.equal((await repository.getReceipt("pg-submit", "submit")).status, "pending");
  await assert.rejects(repository.getReceipt("pg-submit", "different"), { code: "IDEMPOTENCY_CONFLICT" });

  const decision = (receiptKey) => repository.transition({ receiptKey, fingerprint: "changes_requested",
    reviewId: ids.review, organizationId: "org_review_pg", expectedRevision: 1, fromStatuses: ["pending"],
    patch: { status: "changes_requested", reviewer_member_id: seeded.member.id, review_mode: "self_review", decided_at: "2026-08-07T08:01:00.000Z" },
    event: { ...transition, id: randomUUID(), from_status: "pending", to_status: "changes_requested", created_at: "2026-08-07T08:01:00.000Z" },
    audit: { ...audit, id: randomUUID(), event_type: "copy.review_changes_requested", created_at: "2026-08-07T08:01:00.000Z" } });
  const outcomes = await Promise.allSettled([decision("pg-changes-a"), decision("pg-changes-b")]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(outcomes.find((item) => item.status === "rejected").reason.code, "COPY_REVIEW_CONFLICT");
  assert.equal((await repository.getReceipt("pg-submit", "submit")).status, "pending");
  assert.equal((await repository.listEvents("org_review_pg", ids.copy)).length, 2);

  const secondReview = { ...review, id: randomUUID(), created_at: "2026-08-07T08:02:00.000Z" };
  const secondHead = { ...head, ...secondReview, updated_at: secondReview.created_at };
  const secondEvent = { ...transition, id: randomUUID(), human_review_id: secondReview.id,
    created_at: secondReview.created_at };
  const secondAudit = { ...audit, id: randomUUID(), human_review_id: secondReview.id,
    created_at: secondReview.created_at };
  await repository.createReview({ receiptKey: "pg-submit-second", fingerprint: "submit-second",
    review: secondReview, head: secondHead, event: secondEvent, audit: secondAudit });
  const approvedSecond = await repository.transition({ receiptKey: "pg-approve-second", fingerprint: "approve-second",
    reviewId: secondReview.id, organizationId: "org_review_pg", expectedRevision: 1, fromStatuses: ["pending"],
    patch: { status: "approved", reviewer_member_id: seeded.member.id, review_mode: "self_review",
      decided_at: "2026-08-07T08:03:00.000Z" },
    event: { ...secondEvent, id: randomUUID(), from_status: "pending", to_status: "approved",
      created_at: "2026-08-07T08:03:00.000Z" },
    audit: { ...secondAudit, id: randomUUID(), event_type: "copy.review_approved",
      created_at: "2026-08-07T08:03:00.000Z" } });
  await repository.transition({ receiptKey: "pg-auto-revoke-second", fingerprint: "auto-revoke-second",
    resultReceiptKey: "pg-approve-second", reviewId: secondReview.id, organizationId: "org_review_pg",
    expectedRevision: approvedSecond.row_version, fromStatuses: ["approved"],
    patch: { status: "revoked", revoked_at: "2026-08-07T08:04:00.000Z",
      revoke_reason_code: "quality_policy_changed" },
    event: { ...secondEvent, id: randomUUID(), actor_member_id: null, from_status: "approved", to_status: "revoked",
      reason_code: "quality_policy_changed", created_at: "2026-08-07T08:04:00.000Z" },
    audit: { ...secondAudit, id: randomUUID(), actor_member_id: null,
      event_type: "copy.review_revoked_by_invalidation", created_at: "2026-08-07T08:04:00.000Z" } });
  assert.equal((await repository.getReceipt("pg-approve-second", "approve-second")).status, "revoked");
  await assert.rejects(pool.query("UPDATE copy_human_reviews SET profile_version='other' WHERE id=$1", [ids.review]), /append-only/);
  await assert.rejects(pool.query("DELETE FROM copy_human_review_events WHERE human_review_id=$1", [ids.review]), /append-only/);
});
