import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chromium } from "playwright";

import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createMemoryIdentityRepository } from "../src/identity/memory-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { buildApp } from "../src/server/app.js";
import { findAvailablePort } from "../src/server/start.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const ORGANIZATION_ID = "org-v2-d-assets-browser";
const ADMIN_EMAIL = "v2-d-assets@example.test";
const ADMIN_TEMP_PASSWORD = "Temporary-V2-D-Assets-9!";

async function seedImageAsset(app, { kind, filename, actorMemberId, assetId, body = PNG, verify = true }) {
  const checksum = createHash("sha256").update(body).digest("hex");
  const created = await app.assets.service.createUploadAuthorization({
    organizationId: ORGANIZATION_ID,
    actorMemberId,
    idempotencyKey: `${kind}-${filename}`,
    filename,
    contentType: "image/png",
    size: body.length,
    checksumSha256: checksum,
    assetKind: kind,
    assetId
  });
  if (verify !== "pending") {
    await app.assets.service.uploadObject({ organizationId: ORGANIZATION_ID, uploadToken: created.upload.token, body, contentType: "image/png" });
    await app.assets.service.completeUpload({ organizationId: ORGANIZATION_ID, uploadSessionId: created.upload_session_id, idempotencyKey: `complete-${kind}-${filename}`, actorMemberId });
    if (verify) await app.assets.service.runNextVerificationJob();
  }
  return created;
}

async function createWorld(t, { seedCurrentPending = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-v2-d-assets-browser-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(59100);
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const identityRepository = createMemoryIdentityRepository();
  const assetRepository = createMemoryAssetRepository();
  const objectStore = createMemoryObjectStore();
  const seeded = await seedInitialAdmin(identityRepository, {
    organizationId: ORGANIZATION_ID,
    organizationName: "V2-D 素材企业",
    adminEmail: ADMIN_EMAIL,
    adminDisplayName: "素材管理员",
    adminTempPassword: ADMIN_TEMP_PASSWORD
  });
  const app = await buildApp({
    root,
    executor: createFakeExecutor(),
    identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin], cookieSecure: false, seed: { enabled: false } },
    assets: { enabled: true, repository: assetRepository, objectStore, worker: { autoStart: false } }
  });
  const product = await seedImageAsset(app, { kind: "product_image", filename: "商品主图.png", actorMemberId: seeded.member.id });
  const avatar = await seedImageAsset(app, { kind: "avatar_image", filename: "人物立绘.png", actorMemberId: seeded.member.id });
  const pending = await seedImageAsset(app, { kind: "avatar_image", filename: "待上传人物.png", actorMemberId: seeded.member.id, verify: seedCurrentPending ? "pending" : true });
  const failed = await seedImageAsset(app, { kind: "product_image", filename: "损坏商品图.png", actorMemberId: seeded.member.id, body: Buffer.from("not-an-image") });
  const disabled = await seedImageAsset(app, { kind: "product_image", filename: "已停用商品图.png", actorMemberId: seeded.member.id });
  await app.assets.service.disableAsset({ organizationId: ORGANIZATION_ID, assetId: disabled.asset.id, expectedRevision: 1, actorMemberId: seeded.member.id });
  const videoBody = Buffer.from("v2-d-read-only-video");
  const uploadPath = path.join(root, "new-avatar.png");
  await writeFile(uploadPath, PNG);
  const candidate = {
    id: "candidate-v2-d-video",
    object_key: "outputs/v2-d-read-only.mp4",
    original_filename: "系统登记作品.mp4",
    media_type: "video/mp4",
    size: videoBody.length,
    checksum: createHash("sha256").update(videoBody).digest("hex")
  };
  await objectStore.put({ key: candidate.object_key, body: videoBody, contentType: candidate.media_type, metadata: { organizationId: ORGANIZATION_ID } });
  const video = await app.assets.service.verifiedOutputAssetPort.registerVerifiedOutput({ organizationId: ORGANIZATION_ID, actorMemberId: seeded.member.id, candidate, now: "2026-08-17T08:00:00.000Z" });

  try {
    await app.listen({ host: "127.0.0.1", port });
  } catch (error) {
    await app.close();
    if (error.code === "EPERM") return { skipped: "sandbox disallows local TCP listening" };
    throw error;
  }
  t.after(() => app.close());

  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.IDENTITY_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  } catch (_systemError) {
    try { browser = await chromium.launch({ headless: true }); }
    catch (error) { await app.close(); return { skipped: `Chrome/Chromium unavailable: ${error.message}` }; }
  }
  t.after(() => browser.close());
  return { app, browser, origin, root, uploadPath, actorMemberId: seeded.member.id, product, avatar, pending, failed, disabled, video, videoBody };
}

async function login(page, origin) {
  await page.goto(`${origin}/login.html`);
  await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("V2-D-Assets-Browser-Password-9!");
  await page.getByRole("button", { name: "保存并进入工作台" }).click();
  await page.waitForURL(`${origin}/`);
}

async function loginAndOpenAssets(page, origin) {
  await login(page, origin);
  await page.goto(`${origin}/assets.html`);
  await page.getByRole("button", { name: /商品图片/ }).waitFor();
}

function pngSize(buffer) {
  assert.equal(buffer.toString("ascii", 1, 4), "PNG");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("V2-D groups real types, exposes Asset and Version truth, and keeps work videos read-only", async (t) => {
  const world = await createWorld(t);
  if (world.skipped) return t.skip(world.skipped);
  const page = await world.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await loginAndOpenAssets(page, world.origin);

  await page.getByRole("button", { name: /商品图片/ }).waitFor();
  await page.getByRole("button", { name: /人物图片/ }).waitFor();
  await page.getByRole("button", { name: /作品视频/ }).waitFor();
  assert.equal(await page.locator('[data-recommended-action="true"]').count(), 0);

  await page.getByRole("button", { name: /商品主图/ }).click();
  await page.getByRole("heading", { name: "商品主图.png", exact: true }).waitFor();
  await page.getByText("版本历史", { exact: true }).waitFor();
  await page.getByText("关联信息当前未提供", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "上传新版本" }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "重命名" }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "停用", exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "删除", exact: true }).count(), 1);
  assert.ok((await page.locator('[data-recommended-action="true"]').count()) <= 1);

  await page.getByRole("button", { name: /作品视频/ }).click();
  await page.getByRole("button", { name: /系统登记作品/ }).click();
  await page.getByRole("heading", { name: "系统登记作品.mp4", exact: true }).waitFor();
  for (const action of ["上传新版本", "重命名", "停用", "删除"]) assert.equal(await page.getByRole("button", { name: action, exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "上传并开始核验" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "下载文件" }).count(), 1);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载文件" }).click();
  const download = await downloadPromise;
  assert.equal(download.suggestedFilename(), "系统登记作品.mp4");
  assert.deepEqual(await readFile(await download.path()), world.videoBody);

  await page.getByRole("button", { name: /人物图片/ }).click();
  let uploadRequests = 0;
  let uploadPayload = null;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/assets/upload-authorizations") {
      uploadRequests += 1;
      uploadPayload = request.postDataJSON();
    }
  });
  await page.getByRole("button", { name: "上传并开始核验" }).click();
  await page.getByLabel("素材类型").waitFor();
  assert.deepEqual(await page.locator("#assetKind option").allTextContents(), ["商品图片", "人物图片"]);
  assert.equal(await page.locator('#assetKind option[value="work_video"]').count(), 0);
  await page.getByLabel("图片文件").setInputFiles(world.uploadPath);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.locator("#openUpload").click();
  assert.equal(uploadRequests, 0);
  await page.getByLabel("图片文件").setInputFiles(world.uploadPath);
  await page.getByRole("button", { name: "上传并开始核验" }).last().click();
  await page.getByText("上传完成，服务端正在核验", { exact: false }).first().waitFor();
  assert.equal(uploadPayload.kind, "avatar_image");
});

test("V2-D shows real status blockers and provides deterministic 1440, 768, and 390 list-detail focus", async (t) => {
  const world = await createWorld(t);
  if (world.skipped) return t.skip(world.skipped);
  const page = await world.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await loginAndOpenAssets(page, world.origin);

  const screenshotDir = "/private/tmp/hifly-v2-d-assets-screenshots-20260817";
  await mkdir(screenshotDir, { recursive: true });
  const screenshots = [];
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole("button", { name: /商品图片/ }).click();
    const target = path.join(screenshotDir, `assets-${viewport.width}.png`);
    await page.screenshot({ path: target, fullPage: true });
    screenshots.push([target, viewport.width]);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  }
  for (const [file, expectedWidth] of screenshots) assert.equal(pngSize(await readFile(file)).width, expectedWidth);

  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.notEqual((await page.locator(".asset-workspace").evaluate((node) => getComputedStyle(node).gridTemplateColumns)), "none");
  await page.getByRole("button", { name: /损坏商品图/ }).click();
  await page.getByText("核验失败", { exact: true }).first().waitFor();
  await page.getByText("文件内容不是支持的图片格式", { exact: false }).first().waitFor();
  await page.getByRole("button", { name: /已停用商品图/ }).click();
  await page.getByText("已停用", { exact: true }).first().waitFor();
  assert.equal(await page.getByRole("button", { name: "上传新版本" }).count(), 0);

  await page.getByRole("button", { name: /人物图片/ }).click();
  await page.getByText("等待上传", { exact: true }).waitFor();
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await page.locator("#refreshAssets").evaluate((node) => parseFloat(getComputedStyle(node).transitionDuration) <= 0.001), true);

  for (const viewport of [{ width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const row = page.getByRole("button", { name: /人物立绘/ });
    await row.click();
    await page.getByRole("heading", { name: "人物立绘.png", exact: true }).waitFor();
    assert.equal(await page.locator("#assetListPanel").isVisible(), false);
    assert.equal(await page.locator("#assetDetailPanel").isVisible(), true);
    assert.equal(await page.evaluate(() => document.activeElement?.id), "assetDetailTitle");
    await page.getByRole("button", { name: "返回素材列表" }).click();
    assert.equal(await page.locator("#assetListPanel").isVisible(), true);
    assert.equal(await row.evaluate((node) => node === document.activeElement), true);
  }
});

test("V2-D recovers initial load failure and preserves rename input across optimistic conflict", async (t) => {
  const world = await createWorld(t);
  if (world.skipped) return t.skip(world.skipped);
  const page = await world.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let failNextList = true;
  await page.route("**/api/assets", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/assets" && failNextList) {
      failNextList = false;
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "TEMPORARY_FAILURE" }) });
    }
    return route.continue();
  });
  await loginAndOpenAssets(page, world.origin);
  await page.getByText("素材加载失败", { exact: true }).waitFor();
  assert.equal(await page.getByText("正在加载素材...", { exact: true }).count(), 0);
  assert.equal(await page.locator('#refreshAssets[data-recommended-action="true"]').count(), 1);
  await page.getByRole("button", { name: "刷新当前分类" }).click();
  await page.getByRole("button", { name: /商品主图/ }).waitFor();
  failNextList = true;
  await page.getByRole("button", { name: "刷新当前分类" }).click();
  await page.getByText("最新服务端状态暂不可用", { exact: true }).waitFor();
  await page.getByRole("button", { name: /商品主图/ }).waitFor();
  assert.equal(await page.locator('#refreshAssets[data-recommended-action="true"]').count(), 1);
  await page.getByRole("button", { name: "刷新当前分类" }).click();
  await page.getByRole("button", { name: /商品主图/ }).waitFor();

  let patchAttempts = 0;
  await page.route("**/api/assets/*", async (route) => {
    const request = route.request();
    if (request.method() === "PATCH" && patchAttempts++ === 0) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "ASSET_VERSION_CONFLICT" }) });
    return route.continue();
  });
  await page.getByRole("button", { name: /商品主图/ }).click();
  await page.getByRole("button", { name: "重命名" }).click();
  await page.getByLabel("素材名称").fill("我尚未保存的新名称");
  await page.getByRole("button", { name: "保存名称" }).click();
  await page.getByText("你的名称仍保留", { exact: false }).waitFor();
  assert.equal(await page.getByLabel("素材名称").inputValue(), "我尚未保存的新名称");
  assert.equal(await page.getByRole("button", { name: "保存名称" }).isDisabled(), true);
  await page.getByRole("button", { name: "载入最新素材状态" }).click();
  await page.getByText("已载入最新状态", { exact: false }).waitFor();
  assert.equal(await page.getByLabel("素材名称").inputValue(), "我尚未保存的新名称");
  assert.equal(await page.getByRole("button", { name: "保存名称" }).isEnabled(), true);
  await page.getByRole("button", { name: "保存名称" }).click();
  await page.getByText("素材名称已保存", { exact: false }).waitFor();
  await page.getByRole("heading", { name: "我尚未保存的新名称", exact: true }).waitFor();
});

test("V2-D retries the full bootstrap after an initial identity failure", async (t) => {
  const world = await createWorld(t);
  if (world.skipped) return t.skip(world.skipped);
  const page = await world.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await login(page, world.origin);
  let assetAuthRequests = 0;
  let authFailures = 0;
  await page.route("**/api/auth/me", async (route) => {
    const requestPage = new URL(route.request().headers().referer).pathname;
    if (requestPage === "/assets.html") assetAuthRequests += 1;
    if (requestPage === "/assets.html" && assetAuthRequests === 2 && authFailures === 0) {
      authFailures += 1;
      return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "TEMPORARY_IDENTITY_FAILURE" }) });
    }
    return route.continue();
  });

  await page.goto(`${world.origin}/assets.html`);
  await page.getByText("素材加载失败", { exact: true }).waitFor();
  assert.equal(authFailures, 1);
  await page.getByRole("button", { name: "重新加载素材中心" }).click();
  await page.getByRole("button", { name: /商品主图/ }).click();
  assert.equal(await page.getByRole("button", { name: "停用", exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "删除", exact: true }).count(), 1);
});

test("V2-D does not poll forever when only a historical version is pending", async (t) => {
  const world = await createWorld(t, { seedCurrentPending: false });
  if (world.skipped) return t.skip(world.skipped);
  const historical = await seedImageAsset(world.app, { kind: "avatar_image", filename: "历史待上传.png", actorMemberId: world.actorMemberId, verify: "pending" });
  await seedImageAsset(world.app, { kind: "avatar_image", filename: "当前已核验.png", actorMemberId: world.actorMemberId, assetId: historical.asset.id });
  const page = await world.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  let listRequests = 0;
  await page.route("**/api/assets", async (route) => {
    if (route.request().method() === "GET") listRequests += 1;
    return route.continue();
  });

  await loginAndOpenAssets(page, world.origin);
  await page.getByRole("button", { name: /人物图片/ }).click();
  await page.getByRole("button", { name: /当前已核验/ }).waitFor();
  await page.waitForTimeout(2500);
  assert.equal(listRequests, 1);
});

test("V2-D restores stable focus and context after successful asset mutations", async (t) => {
  const world = await createWorld(t, { seedCurrentPending: false });
  if (world.skipped) return t.skip(world.skipped);
  const page = await world.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await loginAndOpenAssets(page, world.origin);

  await page.getByRole("button", { name: /商品主图/ }).click();
  await page.getByRole("button", { name: "重命名" }).click();
  await page.getByLabel("素材名称").fill("已更新商品主图");
  await page.getByRole("button", { name: "保存名称" }).click();
  await page.getByText("素材名称已保存", { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.action), "rename");

  await page.getByRole("button", { name: "上传新版本" }).click();
  await page.getByLabel("图片文件").setInputFiles(world.uploadPath);
  await page.getByRole("button", { name: "上传并开始核验" }).last().click();
  await page.getByText("上传完成，服务端正在核验", { exact: false }).first().waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "assetDetailTitle");
  await page.getByRole("heading", { name: "已更新商品主图", exact: true }).waitFor();

  await page.getByRole("button", { name: /人物图片/ }).click();
  await page.getByRole("button", { name: /人物立绘/ }).click();
  await page.getByRole("button", { name: "停用", exact: true }).click();
  await page.getByRole("button", { name: "确认停用" }).click();
  await page.locator("#assetNotice").getByText("素材已停用。", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "assetDetailTitle");

  await page.getByRole("button", { name: /商品图片/ }).click();
  await page.getByRole("button", { name: /损坏商品图/ }).click();
  await page.getByRole("button", { name: "删除", exact: true }).click();
  await page.getByRole("button", { name: "确认删除" }).click();
  await page.locator("#assetNotice").getByText("素材已删除。", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.kind), "product_image");
});

test("V2-D aligns the available-state summary with one real recommended action", async (t) => {
  const world = await createWorld(t, { seedCurrentPending: false });
  if (world.skipped) return t.skip(world.skipped);
  const page = await world.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await loginAndOpenAssets(page, world.origin);

  await page.getByRole("button", { name: /商品主图/ }).click();
  assert.equal(await page.locator("#summaryNext").textContent(), "上传新的图片版本");
  assert.equal(await page.locator('#uploadNewVersion[data-recommended-action="true"]').count(), 1);
  assert.equal(await page.locator('[data-action="download-version"][data-recommended-action="true"]').count(), 0);

  await page.getByRole("button", { name: /作品视频/ }).click();
  await page.getByRole("button", { name: /系统登记作品/ }).click();
  assert.equal(await page.locator("#summaryNext").textContent(), "下载系统登记作品");
  assert.equal(await page.locator('[data-action="download-version"][data-recommended-action="true"]').count(), 1);
  assert.equal(await page.locator('[data-recommended-action="true"]').count(), 1);
});

test("V2-D ordinary members keep image rename but never receive admin or work-video mutation controls", async (t) => {
  const world = await createWorld(t);
  if (world.skipped) return t.skip(world.skipped);
  const page = await world.browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await loginAndOpenAssets(page, world.origin);
  await page.route("**/api/auth/me", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    return route.fulfill({ response, json: { ...body, membership: { ...body.membership, role: "member" } } });
  });
  await page.reload();
  await page.getByRole("button", { name: /商品主图/ }).click();
  assert.equal(await page.getByRole("button", { name: "重命名", exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "停用", exact: true }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "删除", exact: true }).count(), 0);
  await page.getByRole("button", { name: /作品视频/ }).click();
  await page.getByRole("button", { name: /系统登记作品/ }).click();
  for (const action of ["上传新版本", "重命名", "停用", "删除"]) assert.equal(await page.getByRole("button", { name: action, exact: true }).count(), 0);
});
