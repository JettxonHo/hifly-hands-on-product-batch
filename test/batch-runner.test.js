import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createBatchStore } from "../src/core/batch-store.js";
import { acquireExecutionLock } from "../src/core/execution-lock.js";
import { createExecutionSnapshot } from "../src/core/execution-snapshot.js";
import { runBatch } from "../src/core/batch-runner.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { HiflyHandsOnProductPage } from "../src/hifly-page.js";

async function fixtureRun({ executor, initialStatus = "confirmed", itemOverrides = {} } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-runner-"));
  const image = path.join(root, "product.png");
  await writeFile(image, "product-image");

  const execution = {
    projectRoot: root,
    version: "points-v1",
    assetPointsPerItem: 150,
    videoPointsEstimate: 350,
    confirmedAt: "2026-07-11T00:00:00.000Z"
  };
  const sourceItem = {
    task_id: "task-1",
    sku: "SKU-1",
    product_name: "Alpha",
    selling_points: "Useful",
    category: "beauty",
    image_path: image,
    ...itemOverrides
  };
  const snapshot = await createExecutionSnapshot([sourceItem], execution);
  const item = {
    ...sourceItem,
    status: initialStatus,
    execution_key: snapshot.executionKey,
    confirmed_at: execution.confirmedAt
  };
  const backing = createBatchStore(path.join(root, "batches"));
  await backing.create({ batch_id: "batch-1", items: [item], status: "pending", execution_snapshot: snapshot });
  const lock = await acquireExecutionLock({
    root: path.join(root, "locks"),
    batchId: "batch-1",
    instanceId: "fixture-runner",
    heartbeatIntervalMs: 10_000
  });
  const history = new Map([[item.task_id, [item.status]]]);
  const store = {
    ...backing,
    async update(batchId, updater) {
      const before = await backing.read(batchId);
      const next = await backing.update(batchId, updater);
      for (const nextItem of next.items) {
        const beforeItem = before.items.find((candidate) => candidate.task_id === nextItem.task_id);
        if (beforeItem?.status !== nextItem.status) {
          const taskHistory = history.get(nextItem.task_id) ?? [beforeItem?.status].filter(Boolean);
          taskHistory.push(nextItem.status);
          history.set(nextItem.task_id, taskHistory);
        }
      }
      return next;
    },
    statusHistory(taskId) {
      return history.get(taskId);
    }
  };

  return {
    batchId: "batch-1",
    items: [item],
    config: { execution },
    paths: { projectRoot: root, downloadDir: path.join(root, "downloads") },
    executor: executor ?? createFakeExecutor({ remoteId: "remote-1" }),
    store,
    lock,
    cleanup: async () => {
      await lock.release().catch(() => {});
      await rm(root, { recursive: true, force: true });
    }
  };
}

function fakeElement(tagName, { attrs = {}, text = "", html = "", children = [] } = {}) {
  const element = {
    tagName: tagName.toUpperCase(),
    attrs,
    innerText: text,
    textContent: text || children.map((child) => child.textContent || "").join(" "),
    innerHTML: html,
    children,
    clicked: false,
    getAttribute(name) {
      return this.attrs[name] ?? null;
    },
    getBoundingClientRect() {
      return { width: 120, height: 32 };
    },
    click() {
      this.clicked = true;
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null;
    },
    querySelectorAll(selector) {
      const selectors = selector.split(",").map((part) => part.trim()).filter(Boolean);
      const descendants = [];
      const visit = (node) => {
        for (const child of node.children || []) {
          descendants.push(child);
          visit(child);
        }
      };
      visit(this);
      return descendants.filter((node) => selectors.some((candidate) => fakeMatches(node, candidate)));
    }
  };

  for (const child of children) child.parentElement = element;
  return element;
}

function fakeMatches(element, selector) {
  if (selector === "button") return element.tagName === "BUTTON";
  if (selector === "a[href]") return element.tagName === "A" && Boolean(element.getAttribute("href"));
  if (selector === "button, a") return element.tagName === "BUTTON" || element.tagName === "A";
  if (selector === "svg use") return false;
  if (/^\[[^\]]+\]$/.test(selector)) {
    return Boolean(element.getAttribute(selector.slice(1, -1)));
  }
  if (/^\.[\w-]+$/.test(selector)) {
    return String(element.getAttribute("class") || "").split(/\s+/).includes(selector.slice(1));
  }
  if (["li", "article"].includes(selector)) return element.tagName === selector.toUpperCase();
  return false;
}

function createDownloadTestAdapter(cards) {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const panel = fakeElement("section", { attrs: { class: "auto-main-right" }, children: cards });

  globalThis.window = {
    getComputedStyle() {
      return { display: "block", visibility: "visible", opacity: "1" };
    }
  };
  globalThis.document = {
    querySelector(selector) {
      return selector === ".auto-main-right" ? panel : null;
    }
  };

  const page = {
    getByText() {
      return { first: () => ({ waitFor: async () => {} }) };
    },
    async evaluate(fn, arg) {
      try {
        return fn(arg);
      } finally {
        if (arg) {
          globalThis.window = previousWindow;
          globalThis.document = previousDocument;
        }
      }
    }
  };
  return new HiflyHandsOnProductPage(page, { batch: { defaultTimeoutMs: 10 } }, { info() {} });
}

test("persists checkpoints around submit and download", async () => {
  const fixture = await fixtureRun({ executor: createFakeExecutor({ remoteId: "remote-1" }) });
  try {
    const result = await runBatch(fixture);

    assert.deepEqual(fixture.store.statusHistory("task-1"), [
      "confirmed", "generating_asset", "asset_confirmed",
      "submitted", "download_pending", "completed"
    ]);
    assert.equal(result.items[0].remote_evidence.remote_id, "remote-1");
    assert.equal(result.items[0].output_path, "downloads/remote-1.mp4");
    assert.equal(result.items[0].submit_checkpoint.phase, "remote_submit_pre");
  } finally {
    await fixture.cleanup();
  }
});

test("rejects a confirmed execution whose snapshot no longer matches", async () => {
  const fixture = await fixtureRun();
  try {
    await fixture.store.update("batch-1", (batch) => ({
      ...batch,
      items: batch.items.map((item) => ({ ...item, product_name: "Changed after confirmation" }))
    }));

    await assert.rejects(runBatch(fixture), /execution key/i);
    assert.deepEqual(fixture.executor.calls, []);
  } finally {
    await fixture.cleanup();
  }
});

test("resolved generation strategies are preserved and bound to the execution snapshot", async () => {
  const fixture = await fixtureRun();
  try {
    await fixture.store.update("batch-1", (batch) => ({
      ...batch,
      items: batch.items.map((item) => ({
        ...item,
        resolved_person_source: "fixed_upload",
        resolved_script_mode: "custom"
      }))
    }));

    await assert.rejects(runBatch(fixture), /execution key/i);
    assert.deepEqual(fixture.executor.calls, []);
  } finally {
    await fixture.cleanup();
  }
});

test("snapshot verification uses an internal absolute pool image path", async () => {
  const fixture = await fixtureRun();
  const configRoot = await mkdtemp(path.join(os.tmpdir(), "hifly-config-root-"));
  try {
    const poolPath = path.join(configRoot, "assets", "person_pool", "default", "host.png");
    await mkdir(path.dirname(poolPath), { recursive: true });
    await writeFile(poolPath, "person-image");
    const item = {
      ...fixture.items[0],
      __resolved_person_image_path: poolPath,
      resolved_person_image_path: "assets/person_pool/default/host.png",
      resolved_person_source: "default_pool"
    };
    const execution = fixture.config.execution;
    const snapshot = await createExecutionSnapshot([item], execution);
    await fixture.store.update("batch-1", (batch) => ({
      ...batch,
      execution_snapshot: snapshot,
      items: [{
        ...item,
        status: "confirmed",
        execution_key: snapshot.executionKey,
        confirmed_at: execution.confirmedAt
      }]
    }));
    fixture.items = [item];
    fixture.config.execution = execution;

    const result = await runBatch(fixture);

    assert.equal(result.items[0].status, "completed");
  } finally {
    await rm(configRoot, { recursive: true, force: true });
    await fixture.cleanup();
  }
});

for (const status of [
  "confirmed",
  "generating_asset",
  "asset_confirmed",
  "submitted",
  "download_pending",
  "interrupted_unknown"
]) {
  test(`a ${status} task without an execution key cannot invoke an executor`, async () => {
    const fixture = await fixtureRun({ initialStatus: status });
    try {
      await fixture.store.update("batch-1", (batch) => ({
        ...batch,
        items: batch.items.map((item) => ({ ...item, execution_key: null }))
      }));

      await assert.rejects(runBatch(fixture), /execution key is required/i);
      assert.deepEqual(fixture.executor.calls, []);
    } finally {
      await fixture.cleanup();
    }
  });
}

test("download-pending retry only downloads the known artifact", async () => {
  const executor = createFakeExecutor({ remoteId: "remote-1" });
  const fixture = await fixtureRun({ executor, initialStatus: "download_pending" });
  try {
    await fixture.store.update("batch-1", (batch) => ({
      ...batch,
      items: batch.items.map((item) => ({
        ...item,
        remote_evidence: { remote_id: "remote-1", match_method: "remote_id", evidence_source: "direct_submission" }
      }))
    }));

    const result = await runBatch(fixture);

    assert.equal(result.items[0].status, "completed");
    assert.deepEqual(executor.calls.map((call) => call.method), ["downloadArtifact"]);
  } finally {
    await fixture.cleanup();
  }
});

test("submit-boundary failure remains unknown after its checkpoint", async () => {
  const executor = createFakeExecutor({ failAt: "submitVideo" });
  const fixture = await fixtureRun({ executor });
  try {
    const result = await runBatch(fixture);

    assert.equal(result.items[0].status, "interrupted_unknown");
    assert.equal(result.items[0].submit_checkpoint.phase, "remote_submit_pre");
    assert.equal(executor.callCounts.submitVideo, 1);
    assert.equal(executor.callCounts.createAsset, 1);
  } finally {
    await fixture.cleanup();
  }
});

test("a real custom script verification failure stops before video submission", async () => {
  const calls = [];
  const toggle = {
    first() { return this; },
    async count() { return 1; },
    async getAttribute() { return "false"; },
    async click() { calls.push("toggle-click"); }
  };
  const scriptField = {
    value: "",
    first() { return this; },
    async count() { return 1; },
    async fill(value) {
      this.value = value;
    },
    async inputValue() { return "这是一个足够长的指定口播文案前缀内容，需要在二十个字符之后却被替换。"; }
  };
  const page = {
    locator() {
      return {
        first() {
          return { getByRole: () => toggle };
        }
      };
    },
    getByLabel() { return scriptField; },
    getByPlaceholder() { return scriptField; },
    async waitForTimeout() {}
  };
  const adapter = new HiflyHandsOnProductPage(page, {
    batch: { defaultTimeoutMs: 10 },
    hiflyUi: { scriptLabel: "文案" }
  }, { info() {} });
  adapter.openWorkbench = async () => calls.push("open-workbench");
  adapter.enterHandsOnProductMode = async () => calls.push("enter-mode");
  adapter.resetExistingUpload = async () => calls.push("reset-upload");
  adapter.createHandsOnImage = async () => calls.push("create-image");
  adapter.captureStep = async (_product, step) => calls.push(`capture:${step}`);
  adapter.fillOptionalField = async (_label, _value, field) => calls.push(`fill:${field}`);

  const executor = {
    submitVideoCalls: 0,
    async createAsset(task) {
      return adapter.prepareAsset(task);
    },
    async submitVideo() {
      this.submitVideoCalls += 1;
      throw new Error("submitVideo must not be reached after script verification failure");
    },
    async querySubmission() { throw new Error("querySubmission must not be reached"); },
    async downloadArtifact() { throw new Error("downloadArtifact must not be reached"); },
    async reconcileSubmission() { throw new Error("reconcileSubmission must not be reached"); }
  };
  const fixture = await fixtureRun({
    executor,
    itemOverrides: {
      script: "这是一个足够长的指定口播文案前缀内容，需要在二十个字符之后保持正确。",
      resolved_script_mode: "custom"
    }
  });
  try {
    const result = await runBatch(fixture);

    assert.equal(result.items[0].status, "failed_pre_submit");
    assert.equal(result.items[0].error_phase, "asset_generation");
    assert.equal(executor.submitVideoCalls, 0);
    assert.deepEqual(calls, [
      "open-workbench",
      "enter-mode",
      "reset-upload",
      "create-image",
      "capture:after-upload",
      "fill:product_name",
      "fill:selling_points",
      "capture:script-field-filled",
      "capture:script-fill-not-verified"
    ]);
  } finally {
    await fixture.cleanup();
  }
});

test("a lock without live ownership verification cannot invoke an executor", async () => {
  const fixture = await fixtureRun();
  try {
    fixture.lock = { metadata: { batchId: "batch-1" } };

    await assert.rejects(runBatch(fixture), /acquired lock/i);
    assert.deepEqual(fixture.executor.calls, []);
  } finally {
    await fixture.cleanup();
  }
});

test("stale or mismatched lock ownership cannot invoke an executor", async () => {
  const fixture = await fixtureRun();
  try {
    const metadata = fixture.lock.metadata;
    fixture.lock = {
      metadata,
      async inspect() {
        return { ...metadata, batchId: "other-batch" };
      },
      async heartbeat() {
        throw new Error("stale lock");
      }
    };

    await assert.rejects(runBatch(fixture), /lock/i);
    assert.deepEqual(fixture.executor.calls, []);
  } finally {
    await fixture.cleanup();
  }
});

test("an unacquired stale lock heartbeat cannot invoke an executor", async () => {
  const fixture = await fixtureRun();
  try {
    const metadata = {
      ...fixture.lock.metadata,
      heartbeatAt: new Date(Date.now() - 60_000).toISOString()
    };
    fixture.lock = {
      metadata,
      async inspect() {
        return metadata;
      },
      async heartbeat() {
        return metadata;
      }
    };

    await assert.rejects(runBatch(fixture), /genuine acquired lock/i);
    assert.deepEqual(fixture.executor.calls, []);
  } finally {
    await fixture.cleanup();
  }
});

test("a fresh duck-typed lock cannot invoke an executor", async () => {
  const fixture = await fixtureRun();
  try {
    const metadata = { ...fixture.lock.metadata };
    fixture.lock = {
      metadata,
      async inspect() {
        return metadata;
      },
      async heartbeat() {
        return metadata;
      }
    };

    await assert.rejects(runBatch(fixture), /genuine acquired lock/i);
    assert.deepEqual(fixture.executor.calls, []);
  } finally {
    await fixture.cleanup();
  }
});

test("a changed lock blocks submit after asset generation", async () => {
  const fixture = await fixtureRun();
  const executor = createFakeExecutor({ remoteId: "remote-1" });
  const createAsset = executor.createAsset;
  executor.createAsset = async (...args) => {
    const asset = await createAsset(...args);
    const metadata = await fixture.lock.inspect();
    await writeFile(fixture.lock.lockPath, JSON.stringify({ ...metadata, batchId: "other-batch" }));
    return asset;
  };
  fixture.executor = executor;
  try {
    await assert.rejects(runBatch(fixture), /lock/i);
    assert.deepEqual(executor.calls.map((call) => call.method), ["createAsset"]);
  } finally {
    await fixture.cleanup();
  }
});

test("a changed persisted snapshot blocks submit after asset generation", async () => {
  const fixture = await fixtureRun();
  const executor = createFakeExecutor({ remoteId: "remote-1" });
  const createAsset = executor.createAsset;
  executor.createAsset = async (...args) => {
    const asset = await createAsset(...args);
    await fixture.store.update("batch-1", (batch) => ({
      ...batch,
      items: batch.items.map((item) => ({ ...item, product_name: "Mutated while running" }))
    }));
    return asset;
  };
  fixture.executor = executor;
  try {
    await assert.rejects(runBatch(fixture), /execution key/i);
    assert.deepEqual(executor.calls.map((call) => call.method), ["createAsset"]);
  } finally {
    await fixture.cleanup();
  }
});

test("a failed download remains pending and its retry only downloads", async () => {
  const fixture = await fixtureRun({
    initialStatus: "download_pending",
    executor: createFakeExecutor({ downloadFailure: true })
  });
  try {
    await fixture.store.update("batch-1", (batch) => ({
      ...batch,
      items: batch.items.map((item) => ({
        ...item,
        remote_evidence: { remote_id: "remote-1", match_method: "remote_id", evidence_source: "direct_submission" }
      }))
    }));

    const failed = await runBatch(fixture);
    assert.equal(failed.items[0].status, "download_pending");
    assert.deepEqual(fixture.executor.calls.map((call) => call.method), ["downloadArtifact"]);

    const retry = createFakeExecutor({ remoteId: "remote-1" });
    fixture.executor = retry;
    const recovered = await runBatch(fixture);
    assert.equal(recovered.items[0].status, "completed");
    assert.deepEqual(retry.calls.map((call) => call.method), ["downloadArtifact"]);
  } finally {
    await fixture.cleanup();
  }
});

test("a pre-submit auth pause does not submit or download", async () => {
  const executor = createFakeExecutor({ pauseAt: "createAsset" });
  const fixture = await fixtureRun({ executor });
  try {
    const result = await runBatch(fixture);

    assert.equal(result.items[0].status, "generating_asset");
    assert.equal(result.items[0].paused_auth, true);
    assert.deepEqual(executor.calls.map((call) => call.method), ["createAsset"]);
  } finally {
    await fixture.cleanup();
  }
});

test("a completed prior item does not invalidate the next confirmed item's snapshot", async () => {
  const executor = createFakeExecutor({ remoteId: "remote-2" });
  const fixture = await fixtureRun({ executor });
  try {
    const first = fixture.items[0];
    const secondSource = {
      task_id: "task-2",
      sku: "SKU-2",
      product_name: "Beta",
      selling_points: "Fast",
      category: "beauty",
      image_path: first.image_path
    };
    const snapshot = await createExecutionSnapshot([first, secondSource], fixture.config.execution);
    await fixture.store.update("batch-1", (batch) => ({
      ...batch,
      execution_snapshot: snapshot,
      items: [
        {
          ...first,
          status: "completed",
          execution_key: snapshot.executionKey,
          remote_evidence: { remote_id: "remote-1" },
          output_path: "downloads/remote-1.mp4"
        },
        {
          ...secondSource,
          status: "confirmed",
          execution_key: snapshot.executionKey,
          confirmed_at: fixture.config.execution.confirmedAt
        }
      ]
    }));

    const result = await runBatch(fixture);

    assert.deepEqual(result.items.map((item) => item.status), ["completed", "completed"]);
    assert.deepEqual(executor.calls.map((call) => call.method), [
      "createAsset", "submitVideo", "querySubmission", "downloadArtifact"
    ]);
  } finally {
    await fixture.cleanup();
  }
});

test("download clicks only a safe download action for the current stable work identity", async () => {
  const deleteButton = fakeElement("button", {
    attrs: { "aria-label": "delete", class: "ant-btn icon-delete" },
    html: '<span aria-label="delete" class="anticon-delete"></span>'
  });
  const dropdownButton = fakeElement("button", {
    attrs: { class: "ant-btn ant-dropdown-trigger" },
    html: '<span class="ant-dropdown-trigger"></span>'
  });
  const downloadButton = fakeElement("button", {
    attrs: { class: "ant-btn download" },
    html: '<span aria-label="download" class="anticon-download" data-icon="download"></span>'
  });
  const card = fakeElement("article", {
    attrs: { "data-work-id": "wanted-work" },
    text: "2026-07-13 23:36:27",
    children: [deleteButton, dropdownButton, downloadButton]
  });
  const adapter = createDownloadTestAdapter([card]);

  await adapter.clickWorkDownload({ remote_id: "wanted-work", index: 0 }, 10);

  assert.equal(deleteButton.clicked, false);
  assert.equal(dropdownButton.clicked, false);
  assert.equal(downloadButton.clicked, true);
});

test("download refuses to click when a matched work exposes only destructive actions", async () => {
  const deleteButton = fakeElement("button", {
    attrs: { "aria-label": "delete", class: "ant-btn icon-delete" },
    html: '<span aria-label="delete" class="anticon-delete"></span>'
  });
  const card = fakeElement("article", {
    attrs: { "data-work-id": "wanted-work" },
    text: "2026-07-13 23:36:27",
    children: [deleteButton]
  });
  const adapter = createDownloadTestAdapter([card]);

  await assert.rejects(
    adapter.clickWorkDownload({ remote_id: "wanted-work", index: 0 }, 10),
    /safe download button/
  );
  assert.equal(deleteButton.clicked, false);
});

test("downloadArtifact prefixes repeated suggested filenames with the remote id", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-download-"));
  try {
    await mkdir(path.join(root, "downloads"));
    let savedAs;
    const page = {
      waitForEvent() {
        return Promise.resolve({
          suggestedFilename() {
            return "未命名.mp4";
          },
          async saveAs(outputPath) {
            savedAs = outputPath;
            await writeFile(outputPath, "video");
          }
        });
      }
    };
    const adapter = new HiflyHandsOnProductPage(page, {
      __rootDir: root,
      downloadDir: path.join(root, "downloads"),
      batch: { generationTimeoutMs: 10 }
    }, { info() {} });
    adapter.matchLatestWorks = async () => [{ remote_id: "remote-1", work_key: "remote-1" }];
    adapter.clickWorkDownload = async () => {};

    const artifact = await adapter.downloadArtifact({ remote_id: "remote-1" }, path.join(root, "downloads"));

    assert.match(path.basename(savedAs), /remote-1.*未命名_mp4|remote-1.*未命名\.mp4/);
    assert.equal(artifact.artifact_id, "remote-1");
    assert.match(artifact.relative_path, /^downloads\//);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("submitVideo waits for a sole stable new latest work and returns direct evidence", async () => {
  const actions = [];
  const adapter = new HiflyHandsOnProductPage({
    async waitForTimeout(ms) {
      actions.push(`wait:${ms}`);
    }
  }, { batch: { defaultTimeoutMs: 10, generationTimeoutMs: 20000 } }, { info() {} });
  let observations = 0;
  const checkpoints = [];
  adapter.listLatestWorks = async () => {
    observations += 1;
    if (observations === 1) return [{ work_key: "existing-work" }];
    if (observations === 2) return [{ work_key: "existing-work" }];
    return [{ work_key: "existing-work" }, { work_key: "remote-new", remote_id: "remote-new" }];
  };
  adapter.captureStep = async () => {};
  adapter.clickSubmitButton = async () => {};

  const result = await adapter.submitVideo({}, {
    checkpoint: async (value) => checkpoints.push(value)
  });

  assert.equal(result.status, "submitted");
  assert.equal(result.remoteEvidence.evidence_source, "direct_submission");
  assert.equal(result.remoteEvidence.remote_id, "remote-new");
  assert.deepEqual(actions, ["wait:5000"]);
  assert.equal(checkpoints[0].phase, "remote_submit_pre");
});

test("submitVideo persists wait checkpoints without clicking submit twice", async () => {
  const realNow = Date.now;
  let now = 0;
  Date.now = () => now;
  try {
    const actions = [];
    let submitClicks = 0;
    const adapter = new HiflyHandsOnProductPage({
      async waitForTimeout(ms) {
        actions.push(`wait:${ms}`);
        now += ms;
      }
    }, { batch: { defaultTimeoutMs: 10, generationTimeoutMs: 36000 } }, { info() {} });
    adapter.listLatestWorks = async () => [{ work_key: "existing-work" }];
    adapter.captureStep = async () => {};
    adapter.clickSubmitButton = async () => {
      submitClicks += 1;
    };
    const checkpoints = [];

    const result = await adapter.submitVideo({}, {
      checkpoint: async (value) => checkpoints.push(value)
    });

    assert.equal(result.status, "ambiguous");
    assert.equal(submitClicks, 1);
    assert.deepEqual(checkpoints.map((checkpoint) => checkpoint.phase), [
      "remote_submit_pre",
      "remote_submit_clicked",
      "remote_submit_wait"
    ]);
    assert.equal(checkpoints[2].evidence.elapsed_ms, 35000);
    assert.equal(checkpoints[2].evidence.candidate_count, 0);
    assert.equal(actions.length, 8);
  } finally {
    Date.now = realNow;
  }
});

test("fillProduct applies custom script mode before submit", async () => {
  const calls = [];
  const adapter = new HiflyHandsOnProductPage({}, {
    hiflyUi: { productNameLabel: "产品名称", sellingPointsLabel: "核心卖点", scriptLabel: "文案" },
    behavior: {},
    batch: { defaultTimeoutMs: 1000 },
    debug: { captureSteps: false }
  }, { info() {} });
  adapter.resetExistingUpload = async () => calls.push("reset");
  adapter.createHandsOnImage = async () => calls.push("asset");
  adapter.fillOptionalField = async (_label, _value, field) => calls.push(`fill:${field}`);
  adapter.applyScriptMode = async (product) => calls.push(`script:${product.resolved_script_mode}`);

  await adapter.fillProduct({
    sku: "A",
    product_name: "Alpha",
    selling_points: "Useful",
    script: "指定口播。",
    resolved_script_mode: "custom"
  });

  assert.deepEqual(calls, ["reset", "asset", "fill:product_name", "fill:selling_points", "script:custom"]);
});

test("applyScriptMode enables the default Hifly AI script path", async () => {
  const calls = [];
  const adapter = new HiflyHandsOnProductPage({}, {
    hiflyUi: { scriptLabel: "文案" },
    batch: { defaultTimeoutMs: 1000 }
  }, { info() {} });
  adapter.enableAiScriptGeneration = async () => calls.push("enable-ai");
  adapter.fillOptionalField = async () => {
    throw new Error("default mode must not fill a custom script");
  };

  await adapter.applyScriptMode({ resolved_script_mode: "hifly_ai", script: "ignored" });
  assert.deepEqual(calls, ["enable-ai"]);
});

test("applyScriptMode rejects an unverified custom script before video submission", async () => {
  const calls = [];
  const adapter = new HiflyHandsOnProductPage({}, {
    hiflyUi: { scriptLabel: "文案" },
    batch: { defaultTimeoutMs: 1000 }
  }, { info() {} });
  adapter.disableAiScriptGeneration = async () => calls.push("disable-ai");
  adapter.fillScriptField = async () => calls.push("fill-script");
  adapter.verifyScriptText = async () => {
    calls.push("verify-script");
    throw new Error("Custom script text could not be verified after filling.");
  };

  await assert.rejects(
    adapter.applyScriptMode({ resolved_script_mode: "custom", script: "指定口播。" }),
    /could not be verified/i
  );
  assert.deepEqual(calls, ["disable-ai", "fill-script", "verify-script"]);
});

test("applyScriptMode falls back to the real Hifly script label", async () => {
  const calls = [];
  const script = "这是一条指定口播，会完整写入飞影文案输入框。";
  const scriptField = {
    value: "",
    first() { return this; },
    async count() { return 1; },
    async fill(value) {
      this.value = value;
      calls.push(`fill:${value}`);
    },
    async inputValue() {
      calls.push("read");
      return this.value;
    }
  };
  const missingField = {
    first() { return this; },
    async count() { return 0; }
  };
  const adapter = new HiflyHandsOnProductPage({
    getByLabel(label) {
      return label === "文案" ? scriptField : missingField;
    },
    getByPlaceholder() {
      return missingField;
    }
  }, {
    hiflyUi: { scriptLabel: "脚本文案" },
    batch: { defaultTimeoutMs: 1000 },
    debug: { captureSteps: false }
  }, {
    info(event, details) {
      calls.push(`${event}:${details.fieldName}:${details.label}:${details.match}`);
    }
  });
  adapter.disableAiScriptGeneration = async () => calls.push("disable-ai");
  adapter.captureStep = async (_product, step) => calls.push(`capture:${step}`);

  await adapter.applyScriptMode({ resolved_script_mode: "custom", script });

  assert.deepEqual(calls, [
    "disable-ai",
    `fill:${script}`,
    "field_filled:script:文案:label",
    "capture:script-field-filled",
    "field_read:script:文案:label",
    "read",
    "capture:script-filled"
  ]);
});

test("createHandsOnImage edits a stale generated modal before uploading the current product", async () => {
  const calls = [];
  const adapter = new HiflyHandsOnProductPage({}, {
    batch: { defaultTimeoutMs: 10 },
    behavior: { useRecommendedPersonWhenMissing: true },
    personPool: { fallbackToRecommended: true },
    hiflyUi: {
      uploadPersonText: "上传人物",
      uploadProductText: "上传商品"
    }
  }, { info() {} });

  adapter.openHandsOnModal = async () => calls.push("open");
  adapter.captureStep = async (_product, step) => calls.push(`capture:${step}`);
  let readyChecks = 0;
  adapter.hasGeneratedImageReady = async () => {
    readyChecks += 1;
    calls.push("ready");
    return readyChecks === 1;
  };
  adapter.resetGeneratedHandsOnImage = async () => calls.push("reset-stale");
  adapter.selectRecommendedPerson = async () => calls.push("select-person");
  adapter.captureProductImageSrc = async () => calls.push("capture-src") && { src: "stale.png", naturalWidth: 100 };
  adapter.verifyProductImageReplaced = async () => calls.push("verify");
  adapter.uploadModalFile = async (label, filePath, options = {}) => {
    const required = options?.required === true ? "required" : "optional";
    calls.push(`upload:${label}:${filePath}:${required}`);
  };
  adapter.clickModalGenerate = async () => calls.push("generate");
  adapter.confirmGeneratedHandsOnImage = async () => calls.push("confirm");
  adapter.clickModalConfirm = async () => {
    throw new Error("stale generated result must not be confirmed before re-upload");
  };

  await adapter.createHandsOnImage({
    sku: "SKU001",
    image_path: "/tmp/current-product.png"
  });

  assert.deepEqual(calls, [
    "open",
    "capture:modal-open",
    "ready",
    "reset-stale",
    "capture:modal-reset",
    "open",
    "capture:modal-reopen",
    "ready",
    "select-person",
    "capture-src",
    "upload:上传商品:/tmp/current-product.png:required",
    "verify",
    "capture:modal-ready",
    "ready",
    "generate",
    "capture:modal-after-generate",
    "confirm"
  ]);
});

test("createHandsOnImage retries when a generated modal appears before clicking generate", async () => {
  const calls = [];
  const readyResults = [
    false, // initial open
    true, // unexpected generated/stale result immediately after upload
    false, // reset+reopen anti-loop check
    false, // retry open
    false // retry after upload, safe to click generate
  ];
  const adapter = new HiflyHandsOnProductPage({}, {
    batch: { defaultTimeoutMs: 10 },
    behavior: { useRecommendedPersonWhenMissing: true },
    personPool: { fallbackToRecommended: true },
    hiflyUi: {
      uploadPersonText: "上传人物",
      uploadProductText: "上传商品"
    }
  }, { info(event, payload) { calls.push(`log:${event}:${payload?.attempt ?? ""}`); } });

  adapter.openHandsOnModal = async () => calls.push("open");
  adapter.captureStep = async (_product, step) => calls.push(`capture:${step}`);
  adapter.hasGeneratedImageReady = async () => {
    calls.push("ready");
    return readyResults.shift() ?? false;
  };
  adapter.resetGeneratedHandsOnImage = async () => calls.push("reset-stale");
  adapter.selectRecommendedPerson = async () => calls.push("select-person");
  adapter.captureProductImageSrc = async () => calls.push("capture-src") && { src: "before.png", naturalWidth: 100 };
  adapter.verifyProductImageReplaced = async () => calls.push("verify");
  adapter.uploadModalFile = async (label, filePath, options = {}) => {
    const required = options?.required === true ? "required" : "optional";
    calls.push(`upload:${label}:${filePath}:${required}`);
  };
  adapter.clickModalGenerate = async () => calls.push("generate");
  adapter.confirmGeneratedHandsOnImage = async () => calls.push("confirm");

  await adapter.createHandsOnImage({
    sku: "SKU001",
    image_path: "/tmp/current-product.png"
  });

  assert.deepEqual(calls, [
    "open",
    "capture:modal-open",
    "ready",
    "select-person",
    "capture-src",
    "upload:上传商品:/tmp/current-product.png:required",
    "verify",
    "capture:modal-ready",
    "ready",
    "log:generated_modal_ready_before_generate:0",
    "reset-stale",
    "capture:modal-reset",
    "open",
    "capture:modal-reopen",
    "ready",
    "open",
    "capture:modal-retry-open",
    "ready",
    "select-person",
    "capture-src",
    "upload:上传商品:/tmp/current-product.png:required",
    "verify",
    "capture:modal-ready",
    "ready",
    "generate",
    "capture:modal-after-generate",
    "confirm"
  ]);
});

test("createHandsOnImage forces a product upload even when the modal looks ready to generate", async () => {
  const calls = [];
  const productUploadError = new Error("product upload must run on a stale modal");
  const adapter = new HiflyHandsOnProductPage({}, {
    batch: { defaultTimeoutMs: 10 },
    hiflyUi: {
      uploadPersonText: "上传人物",
      uploadProductText: "上传商品"
    }
  }, { info() {} });

  adapter.openHandsOnModal = async () => calls.push("open");
  adapter.captureStep = async (_product, step) => calls.push(`capture:${step}`);
  adapter.hasGeneratedImageReady = async () => false;
  adapter.selectRecommendedPerson = async () => calls.push("select-person");
  adapter.uploadModalFile = async (label, filePath, options = {}) => {
    const required = options?.required === true ? "required" : "optional";
    calls.push(`upload:${label}:${filePath}:${required}`);
    if (required === "required") throw productUploadError;
  };
  adapter.clickModalGenerate = async () => calls.push("generate");
  adapter.confirmGeneratedHandsOnImage = async () => calls.push("confirm");

  await assert.rejects(
    adapter.createHandsOnImage({ sku: "SKU001", image_path: "/tmp/current-product.png" }),
    productUploadError
  );

  assert.deepEqual(calls, [
    "open",
    "capture:modal-open",
    "upload:上传商品:/tmp/current-product.png:required"
  ]);
});

test("createHandsOnImage throws if a stale image persists after reset+reopen (anti-loop guard)", async () => {
  const calls = [];
  const adapter = new HiflyHandsOnProductPage({}, {
    batch: { defaultTimeoutMs: 10 },
    hiflyUi: { uploadProductText: "上传商品" }
  }, { info() {} });
  adapter.openHandsOnModal = async () => calls.push("open");
  adapter.captureStep = async (_p, step) => calls.push(`capture:${step}`);
  adapter.hasGeneratedImageReady = async () => { calls.push("ready"); return true; };
  adapter.resetGeneratedHandsOnImage = async () => calls.push("reset-stale");
  adapter.dumpModalDomSnapshot = async () => calls.push("dump");

  await assert.rejects(
    adapter.createHandsOnImage({ sku: "SKU001", image_path: "/tmp/p.png" }),
    /stale generated image persists after reset\+reopen/
  );

  assert.deepEqual(calls, [
    "open",
    "capture:modal-open",
    "ready",
    "reset-stale",
    "capture:modal-reset",
    "open",
    "capture:modal-reopen",
    "ready",
    "dump"
  ]);
});

test("resetGeneratedHandsOnImage waits for the product upload button after clicking edit", async () => {
  const actions = [];
  const uploadButton = {
    async isVisible() { return true; },
    async waitFor() { actions.push("upload-visible"); }
  };
  const editLink = {
    async isVisible() { actions.push("edit-text-visible"); return true; },
    async click() { actions.push("edit-text-click"); }
  };
  const dialog = {
    getByText() { return { first: () => editLink }; }
  };
  const page = {
    getByRole(_role, options) {
      const name = String(options?.name || "");
      return name.includes("上传商品")
        ? { first: () => uploadButton }
        : { first: () => editLink };
    },
    async waitForTimeout(ms) { actions.push(`wait:${ms}`); }
  };
  const adapter = new HiflyHandsOnProductPage(page, {
    batch: { defaultTimeoutMs: 10 },
    hiflyUi: { uploadProductText: "上传商品" }
  }, { info() {} });
  adapter.dialogLocator = () => dialog;
  adapter.captureStep = async (_product, step) => actions.push(`capture:${step}`);

  await adapter.resetGeneratedHandsOnImage({ sku: "SKU001" });

  assert.deepEqual(actions, [
    "edit-text-visible",
    "edit-text-click",
    "capture:after-reset-edit",
    "upload-visible",
    "wait:500"
  ]);
});

test("resetGeneratedHandsOnImage clears residual images then throws when the upload button never appears", async () => {
  const actions = [];
  const uploadButton = {
    async isVisible() { return false; },
    async waitFor() { throw new Error("upload controls still hidden"); }
  };
  const editLink = {
    async isVisible() { return true; },
    async click() { actions.push("edit-text-click"); }
  };
  const dialog = {
    getByText() { return { first: () => editLink }; }
  };
  const page = {
    getByRole(_role, options) {
      const name = String(options?.name || "");
      return name.includes("上传商品")
        ? { first: () => uploadButton }
        : { first: () => editLink };
    },
    async waitForTimeout() {}
  };
  const adapter = new HiflyHandsOnProductPage(page, {
    batch: { defaultTimeoutMs: 10 },
    hiflyUi: { uploadProductText: "上传商品" }
  }, { info() {} });
  adapter.dialogLocator = () => dialog;
  adapter.captureStep = async (_product, step) => actions.push(`capture:${step}`);
  adapter.dumpModalDomSnapshot = async () => actions.push("dump");
  adapter.clearResidualModalImages = async () => actions.push("clear-residual");

  await assert.rejects(
    adapter.resetGeneratedHandsOnImage({ sku: "SKU001" }),
    /did not become visible/
  );

  assert.deepEqual(actions, [
    "edit-text-click",
    "capture:after-reset-edit",
    "dump",
    "clear-residual",
    "capture:reset-upload-not-visible",
    "dump"
  ]);
});

test("verifyProductImageReplaced throws when the product image src did not change (safety net)", async () => {
  const adapter = new HiflyHandsOnProductPage({}, { batch: { defaultTimeoutMs: 10 } }, { info() {} });
  adapter.captureStep = async () => {};
  adapter.captureProductImageSrc = async () => ({ src: "https://cdn/stale-bokchoy.png", naturalWidth: 200 });

  await assert.rejects(
    adapter.verifyProductImageReplaced({ src: "https://cdn/stale-bokchoy.png", naturalWidth: 200 }, { sku: "SKU001" }),
    /product image NOT replaced/
  );
});

test("verifyProductImageReplaced passes when a new product image is loaded after upload", async () => {
  const adapter = new HiflyHandsOnProductPage({}, { batch: { defaultTimeoutMs: 10 } }, { info() {} });
  adapter.captureStep = async () => {};
  adapter.captureProductImageSrc = async () => ({ src: "blob:new-chiikawa", naturalWidth: 200 });

  await adapter.verifyProductImageReplaced({ src: "https://cdn/stale-bokchoy.png", naturalWidth: 200 }, { sku: "SKU001" });
});

test("verifyProductImageReplaced throws when no product image is found after upload", async () => {
  const adapter = new HiflyHandsOnProductPage({}, { batch: { defaultTimeoutMs: 10 } }, { info() {} });
  adapter.captureStep = async () => {};
  adapter.captureProductImageSrc = async () => null;

  await assert.rejects(
    adapter.verifyProductImageReplaced(null, { sku: "SKU001" }),
    /product image not found/
  );
});

test("uploadModalFile skips optional uploads when the modal is already ready to generate", async () => {
  const actions = [];
  const adapter = new HiflyHandsOnProductPage({
    getByRole(role, options) {
      actions.push(`${role}:${options.name}`);
      return {
        first() {
          return {
            async isVisible() {
              actions.push("upload-hidden");
              return false;
            },
            async waitFor() {
              actions.push("unexpected-wait");
            },
            async click() {
              actions.push("unexpected-click");
            }
          };
        }
      };
    },
    async waitForEvent() {
      actions.push("unexpected-filechooser");
    },
    locator() {
      return { last: () => ({ async count() { return 0; } }) };
    }
  }, {
    batch: { defaultTimeoutMs: 10 },
    hiflyUi: { uploadProductText: "上传商品", modalSubmitText: "立即生成" }
  }, { info() {} });
  adapter.isHandsOnModalReadyForGenerate = async () => {
    actions.push("generate-ready");
    return true;
  };

  await adapter.uploadModalFile("上传人物", "/tmp/person.png");

  assert.deepEqual(actions, [
    "button:/上传人物/",
    "upload-hidden",
    "generate-ready"
  ]);
});

test("uploadModalFile refuses to skip a required upload when the button stays hidden", async () => {
  const actions = [];
  const adapter = new HiflyHandsOnProductPage({
    getByRole(role, options) {
      actions.push(`${role}:${options.name}`);
      return {
        first() {
          return {
            async isVisible() {
              actions.push("upload-hidden");
              return false;
            },
            async waitFor() {
              actions.push("unexpected-wait");
            },
            async click() {
              actions.push("unexpected-click");
            }
          };
        }
      };
    },
    async waitForEvent() {
      actions.push("unexpected-filechooser");
    },
    locator() {
      return { last: () => ({ async count() { return 0; } }) };
    }
  }, {
    batch: { defaultTimeoutMs: 10 },
    hiflyUi: { uploadProductText: "上传商品", modalSubmitText: "立即生成" }
  }, { info() {} });
  adapter.isHandsOnModalReadyForGenerate = async () => {
    actions.push("generate-ready");
    return true;
  };

  await assert.rejects(
    adapter.uploadModalFile("上传商品", "/tmp/product.png", { required: true }),
    /Required upload "上传商品" is not visible/
  );

  assert.deepEqual(actions, [
    "button:/上传商品/",
    "upload-hidden",
    "generate-ready"
  ]);
});

test("uploadModalFile refuses a required product upload even when the modal is not ready to generate", async () => {
  const actions = [];
  const adapter = new HiflyHandsOnProductPage({
    getByRole(role, options) {
      actions.push(`${role}:${options.name}`);
      return {
        first() {
          return {
            async isVisible() {
              actions.push("upload-hidden");
              return false;
            },
            async waitFor() {
              actions.push("unexpected-wait");
            },
            async click() {
              actions.push("unexpected-click");
            }
          };
        }
      };
    },
    async waitForEvent() {
      actions.push("unexpected-filechooser");
    },
    locator() {
      return { last: () => ({ async count() { return 0; } }) };
    }
  }, {
    batch: { defaultTimeoutMs: 10 },
    hiflyUi: { uploadProductText: "上传商品", modalSubmitText: "立即生成" }
  }, { info() {} });
  adapter.isHandsOnModalReadyForGenerate = async () => {
    actions.push("generate-not-ready");
    return false;
  };

  await assert.rejects(
    adapter.uploadModalFile("上传商品", "/tmp/product.png", { required: true }),
    /Required upload "上传商品" is not visible/
  );

  assert.deepEqual(actions, [
    "button:/上传商品/",
    "upload-hidden",
    "generate-not-ready"
  ]);
});

test("confirmGeneratedHandsOnImage waits for generated preview before confirming", async () => {
  const actions = [];
  const adapter = new HiflyHandsOnProductPage({
    async waitForTimeout(ms) {
      actions.push(`wait:${ms}`);
    }
  }, {
    batch: { defaultTimeoutMs: 10, generationTimeoutMs: 10000 },
    hiflyUi: { modalSubmitText: "立即生成" }
  }, { info() {} });
  let checks = 0;
  adapter.hasGeneratedImageReady = async () => {
    checks += 1;
    actions.push(`ready-check:${checks}`);
    return checks >= 3;
  };
  adapter.clickModalConfirm = async (timeout) => {
    actions.push(`confirm:${timeout}`);
  };

  await adapter.confirmGeneratedHandsOnImage();

  assert.deepEqual(actions, [
    "ready-check:1",
    "wait:2000",
    "ready-check:2",
    "wait:2000",
    "ready-check:3",
    "confirm:10000"
  ]);
});

test("hasGeneratedImageReady detects split confirm text from modal content", async () => {
  const actions = [];
  const dialog = {
    getByText(text) {
      actions.push(`text:${text}`);
      return {
        last() {
          return {
            async isVisible() {
              actions.push("text-hidden");
              return false;
            }
          };
        }
      };
    },
    async evaluate(callback) {
      actions.push("dialog-text");
      return callback({
        innerText: "手持商品图 再次生成 150积分 重新编辑 确 认"
      });
    }
  };
  const adapter = new HiflyHandsOnProductPage({}, {
    batch: { defaultTimeoutMs: 10 },
    hiflyUi: { modalConfirmText: "确认" }
  }, { info() {} });
  adapter.dialogLocator = () => dialog;

  assert.equal(await adapter.hasGeneratedImageReady(), true);
  assert.deepEqual(actions, [
    "text:/确\\s*认/",
    "text-hidden",
    "text:再次生成",
    "text-hidden",
    "dialog-text"
  ]);
});

test("hasGeneratedImageReady ignores generated keywords outside the modal", async () => {
  const actions = [];
  const dialog = {
    getByText(text) {
      actions.push(`dialog-text:${text}`);
      return {
        last() {
          return {
            async isVisible() {
              actions.push("dialog-text-hidden");
              return false;
            }
          };
        }
      };
    },
    async evaluate() {
      actions.push("dialog-empty");
      return "";
    }
  };
  const adapter = new HiflyHandsOnProductPage({}, {
    batch: { defaultTimeoutMs: 10 },
    hiflyUi: { modalConfirmText: "确认" }
  }, { info() {} });
  adapter.dialogLocator = () => dialog;

  assert.equal(await adapter.hasGeneratedImageReady(), false);
  assert.deepEqual(actions, [
    "dialog-text:/确\\s*认/",
    "dialog-text-hidden",
    "dialog-text:再次生成",
    "dialog-text-hidden",
    "dialog-empty"
  ]);
});

test("hasGeneratedImageReady detects a generated UUID preview image", async () => {
  const dialog = {
    getByText() {
      return {
        last() {
          return {
            async isVisible() {
              return false;
            }
          };
        }
      };
    },
    async evaluate(callback) {
      return callback({
        innerText: "手持商品图",
        textContent: "手持商品图",
        querySelectorAll(selector) {
          if (selector === "button") {
            return [
              { innerText: "", textContent: "", getAttribute: () => "" },
              { innerText: "", textContent: "", getAttribute: () => "" },
              { innerText: "", textContent: "", getAttribute: () => "" }
            ];
          }
          if (selector === "img") {
            return [{
              currentSrc: "https://cdn.hifly.cc/5965ae5a-86d4-49ac-bd73-29fed9f93bc7.png",
              src: "",
              getAttribute: () => ""
            }];
          }
          return [];
        }
      });
    }
  };
  const adapter = new HiflyHandsOnProductPage({}, {
    batch: { defaultTimeoutMs: 10 },
    hiflyUi: { modalConfirmText: "确认" }
  }, { info() {} });
  adapter.dialogLocator = () => dialog;

  assert.equal(await adapter.hasGeneratedImageReady(), true);
});

test("hasGeneratedImageReady does not treat upload recommendations as generated preview", async () => {
  const dialog = {
    getByText() {
      return {
        last() {
          return {
            async isVisible() {
              return false;
            }
          };
        }
      };
    },
    async evaluate(callback) {
      return callback({
        innerText: "手持商品图 上传人物 上传商品 推荐： 立即生成 150积分",
        textContent: "手持商品图 上传人物 上传商品 推荐： 立即生成 150积分",
        querySelectorAll(selector) {
          if (selector === "button") {
            return [
              { innerText: "上传人物", textContent: "上传人物", getAttribute: () => "" },
              { innerText: "上传商品", textContent: "上传商品", getAttribute: () => "" },
              { innerText: "立即生成", textContent: "立即生成", getAttribute: () => "" }
            ];
          }
          if (selector === "img") {
            return [
              { currentSrc: "https://hifly.cc/rec_1_w6A56STL.png", src: "", getAttribute: () => "" },
              { currentSrc: "https://hifly.cc/pd1.jpg", src: "", getAttribute: () => "" }
            ];
          }
          return [];
        }
      });
    }
  };
  const adapter = new HiflyHandsOnProductPage({}, {
    batch: { defaultTimeoutMs: 10 },
    hiflyUi: { modalConfirmText: "确认" }
  }, { info() {} });
  adapter.dialogLocator = () => dialog;

  assert.equal(await adapter.hasGeneratedImageReady(), false);
});

test("clickModalConfirm prefers the visible confirm button by text", async () => {
  const actions = [];
  const dialog = {
    async waitFor(options) {
      actions.push(`dialog-wait:${options.state}:${options.timeout}`);
    },
    getByRole(role, options) {
      actions.push(`${role}:${options.name}`);
      return {
        last() {
          return {
            async isVisible() {
              actions.push("confirm-visible");
              return true;
            },
            async boundingBox() {
              actions.push("confirm-box");
              return { x: 700, y: 450, width: 160, height: 48 };
            },
            async click(options) {
              actions.push(`confirm-click:${options.timeout}`);
            }
          };
        }
      };
    },
    async isVisible() {
      actions.push("dialog-hidden-after-click");
      return false;
    }
  };
  const adapter = new HiflyHandsOnProductPage({
    async waitForTimeout(ms) {
      actions.push(`wait:${ms}`);
    },
    mouse: {
      async click(x, y) {
        actions.push(`mouse:${x}:${y}`);
      }
    },
    locator(selector) {
      actions.push(`mask:${selector}`);
      return {
        last() {
          return {
            async waitFor(options) {
              actions.push(`mask-wait:${options.state}:${options.timeout}`);
            }
          };
        }
      };
    }
  }, {
    batch: { defaultTimeoutMs: 10, generationTimeoutMs: 10000 },
    behavior: { postConfirmWaitMs: 25 },
    hiflyUi: { modalConfirmText: "确认" }
  }, { info() {} });
  adapter.dialogLocator = () => dialog;
  let visibleChecks = 0;
  dialog.isVisible = async () => {
    visibleChecks += 1;
    actions.push(`dialog-visible:${visibleChecks}`);
    return visibleChecks === 1;
  };

  await adapter.clickModalConfirm(12345);

  assert.deepEqual(actions, [
    "dialog-wait:visible:12345",
    "button:/确\\s*认/",
    "confirm-visible",
    "confirm-box",
    "confirm-click:12345",
    "wait:300",
    "dialog-visible:1",
    "mouse:780:474",
    "wait:800",
    "dialog-visible:2",
    "dialog-wait:hidden:12345",
    "mask:.ant-modal-mask",
    "mask-wait:hidden:12345",
    "wait:25"
  ]);
});

test("clickModalConfirm falls back to the modal footer confirm button", async () => {
  const actions = [];
  const footerButton = {
    async isVisible() {
      actions.push("footer-visible");
      return true;
    },
    async boundingBox() {
      actions.push("footer-box");
      return { x: 790, y: 458, width: 96, height: 36 };
    },
    async click(options) {
      actions.push(`footer-click:${options.timeout}`);
    }
  };
  let visibleChecks = 0;
  const dialog = {
    async waitFor(options) {
      actions.push(`dialog-wait:${options.state}:${options.timeout}`);
    },
    locator(selector) {
      actions.push(`dialog-locator:${selector}`);
      return {
        filter(options) {
          actions.push(`dialog-filter:${options.hasText}`);
          return {
            last() {
              return footerButton;
            }
          };
        }
      };
    },
    async isVisible() {
      visibleChecks += 1;
      actions.push(`dialog-visible:${visibleChecks}`);
      return visibleChecks === 1;
    }
  };
  const adapter = new HiflyHandsOnProductPage({
    async waitForTimeout(ms) {
      actions.push(`wait:${ms}`);
    },
    mouse: {
      async click(x, y) {
        actions.push(`mouse:${x}:${y}`);
      }
    },
    locator(selector) {
      actions.push(`mask:${selector}`);
      return {
        last() {
          return {
            async waitFor(options) {
              actions.push(`mask-wait:${options.state}:${options.timeout}`);
            }
          };
        }
      };
    }
  }, {
    batch: { defaultTimeoutMs: 10, generationTimeoutMs: 10000 },
    behavior: { postConfirmWaitMs: 0 },
    hiflyUi: { modalConfirmText: "确认" }
  }, { info() {} });
  adapter.dialogLocator = () => dialog;
  adapter.clickModalConfirmButton = async () => {
    actions.push("button-click-missed");
    return false;
  };

  await adapter.clickModalConfirm(12345);

  assert.deepEqual(actions, [
    "dialog-wait:visible:12345",
    "button-click-missed",
    "dialog-locator:.ant-modal-footer button, button",
    "dialog-filter:/确\\s*认/",
    "footer-visible",
    "footer-box",
    "footer-click:12345",
    "wait:300",
    "dialog-visible:1",
    "mouse:838:476",
    "wait:800",
    "dialog-visible:2",
    "dialog-wait:hidden:12345",
    "mask:.ant-modal-mask",
    "mask-wait:hidden:12345",
    "wait:0"
  ]);
});

test("clickModalConfirm final fallback stays inside the modal bounds", async () => {
  const actions = [];
  const dialog = {
    async waitFor(options) {
      actions.push(`dialog-wait:${options.state}:${options.timeout}`);
    },
    locator(selector) {
      actions.push(`dialog-locator:${selector}`);
      return {
        filter(options) {
          actions.push(`dialog-filter:${options.hasText}`);
          return {
            last() {
              return {
                async isVisible() {
                  actions.push("footer-hidden");
                  return false;
                }
              };
            }
          };
        }
      };
    },
    async boundingBox() {
      actions.push("dialog-box");
      return { x: 290, y: 106, width: 616, height: 406 };
    },
    async isVisible() {
      actions.push("dialog-hidden-after-fallback");
      return false;
    }
  };
  const adapter = new HiflyHandsOnProductPage({
    async waitForTimeout(ms) {
      actions.push(`wait:${ms}`);
    },
    mouse: {
      async click(x, y) {
        actions.push(`mouse:${x}:${y}`);
      }
    },
    locator(selector) {
      actions.push(`mask:${selector}`);
      return {
        last() {
          return {
            async waitFor(options) {
              actions.push(`mask-wait:${options.state}:${options.timeout}`);
            }
          };
        }
      };
    }
  }, {
    batch: { defaultTimeoutMs: 10, generationTimeoutMs: 10000 },
    behavior: { postConfirmWaitMs: 0 },
    hiflyUi: { modalConfirmText: "确认" }
  }, { info() {} });
  adapter.dialogLocator = () => dialog;
  adapter.clickModalConfirmButton = async () => {
    actions.push("button-click-missed");
    return false;
  };

  await adapter.clickModalConfirm(12345);

  assert.deepEqual(actions, [
    "dialog-wait:visible:12345",
    "button-click-missed",
    "dialog-locator:.ant-modal-footer button, button",
    "dialog-filter:/确\\s*认/",
    "footer-hidden",
    "dialog-box",
    "mouse:820:469",
    "wait:800",
    "dialog-hidden-after-fallback",
    "dialog-wait:hidden:12345",
    "mask:.ant-modal-mask",
    "mask-wait:hidden:12345",
    "wait:0"
  ]);
});

test("dialogLocator only targets the visible hands-on modal", () => {
  const selectors = [];
  const filtered = {
    last() {
      return "visible-dialog";
    }
  };
  const adapter = new HiflyHandsOnProductPage({
    locator(selector) {
      selectors.push(selector);
      return {
        filter(options) {
          assert.equal(options.hasText, "手持商品图");
          return filtered;
        }
      };
    }
  }, {}, { info() {} });

  assert.equal(adapter.dialogLocator(), "visible-dialog");
  assert.deepEqual(selectors, [".ant-modal:visible, [role='dialog']:visible"]);
});

test("resetExistingUpload clicks the outer delete control even when upload button is visible", async () => {
  const actions = [];
  const adapter = new HiflyHandsOnProductPage({
    locator(selector) {
      assert.equal(selector, ".controls-panel");
      return {
        locator(xpath) {
          assert.match(xpath, /手持商品图/);
          return {
            locator() {
              return {
                filter() {
                  return {
                    first() {
                      return {
                        async isVisible() {
                          actions.push("delete-hidden");
                          return false;
                        }
                      };
                    }
                  };
                }
              };
            },
            async boundingBox() {
              actions.push("card-box");
              return { x: 100, y: 200, width: 540, height: 220 };
            }
          };
        }
      };
    },
    mouse: {
      async click(x, y) {
        actions.push(`mouse:${x}:${y}`);
      }
    },
    async waitForTimeout(ms) {
      actions.push(`wait:${ms}`);
    }
  }, {
    batch: { defaultTimeoutMs: 10 },
    behavior: { resetUploadBeforeEachProduct: true },
    hiflyUi: { uploadLabel: "上传人物+产品图" }
  }, { info() {} });
  adapter.uploadButton = () => ({
    async isVisible() {
      actions.push("upload-visible");
      return true;
    },
    async waitFor() {
      actions.push("upload-restored");
    }
  });
  adapter.closeHandsOnModalIfOpen = async () => actions.push("close-modal");
  adapter.reloadHandsOnProductMode = async () => actions.push("reload-goods");

  await adapter.resetExistingUpload();

  assert.deepEqual(actions, [
    "close-modal",
    "card-box",
    "delete-hidden",
    "mouse:558:296",
    "wait:500",
    "reload-goods",
    "upload-restored"
  ]);
});
