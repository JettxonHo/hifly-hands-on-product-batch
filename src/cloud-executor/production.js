import { createVerifiedOutputAssetPort } from "../work-verification/verified-output-asset-port.js";
import { createWorkVerificationService } from "../work-verification/work-verification-service.js";
import { createWorkVerificationWorker } from "../work-verification/work-verification-worker.js";
import { createPostgresAssetRepository } from "../assets/postgres-asset-repository.js";
import { createLocalObjectStore } from "../assets/local-object-store.js";
import { createIdentityPool } from "../identity/postgres.js";
import { createPostgresIdentityRepository } from "../identity/postgres-identity-repository.js";
import { createPostgresManualExecutionRepository } from "../manual-execution/postgres-manual-execution-repository.js";
import { createManualHandoffPackageService } from "../manual-handoff/manual-handoff-package-service.js";
import { createPostgresManualHandoffRepository } from "../manual-handoff/postgres-manual-handoff-repository.js";
import { createPostgresProductionOrderRepository } from "../production-orders/postgres-production-order-repository.js";
import { createCloudExecutorHeartbeatClient, createCloudExecutorStandbyHeartbeat } from "./heartbeat.js";
import { createCloudExecutorConfig } from "./config.js";
import { createCloudExecutorRuntime } from "./runtime.js";
import { createCloudWorkspaceConfig, ensureCloudExecutorWorkspace } from "./workspace.js";
import { loadConfig } from "../config.js";
import { createPostgresWorkVerificationRepository } from "../work-verification/postgres-work-verification-repository.js";

const ACTIVE_MODES = new Set(["fake", "playwright"]);
const INITIALIZE_ORDER = Object.freeze([
  "identity",
  "assets",
  "productionOrders",
  "manualHandoff",
  "manualExecution",
  "workVerification"
]);

const failure = (code) => Object.assign(new Error(code), { code });
const clean = (value) => typeof value === "string" ? value.trim() : "";

function scopedCloudInput(input, config) {
  if (clean(input?.organizationId) !== clean(config.organizationId) ||
    clean(input?.executorCloudId || input?.cloudExecutorId) !== clean(config.executorCloudId)) {
    throw failure("CLOUD_EXECUTOR_CONTEXT_REQUIRED");
  }
  return {
    organizationId: config.organizationId,
    executorCloudId: config.executorCloudId
  };
}

function createCloudOrderPorts({ repository, config }) {
  const memberOrderPort = {
    async getOrder(input) {
      if (!clean(input?.organizationId) || !clean(input?.orderId)) throw failure("PRODUCTION_ORDER_NOT_FOUND");
      const value = await repository.getOrder(input.organizationId, input.orderId);
      if (!value || value.organization_id !== input.organizationId) throw failure("PRODUCTION_ORDER_NOT_FOUND");
      return value;
    },
    async transitionOrder(input) {
      if (!clean(input?.organizationId) || !clean(input?.orderId)) throw failure("PRODUCTION_ORDER_CONTEXT_REQUIRED");
      const value = await repository.transitionOrder({
        organizationId: input.organizationId,
        orderId: input.orderId,
        expectedRevision: input.expectedRevision,
        fromStatuses: input.fromStatuses,
        toStatus: input.toStatus,
        at: input.at,
        actorMemberId: input.actorMemberId || null,
        reason: input.reason || null,
        transactionClient: input.transactionClient || null
      });
      if (!value) throw failure("PRODUCTION_ORDER_CONFLICT");
      return value;
    }
  };

  return {
    memberOrderPort,
    cloudOrderPort: {
      async listOrdersForCloudExecutor(input = {}) {
        scopedCloudInput(input, config);
        return repository.listOrders(config.organizationId, input.productId || null);
      },
      async getOrderForCloudExecutor(input = {}) {
        scopedCloudInput(input, config);
        return memberOrderPort.getOrder({ organizationId: config.organizationId, orderId: input.orderId });
      },
      async transitionOrderForCloudExecutor(input = {}) {
        const identity = scopedCloudInput(input, config);
        return repository.transitionOrder({
          organizationId: identity.organizationId,
          orderId: input.orderId,
          expectedRevision: input.expectedRevision,
          fromStatuses: input.fromStatuses,
          toStatus: input.toStatus,
          at: input.at,
          actorMemberId: null,
          actorAgentId: null,
          actorCloudExecutorId: input.actorCloudExecutorId || identity.executorCloudId,
          reason: input.reason || null,
          transactionClient: input.transactionClient || null
        }).then((value) => {
          if (!value) throw failure("PRODUCTION_ORDER_CONFLICT");
          return value;
        });
      }
    }
  };
}

function defaultRepositoryFactories() {
  return {
    identity: (input) => createPostgresIdentityRepository(input),
    assets: (input) => createPostgresAssetRepository(input),
    productionOrders: (input) => createPostgresProductionOrderRepository(input),
    manualHandoff: (input) => createPostgresManualHandoffRepository(input),
    manualExecution: (input) => createPostgresManualExecutionRepository(input),
    workVerification: (input) => createPostgresWorkVerificationRepository(input)
  };
}

async function initializeRepository(name, repository) {
  if (typeof repository?.initialize !== "function") throw failure(`CLOUD_EXECUTOR_${name.toUpperCase()}_REPOSITORY_INVALID`);
  await repository.initialize();
}

export async function createCloudExecutorProductionPorts({ pool, config, repositoryFactories = {},
  objectStoreFactory = createLocalObjectStore, verificationWorkerFactory = createWorkVerificationWorker,
  now = Date.now, onError = () => undefined } = {}) {
  const hasCustomRepositories = Object.keys(repositoryFactories).length > 0;
  if (!hasCustomRepositories && (!pool || typeof pool.query !== "function" && typeof pool.connect !== "function")) {
    throw failure("CLOUD_EXECUTOR_DATABASE_REQUIRED");
  }
  if (!config?.workspace || !clean(config.organizationId) || !clean(config.executorCloudId)) {
    throw failure("CLOUD_EXECUTOR_CONTEXT_REQUIRED");
  }
  const workspace = createCloudWorkspaceConfig(config.workspace);
  const factories = { ...defaultRepositoryFactories(), ...repositoryFactories };
  const repositoryInput = { pool, ownsPool: false };
  const repositories = {
    identity: factories.identity(repositoryInput),
    assets: factories.assets(repositoryInput),
    productionOrders: factories.productionOrders(repositoryInput),
    manualHandoff: factories.manualHandoff(repositoryInput),
    manualExecution: factories.manualExecution(repositoryInput),
    workVerification: factories.workVerification(repositoryInput)
  };
  for (const name of INITIALIZE_ORDER) await initializeRepository(name, repositories[name]);

  const candidateStore = objectStoreFactory({ root: workspace.outputsDir, kind: "candidate" });
  const handoffStore = objectStoreFactory({ root: config.handoffDir, kind: "handoff" });
  await candidateStore.initialize?.();
  await handoffStore.initialize?.();

  const { memberOrderPort, cloudOrderPort } = createCloudOrderPorts({ repository: repositories.productionOrders, config });
  const packagePort = createManualHandoffPackageService({
    repository: repositories.manualHandoff,
    orderPort: memberOrderPort,
    packageStore: handoffStore,
    now
  });
  const verificationPortService = createWorkVerificationService({
    repository: repositories.workVerification,
    orderPort: memberOrderPort,
    executionPort: repositories.manualExecution,
    packagePort,
    objectStore: candidateStore,
    verifiedOutputAssetPort: createVerifiedOutputAssetPort({ repository: repositories.assets }),
    now
  });
  const verificationWorker = verificationWorkerFactory({
    service: verificationPortService,
    pollIntervalMs: config.worker?.pollIntervalMs,
    leaseMs: config.worker?.leaseMs,
    heartbeatIntervalMs: config.worker?.heartbeatIntervalMs,
    onError
  });
  if (!verificationWorker?.start || !verificationWorker?.stop) throw failure("CLOUD_EXECUTOR_VERIFICATION_WORKER_INVALID");

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await verificationWorker.stop?.();
    for (const name of INITIALIZE_ORDER.slice().reverse()) await repositories[name]?.close?.();
  }

  return {
    workspace,
    repositories,
    candidateStore,
    handoffStore,
    verificationWorker,
    runtimeOptions: {
      config,
      repository: repositories.manualExecution,
      orderPort: cloudOrderPort,
      packagePort,
      candidateStore,
      verificationPort: {
        requestVerification: verificationPortService.requestVerification,
        getLatestVerificationJob: async (organizationId, productionOrderId) =>
          repositories.workVerification.getLatestVerificationJob(organizationId, productionOrderId),
        getVerificationWorkspace: verificationPortService.getVerificationWorkspace,
        wake: () => verificationWorker.wake?.()
      },
      now,
      onError
    },
    close
  };
}

function inactiveConfig(config, status = "unconfigured") {
  return { ...config, enabled: status !== "disabled", configured: false,
    mode: status === "fail_closed" ? "fail_closed" : config.mode };
}

function shouldAssemble(config) {
  return config?.enabled === true && config.configured === true && ACTIVE_MODES.has(config.mode);
}

function workspaceFailureStatus(error) {
  return error?.code === "CLOUD_EXECUTOR_PROFILE_MARKER_INVALID" ? "requires_action" : "storage_blocked";
}

function inactiveHeartbeatState(status) {
  if (["disabled", "fail_closed"].includes(status)) return { readinessStatus: "disabled", progressPhase: "standby" };
  if (status === "unconfigured") return { readinessStatus: "unconfigured", progressPhase: "standby" };
  if (status === "storage_blocked") return { readinessStatus: "storage_blocked", progressPhase: "requires_action" };
  return { readinessStatus: "requires_action", progressPhase: "requires_action" };
}

export async function createCloudExecutorProductionRuntime({ root = process.cwd(), env = process.env, config = null,
  configFactory = createCloudExecutorConfig, createPool = createIdentityPool,
  portsFactory = createCloudExecutorProductionPorts, runtimeFactory = createCloudExecutorRuntime,
  heartbeatFactory = createCloudExecutorHeartbeatClient, loadHiflyConfig = loadConfig,
  standbyHeartbeatFactory = createCloudExecutorStandbyHeartbeat,
  workspaceFactory = createCloudWorkspaceConfig, ensureWorkspace = ensureCloudExecutorWorkspace,
  fetchImpl = globalThis.fetch, now = Date.now, onError = () => undefined } = {}) {
  const selectedConfig = config || configFactory({ root, env });
  const base = { config: selectedConfig, startup: null, runtime: null, pool: null, ports: null, verificationWorker: null };
  let guardedConfig = selectedConfig;
  if (selectedConfig.enabled !== true) guardedConfig = inactiveConfig(selectedConfig, "disabled");
  else if (!shouldAssemble(selectedConfig)) guardedConfig = inactiveConfig(selectedConfig, selectedConfig.mode === "fail_closed" ? "fail_closed" : "unconfigured");
  else if (selectedConfig.heartbeat?.enabled !== true) guardedConfig = inactiveConfig(selectedConfig, "unconfigured");

  if (guardedConfig !== selectedConfig) {
    let preparationStatus = null;
    try {
      await ensureWorkspace(workspaceFactory(selectedConfig.workspace));
    } catch (error) {
      preparationStatus = workspaceFailureStatus(error);
    }
    const runtime = runtimeFactory({ config: guardedConfig, now, onError });
    const runtimeStartup = await runtime.start();
    const startup = preparationStatus
      ? { status: preparationStatus, ready: false, claimed: false }
      : runtimeStartup;
    let standbyHeartbeat = null;
    if (selectedConfig.heartbeat?.standbyEnabled === true && selectedConfig.heartbeat?.enabled === true) {
      const heartbeatPort = await heartbeatFactory({ ...selectedConfig.heartbeat, fetchImpl });
      standbyHeartbeat = standbyHeartbeatFactory({
        heartbeatPort,
        intervalMs: selectedConfig.worker?.heartbeatIntervalMs,
        onError
      });
      await standbyHeartbeat.start(inactiveHeartbeatState(startup.status));
    }
    let closed = false;
    return {
      ...base,
      runtime,
      startup,
      standbyHeartbeat,
      async close() {
        if (closed) return;
        closed = true;
        standbyHeartbeat?.stop();
        await runtime.close();
      }
    };
  }

  const databaseUrl = clean(selectedConfig.databaseUrl || env.DATABASE_URL);
  if (!databaseUrl) throw failure("CLOUD_EXECUTOR_DATABASE_URL_REQUIRED");
  let pool;
  let ports;
  let runtime;
  try {
    const heartbeatPort = await heartbeatFactory({ ...selectedConfig.heartbeat, fetchImpl });
    pool = await createPool({ connectionString: databaseUrl, max: selectedConfig.databasePoolMax || 5, ssl: selectedConfig.databaseSsl || false });
    ports = await portsFactory({ pool, config: selectedConfig, now, onError });
    let hiflyConfig = null;
    if (selectedConfig.mode === "playwright") hiflyConfig = await loadHiflyConfig(selectedConfig.hiflyConfigPath);
    runtime = runtimeFactory({ ...ports.runtimeOptions, config: { ...selectedConfig, hiflyConfig }, heartbeatPort, now, onError });
    const startup = await runtime.start();
    ports.verificationWorker.start();
    let closed = false;
    async function close() {
      if (closed) return;
      closed = true;
      await runtime.close?.();
      await ports.close?.();
      await pool.end?.();
    }
    return { config: selectedConfig, startup, runtime, pool, ports, verificationWorker: ports.verificationWorker, close };
  } catch (error) {
    await runtime?.close?.().catch?.(() => undefined);
    await ports?.close?.().catch?.(() => undefined);
    await pool?.end?.().catch?.(() => undefined);
    throw error;
  }
}

export { INITIALIZE_ORDER };
