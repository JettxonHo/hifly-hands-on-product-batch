import Fastify from "fastify";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import path from "node:path";

import { createAssetService } from "../assets/asset-service.js";
import { createLocalObjectStore } from "../assets/local-object-store.js";
import { createPostgresAssetRepository } from "../assets/postgres-asset-repository.js";
import { createVerificationWorker } from "../assets/verification-worker.js";
import { createProjectContentService } from "../project-content/project-content-service.js";
import { createPostgresProjectContentRepository } from "../project-content/postgres-project-content-repository.js";
import { createControlledCopyProvider } from "../copy-generation/controlled-provider.js";
import { createCopyGenerationService } from "../copy-generation/copy-generation-service.js";
import { createCopyGenerationWorker } from "../copy-generation/copy-generation-worker.js";
import { createPostgresCopyGenerationRepository } from "../copy-generation/postgres-copy-generation-repository.js";
import { createControlledQualityEvaluator } from "../copy-quality/controlled-evaluator.js";
import { createControlledCopyRewriter } from "../copy-quality/controlled-rewriter.js";
import { createStaticQualityProfileResolver } from "../copy-quality/static-profile-resolver.js";
import { createCopyQualityService } from "../copy-quality/copy-quality-service.js";
import { createCopyQualityWorker } from "../copy-quality/copy-quality-worker.js";
import { createCopyRewriteWorker } from "../copy-quality/copy-rewrite-worker.js";
import { createPostgresCopyQualityRepository } from "../copy-quality/postgres-copy-quality-repository.js";
import { createCopyReviewService } from "../copy-review/copy-review-service.js";
import { createCopyReviewInvalidationCoordinator } from "../copy-review/invalidation-coordinator.js";
import { createPostgresCopyReviewRepository } from "../copy-review/postgres-copy-review-repository.js";
import { createAvatarSelectionService, createCurrentApprovedCopyPort } from "../avatar-selection/avatar-selection-service.js";
import { createPostgresAvatarSelectionRepository } from "../avatar-selection/postgres-avatar-selection-repository.js";
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
import { registerProjectContentRoutes } from "./routes/project-content.js";
import { registerCopyGenerationRoutes } from "./routes/copy-generation.js";
import { registerCopyQualityRoutes } from "./routes/copy-quality.js";
import { registerCopyReviewRoutes } from "./routes/copy-review.js";
import { registerAvatarSelectionRoutes } from "./routes/avatar-selection.js";

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
  if (["PROJECT_NOT_FOUND", "PRODUCT_REVISION_NOT_FOUND", "SELLING_POINT_NOT_FOUND"].includes(error?.code)) {
    return { statusCode: 404, code: error.code };
  }
  if (["COPY_GENERATION_JOB_NOT_FOUND", "COPY_VERSION_NOT_FOUND"].includes(error?.code)) return { statusCode: 404, code: error.code };
  if (["QUALITY_RUN_NOT_FOUND", "QUALITY_FINDING_NOT_FOUND", "COPY_REWRITE_JOB_NOT_FOUND"].includes(error?.code)) return { statusCode: 404, code: error.code };
  if (error?.code === "COPY_REVIEW_NOT_FOUND") return { statusCode: 404, code: error.code };
  if (["COPY_VERSION_CONFLICT", "COPY_VERSION_IMMUTABLE", "COPY_GENERATION_RETRY_BLOCKED", "COPY_GENERATION_ABORT_BLOCKED", "COPY_GENERATION_LEASE_LOST", "COPY_GENERATION_RETRY_EXHAUSTED"].includes(error?.code)) return { statusCode: 409, code: error.code };
  if (["QUALITY_RUN_RETRY_BLOCKED", "QUALITY_RUN_CANCEL_BLOCKED", "QUALITY_RUN_LEASE_LOST", "COPY_REWRITE_REQUIRES_FROZEN_VERSION", "COPY_REWRITE_RETRY_BLOCKED", "COPY_REWRITE_LEASE_LOST"].includes(error?.code)) return { statusCode: 409, code: error.code };
  if (["COPY_REVIEW_CONFLICT", "COPY_REVIEW_ACTIVE_EXISTS"].includes(error?.code)) return { statusCode: 409, code: error.code };
  if (["COPY_GENERATION_CONTEXT_REQUIRED", "COPY_BODY_REQUIRED", "INVALID_COPY_REVISION"].includes(error?.code)) return { statusCode: 400, code: error.code };
  if (["COPY_QUALITY_CONTEXT_REQUIRED", "QUALITY_PROFILE_REQUIRED", "QUALITY_FINDING_RESOLUTION_INVALID", "QUALITY_FINDING_REASON_REQUIRED", "QUALITY_FINDING_ACCEPT_BLOCKED", "COPY_REWRITE_EMPTY_RESULT", "COPY_REWRITE_NO_CHANGE", "COPY_REWRITE_SCOPE_INVALID", "COPY_REWRITE_INSTRUCTION_REQUIRED"].includes(error?.code)) return { statusCode: 400, code: error.code };
  if (["COPY_REVIEW_CONTEXT_REQUIRED", "COPY_REVIEW_REASON_REQUIRED"].includes(error?.code)) return { statusCode: 400, code: error.code };
  if (error?.code === "COPY_REVIEW_FORBIDDEN") return { statusCode: 403, code: error.code };
  if (error?.code === "COPY_REVIEW_GATE_BLOCKED") return { statusCode: 422, code: error.code, reasons: error.details || [] };
  if (error?.code === "AVATAR_ASSET_VERSION_NOT_FOUND") return { statusCode: 404, code: error.code };
  if (["AVATAR_SELECTION_CONFLICT", "IDEMPOTENCY_CONFLICT"].includes(error?.code)) return { statusCode: 409, code: error.code };
  if (["AVATAR_SELECTION_CONTEXT_REQUIRED", "INVALID_AVATAR_SELECTION_PAYLOAD"].includes(error?.code)) return { statusCode: 400, code: error.code };
  if (error?.code === "AVATAR_SELECTION_FORBIDDEN") return { statusCode: 403, code: error.code };
  if (error?.code === "AVATAR_SELECTION_GATE_BLOCKED") return { statusCode: 422, code: error.code, reasons: error.details || [] };
  if (error?.code === "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT") return { statusCode: 422, code: error.code };
  if (error?.code === "COPY_QUALITY_POLICY_CHANGED") return { statusCode: 409, code: error.code };
  if (["PRODUCT_REVISION_CONFLICT", "PRODUCT_REVISION_IMMUTABLE"].includes(error?.code)) {
    return { statusCode: 409, code: error.code };
  }
  if (error?.code === "PRODUCT_REVISION_READY_BLOCKED") {
    return { statusCode: 422, code: error.code, reasons: error.reasons };
  }
  if (["PROJECT_CONTENT_CONTEXT_REQUIRED", "PROJECT_NAME_REQUIRED", "INVALID_CONTENT_BRIEF", "INVALID_SELLING_POINTS", "INVALID_SELLING_POINT_ID", "SELLING_POINT_EMPTY"].includes(error?.code)) {
    return { statusCode: 400, code: error.code };
  }
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
  projectContent: projectContentOptions = null,
  copyGeneration: copyGenerationOptions = null,
  copyQuality: copyQualityOptions = null,
  copyReview: copyReviewOptions = null,
  avatarSelection: avatarSelectionOptions = null,
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
  const projectContentEnabled = projectContentOptions?.enabled === true;
  const copyGenerationEnabled = copyGenerationOptions?.enabled === true;
  const copyQualityEnabled = copyQualityOptions?.enabled === true;
  const copyReviewEnabled = copyReviewOptions?.enabled === true;
  const avatarSelectionEnabled = avatarSelectionOptions?.enabled === true;
  if (assetsEnabled && !identityEnabled) throw Object.assign(new Error("ASSETS_REQUIRE_IDENTITY"), { code: "ASSETS_REQUIRE_IDENTITY" });
  if (projectContentEnabled && !identityEnabled) throw Object.assign(new Error("PROJECT_CONTENT_REQUIRES_IDENTITY"), { code: "PROJECT_CONTENT_REQUIRES_IDENTITY" });
  if (copyGenerationEnabled && !projectContentEnabled) throw Object.assign(new Error("COPY_GENERATION_REQUIRES_PROJECT_CONTENT"), { code: "COPY_GENERATION_REQUIRES_PROJECT_CONTENT" });
  if (copyQualityEnabled && !copyGenerationEnabled) throw Object.assign(new Error("COPY_QUALITY_REQUIRES_COPY_GENERATION"), { code: "COPY_QUALITY_REQUIRES_COPY_GENERATION" });
  if (copyReviewEnabled && !copyQualityEnabled) throw Object.assign(new Error("COPY_REVIEW_REQUIRES_COPY_QUALITY"), { code: "COPY_REVIEW_REQUIRES_COPY_QUALITY" });
  if (avatarSelectionEnabled && !identityEnabled) throw Object.assign(new Error("AVATAR_SELECTION_REQUIRES_IDENTITY"), { code: "AVATAR_SELECTION_REQUIRES_IDENTITY" });
  if (avatarSelectionEnabled && !avatarSelectionOptions.copyApprovalPort && !copyReviewEnabled) throw Object.assign(new Error("AVATAR_SELECTION_REQUIRES_COPY_REVIEW"), { code: "AVATAR_SELECTION_REQUIRES_COPY_REVIEW" });
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
  let projectContentRepository = null;
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
    reply.code(result.statusCode).send({ error: result.code, ...(result.reasons ? { reasons: result.reasons } : {}) });
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
      projectContentEnabled,
      copyGenerationEnabled,
      copyQualityEnabled,
      copyReviewEnabled,
      avatarSelectionEnabled,
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
  const reviewInvalidationCoordinator = copyReviewEnabled ? createCopyReviewInvalidationCoordinator() : null;
  if (projectContentEnabled) {
    projectContentRepository = projectContentOptions.repository || (sharedPool ? createPostgresProjectContentRepository({ pool: sharedPool }) : null);
    const assetReferencePort = projectContentOptions.assetReferencePort || assetService?.assetReferencePort;
    if (!projectContentRepository) throw Object.assign(new Error("PROJECT_CONTENT_REPOSITORY_REQUIRED_WITH_INJECTED_IDENTITY"), { code: "PROJECT_CONTENT_REPOSITORY_REQUIRED_WITH_INJECTED_IDENTITY" });
    if (!assetReferencePort) throw Object.assign(new Error("PROJECT_CONTENT_ASSET_PORT_REQUIRED"), { code: "PROJECT_CONTENT_ASSET_PORT_REQUIRED" });
    await projectContentRepository.initialize();
    const projectContentService = createProjectContentService({ repository: projectContentRepository, assetReferencePort,
      reviewInvalidationCoordinator, now });
    app.decorate("projectContent", { repository: projectContentRepository, service: projectContentService, productRevisionPort: projectContentService.productRevisionPort });
    app.addHook("onClose", async () => projectContentRepository.close?.());
    await registerProjectContentRoutes(app, { service: projectContentService });
  }
  if (copyGenerationEnabled) {
    const repository = copyGenerationOptions.repository || (sharedPool ? createPostgresCopyGenerationRepository({ pool: sharedPool }) : null);
    if (!repository) throw Object.assign(new Error("COPY_GENERATION_REPOSITORY_REQUIRED"), { code: "COPY_GENERATION_REPOSITORY_REQUIRED" });
    await repository.initialize();
    const provider = copyGenerationOptions.provider || createControlledCopyProvider();
    const service = createCopyGenerationService({ repository, productRevisionPort: app.projectContent.productRevisionPort, now,
      maxAttempts: copyGenerationOptions.worker?.maxAttempts, reviewInvalidationCoordinator });
    const worker = createCopyGenerationWorker({
      service, provider, pollIntervalMs: copyGenerationOptions.worker?.pollIntervalMs,
      leaseMs: copyGenerationOptions.worker?.leaseMs, heartbeatIntervalMs: copyGenerationOptions.worker?.heartbeatIntervalMs,
      onError: copyGenerationOptions.worker?.onError || ((error) => console.error("Copy generation worker error:", error?.code || "UNEXPECTED_ERROR"))
    });
    app.decorate("copyGeneration", { repository, service, worker, providerKind: worker.providerKind });
    app.addHook("onClose", async () => { worker.stop(); await repository.close?.(); });
    await registerCopyGenerationRoutes(app, { service, worker });
    if (copyGenerationOptions.worker?.autoStart !== false) worker.start();
  }
  if (copyQualityEnabled) {
    const repository = copyQualityOptions.repository || (sharedPool ? createPostgresCopyQualityRepository({ pool: sharedPool }) : null);
    if (!repository) throw Object.assign(new Error("COPY_QUALITY_REPOSITORY_REQUIRED"), { code: "COPY_QUALITY_REPOSITORY_REQUIRED" });
    await repository.initialize();
    const evaluator = copyQualityOptions.evaluator || createControlledQualityEvaluator();
    const rewriter = copyQualityOptions.rewriter || createControlledCopyRewriter();
    const profileResolver = copyQualityOptions.profileResolver || createStaticQualityProfileResolver({
      profileVersion: copyQualityOptions.profileVersion, ruleVersion: copyQualityOptions.ruleVersion
    });
    const service = createCopyQualityService({ repository, copyService: app.copyGeneration.service,
      profileResolver, reviewInvalidationCoordinator, now,
      maxAttempts: copyQualityOptions.worker?.maxAttempts });
    const worker = createCopyQualityWorker({ service, evaluator,
      pollIntervalMs: copyQualityOptions.worker?.pollIntervalMs,
      leaseMs: copyQualityOptions.worker?.leaseMs,
      heartbeatIntervalMs: copyQualityOptions.worker?.heartbeatIntervalMs,
      onError: copyQualityOptions.worker?.onError || ((error) => console.error("Copy quality worker error:", error?.code || "UNEXPECTED_ERROR")) });
    const rewriteWorker = createCopyRewriteWorker({ service, rewriter,
      pollIntervalMs: copyQualityOptions.worker?.pollIntervalMs,
      leaseMs: copyQualityOptions.worker?.leaseMs,
      heartbeatIntervalMs: copyQualityOptions.worker?.heartbeatIntervalMs,
      onError: copyQualityOptions.worker?.onError || ((error) => console.error("Copy rewrite worker error:", error?.code || "UNEXPECTED_ERROR")) });
    app.decorate("copyQuality", { repository, service, worker, rewriteWorker, evaluatorKind: worker.evaluatorKind,
      rewriterKind: rewriteWorker.rewriterKind, profileResolverKind: profileResolver.kind || "unknown" });
    app.addHook("onClose", async () => { worker.stop(); rewriteWorker.stop(); await repository.close?.(); });
    await registerCopyQualityRoutes(app, { service, worker, rewriteWorker });
    if (copyQualityOptions.worker?.autoStart !== false) { worker.start(); rewriteWorker.start(); }
  }
  if (copyReviewEnabled) {
    const repository = copyReviewOptions.repository || (sharedPool ? createPostgresCopyReviewRepository({ pool: sharedPool }) : null);
    if (!repository) throw Object.assign(new Error("COPY_REVIEW_REPOSITORY_REQUIRED"), { code: "COPY_REVIEW_REPOSITORY_REQUIRED" });
    await repository.initialize();
    const service = createCopyReviewService({ repository, copyService: app.copyGeneration.service,
      qualityService: app.copyQuality.service, now });
    reviewInvalidationCoordinator.attach(service);
    app.decorate("copyReview", { repository, service });
    app.addHook("onClose", async () => repository.close?.());
    await registerCopyReviewRoutes(app, { service });
  }
  if (avatarSelectionEnabled) {
    const repository = avatarSelectionOptions.repository || (sharedPool ? createPostgresAvatarSelectionRepository({ pool: sharedPool }) : null);
    if (!repository) throw Object.assign(new Error("AVATAR_SELECTION_REPOSITORY_REQUIRED"), { code: "AVATAR_SELECTION_REPOSITORY_REQUIRED" });
    await repository.initialize();
    const copyApprovalPort = avatarSelectionOptions.copyApprovalPort || createCurrentApprovedCopyPort({
      copyService: app.copyGeneration.service, copyReviewService: app.copyReview.service
    });
    const service = createAvatarSelectionService({ repository, copyApprovalPort, now });
    app.decorate("avatarSelection", { repository, service, copyApprovalPort });
    app.addHook("onClose", async () => repository.close?.());
    await registerAvatarSelectionRoutes(app, { service });
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
