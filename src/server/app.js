import Fastify from "fastify";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import path from "node:path";

import { createAssetService } from "../assets/asset-service.js";
import { createLocalObjectStore } from "../assets/local-object-store.js";
import { createPostgresAssetRepository } from "../assets/postgres-asset-repository.js";
import { createVerificationWorker } from "../assets/verification-worker.js";
import { createBatchStore } from "../core/batch-store.js";
import { createAuthService } from "../identity/auth-service.js";
import { createPostgresIdentityRepository } from "../identity/postgres-identity-repository.js";
import { createIdentityPool } from "../identity/postgres.js";
import { seedInitialAdmin } from "../identity/seed-admin.js";
import { getProjectRoot } from "../core/project-root.js";
import { createCloudRequestSecurity, createRequestSecurity } from "./request-security.js";
import { registerArtifactRoutes } from "./routes/artifacts.js";
import { registerAssetRoutes } from "./routes/assets.js";
import { registerAuthRoutes, createIdentityGuard } from "./routes/auth.js";
import { registerBatchRoutes } from "./routes/batches.js";
import { registerCaptureRoutes } from "./routes/capture.js";
import { createExecutionCoordinator, registerExecutionRoutes } from "./routes/executions.js";
import { registerImportRoutes } from "./routes/imports.js";
import { registerRpaCallbackRoutes } from "./routes/rpa-callbacks.js";

const CLIENT_ERROR_CODES = new Set([
  "ARTIFACT_NOT_FOUND",
  "BATCH_ALREADY_IMPORTED",
  "BATCH_BYTE_LIMIT",
  "BATCH_FILE_LIMIT",
  "BATCH_NOT_READY",
  "BATCH_ID_MUST_PRECEDE_FILES",
  "CAPTURE_HAR_MISSING",
  "CAPTURE_HTTP_REAL_BATCH_BUDGET_INVALID",
  "CAPTURE_HTTP_REAL_BATCH_DISABLED",
  "CAPTURE_HTTP_REAL_BATCH_IN_PROGRESS",
  "CAPTURE_HTTP_REAL_BATCH_NOT_AUTHORIZED",
  "CAPTURE_HTTP_REAL_BATCH_NOT_READY",
  "CAPTURE_HTTP_RUNTIME_AUTH_UNAVAILABLE",
  "CAPTURE_HTTP_MANIFEST_DRIFT",
  "CAPTURE_MANIFEST_MISSING",
  "CAPTURE_NO_CANDIDATES",
  "CAPTURE_NOT_ENABLED",
  "CAPTURE_RAW_STEPS_MISSING",
  "DECLARED_MIME_MISMATCH",
  "DIRECTORY_UPLOAD_NOT_ALLOWED",
  "DUPLICATE_IDEMPOTENCY_KEY",
  "EXACTLY_ONE_TABLE_REQUIRED",
  "EXECUTION_IN_PROGRESS",
  "EXECUTOR_UNAVAILABLE",
  "EXPLICIT_CONFIRMATION_REQUIRED",
  "IMAGE_PIXEL_LIMIT",
  "IMPORT_FILES_REQUIRED",
  "INVALID_BATCH",
  "INVALID_BATCH_ID",
  "INVALID_CAPTURE_PATH",
  "INVALID_CAPTURE_MANIFEST",
  "INVALID_CAPTURE_REAL_BATCH_REQUEST",
  "INVALID_CSV_ENCODING",
  "INVALID_EXECUTION_REQUEST",
  "INVALID_IDEMPOTENCY_KEY",
  "INVALID_IMAGE",
  "INVALID_IMAGE_SIGNATURE",
  "INVALID_IMPORT_FIELDS",
  "INVALID_TABLE_SIGNATURE",
  "INVALID_UPLOAD_FIELD",
  "INVALID_UPLOAD_NAME",
  "INVALID_RPA_CALLBACK",
  "JSON_OR_MULTIPART_REQUIRED",
  "SERVER_STOPPING",
  "SYMLINK_UPLOAD_NOT_ALLOWED",
  "TASK_NOT_FOUND",
  "UNAUTHORIZED_PRODUCT_IMAGE",
  "UNSAFE_TABLE_REFERENCE",
  "UNSUPPORTED_UPLOAD_TYPE",
  "UPLOAD_TOO_LARGE"
]);

function apiError(error) {
  if (["ASSET_NOT_FOUND", "ASSET_VERSION_NOT_FOUND", "UPLOAD_SESSION_NOT_FOUND", "DOWNLOAD_AUTHORIZATION_NOT_FOUND", "OBJECT_MISSING"].includes(error?.code)) {
    return { statusCode: 404, code: error.code };
  }
  if (["ASSET_VERSION_CONFLICT", "ASSET_HISTORY_REFERENCED", "IDEMPOTENCY_CONFLICT", "OBJECT_ALREADY_EXISTS", "UPLOAD_SESSION_NOT_PENDING", "UPLOAD_AUTHORIZATION_NOT_REPLAYABLE"].includes(error?.code)) {
    return { statusCode: 409, code: error.code };
  }
  if (["ASSET_NOT_ACTIVE", "ASSET_VERSION_NOT_AVAILABLE", "UPLOAD_NOT_COMPLETED"].includes(error?.code)) {
    return { statusCode: 422, code: error.code };
  }
  if (error?.code === "ADMIN_REQUIRED") return { statusCode: 403, code: "ADMIN_REQUIRED" };
  if (error?.code === "UPLOAD_AUTHORIZATION_EXPIRED") return { statusCode: 410, code: "UPLOAD_AUTHORIZATION_EXPIRED" };
  if (["INVALID_ASSET_PAYLOAD", "ASSET_TYPE_NOT_ALLOWED", "ASSET_SIZE_NOT_ALLOWED", "INVALID_ASSET_CHECKSUM", "INVALID_ASSET_ID", "INVALID_ASSET_ACTOR", "INVALID_ASSET_DISPLAY_NAME", "INVALID_ASSET_REVISION", "INVALID_UPLOAD_BODY", "UPLOAD_CONTENT_TYPE_MISMATCH", "INVALID_IDEMPOTENCY_KEY"].includes(error?.code)) {
    return { statusCode: 400, code: error.code };
  }
  if (error?.code === "ENOENT" || error?.code === "INVALID_BATCH_ID" || error?.code === "ARTIFACT_NOT_FOUND") {
    return { statusCode: 404, code: "NOT_FOUND" };
  }
  if (error?.code === "EXECUTION_LOCKED") return { statusCode: 409, code: "EXECUTION_LOCKED" };
  if (error?.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    return { statusCode: error.statusCode, code: error.code ?? "BAD_REQUEST" };
  }
  // Service-unavailable conditions that must surface as 503 (not the 400 that
  // CLIENT_ERROR_CODES would otherwise assign): a stopping server, and idempotency
  // registry backpressure (registry full → reject new keys until a receipt expires).
  if (error?.code === "SERVER_STOPPING" || error?.code === "IDEMPOTENCY_REGISTRY_FULL") {
    return { statusCode: 503, code: error.code };
  }
  if (CLIENT_ERROR_CODES.has(error?.code)) return { statusCode: 400, code: error.code };
  return { statusCode: 500, code: "INTERNAL_ERROR" };
}

export async function buildApp({
  root,
  executor = null,
  executorFactory = null,
  openBrowser = null,
  allowedHost = "127.0.0.1:4317",
  uploadLimits = null,
  executionLock = {},
  pointsEstimate = {},
  generationConfig = {},
  captureLive = {},
  webRoot = path.join(getProjectRoot(), "web"),
  storeOptions = {},
  identity: identityOptions = null,
  assets: assetOptions = null,
  idempotencyMaxEntries,
  idempotencyTtlMs,
  now
} = {}) {
  if (typeof root !== "string" || root.length === 0) throw new TypeError("root is required");
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });
  const batchRoot = path.join(path.resolve(root), "batches");
  const staticRoot = path.resolve(webRoot);
  const identityEnabled = identityOptions?.enabled === true;
  const assetsEnabled = assetOptions?.enabled === true;
  if (assetsEnabled && !identityEnabled) throw Object.assign(new Error("ASSETS_REQUIRE_IDENTITY"), { code: "ASSETS_REQUIRE_IDENTITY" });
  const store = createBatchStore(batchRoot, storeOptions);
  // Startup schema migration: every legacy batch is brought to the current
  // schema BEFORE the coordinator and routes exist — buildApp does not resolve
  // until migration is complete (no fire-and-forget background migration).
  await store.initialize();
  let identityRepository = null;
  let identityService = null;
  let ownsIdentityRepository = false;
  let assetService = null;
  let assetWorker = null;
  let sharedPool = null;
  if (identityEnabled) {
    if (identityOptions.repository) {
      identityRepository = identityOptions.repository;
    } else {
      sharedPool = createIdentityPool({ connectionString: identityOptions.databaseUrl || process.env.DATABASE_URL });
      identityRepository = createPostgresIdentityRepository({ pool: sharedPool, ownsPool: false });
      ownsIdentityRepository = true;
    }
    try {
      await identityRepository.initialize();
      if (identityOptions.seed?.enabled) await seedInitialAdmin(identityRepository, identityOptions.seed, { now });
    } catch (error) {
      if (ownsIdentityRepository) await sharedPool?.end().catch(() => undefined);
      throw error;
    }
    identityService = createAuthService({
      repository: identityRepository,
      sessionTtlMs: identityOptions.sessionTtlMs,
      cookieSecure: identityOptions.cookieSecure !== false,
      rateLimit: identityOptions.rateLimit,
      now
    });
  }
  const security = identityEnabled
    ? createCloudRequestSecurity({
        trustedHosts: identityOptions.trustedHosts,
        trustedOrigins: identityOptions.trustedOrigins
      })
    : createRequestSecurity({ allowedHost });
  const coordinator = createExecutionCoordinator({
    batchRoot,
    executor,
    executorFactory,
    store,
    config: generationConfig,
    lockOptions: executionLock,
    pointsEstimate,
    idempotencyMaxEntries,
    idempotencyTtlMs,
    now
  });

  app.decorate("workbench", { batchRoot, executor, openBrowser, store });
  app.decorate("stopExecutions", coordinator.stop);
  app.addHook("onClose", async () => coordinator.stop());
  if (ownsIdentityRepository) app.addHook("onClose", async () => sharedPool.end());
  app.addHook("onRequest", security.onRequest);
  if (identityService) app.addHook("preHandler", createIdentityGuard(identityService));
  app.setErrorHandler((error, request, reply) => {
    const result = apiError(error);
    reply.code(result.statusCode).send({ error: result.code });
  });
  await app.register(multipart, {
    limits: { files: 500, fileSize: 20 * 1024 * 1024, fields: 8, parts: 508 }
  });
  for (const contentType of ["image/jpeg", "image/png", "image/webp"]) {
    app.addContentTypeParser(contentType, { parseAs: "buffer" }, (_request, body, done) => done(null, body));
  }

  if (!identityEnabled) app.get("/api/session", async (request, reply) => security.bootstrap(reply));
  app.get("/api/runtime", async () => {
    const batchConfig = generationConfig.rpa?.realLive?.batch || {};
    return {
      executionBackend: generationConfig.executionBackend || "playwright",
      assetsEnabled,
      realBatchEnabled: batchConfig.enabled === true,
      realBatchMaxItems: Number.isInteger(batchConfig.maxItems) && batchConfig.maxItems >= 1 ? batchConfig.maxItems : 3
    };
  });

  // Enterprise identity layer (VSA-A01). Opt-in: when identity is enabled, an
  // identity store + auth service are constructed and a guard attaches the
  // server-resolved { member, membership, organization } context to every
  // non-public /api/* request. When disabled (the default for the legacy
  // single-user capture workbench) behavior is unchanged.
  if (identityService) {
    app.decorate("identity", { repository: identityRepository, service: identityService });
    await registerAuthRoutes(app, { authService: identityService });
  }
  if (assetsEnabled) {
    const assetRepository = assetOptions.repository || (sharedPool ? createPostgresAssetRepository({ pool: sharedPool }) : null);
    const objectStore = assetOptions.objectStore || (assetOptions.adapter === "local"
      ? createLocalObjectStore({ root: path.resolve(root, assetOptions.localRoot || ".local-assets") })
      : null);
    if (!assetRepository) throw Object.assign(new Error("ASSET_REPOSITORY_REQUIRED_WITH_INJECTED_IDENTITY"), { code: "ASSET_REPOSITORY_REQUIRED_WITH_INJECTED_IDENTITY" });
    if (!objectStore) throw Object.assign(new Error("ASSET_OBJECT_STORE_REQUIRED"), { code: "ASSET_OBJECT_STORE_REQUIRED" });
    try {
      await assetRepository.initialize();
      await objectStore.initialize?.();
    } catch (error) {
      await assetRepository.close?.().catch(() => undefined);
      if (ownsIdentityRepository) await sharedPool.end().catch(() => undefined);
      throw error;
    }
    assetService = createAssetService({
      repository: assetRepository, objectStore,
      uploadTtlMs: assetOptions.uploadTtlMs, downloadTtlMs: assetOptions.downloadTtlMs, now
    });
    assetWorker = createVerificationWorker({
      service: assetService, pollIntervalMs: assetOptions.worker?.pollIntervalMs,
      onError: assetOptions.worker?.onError || ((error) => console.error("Asset verification worker error:", error?.code || "UNEXPECTED_ERROR"))
    });
    app.decorate("assets", { repository: assetRepository, service: assetService, assetReferencePort: assetService.assetReferencePort, worker: assetWorker, objectStore });
    app.addHook("onClose", async () => { assetWorker.stop(); await assetRepository.close?.(); });
    await registerAssetRoutes(app, { service: assetService, worker: assetWorker });
    if (assetOptions.worker?.autoStart !== false) assetWorker.start();
  }

  await registerBatchRoutes(app, { store });
  await registerCaptureRoutes(app, { batchRoot, store, generationConfig, captureLive });
  await registerImportRoutes(app, { batchRoot, store, uploadLimits });
  await registerExecutionRoutes(app, { coordinator });
  await registerArtifactRoutes(app, { batchRoot, store });
  await registerRpaCallbackRoutes(app, { batchRoot, store });
  await app.register(staticFiles, {
    root: staticRoot,
    prefix: "/",
    index: ["index.html"],
    dotfiles: "deny",
    maxAge: 0,
    immutable: false
  });
  return app;
}
