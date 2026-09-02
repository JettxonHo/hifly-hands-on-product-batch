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
import { HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_ID } from "../src/execution-contracts/hifly-hands-on-product-v1.js";

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
      const text = String(sql);
      const version = text.includes("work_verification_schema_migrations") || text.includes("avatar_selection_schema_migrations") ? 3 :
        text.includes("asset_schema_migrations") ? 2 : 1;
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
  assert.deepEqual(untrustedHealth.json(), { error: "TRUSTED_HOST_REQUIRED" });

  const untrustedOrigin = await app.inject({
    method: "GET",
    url: "/healthz",
    headers: { host: "pilot.test", origin: "https://attacker.invalid" }
  });
  assert.equal(untrustedOrigin.statusCode, 403);
  assert.deepEqual(untrustedOrigin.json(), { error: "TRUSTED_ORIGIN_REQUIRED" });

  const intent = await app.inject({ method: "GET", url: "/api/auth/intent", headers: { host: "pilot.test" } });
  const setCookies = Array.isArray(intent.headers["set-cookie"])
    ? intent.headers["set-cookie"]
    : [String(intent.headers["set-cookie"] || "")];
  const cookieFor = (name) => setCookies.find((value) => value.startsWith(`${name}=`)) || "";
  const identityCookie = cookieFor("hifly_identity");
  const csrfCookie = cookieFor("hifly_identity_csrf");
  assert.notEqual(identityCookie, "");
  assert.notEqual(csrfCookie, "");
  assert.match(identityCookie, /;\s*HttpOnly(?:;|$)/);
  assert.match(identityCookie, /;\s*Secure(?:;|$)/);
  assert.match(identityCookie, /;\s*SameSite=Strict(?:;|$)/);
  assert.match(csrfCookie, /;\s*Secure(?:;|$)/);
  assert.match(csrfCookie, /;\s*SameSite=Strict(?:;|$)/);
});

test("web app owns only the Cloud Executor control plane and never polls or starts its Worker runtime", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-production-web-only-"));
  const identity = createMemoryIdentityRepository();
  const pool = migrationProbePool();
  let app;
  let cloudOrderPolls = 0;
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
    ...(await productionFeatureOptions()),
    cloudExecutor: {
      enabled: true,
      configured: true,
      mode: "fake",
      organizationId: "org_pilot",
      executorCloudId: "cloud-runtime-1",
      readinessPort: { async check() { return { ready: true, status: "available" }; } },
      orderPort: {
        async listOrdersForCloudExecutor() { cloudOrderPolls += 1; return []; },
        async getOrderForCloudExecutor() { return null; },
        async transitionOrderForCloudExecutor() { return null; }
      },
      packagePort: {
        async listPackagesForCloudExecutor() { return []; },
        async getPackageForCloudExecutor() { return null; }
      },
      worker: { autoStart: true, pollIntervalMs: 1, leaseMs: 30_000, heartbeatIntervalMs: 5_000 }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(cloudOrderPolls, 0);
  assert.equal(app.hasDecorator("cloudExecutor"), true);
  assert.equal(typeof app.cloudExecutor.controlPlane.getStatus, "function");
  assert.equal("worker" in app.cloudExecutor, false);
  assert.equal("service" in app.cloudExecutor, false);
  assert.equal("runOnce" in app.cloudExecutor, false);
  const status = await app.inject({ method: "GET", url: "/api/cloud-executor/status", headers: { host: "pilot.test" } });
  assert.equal(status.statusCode, 401);
  const heartbeat = await app.inject({ method: "POST", url: "/internal/cloud-executor/v1/heartbeat", headers: { host: "pilot.test", "content-type": "application/json" }, payload: {} });
  assert.equal(heartbeat.statusCode, 404);
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
  assert.equal(config.copyGeneration.provider, "phase1_controlled_test_double");
  assert.equal(config.copyGeneration.deepseek, null);
  assert.equal(config.copyQuality.evaluator, "phase1_controlled_test_double");
  assert.equal(config.copyQuality.rewriter, "phase1_controlled_test_double");
  assert.equal(config.hiflyApi.enabled, false);
  assert.equal(config.productionOrders.productionContractId, HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_ID);
  assert.deepEqual(config.operatorWorkspace, { enabled: false });
  assert.equal(config.localAgentExecution.enabled, false);
  assert.equal(config.localAgentExecution.token, null);
  assert.deepEqual(config.cloudExecutor, {
    enabled: false,
    configured: false,
    mode: "fail_closed",
    organizationId: null,
    executorCloudId: null,
    heartbeatTimeoutMs: 15_000,
    internal: { enabled: false, organizationId: null, executorCloudId: null, token: null }
  });
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

  const withOperatorWorkspace = createProductionConfig({
    root: "/tmp/hifly-production-test",
    env: productionEnv({ OPERATOR_WORKSPACE_ENABLED: "true" })
  });
  assert.deepEqual(withOperatorWorkspace.operatorWorkspace, { enabled: true });

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

  const withCloudControlPlane = createProductionConfig({
    root: "/tmp/hifly-production-test",
    env: productionEnv({
      CLOUD_EXECUTOR_ENABLED: "true",
      CLOUD_EXECUTOR_MODE: "playwright",
      CLOUD_EXECUTOR_ID: "cloud-web-1",
      CLOUD_EXECUTOR_ORGANIZATION_ID: "org_pilot",
      CLOUD_EXECUTOR_HEARTBEAT_TOKEN: "cloud-heartbeat-secret",
      CLOUD_EXECUTOR_HEARTBEAT_TIMEOUT_MS: "22000",
      CLOUD_EXECUTOR_POLL_INTERVAL_MS: "not-a-duration"
    })
  });
  assert.deepEqual(withCloudControlPlane.cloudExecutor, {
    enabled: true,
    configured: true,
    mode: "playwright",
    organizationId: "org_pilot",
    executorCloudId: "cloud-web-1",
    heartbeatTimeoutMs: 22_000,
    internal: {
      enabled: true,
      organizationId: "org_pilot",
      executorCloudId: "cloud-web-1",
      token: "cloud-heartbeat-secret"
    }
  });
  assert.equal("worker" in withCloudControlPlane.cloudExecutor, false);
  const withStandbyPairing = createProductionConfig({
    root: "/tmp/hifly-production-test",
    env: productionEnv({
      CLOUD_EXECUTOR_ENABLED: "false",
      CLOUD_EXECUTOR_MODE: "fail_closed",
      CLOUD_EXECUTOR_STANDBY_HEARTBEAT_ENABLED: "true",
      CLOUD_EXECUTOR_ID: "cloud-web-standby",
      CLOUD_EXECUTOR_ORGANIZATION_ID: "org_pilot",
      CLOUD_EXECUTOR_HEARTBEAT_TOKEN: "cloud-standby-secret"
    })
  });
  assert.equal(withStandbyPairing.cloudExecutor.enabled, false);
  assert.equal(withStandbyPairing.cloudExecutor.configured, false);
  assert.equal(withStandbyPairing.cloudExecutor.standbyHeartbeatEnabled, true);
  assert.deepEqual(withStandbyPairing.cloudExecutor.internal, {
    enabled: true,
    organizationId: "org_pilot",
    executorCloudId: "cloud-web-standby",
    token: "cloud-standby-secret"
  });
  for (const missing of ["CLOUD_EXECUTOR_ID", "CLOUD_EXECUTOR_ORGANIZATION_ID", "CLOUD_EXECUTOR_HEARTBEAT_TOKEN"]) {
    const env = productionEnv({
      CLOUD_EXECUTOR_ENABLED: "true",
      CLOUD_EXECUTOR_MODE: "playwright",
      CLOUD_EXECUTOR_ID: "cloud-web-1",
      CLOUD_EXECUTOR_ORGANIZATION_ID: "org_pilot",
      CLOUD_EXECUTOR_HEARTBEAT_TOKEN: "cloud-heartbeat-secret"
    });
    delete env[missing];
    assert.throws(
      () => createProductionConfig({ root: "/tmp/hifly-production-test", env }),
      { code: "CLOUD_EXECUTOR_CONTROL_PLANE_CONFIG_REQUIRED" },
      `missing ${missing} must fail closed before production startup`
    );
  }

  await assert.rejects(
    createProductionExecutor().createAsset({ task_id: "pilot-task" }),
    { code: "EXECUTOR_UNAVAILABLE" }
  );
});

test("production config rejects unsupported copy provider and quality evaluator values", () => {
  assert.throws(
    () => createProductionConfig({
      root: "/tmp/hifly-production-test",
      env: productionEnv({ COPY_GENERATION_PROVIDER: "unsupported" })
    }),
    { code: "COPY_GENERATION_PROVIDER_UNSUPPORTED" }
  );
  assert.throws(
    () => createProductionConfig({
      root: "/tmp/hifly-production-test",
      env: productionEnv({ COPY_QUALITY_EVALUATOR: "unsupported" })
    }),
    { code: "COPY_QUALITY_EVALUATOR_UNSUPPORTED" }
  );
  assert.throws(
    () => createProductionConfig({
      root: "/tmp/hifly-production-test",
      env: productionEnv({ COPY_QUALITY_REWRITER: "unsupported" })
    }),
    { code: "COPY_QUALITY_REWRITER_UNSUPPORTED" }
  );
});

test("production DeepSeek selection fails closed without a server-side key", async () => {
  assert.throws(
    () => createProductionConfig({
      root: "/tmp/hifly-production-test",
      env: productionEnv({ COPY_GENERATION_PROVIDER: "deepseek" })
    }),
    { code: "DEEPSEEK_API_KEY_REQUIRED" }
  );

  let poolCalls = 0;
  await assert.rejects(
    startProductionServer({
      root: "/tmp/hifly-production-test",
      env: productionEnv({ COPY_GENERATION_PROVIDER: "deepseek" }),
      handleSignals: false,
      createPool: () => { poolCalls += 1; return { async end() {} }; },
      buildAppImpl: async () => ({ async listen() {}, async close() {} })
    }),
    { code: "DEEPSEEK_API_KEY_REQUIRED" }
  );
  assert.equal(poolCalls, 0);
});

test("production DeepSeek hybrid quality selection fails closed before creating a pool without a server-side key", async () => {
  assert.throws(
    () => createProductionConfig({
      root: "/tmp/hifly-production-test",
      env: productionEnv({ COPY_QUALITY_EVALUATOR: "deepseek_hybrid" })
    }),
    { code: "DEEPSEEK_API_KEY_REQUIRED" }
  );

  let poolCalls = 0;
  await assert.rejects(
    startProductionServer({
      root: "/tmp/hifly-production-test",
      env: productionEnv({ COPY_QUALITY_EVALUATOR: "deepseek_hybrid" }),
      handleSignals: false,
      createPool: () => { poolCalls += 1; return { async end() {} }; },
      buildAppImpl: async () => ({ async listen() {}, async close() {} })
    }),
    { code: "DEEPSEEK_API_KEY_REQUIRED" }
  );
  assert.equal(poolCalls, 0);
});

test("production DeepSeek rewrite selection fails closed before creating a pool without a server-side key", async () => {
  assert.throws(
    () => createProductionConfig({
      root: "/tmp/hifly-production-test",
      env: productionEnv({ COPY_QUALITY_REWRITER: "deepseek" })
    }),
    { code: "DEEPSEEK_API_KEY_REQUIRED" }
  );

  let poolCalls = 0;
  await assert.rejects(
    startProductionServer({
      root: "/tmp/hifly-production-test",
      env: productionEnv({ COPY_QUALITY_REWRITER: "deepseek" }),
      handleSignals: false,
      createPool: () => { poolCalls += 1; return { async end() {} }; },
      buildAppImpl: async () => ({ async listen() {}, async close() {} })
    }),
    { code: "DEEPSEEK_API_KEY_REQUIRED" }
  );
  assert.equal(poolCalls, 0);
});

test("production wiring can select the DeepSeek adapter without making a request during startup", async () => {
  const pool = { async end() {} };
  const app = { async listen() {}, async stopExecutions() {}, async close() {} };
  let buildOptions;
  let fetchCalls = 0;
  const server = await startProductionServer({
    root: "/tmp/hifly-production-test",
    env: productionEnv({ COPY_GENERATION_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "unit-test-key" }),
    handleSignals: false,
    createPool: () => pool,
    deepseekFetch: async (url, init) => {
      fetchCalls += 1;
      assert.equal(url, "https://api.deepseek.com/chat/completions");
      assert.equal(init.headers.authorization, "Bearer unit-test-key");
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"body":"测试文案"}' } }] }), { status: 200 });
    },
    buildAppImpl: async (options) => {
      buildOptions = options;
      return app;
    }
  });

  assert.equal(fetchCalls, 0);
  assert.equal(buildOptions.copyGeneration.provider.kind, "deepseek_official");
  assert.equal(buildOptions.copyQuality.evaluator.kind, "controlled_test_double");
  assert.equal(buildOptions.copyGeneration.deepseek.model, "deepseek-v4-flash");
  assert.deepEqual(
    await buildOptions.copyGeneration.provider.generateCopy({
      productRevision: {
        product_name: "测试商品",
        product_description: "测试描述",
        primary_category: "general",
        content_brief: null,
        selling_points: [{ text: "测试卖点", confirmed: true }]
      }
    }),
    { body: "测试文案" }
  );
  assert.equal(fetchCalls, 1);
  await server.close();
});

test("production Hifly public avatar wiring is token-gated and makes no startup request", async () => {
  const pool = { async end() {} };
  const app = { async listen() {}, async stopExecutions() {}, async close() {} };
  let buildOptions;
  let fetchCalls = 0;
  const server = await startProductionServer({
    root: "/tmp/hifly-production-test",
    env: productionEnv({ HIFLY_API_TOKEN: "unit-test-hifly-token" }),
    handleSignals: false,
    createPool: () => pool,
    hiflyFetch: async () => { fetchCalls += 1; throw new Error("must not fetch during startup"); },
    buildAppImpl: async (options) => { buildOptions = options; return app; }
  });

  assert.equal(fetchCalls, 0);
  assert.equal(typeof buildOptions.avatarSelection.publicAvatarCatalog.list, "function");
  assert.equal(typeof buildOptions.hiflyApi.client.listPublicAvatars, "function");
  await server.close();
});

test("production wiring independently selects a DeepSeek hybrid quality evaluator without making a request during startup", async () => {
  const pool = { async end() {} };
  const app = { async listen() {}, async stopExecutions() {}, async close() {} };
  let buildOptions;
  let fetchCalls = 0;
  const server = await startProductionServer({
    root: "/tmp/hifly-production-test",
    env: productionEnv({
      COPY_GENERATION_PROVIDER: "phase1_controlled_test_double",
      COPY_QUALITY_EVALUATOR: "deepseek_hybrid",
      DEEPSEEK_API_KEY: "unit-test-key"
    }),
    handleSignals: false,
    createPool: () => pool,
    deepseekFetch: async (url, init) => {
      fetchCalls += 1;
      assert.equal(url, "https://api.deepseek.com/chat/completions");
      assert.equal(init.headers.authorization, "Bearer unit-test-key");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ findings: [{
        dimension: "factuality",
        finding_type: "semantic_risk",
        severity_suggestion: "high",
        matched_excerpt: "全网最好",
        claim_summary: "模型语义风险",
        evidence_refs: ["model-only-reference"],
        reason: "需要人工复核",
        confidence: "high",
        remediation: "调整表达"
      }] }) } }] }), { status: 200 });
    },
    buildAppImpl: async (options) => {
      buildOptions = options;
      return app;
    }
  });

  assert.equal(fetchCalls, 0);
  assert.equal(buildOptions.copyGeneration.provider.kind, "phase1_controlled_test_double");
  assert.equal(buildOptions.copyQuality.evaluator.kind, "hybrid_quality_qc");
  let providerDispatch;

  const result = await buildOptions.copyQuality.evaluator.evaluate({
    copyVersion: { body: "这款商品全网最好。" },
    productRevision: {
      product_name: "测试商品",
      selling_points: [{ text: "轻便", confirmed: true }]
    },
    providerRequest: async (request) => { providerDispatch = request; return request.execute(); }
  });
  assert.equal(fetchCalls, 1);
  assert.equal(providerDispatch.providerName, "DeepSeek");
  assert.equal(providerDispatch.providerKind, "deepseek_hybrid");
  assert.equal(providerDispatch.model, "deepseek-v4-flash");
  const semanticFinding = result.findings.find((finding) => finding.rule_source === "llm_semantic_qc");
  assert.equal(semanticFinding?.kind, "review");
  assert.equal(semanticFinding?.code, "SEMANTIC_REVIEW_1");
  assert.equal(semanticFinding?.matched_text, "全网最好");

  await server.close();
});

test("production wiring independently selects a DeepSeek rewriter without making a request during startup", async () => {
  const pool = { async end() {} };
  const app = { async listen() {}, async stopExecutions() {}, async close() {} };
  let buildOptions;
  let fetchCalls = 0;
  const server = await startProductionServer({
    root: "/tmp/hifly-production-test",
    env: productionEnv({
      COPY_GENERATION_PROVIDER: "phase1_controlled_test_double",
      COPY_QUALITY_EVALUATOR: "phase1_controlled_test_double",
      COPY_QUALITY_REWRITER: "deepseek",
      DEEPSEEK_API_KEY: "unit-test-key"
    }),
    handleSignals: false,
    createPool: () => pool,
    deepseekFetch: async (url, init) => {
      fetchCalls += 1;
      assert.equal(url, "https://api.deepseek.com/chat/completions");
      assert.equal(init.headers.authorization, "Bearer unit-test-key");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ body: "改写后的测试文案" }) } }] }), { status: 200 });
    },
    buildAppImpl: async (options) => {
      buildOptions = options;
      return app;
    }
  });

  assert.equal(fetchCalls, 0);
  assert.equal(buildOptions.copyGeneration.provider.kind, "phase1_controlled_test_double");
  assert.equal(buildOptions.copyQuality.evaluator.kind, "controlled_test_double");
  assert.equal(buildOptions.copyQuality.rewriter.kind, "deepseek_official");

  assert.deepEqual(
    await buildOptions.copyQuality.rewriter.rewrite({
      copyVersion: { status: "frozen", body: "原始测试文案" },
      productRevision: {
        product_name: "测试商品",
        selling_points: [{ text: "测试卖点", confirmed: true }]
      },
      scope: "full",
      instruction: "整体改得更自然"
    }),
    { body: "改写后的测试文案" }
  );
  assert.equal(fetchCalls, 1);
  await server.close();
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
    env: productionEnv({
      PORT: "4319",
      OPERATOR_WORKSPACE_ENABLED: "true",
      CLOUD_EXECUTOR_ENABLED: "true",
      CLOUD_EXECUTOR_MODE: "playwright",
      CLOUD_EXECUTOR_ID: "cloud-web-1",
      CLOUD_EXECUTOR_ORGANIZATION_ID: "org_pilot",
      CLOUD_EXECUTOR_HEARTBEAT_TOKEN: "cloud-heartbeat-secret",
      CLOUD_EXECUTOR_HEARTBEAT_TIMEOUT_MS: "22000",
      CLOUD_EXECUTOR_POLL_INTERVAL_MS: "not-a-duration"
    }),
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
  assert.deepEqual(buildOptions.operatorWorkspace, { enabled: true });
  assert.equal(buildOptions.localAgentExecution.enabled, false);
  assert.deepEqual(buildOptions.cloudExecutor, {
    enabled: true,
    configured: true,
    mode: "playwright",
    organizationId: "org_pilot",
    executorCloudId: "cloud-web-1",
    heartbeatTimeoutMs: 22_000,
    internal: {
      enabled: true,
      organizationId: "org_pilot",
      executorCloudId: "cloud-web-1",
      token: "cloud-heartbeat-secret"
    }
  });
  assert.equal("worker" in buildOptions.cloudExecutor, false);
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
