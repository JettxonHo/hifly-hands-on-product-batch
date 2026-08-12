import path from "node:path";
import { pathToFileURL } from "node:url";

import { createCloudExecutorConfig } from "../src/cloud-executor/config.js";
import { createCloudExecutorHealthServer } from "../src/cloud-executor/standalone.js";
import { createCloudExecutorProductionRuntime } from "../src/cloud-executor/production.js";

function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

export async function startCloudExecutorWorkerProcess({ root = process.cwd(), env = process.env,
  config = null, productionRuntimeFactory = createCloudExecutorProductionRuntime,
  healthServerFactory = createCloudExecutorHealthServer, handleSignals = true } = {}) {
  const processRuntime = await productionRuntimeFactory({ root, env, config });
  const selectedConfig = processRuntime.config || config || createCloudExecutorConfig({ root, env });
  const health = healthServerFactory({
    processRuntime,
    host: selectedConfig.health?.host || "127.0.0.1",
    port: selectedConfig.health?.port || 3001
  });
  try {
    await health.listen();
  } catch (error) {
    await processRuntime.close?.().catch?.(() => undefined);
    throw error;
  }
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    await health.close();
    await processRuntime.close?.();
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
  }
  async function shutdown() { await close(); }
  if (handleSignals) {
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }
  return { ...processRuntime, health, close };
}

if (isDirectExecution()) {
  const root = path.resolve(process.cwd());
  const handle = await startCloudExecutorWorkerProcess({ root });
  console.log(JSON.stringify({
    event: "cloud_executor_worker_started",
    status: handle.startup?.status || handle.runtime?.status || "starting",
    runtime: "cloud_executor",
    concurrency: 1
  }));
}
