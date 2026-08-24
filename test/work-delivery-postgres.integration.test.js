import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createIdentityPool, runIdentityMigrations } from "../src/identity/postgres.js";
import { createPostgresIdentityRepository } from "../src/identity/postgres-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { runAssetMigrations } from "../src/assets/postgres.js";
import { runProjectContentMigrations } from "../src/project-content/postgres.js";
import { runCopyGenerationMigrations } from "../src/copy-generation/postgres.js";
import { runAvatarSelectionMigrations } from "../src/avatar-selection/postgres.js";
import { runVideoPlanningMigrations } from "../src/video-planning/postgres.js";
import { runProductionOrderMigrations } from "../src/production-orders/postgres.js";
import { runManualHandoffMigrations } from "../src/manual-handoff/postgres.js";
import { runManualExecutionMigrations } from "../src/manual-execution/postgres.js";
import { runWorkVerificationMigrations } from "../src/work-verification/postgres.js";
import { createPostgresWorkDeliveryRepository } from "../src/work-delivery/postgres-work-delivery-repository.js";
import { runWorkDeliveryMigrations } from "../src/work-delivery/postgres.js";
import { createPostgresWorkLibraryReadPort } from "../src/work-delivery/work-library-read-port.js";
import { createWorkDeliveryService } from "../src/work-delivery/work-delivery-service.js";
import { createOperatorWorkspaceService } from "../src/operator-workspace/operator-workspace-service.js";

const connectionString = process.env.TEST_DATABASE_URL || process.env.IDENTITY_TEST_DATABASE_URL;
const isolatedUrl = (value, schema) => { const url = new URL(value); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); };

test("PostgreSQL A13 migration and repository preserve inspection history, delivery idempotency, isolation, and concurrency", { skip: !connectionString }, async (t) => {
  const schema = `work_delivery_${randomUUID().replaceAll("-", "")}`;
  const adminPool = createIdentityPool({ connectionString });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = createIdentityPool({ connectionString: isolatedUrl(connectionString, schema), max: 8 });
  t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`); await adminPool.end(); });

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
  await runWorkDeliveryMigrations(pool);
  assert.deepEqual((await pool.query("SELECT version FROM work_delivery_schema_migrations ORDER BY version")).rows.map((row) => row.version), [1]);

  const identity = createPostgresIdentityRepository({ pool });
  const seeded = await seedInitialAdmin(identity, { organizationId: "org-a13-pg", organizationName: "A13 PG", adminEmail: "a13-pg@example.test", adminDisplayName: "A13 PG", adminTempPassword: "Temporary-A13-PG-9!" });
  const organizationId = "org-a13-pg", at = "2026-08-09T00:00:00.000Z";
  const ids = Object.fromEntries(["project", "product", "revision", "copy", "avatarAsset", "avatarVersion", "plan", "order", "package", "packageJob", "attempt", "report", "candidate", "verificationJob", "asset", "assetVersion", "work"].map((name) => [name, randomUUID()]));
  const checksum = "a".repeat(64);

  await pool.query("INSERT INTO project_content_projects(id,organization_id,name,created_by_member_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5)", [ids.project, organizationId, "A13 项目", seeded.member.id, at]);
  await pool.query("INSERT INTO project_content_products(id,organization_id,project_id,created_by_member_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5)", [ids.product, organizationId, ids.project, seeded.member.id, at]);
  await pool.query(`INSERT INTO project_content_product_revisions
    (id,organization_id,project_id,product_id,status,revision_number,product_name,primary_category,asset_version_ids,selling_points,created_by_member_id,created_at,updated_at,ready_at)
    VALUES ($1,$2,$3,$4,'ready',1,$5,'general','[]','[]',$6,$7,$7,$7)`, [ids.revision, organizationId, ids.project, ids.product, "A13 商品", seeded.member.id, at]);
  await pool.query("UPDATE project_content_products SET current_revision_id=$2 WHERE organization_id=$1 AND id=$3", [organizationId, ids.revision, ids.product]);
  await pool.query(`INSERT INTO copy_versions
    (id,organization_id,project_id,product_id,product_revision_id,intent,status,version_number,row_version,body,created_by_member_id,created_at,updated_at,frozen_at)
    VALUES ($1,$2,$3,$4,$5,'product_video','frozen',1,1,$6,$7,$8,$8,$8)`, [ids.copy, organizationId, ids.project, ids.product, ids.revision, "A13 copy", seeded.member.id, at]);
  await pool.query(`INSERT INTO avatar_assets
    (id,organization_id,source_type,display_name,description,status,controlled_seed,seed_key,seed_label,created_at,updated_at)
    VALUES ($1,$2,'public','A13 avatar','test','active',true,'a13-avatar','A13 avatar',$3,$3)`, [ids.avatarAsset, organizationId, at]);
  await pool.query(`INSERT INTO avatar_asset_versions
    (id,asset_id,organization_id,version_number,status,authorization_status,authorization_scope,capability_status,materials_accessible,preview_kind,created_at,updated_at)
    VALUES ($1,$2,$3,1,'available','valid','current_organization','verified',true,'image',$4,$4)`, [ids.avatarVersion, ids.avatarAsset, organizationId, at]);
  await pool.query(`INSERT INTO video_plan_versions
    (id,organization_id,product_id,version_number,status,row_version,upstream_snapshot,capability_config_snapshot,output_instructions,created_by_member_id,created_at,updated_at,frozen_at)
    VALUES ($1,$2,$3,1,'frozen',1,$4,$5,$6,$7,$8,$8,$8)`, [ids.plan, organizationId, ids.product, JSON.stringify({ copy_version_id: ids.copy, avatar_asset_version_id: ids.avatarVersion }), JSON.stringify({ preset: "pg" }), "输出", seeded.member.id, at]);
  await pool.query(`INSERT INTO production_orders
    (id,organization_id,product_id,video_plan_version_id,execution_purpose,status,row_version,input_snapshot,status_history,created_by_member_id,created_at,updated_at)
    VALUES ($1,$2,$3,$4,'first_production','succeeded',1,$5,$6,$7,$8,$8)`, [ids.order, organizationId, ids.product, ids.plan, JSON.stringify({ video_plan_version: { id: ids.plan }, product_revision_snapshot: { project_id: ids.project } }), JSON.stringify([{ status: "succeeded", at }]), seeded.member.id, at]);
  const packageClient = await pool.connect();
  try {
    await packageClient.query("BEGIN");
    await packageClient.query(`INSERT INTO manual_handoff_packages
      (id,organization_id,production_order_id,contract_type,contract_version,package_version,status,generation_request_id,generation_job_id,manifest,readme,manifest_hash,package_hash,storage_key,created_by_member_id,created_at,updated_at,row_version,status_history)
      VALUES ($1,$2,$3,'manual_handoff','1.0',1,'ready','a13-package',$4,$5,$6,$7,$8,$9,$10,$11,$11,1,$12)`, [ids.package, organizationId, ids.order, ids.packageJob, JSON.stringify({ accepted_media_types: ["video/mp4"] }), "说明", "manifest-a13", "package-a13", "a13/package.zip", seeded.member.id, at, JSON.stringify([{ from_status: "generating", to_status: "ready", at }])]);
    await packageClient.query(`INSERT INTO manual_handoff_package_generation_jobs
      (id,organization_id,package_id,type,status,attempts,max_attempts,order_snapshot,created_at,updated_at)
      VALUES ($1,$2,$3,'manual_handoff_package_generation','succeeded',1,1,$4,$5,$5)`, [ids.packageJob, organizationId, ids.package, JSON.stringify({ video_plan_version: { id: ids.plan } }), at]);
    await packageClient.query("COMMIT");
  } catch (error) { await packageClient.query("ROLLBACK"); throw error; } finally { packageClient.release(); }
  await pool.query(`INSERT INTO manual_execution_attempts
    (id,organization_id,production_order_id,package_id,package_version,manifest_hash,executor_type,operator_id,status,row_version,claimed_at,started_at,completed_at,created_at,updated_at,status_history)
    VALUES ($1,$2,$3,$4,1,'manifest-a13','manual',$5,'succeeded',2,$6,$6,$6,$6,$6,$7)`, [ids.attempt, organizationId, ids.order, ids.package, seeded.member.id, at, JSON.stringify([{ from_status: "running", to_status: "succeeded", at }])]);
  await pool.query(`INSERT INTO manual_execution_reports
    (id,organization_id,report_version,production_order_id,execution_attempt_id,package_id,package_version,manifest_hash,submitted_by,submitted_at,outcome,completed_at,deviations,primary_output)
    VALUES ($1,$2,1,$3,$4,$5,1,'manifest-a13',$6,$7,'completed',$7,'[]',$8)`, [ids.report, organizationId, ids.order, ids.attempt, ids.package, seeded.member.id, at, JSON.stringify({ upload_reference: ids.candidate, checksum, media_type: "video/mp4", size: 42, role: "primary_video" })]);
  await pool.query(`INSERT INTO manual_execution_candidates
    (id,organization_id,production_order_id,execution_attempt_id,package_id,package_version,manifest_hash,role,original_filename,media_type,size,checksum,status,row_version,upload_token_digest,object_key,uploaded_by_member_id,created_at,updated_at,uploaded_at)
    VALUES ($1,$2,$3,$4,$5,1,'manifest-a13','primary_video','a13.mp4','video/mp4',42,$6,'pending_verification',2,$7,$8,$9,$10,$10,$10)`, [ids.candidate, organizationId, ids.order, ids.attempt, ids.package, checksum, "token-a13", "a13/candidate.mp4", seeded.member.id, at]);
  await pool.query(`INSERT INTO asset_assets(id,organization_id,kind,display_name,status,row_version,created_by_member_id,created_at,updated_at)
    VALUES ($1,$2,'work_video','A13 作品','active',1,$3,$4,$4)`, [ids.asset, organizationId, seeded.member.id, at]);
  await pool.query(`INSERT INTO asset_versions
    (id,asset_id,organization_id,version_number,status,object_key,original_filename,expected_content_type,expected_size,expected_checksum_sha256,verified_content_type,verified_size,verified_checksum_sha256,verified_at,created_at,updated_at)
    VALUES ($1,$2,$3,1,'available','a13/work.mp4','a13.mp4','video/mp4',42,$4,'video/mp4',42,$4,$5,$5,$5)`, [ids.assetVersion, ids.asset, organizationId, checksum, at]);
  await pool.query(`INSERT INTO works
    (id,organization_id,production_order_id,execution_attempt_id,manual_execution_report_id,package_id,package_version,manifest_hash,video_plan_version_id,copy_version_id,avatar_asset_version_id,production_config_snapshot,package_manifest_snapshot,primary_asset_version_id,primary_candidate_id,primary_output_checksum,primary_output_media_type,primary_output_size,status,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,1,'manifest-a13',$7,$8,$9,'{}','{}',$10,$11,$12,'video/mp4',42,'available',$13,$13)`, [ids.work, organizationId, ids.order, ids.attempt, ids.report, ids.package, ids.plan, ids.copy, ids.avatarVersion, ids.assetVersion, ids.candidate, checksum, at]);
  await pool.query(`INSERT INTO work_verification_jobs
    (id,organization_id,type,production_order_id,execution_attempt_id,report_id,candidate_id,primary_output_checksum,
     requested_by_member_id,requested_by_role,status,verification_status,attempts,max_attempts,completed_at,work_id,receipt_key,checks,created_at,updated_at)
    VALUES ($1,$2,'artifact_verification',$3,$4,$5,$6,$7,$8,'admin','succeeded','passed',1,1,$9,$10,'a13-verification','[]',$9,$9)`,
  [ids.verificationJob, organizationId, ids.order, ids.attempt, ids.report, ids.candidate, checksum, seeded.member.id, at, ids.work]);

  const workPort = {
    async listWorks(org) { return (await pool.query("SELECT * FROM works WHERE organization_id=$1 ORDER BY created_at,id", [org])).rows; },
    async getWork(org, workId) { return (await pool.query("SELECT * FROM works WHERE organization_id=$1 AND id=$2", [org, workId])).rows[0] || null; }
  };
  const repository = createPostgresWorkDeliveryRepository({ pool });
  await repository.initialize();
  const orderPort = { async getOrder({ organizationId: requestedOrg, orderId }) {
    return (await pool.query("SELECT * FROM production_orders WHERE organization_id=$1 AND id=$2", [requestedOrg, orderId])).rows[0] || null;
  } };
  const service = createWorkDeliveryService({ repository, workPort, orderPort, now: () => Date.parse(at) });
  const actor = { organizationId, actorMemberId: seeded.member.id, actorRole: "admin" };
  const beforeProjection = await pool.query(`SELECT
    (SELECT count(*)::int FROM work_inspections) AS inspections,
    (SELECT count(*)::int FROM work_delivery_audit_events) AS audits,
    (SELECT count(*)::int FROM work_delivery_status_ledger) AS ledger`);
  const operator = createOperatorWorkspaceService({
    projectContentService: { async getProject() {
      return { id: ids.project, name: "A13 项目", products: [{ id: ids.product, current_revision_id: ids.revision,
        revision: { id: ids.revision, organization_id: organizationId, project_id: ids.project,
          product_id: ids.product, status: "ready", product_name: "A13 商品", asset_version_ids: [], selling_points: [] } }] };
    } },
    productionService: { async getOperatorWorkspace() {
      const [order, plan, packageValue, attempt, report, job, verificationWork] = await Promise.all([
        pool.query("SELECT * FROM production_orders WHERE organization_id=$1 AND id=$2", [organizationId, ids.order]).then((value) => value.rows[0]),
        pool.query("SELECT * FROM video_plan_versions WHERE organization_id=$1 AND id=$2", [organizationId, ids.plan]).then((value) => value.rows[0]),
        pool.query("SELECT * FROM manual_handoff_packages WHERE organization_id=$1 AND id=$2", [organizationId, ids.package]).then((value) => value.rows[0]),
        pool.query("SELECT * FROM manual_execution_attempts WHERE organization_id=$1 AND id=$2", [organizationId, ids.attempt]).then((value) => value.rows[0]),
        pool.query("SELECT * FROM manual_execution_reports WHERE organization_id=$1 AND id=$2", [organizationId, ids.report]).then((value) => value.rows[0]),
        pool.query("SELECT * FROM work_verification_jobs WHERE organization_id=$1 AND id=$2", [organizationId, ids.verificationJob]).then((value) => value.rows[0]),
        pool.query("SELECT * FROM works WHERE organization_id=$1 AND id=$2", [organizationId, ids.work]).then((value) => value.rows[0])
      ]);
      return { workspace: { current_plan: plan, gate: { can_create: false, reasons: [] }, orders: [order], selected_order: order },
        packages: [packageValue], execution: { order, current_attempt: attempt, attempts: [attempt], candidates: [], reports: [report] },
        verification: { order, job, work: verificationWork, works: [verificationWork] },
        work: await service.getWorkProjection({ ...actor, workId: ids.work }), read_errors: [] };
    } }
  });
  for (const stage of ["production", "product_content"]) {
    const projected = await operator.getWorkspace({ ...actor, projectId: ids.project, productId: ids.product,
      stage, orderId: ids.order });
    assert.equal(projected.stages[4].production.work.delivery_status, "pending_review");
  }
  const afterProjection = await pool.query(`SELECT
    (SELECT count(*)::int FROM work_inspections) AS inspections,
    (SELECT count(*)::int FROM work_delivery_audit_events) AS audits,
    (SELECT count(*)::int FROM work_delivery_status_ledger) AS ledger`);
  assert.deepEqual(afterProjection.rows[0], beforeProjection.rows[0]);
  const pending = (await service.listWorks(actor))[0].current_inspection;
  const passed = await service.markDeliverable({ ...actor, workId: ids.work, expectedInspectionId: pending.id, expectedRevision: pending.revision, idempotencyKey: "a13-pass" });
  assert.equal(passed.work.delivery_status, "deliverable");

  const deliveryInputs = [
    { ...actor, workId: ids.work, deliveryMethod: "email", note: "同一请求 A", idempotencyKey: "a13-concurrent",
      expectedInspectionId: passed.inspection.id, expectedRevision: passed.inspection.revision },
    { ...actor, workId: ids.work, deliveryMethod: "email", note: "同一请求 B", idempotencyKey: "a13-concurrent",
      expectedInspectionId: passed.inspection.id, expectedRevision: passed.inspection.revision }
  ];
  const concurrent = await Promise.allSettled(deliveryInputs.map((input) => service.createDelivery(input)));
  assert.equal(concurrent.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter((result) => result.status === "rejected")[0]?.reason?.code, "IDEMPOTENCY_CONFLICT");
  const winnerIndex = concurrent.findIndex((result) => result.status === "fulfilled");
  const winnerInput = deliveryInputs[winnerIndex];
  const winner = concurrent[winnerIndex].value;
  const replay = await service.createDelivery(winnerInput);
  assert.equal(replay.replayed, true);
  assert.equal(replay.delivery.id, winner.delivery.id);
  const second = await service.createDelivery({ ...deliveryInputs[0], idempotencyKey: "a13-second-delivery", note: "第二次真实交付" });
  assert.notEqual(second.delivery.id, winner.delivery.id);
  assert.equal((await repository.listDeliveries(organizationId, ids.work)).length, 2);

  const rework = await service.requestRework({ ...actor, workId: ids.work, category: "visual_quality", reason: "画面需要重新检查", targetUpstreamStage: "video_plan", idempotencyKey: "a13-rework",
    expectedInspectionId: passed.inspection.id, expectedRevision: passed.inspection.revision });
  assert.equal(rework.work.current_inspection.status, "rework_required");
  assert.equal(rework.work.inspection_history.length, 3);
  assert.equal(rework.inspection.category, "visual_quality");
  assert.equal(rework.inspection.reason, "画面需要重新检查");
  assert.equal(rework.inspection.target_upstream_stage, "video_plan");
  assert.equal((await service.createDelivery(winnerInput)).replayed, true);

  await assert.rejects(service.markDeliverable({ ...actor, workId: ids.work, idempotencyKey: "a13-pass-after-rework",
    expectedInspectionId: rework.inspection.id, expectedRevision: rework.inspection.revision }), (error) => error.code === "WORK_DELIVERY_REWORK_BLOCKED");
  await assert.rejects(service.requestRework({ ...actor, workId: ids.work, category: "file_or_format", reason: "格式需要重新检查", targetUpstreamStage: "project_content", idempotencyKey: "a13-rework-again",
    expectedInspectionId: rework.inspection.id, expectedRevision: rework.inspection.revision }), (error) => error.code === "WORK_DELIVERY_REWORK_BLOCKED");
  const stateAfterBlocked = await repository.getInspectionState(organizationId, ids.work);
  const retainedRework = stateAfterBlocked.history.find((entry) => entry.id === rework.inspection.id);
  assert.equal(retainedRework.status, "rework_required");
  assert.equal(retainedRework.category, "visual_quality");
  assert.equal(retainedRework.reason, "画面需要重新检查");
  assert.equal(retainedRework.target_upstream_stage, "video_plan");
  await assert.rejects(pool.query("UPDATE work_inspections SET reason='篡改' WHERE id=$1", [pending.id]));
  await assert.rejects(service.createDelivery({ ...actor, workId: ids.work, deliveryMethod: "email", idempotencyKey: "a13-blocked",
    expectedInspectionId: rework.inspection.id, expectedRevision: rework.inspection.revision }), (error) => error.code === "WORK_DELIVERY_REWORK_BLOCKED");
  assert.equal((await service.getWork({ ...actor, workId: ids.work })).id, ids.work);
  await assert.rejects(service.getWork({ ...actor, organizationId: "org-other", workId: ids.work }), (error) => error.code === "WORK_DELIVERY_WORK_NOT_FOUND");
  assert.ok((await repository.listAuditEvents(organizationId)).length >= 4);
  const transitions = await repository.listStatusTransitions(organizationId);
  assert.equal(transitions.find((entry) => entry.to_status === "passed" && entry.from_status === "pending").to_status, "passed");
  assert.equal(transitions.find((entry) => entry.to_status === "rework_required" && entry.from_status === "passed").from_status, "passed");
  assert.ok(transitions.length >= 3);

  const libraryProjectId = ids.project;
  const otherProjectId = randomUUID();
  const libraryRows = Array.from({ length: 60 }, (_, index) => ({
    orderId: randomUUID(),
    workId: randomUUID(),
    projectId: index >= 54 ? otherProjectId : libraryProjectId,
    createdAt: new Date(Date.parse("2026-08-10T00:00:00.000Z") + (index + 1) * 60_000).toISOString()
  }));
  const librarySeed = await pool.connect();
  try {
    await librarySeed.query("BEGIN");
    for (const [index, row] of libraryRows.entries()) {
      await librarySeed.query(`INSERT INTO production_orders
        (id,organization_id,product_id,video_plan_version_id,execution_purpose,status,row_version,input_snapshot,status_history,created_by_member_id,created_at,updated_at)
        VALUES ($1,$2,$3,$4,'first_production','succeeded',1,$5,$6,$7,$8,$8)`,
      [row.orderId, organizationId, ids.product, ids.plan,
        JSON.stringify({ video_plan_version: { id: ids.plan }, product_revision_snapshot: {
          organization_id: organizationId, project_id: row.projectId, product_id: ids.product,
          product_name: `分页商品 ${String(index + 1).padStart(2, "0")}`
        } }), JSON.stringify([{ status: "succeeded", at: row.createdAt }]), seeded.member.id, row.createdAt]);
      await librarySeed.query(`INSERT INTO works
        (id,organization_id,production_order_id,execution_attempt_id,manual_execution_report_id,package_id,package_version,manifest_hash,
         video_plan_version_id,copy_version_id,avatar_asset_version_id,production_config_snapshot,package_manifest_snapshot,
         primary_asset_version_id,primary_candidate_id,primary_output_checksum,primary_output_media_type,primary_output_size,status,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,1,'manifest-a13',$7,$8,$9,'{}','{}',$10,$11,$12,'video/mp4',42,'available',$13,$13)`,
      [row.workId, organizationId, row.orderId, ids.attempt, ids.report, ids.package, ids.plan, ids.copy,
        ids.avatarVersion, ids.assetVersion, ids.candidate, checksum, row.createdAt]);
    }
    for (const row of libraryRows.slice(0, 7)) {
      await librarySeed.query(`INSERT INTO work_delivery_records
        (id,organization_id,work_id,delivered_by,delivered_at,delivery_method,note,recipient_reference,created_at)
        VALUES ($1,$2,$3,$4,$5,'email','分页状态筛选 fixture',NULL,$5)`,
      [randomUUID(), organizationId, row.workId, seeded.member.id, row.createdAt]);
    }
    await librarySeed.query("COMMIT");
  } catch (error) {
    await librarySeed.query("ROLLBACK");
    throw error;
  } finally {
    librarySeed.release();
  }

  const reads = { listWorks: 0, getWork: 0, getOrder: 0 };
  const boundedWorkPort = {
    async listWorks() {
      reads.listWorks += 1;
      throw new Error("paged PostgreSQL listing must not call the unbounded Work port");
    },
    async getWork(requestedOrg, workId) {
      reads.getWork += 1;
      return (await pool.query("SELECT * FROM works WHERE organization_id=$1 AND id=$2", [requestedOrg, workId])).rows[0] || null;
    }
  };
  const boundedOrderPort = {
    async getOrder({ organizationId: requestedOrg, orderId }) {
      reads.getOrder += 1;
      return (await pool.query("SELECT * FROM production_orders WHERE organization_id=$1 AND id=$2", [requestedOrg, orderId])).rows[0] || null;
    }
  };
  const libraryReadPort = createPostgresWorkLibraryReadPort({ pool });
  const pagedService = createWorkDeliveryService({ repository, workPort: boundedWorkPort, orderPort: boundedOrderPort,
    libraryReadPort, now: () => Date.parse("2026-08-11T00:00:00.000Z") });
  const resetReads = () => { reads.listWorks = 0; reads.getWork = 0; reads.getOrder = 0; };
  const assertBoundedReads = () => {
    assert.equal(reads.listWorks, 0);
    assert.ok(reads.getWork <= 6, `expected no more than 6 Work reads, got ${reads.getWork}`);
    assert.ok(reads.getOrder <= 6, `expected no more than 6 ProductionOrder reads, got ${reads.getOrder}`);
  };
  const writeCounts = async () => (await pool.query(`SELECT
    (SELECT count(*)::int FROM work_inspections WHERE organization_id=$1) AS inspections,
    (SELECT count(*)::int FROM work_delivery_audit_events WHERE organization_id=$1) AS audits,
    (SELECT count(*)::int FROM work_delivery_status_ledger WHERE organization_id=$1) AS ledger`,
  [organizationId])).rows[0];

  const beforePageOne = await writeCounts();
  resetReads();
  const pageOne = await pagedService.listWorksPage({ ...actor, page: 1, pageSize: 6 });
  assert.deepEqual(pageOne.works.map((work) => work.id), libraryRows.slice(-6).reverse().map((row) => row.workId));
  assert.deepEqual(pageOne.pagination, { page: 1, page_size: 6, total_items: 61, total_pages: 11 });
  assert.equal(pageOne.selected_work_id, null);
  assertBoundedReads();
  const afterPageOne = await writeCounts();
  assert.deepEqual({
    inspections: afterPageOne.inspections - beforePageOne.inspections,
    audits: afterPageOne.audits - beforePageOne.audits,
    ledger: afterPageOne.ledger - beforePageOne.ledger
  }, { inspections: 6, audits: 6, ledger: 6 });
  const offPageAfterFirst = await pool.query(
    "SELECT count(*)::int AS count FROM work_inspections WHERE organization_id=$1 AND work_id=ANY($2::uuid[])",
    [organizationId, libraryRows.slice(0, 54).map((row) => row.workId)]
  );
  assert.equal(offPageAfterFirst.rows[0].count, 0);

  resetReads();
  const pageTwo = await pagedService.listWorksPage({ ...actor, page: 2, pageSize: 6 });
  assert.deepEqual(pageTwo.works.map((work) => work.id), libraryRows.slice(48, 54).reverse().map((row) => row.workId));
  assert.deepEqual(pageTwo.pagination, { page: 2, page_size: 6, total_items: 61, total_pages: 11 });
  assertBoundedReads();
  const afterPageTwo = await writeCounts();
  assert.deepEqual({
    inspections: afterPageTwo.inspections - afterPageOne.inspections,
    audits: afterPageTwo.audits - afterPageOne.audits,
    ledger: afterPageTwo.ledger - afterPageOne.ledger
  }, { inspections: 6, audits: 6, ledger: 6 });

  resetReads();
  const sameProject = await pagedService.listWorksPage({ ...actor, page: 1, pageSize: 6, projectId: libraryProjectId });
  assert.deepEqual(sameProject.works.map((work) => work.id), libraryRows.slice(48, 54).reverse().map((row) => row.workId));
  assert.deepEqual(sameProject.pagination, { page: 1, page_size: 6, total_items: 55, total_pages: 10 });
  assertBoundedReads();

  resetReads();
  const otherProject = await pagedService.listWorksPage({ ...actor, page: 1, pageSize: 6, projectId: otherProjectId });
  assert.deepEqual(otherProject.works.map((work) => work.id), libraryRows.slice(-6).reverse().map((row) => row.workId));
  assert.deepEqual(otherProject.pagination, { page: 1, page_size: 6, total_items: 6, total_pages: 1 });
  assertBoundedReads();

  const beforeDelivered = await writeCounts();
  resetReads();
  const deliveredOne = await pagedService.listWorksPage({ ...actor, page: 1, pageSize: 6, deliveryStatus: "delivered" });
  assert.deepEqual(deliveredOne.works.map((work) => work.id), libraryRows.slice(1, 7).reverse().map((row) => row.workId));
  assert.deepEqual(deliveredOne.pagination, { page: 1, page_size: 6, total_items: 7, total_pages: 2 });
  assert.ok(deliveredOne.works.every((work) => work.delivery_status === "delivered"));
  assertBoundedReads();
  const afterDelivered = await writeCounts();
  assert.deepEqual({
    inspections: afterDelivered.inspections - beforeDelivered.inspections,
    audits: afterDelivered.audits - beforeDelivered.audits,
    ledger: afterDelivered.ledger - beforeDelivered.ledger
  }, { inspections: 6, audits: 6, ledger: 6 });
  assert.equal((await pool.query("SELECT count(*)::int AS count FROM work_inspections WHERE organization_id=$1 AND work_id=$2",
    [organizationId, libraryRows[0].workId])).rows[0].count, 0);

  resetReads();
  const deliveredTwo = await pagedService.listWorksPage({ ...actor, page: 2, pageSize: 6, deliveryStatus: "delivered" });
  assert.deepEqual(deliveredTwo.works.map((work) => work.id), [libraryRows[0].workId]);
  assert.equal(deliveredTwo.selected_work_id, null);
  assertBoundedReads();

  resetReads();
  const anchored = await pagedService.listWorksPage({ ...actor, pageSize: 6, anchorWorkId: libraryRows[0].workId });
  assert.equal(anchored.pagination.page, 10);
  assert.equal(anchored.selected_work_id, libraryRows[0].workId);
  assert.ok(anchored.works.some((work) => work.id === anchored.selected_work_id));
  assertBoundedReads();

  resetReads();
  const explicitPageWins = await pagedService.listWorksPage({ ...actor, page: 1, pageSize: 6, anchorWorkId: libraryRows[0].workId });
  assert.equal(explicitPageWins.pagination.page, 1);
  assert.equal(explicitPageWins.selected_work_id, null);
  assertBoundedReads();

  resetReads();
  const filteredAnchor = await pagedService.listWorksPage({ ...actor, pageSize: 6, projectId: libraryProjectId,
    anchorWorkId: libraryRows.at(-1).workId });
  assert.equal(filteredAnchor.pagination.page, 1);
  assert.equal(filteredAnchor.selected_work_id, null);
  assertBoundedReads();

  resetReads();
  const statusFilteredAnchor = await pagedService.listWorksPage({ ...actor, pageSize: 6, deliveryStatus: "delivered",
    anchorWorkId: libraryRows.at(-1).workId });
  assert.equal(statusFilteredAnchor.pagination.page, 1);
  assert.equal(statusFilteredAnchor.selected_work_id, null);
  assertBoundedReads();

  resetReads();
  const foreignAnchor = await pagedService.listWorksPage({ ...actor, pageSize: 6, anchorWorkId: randomUUID() });
  assert.equal(foreignAnchor.pagination.page, 1);
  assert.equal(foreignAnchor.selected_work_id, null);
  assertBoundedReads();
});
