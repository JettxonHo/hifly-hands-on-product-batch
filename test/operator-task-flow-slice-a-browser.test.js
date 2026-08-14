import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chromium } from "playwright";

import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { createMemoryIdentityRepository } from "../src/identity/memory-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
import { buildApp } from "../src/server/app.js";
import { findAvailablePort } from "../src/server/start.js";
import { ADMIN_EMAIL, ADMIN_TEMP_PASSWORD } from "./helpers/identity-world.js";

async function startEnterpriseBrowser(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-operator-task-flow-slice-a-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(57900);
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const identityRepository = createMemoryIdentityRepository();
  await seedInitialAdmin(identityRepository, {
    organizationId: "org_operator_task_flow",
    organizationName: "运营任务流团队",
    adminEmail: ADMIN_EMAIL,
    adminDisplayName: "任务流管理员",
    adminTempPassword: ADMIN_TEMP_PASSWORD
  });
  const app = await buildApp({
    root,
    executor: createFakeExecutor(),
    identity: {
      enabled: true,
      repository: identityRepository,
      trustedHosts: [host],
      trustedOrigins: [origin],
      cookieSecure: false,
      seed: { enabled: false }
    },
    projectContent: {
      enabled: true,
      repository: createMemoryProjectContentRepository(),
      assetReferencePort: { async bindAvailableVersion() {} }
    }
  });
  try {
    await app.listen({ host: "127.0.0.1", port });
  } catch (error) {
    await app.close();
    if (error.code === "EPERM") return t.skip("sandbox disallows local TCP listening");
    throw error;
  }
  t.after(() => app.close());

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.IDENTITY_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    });
  } catch (error) {
    if (error.message.includes("Executable doesn't exist") || error.message.includes("browserType.launch")) {
      return t.skip("Playwright browser is unavailable");
    }
    throw error;
  }
  t.after(() => browser.close());
  const page = await browser.newPage();
  return { page, origin };
}

async function authenticate(page, origin) {
  await page.goto(`${origin}/login.html`);
  await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("heading", { name: "设置新密码" }).waitFor();
  await page.locator("#newPassword").fill("Operator-Task-Flow-Password-9!");
  await page.getByRole("button", { name: "保存并进入工作台" }).click();
  await page.waitForURL(`${origin}/projects.html`);
}

test("enterprise entry routes root to Projects and keeps explicit index as legacy fallback", async (t) => {
  const setup = await startEnterpriseBrowser(t);
  if (!setup) return;
  const { page, origin } = setup;
  await authenticate(page, origin);

  await page.route(`${origin}/api/runtime`, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "RUNTIME_UNAVAILABLE" }) }));
  await page.goto(`${origin}/`);
  await page.waitForLoadState("domcontentloaded");
  assert.equal(new URL(page.url()).pathname, "/");
  assert.equal(await page.locator("main").isVisible(), true);
  await page.unroute(`${origin}/api/runtime`);

  await page.route(`${origin}/api/runtime`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ projectContentEnabled: false }) }));
  await page.goto(`${origin}/`);
  await page.waitForLoadState("domcontentloaded");
  assert.equal(new URL(page.url()).pathname, "/");
  assert.equal(await page.locator("main").isVisible(), true);
  await page.unroute(`${origin}/api/runtime`);

  await page.route(`${origin}/api/auth/me`, (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "AUTH_CONTEXT_UNAVAILABLE" }) }));
  await page.goto(`${origin}/`);
  await page.waitForLoadState("domcontentloaded");
  assert.equal(new URL(page.url()).pathname, "/");
  assert.equal(await page.locator("main").isVisible(), true);
  await page.unroute(`${origin}/api/auth/me`);

  await page.goto(`${origin}/`);
  await page.waitForURL(`${origin}/projects.html`);
  assert.equal(await page.locator("body").getAttribute("data-shell-page"), "projects");

  await page.goto(`${origin}/index.html`);
  await page.getByText("企业流程请进入项目", { exact: true }).waitFor();
  assert.match(page.url(), /\/index\.html$/);
  await page.getByRole("link", { name: "进入项目" }).click();
  await page.waitForURL(`${origin}/projects.html`);
});

test("Projects and Project present one responsive operator task path", async (t) => {
  const setup = await startEnterpriseBrowser(t);
  if (!setup) return;
  const { page, origin } = setup;

  await page.goto(`${origin}/login.html`);
  assert.equal(await page.locator("body").getAttribute("class"), "operator-task-page operator-auth-page");
  await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("heading", { name: "设置新密码" }).waitFor();
  await page.locator("#newPassword").fill("Operator-Task-Flow-Password-9!");
  await page.getByRole("button", { name: "保存并进入工作台" }).click();
  await page.waitForURL(`${origin}/projects.html`);

  assert.equal(await page.locator("body").getAttribute("class"), "operator-task-page");
  await page.getByRole("region", { name: "当前任务" }).getByRole("heading", { name: "创建第一个项目" }).waitFor();
  assert.equal(await page.locator('[data-recommended-action="true"]:visible').count(), 1);

  const createProject = page.getByRole("button", { name: "创建项目", exact: true }).first();
  await createProject.click();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("name")), "name");
  await page.getByRole("button", { name: "关闭创建项目" }).click();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "openProjectDialog");

  await createProject.click();
  await page.getByLabel("项目名称").fill("秋季新品运营项目");
  await page.getByRole("dialog", { name: "创建项目" }).getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByRole("link", { name: "继续项目" }).waitFor();
  if (process.env.SLICE_A_SCREENSHOTS_DIR) {
    await mkdir(process.env.SLICE_A_SCREENSHOTS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.SLICE_A_SCREENSHOTS_DIR, "projects-1440.png"), fullPage: true });
  }
  await page.getByRole("link", { name: "继续项目" }).click();
  await page.waitForURL(/\/project\.html\?id=/);

  const taskSummary = page.getByRole("region", { name: "当前任务" });
  await taskSummary.getByRole("heading", { name: "创建第一个商品" }).waitFor();
  assert.equal(await page.locator('[data-recommended-action="true"]:visible').count(), 1);

  await page.getByRole("button", { name: "创建商品" }).click();
  await page.getByRole("dialog", { name: "创建商品" }).getByLabel("商品名称", { exact: true }).fill("适合秋冬办公室使用的超长名称云朵恒温保温杯");
  await page.getByRole("dialog", { name: "创建商品" }).getByRole("button", { name: "创建商品", exact: true }).click();
  await taskSummary.getByText("需要处理", { exact: true }).waitFor();

  await page.locator('textarea[name="product_description"]').fill("轻盈便携");
  await taskSummary.getByText("有未保存修改", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-recommended-action="true"]:visible').count(), 1);
  assert.equal(await page.locator('[data-recommended-action="true"]:visible').textContent(), "保存草稿");

  await page.getByRole("button", { name: "保存草稿" }).click();
  await taskSummary.getByText("已保存", { exact: true }).waitFor();
  assert.match(await page.locator(".product-list [aria-current=true] .product-meta").textContent(), /草稿 · v2/);
  await page.getByText("素材功能未启用，暂不能选择商品图片。", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-recommended-action="true"]:visible').count(), 0);
  await page.getByRole("button", { name: "设为 Ready" }).click();
  await page.getByText(/暂不能 Ready：/).waitFor();
  assert.match(await taskSummary.textContent(), /确认至少一条卖点/);
  assert.equal(await page.locator('[data-recommended-action="true"]:visible').count(), 0);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await taskSummary.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.activeElement?.blur());
    await page.waitForTimeout(200);
    assert.equal(await taskSummary.isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    if (process.env.SLICE_A_SCREENSHOTS_DIR) {
      await mkdir(process.env.SLICE_A_SCREENSHOTS_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.SLICE_A_SCREENSHOTS_DIR, `project-${viewport.width}.png`), fullPage: true });
    }
  }
});
