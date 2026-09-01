import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

import { createBatchStore } from "../core/batch-store.js";
import { acquireExecutionLock } from "../core/execution-lock.js";
import { createExecutionSnapshot } from "../core/execution-snapshot.js";
import { runBatch } from "../core/batch-runner.js";
import {
  HIFLY_VERIFICATION_RESULT,
  createEvidenceRecord,
  inspectStructuredVerificationResult
} from "../execution-contracts/hifly-hands-on-product-evidence.js";
import { requireHiflyHandsOnProductV1 } from "../execution-contracts/hifly-hands-on-product-v1.js";
import { createHiflyExecutor } from "../executors/hifly-executor.js";
import { HiflyHandsOnProductPage } from "../hifly-page.js";
import { compilePackageToBatchItem, extractHandoffPackage, loadAvatarMappings, verifyHandoffPackageIntegrity } from "../local-agent/package-compiler.js";
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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

function assertHandsOnProductTask(task) {
  const contract = task?.hifly_hands_on_product_v1;
  const value = requireHiflyHandsOnProductV1(contract);
  const mismatches = [];
  const exact = [
    ["contract_id", task?.contract_id, value.contract_id],
    ["video_plan_version_id", task?.video_plan_version_id, value.plan.video_plan_version_id],
    ["plan_review_id", task?.plan_review_id, value.plan.plan_review_id],
    ["product_revision_id", task?.product_revision_id, value.product.revision_id],
    ["product_asset_version_id", task?.product_asset_version_id, value.product.primary_asset_version_id],
    ["copy_version_id", task?.copy_version_id, value.copy.version_id],
    ["avatar_selection_id", task?.avatar_selection_id, value.avatar.selection_id],
    ["avatar_version_id", task?.avatar_version_id, value.avatar.avatar_version_id],
    ["avatar_material_version_id", task?.avatar_material_version_id, value.avatar.material_version_id],
    ["production_mode", task?.production_mode, value.production.mode],
    ["aspect_ratio", task?.aspect_ratio, value.production.aspect_ratio],
    ["voice_source", task?.voice_source, value.production.voice_source],
    ["presentation_size_code", task?.presentation_size_code, value.production.presentation_size_code],
    ["resolved_script_mode", task?.resolved_script_mode, value.copy.mode]
  ];
  for (const [field, actual, expected] of exact) if (actual !== expected) mismatches.push(field);
  if (task?.avatar?.asset_version_id !== value.avatar.avatar_version_id) mismatches.push("avatar.asset_version_id");
  if (typeof task?.script !== "string" || sha256(task.script) !== value.copy.body_hash) mismatches.push("script");
  if (mismatches.length) {
    const error = new Error("HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_MISMATCH");
    error.code = "HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_MISMATCH";
    error.details = mismatches;
    throw error;
  }
  return value;
}

const CONTRACT_VERIFICATION_FIELDS = Object.freeze(["aspect_ratio", "voice_source"]);
const CONTRACT_VERIFICATION_ERROR_CODES = new Set([
  "CONTRACT_FIELD_NOT_MACHINE_VERIFIABLE",
  "CONTRACT_STRUCTURED_EVIDENCE_REQUIRED",
  "CONTRACT_STRUCTURED_EVIDENCE_INVALID",
  "CONTRACT_STRUCTURED_EVIDENCE_INCOMPLETE",
  "CONTRACT_STRUCTURED_EVIDENCE_NOT_VERIFIED"
]);
const ACTION_REASON_CODES = new Set([
  ...CONTRACT_VERIFICATION_ERROR_CODES,
  "HIFLY_HANDS_ON_PRODUCT_V1_HANDHELD_RATIO_MISMATCH",
  "HIFLY_HANDS_ON_PRODUCT_V1_HANDHELD_RATIO_UNVERIFIABLE"
]);

function unavailableContractEvidence(fields = CONTRACT_VERIFICATION_FIELDS) {
  return fields.map((field) => createEvidenceRecord({
    field,
    expected: field === "aspect_ratio" ? "9:16" : "hifly_native",
    actual: null,
    evidenceSource: "not_captured",
    verificationStage: "pre_paid",
    paidBoundary: "before_paid_action_1",
    result: HIFLY_VERIFICATION_RESULT.NOT_PROVEN
  }));
}

function contractFieldNotMachineVerifiable(fields = CONTRACT_VERIFICATION_FIELDS, code = "CONTRACT_FIELD_NOT_MACHINE_VERIFIABLE", evidence = null) {
  const error = new Error("CONTRACT_FIELD_NOT_MACHINE_VERIFIABLE");
  error.code = code;
  error.details = fields;
  error.evidence = evidence || unavailableContractEvidence(fields);
  error.outcome = "requires_action";
  error.failureStage = "pre_point_gate";
  return error;
}

function prePointGateResult(error) {
  return {
    ready: false,
    status: "requires_action",
    outcome: "requires_action",
    code: error.code,
    failureStage: error.failureStage || "pre_point_gate",
    requiresActionReason: error.code,
    ...(Array.isArray(error.details) ? { fields: error.details } : {}),
    ...(Array.isArray(error.evidence) ? { evidence: error.evidence } : {})
  };
}

async function verifyPrePointContract({ verifier, task, contract, page, hiflyPage }) {
  if (typeof verifier !== "function") throw contractFieldNotMachineVerifiable();
  let result;
  try {
    result = await verifier({ task, contract, page, hiflyPage, fields: CONTRACT_VERIFICATION_FIELDS, phase: "pre_point" });
  } catch (error) {
    if (CONTRACT_VERIFICATION_ERROR_CODES.has(error?.code)) {
      if (error.outcome === "requires_action" && Array.isArray(error.evidence)) throw error;
      const fields = Array.isArray(error.details) ? error.details : error.details?.fields || CONTRACT_VERIFICATION_FIELDS;
      throw contractFieldNotMachineVerifiable(fields, error.code, error.evidence);
    }
    throw contractFieldNotMachineVerifiable();
  }
  const inspected = inspectStructuredVerificationResult(result, CONTRACT_VERIFICATION_FIELDS);
  if (!inspected.valid) {
    throw contractFieldNotMachineVerifiable(inspected.fields || CONTRACT_VERIFICATION_FIELDS, inspected.code, inspected.evidence);
  }
  return inspected;
}

async function taskFromPackageArchive(input, workspace, { attemptId, avatarMappingPath, avatarMappings }) {
  const body = input.packageArchive?.body;
  if (!Buffer.isBuffer(body)) {
    const error = new Error("Cloud Executor package archive is required");
    error.code = "CLOUD_EXECUTOR_PACKAGE_ARCHIVE_REQUIRED";
    throw error;
  }
  const extractionRoot = path.join(workspace.assetsDir, attemptId, "package");
  const verified = await verifyHandoffPackageIntegrity({ body, expectedAttempt: input.attempt, expectedPackage: input.package, expectedOrder: input.order });
  const extracted = await extractHandoffPackage(body, extractionRoot);
  const mappings = avatarMappings || await loadAvatarMappings(avatarMappingPath);
  return compilePackageToBatchItem({
    manifest: verified.manifest || extracted.manifest,
    extractionRoot: extracted.directory,
    avatarMappings: mappings,
    taskId: attemptId
  });
}

export function safeArtifactPath(root, relativePath) {
  const value = clean(relativePath).replaceAll("\\", "/");
  if (!value || value.startsWith("/") || path.posix.isAbsolute(value) || path.win32.isAbsolute(value) || /^[A-Za-z]:\//.test(value) || value.split("/").includes("..")) {
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
    const code = ACTION_REASON_CODES.has(item.requires_action_reason)
      ? item.requires_action_reason
      : "LOGIN_REQUIRED";
    return {
      status: "requires_action",
      code,
      failureStage: clean(item.error_phase) || "preflight",
      requiresActionReason: code === "LOGIN_REQUIRED" ? "Cloud Executor Provider login is required." : code,
      ...(Array.isArray(item.contract_evidence) ? { evidence: item.contract_evidence } : {}),
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
  contractFieldVerifier = null,
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
    if (typeof contractFieldVerifier !== "function") return prePointGateResult(contractFieldNotMachineVerifiable());
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
        assertHandsOnProductTask(args[0]);
        return executor.createAsset(...args);
      },
      async submitVideo(task, asset, executionContext = {}) {
        assertHandsOnProductTask(task);
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
    // Contract verification is deliberately before ensureDelegate(): an
    // invalid/missing contract must not launch a browser or construct a Hifly
    // delegate, let alone reach createAsset/submitVideo.
    let contract;
    try {
      contract = assertHandsOnProductTask(task);
    } catch (error) {
      if (String(error?.code || "").startsWith("HIFLY_HANDS_ON_PRODUCT_V1_")) return prePointGateResult(error);
      throw error;
    }
    if (typeof contractFieldVerifier !== "function") return prePointGateResult(contractFieldNotMachineVerifiable());
    const executor = await ensureDelegate();
    try {
      await verifyPrePointContract({ verifier: contractFieldVerifier, task, contract, page, hiflyPage });
    } catch (error) {
      if (CONTRACT_VERIFICATION_ERROR_CODES.has(error?.code)) {
        await context?.close?.().catch?.(() => undefined);
        context = null;
        page = null;
        hiflyPage = null;
        delegate = null;
        return prePointGateResult(error);
      }
      throw error;
    }
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
