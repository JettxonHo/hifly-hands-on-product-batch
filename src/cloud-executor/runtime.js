import { createCloudExecutorReadiness, createCloudExecutorService } from "./cloud-executor-service.js";
import { createCloudExecutorWorker } from "./cloud-executor-worker.js";
import { createFakeCloudExecutor } from "./fake-executor.js";
import { createCloudExecutorLoginRuntime } from "./login.js";
import { createCloudPlaywrightAdapter } from "./playwright-adapter.js";

const failure = (code) => Object.assign(new Error(code), { code });
const clean = (value) => typeof value === "string" ? value.trim() : "";

function inactiveState(config) {
  if (config.enabled !== true) return { status: "disabled", ready: false, claimed: false };
  if (!["fake", "playwright", "login"].includes(config.mode)) return { status: "fail_closed", ready: false, claimed: false };
  if (config.configured !== true || (config.mode === "login" &&
    (!clean(config.workspace?.root) || !clean(config.workspace?.profileDir))) ||
    (config.mode !== "login" && (!clean(config.organizationId) || !clean(config.executorCloudId)))) {
    return { status: "unconfigured", ready: false, claimed: false };
  }
  return null;
}

export function createCloudExecutorRuntime({ config, repository, orderPort, packagePort, candidateStore,
  verificationPort = null, readinessPort = null, executor = null, now = Date.now, onError = () => undefined,
  loginAdapterFactory = createCloudPlaywrightAdapter, loginAdapterOptions = {} } = {}) {
  if (!config || typeof config !== "object" || Array.isArray(config)) throw failure("CLOUD_EXECUTOR_RUNTIME_CONFIG_REQUIRED");
  const inactive = inactiveState(config);
  if (inactive) {
    return {
      executorType: "cloud_executor",
      service: null,
      worker: null,
      async start() { return { ...inactive }; },
      async runOnce() { return { ...inactive }; },
      async close() {},
      get status() { return inactive.status; }
    };
  }

  if (config.mode === "login") {
    return createCloudExecutorLoginRuntime({ config, adapterFactory: loginAdapterFactory, adapterOptions: loginAdapterOptions });
  }

  const selectedExecutor = executor || (config.mode === "playwright"
    ? createCloudPlaywrightAdapter({
      workspace: config.workspace || {
        root: config.storageRoot,
        profileDir: config.profileDir
      },
      hiflyConfig: config.hiflyConfig,
      browserType: config.browserType,
      browserOptions: config.browserOptions,
      contextFactory: config.contextFactory,
      pageFactory: config.pageFactory,
      hiflyPageFactory: config.hiflyPageFactory,
      executorFactory: config.executorFactory,
      taskFactory: config.taskFactory,
      avatarMappingPath: config.avatarMappingPath,
      avatarMappings: config.avatarMappings,
      onProgress: config.onProgress
    })
    : createFakeCloudExecutor());
  const readiness = readinessPort || createCloudExecutorReadiness({
    enabled: true,
    mode: config.mode,
    configured: true,
    check: async () => {
      if (config.mode !== "playwright" || typeof selectedExecutor.preflight !== "function") return { ready: true, status: "available" };
      try {
        const result = await selectedExecutor.preflight();
        if (result?.ready === false || result?.status === "requires_login") {
          return { ready: false, status: result?.status === "requires_login" ? "requires_login" : "requires_action" };
        }
        return { ready: true, status: "available" };
      } catch (error) {
        if (error?.code === "LOGIN_REQUIRED") return { ready: false, status: "requires_login" };
        return { ready: false, status: "requires_action", reason: error?.code || "CLOUD_EXECUTOR_PREFLIGHT_FAILED" };
      }
    }
  });
  const service = createCloudExecutorService({
    repository,
    orderPort,
    packagePort,
    candidateStore,
    verificationPort,
    readinessPort: readiness,
    executor: selectedExecutor,
    enabled: true,
    mode: config.mode,
    organizationId: config.organizationId,
    executorCloudId: config.executorCloudId,
    leaseMs: config.worker?.leaseMs,
    heartbeatIntervalMs: config.worker?.heartbeatIntervalMs,
    now
  });
  const worker = createCloudExecutorWorker({
    service,
    pollIntervalMs: config.worker?.pollIntervalMs,
    onError
  });
  let started = false;

  async function start() {
    if (started) return { status: "running", replayed: true };
    started = true;
    worker.start();
    return { status: "running", replayed: false };
  }

  async function close() {
    worker.stop();
    started = false;
    await selectedExecutor.close?.();
  }

  return {
    executorType: "cloud_executor",
    readiness,
    executor: selectedExecutor,
    service,
    worker,
    start,
    runOnce: () => worker.runNext(),
    close,
    get status() { return worker.halted ? "halted" : started ? "running" : "standby"; }
  };
}
