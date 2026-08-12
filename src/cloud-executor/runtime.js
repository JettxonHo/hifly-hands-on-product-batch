import { createCloudExecutorReadiness, createCloudExecutorService } from "./cloud-executor-service.js";
import { createCloudExecutorWorker } from "./cloud-executor-worker.js";
import { createFakeCloudExecutor } from "./fake-executor.js";

const failure = (code) => Object.assign(new Error(code), { code });
const clean = (value) => typeof value === "string" ? value.trim() : "";

function inactiveState(config) {
  if (config.enabled !== true) return { status: "disabled", ready: false, claimed: false };
  if (config.mode !== "fake") return { status: "fail_closed", ready: false, claimed: false };
  if (config.configured !== true || !clean(config.organizationId) || !clean(config.executorCloudId)) {
    return { status: "unconfigured", ready: false, claimed: false };
  }
  return null;
}

export function createCloudExecutorRuntime({ config, repository, orderPort, packagePort, candidateStore,
  verificationPort = null, readinessPort = null, executor = null, now = Date.now, onError = () => undefined } = {}) {
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

  const readiness = readinessPort || createCloudExecutorReadiness({ enabled: true, mode: "fake", configured: true });
  const selectedExecutor = executor || createFakeCloudExecutor();
  const service = createCloudExecutorService({
    repository,
    orderPort,
    packagePort,
    candidateStore,
    verificationPort,
    readinessPort: readiness,
    executor: selectedExecutor,
    enabled: true,
    mode: "fake",
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
