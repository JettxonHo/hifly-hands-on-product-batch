import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chromium } from "playwright";

import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { createMemoryIdentityRepository } from "../src/identity/memory-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
import { buildApp } from "../src/server/app.js";
import { findAvailablePort } from "../src/server/start.js";
import { ADMIN_EMAIL, ADMIN_TEMP_PASSWORD } from "./helpers/identity-world.js";

test("enterprise pages share the approved shell and responsive creation flows", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-frontend-foundation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(57200);
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const identityRepository = createMemoryIdentityRepository();
  await seedInitialAdmin(identityRepository, {
    organizationId: "org_frontend_foundation",
    organizationName: "星桥内容团队",
    adminEmail: ADMIN_EMAIL,
    adminDisplayName: "林小满",
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
    assets: {
      enabled: true,
      repository: createMemoryAssetRepository(),
      objectStore: createMemoryObjectStore(),
      worker: { autoStart: false }
    },
    projectContent: {
      enabled: true,
      repository: createMemoryProjectContentRepository()
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
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  await page.goto(`${origin}/login.html`);
  await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("Frontend-Foundation-Password-9!");
  await page.getByRole("button", { name: "保存并进入工作台" }).click();
  await page.waitForURL(`${origin}/projects.html`);

  await page.goto(`${origin}/projects.html`);
  await page.getByRole("navigation", { name: "主导航" }).waitFor();
  await page.getByRole("link", { name: "项目" }).waitFor();
  await page.getByRole("link", { name: "素材中心" }).waitFor();
  await page.getByRole("link", { name: "成员管理" }).waitFor();
  assert.equal(await page.getByText("生产任务", { exact: true }).count(), 0);
  assert.equal(await page.getByText("作品库", { exact: true }).count(), 0);
  await page.getByText("星桥内容团队").waitFor();
  assert.equal(await page.getByRole("link", { name: "项目" }).getAttribute("aria-current"), "page");
  assert.equal(await page.locator("script:not([src])").count(), 0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: "创建项目" }).focus();
  assert.notEqual(await page.getByRole("button", { name: "创建项目" }).evaluate((node) => getComputedStyle(node).outlineStyle), "none");
  assert.ok(Number.parseFloat(await page.getByRole("button", { name: "创建项目" }).evaluate((node) => getComputedStyle(node).transitionDuration)) < 0.001);
  await page.getByRole("button", { name: "创建项目" }).click();
  await page.getByRole("dialog", { name: "创建项目" }).waitFor();
  await page.getByLabel("项目名称").fill("九月秋冬新品种草计划与长名称布局验收");
  await page.getByRole("dialog", { name: "创建项目" }).getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByText("九月秋冬新品种草计划与长名称布局验收").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

  await page.getByRole("link", { name: "打开" }).click();
  await page.getByRole("button", { name: "创建商品" }).click();
  await page.getByRole("dialog", { name: "创建商品" }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

  await page.goto(`${origin}/assets.html`);
  await page.getByRole("link", { name: "素材中心" }).waitFor();
  assert.equal(await page.getByRole("link", { name: "素材中心" }).getAttribute("aria-current"), "page");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

  await page.goto(`${origin}/members.html`);
  await page.getByRole("button", { name: "创建成员" }).click();
  const memberDialog = page.getByRole("dialog", { name: "创建成员" });
  await memberDialog.getByLabel("工作邮箱").fill("operator@example.com");
  await memberDialog.getByLabel("姓名").fill("周子安");
  await memberDialog.getByRole("button", { name: "创建并生成临时密码" }).click();
  const temporaryPasswordNode = page.locator("#temporaryPassword:not([hidden])");
  await temporaryPasswordNode.waitFor();
  const temporaryPassword = (await temporaryPasswordNode.textContent()).match(/：(.+?)。/)?.[1];
  assert.ok(temporaryPassword);
  await memberDialog.getByRole("button", { name: "关闭创建成员" }).click();
  const memberRow = page.locator(".member-row").filter({ hasText: "周子安" });
  await memberRow.getByRole("button", { name: "停用" }).click();
  await page.getByRole("dialog", { name: "确认停用成员" }).getByText(/周子安/).waitFor();
  await page.getByRole("button", { name: "取消" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

  await page.getByRole("button", { name: "退出" }).click();
  await page.waitForURL(`${origin}/login.html`);
  await page.getByLabel("工作邮箱").fill("operator@example.com");
  await page.getByLabel("密码", { exact: true }).fill(temporaryPassword);
  await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("Operator-Permanent-Password-9!");
  await page.getByRole("button", { name: "保存并进入工作台" }).click();
  await page.waitForURL(`${origin}/projects.html`);
  await page.route("**/api/auth/me", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    await route.continue();
  }, { times: 1 });
  await page.goto(`${origin}/projects.html`, { waitUntil: "domcontentloaded" });
  assert.equal(await page.getByRole("link", { name: "成员管理" }).count(), 0);
  await page.getByRole("navigation", { name: "主导航" }).waitFor();
  await page.getByText("星桥内容团队").waitFor();
  assert.equal(await page.getByRole("link", { name: "成员管理" }).count(), 0);
});
