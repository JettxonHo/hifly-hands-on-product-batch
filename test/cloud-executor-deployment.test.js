import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createMemoryManualExecutionRepository } from "../src/manual-execution/memory-manual-execution-repository.js";
import { createMemoryManualHandoffRepository } from "../src/manual-handoff/memory-manual-handoff-repository.js";
import { createMemoryProductionOrderRepository } from "../src/production-orders/memory-production-order-repository.js";
import { createMemoryWorkVerificationRepository } from "../src/work-verification/memory-work-verification-repository.js";
import { createCloudExecutorHeartbeatClient } from "../src/cloud-executor/heartbeat.js";
import { createCloudExecutorWorker } from "../src/cloud-executor/cloud-executor-worker.js";
import { createCloudExecutorConfig } from "../src/cloud-executor/config.js";
import { createCloudExecutorProductionPorts, createCloudExecutorProductionRuntime } from "../src/cloud-executor/production.js";
import { createCloudExecutorHealthServer } from "../src/cloud-executor/standalone.js";
import { createCloudWorkspaceConfig } from "../src/cloud-executor/workspace.js";
import { safeArtifactPath } from "../src/cloud-executor/playwright-adapter.js";

const ORGANIZATION_ID = "org-ce07";
const EXECUTOR_ID = "cloud-executor-ce07";

function disabledConfig(workspace = null) {
  return {
    enabled: false,
    configured: false,
    mode: "fail_closed",
    executorType: "cloud_executor",
    organizationId: null,
    executorCloudId: null,
    workspace,
    storage: workspace ? { root: workspace.root, minFreeBytes: 0 } : null,
    heartbeat: { enabled: false, standbyEnabled: false, url: null, token: null, timeoutMs: 15_000 },
    worker: { pollIntervalMs: 1000, leaseMs: 30_000, heartbeatIntervalMs: 5000, concurrency: 1 },
    health: { host: "127.0.0.1", port: 0 }
  };
}

test("disabled production worker is a long-lived healthy standby without DB, Hifly, browser, or claim wiring", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ce07-disabled-workspace-"));
  const workspace = createCloudWorkspaceConfig({ root, profileDir: path.join(root, "profile") });
  let poolCalls = 0;
  let portsCalls = 0;
  let hiflyConfigReads = 0;
  try {
    const first = await createCloudExecutorProductionRuntime({
      config: disabledConfig(workspace),
      createPool: () => { poolCalls += 1; throw new Error("disabled worker must not create a pool"); },
      portsFactory: async () => { portsCalls += 1; throw new Error("disabled worker must not assemble ports"); },
      loadHiflyConfig: () => { hiflyConfigReads += 1; throw new Error("disabled worker must not read Hifly config"); }
    });

    assert.equal(first.startup.status, "disabled");
    assert.equal(first.runtime.status, "disabled");
    assert.equal(first.runtime.service, null);
    assert.equal(first.runtime.worker, null);
    const marker = await readFile(workspace.profileMarkerPath, "utf8");
    await first.close();

    const restarted = await createCloudExecutorProductionRuntime({ config: disabledConfig(workspace) });
    assert.equal(await readFile(workspace.profileMarkerPath, "utf8"), marker);
    await restarted.close();
    assert.equal(poolCalls, 0);
    assert.equal(portsCalls, 0);
    assert.equal(hiflyConfigReads, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inactive production workspace failure stays no-side-effect and reports a controlled readiness", async () => {
  let poolCalls = 0;
  const config = disabledConfig(createCloudWorkspaceConfig({ root: "/tmp/ce07-blocked", profileDir: "/tmp/ce07-blocked/profile" }));
  const handle = await createCloudExecutorProductionRuntime({
    config,
    ensureWorkspace: async () => { throw Object.assign(new Error("private path"), { code: "EACCES" }); },
    createPool: () => { poolCalls += 1; throw new Error("inactive worker must not create a pool"); }
  });
  assert.equal(handle.startup.status, "storage_blocked");
  assert.equal(handle.runtime.service, null);
  assert.equal(handle.runtime.worker, null);
  assert.equal(poolCalls, 0);
  await handle.close();
});

test("explicit standby pairing reports disabled without DB, browser, Hifly, order, or claim wiring", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ce07-standby-heartbeat-"));
  const workspace = createCloudWorkspaceConfig({ root, profileDir: path.join(root, "profile") });
  const reports = [];
  let poolCalls = 0;
  let portsCalls = 0;
  let hiflyConfigReads = 0;
  try {
    const config = {
      ...disabledConfig(workspace),
      executorCloudId: EXECUTOR_ID,
      organizationId: ORGANIZATION_ID,
      heartbeat: {
        enabled: true,
        standbyEnabled: true,
        url: "http://app:3000/internal/cloud-executor/v1/heartbeat",
        token: "standby-test-token",
        timeoutMs: 15_000
      }
    };
    const handle = await createCloudExecutorProductionRuntime({
      config,
      heartbeatFactory: () => ({ async report(value) { reports.push(value); } }),
      createPool: () => { poolCalls += 1; throw new Error("standby must not create a pool"); },
      portsFactory: () => { portsCalls += 1; throw new Error("standby must not create ports"); },
      loadHiflyConfig: () => { hiflyConfigReads += 1; throw new Error("standby must not read Hifly config"); }
    });
    assert.deepEqual(reports, [{ readinessStatus: "disabled", progressPhase: "standby" }]);
    assert.equal(handle.runtime.service, null);
    assert.equal(handle.runtime.worker, null);
    assert.equal(poolCalls, 0);
    assert.equal(portsCalls, 0);
    assert.equal(hiflyConfigReads, 0);
    await handle.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("active production runtime assembles the standalone Worker with DB, ports, and heartbeat only", async () => {
  const calls = [];
  let runtimeOptions = null;
  let pool = null;
  const config = {
    enabled: true,
    configured: true,
    mode: "fake",
    organizationId: ORGANIZATION_ID,
    executorCloudId: EXECUTOR_ID,
    databaseUrl: "postgresql://worker@postgres/cloud",
    databasePoolMax: 3,
    databaseSsl: false,
    heartbeat: { enabled: true, url: "http://app:3000/internal/cloud-executor/v1/heartbeat", token: "test-token", timeoutMs: 15_000 },
    worker: { pollIntervalMs: 1000, leaseMs: 30_000, heartbeatIntervalMs: 5000, concurrency: 1 }
  };
  const ports = {
    runtimeOptions: { marker: "standalone-ports" },
    verificationWorker: { start() { calls.push("verification.start"); }, stop() { calls.push("verification.stop"); } },
    async close() { calls.push("ports.close"); }
  };
  const handle = await createCloudExecutorProductionRuntime({
    config,
    createPool(input) { calls.push(["pool", input]); pool = { async end() { calls.push("pool.end"); } }; return pool; },
    portsFactory(input) { calls.push(["ports", input.config.mode]); return ports; },
    heartbeatFactory(input) { calls.push(["heartbeat", input.url]); return { report() {} }; },
    runtimeFactory(input) {
      runtimeOptions = input;
      return { status: "standby", async start() { calls.push("runtime.start"); return { status: "running" }; }, async close() { calls.push("runtime.close"); } };
    },
    loadHiflyConfig() { throw new Error("fake mode must not read Hifly config"); }
  });

  assert.equal(handle.startup.status, "running");
  assert.equal(runtimeOptions.marker, "standalone-ports");
  assert.equal(typeof runtimeOptions.heartbeatPort.report, "function");
  assert.deepEqual(calls.slice(0, 4), [
    ["heartbeat", config.heartbeat.url],
    ["pool", { connectionString: config.databaseUrl, max: 3, ssl: false }],
    ["ports", "fake"],
    "runtime.start"
  ]);
  await handle.close();
  assert.deepEqual(calls.slice(-3), ["runtime.close", "ports.close", "pool.end"]);
});

test("production port assembly schema-checks PostgreSQL repositories and keeps worker ports separate from the Web app", async () => {
  const root = await new Promise((resolve, reject) => {
    import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "ce07-ports-"))).then(resolve, reject);
  });
  const workspace = createCloudWorkspaceConfig({ root, profileDir: path.join(root, "profile") });
  const initialized = [];
  const repositories = {
    identity: createMemoryIdentityRepositoryWithProbe("identity", initialized),
    assets: createMemoryAssetRepositoryWithProbe(initialized),
    productionOrders: createMemoryProductionOrderRepositoryWithProbe(initialized),
    manualHandoff: createMemoryManualHandoffRepositoryWithProbe(initialized),
    manualExecution: createMemoryManualExecutionRepositoryWithProbe(initialized),
    workVerification: createMemoryWorkVerificationRepositoryWithProbe(initialized)
  };
  const stores = new Map();
  const ports = await createCloudExecutorProductionPorts({
    pool: { marker: "postgres-pool" },
    config: {
      organizationId: ORGANIZATION_ID,
      executorCloudId: EXECUTOR_ID,
      workspace,
      handoffDir: path.join(root, "handoff"),
      worker: { pollIntervalMs: 1000, leaseMs: 30_000, heartbeatIntervalMs: 5000 }
    },
    repositoryFactories: {
      identity: () => repositories.identity,
      assets: () => repositories.assets,
      productionOrders: () => repositories.productionOrders,
      manualHandoff: () => repositories.manualHandoff,
      manualExecution: () => repositories.manualExecution,
      workVerification: () => repositories.workVerification
    },
    objectStoreFactory: ({ root: storeRoot }) => {
      const store = createMemoryObjectStore();
      stores.set(storeRoot, store);
      return store;
    },
    verificationWorkerFactory: () => ({ start() {}, stop() {}, wake() {} })
  });

  assert.deepEqual(initialized, ["identity", "assets", "productionOrders", "manualHandoff", "manualExecution", "workVerification"]);
  assert.equal(typeof ports.runtimeOptions.repository.claimAttempt, "function");
  assert.equal(typeof ports.runtimeOptions.orderPort.listOrdersForCloudExecutor, "function");
  assert.equal(typeof ports.runtimeOptions.orderPort.transitionOrderForCloudExecutor, "function");
  assert.equal(typeof ports.runtimeOptions.packagePort.downloadPackageForCloudExecutor, "function");
  assert.equal(typeof ports.runtimeOptions.verificationPort.requestVerification, "function");
  assert.equal(typeof ports.verificationWorker.start, "function");
  assert.equal(stores.size, 2);
  await ports.close();
});

test("heartbeat sends only allowlisted state with the Bearer token from env and never exposes it", async () => {
  const requests = [];
  const client = createCloudExecutorHeartbeatClient({
    enabled: true,
    url: "https://pilot.example.test/internal/cloud-executor/v1/heartbeat",
    token: "heartbeat-secret-for-test",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ status: "online", secret: "must-not-be-forwarded" }), { status: 200 });
    }
  });

  const result = await client.report({ readinessStatus: "available", progressPhase: "standby" });
  assert.equal(result.status, "online");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://pilot.example.test/internal/cloud-executor/v1/heartbeat");
  assert.equal(requests[0].init.headers.authorization, "Bearer heartbeat-secret-for-test");
  assert.deepEqual(JSON.parse(requests[0].init.body), { readiness_status: "available", progress_phase: "standby" });
  assert.doesNotMatch(JSON.stringify(result), /heartbeat-secret-for-test|must-not-be-forwarded/i);

  await assert.rejects(
    client.report({ readinessStatus: "available", progressPhase: "private_exception" }),
    { code: "CLOUD_EXECUTOR_HEARTBEAT_STATE_INVALID" }
  );
  assert.equal(requests.length, 1);
});

test("disabled heartbeat client is a no-op and does not require a token or URL", async () => {
  let fetchCalls = 0;
  const client = createCloudExecutorHeartbeatClient({ enabled: false, fetchImpl: async () => { fetchCalls += 1; } });
  assert.deepEqual(await client.report({ readinessStatus: "disabled", progressPhase: "standby" }), { status: "disabled", skipped: true });
  assert.equal(fetchCalls, 0);
});

test("standalone configuration fixes concurrency at one and rejects unsafe heartbeat URLs", () => {
  const config = createCloudExecutorConfig({
    root: "/tmp/ce07-config",
    env: { CLOUD_EXECUTOR_ENABLED: "false", CLOUD_EXECUTOR_CONCURRENCY: "1", DATABASE_URL: "postgresql://worker@db/pilot" }
  });
  assert.equal(config.worker.concurrency, 1);
  assert.equal(config.databaseUrl, "postgresql://worker@db/pilot");
  assert.equal(config.heartbeat.standbyEnabled, false);
  const paired = createCloudExecutorConfig({ env: {
    CLOUD_EXECUTOR_ENABLED: "false",
    CLOUD_EXECUTOR_STANDBY_HEARTBEAT_ENABLED: "true",
    CLOUD_EXECUTOR_ID: EXECUTOR_ID,
    CLOUD_EXECUTOR_ORGANIZATION_ID: ORGANIZATION_ID,
    CLOUD_EXECUTOR_HEARTBEAT_URL: "http://app:3000/internal/cloud-executor/v1/heartbeat",
    CLOUD_EXECUTOR_HEARTBEAT_TOKEN: "test-token"
  } });
  assert.equal(paired.heartbeat.enabled, true);
  assert.equal(paired.heartbeat.standbyEnabled, true);
  assert.throws(() => createCloudExecutorConfig({ env: {
    CLOUD_EXECUTOR_STANDBY_HEARTBEAT_ENABLED: "true",
    CLOUD_EXECUTOR_HEARTBEAT_URL: "http://app:3000/internal/cloud-executor/v1/heartbeat",
    CLOUD_EXECUTOR_HEARTBEAT_TOKEN: "test-token"
  } }), { code: "CLOUD_EXECUTOR_STANDBY_HEARTBEAT_CONFIG_REQUIRED" });
  assert.throws(() => createCloudExecutorConfig({ env: { CLOUD_EXECUTOR_CONCURRENCY: "2" } }), { code: "CLOUD_EXECUTOR_CONCURRENCY_INVALID" });
  assert.throws(() => createCloudExecutorHeartbeatClient({ enabled: true, url: "https://pilot.test/internal/cloud-executor/v1/heartbeat?token=secret", token: "test" }), { code: "CLOUD_EXECUTOR_HEARTBEAT_URL_INVALID" });
});

test("worker heartbeat reports busy and terminal state using only the public allowlist", async () => {
  const reports = [];
  const worker = createCloudExecutorWorker({
    service: { async runOnce() { return { status: "standby", claimed: false, private_error: "must-not-be-forwarded" }; } },
    pollIntervalMs: 1000,
    heartbeatIntervalMs: 1000,
    heartbeatPort: { async report(state) { reports.push(state); } }
  });
  await worker.runNext();
  worker.stop();
  assert.deepEqual(reports, [
    { readinessStatus: "busy", progressPhase: "executing" },
    { readinessStatus: "available", progressPhase: "standby" }
  ]);
  assert.doesNotMatch(JSON.stringify(reports), /private_error|must-not-be-forwarded/i);
});

test("standalone health server reports disabled standby without secrets or claim state", async () => {
  const handle = {
    config: { mode: "fail_closed", worker: { concurrency: 1 } },
    startup: { status: "disabled" },
    runtime: { status: "disabled", worker: null }
  };
  const health = createCloudExecutorHealthServer({ processRuntime: handle, host: "127.0.0.1", port: 0 });
  await health.listen();
  try {
    const address = health.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, {
      status: "ok",
      runtime: "cloud_executor",
      readiness: "disabled",
      worker: "standby",
      concurrency: 1,
      claim_enabled: false
    });
    assert.doesNotMatch(JSON.stringify(body), /token|profile|path|secret|available/i);
  } finally {
    await health.close();
  }
});

test("Windows separators are accepted for relative artifacts but drive and UNC paths fail closed", () => {
  const root = path.resolve(os.tmpdir(), "ce07-artifact-root");
  assert.equal(safeArtifactPath(root, "outputs\\video.mp4"), path.join(root, "outputs", "video.mp4"));
  for (const value of ["C:\\private\\video.mp4", "\\\\server\\share\\video.mp4"]) {
    assert.throws(() => safeArtifactPath(root, value), { code: "CLOUD_EXECUTOR_ARTIFACT_PATH_INVALID" });
  }
});

test("production Compose and image define one disabled worker with persistent media, Chrome/Xvfb, and loopback noVNC", async () => {
  const compose = await readFile(new URL("../docker-compose.production.yml", import.meta.url), "utf8");
  const dockerfile = await readFile(new URL("../deploy/cloud-executor.Dockerfile", import.meta.url), "utf8");
  const entrypoint = await readFile(new URL("../deploy/cloud-executor-entrypoint.sh", import.meta.url), "utf8");
  const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  const runbook = await readFile(new URL("../docs/deployment/ALIYUN_CLOUD_EXECUTOR_CE07_RUNBOOK.md", import.meta.url), "utf8");

  assert.match(compose, /\r?\n  cloud_executor:\r?\n/);
  assert.match(compose, /dockerfile: deploy\/cloud-executor\.Dockerfile/);
  assert.match(compose, /CLOUD_EXECUTOR_ENABLED: \$\{CLOUD_EXECUTOR_ENABLED:-false\}/);
  assert.match(compose, /CLOUD_EXECUTOR_MODE: \$\{CLOUD_EXECUTOR_MODE:-fail_closed\}/);
  assert.match(compose, /CLOUD_EXECUTOR_CONCURRENCY: "1"/);
  const cloudService = compose.slice(compose.indexOf("\n  cloud_executor:"), compose.indexOf("\nvolumes:"));
  assert.match(cloudService, /networks:\r?\n      - internal\r?\n      - executor_egress/);
  assert.doesNotMatch(cloudService, /(?:0\.0\.0\.0|\$\{[^}]*\}):3001:3001/);
  assert.match(compose, /\n  executor_egress:\r?\n/);
  assert.match(compose, /TRUSTED_HOSTS: \$\{TRUSTED_HOSTS:-[^\r\n]*app:3000/);
  assert.equal(compose.match(/CLOUD_EXECUTOR_STANDBY_HEARTBEAT_ENABLED: \$\{CLOUD_EXECUTOR_STANDBY_HEARTBEAT_ENABLED:-false\}/g)?.length, 2);
  assert.match(cloudService, /CLOUD_EXECUTOR_HEARTBEAT_URL: \$\{CLOUD_EXECUTOR_HEARTBEAT_URL:-http:\/\/app:3000\/internal\/cloud-executor\/v1\/heartbeat\}/);
  assert.match(compose, /cloud_executor_profile:\/var\/lib\/hifly-executor\/profile/);
  assert.match(compose, /cloud_executor_assets:\/var\/lib\/hifly-executor\/assets/);
  assert.match(compose, /cloud_executor_outputs:\/var\/lib\/hifly-executor\/outputs/);
  assert.match(compose, /cloud_executor_evidence:\/var\/lib\/hifly-executor\/evidence/);
  assert.match(compose, /127\.0\.0\.1:\$\{CLOUD_EXECUTOR_NOVNC_HOST_PORT:-6080\}:6080/);
  assert.doesNotMatch(compose, /0\.0\.0\.0:\$\{CLOUD_EXECUTOR_NOVNC_HOST_PORT/);
  assert.match(compose, /mem_limit: 1024m/);
  assert.match(compose, /cpus: 0\.75/);
  assert.match(compose, /pids_limit: 256/);
  assert.match(compose, /healthcheck:/);
  assert.match(compose, /restart: unless-stopped/);

  assert.match(dockerfile, /FROM node:22-bookworm-slim/);
  for (const packageName of ["xvfb", "x11vnc", "novnc", "websockify", "x11-utils"]) assert.match(dockerfile, new RegExp(`\\b${packageName}\\b`));
  assert.match(dockerfile, /playwright install --with-deps chromium/);
  assert.match(dockerfile, /ENTRYPOINT \["\/app\/deploy\/cloud-executor-entrypoint\.sh"\]/);
  assert.match(entrypoint, /Xvfb "\$DISPLAY"/);
  assert.match(entrypoint, /x11vnc [^\n]*-listen 127\.0\.0\.1/);
  assert.match(entrypoint, /websockify .*"0\.0\.0\.0:\$NOVNC_PORT" "127\.0\.0\.1:5900"/);
  assert.match(entrypoint, /login\)[\s\S]*exec node scripts\/cloud-executor\.js login/);
  assert.match(entrypoint, /worker\|''\)[\s\S]*exec node scripts\/cloud-executor-worker\.js/);
  assert.doesNotMatch(entrypoint, /migrate:production|runProductionMigrations/);
  assert.match(runbook, /stop cloud_executor[\s\S]*run --rm --service-ports cloud_executor login[\s\S]*up -d cloud_executor/);

  for (const line of [
    "CLOUD_EXECUTOR_ENABLED=false",
    "CLOUD_EXECUTOR_MODE=fail_closed",
    "CLOUD_EXECUTOR_STANDBY_HEARTBEAT_ENABLED=false",
    "CLOUD_EXECUTOR_CONCURRENCY=1",
    "CLOUD_EXECUTOR_HEARTBEAT_URL=http://app:3000/internal/cloud-executor/v1/heartbeat",
    "CLOUD_EXECUTOR_HEARTBEAT_TOKEN=",
    "CLOUD_EXECUTOR_PROFILE_DIR=/var/lib/hifly-executor/profile",
    "CLOUD_EXECUTOR_ASSETS_DIR=/var/lib/hifly-executor/assets",
    "CLOUD_EXECUTOR_OUTPUTS_DIR=/var/lib/hifly-executor/outputs",
    "CLOUD_EXECUTOR_EVIDENCE_DIR=/var/lib/hifly-executor/evidence",
    "CLOUD_EXECUTOR_HEALTH_PORT=3001",
    "CLOUD_EXECUTOR_NOVNC_BIND_HOST=127.0.0.1"
  ]) assert.match(envExample, new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), line);
  assert.doesNotMatch(envExample, /Bearer\s+[A-Za-z0-9]/i);
});

function withInitialize(name, value, initialized) {
  return { ...value, async initialize() { initialized.push(name); await value.initialize?.(); } };
}

function createMemoryIdentityRepositoryWithProbe(name, initialized) {
  return withInitialize(name, { async initialize() {}, async close() {} }, initialized);
}

function createMemoryAssetRepositoryWithProbe(initialized) {
  const repository = createMemoryAssetRepository();
  return withInitialize("assets", repository, initialized);
}

function createMemoryProductionOrderRepositoryWithProbe(initialized) {
  const repository = createMemoryProductionOrderRepository();
  return withInitialize("productionOrders", repository, initialized);
}

function createMemoryManualHandoffRepositoryWithProbe(initialized) {
  const repository = createMemoryManualHandoffRepository();
  return withInitialize("manualHandoff", repository, initialized);
}

function createMemoryManualExecutionRepositoryWithProbe(initialized) {
  const repository = createMemoryManualExecutionRepository();
  return withInitialize("manualExecution", repository, initialized);
}

function createMemoryWorkVerificationRepositoryWithProbe(initialized) {
  const repository = createMemoryWorkVerificationRepository();
  return withInitialize("workVerification", repository, initialized);
}
