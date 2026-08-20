import path from "node:path";

import { createFakeExecutor } from "../executors/fake-executor.js";
import { getProjectRoot } from "../core/project-root.js";

export const PRODUCTION_FEATURES = Object.freeze([
  "identity",
  "assets",
  "projectContent",
  "copyGeneration",
  "copyQuality",
  "copyReview",
  "avatarSelection",
  "videoPlanning",
  "productionOrders",
  "manualHandoff",
  "manualExecution",
  "artifactVerification",
  "workDelivery"
]);

export const PRODUCTION_FEATURE_FLAGS = Object.freeze({
  A01: true,
  A02: true,
  A03: true,
  A04: true,
  A05: true,
  A06: true,
  A07: true,
  A08: true,
  A09: true,
  A10: true,
  A11: true,
  A12: true,
  A13: true,
  A14: true
});

const DEFAULT_PORT = 3000;
const DEFAULT_DATA_DIR = "/var/lib/hifly";
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const COPY_GENERATION_PROVIDERS = new Set(["phase1_controlled_test_double", "deepseek"]);
const COPY_QUALITY_EVALUATORS = new Set(["phase1_controlled_test_double", "deepseek_hybrid"]);
const COPY_QUALITY_REWRITERS = new Set(["phase1_controlled_test_double", "deepseek"]);
const CLOUD_EXECUTOR_CONTROL_PLANE_MODES = new Set(["fail_closed", "fake", "playwright", "login"]);

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value.trim() === "") {
    throw Object.assign(new Error(`${name}_REQUIRED`), { code: `${name}_REQUIRED` });
  }
  return value.trim();
}

function integer(value, name, { min = 1, max = 65535 } = {}) {
  const selected = Number(value);
  if (!Number.isInteger(selected) || selected < min || selected > max) {
    throw Object.assign(new Error(`${name}_INVALID`), { code: `${name}_INVALID` });
  }
  return selected;
}

function duration(value, name, fallback, { min = 1_000, max = 30 * 60 * 1000 } = {}) {
  return integer(value || fallback, name, { min, max });
}

function boolean(value, name, fallback = false) {
  if (value === undefined || value === "") return fallback;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw Object.assign(new Error(`${name}_INVALID`), { code: `${name}_INVALID` });
}

function list(value) {
  if (value === undefined || value === "") return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim()))];
}

function dataPath(root, value) {
  return path.resolve(root, value || DEFAULT_DATA_DIR);
}

function workerOptions() {
  return {
    autoStart: true,
    pollIntervalMs: 1000,
    leaseMs: 30_000,
    heartbeatIntervalMs: 5_000,
    maxAttempts: 3
  };
}

function databaseSsl(env) {
  if (!boolean(env.DATABASE_SSL, "DATABASE_SSL", false)) return false;
  return { rejectUnauthorized: boolean(env.DATABASE_SSL_REJECT_UNAUTHORIZED, "DATABASE_SSL_REJECT_UNAUTHORIZED", true) };
}

export function createProductionConfig({ root = getProjectRoot(), env = process.env } = {}) {
  const databaseUrl = required(env, "DATABASE_URL");
  const publicHost = required(env, "PUBLIC_HOST");
  const publicOrigin = required(env, "PUBLIC_ORIGIN");
  let origin;
  try {
    origin = new URL(publicOrigin);
  } catch {
    throw Object.assign(new Error("PUBLIC_ORIGIN_INVALID"), { code: "PUBLIC_ORIGIN_INVALID" });
  }
  if (origin.protocol !== "https:") {
    throw Object.assign(new Error("PUBLIC_ORIGIN_MUST_USE_HTTPS"), { code: "PUBLIC_ORIGIN_MUST_USE_HTTPS" });
  }

  const port = integer(env.PORT || DEFAULT_PORT, "PORT");
  const dataDir = dataPath(root, env.DATA_DIR);
  const backupDir = dataPath(root, env.BACKUP_DIR || "/var/backups/hifly");
  const cloudExecutorOutputsRoot = dataPath(root, env.CLOUD_EXECUTOR_OUTPUTS_DIR || "/var/lib/hifly-executor/outputs");
  const trustedHosts = unique([
    publicHost,
    `127.0.0.1:${port}`,
    `localhost:${port}`,
    ...list(env.TRUSTED_HOSTS)
  ]);
  const trustedOrigins = unique([publicOrigin, ...list(env.TRUSTED_ORIGINS)]);
  const seedEnabled = boolean(env.INITIAL_ADMIN_ENABLED, "INITIAL_ADMIN_ENABLED", true);
  const adminEmail = seedEnabled ? required(env, "INITIAL_ADMIN_EMAIL") : null;
  const adminPassword = seedEnabled ? required(env, "INITIAL_ADMIN_PASSWORD") : null;
  const organizationId = seedEnabled ? required(env, "INITIAL_ORGANIZATION_ID") : null;
  const organizationName = seedEnabled ? required(env, "INITIAL_ORGANIZATION_NAME") : null;
  const executionMode = env.PRODUCTION_EXECUTOR?.trim() || "fail_closed";
  if (!new Set(["fail_closed", "fake"]).has(executionMode)) {
    throw Object.assign(new Error("PRODUCTION_EXECUTOR_UNSUPPORTED"), { code: "PRODUCTION_EXECUTOR_UNSUPPORTED" });
  }

  const copyGenerationProvider = env.COPY_GENERATION_PROVIDER?.trim() || "phase1_controlled_test_double";
  if (!COPY_GENERATION_PROVIDERS.has(copyGenerationProvider)) {
    throw Object.assign(new Error("COPY_GENERATION_PROVIDER_UNSUPPORTED"), { code: "COPY_GENERATION_PROVIDER_UNSUPPORTED" });
  }
  const copyQualityEvaluator = env.COPY_QUALITY_EVALUATOR?.trim() || "phase1_controlled_test_double";
  if (!COPY_QUALITY_EVALUATORS.has(copyQualityEvaluator)) {
    throw Object.assign(new Error("COPY_QUALITY_EVALUATOR_UNSUPPORTED"), { code: "COPY_QUALITY_EVALUATOR_UNSUPPORTED" });
  }
  const copyQualityRewriter = env.COPY_QUALITY_REWRITER?.trim() || "phase1_controlled_test_double";
  if (!COPY_QUALITY_REWRITERS.has(copyQualityRewriter)) {
    throw Object.assign(new Error("COPY_QUALITY_REWRITER_UNSUPPORTED"), { code: "COPY_QUALITY_REWRITER_UNSUPPORTED" });
  }
  const deepseek = copyGenerationProvider === "deepseek" || copyQualityEvaluator === "deepseek_hybrid" || copyQualityRewriter === "deepseek"
    ? { apiKey: required(env, "DEEPSEEK_API_KEY"), model: "deepseek-v4-flash" }
    : null;

  const worker = workerOptions();
  const hiflyApiToken = env.HIFLY_API_TOKEN?.trim() || null;
  const localAgentRequested = boolean(env.LOCAL_AGENT_ENABLED, "LOCAL_AGENT_ENABLED", false);
  const localAgentId = env.LOCAL_AGENT_ID?.trim() || null;
  const localAgentOrganizationId = env.LOCAL_AGENT_ORGANIZATION_ID?.trim() || null;
  const localAgentToken = env.LOCAL_AGENT_TOKEN?.trim() || null;
  if (localAgentRequested && (!localAgentId || !localAgentOrganizationId || !localAgentToken)) {
    throw Object.assign(new Error("LOCAL_AGENT_CONFIG_REQUIRED"), { code: "LOCAL_AGENT_CONFIG_REQUIRED" });
  }
  const cloudExecutorRequested = boolean(env.CLOUD_EXECUTOR_ENABLED, "CLOUD_EXECUTOR_ENABLED", false);
  const cloudExecutorMode = env.CLOUD_EXECUTOR_MODE?.trim() || "fail_closed";
  if (!CLOUD_EXECUTOR_CONTROL_PLANE_MODES.has(cloudExecutorMode)) {
    throw Object.assign(new Error("CLOUD_EXECUTOR_MODE_UNSUPPORTED"), { code: "CLOUD_EXECUTOR_MODE_UNSUPPORTED" });
  }
  const cloudExecutorId = env.CLOUD_EXECUTOR_ID?.trim() || null;
  const cloudExecutorOrganizationId = env.CLOUD_EXECUTOR_ORGANIZATION_ID?.trim() || null;
  const cloudExecutorHeartbeatToken = env.CLOUD_EXECUTOR_HEARTBEAT_TOKEN?.trim() || null;
  const cloudExecutorStandbyHeartbeatEnabled = boolean(
    env.CLOUD_EXECUTOR_STANDBY_HEARTBEAT_ENABLED,
    "CLOUD_EXECUTOR_STANDBY_HEARTBEAT_ENABLED",
    false
  );
  if ((cloudExecutorRequested || cloudExecutorStandbyHeartbeatEnabled) &&
    (!cloudExecutorId || !cloudExecutorOrganizationId || !cloudExecutorHeartbeatToken)) {
    throw Object.assign(new Error("CLOUD_EXECUTOR_CONTROL_PLANE_CONFIG_REQUIRED"), { code: "CLOUD_EXECUTOR_CONTROL_PLANE_CONFIG_REQUIRED" });
  }
  const cloudExecutorHeartbeatTimeoutMs = duration(
    env.CLOUD_EXECUTOR_HEARTBEAT_TIMEOUT_MS,
    "CLOUD_EXECUTOR_HEARTBEAT_TIMEOUT_MS",
    15_000
  );
  const generationConfig = {
    executionBackend: executionMode,
    rpa: {
      mode: "mock",
      captureHttpMode: "mock",
      realLive: {
        enabled: false,
        allowedHosts: [],
        artifactAllowedHosts: [],
        allowedDomains: [],
        batch: { enabled: false, maxItems: 0 }
      },
      callbackBaseUrl: publicOrigin
    },
    uploadLimits: {
      maxImageBytes: 10 * 1024 * 1024,
      maxTableBytes: 20 * 1024 * 1024,
      maxBatchFiles: 500,
      maxBatchBytes: 128 * 1024 * 1024,
      maxImagePixels: 40_000_000
    },
    executionLock: { heartbeatIntervalMs: 5_000, suspiciousAfterMs: 30_000 },
    pointsEstimate: { version: "pilot-fail-closed", assetPointsPerItem: 0, videoPointsEstimate: null },
    batch: { maxItems: 1, retryLimit: 2, defaultTimeoutMs: 30_000, generationTimeoutMs: 1_800_000 }
  };

  return {
    root: path.resolve(root),
    dataDir,
    backupDir,
    port,
    listenHost: "0.0.0.0",
    publicHost,
    publicOrigin,
    databaseUrl,
    databasePoolMax: integer(env.DATABASE_POOL_MAX || 8, "DATABASE_POOL_MAX", { min: 1, max: 16 }),
    databaseSsl: databaseSsl(env),
    startupMigrations: false,
    featureFlags: PRODUCTION_FEATURE_FLAGS,
    generationConfig,
    identity: {
      enabled: true,
      databaseUrl,
      listenHost: "0.0.0.0",
      trustedHosts,
      trustedOrigins,
      cookieSecure: true,
      sessionTtlMs: integer(env.SESSION_TTL_MS || DEFAULT_SESSION_TTL_MS, "SESSION_TTL_MS", { min: 60_000, max: 30 * 24 * 60 * 60 * 1000 }),
      seed: {
        enabled: seedEnabled,
        organizationId,
        organizationName,
        adminEmail,
        adminDisplayName: env.INITIAL_ADMIN_DISPLAY_NAME?.trim() || "Pilot Admin",
        adminTempPassword: adminPassword
      }
    },
    assets: {
      enabled: true,
      adapter: "local",
      localRoot: path.join(dataDir, "objects"),
      readOnlyFallbackRoot: cloudExecutorOutputsRoot,
      uploadTtlMs: 600_000,
      downloadTtlMs: 300_000,
      worker
    },
    projectContent: { enabled: true },
    copyGeneration: {
      enabled: true,
      provider: copyGenerationProvider,
      deepseek: copyGenerationProvider === "deepseek" ? deepseek : null,
      worker
    },
    copyQuality: {
      enabled: true,
      profileVersion: "commerce-cn-v1",
      ruleVersion: "rules-pilot-controlled",
      evaluator: copyQualityEvaluator,
      deepseek: copyQualityEvaluator === "deepseek_hybrid" || copyQualityRewriter === "deepseek" ? deepseek : null,
      rewriter: copyQualityRewriter,
      worker
    },
    copyReview: { enabled: true },
    avatarSelection: { enabled: true },
    videoPlanning: { enabled: true, worker },
    appearanceFidelity: {
      enabled: boolean(env.APPEARANCE_FIDELITY_ENABLED, "APPEARANCE_FIDELITY_ENABLED", false),
      provider: "disabled",
      worker: { ...worker, autoStart: false }
    },
    productionOrders: { enabled: true },
    manualHandoff: { enabled: true, localRoot: path.join(dataDir, "manual-handoff-packages"), worker },
    manualExecution: { enabled: true, maxCandidateBytes: 256 * 1024 * 1024, localRoot: path.join(dataDir, "manual-execution-candidates"), worker },
    localAgentExecution: {
      enabled: localAgentRequested && Boolean(localAgentId && localAgentOrganizationId && localAgentToken),
      configured: localAgentRequested,
      agentId: localAgentId,
      organizationId: localAgentOrganizationId,
      token: localAgentToken,
      leaseMs: duration(env.LOCAL_AGENT_LEASE_MS, "LOCAL_AGENT_LEASE_MS", 30_000)
    },
    cloudExecutor: {
      enabled: cloudExecutorRequested,
      configured: cloudExecutorRequested && Boolean(cloudExecutorId && cloudExecutorOrganizationId && cloudExecutorHeartbeatToken),
      mode: cloudExecutorMode,
      organizationId: cloudExecutorOrganizationId,
      executorCloudId: cloudExecutorId,
      heartbeatTimeoutMs: cloudExecutorHeartbeatTimeoutMs,
      ...(cloudExecutorStandbyHeartbeatEnabled ? { standbyHeartbeatEnabled: true } : {}),
      internal: {
        enabled: cloudExecutorRequested || cloudExecutorStandbyHeartbeatEnabled,
        organizationId: cloudExecutorOrganizationId,
        executorCloudId: cloudExecutorId,
        token: cloudExecutorHeartbeatToken
      }
    },
    artifactVerification: { enabled: true, worker },
    workDelivery: { enabled: true },
    hiflyApi: {
      enabled: Boolean(hiflyApiToken),
      token: hiflyApiToken,
      timeoutMs: integer(env.HIFLY_API_TIMEOUT_MS || 10_000, "HIFLY_API_TIMEOUT_MS", { min: 1_000, max: 60_000 })
    }
  };
}

function unavailable(method) {
  return async () => {
    throw Object.assign(new Error(`Production executor is unavailable: ${method}`), {
      code: "EXECUTOR_UNAVAILABLE"
    });
  };
}

export function createFailClosedExecutor() {
  return {
    backend: "fail_closed",
    setCallbackBaseUrl() {},
    createAsset: unavailable("createAsset"),
    submitVideo: unavailable("submitVideo"),
    querySubmission: unavailable("querySubmission"),
    downloadArtifact: unavailable("downloadArtifact"),
    reconcileSubmission: unavailable("reconcileSubmission"),
    async close() {}
  };
}

export function createProductionExecutor({ mode = "fail_closed", scenario = {} } = {}) {
  if (mode === "fail_closed") return createFailClosedExecutor();
  if (mode === "fake") return Object.assign(createFakeExecutor(scenario), { backend: "fake" });
  throw Object.assign(new Error("PRODUCTION_EXECUTOR_UNSUPPORTED"), { code: "PRODUCTION_EXECUTOR_UNSUPPORTED" });
}
