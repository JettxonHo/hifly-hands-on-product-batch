import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

import { buildApp } from "../src/server/app.js";
import { createBatchStore } from "../src/core/batch-store.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { startServer } from "../src/server/start.js";

test("serves the workbench without inline assets blocked by CSP", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-gui-static-"));
  const app = await buildApp({ root, executor: createFakeExecutor() });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  const response = await app.inject({ method: "GET", url: "/", headers: { host: "127.0.0.1:4317" } });

  assert.equal(response.statusCode, 200);
  assert.match(response.body, /飞影批量工作台/);
  assert.match(response.body, /批量录入/);
  assert.match(response.body, /同时录制抓包产物（不切换批量后端）/);
  assert.doesNotMatch(response.body, /<script(?![^>]+src=)/i);
  assert.doesNotMatch(response.body, /<style/i);
  assert.equal(
    response.headers["content-security-policy"],
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'"
  );
});

test("single-product GUI path creates a pending batch", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-gui-smoke-"));
  const imagePath = path.join(root, "SKU-GUI.png");
  let server = null;
  let browser = null;
  t.after(async () => {
    await browser?.close();
    await server?.close();
    await rm(root, { recursive: true, force: true });
  });

  await writeFile(
    imagePath,
    await sharp({ create: { width: 4, height: 4, channels: 3, background: "white" } }).png().toBuffer()
  );

  try {
    server = await startServer({
      root,
      executor: createFakeExecutor(),
      openBrowser: async () => {},
      handleSignals: false
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("sandbox disallows local TCP listening");
      return;
    }
    throw error;
  }

  try {
    browser = await chromium.launch();
  } catch (error) {
    if (error?.message?.includes("Executable doesn't exist") || error?.message?.includes("browserType.launch")) {
      t.skip("Playwright browser is unavailable in this environment");
      return;
    }
    throw error;
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(server.url);
  await assertVisible(page.getByRole("heading", { name: "飞影批量工作台" }));
  await page.getByRole("tab", { name: "新建商品" }).click();
  const singleForm = page.locator("#singleForm");
  await singleForm.getByLabel("SKU", { exact: true }).fill("SKU-GUI");
  await singleForm.getByLabel("产品名称").fill("云感保湿乳");
  await singleForm.getByLabel("核心卖点").fill("轻薄好吸收，通勤补水");
  await singleForm.getByLabel("品类").fill("beauty");
  await singleForm.getByLabel("商品图", { exact: true }).setInputFiles(imagePath);
  await page.getByRole("button", { name: "加入待执行" }).click();

  await assertVisible(page.getByRole("heading", { name: "待执行任务" }));
  await assertVisible(page.getByText("云感保湿乳"));
  await assertVisible(page.getByText("按当前批次全部商品执行：1 个商品生成 1 条视频。"));
  await assertVisible(page.getByText("抓包工作流"));
  await assertVisible(page.getByText("本批次未开启抓包。"));
  await page.getByRole("button", { name: "开始生成" }).click();
  await assertVisible(page.getByRole("heading", { name: "确认开始生成" }));
  await assertVisible(page.getByText(/一商品一条片.*1 条视频/));
  await page.getByRole("button", { name: "确认生成" }).click();
  await assertVisible(page.getByRole("heading", { name: "运行记录" }));
});

test("GUI separates the batch backend from capture HTTP live mode", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-gui-runtime-modes-"));
  let server = null;
  let browser = null;
  t.after(async () => {
    await browser?.close();
    await server?.close();
    await rm(root, { recursive: true, force: true });
  });

  try {
    server = await startServer({
      root,
      executor: createFakeExecutor(),
      openBrowser: async () => {},
      handleSignals: false
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("sandbox disallows local TCP listening");
      return;
    }
    throw error;
  }

  try {
    browser = await chromium.launch();
  } catch (error) {
    if (error?.message?.includes("Executable doesn't exist") || error?.message?.includes("browserType.launch")) {
      t.skip("Playwright browser is unavailable in this environment");
      return;
    }
    throw error;
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(server.url);
  await assertVisible(page.getByText("批量生成：Playwright"));
  await assertVisible(page.getByText("抓包 HTTP：单条联调"));
});

test("bulk-entry GUI path creates one batch from multiple product rows", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-gui-bulk-"));
  const imageOne = path.join(root, "bulk-one.png");
  const imageTwo = path.join(root, "bulk-two.png");
  let server = null;
  let browser = null;
  t.after(async () => {
    await browser?.close();
    await server?.close();
    await rm(root, { recursive: true, force: true });
  });

  await writeFile(
    imageOne,
    await sharp({ create: { width: 4, height: 4, channels: 3, background: "white" } }).png().toBuffer()
  );
  await writeFile(
    imageTwo,
    await sharp({ create: { width: 4, height: 4, channels: 3, background: "green" } }).png().toBuffer()
  );

  try {
    server = await startServer({
      root,
      executor: createFakeExecutor(),
      openBrowser: async () => {},
      handleSignals: false
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("sandbox disallows local TCP listening");
      return;
    }
    throw error;
  }

  try {
    browser = await chromium.launch();
  } catch (error) {
    if (error?.message?.includes("Executable doesn't exist") || error?.message?.includes("browserType.launch")) {
      t.skip("Playwright browser is unavailable in this environment");
      return;
    }
    throw error;
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(server.url);
  await page.getByRole("tab", { name: "批量录入" }).click();
  await page.getByRole("button", { name: "新增一行" }).click();

  const first = page.locator(".bulk-row").nth(0);
  await first.locator("[name='bulkSku']").fill("BULK-1");
  await first.locator("[name='bulkProductName']").fill("云感保湿乳");
  await first.locator("[name='bulkCategory']").fill("beauty");
  await first.locator("[name='bulkSellingPoints']").fill("轻薄补水");
  await first.locator("[name='bulkProductImage']").setInputFiles(imageOne);

  const second = page.locator(".bulk-row").nth(1);
  await second.locator("[name='bulkSku']").fill("BULK-2");
  await second.locator("[name='bulkProductName']").fill("山野小青菜");
  await second.locator("[name='bulkCategory']").fill("fresh_food");
  await second.locator("[name='bulkSellingPoints']").fill("新鲜脆嫩");
  await second.locator("[name='bulkProductImage']").setInputFiles(imageTwo);

  await page.getByRole("button", { name: "生成批次" }).click();

  await assertVisible(page.getByRole("heading", { name: "待执行任务" }));
  await assertVisible(page.getByText("云感保湿乳"));
  await assertVisible(page.getByText("山野小青菜"));
  await assertVisible(page.getByText("按当前批次全部商品执行：2 个商品生成 2 条视频。"));
});

test("table import opens the new batch at the top of the queue", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-gui-import-"));
  const imagePath = path.join(root, "IMPORT-1.png");
  const tablePath = path.join(root, "products.csv");
  let server = null;
  let browser = null;
  t.after(async () => {
    await browser?.close();
    await server?.close();
    await rm(root, { recursive: true, force: true });
  });

  await writeFile(
    imagePath,
    await sharp({ create: { width: 4, height: 4, channels: 3, background: "blue" } }).png().toBuffer()
  );
  await writeFile(
    tablePath,
    "sku,product_name,selling_points,category,image_path\nIMPORT-1,导入测试商品,轻便好用,demo,IMPORT-1.png\n"
  );
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "aaa-old-pending",
    status: "pending",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    uploads: [],
    artifacts: [],
    items: [{
      task_id: "task-old",
      sku: "OLD",
      product_name: "历史待执行商品",
      selling_points: "",
      category: "demo",
      status: "pending"
    }]
  });

  try {
    server = await startServer({
      root,
      executor: createFakeExecutor(),
      openBrowser: async () => {},
      handleSignals: false
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("sandbox disallows local TCP listening");
      return;
    }
    throw error;
  }

  try {
    browser = await chromium.launch();
  } catch (error) {
    if (error?.message?.includes("Executable doesn't exist") || error?.message?.includes("browserType.launch")) {
      t.skip("Playwright browser is unavailable in this environment");
      return;
    }
    throw error;
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(server.url);
  await page.getByRole("tab", { name: "批量导入" }).click();
  await page.locator("#tableFile").setInputFiles(tablePath);
  await page.locator("#imageFiles").setInputFiles(imagePath);
  await page.getByRole("button", { name: "导入批次" }).click();

  await assertVisible(page.getByRole("heading", { name: "待执行任务" }));
  await assertVisible(page.getByText("导入测试商品"));
  await assertVisible(page.getByText("按当前批次全部商品执行：1 个商品生成 1 条视频。"));
  const firstRow = page.locator("#batchTable tr").first();
  await firstRow.waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(await firstRow.evaluate((row) => row.classList.contains("selected")), true);
  assert.equal(await firstRow.getByText("aaa-old-pending").count(), 0);
});

test("capture GUI exposes a no-network dry-run action for redacted batches", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-gui-capture-dry-run-"));
  let server = null;
  let browser = null;
  t.after(async () => {
    await browser?.close();
    await server?.close();
    await rm(root, { recursive: true, force: true });
  });

  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-capture-dry-run",
    status: "completed",
    uploads: [],
    artifacts: [],
    items: [],
    capture: {
      enabled: true,
      status: "redacted",
      manifest_path: "batches/batch-capture-dry-run/capture/manifest.json"
    }
  });

  try {
    server = await startServer({
      root,
      executor: createFakeExecutor(),
      openBrowser: async () => {},
      handleSignals: false
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("sandbox disallows local TCP listening");
      return;
    }
    throw error;
  }

  try {
    browser = await chromium.launch();
  } catch (error) {
    if (error?.message?.includes("Executable doesn't exist") || error?.message?.includes("browserType.launch")) {
      t.skip("Playwright browser is unavailable in this environment");
      return;
    }
    throw error;
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(server.url);
  await page.getByRole("tab", { name: "待执行任务" }).click();
  await assertVisible(page.getByRole("button", { name: "真实请求预演" }));
  await assertVisible(page.getByText("仅构造请求计划，不访问飞影、不消耗积分"));
});

test("capture GUI exposes fake small-batch queue preview status and action", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-gui-capture-queue-"));
  let server = null;
  let browser = null;
  t.after(async () => {
    await browser?.close();
    await server?.close();
    await rm(root, { recursive: true, force: true });
  });

  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-capture-queue",
    status: "failed",
    uploads: [],
    artifacts: [],
    items: [
      { task_id: "task-1", sku: "SKU-1", product_name: "Queue One", status: "completed", output_path: "artifacts/one.mp4" },
      { task_id: "task-2", sku: "SKU-2", product_name: "Queue Two", status: "failed_remote" }
    ],
    capture: {
      enabled: true,
      status: "dry_run_passed",
      manifest_path: "batches/batch-capture-queue/capture/manifest.json",
      queue: {
        mode: "fake",
        status: "failed",
        total: 2,
        completed: 1,
        failed: 1,
        current_task_id: "task-2",
        last_error: { code: "CAPTURE_HTTP_QUEUE_FAILED", message: "private path /Users/ketchup" }
      }
    }
  });

  try {
    server = await startServer({
      root,
      executor: createFakeExecutor(),
      openBrowser: async () => {},
      handleSignals: false
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("sandbox disallows local TCP listening");
      return;
    }
    throw error;
  }

  try {
    browser = await chromium.launch();
  } catch (error) {
    if (error?.message?.includes("Executable doesn't exist") || error?.message?.includes("browserType.launch")) {
      t.skip("Playwright browser is unavailable in this environment");
      return;
    }
    throw error;
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(server.url);
  await page.getByRole("tab", { name: "待执行任务" }).click();
  await assertVisible(page.getByText("小批量预演：失败（1/2）"));
  await assertVisible(page.getByText("小批量错误：CAPTURE_HTTP_QUEUE_FAILED"));
  await assertVisible(page.getByText("小批量预演只使用本地 mock，不访问飞影、不消耗积分"));
  const button = page.getByRole("button", { name: "抓包 HTTP 小批量预演" });
  await assertVisible(button);
  assert.equal(await button.isDisabled(), false);
});

test("capture GUI enables real-live action only for one-item dry-run batches", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-gui-real-live-disabled-"));
  let server = null;
  let browser = null;
  t.after(async () => {
    await browser?.close();
    await server?.close();
    await rm(root, { recursive: true, force: true });
  });

  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-real-live-disabled",
    status: "completed",
    uploads: [],
    artifacts: [],
    items: [{ task_id: "task-1", sku: "SKU-1", product_name: "Live One", status: "completed" }],
    capture: {
      enabled: true,
      status: "dry_run_passed",
      manifest_path: "batches/batch-real-live-disabled/capture/manifest.json",
      dry_run_summary: { executed_step_count: 7, request_plan: [] }
    }
  });

  try {
    server = await startServer({
      root,
      executor: createFakeExecutor(),
      openBrowser: async () => {},
      handleSignals: false
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("sandbox disallows local TCP listening");
      return;
    }
    throw error;
  }

  try {
    browser = await chromium.launch();
  } catch (error) {
    if (error?.message?.includes("Executable doesn't exist") || error?.message?.includes("browserType.launch")) {
      t.skip("Playwright browser is unavailable in this environment");
      return;
    }
    throw error;
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(server.url);
  await page.getByRole("tab", { name: "待执行任务" }).click();
  await assertVisible(page.getByText("状态：真实请求预演通过", { exact: true }));
  await assertVisible(page.getByRole("button", { name: "真实 HTTP 生成（会访问飞影，可能消耗积分）" }));
  assert.equal(await page.getByRole("button", { name: "真实 HTTP 生成（会访问飞影，可能消耗积分）" }).isDisabled(), false);
  await assertVisible(page.getByText("小批量预演只使用本地 mock，不访问飞影、不消耗积分；真实 HTTP 生成只允许单条联调，且可能消耗积分。"));
});

test("capture GUI shows real-live completion evidence without offering a retry action", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-gui-real-live-completed-"));
  let server = null;
  let browser = null;
  t.after(async () => {
    await browser?.close();
    await server?.close();
    await rm(root, { recursive: true, force: true });
  });

  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-real-live-completed",
    status: "completed",
    uploads: [],
    artifacts: [{ artifact_id: "video-1", relative_path: "artifacts/未命名.mp4" }],
    items: [{
      task_id: "task-1",
      sku: "SKU-OK",
      product_name: "Live Done",
      status: "completed",
      output_path: "artifacts/未命名.mp4"
    }],
    capture: {
      enabled: true,
      status: "real_live_completed",
      manifest_path: "batches/batch-real-live-completed/capture/manifest.json",
      live_summary: {
        sku: "SKU-OK",
        remote_id: 640509,
        artifact_path: "artifacts/未命名.mp4",
        completed_at: "2026-07-18T16:54:38.462Z"
      }
    }
  });

  try {
    server = await startServer({
      root,
      executor: createFakeExecutor(),
      openBrowser: async () => {},
      handleSignals: false
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("sandbox disallows local TCP listening");
      return;
    }
    throw error;
  }

  try {
    browser = await chromium.launch();
  } catch (error) {
    if (error?.message?.includes("Executable doesn't exist") || error?.message?.includes("browserType.launch")) {
      t.skip("Playwright browser is unavailable in this environment");
      return;
    }
    throw error;
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(server.url);
  await page.getByRole("tab", { name: "待执行任务" }).click();
  await assertVisible(page.getByText("状态：真实 HTTP 已完成", { exact: true }));
  await assertVisible(page.getByText("真实 HTTP 已完成并下载到本地。"));
  await assertVisible(page.locator("#panel-queue").getByText("飞影作品 ID：640509"));
  await assertVisible(page.locator("#panel-queue").getByText("下载路径：artifacts/未命名.mp4"));
  await assertVisible(page.locator("#panel-queue").getByRole("link", { name: "下载产物" }).first());
  await assertVisible(page.getByText("默认不再重复生成"));
  assert.equal(await page.getByRole("button", { name: "复制路径" }).count(), 2);
  assert.equal(await page.getByRole("button", { name: /重新真实 HTTP 生成/ }).count(), 0);
  await page.getByRole("tab", { name: "运行记录" }).click();
  await assertVisible(page.locator("#panel-records").getByText("抓包 HTTP：已完成"));
  await assertVisible(page.locator("#panel-records").getByText("飞影作品 ID：640509"));
  await assertVisible(page.locator("#panel-records").getByText("下载路径：artifacts/未命名.mp4"));
  await assertVisible(page.locator("#panel-records").getByRole("link", { name: "下载产物" }).first());
});

test("capture GUI exposes a clear retry action for failed real-live batches", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-gui-real-live-failed-"));
  let server = null;
  let browser = null;
  t.after(async () => {
    await browser?.close();
    await server?.close();
    await rm(root, { recursive: true, force: true });
  });

  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-real-live-failed",
    status: "completed",
    uploads: [],
    artifacts: [],
    items: [{ task_id: "task-1", sku: "SKU-FAIL", product_name: "Live Fail", status: "completed" }],
    capture: {
      enabled: true,
      status: "real_live_failed",
      manifest_path: "batches/batch-real-live-failed/capture/manifest.json",
      live_error: {
        code: "CAPTURE_HTTP_ARTIFACT_MISSING",
        message: "Unable to download the generated artifact."
      }
    }
  });

  try {
    server = await startServer({
      root,
      executor: createFakeExecutor(),
      openBrowser: async () => {},
      handleSignals: false
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("sandbox disallows local TCP listening");
      return;
    }
    throw error;
  }

  try {
    browser = await chromium.launch();
  } catch (error) {
    if (error?.message?.includes("Executable doesn't exist") || error?.message?.includes("browserType.launch")) {
      t.skip("Playwright browser is unavailable in this environment");
      return;
    }
    throw error;
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(server.url);
  await page.getByRole("tab", { name: "待执行任务" }).click();
  await assertVisible(page.getByText("真实 HTTP 失败"));
  await assertVisible(page.locator("#panel-queue").getByText("错误码：CAPTURE_HTTP_ARTIFACT_MISSING"));
  const retry = page.getByRole("button", { name: "重新真实 HTTP 生成（会访问飞影，可能消耗积分）" });
  await assertVisible(retry);
  assert.equal(await retry.isDisabled(), false);
  await page.getByRole("tab", { name: "运行记录" }).click();
  await assertVisible(page.locator("#panel-records").getByText("抓包 HTTP：失败，可到待执行任务中重新真实 HTTP 生成"));
  await assertVisible(page.locator("#panel-records").getByText("错误码：CAPTURE_HTTP_ARTIFACT_MISSING"));
});

async function assertVisible(locator) {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(await locator.isVisible(), true);
}

test("real-batch GUI control is hidden when the runtime disables it", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-gui-real-batch-off-"));
  let server = null;
  let browser = null;
  t.after(async () => {
    await browser?.close();
    await server?.close();
    await rm(root, { recursive: true, force: true });
  });

  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-gui-real-off",
    status: "completed",
    uploads: [],
    artifacts: [],
    items: [{ task_id: "task-1", sku: "SKU-1", product_name: "Real One", status: "pending" }],
    capture: {
      enabled: true,
      status: "dry_run_passed",
      manifest_path: "batches/batch-gui-real-off/capture/manifest.json"
    }
  });

  try {
    server = await startServer({
      root,
      executor: createFakeExecutor(),
      openBrowser: async () => {},
      handleSignals: false
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("sandbox disallows local TCP listening");
      return;
    }
    throw error;
  }

  try {
    browser = await chromium.launch();
  } catch (error) {
    if (error?.message?.includes("Executable doesn't exist") || error?.message?.includes("browserType.launch")) {
      t.skip("Playwright browser is unavailable in this environment");
      return;
    }
    throw error;
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(server.url);
  await page.getByRole("tab", { name: "待执行任务" }).click();
  await assertVisible(page.getByText("抓包工作流"));
  assert.equal(await page.getByRole("button", { name: /真实 HTTP 小批量生成/ }).count(), 0);
});

test("real-batch GUI control shows point-risk copy when the runtime enables it", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-gui-real-batch-on-"));
  let server = null;
  let browser = null;
  t.after(async () => {
    await browser?.close();
    await server?.close();
    await rm(root, { recursive: true, force: true });
  });

  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-gui-real-on",
    status: "completed",
    uploads: [],
    artifacts: [],
    items: [{ task_id: "task-1", sku: "SKU-1", product_name: "Real One", status: "pending" }],
    capture: {
      enabled: true,
      status: "dry_run_passed",
      manifest_path: "batches/batch-gui-real-on/capture/manifest.json"
    }
  });

  try {
    server = await startServer({
      root,
      executor: createFakeExecutor(),
      generationConfig: { rpa: { realLive: { batch: { enabled: true, maxItems: 3 } } } },
      openBrowser: async () => {},
      handleSignals: false
    });
  } catch (error) {
    if (error?.code === "EPERM") {
      t.skip("sandbox disallows local TCP listening");
      return;
    }
    throw error;
  }

  try {
    browser = await chromium.launch();
  } catch (error) {
    if (error?.message?.includes("Executable doesn't exist") || error?.message?.includes("browserType.launch")) {
      t.skip("Playwright browser is unavailable in this environment");
      return;
    }
    throw error;
  }

  const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  await page.goto(server.url);
  await page.getByRole("tab", { name: "待执行任务" }).click();
  await assertVisible(page.getByText("抓包工作流"));
  const button = page.getByRole("button", { name: /真实 HTTP 小批量生成/ });
  await assertVisible(button);
  await assertVisible(page.getByText("真实 HTTP 小批量会访问飞影，可能消耗积分"));
});
