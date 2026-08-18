import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createCloudExecutorService } from "../src/cloud-executor/cloud-executor-service.js";
import { createCloudExecutorWorker } from "../src/cloud-executor/cloud-executor-worker.js";
import { createCloudExecutorConfig } from "../src/cloud-executor/config.js";
import { createCloudExecutorRuntime } from "../src/cloud-executor/runtime.js";
import { startCloudExecutorRuntime } from "../src/cloud-executor/start.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createMemoryManualExecutionRepository } from "../src/manual-execution/memory-manual-execution-repository.js";

const ORGANIZATION_ID = "org-cloud";
const CLOUD_EXECUTOR_ID = "cloud-executor-1";

const clone = (value) => value == null ? value : structuredClone(value);

function attempt({ id, executorType, operatorId = null, executorAgentId = null, executorCloudId = null }) {
  return {
    id, organization_id: ORGANIZATION_ID, production_order_id: `order-${id}`, package_id: `package-${id}`,
    package_version: 1, manifest_hash: `manifest-${id}`, package_hash: null, executor_type: executorType,
    operator_id: operatorId, executor_agent_id: executorAgentId, executor_cloud_id: executorCloudId,
    status: "claimed", row_version: 1, claimed_at: "2026-08-12T00:00:00.000Z", started_at: null,
    completed_at: null, created_at: "2026-08-12T00:00:00.000Z", updated_at: "2026-08-12T00:00:00.000Z",
    status_history: [{ status: "claimed", at: "2026-08-12T00:00:00.000Z" }]
  };
}

test("execution attempt identity keeps manual, local_agent, and cloud_executor disjoint", async () => {
  const repository = createMemoryManualExecutionRepository();
  for (const value of [
    attempt({ id: "manual", executorType: "manual", operatorId: "member-1" }),
    attempt({ id: "local", executorType: "local_agent", executorAgentId: "agent-1" }),
    attempt({ id: "cloud", executorType: "cloud_executor", executorCloudId: CLOUD_EXECUTOR_ID })
  ]) {
    const saved = await repository.claimAttempt({
      receiptKey: `receipt-${value.id}`, fingerprint: value.id, attempt: value,
      transitionOrder: async () => ({ id: value.production_order_id }), audit: null
    });
    assert.equal(saved.attempt.executor_type, value.executor_type);
  }

  await assert.rejects(
    repository.claimAttempt({
      receiptKey: "receipt-invalid", fingerprint: "invalid",
      attempt: attempt({ id: "invalid", executorType: "cloud_executor", executorCloudId: CLOUD_EXECUTOR_ID, executorAgentId: "agent-1" }),
      transitionOrder: async () => ({ id: "order-invalid" }), audit: null
    }),
    { code: "MANUAL_EXECUTION_ATTEMPT_IDENTITY_INVALID" }
  );
});

function makeCloudWorld({ enabled = true, mode = "fake", readiness = { ready: true }, executorResult = { body: Buffer.from("x") }, executor = null,
  orderCount = 1, leaseMs = 30_000, heartbeatIntervalMs = 5_000, nowValue = Date.parse("2026-08-12T00:00:00.000Z") } = {}) {
  const order = {
    id: "order-cloud-1", organization_id: ORGANIZATION_ID, status: "waiting_for_executor", row_version: 1,
    created_by_member_id: "member-owner", input_snapshot: {}, status_history: []
  };
  const orders = Array.from({ length: orderCount }, (_, index) => ({ ...order, id: `order-cloud-${index + 1}` }));
  const packages = new Map(orders.map((value, index) => [value.id, {
    ...packageRecordFor(value.id, index + 1)
  }]));
  let listCalls = 0;
  let transitionCalls = 0;
  const orderPort = {
    async listOrdersForCloudExecutor() { listCalls += 1; return orders.map(clone); },
    async getOrderForCloudExecutor(input) { return clone(orders.find((value) => value.id === input.orderId)); },
    async transitionOrderForCloudExecutor(input) {
      transitionCalls += 1;
      const selected = orders.find((value) => value.id === input.orderId);
      if (!selected || input.expectedRevision !== selected.row_version || !input.fromStatuses.includes(selected.status)) return null;
      selected.status = input.toStatus;
      selected.row_version += 1;
      return clone(selected);
    }
  };
  const packagePort = {
    async listPackagesForCloudExecutor(input) { return packages.has(input.productionOrderId) ? [clone(packages.get(input.productionOrderId))] : []; },
    async getPackageForCloudExecutor(input) {
      const value = [...packages.values()].find((candidate) => candidate.id === input.packageId);
      return clone(value);
    },
    async downloadPackageForCloudExecutor(input) {
      const value = [...packages.values()].find((candidate) => candidate.id === input.packageId);
      return value ? {
        body: Buffer.from("sensitive-package-marker https://private.example/package"),
        contentType: "application/zip",
        privateUrl: "https://private.example/package"
      } : null;
    }
  };
  const repository = createMemoryManualExecutionRepository();
  const candidateStore = createMemoryObjectStore();
  const verificationCalls = [];
  const readinessPort = { async check() { return readiness; } };
  const verificationPort = {
    async requestVerification(input) { verificationCalls.push(input); return { job: { id: `job-${verificationCalls.length}` }, replayed: false }; },
    async wake() { verificationCalls.push({ wake: true }); }
  };
  const selectedExecutor = executor || { async run() { return executorResult; } };
  const serviceOptions = {
    enabled, mode, organizationId: ORGANIZATION_ID, executorCloudId: CLOUD_EXECUTOR_ID,
    repository, orderPort, packagePort, candidateStore, readinessPort, verificationPort,
    executor: selectedExecutor, leaseMs, heartbeatIntervalMs, now: () => nowValue
  };
  const service = createCloudExecutorService(serviceOptions);
  return { service, order: orders[0], orders, packages, repository, candidateStore, verificationCalls,
    orderPort, packagePort, runtimeOptions: {
      config: { enabled, configured: enabled && mode === "fake", mode, organizationId: ORGANIZATION_ID,
        executorCloudId: CLOUD_EXECUTOR_ID, worker: { pollIntervalMs: 1, leaseMs, heartbeatIntervalMs } },
      repository, orderPort, packagePort, candidateStore, readinessPort, verificationPort, executor: selectedExecutor,
      now: () => nowValue
    },
    advance(ms) { nowValue += ms; }, get listCalls() { return listCalls; },
    get transitionCalls() { return transitionCalls; } };
}

function packageRecordFor(orderId, index) {
  return {
    id: `package-cloud-${index}`, organization_id: ORGANIZATION_ID, production_order_id: orderId,
    package_version: 1, manifest_hash: `manifest-cloud-${index}`, package_hash: `package-cloud-${index}`, status: "ready",
    manifest: { accepted_media_types: ["video/mp4"] }
  };
}

function throwingHeartbeatRace(error) {
  let releaseHeartbeat;
  let signalHeartbeatStarted;
  let signalHeartbeatFinished;
  const heartbeatRelease = new Promise((resolve) => { releaseHeartbeat = resolve; });
  const heartbeatStarted = new Promise((resolve) => { signalHeartbeatStarted = resolve; });
  const heartbeatFinished = new Promise((resolve) => { signalHeartbeatFinished = resolve; });
  const reportErrors = [];
  return {
    reportErrors,
    executor: {
      async run({ progress }) {
        void progress({ phase: "provider_submitted" });
        await heartbeatStarted;
        setTimeout(releaseHeartbeat, 0);
        throw error;
      }
    },
    install(repository) {
      const heartbeatCloudAttempt = repository.heartbeatCloudAttempt.bind(repository);
      const saveReport = repository.saveReport.bind(repository);
      repository.heartbeatCloudAttempt = async (input) => {
        signalHeartbeatStarted();
        await heartbeatRelease;
        try {
          return await heartbeatCloudAttempt(input);
        } finally {
          signalHeartbeatFinished();
        }
      };
      repository.saveReport = async (input) => {
        await heartbeatFinished;
        try {
          return await saveReport(input);
        } catch (caught) {
          reportErrors.push(caught?.code);
          throw caught;
        }
      };
    }
  };
}

test("disabled cloud executor is fail-closed before readiness or claim", async () => {
  const world = makeCloudWorld({ enabled: false, mode: "fail_closed" });
  const result = await world.service.runOnce();
  assert.equal(result.status, "disabled");
  assert.equal(world.listCalls, 0);
  assert.equal(world.transitionCalls, 0);
});

test("cloud readiness is evaluated before any order claim", async () => {
  const world = makeCloudWorld({ readiness: { ready: false, status: "requires_login", reason: "session-detail=private-value" } });
  const result = await world.service.runOnce();
  assert.equal(result.status, "requires_login");
  assert.equal(result.reason, undefined);
  assert.doesNotMatch(JSON.stringify(result), /private-value|session-detail/i);
  assert.equal(world.listCalls, 0);
  assert.equal(world.transitionCalls, 0);
});

test("low persistent storage blocks before listing, claiming, or creating an attempt", async () => {
  const world = makeCloudWorld({ readiness: { ready: false, status: "storage_blocked", reason: "absolute path must stay private" } });
  const result = await world.service.runOnce();
  assert.equal(result.status, "storage_blocked");
  assert.equal(result.reason, undefined);
  assert.equal(world.listCalls, 0);
  assert.equal(world.transitionCalls, 0);
  assert.equal((await world.repository.listAttempts(ORGANIZATION_ID)).length, 0);
});

test("missing or expired Provider session maps to requires_login before claim", async () => {
  for (const sessionState of ["missing", "expired"]) {
    const world = makeCloudWorld({ mode: "playwright", executor: {
      async preflight() {
        throw Object.assign(new Error("login details must stay private"), {
          code: "LOGIN_REQUIRED",
          sessionState
        });
      },
      async run() {
        throw new Error("login readiness must stop before execution");
      }
    } });
    const runtime = createCloudExecutorRuntime({
      ...world.runtimeOptions,
      readinessPort: null,
      config: { ...world.runtimeOptions.config, configured: true }
    });

    const result = await runtime.runOnce();
    assert.equal(result.status, "requires_login");
    assert.equal(result.ready, false);
    assert.equal(world.listCalls, 0, sessionState);
    assert.equal(world.transitionCalls, 0, sessionState);
    assert.doesNotMatch(JSON.stringify(result), /login details|sessionState|cookie|token|profile/i);
    await runtime.close();
  }
});

test("standalone Cloud Executor runtime owns fake service and worker without starting on construction", async () => {
  const world = makeCloudWorld();
  const runtime = createCloudExecutorRuntime(world.runtimeOptions);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(world.listCalls, 0);
  assert.equal(runtime.executorType, "cloud_executor");
  assert.equal(typeof runtime.service.runOnce, "function");
  assert.equal(typeof runtime.worker.runNext, "function");

  const result = await runtime.runOnce();
  assert.equal(result.status, "succeeded");
  assert.equal(world.listCalls, 1);
  await runtime.close();
});

test("standalone runtime entrypoint requires explicit config and stays fail-closed when disabled", async () => {
  assert.throws(() => createCloudExecutorRuntime(), { code: "CLOUD_EXECUTOR_RUNTIME_CONFIG_REQUIRED" });
  const { runtime, startup } = await startCloudExecutorRuntime({ config: { enabled: false, mode: "fail_closed" } });
  assert.equal(startup.status, "disabled");
  assert.equal(runtime.status, "disabled");
  assert.equal(runtime.service, null);
  assert.equal(runtime.worker, null);
  await runtime.close();
});

test("fake success claims one order, reports a cloud identity, and triggers A12 once", async () => {
  const world = makeCloudWorld({ orderCount: 2 });
  const result = await world.service.runOnce();
  assert.equal(result.status, "succeeded");
  assert.equal(result.attempt.executor_type, "cloud_executor");
  assert.equal(result.attempt.executor_cloud_id, CLOUD_EXECUTOR_ID);
  assert.equal(result.attempt.executor_agent_id, null);
  assert.equal(result.report.submitted_by, null);
  assert.equal(result.report.submitted_by_agent_id, null);
  assert.equal(result.report.submitted_by_cloud_executor_id, CLOUD_EXECUTOR_ID);
  assert.equal(world.order.status, "running");
  assert.equal(world.orders[1].status, "waiting_for_executor");
  assert.equal(world.verificationCalls.filter((value) => value.productionOrderId).length, 1);
  assert.equal(world.verificationCalls.filter((value) => value.wake).length, 1);

  const candidates = await world.repository.listCandidates(ORGANIZATION_ID, result.attempt.id);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].uploaded_by_cloud_executor_id, CLOUD_EXECUTOR_ID);
  assert.equal(candidates[0].uploaded_by_agent_id, null);
  assert.equal(candidates[0].status, "pending_verification");
});

test("fake failure stops the worker and never claims the next order", async () => {
  const world = makeCloudWorld({ orderCount: 2, executorResult: { ok: false, failureStage: "fake_execution" } });
  const first = await world.service.runOnce();
  assert.equal(first.status, "failed");
  assert.equal(first.stopped, true);
  assert.equal(world.order.status, "failed");
  assert.equal(world.orders[1].status, "waiting_for_executor");
  const callsAfterFailure = world.listCalls;
  const second = await world.service.runOnce();
  assert.equal(second.status, "halted");
  assert.equal(world.listCalls, callsAfterFailure);

  const workerWorld = makeCloudWorld({ orderCount: 2, executorResult: { ok: false, failureStage: "fake_execution" } });
  const worker = createCloudExecutorWorker({ service: workerWorld.service, pollIntervalMs: 1 });
  worker.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  worker.stop();
  assert.equal(worker.halted, true);
  assert.equal(workerWorld.orders[1].status, "waiting_for_executor");
});

test("uncertain post-submit outcome requires action, stops the worker, and never retries Provider submission", async () => {
  let providerCalls = 0;
  const world = makeCloudWorld({ orderCount: 2, executor: {
    async run() {
      providerCalls += 1;
      return {
        status: "requires_action",
        failureStage: "unknown_post_submit",
        requiresActionReason: "Provider submission outcome is ambiguous"
      };
    }
  } });

  const first = await world.service.runOnce();
  const second = await world.service.runOnce();

  assert.equal(first.status, "requires_action");
  assert.equal(first.stopped, true);
  assert.equal(second.status, "halted");
  assert.equal(providerCalls, 1);
  assert.equal(world.order.status, "requires_action");
  assert.equal(world.orders[1].status, "waiting_for_executor");
  assert.equal(first.report.outcome, "requires_action");
  assert.equal(first.report.retryability, "not_retryable");
  assert.equal(first.report.failure_stage, "unknown_post_submit");
});

test("playwright mode downloads the claimed package archive for the executor without projecting its contents", async () => {
  let received;
  const world = makeCloudWorld({ mode: "playwright", executor: {
    async run(input) {
      received = input;
      return { body: Buffer.from("video") };
    }
  } });

  const result = await world.service.runOnce();

  assert.equal(received.packageArchive.body.toString(), "sensitive-package-marker https://private.example/package");
  assert.equal(received.packageArchive.contentType, "application/zip");
  assert.equal(received.packageArchive.privateUrl, undefined);
  assert.equal(/sensitive-package-marker|private\.example/i.test(JSON.stringify(result)), false);
  assert.equal(result.status, "succeeded");
});

test("an unexpected fake executor error is terminal and records a failed report", async () => {
  const world = makeCloudWorld({ orderCount: 2, executor: { async run() { throw new Error("fake failure"); } } });
  const result = await world.service.runOnce();
  assert.equal(result.status, "failed");
  assert.equal(result.stopped, true);
  assert.equal(result.report.failure_stage, "fake_execution");
  assert.equal(world.order.status, "failed");
  assert.equal(world.orders[1].status, "waiting_for_executor");
});

test("queued heartbeat is drained before an executor exception records one failed report", async () => {
  const race = throwingHeartbeatRace(new Error("fake failure"));
  const world = makeCloudWorld({ executor: race.executor });
  race.install(world.repository);

  const result = await world.service.runOnce();

  assert.deepEqual(race.reportErrors, []);
  assert.equal(result.status, "failed");
  const attempts = await world.repository.listAttempts(ORGANIZATION_ID, world.order.id);
  const reports = await world.repository.listReports(ORGANIZATION_ID, attempts[0].id);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, "failed");
  assert.equal(reports.length, 1);
  assert.equal(reports[0].outcome, "failed");
  assert.equal(world.verificationCalls.length, 0);
});

test("queued heartbeat is drained before a post-submit exception requires action once", async () => {
  const race = throwingHeartbeatRace(Object.assign(new Error("unknown post-submit result"), {
    code: "CLOUD_EXECUTOR_POST_SUBMIT_UNKNOWN"
  }));
  const world = makeCloudWorld({ executor: race.executor });
  race.install(world.repository);

  const result = await world.service.runOnce();

  assert.deepEqual(race.reportErrors, []);
  assert.equal(result.status, "requires_action");
  const attempts = await world.repository.listAttempts(ORGANIZATION_ID, world.order.id);
  const reports = await world.repository.listReports(ORGANIZATION_ID, attempts[0].id);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, "requires_action");
  assert.equal(reports.length, 1);
  assert.equal(reports[0].outcome, "requires_action");
  assert.equal(reports[0].failure_stage, "unknown_post_submit");
  assert.equal(world.verificationCalls.length, 0);
});

test("heartbeat gate failure after an executor exception writes no terminal report", async () => {
  const world = makeCloudWorld({ executor: {
    async run({ progress }) {
      await assert.rejects(progress({ phase: "provider_submitted" }));
      throw new Error("executor failure after heartbeat failure");
    }
  } });
  world.repository.heartbeatCloudAttempt = async () => {
    throw Object.assign(new Error("heartbeat conflict"), { code: "MANUAL_EXECUTION_ATTEMPT_CONFLICT" });
  };

  await assert.rejects(world.service.runOnce(), { code: "CLOUD_EXECUTOR_LEASE_LOST" });

  const attempts = await world.repository.listAttempts(ORGANIZATION_ID, world.order.id);
  const reports = await world.repository.listReports(ORGANIZATION_ID, attempts[0].id);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, "running");
  assert.equal(reports.length, 0);
  assert.equal(world.verificationCalls.length, 0);
});

test("terminal heartbeat gate read failure loses the lease and writes no report", async () => {
  const world = makeCloudWorld({ executor: { async run() { throw new Error("fake failure"); } } });
  const getAttempt = world.repository.getAttempt.bind(world.repository);
  const saveReport = world.repository.saveReport.bind(world.repository);
  let getAttemptCalls = 0;
  let saveReportCalls = 0;
  world.repository.getAttempt = async (...args) => {
    getAttemptCalls += 1;
    if (getAttemptCalls === 1) {
      throw Object.assign(new Error("attempt read unavailable"), { code: "ATTEMPT_READ_FAILED" });
    }
    return getAttempt(...args);
  };
  world.repository.saveReport = async (input) => {
    saveReportCalls += 1;
    return saveReport(input);
  };

  await assert.rejects(world.service.runOnce(), { code: "CLOUD_EXECUTOR_LEASE_LOST" });

  const attempts = await world.repository.listAttempts(ORGANIZATION_ID, world.order.id);
  const reports = await world.repository.listReports(ORGANIZATION_ID, attempts[0].id);
  assert.equal(saveReportCalls, 0);
  assert.equal(attempts[0].status, "running");
  assert.equal(reports.length, 0);
});

test("terminal heartbeat gate ownership mismatch loses the lease and writes no report", async () => {
  const world = makeCloudWorld({ executor: { async run() { throw new Error("fake failure"); } } });
  const getAttempt = world.repository.getAttempt.bind(world.repository);
  const saveReport = world.repository.saveReport.bind(world.repository);
  let getAttemptCalls = 0;
  let saveReportCalls = 0;
  world.repository.getAttempt = async (...args) => {
    getAttemptCalls += 1;
    const current = await getAttempt(...args);
    if (getAttemptCalls === 1) return { ...current, executor_cloud_id: "different-cloud-executor" };
    return current;
  };
  world.repository.saveReport = async (input) => {
    saveReportCalls += 1;
    return saveReport(input);
  };

  await assert.rejects(world.service.runOnce(), { code: "CLOUD_EXECUTOR_LEASE_LOST" });

  const attempts = await world.repository.listAttempts(ORGANIZATION_ID, world.order.id);
  const reports = await world.repository.listReports(ORGANIZATION_ID, attempts[0].id);
  assert.equal(saveReportCalls, 0);
  assert.equal(attempts[0].status, "running");
  assert.equal(reports.length, 0);
});

test("fake execution heartbeats the single leased attempt before reporting", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const world = makeCloudWorld({ heartbeatIntervalMs: 5, executor: {
    async run() {
      await gate;
      return { body: Buffer.from("heartbeat-output") };
    }
  } });
  const running = world.service.runOnce();
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();
  const result = await running;
  assert.equal(result.status, "succeeded");
  const saved = await world.repository.getAttempt(ORGANIZATION_ID, result.attempt.id);
  assert.ok(saved.row_version >= 4);
  assert.equal(saved.status, "succeeded");
});

test("candidate upload completion survives a heartbeat before the terminal report", async () => {
  const world = makeCloudWorld();
  const reportErrors = [];
  const markCandidateUploaded = world.repository.markCandidateUploaded.bind(world.repository);
  const saveReport = world.repository.saveReport.bind(world.repository);
  world.repository.markCandidateUploaded = async (input) => {
    const uploaded = await markCandidateUploaded(input);
    const current = await world.repository.getAttempt(ORGANIZATION_ID, uploaded.candidate.execution_attempt_id);
    await world.repository.heartbeatCloudAttempt({
      receiptKey: `race-heartbeat-${current.id}-${current.row_version}`,
      fingerprint: `race-heartbeat-${current.id}-${current.row_version}`,
      attemptId: current.id,
      organizationId: ORGANIZATION_ID,
      executorCloudId: CLOUD_EXECUTOR_ID,
      expectedRevision: current.row_version,
      now: "2026-08-12T00:00:01.000Z",
      leaseExpiresAt: "2026-08-12T00:00:31.000Z",
      progressPhase: "upload_completed",
      audit: null
    });
    return uploaded;
  };
  world.repository.saveReport = async (input) => {
    try {
      return await saveReport(input);
    } catch (error) {
      reportErrors.push(error?.code);
      throw error;
    }
  };

  const result = await world.service.runOnce();

  assert.deepEqual(reportErrors, []);
  assert.equal(result.status, "succeeded");
  const attempts = await world.repository.listAttempts(ORGANIZATION_ID, world.order.id);
  const reports = await world.repository.listReports(ORGANIZATION_ID, result.attempt.id);
  const candidates = await world.repository.listCandidates(ORGANIZATION_ID, result.attempt.id);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, "succeeded");
  assert.equal(reports.length, 1);
  assert.equal(reports[0].outcome, "completed");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].execution_attempt_id, attempts[0].id);
  assert.equal(candidates[0].status, "pending_verification");
  const terminalTransitions = (await world.repository.listStatusTransitions(ORGANIZATION_ID))
    .filter((value) => value.attempt_id === attempts[0].id && value.to_status === "succeeded");
  assert.equal(terminalTransitions.length, 1);
  assert.equal(world.verificationCalls.filter((value) => value.productionOrderId).length, 1);
});

test("concurrent worker polls have one in-flight claim", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const world = makeCloudWorld({ orderCount: 2 });
  const originalRun = world.service.runOnce;
  world.service.runOnce = async () => {
    await gate;
    return originalRun();
  };
  const worker = createCloudExecutorWorker({ service: world.service, pollIntervalMs: 1 });
  const first = worker.runNext();
  const second = worker.runNext();
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(secondResult, null);
  assert.equal(firstResult.status, "succeeded");
  assert.equal(world.orders.filter((value) => value.status !== "waiting_for_executor").length, 1);
});

test("cloud lease expiry becomes requires_action and never auto-creates another attempt", async () => {
  const world = makeCloudWorld({ orderCount: 2, leaseMs: 100 });
  const at = "2026-08-12T00:00:00.000Z";
  const attempt = {
    id: "cloud-expiring-attempt", organization_id: ORGANIZATION_ID, production_order_id: world.order.id,
    package_id: "package-cloud-1", package_version: 1, manifest_hash: "manifest-cloud-1", package_hash: "package-cloud-1",
    executor_type: "cloud_executor", operator_id: null, executor_agent_id: null, executor_cloud_id: CLOUD_EXECUTOR_ID,
    status: "claimed", row_version: 1, claimed_at: at, started_at: null, completed_at: null,
    lease_expires_at: "2026-08-12T00:00:00.100Z", heartbeat_at: at, progress_phase: "claimed",
    created_at: at, updated_at: at, status_history: [{ status: "claimed", at, actor_cloud_executor_id: CLOUD_EXECUTOR_ID }]
  };
  const claimed = await world.repository.claimAttempt({ receiptKey: "seed-claim", fingerprint: "seed-claim", attempt,
    transitionOrder: () => world.orderPort.transitionOrderForCloudExecutor({ organizationId: ORGANIZATION_ID, orderId: world.order.id,
      expectedRevision: 1, fromStatuses: ["waiting_for_executor"], toStatus: "claimed", at, actorCloudExecutorId: CLOUD_EXECUTOR_ID }), audit: null });
  const started = await world.repository.startAttempt({ receiptKey: "seed-start", fingerprint: "seed-start", attemptId: claimed.attempt.id,
    organizationId: ORGANIZATION_ID, expectedRevision: 1, patch: { status: "running", started_at: at, updated_at: at,
      lease_expires_at: "2026-08-12T00:00:00.100Z", heartbeat_at: at, progress_phase: "started",
      status_history: [...attempt.status_history, { status: "running", at, actor_cloud_executor_id: CLOUD_EXECUTOR_ID }] },
    transitionOrder: () => world.orderPort.transitionOrderForCloudExecutor({ organizationId: ORGANIZATION_ID, orderId: world.order.id,
      expectedRevision: 2, fromStatuses: ["claimed"], toStatus: "running", at, actorCloudExecutorId: CLOUD_EXECUTOR_ID }), audit: null });
  assert.equal(started.attempt.status, "running");
  world.advance(101);

  const expired = await world.service.runOnce();
  assert.equal(expired.status, "requires_action");
  assert.equal((await world.repository.getAttempt(ORGANIZATION_ID, attempt.id)).status, "requires_action");
  assert.equal(world.order.status, "requires_action");
  assert.equal(world.orders[1].status, "waiting_for_executor");
  assert.equal((await world.repository.listAttempts(ORGANIZATION_ID)).length, 1);
  assert.equal((await world.service.runOnce()).status, "halted");
});

test("standalone cloud executor config is disabled and fail-closed by default", () => {
  const env = {
    DATABASE_URL: "postgresql://pilot:secret@postgres:5432/hifly_pilot",
    PUBLIC_HOST: "pilot.example.test",
    PUBLIC_ORIGIN: "https://pilot.example.test",
    INITIAL_ADMIN_ENABLED: "false"
  };
  const config = createCloudExecutorConfig({ root: "/tmp/hifly-cloud-executor-test", env });
  assert.equal(config.enabled, false);
  assert.equal(config.configured, false);
  assert.equal(config.mode, "fail_closed");
  assert.equal(config.executorType, "cloud_executor");
  assert.equal(config.worker.autoStart, undefined);

  const unconfigured = createCloudExecutorConfig({ root: "/tmp/hifly-cloud-executor-test", env: {
    ...env, CLOUD_EXECUTOR_ENABLED: "true", CLOUD_EXECUTOR_MODE: "fake"
  } });
  assert.equal(unconfigured.enabled, true);
  assert.equal(unconfigured.configured, false);
  assert.equal(unconfigured.worker.autoStart, undefined);

  const configured = createCloudExecutorConfig({ root: "/tmp/hifly-cloud-executor-test", env: {
    ...env, CLOUD_EXECUTOR_ENABLED: "true", CLOUD_EXECUTOR_MODE: "fake", CLOUD_EXECUTOR_ID: CLOUD_EXECUTOR_ID,
    CLOUD_EXECUTOR_ORGANIZATION_ID: ORGANIZATION_ID
  } });
  assert.equal(configured.configured, true);
  assert.equal(configured.worker.autoStart, undefined);

  const playwright = createCloudExecutorConfig({ root: "/tmp/hifly-cloud-executor-test", env: {
    ...env, CLOUD_EXECUTOR_ENABLED: "true", CLOUD_EXECUTOR_MODE: "playwright", CLOUD_EXECUTOR_ID: CLOUD_EXECUTOR_ID,
    CLOUD_EXECUTOR_ORGANIZATION_ID: ORGANIZATION_ID, CLOUD_EXECUTOR_WORKSPACE_ROOT: "/var/lib/hifly-cloud",
    CLOUD_EXECUTOR_PROFILE_DIR: "/var/lib/hifly-profile", CLOUD_EXECUTOR_AVATAR_MAPPING_FILE: "/etc/hifly/avatar-mappings.json"
  } });
  assert.equal(playwright.configured, true);
  const workspaceRoot = path.resolve("/var/lib/hifly-cloud");
  const profileDir = path.resolve("/var/lib/hifly-profile");
  assert.equal(playwright.avatarMappingPath, path.resolve("/etc/hifly/avatar-mappings.json"));
  assert.deepEqual(playwright.workspace, {
    root: workspaceRoot,
    profileDir,
    assetsDir: path.join(workspaceRoot, "assets"),
    outputsDir: path.join(workspaceRoot, "outputs"),
    evidenceDir: path.join(workspaceRoot, "evidence")
  });
});

test("cloud executor migration adds a separate identity without relaxing existing identities", async () => {
  const migration = await readFile(new URL("../src/manual-execution/migrations/004_cloud_executor_identity.sql", import.meta.url), "utf8");
  assert.match(migration, /executor_type IN \('manual', 'local_agent', 'cloud_executor'\)/);
  assert.match(migration, /executor_cloud_id/);
  assert.match(migration, /executor_type = 'cloud_executor'/);
  assert.match(migration, /num_nonnulls\(uploaded_by_member_id, uploaded_by_agent_id, uploaded_by_cloud_executor_id\) = 1/);
  assert.match(migration, /num_nonnulls\(submitted_by, submitted_by_agent_id, submitted_by_cloud_executor_id\) = 1/);
});
