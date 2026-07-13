import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createBatchStore } from "../src/core/batch-store.js";
import { acquireExecutionLock } from "../src/core/execution-lock.js";
import { createExecutionSnapshot } from "../src/core/execution-snapshot.js";
import { runBatch } from "../src/core/batch-runner.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { HiflyHandsOnProductPage } from "../src/hifly-page.js";

async function fixtureRun({ executor, initialStatus = "confirmed" } = {}) {
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
    image_path: image
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
  adapter.hasGeneratedImageReady = async () => calls.push("ready") && true;
  adapter.resetGeneratedHandsOnImage = async () => calls.push("reset-stale");
  adapter.selectRecommendedPerson = async () => calls.push("select-person");
  adapter.uploadModalFile = async (label, filePath) => calls.push(`upload:${label}:${filePath}`);
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
    "select-person",
    "upload:上传商品:/tmp/current-product.png",
    "capture:modal-ready",
    "generate",
    "capture:modal-after-generate",
    "confirm"
  ]);
});

test("resetGeneratedHandsOnImage retries by coordinates when edit click does not reveal upload controls", async () => {
  const actions = [];
  let attempts = 0;
  const uploadButton = {
    async waitFor() {
      attempts += 1;
      if (attempts === 1) throw new Error("upload controls still hidden");
      actions.push("upload-visible");
    }
  };
  const editButton = {
    async click() {
      actions.push("edit-text-click");
    }
  };
  const dialog = {
    getByText() {
      return {
        first: () => ({
          async isVisible() {
            actions.push("edit-text-visible");
            return true;
          },
          async click() {
            return editButton.click();
          }
        })
      };
    },
    getByRole(_role, options) {
      const name = String(options?.name || "");
      return name.includes("上传商品") ? { first: () => uploadButton } : { first: () => editButton };
    },
    async waitFor() {
      actions.push("dialog-visible");
    },
    async boundingBox() {
      actions.push("dialog-box");
      return { x: 100, y: 200, width: 500, height: 300 };
    }
  };
  const page = {
    mouse: {
      async click(x, y) {
        actions.push(`mouse:${x}:${y}`);
      }
    },
    async waitForTimeout(ms) {
      actions.push(`wait:${ms}`);
    }
  };
  const adapter = new HiflyHandsOnProductPage(page, {
    batch: { defaultTimeoutMs: 10 },
    hiflyUi: { uploadProductText: "上传商品" }
  }, { info() {} });
  adapter.dialogLocator = () => dialog;

  await adapter.resetGeneratedHandsOnImage();

  assert.deepEqual(actions, [
    "edit-text-visible",
    "edit-text-click",
    "dialog-visible",
    "dialog-box",
    "mouse:310:457",
    "upload-visible",
    "wait:500"
  ]);
});

test("uploadModalFile accepts an already uploaded modal that is ready to generate", async () => {
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
    }
  }, {
    batch: { defaultTimeoutMs: 10 },
    hiflyUi: { uploadProductText: "上传商品", modalSubmitText: "立即生成" }
  }, { info() {} });
  adapter.isHandsOnModalReadyForGenerate = async () => {
    actions.push("generate-ready");
    return true;
  };

  await adapter.uploadModalFile("上传商品", "/tmp/product.png");

  assert.deepEqual(actions, [
    "button:/上传商品/",
    "upload-hidden",
    "generate-ready"
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
