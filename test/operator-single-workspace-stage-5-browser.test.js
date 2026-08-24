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
import { buildApp } from "../src/server/app.js";
import { findAvailablePort } from "../src/server/start.js";
import { ADMIN_EMAIL, ADMIN_TEMP_PASSWORD } from "./helpers/identity-world.js";

const assetReferencePort = {
  async bindAvailableVersion(input) {
    return { reference: { asset_version_id: input.assetVersionId },
      asset_version: { id: input.assetVersionId, status: "available" } };
  }
};

async function readyProduct(service, actor, projectId, key, name) {
  const created = await service.createProduct({ ...actor, projectId, idempotencyKey: key, productName: name });
  let revision = await service.saveRevision({ ...actor, productRevisionId: created.revision.id,
    expectedRevision: created.revision.revision_number, productName: name,
    sellingPoints: [{ text: `${name}核心卖点` }], assetVersionIds: [`${key}-image`] });
  revision = await service.confirmSellingPoint({ ...actor, productRevisionId: revision.id,
    pointId: revision.selling_points[0].id, expectedRevision: revision.revision_number });
  revision = await service.readyRevision({ ...actor, productRevisionId: revision.id,
    expectedRevision: revision.revision_number, idempotencyKey: `${key}-ready` });
  return { product: created.product, revision };
}

function fixture(productId, state = {}) {
  const order = {
    id: state.orderId || "order-stage-5", organization_id: "org_stage_5", product_id: productId,
    video_plan_version_id: "plan-stage-5", execution_purpose: "first_production",
    status: state.orderStatus || "waiting_for_executor", row_version: 1,
    created_at: "2026-08-24T01:00:00.000Z"
  };
  const attemptStatus = state.attemptStatus || (state.verificationStatus || state.workStatus ? "succeeded" : null);
  const attempt = attemptStatus ? {
    id: "attempt-stage-5", production_order_id: order.id, status: attemptStatus
  } : null;
  const report = attempt && (state.reportOutcome || state.verificationStatus || state.workStatus) ? {
    id: "report-stage-5", execution_attempt_id: attempt.id, production_order_id: order.id,
    report_version: 1,
    outcome: state.reportOutcome || "completed", failure_stage: "playwright_execution", retryability: "not_retryable"
  } : null;
  const job = state.verificationStatus ? {
    id: "verification-stage-5", production_order_id: order.id, execution_attempt_id: attempt.id,
    report_id: report.id, status: state.verificationJobStatus || "succeeded",
    verification_status: state.verificationStatus
  } : null;
  const work = state.workStatus ? {
    id: "work-stage-5", production_order_id: order.id, execution_attempt_id: attempt.id,
    manual_execution_report_id: report.id
  } : null;
  return {
    workspace: {
      current_plan: { id: "plan-stage-5", organization_id: "org_stage_5", product_id: productId,
        status: "frozen", version_number: 2 },
      gate: { can_create: state.canCreate === true, reasons: state.gateReasons || [] },
      orders: state.noOrder ? [] : [order],
      selected_order: state.noOrder ? null : order
    },
    packages: state.packageStatus ? [{
      id: "package-stage-5", production_order_id: order.id, status: state.packageStatus,
      package_version: 1
    }] : [],
    execution: state.noOrder ? null : {
      order,
      current_attempt: attempt, attempts: attempt ? [attempt] : [], candidates: [], reports: report ? [report] : []
    },
    verification: state.noOrder ? null : {
      order, job, work, works: work ? [work] : []
    },
    work: state.workStatus ? {
      ...work, project_id: state.projectId || null, product_id: productId, status: "available",
      delivery_status: state.workStatus
    } : null,
    read_errors: state.readErrors || []
  };
}

async function world(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-stage-5-browser-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(59800);
  const origin = `http://127.0.0.1:${port}`;
  const host = `127.0.0.1:${port}`;
  const identityRepository = createMemoryIdentityRepository();
  const seeded = await seedInitialAdmin(identityRepository, {
    organizationId: "org_stage_5", organizationName: "生产团队", adminEmail: ADMIN_EMAIL,
    adminDisplayName: "生产管理员", adminTempPassword: ADMIN_TEMP_PASSWORD
  });
  const actor = { organizationId: "org_stage_5", actorMemberId: seeded.member.id, actorRole: "admin" };
  const state = { current: null };
  const createdOrders = [];
  const generatedPackages = [];
  const createReceipts = new Map();
  const packageReceipts = new Map();
  const app = await buildApp({
    root, executor: createFakeExecutor(),
    identity: { enabled: true, repository: identityRepository, trustedHosts: [host],
      trustedOrigins: [origin], cookieSecure: false, seed: { enabled: false } },
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort },
    operatorWorkspace: { enabled: true, productionService: {
      async getOperatorWorkspace(input) {
        const value = structuredClone(state.current || fixture(input.productId));
        if (value.work) value.work.project_id = state.projectId;
        return value;
      }
    } }
  });
  const project = await app.projectContent.service.createProject({ ...actor, idempotencyKey: "stage-5-project",
    name: "夏日防晒推广" });
  const first = await readyProduct(app.projectContent.service, actor, project.id, "stage-5-first", "清透防晒乳");
  const second = await readyProduct(app.projectContent.service, actor, project.id, "stage-5-second", "云感保湿乳");
  state.projectId = project.id;
  state.current = fixture(first.product.id);
  app.post("/api/products/:productId/production-orders", async (request, reply) => {
    const key = request.headers["idempotency-key"];
    if (createReceipts.has(key)) return reply.code(200).send({ order: createReceipts.get(key), replayed: true });
    const next = fixture(request.params.productId, { projectId: state.projectId });
    state.current = next;
    const order = structuredClone(next.workspace.selected_order);
    createReceipts.set(key, order);
    createdOrders.push(order);
    return reply.code(201).send({ order, replayed: false });
  });
  app.post("/api/production-orders/:orderId/manual-handoff-packages", async (request, reply) => {
    const key = request.headers["idempotency-key"];
    if (packageReceipts.has(key)) return reply.code(200).send({ package: packageReceipts.get(key), replayed: true });
    const packageValue = { id: `package-stage-5-${generatedPackages.length + 1}`,
      production_order_id: request.params.orderId, status: "ready", package_version: generatedPackages.length + 1 };
    state.current.packages = [packageValue];
    packageReceipts.set(key, packageValue);
    generatedPackages.push(packageValue);
    return reply.code(201).send({ package: packageValue, replayed: false });
  });
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
  return { app, browser, origin, project, first, second, state, createdOrders, generatedPackages };
}

async function login(page, origin) {
  await page.goto(`${origin}/login.html`);
  await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("heading", { name: "设置新密码" }).waitFor();
  await page.locator("#newPassword").fill("Single-Workspace-Stage-5-Password-9!");
  await page.getByRole("button", { name: "保存并进入工作台" }).click();
  await page.waitForURL(`${origin}/projects.html`);
}

function workspaceUrl(origin, projectId, productId, orderId = "order-stage-5") {
  const url = new URL("/workspace.html", origin);
  url.searchParams.set("project", projectId);
  url.searchParams.set("product", productId);
  url.searchParams.set("stage", "production");
  if (orderId) url.searchParams.set("orderId", orderId);
  return url.href;
}

test("Stage 5 renders authoritative terminal truth and one safe action at every accepted viewport", async (t) => {
  const setup = await world(t);
  if (!setup) return t.skip("real Chrome unavailable in this environment");
  const { browser, origin, project, first, state } = setup;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let cloudStatusReads = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/cloud-executor/status") cloudStatusReads += 1;
  });
  await login(page, origin);
  await page.goto(workspaceUrl(origin, project.id, first.product.id));
  await page.locator("#productionWorkspacePanel").waitFor();
  await page.locator("#productionWorkspaceBody").waitFor();

  const matrix = [
    [{ packageStatus: "ready" }, "等待生产门禁核对", null, "当前无需操作"],
    [{ orderStatus: "running", attemptStatus: "running" }, "正在生成作品", null, "当前无需操作"],
    [{ orderStatus: "running", attemptStatus: "succeeded", reportOutcome: "completed" },
      "生成完成，待文件核验", null, "当前无需操作"],
    [{ orderStatus: "running", attemptStatus: "succeeded", verificationStatus: "pending",
      verificationJobStatus: "queued" }, "正在核验作品文件", null, "当前无需操作"],
    [{ orderStatus: "running", attemptStatus: "succeeded", verificationStatus: "requires_action" },
      "作品文件核验需要处理", "view_verification_details", "查看核验详情"],
    [{ orderStatus: "running", attemptStatus: "succeeded", verificationStatus: "failed" },
      "作品文件核验需要处理", "view_verification_details", "查看核验详情"],
    [{ orderStatus: "failed", attemptStatus: "failed", reportOutcome: "failed" },
      "生产失败，已停止", "view_production_failure_details", "查看失败详情"],
    [{ orderStatus: "succeeded", attemptStatus: "succeeded", verificationStatus: "passed",
      workStatus: "pending_review" }, "作品待检查", "review_production_work", "进入作品库检查"],
    [{ orderStatus: "succeeded", attemptStatus: "succeeded", verificationStatus: "passed",
      workStatus: "rework_required" }, "作品需要返工", "view_production_rework", "查看返工要求"],
    [{ orderStatus: "succeeded", attemptStatus: "succeeded", verificationStatus: "passed",
      workStatus: "deliverable" }, "作品可交付", "deliver_production_work", "进入作品库登记交付"],
    [{ orderStatus: "succeeded", attemptStatus: "succeeded", verificationStatus: "passed",
      workStatus: "delivered" }, "作品已交付，待真实下载验收", "view_production_delivery",
      "查看交付记录并完成真实下载验收"],
    [{ orderStatus: "succeeded", readErrors: ["execution"] },
      "生产执行状态读取失败", "retry_production_read", "刷新当前工单"],
    [{ orderStatus: "succeeded", readErrors: ["work"], verificationStatus: "passed" },
      "作品状态读取失败", "retry_production_read", "刷新当前工单"]
  ];
  for (const [next, status, action, actionLabel] of matrix) {
    state.current = fixture(first.product.id, next);
    const refreshed = page.waitForResponse((response) =>
      response.url().includes("/operator-workspace?") && response.request().method() === "GET");
    await page.locator("#refreshProductionWorkspace").click();
    const response = await refreshed;
    assert.equal(response.status(), 200);
    assert.equal((await response.json()).workspace.stages[4].business_status, status);
    await page.waitForTimeout(100);
    assert.equal(await page.locator("#productionTaskTitle").textContent(), status);
    const primary = page.locator("#workspacePrimaryAction");
    assert.equal(await primary.getAttribute("data-action-code"), action);
    assert.equal(await primary.textContent(), actionLabel);
    assert.ok((await page.locator('[data-recommended-action="true"]').count()) <= 1);
  }

  state.current = fixture(first.product.id, { orderStatus: "succeeded", attemptStatus: "succeeded",
    verificationStatus: "passed", workStatus: "pending_review", readErrors: ["handoff"] });
  await page.locator("#refreshProductionWorkspace").click();
  await page.getByText("作品待检查", { exact: true }).first().waitFor();
  assert.equal(await page.locator("#productionPackageSummary").textContent(), "读取失败");

  state.current = fixture(first.product.id, { orderStatus: "succeeded", attemptStatus: "succeeded",
    verificationStatus: "passed", workStatus: "pending_review", readErrors: ["verification"] });
  await page.locator("#refreshProductionWorkspace").click();
  await page.getByText("核验状态读取失败", { exact: true }).first().waitFor();
  assert.equal(await page.locator("#productionVerificationSummary").textContent(), "读取失败");
  assert.equal(await page.locator("#productionVerificationSummary").getByText("已通过", { exact: true }).count(), 0);
  state.current = fixture(first.product.id, { orderStatus: "succeeded", attemptStatus: "succeeded",
    verificationStatus: "passed", workStatus: "pending_review" });
  await page.locator("#refreshProductionWorkspace").click();
  await page.getByText("作品待检查", { exact: true }).first().waitFor();

  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.locator("#refreshProductionWorkspace").focus();
    assert.equal(await page.evaluate(() => document.activeElement?.id), "refreshProductionWorkspace");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    assert.equal(await page.locator("#taskSummaryTitle").textContent(), "当前生产任务");
    assert.equal(await page.locator("#taskStatus").textContent(), "作品待检查");
    assert.equal(await page.locator("#taskNext").textContent(), "进入作品库检查");
    assert.equal(await page.locator("#workspaceTechnicalStage").textContent(), "生产");
    assert.match(await page.locator("#workspaceTechnicalObject").textContent(), /order-stage-5/);
    assert.equal(await page.emulateMedia({ reducedMotion: "reduce" }).then(() =>
      page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)), true);
    if (process.env.STAGE5_SCREENSHOT_DIR) {
      await mkdir(process.env.STAGE5_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({ path: path.join(process.env.STAGE5_SCREENSHOT_DIR,
        `stage-5-production-${viewport.width}x${viewport.height}.png`), fullPage: true });
    }
  }
  assert.equal(cloudStatusReads, 0);
});

test("Stage 5 mobile order list-detail-return and scoped read recovery keep exact order authority", async (t) => {
  const setup = await world(t);
  if (!setup) return t.skip("real Chrome unavailable in this environment");
  const { browser, origin, project, first, state } = setup;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await login(page, origin);
  let initialFailOnce = true;
  const initialFailure = async (route) => {
    if (initialFailOnce) {
      initialFailOnce = false;
      await route.fulfill({ status: 503, contentType: "application/json",
        body: JSON.stringify({ error: "OPERATOR_WORKSPACE_UNAVAILABLE" }) });
    } else await route.continue();
  };
  await page.route("**/operator-workspace?*", initialFailure);
  await page.goto(workspaceUrl(origin, project.id, first.product.id));
  await page.getByText("生产状态暂时无法读取").waitFor();
  assert.equal(await page.locator('[data-stage-code][href]').count(), 0);
  await page.locator("#workspacePrimaryAction").click();
  await page.locator("#productionWorkspacePanel").waitFor();
  await page.getByText("生产交接资料待生成", { exact: true }).first().waitFor();
  await page.unroute("**/operator-workspace?*", initialFailure);
  await page.locator("#mobileProductionDetailBack").click();
  await page.locator('[data-production-mobile-layer="list"]').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.orderId), "order-stage-5");
  await page.locator("#mobileProductionProductBack").click();
  assert.equal(await page.locator("#productList").isVisible(), true);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-current")), "true");
  await page.getByRole("button", { name: "清透防晒乳" }).click();
  await page.locator("#productionTaskTitle").waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "productionTaskTitle");
  await page.locator("#mobileProductionDetailBack").click();
  await page.locator('[data-production-mobile-layer="list"]').waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.dataset?.orderId), "order-stage-5");
  await page.getByRole("button", { name: /生产工单/ }).click();
  await page.locator("#productionTaskTitle").waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.id), "productionTaskTitle");

  state.current = fixture(first.product.id, { projectId: project.id, orderStatus: "succeeded",
    attemptStatus: "succeeded", verificationStatus: "passed", workStatus: "rework_required" });
  await page.locator("#refreshProductionWorkspace").click();
  await page.getByText("作品需要返工", { exact: true }).first().waitFor();
  await page.locator("#productionTechnicalDetails").evaluate((element) => { element.open = true; });
  let failOnce = true;
  await page.route("**/operator-workspace?*", async (route) => {
    if (failOnce) {
      failOnce = false;
      await route.fulfill({ status: 503, contentType: "application/json",
        body: JSON.stringify({ error: "OPERATOR_WORKSPACE_UNAVAILABLE" }) });
    } else await route.continue();
  });
  await page.locator("#refreshProductionWorkspace").click();
  await page.getByText("生产状态暂时无法读取").waitFor();
  assert.equal(await page.locator('[data-stage-code][href]').count(), 0);
  for (const id of ["productionOrderSummary", "productionPackageSummary", "productionExecutionSummary",
    "productionVerificationSummary", "productionWorkSummary"]) {
    assert.equal(await page.locator(`#${id}`).textContent(), "未读取", id);
  }
  for (const id of ["productionTechnicalOrder", "productionTechnicalAttempt",
    "productionTechnicalVerification", "productionTechnicalWork"]) {
    assert.equal(await page.locator(`#${id}`).textContent(), "无", id);
  }
  assert.equal(await page.locator("#productionTechnicalDetails").evaluate((element) => element.open), false);
  assert.equal(await page.locator("#productionWorkspaceNotice").textContent(), "");
  assert.equal(await page.locator("#taskStatus").textContent(), "读取失败");
  assert.equal(await page.locator("#workspaceTechnicalObjectRow").isHidden(), true);
  state.current = fixture(first.product.id, { orderStatus: "succeeded", attemptStatus: "succeeded",
    verificationStatus: "passed", workStatus: "rework_required" });
  await page.locator("#workspacePrimaryAction").click();
  await page.getByText("作品需要返工", { exact: true }).first().waitFor();
  assert.match(page.url(), /orderId=order-stage-5/);

  state.current = fixture(first.product.id, { projectId: project.id, orderStatus: "succeeded",
    attemptStatus: "succeeded", verificationStatus: "passed", workStatus: "pending_review" });
  state.current.execution.reports[0].execution_attempt_id = "attempt-other";
  state.current.execution.reports[0].failure_reason = "FOREIGN_BROWSER_MARKER";
  await page.locator("#refreshProductionWorkspace").click();
  await page.getByText("生产状态暂时无法读取").waitFor();
  assert.equal((await page.locator("body").textContent()).includes("FOREIGN_BROWSER_MARKER"), false);
  assert.equal(await page.locator('[data-recommended-action="true"]').count(), 1);
  state.current = fixture(first.product.id, { projectId: project.id, orderStatus: "succeeded",
    attemptStatus: "succeeded", verificationStatus: "passed", workStatus: "pending_review" });
  await page.locator("#workspacePrimaryAction").click();
  await page.getByText("作品待检查", { exact: true }).first().waitFor();
});

test("Stage 5 reconciles a committed create with a lost response and keeps untrusted action codes inert", async (t) => {
  const setup = await world(t);
  if (!setup) return t.skip("real Chrome unavailable in this environment");
  const { browser, origin, project, first, state, createdOrders } = setup;
  state.current = fixture(first.product.id, { noOrder: true, canCreate: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await login(page, origin);
  await page.goto(workspaceUrl(origin, project.id, first.product.id, null));
  const primary = page.locator("#workspacePrimaryAction");
  await page.getByText("生产待创建", { exact: true }).first().waitFor();
  assert.equal(await primary.getAttribute("data-action-code"), "create_production_order");

  let createCalls = 0;
  await page.route("**/api/products/*/production-orders", async (route) => {
    createCalls += 1;
    if (createCalls === 1) {
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      await route.abort("failed");
      return;
    }
    await route.continue();
  });
  await primary.click();
  const dialog = page.getByRole("dialog", { name: "确认创建当前商品的生产工单" });
  await dialog.getByRole("button", { name: "确认创建" }).click();
  await page.getByText("生产交接资料待生成", { exact: true }).first().waitFor();
  assert.equal(await page.locator("#productionCreateDialog").evaluate((element) => element.open), false);
  assert.equal(await page.evaluate(() => document.activeElement?.id), "productionTaskTitle");
  assert.equal(createCalls, 1);
  assert.equal(createdOrders.length, 1);

  for (const action of [
    { code: "toString", stage: "production", kind: "command" },
    { code: "generate_handoff_package", stage: "video_plan", kind: "command" },
    { code: "generate_handoff_package", stage: "production", kind: "navigate" }
  ]) {
    await page.route("**/operator-workspace?*", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.workspace.recommended_action = action;
      await route.fulfill({ response, json: body });
    }, { times: 1 });
    await page.locator("#refreshProductionWorkspace").click();
    await page.getByText("生产交接资料待生成", { exact: true }).first().waitFor();
    assert.equal(await primary.getAttribute("data-action-code"), null);
    assert.equal(await primary.isDisabled(), true);
  }
});

test("Stage 5 reconciles committed create and handoff writes hidden by an HTTP 503", async (t) => {
  const setup = await world(t);
  if (!setup) return t.skip("real Chrome unavailable in this environment");
  const { browser, origin, project, first, state, createdOrders, generatedPackages } = setup;
  state.current = fixture(first.product.id, { noOrder: true, canCreate: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await login(page, origin);
  await page.goto(workspaceUrl(origin, project.id, first.product.id, null));

  let createCalls = 0;
  await page.route("**/api/products/*/production-orders", async (route) => {
    createCalls += 1;
    const response = await route.fetch();
    assert.equal(response.status(), 201);
    await route.fulfill({ status: 503, contentType: "application/json",
      body: JSON.stringify({ error: "UPSTREAM_RESPONSE_UNKNOWN" }) });
  }, { times: 1 });
  await page.locator("#workspacePrimaryAction").click();
  await page.locator("#productionCreateDialog").getByRole("button", { name: "确认创建" }).click();
  await page.getByText("生产交接资料待生成", { exact: true }).first().waitFor();
  assert.equal(await page.locator("#productionCreateDialog").evaluate((element) => element.open), false);
  assert.equal(createCalls, 1);
  assert.equal(createdOrders.length, 1);

  let handoffCalls = 0;
  await page.route("**/api/production-orders/*/manual-handoff-packages", async (route) => {
    handoffCalls += 1;
    const response = await route.fetch();
    assert.equal(response.status(), 201);
    await route.fulfill({ status: 503, contentType: "application/json",
      body: JSON.stringify({ error: "UPSTREAM_RESPONSE_UNKNOWN" }) });
  }, { times: 1 });
  assert.equal(await page.locator("#workspacePrimaryAction").getAttribute("data-action-code"), "generate_handoff_package");
  await page.locator("#workspacePrimaryAction").click();
  await page.getByText("已就绪", { exact: true }).first().waitFor();
  assert.equal(handoffCalls, 1);
  assert.equal(generatedPackages.length, 1);
  assert.equal(await page.locator("#workspacePrimaryAction").getAttribute("data-action-code"), null);
  await page.locator("#workspacePrimaryAction").click({ force: true });
  await page.waitForTimeout(100);
  assert.equal(handoffCalls, 1);
  assert.equal(generatedPackages.length, 1);
});

test("Stage 5 ignores stale same-runtime responses and Back Forward reload exact product authority", async (t) => {
  const setup = await world(t);
  if (!setup) return t.skip("real Chrome unavailable in this environment");
  const { browser, origin, project, first, second, state, createdOrders } = setup;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await login(page, origin);
  await page.goto(workspaceUrl(origin, project.id, first.product.id));
  await page.getByText("生产交接资料待生成", { exact: true }).first().waitFor();

  let delayFirst = false;
  let releaseFirst;
  const firstReleased = new Promise((resolve) => { releaseFirst = resolve; });
  let delayedRequestSeen;
  const delayedRequest = new Promise((resolve) => { delayedRequestSeen = resolve; });
  await page.route("**/operator-workspace?*", async (route) => {
    if (delayFirst && route.request().url().includes(`/products/${first.product.id}/`)) {
      delayFirst = false;
      const response = await route.fetch();
      delayedRequestSeen();
      await firstReleased;
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });
  delayFirst = true;
  await page.locator("#refreshProductionWorkspace").click();
  await delayedRequest;
  state.current = null;
  await page.getByRole("button", { name: "云感保湿乳" }).click();
  await page.waitForURL((url) => url.searchParams.get("product") === second.product.id);
  await page.getByText("云感保湿乳", { exact: true }).first().waitFor();
  releaseFirst();
  await page.waitForTimeout(100);
  assert.equal(new URL(page.url()).searchParams.get("product"), second.product.id);
  assert.equal(await page.locator('#productList button[aria-current="true"]').textContent(), "云感保湿乳");
  assert.equal(await page.locator("#productionTaskTitle").textContent(), "生产交接资料待生成");

  await page.goBack();
  await page.waitForURL((url) => url.searchParams.get("product") === first.product.id);
  await page.getByText("清透防晒乳", { exact: true }).first().waitFor();
  assert.equal(await page.locator('#productList button[aria-current="true"]').textContent(), "清透防晒乳");
  await page.goForward();
  await page.waitForURL((url) => url.searchParams.get("product") === second.product.id);
  await page.getByText("云感保湿乳", { exact: true }).first().waitFor();
  assert.equal(await page.locator('#productList button[aria-current="true"]').textContent(), "云感保湿乳");

  state.current = fixture(second.product.id, { noOrder: true, canCreate: true });
  await page.evaluate(() => {
    const url = new URL(location.href);
    url.searchParams.delete("orderId");
    history.replaceState({ productId: url.searchParams.get("product"), orderId: null }, "", url);
    dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  });
  await page.getByText("生产待创建", { exact: true }).first().waitFor();
  await page.locator("#workspacePrimaryAction").click();
  const createDialog = page.locator("#productionCreateDialog");
  assert.equal(await createDialog.evaluate((element) => element.open), true);

  let createCalls = 0;
  await page.route("**/api/products/*/production-orders", async (route) => {
    createCalls += 1;
    await route.continue();
  });
  state.current = null;
  await page.goBack();
  await page.waitForURL((url) => url.searchParams.get("product") === first.product.id);
  await page.getByText("清透防晒乳", { exact: true }).first().waitFor();
  assert.equal(await createDialog.evaluate((element) => element.open), false);
  assert.equal(await page.locator('#productList button[aria-current="true"]').textContent(), "清透防晒乳");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "productionTaskTitle");
  await page.locator("#productionCreateForm").evaluate((form) => form.requestSubmit());
  await page.waitForTimeout(100);
  assert.equal(createCalls, 0);
  assert.equal(createdOrders.length, 0);
});

test("Stage 5 selects the accepted product and clears prior authority while its read is pending or fails", async (t) => {
  const setup = await world(t);
  if (!setup) return t.skip("real Chrome unavailable in this environment");
  const { browser, origin, project, first, second, state } = setup;
  state.current = fixture(first.product.id, { projectId: project.id, orderStatus: "succeeded",
    attemptStatus: "succeeded", verificationStatus: "passed", workStatus: "pending_review" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await login(page, origin);
  await page.goto(workspaceUrl(origin, project.id, first.product.id));
  await page.getByText("作品待检查", { exact: true }).first().waitFor();

  let releaseSecond;
  const secondReleased = new Promise((resolve) => { releaseSecond = resolve; });
  let sawSecond;
  const secondSeen = new Promise((resolve) => { sawSecond = resolve; });
  await page.route("**/operator-workspace?*", async (route) => {
    if (route.request().url().includes(`/products/${second.product.id}/`)) {
      sawSecond();
      await secondReleased;
      await route.fulfill({ status: 503, contentType: "application/json",
        body: JSON.stringify({ error: "OPERATOR_WORKSPACE_UNAVAILABLE" }) });
      return;
    }
    await route.continue();
  });

  await page.getByRole("button", { name: "云感保湿乳" }).click();
  await secondSeen;
  await page.waitForURL((url) => url.searchParams.get("product") === second.product.id);
  assert.equal(await page.locator('#productList button[aria-current="true"]').textContent(), "云感保湿乳");
  assert.equal(await page.locator("#taskContext").textContent(), "正在读取 云感保湿乳 的生产状态");
  assert.equal(await page.locator("#saveStatus").textContent(), "等待服务端状态");
  assert.equal(await page.locator("#workspaceTechnicalObjectRow").isHidden(), true);
  for (const stale of ["作品待检查", "已生成", "服务端状态已同步", "order-stage-5", "work-stage-5"]) {
    assert.equal((await page.locator("body").innerText()).includes(stale), false, stale);
  }

  releaseSecond();
  await page.getByText("生产状态暂时无法读取", { exact: true }).waitFor();
  assert.equal(await page.locator('#productList button[aria-current="true"]').textContent(), "云感保湿乳");
  assert.equal(await page.locator("#taskContext").textContent(), "当前商品生产真值暂时无法读取");
  assert.equal(await page.locator("#workspacePrimaryAction").getAttribute("data-action-code"), "retry_production_read");
  assert.equal((await page.locator("body").innerText()).includes("order-stage-5"), false);
});
