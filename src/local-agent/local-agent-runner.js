import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createBatchStore } from "../core/batch-store.js";
import { acquireExecutionLock } from "../core/execution-lock.js";
import { createExecutionSnapshot } from "../core/execution-snapshot.js";
import { runBatch } from "../core/batch-runner.js";
import { createLocalAgentFakeExecutor } from "./fake-executor.js";
import { createLocalAgentHttpClientFromEnv } from "./agent-http-client.js";
import { compilePackageToBatchItem, extractHandoffPackage, loadAvatarMappings } from "./package-compiler.js";
import { EXIT_CODES, isRequiresActionError, localAgentError } from "./errors.js";

export { EXIT_CODES };

export const LOCAL_AGENT_PROGRESS_PHASES = Object.freeze([
  "started",
  "downloading_package",
  "compiling",
  "executing",
  "authorizing_candidate",
  "uploading_candidate",
  "reporting"
]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isRealExecutionEnabled({ argv = [], env = process.env } = {}) {
  return argv.includes("--real") && env.LOCAL_AGENT_REAL_EXECUTION === "true";
}

export function selectLocalAgentExecutor({ argv = [], env = process.env, fakeExecutor = createLocalAgentFakeExecutor(), realExecutor } = {}) {
  if (isRealExecutionEnabled({ argv, env })) {
    if (!realExecutor) throw localAgentError("LOCAL_EXECUTION_FAILED");
    return realExecutor;
  }
  return fakeExecutor;
}

function log(logger, method, event, fields = {}) {
  try {
    logger?.[method]?.(event, fields);
  } catch {
    // Logging must never change execution state.
  }
}

function safeOutputPath(root, relativePath) {
  const value = clean(relativePath).replaceAll("\\", "/");
  if (!value || value.startsWith("/") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || value.split("/").includes("..")) {
    throw localAgentError("LOCAL_EXECUTION_FAILED");
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...value.split("/"));
  const relative = path.relative(resolvedRoot, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw localAgentError("LOCAL_EXECUTION_FAILED");
  return resolved;
}

function candidateFilename(task) {
  const value = clean(task.product_name).replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/g, "");
  return `${value || "local-agent"}.mp4`;
}

function checksum(body) {
  return createHash("sha256").update(body).digest("hex");
}

function createLeaseHeartbeatController({ client, attemptId, runId, getProgressPhase, intervalMs, setIntervalImpl, clearIntervalImpl, heartbeatScheduler, onError }) {
  if (heartbeatScheduler !== null && typeof heartbeatScheduler !== "function") throw new TypeError("heartbeatScheduler must be a function");
  if (heartbeatScheduler === null && (!Number.isFinite(intervalMs) || intervalMs <= 0)) throw new TypeError("heartbeatIntervalMs must be positive");
  let stopped = false;
  let sequence = 0;
  let inFlight = null;
  let lastError = null;

  const heartbeat = async () => {
    if (stopped) return null;
    if (inFlight) return inFlight;
    const idempotencyKey = `${runId}:heartbeat:${sequence++}`;
    inFlight = Promise.resolve(client.heartbeatTask({
      attemptId,
      progressPhase: getProgressPhase(),
      idempotencyKey
    })).then((value) => {
      lastError = null;
      return value;
    }).catch((error) => {
      lastError = error;
      onError?.(error);
      return null;
    }).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  const scheduled = heartbeatScheduler
    ? heartbeatScheduler({ heartbeat, getProgressPhase, intervalMs })
    : setIntervalImpl(() => heartbeat(), intervalMs);
  scheduled?.unref?.();

  return {
    heartbeat,
    async assertLease() {
      await heartbeat();
      if (lastError) throw localAgentError("LOCAL_EXECUTION_FAILED");
    },
    async stop() {
      if (stopped) return;
      stopped = true;
      if (heartbeatScheduler) {
        if (typeof scheduled === "function") await scheduled();
        else await scheduled?.stop?.();
      } else {
        clearIntervalImpl(scheduled);
      }
      await inFlight?.catch(() => undefined);
    }
  };
}

async function executeBatch({ task, executor, temporaryRoot, attemptId, runId }) {
  const batchId = `local-agent-${attemptId}-${runId}`;
  const batchRoot = path.join(temporaryRoot, "batches");
  const downloadDir = path.join(temporaryRoot, "downloads");
  await mkdir(downloadDir, { recursive: true });
  const confirmedAt = new Date().toISOString();
  const sourceTask = { ...task, status: "confirmed", confirmed_at: confirmedAt };
  const execution = {
    projectRoot: temporaryRoot,
    version: "local-agent-p0-fake",
    assetPointsPerItem: 0,
    videoPointsEstimate: 0,
    confirmedAt
  };
  const snapshot = await createExecutionSnapshot([sourceTask], execution);
  const items = [{ ...sourceTask, execution_key: snapshot.executionKey }];
  const store = createBatchStore(batchRoot);
  const lock = await acquireExecutionLock({ root: path.join(temporaryRoot, "locks"), batchId, instanceId: `local-agent-${process.pid}-${runId}` });
  try {
    const result = await runBatch({
      batchId,
      items,
      config: { execution },
      paths: { projectRoot: temporaryRoot, downloadDir },
      executor,
      store,
      lock
    });
    const item = result.items?.[0];
    if (result.status !== "completed" || item?.status !== "completed") {
      if (item?.paused_auth === true && item?.error_message === "LOGIN_REQUIRED") {
        throw localAgentError("LOGIN_REQUIRED", { outcome: "requires_action" });
      }
      throw localAgentError("LOCAL_EXECUTION_FAILED");
    }
    const outputPath = safeOutputPath(temporaryRoot, item.output_path);
    return { body: await readFile(outputPath) };
  } finally {
    await lock.release().catch(() => undefined);
  }
}

function requireClient(client) {
  const methods = ["heartbeat", "claim", "start", "heartbeatTask", "downloadPackage", "authorizeCandidate", "uploadCandidate", "completeCandidate", "report"];
  if (!client || methods.some((method) => typeof client[method] !== "function")) throw new TypeError("local agent client is required");
}

export async function runLocalAgentOnce({
  client,
  avatarMappings = null,
  avatarMappingPath = null,
  configPath = null,
  executor = null,
  fakeExecutor = null,
  realExecutor = null,
  argv = [],
  env = process.env,
  tempDirectoryFactory = async () => mkdtemp(path.join(os.tmpdir(), "local-agent-run-")),
  heartbeatIntervalMs = 5_000,
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
  heartbeatScheduler = null,
  logger = null
} = {}) {
  requireClient(client);
  const runId = randomUUID();
  let temporaryRoot;
  let attemptId = null;
  let reportSubmitted = false;
  let heartbeatController = null;
  let progressPhase = "started";
  let selectedExecutor = null;
  const reportIds = new Map();

  const reportIdFor = (outcome) => {
    if (!reportIds.has(outcome)) reportIds.set(outcome, randomUUID());
    return reportIds.get(outcome);
  };

  async function sendReport({ outcome, errorCode = null, primaryCandidateId = null, failureStage = null }) {
    if (!attemptId || reportSubmitted) return null;
    await heartbeatController?.assertLease?.();
    progressPhase = "reporting";
    const value = await client.report({
      attemptId,
      reportId: reportIdFor(outcome),
      outcome,
      primaryCandidateId,
      errorCode,
      failureStage,
      idempotencyKey: `${runId}:report:${outcome}`
    });
    reportSubmitted = true;
    return value;
  }

  try {
    selectedExecutor = selectLocalAgentExecutor({
      argv,
      env,
      fakeExecutor: executor || fakeExecutor || createLocalAgentFakeExecutor(),
      realExecutor
    });
    if (isRealExecutionEnabled({ argv, env })) {
      if (typeof selectedExecutor.preflight !== "function") throw localAgentError("LOCAL_EXECUTION_FAILED");
      await selectedExecutor.preflight();
    }
    temporaryRoot = await tempDirectoryFactory();
    await client.heartbeat({ idempotencyKey: `${runId}:heartbeat` });
    const claimed = await client.claim({ idempotencyKey: `${runId}:claim` });
    if (!claimed?.attempt?.id) {
      log(logger, "info", "local_agent_idle");
      return { status: "idle", exitCode: EXIT_CODES.success };
    }
    attemptId = claimed.attempt.id;
    await client.start({ attemptId, idempotencyKey: `${runId}:start` });
    heartbeatController = createLeaseHeartbeatController({
      client,
      attemptId,
      runId,
      getProgressPhase: () => progressPhase,
      intervalMs: heartbeatIntervalMs,
      setIntervalImpl,
      clearIntervalImpl,
      heartbeatScheduler,
      onError: () => log(logger, "error", "local_agent_heartbeat_failed", { attemptId, code: "LOCAL_AGENT_HEARTBEAT_FAILED" })
    });
    progressPhase = "downloading_package";
    const downloaded = await client.downloadPackage({ attemptId });
    if (!Buffer.isBuffer(downloaded?.body)) throw localAgentError("LOCAL_EXECUTION_FAILED");

    const extractionRoot = path.join(temporaryRoot, "package");
    progressPhase = "compiling";
    const extracted = await extractHandoffPackage(downloaded.body, extractionRoot);
    const mappings = avatarMappings || await loadAvatarMappings(avatarMappingPath || configPath || env.LOCAL_AGENT_AVATAR_MAPPING_FILE);
    let task;
    try {
      task = await compilePackageToBatchItem({
        manifest: extracted.manifest,
        extractionRoot: extracted.directory,
        avatarMappings: mappings,
        taskId: extracted.manifest.production_order_id || extracted.manifest.package_id
      });
    } catch (error) {
      if (!isRequiresActionError(error)) throw error;
      const report = await sendReport({ outcome: "requires_action", errorCode: error.code, failureStage: "compile" });
      log(logger, "info", "local_agent_requires_action", { attemptId, code: error.code });
      return { status: "requires_action", exitCode: EXIT_CODES.requiresAction, attemptId, report };
    }

    progressPhase = "executing";
    const output = await executeBatch({ task, executor: selectedExecutor, temporaryRoot, attemptId, runId });
    await heartbeatController.assertLease();
    const outputChecksum = checksum(output.body);
    const filename = candidateFilename(task);
    progressPhase = "authorizing_candidate";
    const authorized = await client.authorizeCandidate({
      attemptId,
      role: "primary_video",
      originalFilename: filename,
      mediaType: "video/mp4",
      size: output.body.length,
      checksum: outputChecksum,
      idempotencyKey: `${runId}:authorize`
    });
    const candidateId = authorized?.candidate?.id;
    if (!candidateId) throw localAgentError("LOCAL_EXECUTION_FAILED");
    progressPhase = "uploading_candidate";
    await client.uploadCandidate({ attemptId, candidateId, body: output.body, mediaType: "video/mp4", idempotencyKey: `${runId}:upload` });
    await client.completeCandidate({ attemptId, candidateId, idempotencyKey: `${runId}:complete` });
    const report = await sendReport({ outcome: "completed", primaryCandidateId: candidateId });
    log(logger, "info", "local_agent_completed", { attemptId });
    return { status: "completed", exitCode: EXIT_CODES.success, attemptId, report };
  } catch (error) {
    const code = isRequiresActionError(error) ? error.code : "LOCAL_EXECUTION_FAILED";
    const outcome = isRequiresActionError(error) ? "requires_action" : "failed";
    let report = null;
    if (attemptId && !reportSubmitted) {
      try {
        report = await sendReport({ outcome, errorCode: code, failureStage: "execute" });
      } catch {
        report = null;
      }
    }
    log(logger, "error", outcome === "requires_action" ? "local_agent_requires_action" : "local_agent_failed", { attemptId, code });
    return { status: outcome, exitCode: outcome === "requires_action" ? EXIT_CODES.requiresAction : EXIT_CODES.failed, attemptId, report };
  } finally {
    await heartbeatController?.stop?.();
    if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function createDefaultRealExecutor({ root, env }) {
  const [{ createExecutorForBackend }, { loadConfig }] = await Promise.all([
    import("../server/start.js"),
    import("../config.js")
  ]);
  const configPath = env.LOCAL_AGENT_HIFLY_CONFIG_PATH || path.join(root, "config.local.json");
  const config = loadConfig(configPath);
  return createExecutorForBackend(root, config);
}

export async function main({
  argv = process.argv.slice(2),
  env = process.env,
  root = process.cwd(),
  logger = console,
  clientFactory = null,
  realExecutorFactory = null,
  heartbeatIntervalMs = Number(env.LOCAL_AGENT_HEARTBEAT_INTERVAL_MS || 5_000)
} = {}) {
  const command = argv.find((value) => !value.startsWith("-")) || "run-once";
  if (command !== "run-once") {
    log(logger, "error", "LOCAL_EXECUTION_FAILED");
    return { status: "failed", exitCode: EXIT_CODES.failed };
  }
  const client = clientFactory
    ? await clientFactory({ env })
    : createLocalAgentHttpClientFromEnv({ env, logger });
  const realEnabled = isRealExecutionEnabled({ argv, env });
  const fakeEnabled = env.LOCAL_AGENT_FAKE_EXECUTION === "true";
  if (!realEnabled && !fakeEnabled) {
    await client.heartbeat({ idempotencyKey: `standby:${randomUUID()}` });
    log(logger, "info", "local_agent_standby");
    return { status: "standby", exitCode: EXIT_CODES.success };
  }
  let realExecutor = null;
  if (realEnabled) {
    try {
      realExecutor = await (realExecutorFactory || createDefaultRealExecutor)({ root, env, argv });
    } catch {
      log(logger, "error", "local_agent_failed", { code: "LOCAL_EXECUTION_FAILED" });
      return { status: "failed", exitCode: EXIT_CODES.failed };
    }
  }
  try {
    return await runLocalAgentOnce({ client, argv, env, realExecutor, heartbeatIntervalMs, logger });
  } finally {
    try {
      await realExecutor?.close?.();
    } catch {
      // A close failure must not replace the run result.
    }
  }
}

export { isRealExecutionEnabled };
