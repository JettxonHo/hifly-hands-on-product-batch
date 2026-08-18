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

test("system Chrome completes and restores the project-content flow", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-project-content-browser-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(56800), host = `127.0.0.1:${port}`, origin = `http://${host}`;
  const identityRepository = createMemoryIdentityRepository();
  const seeded = await seedInitialAdmin(identityRepository, { organizationId: "org_browser_content", organizationName: "Content Browser", adminEmail: ADMIN_EMAIL, adminDisplayName: "Browser Admin", adminTempPassword: ADMIN_TEMP_PASSWORD });
  const assetRepository = createMemoryAssetRepository(), objectStore = createMemoryObjectStore();
  const assetService = createAssetService({ repository: assetRepository, objectStore });
  const authorized = await assetService.createUploadAuthorization({ organizationId: "org_browser_content", actorMemberId: seeded.member.id, idempotencyKey: "browser-asset", filename: "product.png", contentType: "image/png", size: PNG.length, checksumSha256: createHash("sha256").update(PNG).digest("hex") });
  await assetService.uploadObject({ organizationId: "org_browser_content", uploadToken: authorized.upload.token, body: PNG, contentType: "image/png" });
  await assetService.completeUpload({ organizationId: "org_browser_content", actorMemberId: seeded.member.id, uploadSessionId: authorized.upload_session_id, idempotencyKey: "browser-complete" });
  await assetService.runNextVerificationJob();
  const app = await buildApp({ root, executor: createFakeExecutor(), identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin], cookieSecure: false, seed: { enabled: false } }, assets: { enabled: true, repository: assetRepository, objectStore, worker: { autoStart: false } }, projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort: assetService.assetReferencePort } });
  try { await app.listen({ host: "127.0.0.1", port }); } catch (error) { await app.close(); if (error.code === "EPERM") return t.skip("sandbox disallows local TCP listening"); throw error; }
  t.after(() => app.close());
  let browser;
  const systemChrome = process.env.IDENTITY_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  try { browser = await chromium.launch({ headless: true, executablePath: systemChrome }); } catch (error) { return t.skip(`system Chrome unavailable: ${error.message}`); }
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`${origin}/login.html`); await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL); await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD); await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("Browser-Content-Password-9!"); await page.getByRole("button", { name: "保存并进入工作台" }).click(); await page.waitForURL(`${origin}/projects.html`);
  const mixedAssets = [
    { ...authorized.asset, kind: "product_image", status: "active", versions: [{ ...authorized.asset_version, status: "available" }] },
    { ...authorized.asset, id: "avatar-asset-190", kind: "avatar_image", status: "active", versions: [{ ...authorized.asset_version, id: "avatar-version-190", asset_id: "avatar-asset-190", original_filename: "人物立绘.png", status: "available" }] },
    { ...authorized.asset, id: "work-asset-190", kind: "work_video", status: "active", versions: [{ ...authorized.asset_version, id: "work-version-190", asset_id: "work-asset-190", original_filename: "历史成片.mp4", status: "available" }] }
  ];
  await page.route("**/api/assets", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ assets: mixedAssets })
  }));
  await page.getByRole("link", { name: "项目", exact: true }).click(); await page.getByRole("button", { name: "创建项目" }).click(); await page.getByLabel("项目名称").fill("八月新品"); await page.getByRole("dialog", { name: "创建项目" }).getByRole("button", { name: "创建项目", exact: true }).click(); await page.getByRole("link", { name: "继续项目" }).click();
  const projectId = new URL(page.url()).searchParams.get("id");
  assert.ok(projectId);
  await page.getByRole("button", { name: "创建商品" }).click(); await page.getByRole("dialog", { name: "创建商品" }).getByLabel("商品名称", { exact: true }).fill("云朵抱枕"); await page.getByRole("dialog", { name: "创建商品" }).getByRole("button", { name: "创建商品", exact: true }).click();
  await page.getByRole("heading", { name: "实物尺寸" }).waitFor();
  assert.equal(await page.getByText("product.png · 版本 1", { exact: true }).count(), 1);
  assert.equal(await page.getByText("人物立绘.png · 版本 1", { exact: true }).count(), 0);
  assert.equal(await page.getByText("历史成片.mp4 · 版本 1", { exact: true }).count(), 0);
  assert.equal(await page.locator("#assetOptions input").count(), 1);
  await page.getByLabel("高度", { exact: true }).fill("18"); await page.getByLabel("宽度", { exact: true }).fill("12"); await page.getByLabel("尺寸单位", { exact: true }).selectOption("cm");
  await page.getByLabel("容量数值（可选）", { exact: true }).fill("500"); await page.getByLabel("容量单位", { exact: true }).selectOption("ml");
  await page.getByRole("button", { name: "新增卖点" }).click(); await page.locator(".point-row input").fill("柔软亲肤"); await page.getByRole("button", { name: "保存草稿" }).click(); await page.getByText("草稿已保存。").waitFor();
  await page.getByRole("button", { name: "确认", exact: true }).click(); await page.getByText(/已确认。$/).waitFor(); await page.locator("#assetOptions input").check();
  await page.getByRole("button", { name: "设为资料已就绪", exact: true }).click(); await page.getByText("商品资料已设为就绪。").waitFor(); assert.match(await page.locator("#revisionState").textContent(), /^商品资料已就绪/);
  const revisionId = new URL(page.url()).searchParams.get("revision");
  assert.ok(revisionId);
  assert.equal(await page.getByLabel("高度", { exact: true }).inputValue(), "18");
  assert.equal(await page.getByLabel("尺寸单位", { exact: true }).inputValue(), "cm");
  assert.equal(await page.getByLabel("容量单位", { exact: true }).inputValue(), "ml");
  await page.reload(); await page.locator("#revisionState").waitFor(); assert.match(await page.locator("#revisionState").textContent(), /^商品资料已就绪/);
  assert.equal(new URL(page.url()).searchParams.get("revision"), revisionId);
  assert.equal(await page.getByRole("button", { name: "设为资料已就绪", exact: true }).isDisabled(), true);
  assert.equal(await page.locator("#assetOptions input").isDisabled(), false);

  const screenshotDir = process.env.ISSUE_193_SCREENSHOT_DIR;
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false,
      `Project physical facts should not overflow at ${viewport.width}px`);
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `project-dimensions-${viewport.width}x${viewport.height}.png`), fullPage: true });
  }

  const concurrent = await page.evaluate(async ({ revisionId }) => {
    const csrf = decodeURIComponent((document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hifly_identity_csrf=")) || "=").split("=").slice(1).join("="));
    const revision = await (await fetch(`/api/product-revisions/${revisionId}`)).json();
    const response = await fetch(`/api/product-revisions/${revisionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", "x-identity-csrf": csrf },
      body: JSON.stringify({
        expected_revision: revision.revision.revision_number,
        product_name: revision.revision.product_name,
        product_description: "服务端并发版本",
        primary_category: revision.revision.primary_category,
        content_brief: revision.revision.content_brief,
        selling_points: revision.revision.selling_points,
        asset_version_ids: revision.revision.asset_version_ids
      })
    });
    return response.json();
  }, { revisionId });
  const currentRevisionId = concurrent.revision.id;
  assert.notEqual(currentRevisionId, revisionId);
  await page.locator('textarea[name="product_description"]').fill("并发修改");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await page.getByText("页面内容已过期。本地修改仍保留，可先复制内容，或明确载入服务端最新版本。", { exact: true }).waitFor();
  assert.equal(await page.locator('textarea[name="product_description"]').inputValue(), "并发修改");
  assert.equal(await page.getByRole("button", { name: "载入服务端最新版本" }).isVisible(), true);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "载入服务端最新版本" }).click();
  await page.waitForURL((url) => url.searchParams.get("revision") === currentRevisionId);
  assert.equal(await page.locator('textarea[name="product_description"]').inputValue(), "服务端并发版本");
  assert.equal(new URL(page.url()).searchParams.get("revision"), currentRevisionId);

  await page.route("**/api/assets", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ assets: [{ ...authorized.asset, status: "disabled", versions: [{ ...authorized.asset_version, status: "available" }] }] })
  }));
  await page.reload();
  await page.getByText("选择至少一张可引用图片", { exact: false }).waitFor();
  assert.equal(await page.locator("#assetOptions input").count(), 0);

  await page.unroute("**/api/assets");
  await page.reload();
  await page.route(new RegExp(`/api/product-revisions/${currentRevisionId}/ready$`), (route) => route.fulfill({
    status: 422,
    contentType: "application/json",
    body: JSON.stringify({ error: "ASSET_NOT_ACTIVE" })
  }));
  await page.route("**/api/assets", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ assets: [{ ...authorized.asset, status: "disabled", versions: [{ ...authorized.asset_version, status: "available" }] }] })
  }));
  await page.getByRole("button", { name: "设为资料已就绪", exact: true }).click();
  await page.getByText("素材已不可引用，请重新选择。", { exact: true }).waitFor();
  assert.equal(await page.locator("#assetOptions input").count(), 0);

  await page.unroute("**/api/assets");
  const actualProject = await page.evaluate(async (id) => (await fetch(`/api/projects/${id}`)).json(), projectId);
  const staleProject = structuredClone(actualProject);
  const staleRevision = staleProject.project.products.find((item) => item.revision.id === currentRevisionId).revision;
  staleRevision.status = "draft";
  staleRevision.asset_version_ids = ["avatar-version-190", "work-version-190"];
  staleRevision.selling_points = [{ id: "point-stale-190", text: "已确认卖点", confirmed: true }];
  await page.route(`${origin}/api/projects/${projectId}`, (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(staleProject)
  }));
  await page.route("**/api/assets", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ assets: mixedAssets })
  }));
  let savedPayload;
  await page.route(`${origin}/api/product-revisions/${currentRevisionId}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    savedPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ revision: { ...staleRevision, revision_number: staleRevision.revision_number + 1, asset_version_ids: [] } })
    });
  });
  await page.reload();
  await page.getByText("选择至少一张可引用图片", { exact: false }).waitFor();
  assert.equal(await page.locator("#assetOptions input").count(), 1);
  assert.equal(await page.locator("#assetOptions input:checked").count(), 0);
  await page.getByRole("button", { name: "保存草稿" }).click();
  await page.getByText("草稿已保存。", { exact: true }).waitFor();
  assert.deepEqual(savedPayload.asset_version_ids, []);
});
