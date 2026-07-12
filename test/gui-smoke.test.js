import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

import { buildApp } from "../src/server/app.js";
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
  await page.getByLabel("SKU").fill("SKU-GUI");
  await page.getByLabel("产品名称").fill("云感保湿乳");
  await page.getByLabel("核心卖点").fill("轻薄好吸收，通勤补水");
  await page.getByLabel("品类").fill("beauty");
  await page.getByLabel("商品图", { exact: true }).setInputFiles(imagePath);
  await page.getByRole("button", { name: "加入待执行" }).click();

  await assertVisible(page.getByRole("heading", { name: "待执行任务" }));
  await assertVisible(page.getByText("云感保湿乳"));
  await page.getByRole("button", { name: "开始生成" }).click();
  await assertVisible(page.getByRole("heading", { name: "确认开始生成" }));
  await page.getByRole("button", { name: "确认生成" }).click();
  await assertVisible(page.getByRole("heading", { name: "运行记录" }));
});

async function assertVisible(locator) {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  assert.equal(await locator.isVisible(), true);
}
