import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

import { createBatchStore } from "../core/batch-store.js";
import { acquireExecutionLock } from "../core/execution-lock.js";
import { createExecutionSnapshot } from "../core/execution-snapshot.js";
import { runBatch } from "../core/batch-runner.js";
import { createHiflyExecutor } from "../executors/hifly-executor.js";
import { HiflyHandsOnProductPage } from "../hifly-page.js";
import { compilePackageToBatchItem, extractHandoffPackage, loadAvatarMappings } from "../local-agent/package-compiler.js";
import { createCloudWorkspaceConfig, ensureCloudExecutorWorkspace } from "./workspace.js";

export const CLOUD_PLAYWRIGHT_PROGRESS = Object.freeze({
  PRE_SUBMIT: "pre_submit",
  SUBMITTED: "submitted",
  WAIT_DOWNLOAD: "wait_download",
  UNKNOWN_POST_SUBMIT: "unknown_post_submit"
});

const CHECKPOINT_PROGRESS = Object.freeze({
  remote_submit_pre: CLOUD_PLAYWRIGHT_PROGRESS.PRE_SUBMIT,
  remote_submit_clicked: CLOUD_PLAYWRIGHT_PROGRESS.SUBMITTED,
  remote_submit_wait: CLOUD_PLAYWRIGHT_PROGRESS.WAIT_DOWNLOAD
});

const EXECUTOR_METHODS = Object.freeze([
  "createAsset",
  "submitVideo",
  "querySubmission",
  "downloadArtifact",
  "reconcileSubmission"
]);

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hiflyConfigFor(workspace, config = {}) {
  return {
    ...config,
    __rootDir: workspace.root,
    browser: { ...(config.browser || {}), profileDir: workspace.profileDir },
    downloadDir: workspace.outputsDir,
    screenshotDir: workspace.evidenceDir,
    logDir: workspace.evidenceDir,
    batch: {
      defaultTimeoutMs: config.batch?.defaultTimeoutMs ?? 30_000,
      generationTimeoutMs: config.batch?.generationTimeoutMs ?? 30 * 60 * 1_000,
      ...(config.batch || {})
    }
  };
}

function browserOptions(config, options = {}) {
  const result = {
    acceptDownloads: true,
    ...(config.browser?.headless === undefined && options.headless === undefined ? { headless: true } : {}),
    ...(config.browser?.headless !== undefined ? { headless: config.browser.headless } : {}),
    ...(options.headless !== undefined ? { headless: options.headless } : {}),
    ...(config.browser?.slowMoMs !== undefined ? { slowMo: config.browser.slowMoMs } : {}),
    ...(options.slowMoMs !== undefined ? { slowMo: options.slowMoMs } : {}),
    ...(config.browser?.viewport ? { viewport: config.browser.viewport } : {}),
    ...(options.viewport ? { viewport: options.viewport } : {}),
    ...(Array.isArray(config.browser?.args) ? { args: config.browser.args } : {}),
    ...(Array.isArray(options.args) ? { args: options.args } : {}),
    ...(options.browserOptions || {})
  };
  result.acceptDownloads = true;
  return result;
}

function mapCheckpoint(phase) {
  return CHECKPOINT_PROGRESS[phase] || null;
}

function assertExecutor(executor) {
  if (!executor || typeof executor !== "object") throw new TypeError("cloud Playwright executor is required");
  for (const method of EXECUTOR_METHODS) {
    if (typeof executor[method] !== "function") throw new TypeError(`cloud Playwright executor requires ${method}`);
  }
  return executor;
}

function cloudTask(selected, input, workspace) {
  return {
    ...selected,
    task_id: clean(selected.task_id) || clean(input.attempt?.id) || clean(input.order?.id) || "cloud-task",
    __cloud_workspace_root: workspace.root
  };
}

async function taskFromPackageArchive(input, workspace, { attemptId, avatarMappingPath, avatarMappings }) {
  const body = input.packageArchive?.body;
  if (!Buffer.isBuffer(body)) {
    const error = new Error("Cloud Executor package archive is required");
    error.code = "CLOUD_EXECUTOR_PACKAGE_ARCHIVE_REQUIRED";
    throw error;
  }
  const extractionRoot = path.join(workspace.assetsDir, attemptId, "package");
  const extracted = await extractHandoffPackage(body, extractionRoot);
  const mappings = avatarMappings || await loadAvatarMappings(avatarMappingPath);
  return compilePackageToBatchItem({
    manifest: extracted.manifest,
    extractionRoot: extracted.directory,
    avatarMappings: mappings,
    taskId: attemptId
  });
}

function safeArtifactPath(root, relativePath) {
  const value = clean(relativePath).replaceAll("\\", "/");
  if (!value || value.startsWith("/") || path.posix.isAbsolute(value) || value.split("/").includes("..")) {
    const error = new Error("Cloud Executor artifact path is invalid");
    error.code = "CLOUD_EXECUTOR_ARTIFACT_PATH_INVALID";
    throw error;
  }
  const resolved = path.resolve(root, ...value.split("/"));
  const relative = path.relative(root, resolved);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    const error = new Error("Cloud Executor artifact path is invalid");
    error.code = "CLOUD_EXECUTOR_ARTIFACT_PATH_INVALID";
    throw error;
  }
  return resolved;
}

function actionResult(item, progressTrace) {
  if (item?.status === "interrupted_unknown" || ["submitted", "download_pending"].includes(item?.status)) {
    return {
      status: "requires_action",
      code: "CLOUD_EXECUTOR_POST_SUBMIT_UNKNOWN",
      failureStage: "unknown_post_submit",
      requiresActionReason: "Provider submission outcome is unknown or ambiguous; reconcile before any retry.",
      remoteCandidates: item.remote_candidates || [],
      checkpoints: progressTrace
    };
  }
  if (item?.paused_auth === true) {
    return {
      status: "requires_action",
      code: "LOGIN_REQUIRED",
      failureStage: "preflight",
      requiresActionReason: "Cloud Executor Provider login is required.",
      checkpoints: progressTrace
    };
  }
  return {
    status: "failed",
    ok: false,
    failureStage: clean(item?.error_phase) || "playwright_execution",
    errorCode: clean(item?.error_message) || "CLOUD_EXECUTOR_PLAYWRIGHT_FAILED",
    checkpoints: progressTrace
  };
}

export function createCloudPlaywrightAdapter({
  workspace,
  hiflyConfig = {},
  browserType = chromium,
  browserOptions: explicitBrowserOptions = {},
  contextFactory = null,
  pageFactory = null,
  hiflyPageFactory = (page, config, logger) => new HiflyHandsOnProductPage(page, config, logger),
  executorFactory = createHiflyExecutor,
  taskFactory = null,
  avatarMappingPath = null,
  avatarMappings = null,
  batchStoreFactory = createBatchStore,
  lockFactory = acquireExecutionLock,
  snapshotFactory = createExecutionSnapshot,
  runBatchImpl = runBatch,
  readArtifact = readFile,
  logger = { info() {} },
  onProgress = null,
  now = Date.now
} = {}) {
  const cloudWorkspace = createCloudWorkspaceConfig(workspace);
  const config = hiflyConfigFor(cloudWorkspace, hiflyConfig);
  if (typeof executorFactory !== "function") throw new TypeError("executorFactory is required");
  if (typeof hiflyPageFactory !== "function") throw new TypeError("hiflyPageFactory is required");
  if (typeof runBatchImpl !== "function") throw new TypeError("runBatchImpl is required");

  let context = null;
  let page = null;
  let hiflyPage = null;
  let delegate = null;
  let closed = false;
  let halted = false;

  async function ensureWorkspace() {
    await ensureCloudExecutorWorkspace(cloudWorkspace);
  }

  async function ensureDelegate() {
    if (delegate) return delegate;
    if (closed) throw new Error("Cloud Executor Playwright adapter is closed");
    await ensureWorkspace();
    const options = browserOptions(config, explicitBrowserOptions);
    context = contextFactory
      ? await contextFactory({ profileDir: cloudWorkspace.profileDir, options, workspace: cloudWorkspace, config })
      : await browserType.launchPersistentContext(cloudWorkspace.profileDir, options);
    page = pageFactory
      ? await pageFactory({ context, workspace: cloudWorkspace, config })
      : context.pages?.()[0] || await context.newPage();
    page?.setDefaultTimeout?.(config.batch.defaultTimeoutMs);
    hiflyPage = hiflyPageFactory(page, config, logger);
    delegate = assertExecutor(executorFactory({ hiflyPage, page, config, workspace: cloudWorkspace, logger }));
    return delegate;
  }

  async function preflight() {
    return (await ensureDelegate()).preflight();
  }

  async function login({ waitForInput = async () => undefined } = {}) {
    await ensureDelegate();
    if (typeof hiflyPage?.openWorkbench !== "function") {
      const error = new Error("Cloud Executor login surface is unavailable");
      error.code = "CLOUD_EXECUTOR_LOGIN_SURFACE_UNAVAILABLE";
      throw error;
    }
    await hiflyPage.openWorkbench();
    await waitForInput();
    const result = await delegate.preflight();
    return { status: result?.status || "ready" };
  }

  async function run(input = {}) {
    if (halted) {
      return {
        status: "requires_action",
        code: "CLOUD_EXECUTOR_POST_SUBMIT_UNKNOWN",
        failureStage: "unknown_post_submit",
        requiresActionReason: "The Cloud Executor is halted pending Provider reconciliation."
      };
    }
    const progress = typeof input.progress === "function" ? input.progress : onProgress;
    const progressTrace = [];
    let lastProgress = null;
    async function reportProgress(phase, evidence = null) {
      if (!Object.values(CLOUD_PLAYWRIGHT_PROGRESS).includes(phase) || phase === CLOUD_PLAYWRIGHT_PROGRESS.UNKNOWN_POST_SUBMIT && lastProgress === phase) return;
      if (phase !== CLOUD_PLAYWRIGHT_PROGRESS.UNKNOWN_POST_SUBMIT && lastProgress === phase) return;
      lastProgress = phase;
      const checkpoint = { phase, evidence };
      progressTrace.push(checkpoint);
      await progress?.(checkpoint);
    }

    const wrappedExecutor = {
      async createAsset(...args) {
        return executor.createAsset(...args);
      },
      async submitVideo(task, asset, executionContext = {}) {
        await reportProgress(CLOUD_PLAYWRIGHT_PROGRESS.PRE_SUBMIT);
        const checkpoint = executionContext.checkpoint;
        const wrappedContext = {
          ...executionContext,
          checkpoint: async ({ phase, evidence }) => {
            const mapped = mapCheckpoint(phase);
            if (mapped) await reportProgress(mapped, evidence);
            return checkpoint?.({ phase, evidence });
          }
        };
        const result = await executor.submitVideo(task, asset, wrappedContext);
        if (result?.status === "submitted") await reportProgress(CLOUD_PLAYWRIGHT_PROGRESS.SUBMITTED, result.remoteEvidence || null);
        return result;
      },
      async querySubmission(...args) {
        await reportProgress(CLOUD_PLAYWRIGHT_PROGRESS.WAIT_DOWNLOAD);
        return executor.querySubmission(...args);
      },
      async downloadArtifact(...args) {
        await reportProgress(CLOUD_PLAYWRIGHT_PROGRESS.WAIT_DOWNLOAD);
        return executor.downloadArtifact(...args);
      },
      async reconcileSubmission(...args) {
        return executor.reconcileSubmission(...args);
      }
    };

    const attemptId = clean(input.attempt?.id) || randomUUID();
    let task;
    try {
      const selected = await (typeof taskFactory === "function"
        ? taskFactory({ ...input, workspace: cloudWorkspace })
        : taskFromPackageArchive(input, cloudWorkspace, { attemptId, avatarMappingPath, avatarMappings }));
      task = cloudTask(selected, input, cloudWorkspace);
    } catch (error) {
      if (error?.outcome === "requires_action") {
        return {
          status: "requires_action",
          failureStage: "package_materialization",
          requiresActionReason: error.code || "CLOUD_EXECUTOR_PACKAGE_REQUIRES_ACTION",
          checkpoints: progressTrace
        };
      }
      throw error;
    }
    const executor = await ensureDelegate();
    const confirmedAt = new Date(now()).toISOString();
    const execution = {
      version: "cloud-executor-playwright",
      assetPointsPerItem: 0,
      videoPointsEstimate: 0,
      projectRoot: cloudWorkspace.root,
      confirmedAt
    };
    const snapshot = await snapshotFactory([task], execution);
    const confirmedTask = {
      ...task,
      status: "confirmed",
      confirmed_at: confirmedAt,
      execution_key: snapshot.executionKey
    };
    const batchId = `cloud-${attemptId}`;
    const store = batchStoreFactory(cloudWorkspace.batchDir);
    await store.initialize?.();
    await store.create({
      batch_id: batchId,
      items: [confirmedTask],
      estimated_points: snapshot.estimate,
      execution_snapshot: snapshot
    });
    const lock = await lockFactory({
      root: cloudWorkspace.lockDir,
      batchId,
      instanceId: `cloud-playwright-${process.pid}-${randomUUID()}`
    });
    try {
      const result = await runBatchImpl({
        batchId,
        items: [confirmedTask],
        config: { execution },
        paths: { projectRoot: cloudWorkspace.root, downloadDir: cloudWorkspace.outputsDir },
        executor: wrappedExecutor,
        store,
        lock
      });
      const item = result.items?.[0];
      if (item?.status === "completed") {
        const outputPath = safeArtifactPath(cloudWorkspace.root, item.output_path);
        const body = await readArtifact(outputPath);
        if (!Buffer.isBuffer(body) || body.length === 0) {
          const error = new Error("Cloud Executor downloaded artifact is empty");
          error.code = "CLOUD_EXECUTOR_ARTIFACT_INVALID";
          throw error;
        }
        return { status: "succeeded", body, outputPath, checkpoints: progressTrace };
      }
      const action = actionResult(item, progressTrace);
      if (action.status === "requires_action") {
        halted = true;
        await reportProgress(CLOUD_PLAYWRIGHT_PROGRESS.UNKNOWN_POST_SUBMIT, {
          candidates: action.remoteCandidates
        });
        return action;
      }
      return action;
    } finally {
      await lock.release();
    }
  }

  async function close() {
    if (closed) return;
    closed = true;
    await context?.close?.();
    context = null;
    page = null;
    delegate = null;
  }

  return {
    kind: "cloud_playwright",
    workspace: cloudWorkspace,
    config,
    preflight,
    login,
    run,
    close,
    get halted() { return halted; },
    get browserContext() { return context; },
    get page() { return page; }
  };
}

export const createCloudPlaywrightExecutor = createCloudPlaywrightAdapter;

export { createCloudWorkspaceConfig };
