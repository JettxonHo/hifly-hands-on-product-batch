import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createMemoryAvatarSelectionRepository } from "../src/avatar-selection/memory-avatar-selection-repository.js";
import { createControlledCopyProvider } from "../src/copy-generation/controlled-provider.js";
import { createMemoryCopyGenerationRepository } from "../src/copy-generation/memory-copy-generation-repository.js";
import { createControlledQualityEvaluator } from "../src/copy-quality/controlled-evaluator.js";
import { createControlledCopyRewriter } from "../src/copy-quality/controlled-rewriter.js";
import { createMemoryCopyQualityRepository } from "../src/copy-quality/memory-copy-quality-repository.js";
import { createMemoryCopyReviewRepository } from "../src/copy-review/memory-copy-review-repository.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { createMemoryIdentityRepository } from "../src/identity/memory-identity-repository.js";
import { createMemoryManualExecutionRepository } from "../src/manual-execution/memory-manual-execution-repository.js";
import { createMemoryManualHandoffRepository } from "../src/manual-handoff/memory-manual-handoff-repository.js";
import { createMemoryProductionOrderRepository } from "../src/production-orders/memory-production-order-repository.js";
import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
import { buildApp } from "../src/server/app.js";
import { createMemoryVideoPlanningRepository } from "../src/video-planning/memory-video-planning-repository.js";
import {
  PRODUCTION_FEATURES,
  createProductionConfig,
  createProductionExecutor
} from "../src/server/production-config.js";
import { startProductionServer } from "../src/server/production-start.js";

function migrationProbePool() {
  return {
    connectCalls: 0,
    queryCalls: 0,
    async connect() {
      this.connectCalls += 1;
      throw new Error("startup migration must not acquire a migration client");
    },
    async query(sql) {
      this.queryCalls += 1;
      const version = String(sql).includes("work_verification_schema_migrations") ? 2 : 1;
      return { rows: [{ version }], rowCount: 1 };
    },
    async end() {}
  };
}

async function productionFeatureOptions({ localAgentExecution = null } = {}) {
  const objectStore = createMemoryObjectStore();
  return {
    assets: {
      enabled: true,
      repository: createMemoryAssetRepository(),
      objectStore,
      worker: { autoStart: false }
    },
    projectContent: {
      enabled: true,
      repository: createMemoryProjectContentRepository()
    },
    copyGeneration: {
      enabled: true,
      repository: createMemoryCopyGenerationRepository(),
      provider: createControlledCopyProvider(),
      worker: { autoStart: false }
    },
    copyQuality: {
      enabled: true,
      repository: createMemoryCopyQualityRepository(),
      evaluator: createControlledQualityEvaluator(),
      rewriter: createControlledCopyRewriter(),
      worker: { autoStart: false }
    },
    copyReview: {
      enabled: true,
      repository: createMemoryCopyReviewRepository()
    },
    avatarSelection: {
      enabled: true,
      repository: createMemoryAvatarSelectionRepository()
    },
    videoPlanning: {
      enabled: true,
      repository: createMemoryVideoPlanningRepository(),
      worker: { autoStart: false }
    },
    productionOrders: {
      enabled: true,
      repository: createMemoryProductionOrderRepository()
    },
    manualHandoff: {
      enabled: true,
      repository: createMemoryManualHandoffRepository(),
      packageStore: objectStore,
      worker: { autoStart: false }
    },
    manualExecution: {
      enabled: true,
      repository: createMemoryManualExecutionRepository(),
      candidateStore: objectStore
    },
    ...(localAgentExecution ? { localAgentExecution } : {}),
    artifactVerification: {
      enabled: true,
      worker: { autoStart: false }
    },
    workDelivery: {
      enabled: true
    }
  };
}

function productionEnv(overrides = {}) {
  return {
    DATABASE_URL: "postgresql://pilot:secret@postgres:5432/hifly_pilot",
    PUBLIC_HOST: "pilot.example.test",
    PUBLIC_ORIGIN: "https://pilot.example.test",
    PORT: "4300",
    INITIAL_ADMIN_EMAIL: "admin@pilot.example.test",
    INITIAL_ADMIN_PASSWORD: "Pilot-Initial-Password-9!",
    INITIAL_ORGANIZATION_ID: "org_pilot",
    INITIAL_ORGANIZATION_NAME: "Pilot Organization",
    ...overrides
  };
}

test("production build disables database startup migrations but still checks repository schema", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-production-build-"));
  const identity = createMemoryIdentityRepository();
  const pool = migrationProbePool();
  let app;
  t.after(async () => {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  });

  app = await buildApp({
    root,
    executor: createFakeExecutor(),
    databasePool: pool,
    startupMigrations: false,
    generationConfig: {
      executionBackend: "fake",
      rpa: { mode: "mock", realLive: { enabled: false, batch: { enabled: false } } }
    },
    identity: {
      enabled: true,
      repository: identity,
      trustedHosts: ["pilot.test"],
      trustedOrigins: ["https://pilot.test"],
      cookieSecure: true,
      seed: { enabled: false }
    },
    ...(await productionFeatureOptions())
  });

  assert.equal(pool.connectCalls, 0);
  assert.equal(pool.queryCalls, 2);
  const health = await app.inject({ method: "GET", url: "/healthz", headers: { host: "pilot.test" } });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: "ok" });

  const untrustedHealth = await app.inject({ method: "GET", url: "/healthz", headers: { host: "untrusted.test" } });
  assert.equal(untrustedHealth.statusCode, 403);
});

test("enabled local-agent wiring registers bearer routes without changing member routes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-production-agent-build-"));
  const identity = createMemoryIdentityRepository();
  const pool = migrationProbePool();
  let app;
  t.after(async () => {
    await app?.close();
    await rm(root, { recursive: true, force: true });
  });

  app = await buildApp({
    root,
    executor: createFakeExecutor(),
    databasePool: pool,
    startupMigrations: false,
    generationConfig: { executionBackend: "fake", rpa: { mode: "mock", realLive: { enabled: false, batch: { enabled: false } } } },
    identity: { enabled: true, repository: identity, trustedHosts: ["pilot.test"], trustedOrigins: ["https://pilot.test"], cookieSecure: true, seed: { enabled: false } },
    ...(await productionFeatureOptions({ localAgentExecution: { enabled: true, organizationId: "org_agent", agentId: "agent_1", token: "agent-secret", leaseMs: 10_000 } }))
  });

  assert.equal(typeof app.localAgentExecution.service.claimTask, "function");
  const heartbeat = await app.inject({ method: "POST", url: "/api/agent/v1/heartbeat", headers: {
    host: "pilot.test", authorization: "Bearer agent-secret", "idempotency-key": "agent-online", "content-type": "application/json"
  }, payload: {} });
  assert.equal(heartbeat.statusCode, 200);
  assert.equal(await app.localAgentExecution.readiness.isOnline({ organizationId: "org_agent" }), true);
  const claim = await app.inject({ method: "POST", url: "/api/agent/v1/tasks/claim", headers: {
    host: "pilot.test", authorization: "Bearer agent-secret", "idempotency-key": "agent-claim", "content-type": "application/json"
  }, payload: {} });
  assert.equal(claim.statusCode, 201);
  assert.deepEqual(claim.json(), { attempt: null, replayed: false });
  assert.equal(claim.body.includes("agent-secret"), false);
});

test("production config is env-only, enables A01-A14, and defaults execution to fail-closed", async () => {
  const config = createProductionConfig({
    root: "/tmp/hifly-production-test",
    env: productionEnv()
  });

  assert.equal(config.__configPath, undefined);
  assert.equal(config.listenHost, "0.0.0.0");
  assert.equal(config.port, 4300);
  assert.equal(config.startupMigrations, false);
  assert.equal(config.generationConfig.executionBackend, "fail_closed");
  assert.equal(config.generationConfig.rpa.realLive.enabled, false);
  assert.equal(config.generationConfig.rpa.realLive.batch.enabled, false);
  assert.equal(config.hiflyApi.enabled, false);
  assert.equal(config.localAgentExecution.enabled, false);
  assert.equal(config.localAgentExecution.token, null);
  assert.equal(config.identity.cookieSecure, true);
  assert.equal(config.featureFlags.A14, true);
  assert.equal(config.generationConfig.uploadLimits.maxBatchBytes, 128 * 1024 * 1024);
  for (const feature of PRODUCTION_FEATURES) assert.equal(config[feature].enabled, true, feature);

  const withHiflyToken = createProductionConfig({
    root: "/tmp/hifly-production-test",
    env: productionEnv({ HIFLY_API_TOKEN: "test-hifly-token" })
  });
  assert.equal(withHiflyToken.hiflyApi.enabled, true);
  assert.equal(withHiflyToken.hiflyApi.token, "test-hifly-token");

  for (const missing of ["LOCAL_AGENT_ID", "LOCAL_AGENT_ORGANIZATION_ID", "LOCAL_AGENT_TOKEN"]) {
    const env = productionEnv({
      LOCAL_AGENT_ENABLED: "true",
      LOCAL_AGENT_ID: "agent-1",
      LOCAL_AGENT_ORGANIZATION_ID: "org_pilot",
      LOCAL_AGENT_TOKEN: "local-secret"
    });
    delete env[missing];
    assert.throws(
      () => createProductionConfig({ root: "/tmp/hifly-production-test", env }),
      { code: "LOCAL_AGENT_CONFIG_REQUIRED" },
      `missing ${missing} must fail closed with a stable configuration error`
    );
  }

  const withLocalAgent = createProductionConfig({
    root: "/tmp/hifly-production-test",
    env: productionEnv({ LOCAL_AGENT_ENABLED: "true", LOCAL_AGENT_ID: "agent-1", LOCAL_AGENT_ORGANIZATION_ID: "org_pilot", LOCAL_AGENT_TOKEN: "local-secret" })
  });
  assert.equal(withLocalAgent.localAgentExecution.enabled, true);
  assert.equal(withLocalAgent.localAgentExecution.agentId, "agent-1");

  await assert.rejects(
    createProductionExecutor().createAsset({ task_id: "pilot-task" }),
    { code: "EXECUTOR_UNAVAILABLE" }
  );
});

test("production server binds once on 0.0.0.0 without opening a browser", async () => {
  const events = [];
  const pool = { async end() { events.push("pool.end"); } };
  const app = {
    async listen(options) { events.push({ type: "listen", options }); },
    async stopExecutions() { events.push("stop"); },
    async close() { events.push("close"); }
  };
  let buildOptions;
  let poolOptions;

  const server = await startProductionServer({
    root: "/tmp/hifly-production-test",
    env: productionEnv({ PORT: "4319" }),
    handleSignals: false,
    createPool(options) {
      poolOptions = options;
      return pool;
    },
    buildAppImpl: async (options) => {
      buildOptions = options;
      return app;
    }
  });

  assert.deepEqual(events, [{ type: "listen", options: { host: "0.0.0.0", port: 4319 } }]);
  assert.equal(poolOptions.connectionString, "postgresql://pilot:secret@postgres:5432/hifly_pilot");
  assert.equal(buildOptions.databasePool, pool);
  assert.equal(buildOptions.closeDatabasePool, false);
  assert.equal(buildOptions.startupMigrations, false);
  assert.equal(buildOptions.localAgentExecution.enabled, false);
  assert.equal(buildOptions.openBrowser, null);
  assert.equal(buildOptions.identity.listenHost, "0.0.0.0");
  await assert.rejects(buildOptions.executor.submitVideo({ task_id: "pilot-task" }), { code: "EXECUTOR_UNAVAILABLE" });

  await server.close();
  assert.deepEqual(events, [
    { type: "listen", options: { host: "0.0.0.0", port: 4319 } },
    "stop",
    "close",
    "pool.end"
  ]);
});

test("production server wires an optional Hifly API client without changing the executor", async () => {
  const pool = { async end() {} };
  const app = { async listen() {}, async stopExecutions() {}, async close() {} };
  let buildOptions;
  const server = await startProductionServer({
    root: "/tmp/hifly-production-test",
    env: productionEnv({ HIFLY_API_TOKEN: "test-hifly-token" }),
    handleSignals: false,
    createPool: () => pool,
    hiflyFetch: async () => new Response(JSON.stringify({ code: 0, left: 99, request_id: "req-prod" }), { status: 200 }),
    buildAppImpl: async (options) => {
      buildOptions = options;
      return app;
    }
  });

  assert.equal(buildOptions.hiflyApi.enabled, true);
  assert.deepEqual(await buildOptions.hiflyApi.client.getAccountCredit(), { left: 99, requestId: "req-prod" });
  assert.equal(buildOptions.executor.backend, "fail_closed");
  await server.close();
});

test("production server does not advance to another port after an explicit bind failure", async () => {
  let listenCalls = 0;
  const pool = { async end() {} };
  const bindError = Object.assign(new Error("address already in use"), { code: "EADDRINUSE" });
  const app = {
    async listen() {
      listenCalls += 1;
      throw bindError;
    },
    async close() {},
    async stopExecutions() {}
  };

  await assert.rejects(
    startProductionServer({
      root: "/tmp/hifly-production-test",
      env: productionEnv({ PORT: "4319" }),
      handleSignals: false,
      createPool: () => pool,
      buildAppImpl: async () => app
    }),
    { code: "EADDRINUSE" }
  );
  assert.equal(listenCalls, 1);
});
