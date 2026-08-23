import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chromium } from "playwright";

import { createAssetService } from "../src/assets/asset-service.js";
import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { createMemoryIdentityRepository } from "../src/identity/memory-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
import { buildApp } from "../src/server/app.js";
import { findAvailablePort } from "../src/server/start.js";
import { ADMIN_EMAIL, ADMIN_TEMP_PASSWORD } from "./helpers/identity-world.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

async function startWorkspaceBrowser(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-single-workspace-stage-1-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(58700);
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const organizationId = "org_single_workspace_stage_1";
  const identityRepository = createMemoryIdentityRepository();
  const seeded = await seedInitialAdmin(identityRepository, {
    organizationId,
    organizationName: "单任务工作区团队",
    adminEmail: ADMIN_EMAIL,
    adminDisplayName: "工作区管理员",
    adminTempPassword: ADMIN_TEMP_PASSWORD
  });
  const assetRepository = createMemoryAssetRepository();
  const objectStore = createMemoryObjectStore();
  const assetService = createAssetService({ repository: assetRepository, objectStore });
  const authorized = await assetService.createUploadAuthorization({
    organizationId,
    actorMemberId: seeded.member.id,
    idempotencyKey: "workspace-product-image",
    filename: "清透防晒乳.png",
    contentType: "image/png",
    size: PNG.length,
    checksumSha256: createHash("sha256").update(PNG).digest("hex")
  });
  await assetService.uploadObject({ organizationId, uploadToken: authorized.upload.token, body: PNG, contentType: "image/png" });
  await assetService.completeUpload({ organizationId, actorMemberId: seeded.member.id, uploadSessionId: authorized.upload_session_id, idempotencyKey: "workspace-product-image-complete" });
  await assetService.runNextVerificationJob();
  const avatarAuthorized = await assetService.createUploadAuthorization({
    organizationId,
    actorMemberId: seeded.member.id,
    idempotencyKey: "workspace-avatar-image",
    filename: "人物参考图.png",
    contentType: "image/png",
    size: PNG.length,
    checksumSha256: createHash("sha256").update(PNG).digest("hex"),
    assetKind: "avatar_image"
  });
  await assetService.uploadObject({ organizationId, uploadToken: avatarAuthorized.upload.token, body: PNG, contentType: "image/png" });
  await assetService.completeUpload({ organizationId, actorMemberId: seeded.member.id, uploadSessionId: avatarAuthorized.upload_session_id, idempotencyKey: "workspace-avatar-image-complete" });
  await assetService.runNextVerificationJob();
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
      assetReferencePort: assetService.assetReferencePort
    },
    assets: { enabled: true, repository: assetRepository, objectStore, worker: { autoStart: false } },
    operatorWorkspace: { enabled: true }
  });
  const actor = { organizationId, actorMemberId: seeded.member.id };
  const project = await app.projectContent.service.createProject({
    ...actor,
    idempotencyKey: "workspace-project",
    name: "夏日防晒推广",
    description: "防晒短视频"
  });
  const first = await app.projectContent.service.createProduct({
    ...actor,
    projectId: project.id,
    idempotencyKey: "workspace-product-1",
    productName: "清透防晒乳 SPF50+"
  });
  await app.projectContent.service.createProduct({
    ...actor,
    projectId: project.id,
    idempotencyKey: "workspace-product-2",
    productName: "云感保湿乳"
  });
  try {
    await app.listen({ host: "127.0.0.1", port });
  } catch (error) {
    await app.close();
    if (error.code === "EPERM") return null;
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
    await app.close();
    if (error.message.includes("Executable doesn't exist") || error.message.includes("browserType.launch")) return null;
    throw error;
  }
  t.after(() => browser.close());
  return { app, browser, origin, project, product: first.product, revision: first.revision, authorized, avatarAuthorized };
}

async function authenticate(page, origin) {
  await page.goto(`${origin}/login.html`);
  await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("heading", { name: "设置新密码" }).waitFor();
  await page.locator("#newPassword").fill("Single-Workspace-Stage-1-Password-9!");
  await page.getByRole("button", { name: "保存并进入工作台" }).click();
  await page.waitForURL(`${origin}/projects.html`);
}

function workspaceUrl(origin, projectId, productId, stage = "product_content") {
  return `${origin}/workspace.html?project=${encodeURIComponent(projectId)}&product=${encodeURIComponent(productId)}&stage=${encodeURIComponent(stage)}`;
}

async function assertRecommendedAction(page, code, label) {
  const action = page.locator("#workspacePrimaryAction");
  await action.waitFor();
  assert.equal(await action.getAttribute("data-action-code"), code);
  assert.equal((await action.textContent()).trim(), label);
  assert.equal(await page.locator('[data-recommended-action="true"]').count(), 1);
}

test("Stage 1 opens one exact Product Content workspace and routes legacy stages safely", async (t) => {
  const setup = await startWorkspaceBrowser(t);
  if (!setup) return t.skip("local Chrome or TCP listening is unavailable");
  const { browser, origin, project, product } = setup;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await authenticate(page, origin);

  await page.goto(workspaceUrl(origin, project.id, product.id));
  await page.getByRole("heading", { name: "确认商品资料" }).waitFor();
  assert.equal(await page.locator("body").getAttribute("data-workspace-stage"), "product_content");
  assert.equal((await page.locator("#projectName").textContent()).trim(), project.name);
  assert.equal(await page.getByRole("button", { name: /清透防晒乳 SPF50\+/ }).getAttribute("aria-current"), "true");
  assert.equal(await page.locator('[data-workspace-panel="product-list"]').count(), 1);
  assert.equal(await page.locator('[data-workspace-panel="current-task"]').count(), 1);
  assert.equal(await page.locator('[data-workspace-panel="supporting-context"]').count(), 1);
  assert.equal(await page.locator("#workspaceActionBar").count(), 1);

  const expectedLegacy = new Map([
    ["copy", "/copy.html"],
    ["avatar", "/avatar.html"],
    ["video_plan", "/plan.html"],
    ["production", "/production.html"]
  ]);
  for (const script of ["copy.js", "avatar.js", "plan.js", "production.js"]) {
    await page.route(`**/${script}`, (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
  }
  const namedContext = { copy: "revision", avatar: "copy", video_plan: "plan", production: "orderId" };
  for (const [stage, pathname] of expectedLegacy) {
    const stageUrl = new URL(workspaceUrl(origin, project.id, product.id, stage));
    stageUrl.searchParams.set(namedContext[stage], stage === "copy" ? setup.revision.id : `${stage}-context`);
    stageUrl.searchParams.set("unknown", "must-not-cross-boundary");
    await page.goto(stageUrl.href);
    await page.waitForURL((url) => url.pathname === pathname);
    const url = new URL(page.url());
    assert.equal(url.searchParams.get("project"), project.id, stage);
    if (stage === "copy") assert.equal(url.searchParams.get("revision"), setup.revision.id, stage);
    else assert.equal(url.searchParams.get("product"), product.id, stage);
    if (stage !== "copy") assert.equal(url.searchParams.get(namedContext[stage]), `${stage}-context`, stage);
    assert.equal(url.searchParams.has("stage"), false, stage);
    assert.equal(url.searchParams.has("unknown"), false, stage);
  }

  const screenshotDir = process.env.STAGE_1_SCREENSHOTS_DIR;
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(workspaceUrl(origin, project.id, product.id));
    await page.getByRole("heading", { name: "确认商品资料" }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${viewport.width}px overflow`);
    if (screenshotDir) {
      const screenshot = await page.screenshot({
        path: path.join(screenshotDir, `stage-1-product-content-${viewport.width}x${viewport.height}.png`)
      });
      assert.equal(screenshot.readUInt32BE(16), viewport.width);
      assert.equal(screenshot.readUInt32BE(20), viewport.height);
    }
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await page.locator("#workspaceActionBar").evaluate((node) => Number.parseFloat(getComputedStyle(node).transitionDuration) <= 0.001), true);
  await page.getByRole("button", { name: "返回商品列表" }).click();
  assert.equal(await page.locator('[data-workspace-panel="product-list"]').isVisible(), true);
  const secondProduct = page.getByRole("button", { name: /云感保湿乳/ });
  await secondProduct.click();
  await page.waitForURL((url) => url.searchParams.get("product") !== product.id);
  await page.waitForFunction(() => document.activeElement === document.querySelector(".workspace-task-panel h2"));
  assert.equal(await page.locator(".workspace-task-panel h2").evaluate((node) => document.activeElement === node), true);
  await page.getByRole("button", { name: "返回商品列表" }).click();
  await page.waitForFunction(() => document.activeElement?.matches('#productList button[aria-current="true"]'));
  assert.equal(await secondProduct.evaluate((node) => document.activeElement === node), true);
  await page.goBack();
  await page.waitForURL((url) => url.searchParams.get("product") === product.id);
  await page.goForward();
  await page.waitForURL((url) => url.searchParams.get("product") !== product.id);
});

test("Stage 1 preserves Product Content truth across actions, history, conflicts, assets, and recovery", async (t) => {
  const setup = await startWorkspaceBrowser(t);
  if (!setup) return t.skip("local Chrome or TCP listening is unavailable");
  const { browser, origin, project, product } = setup;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await authenticate(page, origin);
  await page.goto(workspaceUrl(origin, project.id, product.id));

  await assertRecommendedAction(page, "review_product_blockers", "查看待补资料");
  assert.equal(await page.locator("#assetOptions input").count(), 1);
  assert.equal(await page.getByText("人物参考图.png · 版本 1", { exact: true }).count(), 0);
  await page.locator("#workspacePrimaryAction").click();
  assert.equal(await page.getByRole("button", { name: "新增卖点" }).evaluate((node) => document.activeElement === node), true);

  const description = page.locator('textarea[name="product_description"]');
  await description.fill("必须保留的本地商品说明");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: /云感保湿乳/ }).click();
  assert.equal(new URL(page.url()).searchParams.get("product"), product.id);
  assert.equal(await description.inputValue(), "必须保留的本地商品说明");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "刷新当前商品" }).click();
  assert.equal(await description.inputValue(), "必须保留的本地商品说明");

  await page.getByRole("button", { name: "新增卖点" }).click();
  await page.locator(".point-row input").fill("清爽不黏腻");
  await assertRecommendedAction(page, "save_product_content", "保存当前修改");
  await page.locator("#workspacePrimaryAction").click();
  await page.getByText("草稿已保存。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await page.getByText(/已确认。$/).waitFor();
  await page.locator("#assetOptions input").check();
  await assertRecommendedAction(page, "save_product_content", "保存当前修改");
  await page.locator("#workspacePrimaryAction").click();
  await page.getByText("草稿已保存。", { exact: true }).waitFor();
  await assertRecommendedAction(page, "mark_product_content_ready", "设为资料已就绪");

  await page.locator("#workspacePrimaryAction").click();
  await page.getByText("商品资料已设为就绪。", { exact: true }).waitFor();
  await assertRecommendedAction(page, "continue_to_copy", "确认并进入文案");
  const parentRevisionId = new URL(page.url()).searchParams.get("revision");
  assert.ok(parentRevisionId);

  await page.locator('textarea[name="product_description"]').fill("形成新的当前草稿");
  await assertRecommendedAction(page, "save_product_content", "保存当前修改");
  await page.locator("#workspacePrimaryAction").click();
  await page.getByText("草稿已保存。", { exact: true }).waitFor();
  await assertRecommendedAction(page, "mark_product_content_ready", "设为资料已就绪");
  await page.locator("#workspacePrimaryAction").click();
  await page.getByText("商品资料已设为就绪。", { exact: true }).waitFor();
  await assertRecommendedAction(page, "continue_to_copy", "确认并进入文案");
  const currentRevisionId = new URL(page.url()).searchParams.get("revision");
  assert.notEqual(currentRevisionId, parentRevisionId);

  await page.goto(`${workspaceUrl(origin, project.id, product.id)}&revision=${parentRevisionId}`);
  await page.getByText("历史版本", { exact: true }).waitFor();
  await assertRecommendedAction(page, "return_to_current_product_revision", "回到当前版本");
  await page.locator("#workspacePrimaryAction").click();
  await page.waitForURL((url) => url.searchParams.get("revision") === currentRevisionId);

  await page.route("**/copy.js", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
  await page.locator("#workspacePrimaryAction").click();
  await page.waitForURL((url) => url.pathname === "/copy.html");
  assert.equal(new URL(page.url()).searchParams.get("revision"), currentRevisionId);
  await page.unroute("**/copy.js");
  await page.goto(`${workspaceUrl(origin, project.id, product.id)}&revision=${currentRevisionId}`);

  const concurrent = await page.evaluate(async (revisionId) => {
    const csrf = decodeURIComponent((document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hifly_identity_csrf=")) || "=").split("=").slice(1).join("="));
    const current = (await (await fetch(`/api/product-revisions/${revisionId}`)).json()).revision;
    const response = await fetch(`/api/product-revisions/${revisionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-identity-csrf": csrf },
      body: JSON.stringify({
        expected_revision: current.revision_number,
        product_name: current.product_name,
        product_description: "服务端并发更新",
        primary_category: current.primary_category,
        physical_dimensions: current.physical_dimensions,
        content_brief: current.content_brief,
        selling_points: current.selling_points,
        asset_version_ids: current.asset_version_ids
      })
    });
    return response.json();
  }, currentRevisionId);
  assert.ok(concurrent.revision?.id);
  await page.locator('textarea[name="product_description"]').fill("我的未保存修改");
  await page.locator("#workspacePrimaryAction").click();
  await page.getByText("页面内容已过期。本地修改仍保留，可先复制内容，或明确载入服务端最新版本。", { exact: true }).waitFor();
  assert.equal(await page.locator('textarea[name="product_description"]').inputValue(), "我的未保存修改");
  await assertRecommendedAction(page, "load_latest_product_content", "载入服务端最新版本");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#workspacePrimaryAction").click();
  await page.waitForFunction(() => document.querySelector('textarea[name="product_description"]')?.value === "服务端并发更新");
  assert.equal(new URL(page.url()).searchParams.get("revision"), concurrent.revision.id);
  assert.equal(await page.locator('textarea[name="product_description"]').inputValue(), "服务端并发更新");
  assert.equal(new URL(page.url()).pathname, "/workspace.html");

  const endpoint = "**/*";
  let failedRead = false;
  await page.route(endpoint, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== `/api/projects/${project.id}/products/${product.id}/operator-workspace` || url.searchParams.get("stage") !== "product_content") return route.continue();
    if (!failedRead) {
      failedRead = true;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "OPERATOR_WORKSPACE_UNAVAILABLE" }) });
    }
    return route.continue();
  });
  await page.goto("about:blank");
  await page.goto(`${workspaceUrl(origin, project.id, product.id)}&revision=${concurrent.revision.id}#read-failure`);
  await page.getByText("商品工作区暂时无法载入", { exact: true }).waitFor();
  assert.equal(failedRead, true);
  await assertRecommendedAction(page, "retry_product_content_read", "刷新当前商品");
  await page.locator("#workspacePrimaryAction").click();
  await page.waitForFunction(() => document.querySelector("#openProductDialog")?.disabled === false);
  assert.equal(await page.getByRole("button", { name: "创建商品" }).isEnabled(), true);
  await page.unroute(endpoint);

  const staleContextUrl = new URL(workspaceUrl(origin, project.id, product.id));
  staleContextUrl.searchParams.set("copy", "stale-copy-context");
  staleContextUrl.searchParams.set("plan", "stale-plan-context");
  staleContextUrl.searchParams.set("orderId", "stale-order-context");
  await page.goto(staleContextUrl.href);
  const secondProductButton = page.getByRole("button", { name: /云感保湿乳/ });
  await secondProductButton.click();
  await page.waitForURL((url) => url.searchParams.get("product") !== product.id);
  for (const [selector, queryName] of [["#avatarStageLink", "copy"], ["#planStageLink", "plan"], ["#productionStageLink", "orderId"]]) {
    const href = new URL(await page.locator(selector).getAttribute("href"), origin);
    assert.equal(href.searchParams.has(queryName), false, `${queryName} must be cleared after product switch`);
  }

  const secondProductId = new URL(page.url()).searchParams.get("product");
  const secondDescription = page.locator('textarea[name="product_description"]');
  await secondDescription.fill("B 的未保存修改");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.goBack();
  await page.waitForURL((url) => url.searchParams.get("product") === secondProductId);
  assert.equal(await secondDescription.inputValue(), "B 的未保存修改");

  page.once("dialog", (dialog) => dialog.accept());
  await page.goBack();
  await page.waitForURL((url) => url.searchParams.get("product") === product.id);
  await page.waitForFunction(() => document.querySelector('#revisionForm input[name="product_name"]')?.value === "清透防晒乳 SPF50+");
  const firstDescription = page.locator('textarea[name="product_description"]');
  await firstDescription.fill("A 的未保存修改");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.goForward();
  await page.waitForURL((url) => url.searchParams.get("product") === product.id);
  assert.equal(await firstDescription.inputValue(), "A 的未保存修改");

  page.once("dialog", (dialog) => dialog.accept());
  await page.goForward();
  await page.waitForURL((url) => url.searchParams.get("product") === secondProductId);
  await page.waitForFunction(() => document.querySelector('#revisionForm input[name="product_name"]')?.value === "云感保湿乳");
  let popstateFailed = false;
  await page.route(endpoint, (route) => {
    const url = new URL(route.request().url());
    if (!popstateFailed && url.pathname === `/api/projects/${project.id}/products/${product.id}/operator-workspace`) {
      popstateFailed = true;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "OPERATOR_WORKSPACE_UNAVAILABLE" }) });
    }
    return route.continue();
  });
  await page.goBack();
  await page.waitForURL((url) => url.searchParams.get("product") === product.id);
  await page.getByText("商品资料暂时无法读取", { exact: true }).waitFor();
  assert.equal(popstateFailed, true);
  assert.equal(await page.locator("#revisionForm").isHidden(), true);
  const failedStageLinks = page.locator("[data-stage-code]");
  assert.equal(await failedStageLinks.count(), 10);
  for (const link of await failedStageLinks.all()) {
    assert.equal(await link.getAttribute("href"), null);
    assert.equal(await link.getAttribute("aria-disabled"), "true");
  }
  await assertRecommendedAction(page, "retry_product_content_read", "刷新当前商品");
  await page.locator("#workspacePrimaryAction").click();
  await page.waitForFunction(() => document.querySelector('#revisionForm input[name="product_name"]')?.value === "清透防晒乳 SPF50+");
  assert.equal(new URL(page.url()).searchParams.get("product"), product.id);
  for (const link of await page.locator("[data-stage-code]").all()) {
    const stage = await link.getAttribute("data-stage-code");
    const href = new URL(await link.getAttribute("href"), origin);
    assert.equal(await link.getAttribute("aria-disabled"), null);
    if (stage === "copy") assert.equal(href.searchParams.get("revision"), concurrent.revision.id);
    else assert.equal(href.searchParams.get("product"), product.id);
  }
  await page.unroute(endpoint);

  const invalidActions = [
    { code: "future_stage_action", stage: "product_content", kind: "command" },
    { code: "save_product_content", stage: "copy", kind: "command" },
    { code: "save_product_content", stage: "product_content", kind: "navigate" }
  ];
  for (const [index, invalid] of invalidActions.entries()) {
    await page.route(endpoint, async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname !== `/api/projects/${project.id}/products/${product.id}/operator-workspace` || url.searchParams.get("stage") !== "product_content") return route.continue();
      const response = await route.fetch();
      const body = await response.json();
      body.workspace.recommended_action = invalid;
      await route.fulfill({ response, json: body });
    });
    await page.goto("about:blank");
    await page.goto(`${workspaceUrl(origin, project.id, product.id)}&revision=${concurrent.revision.id}#invalid-action-${index}`);
    const action = page.locator("#workspacePrimaryAction");
    await action.waitFor();
    assert.equal(await action.isDisabled(), true);
    assert.equal(await action.getAttribute("data-action-code"), null);
    assert.equal(await page.locator('[data-recommended-action="true"]').count(), 0);
    await page.unroute(endpoint);
  }

  await page.goto(workspaceUrl(origin, project.id, product.id));
  await page.getByRole("button", { name: "创建商品" }).click();
  const dialog = page.getByRole("dialog", { name: "创建商品" });
  await dialog.getByLabel("商品名称", { exact: true }).fill("新建隔离商品");
  await dialog.getByRole("button", { name: "创建商品", exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("product") !== product.id);
  assert.equal(await page.locator('#revisionForm input[name="product_name"]').inputValue(), "新建隔离商品");
  assert.equal(await page.getByRole("button", { name: /新建隔离商品/ }).getAttribute("aria-current"), "true");
});
