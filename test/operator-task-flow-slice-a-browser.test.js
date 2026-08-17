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
  const port = await findAvailablePort(58500);
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

async function assertNoHorizontalOverflow(page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
}

async function captureViewport(page, name, viewport) {
  if (!process.env.SLICE_A_SCREENSHOTS_DIR) return;
  await mkdir(process.env.SLICE_A_SCREENSHOTS_DIR, { recursive: true });
  const screenshot = await page.screenshot({
    path: path.join(process.env.SLICE_A_SCREENSHOTS_DIR, `${name}-${viewport.width}.png`),
    fullPage: true
  });
  assert.equal(screenshot.readUInt32BE(16), viewport.width);
  assert.ok(screenshot.readUInt32BE(20) >= viewport.height);
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
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await assertNoHorizontalOverflow(page);
    await captureViewport(page, "login", viewport);
  }
  await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("heading", { name: "设置新密码" }).waitFor();
  await page.locator("#newPassword").fill("Operator-Task-Flow-Password-9!");
  await page.getByRole("button", { name: "保存并进入工作台" }).click();
  await page.waitForURL(`${origin}/projects.html`);

  assert.equal(await page.locator("body").getAttribute("class"), "operator-task-page");
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await assertNoHorizontalOverflow(page);
  }
  await page.goto(`${origin}/index.html`);
  await page.getByText("企业流程请进入项目", { exact: true }).waitFor();
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await assertNoHorizontalOverflow(page);
  }
  await page.goto(`${origin}/projects.html`);
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
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await assertNoHorizontalOverflow(page);
    await captureViewport(page, "projects", viewport);
  }
  await page.getByRole("link", { name: "继续项目" }).click();
  await page.waitForURL(/\/project\.html\?id=/);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await assertNoHorizontalOverflow(page);
  }

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
  assert.match(await page.locator(".product-list [aria-current=true] .product-meta").textContent(), /草稿 · v2 · 2 项待处理/);
  assert.match(await taskSummary.textContent(), /2 项待处理：确认至少一条卖点、素材功能未启用/);
  assert.match(await taskSummary.textContent(), /推荐下一步补齐资料就绪条件/);
  await page.getByText("素材功能未启用，暂不能选择商品图片。", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-recommended-action="true"]:visible').count(), 0);
  await page.getByRole("button", { name: "设为资料已就绪", exact: true }).click();
  await page.getByText(/暂不能设为资料已就绪：/).waitFor();
  assert.match(await taskSummary.textContent(), /确认至少一条卖点/);

  await page.getByRole("button", { name: "创建商品" }).click();
  await page.getByRole("dialog", { name: "创建商品" }).getByLabel("商品名称", { exact: true }).fill("第二个商品");
  await page.getByRole("dialog", { name: "创建商品" }).getByRole("button", { name: "创建商品", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.locator("#productList > button").nth(0).click();
  await page.locator('textarea[name="product_description"]').fill("切换前的本地修改");
  const switchGuard = new Promise((resolve) => page.once("dialog", async (dialog) => {
    resolve(dialog.message());
    await dialog.dismiss();
  }));
  await page.locator("#productList > button").nth(1).click();
  assert.match(await switchGuard, /未保存/);
  assert.equal(await page.locator('textarea[name="product_description"]').inputValue(), "切换前的本地修改");
  assert.equal(await page.locator("#productList > button").nth(0).getAttribute("aria-current"), "true");

  const refreshGuard = new Promise((resolve) => page.once("dialog", async (dialog) => {
    resolve(dialog.message());
    await dialog.dismiss();
  }));
  await page.getByRole("button", { name: "刷新当前商品" }).click();
  assert.match(await refreshGuard, /未保存/);
  assert.equal(await page.locator('textarea[name="product_description"]').inputValue(), "切换前的本地修改");

  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await taskSummary.scrollIntoViewIfNeeded();
    await page.evaluate(() => document.activeElement?.blur());
    assert.equal(await taskSummary.isVisible(), true);
    await assertNoHorizontalOverflow(page);
    await captureViewport(page, "project", viewport);
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedMotion = await page.locator("button").first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { transitionDuration: Number.parseFloat(style.transitionDuration), animationDuration: Number.parseFloat(style.animationDuration) };
  });
  assert.ok(reducedMotion.transitionDuration <= 0.001);
  assert.ok(reducedMotion.animationDuration <= 0.001);
});

test("Project presents the general category as 未细分品类 without changing save payloads", async (t) => {
  const setup = await startEnterpriseBrowser(t);
  if (!setup) return;
  const { page, origin } = setup;
  await authenticate(page, origin);

  await page.getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByLabel("项目名称").fill("品类映射项目");
  await page.getByRole("dialog", { name: "创建项目" }).getByRole("button", { name: "创建项目", exact: true }).click();
  await page.getByRole("link", { name: "继续项目" }).click();
  await page.getByRole("button", { name: "创建商品" }).click();
  await page.getByRole("dialog", { name: "创建商品" }).getByLabel("商品名称", { exact: true }).fill("未细分品类商品");
  await page.getByRole("dialog", { name: "创建商品" }).getByRole("button", { name: "创建商品", exact: true }).click();

  const category = page.locator('input[name="primary_category"]');
  await category.waitFor();
  assert.equal(await category.inputValue(), "未细分品类");

  const payloads = [];
  await page.route(/\/api\/product-revisions\/[^/]+$/, async (route) => {
    if (route.request().method() === "PATCH") payloads.push(route.request().postDataJSON());
    await route.continue();
  });
  await category.fill("未细分品类");
  const generalSave = page.waitForResponse((response) => response.request().method() === "PATCH" && /\/api\/product-revisions\/[^/]+$/.test(response.url()));
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  assert.equal((await generalSave).ok(), true);
  await page.getByText("草稿已保存。", { exact: true }).waitFor();
  assert.equal(payloads.at(-1).primary_category, "general");

  await category.fill("家居");
  const customSave = page.waitForResponse((response) => response.request().method() === "PATCH" && /\/api\/product-revisions\/[^/]+$/.test(response.url()));
  await page.getByRole("button", { name: "保存草稿", exact: true }).click();
  assert.equal((await customSave).ok(), true);
  await page.getByText("草稿已保存。", { exact: true }).waitFor();
  assert.equal(payloads.at(-1).primary_category, "家居");
  assert.equal(await category.inputValue(), "家居");
  await page.unroute(/\/api\/product-revisions\/[^/]+$/);
});

test("Projects clears loading content after runtime and API failures", async (t) => {
  const setup = await startEnterpriseBrowser(t);
  if (!setup) return;
  const { page, origin } = setup;
  await authenticate(page, origin);

  await page.route(`${origin}/api/runtime`, (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: "RUNTIME_UNAVAILABLE" })
  }));
  await page.goto(`${origin}/projects.html`);
  await page.getByText("工作台配置暂时无法读取，请刷新项目列表重试。", { exact: true }).waitFor();
  assert.equal(await page.locator("#projectList").getAttribute("aria-busy"), "false");
  assert.equal(await page.getByText("正在加载...", { exact: true }).count(), 0);
  await page.unroute(`${origin}/api/runtime`);
  await page.getByRole("button", { name: "刷新项目列表" }).click();
  await page.getByRole("region", { name: "当前任务" }).getByRole("heading", { name: "创建第一个项目" }).waitFor();

  await page.route(`${origin}/api/runtime`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ projectContentEnabled: true })
  }));
  await page.route(`${origin}/api/projects`, (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: "PROJECTS_UNAVAILABLE" })
  }));
  await page.goto(`${origin}/projects.html`);
  await page.getByText("项目列表加载失败，请刷新项目列表重试。", { exact: true }).waitFor();
  assert.equal(await page.locator("#projectList").getAttribute("aria-busy"), "false");
  assert.equal(await page.getByText("正在加载...", { exact: true }).count(), 0);
});

test("Projects names project-list refresh and preserves full bootstrap recovery", async (t) => {
  const setup = await startEnterpriseBrowser(t);
  if (!setup) return;
  const { page, origin } = setup;
  await authenticate(page, origin);

  const refresh = page.getByRole("button", { name: "刷新项目列表", exact: true });
  assert.equal(await refresh.getAttribute("data-refresh-scope"), "project-list");

  await page.route(`${origin}/api/runtime`, (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: "RUNTIME_UNAVAILABLE" })
  }));
  await page.goto(`${origin}/projects.html`);
  await page.getByText("工作台配置暂时无法读取，请刷新项目列表重试。", { exact: true }).waitFor();
  assert.equal(await page.locator("#taskNext").textContent(), "刷新项目列表");
  assert.equal(await page.locator("#taskBlocker").textContent(), "工作台配置未载入，请刷新项目列表。");
  await page.unroute(`${origin}/api/runtime`);
  await page.getByRole("button", { name: "刷新项目列表", exact: true }).click();
  await page.getByRole("region", { name: "当前任务" }).getByRole("heading", { name: "创建第一个项目" }).waitFor();

  await page.route(`${origin}/api/projects`, (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: "PROJECTS_UNAVAILABLE" })
  }));
  await page.getByRole("button", { name: "刷新项目列表", exact: true }).click();
  await page.getByText("项目列表加载失败，请刷新项目列表重试。", { exact: true }).waitFor();
  assert.equal(await page.locator("#taskNext").textContent(), "刷新项目列表");
  assert.equal(await page.locator("#taskBlocker").textContent(), "项目列表未载入，请刷新项目列表。");
  assert.equal(await page.locator('[data-recommended-action="true"]').textContent(), "刷新项目列表");
  await page.unroute(`${origin}/api/projects`);
  await page.getByRole("button", { name: "刷新项目列表", exact: true }).click();
  await page.getByRole("region", { name: "当前任务" }).getByRole("heading", { name: "创建第一个项目" }).waitFor();
});

test("Project deep links keep non-current Ready revisions read-only and surface lookup failures", async (t) => {
  const setup = await startEnterpriseBrowser(t);
  if (!setup) return;
  const { page, origin } = setup;
  await authenticate(page, origin);

  const projectId = "project-deep-link";
  await page.route(`${origin}/api/projects/${projectId}`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      project: {
        id: projectId,
        name: "深链项目",
        description: null,
        delivery_date: null,
        products: [
          { id: "product-current", project_id: projectId, current_revision_id: "revision-current", revision: {
            id: "revision-current", project_id: projectId, product_id: "product-current", status: "draft", revision_number: 2,
            product_name: "当前商品", product_description: "当前版本", primary_category: "general", content_brief: null,
            asset_version_ids: [], selling_points: []
          } }
        ]
      }
    })
  }));
  await page.route(`${origin}/api/product-revisions/revision-history`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ revision: {
      id: "revision-history", project_id: projectId, product_id: "product-current", status: "ready", revision_number: 1,
      product_name: "历史商品", product_description: "旧版本", primary_category: "general", content_brief: null,
      asset_version_ids: [], selling_points: []
    } })
  }));
  await page.route(`${origin}/api/product-revisions/foreign-revision`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ revision: {
      id: "foreign-revision", project_id: "foreign-project", product_id: "foreign-product", status: "superseded", revision_number: 1,
      product_name: "不应泄露的外部商品", product_description: "不可见内容", primary_category: "general", content_brief: null,
      asset_version_ids: [], selling_points: []
    } })
  }));
  await page.route(`${origin}/api/product-revisions/failed-revision`, (route) => route.fulfill({
    status: 500,
    contentType: "application/json",
    body: JSON.stringify({ error: "REVISION_LOOKUP_FAILED" })
  }));

  await page.goto(`${origin}/project.html?id=${projectId}&revision=revision-history`);
  await page.locator("#revisionState").getByText("商品资料已就绪 · v1", { exact: true }).waitFor();
  assert.equal(await page.locator('#revisionForm input[name="product_name"]').isDisabled(), true);
  assert.equal(await page.locator('#revisionForm input[name="product_name"]').inputValue(), "历史商品");
  const returnCurrent = page.getByRole("button", { name: "回到当前版本" });
  assert.equal(await returnCurrent.getAttribute("data-recommended-action"), "true");
  await returnCurrent.click();
  await page.locator("#revisionState").getByText("草稿 · v2", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("revision"), "revision-current");

  await page.goto(`${origin}/project.html?id=${projectId}&revision=not-a-real-revision`);
  await page.locator("#revisionState").getByText("草稿 · v2", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("revision"), "revision-current");

  await page.goto(`${origin}/project.html?id=${projectId}&revision=foreign-revision`);
  await page.locator("#revisionState").getByText("草稿 · v2", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("revision"), "revision-current");
  assert.equal(await page.getByText("不应泄露的外部商品", { exact: true }).count(), 0);

  await page.goto(`${origin}/project.html?id=${projectId}&revision=failed-revision`);
  await page.getByRole("heading", { name: "商品工作区暂时无法载入" }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("revision"), "failed-revision");
  assert.equal(await page.locator("#editor").isHidden(), true);
});
