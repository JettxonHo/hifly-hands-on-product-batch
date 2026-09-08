import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import test from "node:test";

import { createCloudPlaywrightAdapter } from "../src/cloud-executor/playwright-adapter.js";
import { createExecutionSnapshot } from "../src/core/execution-snapshot.js";
import { createManualHandoffPackageService } from "../src/manual-handoff/manual-handoff-package-service.js";
import { createManualHandoffPackageWorker } from "../src/manual-handoff/manual-handoff-package-worker.js";
import { createMemoryManualHandoffRepository } from "../src/manual-handoff/memory-manual-handoff-repository.js";
import { createMemoryManualHandoffPackageStore } from "../src/manual-handoff/manual-handoff-package-store.js";
import { buildManualHandoffZip, extractManualHandoffArchive } from "../src/manual-handoff/manual-handoff-package-store.js";
import { sha256 } from "../src/manual-handoff/manual-handoff-package.js";
import { buildHiflyHandsOnProductV1, HIFLY_HANDS_ON_PRODUCT_V1_CURRENT_SETTINGS } from "../src/execution-contracts/hifly-hands-on-product-v1.js";
import { hiflyPrePaidRequirementsFor } from "../src/execution-contracts/hifly-hands-on-product-evidence.js";
import { HIFLY_VERIFICATION_RESULT, createEvidenceRecord } from "../src/execution-contracts/hifly-hands-on-product-evidence.js";
import { HiflyHandsOnProductPage } from "../src/hifly-page.js";

async function workspaceFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cloud-playwright-adapter-"));
  const workspace = {
    root,
    profileDir: path.join(root, "profile"),
    assetsDir: path.join(root, "assets"),
    outputsDir: path.join(root, "outputs"),
    evidenceDir: path.join(root, "evidence")
  };
  await Promise.all([
    mkdir(workspace.profileDir, { recursive: true }),
    mkdir(workspace.assetsDir, { recursive: true }),
    mkdir(workspace.outputsDir, { recursive: true }),
    mkdir(workspace.evidenceDir, { recursive: true })
  ]);
  await writeFile(path.join(workspace.assetsDir, "product.png"), "product");
  await writeFile(path.join(workspace.assetsDir, "person.png"), "person");
  return { workspace, cleanup: () => rm(root, { recursive: true, force: true }) };
}

function contractFixture({ planId, planReviewId, revisionId, productAssetVersionId, productBody, copyVersionId, copyBody = "固定测试文案", selectionId, avatarVersionId, materialVersionId, avatarBody, presentationSizeCode = "smart_fit", currentSettings = false } = {}) {
  const product = productBody || Buffer.from("product");
  const avatar = avatarBody || Buffer.from("person");
  return buildHiflyHandsOnProductV1({
    plan: { video_plan_version_id: planId, plan_review_id: planReviewId, status: "frozen", review_status: "approved", current: true },
    product: { revision_id: revisionId, primary_asset_version_id: productAssetVersionId, checksum_sha256: sha256(product), media_type: "image/png", size: product.length },
    copy: { version_id: copyVersionId, status: "frozen", review_status: "approved", body: copyBody },
    avatar: { selection_id: selectionId, avatar_version_id: avatarVersionId, material_version_id: materialVersionId, checksum_sha256: sha256(avatar), media_type: "image/png", size: avatar.length, status: "confirmed", current: true },
    ...(presentationSizeCode !== "smart_fit" || currentSettings ? {
      production: {
        ...(presentationSizeCode !== "smart_fit" ? { presentation_size_code: presentationSizeCode } : {}),
        ...(currentSettings ? HIFLY_HANDS_ON_PRODUCT_V1_CURRENT_SETTINGS : {})
      }
    } : {})
  });
}

function fakeContext(page, calls) {
  return {
    pages() { return [page]; },
    async newPage() { calls.push("new-page"); return page; },
    async close() { calls.push("context-close"); }
  };
}

function taskFor(workspace, { currentSettings = false } = {}) {
  const productBody = Buffer.from("product");
  const avatarBody = Buffer.from("person");
  const contract = contractFixture({ planId: "plan-cloud-task", planReviewId: "review-cloud-task", revisionId: "revision-cloud-task", productAssetVersionId: "asset-cloud-task", productBody, copyVersionId: "copy-cloud-task", selectionId: "selection-cloud-task", avatarVersionId: "avatar-cloud-task", materialVersionId: "material-cloud-task", avatarBody, currentSettings });
  return {
    task_id: "cloud-task-1",
    sku: "SKU-CLOUD-1",
    product_name: "Cloud product",
    selling_points: "A useful product",
    category: "test",
    image_path: path.join(workspace.assetsDir, "product.png"),
    person_image_path: path.join(workspace.assetsDir, "person.png"),
    resolved_person_image_path: path.join(workspace.assetsDir, "person.png"),
    resolved_person_source: "cloud-test-fixture",
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
    avatar: { asset_version_id: contract.avatar.avatar_version_id },
    ...(currentSettings ? {
      voice_display_name: contract.production.voice_display_name,
      voice_style: contract.production.voice_style,
      subtitles_enabled: contract.production.subtitles_enabled,
      output_aspect_ratio_policy: contract.production.output_aspect_ratio_policy
    } : {})
  };
}

function packageFor() {
  return {
    id: "package-cloud-1",
    package_version: 1,
    manifest_hash: "manifest-cloud-1",
    package_hash: "package-cloud-1",
    status: "ready"
  };
}

function orderFor() {
  return { id: "order-cloud-1", created_by_member_id: "member-owner" };
}

function verifiedContractFields(fields = ["target_aspect_ratio", "voice_source"]) {
  return {
    status: "verified",
    evidence: fields.map((field) => createEvidenceRecord({
      field,
      expected: field === "target_aspect_ratio" ? "9:16" : field === "voice_display_name" ? "播客-女声" : field === "voice_style" ? "普通话" : field === "subtitles_enabled" ? true : "hifly_native",
      actual: field === "target_aspect_ratio" ? "9:16" : field === "voice_display_name" ? "播客-女声" : field === "voice_style" ? "普通话" : field === "subtitles_enabled" ? true : { display: "Hifly 原生声音" },
      evidenceSource: ["target_aspect_ratio", "voice_source"].includes(field) ? field === "target_aspect_ratio" ? "production_contract" : "hifly_ui_display" : "hifly_dom_readback",
      verificationStage: "pre_paid",
      paidBoundary: "before_paid_action_1",
      result: field === "voice_source" ? HIFLY_VERIFICATION_RESULT.PARTIAL : HIFLY_VERIFICATION_RESULT.PROVEN
    }))
  };
}

test("cloud adapter binds approved current settings and leaves the target ratio for post-generation evidence", async () => {
  const { workspace, cleanup } = await workspaceFixture();
  const calls = [];
  const phases = [];
  const task = taskFor(workspace, { currentSettings: true });
  const page = { setDefaultTimeout() {} };
  const context = fakeContext(page, calls);
  try {
    const adapter = createCloudPlaywrightAdapter({
      workspace,
      browserType: { async launchPersistentContext() { return context; } },
      taskFactory: async () => task,
      contractFieldVerifier: async (input) => {
        phases.push({ phase: input.phase, fields: input.fields });
        return verifiedContractFields(input.fields);
      },
      hiflyPageFactory() {
        return {
          async preflight() { return { status: "ready" }; },
          async verifyCurrentSettings(currentTask) {
            calls.push(["settings", currentTask.voice_display_name, currentTask.voice_style, currentTask.subtitles_enabled]);
            return verifiedContractFields(["voice_source", "voice_display_name", "voice_style", "subtitles_enabled"]);
          },
          async prepareAsset(_task, { contractFieldVerifier }) {
            calls.push("prepare-asset");
            await contractFieldVerifier();
            return { asset_id: "asset-current-settings" };
          },
          async submitVideo() {
            calls.push("submit");
            return { status: "submitted", remoteEvidence: { evidence_source: "direct_submission", remote_id: "work-current-settings" } };
          },
          async querySubmission(remoteEvidence) { return { status: "ready", remoteEvidence }; },
          async downloadArtifact(_remoteEvidence, destination) {
            await writeFile(path.join(destination, "current-settings.mp4"), "video");
            return { artifact_id: "work-current-settings", relative_path: "outputs/current-settings.mp4" };
          },
          async reconcileSubmission() { return { candidates: [] }; }
        };
      }
    });

    const result = await adapter.run({
      order: orderFor(),
      attempt: { id: "attempt-current-settings" },
      package: packageFor()
    });

    assert.equal(result.status, "succeeded");
    assert.deepEqual(phases, [
      { phase: "pre_point", fields: ["voice_source", "voice_display_name", "voice_style", "subtitles_enabled"] },
      { phase: "pre_paid_action_1", fields: ["voice_source", "voice_display_name", "voice_style", "subtitles_enabled"] }
    ]);
    assert.deepEqual(calls, [
      ["settings", "播客-女声", "普通话", true],
      "prepare-asset",
      ["settings", "播客-女声", "普通话", true],
      "submit"
    ]);
    assert.deepEqual(Object.keys(hiflyPrePaidRequirementsFor(task.hifly_hands_on_product_v1)), [
      "voice_source", "voice_display_name", "voice_style", "subtitles_enabled"
    ]);
  } finally {
    await cleanup();
  }
});

test("cloud adapter selects the real page verifier by default for a current settings contract", async () => {
  const { workspace, cleanup } = await workspaceFixture();
  const calls = [];
  const verifierPhases = [];
  const task = taskFor(workspace, { currentSettings: true });
  const page = { setDefaultTimeout() {} };
  const context = fakeContext(page, calls);
  try {
    const adapter = createCloudPlaywrightAdapter({
      workspace,
      browserType: { async launchPersistentContext() { return context; } },
      taskFactory: async () => task,
      hiflyPageFactory() {
        return {
          async preflight() { calls.push("preflight"); return { status: "ready" }; },
          async verifyCurrentSettings(currentTask) {
            verifierPhases.push(currentTask.hifly_hands_on_product_v1.production.output_aspect_ratio_policy);
            return verifiedContractFields(["voice_source", "voice_display_name", "voice_style", "subtitles_enabled"]);
          },
          async prepareAsset(_task, { contractFieldVerifier }) {
            calls.push("prepare-asset");
            await contractFieldVerifier();
            return { asset_id: "asset-default-verifier" };
          },
          async submitVideo() {
            calls.push("submit");
            return { status: "submitted", remoteEvidence: { evidence_source: "direct_submission", remote_id: "work-default-verifier" } };
          },
          async querySubmission(remoteEvidence) { return { status: "ready", remoteEvidence }; },
          async downloadArtifact(_remoteEvidence, destination) {
            await writeFile(path.join(destination, "default-verifier.mp4"), "video");
            return { artifact_id: "work-default-verifier", relative_path: "outputs/default-verifier.mp4" };
          },
          async reconcileSubmission() { return { candidates: [] }; }
        };
      }
    });

    const result = await adapter.run({
      order: orderFor(),
      attempt: { id: "attempt-default-verifier" },
      package: packageFor()
    });

    assert.equal(result.status, "succeeded");
    assert.deepEqual(verifierPhases, [
      "post_output_verify_pad_preserve",
      "post_output_verify_pad_preserve"
    ]);
    assert.deepEqual(calls, ["preflight", "prepare-asset", "submit"]);
  } finally {
    await cleanup();
  }
});

test("cloud adapter default verifier reads current settings from the controlled Hifly DOM", async (t) => {
  const { workspace, cleanup } = await workspaceFixture();
  let browser;
  let adapter;
  try {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      if (error?.message?.includes("Executable doesn't exist")) return t.skip("Playwright browser is unavailable");
      throw error;
    }
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    await page.setContent(`
      <div class="page-goods">
        <div class="controls-panel">
          <div class="card auto-voice-box">
            <div class="voice-info"><div class="voice-details">
              <p class="voice-name">播客-女声</p>
              <p class="voice-style">普通话</p>
            </div></div>
          </div>
          <div class="card"><div class="card-header">
            <h2>字幕</h2><button type="button" role="switch" aria-checked="true"
              onclick="window.subtitleClicks = (window.subtitleClicks || 0) + 1"></button>
          </div></div>
        </div>
      </div>
      <script>window.subtitleClicks = 0</script>
    `);
    const task = taskFor(workspace, { currentSettings: true });
    let paidClicks = 0;
    let invalidateSettingsBeforeLateRead = false;
    adapter = createCloudPlaywrightAdapter({
      workspace,
      contextFactory: async () => context,
      pageFactory: async () => page,
      taskFactory: async () => task,
      hiflyPageFactory(currentPage, config, logger) {
        const hiflyPage = new HiflyHandsOnProductPage(currentPage, config, logger);
        hiflyPage.preflight = async () => ({ status: "ready" });
        hiflyPage.prepareAsset = async (_task, { contractFieldVerifier }) => {
          if (invalidateSettingsBeforeLateRead) {
            await currentPage.evaluate(() => {
              document.querySelector("button[role='switch']")?.setAttribute("aria-checked", "false");
              const overlay = document.createElement("div");
              overlay.id = "settings-overlay";
              overlay.style.cssText = "position:fixed;inset:0;z-index:10;pointer-events:auto";
              document.body.appendChild(overlay);
            });
          }
          await contractFieldVerifier();
          paidClicks += 1;
          return { asset_id: "asset-dom-default-verifier" };
        };
        hiflyPage.submitVideo = async () => ({
          status: "submitted",
          remoteEvidence: { evidence_source: "direct_submission", remote_id: "work-dom-default-verifier" }
        });
        hiflyPage.querySubmission = async (remoteEvidence) => ({ status: "ready", remoteEvidence });
        hiflyPage.downloadArtifact = async (_remoteEvidence, destination) => {
          await writeFile(path.join(destination, "dom-default-verifier.mp4"), "video");
          return { artifact_id: "work-dom-default-verifier", relative_path: "outputs/dom-default-verifier.mp4" };
        };
        hiflyPage.reconcileSubmission = async () => ({ candidates: [] });
        return hiflyPage;
      }
    });

    assert.deepEqual(await adapter.preflight({ task }), { status: "ready" });
    const result = await adapter.run({
      order: orderFor(),
      attempt: { id: "attempt-dom-default-verifier" },
      package: packageFor()
    });
    assert.equal(result.status, "succeeded");
    assert.equal(paidClicks, 1);

    invalidateSettingsBeforeLateRead = true;
    const blocked = await adapter.run({
      order: orderFor(),
      attempt: { id: "attempt-dom-default-verifier-late-blocked" },
      package: packageFor()
    });
    assert.equal(blocked.status, "requires_action");
    assert.equal(blocked.code, "CONTRACT_STRUCTURED_EVIDENCE_NOT_VERIFIED");
    assert.equal(blocked.failureStage, "pre_paid_gate");
    assert.equal(paidClicks, 1);
    assert.equal(await page.evaluate(() => window.subtitleClicks), 0);
  } finally {
    if (adapter) await adapter.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    await cleanup();
  }
});

async function generatedPackageForCloudExecutor() {
  const assetBody = Buffer.from("generated-product-image");
  const avatarBody = Buffer.from("person");
  const contract = contractFixture({ planId: "plan-cloud-v1", planReviewId: "review-cloud-v1", revisionId: "revision-cloud-v1", productAssetVersionId: "product-version-cloud", productBody: assetBody, copyVersionId: "copy-cloud-v1", copyBody: "Generated frozen copy.", selectionId: "selection-cloud-v1", avatarVersionId: "avatar-version-cloud", materialVersionId: "material-cloud-v1", avatarBody });
  const sourceOrder = {
    id: "order-cloud-generated", organization_id: "org-cloud", project_id: "project-cloud", product_id: "product-cloud",
    video_plan_version_id: "plan-cloud-v1", execution_purpose: "first_production", status: "waiting_for_executor",
    created_by_member_id: "member-cloud", created_at: "2026-08-12T00:00:00.000Z", updated_at: "2026-08-12T00:00:00.000Z",
    input_snapshot: {
      product_revision: {
        id: "revision-cloud-v1", status: "ready", product_name: "Generated cloud product", sku: "SKU-GENERATED",
        selling_points: ["Existing compiler path"], category: "test", asset_version_ids: ["product-version-cloud"]
      },
      copy_snapshot: {
        copy_version_id: "copy-cloud-v1", version_number: 1, status: "frozen", intent: "product_recommendation",
        copy_body: "Generated frozen copy.", review: { id: "review-cloud-v1", status: "approved", decided_at: "2026-08-12T00:00:00.000Z" }
      },
      avatar_snapshot: {
        avatar_selection_id: "selection-cloud-v1", avatar_asset_id: "avatar-cloud", avatar_asset_version_id: "avatar-version-cloud",
        status: "confirmed", version_number: 1, display_name: "Cloud Avatar", source_type: "seeded",
        authorization_status: "valid", capability_status: "verified", capabilities: [{ code: "speech", evidence_reference: "fixture:speech" }]
      },
      video_plan_version: { id: "plan-cloud-v1", version_number: 1, status: "frozen", presentation_size_code: "smart_fit", output_instructions: "Vertical product video" },
      plan_review: { id: "review-cloud-v1", status: "approved" },
      hifly_hands_on_product_v1: contract,
      asset_references: [{
        asset_id: "product-asset-cloud", asset_version_id: "product-version-cloud", role: "product_image",
        display_name: "Product image", media_type: "image/png", size: assetBody.length, checksum: sha256(assetBody),
        retrieval_mode: "embedded", access_scope: "organization", body: assetBody
      }]
    }
  };
  const repository = createMemoryManualHandoffRepository();
  const packageStore = createMemoryManualHandoffPackageStore();
  const service = createManualHandoffPackageService({
    repository,
    packageStore,
    now: () => Date.parse("2026-08-12T00:00:00.000Z"),
    orderPort: { async getOrder() { return structuredClone(sourceOrder); } }
  });
  const worker = createManualHandoffPackageWorker({ service });
  const requested = await service.requestGeneration({
    organizationId: sourceOrder.organization_id,
    actorMemberId: sourceOrder.created_by_member_id,
    actorRole: "member",
    productionOrderId: sourceOrder.id,
    generationRequestId: "cloud-generated-package"
  });
  await worker.runNext();
  const packageRecord = await service.getPackageForCloudExecutor({
    organizationId: sourceOrder.organization_id,
    executorCloudId: "cloud-executor-test",
    packageId: requested.package.id
  });
  const packageArchive = await service.downloadPackageForCloudExecutor({
    organizationId: sourceOrder.organization_id,
    executorCloudId: "cloud-executor-test",
    packageId: requested.package.id
  });
  return { packageRecord, packageArchive, sourceOrder };
}

test("cloud adapter injects an explicit profile/workspace and composes the existing Hifly adapter", async () => {
  const { workspace, cleanup } = await workspaceFixture();
  const calls = [];
  const page = { setDefaultTimeout(value) { calls.push(["timeout", value]); } };
  const context = fakeContext(page, calls);
  let receivedHiflyConfig;
  try {
    const adapter = createCloudPlaywrightAdapter({
      workspace,
      hiflyConfig: { batch: { defaultTimeoutMs: 321 } },
      contractFieldVerifier: async ({ fields }) => verifiedContractFields(fields),
      browserType: {
        async launchPersistentContext(profileDir, options) {
          calls.push(["launch", profileDir, options]);
          return context;
        }
      },
      executorFactory: ({ hiflyPage }) => hiflyPage,
      hiflyPageFactory(_page, config) {
        receivedHiflyConfig = config;
        return {
          async preflight() { return { status: "ready" }; },
          async createAsset() {},
          async submitVideo() {},
          async querySubmission() {},
          async downloadArtifact() {},
          async reconcileSubmission() {}
        };
      }
    });

    assert.deepEqual(await adapter.preflight(), { status: "ready" });
    assert.deepEqual(calls[0], ["launch", workspace.profileDir, {
      acceptDownloads: true,
      headless: true
    }]);
    assert.deepEqual(calls[1], ["timeout", 321]);
    assert.equal(receivedHiflyConfig.__rootDir, workspace.root);
    assert.equal(receivedHiflyConfig.browser.profileDir, workspace.profileDir);
    assert.equal(receivedHiflyConfig.downloadDir, workspace.outputsDir);
    assert.equal(receivedHiflyConfig.screenshotDir, workspace.evidenceDir);

    await adapter.close();
    assert.equal(calls.at(-1), "context-close");
  } finally {
    await cleanup();
  }
});

test("cloud adapter preserves browser-zero preflight without a task verifier", async () => {
  const { workspace, cleanup } = await workspaceFixture();
  const calls = [];
  try {
    const adapter = createCloudPlaywrightAdapter({
      workspace,
      browserType: { async launchPersistentContext() { calls.push("browser"); throw new Error("browser must not launch"); } }
    });
    const result = await adapter.preflight();
    assert.equal(result.ready, false);
    assert.equal(result.status, "requires_action");
    assert.equal(result.code, "CONTRACT_FIELD_NOT_MACHINE_VERIFIABLE");
    assert.equal(result.failureStage, "pre_point_gate");
    assert.deepEqual(result.fields, ["target_aspect_ratio", "voice_source"]);
    assert.deepEqual(calls, []);
  } finally { await cleanup(); }
});

test("cloud adapter rejects a bare boolean verifier result before createAsset", async () => {
  const { workspace, cleanup } = await workspaceFixture();
  const calls = [];
  const task = taskFor(workspace);
  const context = fakeContext({ setDefaultTimeout() {} }, calls);
  try {
    const adapter = createCloudPlaywrightAdapter({
      workspace,
      browserType: { async launchPersistentContext() { return context; } },
      taskFactory: async () => task,
      contractFieldVerifier: async () => true,
      hiflyPageFactory() {
        return {
          async preflight() {},
          async prepareAsset() { calls.push("prepare-asset"); },
          async submitVideo() { calls.push("submit"); },
          async querySubmission() {},
          async downloadArtifact() {},
          async reconcileSubmission() {}
        };
      }
    });

    const result = await adapter.run({ attempt: { id: "attempt-bare-verifier" } });

    assert.equal(result.status, "requires_action");
    assert.equal(result.code, "CONTRACT_STRUCTURED_EVIDENCE_REQUIRED");
    assert.equal(result.failureStage, "pre_point_gate");
    assert.deepEqual(result.fields, ["target_aspect_ratio", "voice_source"]);
    assert.equal(result.evidence[0].result, HIFLY_VERIFICATION_RESULT.NOT_PROVEN);
    assert.equal(calls.includes("prepare-asset"), false);
    assert.equal(calls.includes("submit"), false);
  } finally {
    await cleanup();
  }
});

test("cloud adapter reconstructs thrown verifier evidence instead of exposing raw values", async () => {
  const { workspace, cleanup } = await workspaceFixture();
  const task = taskFor(workspace);
  const context = fakeContext({ setDefaultTimeout() {} }, []);
  try {
    const adapter = createCloudPlaywrightAdapter({
      workspace,
      browserType: { async launchPersistentContext() { return context; } },
      taskFactory: async () => task,
      contractFieldVerifier: async () => {
        throw Object.assign(new Error("unsafe verifier detail"), {
          code: "CONTRACT_STRUCTURED_EVIDENCE_REQUIRED",
          outcome: "requires_action",
          evidence: [{
            field: "target_aspect_ratio",
            expected: "https://unsafe.example/secret",
            actual: "/private/raw/path",
            evidence_source: "https://unsafe.example/raw",
            verification_stage: "pre_paid",
            paid_boundary: "before_paid_action_1",
            result: HIFLY_VERIFICATION_RESULT.PROVEN
          }]
        });
      },
      hiflyPageFactory() {
        return {
          async preflight() {},
          async prepareAsset() { throw new Error("must not run"); },
          async submitVideo() { throw new Error("must not run"); },
          async querySubmission() {},
          async downloadArtifact() {},
          async reconcileSubmission() {}
        };
      }
    });
    const result = await adapter.run({ attempt: { id: "attempt-thrown-evidence" } });
    assert.equal(result.status, "requires_action");
    assert.equal(result.code, "CONTRACT_STRUCTURED_EVIDENCE_REQUIRED");
    assert.deepEqual(result.evidence.map((record) => record.field), ["target_aspect_ratio", "voice_source"]);
    assert.equal(result.evidence[0].evidence_source, "not_captured");
    assert.equal(result.evidence[0].actual, null);
  } finally {
    await cleanup();
  }
});

test("cloud action result retains a post-handheld ratio requires_action evidence", async () => {
  const { workspace, cleanup } = await workspaceFixture();
  const task = taskFor(workspace);
  const evidence = createEvidenceRecord({
    field: "handheld_aspect_ratio",
    expected: "9:16",
    actual: "1600x2848",
    evidenceSource: "generated_artifact_natural_dimensions",
    verificationStage: "post_handheld_pre_video",
    paidBoundary: "after_paid_action_1_before_paid_action_2",
    result: HIFLY_VERIFICATION_RESULT.FAIL_EXACT_MATCH
  });
  const context = fakeContext({ setDefaultTimeout() {} }, []);
  try {
    const adapter = createCloudPlaywrightAdapter({
      workspace,
      browserType: { async launchPersistentContext() { return context; } },
      taskFactory: async () => task,
      contractFieldVerifier: async ({ fields }) => verifiedContractFields(fields),
      hiflyPageFactory() {
        return {
          async preflight() { return { status: "ready" }; },
          async prepareAsset() {
            throw Object.assign(new Error("ratio mismatch"), {
              code: "HIFLY_HANDS_ON_PRODUCT_V1_HANDHELD_RATIO_MISMATCH",
              outcome: "requires_action",
              failureStage: "post_handheld_pre_video",
              evidence: [evidence]
            });
          },
          async submitVideo() { throw new Error("submit must not run"); },
          async querySubmission() {},
          async downloadArtifact() {},
          async reconcileSubmission() {}
        };
      }
    });
    const result = await adapter.run({ attempt: { id: "attempt-ratio-stop" } });
    assert.equal(result.status, "requires_action");
    assert.equal(result.code, "HIFLY_HANDS_ON_PRODUCT_V1_HANDHELD_RATIO_MISMATCH");
    assert.equal(result.failureStage, "post_handheld_pre_video");
    assert.deepEqual(result.evidence, [evidence]);
  } finally {
    await cleanup();
  }
});

test("cloud adapter maps existing Hifly checkpoints to controlled cloud progress and downloads one result", async () => {
  const { workspace, cleanup } = await workspaceFixture();
  const progress = [];
  const calls = [];
  const task = taskFor(workspace);
  const page = { setDefaultTimeout() {} };
  const context = fakeContext(page, calls);
  const verifierInputs = [];
  let pageState = "before-prepare-navigation";
  try {
    const adapter = createCloudPlaywrightAdapter({
      workspace,
      browserType: { async launchPersistentContext() { return context; } },
      taskFactory: async () => task,
      contractFieldVerifier: async (input) => {
        verifierInputs.push({ phase: input.phase, pageState, page: input.page, hiflyPage: input.hiflyPage });
        calls.push("verify");
        return verifiedContractFields(input.fields);
      },
      hiflyPageFactory() {
        return {
          async preflight() { return { status: "ready" }; },
          async prepareAsset(_task, { contractFieldVerifier }) {
            calls.push("prepare-asset");
            pageState = "after-prepare-navigation";
            await contractFieldVerifier();
            return { asset_id: "asset-1" };
          },
          async submitVideo(_task, { checkpoint }) {
            calls.push("submit");
            await checkpoint({ phase: "remote_submit_pre", evidence: { work_keys: [] } });
            await checkpoint({ phase: "remote_submit_clicked", evidence: { observed_at: "now" } });
            return { status: "submitted", remoteEvidence: { evidence_source: "direct_submission", remote_id: "work-1" } };
          },
          async querySubmission(remoteEvidence) {
            calls.push("query");
            return { status: "ready", remoteEvidence };
          },
          async downloadArtifact(_remoteEvidence, destination) {
            calls.push("download");
            await writeFile(path.join(destination, "work-1.mp4"), "video");
            return { artifact_id: "work-1", relative_path: "outputs/work-1.mp4" };
          },
          async reconcileSubmission() { calls.push("reconcile"); return { candidates: [] }; }
        };
      },
      onProgress: async ({ phase }) => progress.push(phase)
    });

    const result = await adapter.run({
      order: orderFor(),
      attempt: { id: "attempt-cloud-1" },
      package: packageFor(),
      progress: async ({ phase }) => progress.push(phase)
    });

    assert.equal(result.status, "succeeded");
    assert.equal(result.body.toString(), "video");
    assert.deepEqual(calls, ["verify", "prepare-asset", "verify", "submit", "query", "download"]);
    assert.deepEqual(verifierInputs.map(({ phase, pageState: state }) => ({ phase, pageState: state })), [
      { phase: "pre_point", pageState: "before-prepare-navigation" },
      { phase: "pre_paid_action_1", pageState: "after-prepare-navigation" }
    ]);
    assert.equal(verifierInputs[0].page, page);
    assert.equal(typeof verifierInputs[0].hiflyPage, "object");
    assert.equal(verifierInputs[1].page, page);
    assert.equal(typeof verifierInputs[1].hiflyPage, "object");
    assert.deepEqual(progress, ["pre_submit", "submitted", "wait_download"]);
  } finally {
    await cleanup();
  }
});

test("cloud adapter fails closed when navigation invalidates the late contract verification", async () => {
  const { workspace, cleanup } = await workspaceFixture();
  const calls = [];
  const phases = [];
  const progress = [];
  const task = taskFor(workspace);
  const page = { setDefaultTimeout() {} };
  const context = fakeContext(page, calls);
  let pageState = "before-prepare-navigation";
  let innerPaidClicks = 0;
  let paidMarkers = 0;
  try {
    const adapter = createCloudPlaywrightAdapter({
      workspace,
      browserType: { async launchPersistentContext() { return context; } },
      taskFactory: async () => task,
      contractFieldVerifier: async (input) => {
        phases.push({ phase: input.phase, pageState });
        if (input.phase === "pre_paid_action_1") return false;
        return verifiedContractFields(input.fields);
      },
      hiflyPageFactory() {
        return {
          async preflight() { return { status: "ready" }; },
          async prepareAsset(_task, { contractFieldVerifier, checkpoint }) {
            calls.push("prepare-asset");
            pageState = "after-prepare-navigation";
            await contractFieldVerifier();
            await checkpoint({
              phase: "asset_paid_action_pre",
              evidence: { paid_boundary: "before_paid_action_1" }
            });
            paidMarkers += 1;
            innerPaidClicks += 1;
            return { asset_id: "must-not-reach-paid-click" };
          },
          async submitVideo() { calls.push("submit"); throw new Error("submit must not run"); },
          async querySubmission() { calls.push("query"); throw new Error("query must not run"); },
          async downloadArtifact() { calls.push("download"); throw new Error("download must not run"); },
          async reconcileSubmission() { calls.push("reconcile"); return { candidates: [] }; }
        };
      }
    });

    const result = await adapter.run({
      order: orderFor(),
      attempt: { id: "attempt-late-verifier-failure" },
      package: packageFor(),
      progress: async ({ phase }) => progress.push(phase)
    });

    assert.equal(result.status, "requires_action");
    assert.equal(result.code, "CONTRACT_STRUCTURED_EVIDENCE_REQUIRED");
    assert.equal(result.failureStage, "pre_paid_gate");
    assert.equal(adapter.halted, true);
    assert.deepEqual(result.evidence.map((record) => record.field), ["target_aspect_ratio", "voice_source"]);
    assert.deepEqual(result.checkpoints, []);
    assert.equal(progress.includes("unknown_post_submit"), false);
    assert.equal(paidMarkers, 0);
    assert.equal(innerPaidClicks, 0);
    assert.deepEqual(phases, [
      { phase: "pre_point", pageState: "before-prepare-navigation" },
      { phase: "pre_paid_action_1", pageState: "after-prepare-navigation" }
    ]);
    assert.deepEqual(calls, ["prepare-asset"]);
  } finally {
    await cleanup();
  }
});

test("ambiguous post-submit outcome becomes requires_action and never submits again", async () => {
  const { workspace, cleanup } = await workspaceFixture();
  const calls = [];
  const task = taskFor(workspace);
  const page = { setDefaultTimeout() {} };
  const context = fakeContext(page, calls);
  try {
    const adapter = createCloudPlaywrightAdapter({
      workspace,
      browserType: { async launchPersistentContext() { return context; } },
      taskFactory: async () => task,
      contractFieldVerifier: async ({ fields }) => verifiedContractFields(fields),
      hiflyPageFactory() {
        return {
          async preflight() { return { status: "ready" }; },
          async prepareAsset() { return { asset_id: "asset-1" }; },
          async submitVideo(_task, { checkpoint }) {
            calls.push("submit");
            await checkpoint({ phase: "remote_submit_pre", evidence: { work_keys: [] } });
            await checkpoint({ phase: "remote_submit_clicked", evidence: { observed_at: "now" } });
            return { status: "ambiguous", candidates: [{ work_key: "possible-work-1" }, { work_key: "possible-work-2" }] };
          },
          async querySubmission() { calls.push("query"); throw new Error("query must not run"); },
          async downloadArtifact() { calls.push("download"); throw new Error("download must not run"); },
          async reconcileSubmission() { calls.push("reconcile"); return { candidates: [] }; }
        };
      }
    });

    const first = await adapter.run({ order: orderFor(), attempt: { id: "attempt-cloud-1" }, package: packageFor() });
    const second = await adapter.run({ order: orderFor(), attempt: { id: "attempt-cloud-1" }, package: packageFor() });

    assert.equal(first.status, "requires_action");
    assert.equal(first.failureStage, "unknown_post_submit");
    assert.equal(second.status, "requires_action");
    assert.equal(second.code, "CLOUD_EXECUTOR_POST_SUBMIT_UNKNOWN");
    assert.deepEqual(calls, ["submit"]);
  } finally {
    await cleanup();
  }
});

test("cloud adapter compiles an actual generated ManualHandoffPackage archive through the existing package compiler", async () => {
  const { workspace, cleanup } = await workspaceFixture();
  const generated = await generatedPackageForCloudExecutor();
  const avatarBytes = Buffer.from("person");
  const sourceCalls = [];
  let compiledTask;
  let executionConfig;
  let snapshotEstimate;
  const handheldEvidence = createEvidenceRecord({ field: "handheld_aspect_ratio", expected: "9:16", actual: "1600x2848",
    evidenceSource: "generated_artifact_natural_dimensions", verificationStage: "post_handheld_pre_video",
    paidBoundary: "after_paid_action_1_before_paid_action_2", result: HIFLY_VERIFICATION_RESULT.FAIL_EXACT_MATCH });
  const page = { setDefaultTimeout() {} };
  const context = fakeContext(page, []);
  try {
    const adapter = createCloudPlaywrightAdapter({
      workspace,
      avatarAssetSource: {
        async readVerifiedAvatarImage(input) {
          sourceCalls.push(input);
          return {
            asset_id: "material-asset-cloud",
            asset_version_id: "material-cloud-v1",
            kind: "avatar_image",
            bytes: avatarBytes,
            media_type: "image/png",
            size: avatarBytes.length,
            checksum_sha256: sha256(avatarBytes)
          };
        }
      },
      browserType: { async launchPersistentContext() { return context; } },
      snapshotFactory: async (items, execution) => {
        executionConfig = execution;
        const snapshot = await createExecutionSnapshot(items, execution);
        snapshotEstimate = snapshot.estimate;
        return snapshot;
      },
      contractFieldVerifier: async ({ fields }) => verifiedContractFields(fields),
      hiflyPageFactory() {
        return {
          async preflight() { return { status: "ready" }; },
          async prepareAsset(task) { compiledTask = task; return { asset_id: "asset-generated", handheld_evidence: [handheldEvidence] }; },
          async submitVideo() {
            return { status: "submitted", remoteEvidence: { evidence_source: "direct_submission", remote_id: "work-generated" } };
          },
          async querySubmission(remoteEvidence) { return { status: "ready", remoteEvidence }; },
          async downloadArtifact(_remoteEvidence, destination) {
            await writeFile(path.join(destination, "generated.mp4"), "generated-video");
            return { artifact_id: "work-generated", relative_path: "outputs/generated.mp4" };
          },
          async reconcileSubmission() { return { candidates: [] }; }
        };
      }
    });

    const result = await adapter.run({
      order: generated.sourceOrder,
      attempt: { id: "attempt-generated" },
      package: generated.packageRecord,
      packageArchive: generated.packageArchive
    });

    assert.equal(result.status, "succeeded");
    assert.equal(result.body.toString(), "generated-video");
    assert.deepEqual(result.evidence, [handheldEvidence]);
    assert.equal(compiledTask.product_name, "Generated cloud product");
    assert.equal(compiledTask.script, "Generated frozen copy.");
    assert.equal(compiledTask.person_image_path, path.join(workspace.assetsDir, "attempt-generated", "package", "resolved-avatar", "avatar.png"));
    assert.deepEqual(await readFile(compiledTask.person_image_path), avatarBytes);
    assert.equal(compiledTask.resolved_person_source, "cloud_asset_store");
    assert.deepEqual(sourceCalls, [{
      organizationId: "org-cloud", productId: "product-cloud", copyVersionId: "copy-cloud-v1",
      avatarSelectionId: "selection-cloud-v1", avatarVersionId: "avatar-version-cloud",
      materialVersionId: "material-cloud-v1", assetVersionId: "material-cloud-v1"
    }]);
    assert.equal(executionConfig.assetPointsPerItem, null);
    assert.equal(executionConfig.videoPointsEstimate, null);
    assert.equal(snapshotEstimate.known, false);
    assert.equal(snapshotEstimate.total, null);
    assert.deepEqual(snapshotEstimate.unknownComponents, ["assetPointsPerItem", "videoPointsEstimate"]);
    assert.equal(compiledTask.presentation_size_code, "smart_fit");
    assert.equal(compiledTask.image_path.startsWith(path.join(workspace.assetsDir, "attempt-generated")), true);
    assert.equal("task" in generated.packageRecord, false);
  } finally {
    await cleanup();
  }
});

test("cloud adapter rejects an attributed archive hash drift before browser/delegate construction", async () => {
  const { workspace, cleanup } = await workspaceFixture();
  const generated = await generatedPackageForCloudExecutor();
  const entries = await extractManualHandoffArchive(generated.packageArchive.body);
  const manifest = JSON.parse(entries["manifest.json"].toString());
  manifest.product_id = "tampered-product";
  const tamperedArchive = await buildManualHandoffZip([
    { name: "manifest.json", body: JSON.stringify(manifest) },
    { name: "README.md", body: entries["README.md"] },
    ...Object.entries(entries).filter(([name]) => name.startsWith("assets/")).map(([name, body]) => ({ name, body }))
  ]);
  const calls = [];
  try {
    const adapter = createCloudPlaywrightAdapter({
      workspace,
      avatarMappings: { "avatar-version-cloud": path.join(workspace.assetsDir, "person.png") },
      browserType: { async launchPersistentContext() { calls.push("browser"); return fakeContext({ setDefaultTimeout() {} }, calls); } },
      hiflyPageFactory() { calls.push("delegate"); return {}; }
    });
    await assert.rejects(() => adapter.run({ order: generated.sourceOrder, attempt: { id: "attempt-tampered", package_id: generated.packageRecord.id, package_version: generated.packageRecord.package_version, manifest_hash: generated.packageRecord.manifest_hash, package_hash: generated.packageRecord.package_hash }, package: generated.packageRecord, packageArchive: { body: tamperedArchive, contentType: "application/zip" } }), { code: "MANUAL_HANDOFF_PACKAGE_INTEGRITY_MISMATCH" });
    assert.deepEqual(calls, []);
  } finally { await cleanup(); }
});

test("cloud adapter rejects unexpected ZIP members before writing the extraction root", async () => {
  const { workspace, cleanup } = await workspaceFixture();
  const generated = await generatedPackageForCloudExecutor();
  const entries = await extractManualHandoffArchive(generated.packageArchive.body);
  const unexpectedArchive = await buildManualHandoffZip([
    { name: "manifest.json", body: entries["manifest.json"] },
    { name: "README.md", body: entries["README.md"] },
    ...Object.entries(entries).filter(([name]) => name.startsWith("assets/")).map(([name, body]) => ({ name, body })),
    { name: "unexpected.bin", body: Buffer.from("must-not-extract") }
  ]);
  const extractionRoot = path.join(workspace.assetsDir, "attempt-unexpected-member", "package");
  const calls = [];
  try {
    const adapter = createCloudPlaywrightAdapter({
      workspace,
      avatarMappings: { "avatar-version-cloud": path.join(workspace.assetsDir, "person.png") },
      browserType: { async launchPersistentContext() { calls.push("browser"); return fakeContext({ setDefaultTimeout() {} }, calls); } },
      hiflyPageFactory() { calls.push("delegate"); return {}; }
    });
    await assert.rejects(() => adapter.run({ order: generated.sourceOrder, attempt: { id: "attempt-unexpected-member" }, package: generated.packageRecord,
      packageArchive: { body: unexpectedArchive, contentType: "application/zip" } }), { code: "MANUAL_HANDOFF_PACKAGE_INTEGRITY_MISMATCH" });
    await assert.rejects(() => access(extractionRoot));
    assert.deepEqual(calls, []);
  } finally { await cleanup(); }
});

test("cloud adapter contains no second selector or page-flow implementation", async () => {
  const source = await readFile(new URL("../src/cloud-executor/playwright-adapter.js", import.meta.url), "utf8");
  assert.match(source, /HiflyHandsOnProductPage/);
  assert.match(source, /createHiflyExecutor/);
  assert.doesNotMatch(source, /上传人物|上传商品|立即生成|最新作品|\.locator\(/);
});

test("cloud adapter rejects taskFactory script mode or copy drift before browser/delegate", async () => {
  const { workspace, cleanup } = await workspaceFixture();
  const calls = [];
  const task = taskFor(workspace);
  const context = fakeContext({ setDefaultTimeout() {} }, calls);
  try {
    const adapter = createCloudPlaywrightAdapter({
      workspace,
      browserType: { async launchPersistentContext() { calls.push("browser"); return context; } },
      taskFactory: async () => ({ ...task, resolved_script_mode: "custom" }),
      contractFieldVerifier: async ({ fields }) => verifiedContractFields(fields),
      hiflyPageFactory() {
        calls.push("delegate");
        return { async preflight() {}, async createAsset() {}, async submitVideo() {}, async querySubmission() {}, async downloadArtifact() {}, async reconcileSubmission() {} };
      }
    });
    const result = await adapter.run({ attempt: { id: "attempt-task-drift" } });
    assert.equal(result.status, "requires_action");
    assert.equal(result.failureStage, "pre_point_gate");
    assert.equal(result.code, "HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_MISMATCH");
    assert.deepEqual(calls, []);
  } finally { await cleanup(); }
});

test("cloud adapter closes a browser after a failed pre-point verifier and never reaches createAsset or submitVideo", async () => {
  const { workspace, cleanup } = await workspaceFixture();
  const calls = [];
  const task = taskFor(workspace);
  const context = {
    pages() { return [{ setDefaultTimeout() {} }]; },
    async close() { calls.push("context-close"); },
    async newPage() { return { setDefaultTimeout() {} }; }
  };
  try {
    const adapter = createCloudPlaywrightAdapter({
      workspace,
      browserType: { async launchPersistentContext() { calls.push("browser"); return context; } },
      taskFactory: async () => task,
      contractFieldVerifier: async ({ page, hiflyPage }) => { calls.push(["verify", page, hiflyPage]); return false; },
      hiflyPageFactory() {
        calls.push("delegate");
        return {
          async preflight() {},
          async prepareAsset() { calls.push("prepare-asset"); },
          async submitVideo() { calls.push("submit"); },
          async querySubmission() {}, async downloadArtifact() {}, async reconcileSubmission() {}
        };
      }
    });
    const result = await adapter.run({ attempt: { id: "attempt-verifier-failed" } });
    assert.equal(result.status, "requires_action");
    assert.equal(result.code, "CONTRACT_STRUCTURED_EVIDENCE_REQUIRED");
    assert.equal(result.failureStage, "pre_point_gate");
    assert.equal(calls[0], "browser");
    assert.equal(calls[1], "delegate");
    assert.equal(calls[2][0], "verify");
    assert.equal(calls[2][1] !== undefined, true);
    assert.equal(calls[2][2] !== undefined, true);
    assert.equal(calls.includes("prepare-asset"), false);
    assert.equal(calls.includes("submit"), false);
    assert.equal(calls.at(-1), "context-close");
  } finally { await cleanup(); }
});
