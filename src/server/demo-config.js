import path from "node:path";

export const DEMO_FEATURES = Object.freeze([
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

export const DEMO_CREDENTIALS = Object.freeze({
  email: "demo-admin@demo.local",
  temporaryPassword: "Demo-Local-2026-Only!"
});

const DEMO_ORGANIZATION = Object.freeze({
  id: "org_demo_local",
  name: "本地演示企业"
});

function assertLocalDatabaseUrl(databaseUrl) {
  if (typeof databaseUrl !== "string" || databaseUrl.length === 0) {
    throw new TypeError("demo databaseUrl is required");
  }
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new TypeError("demo databaseUrl must be a valid PostgreSQL URL");
  }
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") {
    throw new TypeError("demo databaseUrl must use PostgreSQL");
  }
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw Object.assign(new Error("DEMO_DATABASE_MUST_BE_LOCAL"), { code: "DEMO_DATABASE_MUST_BE_LOCAL" });
  }
  return databaseUrl;
}

function assertPort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new RangeError("demo port must be a valid TCP port");
  }
  return port;
}

function workerOptions() {
  return {
    autoStart: true,
    pollIntervalMs: 200,
    leaseMs: 30_000,
    heartbeatIntervalMs: 1_000,
    maxAttempts: 3
  };
}

export function createDemoConfig({ root, port, databaseUrl } = {}) {
  if (typeof root !== "string" || root.length === 0) throw new TypeError("demo root is required");
  const selectedPort = assertPort(port);
  const selectedDatabaseUrl = assertLocalDatabaseUrl(databaseUrl);
  const host = `127.0.0.1:${selectedPort}`;

  return {
    root: path.resolve(root),
    databaseUrl: selectedDatabaseUrl,
    landingPath: "/login.html",
    credentials: DEMO_CREDENTIALS,
    generationConfig: {
      executionBackend: "fake",
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
        callbackBaseUrl: `http://${host}`
      },
      uploadLimits: {
        maxImageBytes: 10 * 1024 * 1024,
        maxTableBytes: 20 * 1024 * 1024,
        maxBatchFiles: 500,
        maxBatchBytes: 1024 * 1024 * 1024,
        maxImagePixels: 40_000_000
      },
      executionLock: { heartbeatIntervalMs: 5_000, suspiciousAfterMs: 30_000 },
      batch: { maxItems: 0, retryLimit: 2, defaultTimeoutMs: 30_000, generationTimeoutMs: 1_800_000 },
      pointsEstimate: { version: "local-demo", assetPointsPerItem: 0, videoPointsEstimate: 0 }
    },
    identity: {
      enabled: true,
      databaseUrl: selectedDatabaseUrl,
      listenHost: "127.0.0.1",
      trustedHosts: [host],
      trustedOrigins: [`http://${host}`],
      cookieSecure: false,
      sessionTtlMs: 8 * 60 * 60 * 1000,
      seed: {
        enabled: true,
        organizationId: DEMO_ORGANIZATION.id,
        organizationName: DEMO_ORGANIZATION.name,
        adminEmail: DEMO_CREDENTIALS.email,
        adminDisplayName: "本地演示管理员",
        adminTempPassword: DEMO_CREDENTIALS.temporaryPassword
      }
    },
    assets: {
      enabled: true,
      adapter: "local",
      localRoot: path.join(path.resolve(root), "assets"),
      uploadTtlMs: 600_000,
      downloadTtlMs: 300_000,
      worker: workerOptions()
    },
    projectContent: { enabled: true },
    copyGeneration: {
      enabled: true,
      provider: "phase1_controlled_test_double",
      worker: workerOptions()
    },
    copyQuality: {
      enabled: true,
      profileVersion: "commerce-cn-v1",
      ruleVersion: "rules-local-demo",
      evaluator: "phase1_controlled_test_double",
      rewriter: "phase1_controlled_test_double",
      worker: workerOptions()
    },
    copyReview: { enabled: true },
    avatarSelection: { enabled: true },
    videoPlanning: { enabled: true, worker: workerOptions() },
    productionOrders: { enabled: true },
    manualHandoff: {
      enabled: true,
      localRoot: path.join(path.resolve(root), "manual-handoff-packages"),
      worker: workerOptions()
    },
    manualExecution: {
      enabled: true,
      maxCandidateBytes: 256 * 1024 * 1024,
      localRoot: path.join(path.resolve(root), "manual-execution-candidates"),
      worker: workerOptions()
    },
    artifactVerification: { enabled: true, worker: workerOptions() },
    workDelivery: { enabled: true }
  };
}
