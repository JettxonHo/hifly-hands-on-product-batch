import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { chromium } from "playwright";
import test from "node:test";

import { createCloudExecutorService } from "../src/cloud-executor/cloud-executor-service.js";
import { createCloudExecutorWorker } from "../src/cloud-executor/cloud-executor-worker.js";
import { createCloudExecutorConfig } from "../src/cloud-executor/config.js";
import { createCloudExecutorRuntime } from "../src/cloud-executor/runtime.js";
import { startCloudExecutorRuntime } from "../src/cloud-executor/start.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createMemoryManualExecutionRepository } from "../src/manual-execution/memory-manual-execution-repository.js";
import { HIFLY_VERIFICATION_RESULT, createEvidenceRecord } from "../src/execution-contracts/hifly-hands-on-product-evidence.js";
import { HIFLY_HANDS_ON_PRODUCT_V1_CURRENT_SETTINGS, buildHiflyHandsOnProductV1 } from "../src/execution-contracts/hifly-hands-on-product-v1.js";
import { HiflyHandsOnProductPage } from "../src/hifly-page.js";

const ORGANIZATION_ID = "org-cloud";
const CLOUD_EXECUTOR_ID = "cloud-executor-1";

const clone = (value) => value == null ? value : structuredClone(value);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function attempt({ id, executorType, operatorId = null, executorAgentId = null, executorCloudId = null }) {
  return {
    id, organization_id: ORGANIZATION_ID, production_order_id: `order-${id}`, package_id: `package-${id}`,
    package_version: 1, manifest_hash: `manifest-${id}`, package_hash: null, executor_type: executorType,
    operator_id: operatorId, executor_agent_id: executorAgentId, executor_cloud_id: executorCloudId,
    status: "claimed", row_version: 1, claimed_at: "2026-08-12T00:00:00.000Z", started_at: null,
    completed_at: null, created_at: "2026-08-12T00:00:00.000Z", updated_at: "2026-08-12T00:00:00.000Z",
    status_history: [{ status: "claimed", at: "2026-08-12T00:00:00.000Z" }]
  };
}

test("execution attempt identity keeps manual, local_agent, and cloud_executor disjoint", async () => {
  const repository = createMemoryManualExecutionRepository();
  for (const value of [
    attempt({ id: "manual", executorType: "manual", operatorId: "member-1" }),
    attempt({ id: "local", executorType: "local_agent", executorAgentId: "agent-1" }),
    attempt({ id: "cloud", executorType: "cloud_executor", executorCloudId: CLOUD_EXECUTOR_ID })
  ]) {
    const saved = await repository.claimAttempt({
      receiptKey: `receipt-${value.id}`, fingerprint: value.id, attempt: value,
      transitionOrder: async () => ({ id: value.production_order_id }), audit: null
    });
    assert.equal(saved.attempt.executor_type, value.executor_type);
  }

  await assert.rejects(
    repository.claimAttempt({
      receiptKey: "receipt-invalid", fingerprint: "invalid",
      attempt: attempt({ id: "invalid", executorType: "cloud_executor", executorCloudId: CLOUD_EXECUTOR_ID, executorAgentId: "agent-1" }),
      transitionOrder: async () => ({ id: "order-invalid" }), audit: null
    }),
    { code: "MANUAL_EXECUTION_ATTEMPT_IDENTITY_INVALID" }
  );
});

function makeCloudWorld({ enabled = true, mode = "fake", readiness = { ready: true }, executorResult = { body: Buffer.from("x") }, executor = null,
  orderCount = 1, leaseMs = 30_000, heartbeatIntervalMs = 5_000, nowValue = Date.parse("2026-08-12T00:00:00.000Z"), packageManifest = null,
  videoDeliveryNormalizer = null } = {}) {
  const order = {
    id: "order-cloud-1", organization_id: ORGANIZATION_ID, status: "waiting_for_executor", row_version: 1,
    created_by_member_id: "member-owner", input_snapshot: {}, status_history: []
  };
  const orders = Array.from({ length: orderCount }, (_, index) => ({ ...order, id: `order-cloud-${index + 1}` }));
  const packages = new Map(orders.map((value, index) => [value.id, {
    ...packageRecordFor(value.id, index + 1, packageManifest)
  }]));
  let listCalls = 0;
  let transitionCalls = 0;
  const orderPort = {
    async listOrdersForCloudExecutor() { listCalls += 1; return orders.map(clone); },
    async getOrderForCloudExecutor(input) { return clone(orders.find((value) => value.id === input.orderId)); },
    async transitionOrderForCloudExecutor(input) {
      transitionCalls += 1;
      const selected = orders.find((value) => value.id === input.orderId);
      if (!selected || input.expectedRevision !== selected.row_version || !input.fromStatuses.includes(selected.status)) return null;
      selected.status = input.toStatus;
      selected.row_version += 1;
      return clone(selected);
    }
  };
  const packagePort = {
    async listPackagesForCloudExecutor(input) { return packages.has(input.productionOrderId) ? [clone(packages.get(input.productionOrderId))] : []; },
    async getPackageForCloudExecutor(input) {
      const value = [...packages.values()].find((candidate) => candidate.id === input.packageId);
      return clone(value);
    },
    async downloadPackageForCloudExecutor(input) {
      const value = [...packages.values()].find((candidate) => candidate.id === input.packageId);
      return value ? {
        body: Buffer.from("sensitive-package-marker https://private.example/package"),
        contentType: "application/zip",
        privateUrl: "https://private.example/package"
      } : null;
    }
  };
  const repository = createMemoryManualExecutionRepository();
  const candidateStore = createMemoryObjectStore();
  const verificationCalls = [];
  const readinessPort = { async check() { return readiness; } };
  const verificationPort = {
    async requestVerification(input) { verificationCalls.push(input); return { job: { id: `job-${verificationCalls.length}` }, replayed: false }; },
    async wake() { verificationCalls.push({ wake: true }); }
  };
  const selectedExecutor = executor || { async run() { return executorResult; } };
  const serviceOptions = {
    enabled, mode, organizationId: ORGANIZATION_ID, executorCloudId: CLOUD_EXECUTOR_ID,
    repository, orderPort, packagePort, candidateStore, readinessPort, verificationPort,
    executor: selectedExecutor, leaseMs, heartbeatIntervalMs, now: () => nowValue,
    ...(videoDeliveryNormalizer ? { videoDeliveryNormalizer } : {})
  };
  const service = createCloudExecutorService(serviceOptions);
  return { service, order: orders[0], orders, packages, repository, candidateStore, verificationCalls,
    orderPort, packagePort, runtimeOptions: {
      config: { enabled, configured: enabled && mode === "fake", mode, organizationId: ORGANIZATION_ID,
        executorCloudId: CLOUD_EXECUTOR_ID, worker: { pollIntervalMs: 1, leaseMs, heartbeatIntervalMs } },
      repository, orderPort, packagePort, candidateStore, readinessPort, verificationPort, executor: selectedExecutor,
      now: () => nowValue
    },
    advance(ms) { nowValue += ms; }, get listCalls() { return listCalls; },
    get transitionCalls() { return transitionCalls; } };
}

function packageRecordFor(orderId, index, packageManifest = null) {
  return {
    id: `package-cloud-${index}`, organization_id: ORGANIZATION_ID, production_order_id: orderId,
    package_version: 1, manifest_hash: `manifest-cloud-${index}`, package_hash: `package-cloud-${index}`, status: "ready",
    manifest: { accepted_media_types: ["video/mp4"], ...(packageManifest || {}) }
  };
}

function currentDeliveryContract() {
  return buildHiflyHandsOnProductV1({
    plan: { video_plan_version_id: "plan-cloud-delivery", plan_review_id: "review-cloud-delivery", status: "frozen", review_status: "approved", current: true },
    product: { revision_id: "revision-cloud-delivery", primary_asset_version_id: "asset-cloud-delivery", checksum_sha256: "a".repeat(64), media_type: "image/png", size: 1 },
    copy: { version_id: "copy-cloud-delivery", status: "frozen", review_status: "approved", body: "固定测试文案" },
    avatar: { selection_id: "selection-cloud-delivery", avatar_version_id: "avatar-cloud-delivery", material_version_id: "material-cloud-delivery",
      checksum_sha256: "b".repeat(64), media_type: "image/png", size: 1, status: "confirmed", current: true },
    production: { ...HIFLY_HANDS_ON_PRODUCT_V1_CURRENT_SETTINGS }
  });
}

function throwingHeartbeatRace(error) {
  let releaseHeartbeat;
  let signalHeartbeatStarted;
  let signalHeartbeatFinished;
  const heartbeatRelease = new Promise((resolve) => { releaseHeartbeat = resolve; });
  const heartbeatStarted = new Promise((resolve) => { signalHeartbeatStarted = resolve; });
  const heartbeatFinished = new Promise((resolve) => { signalHeartbeatFinished = resolve; });
  const reportErrors = [];
  return {
    reportErrors,
    executor: {
      async run({ progress }) {
        void progress({ phase: "provider_submitted" });
        await heartbeatStarted;
        setTimeout(releaseHeartbeat, 0);
        throw error;
      }
    },
    install(repository) {
      const heartbeatCloudAttempt = repository.heartbeatCloudAttempt.bind(repository);
      const saveReport = repository.saveReport.bind(repository);
      repository.heartbeatCloudAttempt = async (input) => {
        signalHeartbeatStarted();
        await heartbeatRelease;
        try {
          return await heartbeatCloudAttempt(input);
        } finally {
          signalHeartbeatFinished();
        }
      };
      repository.saveReport = async (input) => {
        await heartbeatFinished;
        try {
          return await saveReport(input);
        } catch (caught) {
          reportErrors.push(caught?.code);
          throw caught;
        }
      };
    }
  };
}

test("disabled cloud executor is fail-closed before readiness or claim", async () => {
  const world = makeCloudWorld({ enabled: false, mode: "fail_closed" });
  const result = await world.service.runOnce();
  assert.equal(result.status, "disabled");
  assert.equal(world.listCalls, 0);
  assert.equal(world.transitionCalls, 0);
});

test("cloud readiness is evaluated before any order claim", async () => {
  const world = makeCloudWorld({ readiness: { ready: false, status: "requires_login", reason: "session-detail=private-value" } });
  const result = await world.service.runOnce();
  assert.equal(result.status, "requires_login");
  assert.equal(result.reason, undefined);
  assert.doesNotMatch(JSON.stringify(result), /private-value|session-detail/i);
  assert.equal(world.listCalls, 0);
  assert.equal(world.transitionCalls, 0);
});

test("runtime no-verifier preflight blocks claim with a stable contract gate", async () => {
  const world = makeCloudWorld({ mode: "playwright", executor: {
    async preflight() {
      return { ready: false, status: "requires_action", code: "CONTRACT_FIELD_NOT_MACHINE_VERIFIABLE", failureStage: "pre_point_gate" };
    },
    async run() { throw new Error("run must not start"); }
  } });
  const runtime = createCloudExecutorRuntime({
    ...world.runtimeOptions,
    readinessPort: null,
    config: { ...world.runtimeOptions.config, mode: "playwright", configured: true }
  });
  const result = await runtime.runOnce();
  assert.equal(result.status, "requires_action");
  assert.equal(result.reason, "CONTRACT_FIELD_NOT_MACHINE_VERIFIABLE");
  assert.equal(world.listCalls, 1);
  assert.equal(world.transitionCalls, 0);
  assert.equal((await world.repository.listAttempts(ORGANIZATION_ID)).length, 0);
  await runtime.close();
});

test("playwright runtime separates environment readiness from current-settings gates", async (t) => {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (error) {
    if (error?.message?.includes("Executable doesn't exist")) return t.skip("Playwright browser is unavailable");
    throw error;
  }

  const root = await mkdtemp(path.join(os.tmpdir(), "cloud-runtime-settings-"));
  const workspace = {
    root,
    profileDir: path.join(root, "profile"),
    assetsDir: path.join(root, "assets"),
    outputsDir: path.join(root, "outputs"),
    evidenceDir: path.join(root, "evidence"),
    batchDir: path.join(root, "batches"),
    lockDir: path.join(root, "locks")
  };
  const productBytes = Buffer.from("product");
  const avatarBytes = Buffer.from("person");
  const contract = buildHiflyHandsOnProductV1({
    plan: { video_plan_version_id: "plan-runtime-settings", plan_review_id: "review-runtime-settings", status: "frozen", review_status: "approved", current: true },
    product: { revision_id: "revision-runtime-settings", primary_asset_version_id: "asset-runtime-settings", checksum_sha256: sha256(productBytes), media_type: "image/png", size: productBytes.length },
    copy: { version_id: "copy-runtime-settings", status: "frozen", review_status: "approved", body: "固定测试文案" },
    avatar: { selection_id: "selection-runtime-settings", avatar_version_id: "avatar-runtime-settings", material_version_id: "material-runtime-settings",
      checksum_sha256: sha256(avatarBytes), media_type: "image/png", size: avatarBytes.length, status: "confirmed", current: true },
    production: { ...HIFLY_HANDS_ON_PRODUCT_V1_CURRENT_SETTINGS }
  });
  const task = {
    task_id: "runtime-current-settings-task",
    sku: "SKU-RUNTIME-CURRENT",
    product_name: "Runtime current settings product",
    selling_points: "Controlled runtime fixture",
    category: "test",
    image_path: path.join(workspace.assetsDir, "product.png"),
    person_image_path: path.join(workspace.assetsDir, "person.png"),
    resolved_person_image_path: path.join(workspace.assetsDir, "person.png"),
    resolved_person_source: "runtime-test-fixture",
    script: "固定测试文案",
    resolved_script_mode: "frozen_copy",
    hifly_hands_on_product_v1: contract,
    contract_id: contract.contract_id,
    video_plan_version_id: contract.plan.video_plan_version_id,
    plan_review_id: contract.plan.plan_review_id,
    product_revision_id: contract.product.revision_id,
    product_asset_version_id: contract.product.primary_asset_version_id,
    copy_version_id: contract.copy.version_id,
    avatar_selection_id: contract.avatar.selection_id,
    avatar_version_id: contract.avatar.avatar_version_id,
    avatar_material_version_id: contract.avatar.material_version_id,
    target_aspect_ratio: contract.production.target_aspect_ratio,
    handheld_aspect_ratio_policy: contract.production.handheld_aspect_ratio_policy,
    voice_source: contract.production.voice_source,
    voice_identity_policy: contract.production.voice_identity_policy,
    production_mode: contract.production.mode,
    presentation_size_code: contract.production.presentation_size_code,
    voice_display_name: contract.production.voice_display_name,
    voice_style: contract.production.voice_style,
    subtitles_enabled: contract.production.subtitles_enabled,
    output_aspect_ratio_policy: contract.production.output_aspect_ratio_policy,
    avatar: { asset_version_id: contract.avatar.avatar_version_id }
  };
  await Promise.all([
    mkdir(workspace.assetsDir, { recursive: true }),
    mkdir(workspace.outputsDir, { recursive: true }),
    mkdir(workspace.evidenceDir, { recursive: true })
  ]);
  await writeFile(path.join(workspace.assetsDir, "product.png"), "product");
  await writeFile(path.join(workspace.assetsDir, "person.png"), "person");

  const markup = ({ authenticated, voiceName, subtitle }) => `
    <div data-auth-ready="${authenticated ? "true" : "false"}"></div>
    <div class="page-goods"><div class="controls-panel">
      <div class="card auto-voice-box"><div class="voice-info"><div class="voice-details">
        <p class="voice-name">${voiceName}</p><p class="voice-style">普通话</p>
      </div></div></div>
      <div class="card"><div class="card-header"><h2>字幕</h2>
        <button type="button" role="switch" aria-checked="${subtitle ? "true" : "false"}"
          onclick="this.setAttribute('aria-checked', this.getAttribute('aria-checked') === 'true' ? 'false' : 'true')"></button>
      </div></div>
    </div></div>`;

  const createRuntime = async ({ authenticated, voiceName = "播客-女声", subtitle = false }) => {
    const world = makeCloudWorld({ mode: "playwright", packageManifest: { hifly_hands_on_product_v1: contract } });
    const events = [];
    const errors = [];
    let paidActions = 0;
    const runtime = createCloudExecutorRuntime({
      ...world.runtimeOptions,
      executor: null,
      readinessPort: null,
      onError: (error) => errors.push(error),
      config: {
        ...world.runtimeOptions.config,
        enabled: true,
        configured: true,
        mode: "playwright",
        workspace,
        storage: { root: workspace.root, minFreeBytes: 0 },
        contextFactory: async () => {
          const context = await browser.newContext({ acceptDownloads: true });
          const page = await context.newPage();
          await page.setContent(markup({ authenticated, voiceName, subtitle }));
          events.push("context_ready");
          return context;
        },
        pageFactory: async ({ context }) => context.pages()[0],
        taskFactory: async () => task,
        hiflyPageFactory(page, config, logger) {
          const hiflyPage = new HiflyHandsOnProductPage(page, config, logger);
          const verifyCurrentSettings = hiflyPage.verifyCurrentSettings.bind(hiflyPage);
          hiflyPage.preflight = async () => {
            events.push("environment_preflight");
            if (await page.locator("[data-auth-ready='true']").count() !== 1) {
              throw Object.assign(new Error("LOGIN_REQUIRED"), { code: "LOGIN_REQUIRED", outcome: "requires_action" });
            }
            return { status: "ready" };
          };
          hiflyPage.prepareCurrentSettings = async (currentTask) => {
            events.push("prepare_current_settings");
            return HiflyHandsOnProductPage.prototype.prepareCurrentSettings.call(hiflyPage, currentTask);
          };
          hiflyPage.verifyCurrentSettings = async (currentTask) => {
            events.push("verify_current_settings");
            return verifyCurrentSettings(currentTask);
          };
          hiflyPage.prepareAsset = async (_task, { contractFieldVerifier }) => {
            events.push("create_asset");
            await contractFieldVerifier();
            paidActions += 1;
            return { asset_id: "runtime-current-settings-asset" };
          };
          hiflyPage.submitVideo = async () => {
            events.push("submit_video");
            return {
              status: "submitted",
              remoteEvidence: {
                evidence_source: "causal_submission_receipt",
                receipt_id: "runtime-current-settings-receipt",
                remote_id: "runtime-current-settings-work"
              }
            };
          };
          hiflyPage.querySubmission = async (remoteEvidence) => ({ status: "ready", remoteEvidence });
          hiflyPage.downloadArtifact = async (_remoteEvidence, destination) => {
            await writeFile(path.join(destination, "runtime-current-settings.mp4"), "video");
            return { artifact_id: "runtime-current-settings-work", relative_path: "outputs/runtime-current-settings.mp4" };
          };
          hiflyPage.reconcileSubmission = async () => ({ candidates: [] });
          return hiflyPage;
        },
        executorFactory: ({ hiflyPage }) => ({
          async preflight() { return hiflyPage.preflight(); },
          async createAsset(currentTask, context) { return hiflyPage.prepareAsset(currentTask, context); },
          async submitVideo(currentTask, asset, context) { return hiflyPage.submitVideo(currentTask, { asset, checkpoint: context?.checkpoint }); },
          async querySubmission(remoteEvidence) { return hiflyPage.querySubmission(remoteEvidence); },
          async downloadArtifact(remoteEvidence, destination, context) { return hiflyPage.downloadArtifact(remoteEvidence, destination, context); },
          async reconcileSubmission(currentTask, checkpoint) { return hiflyPage.reconcileSubmission(currentTask, checkpoint); }
        })
      }
    });
    return { runtime, world, events, errors, get paidActions() { return paidActions; } };
  };

  try {
    const login = await createRuntime({ authenticated: false });
    const loginResult = await login.runtime.runOnce();
    assert.equal(loginResult.status, "requires_login");
    assert.equal(login.world.listCalls, 1);
    assert.equal(login.world.transitionCalls, 0);
    assert.equal(login.paidActions, 0);
    assert.deepEqual(login.events, ["context_ready", "environment_preflight"]);
    await login.runtime.close();

    const wrong = await createRuntime({ authenticated: true, voiceName: "错误声音" });
    const wrongResult = await wrong.runtime.runOnce();
    assert.equal(wrongResult.status, "requires_action");
    assert.equal(wrong.world.listCalls, 1);
    assert.ok(wrong.world.transitionCalls > 0);
    assert.equal(wrong.paidActions, 0);
    assert.deepEqual(wrong.events, [
      "context_ready", "environment_preflight", "environment_preflight",
      "prepare_current_settings", "verify_current_settings"
    ]);
    await wrong.runtime.close();
  } finally {
    await browser.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});

test("playwright runtime keeps an empty queue and a legacy package browser-zero", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cloud-runtime-preclaim-"));
  const workspace = { root, profileDir: path.join(root, "profile") };
  let browserLaunches = 0;
  const runtimeFor = (world) => createCloudExecutorRuntime({
    ...world.runtimeOptions,
    executor: null,
    readinessPort: null,
    config: {
      ...world.runtimeOptions.config,
      enabled: true,
      configured: true,
      mode: "playwright",
      workspace,
      storage: { root, minFreeBytes: 0 },
      browserType: {
        async launchPersistentContext() {
          browserLaunches += 1;
          throw new Error("browser must stay closed for this preclaim gate");
        }
      }
    }
  });

  try {
    const emptyWorld = makeCloudWorld({ mode: "playwright", orderCount: 0 });
    const emptyRuntime = runtimeFor(emptyWorld);
    const empty = await emptyRuntime.runOnce();
    assert.equal(empty.status, "standby");
    assert.equal(emptyWorld.listCalls, 1);
    assert.equal(emptyWorld.transitionCalls, 0);
    await emptyRuntime.close();

    const historical = structuredClone(currentDeliveryContract());
    for (const field of Object.keys(HIFLY_HANDS_ON_PRODUCT_V1_CURRENT_SETTINGS)) delete historical.production[field];
    const legacyWorld = makeCloudWorld({ mode: "playwright", packageManifest: { hifly_hands_on_product_v1: historical } });
    const legacyRuntime = runtimeFor(legacyWorld);
    const legacy = await legacyRuntime.runOnce();
    assert.equal(legacy.status, "requires_action");
    assert.equal(legacy.reason, "CONTRACT_FIELD_NOT_MACHINE_VERIFIABLE");
    assert.equal(legacyWorld.listCalls, 1);
    assert.equal(legacyWorld.transitionCalls, 0);
    assert.equal((await legacyWorld.repository.listAttempts(ORGANIZATION_ID)).length, 0);
    await legacyRuntime.close();
    assert.equal(browserLaunches, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("low persistent storage blocks before listing, claiming, or creating an attempt", async () => {
  const world = makeCloudWorld({ readiness: { ready: false, status: "storage_blocked", reason: "absolute path must stay private" } });
  const result = await world.service.runOnce();
  assert.equal(result.status, "storage_blocked");
  assert.equal(result.reason, undefined);
  assert.equal(world.listCalls, 0);
  assert.equal(world.transitionCalls, 0);
  assert.equal((await world.repository.listAttempts(ORGANIZATION_ID)).length, 0);
});

test("missing or expired Provider session maps to requires_login before claim", async () => {
  for (const sessionState of ["missing", "expired"]) {
    const world = makeCloudWorld({ mode: "playwright", executor: {
      async preflight() {
        throw Object.assign(new Error("login details must stay private"), {
          code: "LOGIN_REQUIRED",
          sessionState
        });
      },
      async run() {
        throw new Error("login readiness must stop before execution");
      }
    } });
    const runtime = createCloudExecutorRuntime({
      ...world.runtimeOptions,
      readinessPort: null,
      config: { ...world.runtimeOptions.config, configured: true }
    });

    const result = await runtime.runOnce();
    assert.equal(result.status, "requires_login");
    assert.equal(result.ready, false);
    assert.equal(world.listCalls, 1, sessionState);
    assert.equal(world.transitionCalls, 0, sessionState);
    assert.doesNotMatch(JSON.stringify(result), /login details|sessionState|cookie|token|profile/i);
    await runtime.close();
  }
});

test("standalone Cloud Executor runtime owns fake service and worker without starting on construction", async () => {
  const world = makeCloudWorld();
  const runtime = createCloudExecutorRuntime(world.runtimeOptions);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(world.listCalls, 0);
  assert.equal(runtime.executorType, "cloud_executor");
  assert.equal(typeof runtime.service.runOnce, "function");
  assert.equal(typeof runtime.worker.runNext, "function");

  const result = await runtime.runOnce();
  assert.equal(result.status, "succeeded");
  assert.equal(world.listCalls, 1);
  await runtime.close();
});

test("standalone runtime entrypoint requires explicit config and stays fail-closed when disabled", async () => {
  assert.throws(() => createCloudExecutorRuntime(), { code: "CLOUD_EXECUTOR_RUNTIME_CONFIG_REQUIRED" });
  const { runtime, startup } = await startCloudExecutorRuntime({ config: { enabled: false, mode: "fail_closed" } });
  assert.equal(startup.status, "disabled");
  assert.equal(runtime.status, "disabled");
  assert.equal(runtime.service, null);
  assert.equal(runtime.worker, null);
  await runtime.close();
});

test("fake success claims one order, reports a cloud identity, and triggers A12 once", async () => {
  const world = makeCloudWorld({ orderCount: 2 });
  const result = await world.service.runOnce();
  assert.equal(result.status, "succeeded");
  assert.equal(result.attempt.executor_type, "cloud_executor");
  assert.equal(result.attempt.executor_cloud_id, CLOUD_EXECUTOR_ID);
  assert.equal(result.attempt.executor_agent_id, null);
  assert.equal(result.report.submitted_by, null);
  assert.equal(result.report.submitted_by_agent_id, null);
  assert.equal(result.report.submitted_by_cloud_executor_id, CLOUD_EXECUTOR_ID);
  assert.equal(world.order.status, "running");
  assert.equal(world.orders[1].status, "waiting_for_executor");
  assert.equal(world.verificationCalls.filter((value) => value.productionOrderId).length, 1);
  assert.equal(world.verificationCalls.filter((value) => value.wake).length, 1);

  const candidates = await world.repository.listCandidates(ORGANIZATION_ID, result.attempt.id);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].uploaded_by_cloud_executor_id, CLOUD_EXECUTOR_ID);
  assert.equal(candidates[0].uploaded_by_agent_id, null);
  assert.equal(candidates[0].status, "pending_verification");
});

test("completed Cloud report preserves bounded Stage 1 asset evidence", async () => {
  const evidence = createEvidenceRecord({ field: "handheld_aspect_ratio", expected: "9:16", actual: "1600x2848",
    evidenceSource: "generated_artifact_natural_dimensions", verificationStage: "post_handheld_pre_video",
    paidBoundary: "after_paid_action_1_before_paid_action_2", result: HIFLY_VERIFICATION_RESULT.FAIL_EXACT_MATCH });
  const world = makeCloudWorld({ executorResult: { body: Buffer.from("video"), evidence: [evidence] } });
  const result = await world.service.runOnce();
  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.report.supporting_outputs, [{ kind: "production_evidence", evidence: [evidence] }]);
});

test("current V1 delivery policy keeps the downloaded source as supporting output", async () => {
  const original = Buffer.from("provider-output");
  const delivery = Buffer.from("strict-padded-delivery");
  let normalizeCalls = 0;
  let preflightCalls = 0;
  const normalizer = {
    async preflight() { preflightCalls += 1; },
    async normalize(input) {
      normalizeCalls += 1;
      assert.deepEqual(input.original.bytes, original);
      const attempt = (await world.repository.listAttempts(ORGANIZATION_ID, world.order.id))[0];
      const archived = await world.repository.listCandidates(ORGANIZATION_ID, attempt.id);
      assert.equal(archived.length, 1);
      assert.equal(archived[0].role, "supporting_output");
      assert.deepEqual(await world.candidateStore.get(archived[0].object_key), original);
      return {
        original: { bytes: Buffer.from("must-not-replace-downloaded-bytes"), media_type: "video/mp4", original_filename: "other.mp4" },
        delivery: { bytes: delivery, media_type: "video/mp4", original_filename: "provider.mp4", size: delivery.length },
        evidence: []
      };
    }
  };
  const world = makeCloudWorld({
    executorResult: { body: original, mediaType: "video/mp4", originalFilename: "provider.mp4" },
    packageManifest: { hifly_hands_on_product_v1: currentDeliveryContract() },
    videoDeliveryNormalizer: normalizer
  });

  const result = await world.service.runOnce();
  const candidates = await world.repository.listCandidates(ORGANIZATION_ID, result.attempt.id);
  const reports = await world.repository.listReports(ORGANIZATION_ID, result.attempt.id);

  assert.equal(normalizeCalls, 1);
  assert.equal(preflightCalls, 1);
  assert.equal(result.status, "succeeded");
  assert.equal(candidates.length, 2);
  const primary = candidates.find((candidate) => candidate.role === "primary_video");
  const supporting = candidates.find((candidate) => candidate.role === "supporting_output");
  assert.equal(primary.size, delivery.length);
  assert.equal(supporting.size, original.length);
  assert.equal(supporting.original_filename, "provider.mp4");
  assert.deepEqual(await world.candidateStore.get(supporting.object_key), original);
  assert.equal(reports[0].primary_output.upload_reference, primary.id);
  assert.equal(reports[0].supporting_outputs[0].upload_reference, supporting.id);
  assert.equal(reports[0].supporting_outputs[0].role, "supporting_output");
  assert.equal(reports[0].supporting_outputs[0].purpose, "hifly_original");
});

test("current V1 delivery policy preflights media tools before executor.run", async () => {
  let executorCalls = 0;
  const world = makeCloudWorld({
    packageManifest: { hifly_hands_on_product_v1: currentDeliveryContract() },
    executor: { async run() { executorCalls += 1; return { body: Buffer.from("should-not-run") }; } },
    videoDeliveryNormalizer: {
      async preflight() { throw Object.assign(new Error("ffmpeg unavailable"), { code: "CLOUD_EXECUTOR_VIDEO_DELIVERY_PREFLIGHT_FAILED" }); },
      async normalize() { throw new Error("should not normalize"); }
    }
  });

  const result = await world.service.runOnce();
  assert.equal(executorCalls, 0);
  assert.equal(result.status, "failed");
  assert.equal(result.report.failure_stage, "video_delivery_preflight");
  assert.equal((await world.repository.listCandidates(ORGANIZATION_ID, result.attempt.id)).length, 0);
});

test("post-executor delivery failure stops the Cloud attempt without a second executor call", async () => {
  let executorCalls = 0;
  const world = makeCloudWorld({
    packageManifest: { hifly_hands_on_product_v1: currentDeliveryContract() },
    executor: { async run() { executorCalls += 1; return { body: Buffer.from("provider-output") }; } },
    videoDeliveryNormalizer: {
      async preflight() {},
      async normalize() { throw Object.assign(new Error("decode failed"), { code: "CLOUD_EXECUTOR_VIDEO_DELIVERY_TRANSCODE_FAILED" }); }
    }
  });

  const result = await world.service.runOnce();
  const replay = await world.service.runOnce();
  assert.equal(executorCalls, 1);
  assert.equal(result.status, "failed");
  assert.equal(result.report.failure_stage, "post_download_delivery");
  assert.equal(replay.status, "halted");
  const candidates = await world.repository.listCandidates(ORGANIZATION_ID, result.attempt.id);
  assert.equal(candidates.length, 1);
  const original = candidates[0];
  assert.equal(original.role, "supporting_output");
  assert.equal(original.execution_attempt_id, result.attempt.id);
  assert.equal(original.production_order_id, world.order.id);
  assert.deepEqual(await world.candidateStore.get(original.object_key), Buffer.from("provider-output"));
  const reports = await world.repository.listReports(ORGANIZATION_ID, result.attempt.id);
  assert.equal(reports[0].primary_output, null);
  assert.equal(reports[0].retryability, "not_retryable");
  assert.equal(reports[0].supporting_outputs[0].upload_reference, original.id);
  assert.equal(reports[0].supporting_outputs[0].purpose, "hifly_original");
  assert.equal(world.verificationCalls.length, 0);
});

test("original storage failure stops delivery processing and never reports success", async () => {
  let normalizeCalls = 0;
  const world = makeCloudWorld({
    packageManifest: { hifly_hands_on_product_v1: currentDeliveryContract() },
    executorResult: { body: Buffer.from("provider-output") },
    videoDeliveryNormalizer: {
      async preflight() {},
      async normalize() { normalizeCalls += 1; throw new Error("must not normalize"); }
    }
  });
  world.candidateStore.put = async () => { throw new Error("storage unavailable"); };

  const result = await world.service.runOnce();
  assert.equal(result.status, "failed");
  assert.equal(normalizeCalls, 0);
  assert.equal(world.verificationCalls.length, 0);
  const candidates = await world.repository.listCandidates(ORGANIZATION_ID, result.attempt.id);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].role, "supporting_output");
  assert.equal(candidates[0].status, "upload_pending");
  const reports = await world.repository.listReports(ORGANIZATION_ID, result.attempt.id);
  assert.equal(reports[0].primary_output, null);
  assert.deepEqual(reports[0].supporting_outputs, []);
  assert.equal((await world.service.runOnce()).status, "halted");
});

test("an uncertain executor result is not archived as this attempt's original", async () => {
  let normalizeCalls = 0;
  const world = makeCloudWorld({
    packageManifest: { hifly_hands_on_product_v1: currentDeliveryContract() },
    executorResult: { status: "requires_action", body: Buffer.from("unassociated-candidate") },
    videoDeliveryNormalizer: {
      async preflight() {},
      async normalize() { normalizeCalls += 1; throw new Error("must not normalize"); }
    }
  });
  const result = await world.service.runOnce();
  assert.equal(result.status, "requires_action");
  assert.equal(normalizeCalls, 0);
  assert.equal((await world.repository.listCandidates(ORGANIZATION_ID, result.attempt.id)).length, 0);
  assert.equal(world.verificationCalls.length, 0);
});

test("historical V1 contracts retain the original Cloud output path", async () => {
  const historical = structuredClone(currentDeliveryContract());
  for (const field of Object.keys(HIFLY_HANDS_ON_PRODUCT_V1_CURRENT_SETTINGS)) delete historical.production[field];
  let preflightCalls = 0;
  let normalizeCalls = 0;
  const world = makeCloudWorld({
    packageManifest: { hifly_hands_on_product_v1: historical },
    videoDeliveryNormalizer: {
      async preflight() { preflightCalls += 1; },
      async normalize() { normalizeCalls += 1; throw new Error("historical output must not normalize"); }
    }
  });

  const result = await world.service.runOnce();
  assert.equal(result.status, "succeeded");
  assert.equal(preflightCalls, 0);
  assert.equal(normalizeCalls, 0);
  assert.equal((await world.repository.listCandidates(ORGANIZATION_ID, result.attempt.id)).length, 1);
});

test("fake failure stops the worker and never claims the next order", async () => {
  const world = makeCloudWorld({ orderCount: 2, executorResult: { ok: false, failureStage: "fake_execution" } });
  const first = await world.service.runOnce();
  assert.equal(first.status, "failed");
  assert.equal(first.stopped, true);
  assert.equal(world.order.status, "failed");
  assert.equal(world.orders[1].status, "waiting_for_executor");
  const callsAfterFailure = world.listCalls;
  const second = await world.service.runOnce();
  assert.equal(second.status, "halted");
  assert.equal(world.listCalls, callsAfterFailure);

  const workerWorld = makeCloudWorld({ orderCount: 2, executorResult: { ok: false, failureStage: "fake_execution" } });
  const worker = createCloudExecutorWorker({ service: workerWorld.service, pollIntervalMs: 1 });
  worker.start();
  await new Promise((resolve) => setTimeout(resolve, 10));
  worker.stop();
  assert.equal(worker.halted, true);
  assert.equal(workerWorld.orders[1].status, "waiting_for_executor");
});

test("uncertain post-submit outcome requires action, stops the worker, and never retries Provider submission", async () => {
  let providerCalls = 0;
  const evidence = createEvidenceRecord({ field: "handheld_aspect_ratio", expected: "9:16", actual: "1600x2848",
    evidenceSource: "generated_artifact_natural_dimensions", verificationStage: "post_handheld_pre_video",
    paidBoundary: "after_paid_action_1_before_paid_action_2", result: HIFLY_VERIFICATION_RESULT.FAIL_EXACT_MATCH });
  const world = makeCloudWorld({ orderCount: 2, executor: {
    async run() {
      providerCalls += 1;
      return {
        status: "requires_action",
        failureStage: "unknown_post_submit",
        requiresActionReason: "Provider submission outcome is ambiguous",
        evidence: [evidence]
      };
    }
  } });

  const first = await world.service.runOnce();
  const second = await world.service.runOnce();

  assert.equal(first.status, "requires_action");
  assert.equal(first.stopped, true);
  assert.equal(second.status, "halted");
  assert.equal(providerCalls, 1);
  assert.equal(world.order.status, "requires_action");
  assert.equal(world.orders[1].status, "waiting_for_executor");
  assert.equal(first.report.outcome, "requires_action");
  assert.equal(first.report.retryability, "not_retryable");
  assert.equal(first.report.failure_stage, "unknown_post_submit");
  assert.deepEqual(first.report.supporting_outputs, [{ kind: "production_evidence", evidence: [evidence] }]);
});

test("playwright mode downloads the claimed package archive for the executor without projecting its contents", async () => {
  let received;
  const world = makeCloudWorld({ mode: "playwright", executor: {
    async run(input) {
      received = input;
      return { body: Buffer.from("video") };
    }
  } });

  const result = await world.service.runOnce();

  assert.equal(received.packageArchive.body.toString(), "sensitive-package-marker https://private.example/package");
  assert.equal(received.packageArchive.contentType, "application/zip");
  assert.equal(received.packageArchive.privateUrl, undefined);
  assert.equal(/sensitive-package-marker|private\.example/i.test(JSON.stringify(result)), false);
  assert.equal(result.status, "succeeded");
});

test("an unexpected fake executor error is terminal and records a failed report", async () => {
  const world = makeCloudWorld({ orderCount: 2, executor: { async run() { throw new Error("fake failure"); } } });
  const result = await world.service.runOnce();
  assert.equal(result.status, "failed");
  assert.equal(result.stopped, true);
  assert.equal(result.report.failure_stage, "fake_execution");
  assert.equal(world.order.status, "failed");
  assert.equal(world.orders[1].status, "waiting_for_executor");
});

test("queued heartbeat is drained before an executor exception records one failed report", async () => {
  const race = throwingHeartbeatRace(new Error("fake failure"));
  const world = makeCloudWorld({ executor: race.executor });
  race.install(world.repository);

  const result = await world.service.runOnce();

  assert.deepEqual(race.reportErrors, []);
  assert.equal(result.status, "failed");
  const attempts = await world.repository.listAttempts(ORGANIZATION_ID, world.order.id);
  const reports = await world.repository.listReports(ORGANIZATION_ID, attempts[0].id);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, "failed");
  assert.equal(reports.length, 1);
  assert.equal(reports[0].outcome, "failed");
  assert.equal(world.verificationCalls.length, 0);
});

test("queued heartbeat is drained before a post-submit exception requires action once", async () => {
  const race = throwingHeartbeatRace(Object.assign(new Error("unknown post-submit result"), {
    code: "CLOUD_EXECUTOR_POST_SUBMIT_UNKNOWN"
  }));
  const world = makeCloudWorld({ executor: race.executor });
  race.install(world.repository);

  const result = await world.service.runOnce();

  assert.deepEqual(race.reportErrors, []);
  assert.equal(result.status, "requires_action");
  const attempts = await world.repository.listAttempts(ORGANIZATION_ID, world.order.id);
  const reports = await world.repository.listReports(ORGANIZATION_ID, attempts[0].id);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, "requires_action");
  assert.equal(reports.length, 1);
  assert.equal(reports[0].outcome, "requires_action");
  assert.equal(reports[0].failure_stage, "unknown_post_submit");
  assert.equal(world.verificationCalls.length, 0);
});

test("heartbeat gate failure after an executor exception writes no terminal report", async () => {
  const world = makeCloudWorld({ executor: {
    async run({ progress }) {
      await assert.rejects(progress({ phase: "provider_submitted" }));
      throw new Error("executor failure after heartbeat failure");
    }
  } });
  world.repository.heartbeatCloudAttempt = async () => {
    throw Object.assign(new Error("heartbeat conflict"), { code: "MANUAL_EXECUTION_ATTEMPT_CONFLICT" });
  };

  await assert.rejects(world.service.runOnce(), { code: "CLOUD_EXECUTOR_LEASE_LOST" });

  const attempts = await world.repository.listAttempts(ORGANIZATION_ID, world.order.id);
  const reports = await world.repository.listReports(ORGANIZATION_ID, attempts[0].id);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, "running");
  assert.equal(reports.length, 0);
  assert.equal(world.verificationCalls.length, 0);
});

test("terminal heartbeat gate read failure loses the lease and writes no report", async () => {
  const world = makeCloudWorld({ executor: { async run() { throw new Error("fake failure"); } } });
  const getAttempt = world.repository.getAttempt.bind(world.repository);
  const saveReport = world.repository.saveReport.bind(world.repository);
  let getAttemptCalls = 0;
  let saveReportCalls = 0;
  world.repository.getAttempt = async (...args) => {
    getAttemptCalls += 1;
    if (getAttemptCalls === 1) {
      throw Object.assign(new Error("attempt read unavailable"), { code: "ATTEMPT_READ_FAILED" });
    }
    return getAttempt(...args);
  };
  world.repository.saveReport = async (input) => {
    saveReportCalls += 1;
    return saveReport(input);
  };

  await assert.rejects(world.service.runOnce(), { code: "CLOUD_EXECUTOR_LEASE_LOST" });

  const attempts = await world.repository.listAttempts(ORGANIZATION_ID, world.order.id);
  const reports = await world.repository.listReports(ORGANIZATION_ID, attempts[0].id);
  assert.equal(saveReportCalls, 0);
  assert.equal(attempts[0].status, "running");
  assert.equal(reports.length, 0);
});

test("terminal heartbeat gate ownership mismatch loses the lease and writes no report", async () => {
  const world = makeCloudWorld({ executor: { async run() { throw new Error("fake failure"); } } });
  const getAttempt = world.repository.getAttempt.bind(world.repository);
  const saveReport = world.repository.saveReport.bind(world.repository);
  let getAttemptCalls = 0;
  let saveReportCalls = 0;
  world.repository.getAttempt = async (...args) => {
    getAttemptCalls += 1;
    const current = await getAttempt(...args);
    if (getAttemptCalls === 1) return { ...current, executor_cloud_id: "different-cloud-executor" };
    return current;
  };
  world.repository.saveReport = async (input) => {
    saveReportCalls += 1;
    return saveReport(input);
  };

  await assert.rejects(world.service.runOnce(), { code: "CLOUD_EXECUTOR_LEASE_LOST" });

  const attempts = await world.repository.listAttempts(ORGANIZATION_ID, world.order.id);
  const reports = await world.repository.listReports(ORGANIZATION_ID, attempts[0].id);
  assert.equal(saveReportCalls, 0);
  assert.equal(attempts[0].status, "running");
  assert.equal(reports.length, 0);
});

test("fake execution heartbeats the single leased attempt before reporting", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const world = makeCloudWorld({ heartbeatIntervalMs: 5, executor: {
    async run() {
      await gate;
      return { body: Buffer.from("heartbeat-output") };
    }
  } });
  const running = world.service.runOnce();
  await new Promise((resolve) => setTimeout(resolve, 20));
  release();
  const result = await running;
  assert.equal(result.status, "succeeded");
  const saved = await world.repository.getAttempt(ORGANIZATION_ID, result.attempt.id);
  assert.ok(saved.row_version >= 4);
  assert.equal(saved.status, "succeeded");
});

test("candidate upload completion survives a heartbeat before the terminal report", async () => {
  const world = makeCloudWorld();
  const reportErrors = [];
  const markCandidateUploaded = world.repository.markCandidateUploaded.bind(world.repository);
  const saveReport = world.repository.saveReport.bind(world.repository);
  world.repository.markCandidateUploaded = async (input) => {
    const uploaded = await markCandidateUploaded(input);
    const current = await world.repository.getAttempt(ORGANIZATION_ID, uploaded.candidate.execution_attempt_id);
    await world.repository.heartbeatCloudAttempt({
      receiptKey: `race-heartbeat-${current.id}-${current.row_version}`,
      fingerprint: `race-heartbeat-${current.id}-${current.row_version}`,
      attemptId: current.id,
      organizationId: ORGANIZATION_ID,
      executorCloudId: CLOUD_EXECUTOR_ID,
      expectedRevision: current.row_version,
      now: "2026-08-12T00:00:01.000Z",
      leaseExpiresAt: "2026-08-12T00:00:31.000Z",
      progressPhase: "upload_completed",
      audit: null
    });
    return uploaded;
  };
  world.repository.saveReport = async (input) => {
    try {
      return await saveReport(input);
    } catch (error) {
      reportErrors.push(error?.code);
      throw error;
    }
  };

  const result = await world.service.runOnce();

  assert.deepEqual(reportErrors, []);
  assert.equal(result.status, "succeeded");
  const attempts = await world.repository.listAttempts(ORGANIZATION_ID, world.order.id);
  const reports = await world.repository.listReports(ORGANIZATION_ID, result.attempt.id);
  const candidates = await world.repository.listCandidates(ORGANIZATION_ID, result.attempt.id);
  assert.equal(attempts.length, 1);
  assert.equal(attempts[0].status, "succeeded");
  assert.equal(reports.length, 1);
  assert.equal(reports[0].outcome, "completed");
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].execution_attempt_id, attempts[0].id);
  assert.equal(candidates[0].status, "pending_verification");
  const terminalTransitions = (await world.repository.listStatusTransitions(ORGANIZATION_ID))
    .filter((value) => value.attempt_id === attempts[0].id && value.to_status === "succeeded");
  assert.equal(terminalTransitions.length, 1);
  assert.equal(world.verificationCalls.filter((value) => value.productionOrderId).length, 1);
});

test("concurrent worker polls have one in-flight claim", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const world = makeCloudWorld({ orderCount: 2 });
  const originalRun = world.service.runOnce;
  world.service.runOnce = async () => {
    await gate;
    return originalRun();
  };
  const worker = createCloudExecutorWorker({ service: world.service, pollIntervalMs: 1 });
  const first = worker.runNext();
  const second = worker.runNext();
  release();
  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(secondResult, null);
  assert.equal(firstResult.status, "succeeded");
  assert.equal(world.orders.filter((value) => value.status !== "waiting_for_executor").length, 1);
});

test("cloud lease expiry becomes requires_action and never auto-creates another attempt", async () => {
  const world = makeCloudWorld({ orderCount: 2, leaseMs: 100 });
  const at = "2026-08-12T00:00:00.000Z";
  const attempt = {
    id: "cloud-expiring-attempt", organization_id: ORGANIZATION_ID, production_order_id: world.order.id,
    package_id: "package-cloud-1", package_version: 1, manifest_hash: "manifest-cloud-1", package_hash: "package-cloud-1",
    executor_type: "cloud_executor", operator_id: null, executor_agent_id: null, executor_cloud_id: CLOUD_EXECUTOR_ID,
    status: "claimed", row_version: 1, claimed_at: at, started_at: null, completed_at: null,
    lease_expires_at: "2026-08-12T00:00:00.100Z", heartbeat_at: at, progress_phase: "claimed",
    created_at: at, updated_at: at, status_history: [{ status: "claimed", at, actor_cloud_executor_id: CLOUD_EXECUTOR_ID }]
  };
  const claimed = await world.repository.claimAttempt({ receiptKey: "seed-claim", fingerprint: "seed-claim", attempt,
    transitionOrder: () => world.orderPort.transitionOrderForCloudExecutor({ organizationId: ORGANIZATION_ID, orderId: world.order.id,
      expectedRevision: 1, fromStatuses: ["waiting_for_executor"], toStatus: "claimed", at, actorCloudExecutorId: CLOUD_EXECUTOR_ID }), audit: null });
  const started = await world.repository.startAttempt({ receiptKey: "seed-start", fingerprint: "seed-start", attemptId: claimed.attempt.id,
    organizationId: ORGANIZATION_ID, expectedRevision: 1, patch: { status: "running", started_at: at, updated_at: at,
      lease_expires_at: "2026-08-12T00:00:00.100Z", heartbeat_at: at, progress_phase: "started",
      status_history: [...attempt.status_history, { status: "running", at, actor_cloud_executor_id: CLOUD_EXECUTOR_ID }] },
    transitionOrder: () => world.orderPort.transitionOrderForCloudExecutor({ organizationId: ORGANIZATION_ID, orderId: world.order.id,
      expectedRevision: 2, fromStatuses: ["claimed"], toStatus: "running", at, actorCloudExecutorId: CLOUD_EXECUTOR_ID }), audit: null });
  assert.equal(started.attempt.status, "running");
  world.advance(101);

  const expired = await world.service.runOnce();
  assert.equal(expired.status, "requires_action");
  assert.equal((await world.repository.getAttempt(ORGANIZATION_ID, attempt.id)).status, "requires_action");
  assert.equal(world.order.status, "requires_action");
  assert.equal(world.orders[1].status, "waiting_for_executor");
  assert.equal((await world.repository.listAttempts(ORGANIZATION_ID)).length, 1);
  assert.equal((await world.service.runOnce()).status, "halted");
});

test("standalone cloud executor config is disabled and fail-closed by default", () => {
  const env = {
    DATABASE_URL: "postgresql://pilot:secret@postgres:5432/hifly_pilot",
    PUBLIC_HOST: "pilot.example.test",
    PUBLIC_ORIGIN: "https://pilot.example.test",
    INITIAL_ADMIN_ENABLED: "false"
  };
  const config = createCloudExecutorConfig({ root: "/tmp/hifly-cloud-executor-test", env });
  assert.equal(config.enabled, false);
  assert.equal(config.configured, false);
  assert.equal(config.mode, "fail_closed");
  assert.equal(config.executorType, "cloud_executor");
  assert.equal(config.worker.autoStart, undefined);

  const unconfigured = createCloudExecutorConfig({ root: "/tmp/hifly-cloud-executor-test", env: {
    ...env, CLOUD_EXECUTOR_ENABLED: "true", CLOUD_EXECUTOR_MODE: "fake"
  } });
  assert.equal(unconfigured.enabled, true);
  assert.equal(unconfigured.configured, false);
  assert.equal(unconfigured.worker.autoStart, undefined);

  const configured = createCloudExecutorConfig({ root: "/tmp/hifly-cloud-executor-test", env: {
    ...env, CLOUD_EXECUTOR_ENABLED: "true", CLOUD_EXECUTOR_MODE: "fake", CLOUD_EXECUTOR_ID: CLOUD_EXECUTOR_ID,
    CLOUD_EXECUTOR_ORGANIZATION_ID: ORGANIZATION_ID
  } });
  assert.equal(configured.configured, true);
  assert.equal(configured.worker.autoStart, undefined);

  const playwright = createCloudExecutorConfig({ root: "/tmp/hifly-cloud-executor-test", env: {
    ...env, CLOUD_EXECUTOR_ENABLED: "true", CLOUD_EXECUTOR_MODE: "playwright", CLOUD_EXECUTOR_ID: CLOUD_EXECUTOR_ID,
    CLOUD_EXECUTOR_ORGANIZATION_ID: ORGANIZATION_ID, CLOUD_EXECUTOR_WORKSPACE_ROOT: "/var/lib/hifly-cloud",
    CLOUD_EXECUTOR_PROFILE_DIR: "/var/lib/hifly-profile", CLOUD_EXECUTOR_AVATAR_MAPPING_FILE: "/etc/hifly/avatar-mappings.json"
  } });
  assert.equal(playwright.configured, true);
  const workspaceRoot = path.resolve("/var/lib/hifly-cloud");
  const profileDir = path.resolve("/var/lib/hifly-profile");
  assert.equal(playwright.avatarMappingPath, path.resolve("/etc/hifly/avatar-mappings.json"));
  assert.deepEqual(playwright.workspace, {
    root: workspaceRoot,
    profileDir,
    assetsDir: path.join(workspaceRoot, "assets"),
    outputsDir: path.join(workspaceRoot, "outputs"),
    evidenceDir: path.join(workspaceRoot, "evidence")
  });
});

test("cloud executor migration adds a separate identity without relaxing existing identities", async () => {
  const migration = await readFile(new URL("../src/manual-execution/migrations/004_cloud_executor_identity.sql", import.meta.url), "utf8");
  assert.match(migration, /executor_type IN \('manual', 'local_agent', 'cloud_executor'\)/);
  assert.match(migration, /executor_cloud_id/);
  assert.match(migration, /executor_type = 'cloud_executor'/);
  assert.match(migration, /num_nonnulls\(uploaded_by_member_id, uploaded_by_agent_id, uploaded_by_cloud_executor_id\) = 1/);
  assert.match(migration, /num_nonnulls\(submitted_by, submitted_by_agent_id, submitted_by_cloud_executor_id\) = 1/);
});
