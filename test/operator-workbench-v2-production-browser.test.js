import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chromium } from "playwright";

import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { createMemoryIdentityRepository } from "../src/identity/memory-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createMemoryManualHandoffPackageStore } from "../src/manual-handoff/manual-handoff-package-store.js";
import { createMemoryManualHandoffRepository } from "../src/manual-handoff/memory-manual-handoff-repository.js";
import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
import { createMemoryProductionOrderRepository } from "../src/production-orders/memory-production-order-repository.js";
import { buildApp } from "../src/server/app.js";
import { findAvailablePort } from "../src/server/start.js";
import { createMemoryVideoPlanningRepository } from "../src/video-planning/memory-video-planning-repository.js";
import { ADMIN_EMAIL, ADMIN_TEMP_PASSWORD } from "./helpers/identity-world.js";

test("approved Plan with no order exposes one business-first Production recommendation", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-v2-production-browser-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(58900);
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const organizationId = "org-v2-production-browser";
  const identityRepository = createMemoryIdentityRepository();
  const seeded = await seedInitialAdmin(identityRepository, {
    organizationId,
    organizationName: "星桥生产工作台",
    adminEmail: ADMIN_EMAIL,
    adminDisplayName: "生产运营",
    adminTempPassword: ADMIN_TEMP_PASSWORD
  });

  let product;
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
      assetReferencePort: { async bindAvailableVersion(input) { return { reference: input }; } }
    },
    videoPlanning: {
      enabled: true,
      repository: createMemoryVideoPlanningRepository(),
      worker: { autoStart: false },
      upstreamPort: { async resolveCurrent() { return null; } },
      capabilitySnapshotPort: { async resolve() { return null; } },
      agentReadinessPort: { async isOnline() { return false; } }
    },
    productionOrders: {
      enabled: true,
      repository: createMemoryProductionOrderRepository(),
      inputSnapshotPort: {
        async freezeForOrder() {
          return {
            approved_copy_snapshot: {
              copy_version_id: "copy-v2-production",
              product_revision_id: "revision-v2-production",
              version_number: 1,
              status: "frozen",
              intent: "product_recommendation",
              body: "公开浏览器测试文案",
              review: { id: "copy-review-v2-production", status: "approved" }
            },
            product_revision_snapshot: {
              id: "revision-v2-production",
              organization_id: organizationId,
              project_id: "project-v2-production",
              product_id: product.id,
              status: "ready",
              revision_number: 1,
              product_name: "云感保湿乳",
              product_description: "日常保湿",
              asset_version_ids: []
            },
            asset_references: [],
            avatar_selection_snapshot: {
              avatar_selection_id: "avatar-selection-v2-production",
              copy_version_id: "copy-v2-production",
              asset_version_id: "avatar-version-v2-production",
              status: "confirmed",
              version_number: 1,
              avatar_asset_id: "avatar-v2-production",
              display_name: "企业人物",
              source_type: "enterprise",
              authorization_status: "valid",
              capability_status: "verified",
              capabilities: []
            }
          };
        }
      },
      planPort: {
        async resolveCurrentApprovedPlan({ organizationId: requestedOrganizationId, productId }) {
          if (requestedOrganizationId !== organizationId || productId !== product.id) return null;
          return {
            current_valid: true,
            gate: { can_create: true, reasons: [] },
            plan: {
              id: "plan-v2-production",
              organization_id: organizationId,
              product_id: product.id,
              version_number: 2,
              status: "frozen",
              output_instructions: "竖版商品种草口播",
              upstream_snapshot: {
                product_revision_id: "revision-v2-production",
                copy_version_id: "copy-v2-production",
                avatar_selection_id: "avatar-selection-v2-production",
                avatar_asset_version_id: "avatar-version-v2-production"
              },
              capability_config_snapshot: { snapshot_version: "capability-v2-production", verified_capabilities: [] }
            },
            plan_review: { id: "plan-review-v2-production", status: "approved" },
            preflight_result: {
              id: "preflight-v2-production",
              status: "warning",
              groups: { production_readiness: { status: "warning", checks: [] } }
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
    }
  });

  const project = await app.projectContent.service.createProject({
    organizationId,
    actorMemberId: seeded.member.id,
    idempotencyKey: "v2-production-project",
    name: "生产项目"
  });
  ({ product } = await app.projectContent.service.createProduct({
    organizationId,
    actorMemberId: seeded.member.id,
    projectId: project.id,
    idempotencyKey: "v2-production-product",
    productName: "云感保湿乳"
  }));

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
  } catch (_systemError) {
    try {
      browser = await chromium.launch({ headless: true });
    } catch (error) {
      return t.skip(`Chrome/Chromium unavailable: ${error.message}`);
    }
  }
  t.after(() => browser.close());

  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.addInitScript(() => { window.__HIFLY_CLOUD_STATUS_POLL_INTERVAL_MS__ = 60_000; });
  let cloudState = {
    worker: { connection: "offline", last_heartbeat_at: null },
    readiness: { status: "disabled" },
    worker_state: "disabled",
    current_order: null,
    current_attempt: null,
    progress: null,
    execution: { status: "pending" },
    verification: { status: "not_started" },
    work: null,
    delivery: { status: "not_available" },
    failure: null
  };
  let persistedOrderStatus = null;
  let persistedExecution = null;
  let persistedVerification = null;
  let persistedVerificationReadFailures = 0;
  let persistedVerificationOrderOverride = null;
  let persistedWork = null;
  let persistedWorkReadFailures = 0;
  let manualHandoffOverride = null;
  await page.route("**/api/runtime", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    return route.fulfill({ response, json: {
      ...body,
      manualHandoffEnabled: manualHandoffOverride ?? body.manualHandoffEnabled,
      manualExecutionEnabled: true,
      artifactVerificationEnabled: true,
      worksEnabled: true
    } });
  });
  await page.route("**/api/cloud-executor/status", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(cloudState)
  }));
  await page.route(`**/api/products/${product.id}/production-workspace*`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    const persistedOrderId = new URL(route.request().url()).searchParams.get("orderId") || body.selected_order?.id || body.orders.at(-1)?.id;
    const projectedOrder = cloudState.current_order || (persistedOrderStatus && persistedOrderId
      ? { id: persistedOrderId, status: persistedOrderStatus }
      : null);
    if (projectedOrder?.id) {
      body.orders = body.orders.map((order) => order.id === projectedOrder.id
        ? { ...order, status: projectedOrder.status }
        : order);
      if (body.selected_order?.id === projectedOrder.id) body.selected_order = { ...body.selected_order, status: projectedOrder.status };
    }
    return route.fulfill({ response, json: body });
  });
  let selectedOrderId = null;
  let packageState = null;
  await page.route("**/api/production-orders/*/manual-handoff-packages", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const pathname = new URL(route.request().url()).pathname;
    if (selectedOrderId && !pathname.endsWith(`/api/production-orders/${selectedOrderId}/manual-handoff-packages`)) return route.continue();
    const packageProjection = packageState ? {
      package_id: `package-v2-production-${packageState}`,
      production_order_id: selectedOrderId,
      package_version: 1,
      status: packageState,
      created_at: "2026-08-17T08:00:00.000Z",
      updated_at: "2026-08-17T08:00:00.000Z",
      supersedes_package_id: null,
      integrity_summary: packageState === "ready" ? "交接资料完整" : null,
      content_summary: null,
      failure_reason: packageState === "generation_failed" ? "交接资料准备失败。" : null
    } : null;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ packages: packageProjection ? [packageProjection] : [] })
    });
  });
  await page.route("**/api/production-orders/*/manual-execution", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const orderId = new URL(route.request().url()).pathname.split("/").at(-2);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(persistedExecution || {
        order: { id: orderId, status: persistedOrderStatus || "waiting_for_executor" },
        current_attempt: null,
        candidates: [],
        reports: []
      })
    });
  });
  await page.route("**/api/production-orders/*/work-verification", (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const orderId = new URL(route.request().url()).pathname.split("/").at(-2);
    if (persistedVerificationReadFailures > 0) {
      persistedVerificationReadFailures -= 1;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "CONTROLLED_VERIFICATION_READ_FAILURE" }) });
    }
    const projectedVerification = structuredClone(persistedVerification || {
      order: { id: orderId, status: persistedOrderStatus || "waiting_for_executor" },
      job: null,
      work: null,
      works: []
    });
    if (persistedVerificationOrderOverride) projectedVerification.order.id = persistedVerificationOrderOverride;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(projectedVerification)
    });
  });
  await page.route("**/api/works/*", (route) => {
    if (route.request().method() !== "GET" || !persistedWork) return route.continue();
    if (persistedWorkReadFailures > 0) {
      persistedWorkReadFailures -= 1;
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "CONTROLLED_WORK_READ_FAILURE" }) });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ work: persistedWork }) });
  });

  let initialProductionBootstrapFailed = false;
  await page.route(`**/api/projects/${project.id}`, (route) => {
    if (!initialProductionBootstrapFailed && new URL(page.url()).pathname === "/production.html") {
      initialProductionBootstrapFailed = true;
      return route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ error: "CONTROLLED_PRODUCTION_BOOTSTRAP_FAILURE" })
      });
    }
    return route.continue();
  });

  await page.goto(`${origin}/login.html`);
  await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("Operator-V2-Production-9!");
  await page.getByRole("button", { name: "保存并进入工作台" }).click();
  await page.waitForURL(`${origin}/projects.html`);

  await page.goto(`${origin}/production.html?project=${project.id}&product=${product.id}`);
  await page.getByText("生成与交付工作区加载失败", { exact: false }).waitFor();
  assert.equal(initialProductionBootstrapFailed, true, "The injected failure must target Production's own initial bootstrap");
  assert.equal(await page.locator('[data-recommended-action="true"]').count(), 1);
  assert.equal(await page.locator("#refreshProduction").getAttribute("data-recommended-action"), "true");
  await page.locator("#refreshProduction").click();
  await page.locator("#productionWorkspace:not([hidden])").waitFor();
  await page.locator("#orderListEmpty").waitFor({ state: "visible" });
  await page.getByText("已批准方案", { exact: true }).waitFor();
  assert.equal(await page.locator("#orderList [data-order-id]").count(), 0);
  assert.equal((await page.locator("#productSelector option:checked").textContent()).trim(), "云感保湿乳");

  const taskSummary = page.locator("#productionTaskSummary");
  assert.equal(await page.locator("#productionTechnicalDetails").getAttribute("open"), null, "technical details must be collapsed by default");
  assert.equal(await taskSummary.count(), 1, "approved Plan with no order must render #productionTaskSummary");
  const taskSummaryText = await taskSummary.innerText();
  assert.match(taskSummaryText, /云感保湿乳/);
  assert.equal(await taskSummary.getByText("生产", { exact: true }).count(), 1);
  assert.match(taskSummaryText, /可准备生产/);
  assert.match(taskSummaryText, /创建生产工单/);
  assert.doesNotMatch(taskSummaryText, /Cloud Executor|\battempt\b|\bhandoff\b|\beligible\b/i);

  const recommendedAction = page.locator('[data-recommended-action="true"]');
  assert.equal(await recommendedAction.count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  await recommendedAction.click();
  const createOrderDialog = page.getByRole("dialog", { name: "创建生产工单" });
  await createOrderDialog.waitFor({ state: "visible" });
  assert.equal(await createOrderDialog.evaluate((dialog) => dialog.contains(document.activeElement)), true);
  await createOrderDialog.getByRole("button", { name: "关闭创建生产工单" }).click();
  assert.equal(await page.locator("#createOrderEmpty").evaluate((button) => button === document.activeElement), true);
  await page.locator("#createOrderEmpty").click();
  await createOrderDialog.waitFor({ state: "visible" });
  await createOrderDialog.getByLabel("首次生产", { exact: false }).check();
  await createOrderDialog.getByRole("button", { name: "确认创建工单" }).click();
  await page.locator("#orderList [data-order-id]").waitFor();
  selectedOrderId = await page.locator("#orderList [data-order-id]").getAttribute("data-order-id");
  assert.ok(selectedOrderId);
  await page.locator("#orderStatus").waitFor({ state: "visible" });
  assert.equal((await page.locator("#orderStatus").textContent()).trim(), "等待执行");
  assert.equal((await page.locator("#packageStatus").textContent()).trim(), "未生成");

  async function assertCreateOrderBlocked() {
    for (const selector of ["#createOrderButton", "#createOrderEmpty"]) {
      const control = page.locator(selector);
      assert.equal(await control.isDisabled(), true, `${selector} must be disabled while an order exists`);
      await control.evaluate((button) => button.click());
      assert.equal(await createOrderDialog.isVisible(), false, `${selector} must not open a second-order dialog`);
    }
  }
  await assertCreateOrderBlocked();

  assert.equal(await taskSummary.isVisible(), true, "waiting order with no handoff package must keep #productionTaskSummary visible");
  const waitingOrderSummaryText = await taskSummary.innerText();
  assert.match(waitingOrderSummaryText, /云感保湿乳/);
  assert.equal(await taskSummary.getByText("生产", { exact: true }).count(), 1);
  assert.equal((await page.locator("#productionTaskStatus").textContent()).trim(), "交接资料未就绪");
  assert.equal((await page.locator("#productionTaskNextStep").textContent()).trim(), "生成生产交接包");
  assert.equal((await recommendedAction.count()) <= 1, true);
  assert.equal(await recommendedAction.count(), 1);
  assert.equal(await recommendedAction.getAttribute("id"), "generatePackageButton");

  async function reloadPackageState(state, packageStatus) {
    packageState = state;
    await page.reload();
    await page.locator("#productionWorkspace:not([hidden])").waitFor();
    await page.waitForFunction((expected) => document.querySelector("#packageStatus")?.textContent.trim() === expected, packageStatus);
    assert.equal((await page.locator("#orderStatus").textContent()).trim(), "等待执行");
  }

  async function assertPackageTaskSummary({ status, next, recommendedId = null }) {
    assert.equal(await taskSummary.isVisible(), true, `${packageState} package state must keep #productionTaskSummary visible`);
    const summaryText = await taskSummary.innerText();
    assert.match(summaryText, /云感保湿乳/);
    assert.equal(await taskSummary.getByText("生产", { exact: true }).count(), 1);
    const statusText = (await page.locator("#productionTaskStatus").textContent()).trim();
    if (status instanceof RegExp) assert.match(statusText, status); else assert.equal(statusText, status);
    if (next) {
      const nextText = (await page.locator("#productionTaskNextStep").textContent()).trim();
      if (next instanceof RegExp) assert.match(nextText, next); else assert.equal(nextText, next);
    }
    assert.doesNotMatch(summaryText, /Cloud Executor|\battempt\b|\bhandoff\b|\beligible\b/i);
    const recommendedCount = await recommendedAction.count();
    assert.equal(recommendedCount <= 1, true);
    assert.equal(recommendedCount, recommendedId ? 1 : 0);
    if (recommendedId) assert.equal(await recommendedAction.getAttribute("id"), recommendedId);
  }

  await reloadPackageState("generating", "生成中");
  await assertPackageTaskSummary({ status: "正在准备交接资料", next: "等待" });

  await reloadPackageState("generation_failed", "生成未完成");
  await assertPackageTaskSummary({ status: "交接资料准备失败", next: /人工确认重试/, recommendedId: "retryPackageButton" });

  await reloadPackageState("expired", "下载权限已过期");
  await assertPackageTaskSummary({ status: "下载授权已过期", next: "重新获取下载授权", recommendedId: "authorizePackageButton" });

  for (const [state, packageStatus] of [["superseded", "已由新版本替代"], ["revoked", "已停用"]]) {
    await reloadPackageState(state, packageStatus);
    await assertPackageTaskSummary({ status: "当前交接包不可用", next: /(返回当前有效包|重新生成)/ });
    assert.notEqual(await page.locator("#downloadPackageButton").getAttribute("data-recommended-action"), "true");
    assert.notEqual(await page.locator("#claimManualExecution").getAttribute("data-recommended-action"), "true");
  }

  await reloadPackageState("ready", "可下载");
  await assertPackageTaskSummary({ status: /^(生产门禁未通过|等待生产环境就绪)$/ });
  const readySummaryText = await taskSummary.innerText();
  const readyBlocker = page.locator("#productionTaskBlocker");
  assert.equal(await readyBlocker.isVisible(), true);
  const readyBlockerText = await readyBlocker.innerText();
  assert.match(readyBlockerText, /激活门禁尚未由页面证明/);
  assert.match(readyBlockerText, /等待获授权运维核对/);
  assert.doesNotMatch(readySummaryText, /可执行/);
  assert.notEqual(await page.locator("#claimManualExecution").getAttribute("data-recommended-action"), "true");
  assert.equal(await page.getByRole("button", { name: /(?:启动|停止).*(?:Worker|生产环境)|(?:Worker|生产环境).*(?:启动|停止)/i }).count(), 0);
  assert.doesNotMatch(await page.locator("#mainContent").innerText(), /(?:启动|停止)\s*(?:Cloud Executor|Worker)|(?:Cloud Executor|Worker)\s*(?:启动|停止)/i);

  async function reloadCloudState(nextState) {
    cloudState = nextState;
    await page.reload();
    await page.locator("#productionWorkspace:not([hidden])").waitFor();
    await page.waitForFunction(() => document.querySelector("#packageStatus")?.textContent.trim() === "可下载");
  }

  async function assertCloudTaskSummary({ status, next, recommended = null }) {
    assert.equal(await taskSummary.isVisible(), true);
    const summaryText = await taskSummary.innerText();
    const statusText = (await page.locator("#productionTaskStatus").textContent()).trim();
    const nextText = (await page.locator("#productionTaskNextStep").textContent()).trim();
    if (status instanceof RegExp) assert.match(statusText, status); else assert.equal(statusText, status);
    if (next instanceof RegExp) assert.match(nextText, next); else assert.equal(nextText, next);
    assert.doesNotMatch(summaryText, /attempt-v2-production|heartbeat|心跳/i);
    const recommendedCount = await recommendedAction.count();
    assert.equal(recommendedCount <= 1, true);
    if (recommended === null) assert.equal(recommendedCount, 0);
    else if (recommended.optional === true) {
      if (recommendedCount === 1) assert.equal(recommended.ids.includes(await recommendedAction.getAttribute("id")), true);
    }
    else if (Array.isArray(recommended)) {
      assert.equal(recommendedCount, 1);
      assert.equal(recommended.includes(await recommendedAction.getAttribute("id")), true);
    } else {
      assert.equal(recommendedCount, 1);
      assert.equal(await recommendedAction.getAttribute("id"), recommended);
    }
    return summaryText;
  }

  cloudState = {
    worker: { connection: "online", last_heartbeat_at: "2026-08-17T08:59:00.000Z" },
    readiness: { status: "busy" },
    worker_state: "busy",
    current_order: { id: selectedOrderId, status: "claimed" },
    current_attempt: { id: "attempt-v2-production", status: "claimed", progress_phase: "claimed", heartbeat_at: "2026-08-17T08:59:00.000Z" },
    progress: { phase: "claimed", label: "已领取", updated_at: "2026-08-17T08:59:00.000Z" },
    execution: { status: "pending" },
    verification: { status: "not_started" },
    work: null,
    delivery: { status: "not_available" },
    failure: null
  };
  await reloadCloudState(cloudState);
  await assertCloudTaskSummary({ status: "正在生成", next: "等待" });
  assert.notEqual(await page.locator("#claimManualExecution").getAttribute("data-recommended-action"), "true");
  await assertCreateOrderBlocked();

  cloudState = {
    worker: { connection: "online", last_heartbeat_at: "2026-08-17T09:00:00.000Z" },
    readiness: { status: "busy" },
    worker_state: "busy",
    current_order: { id: selectedOrderId, status: "running" },
    current_attempt: { id: "attempt-v2-production", status: "running", progress_phase: "waiting_provider", heartbeat_at: "2026-08-17T09:00:00.000Z" },
    progress: { phase: "waiting_provider", label: "等待生成", updated_at: "2026-08-17T09:00:00.000Z" },
    execution: { status: "pending" },
    verification: { status: "not_started" },
    work: null,
    delivery: { status: "not_available" },
    failure: null
  };
  await reloadCloudState(cloudState);
  await assertCloudTaskSummary({ status: "正在生成", next: "等待" });
  const technicalDetails = page.locator("#productionTechnicalDetails");
  assert.equal(await technicalDetails.count(), 1);
  assert.equal(await technicalDetails.evaluate((details) => details.tagName === "DETAILS" && !details.open), true);
  const technicalDetailsText = await technicalDetails.textContent();
  assert.match(technicalDetailsText, /attempt-v2-production/);
  assert.match(technicalDetailsText, /heartbeat|心跳/i);

  await reloadCloudState({
    worker: { connection: "online", last_heartbeat_at: "2026-08-17T09:01:00.000Z" },
    readiness: { status: "requires_action" },
    worker_state: "requires_action",
    current_order: { id: selectedOrderId, status: "failed" },
    current_attempt: { id: "attempt-v2-production", status: "failed", progress_phase: "failed", heartbeat_at: "2026-08-17T09:01:00.000Z" },
    progress: { phase: "failed", label: "执行失败", updated_at: "2026-08-17T09:01:00.000Z" },
    execution: { status: "failed" },
    verification: { status: "not_started" },
    work: null,
    delivery: { status: "not_available" },
    failure: { code: "EXECUTION_FAILED", stage: "execution", message: "当前生成失败，整批已停；不会自动重试。", retryable: false }
  });
  const failedSummaryText = await assertCloudTaskSummary({ status: /人工处理.*整批已停|整批已停.*人工处理/, next: "处理当前阻断" });
  assert.match(failedSummaryText, /不会自动重试/);
  await assertCreateOrderBlocked();
  for (const selector of ["#retryPackageButton", "#createOrderButton", "#createOrderEmpty"]) {
    assert.notEqual(await page.locator(selector).getAttribute("data-recommended-action"), "true");
  }

  persistedOrderStatus = "failed";
  persistedExecution = {
    order: { id: selectedOrderId, status: "failed" },
    current_attempt: { id: "attempt-v2-production-persisted-failed", status: "failed" },
    candidates: [],
    reports: [{
      id: "report-v2-production-persisted-failed",
      report_version: 1,
      outcome: "failed",
      submitted_at: "2026-08-18T12:37:29.994Z",
      error_category: "cloud_executor",
      failure_stage: "playwright_execution",
      retryability: "not_retryable"
    }]
  };
  persistedVerification = {
    order: { id: selectedOrderId, status: "failed" },
    job: null,
    work: null,
    works: []
  };
  await reloadCloudState({
    worker: { connection: "offline", last_heartbeat_at: null },
    readiness: { status: "disabled" },
    worker_state: "disabled",
    current_order: null,
    current_attempt: null,
    progress: null,
    execution: { status: "pending" },
    verification: { status: "not_started" },
    work: null,
    delivery: { status: "not_available" },
    failure: null
  });
  const persistedFailedSummary = await assertCloudTaskSummary({
    status: "生产失败，已停止",
    next: "查看失败详情",
    recommended: "productionTaskAction"
  });
  assert.match(persistedFailedSummary, /不会自动重试/);
  assert.doesNotMatch(persistedFailedSummary, /等待生产门禁核对|生产门禁未通过|等待获授权运维核对/);
  assert.equal(await page.locator("#productionTaskAction").getAttribute("href"), "#manualHistorySection");
  assert.equal(await page.locator("#manualHistorySection").isVisible(), true);
  assert.equal(await page.locator("#reenterManualExecution").isHidden(), true);
  await assertCreateOrderBlocked();

  const failedScreenshotRoot = path.join(os.tmpdir(), "hifly-issue202-failed-order-screenshots");
  await mkdir(failedScreenshotRoot, { recursive: true });
  for (const viewport of [
    { width: 1440, height: 1000, name: "failed-order-1440.png" },
    { width: 768, height: 1024, name: "failed-order-768.png" },
    { width: 390, height: 844, name: "failed-order-390.png" }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false,
      `${viewport.width}px failed-order summary must not overflow horizontally`);
    assert.equal(await page.locator('[data-recommended-action="true"]').count(), 1,
      `${viewport.width}px failed-order summary must expose one safe recommendation`);
    await page.screenshot({ path: path.join(failedScreenshotRoot, viewport.name) });
  }

  persistedOrderStatus = null;
  persistedExecution = null;
  persistedVerification = null;

  await reloadCloudState({
    ...cloudState,
    current_order: { id: selectedOrderId, status: "cancel_requested" },
    current_attempt: { id: "attempt-v2-production", status: "cancel_requested", progress_phase: "cancelling" },
    progress: { phase: "cancelling", label: "正在取消", updated_at: "2026-08-17T09:01:30.000Z" },
    execution: { status: "pending" },
    failure: null
  });
  await assertCloudTaskSummary({ status: "正在取消", next: "等待终态" });

  await reloadCloudState({
    ...cloudState,
    current_order: { id: selectedOrderId, status: "cancelled" },
    current_attempt: { id: "attempt-v2-production", status: "cancelled", progress_phase: "cancelled" },
    progress: { phase: "cancelled", label: "已取消", updated_at: "2026-08-17T09:01:40.000Z" },
    execution: { status: "pending" },
    failure: null
  });
  await assertCloudTaskSummary({ status: "已取消", next: /查看结果|重新规划/ });

  await reloadCloudState({
    worker: { connection: "online", last_heartbeat_at: "2026-08-17T09:02:00.000Z" },
    readiness: { status: "available" },
    worker_state: "standby",
    current_order: { id: selectedOrderId, status: "succeeded" },
    current_attempt: { id: "attempt-v2-production", status: "succeeded", progress_phase: "succeeded", heartbeat_at: "2026-08-17T09:02:00.000Z" },
    progress: { phase: "succeeded", label: "生成完成", updated_at: "2026-08-17T09:02:00.000Z" },
    execution: { status: "succeeded" },
    verification: { status: "not_started" },
    work: null,
    delivery: { status: "not_available" },
    failure: null
  });
  const generatedSummaryText = await assertCloudTaskSummary({ status: "生成完成，待文件核验", next: /(开始|等待)文件核验/ });
  assert.doesNotMatch(generatedSummaryText, /本单已完成/);

  await reloadCloudState({
    ...cloudState,
    verification: { status: "pending", job_id: "verification-v2-production" }
  });
  await assertCloudTaskSummary({ status: "正在核验作品文件", next: "等待" });

  await reloadCloudState({
    ...cloudState,
    verification: { status: "requires_action", job_id: "verification-v2-production" },
    failure: { code: "VERIFICATION_REQUIRES_ACTION", stage: "verification", message: "作品文件核验需要人工处理。", retryable: false }
  });
  const verificationBlockedText = await assertCloudTaskSummary({ status: "文件核验需处理", next: "处理核验问题" });
  assert.doesNotMatch(verificationBlockedText, /自动重新生产/);

  await reloadCloudState({
    ...cloudState,
    verification: { status: "passed", job_id: "verification-v2-production" },
    failure: null
  });
  await assertCloudTaskSummary({ status: "正在登记作品", next: "等待" });

  for (const projection of [
    { deliveryStatus: "pending_review", status: "作品待检查", next: "进入作品库检查" },
    { deliveryStatus: "rework_required", status: "作品需要返工", next: "查看返工要求" },
    { deliveryStatus: "deliverable", status: "作品可交付", next: "进入作品库登记交付" },
    { deliveryStatus: "delivered", status: "作品已交付，待真实下载验收", next: "查看交付记录并完成真实下载验收" }
  ]) {
    await reloadCloudState({
      ...cloudState,
      verification: { status: "passed", job_id: "verification-v2-production" },
      work: { id: "work-v2-production", status: "available", delivery_status: projection.deliveryStatus, preview_available: true, download_available: true },
      delivery: { status: projection.deliveryStatus },
      failure: null
    });
    const workSummaryText = await assertCloudTaskSummary({ status: projection.status, next: projection.next,
      recommended: "productionTaskAction" });
    assert.doesNotMatch(workSummaryText, /本单已完成/);
    await assertCreateOrderBlocked();
    assert.notEqual(await page.locator("#createOrderButton").getAttribute("data-recommended-action"), "true");
    assert.notEqual(await page.locator("#createOrderEmpty").getAttribute("data-recommended-action"), "true");
  }

  const persistedCandidate = {
    id: "candidate-v2-production-persisted",
    role: "primary_video",
    status: "pending_verification",
    checksum: "a".repeat(64)
  };
  const persistedReport = {
    id: "report-v2-production-persisted",
    report_version: 1,
    outcome: "completed",
    submitted_at: "2026-08-18T07:00:00.000Z",
    primary_output: { upload_reference: persistedCandidate.id, checksum: persistedCandidate.checksum }
  };
  const persistedJob = {
    id: "verification-v2-production-persisted",
    report_id: persistedReport.id,
    candidate_id: persistedCandidate.id,
    primary_output_checksum: persistedCandidate.checksum,
    status: "succeeded",
    verification_status: "passed"
  };
  persistedOrderStatus = "succeeded";
  persistedExecution = {
    order: { id: selectedOrderId, status: "succeeded" },
    current_attempt: { id: "attempt-v2-production-persisted", status: "succeeded" },
    candidates: [persistedCandidate],
    reports: [persistedReport]
  };
  cloudState = {
    worker: { connection: "offline", last_heartbeat_at: null },
    readiness: { status: "disabled" },
    worker_state: "disabled",
    current_order: null,
    current_attempt: null,
    progress: null,
    execution: { status: "pending" },
    verification: { status: "not_started" },
    work: null,
    delivery: { status: "not_available" },
    failure: null
  };

  async function reloadPersistedTerminal({ verificationStatus, deliveryStatus = null }) {
    const includesWork = Boolean(deliveryStatus);
    const pendingStatus = ["queued", "running"].includes(verificationStatus);
    persistedVerification = {
      order: { id: selectedOrderId, status: "succeeded" },
      job: verificationStatus === "not_started" ? null : {
        ...persistedJob,
        status: pendingStatus ? verificationStatus : "succeeded",
        verification_status: verificationStatus
      },
      work: includesWork ? { id: "work-v2-production-persisted", status: "available" } : null,
      works: includesWork ? [{ id: "work-v2-production-persisted", status: "available" }] : []
    };
    persistedWork = includesWork ? {
      id: "work-v2-production-persisted",
      status: "available",
      delivery_status: deliveryStatus,
      current_inspection: {
        id: "inspection-v2-production-persisted",
        status: deliveryStatus === "rework_required" ? "rework_required" : deliveryStatus === "pending_review" ? "pending" : "passed",
        revision: 1
      },
      deliveries: deliveryStatus === "delivered" ? [{ id: "delivery-v2-production-persisted" }] : []
    } : null;
    await page.reload();
    await page.locator("#productionWorkspace:not([hidden])").waitFor();
    await page.locator("#productionTaskSummary:not([hidden])").waitFor();
  }

  for (const projection of [
    { verificationStatus: "not_started", status: "生成完成，待文件核验", next: "等待文件核验" },
    { verificationStatus: "queued", status: "正在核验作品文件", next: "等待" },
    { verificationStatus: "running", status: "正在核验作品文件", next: "等待" },
    { verificationStatus: "requires_action", status: "文件核验需处理", next: "处理核验问题" },
    { verificationStatus: "failed", status: "文件核验需处理", next: "处理核验问题" },
    { verificationStatus: "passed", status: "正在登记作品", next: "等待" }
  ]) {
    await reloadPersistedTerminal(projection);
    assert.equal((await page.locator("#productionTaskStatus").textContent()).trim(), projection.status);
    assert.equal((await page.locator("#productionTaskNextStep").textContent()).trim(), projection.next);
    assert.equal(await page.locator('[data-recommended-action="true"]').count(), 0);
  }

  for (const projection of [
    { deliveryStatus: "pending_review", status: "作品待检查", next: "进入作品库检查" },
    { deliveryStatus: "rework_required", status: "作品需要返工", next: "查看返工要求" },
    { deliveryStatus: "deliverable", status: "作品可交付", next: "进入作品库登记交付" },
    { deliveryStatus: "delivered", status: "作品已交付，待真实下载验收", next: "查看交付记录并完成真实下载验收" }
  ]) {
    await reloadPersistedTerminal({ verificationStatus: "passed", deliveryStatus: projection.deliveryStatus });
    assert.equal((await page.locator("#productionTaskStatus").textContent()).trim(), projection.status);
    assert.equal((await page.locator("#productionTaskNextStep").textContent()).trim(), projection.next);
    assert.equal(await page.locator("#productionTaskAction").getAttribute("data-recommended-action"), "true");
    assert.equal(await page.locator('[data-recommended-action="true"]').count(), 1);
    await assertCreateOrderBlocked();
  }

  await reloadPersistedTerminal({ verificationStatus: "passed", deliveryStatus: "pending_review" });
  const refreshedWorkspace = page.waitForResponse((response) =>
    response.request().method() === "GET" && new URL(response.url()).pathname === `/api/products/${product.id}/production-workspace`);
  await page.locator("#refreshProduction").click();
  await refreshedWorkspace;
  await page.waitForFunction(() => document.querySelector("#productionTaskStatus")?.textContent.trim() === "作品待检查");
  assert.equal((await page.locator("#productionTaskStatus").textContent()).trim(), "作品待检查");
  assert.equal(await page.locator('[data-recommended-action="true"]').count(), 1);

  packageState = "expired";
  await reloadPersistedTerminal({ verificationStatus: "passed", deliveryStatus: "pending_review" });
  assert.equal((await page.locator("#productionTaskStatus").textContent()).trim(), "作品待检查");
  assert.equal((await page.locator("#productionTaskNextStep").textContent()).trim(), "进入作品库检查");
  assert.equal(await page.locator("#productionTaskAction").getAttribute("data-recommended-action"), "true");
  assert.notEqual(await page.locator("#authorizePackageButton").getAttribute("data-recommended-action"), "true");

  manualHandoffOverride = false;
  await reloadPersistedTerminal({ verificationStatus: "passed", deliveryStatus: "pending_review" });
  assert.equal((await page.locator("#productionTaskStatus").textContent()).trim(), "作品待检查");
  assert.equal(await page.locator("#productionTaskAction").getAttribute("data-recommended-action"), "true");
  manualHandoffOverride = null;

  persistedWorkReadFailures = 1;
  await reloadPersistedTerminal({ verificationStatus: "passed", deliveryStatus: "pending_review" });
  assert.equal((await page.locator("#productionTaskStatus").textContent()).trim(), "作品状态读取失败");
  assert.equal((await page.locator("#productionTaskNextStep").textContent()).trim(), "刷新当前工单");
  assert.equal(await page.locator("#refreshProduction").getAttribute("data-recommended-action"), "true");
  assert.equal(await page.locator('[data-recommended-action="true"]').count(), 1);
  assert.doesNotMatch(await taskSummary.innerText(), /正在登记作品/);
  assert.equal(await page.locator("#worksLibraryLink").isHidden(), true);
  assert.match(await page.locator("#worksLibraryDisabled").textContent(), /刷新当前工单/);
  const recoveredWork = page.waitForResponse((response) =>
    response.request().method() === "GET" && new URL(response.url()).pathname === "/api/works/work-v2-production-persisted");
  await page.locator("#refreshProduction").click();
  await recoveredWork;
  await page.waitForFunction(() => document.querySelector("#productionTaskStatus")?.textContent.trim() === "作品待检查");
  assert.equal(await page.locator("#productionTaskAction").getAttribute("data-recommended-action"), "true");
  assert.equal(await page.locator('[data-recommended-action="true"]').count(), 1);
  assert.equal(await page.locator("#worksLibraryLink").isVisible(), true);

  persistedVerificationReadFailures = 1;
  const failedVerificationRead = page.waitForResponse((response) =>
    response.request().method() === "GET"
      && new URL(response.url()).pathname === `/api/production-orders/${selectedOrderId}/work-verification`
      && response.status() === 503);
  await page.locator("#refreshProduction").click();
  await failedVerificationRead;
  await page.waitForFunction(() => document.querySelector("#productionTaskStatus")?.textContent.trim() === "核验状态读取失败");
  assert.equal((await page.locator("#productionTaskNextStep").textContent()).trim(), "刷新当前工单");
  assert.equal(await page.locator("#refreshProduction").getAttribute("data-recommended-action"), "true");
  assert.equal(await page.locator('[data-recommended-action="true"]').count(), 1);
  assert.doesNotMatch(await taskSummary.innerText(), /作品待检查|生成完成，待文件核验/);
  assert.equal(await page.locator("#worksLibraryLink").isHidden(), true);

  persistedVerificationOrderOverride = "order-from-another-selection";
  await page.locator("#refreshProduction").click();
  await page.waitForFunction(() => document.querySelector("#productionTaskStatus")?.textContent.trim() === "核验状态读取失败");
  assert.equal(await page.locator("#worksLibraryLink").isHidden(), true);
  persistedVerificationOrderOverride = null;

  const recoveredVerificationRead = page.waitForResponse((response) =>
    response.request().method() === "GET"
      && new URL(response.url()).pathname === `/api/production-orders/${selectedOrderId}/work-verification`
      && response.status() === 200);
  await page.locator("#refreshProduction").click();
  await recoveredVerificationRead;
  await page.waitForFunction(() => document.querySelector("#productionTaskStatus")?.textContent.trim() === "作品待检查");
  assert.equal(await page.locator("#productionTaskAction").getAttribute("data-recommended-action"), "true");
  assert.equal(await page.locator("#worksLibraryLink").isVisible(), true);

  const screenshotRoot = path.join(os.tmpdir(), "hifly-v2-b-production-screenshots");
  await mkdir(screenshotRoot, { recursive: true });
  for (const viewport of [
    { width: 1440, height: 1000, name: "production-1440.png" },
    { width: 768, height: 1024, name: "production-768.png" },
    { width: 390, height: 844, name: "production-390.png" }
  ]) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.reload();
    await page.locator("#productionTaskSummary:not([hidden])").waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, `${viewport.width}px must not overflow horizontally`);
    assert.equal(await page.locator('[data-recommended-action="true"]').count() <= 1, true, `${viewport.width}px must expose at most one recommendation`);
    await page.screenshot({ path: path.join(screenshotRoot, viewport.name) });
  }

  await page.emulateMedia({ reducedMotion: "reduce" });
  const reducedTransitionMs = await page.locator("#refreshProduction").evaluate((button) => {
    const value = getComputedStyle(button).transitionDuration.split(",")[0].trim();
    return value.endsWith("ms") ? Number.parseFloat(value) : Number.parseFloat(value) * 1000;
  });
  assert.equal(reducedTransitionMs <= 0.01, true);
  await page.locator("#productionTechnicalDetails summary").focus();
  assert.notEqual(await page.locator("#productionTechnicalDetails summary").evaluate((summary) => getComputedStyle(summary).outlineStyle), "none");
});
