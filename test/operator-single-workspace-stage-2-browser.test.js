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

async function readyProduct(service, actor, projectId, assetVersionId, key, name) {
  const created = await service.createProduct({ ...actor, projectId, idempotencyKey: key, productName: name });
  let revision = await service.saveRevision({
    ...actor, productRevisionId: created.revision.id, expectedRevision: created.revision.revision_number,
    productName: name, productDescription: `${name}商品说明`, primaryCategory: "防晒护肤",
    contentBrief: { expression_style: "自然口语" }, sellingPoints: [{ text: `${name}核心卖点` }],
    assetVersionIds: [assetVersionId]
  });
  revision = await service.confirmSellingPoint({
    ...actor, productRevisionId: revision.id, pointId: revision.selling_points[0].id, expectedRevision: revision.revision_number
  });
  revision = await service.readyRevision({
    ...actor, productRevisionId: revision.id, expectedRevision: revision.revision_number, idempotencyKey: `${key}-ready`
  });
  return { product: created.product, revision };
}

async function startWorld(t, portStart, { evaluateQuality } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-single-workspace-stage-2-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(portStart);
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const organizationId = "org_single_workspace_stage_2";
  const identityRepository = createMemoryIdentityRepository();
  const seeded = await seedInitialAdmin(identityRepository, {
    organizationId,
    organizationName: "文案工作区团队",
    adminEmail: ADMIN_EMAIL,
    adminDisplayName: "文案管理员",
    adminTempPassword: ADMIN_TEMP_PASSWORD
  });
  const assetRepository = createMemoryAssetRepository();
  const objectStore = createMemoryObjectStore();
  const assetService = createAssetService({ repository: assetRepository, objectStore });
  const uploaded = await assetService.createUploadAuthorization({
    organizationId, actorMemberId: seeded.member.id, idempotencyKey: "stage-2-product-image",
    filename: "清透防晒乳.png", contentType: "image/png", size: PNG.length,
    checksumSha256: createHash("sha256").update(PNG).digest("hex")
  });
  await assetService.uploadObject({ organizationId, uploadToken: uploaded.upload.token, body: PNG, contentType: "image/png" });
  await assetService.completeUpload({ organizationId, actorMemberId: seeded.member.id, uploadSessionId: uploaded.upload_session_id, idempotencyKey: "stage-2-product-image-complete" });
  await assetService.runNextVerificationJob();

  const app = await buildApp({
    root,
    executor: createFakeExecutor(),
    identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin], cookieSecure: false, seed: { enabled: false } },
    assets: { enabled: true, repository: assetRepository, objectStore, worker: { autoStart: false } },
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort: assetService.assetReferencePort },
    copyGeneration: { enabled: true, repository: createMemoryCopyGenerationRepository(), provider: createControlledCopyProvider(), worker: { autoStart: false } },
    copyQuality: { enabled: true, repository: createMemoryCopyQualityRepository(), evaluator: createControlledQualityEvaluator({ evaluate: evaluateQuality }), rewriter: createControlledCopyRewriter(), worker: { autoStart: false } },
    copyReview: { enabled: true, repository: createMemoryCopyReviewRepository() },
    operatorWorkspace: { enabled: true }
  });
  const actor = { organizationId, actorMemberId: seeded.member.id };
  const project = await app.projectContent.service.createProject({ ...actor, idempotencyKey: "stage-2-project", name: "夏日防晒推广", description: "短视频文案" });
  const first = await readyProduct(app.projectContent.service, actor, project.id, uploaded.asset_version.id, "stage-2-product-1", "清透防晒乳 SPF50+");
  const second = await readyProduct(app.projectContent.service, actor, project.id, uploaded.asset_version.id, "stage-2-product-2", "云感保湿乳");

  try { await app.listen({ host: "127.0.0.1", port }); }
  catch (error) { await app.close(); if (error.code === "EPERM") return null; throw error; }
  t.after(() => app.close());
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.IDENTITY_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
  } catch (error) {
    await app.close();
    if (error.message.includes("Executable doesn't exist") || error.message.includes("browserType.launch")) return null;
    throw error;
  }
  t.after(() => browser.close());
  return { app, browser, origin, project, first, second, actor };
}

async function authenticate(page, origin) {
  await page.goto(`${origin}/login.html`);
  await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("heading", { name: "设置新密码" }).waitFor();
  await page.locator("#newPassword").fill("Single-Workspace-Stage-2-Password-9!");
  await page.getByRole("button", { name: "保存并进入工作台" }).click();
  await page.waitForURL(`${origin}/projects.html`);
}

function url(origin, projectId, productId, copyId = null) {
  const result = new URL("/workspace.html", origin);
  result.searchParams.set("project", projectId);
  result.searchParams.set("product", productId);
  result.searchParams.set("stage", "copy");
  if (copyId) result.searchParams.set("copy", copyId);
  return result.href;
}

async function expectAction(page, code, label) {
  const action = page.locator("#workspacePrimaryAction");
  await action.waitFor();
  await page.waitForFunction(({ code, label }) => {
    const button = document.querySelector("#workspacePrimaryAction");
    return button?.dataset.actionCode === code && button.textContent.trim() === label;
  }, { code, label });
  assert.equal(await action.getAttribute("data-recommended-action"), "true");
  assert.equal(await page.locator('[data-recommended-action="true"]').count(), 1);
}

async function expectOneVisibleBrandAction(page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForTimeout(180);
  const actions = await page.evaluate(() => {
    const visible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return !element.hidden && style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const colorValue = (token) => {
      const probe = document.createElement("span");
      probe.style.color = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const brandColors = ["--brand", "--brand-hover", "--brand-pressed"].map(colorValue);
    const primary = document.querySelector("#workspacePrimaryAction");
    const primaryStyle = getComputedStyle(primary);
    const competitors = [...document.querySelectorAll("button:not(:disabled), a[href]")].filter((element) => {
      const style = getComputedStyle(element);
      return element !== primary && visible(element) && brandColors.includes(style.backgroundColor) && style.color === "rgb(255, 255, 255)";
    }).map((element) => ({ id: element.id, text: element.textContent.trim() }));
    return { primaryIsBrand: visible(primary) && brandColors.includes(primaryStyle.backgroundColor) && primaryStyle.color === "rgb(255, 255, 255)",
      primary: { visible: visible(primary), background: primaryStyle.backgroundColor, color: primaryStyle.color, brandColors }, competitors };
  });
  assert.equal(actions.primaryIsBrand, true, JSON.stringify(actions.primary));
  assert.deepEqual(actions.competitors, [], `Copy must not visually duplicate the fixed recommended action: ${JSON.stringify(actions.competitors)}`);
}

test("Stage 2 keeps Copy generation, QC, and human approval separate in one workspace", async (t) => {
  const setup = await startWorld(t, 59200);
  if (!setup) return t.skip("local Chrome or TCP listening is unavailable");
  const { app, browser, origin, project, first } = setup;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await authenticate(page, origin);
  await page.goto(url(origin, project.id, first.product.id));
  await page.getByRole("heading", { name: "完善并审核文案" }).waitFor();
  await expectAction(page, "request_copy_generation", "生成文案");
  await expectOneVisibleBrandAction(page);
  assert.equal(await page.locator("body").getAttribute("data-workspace-stage"), "copy");
  assert.equal(await page.locator('[data-stage-code="avatar"]').first().getAttribute("href"), `/avatar.html?project=${project.id}&product=${first.product.id}`);

  await page.locator("#workspacePrimaryAction").click();
  await page.getByText(/文案生成已排队|正在生成文案/).first().waitFor();
  assert.equal(await page.locator('[data-recommended-action="true"]').count(), 0);
  await app.runNextCopyGenerationJob();
  await page.getByText("文案草稿待质检", { exact: true }).first().waitFor({ timeout: 5000 });

  const editor = page.locator("#workspaceCopyBody");
  await editor.fill(`${await editor.inputValue()} 补充一句。`);
  await expectAction(page, "save_copy_draft", "保存当前修改");
  await page.locator("#workspacePrimaryAction").click();
  await page.getByText("文案草稿已保存。", { exact: true }).waitFor();
  await expectAction(page, "start_copy_quality", "开始质检");
  await page.locator("#workspacePrimaryAction").click();
  await page.getByText(/文案质检已排队|正在质检文案/).first().waitFor();
  await app.runNextCopyQualityJob();
  await page.getByText("质检已通过，待提交人工审核", { exact: true }).first().waitFor({ timeout: 5000 });
  assert.equal(await page.getByText("进入人物", { exact: true }).count(), 0, "QC passed must not appear as human approval");
  await expectAction(page, "submit_copy_review", "提交人工审核");

  await page.locator("#workspacePrimaryAction").click();
  await page.getByText("文案待人工审核", { exact: true }).first().waitFor();
  await expectAction(page, "approve_copy_review", "批准文案");
  await page.locator("#workspacePrimaryAction").click();
  await page.getByRole("heading", { name: "批准当前文案" }).waitFor();
  assert.equal(await page.locator("#workspaceApproveDialog").evaluate((dialog) => dialog.open), true);
  let approvalConflictHits = 0;
  await page.route("**/api/copy-reviews/*/approve", (route) => {
    if (approvalConflictHits === 0) {
      approvalConflictHits += 1;
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "COPY_REVIEW_CONFLICT" }) });
    }
    return route.continue();
  });
  await page.getByRole("button", { name: "确认批准" }).click();
  await page.getByText("状态已被其他人更新，请刷新当前文案。", { exact: true }).waitFor();
  assert.equal(await page.locator("#workspaceApproveDialog").evaluate((dialog) => dialog.open), true);
  await page.unroute("**/api/copy-reviews/*/approve");
  await page.getByRole("button", { name: "确认批准" }).click();
  await page.getByText("文案已批准", { exact: true }).first().waitFor();
  await expectAction(page, "continue_to_avatar", "进入人物");

  const qualityTab = page.locator("#workspaceQualityTab");
  const reviewTab = page.locator("#workspaceReviewTab");
  await qualityTab.focus();
  await qualityTab.press("ArrowRight");
  assert.equal(await reviewTab.getAttribute("aria-selected"), "true");
  assert.equal(await reviewTab.getAttribute("tabindex"), "0");
  assert.equal(await qualityTab.getAttribute("tabindex"), "-1");
  await reviewTab.press("Home");
  assert.equal(await qualityTab.getAttribute("aria-selected"), "true");

  const screenshotDir = process.env.STAGE_2_SCREENSHOTS_DIR;
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${viewport.width}px overflow`);
    if (screenshotDir) {
      const image = await page.screenshot({ path: path.join(screenshotDir, `stage-2-copy-approved-${viewport.width}x${viewport.height}.png`) });
      assert.equal(image.readUInt32BE(16), viewport.width);
      assert.equal(image.readUInt32BE(20), viewport.height);
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await page.locator("#workspaceActionBar").evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration) <= 0.001), true);
});

test("Stage 2 fails closed and recovers exact Copy context without losing local edits", async (t) => {
  const setup = await startWorld(t, 59250);
  if (!setup) return t.skip("local Chrome or TCP listening is unavailable");
  const { app, browser, origin, project, first, second, actor } = setup;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await authenticate(page, origin);

  let bootstrapFailures = 0;
  const endpoint = `/api/projects/${project.id}/products/${first.product.id}/operator-workspace`;
  await page.route("**/api/projects/*/products/*/operator-workspace?*", (route) => {
    const requestUrl = new URL(route.request().url());
    if (requestUrl.pathname === endpoint && requestUrl.searchParams.get("stage") === "copy" && bootstrapFailures === 0) {
      bootstrapFailures += 1;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "OPERATOR_WORKSPACE_UNAVAILABLE" }) });
    }
    return route.continue();
  });
  await page.goto(url(origin, project.id, first.product.id));
  await page.getByText("文案暂时无法读取", { exact: true }).waitFor();
  assert.equal(bootstrapFailures, 1);
  assert.equal(await page.locator("[data-stage-code]").count(), 10);
  assert.equal(await page.locator('[data-stage-code][aria-disabled="true"]:not([href])').count(), 10);
  await expectAction(page, "retry_copy_read", "刷新当前文案");
  await page.locator("#workspacePrimaryAction").click();
  await expectAction(page, "request_copy_generation", "生成文案");
  assert.equal(await page.locator('[data-stage-code="copy"]').first().getAttribute("href"), `/workspace.html?project=${project.id}&product=${first.product.id}&stage=copy`);

  await page.unroute("**/api/projects/*/products/*/operator-workspace?*");
  await page.locator("#workspacePrimaryAction").click();
  await app.runNextCopyGenerationJob();
  await page.getByText("文案草稿待质检", { exact: true }).first().waitFor({ timeout: 5000 });
  const editor = page.locator("#workspaceCopyBody");
  const localText = `${await editor.inputValue()} 本地冲突内容。`;
  await editor.fill(localText);
  await expectAction(page, "save_copy_draft", "保存当前修改");
  let conflictHits = 0;
  await page.route("**/api/copy-versions/*", (route) => {
    if (route.request().method() === "PATCH" && conflictHits === 0) {
      conflictHits += 1;
      return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "COPY_VERSION_CONFLICT" }) });
    }
    return route.continue();
  });
  await page.locator("#workspacePrimaryAction").click();
  await expectAction(page, "load_latest_copy_version", "载入最新文案状态");
  assert.equal(await editor.inputValue(), localText);
  await page.locator("#workspacePrimaryAction").click();
  assert.equal(await editor.inputValue(), localText);
  await expectAction(page, "save_copy_draft", "保存当前修改");
  await page.unroute("**/api/copy-versions/*");
  await page.locator("#workspacePrimaryAction").click();
  await page.getByText("文案草稿已保存。", { exact: true }).waitFor();

  const frozen = await app.copyQuality.service.startQualityCheck({
    ...actor, copyVersionId: new URL(page.url()).searchParams.get("copy"), expectedRevision: 2, idempotencyKey: "stage-2-history-freeze"
  });
  const child = await app.copyGeneration.service.editCopyVersion({
    ...actor, copyVersionId: frozen.copy_version.id, expectedRevision: frozen.copy_version.row_version,
    idempotencyKey: "stage-2-history-child", body: `${frozen.copy_version.body} 新草稿。`
  });
  await page.goto(url(origin, project.id, first.product.id, frozen.copy_version.id));
  await expectAction(page, "return_to_current_copy_version", "回到当前文案");
  assert.equal(await editor.isEditable(), false);
  await page.locator("#workspacePrimaryAction").click();
  await page.waitForURL((value) => value.searchParams.get("copy") === child.id);
  await page.waitForFunction(() => document.querySelector("#workspaceCopyBody")?.readOnly === false);

  await editor.fill(`${await editor.inputValue()} 未保存。`);
  await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  await page.getByRole("heading", { name: "保留当前文案修改" }).waitFor();
  await page.getByRole("button", { name: "继续编辑" }).click();
  assert.equal(new URL(page.url()).searchParams.get("copy"), child.id);
  assert.match(await editor.inputValue(), /未保存。$/);

  await page.getByRole("button", { name: /云感保湿乳/ }).click();
  await page.getByRole("heading", { name: "保留当前文案修改" }).waitFor();
  await page.getByRole("button", { name: "放弃修改" }).click();
  await page.waitForURL((value) => value.searchParams.get("product") === second.product.id);
  await page.goBack();
  await page.waitForURL((value) => value.searchParams.get("product") === first.product.id);
  await editor.fill(`${await editor.inputValue()} Forward 保留。`);
  await page.goForward({ waitUntil: "domcontentloaded" }).catch(() => undefined);
  await page.getByRole("heading", { name: "保留当前文案修改" }).waitFor();
  await page.getByRole("button", { name: "继续编辑" }).click();
  assert.equal(new URL(page.url()).searchParams.get("product"), first.product.id);
  assert.match(await editor.inputValue(), /Forward 保留。$/);

  let invalidHits = 0;
  await page.route("**/api/projects/*/products/*/operator-workspace?*", async (route) => {
    if (invalidHits > 0) return route.continue();
    invalidHits += 1;
    const response = await route.fetch();
    const payload = await response.json();
    payload.workspace.recommended_action = { code: "unknown_copy_command", stage: "copy", kind: "command" };
    return route.fulfill({ response, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.getByRole("button", { name: "刷新当前文案" }).click();
  await page.getByRole("heading", { name: "保留当前文案修改" }).waitFor();
  await page.getByRole("button", { name: "放弃修改" }).click();
  await page.getByText("文案暂时无法读取", { exact: true }).waitFor();
  await expectAction(page, "retry_copy_read", "刷新当前文案");
  assert.equal(await page.locator('[data-stage-code][aria-disabled="true"]:not([href])').count(), 10);
});

test("Stage 2 resolves review findings truthfully and never accepts hard blocks", async (t) => {
  const reviewFinding = {
    code: "TONE_REVIEW", kind: "review", severity: "medium", title: "语气待判断",
    matched_text: "全网最好", message: "请人工判断语气是否符合品牌事实",
    evidence_reference: "copy:text:12-16", rule_source: "brand_policy", suggestion: "改为有事实依据的体验描述"
  };
  const hardBlock = {
    code: "FACT_BLOCK", kind: "hard_block", severity: "critical", title: "事实依据不足",
    matched_text: "绝对有效", message: "必须修正文案或商品事实",
    evidence_reference: "copy:text:20-24", rule_source: "fact_policy", suggestion: "返回商品资料核对事实"
  };
  const setup = await startWorld(t, 59300, { evaluateQuality: async ({ productRevision }) => ({
    checks_complete: true,
    findings: [productRevision.product_name.includes("云感") ? hardBlock : reviewFinding]
  }) });
  if (!setup) return t.skip("local Chrome or TCP listening is unavailable");
  const { app, browser, origin, project, first, second } = setup;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await authenticate(page, origin);

  async function generateAndCheck(product) {
    await page.goto(url(origin, project.id, product.product.id));
    await expectAction(page, "request_copy_generation", "生成文案");
    await page.locator("#workspacePrimaryAction").click();
    await app.runNextCopyGenerationJob();
    await page.getByText("文案草稿待质检", { exact: true }).first().waitFor({ timeout: 5000 });
    await expectAction(page, "start_copy_quality", "开始质检");
    await page.locator("#workspacePrimaryAction").click();
    await app.runNextCopyQualityJob();
  }

  await generateAndCheck(first);
  await page.getByText("质检需要人工判断", { exact: true }).first().waitFor({ timeout: 5000 });
  await expectAction(page, "review_copy_quality", "处理质检问题");
  const reviewCard = page.locator('[data-finding-code="TONE_REVIEW"]');
  assert.equal(await reviewCard.getByRole("button", { name: "返回商品资料" }).count(), 1);
  assert.equal(await reviewCard.getByRole("button", { name: "人工修改文案" }).count(), 1);
  await page.locator("#workspacePrimaryAction").click();
  await reviewCard.scrollIntoViewIfNeeded();
  const screenshotDir = process.env.STAGE_2_SCREENSHOTS_DIR;
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await reviewCard.getByRole("button", { name: "人工修改文案" }).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 84));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${viewport.width}px finding overflow`);
    if (screenshotDir) {
      const image = await page.screenshot({ path: path.join(screenshotDir, `stage-2-copy-needs-review-${viewport.width}x${viewport.height}.png`) });
      assert.equal(image.readUInt32BE(16), viewport.width);
      assert.equal(image.readUInt32BE(20), viewport.height);
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await reviewCard.getByRole("button", { name: "接受并填写理由" }).click();
  const dialog = page.locator("#workspaceFindingDialog");
  assert.equal(await dialog.evaluate((element) => element.open), true);
  assert.equal(await page.locator("#workspaceFindingReason").evaluate((element) => element === document.activeElement), true);
  await page.getByRole("button", { name: "确认接受" }).click();
  await page.getByText("请填写接受理由。", { exact: true }).waitFor();
  await page.locator("#workspaceFindingReason").fill("运营复核后确认符合品牌事实");
  let conflicts = 0;
  await page.route("**/api/quality-findings/*/resolutions", (route) => {
    if (conflicts++ === 0) return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "QUALITY_FINDING_CONFLICT" }) });
    return route.continue();
  });
  await page.getByRole("button", { name: "确认接受" }).click();
  await page.locator("#workspaceFindingError").getByText("质检状态已被其他人更新，请刷新当前文案。", { exact: true }).waitFor();
  assert.equal(await dialog.evaluate((element) => element.open), true);
  assert.equal(await page.locator("#workspaceFindingReason").inputValue(), "运营复核后确认符合品牌事实");
  await page.unroute("**/api/quality-findings/*/resolutions");
  await page.getByRole("button", { name: "确认接受" }).click();
  await page.getByText("质检已通过，待提交人工审核", { exact: true }).first().waitFor({ timeout: 5000 });
  await expectAction(page, "submit_copy_review", "提交人工审核");

  await generateAndCheck(second);
  await page.getByText("文案质检未通过", { exact: true }).first().waitFor({ timeout: 5000 });
  const hardBlockCard = page.locator('[data-finding-code="FACT_BLOCK"]');
  assert.equal(await hardBlockCard.getByRole("button", { name: "接受并填写理由" }).count(), 0);
  assert.equal(await hardBlockCard.getByRole("button", { name: "返回商品资料" }).count(), 1);
  assert.equal(await hardBlockCard.getByRole("button", { name: "人工修改文案" }).count(), 1);
  await expectAction(page, "review_copy_quality", "处理质检问题");
});
