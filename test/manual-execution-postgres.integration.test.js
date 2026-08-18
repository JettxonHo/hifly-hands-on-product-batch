import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import test from "node:test";

import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createCloudExecutorService } from "../src/cloud-executor/cloud-executor-service.js";
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

test("clean PostgreSQL A11/A12 migration and repository preserve manual, local-agent, and cloud executor bindings", { skip: !connectionString }, async (t) => {
  const schema = `manual_execution_${randomUUID().replaceAll("-", "")}`;
  const adminPool = createIdentityPool({ connectionString });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = createIdentityPool({ connectionString: isolatedUrl(connectionString, schema) });
  t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`); await adminPool.end(); });
  await runIdentityMigrations(pool); await runProjectContentMigrations(pool); await runVideoPlanningMigrations(pool);
  await runProductionOrderMigrations(pool); await runManualHandoffMigrations(pool); await runManualExecutionMigrations(pool);
  assert.equal((await pool.query("SELECT max(version)::integer version FROM manual_execution_schema_migrations")).rows[0].version, 4);
  const attemptColumns = (await pool.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name='manual_execution_attempts'
      AND column_name IN ('executor_agent_id','executor_cloud_id','lease_expires_at','heartbeat_at','progress_phase')`)).rows.map((row) => row.column_name);
  assert.deepEqual(attemptColumns.sort(), ["executor_agent_id", "executor_cloud_id", "heartbeat_at", "lease_expires_at", "progress_phase"]);
  const resultIdentityColumns = (await pool.query(`SELECT table_name,column_name,is_nullable FROM information_schema.columns
    WHERE table_schema=current_schema() AND ((table_name='manual_execution_candidates' AND column_name IN ('uploaded_by_member_id','uploaded_by_agent_id','uploaded_by_cloud_executor_id'))
      OR (table_name='manual_execution_reports' AND column_name IN ('submitted_by','submitted_by_agent_id','submitted_by_cloud_executor_id')))`)).rows;
  assert.deepEqual(resultIdentityColumns.map((row) => [row.table_name, row.column_name, row.is_nullable]).sort(), [
    ["manual_execution_candidates", "uploaded_by_agent_id", "YES"],
    ["manual_execution_candidates", "uploaded_by_cloud_executor_id", "YES"], ["manual_execution_candidates", "uploaded_by_member_id", "YES"],
    ["manual_execution_reports", "submitted_by", "YES"], ["manual_execution_reports", "submitted_by_agent_id", "YES"],
    ["manual_execution_reports", "submitted_by_cloud_executor_id", "YES"]
  ]);
  const identityChecks = (await pool.query(`SELECT conname FROM pg_constraint WHERE connamespace=current_schema()::regnamespace
    AND conname IN ('manual_execution_candidate_uploader_identity_check','manual_execution_report_submitter_identity_check') ORDER BY conname`)).rows.map((row) => row.conname);
  assert.deepEqual(identityChecks, ["manual_execution_candidate_uploader_identity_check", "manual_execution_report_submitter_identity_check"]);

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
  const handoffClient = await pool.connect();
  try {
    await handoffClient.query("BEGIN");
    await handoffClient.query(`INSERT INTO manual_handoff_packages(id,organization_id,production_order_id,contract_type,contract_version,package_version,status,generation_request_id,generation_job_id,manifest,readme,manifest_hash,package_hash,storage_key,created_by_member_id,created_at,updated_at,row_version,status_history)
      VALUES ($1,$2,$3,'manual_handoff','1.0',1,'ready','a11-generation',$4,$5,$6,$7,$8,$9,$10,$11,$11,1,$12)`, [packageId, order.organization_id, order.id, jobId,
      JSON.stringify({ accepted_media_types: ["video/mp4"] }), "说明", "manifest-pg", "package-pg", "manual-handoff/package.zip", seeded.member.id, at, JSON.stringify([{ from_status: "generating", to_status: "ready", at }])]);
    await handoffClient.query(`INSERT INTO manual_handoff_package_generation_jobs(id,organization_id,package_id,type,status,attempts,max_attempts,order_snapshot,created_at,updated_at)
      VALUES ($1,$2,$3,'manual_handoff_package_generation','succeeded',1,1,$4,$5,$5)`, [jobId, order.organization_id, packageId, JSON.stringify(snapshot), at]);
    await handoffClient.query("COMMIT");
  } catch (error) {
    await handoffClient.query("ROLLBACK");
    throw error;
  } finally {
    handoffClient.release();
  }

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

  const cloudOrderId = randomUUID(), cloudPackageId = randomUUID(), cloudJobId = randomUUID();
  const cloudOrder = { ...order, id: cloudOrderId, status: "waiting_for_executor", row_version: 1,
    status_history: [{ status: "waiting_for_executor", at }] };
  await orderRepository.createOrder({ receiptKey: "cloud-order", fingerprint: "cloud-order", order: cloudOrder,
    auditEvents: [{ id: randomUUID(), organization_id: cloudOrder.organization_id, actor_member_id: seeded.member.id,
      production_order_id: cloudOrder.id, event_type: "production_order.created", metadata: {}, created_at: at }],
    outboxEvent: { id: randomUUID(), organization_id: cloudOrder.organization_id, aggregate_id: cloudOrder.id,
      event_type: "production_order.created", payload: {}, created_at: at, published_at: null } });
  const cloudHandoffClient = await pool.connect();
  try {
    await cloudHandoffClient.query("BEGIN");
    await cloudHandoffClient.query(`INSERT INTO manual_handoff_packages(id,organization_id,production_order_id,contract_type,contract_version,package_version,status,generation_request_id,generation_job_id,manifest,readme,manifest_hash,package_hash,storage_key,created_by_member_id,created_at,updated_at,row_version,status_history)
      VALUES ($1,$2,$3,'manual_handoff','1.0',1,'ready','cloud-generation',$4,$5,$6,$7,$8,$9,$10,$11,$11,1,$12)`,
    [cloudPackageId, cloudOrder.organization_id, cloudOrder.id, cloudJobId,
      JSON.stringify({ accepted_media_types: ["video/mp4"] }), "说明", "manifest-cloud-pg", "package-cloud-pg",
      "manual-handoff/cloud-package.zip", seeded.member.id, at,
      JSON.stringify([{ from_status: "generating", to_status: "ready", at }])]);
    await cloudHandoffClient.query(`INSERT INTO manual_handoff_package_generation_jobs(id,organization_id,package_id,type,status,attempts,max_attempts,order_snapshot,created_at,updated_at)
      VALUES ($1,$2,$3,'manual_handoff_package_generation','succeeded',1,1,$4,$5,$5)`,
    [cloudJobId, cloudOrder.organization_id, cloudPackageId, JSON.stringify(snapshot), at]);
    await cloudHandoffClient.query("COMMIT");
  } catch (error) {
    await cloudHandoffClient.query("ROLLBACK");
    throw error;
  } finally {
    cloudHandoffClient.release();
  }

  const executorCloudId = "cloud-executor-pg";
  const cloudReportErrors = [];
  const repositoryWithUploadHeartbeat = {
    ...repository,
    async markCandidateUploaded(input) {
      const uploadedCandidate = await repository.markCandidateUploaded(input);
      const current = await repository.getAttempt(cloudOrder.organization_id, uploadedCandidate.candidate.execution_attempt_id);
      await repository.heartbeatCloudAttempt({
        receiptKey: `pg-race-heartbeat-${current.id}-${current.row_version}`,
        fingerprint: `pg-race-heartbeat-${current.id}-${current.row_version}`,
        attemptId: current.id,
        organizationId: cloudOrder.organization_id,
        executorCloudId,
        expectedRevision: current.row_version,
        now: "2026-08-08T10:00:01.000Z",
        leaseExpiresAt: "2026-08-08T10:00:31.000Z",
        progressPhase: "upload_completed",
        audit: null
      });
      return uploadedCandidate;
    },
    async saveReport(input) {
      try {
        return await repository.saveReport(input);
      } catch (error) {
        cloudReportErrors.push(error?.code);
        throw error;
      }
    }
  };
  let verificationRequests = 0;
  const cloudService = createCloudExecutorService({
    repository: repositoryWithUploadHeartbeat,
    orderPort: {
      listOrdersForCloudExecutor: () => orderRepository.listOrders(cloudOrder.organization_id),
      getOrderForCloudExecutor: (input) => orderRepository.getOrder(cloudOrder.organization_id, input.orderId),
      transitionOrderForCloudExecutor: (input) => orderRepository.transitionOrder({
        organizationId: cloudOrder.organization_id,
        orderId: input.orderId,
        expectedRevision: input.expectedRevision,
        fromStatuses: input.fromStatuses,
        toStatus: input.toStatus,
        at: input.at,
        actorCloudExecutorId: input.actorCloudExecutorId,
        reason: input.reason
      })
    },
    packagePort: {
      async listPackagesForCloudExecutor(input) {
        return input.productionOrderId === cloudOrder.id ? [{
          id: cloudPackageId, organization_id: cloudOrder.organization_id, production_order_id: cloudOrder.id,
          package_version: 1, status: "ready", manifest_hash: "manifest-cloud-pg", package_hash: "package-cloud-pg"
        }] : [];
      },
      async getPackageForCloudExecutor() { return null; }
    },
    candidateStore: createMemoryObjectStore(),
    verificationPort: {
      async requestVerification() { verificationRequests += 1; return { job: { id: "cloud-verification-pg" }, replayed: false }; },
      async wake() {}
    },
    readinessPort: { async check() { return { ready: true }; } },
    executor: { async run() { return { body: Buffer.from("cloud-pg-candidate"), mediaType: "video/mp4" }; } },
    enabled: true,
    mode: "fake",
    organizationId: cloudOrder.organization_id,
    executorCloudId,
    heartbeatIntervalMs: 30_000,
    now: () => Date.parse(at)
  });

  const cloudResult = await cloudService.runOnce();
  assert.deepEqual(cloudReportErrors, []);
  assert.equal(cloudResult.status, "succeeded");
  const cloudAttempts = await repository.listAttempts(cloudOrder.organization_id, cloudOrder.id);
  const cloudReports = await repository.listReports(cloudOrder.organization_id, cloudAttempts[0].id);
  const cloudCandidates = await repository.listCandidates(cloudOrder.organization_id, cloudAttempts[0].id);
  assert.equal(cloudAttempts.length, 1);
  assert.equal(cloudAttempts[0].status, "succeeded");
  assert.equal(cloudReports.length, 1);
  assert.equal(cloudReports[0].outcome, "completed");
  assert.equal(cloudCandidates.length, 1);
  assert.equal(cloudCandidates[0].execution_attempt_id, cloudAttempts[0].id);
  assert.equal(cloudCandidates[0].status, "pending_verification");
  assert.equal(Number((await pool.query(`SELECT count(*) FROM manual_execution_status_ledger
    WHERE organization_id=$1 AND execution_attempt_id=$2 AND to_status='succeeded'`,
  [cloudOrder.organization_id, cloudAttempts[0].id])).rows[0].count), 1);
  assert.equal(verificationRequests, 1);
  assert.equal((await repository.listReports("org-other", cloudAttempts[0].id)).length, 0);
  assert.equal((await cloudService.runOnce()).status, "standby");
  assert.equal((await repository.listReports(cloudOrder.organization_id, cloudAttempts[0].id)).length, 1);

  const errorOrderId = randomUUID(), errorPackageId = randomUUID(), errorJobId = randomUUID();
  const errorOrder = { ...order, id: errorOrderId, status: "waiting_for_executor", row_version: 1,
    status_history: [{ status: "waiting_for_executor", at }] };
  await orderRepository.createOrder({ receiptKey: "cloud-error-order", fingerprint: "cloud-error-order", order: errorOrder,
    auditEvents: [{ id: randomUUID(), organization_id: errorOrder.organization_id, actor_member_id: seeded.member.id,
      production_order_id: errorOrder.id, event_type: "production_order.created", metadata: {}, created_at: at }],
    outboxEvent: { id: randomUUID(), organization_id: errorOrder.organization_id, aggregate_id: errorOrder.id,
      event_type: "production_order.created", payload: {}, created_at: at, published_at: null } });
  const errorHandoffClient = await pool.connect();
  try {
    await errorHandoffClient.query("BEGIN");
    await errorHandoffClient.query(`INSERT INTO manual_handoff_packages(id,organization_id,production_order_id,contract_type,contract_version,package_version,status,generation_request_id,generation_job_id,manifest,readme,manifest_hash,package_hash,storage_key,created_by_member_id,created_at,updated_at,row_version,status_history)
      VALUES ($1,$2,$3,'manual_handoff','1.0',1,'ready','cloud-error-generation',$4,$5,$6,$7,$8,$9,$10,$11,$11,1,$12)`,
    [errorPackageId, errorOrder.organization_id, errorOrder.id, errorJobId,
      JSON.stringify({ accepted_media_types: ["video/mp4"] }), "说明", "manifest-cloud-error-pg", "package-cloud-error-pg",
      "manual-handoff/cloud-error-package.zip", seeded.member.id, at,
      JSON.stringify([{ from_status: "generating", to_status: "ready", at }])]);
    await errorHandoffClient.query(`INSERT INTO manual_handoff_package_generation_jobs(id,organization_id,package_id,type,status,attempts,max_attempts,order_snapshot,created_at,updated_at)
      VALUES ($1,$2,$3,'manual_handoff_package_generation','succeeded',1,1,$4,$5,$5)`,
    [errorJobId, errorOrder.organization_id, errorPackageId, JSON.stringify(snapshot), at]);
    await errorHandoffClient.query("COMMIT");
  } catch (error) {
    await errorHandoffClient.query("ROLLBACK");
    throw error;
  } finally {
    errorHandoffClient.release();
  }

  let releaseErrorHeartbeat;
  let signalErrorHeartbeatStarted;
  let signalErrorHeartbeatFinished;
  const errorHeartbeatRelease = new Promise((resolve) => { releaseErrorHeartbeat = resolve; });
  const errorHeartbeatStarted = new Promise((resolve) => { signalErrorHeartbeatStarted = resolve; });
  const errorHeartbeatFinished = new Promise((resolve) => { signalErrorHeartbeatFinished = resolve; });
  const errorReportErrors = [];
  const repositoryWithErrorHeartbeat = {
    ...repository,
    async heartbeatCloudAttempt(input) {
      signalErrorHeartbeatStarted();
      await errorHeartbeatRelease;
      try {
        return await repository.heartbeatCloudAttempt(input);
      } finally {
        signalErrorHeartbeatFinished();
      }
    },
    async saveReport(input) {
      await errorHeartbeatFinished;
      try {
        return await repository.saveReport(input);
      } catch (error) {
        errorReportErrors.push(error?.code);
        throw error;
      }
    }
  };
  const errorCloudService = createCloudExecutorService({
    repository: repositoryWithErrorHeartbeat,
    orderPort: {
      listOrdersForCloudExecutor: () => orderRepository.listOrders(errorOrder.organization_id),
      getOrderForCloudExecutor: (input) => orderRepository.getOrder(errorOrder.organization_id, input.orderId),
      transitionOrderForCloudExecutor: (input) => orderRepository.transitionOrder({
        organizationId: errorOrder.organization_id,
        orderId: input.orderId,
        expectedRevision: input.expectedRevision,
        fromStatuses: input.fromStatuses,
        toStatus: input.toStatus,
        at: input.at,
        actorCloudExecutorId: input.actorCloudExecutorId,
        reason: input.reason
      })
    },
    packagePort: {
      async listPackagesForCloudExecutor(input) {
        return input.productionOrderId === errorOrder.id ? [{
          id: errorPackageId, organization_id: errorOrder.organization_id, production_order_id: errorOrder.id,
          package_version: 1, status: "ready", manifest_hash: "manifest-cloud-error-pg", package_hash: "package-cloud-error-pg"
        }] : [];
      },
      async getPackageForCloudExecutor() { return null; }
    },
    candidateStore: createMemoryObjectStore(),
    verificationPort: { async requestVerification() { throw new Error("verification must not run"); }, async wake() {} },
    readinessPort: { async check() { return { ready: true }; } },
    executor: {
      async run({ progress }) {
        void progress({ phase: "provider_submitted" });
        await errorHeartbeatStarted;
        setTimeout(releaseErrorHeartbeat, 0);
        throw new Error("deterministic PostgreSQL executor failure");
      }
    },
    enabled: true,
    mode: "fake",
    organizationId: errorOrder.organization_id,
    executorCloudId,
    heartbeatIntervalMs: 30_000,
    now: () => Date.parse(at)
  });

  const errorCloudResult = await errorCloudService.runOnce();
  assert.deepEqual(errorReportErrors, []);
  assert.equal(errorCloudResult.status, "failed");
  const errorAttempts = await repository.listAttempts(errorOrder.organization_id, errorOrder.id);
  const errorReports = await repository.listReports(errorOrder.organization_id, errorAttempts[0].id);
  assert.equal(errorAttempts.length, 1);
  assert.equal(errorAttempts[0].status, "failed");
  assert.equal(errorReports.length, 1);
  assert.equal(errorReports[0].outcome, "failed");
  await repository.close();
});
