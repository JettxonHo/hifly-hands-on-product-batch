import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chromium } from "playwright";

import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createControlledCopyProvider } from "../src/copy-generation/controlled-provider.js";
import { createMemoryCopyGenerationRepository } from "../src/copy-generation/memory-copy-generation-repository.js";
import { createControlledQualityEvaluator } from "../src/copy-quality/controlled-evaluator.js";
import { createMemoryCopyQualityRepository } from "../src/copy-quality/memory-copy-quality-repository.js";
import { createMemoryCopyReviewRepository } from "../src/copy-review/memory-copy-review-repository.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { createMemoryIdentityRepository } from "../src/identity/memory-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createMemoryAvatarSelectionRepository } from "../src/avatar-selection/memory-avatar-selection-repository.js";
import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
import { createMemoryVideoPlanningRepository } from "../src/video-planning/memory-video-planning-repository.js";
import { createMemoryProductionOrderRepository } from "../src/production-orders/memory-production-order-repository.js";
import { createMemoryManualHandoffRepository } from "../src/manual-handoff/memory-manual-handoff-repository.js";
import { createMemoryManualHandoffPackageStore } from "../src/manual-handoff/manual-handoff-package-store.js";
import { createMemoryManualExecutionRepository } from "../src/manual-execution/memory-manual-execution-repository.js";
import { createMemoryWorkDeliveryRepository } from "../src/work-delivery/memory-work-delivery-repository.js";
import { createWorkDeliveryService } from "../src/work-delivery/work-delivery-service.js";
import { buildApp } from "../src/server/app.js";
import { findAvailablePort } from "../src/server/start.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const CANDIDATE = Buffer.from("a14-browser-candidate");

function clone(value) {
  return value == null ? value : structuredClone(value);
}

test("VSA-A14 main path completes from a fresh enterprise login to inspected and delivered Work", async (t) => {
  const screenshotDir = process.env.A14_SCREENSHOT_DIR;
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-vsa-a14-browser-"));
  const assetPath = path.join(root, "a14-product.png");
  await writeFile(assetPath, PNG);
  t.after(() => rm(root, { recursive: true, force: true }));

  const organizationId = "org-a14-browser";
  const port = await findAvailablePort(58400);
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const adminEmail = "a14-admin@example.test";
  const adminTempPassword = "Temporary-A14-Admin-9!";
  const operatorEmail = "a14-operator@example.test";
  const identityRepository = createMemoryIdentityRepository();
  const seeded = await seedInitialAdmin(identityRepository, {
    organizationId,
    organizationName: "A14 全链路企业",
    adminEmail,
    adminDisplayName: "A14 管理员",
    adminTempPassword
  });

  let projectId = null;
  let productId = null;
  let revisionId = null;
  let productName = "云感保湿乳";
  let assetVersionId = null;
  let copyVersionId = null;
  let avatarSelectionId = null;
  let planId = null;
  let orderId = null;
  let candidateId = null;
  let verificationJob = null;
  let work = null;
  const checksum = "431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460";

  const verificationService = {
    async getVerificationWorkspace({ productionOrderId, organizationId: requestOrganizationId }) {
      return {
        order: { id: productionOrderId, organization_id: requestOrganizationId, status: work ? "succeeded" : "running", input_snapshot: {} },
        job: clone(verificationJob),
        work: clone(work),
        works: work ? [clone(work)] : []
      };
    },
    async requestVerification({ productionOrderId, reportId, candidateId: requestedCandidateId }) {
      orderId = productionOrderId;
      candidateId = requestedCandidateId;
      verificationJob = {
        id: "job-a14-browser",
        report_id: reportId,
        candidate_id: requestedCandidateId,
        primary_output_checksum: "a".repeat(64),
        production_order_id: productionOrderId,
        verification_status: "queued",
        status: "queued",
        attempts: 0,
        max_attempts: 3,
        created_at: "2026-08-09T00:00:00.000Z",
        updated_at: "2026-08-09T00:00:00.000Z"
      };
      return { job: clone(verificationJob), work: null, replayed: false };
    },
    async getVerificationJob() { return clone(verificationJob); },
    async retryVerification() { return { job: clone(verificationJob), replayed: false }; },
    async recoverVerification() { return { job: clone(verificationJob), replayed: false }; },
    async runNextVerificationJob() {
      if (!verificationJob || verificationJob.status !== "queued") return verificationJob;
      verificationJob = { ...verificationJob, status: "succeeded", verification_status: "passed", attempts: 1, updated_at: "2026-08-09T00:01:00.000Z" };
      work = {
        id: "work-a14-browser",
        organization_id: organizationId,
        project_id: projectId,
        product_id: productId,
        project_name: "A14 全链路项目",
        product_name: productName,
        production_order_id: orderId,
        primary_asset_version_id: "asset-version-work-a14",
        primary_output_media_type: "video/mp4",
        primary_output_size: CANDIDATE.length,
        status: "available",
        created_at: "2026-08-09T00:01:00.000Z",
        updated_at: "2026-08-09T00:01:00.000Z"
      };
      return { job: clone(verificationJob), work: clone(work) };
    },
    async listWorks(requestOrganizationId) {
      return work && requestOrganizationId === organizationId ? [clone(work)] : [];
    },
    async getWork(requestOrganizationId, requestedWorkId) {
      return work && requestOrganizationId === organizationId && requestedWorkId === work.id ? clone(work) : null;
    }
  };
  const workDeliveryService = createWorkDeliveryService({
    repository: createMemoryWorkDeliveryRepository(),
    workPort: verificationService,
    now: () => Date.parse("2026-08-09T01:00:00.000Z")
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
    },
    copyGeneration: {
      enabled: true,
      repository: createMemoryCopyGenerationRepository(),
      provider: createControlledCopyProvider(),
      worker: { autoStart: false }
    },
    copyQuality: {
      enabled: true,
      repository: createMemoryCopyQualityRepository(),
      evaluator: createControlledQualityEvaluator(),
      worker: { autoStart: false }
    },
    copyReview: {
      enabled: true,
      repository: createMemoryCopyReviewRepository()
    },
    avatarSelection: {
      enabled: true,
      repository: createMemoryAvatarSelectionRepository()
    },
    videoPlanning: {
      enabled: true,
      repository: createMemoryVideoPlanningRepository(),
      worker: { autoStart: false },
      agentReadinessPort: { async isOnline() { return false; } }
    },
    productionOrders: {
      enabled: true,
      repository: createMemoryProductionOrderRepository(),
      inputSnapshotPort: {
        async freezeForOrder() {
          return {
            approved_copy_snapshot: {
              copy_version_id: copyVersionId,
              product_revision_id: revisionId,
              version_number: 1,
              status: "frozen",
              intent: "product_recommendation",
              body: "今天想和大家分享云感保湿乳。",
              review: { id: "copy-review-a14", status: "approved" }
            },
            product_revision_snapshot: {
              id: revisionId,
              organization_id: organizationId,
              project_id: projectId,
              product_id: productId,
              status: "ready",
              revision_number: 1,
              product_name: productName,
              product_description: "日常保湿",
              selling_points: [{ text: "清爽亲肤", confirmed: true }],
              asset_version_ids: [assetVersionId]
            },
            asset_references: [{
              asset_id: "asset-a14-browser",
              asset_version_id: assetVersionId,
              role: "product_image",
              display_name: "商品图",
              media_type: "image/png",
              size: PNG.length,
              checksum,
              retrieval_mode: "embedded",
              access_scope: "organization",
              body: PNG
            }],
            avatar_selection_snapshot: {
              avatar_selection_id: avatarSelectionId,
              copy_version_id: copyVersionId,
              avatar_asset_id: "avatar-asset-a14",
              asset_version_id: "avatar-version-a14",
              avatar_asset_version_id: "avatar-version-a14",
              status: "confirmed",
              version_number: 1,
              display_name: "林小满",
              source_type: "enterprise",
              authorization_status: "valid",
              capability_status: "verified",
              capabilities: [{ code: "mandarin_speech", evidence_reference: "seed:a14" }]
            },
            video_plan_version: {
              id: planId,
              version_number: 1,
              status: "frozen",
              output_instructions: "竖版种草口播，突出清爽亲肤。",
              upstream_snapshot: {
                product_revision_id: revisionId,
                copy_version_id: copyVersionId,
                avatar_selection_id: avatarSelectionId,
                avatar_asset_version_id: "avatar-version-a14"
              },
              capability_config_snapshot: {
                snapshot_version: "a14-capabilities",
                verified_capabilities: [{ code: "mandarin_speech", evidence_reference: "seed:a14" }]
              }
            }
          };
        }
      },
      agentReadinessPort: { async isOnline() { return false; } }
    },
    manualHandoff: {
      enabled: true,
      repository: createMemoryManualHandoffRepository(),
      packageStore: createMemoryManualHandoffPackageStore(),
      worker: { autoStart: false }
    },
    manualExecution: {
      enabled: true,
      repository: createMemoryManualExecutionRepository(),
      candidateStore: createMemoryObjectStore()
    },
    artifactVerification: {
      enabled: true,
      service: verificationService,
      workerInstance: {
        start() {},
        stop() {},
        runNextVerificationJob: verificationService.runNextVerificationJob
      }
    },
    workDelivery: {
      enabled: true,
      service: workDeliveryService
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
  const executablePath = process.env.IDENTITY_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  try {
    browser = await chromium.launch({ headless: true, executablePath });
  } catch (error) {
    return t.skip(`system Chrome unavailable: ${error.message}`);
  }
  t.after(() => browser.close());
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const operatorContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const adminPage = await adminContext.newPage();
  const operatorPage = await operatorContext.newPage();
  t.after(() => Promise.all([adminContext.close(), operatorContext.close()]));

  await adminPage.goto(`${origin}/login.html`);
  await adminPage.getByLabel("工作邮箱").fill(adminEmail);
  await adminPage.getByLabel("密码", { exact: true }).fill(adminTempPassword);
  await adminPage.getByRole("button", { name: "登录" }).click();
  await adminPage.locator("#newPassword").fill("A14-Admin-Permanent-9!");
  await adminPage.getByRole("button", { name: "保存并进入工作台" }).click();
  await adminPage.waitForURL(`${origin}/projects.html`);

  await adminPage.goto(`${origin}/members.html`);
  await adminPage.getByRole("button", { name: "创建成员" }).click();
  const memberDialog = adminPage.getByRole("dialog", { name: "创建成员" });
  await memberDialog.getByLabel("工作邮箱").fill(operatorEmail);
  await memberDialog.getByLabel("姓名").fill("A14 执行成员");
  await memberDialog.getByRole("button", { name: "创建并生成临时密码" }).click();
  const temporaryPasswordNode = adminPage.locator("#temporaryPassword:not([hidden])");
  await temporaryPasswordNode.waitFor();
  const temporaryPassword = (await temporaryPasswordNode.textContent()).match(/：(.+?)。/)?.[1];
  assert.ok(temporaryPassword);
  await memberDialog.getByRole("button", { name: "关闭创建成员" }).click();

  await operatorPage.goto(`${origin}/login.html`);
  await operatorPage.getByLabel("工作邮箱").fill(operatorEmail);
  await operatorPage.getByLabel("密码", { exact: true }).fill(temporaryPassword);
  await operatorPage.getByRole("button", { name: "登录" }).click();
  await operatorPage.locator("#newPassword").fill("A14-Operator-Permanent-9!");
  await operatorPage.getByRole("button", { name: "保存并进入工作台" }).click();
  await operatorPage.waitForURL(`${origin}/projects.html`);

  await operatorPage.getByRole("button", { name: "创建项目" }).click();
  await operatorPage.getByLabel("项目名称").fill("A14 全链路项目");
  await operatorPage.getByRole("dialog", { name: "创建项目" }).getByRole("button", { name: "创建项目", exact: true }).click();
  await operatorPage.getByText("A14 全链路项目", { exact: true }).waitFor();
  const projectHref = await operatorPage.getByRole("link", { name: "打开" }).first().getAttribute("href");
  projectId = new URL(projectHref, origin).searchParams.get("id");
  assert.ok(projectId);
  await operatorPage.getByRole("link", { name: "打开" }).click();
  await operatorPage.getByRole("button", { name: "创建商品" }).click();
  await operatorPage.getByRole("dialog", { name: "创建商品" }).getByLabel("商品名称", { exact: true }).fill(productName);
  await operatorPage.getByRole("dialog", { name: "创建商品" }).getByRole("button", { name: "创建商品", exact: true }).click();

  await operatorPage.goto(`${origin}/assets.html`);
  await operatorPage.locator("#assetFile").setInputFiles(assetPath);
  await operatorPage.getByRole("button", { name: "上传并开始核验" }).click();
  await operatorPage.getByText("核验中", { exact: true }).waitFor();
  await app.assets.service.runNextVerificationJob();
  await operatorPage.getByText("核验通过", { exact: true }).waitFor({ timeout: 5000 });
  const listedAssets = await operatorPage.evaluate(async () => (await (await fetch("/api/assets")).json()).assets);
  assetVersionId = listedAssets[0].versions[0].id;

  await operatorPage.goto(`${origin}/project.html?id=${encodeURIComponent(projectId)}`);
  await operatorPage.getByRole("button", { name: "新增卖点" }).click();
  await operatorPage.locator(".point-row input").fill("清爽亲肤");
  await operatorPage.getByRole("button", { name: "保存草稿" }).click();
  await operatorPage.getByText("草稿已保存。", { exact: true }).waitFor();
  await operatorPage.getByRole("button", { name: "确认", exact: true }).click();
  await operatorPage.getByText(/已确认。$/).waitFor();
  await operatorPage.locator("#assetOptions input").check();
  await operatorPage.getByRole("button", { name: "设为资料已就绪", exact: true }).click();
  await operatorPage.getByText("商品资料已设为就绪。", { exact: true }).waitFor();
  revisionId = new URL(operatorPage.url()).searchParams.get("revision");
  productId = (await operatorPage.evaluate(async (id) => (await (await fetch(`/api/projects/${id}`)).json()).project.products[0].id, projectId));
  assert.ok(productId);
  assert.ok(revisionId);
  const copyHref = await operatorPage.locator("#openCopyWorkspace").getAttribute("href");
  assert.equal(new URL(copyHref, origin).searchParams.get("revision"), revisionId);
  await operatorPage.reload();
  assert.equal(new URL(operatorPage.url()).searchParams.get("revision"), revisionId);
  await operatorPage.locator("#openCopyWorkspace").click();
  await operatorPage.waitForURL(/\/copy\.html\?project=/);
  assert.match(await operatorPage.locator("#productFactsLink").getAttribute("href"), /[?&]revision=[^&]+/);

  await operatorPage.locator("#generateCopy").click();
  await operatorPage.getByText("文案正在生成，可离开此页面。", { exact: true }).waitFor();
  await app.copyGeneration.worker.runNext();
  await operatorPage.locator("#copyBody").waitFor();
  copyVersionId = await operatorPage.evaluate(async () => (await (await fetch(`/api/product-revisions/${new URLSearchParams(location.search).get("revision")}/copy-versions`)).json()).copy_versions.at(-1).id);
  await operatorPage.locator("#startQuality").click();
  await app.copyQuality.worker.runNext();
  await operatorPage.locator("#qualityConclusion").filter({ hasText: "质检通过" }).waitFor({ timeout: 5000 });
  await operatorPage.locator("#reviewTab").click();
  await operatorPage.locator("#submitReview").click();
  await operatorPage.locator("#reviewConclusion").filter({ hasText: "审核中" }).waitFor();

  const copyUrl = `${origin}/copy.html?project=${encodeURIComponent(projectId)}&revision=${encodeURIComponent(revisionId)}`;
  await adminPage.goto(copyUrl);
  await adminPage.locator("#reviewTab").click();
  await adminPage.locator("#approveReview").click();
  await adminPage.locator("#confirmApproveReview").click();
  await adminPage.locator("#reviewConclusion").filter({ hasText: "已批准" }).waitFor();
  await operatorPage.goto(copyUrl);
  await operatorPage.locator("#reviewTab").click();
  await operatorPage.locator("#reviewConclusion").filter({ hasText: "已批准" }).waitFor();
  await operatorPage.locator("#nextStageLink").waitFor();
  await operatorPage.locator("#nextStageLink").click();
  await operatorPage.waitForURL(/\/avatar\.html\?project=/);
  await operatorPage.getByRole("button", { name: /林小满/ }).first().click();
  await operatorPage.locator("#confirmAvatar").click();
  await operatorPage.locator("#submitConfirmAvatar").click();
  await operatorPage.getByText("人物已确认。", { exact: true }).waitFor();
  avatarSelectionId = await operatorPage.evaluate(async () => (await (await fetch(`/api/products/${new URLSearchParams(location.search).get("product")}/avatar-workspace`)).json()).selection.current_selection.id);
  await operatorPage.locator("#nextPlanLink").click();
  await operatorPage.waitForURL(/\/plan\.html\?project=/);
  await operatorPage.locator("#emptyPlan").waitFor();
  assert.equal(await operatorPage.locator("#emptyPlan").isVisible(), true);
  await operatorPage.locator("#firstInstructions").fill("竖版种草口播，先展示使用场景，再突出核心卖点。");
  await operatorPage.locator("#createPlan").click();
  await operatorPage.locator("#planVersionTitle").waitFor();
  planId = await operatorPage.evaluate(async () => (await (await fetch(`/api/products/${new URLSearchParams(location.search).get("product")}/video-plan-workspace`)).json()).current_plan.id);
  await operatorPage.locator("#runPreflight").click();
  await app.videoPlanning.worker.runNext();
  await operatorPage.locator("#preflightBadge").filter({ hasText: "存在提醒" }).waitFor({ timeout: 5000 });
  await operatorPage.locator("#showReview").click();
  await operatorPage.locator("#submitReview").click();
  await operatorPage.locator("#confirmReviewAction").click();
  await operatorPage.locator("#reviewBadge").filter({ hasText: "审核中" }).waitFor();

  const planUrl = `${origin}/plan.html?project=${encodeURIComponent(projectId)}&product=${encodeURIComponent(productId)}&plan=${encodeURIComponent(planId)}`;
  await adminPage.goto(`${origin}/plan.html?project=${encodeURIComponent(projectId)}&product=${encodeURIComponent(productId)}&plan=${encodeURIComponent(planId)}`);
  await adminPage.locator("#showReview").click();
  await adminPage.locator("#approveReview").click();
  await adminPage.locator("#confirmReviewAction").click();
  await adminPage.locator("#reviewBadge").filter({ hasText: "已批准" }).waitFor();
  await operatorPage.goto(planUrl);
  await operatorPage.locator("#createOrderLink").waitFor();
  await operatorPage.locator("#createOrderLink").click();
  await operatorPage.waitForURL(/\/production\.html\?project=/);

  await operatorPage.locator("#createOrderButton").click();
  await operatorPage.locator("#purposeFirst").check();
  await operatorPage.locator("#confirmCreateOrder").click();
  await operatorPage.locator("#orderStatus").filter({ hasText: "等待执行" }).waitFor();
  orderId = await operatorPage.locator("#orderList [data-order-id]").last().getAttribute("data-order-id");
  await operatorPage.locator("#generatePackageButton").click();
  await operatorPage.getByText("生成中", { exact: true }).waitFor();
  await app.manualHandoff.worker.runNext();
  await operatorPage.getByText("可下载", { exact: true }).waitFor({ timeout: 7000 });
  await operatorPage.reload();
  await operatorPage.getByText("可下载", { exact: true }).waitFor();
  await operatorPage.locator("#claimManualExecution").click();
  await operatorPage.getByText("任务已领取，请确认开始。", { exact: true }).waitFor();
  await operatorPage.locator("#confirmManualStart").click();
  await operatorPage.locator("#confirmStartManualButton").click();
  await operatorPage.locator("#manualCandidateFile").setInputFiles({ name: "a14-candidate.mp4", mimeType: "video/mp4", buffer: CANDIDATE });
  await operatorPage.locator("#uploadManualCandidate").click();
  await operatorPage.getByText("候选作品已上传，等待提交结果。", { exact: true }).waitFor();
  await operatorPage.locator("#submitManualReport").click();
  await operatorPage.locator("#manualReportOutcome").selectOption("completed");
  await operatorPage.locator("#confirmManualReportButton").click();
  await operatorPage.getByText("执行结果已提交，候选作品等待后续核验。", { exact: true }).waitFor();
  await operatorPage.locator("#requestWorkVerification").click();
  await operatorPage.getByText("核验请求已受理", { exact: false }).waitFor();
  await app.artifactVerification.worker.runNextVerificationJob();
  await operatorPage.getByText("作品已登记", { exact: true }).waitFor({ timeout: 7000 });
  const worksHref = await operatorPage.locator("#worksLibraryLink").getAttribute("href");
  assert.match(worksHref, /works\.html\?work=/);
  assert.equal(await operatorPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  if (screenshotDir) await operatorPage.screenshot({ path: path.join(screenshotDir, "a14-production-1440.png"), fullPage: true });

  await adminPage.goto(`${origin}${worksHref}`);
  await adminPage.getByRole("heading", { name: "作品库", exact: true }).waitFor();
  await adminPage.getByText(productName, { exact: true }).first().waitFor();
  await adminPage.locator("#passInspection").click();
  await adminPage.locator("#submitPass").click();
  await adminPage.getByText("检查已完成。", { exact: true }).waitFor();
  await adminPage.locator("#recordDelivery").click();
  await adminPage.locator("#deliveryRecipient").fill("品牌运营团队");
  await adminPage.locator("#deliveryNote").fill("A14 浏览器验收交付");
  await adminPage.locator("#submitDelivery").click();
  await adminPage.getByText("交付已登记", { exact: false }).waitFor();
  await adminPage.locator("#selectedDeliveryStatus").filter({ hasText: "已交付" }).waitFor();
  assert.equal((await adminPage.locator("#deliveryCount").textContent()).trim(), "共 1 次");
  await adminPage.setViewportSize({ width: 390, height: 844 });
  assert.equal(await adminPage.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  if (screenshotDir) await adminPage.screenshot({ path: path.join(screenshotDir, "a14-works-390.png"), fullPage: true });

  const pageText = await adminPage.locator("body").innerText();
  for (const forbidden of ["Hifly", "Provider", "Capture", "积分", "WorkInspection", "DeliveryRecord", "checksum", "manifest", "Playwright"]) {
    assert.equal(pageText.includes(forbidden), false, `forbidden enterprise UI term: ${forbidden}`);
  }
});
