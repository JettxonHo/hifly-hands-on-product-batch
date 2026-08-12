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
import { createMemoryProductionOrderRepository } from "../src/production-orders/memory-production-order-repository.js";
import { buildApp } from "../src/server/app.js";
import { findAvailablePort } from "../src/server/start.js";
import { createMemoryVideoPlanningRepository } from "../src/video-planning/memory-video-planning-repository.js";
import { ADMIN_EMAIL, ADMIN_TEMP_PASSWORD } from "./helpers/identity-world.js";

test("production workspace supports empty/create/re-entry flows at desktop and 390px without A10 buttons", async (t) => {
  const screenshotDir = process.env.A09_SCREENSHOT_DIR;
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-production-browser-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(57900), host = `127.0.0.1:${port}`, origin = `http://${host}`;
  const identityRepository = createMemoryIdentityRepository();
  const seeded = await seedInitialAdmin(identityRepository, { organizationId: "org-production-browser", organizationName: "生产工作台",
    adminEmail: ADMIN_EMAIL, adminDisplayName: "生产运营", adminTempPassword: ADMIN_TEMP_PASSWORD });
  const app = await buildApp({ root, executor: createFakeExecutor(),
    identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin], cookieSecure: false, seed: { enabled: false } },
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort: { async bindAvailableVersion(input) { return { reference: input }; } } },
    videoPlanning: { enabled: true, repository: createMemoryVideoPlanningRepository(), worker: { autoStart: false },
      upstreamPort: { async resolveCurrent() { return null; } }, capabilitySnapshotPort: { async resolve() { return null; } },
      agentReadinessPort: { async isOnline() { return false; } } },
    productionOrders: { enabled: true, repository: createMemoryProductionOrderRepository(),
      inputSnapshotPort: { async freezeForOrder() {
        return { approved_copy_snapshot: { copy_version_id: "copy-browser", product_revision_id: "revision-browser", version_number: 1, status: "frozen", intent: "product_recommendation", body: "浏览器冻结文案正文", review: { id: "review-browser", status: "approved" } },
          product_revision_snapshot: { id: "revision-browser", organization_id: "org-production-browser", project_id: "project-browser", product_id: product.id, status: "ready", revision_number: 1, product_name: "云感保湿乳", product_description: "日常保湿", asset_version_ids: ["product-image-browser"] },
          asset_references: [{ asset_id: "asset-browser", asset_version_id: "product-image-browser", role: "product_image", display_name: "商品图", media_type: "image/png", size: 5, checksum: "6105d6cc76af400325e94d588ce511be5bfdbb73b437dc51eca43917d7a43e3d", retrieval_mode: "embedded", access_scope: "organization", body: Buffer.from("image") }],
          avatar_selection_snapshot: { avatar_selection_id: "selection-browser", copy_version_id: "copy-browser", asset_version_id: "avatar-browser", status: "confirmed", version_number: 1, avatar_asset_id: "avatar-asset-browser", display_name: "浏览器人物", source_type: "enterprise", authorization_status: "valid", capability_status: "verified", capabilities: [{ code: "speech", evidence_reference: "seed:speech" }] } };
      } },
      planPort: { async resolveCurrentApprovedPlan({ organizationId, productId }) {
        if (organizationId !== "org-production-browser" || productId !== product.id) return null;
        return { current_valid: true, gate: { can_create: true, reasons: [] },
          plan: { id: "plan-browser", organization_id: organizationId, product_id: productId, version_number: 2, status: "frozen",
            output_instructions: "竖版商品种草口播", upstream_snapshot: { product_revision_id: "revision-browser", copy_version_id: "copy-browser",
              avatar_selection_id: "selection-browser", avatar_asset_version_id: "avatar-browser" },
            capability_config_snapshot: { snapshot_version: "capability-browser", verified_capabilities: [{ code: "speech", evidence_reference: "seed:speech" }] } },
          plan_review: { id: "review-browser", status: "approved" },
          preflight_result: { id: "preflight-browser", status: "warning", groups: { production_readiness: { status: "warning", checks: [] } } } };
      } }, agentReadinessPort: { async isOnline() { return false; } } }
  });
  const project = await app.projectContent.service.createProject({ organizationId: "org-production-browser", actorMemberId: seeded.member.id,
    idempotencyKey: "production-browser-project", name: "生产项目" });
  const { product } = await app.projectContent.service.createProduct({ organizationId: "org-production-browser", actorMemberId: seeded.member.id,
    projectId: project.id, idempotencyKey: "production-browser-product", productName: "云感保湿乳" });
  try { await app.listen({ host: "127.0.0.1", port }); }
  catch (error) { await app.close(); if (error.code === "EPERM") return t.skip("sandbox disallows local TCP listening"); throw error; }
  t.after(() => app.close());

  let browser;
  const executablePath = process.env.IDENTITY_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  try { browser = await chromium.launch({ headless: true, executablePath }); }
  catch (_systemError) { try { browser = await chromium.launch({ headless: true }); } catch (error) { return t.skip(`Chrome/Chromium unavailable: ${error.message}`); } }
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => { window.__HIFLY_CLOUD_STATUS_POLL_INTERVAL_MS__ = 50; });
  await page.goto(`${origin}/login.html`); await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD); await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("Production-Browser-Password-9!"); await page.getByRole("button", { name: "保存并进入工作台" }).click(); await page.waitForURL(`${origin}/projects.html`);

  let cloudStatusRequests = 0, cloudStatusActiveRequests = 0, maxCloudStatusActiveRequests = 0, cloudStatusFailure = false;
  let cloudState = { worker: { connection: "offline", last_heartbeat_at: null }, readiness: { status: "requires_action" }, worker_state: "offline", current_order: null, current_attempt: null, progress: null, execution: { status: "pending" }, verification: { status: "not_started" }, work: null, delivery: { status: "not_available" }, failure: null };
  await page.route("**/api/cloud-executor/status", async (route) => {
    cloudStatusRequests += 1;
    cloudStatusActiveRequests += 1;
    maxCloudStatusActiveRequests = Math.max(maxCloudStatusActiveRequests, cloudStatusActiveRequests);
    await new Promise((resolve) => setTimeout(resolve, 75));
    try { return await route.fulfill({ status: cloudStatusFailure ? 503 : 200, contentType: "application/json", body: JSON.stringify(cloudStatusFailure ? { error: "STATUS_UNAVAILABLE" } : cloudState) }); }
    finally { cloudStatusActiveRequests -= 1; }
  });
  await page.goto(`${origin}/production.html?project=${project.id}&product=${product.id}`);
  await page.getByRole("heading", { name: "生成与交付", exact: true }).waitFor();
  await page.locator("#orderListEmpty").waitFor();
  await page.getByText("云端执行器离线", { exact: true }).waitFor();
  assert.equal(await page.getByText("请启动本地 Agent", { exact: false }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  assert.equal(await page.getByRole("button", { name: "生成交接包" }).count(), 0);

  await page.getByRole("button", { name: "+ 创建工单" }).click();
  const dialog = page.getByRole("dialog", { name: "创建生产工单" }); await dialog.waitFor();
  assert.equal(await dialog.locator("input[type=radio]:checked").count(), 0);
  assert.equal(await dialog.getByRole("button", { name: "确认创建工单" }).isDisabled(), true);
  await dialog.getByLabel("首次生产", { exact: false }).check();
  await dialog.getByRole("button", { name: "确认创建工单" }).dblclick();
  await page.getByText("等待执行", { exact: true }).first().waitFor();
  const orderId = await page.locator("#orderList [data-order-id]").getAttribute("data-order-id");
  cloudState = { worker: { connection: "online", last_heartbeat_at: "2026-08-12T00:01:00.000Z" }, readiness: { status: "busy" }, worker_state: "busy", current_order: { id: orderId, status: "running" }, current_attempt: { id: "attempt-browser", status: "running", progress_phase: "uploading", heartbeat_at: "2026-08-12T00:01:00.000Z" }, progress: { phase: "uploading", label: "上传素材", updated_at: "2026-08-12T00:01:00.000Z" }, execution: { status: "pending" }, verification: { status: "not_started" }, work: null, delivery: { status: "not_available" }, failure: null };
  await page.getByText("Cloud Executor 正在执行", { exact: true }).waitFor({ timeout: 1000 });
  await page.getByText("上传素材", { exact: true }).first().waitFor();
  cloudStatusFailure = true;
  await page.getByText("云端执行器离线", { exact: true }).waitFor();
  cloudStatusFailure = false;
  cloudState = { ...cloudState, progress: { phase: "waiting_provider", label: "等待云端生成", updated_at: "2026-08-12T00:01:30.000Z" }, current_attempt: { ...cloudState.current_attempt, progress_phase: "waiting_provider" } };
  await page.getByText("等待云端生成", { exact: true }).first().waitFor();
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "a09-production-1440.png"), fullPage: true });
  assert.equal(await page.locator("#orderList [data-order-id]").count(), 1);
  assert.equal(await page.getByText("目的在创建时固定，不可修改。", { exact: true }).count() > 0, true);
  assert.equal(await page.getByRole("button", { name: "生成交接包" }).count(), 0);

  await page.setViewportSize({ width: 390, height: 844 });
  cloudState = { worker: { connection: "online", last_heartbeat_at: "2026-08-12T00:02:00.000Z" }, readiness: { status: "requires_login" }, worker_state: "requires_action", current_order: { id: orderId, status: "waiting_for_executor" }, current_attempt: null, progress: null, execution: { status: "pending" }, verification: { status: "not_started" }, work: null, delivery: { status: "not_available" }, failure: null };
  await page.getByText("需要重新登录飞影", { exact: true }).first().waitFor();
  cloudState = { worker: { connection: "online", last_heartbeat_at: "2026-08-12T00:03:00.000Z" }, readiness: { status: "storage_blocked" }, worker_state: "requires_action", current_order: { id: orderId, status: "waiting_for_executor" }, current_attempt: null, progress: null, execution: { status: "pending" }, verification: { status: "not_started" }, work: null, delivery: { status: "not_available" }, failure: null };
  await page.getByText("云端磁盘空间不足", { exact: true }).waitFor();
  cloudState = { worker: { connection: "online", last_heartbeat_at: "2026-08-12T00:04:00.000Z" }, readiness: { status: "requires_action" }, worker_state: "requires_action", current_order: { id: orderId, status: "failed" }, current_attempt: { id: "attempt-browser", status: "failed", progress_phase: "failed" }, progress: { phase: "failed", label: "执行失败", updated_at: "2026-08-12T00:04:00.000Z" }, execution: { status: "failed" }, verification: { status: "not_started" }, work: null, delivery: { status: "not_available" }, failure: { code: "CLOUD_EXECUTOR_EXECUTION_FAILED", stage: "execution", message: "Cloud Executor 执行失败；不会自动重试。", retryable: false } };
  await page.getByText("Cloud Executor 执行失败；不会自动重试。", { exact: true }).first().waitFor();
  assert.equal(await page.getByText("需要人工处理", { exact: true }).count() > 0, true);
  cloudState = { worker: { connection: "online", last_heartbeat_at: "2026-08-12T00:05:00.000Z" }, readiness: { status: "available" }, worker_state: "standby", current_order: { id: orderId, status: "succeeded" }, current_attempt: { id: "attempt-browser", status: "succeeded", progress_phase: "succeeded" }, progress: { phase: "succeeded", label: "执行成功", updated_at: "2026-08-12T00:05:00.000Z" }, execution: { status: "succeeded" }, verification: { status: "passed", job_id: "job-browser" }, work: { id: "work-browser", status: "available", delivery_status: "delivered", preview_available: true, download_available: true }, delivery: { status: "delivered" }, failure: null };
  await page.locator("#cloudExecutorWorkLink").waitFor({ state: "visible" });
  const workHref = await page.locator("#cloudExecutorWorkLink").getAttribute("href");
  assert.match(workHref, /^\/works\.html\?/);
  assert.doesNotMatch(workHref, /artifacts|object_key|signed/);
  assert.equal(maxCloudStatusActiveRequests, 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "a09-production-390.png"), fullPage: true });
  const requestsBeforeLeave = cloudStatusRequests;
  await page.goto("about:blank");
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(cloudStatusRequests, requestsBeforeLeave);
});
