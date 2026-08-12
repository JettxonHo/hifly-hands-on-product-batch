import path from "node:path";
import { pathToFileURL } from "node:url";

import { createControlledCopyProvider } from "../copy-generation/controlled-provider.js";
import { createDeepSeekCopyProvider } from "../copy-generation/deepseek-provider.js";
import { createControlledQualityEvaluator } from "../copy-quality/controlled-evaluator.js";
import { createControlledCopyRewriter } from "../copy-quality/controlled-rewriter.js";
import { createDeepSeekQualityEvaluator } from "../copy-quality/deepseek-evaluator.js";
import { createDeepSeekCopyRewriter } from "../copy-quality/deepseek-rewriter.js";
import { createDeterministicQualityEvaluator } from "../copy-quality/deterministic-evaluator.js";
import { createHybridQualityEvaluator } from "../copy-quality/hybrid-evaluator.js";
import { createIdentityPool } from "../identity/postgres.js";
import { createDeepSeekClient } from "../llm/deepseek-client.js";
import { createFetchTransport } from "../llm/http-transport.js";
import { createControlledPreflightEvaluator } from "../video-planning/controlled-preflight-evaluator.js";
import { createDisabledLiveTransport } from "../rpa/capture/real-live-http-client.js";
import { createHiflyApiClient } from "../providers/hifly-api-client.js";
import { createHiflyPublicAvatarCatalog } from "../avatar-selection/hifly-public-avatar-catalog.js";
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

function copyGenerationProvider(config, deepseekFetch) {
  if (config.copyGeneration.provider === "deepseek") {
    const client = createDeepSeekClient({
      apiKey: config.copyGeneration.deepseek?.apiKey,
      model: config.copyGeneration.deepseek?.model,
      transport: createFetchTransport({ fetchImpl: deepseekFetch })
    });
    return createDeepSeekCopyProvider({ client });
  }
  if (config.copyGeneration.provider === "phase1_controlled_test_double") return createControlledCopyProvider();
  throw Object.assign(new Error("COPY_GENERATION_PROVIDER_UNSUPPORTED"), { code: "COPY_GENERATION_PROVIDER_UNSUPPORTED" });
}

function copyQualityEvaluator(config, deepseekFetch) {
  if (config.copyQuality.evaluator === "phase1_controlled_test_double") return createControlledQualityEvaluator();
  if (config.copyQuality.evaluator === "deepseek_hybrid") {
    const client = createDeepSeekClient({
      apiKey: config.copyQuality.deepseek?.apiKey,
      model: config.copyQuality.deepseek?.model,
      transport: createFetchTransport({ fetchImpl: deepseekFetch })
    });
    return createHybridQualityEvaluator({
      deterministicEvaluator: createDeterministicQualityEvaluator(),
      semanticEvaluator: createDeepSeekQualityEvaluator({ client })
    });
  }
  throw Object.assign(new Error("COPY_QUALITY_EVALUATOR_UNSUPPORTED"), { code: "COPY_QUALITY_EVALUATOR_UNSUPPORTED" });
}

function copyQualityRewriter(config, deepseekFetch) {
  if (config.copyQuality.rewriter === "phase1_controlled_test_double") return createControlledCopyRewriter();
  if (config.copyQuality.rewriter === "deepseek") {
    const client = createDeepSeekClient({
      apiKey: config.copyQuality.deepseek?.apiKey,
      model: config.copyQuality.deepseek?.model,
      transport: createFetchTransport({ fetchImpl: deepseekFetch })
    });
    return createDeepSeekCopyRewriter({ client });
  }
  throw Object.assign(new Error("COPY_QUALITY_REWRITER_UNSUPPORTED"), { code: "COPY_QUALITY_REWRITER_UNSUPPORTED" });
}

function appOptions(config, projectRoot, pool, executor, hiflyFetch, deepseekFetch) {
  const hiflyClient = config.hiflyApi.enabled ? createHiflyApiClient({
    token: config.hiflyApi.token,
    timeoutMs: config.hiflyApi.timeoutMs,
    fetchImpl: hiflyFetch
  }) : null;
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
    copyGeneration: { ...config.copyGeneration, provider: copyGenerationProvider(config, deepseekFetch) },
    copyQuality: {
      ...config.copyQuality,
      evaluator: copyQualityEvaluator(config, deepseekFetch),
      rewriter: copyQualityRewriter(config, deepseekFetch)
    },
    copyReview: config.copyReview,
    avatarSelection: { ...config.avatarSelection,
      publicAvatarCatalog: hiflyClient ? createHiflyPublicAvatarCatalog({ client: hiflyClient }) : null },
    videoPlanning: { ...config.videoPlanning, evaluator: createControlledPreflightEvaluator() },
    productionOrders: config.productionOrders,
    manualHandoff: config.manualHandoff,
    manualExecution: config.manualExecution,
    localAgentExecution: config.localAgentExecution,
    artifactVerification: config.artifactVerification,
    workDelivery: config.workDelivery,
    hiflyApi: hiflyClient ? { enabled: true, client: hiflyClient } : { enabled: false }
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
  deepseekFetch = globalThis.fetch,
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
    app = await buildAppImpl(appOptions(selectedConfig, projectRoot, pool, selectedExecutor, hiflyFetch, deepseekFetch));
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
