import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chromium } from "playwright";

import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { createMemoryIdentityRepository } from "../src/identity/memory-identity-repository.js";
import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { buildApp } from "../src/server/app.js";
import { findAvailablePort } from "../src/server/start.js";

const PNG_A = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const PNG_B = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGP4zwAAAgEBAScY42YAAAAASUVORK5CYII=", "base64");
const ORGANIZATION_ID = "org-single-workspace-assets-closeout";
const ADMIN_EMAIL = "assets-closeout@example.test";
const ADMIN_TEMP_PASSWORD = "Temporary-Assets-Closeout-9!";
const ADMIN_PASSWORD = "Assets-Closeout-Browser-Password-9!";

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function assertPngSize(buffer, width, height) {
  assert.equal(buffer.toString("ascii", 1, 4), "PNG");
  assert.equal(buffer.readUInt32BE(16), width);
  assert.equal(buffer.readUInt32BE(20), height);
}

async function seedImage(app, { key, kind, filename, body }) {
  const actor = { organizationId: ORGANIZATION_ID, actorMemberId: app.seededMemberId };
  const created = await app.assets.service.createUploadAuthorization({
    ...actor,
    idempotencyKey: `${key}-authorize`,
    filename,
    contentType: "image/png",
    size: body.length,
    checksumSha256: sha256(body),
    assetKind: kind
  });
  await app.assets.service.uploadObject({
    organizationId: ORGANIZATION_ID,
    uploadToken: created.upload.token,
    body,
    contentType: "image/png"
  });
  await app.assets.service.completeUpload({
    ...actor,
    uploadSessionId: created.upload_session_id,
    idempotencyKey: `${key}-complete`
  });
  await app.assets.service.runNextVerificationJob();
  return created;
}

async function launchBrowser() {
  try {
    return await chromium.launch({
      headless: true,
      executablePath: process.env.IDENTITY_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    });
  } catch (error) {
    if (error.message.includes("Executable doesn't exist") || error.message.includes("browserType.launch")) return null;
    throw error;
  }
}

async function createWorld(t, { projectContentEnabled = false, assetsEnabled = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-assets-mobile-closeout-"));
  const port = await findAvailablePort(59650);
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const identityRepository = createMemoryIdentityRepository();
  const assetRepository = createMemoryAssetRepository();
  const objectStore = createMemoryObjectStore();
  const seeded = await seedInitialAdmin(identityRepository, {
    organizationId: ORGANIZATION_ID,
    organizationName: "素材移动收口团队",
    adminEmail: ADMIN_EMAIL,
    adminDisplayName: "素材管理员",
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
    ...(assetsEnabled ? { assets: { enabled: true, repository: assetRepository, objectStore, worker: { autoStart: false } } } : {}),
    ...(projectContentEnabled ? { projectContent: {
      enabled: true,
      repository: createMemoryProjectContentRepository(),
      ...(!assetsEnabled ? { assetReferencePort: { async bindAvailableVersion() { throw new Error("assets disabled"); } } } : {})
    } } : {})
  });
  app.seededMemberId = seeded.member.id;

  let product = null, avatarA = null, avatarB = null, video = null, videoBody = null;
  if (assetsEnabled) {
    product = await seedImage(app, {
      key: "closeout-product",
      kind: "product_image",
      filename: "防晒霜商品主图.png",
      body: PNG_A
    });
    avatarA = await seedImage(app, {
      key: "closeout-avatar-a",
      kind: "avatar_image",
      filename: "林小满人物图.png",
      body: PNG_A
    });
    avatarB = await seedImage(app, {
      key: "closeout-avatar-b",
      kind: "avatar_image",
      filename: "周言人物图.png",
      body: PNG_B
    });
    videoBody = Buffer.from("single-workspace-assets-read-only-video");
    const videoObjectKey = `${ORGANIZATION_ID}/work-videos/closeout.mp4`;
    await objectStore.put({
      key: videoObjectKey,
      body: videoBody,
      contentType: "video/mp4",
      metadata: { organizationId: ORGANIZATION_ID }
    });
    video = await app.assets.service.verifiedOutputAssetPort.registerVerifiedOutput({
      organizationId: ORGANIZATION_ID,
      actorMemberId: seeded.member.id,
      candidate: {
        id: "candidate-assets-mobile-closeout",
        object_key: videoObjectKey,
        original_filename: "只读成片.mp4",
        media_type: "video/mp4",
        size: videoBody.length,
        checksum: sha256(videoBody)
      },
      now: "2026-08-25T08:00:00.000Z"
    });
  }

  try {
    await app.listen({ host: "127.0.0.1", port });
  } catch (error) {
    await app.close();
    if (error.code === "EPERM") {
      await rm(root, { recursive: true, force: true });
      return { skipped: "sandbox disallows local TCP listening" };
    }
    throw error;
  }
  const browser = await launchBrowser();
  if (!browser) {
    await app.close();
    await rm(root, { recursive: true, force: true });
    return { skipped: "Chrome/Chromium is unavailable" };
  }
  t.after(async () => {
    await browser.close();
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  return {
    app,
    browser,
    origin,
    root,
    objectStore,
    actorMemberId: seeded.member.id,
    product,
    avatarA,
    avatarB,
    video,
    videoBody
  };
}

async function authenticate(page, origin) {
  await page.goto(`${origin}/login.html`);
  await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("heading", { name: "设置新密码" }).waitFor();
  await page.locator("#newPassword").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "保存并进入工作台" }).click();
  await page.waitForURL((url) => url.origin === origin && url.pathname !== "/login.html");
}

function assetsUrl(origin, kind = null, assetId = null) {
  const url = new URL("/assets.html", origin);
  if (kind) url.searchParams.set("kind", kind);
  if (assetId) url.searchParams.set("asset", assetId);
  return url.href;
}

async function waitForAssetList(page) {
  await page.locator("#assetList .asset-row").first().waitFor();
  await page.locator("#refreshAssets").waitFor();
}

async function assertCanonicalDetail(page, origin, kind, asset) {
  await page.goto(assetsUrl(origin, kind, asset.asset.id));
  await page.getByRole("heading", { name: asset.asset.display_name, exact: true }).waitFor({ timeout: 5000 });
  assert.equal(await page.locator(`[data-kind="${kind}"]`).getAttribute("aria-current"), "true");
  assert.equal(new URL(page.url()).search, `?kind=${kind}&asset=${asset.asset.id}`);
  assert.equal(await page.locator(`button.asset-row[data-asset-id="${asset.asset.id}"]`).getAttribute("aria-current"), "true");
}

async function assertNoSelectedAuthority(page) {
  await page.getByText("选择一个素材查看详情", { exact: true }).waitFor({ state: "attached" });
  assert.equal(await page.locator("#assetList .asset-row[aria-current=true]").count(), 0);
  assert.equal(await page.locator("#assetDetail [data-action]").count(), 0);
  assert.equal(await page.locator("#assetDetail img[data-preview-role=detail]").count(), 0);
}

async function responseSha(page, origin, source) {
  const response = await page.request.get(new URL(source, origin).href);
  assert.equal(response.status(), 200);
  return sha256(await response.body());
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function withTimeout(promise, message, timeoutMs = 4000) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function settleBrowserFrames(page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function refreshAssetsBehindDialog(page) {
  const response = page.waitForResponse((candidate) => candidate.request().method() === "GET" &&
    new URL(candidate.url()).pathname === "/api/assets");
  await page.evaluate(() => document.querySelector("#refreshAssets").click());
  await response;
  await page.waitForFunction(() => !document.querySelector("#refreshAssets")?.disabled);
  await settleBrowserFrames(page);
}

test("Assets canonical routes restore exact type and Asset while invalid routes fail closed", async (t) => {
  const world = await createWorld(t);
  if (world.skipped) return t.skip(world.skipped);
  const page = await world.browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await authenticate(page, world.origin);

  await page.goto(assetsUrl(world.origin));
  await waitForAssetList(page);
  assert.equal(new URL(page.url()).search, "");
  assert.equal(await page.locator('[data-kind="product_image"]').getAttribute("aria-current"), "true");
  await assertNoSelectedAuthority(page);

  for (const [kind, asset] of [
    ["product_image", world.product],
    ["avatar_image", world.avatarA],
    ["work_video", world.video]
  ]) await assertCanonicalDetail(page, world.origin, kind, asset);

  await page.goto(assetsUrl(world.origin, "product_image", world.avatarA.asset.id));
  await waitForAssetList(page);
  assert.equal(await page.locator('[data-kind="product_image"]').getAttribute("aria-current"), "true");
  await assertNoSelectedAuthority(page);

  await page.goto(assetsUrl(world.origin, "avatar_image", "unknown-asset"));
  await waitForAssetList(page);
  assert.equal(await page.locator('[data-kind="avatar_image"]').getAttribute("aria-current"), "true");
  await assertNoSelectedAuthority(page);

  await page.goto(assetsUrl(world.origin, "unknown_kind", world.product.asset.id));
  await waitForAssetList(page);
  assert.equal(await page.locator('[data-kind="product_image"]').getAttribute("aria-current"), "true");
  await assertNoSelectedAuthority(page);
});

test("synced public avatar thumbnail keeps exact PNG bytes in the Assets center at all viewports", async (t) => {
  const world = await createWorld(t);
  if (world.skipped) return t.skip(world.skipped);
  const publicThumbnail = await world.app.assets.service.registerPublicAvatarThumbnail({
    organizationId: ORGANIZATION_ID,
    providerKey: "hifly-public:assets-browser-thumbnail",
    displayName: "公共同步人物",
    bytes: PNG_A,
    mediaType: "image/png",
    size: PNG_A.length,
    checksumSha256: sha256(PNG_A)
  });
  const page = await world.browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await authenticate(page, world.origin);

  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(assetsUrl(world.origin, "avatar_image"));
    await waitForAssetList(page);
    const row = page.locator(`button.asset-row[data-asset-id="${publicThumbnail.asset.id}"]`);
    await row.click();
    await page.getByRole("heading", { name: "公共同步人物", exact: true }).waitFor();
    await page.locator('#assetDetail [data-preview-state="ready"]').waitFor();
    const source = await page.locator("#assetPreviewImage").getAttribute("src");
    assert.match(source, /^\/api\/assets\/downloads\//);
    assert.equal(await responseSha(page, world.origin, source), sha256(PNG_A));
    assert.equal(await page.locator("body").textContent().then((value) => value.includes("hifly-public:assets-browser-thumbnail")), false);
    assert.equal(await page.locator("body").textContent().then((value) => value.includes("object_key")), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.equal(await page.evaluate((assetId) => document.activeElement?.dataset.assetId === assetId ||
      document.activeElement?.id === "assetDetailTitle", publicThumbnail.asset.id), true);
  }
});

test("avatar list and detail reuse one real generic download grant and ignore stale preview authority", async (t) => {
  const world = await createWorld(t);
  if (world.skipped) return t.skip(world.skipped);
  const page = await world.browser.newPage({ viewport: { width: 1440, height: 900 } });
  await authenticate(page, world.origin);

  const staleAvatarStarted = deferred();
  const releaseStaleAvatar = deferred();
  const staleAvatarFulfilled = deferred();
  let staleAvatarArmed = false;
  let staleAvatarUrl = null;
  const grants = [];
  t.after(() => releaseStaleAvatar.resolve());
  await page.route("**/api/asset-versions/*/download-authorizations", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const versionId = decodeURIComponent(pathname.split("/").at(-2));
    const response = await route.fetch();
    const body = await response.json();
    grants.push({ versionId, body });
    const held = versionId === world.avatarA.asset_version.id && staleAvatarArmed;
    if (held) {
      staleAvatarArmed = false;
      staleAvatarUrl = body.download.url;
      staleAvatarStarted.resolve();
      await releaseStaleAvatar.promise;
    }
    await route.fulfill({ response });
    if (held) staleAvatarFulfilled.resolve();
  });

  await page.goto(assetsUrl(world.origin, "avatar_image", world.avatarB.asset.id));
  await waitForAssetList(page);

  const avatarBRow = page.locator(`button.asset-row[data-asset-id="${world.avatarB.asset.id}"]`);
  await page.getByRole("heading", { name: world.avatarB.asset.display_name, exact: true }).waitFor();
  const listPreview = avatarBRow.locator(`img[data-preview-role="list"][data-asset-id="${world.avatarB.asset.id}"]`);
  const detailPreview = page.locator(`#assetPreviewImage[data-preview-role="detail"][data-asset-id="${world.avatarB.asset.id}"]`);
  await listPreview.waitFor();
  await detailPreview.waitFor();
  await page.waitForFunction((assetId) => {
    const previews = [...document.querySelectorAll(`img[data-asset-id="${CSS.escape(assetId)}"]`)];
    return previews.length >= 2 && previews.every((image) => image.complete && image.naturalWidth > 0);
  }, world.avatarB.asset.id);
  const listSource = await listPreview.getAttribute("src");
  const detailSource = await detailPreview.getAttribute("src");
  assert.equal(detailSource, listSource);
  assert.equal(await responseSha(page, world.origin, detailSource), sha256(PNG_B));

  const avatarBGrants = grants.filter((grant) => grant.versionId === world.avatarB.asset_version.id);
  assert.equal(avatarBGrants.length, 1, "list and detail must reuse one exact authorization for the current version");
  assert.equal(avatarBGrants[0].body.download.url, detailSource);
  assert.equal(JSON.stringify(avatarBGrants[0].body).includes("object_key"), false);

  const avatarARow = page.locator(`button.asset-row[data-asset-id="${world.avatarA.asset.id}"]`);
  const avatarAListPreview = avatarARow.locator(`img[data-preview-role="list"][data-asset-id="${world.avatarA.asset.id}"]`);
  await avatarAListPreview.waitFor();
  await page.waitForFunction((assetId) => {
    const image = document.querySelector(`img[data-preview-role="list"][data-asset-id="${CSS.escape(assetId)}"]`);
    return image?.complete && image.naturalWidth > 0;
  }, world.avatarA.asset.id);

  staleAvatarArmed = true;
  await avatarARow.click();
  await withTimeout(staleAvatarStarted.promise, "stale avatar authorization was not held");
  await avatarBRow.click();
  await page.getByRole("heading", { name: world.avatarB.asset.display_name, exact: true }).waitFor();
  assert.equal(await page.locator(`#assetPreviewImage[data-asset-id="${world.avatarA.asset.id}"]`).count(), 0);
  await detailPreview.waitFor({ timeout: 4000 });
  await page.waitForFunction((assetId) => {
    const previews = [...document.querySelectorAll(`img[data-asset-id="${CSS.escape(assetId)}"]`)];
    return previews.length >= 2 && previews.every((image) => image.complete && image.naturalWidth > 0);
  }, world.avatarB.asset.id, { timeout: 4000 });
  const sourceBeforeStaleRelease = await detailPreview.getAttribute("src");
  assert.equal(new URL(page.url()).searchParams.get("asset"), world.avatarB.asset.id);
  assert.notEqual(sourceBeforeStaleRelease, staleAvatarUrl,
    "new route authority must not wait for the old Asset authorization");
  assert.equal(await listPreview.getAttribute("src"), sourceBeforeStaleRelease);
  assert.equal(await responseSha(page, world.origin, sourceBeforeStaleRelease), sha256(PNG_B));
  releaseStaleAvatar.resolve();
  await withTimeout(staleAvatarFulfilled.promise, "held avatar authorization response was not released");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await detailPreview.getAttribute("src"), sourceBeforeStaleRelease,
    "a late authorization for the old Asset must not overwrite the current detail src");
  assert.equal(await page.locator(`#assetPreviewImage[data-asset-id="${world.avatarA.asset.id}"]`).count(), 0);

  const projection = await page.evaluate(async () => await (await fetch("/api/assets")).json());
  assert.equal(JSON.stringify(projection).includes("object_key"), false);
  assert.equal(projection.assets.find((asset) => asset.id === world.avatarB.asset.id).versions[0].id,
    world.avatarB.asset_version.id);
  assert.equal((await page.locator("body").innerText()).includes("object_key"), false);

  const staleListStarted = deferred();
  const releaseStaleList = deferred();
  const staleListFulfilled = deferred();
  let holdNextList = true;
  t.after(() => releaseStaleList.resolve());
  await page.route("**/api/assets", async (route) => {
    if (new URL(route.request().url()).pathname !== "/api/assets" || !holdNextList) return route.continue();
    holdNextList = false;
    const response = await route.fetch();
    staleListStarted.resolve();
    await releaseStaleList.promise;
    await route.fulfill({ response });
    staleListFulfilled.resolve();
  });
  await page.locator("#refreshAssets").click();
  await withTimeout(staleListStarted.promise, "refresh request was not held");
  await page.locator('[data-kind="work_video"]').click();
  assert.equal(new URL(page.url()).searchParams.get("kind"), "work_video");
  await withTimeout(
    page.locator(`button.asset-row[data-asset-id="${world.video.asset.id}"]`).waitFor(),
    "the replacement work-video read did not recover while the old list request was held"
  );
  assert.equal(await page.locator("#summaryKind").textContent(), "作品视频");
  releaseStaleList.resolve();
  await withTimeout(staleListFulfilled.promise, "held list response was not released");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(new URL(page.url()).searchParams.get("kind"), "work_video");
  assert.equal(new URL(page.url()).searchParams.has("asset"), false);
  assert.equal(await page.locator("#assetDetail img[data-preview-role=detail]").count(), 0,
    "a late list response must not restore the old preview authority");
});

test("avatar preview expiry and verified-byte drift clear stale src with a business fallback", async (t) => {
  const world = await createWorld(t);
  if (world.skipped) return t.skip(world.skipped);
  const page = await world.browser.newPage({ viewport: { width: 1440, height: 900 } });
  await authenticate(page, world.origin);

  let shortenNextAvatarGrant = true;
  await page.route("**/api/asset-versions/*/download-authorizations", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const versionId = decodeURIComponent(pathname.split("/").at(-2));
    if (versionId !== world.avatarB.asset_version.id || !shortenNextAvatarGrant) return route.continue();
    shortenNextAvatarGrant = false;
    const response = await route.fetch();
    const body = await response.json();
    body.download.expires_at = new Date(Date.now() + 700).toISOString();
    return route.fulfill({ response, json: body });
  });

  await page.goto(assetsUrl(world.origin, "avatar_image", world.avatarB.asset.id));
  const preview = page.locator("#assetPreviewRegion");
  const image = page.locator("#assetPreviewImage");
  await page.waitForFunction(() => document.querySelector("#assetPreviewRegion")?.dataset.previewState === "ready");
  assert.match(await image.getAttribute("src"), /^\/api\/assets\/downloads\/[^/]+$/);
  await page.waitForFunction(() => document.querySelector("#assetPreviewRegion")?.dataset.previewState === "expired");
  assert.equal(await image.getAttribute("src"), null);
  assert.match(await page.locator("#assetPreviewFallback").textContent(), /权限已过期/);
  assert.equal(await page.locator("#assetPreviewFallback").getAttribute("role"), "img");
  assert.match(await page.locator("#assetPreviewFallback").getAttribute("aria-label"), /周言人物图/);

  await page.locator("#retryAssetPreview").click();
  await page.waitForFunction(() => document.querySelector("#assetPreviewRegion")?.dataset.previewState === "ready");
  await world.objectStore.remove(world.avatarB.object_key);
  await world.objectStore.put({
    key: world.avatarB.object_key,
    body: Buffer.from("verified-bytes-drift"),
    contentType: "image/png",
    metadata: { organizationId: ORGANIZATION_ID }
  });
  const driftResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.startsWith("/api/assets/downloads/") && response.status() >= 400);
  await page.locator("#refreshAssets").click();
  assert.equal((await driftResponse).status() >= 400, true, "verified SHA drift must fail closed at the real bytes endpoint");
  await page.waitForFunction(() => document.querySelector("#assetPreviewRegion")?.dataset.previewState === "error");
  assert.equal(await image.getAttribute("src"), null);
  assert.match(await page.locator("#assetPreviewFallback").textContent(), /解码失败|暂不可用/);
  assert.equal(await page.locator('#uploadNewVersion[data-recommended-action="true"]').count(), 1,
    "preview failure must not replace the business next action");
  assert.equal(await preview.getAttribute("data-preview-state"), "error");

  await world.objectStore.remove(world.avatarB.object_key);
  await world.objectStore.put({
    key: world.avatarB.object_key,
    body: PNG_B,
    contentType: "image/png",
    metadata: { organizationId: ORGANIZATION_ID }
  });
  await page.route("**/api/assets/downloads/*", (route) => route.fulfill({
    status: 200,
    contentType: "image/png",
    body: Buffer.from("corrupt-image-body")
  }));
  const corruptResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname.startsWith("/api/assets/downloads/") && response.status() === 200);
  await page.locator("#retryAssetPreview").click();
  await corruptResponse;
  await page.waitForFunction(() => document.querySelector("#assetPreviewRegion")?.dataset.previewState === "error");
  assert.equal(await image.getAttribute("src"), null);
  assert.match(await page.locator("#assetPreviewFallback").textContent(), /解码失败/,
    "a corrupt HTTP 200 image must produce a decode fallback");
});

test("a scoped list failure revokes old detail, mutation, and preview authority until exact recovery", async (t) => {
  const world = await createWorld(t);
  if (world.skipped) return t.skip(world.skipped);
  const page = await world.browser.newPage({ viewport: { width: 390, height: 844 } });
  await authenticate(page, world.origin);
  await page.goto(assetsUrl(world.origin, "avatar_image", world.avatarA.asset.id));
  await page.getByRole("heading", { name: world.avatarA.asset.display_name, exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector("#assetPreviewRegion")?.dataset.previewState === "ready");
  assert.equal(await page.locator('[data-action="rename"]').count(), 1);
  await page.locator('[data-action="rename"]').click();

  let failNextList = true;
  await page.route("**/api/assets", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/assets" && failNextList) {
      failNextList = false;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "TEMPORARY_FAILURE" }) });
    }
    return route.continue();
  });
  await page.evaluate(() => document.querySelector("#refreshAssets").click());
  await page.getByText(/旧详情和操作权限已清除/).waitFor();
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.id === "refreshAssets");
  assert.equal(await page.locator("#assetListPanel").isVisible(), true);
  assert.equal(await page.locator("#assetDetailPanel").isVisible(), false);
  assert.equal(await page.locator("#refreshAssets").evaluate((node) => node === document.activeElement), true,
    "a revoked dialog trigger must fall back to the scoped refresh action");
  await assertNoSelectedAuthority(page);
  assert.equal(await page.locator("#assetList .asset-row:enabled").count(), 0);
  assert.equal(await page.locator('img[data-preview-role][src]').count(), 0);
  assert.equal(await page.locator('[data-recommended-action="true"]').count(), 1);
  assert.equal(await page.locator('#refreshAssets[data-recommended-action="true"]').count(), 1);

  await page.locator("#refreshAssets").click();
  await page.getByRole("heading", { name: world.avatarA.asset.display_name, exact: true }).waitFor();
  assert.equal(await page.locator("#assetDetailPanel").isVisible(), true);
  assert.equal(await page.locator('[data-action="rename"]').count(), 1);
  assert.equal(new URL(page.url()).searchParams.get("asset"), world.avatarA.asset.id);
});

test("Assets preserve desktop and tablet focus, dialog entry, screenshots, and one visible recommendation", async (t) => {
  const world = await createWorld(t);
  if (world.skipped) return t.skip(world.skipped);
  const page = await world.browser.newPage({ viewport: { width: 1440, height: 900 } });
  await authenticate(page, world.origin);
  const screenshotDir = "/private/tmp/hifly-issue-250-assets-screenshots";
  await mkdir(screenshotDir, { recursive: true });

  await page.goto(assetsUrl(world.origin, "product_image"));
  await waitForAssetList(page);
  const productRow = page.locator(`button.asset-row[data-asset-id="${world.product.asset.id}"]`);
  assertPngSize(await page.screenshot({ path: path.join(screenshotDir, "assets-list-1440.png") }), 1440, 900);
  await productRow.click();
  assert.equal(await productRow.evaluate((node) => node === document.activeElement), true);
  assertPngSize(await page.screenshot({ path: path.join(screenshotDir, "assets-product-detail-1440.png") }), 1440, 900);

  await page.locator('[data-action="rename"]').click();
  assert.equal(await page.locator("#assetDisplayName").evaluate((node) => node === document.activeElement), true);
  const refreshedBehindDialog = page.waitForResponse((response) => response.request().method() === "GET" &&
    new URL(response.url()).pathname === "/api/assets");
  await page.evaluate(() => document.querySelector("#refreshAssets").click());
  await refreshedBehindDialog;
  await page.waitForFunction(() => !document.querySelector("#refreshAssets")?.disabled &&
    Boolean(document.querySelector('#assetDetail [data-action="rename"]')));
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => document.activeElement?.dataset.action === "rename");
  assert.equal(await page.locator('[data-action="rename"]').evaluate((node) => node === document.activeElement), true);
  await page.locator('[data-action="disable"]').click();
  assert.equal(await page.locator("#dangerTitle").evaluate((node) => node === document.activeElement), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator('[data-action="disable"]').evaluate((node) => node === document.activeElement), true);
  await page.locator('[data-kind="product_image"]').click();
  await page.locator("#openUpload").click();
  assert.equal(await page.locator("#assetKind").evaluate((node) => node === document.activeElement), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#openUpload").evaluate((node) => node === document.activeElement), true);

  await page.goto(assetsUrl(world.origin, "avatar_image"));
  await waitForAssetList(page);
  await page.locator(`button.asset-row[data-asset-id="${world.avatarA.asset.id}"]`).click();
  await page.getByRole("heading", { name: world.avatarA.asset.display_name, exact: true }).waitFor();
  await page.locator('#assetDetail [data-preview-state="ready"]').waitFor();
  await settleBrowserFrames(page);
  const acceptedDesktopFrame = await page.screenshot({
    path: path.join(screenshotDir, "assets-avatar-detail-1440.png"),
    animations: "disabled"
  });
  await settleBrowserFrames(page);
  const repeatedDesktopFrame = await page.screenshot({ animations: "disabled" });
  assertPngSize(acceptedDesktopFrame, 1440, 900);
  assertPngSize(repeatedDesktopFrame, 1440, 900);
  assert.equal(sha256(acceptedDesktopFrame), sha256(repeatedDesktopFrame), "the saved 1440 avatar evidence must be byte stable");

  for (const viewport of [{ width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.goto(assetsUrl(world.origin, "avatar_image"));
    await waitForAssetList(page);
    const row = page.locator(`button.asset-row[data-asset-id="${world.avatarA.asset.id}"]`);
    assertPngSize(await page.screenshot({ path: path.join(screenshotDir, `assets-list-${viewport.width}.png`) }), viewport.width, viewport.height);
    await row.click();
    await page.getByRole("heading", { name: world.avatarA.asset.display_name, exact: true }).waitFor();
    await page.locator('#assetDetail [data-preview-state="ready"]').waitFor();
    assert.equal(await page.locator("#assetDetailTitle").evaluate((node) => node === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    assert.ok((await page.locator('[data-recommended-action="true"]:visible').count()) <= 1);
    if (viewport.width === 390) await page.locator("#assetDetailPanel").evaluate((node) => {
      const stickyHeight = document.querySelector(".app-sidebar")?.getBoundingClientRect().height || 0;
      const documentTop = node.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, documentTop - stickyHeight - 12));
    });
    assertPngSize(await page.screenshot({ path: path.join(screenshotDir, `assets-avatar-detail-${viewport.width}.png`) }), viewport.width, viewport.height);
    await page.locator("#backToAssets").click();
    assert.equal(await row.evaluate((node) => node === document.activeElement), true);
  }
});

test("390 route history and explicit back restore exact list focus without horizontal overflow", async (t) => {
  const world = await createWorld(t);
  if (world.skipped) return t.skip(world.skipped);
  const page = await world.browser.newPage({ viewport: { width: 390, height: 844 } });
  await authenticate(page, world.origin);
  await page.goto(assetsUrl(world.origin, "avatar_image"));
  await waitForAssetList(page);

  const row = page.locator(`button.asset-row[data-asset-id="${world.avatarA.asset.id}"]`);
  await row.click();
  await page.getByRole("heading", { name: world.avatarA.asset.display_name, exact: true }).waitFor();
  assert.equal(new URL(page.url()).search, `?kind=avatar_image&asset=${world.avatarA.asset.id}`);
  assert.equal(await page.locator("#assetListPanel").isVisible(), false);
  assert.equal(await page.locator("#assetDetailPanel").isVisible(), true);
  assert.equal(await page.locator("#assetDetailTitle").evaluate((node) => node === document.activeElement), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);

  await page.goBack();
  await page.waitForFunction(() => !new URL(location.href).searchParams.has("asset") &&
    getComputedStyle(document.querySelector("#assetListPanel")).display !== "none");
  assert.equal(new URL(page.url()).search, "?kind=avatar_image");
  assert.equal(await row.evaluate((node) => node === document.activeElement), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);

  await page.goForward();
  await page.waitForFunction((assetId) => new URL(location.href).searchParams.get("asset") === assetId &&
    document.activeElement?.id === "assetDetailTitle", world.avatarA.asset.id);
  assert.equal(await page.locator("#assetDetailPanel").isVisible(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);

  await page.locator("#backToAssets").click();
  await page.waitForFunction(() => !new URL(location.href).searchParams.has("asset") && document.activeElement?.dataset.assetId);
  assert.equal(await row.evaluate((node) => node === document.activeElement), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);

  await row.click();
  await page.getByRole("heading", { name: world.avatarA.asset.display_name, exact: true }).waitFor();
  await page.locator('#assetDetail [data-preview-state="ready"]').waitFor();

  const heldIdentity = deferred();
  const identityStarted = deferred();
  await page.route("**/api/auth/me", async (route) => {
    const response = await route.fetch();
    identityStarted.resolve();
    await heldIdentity.promise;
    await route.fulfill({ response });
  });
  const assetsRecovered = page.waitForResponse((response) => response.request().method() === "GET" &&
    new URL(response.url()).pathname === "/api/assets", { timeout: 4000 });
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await withTimeout(identityStarted.promise, "persisted pageshow must re-read identity");
  await assertNoSelectedAuthority(page);
  assert.equal(await page.locator("#assetListPanel").isVisible(), true);
  assert.equal(await page.locator("#assetDetailPanel").isVisible(), false);
  assert.equal(await page.locator('img[data-preview-role][src]').count(), 0);
  heldIdentity.resolve();
  await assetsRecovered;
  await page.getByRole("heading", { name: world.avatarA.asset.display_name, exact: true }).waitFor();
  await page.locator('#assetDetail [data-preview-state="ready"]').waitFor();
  assert.equal(new URL(page.url()).search, `?kind=avatar_image&asset=${world.avatarA.asset.id}`);
  await page.unroute("**/api/auth/me");

  let failNextIdentity = true;
  await page.route("**/api/auth/me", async (route) => {
    if (failNextIdentity) {
      failNextIdentity = false;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "TEMPORARY_FAILURE" }) });
    }
    return route.continue();
  });
  const identityFailed = page.waitForResponse((response) => response.request().method() === "GET" &&
    new URL(response.url()).pathname === "/api/auth/me" && response.status() === 503, { timeout: 4000 });
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  await identityFailed;
  await page.getByText("素材中心初始化失败，请重新加载身份与素材状态。", { exact: true }).waitFor();
  await page.waitForFunction(() => document.activeElement?.id === "refreshAssets");
  await assertNoSelectedAuthority(page);
  assert.equal(await page.locator("#assetListPanel").isVisible(), true);
  assert.equal(await page.locator("#assetDetailPanel").isVisible(), false);
  assert.equal(await page.locator("#refreshAssets").isVisible(), true);
  assert.equal(await page.locator("#refreshAssets").isEnabled(), true);
  assert.equal(await page.locator('#refreshAssets[data-recommended-action="true"]').count(), 1);

  const identityRecovered = page.waitForResponse((response) => response.request().method() === "GET" &&
    new URL(response.url()).pathname === "/api/auth/me" && response.status() === 200, { timeout: 4000 });
  const listRecovered = page.waitForResponse((response) => response.request().method() === "GET" &&
    new URL(response.url()).pathname === "/api/assets" && response.status() === 200, { timeout: 4000 });
  await page.locator("#refreshAssets").click();
  await Promise.all([identityRecovered, listRecovered]);
  await page.getByRole("heading", { name: world.avatarA.asset.display_name, exact: true }).waitFor();
  await page.locator('#assetDetail [data-preview-state="ready"]').waitFor();
  assert.equal(await page.locator("#assetDetailPanel").isVisible(), true);
  assert.equal(new URL(page.url()).search, `?kind=avatar_image&asset=${world.avatarA.asset.id}`);
  await page.unroute("**/api/auth/me");
});

test("work videos expose no mutations and danger 409 requires reload plus a new confirmation", async (t) => {
  const world = await createWorld(t);
  if (world.skipped) return t.skip(world.skipped);
  const page = await world.browser.newPage({ viewport: { width: 1440, height: 900 } });
  await authenticate(page, world.origin);
  await page.goto(assetsUrl(world.origin));
  await waitForAssetList(page);

  let workVideoMutations = 0;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.includes(world.video.asset.id) && ["POST", "PATCH", "DELETE", "PUT"].includes(request.method())) workVideoMutations += 1;
  });
  await page.locator('[data-kind="work_video"]').click();
  await page.locator(`button.asset-row[data-asset-id="${world.video.asset.id}"]`).click();
  await page.getByRole("heading", { name: world.video.asset.display_name, exact: true }).waitFor();
  assert.equal(await page.locator("#openUpload").isVisible(), false);
  for (const action of ["upload-new-version", "rename", "disable", "delete"]) {
    assert.equal(await page.locator(`#assetDetail [data-action="${action}"]`).count(), 0);
  }
  assert.equal(await page.locator('#assetDetail [data-action="download-version"]').count(), 1);
  assert.equal(workVideoMutations, 0);

  await page.locator('[data-kind="product_image"]').click();
  await page.locator(`button.asset-row[data-asset-id="${world.product.asset.id}"]`).click();
  const disablePath = `/api/assets/${world.product.asset.id}/disable`;
  const bodies = [];
  await page.route(`**${disablePath}`, async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    bodies.push(route.request().postDataJSON());
    if (bodies.length === 1) {
      await world.app.assets.service.updateAssetMetadata({
        organizationId: ORGANIZATION_ID,
        assetId: world.product.asset.id,
        expectedRevision: 1,
        displayName: "并发更新后的商品主图",
        actorMemberId: world.actorMemberId
      });
      return route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ error: "ASSET_VERSION_CONFLICT" })
      });
    }
    return route.continue();
  });

  await page.locator('#assetDetail [data-action="disable"]').click();
  await page.locator("#confirmDanger").click();
  await page.locator("#dangerConflictActions").waitFor();
  assert.equal(await page.locator("#assetDangerDialog").evaluate((dialog) => dialog.open), true);
  assert.equal(await page.locator("#confirmDanger").isDisabled(), true);
  assert.deepEqual(bodies.map((body) => body.expected_revision), [1]);

  await page.locator("#reloadDanger").click();
  await page.getByText("并发更新后的商品主图", { exact: true }).first().waitFor();
  assert.equal(await page.locator("#assetDangerDialog").evaluate((dialog) => dialog.open), true);
  assert.equal(await page.locator("#confirmDanger").isEnabled(), true);
  assert.equal(bodies.length, 1, "reload must not replay the destructive command");

  await page.locator("#confirmDanger").click();
  await page.getByText("素材已停用。", { exact: true }).waitFor();
  assert.deepEqual(bodies.map((body) => body.expected_revision), [1, 2]);
  assert.equal(workVideoMutations, 0);
});

for (const invalidation of ["route", "refresh", "pagehide"]) {
  test(`a held exact-version download grant cannot trigger a stale download after ${invalidation}`, async (t) => {
    const world = await createWorld(t);
    if (world.skipped) return t.skip(world.skipped);
    const page = await world.browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await authenticate(page, world.origin);
    await page.goto(assetsUrl(world.origin, "work_video", world.video.asset.id));
    await page.getByRole("heading", { name: world.video.asset.display_name, exact: true }).waitFor();

    const authorizationStarted = deferred();
    const releaseAuthorization = deferred();
    const authorizationFulfilled = deferred();
    let downloadByteRequests = 0;
    t.after(() => releaseAuthorization.resolve());
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/assets/downloads/")) downloadByteRequests += 1;
    });
    await page.evaluate(() => {
      window.__assetDownloadLinkTriggers = 0;
      document.addEventListener("click", (event) => {
        if (event.composedPath().some((node) => node instanceof HTMLAnchorElement && node.hasAttribute("download"))) {
          window.__assetDownloadLinkTriggers += 1;
        }
      }, true);
    });
    await page.route("**/api/asset-versions/*/download-authorizations", async (route) => {
      const pathname = new URL(route.request().url()).pathname;
      const versionId = decodeURIComponent(pathname.split("/").at(-2));
      if (versionId !== world.video.asset_version.id) return route.continue();
      const response = await route.fetch();
      authorizationStarted.resolve();
      await releaseAuthorization.promise;
      try {
        await route.fulfill({ response });
      } catch (error) {
        if (!/abort|cancel|handled|closed/i.test(error.message)) throw error;
      } finally {
        authorizationFulfilled.resolve();
      }
    });

    await page.locator(`[data-action="download-version"][data-version-id="${world.video.asset_version.id}"]`).click();
    await withTimeout(authorizationStarted.promise, "exact work-video download authorization was not held");
    if (invalidation === "route") {
      await page.locator('[data-kind="product_image"]').click();
      await settleBrowserFrames(page);
    } else if (invalidation === "refresh") {
      await refreshAssetsBehindDialog(page);
    } else {
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
      await settleBrowserFrames(page);
    }

    releaseAuthorization.resolve();
    await withTimeout(authorizationFulfilled.promise, "held download authorization was not released");
    await page.waitForTimeout(150);
    const staleState = await page.evaluate(() => ({
      linkTriggers: window.__assetDownloadLinkTriggers,
      notice: document.querySelector("#assetNotice")?.textContent || ""
    }));
    assert.deepEqual({
      downloadByteRequests,
      linkTriggers: staleState.linkTriggers,
      staleNotice: /已失效|状态已变化|重新.*下载|刷新.*重试/.test(staleState.notice)
    }, {
      downloadByteRequests: 0,
      linkTriggers: 0,
      staleNotice: true
    }, "a grant resolved outside its exact list/route/page authority must be discarded before link creation");
  });
}

async function exerciseStaleDangerIntent(t, invalidation) {
  const world = await createWorld(t);
  if (world.skipped) return t.skip(world.skipped);
  let pending = null;
  if (invalidation === "automatic refresh") {
    pending = await world.app.assets.service.createUploadAuthorization({
      organizationId: ORGANIZATION_ID,
      actorMemberId: world.actorMemberId,
      idempotencyKey: "danger-auto-refresh-pending",
      filename: "触发自动刷新.png",
      contentType: "image/png",
      size: PNG_A.length,
      checksumSha256: sha256(PNG_A),
      assetKind: "product_image"
    });
  }
  const page = await world.browser.newPage({ viewport: { width: 1440, height: 900 } });
  await authenticate(page, world.origin);
  await page.goto(assetsUrl(world.origin, "product_image", world.product.asset.id));
  await page.getByRole("heading", { name: world.product.asset.display_name, exact: true }).waitFor();

  const mutationPath = `/api/assets/${world.product.asset.id}/disable`;
  let mutationPosts = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === mutationPath) mutationPosts += 1;
  });
  await page.locator('[data-action="disable"]').click();
  if (invalidation === "manual refresh") {
    await refreshAssetsBehindDialog(page);
  } else if (invalidation === "automatic refresh") {
    const automaticRefresh = page.waitForResponse((candidate) => candidate.request().method() === "GET" &&
      new URL(candidate.url()).pathname === "/api/assets", { timeout: 5000 });
    await world.app.assets.service.uploadObject({
      organizationId: ORGANIZATION_ID,
      uploadToken: pending.upload.token,
      body: PNG_A,
      contentType: "image/png"
    });
    await world.app.assets.service.completeUpload({
      organizationId: ORGANIZATION_ID,
      actorMemberId: world.actorMemberId,
      uploadSessionId: pending.upload_session_id,
      idempotencyKey: "danger-auto-refresh-complete"
    });
    await world.app.assets.service.runNextVerificationJob();
    await automaticRefresh;
    await page.waitForFunction(() => !document.querySelector("#refreshAssets")?.disabled);
    await settleBrowserFrames(page);
  } else {
    const identityRead = page.waitForResponse((candidate) => candidate.request().method() === "GET" &&
      new URL(candidate.url()).pathname === "/api/auth/me");
    const listRead = page.waitForResponse((candidate) => candidate.request().method() === "GET" &&
      new URL(candidate.url()).pathname === "/api/assets");
    await page.evaluate(() => {
      window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
      window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
    });
    await Promise.all([identityRead, listRead]);
    await page.waitForFunction(() => !document.querySelector("#refreshAssets")?.disabled);
    await settleBrowserFrames(page);
  }
  await page.evaluate(() => document.querySelector("#confirmDanger").click());
  await page.waitForTimeout(100);
  const staleState = await page.evaluate(() => ({
    confirmDisabled: document.querySelector("#confirmDanger").disabled,
    reloadVisible: !document.querySelector("#dangerConflictActions").hidden,
    staleNotice: /状态已变化|已失效/.test(document.querySelector("#dangerError").textContent || "")
  }));
  assert.deepEqual({ ...staleState, mutationPosts }, {
    confirmDisabled: true,
    reloadVisible: true,
    staleNotice: true,
    mutationPosts: 0
  }, `${invalidation} must revoke the captured destructive revision before any POST`);

  await page.locator("#reloadDanger").click();
  await page.waitForFunction(() => !document.querySelector("#confirmDanger")?.disabled);
  const reboundPost = page.waitForRequest((request) => request.method() === "POST" &&
    new URL(request.url()).pathname === mutationPath);
  await page.locator("#confirmDanger").click();
  await reboundPost;
  assert.equal(mutationPosts, 1, "only the explicit reloadDanger rebind may authorize the POST");
}

for (const invalidation of ["manual refresh", "automatic refresh", "pagehide"]) {
  test(`${invalidation} stales a danger intent until reloadDanger explicitly rebinds it`, async (t) => {
    await exerciseStaleDangerIntent(t, invalidation);
  });
}

test("manual refresh stales a rename intent with zero writes until reloadRename rebinds it", async (t) => {
  const world = await createWorld(t);
  if (world.skipped) return t.skip(world.skipped);
  const page = await world.browser.newPage({ viewport: { width: 1440, height: 900 } });
  await authenticate(page, world.origin);
  await page.goto(assetsUrl(world.origin, "product_image", world.product.asset.id));
  await page.getByRole("heading", { name: world.product.asset.display_name, exact: true }).waitFor();

  let renamePatches = 0;
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (request.method() === "PATCH" && pathname === `/api/assets/${world.product.asset.id}`) renamePatches += 1;
  });

  await page.locator('[data-action="rename"]').click();
  await page.locator("#assetDisplayName").fill("刷新后仍需确认的名称");
  await refreshAssetsBehindDialog(page);
  await page.evaluate(() => document.querySelector("#renameForm").requestSubmit());
  await page.waitForTimeout(100);
  const renameState = await page.evaluate(() => ({
    submitDisabled: document.querySelector("#submitRename").disabled,
    reloadVisible: !document.querySelector("#renameConflictActions").hidden,
    draft: document.querySelector("#assetDisplayName").value,
    staleNotice: /状态已变化|已失效/.test(document.querySelector("#renameError").textContent || "")
  }));
  assert.deepEqual({ ...renameState, renamePatches }, {
    submitDisabled: true,
    reloadVisible: true,
    draft: "刷新后仍需确认的名称",
    staleNotice: true,
    renamePatches: 0
  }, "a rename draft may survive refresh but its write authority may not");

  await page.locator("#reloadRename").click();
  await page.waitForFunction(() => !document.querySelector("#submitRename")?.disabled);
  const renameRequest = page.waitForRequest((request) => request.method() === "PATCH" &&
    new URL(request.url()).pathname === `/api/assets/${world.product.asset.id}`);
  await page.locator("#submitRename").click();
  await renameRequest;
  assert.equal(renamePatches, 1);
  await page.getByText("素材名称已保存。", { exact: true }).waitFor();
});

test("manual refresh stales an upload intent with zero writes until the dialog is reopened", async (t) => {
  const world = await createWorld(t);
  if (world.skipped) return t.skip(world.skipped);
  const page = await world.browser.newPage({ viewport: { width: 1440, height: 900 } });
  await authenticate(page, world.origin);
  await page.goto(assetsUrl(world.origin, "product_image", world.product.asset.id));
  await page.getByRole("heading", { name: world.product.asset.display_name, exact: true }).waitFor();

  let uploadAuthorizations = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/assets/upload-authorizations") {
      uploadAuthorizations += 1;
    }
  });

  await page.locator("#uploadNewVersion").click();
  await page.locator("#assetFile").setInputFiles({ name: "stale-upload.png", mimeType: "image/png", buffer: PNG_B });
  await refreshAssetsBehindDialog(page);
  const uploadWasClosed = await page.locator("#uploadDialog").evaluate((dialog) => !dialog.open);
  if (!uploadWasClosed) await page.evaluate(() => document.querySelector("#uploadForm").requestSubmit());
  await page.waitForTimeout(100);
  assert.equal(uploadAuthorizations, 0, "refresh must never consume a stale upload intent");
  if (!uploadWasClosed) {
    await page.locator('#uploadDialog [data-close-dialog]').first().click();
    await page.waitForFunction(() => !document.querySelector("#uploadDialog")?.open);
  }
  await page.locator("#uploadNewVersion").click();
  await page.locator("#assetFile").setInputFiles({ name: "reopened-upload.png", mimeType: "image/png", buffer: PNG_B });
  const uploadRequest = page.waitForRequest((request) => request.method() === "POST" &&
    new URL(request.url()).pathname === "/api/assets/upload-authorizations");
  await page.locator("#submitUpload").click();
  await uploadRequest;
  assert.equal(uploadAuthorizations, 1, "only a reopened upload dialog may mint a new upload intent");
});

test("390 exact avatar detail mints only the selected version and never hidden list rows", async (t) => {
  const world = await createWorld(t);
  if (world.skipped) return t.skip(world.skipped);
  const page = await world.browser.newPage({ viewport: { width: 390, height: 844 } });
  await authenticate(page, world.origin);
  const grantedVersionIds = [];
  await page.route("**/api/asset-versions/*/download-authorizations", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    grantedVersionIds.push(decodeURIComponent(pathname.split("/").at(-2)));
    await route.continue();
  });

  await page.goto(assetsUrl(world.origin, "avatar_image", world.avatarB.asset.id));
  await page.getByRole("heading", { name: world.avatarB.asset.display_name, exact: true }).waitFor();
  assert.equal(await page.locator("#assetList .asset-row").count(), 2, "fixture must contain selected and hidden avatar rows");
  assert.equal(await page.locator("#assetListPanel").isVisible(), false);
  await page.waitForFunction(() => document.querySelector("#assetPreviewRegion")?.dataset.previewState === "ready");
  await page.waitForTimeout(150);
  assert.deepEqual(grantedVersionIds, [world.avatarB.asset_version.id],
    "the hidden sequential-layout list must mint zero grants");
});

test("an exact desktop avatar detail survives 390 and 768 resize layers before returning to both desktop panels", async (t) => {
  const world = await createWorld(t);
  if (world.skipped) return t.skip(world.skipped);
  const page = await world.browser.newPage({ viewport: { width: 1440, height: 900 } });
  await authenticate(page, world.origin);
  const exactUrl = assetsUrl(world.origin, "avatar_image", world.avatarB.asset.id);
  await page.goto(exactUrl);
  await page.getByRole("heading", { name: world.avatarB.asset.display_name, exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector("#assetPreviewRegion")?.dataset.previewState === "ready");
  assert.equal(await page.locator("#assetListPanel").isVisible(), true);
  assert.equal(await page.locator("#assetDetailPanel").isVisible(), true);

  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 900 }]) {
    await page.setViewportSize(viewport);
    await settleBrowserFrames(page);
    const state = await page.evaluate(() => ({
      url: location.href,
      listVisible: getComputedStyle(document.querySelector("#assetListPanel")).display !== "none",
      detailVisible: getComputedStyle(document.querySelector("#assetDetailPanel")).display !== "none",
      detailFocused: document.activeElement?.id === "assetDetailTitle",
      noOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth
    }));
    assert.deepEqual(state, {
      url: exactUrl,
      listVisible: false,
      detailVisible: true,
      detailFocused: true,
      noOverflow: true
    }, `${viewport.width}px must derive the detail layer from the exact selected route`);
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  await settleBrowserFrames(page);
  assert.deepEqual({
    url: page.url(),
    listVisible: await page.locator("#assetListPanel").isVisible(),
    detailVisible: await page.locator("#assetDetailPanel").isVisible(),
    noOverflow: await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
  }, {
    url: exactUrl,
    listVisible: true,
    detailVisible: true,
    noOverflow: true
  });
});

test("reduced-motion selected 1440 avatar screenshots are byte stable", async (t) => {
  const world = await createWorld(t);
  if (world.skipped) return t.skip(world.skipped);
  const page = await world.browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await authenticate(page, world.origin);
  await page.goto(assetsUrl(world.origin, "avatar_image", world.avatarB.asset.id));
  await page.getByRole("heading", { name: world.avatarB.asset.display_name, exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector("#assetPreviewRegion")?.dataset.previewState === "ready");
  assert.equal(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches), true);
  await settleBrowserFrames(page);
  const first = await page.screenshot({ animations: "disabled" });
  await settleBrowserFrames(page);
  const second = await page.screenshot({ animations: "disabled" });
  assertPngSize(first, 1440, 900);
  assertPngSize(second, 1440, 900);
  assert.equal(sha256(first), sha256(second), "the accepted 1440 avatar evidence frame must be reproducible");
});

test("enterprise, legacy, history, and direct assets-off routes close out at tablet and mobile widths", async (t) => {
  const world = await createWorld(t, { projectContentEnabled: true });
  if (world.skipped) return t.skip(world.skipped);
  const page = await world.browser.newPage({ viewport: { width: 768, height: 900 } });
  await authenticate(page, world.origin);
  assert.equal(new URL(page.url()).pathname, "/projects.html", "feature-on login must land on Projects");

  const assetsEnabled = true;
  await page.route("**/api/runtime", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      identityEnabled: true,
      projectContentEnabled: true,
      copyGenerationEnabled: true,
      avatarSelectionEnabled: true,
      videoPlanningEnabled: true,
      productionOrdersEnabled: true,
      worksEnabled: true,
      assetsEnabled
    })
  }));

  const enterpriseRoutes = [
    "/projects.html",
    "/project.html?id=project-closeout",
    "/copy.html?project=project-closeout&revision=revision-closeout",
    "/avatar.html?project=project-closeout&product=product-closeout",
    "/plan.html?project=project-closeout&product=product-closeout",
    "/production.html?project=project-closeout&product=product-closeout",
    "/works.html"
  ];
  for (const route of enterpriseRoutes) {
    await page.goto(`${world.origin}${route}`);
    await page.locator("#mainContent").waitFor();
    assert.equal(`${new URL(page.url()).pathname}${new URL(page.url()).search}`, route);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    assert.equal(await page.locator('[data-page="assets"]').evaluate((node) => node.hidden), false);
    if (/^\/(project|copy|avatar|plan|production)\.html/.test(route)) {
      const stages = page.locator('nav[aria-label="项目阶段"]');
      assert.equal(await stages.count(), 1, `${route} must preserve the Stage 1-5 workspace shell`);
      assert.equal(await stages.locator(":scope > *").count(), 5, `${route} must expose exactly five stages`);
    }
  }

  await page.goto(assetsUrl(world.origin, "avatar_image", world.avatarA.asset.id));
  await page.getByRole("heading", { name: world.avatarA.asset.display_name, exact: true }).waitFor();
  const exactAssetsUrl = page.url();
  await page.goto(`${world.origin}/works.html`);
  await page.goBack();
  await page.waitForURL(exactAssetsUrl);
  await page.getByRole("heading", { name: world.avatarA.asset.display_name, exact: true }).waitFor();
  await page.goForward();
  await page.waitForURL(`${world.origin}/works.html`);

  await page.goto(`${world.origin}/`);
  await page.waitForURL(`${world.origin}/projects.html`);
  await page.goto(`${world.origin}/index.html`);
  await page.getByRole("tab", { name: "批量录入" }).waitFor();
  assert.equal(await page.getByRole("tab", { name: "待执行任务" }).count(), 1);

  await page.goto(`${world.origin}/login.html`);
  await page.waitForURL(`${world.origin}/projects.html`);

  const assetsOffWorld = await createWorld(t, { projectContentEnabled: true, assetsEnabled: false });
  if (assetsOffWorld.skipped) return t.skip(assetsOffWorld.skipped);
  const assetsOffPage = await assetsOffWorld.browser.newPage({ viewport: { width: 390, height: 844 } });
  await authenticate(assetsOffPage, assetsOffWorld.origin);
  assert.equal(new URL(assetsOffPage.url()).pathname, "/projects.html");
  const runtime = await assetsOffPage.request.get(`${assetsOffWorld.origin}/api/runtime`);
  assert.equal((await runtime.json()).assetsEnabled, false);
  assert.equal(await assetsOffPage.locator('[data-page="assets"]').evaluate((node) => node.hidden), true,
    "real assets-off enterprise navigation must not advertise the Assets route");
  await assetsOffPage.goto(`${assetsOffWorld.origin}/assets.html`);
  await assetsOffPage.getByText("素材加载失败", { exact: true }).waitFor();
  assert.equal(await assetsOffPage.locator("#openUpload").isDisabled(), true);
  assert.equal(await assetsOffPage.locator("#assetList .asset-row:enabled").count(), 0);
  assert.equal(await assetsOffPage.locator("#assetDetail [data-action]").count(), 0);
  assert.equal(await assetsOffPage.locator('[data-page="assets"]').evaluate((node) => node.hidden), true);
});
