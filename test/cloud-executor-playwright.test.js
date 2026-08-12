import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCloudPlaywrightAdapter } from "../src/cloud-executor/playwright-adapter.js";
import { createManualHandoffPackageService } from "../src/manual-handoff/manual-handoff-package-service.js";
import { createManualHandoffPackageWorker } from "../src/manual-handoff/manual-handoff-package-worker.js";
import { createMemoryManualHandoffRepository } from "../src/manual-handoff/memory-manual-handoff-repository.js";
import { createMemoryManualHandoffPackageStore } from "../src/manual-handoff/manual-handoff-package-store.js";
import { sha256 } from "../src/manual-handoff/manual-handoff-package.js";

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

function fakeContext(page, calls) {
  return {
    pages() { return [page]; },
    async newPage() { calls.push("new-page"); return page; },
    async close() { calls.push("context-close"); }
  };
}

function taskFor(workspace) {
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
    script: "A fixed script for the cloud executor test.",
    resolved_script_mode: "custom"
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

async function generatedPackageForCloudExecutor() {
  const assetBody = Buffer.from("generated-product-image");
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
      video_plan_version: { id: "plan-cloud-v1", version_number: 1, status: "frozen", output_instructions: "Vertical product video" },
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

test("cloud adapter maps existing Hifly checkpoints to controlled cloud progress and downloads one result", async () => {
  const { workspace, cleanup } = await workspaceFixture();
  const progress = [];
  const calls = [];
  const task = taskFor(workspace);
  const page = { setDefaultTimeout() {} };
  const context = fakeContext(page, calls);
  try {
    const adapter = createCloudPlaywrightAdapter({
      workspace,
      browserType: { async launchPersistentContext() { return context; } },
      taskFactory: async () => task,
      hiflyPageFactory() {
        return {
          async preflight() { return { status: "ready" }; },
          async prepareAsset() { calls.push("prepare-asset"); return { asset_id: "asset-1" }; },
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
    assert.deepEqual(calls, ["prepare-asset", "submit", "query", "download"]);
    assert.deepEqual(progress, ["pre_submit", "submitted", "wait_download"]);
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
  const avatarMappingPath = path.join(workspace.root, "avatar-mappings.json");
  const avatarPath = path.join(workspace.assetsDir, "person.png");
  await writeFile(avatarMappingPath, JSON.stringify({ "avatar-version-cloud": avatarPath }));
  let compiledTask;
  const page = { setDefaultTimeout() {} };
  const context = fakeContext(page, []);
  try {
    const adapter = createCloudPlaywrightAdapter({
      workspace,
      avatarMappingPath,
      browserType: { async launchPersistentContext() { return context; } },
      hiflyPageFactory() {
        return {
          async preflight() { return { status: "ready" }; },
          async prepareAsset(task) { compiledTask = task; return { asset_id: "asset-generated" }; },
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
    assert.equal(compiledTask.product_name, "Generated cloud product");
    assert.equal(compiledTask.script, "Generated frozen copy.");
    assert.equal(compiledTask.person_image_path, avatarPath);
    assert.equal(compiledTask.image_path.startsWith(path.join(workspace.assetsDir, "attempt-generated")), true);
    assert.equal("task" in generated.packageRecord, false);
  } finally {
    await cleanup();
  }
});

test("cloud adapter contains no second selector or page-flow implementation", async () => {
  const source = await readFile(new URL("../src/cloud-executor/playwright-adapter.js", import.meta.url), "utf8");
  assert.match(source, /HiflyHandsOnProductPage/);
  assert.match(source, /createHiflyExecutor/);
  assert.doesNotMatch(source, /上传人物|上传商品|立即生成|最新作品|\.locator\(/);
});
