import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";

import { createMemoryIdentityRepository } from "../src/identity/memory-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
import { createMemoryVideoPlanningRepository } from "../src/video-planning/memory-video-planning-repository.js";
import { createMemoryProductionOrderRepository } from "../src/production-orders/memory-production-order-repository.js";
import { createMemoryManualHandoffRepository } from "../src/manual-handoff/memory-manual-handoff-repository.js";
import { createMemoryManualHandoffPackageStore } from "../src/manual-handoff/manual-handoff-package-store.js";
import { createMemoryManualExecutionRepository } from "../src/manual-execution/memory-manual-execution-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { buildApp } from "../src/server/app.js";
import { findAvailablePort } from "../src/server/start.js";

const email = "a11-browser@example.test";
const temporaryPassword = "Temporary-A11-Browser-9!";

test("A11 browser flow claims, confirms, uploads, reports, refreshes, and stays usable at 390px", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-a11-browser-"));
  const port = await findAvailablePort(58140), host = `127.0.0.1:${port}`, origin = `http://${host}`;
  const identityRepository = createMemoryIdentityRepository();
  const seeded = await seedInitialAdmin(identityRepository, { organizationId: "org-a11-browser", organizationName: "A11 浏览器", adminEmail: email, adminDisplayName: "人工执行者", adminTempPassword: temporaryPassword });
  const projectContentRepository = createMemoryProjectContentRepository();
  const productionRepository = createMemoryProductionOrderRepository();
  const packageRecord = { id: "package-browser-a11", organization_id: "org-a11-browser", production_order_id: null, package_version: 1, status: "ready",
    manifest_hash: "manifest-browser", package_hash: "package-browser", manifest: { accepted_media_types: ["video/mp4"] }, integrity_summary: "MANIFEST-PACKAGE",
    content_summary: { execution_steps: ["按交接包说明完成人工制作"], business_constraints: [], expected_behavior: ["提交主要视频"], output_requirements: { expected_quantity: 1, file_naming_rule: "{product}-primary.mp4", accepted_media_types: ["video/mp4"], minimum_validation_requirements: ["文件可读取"] }, assets: [] } };
  const app = await buildApp({ root, executor: null,
    identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin], cookieSecure: false, seed: { enabled: false } },
    projectContent: { enabled: true, repository: projectContentRepository, assetReferencePort: { async bindAvailableVersion(input) { return { reference: input }; } } },
    videoPlanning: { enabled: true, repository: createMemoryVideoPlanningRepository(), worker: { autoStart: false }, upstreamPort: { async resolveCurrent() { return null; } }, capabilitySnapshotPort: { async resolve() { return null; } }, agentReadinessPort: { async isOnline() { return false; } } },
    productionOrders: { enabled: true, repository: productionRepository, planPort: { async resolveCurrentApprovedPlan({ organizationId, productId }) { return { current_valid: true, plan: { id: "plan-browser-a11", organization_id: organizationId, product_id: productId, version_number: 1, status: "frozen", upstream_snapshot: {}, capability_config_snapshot: {}, output_instructions: "视频" }, plan_review: { status: "approved" }, preflight_result: { status: "warning" } }; } }, inputSnapshotPort: { async freezeForOrder() { return { approved_copy_snapshot: {}, product_revision_snapshot: {}, asset_references: [], avatar_selection_snapshot: {} }; } }, agentReadinessPort: { async isOnline() { return false; } } },
    manualHandoff: { enabled: true, repository: createMemoryManualHandoffRepository(), packageStore: createMemoryManualHandoffPackageStore(), worker: { autoStart: false } },
    manualExecution: { enabled: true, repository: createMemoryManualExecutionRepository(), candidateStore: createMemoryObjectStore(), packagePort: { async getPackage() { return structuredClone(packageRecord); }, async listPackages() { return [structuredClone(packageRecord)]; } } }
  });
  t.after(async () => { await app.close(); });
  const organizationId = "org-a11-browser";
  const project = await app.projectContent.service.createProject({ organizationId, actorMemberId: seeded.member.id, idempotencyKey: "a11-browser-project", name: "A11 浏览器项目" });
  const createdProduct = await app.projectContent.service.createProduct({ organizationId, actorMemberId: seeded.member.id, projectId: project.id, idempotencyKey: "a11-browser-product", productName: "浏览器商品" });
  const product = createdProduct.product;
  const order = await app.productionOrders.service.createProductionOrder({ organizationId, actorMemberId: seeded.member.id, actorRole: "admin", productId: product.id, executionPurpose: "first_production", videoPlanVersionId: "plan-browser-a11", idempotencyKey: "a11-browser-order" });
  packageRecord.production_order_id = order.order.id;
  try { await app.listen({ host: "127.0.0.1", port }); } catch (error) { if (error.code === "EPERM") return t.skip("sandbox disallows local TCP listening"); throw error; }
  let browser;
  try { browser = await chromium.launch({ headless: true, executablePath: process.env.IDENTITY_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }); }
  catch (_error) { try { browser = await chromium.launch({ headless: true }); } catch (error) { return t.skip(`Chrome/Chromium unavailable: ${error.message}`); } }
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const packageProjection = { ...packageRecord, package_id: packageRecord.id };
  delete packageProjection.id;
  await page.route(`**/api/production-orders/${order.order.id}/manual-handoff-packages`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ packages: [packageProjection] }) }));
  await page.goto(`${origin}/login.html`); await page.getByLabel("工作邮箱").fill(email); await page.getByLabel("密码", { exact: true }).fill(temporaryPassword); await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("A11-Browser-Password-9!"); await page.getByRole("button", { name: "保存并进入工作台" }).click(); await page.waitForURL(`${origin}/`);
  await page.goto(`${origin}/production.html?project=${project.id}&product=${product.id}&orderId=${order.order.id}`);
  await page.getByRole("button", { name: "领取人工任务", exact: true }).waitFor();
  await page.getByRole("button", { name: "领取人工任务", exact: true }).click(); await page.getByText("任务已领取，请确认开始。", { exact: true }).waitFor();
  await page.locator("#confirmManualStart").click(); await page.getByText("交接包版本", { exact: true }).waitFor(); await page.getByText("v1", { exact: true }).waitFor(); await page.getByText("MANIFEST-PACKAGE", { exact: true }).waitFor();
  await page.locator("#confirmStartManualButton").click(); await page.locator("#confirmManualStart").waitFor({ state: "hidden" });
  await page.locator("#manualCandidateFile").setInputFiles({ name: "browser-clip.mp4", mimeType: "video/mp4", buffer: Buffer.from("browser-candidate") });
  await page.getByRole("button", { name: "上传候选作品", exact: true }).click(); await page.getByText("候选作品已上传，等待提交结果。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "提交执行结果", exact: true }).click(); await page.locator("#manualReportOutcome").waitFor(); assert.equal(await page.locator("#manualReportOutcome").inputValue(), "");
  await page.locator("#manualReportOutcome").selectOption("completed"); await page.getByRole("button", { name: "提交结果", exact: true }).click(); await page.getByText("执行结果已提交，候选作品等待后续核验。", { exact: true }).waitFor();
  assert.match(await page.locator("#manualExecutionMeta").textContent(), /后续核验|后续阶段开放/);
  await page.reload(); await page.getByText("执行结果已提交，候选作品等待后续核验。", { exact: false }).waitFor().catch(() => undefined); assert.match(await page.locator("#manualExecutionMeta").textContent(), /后续核验|后续阶段开放/);
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await page.getByText("人工执行", { exact: true }).last().waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  assert.equal(await page.locator("#manualExecutionPanel").isVisible(), true);
  assert.match(await page.locator("#manualCandidateLimit").textContent(), /256 MB/);

  const executionUrl = `/api/production-orders/${order.order.id}/manual-execution`;
  let mockedExecution = await page.evaluate((url) => fetch(url).then((response) => response.json()), executionUrl);
  const actionProjection = structuredClone(mockedExecution);
  actionProjection.order.status = "requires_action";
  actionProjection.current_attempt.status = "requires_action";
  actionProjection.reports = [{ ...actionProjection.reports.at(-1), outcome: "requires_action", requires_action_reason: "需要确认实际输出与交接包要求" }];
  let mockMode = "requires_action";
  await page.route(new RegExp(`/api/manual-execution-attempts/${actionProjection.current_attempt.id}/recheck$`), async (route) => {
    mockMode = "running";
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ attempt: { ...actionProjection.current_attempt, status: "running" }, replayed: false }) });
  });
  await page.route(new RegExp(`/api/production-orders/${order.order.id}/manual-execution(?:/.*)?$`), async (route) => {
    if (route.request().method() !== "GET") {
      return route.continue();
    }
    const projection = structuredClone(actionProjection);
    if (mockMode === "running") { projection.order.status = "running"; projection.current_attempt.status = "running"; }
    if (mockMode === "failed_retryable" || mockMode === "failed_not_retryable") {
      projection.order.status = "requires_action"; projection.current_attempt.status = "failed";
      projection.reports = [{ ...actionProjection.reports[0], outcome: "failed", requires_action_reason: null, error_category: "technical", failure_stage: "人工制作", retryability: mockMode === "failed_retryable" ? "retryable" : "not_retryable" }];
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(projection) });
  });
  await page.setViewportSize({ width: 1440, height: 1000 }); await page.reload(); await page.locator("#manualExecutionStatus").filter({ hasText: "需要处理" }).waitFor();
  assert.match(await page.locator("#manualExecutionStatus").getAttribute("class"), /blocked/);
  await page.locator("#recheckManualExecution").click(); await page.locator("#recheckManualDialog").waitFor({ state: "visible" }); await page.locator("#manualRecheckReason").fill("已确认输出并完成处理"); await page.locator("#confirmRecheckManualButton").click(); await page.locator("#manualExecutionStatus").filter({ hasText: "执行中" }).waitFor();
  await page.locator("#submitManualReport").click(); await page.locator("#reportManualDialog").waitFor({ state: "visible" }); assert.equal(await page.locator("#reportManualDialogTitle").textContent(), "提交更正报告"); assert.equal(await page.locator("#manualReportCorrectionHint").isVisible(), true); await page.locator("#reportManualDialog").getByRole("button", { name: "返回", exact: true }).click();
  mockMode = "failed_retryable"; await page.reload(); await page.locator("#manualExecutionStatus").filter({ hasText: "失败" }).waitFor(); await page.locator("#reenterManualExecution").waitFor({ state: "visible" }); assert.match(await page.locator("#manualExecutionMeta").textContent(), /可重试/);
  mockMode = "failed_not_retryable"; await page.reload(); await page.locator("#manualExecutionStatus").filter({ hasText: "失败" }).waitFor(); await page.locator("#reenterManualExecution").waitFor({ state: "hidden" }); assert.match(await page.locator("#manualExecutionMeta").textContent(), /不可.*重试/);
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
});
