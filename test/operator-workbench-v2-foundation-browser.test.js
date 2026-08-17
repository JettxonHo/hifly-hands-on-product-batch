import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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

const ENTERPRISE_PAGES = [
  "/projects.html",
  "/project.html?id=project-v2-a",
  "/copy.html?project=project-v2-a&revision=revision-v2-a",
  "/avatar.html?project=project-v2-a&product=product-v2-a",
  "/plan.html?project=project-v2-a&product=product-v2-a",
  "/production.html?project=project-v2-a&product=product-v2-a",
  "/works.html",
  "/assets.html",
  "/members.html"
];

const PAGE_SCRIPTS = [
  "projects.js",
  "project.js",
  "copy.js",
  "avatar.js",
  "plan.js",
  "production.js",
  "works.js",
  "assets.js",
  "members.js"
];

async function launchBrowser(t) {
  try {
    return await chromium.launch({
      headless: true,
      executablePath: process.env.IDENTITY_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    });
  } catch (error) {
    if (error.message.includes("Executable doesn't exist") || error.message.includes("browserType.launch")) {
      t.skip("Playwright browser is unavailable");
      return null;
    }
    throw error;
  }
}

async function stubEnterpriseContext(page, role = "admin") {
  await page.route("**/api/auth/me", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      status: "active",
      organization: { id: "org-v2-a", name: "星桥内容团队" },
      member: { id: `member-${role}`, display_name: role === "admin" ? "林小满" : "周子安", email: `${role}@example.com` },
      membership: { role }
    })
  }));
  await page.route("**/api/runtime", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      identityEnabled: true,
      assetsEnabled: true,
      projectContentEnabled: true,
      copyGenerationEnabled: true,
      avatarSelectionEnabled: true,
      videoPlanningEnabled: true,
      productionOrdersEnabled: true,
      worksEnabled: true
    })
  }));
  for (const script of PAGE_SCRIPTS) {
    await page.route(`**/${script}`, (route) => route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: ""
    }));
  }
}

test("enterprise shell keeps one role-aware navigation order across pages", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-v2-a-shell-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(58600);
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const identityRepository = createMemoryIdentityRepository();
  await seedInitialAdmin(identityRepository, {
    organizationId: "org-v2-a",
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

  const browser = await launchBrowser(t);
  if (!browser) return;
  t.after(() => browser.close());
  const adminPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await stubEnterpriseContext(adminPage, "admin");

  for (const pathname of ENTERPRISE_PAGES) {
    await adminPage.goto(`${origin}${pathname}`);
    const navigation = adminPage.getByRole("navigation", { name: "主导航" });
    await adminPage.waitForTimeout(200);
    assert.deepEqual(
      await navigation.locator("[data-page]:visible").evaluateAll((links) => links.map((link) => link.textContent.trim())),
      ["项目", "作品库", "素材中心", "成员管理"],
      pathname
    );
    assert.equal(await navigation.getByText("生产任务", { exact: true }).count(), 0, pathname);
  }

  const stagePages = [
    ["/project.html?id=project-v2-a", ["current", "blocked", "blocked", "blocked", "blocked"]],
    ["/copy.html?project=project-v2-a&revision=revision-v2-a", ["available", "current", "available", "blocked", "blocked"]],
    ["/avatar.html?project=project-v2-a&product=product-v2-a", ["available", "available", "current", "blocked", "blocked"]],
    ["/plan.html?project=project-v2-a&product=product-v2-a", ["available", "available", "available", "current", "blocked"]],
    ["/production.html?project=project-v2-a&product=product-v2-a", ["available", "available", "available", "available", "current"]]
  ];
  for (const [pathname, expectedStates] of stagePages) {
    await adminPage.goto(`${origin}${pathname}`);
    const stages = adminPage.locator('nav[aria-label="项目阶段"]');
    assert.equal(await stages.count(), 1, pathname);
    assert.deepEqual(
      await stages.locator(":scope > *").evaluateAll((items) => items.map((item) => item.textContent.trim().replace(/^[✓1-5]\s*/, ""))),
      ["商品资料", "文案", "人物", "视频方案", "生产"],
      pathname
    );
    assert.deepEqual(
      await stages.locator(":scope > *").evaluateAll((items) => items.map((item) => item.dataset.stageState)),
      expectedStates,
      `${pathname} desktop stage semantics`
    );
    assert.deepEqual(
      await adminPage.locator(".stage-mobile li").evaluateAll((items) => items.map((item) => item.dataset.stageState)),
      expectedStates,
      `${pathname} mobile stage semantics`
    );
  }

  await adminPage.goto(`${origin}/project.html?id=project-v2-a`);
  assert.equal((await adminPage.locator("#readyRevision").textContent()).trim(), "设为资料已就绪");
  assert.equal(await adminPage.locator("#refreshRevision").getAttribute("data-refresh-scope"), "current-product");
  assert.equal((await adminPage.locator("#refreshRevision").textContent()).trim(), "刷新当前商品");
  assert.doesNotMatch(await adminPage.locator("#mainContent").innerText(), /\bReady\b/);

  await adminPage.goto(`${origin}/copy.html?project=project-v2-a&revision=revision-v2-a`);
  const copySummary = adminPage.locator(".task-summary");
  assert.deepEqual(
    await copySummary.locator("dt").allTextContents(),
    ["当前上下文", "所处步骤", "业务状态", "当前版本", "文案质检", "人工审核"]
  );
  assert.equal(await adminPage.locator("#refreshCopy").getAttribute("data-refresh-scope"), "page");
  assert.equal(await adminPage.locator(".operator-audit-details").count(), 2);
  assert.doesNotMatch(await copySummary.innerText(), /QC|HumanReview|CopyVersion/);

  await adminPage.goto(`${origin}/plan.html?project=project-v2-a&product=product-v2-a`);
  const planSummary = adminPage.locator(".task-summary");
  assert.match(await planSummary.innerText(), /预检/);
  assert.match(await planSummary.innerText(), /人工审核/);
  assert.equal(await adminPage.locator("#refreshPlan").getAttribute("data-refresh-scope"), "page");
  assert.equal(await adminPage.locator(".operator-technical-details").count(), 1);
  assert.doesNotMatch(await planSummary.innerText(), /HumanReview|Preflight/);

  const responsivePages = [
    "/projects.html",
    "/project.html?id=project-v2-a",
    "/copy.html?project=project-v2-a&revision=revision-v2-a",
    "/production.html?project=project-v2-a&product=product-v2-a",
    "/works.html",
    "/assets.html",
    "/members.html"
  ];
  const screenshotDir = process.env.V2_A_SCREENSHOTS_DIR;
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await adminPage.setViewportSize(viewport);
    for (const pathname of responsivePages) {
      await adminPage.goto(`${origin}${pathname}`);
      assert.equal(
        await adminPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        true,
        `${pathname} at ${viewport.width}px`
      );
      if (screenshotDir) {
        const name = pathname.split("?")[0].replace(/^\//, "").replace(/\.html$/, "") || "entry";
        const screenshot = await adminPage.screenshot({
          path: path.join(screenshotDir, `${name}-${viewport.width}x${viewport.height}.png`)
        });
        assert.equal(screenshot.readUInt32BE(16), viewport.width);
        assert.equal(screenshot.readUInt32BE(20), viewport.height);
      }
    }
  }

  await adminPage.setViewportSize({ width: 390, height: 844 });
  await adminPage.emulateMedia({ reducedMotion: "reduce" });
  await adminPage.goto(`${origin}/project.html?id=project-v2-a`);
  assert.equal(
    await adminPage.locator("#readyRevision").evaluate((button) => Number.parseFloat(getComputedStyle(button).transitionDuration) <= 0.001),
    true
  );
  await adminPage.keyboard.press("Tab");
  assert.equal(await adminPage.locator(".skip-link").evaluate((link) => document.activeElement === link), true);

  await adminPage.goto(`${origin}/index.html`);
  assert.equal(await adminPage.locator("body.operator-task-page").count(), 0);
  assert.equal(await adminPage.getByRole("tab", { name: "批量录入" }).count(), 1);
  assert.equal(await adminPage.getByRole("tab", { name: "批量导入" }).count(), 1);
  assert.equal(await adminPage.getByRole("tab", { name: "待执行任务" }).count(), 1);
  assert.equal(await adminPage.getByRole("tab", { name: "运行记录" }).count(), 1);

  const memberPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await stubEnterpriseContext(memberPage, "member");
  await memberPage.goto(`${origin}/projects.html`);
  const memberNavigation = memberPage.getByRole("navigation", { name: "主导航" });
  await memberPage.getByText("星桥内容团队").waitFor({ timeout: 3000 });
  assert.deepEqual(
    await memberNavigation.locator("[data-page]:visible").evaluateAll((links) => links.map((link) => link.textContent.trim())),
    ["项目", "作品库", "素材中心"]
  );
});
