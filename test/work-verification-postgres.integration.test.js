import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createPostgresAssetRepository } from "../src/assets/postgres-asset-repository.js";
import { runAssetMigrations } from "../src/assets/postgres.js";
import { createIdentityPool, runIdentityMigrations } from "../src/identity/postgres.js";
import { createPostgresIdentityRepository } from "../src/identity/postgres-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createPostgresManualExecutionRepository } from "../src/manual-execution/postgres-manual-execution-repository.js";
import { runManualExecutionMigrations } from "../src/manual-execution/postgres.js";
import { createPostgresManualHandoffRepository } from "../src/manual-handoff/postgres-manual-handoff-repository.js";
import { runManualHandoffMigrations } from "../src/manual-handoff/postgres.js";
import { createPostgresProductionOrderRepository } from "../src/production-orders/postgres-production-order-repository.js";
import { runProductionOrderMigrations } from "../src/production-orders/postgres.js";
import { runProjectContentMigrations } from "../src/project-content/postgres.js";
import { runCopyGenerationMigrations } from "../src/copy-generation/postgres.js";
import { runAvatarSelectionMigrations } from "../src/avatar-selection/postgres.js";
import { runVideoPlanningMigrations } from "../src/video-planning/postgres.js";
import { createPostgresWorkVerificationRepository } from "../src/work-verification/postgres-work-verification-repository.js";
import { runWorkVerificationMigrations } from "../src/work-verification/postgres.js";
import { createWorkVerificationService } from "../src/work-verification/work-verification-service.js";

const connectionString = process.env.TEST_DATABASE_URL || process.env.IDENTITY_TEST_DATABASE_URL;
const isolatedUrl = (value, schema) => {
  const url = new URL(value);
  url.searchParams.set("options", `-c search_path=${schema}`);
  return url.toString();
};

test("PostgreSQL A12 completion commits Work, canonical AssetVersion, order transition, candidate projection, and audit together", { skip: !connectionString }, async (t) => {
  const schema = `work_verification_${randomUUID().replaceAll("-", "")}`;
  const adminPool = createIdentityPool({ connectionString });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = createIdentityPool({ connectionString: isolatedUrl(connectionString, schema) });
  t.after(async () => {
    await pool.end();
    await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await adminPool.end();
  });

  await runIdentityMigrations(pool);
  await runAssetMigrations(pool);
  await runProjectContentMigrations(pool);
  await runCopyGenerationMigrations(pool);
  await runAvatarSelectionMigrations(pool);
  await runVideoPlanningMigrations(pool);
  await runProductionOrderMigrations(pool);
  await runManualHandoffMigrations(pool);
  await runManualExecutionMigrations(pool);
  await runWorkVerificationMigrations(pool);
  assert.deepEqual((await pool.query("SELECT version FROM work_verification_schema_migrations ORDER BY version")).rows.map((row) => row.version), [1, 2]);

  const identity = createPostgresIdentityRepository({ pool });
  const seeded = await seedInitialAdmin(identity, {
    organizationId: "org-a12-pg", organizationName: "A12 PG", adminEmail: "a12-pg@example.test",
    adminDisplayName: "A12 PG", adminTempPassword: "Temporary-A12-PG-9!"
  });
  const at = "2026-08-09T00:00:00.000Z";
  const ids = Object.fromEntries([
    "project", "product", "revision", "plan", "copy", "avatarAsset", "avatarVersion", "order", "package", "packageJob", "attempt", "report", "candidate"
  ].map((name) => [name, randomUUID()]));
  const organizationId = "org-a12-pg";
  const body = Buffer.from("postgres-candidate-video");
  const checksum = createHash("sha256").update(body).digest("hex");

  await pool.query("INSERT INTO project_content_projects(id,organization_id,name,created_by_member_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5)",
    [ids.project, organizationId, "A12 项目", seeded.member.id, at]);
  await pool.query("INSERT INTO project_content_products(id,organization_id,project_id,created_by_member_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5)",
    [ids.product, organizationId, ids.project, seeded.member.id, at]);
  await pool.query(`INSERT INTO project_content_product_revisions
    (id,organization_id,project_id,product_id,status,revision_number,product_name,primary_category,asset_version_ids,selling_points,created_by_member_id,created_at,updated_at,ready_at)
    VALUES ($1,$2,$3,$4,'ready',1,$5,'general','[]','[]',$6,$7,$7,$7)`,
    [ids.revision, organizationId, ids.project, ids.product, "A12 商品", seeded.member.id, at]);
  await pool.query("UPDATE project_content_products SET current_revision_id=$2 WHERE organization_id=$1 AND id=$3", [organizationId, ids.revision, ids.product]);
  await pool.query(`INSERT INTO copy_versions
    (id,organization_id,project_id,product_id,product_revision_id,intent,status,version_number,row_version,body,created_by_member_id,created_at,updated_at,frozen_at)
    VALUES ($1,$2,$3,$4,$5,'product_video','frozen',1,1,$6,$7,$8,$8,$8)`,
    [ids.copy, organizationId, ids.project, ids.product, ids.revision, "A12 copy", seeded.member.id, at]);
  await pool.query(`INSERT INTO avatar_assets
    (id,organization_id,source_type,display_name,description,status,controlled_seed,seed_key,seed_label,created_at,updated_at)
    VALUES ($1,$2,'public','A12 avatar','test','active',true,'a12-avatar','A12 avatar',$3,$3)`, [ids.avatarAsset, organizationId, at]);
  await pool.query(`INSERT INTO avatar_asset_versions
    (id,asset_id,organization_id,version_number,status,authorization_status,authorization_scope,capability_status,materials_accessible,preview_kind,created_at,updated_at)
    VALUES ($1,$2,$3,1,'available','valid','current_organization','verified',true,'image',$4,$4)`,
    [ids.avatarVersion, ids.avatarAsset, organizationId, at]);
  await pool.query(`INSERT INTO video_plan_versions
    (id,organization_id,product_id,version_number,status,row_version,upstream_snapshot,capability_config_snapshot,output_instructions,created_by_member_id,created_at,updated_at,frozen_at)
    VALUES ($1,$2,$3,1,'frozen',1,$4,$5,$6,$7,$8,$8,$8)`,
    [ids.plan, organizationId, ids.product, JSON.stringify({ copy_version_id: ids.copy, avatar_asset_version_id: ids.avatarVersion }), JSON.stringify({ preset: "pg" }), "输出", seeded.member.id, at]);
  const inputSnapshot = {
    video_plan_version: { id: ids.plan },
    approved_copy_snapshot: { copy_version_id: ids.copy },
    avatar_selection_snapshot: { avatar_asset_version_id: ids.avatarVersion },
    capability_config_snapshot: { preset: "pg" }
  };
  await pool.query(`INSERT INTO production_orders
    (id,organization_id,product_id,video_plan_version_id,execution_purpose,status,row_version,input_snapshot,status_history,created_by_member_id,created_at,updated_at)
    VALUES ($1,$2,$3,$4,'first_production','running',1,$5,$6,$7,$8,$8)`,
    [ids.order, organizationId, ids.product, ids.plan, JSON.stringify(inputSnapshot), JSON.stringify([{ status: "running", at }]), seeded.member.id, at]);
  const packageClient = await pool.connect();
  try {
    await packageClient.query("BEGIN");
    await packageClient.query(`INSERT INTO manual_handoff_packages
      (id,organization_id,production_order_id,contract_type,contract_version,package_version,status,generation_request_id,generation_job_id,manifest,readme,manifest_hash,package_hash,storage_key,created_by_member_id,created_at,updated_at,row_version,status_history)
      VALUES ($1,$2,$3,'manual_handoff','1.0',2,'ready','a12-package',$4,$5,$6,$7,$8,$9,$10,$11,$11,1,$12)`,
      [ids.package, organizationId, ids.order, ids.packageJob, JSON.stringify({ accepted_media_types: ["video/mp4"], expected_quantity: 1 }), "说明", "manifest-a12", "package-a12", "a12/package.zip", seeded.member.id, at, JSON.stringify([{ from_status: "generating", to_status: "ready", at }])]);
    await packageClient.query(`INSERT INTO manual_handoff_package_generation_jobs
      (id,organization_id,package_id,type,status,attempts,max_attempts,order_snapshot,created_at,updated_at)
      VALUES ($1,$2,$3,'manual_handoff_package_generation','succeeded',1,1,$4,$5,$5)`,
      [ids.packageJob, organizationId, ids.package, JSON.stringify(inputSnapshot), at]);
    await packageClient.query("COMMIT");
  } catch (error) {
    await packageClient.query("ROLLBACK");
    throw error;
  } finally {
    packageClient.release();
  }
  await pool.query(`INSERT INTO manual_execution_attempts
    (id,organization_id,production_order_id,package_id,package_version,manifest_hash,executor_type,operator_id,status,row_version,claimed_at,started_at,completed_at,created_at,updated_at,status_history)
    VALUES ($1,$2,$3,$4,2,'manifest-a12','manual',$5,'succeeded',2,$6,$6,$6,$6,$6,$7)`,
    [ids.attempt, organizationId, ids.order, ids.package, seeded.member.id, at, JSON.stringify([{ from_status: "running", to_status: "succeeded", at }])]);
  await pool.query(`INSERT INTO manual_execution_reports
    (id,organization_id,report_version,production_order_id,execution_attempt_id,package_id,package_version,manifest_hash,submitted_by,submitted_at,outcome,completed_at,deviations,primary_output)
    VALUES ($1,$2,1,$3,$4,$5,2,'manifest-a12',$6,$7,'completed',$7,'[]',$8)`,
    [ids.report, organizationId, ids.order, ids.attempt, ids.package, seeded.member.id, at,
      JSON.stringify({ upload_reference: ids.candidate, checksum, media_type: "video/mp4", size: body.length, role: "primary_video" })]);
  await pool.query(`INSERT INTO manual_execution_candidates
    (id,organization_id,production_order_id,execution_attempt_id,package_id,package_version,manifest_hash,role,original_filename,media_type,size,checksum,status,row_version,upload_token_digest,object_key,uploaded_by_member_id,created_at,updated_at,uploaded_at)
    VALUES ($1,$2,$3,$4,$5,2,'manifest-a12','primary_video','a12.mp4','video/mp4',$6,$7,'pending_verification',2,$8,$9,$10,$11,$11,$11)`,
    [ids.candidate, organizationId, ids.order, ids.attempt, ids.package, body.length, checksum,
      createHash("sha256").update("a12-token").digest("hex"), "a12/candidate.mp4", seeded.member.id, at]);

  const migrationProbeClient = await pool.connect();
  try {
    await migrationProbeClient.query("BEGIN");
    const probeReportId = randomUUID(), probeJobA = randomUUID(), probeJobB = randomUUID();
    await migrationProbeClient.query(`INSERT INTO manual_execution_reports
      (id,organization_id,report_version,production_order_id,execution_attempt_id,package_id,package_version,manifest_hash,submitted_by,submitted_at,outcome,completed_at,deviations,primary_output)
      VALUES ($1,$2,2,$3,$4,$5,2,'manifest-a12',$6,$7,'completed',$7,'[]',$8)`,
      [probeReportId, organizationId, ids.order, ids.attempt, ids.package, seeded.member.id, "2026-08-09T00:00:01.000Z",
        JSON.stringify({ upload_reference: ids.candidate, checksum, media_type: "video/mp4", size: body.length, role: "primary_video" })]);
    const insertProbeJob = (jobId, reportId) => migrationProbeClient.query(`INSERT INTO work_verification_jobs
      (id,organization_id,type,production_order_id,execution_attempt_id,report_id,candidate_id,primary_output_checksum,requested_by_member_id,requested_by_role,status,verification_status,attempts,max_attempts,receipt_key,checks,created_at,updated_at)
      VALUES ($1,$2,'artifact_verification',$3,$4,$5,$6,$7,$8,'admin','queued','queued',0,3,$9,'[]',$10,$10)`,
      [jobId, organizationId, ids.order, ids.attempt, reportId, ids.candidate, checksum, seeded.member.id, `migration-probe-${jobId}`, at]);
    await insertProbeJob(probeJobA, ids.report);
    await insertProbeJob(probeJobB, probeReportId);
    assert.equal(Number((await migrationProbeClient.query("SELECT count(*) count FROM work_verification_jobs WHERE id IN ($1,$2)", [probeJobA, probeJobB])).rows[0].count), 2);
    await migrationProbeClient.query("ROLLBACK");
  } catch (error) {
    await migrationProbeClient.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    migrationProbeClient.release();
  }

  const correctionReportId = randomUUID();
  await pool.query(`INSERT INTO manual_execution_reports
    (id,organization_id,report_version,production_order_id,execution_attempt_id,package_id,package_version,manifest_hash,submitted_by,submitted_at,supersedes_report_id,outcome,completed_at,deviations,primary_output)
    VALUES ($1,$2,2,$3,$4,$5,2,'manifest-a12',$6,$7,$8,'completed',$7,'[]',$9)`,
    [correctionReportId, organizationId, ids.order, ids.attempt, ids.package, seeded.member.id, "2026-08-09T00:01:00.000Z", ids.report,
      JSON.stringify({ upload_reference: ids.candidate, checksum, media_type: "video/mp4", size: body.length, role: "primary_video" })]);

  const objectStore = createMemoryObjectStore();
  await objectStore.put({ key: "a12/candidate.mp4", body, contentType: "video/mp4", metadata: { organizationId, candidateOutputId: ids.candidate } });
  const assetRepository = createPostgresAssetRepository({ pool });
  const workRepository = createPostgresWorkVerificationRepository({ pool });
  const executionRepository = createPostgresManualExecutionRepository({ pool });
  const packageRepository = createPostgresManualHandoffRepository({ pool });
  await assetRepository.initialize();
  await executionRepository.initialize();
  await packageRepository.initialize();
  await workRepository.initialize();
  const concurrentReceiptKey = `${organizationId}:work-verification:concurrent-receipt`;
  const concurrentJobs = ["b", "c"].map((letter) => ({
    id: randomUUID(), organization_id: organizationId, type: "artifact_verification", production_order_id: ids.order,
    execution_attempt_id: ids.attempt, report_id: ids.report, candidate_id: ids.candidate, primary_output_checksum: letter.repeat(64),
    requested_by_member_id: seeded.member.id, requested_by_role: "admin", status: "queued", verification_status: "queued",
    failure_kind: null, failure_code: null, failure_reason: null, attempts: 0, max_attempts: 3, lease_token: null,
    lease_expires_at: null, started_at: null, heartbeat_at: null, completed_at: null, work_id: null, receipt_key: concurrentReceiptKey,
    checks: [], created_at: "2026-08-09T00:10:00.000Z", updated_at: "2026-08-09T00:10:00.000Z"
  }));
  const concurrentResults = await Promise.allSettled(concurrentJobs.map((job, index) => workRepository.createVerificationRequest({
    receiptKey: concurrentReceiptKey, fingerprint: `concurrent-fingerprint-${index}`, job
  })));
  assert.equal(concurrentResults.filter((result) => result.status === "fulfilled").length, 1);
  const conflict = concurrentResults.find((result) => result.status === "rejected");
  assert.equal(conflict?.reason?.code, "IDEMPOTENCY_CONFLICT");
  const winnerIndex = concurrentResults.findIndex((result) => result.status === "fulfilled");
  const replay = await workRepository.createVerificationRequest({ receiptKey: concurrentReceiptKey,
    fingerprint: `concurrent-fingerprint-${winnerIndex}`, job: concurrentJobs[winnerIndex] });
  assert.equal(replay.replayed, true);
  const orderRepository = createPostgresProductionOrderRepository({ pool });
  const orderPort = {
    getOrder: ({ organizationId: requestedOrganizationId, orderId }) => orderRepository.getOrder(requestedOrganizationId, orderId),
    transitionOrder: (input) => orderRepository.transitionOrder(input)
  };
  const packagePort = {
    getPackage: ({ organizationId: requestedOrganizationId, packageId }) => packageRepository.getPackage(requestedOrganizationId, packageId)
  };
  const service = createWorkVerificationService({
    repository: workRepository,
    orderPort,
    executionPort: executionRepository,
    packagePort,
    objectStore,
    verifiedOutputAssetPort: { registerVerifiedOutput: (input) => assetRepository.registerVerifiedOutput(input) },
    now: () => Date.parse(at)
  });
  const actor = { organizationId, actorMemberId: seeded.member.id, actorRole: "admin" };
  const requested = await service.requestVerification({ ...actor, productionOrderId: ids.order, executionAttemptId: ids.attempt,
    reportId: correctionReportId, candidateId: ids.candidate, idempotencyKey: "pg-verify" });
  await pool.query(`
    CREATE FUNCTION a12_fail_order_transition() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.id = '${ids.order}'::uuid AND NEW.status = 'succeeded' THEN
        RAISE EXCEPTION 'A12 injected order transition failure';
      END IF;
      RETURN NEW;
    END;
    $$;
    CREATE TRIGGER a12_fail_order_transition_trigger
      BEFORE UPDATE OF status ON production_orders
      FOR EACH ROW EXECUTE FUNCTION a12_fail_order_transition();
  `);
  const failed = await service.runNextVerificationJob();
  assert.equal(failed.job.status, "failed");
  assert.equal(failed.job.failure_kind, "technical");
  assert.equal(failed.job.verification_status, "failed");
  assert.equal((await orderRepository.getOrder(organizationId, ids.order)).status, "running");
  const failedCandidate = await executionRepository.getCandidate(organizationId, ids.candidate);
  assert.equal(failedCandidate.verification_status, "failed");
  assert.equal(failedCandidate.verification_failure_kind, "technical");
  assert.equal(Number((await pool.query("SELECT count(*) count FROM asset_assets WHERE organization_id=$1 AND kind='work_video'", [organizationId])).rows[0].count), 0);
  assert.equal(Number((await pool.query("SELECT count(*) count FROM asset_versions v JOIN asset_assets a ON a.id=v.asset_id WHERE a.organization_id=$1 AND a.kind='work_video'", [organizationId])).rows[0].count), 0);
  assert.equal(Number((await pool.query("SELECT count(*) count FROM works WHERE organization_id=$1", [organizationId])).rows[0].count), 0);
  await pool.query("DROP TRIGGER a12_fail_order_transition_trigger ON production_orders");
  await pool.query("DROP FUNCTION a12_fail_order_transition()");
  await service.retryVerification({ ...actor, jobId: failed.job.id, idempotencyKey: "pg-verify-retry" });
  const completed = await service.runNextVerificationJob();
  assert.equal(completed.job.verification_status, "passed");
  assert.equal(completed.work.primary_asset_version_id, (await pool.query("SELECT id FROM asset_versions WHERE object_key=$1", ["a12/candidate.mp4"])).rows[0].id);
  assert.equal(Number((await pool.query("SELECT count(*) count FROM works WHERE organization_id=$1", [organizationId])).rows[0].count), 1);
  assert.equal((await orderRepository.getOrder(organizationId, ids.order)).status, "succeeded");
  assert.equal((await executionRepository.getCandidate(organizationId, ids.candidate)).verification_status, "passed");
  assert.equal(Number((await pool.query("SELECT count(*) count FROM work_verification_audit_events WHERE organization_id=$1 AND event_type='work_verification.passed'", [organizationId])).rows[0].count), 1);
  assert.equal(Number((await pool.query("SELECT count(*) count FROM production_order_audit_events WHERE organization_id=$1 AND event_type='production_order.succeeded'", [organizationId])).rows[0].count), 1);
  assert.equal(Number((await pool.query("SELECT count(*) count FROM work_verification_status_ledger WHERE job_id=$1 AND to_status='passed'", [requested.job.id])).rows[0].count), 1);
  await assert.rejects(pool.query("UPDATE works SET status='withdrawn' WHERE organization_id=$1", [organizationId]), /append-only/);
  await assert.rejects(pool.query("DELETE FROM work_verification_audit_events WHERE organization_id=$1", [organizationId]), /append-only/);
});
