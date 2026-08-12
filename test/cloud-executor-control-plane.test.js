import assert from "node:assert/strict";
import test from "node:test";

import { createCloudExecutorControlPlane } from "../src/cloud-executor/control-plane.js";
import { activateAdmin, identityApp, identityHeaders } from "./helpers/identity-world.js";

const ORGANIZATION_ID = "org-cloud-control-plane";
const EXECUTOR_ID = "cloud-executor-control-plane";

const clone = (value) => value == null ? value : structuredClone(value);

function makeWorld({ attempt, report, verification = null, work = null, nowValue = Date.parse("2026-08-12T00:00:00.000Z") } = {}) {
  const state = { verification, work };
  const repository = {
    async listAttempts(organizationId) {
      return organizationId === ORGANIZATION_ID && attempt ? [clone(attempt)] : [];
    },
    async listReports(organizationId, attemptId) {
      return organizationId === ORGANIZATION_ID && attempt?.id === attemptId && report ? [clone(report)] : [];
    }
  };
  const orderPort = {
    async getOrder(input) {
      if (input.organizationId !== ORGANIZATION_ID || input.orderId !== attempt?.production_order_id) return null;
      return {
        id: attempt.production_order_id,
        organization_id: ORGANIZATION_ID,
        status: attempt.status === "running" ? "running" : attempt.status === "succeeded" ? "succeeded" : "failed",
        execution_purpose: "first_production",
        created_at: "2026-08-12T00:00:00.000Z",
        updated_at: "2026-08-12T00:01:00.000Z",
        input_snapshot: { secret: "must-not-be-public", server_path: "/srv/private/order.json" }
      };
    }
  };
  const verificationPort = {
    async getVerificationWorkspace() {
      return {
        job: clone(state.verification),
        work: clone(state.work),
        works: state.work ? [clone(state.work)] : []
      };
    }
  };
  const deliveryPort = {
    async getWork() { return clone(state.work); }
  };
  const plane = createCloudExecutorControlPlane({
    enabled: true,
    mode: "fake",
    configured: true,
    organizationId: ORGANIZATION_ID,
    executorCloudId: EXECUTOR_ID,
    repository,
    orderPort,
    verificationPort,
    deliveryPort,
    heartbeatTimeoutMs: 15_000,
    now: () => nowValue
  });
  return {
    plane,
    state,
    advance(ms) { nowValue += ms; }
  };
}

function cloudAttempt(status, progressPhase) {
  return {
    id: "attempt-cloud-control-plane",
    organization_id: ORGANIZATION_ID,
    production_order_id: "order-cloud-control-plane",
    package_id: "package-cloud-control-plane",
    executor_type: "cloud_executor",
    executor_cloud_id: EXECUTOR_ID,
    status,
    progress_phase: progressPhase,
    row_version: 3,
    heartbeat_at: "2026-08-12T00:00:30.000Z",
    started_at: "2026-08-12T00:00:01.000Z",
    completed_at: status === "succeeded" || status === "failed" ? "2026-08-12T00:01:00.000Z" : null,
    created_at: "2026-08-12T00:00:00.000Z",
    updated_at: "2026-08-12T00:01:00.000Z",
    object_key: "cloud-executor/org-cloud-control-plane/private.mp4",
    status_history: []
  };
}

test("disabled Cloud Executor projection is fail-closed and contains only allowlisted state", async () => {
  const plane = createCloudExecutorControlPlane({ enabled: false, mode: "fail_closed" });
  const projection = await plane.getStatus({ organizationId: ORGANIZATION_ID });

  assert.equal(projection.worker.connection, "offline");
  assert.equal(projection.readiness.status, "disabled");
  assert.equal(projection.current_order, null);
  assert.equal(projection.current_attempt, null);
  assert.equal(projection.failure, null);
  assert.doesNotMatch(JSON.stringify(projection), /secret|token|profile|server|object_key|vnc|exception/i);
});

test("online busy projection exposes a controlled phase and current order/attempt without internal fields", async () => {
  const world = makeWorld({ attempt: cloudAttempt("running", "uploading_product") });
  await world.plane.reportHeartbeat({
    organizationId: ORGANIZATION_ID,
    executorCloudId: EXECUTOR_ID,
    readinessStatus: "available",
    progressPhase: "uploading_product"
  });

  const projection = await world.plane.getStatus({ organizationId: ORGANIZATION_ID, actorMemberId: "member", actorRole: "admin" });

  assert.equal(projection.worker.connection, "online");
  assert.equal(projection.readiness.status, "busy");
  assert.equal(projection.worker_state, "busy");
  assert.deepEqual(projection.current_order, {
    id: "order-cloud-control-plane",
    status: "running",
    execution_purpose: "first_production",
    created_at: "2026-08-12T00:00:00.000Z",
    updated_at: "2026-08-12T00:01:00.000Z"
  });
  assert.equal(projection.current_attempt.id, "attempt-cloud-control-plane");
  assert.equal(projection.current_attempt.progress_phase, "uploading");
  assert.equal(projection.progress.phase, "uploading");
  assert.equal(projection.progress.label, "上传素材");
  assert.doesNotMatch(JSON.stringify(projection), /private\.mp4|must-not-be-public|server_path|object_key|profile|token|vnc/i);
});

test("execution success, A12 pending/passed, and delivery remain separate states", async () => {
  const world = makeWorld({
    attempt: cloudAttempt("succeeded", "succeeded"),
    report: {
      id: "report-cloud-control-plane",
      outcome: "completed",
      primary_output: { upload_reference: "candidate-cloud-control-plane" },
      operator_note: "private report note"
    },
    verification: { id: "job-cloud-control-plane", verification_status: "queued", status: "queued" }
  });
  await world.plane.reportHeartbeat({ organizationId: ORGANIZATION_ID, executorCloudId: EXECUTOR_ID, readinessStatus: "available" });

  const pending = await world.plane.getStatus({ organizationId: ORGANIZATION_ID, actorMemberId: "member", actorRole: "admin" });
  assert.equal(pending.execution.status, "succeeded");
  assert.equal(pending.verification.status, "pending");
  assert.equal(pending.delivery.status, "not_available");
  assert.equal(pending.work, null);

  world.state.verification = { id: "job-cloud-control-plane", verification_status: "passed", status: "succeeded" };
  world.state.work = {
    id: "work-cloud-control-plane",
    organization_id: ORGANIZATION_ID,
    status: "available",
    delivery_status: "delivered",
    primary_asset_version_id: "asset-version-private",
    object_key: "private/object-key"
  };
  const delivered = await world.plane.getStatus({ organizationId: ORGANIZATION_ID, actorMemberId: "member", actorRole: "admin" });
  assert.equal(delivered.execution.status, "succeeded");
  assert.equal(delivered.verification.status, "passed");
  assert.equal(delivered.delivery.status, "delivered");
  assert.deepEqual(delivered.work, {
    id: "work-cloud-control-plane",
    status: "available",
    delivery_status: "delivered",
    preview_available: true,
    download_available: true
  });
  assert.doesNotMatch(JSON.stringify(delivered), /private report note|asset-version-private|object-key|object_key|token|profile|server|vnc/i);
});

test("terminal failure is controlled and stale heartbeat becomes offline", async () => {
  const world = makeWorld({
    attempt: cloudAttempt("failed", "playwright_execution"),
    report: {
      id: "report-cloud-control-plane-failure",
      outcome: "failed",
      failure_stage: "playwright_execution",
      requires_action_reason: "raw exception https://secret.example token=private"
    }
  });
  await world.plane.reportHeartbeat({ organizationId: ORGANIZATION_ID, executorCloudId: EXECUTOR_ID, readinessStatus: "requires_action" });

  const online = await world.plane.getStatus({ organizationId: ORGANIZATION_ID, actorMemberId: "member", actorRole: "admin" });
  assert.equal(online.worker.connection, "online");
  assert.equal(online.readiness.status, "requires_action");
  assert.equal(online.failure.code, "CLOUD_EXECUTOR_EXECUTION_FAILED");
  assert.equal(online.failure.stage, "execution");
  assert.equal(online.failure.retryable, false);
  assert.match(online.failure.message, /不会自动重试/);
  assert.doesNotMatch(JSON.stringify(online), /raw exception|secret\.example|token=private|playwright_execution/i);

  world.advance(16_000);
  const stale = await world.plane.getStatus({ organizationId: ORGANIZATION_ID, actorMemberId: "member", actorRole: "admin" });
  assert.equal(stale.worker.connection, "offline");
});

test("authenticated internal heartbeat updates the public projection and never echoes the bearer token", async (t) => {
  const rawAttempt = { id: "attempt-api-leak", organization_id: "org_test", production_order_id: "order-api-leak", executor_type: "cloud_executor", executor_cloud_id: EXECUTOR_ID, status: "running", progress_phase: "uploading_product", object_key: "private/object-key", profile_path: "/private/profile", server_path: "/private/server" };
  const cloud = {
    enabled: true,
    configured: true,
    mode: "fake",
    organizationId: "org_test",
    executorCloudId: EXECUTOR_ID,
    repository: { async listAttempts() { return [clone(rawAttempt)]; }, async listReports() { return [{ id: "report-api-leak", failure_stage: "playwright_execution", operator_note: "private note" }]; } },
    orderPort: { async getOrder() { return { id: "order-api-leak", organization_id: "org_test", status: "running", input_snapshot: { secret: "private" } }; } },
    internal: { enabled: true, organizationId: "org_test", executorCloudId: EXECUTOR_ID, token: "cloud-internal-secret" }
  };
  const { app } = await identityApp(t, { cloudExecutor: cloud });
  const auth = await activateAdmin(app);
  const headers = identityHeaders({ cookies: auth.cookies });

  const before = await app.inject({ method: "GET", url: "/api/cloud-executor/status", headers });
  assert.equal(before.statusCode, 200);
  assert.equal(before.json().worker.connection, "offline");

  const unauthorized = await app.inject({ method: "POST", url: "/internal/cloud-executor/v1/heartbeat", headers, payload: {} });
  assert.equal(unauthorized.statusCode, 401);

  const heartbeat = await app.inject({
    method: "POST",
    url: "/internal/cloud-executor/v1/heartbeat",
    headers: { ...headers, authorization: `Bearer ${cloud.internal.token}` },
    payload: { readiness_status: "available", progress_phase: "standby" }
  });
  assert.equal(heartbeat.statusCode, 200);
  assert.equal(JSON.stringify(heartbeat.json()).includes(cloud.internal.token), false);

  const after = await app.inject({ method: "GET", url: "/api/cloud-executor/status", headers });
  assert.equal(after.statusCode, 200);
  assert.equal(after.json().worker.connection, "online");
  assert.equal(after.json().readiness.status, "busy");
  assert.equal(JSON.stringify(after.json()).includes(cloud.internal.token), false);
  assert.doesNotMatch(JSON.stringify(after.json()), /private|object_key|profile|server|playwright_execution|token/i);
  assert.equal(after.json().current_attempt.progress_phase, "uploading");
});
