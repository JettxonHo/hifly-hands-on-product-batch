import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chromium } from "playwright";

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
import { createControlledPreflightEvaluator } from "../src/video-planning/controlled-preflight-evaluator.js";
import { createMemoryVideoPlanningRepository } from "../src/video-planning/memory-video-planning-repository.js";
import { ADMIN_EMAIL, ADMIN_TEMP_PASSWORD } from "./helpers/identity-world.js";

const assetReferencePort = {
  async bindAvailableVersion(input) {
    return { reference: { asset_version_id: input.assetVersionId }, asset_version: { id: input.assetVersionId, status: "available" } };
  }
};

async function readyProduct(service, actor, projectId, key, name) {
  const created = await service.createProduct({ ...actor, projectId, idempotencyKey: key, productName: name });
  let revision = await service.saveRevision({ ...actor, productRevisionId: created.revision.id,
    expectedRevision: created.revision.revision_number, productName: name, productDescription: `${name}商品说明`,
    primaryCategory: "防晒护肤", contentBrief: { expression_style: "自然口语" },
    sellingPoints: [{ text: `${name}核心卖点` }], assetVersionIds: [`${key}-product-image`] });
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

async function confirmAvatar(app, actor, productId, copyVersionId, key) {
  const workspace = await app.avatarSelection.service.getWorkspace({ ...actor, actorRole: "admin", productId, copyVersionId });
  const entry = workspace.catalog.find((item) => item.gate.can_confirm);
  assert.ok(entry, "controlled catalog should expose one confirmable Avatar fixture");
  return app.avatarSelection.service.confirmSelection({ ...actor, actorRole: "admin", productId, copyVersionId,
    assetVersionId: entry.asset_version.id, expectedRevision: 0, idempotencyKey: `${key}-avatar` });
}

async function startWorld(t, portStart = 59600) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-single-workspace-stage-4-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(portStart);
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const organizationId = "org_single_workspace_stage_4";
  const identityRepository = createMemoryIdentityRepository();
  const seeded = await seedInitialAdmin(identityRepository, { organizationId, organizationName: "方案工作区团队",
    adminEmail: ADMIN_EMAIL, adminDisplayName: "方案管理员", adminTempPassword: ADMIN_TEMP_PASSWORD });
  const actor = { organizationId, actorMemberId: seeded.member.id, actorRole: "admin" };
  let productionReads = 0;
  const app = await buildApp({
    root, executor: createFakeExecutor(),
    identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin],
      cookieSecure: false, seed: { enabled: false } },
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort },
    copyGeneration: { enabled: true, repository: createMemoryCopyGenerationRepository(),
      provider: createControlledCopyProvider(), worker: { autoStart: false } },
    copyQuality: { enabled: true, repository: createMemoryCopyQualityRepository(), evaluator: createControlledQualityEvaluator(),
      rewriter: createControlledCopyRewriter(), worker: { autoStart: false } },
    copyReview: { enabled: true, repository: createMemoryCopyReviewRepository() },
    avatarSelection: { enabled: true, repository: createMemoryAvatarSelectionRepository() },
    videoPlanning: { enabled: true, repository: createMemoryVideoPlanningRepository(),
      evaluator: createControlledPreflightEvaluator(), worker: { autoStart: true, pollIntervalMs: 20 } },
    operatorWorkspace: { enabled: true, productionService: {
      async getWorkspace() {
        productionReads += 1;
        throw new Error("Stage 5 Production must remain unread");
      }
    } }
  });
  const project = await app.projectContent.service.createProject({ ...actor, idempotencyKey: "stage-4-project",
    name: "夏日防晒推广", description: "视频方案" });
  const first = await readyProduct(app.projectContent.service, actor, project.id, "stage-4-product-1", "清透防晒乳 SPF50+");
  const second = await readyProduct(app.projectContent.service, actor, project.id, "stage-4-product-2", "云感保湿乳");
  const firstCopy = await approveCopy(app, actor, first.revision, "stage-4-copy-1");
  const secondCopy = await approveCopy(app, actor, second.revision, "stage-4-copy-2");
  const firstSelection = await confirmAvatar(app, actor, first.product.id, firstCopy.id, "stage-4-first");
  const secondSelection = await confirmAvatar(app, actor, second.product.id, secondCopy.id, "stage-4-second");

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
  return { app, browser, origin, project, first, second, firstCopy, secondCopy, firstSelection, secondSelection,
    actor, productionReads: () => productionReads };
}

async function authenticate(page, origin) {
  await page.goto(`${origin}/login.html`);
  await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("heading", { name: "设置新密码" }).waitFor();
  await page.locator("#newPassword").fill("Single-Workspace-Stage-4-Password-9!");
  await page.getByRole("button", { name: "保存并进入工作台" }).click();
  await page.waitForURL(`${origin}/projects.html`);
}

function workspaceUrl(origin, projectId, productId, planId = null) {
  const result = new URL("/workspace.html", origin);
  result.searchParams.set("project", projectId);
  result.searchParams.set("product", productId);
  result.searchParams.set("stage", "video_plan");
  if (planId) result.searchParams.set("plan", planId);
  return result.href;
}

function migratedStageUrl(origin, projectId, productId, stage, copyVersionId = null) {
  const result = new URL("/workspace.html", origin);
  result.searchParams.set("project", projectId);
  result.searchParams.set("product", productId);
  result.searchParams.set("stage", stage);
  if (copyVersionId) result.searchParams.set("copy", copyVersionId);
  return result.href;
}

async function expectAction(page, code, label) {
  await page.waitForFunction(({ code, label }) => {
    const button = document.querySelector("#workspacePrimaryAction");
    return button?.dataset.actionCode === code && button.textContent.trim() === label;
  }, { code, label });
  assert.equal(await page.locator('[data-recommended-action="true"]').count(), 1);
}

async function createPlanInBrowser(page, { instructions = "竖版产品说明", size = "small" } = {}) {
  await page.locator("#firstInstructions").fill(instructions);
  await page.locator("#firstPresentationSize").selectOption(size);
  await expectAction(page, "create_video_plan", "创建视频方案");
  await page.locator("#workspacePrimaryAction").click();
  await page.waitForFunction(() => new URL(location.href).searchParams.has("plan"));
  await page.locator("#outputInstructions").waitFor();
  return new URL(page.url()).searchParams.get("plan");
}

async function expectNoHorizontalOverflow(page) {
  const evidence = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    media: { compact: matchMedia("(max-width: 680px)").matches, converged: matchMedia("(max-width: 1120px)").matches },
    layout: [".app-shell", ".app-frame", ".workspace-content", ".single-workspace-layout"].map((selector) => {
      const node = document.querySelector(selector);
      const rect = node?.getBoundingClientRect();
      return { selector, left: rect?.left, right: rect?.right, width: rect?.width,
        cssWidth: node ? getComputedStyle(node).width : null };
    }),
    offenders: [...document.querySelectorAll("body *")].flatMap((node) => {
      const rect = node.getBoundingClientRect();
      return rect.right > document.documentElement.clientWidth + 1 || rect.left < -1
        ? [{ tag: node.tagName, id: node.id, className: String(node.className || ""), left: rect.left, right: rect.right }]
        : [];
    }).slice(0, 12)
  }));
  assert.equal(evidence.scrollWidth > evidence.clientWidth, false, JSON.stringify(evidence));
}

async function stageLinksAreDisabled(page) {
  return page.locator("[data-stage-code]").evaluateAll((links) => links.length === 10 && links.every((link) =>
    !link.hasAttribute("href") && link.getAttribute("aria-disabled") === "true"));
}

test("Stage 4 opens the exact VideoPlan workspace instead of the legacy Plan page", async (t) => {
  const setup = await startWorld(t);
  if (!setup) return t.skip("local Chrome or TCP listening is unavailable");
  const { browser, origin, project, first, firstCopy, productionReads } = setup;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await authenticate(page, origin);

  await page.goto(workspaceUrl(origin, project.id, first.product.id));
  await page.getByRole("heading", { name: "制定并审核视频方案" }).waitFor();
  assert.equal(new URL(page.url()).pathname, "/workspace.html");
  await expectAction(page, "create_video_plan", "创建视频方案");
  assert.equal(await page.locator('[data-stage-code="video_plan"]').first().getAttribute("aria-current"), "step");
  assert.equal(await page.locator('[data-stage-code="production"]').first().getAttribute("href"),
    `/production.html?project=${project.id}&product=${first.product.id}`);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);

  await page.goto(migratedStageUrl(origin, project.id, first.product.id, "copy", firstCopy.id));
  await page.getByRole("heading", { name: "完善并审核文案" }).waitFor();
  assert.equal(await page.locator('[data-stage-code="video_plan"]').first().getAttribute("href"),
    `/workspace.html?project=${project.id}&product=${first.product.id}&stage=video_plan`);

  await page.goto(migratedStageUrl(origin, project.id, first.product.id, "avatar", firstCopy.id));
  await page.getByRole("heading", { name: "选择并确认人物" }).waitFor();
  assert.equal(await page.locator('[data-stage-code="video_plan"]').first().getAttribute("href"),
    `/workspace.html?project=${project.id}&product=${first.product.id}&stage=video_plan`);
  assert.equal(await page.locator('[data-stage-code="production"]').first().getAttribute("href"),
    `/production.html?project=${project.id}&product=${first.product.id}`);
  assert.equal(productionReads(), 0);
});

test("Stage 4 preserves local input through 409 and keeps preflight separate from human approval", async (t) => {
  const setup = await startWorld(t, 59620);
  if (!setup) return t.skip("local Chrome or TCP listening is unavailable");
  const { app, browser, origin, project, first, actor, productionReads } = setup;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let productionApiRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/production")) productionApiRequests += 1;
  });
  await authenticate(page, origin);
  await page.goto(workspaceUrl(origin, project.id, first.product.id));

  const planId = await createPlanInBrowser(page, { instructions: "先展示使用场景，再说明清爽卖点", size: "small" });
  assert.equal(await page.locator("#presentationSize").inputValue(), "small");

  const authoritative = await app.videoPlanning.service.getWorkspace({ ...actor, productId: first.product.id, planId });
  await app.videoPlanning.service.saveDraft({ ...actor, productId: first.product.id, planId,
    expectedRevision: authoritative.current_plan.row_version, outputInstructions: "服务端并发更新",
    presentationSizeCode: "small" });

  const localDraft = "本地仍需保留的制作说明";
  await page.locator("#outputInstructions").fill(localDraft);
  await expectAction(page, "save_video_plan_draft", "保存草稿");
  await page.locator("#workspacePrimaryAction").click();
  await expectAction(page, "load_latest_video_plan", "载入最新方案状态");
  assert.equal(await page.locator("#outputInstructions").inputValue(), localDraft);

  await page.locator("#workspacePrimaryAction").click();
  await expectAction(page, "save_video_plan_draft", "保存草稿");
  assert.equal(await page.locator("#outputInstructions").inputValue(), localDraft);
  await page.locator("#workspacePrimaryAction").click();
  await expectAction(page, "run_video_plan_preflight", "开始预检");
  const saved = await app.videoPlanning.service.getWorkspace({ ...actor, productId: first.product.id, planId });
  assert.equal(saved.current_plan.output_instructions, localDraft);

  const preflightTab = page.getByRole("tab", { name: "预检" });
  const reviewTab = page.getByRole("tab", { name: "人工审核" });
  await preflightTab.focus();
  await preflightTab.press("End");
  assert.equal(await reviewTab.getAttribute("aria-selected"), "true");
  assert.equal(await reviewTab.evaluate((node) => document.activeElement === node), true);
  await reviewTab.press("Home");
  assert.equal(await preflightTab.getAttribute("aria-selected"), "true");

  await page.locator("#workspacePrimaryAction").click();
  await expectAction(page, "submit_video_plan_review", "提交方案审核");
  assert.match(await page.locator("#preflightBadge").textContent(), /预检通过|存在提醒/);
  assert.equal(await page.locator("#reviewBadge").textContent(), "未提交审核");

  await page.locator("#workspacePrimaryAction").click();
  const reviewDialog = page.locator("#reviewDialog");
  await reviewDialog.waitFor();
  assert.equal(await page.locator("#confirmReviewAction").evaluate((node) => document.activeElement === node), true);
  await page.locator("#confirmReviewAction").click();
  await expectAction(page, "approve_video_plan_review", "批准方案");
  assert.equal(await page.locator("#reviewBadge").textContent(), "审核中");
  assert.notEqual(await page.locator("#preflightBadge").textContent(), "已批准");

  await page.locator("#workspacePrimaryAction").click();
  await page.locator("#confirmReviewAction").click();
  await expectAction(page, "continue_to_production", "进入生产");
  assert.equal(await page.locator("#reviewBadge").textContent(), "已批准");
  if (process.env.STAGE4_SCREENSHOT_DIR) {
    await mkdir(process.env.STAGE4_SCREENSHOT_DIR, { recursive: true });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expectNoHorizontalOverflow(page);
      await page.screenshot({ path: path.join(process.env.STAGE4_SCREENSHOT_DIR, `stage-4-approved-${viewport.width}x${viewport.height}.png`) });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  }

  await page.locator("#deriveVideoPlanDraft").click();
  await page.waitForFunction((priorPlanId) => new URL(location.href).searchParams.get("plan") !== priorPlanId, planId);
  const derivedPlanId = new URL(page.url()).searchParams.get("plan");
  await expectAction(page, "run_video_plan_preflight", "开始预检");
  await page.locator(`#versionList [data-plan-id="${planId}"]`).click();
  await expectAction(page, "return_to_current_video_plan", "回到当前方案");
  assert.equal(new URL(page.url()).searchParams.get("plan"), planId);
  assert.equal(await page.locator("#outputInstructions").getAttribute("readonly"), "");
  await page.locator("#workspacePrimaryAction").click();
  await page.waitForURL(new RegExp(`plan=${derivedPlanId}`));
  await expectAction(page, "run_video_plan_preflight", "开始预检");

  await page.locator("#workspacePrimaryAction").click();
  await expectAction(page, "submit_video_plan_review", "提交方案审核");
  await page.locator("#workspacePrimaryAction").click();
  await page.locator("#confirmReviewAction").click();
  await expectAction(page, "approve_video_plan_review", "批准方案");
  await page.getByRole("tab", { name: "人工审核" }).click();
  await page.locator("#requestChanges").click();
  assert.equal(await page.locator("#reviewReasonInput").evaluate((node) => document.activeElement === node), true);
  await page.locator("#confirmReviewAction").click();
  assert.equal(await page.locator("#reviewDialogError").textContent(), "请填写修改意见。");
  await page.locator("#reviewReasonInput").fill("需要补充镜头节奏说明");
  await page.locator("#confirmReviewAction").click();
  await expectAction(page, "derive_video_plan_draft", "基于此方案修改");

  await page.locator("#workspacePrimaryAction").click();
  await page.waitForFunction((priorPlanId) => new URL(location.href).searchParams.get("plan") !== priorPlanId, derivedPlanId);
  await expectAction(page, "run_video_plan_preflight", "开始预检");
  await approveCopy(app, actor, first.revision, "stage-4-upstream-replacement");
  await page.locator("#refreshVideoPlanWorkspace").click();
  await expectAction(page, "return_to_avatar", "返回人物");
  assert.match(await page.locator("#taskBlocker").textContent(), /上游|人物/);
  assert.equal(productionReads(), 0);
  assert.equal(productionApiRequests, 0);
  assert.equal(await page.locator('[data-stage-code="production"]').first().getAttribute("href"),
    `/production.html?project=${project.id}&product=${first.product.id}`);
  await expectNoHorizontalOverflow(page);
});

test("Stage 4 bootstrap and scoped refresh fail closed without stale actions or stage links", async (t) => {
  const setup = await startWorld(t, 59640);
  if (!setup) return t.skip("local Chrome or TCP listening is unavailable");
  const { browser, origin, project, first } = setup;
  const page = await browser.newPage({ viewport: { width: 768, height: 900 } });
  await authenticate(page, origin);
  const pattern = "**/api/projects/*/products/*/operator-workspace**";
  let failInitial = true;
  await page.route(pattern, async (route) => {
    if (failInitial) {
      failInitial = false;
      return route.fulfill({ status: 503, contentType: "application/json",
        body: JSON.stringify({ error: "OPERATOR_WORKSPACE_UNAVAILABLE" }) });
    }
    return route.continue();
  });

  await page.goto(workspaceUrl(origin, project.id, first.product.id));
  await page.locator("#videoPlanWorkspaceHeading").filter({ hasText: "视频方案暂时无法读取" }).waitFor();
  await expectAction(page, "retry_video_plan_read", "刷新当前方案");
  assert.equal(await stageLinksAreDisabled(page), true);
  await page.locator("#workspacePrimaryAction").click();
  await page.getByRole("heading", { name: "制定并审核视频方案" }).waitFor();
  await expectAction(page, "create_video_plan", "创建视频方案");
  assert.equal(await page.locator('[data-stage-code="video_plan"]').first().getAttribute("href"),
    `/workspace.html?project=${project.id}&product=${first.product.id}&stage=video_plan`);

  await page.unroute(pattern);
  let resolveDownstreamError;
  const downstreamErrorObserved = new Promise((resolve) => { resolveDownstreamError = resolve; });
  await page.route(pattern, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const copyStage = body.workspace.stages.find((stage) => stage.code === "copy");
    Object.assign(copyStage, { read_status: "error", navigation_state: null, business_status: null,
      blocker_codes: [], current_object: null });
    await route.fulfill({ response, json: body });
    resolveDownstreamError();
  });
  await page.locator("#refreshVideoPlanWorkspace").click();
  await downstreamErrorObserved;
  await page.waitForFunction(() => [...document.querySelectorAll('[data-stage-code="copy"]')].every((link) =>
    (link.closest("li") || link).dataset.stageState === "error"));
  await expectAction(page, "create_video_plan", "创建视频方案");
  const copyLinks = page.locator('[data-stage-code="copy"]');
  assert.equal(await copyLinks.count(), 2);
  const expectedCopyHref = `/workspace.html?project=${project.id}&product=${first.product.id}&stage=copy`;
  const copyLinkStates = await copyLinks.evaluateAll((links) => links.map((link) => ({
    href: link.getAttribute("href"), ariaDisabled: link.getAttribute("aria-disabled"),
    state: (link.closest("li") || link).dataset.stageState
  })));
  assert.equal(copyLinkStates.every((item) => item.href === expectedCopyHref && item.ariaDisabled !== "true" &&
    item.state === "error"), true, JSON.stringify(copyLinkStates));

  await page.unroute(pattern);
  let corruptOnce = true;
  await page.route(pattern, async (route) => {
    if (!corruptOnce) return route.continue();
    corruptOnce = false;
    const response = await route.fetch();
    const body = await response.json();
    body.workspace.recommended_action = { code: "unregistered_plan_command", stage: "video_plan", kind: "command" };
    return route.fulfill({ response, json: body });
  });
  await page.locator("#refreshVideoPlanWorkspace").click();
  await page.locator("#videoPlanWorkspaceHeading").filter({ hasText: "视频方案暂时无法读取" }).waitFor();
  await expectAction(page, "retry_video_plan_read", "刷新当前方案");
  assert.equal(await stageLinksAreDisabled(page), true);
  assert.equal(await page.locator("#videoPlanWorkspaceContent").isHidden(), true);
  await page.locator("#workspacePrimaryAction").click();
  await page.getByRole("heading", { name: "制定并审核视频方案" }).waitFor();
  await expectAction(page, "create_video_plan", "创建视频方案");
  await expectNoHorizontalOverflow(page);
});

test("Stage 4 keeps PC and mobile composition first-class and restores exact dirty history context", async (t) => {
  const setup = await startWorld(t, 59660);
  if (!setup) return t.skip("local Chrome or TCP listening is unavailable");
  const { browser, origin, project, first, second } = setup;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await authenticate(page, origin);
  await page.goto(workspaceUrl(origin, project.id, first.product.id));
  await page.getByRole("heading", { name: "制定并审核视频方案" }).waitFor();

  await page.locator("#mobileVideoPlanProductBack").click();
  assert.equal(await page.locator("body").getAttribute("data-mobile-layer"), "list");
  const firstItem = page.locator(`#productList [data-product-id="${first.product.id}"]`);
  assert.equal(await firstItem.evaluate((node) => document.activeElement === node), true);
  const secondItem = page.locator(`#productList [data-product-id="${second.product.id}"]`);
  await secondItem.click();
  await page.waitForURL(new RegExp(`product=${second.product.id}`));
  assert.equal(await page.locator("#videoPlanWorkspaceHeading").evaluate((node) => document.activeElement === node), true);

  await page.locator("#mobileVideoPlanProductBack").click();
  await page.locator(`#productList [data-product-id="${first.product.id}"]`).click();
  await page.waitForURL(new RegExp(`product=${first.product.id}`));
  await page.locator("#firstInstructions").fill("A 商品本地未保存说明");
  await page.evaluate(() => history.back());
  await page.locator("#workspaceUnsavedDialog").waitFor();
  assert.equal(new URL(page.url()).searchParams.get("product"), first.product.id);
  assert.equal(await page.locator("#firstInstructions").inputValue(), "A 商品本地未保存说明");
  await page.locator("#keepWorkspaceEditing").click();
  assert.equal(await page.locator("#firstInstructions").evaluate((node) => document.activeElement === node), true);

  await page.evaluate(() => history.back());
  await page.locator("#workspaceUnsavedDialog").waitFor();
  await page.locator("#discardWorkspaceChanges").click();
  await page.waitForURL(new RegExp(`product=${second.product.id}`));
  assert.equal(await page.locator("#videoPlanWorkspaceHeading").evaluate((node) => document.activeElement === node), true);

  await page.locator("#firstInstructions").fill("B 商品本地未保存说明");
  await page.evaluate(() => history.forward());
  await page.locator("#workspaceUnsavedDialog").waitFor();
  assert.equal(new URL(page.url()).searchParams.get("product"), second.product.id);
  await page.locator("#discardWorkspaceChanges").click();
  await page.waitForURL(new RegExp(`product=${first.product.id}`));
  assert.equal(await page.locator("#videoPlanWorkspaceHeading").evaluate((node) => document.activeElement === node), true);

  for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 900 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expectNoHorizontalOverflow(page);
    const actionBox = await page.locator("#workspacePrimaryAction").boundingBox();
    assert.ok(actionBox && actionBox.y + actionBox.height <= viewport.height);
    const transition = await page.locator(".workspace-panel").first().evaluate((node) => getComputedStyle(node).transitionDuration);
    assert.ok(["0s", "0.001s", "0.01ms"].includes(transition) || Number.parseFloat(transition) <= 0.01);
  }
  const columnsAt1440 = await page.locator(".single-workspace-layout").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
  assert.equal(columnsAt1440, 3);
  await page.setViewportSize({ width: 768, height: 900 });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const columnsAt768 = await page.locator(".single-workspace-layout").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length);
  assert.equal(columnsAt768, 2);
});
