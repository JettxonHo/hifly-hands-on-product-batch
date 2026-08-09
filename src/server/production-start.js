import path from "node:path";
import { pathToFileURL } from "node:url";

import { createControlledCopyProvider } from "../copy-generation/controlled-provider.js";
import { createControlledQualityEvaluator } from "../copy-quality/controlled-evaluator.js";
import { createControlledCopyRewriter } from "../copy-quality/controlled-rewriter.js";
import { createIdentityPool } from "../identity/postgres.js";
import { createControlledPreflightEvaluator } from "../video-planning/controlled-preflight-evaluator.js";
import { createDisabledLiveTransport } from "../rpa/capture/real-live-http-client.js";
import { createHiflyApiClient } from "../providers/hifly-api-client.js";
import { buildApp } from "./app.js";
import { createProductionConfig, createProductionExecutor } from "./production-config.js";

function disabledCaptureLive() {
  return {
    authProvider: {
      async getRuntimeAuth() {
        throw Object.assign(new Error("Production real capture is disabled"), {
          code: "CAPTURE_HTTP_REAL_LIVE_DISABLED"
        });
      }
    },
    transport: createDisabledLiveTransport()
  };
}

function appOptions(config, projectRoot, pool, executor, hiflyFetch) {
  return {
    root: config.dataDir,
    webRoot: path.join(projectRoot, "web"),
    executor,
    executorFactory: () => createProductionExecutor({ mode: config.generationConfig.executionBackend }),
    openBrowser: null,
    databasePool: pool,
    closeDatabasePool: false,
    startupMigrations: false,
    uploadLimits: config.generationConfig.uploadLimits,
    executionLock: config.generationConfig.executionLock,
    pointsEstimate: config.generationConfig.pointsEstimate,
    generationConfig: config.generationConfig,
    captureLive: disabledCaptureLive(),
    identity: config.identity,
    assets: config.assets,
    projectContent: config.projectContent,
    copyGeneration: { ...config.copyGeneration, provider: createControlledCopyProvider() },
    copyQuality: {
      ...config.copyQuality,
      evaluator: createControlledQualityEvaluator(),
      rewriter: createControlledCopyRewriter()
    },
    copyReview: config.copyReview,
    avatarSelection: config.avatarSelection,
    videoPlanning: { ...config.videoPlanning, evaluator: createControlledPreflightEvaluator(), agentReadinessPort: { async isOnline() { return false; } } },
    productionOrders: config.productionOrders,
    manualHandoff: config.manualHandoff,
    manualExecution: config.manualExecution,
    artifactVerification: config.artifactVerification,
    workDelivery: config.workDelivery,
    hiflyApi: config.hiflyApi.enabled ? {
      enabled: true,
      client: createHiflyApiClient({
        token: config.hiflyApi.token,
        timeoutMs: config.hiflyApi.timeoutMs,
        fetchImpl: hiflyFetch
      })
    } : { enabled: false }
  };
}

export async function startProductionServer({
  root,
  env = process.env,
  config = null,
  buildAppImpl = buildApp,
  createPool = createIdentityPool,
  executor = null,
  hiflyFetch = globalThis.fetch,
  handleSignals = true
} = {}) {
  const projectRoot = path.resolve(root || process.cwd());
  const selectedConfig = config || createProductionConfig({ root: projectRoot, env });
  const pool = await createPool({
    connectionString: selectedConfig.databaseUrl,
    max: selectedConfig.databasePoolMax,
    ssl: selectedConfig.databaseSsl
  });
  const selectedExecutor = executor || createProductionExecutor({ mode: selectedConfig.generationConfig.executionBackend });
  let app;
  try {
    app = await buildAppImpl(appOptions(selectedConfig, projectRoot, pool, selectedExecutor, hiflyFetch));
    await app.listen({ host: selectedConfig.listenHost, port: selectedConfig.port });
  } catch (error) {
    await app?.close?.().catch(() => undefined);
    await selectedExecutor.close?.().catch(() => undefined);
    await pool.end?.().catch(() => undefined);
    throw error;
  }

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    await app.stopExecutions?.();
    await app.close?.();
    await selectedExecutor.close?.();
    await pool.end?.();
  }
  async function shutdown() {
    await close();
  }
  if (handleSignals) {
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }

  console.log(`Production pilot listening on ${selectedConfig.listenHost}:${selectedConfig.port}`);
  return { app, config: selectedConfig, executor: selectedExecutor, pool, close };
}

function isDirectExecution() {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectExecution()) await startProductionServer();
