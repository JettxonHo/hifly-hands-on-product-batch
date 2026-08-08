import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import test from "node:test";

import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createManualExecutionService } from "../src/manual-execution/manual-execution-service.js";
import { createPostgresManualExecutionRepository } from "../src/manual-execution/postgres-manual-execution-repository.js";
import { runManualExecutionMigrations } from "../src/manual-execution/postgres.js";
import { runIdentityMigrations, createIdentityPool } from "../src/identity/postgres.js";
import { createPostgresIdentityRepository } from "../src/identity/postgres-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { runProjectContentMigrations } from "../src/project-content/postgres.js";
import { runVideoPlanningMigrations } from "../src/video-planning/postgres.js";
import { runProductionOrderMigrations } from "../src/production-orders/postgres.js";
import { createPostgresProductionOrderRepository } from "../src/production-orders/postgres-production-order-repository.js";
import { runManualHandoffMigrations } from "../src/manual-handoff/postgres.js";

const connectionString = process.env.TEST_DATABASE_URL || process.env.IDENTITY_TEST_DATABASE_URL;
const isolatedUrl = (value, schema) => { const url = new URL(value); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); };

test("clean PostgreSQL A11 migration and repository preserve bindings, reports, receipts, and order boundary", { skip: !connectionString }, async (t) => {
  const schema = `manual_execution_${randomUUID().replaceAll("-", "")}`;
  const adminPool = createIdentityPool({ connectionString });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = createIdentityPool({ connectionString: isolatedUrl(connectionString, schema) });
  t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`); await adminPool.end(); });
  await runIdentityMigrations(pool); await runProjectContentMigrations(pool); await runVideoPlanningMigrations(pool);
  await runProductionOrderMigrations(pool); await runManualHandoffMigrations(pool); await runManualExecutionMigrations(pool);
  assert.equal((await pool.query("SELECT max(version)::integer version FROM manual_execution_schema_migrations")).rows[0].version, 1);

  const identity = createPostgresIdentityRepository({ pool, ownsPool: false });
  const seeded = await seedInitialAdmin(identity, { organizationId: "org-a11-pg", organizationName: "A11 PG", adminEmail: "a11-pg@example.test", adminDisplayName: "A11 PG", adminTempPassword: "Temporary-A11-PG-9!" });
  const at = "2026-08-08T10:00:00.000Z", projectId = randomUUID(), productId = randomUUID(), planId = randomUUID(), orderId = randomUUID(), packageId = randomUUID(), jobId = randomUUID();
  await pool.query("INSERT INTO project_content_projects(id,organization_id,name,created_by_member_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5)", [projectId, "org-a11-pg", "A11 项目", seeded.member.id, at]);
  await pool.query("INSERT INTO project_content_products(id,organization_id,project_id,created_by_member_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5)", [productId, "org-a11-pg", projectId, seeded.member.id, at]);
  await pool.query(`INSERT INTO video_plan_versions(id,organization_id,product_id,version_number,status,row_version,upstream_snapshot,capability_config_snapshot,output_instructions,created_by_member_id,created_at,updated_at)
    VALUES ($1,$2,$3,1,'frozen',1,$4,$5,$6,$7,$8,$8)`, [planId, "org-a11-pg", productId, JSON.stringify({}), JSON.stringify({}), "输出", seeded.member.id, at]);
  const snapshot = { video_plan_version: { id: planId, status: "frozen", output_instructions: "输出" }, plan_review: { status: "approved" }, preflight_result: { status: "warning" } };
  const orderRepository = createPostgresProductionOrderRepository({ pool }); await orderRepository.initialize();
  const order = { id: orderId, organization_id: "org-a11-pg", product_id: productId, video_plan_version_id: planId, execution_purpose: "first_production",
    status: "waiting_for_executor", row_version: 1, input_snapshot: snapshot, status_history: [{ status: "waiting_for_executor", at }],
    created_by_member_id: seeded.member.id, created_at: at, updated_at: at };
  await orderRepository.createOrder({ receiptKey: "a11-order", fingerprint: "a11-order", order,
    auditEvents: [{ id: randomUUID(), organization_id: order.organization_id, actor_member_id: seeded.member.id, production_order_id: order.id, event_type: "production_order.created", metadata: {}, created_at: at }],
    outboxEvent: { id: randomUUID(), organization_id: order.organization_id, aggregate_id: order.id, event_type: "production_order.created", payload: {}, created_at: at, published_at: null } });
  await pool.query(`INSERT INTO manual_handoff_packages(id,organization_id,production_order_id,contract_type,contract_version,package_version,status,generation_request_id,generation_job_id,manifest,readme,manifest_hash,package_hash,storage_key,created_by_member_id,created_at,updated_at,row_version,status_history)
    VALUES ($1,$2,$3,'manual_handoff','1.0',1,'ready','a11-generation',$4,$5,$6,$7,$8,$9,$10,$11,$11,1,$12)`, [packageId, order.organization_id, order.id, jobId,
    JSON.stringify({ accepted_media_types: ["video/mp4"] }), "说明", "manifest-pg", "package-pg", "manual-handoff/package.zip", seeded.member.id, at, JSON.stringify([{ from_status: "generating", to_status: "ready", at }])]);
  await pool.query(`INSERT INTO manual_handoff_package_generation_jobs(id,organization_id,package_id,type,status,attempts,max_attempts,order_snapshot,created_at,updated_at)
    VALUES ($1,$2,$3,'manual_handoff_package_generation','succeeded',1,1,$4,$5,$5)`, [jobId, order.organization_id, packageId, JSON.stringify(snapshot), at]);

  const repository = createPostgresManualExecutionRepository({ pool }); await repository.initialize();
  const packagePort = { async getPackage() { return { id: packageId, organization_id: order.organization_id, production_order_id: order.id, package_version: 1, status: "ready", manifest_hash: "manifest-pg", package_hash: "package-pg", manifest: { accepted_media_types: ["video/mp4"] } }; }, async listPackages() { return []; } };
  const orderPort = { getOrder: ({ organizationId, orderId: requested }) => orderRepository.getOrder(organizationId, requested), transitionOrder: (input) => orderRepository.transitionOrder(input) };
  const service = createManualExecutionService({ repository, orderPort, packagePort, candidateStore: createMemoryObjectStore(), now: () => Date.parse(at) });
  const actor = { organizationId: order.organization_id, actorMemberId: seeded.member.id, actorRole: "admin" };
  const claimed = await service.claimManualTask({ ...actor, productionOrderId: order.id, packageId, idempotencyKey: "pg-claim" });
  const started = await service.confirmStart({ ...actor, attemptId: claimed.attempt.id, idempotencyKey: "pg-start" });
  const body = Buffer.from("pg-candidate"), checksum = createHash("sha256").update(body).digest("hex");
  const authorization = await service.createCandidateUploadAuthorization({ ...actor, attemptId: started.attempt.id, role: "primary_video", originalFilename: "pg.mp4", mediaType: "video/mp4", size: body.length, checksum, idempotencyKey: "pg-upload" });
  await service.uploadCandidateObject({ ...actor, uploadToken: authorization.upload_token, body, contentType: "video/mp4" });
  const uploaded = await service.completeCandidateUpload({ ...actor, attemptId: started.attempt.id, candidateId: authorization.candidate.id, uploadToken: authorization.upload_token, idempotencyKey: "pg-complete" });
  const submitted = await service.submitReport({ ...actor, attemptId: started.attempt.id, reportId: randomUUID(), idempotencyKey: "pg-report", outcome: "completed", primaryCandidateId: uploaded.candidate.id, deviations: [] });
  assert.equal(submitted.attempt.status, "succeeded");
  assert.equal((await orderRepository.getOrder(order.organization_id, order.id)).status, "running");
  assert.equal((await repository.listReports(order.organization_id, started.attempt.id)).length, 1);
  await assert.rejects(pool.query("UPDATE manual_execution_reports SET outcome='failed'"), /manual execution history is append-only/);
  assert.equal((await repository.listAttempts("org-other", order.id)).length, 0);
  await repository.close();
});
