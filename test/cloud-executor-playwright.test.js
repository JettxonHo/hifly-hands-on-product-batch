import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCloudPlaywrightAdapter } from "../src/cloud-executor/playwright-adapter.js";

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

function packageFor(task) {
  return {
    id: "package-cloud-1",
    package_version: 1,
    manifest_hash: "manifest-cloud-1",
    package_hash: "package-cloud-1",
    status: "ready",
    task
  };
}

function orderFor() {
  return { id: "order-cloud-1", created_by_member_id: "member-owner" };
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
      package: packageFor(task),
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

    const first = await adapter.run({ order: orderFor(), attempt: { id: "attempt-cloud-1" }, package: packageFor(task) });
    const second = await adapter.run({ order: orderFor(), attempt: { id: "attempt-cloud-1" }, package: packageFor(task) });

    assert.equal(first.status, "requires_action");
    assert.equal(first.failureStage, "unknown_post_submit");
    assert.equal(second.status, "requires_action");
    assert.equal(second.code, "CLOUD_EXECUTOR_POST_SUBMIT_UNKNOWN");
    assert.deepEqual(calls, ["submit"]);
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
