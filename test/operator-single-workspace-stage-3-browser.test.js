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
import { createMemoryAvatarSelectionRepository } from "../src/avatar-selection/memory-avatar-selection-repository.js";
import { createMemoryCopyGenerationRepository } from "../src/copy-generation/memory-copy-generation-repository.js";
import { createControlledCopyProvider } from "../src/copy-generation/controlled-provider.js";
import { createMemoryCopyQualityRepository } from "../src/copy-quality/memory-copy-quality-repository.js";
import { createControlledQualityEvaluator } from "../src/copy-quality/controlled-evaluator.js";
import { createControlledCopyRewriter } from "../src/copy-quality/controlled-rewriter.js";
import { createMemoryCopyReviewRepository } from "../src/copy-review/memory-copy-review-repository.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { createMemoryIdentityRepository } from "../src/identity/memory-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
import { buildApp } from "../src/server/app.js";
import { findAvailablePort } from "../src/server/start.js";
import { ADMIN_EMAIL, ADMIN_TEMP_PASSWORD } from "./helpers/identity-world.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const PNG_SHA = createHash("sha256").update(PNG).digest("hex");

async function uploadImage(assetService, actor, key, filename, kind) {
  const created = await assetService.createUploadAuthorization({ ...actor, idempotencyKey: `${key}-upload`,
    filename, contentType: "image/png", size: PNG.length, checksumSha256: PNG_SHA, assetKind: kind });
  await assetService.uploadObject({ organizationId: actor.organizationId, uploadToken: created.upload.token,
    body: PNG, contentType: "image/png" });
  await assetService.completeUpload({ ...actor, uploadSessionId: created.upload_session_id,
    idempotencyKey: `${key}-complete` });
  await assetService.runNextVerificationJob();
  return created;
}

async function readyProduct(service, actor, projectId, assetVersionId, key, name) {
  const created = await service.createProduct({ ...actor, projectId, idempotencyKey: key, productName: name });
  let revision = await service.saveRevision({ ...actor, productRevisionId: created.revision.id,
    expectedRevision: created.revision.revision_number, productName: name, productDescription: `${name}商品说明`,
    primaryCategory: "防晒护肤", contentBrief: { expression_style: "自然口语" },
    sellingPoints: [{ text: `${name}核心卖点` }], assetVersionIds: [assetVersionId] });
  revision = await service.confirmSellingPoint({ ...actor, productRevisionId: revision.id,
    pointId: revision.selling_points[0].id, expectedRevision: revision.revision_number });
  revision = await service.readyRevision({ ...actor, productRevisionId: revision.id,
    expectedRevision: revision.revision_number, idempotencyKey: `${key}-ready` });
  return { product: created.product, revision };
}

async function approveCopy(app, actor, revision, key) {
  await app.copyGeneration.service.requestGeneration({ ...actor, productRevisionId: revision.id,
    intent: "product_recommendation", idempotencyKey: `${key}-generate` });
  await app.copyGeneration.worker.runNext();
  const copies = await app.copyGeneration.service.listCopyVersions({ ...actor, productRevisionId: revision.id });
  const copy = copies.at(-1);
  await app.copyQuality.service.startQualityCheck({ ...actor, copyVersionId: copy.id,
    expectedRevision: copy.row_version, profileVersion: "commerce-cn-v1", ruleVersion: "rules-2026-08",
    idempotencyKey: `${key}-quality` });
  await app.copyQuality.worker.runNext();
  const submitted = await app.copyReview.service.submitReview({ ...actor, copyVersionId: copy.id,
    idempotencyKey: `${key}-review` });
  await app.copyReview.service.approveReview({ ...actor, actorRole: "admin", reviewId: submitted.current_review.id,
    expectedRevision: submitted.current_review.row_version, idempotencyKey: `${key}-approve` });
  return copy;
}

async function startWorld(t, portStart = 59400) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-single-workspace-stage-3-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(portStart);
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const organizationId = "org_single_workspace_stage_3";
  const identityRepository = createMemoryIdentityRepository();
  const seeded = await seedInitialAdmin(identityRepository, { organizationId, organizationName: "人物工作区团队",
    adminEmail: ADMIN_EMAIL, adminDisplayName: "人物管理员", adminTempPassword: ADMIN_TEMP_PASSWORD });
  const actor = { organizationId, actorMemberId: seeded.member.id };
  const assetRepository = createMemoryAssetRepository();
  const objectStore = createMemoryObjectStore();
  const assetService = createAssetService({ repository: assetRepository, objectStore });
  const productImage = await uploadImage(assetService, actor, "stage-3-product", "商品.png", "product_image");
  const avatarImageA = await uploadImage(assetService, actor, "stage-3-avatar-a", "人物甲.png", "avatar_image");
  const avatarImageB = await uploadImage(assetService, actor, "stage-3-avatar-b", "人物乙.png", "avatar_image");

  const app = await buildApp({
    root, executor: createFakeExecutor(),
    identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin],
      cookieSecure: false, seed: { enabled: false } },
    assets: { enabled: true, repository: assetRepository, objectStore, worker: { autoStart: false } },
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort: assetService.assetReferencePort },
    copyGeneration: { enabled: true, repository: createMemoryCopyGenerationRepository(), provider: createControlledCopyProvider(), worker: { autoStart: false } },
    copyQuality: { enabled: true, repository: createMemoryCopyQualityRepository(), evaluator: createControlledQualityEvaluator(), rewriter: createControlledCopyRewriter(), worker: { autoStart: false } },
    copyReview: { enabled: true, repository: createMemoryCopyReviewRepository() },
    avatarSelection: { enabled: true, repository: createMemoryAvatarSelectionRepository() },
    operatorWorkspace: { enabled: true }
  });
  const project = await app.projectContent.service.createProject({ ...actor, idempotencyKey: "stage-3-project",
    name: "夏日防晒推广", description: "人物选择" });
  const first = await readyProduct(app.projectContent.service, actor, project.id, productImage.asset_version.id,
    "stage-3-product-1", "清透防晒乳 SPF50+");
  const second = await readyProduct(app.projectContent.service, actor, project.id, productImage.asset_version.id,
    "stage-3-product-2", "云感保湿乳");
  const firstCopy = await approveCopy(app, actor, first.revision, "stage-3-copy-1");
  const secondCopy = await approveCopy(app, actor, second.revision, "stage-3-copy-2");
  const common = { ...actor, actorRole: "admin", description: "组织内受控人物素材。", authorizationStatus: "valid",
    authorizationExpiresAt: "2027-08-24T00:00:00.000Z", categoryTags: ["防晒护肤"],
    capabilities: [{ code: "hands_on_product", label: "手持商品图", evidenceReference: "controlled:test:stage-3" }] };
  const avatarA = await app.avatarSelection.service.registerEnterpriseAvatar({ ...common,
    materialAssetVersionId: avatarImageA.asset_version.id, displayName: "林小满" });
  const avatarB = await app.avatarSelection.service.registerEnterpriseAvatar({ ...common,
    materialAssetVersionId: avatarImageB.asset_version.id, displayName: "周言" });

  try { await app.listen({ host: "127.0.0.1", port }); }
  catch (error) { await app.close(); if (error.code === "EPERM") return null; throw error; }
  t.after(() => app.close());
  let browser;
  try {
    browser = await chromium.launch({ headless: true,
      executablePath: process.env.IDENTITY_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  } catch (error) {
    await app.close();
    if (error.message.includes("Executable doesn't exist") || error.message.includes("browserType.launch")) return null;
    throw error;
  }
  t.after(() => browser.close());
  return { app, browser, origin, project, first, second, firstCopy, secondCopy, avatarA, avatarB };
}

async function authenticate(page, origin) {
  await page.goto(`${origin}/login.html`);
  await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("heading", { name: "设置新密码" }).waitFor();
  await page.locator("#newPassword").fill("Single-Workspace-Stage-3-Password-9!");
  await page.getByRole("button", { name: "保存并进入工作台" }).click();
  await page.waitForURL(`${origin}/projects.html`);
}

function workspaceUrl(origin, projectId, productId) {
  const result = new URL("/workspace.html", origin);
  result.searchParams.set("project", projectId);
  result.searchParams.set("product", productId);
  result.searchParams.set("stage", "avatar");
  return result.href;
}

async function expectAction(page, code, label) {
  await page.waitForFunction(({ code, label }) => {
    const button = document.querySelector("#workspacePrimaryAction");
    return button?.dataset.actionCode === code && button.textContent.trim() === label;
  }, { code, label });
  assert.equal(await page.locator('[data-recommended-action="true"]').count(), 1);
}

test("Stage 3 shows exact secure previews and confirms an explicit Avatar selection", async (t) => {
  const setup = await startWorld(t);
  if (!setup) return t.skip("local Chrome or TCP listening is unavailable");
  const { app, browser, origin, project, first, avatarA } = setup;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await authenticate(page, origin);
  let selectionWrites = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && /\/api\/products\/[^/]+\/avatar-selections$/.test(new URL(request.url()).pathname)) selectionWrites += 1;
  });
  await page.goto(workspaceUrl(origin, project.id, first.product.id));
  await page.getByRole("heading", { name: "选择并确认人物" }).waitFor();
  await expectAction(page, "select_avatar", "选择人物");
  const avatarButton = page.locator(`[data-avatar-id="${avatarA.asset.id}"]`);
  await avatarButton.locator("img").waitFor();
  assert.equal(selectionWrites, 0);
  await avatarButton.click();
  await expectAction(page, "confirm_avatar_selection", "确认选择人物");
  assert.equal(selectionWrites, 0, "choosing a card must not submit");
  const thumbnailSource = await avatarButton.locator("img").getAttribute("src");
  const detailSource = await page.locator("#avatarPreviewImage").getAttribute("src");
  assert.equal(detailSource, thumbnailSource, "thumbnail and detail must use the same short-lived grant");
  assert.equal(await page.locator("body").textContent().then((value) => value.includes(avatarA.asset_version.material_asset_version_id)), false);

  await page.locator("#workspacePrimaryAction").click();
  const dialog = page.locator("#workspaceAvatarConfirmDialog");
  await dialog.getByRole("heading", { name: "确认人物选择" }).waitFor();
  assert.equal(await dialog.evaluate((element) => element.open), true);
  await dialog.getByRole("button", { name: "确认选择" }).click();
  assert.equal(selectionWrites, 1);
  await page.getByText("人物已确认", { exact: true }).first().waitFor();
  await expectAction(page, "continue_to_video_plan", "进入视频方案");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#mobileAvatarProductBack").click();
  await page.locator(`[data-product-id="${first.product.id}"]`).click();
  await avatarButton.click();
  assert.equal(await page.locator("body").getAttribute("data-avatar-mobile-layer"), "detail");
  assert.equal(await page.locator("#avatarDetailHeading").evaluate((element) => document.activeElement === element), true);
  await page.locator("#mobileAvatarDetailBack").click();
  assert.equal(await avatarButton.evaluate((element) => document.activeElement === element), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await page.locator("#workspaceActionBar").evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration) <= 0.001), true);

  const screenshotDir = process.env.STAGE_3_SCREENSHOTS_DIR;
  if (screenshotDir) {
    await mkdir(screenshotDir, { recursive: true });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      const image = await page.screenshot({ path: path.join(screenshotDir, `stage-3-avatar-${viewport.width}x${viewport.height}.png`) });
      assert.equal(image.readUInt32BE(16), viewport.width);
      assert.equal(image.readUInt32BE(20), viewport.height);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    }
  }
  assert.equal((await app.avatarSelection.repository.getSelectionState("org_single_workspace_stage_3", first.product.id)).current_selection.status, "confirmed");
});

test("Stage 3 fails visibly and recovers exact previews, conflicts, and dirty history navigation", async (t) => {
  const setup = await startWorld(t, 59450);
  if (!setup) return t.skip("local Chrome or TCP listening is unavailable");
  const { browser, origin, project, first, second, avatarA, avatarB } = setup;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await authenticate(page, origin);

  let bootstrapFailures = 0;
  let unsafeAction = false;
  const workspacePath = `/api/projects/${project.id}/products/${first.product.id}/operator-workspace`;
  await page.route("**/api/projects/*/products/*/operator-workspace?*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname === workspacePath && requestUrl.searchParams.get("stage") === "avatar" && bootstrapFailures === 0) {
      bootstrapFailures += 1;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "OPERATOR_WORKSPACE_UNAVAILABLE" }) });
    }
    if (requestUrl.pathname === workspacePath && requestUrl.searchParams.get("stage") === "avatar" && unsafeAction) {
      const response = await route.fetch();
      const body = await response.json();
      body.workspace.recommended_action = { code: "start_worker", stage: "production", kind: "command" };
      return route.fulfill({ response, contentType: "application/json", body: JSON.stringify(body) });
    }
    return route.continue();
  });
  let previewAFailures = 0;
  await page.route(`**/api/avatar-catalog/${avatarA.asset.id}/preview-authorizations`, (route) => {
    if (previewAFailures++ === 0) return route.fulfill({ status: 503, contentType: "application/json",
      body: JSON.stringify({ error: "AVATAR_PREVIEW_AUTHORIZATION_UNAVAILABLE" }) });
    return route.continue();
  });
  let previewBExpired = 0;
  await page.route(`**/api/avatar-catalog/${avatarB.asset.id}/preview-authorizations`, async (route) => {
    if (previewBExpired++ > 0) return route.continue();
    const response = await route.fetch();
    const body = await response.json();
    body.preview.expires_at = "2000-01-01T00:00:00.000Z";
    return route.fulfill({ response, body: JSON.stringify(body), contentType: "application/json" });
  });

  await page.goto(workspaceUrl(origin, project.id, first.product.id));
  await page.getByText("人物暂时无法读取", { exact: true }).waitFor();
  assert.equal(bootstrapFailures, 1);
  assert.equal(await page.locator('[data-stage-code][aria-disabled="true"]:not([href])').count(), 10);
  await expectAction(page, "retry_avatar_read", "刷新当前人物");
  await page.locator("#workspacePrimaryAction").click();
  await expectAction(page, "select_avatar", "选择人物");
  assert.match(await page.locator('[data-stage-code="avatar"]').first().getAttribute("href"),
    new RegExp(`^/workspace\\.html\\?project=${project.id}&product=${first.product.id}&stage=avatar&copy=`));

  unsafeAction = true;
  await page.locator("#refreshAvatarWorkspace").click();
  await page.getByText("人物暂时无法读取", { exact: true }).waitFor();
  assert.equal(await page.locator('[data-action-code="start_worker"]').count(), 0);
  assert.equal(await page.locator('[data-stage-code][aria-disabled="true"]:not([href])').count(), 10);
  await expectAction(page, "retry_avatar_read", "刷新当前人物");
  unsafeAction = false;
  await page.locator("#workspacePrimaryAction").click();
  await expectAction(page, "select_avatar", "选择人物");

  const avatarAButton = page.locator(`[data-avatar-id="${avatarA.asset.id}"]`);
  await avatarAButton.click();
  await page.locator("#avatarPreviewNotice").getByText("人物图片授权暂时失败，可以重试。", { exact: true }).waitFor();
  assert.equal(await page.locator("#avatarPreviewFallback span").textContent(), "林");
  await page.locator("#retryAvatarPreview").click();
  await page.locator("#avatarPreviewImage").waitFor();
  assert.equal(previewAFailures, 2);

  const avatarBButton = page.locator(`[data-avatar-id="${avatarB.asset.id}"]`);
  await avatarBButton.click();
  await page.locator("#avatarPreviewNotice").getByText("人物图片授权已过期，请重新获取。", { exact: true }).waitFor();
  await page.locator("#retryAvatarPreview").click();
  await page.locator("#avatarPreviewImage").waitFor();
  assert.equal(previewBExpired, 2);
  await expectAction(page, "confirm_avatar_selection", "确认选择人物");

  const idempotencyKeys = [];
  const selectionBodies = [];
  let selectionConflicts = 0;
  await page.route("**/api/products/*/avatar-selections", async (route) => {
    idempotencyKeys.push(route.request().headers()["idempotency-key"]);
    selectionBodies.push(route.request().postDataJSON());
    if (selectionConflicts++ === 0) return route.fulfill({ status: 409, contentType: "application/json",
      body: JSON.stringify({ error: "AVATAR_SELECTION_CONFLICT" }) });
    return route.continue();
  });
  await page.locator("#workspacePrimaryAction").click();
  await page.locator("#confirmWorkspaceAvatar").click();
  await page.getByText("人物选择已被其他成员更新，请载入最新状态后再确认。", { exact: true }).waitFor();
  assert.equal(await page.locator("#workspaceAvatarConfirmDialog").evaluate((element) => element.open), true);
  await page.locator("#loadLatestAvatarSelection").click();
  await page.getByText("已载入最新人物状态；本地选择仍保留，请重新确认。", { exact: true }).waitFor();
  await page.locator("#confirmWorkspaceAvatar").click();
  await page.getByText("人物已确认", { exact: true }).first().waitFor();
  assert.equal(idempotencyKeys.length, 2);
  assert.notEqual(idempotencyKeys[0], idempotencyKeys[1]);
  assert.equal(selectionBodies[0].asset_version_id, avatarB.asset_version.id);
  assert.equal(selectionBodies[1].asset_version_id, avatarB.asset_version.id);

  await avatarAButton.click();
  await expectAction(page, "confirm_avatar_selection", "确认选择人物");
  const secondProductButton = page.locator(`[data-product-id="${second.product.id}"]`);
  await secondProductButton.click();
  const pendingDialog = page.locator("#workspaceAvatarPendingDialog");
  assert.equal(await pendingDialog.evaluate((element) => element.open), true);
  await page.locator("#keepWorkspaceAvatarSelection").click();
  assert.equal(new URL(page.url()).searchParams.get("product"), first.product.id);
  await secondProductButton.click();
  await page.locator("#discardWorkspaceAvatarSelection").click();
  await page.waitForFunction((productId) => new URL(location.href).searchParams.get("product") === productId, second.product.id);
  await page.goBack();
  await page.waitForFunction((productId) => new URL(location.href).searchParams.get("product") === productId, first.product.id);
  await page.locator(`[data-avatar-id="${avatarA.asset.id}"]`).click();
  await page.goForward({ waitUntil: "domcontentloaded" }).catch(() => {});
  await pendingDialog.waitFor({ state: "visible" });
  await page.locator("#keepWorkspaceAvatarSelection").click();
  assert.equal(new URL(page.url()).searchParams.get("product"), first.product.id);
  await page.goForward({ waitUntil: "domcontentloaded" }).catch(() => {});
  await pendingDialog.waitFor({ state: "visible" });
  await page.locator("#discardWorkspaceAvatarSelection").click();
  await page.waitForFunction((productId) => new URL(location.href).searchParams.get("product") === productId, second.product.id);
  assert.equal(await page.locator('[data-recommended-action="true"]').count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
});
