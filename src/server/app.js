import Fastify from "fastify";
import multipart from "@fastify/multipart";
import staticFiles from "@fastify/static";
import path from "node:path";

import { createBatchStore } from "../core/batch-store.js";
import { getProjectRoot } from "../core/project-root.js";
import { createRequestSecurity } from "./request-security.js";
import { registerArtifactRoutes } from "./routes/artifacts.js";
import { registerBatchRoutes } from "./routes/batches.js";
import { createExecutionCoordinator, registerExecutionRoutes } from "./routes/executions.js";
import { registerImportRoutes } from "./routes/imports.js";

const CLIENT_ERROR_CODES = new Set([
  "ARTIFACT_NOT_FOUND",
  "BATCH_ALREADY_IMPORTED",
  "BATCH_BYTE_LIMIT",
  "BATCH_FILE_LIMIT",
  "BATCH_NOT_READY",
  "BATCH_ID_MUST_PRECEDE_FILES",
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
  "INVALID_CSV_ENCODING",
  "INVALID_EXECUTION_REQUEST",
  "INVALID_IDEMPOTENCY_KEY",
  "INVALID_IMAGE",
  "INVALID_IMAGE_SIGNATURE",
  "INVALID_IMPORT_FIELDS",
  "INVALID_TABLE_SIGNATURE",
  "INVALID_UPLOAD_FIELD",
  "INVALID_UPLOAD_NAME",
  "JSON_OR_MULTIPART_REQUIRED",
  "SERVER_STOPPING",
  "SYMLINK_UPLOAD_NOT_ALLOWED",
  "UNAUTHORIZED_PRODUCT_IMAGE",
  "UNSAFE_TABLE_REFERENCE",
  "UNSUPPORTED_UPLOAD_TYPE",
  "UPLOAD_TOO_LARGE"
]);

function apiError(error) {
  if (error?.code === "ENOENT" || error?.code === "INVALID_BATCH_ID" || error?.code === "ARTIFACT_NOT_FOUND") {
    return { statusCode: 404, code: "NOT_FOUND" };
  }
  if (error?.code === "EXECUTION_LOCKED") return { statusCode: 409, code: "EXECUTION_LOCKED" };
  if (error?.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
    return { statusCode: error.statusCode, code: error.code ?? "BAD_REQUEST" };
  }
  if (CLIENT_ERROR_CODES.has(error?.code)) return { statusCode: 400, code: error.code };
  return { statusCode: 500, code: "INTERNAL_ERROR" };
}

export async function buildApp({
  root,
  executor = null,
  openBrowser = null,
  allowedHost = "127.0.0.1:4317",
  uploadLimits = null,
  webRoot = path.join(getProjectRoot(), "web")
} = {}) {
  if (typeof root !== "string" || root.length === 0) throw new TypeError("root is required");
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });
  const batchRoot = path.join(path.resolve(root), "batches");
  const staticRoot = path.resolve(webRoot);
  const store = createBatchStore(batchRoot);
  const security = createRequestSecurity({ allowedHost });
  const coordinator = createExecutionCoordinator({ batchRoot, executor, store });

  app.decorate("workbench", { batchRoot, executor, openBrowser, store });
  app.decorate("stopExecutions", coordinator.stop);
  app.addHook("onClose", async () => coordinator.stop());
  app.addHook("onRequest", security.onRequest);
  app.setErrorHandler((error, request, reply) => {
    const result = apiError(error);
    reply.code(result.statusCode).send({ error: result.code });
  });
  await app.register(multipart, {
    limits: { files: 500, fileSize: 20 * 1024 * 1024, fields: 8, parts: 508 }
  });

  app.get("/api/session", async (request, reply) => security.bootstrap(reply));
  await registerBatchRoutes(app, { store });
  await registerImportRoutes(app, { batchRoot, store, uploadLimits });
  await registerExecutionRoutes(app, { coordinator });
  await registerArtifactRoutes(app, { batchRoot, store });
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
