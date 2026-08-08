import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";

import { createFakeExecutor } from "../src/executors/fake-executor.js";
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

test("A12 browser flow restores queued and passed verification state at 1440/390 without a works.html entry", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-a12-browser-"));
  const port = await findAvailablePort(58240), host = `127.0.0.1:${port}`, origin = `http://${host}`;
  const identityRepository = createMemoryIdentityRepository();
  const seeded = await seedInitialAdmin(identityRepository, { organizationId: "org-a12-browser", organizationName: "A12 浏览器", adminEmail: "a12-browser@example.test", adminDisplayName: "A12 浏览器", adminTempPassword: "Temporary-A12-Browser-9!" });
  const productionRepository = createMemoryProductionOrderRepository();
  const verification = { job: null, work: null, failNextRead: false, nextOutcome: "requires_action" };
  const verificationService = {
    async getVerificationWorkspace({ productionOrderId, organizationId }) {
      if (verification.failNextRead) { verification.failNextRead = false; throw new Error("temporary read failure"); }
      return { order: { id: productionOrderId, organization_id: organizationId, status: verification.work ? "succeeded" : "running", input_snapshot: { secret: "server-only" } }, job: verification.job, work: verification.work, works: verification.work ? [verification.work] : [] };
    },
    async requestVerification({ productionOrderId, reportId }) {
      const correction = reportId !== "report-a12-browser";
      verification.nextOutcome = correction ? "passed" : "requires_action";
      verification.job = { id: correction ? "job-a12-browser-correction" : "job-a12-browser", report_id: reportId, candidate_id: "candidate-a12-browser", primary_output_checksum: "a".repeat(64), production_order_id: productionOrderId, verification_status: "queued", status: "queued", attempts: 0, max_attempts: 3, created_at: correction ? "2026-08-09T00:02:00.000Z" : "2026-08-09T00:00:00.000Z", updated_at: correction ? "2026-08-09T00:02:00.000Z" : "2026-08-09T00:00:00.000Z" };
      verification.failNextRead = !correction;
      return { job: verification.job, work: null, replayed: false };
    },
    async getVerificationJob() { return verification.job; },
    async retryVerification() { return { job: verification.job, replayed: false }; },
    async recoverVerification() { return { job: verification.job, replayed: false }; },
    async runNextVerificationJob() {
      if (verification.job?.verification_status === "queued") {
        verification.job = verification.nextOutcome === "passed"
          ? { ...verification.job, status: "succeeded", verification_status: "passed", updated_at: "2026-08-09T00:03:00.000Z" }
          : { ...verification.job, status: "succeeded", verification_status: "requires_action", failure_kind: "business", failure_reason: "核心输入发生偏差，不能自动登记作品。", updated_at: "2026-08-09T00:01:00.000Z" };
        if (verification.nextOutcome === "passed") verification.work = { id: "work-a12-browser", primary_asset_version_id: "asset-version-work-browser", primary_output_checksum: "a".repeat(64), primary_output_media_type: "video/mp4", primary_output_size: 16 };
      }
      return verification.job ? { job: verification.job, work: verification.work } : null;
    },
    async heartbeatVerificationJob() {}
  };
  const packageRecord = { id: "package-a12-browser", organization_id: "org-a12-browser", production_order_id: null, package_version: 1, status: "ready", manifest_hash: "manifest-a12-browser", manifest: { accepted_media_types: ["video/mp4"] } };
  const app = await buildApp({ root, executor: createFakeExecutor(),
    identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin], cookieSecure: false, seed: { enabled: false } },
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort: { async bindAvailableVersion(input) { return { reference: input }; } } },
    videoPlanning: { enabled: true, repository: createMemoryVideoPlanningRepository(), worker: { autoStart: false }, upstreamPort: { async resolveCurrent() { return null; } }, capabilitySnapshotPort: { async resolve() { return null; } }, agentReadinessPort: { async isOnline() { return false; } } },
    productionOrders: { enabled: true, repository: productionRepository,
      planPort: { async resolveCurrentApprovedPlan({ organizationId, productId }) { return { current_valid: true, gate: { can_create: true, reasons: [] }, plan: { id: "plan-a12-browser", organization_id: organizationId, product_id: productId, version_number: 1, status: "frozen", upstream_snapshot: {}, capability_config_snapshot: {}, output_instructions: "视频" }, plan_review: { status: "approved" }, preflight_result: { status: "warning" } }; } },
      inputSnapshotPort: { async freezeForOrder() { return { approved_copy_snapshot: { copy_version_id: "copy-a12-browser" }, product_revision_snapshot: { id: "revision-a12-browser" }, avatar_selection_snapshot: { asset_version_id: "avatar-a12-browser" } }; } }, agentReadinessPort: { async isOnline() { return false; } } },
    manualHandoff: { enabled: true, repository: createMemoryManualHandoffRepository(), packageStore: createMemoryManualHandoffPackageStore(), worker: { autoStart: false } },
    manualExecution: { enabled: true, repository: createMemoryManualExecutionRepository(), candidateStore: createMemoryObjectStore(), packagePort: { async getPackage() { return packageRecord; }, async listPackages() { return [packageRecord]; } }, worker: { autoStart: false } },
    artifactVerification: { enabled: true, service: verificationService, workerInstance: { start() {}, stop() {} } }
  });
  const project = await app.projectContent.service.createProject({ organizationId: "org-a12-browser", actorMemberId: seeded.member.id, idempotencyKey: "a12-browser-project", name: "A12 浏览器项目" });
  const { product } = await app.projectContent.service.createProduct({ organizationId: "org-a12-browser", actorMemberId: seeded.member.id, projectId: project.id, idempotencyKey: "a12-browser-product", productName: "A12 商品" });
  const order = await app.productionOrders.service.createProductionOrder({ organizationId: "org-a12-browser", actorMemberId: seeded.member.id, actorRole: "admin", productId: product.id, executionPurpose: "first_production", videoPlanVersionId: "plan-a12-browser", idempotencyKey: "a12-browser-order" });
  packageRecord.production_order_id = order.order.id;
  try { await app.listen({ host: "127.0.0.1", port }); }
  catch (error) { await app.close(); if (error.code === "EPERM") return t.skip("sandbox disallows local TCP listening"); throw error; }
  t.after(() => app.close());
  let browser;
  try { browser = await chromium.launch({ headless: true, executablePath: process.env.IDENTITY_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }); }
  catch (_error) { try { browser = await chromium.launch({ headless: true }); } catch (error) { return t.skip(`Chrome/Chromium unavailable: ${error.message}`); } }
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${origin}/login.html`); await page.getByLabel("工作邮箱").fill("a12-browser@example.test"); await page.getByLabel("密码", { exact: true }).fill("Temporary-A12-Browser-9!"); await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("A12-Browser-Password-9!"); await page.getByRole("button", { name: "保存并进入工作台" }).click(); await page.waitForURL(`${origin}/`);
  const executionProjection = { order: { id: order.order.id, status: "succeeded" }, current_attempt: { id: "attempt-a12-browser", status: "succeeded" }, candidates: [{ id: "candidate-a12-browser", role: "primary_video", status: "pending_verification", original_filename: "a12.mp4", checksum: "a".repeat(64), verification_status: "queued" }], reports: [{ id: "report-a12-browser", outcome: "completed", deviations: [{ code: "input_changed" }], primary_output: { upload_reference: "candidate-a12-browser", checksum: "a".repeat(64), media_type: "video/mp4", size: 16, role: "primary_video" } }] };
  await page.route(new RegExp(`/api/production-orders/${order.order.id}/manual-execution$`), (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(executionProjection) }));
  await page.route(new RegExp(`/api/manual-execution-attempts/${executionProjection.current_attempt.id}/reports$`), async (route) => {
    const body = route.request().postDataJSON();
    executionProjection.reports = [{ ...executionProjection.reports[0], id: body.report_id, report_version: 2, submitted_at: "2026-08-09T00:02:00.000Z", supersedes_report_id: body.supersedes_report_id, deviations: [] }];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ report: executionProjection.reports[0] }) });
  });
  await page.goto(`${origin}/production.html?project=${project.id}&product=${product.id}&orderId=${order.order.id}`);
  await page.getByText("执行完成不等于工单完成", { exact: false }).waitFor();
  await page.getByRole("button", { name: "发起核验", exact: true }).click();
  await page.getByText("核验请求已受理", { exact: false }).waitFor();
  await page.getByText("核验状态暂时无法读取", { exact: false }).waitFor();
  await verificationService.runNextVerificationJob();
  await page.getByText("请先提交更正报告", { exact: false }).waitFor();
  await page.getByRole("button", { name: "提交更正报告", exact: true }).click();
  await page.locator("#manualReportOutcome").selectOption("completed");
  await page.getByRole("button", { name: "提交结果", exact: true }).click();
  await page.getByRole("button", { name: "重新核验", exact: true }).waitFor();
  await page.getByRole("button", { name: "重新核验", exact: true }).click();
  await page.getByText("核验请求已受理", { exact: false }).waitFor();
  await verificationService.runNextVerificationJob();
  await page.getByText("作品已登记", { exact: true }).waitFor();
  await page.waitForFunction(() => !document.body.innerText.includes("核验状态暂时无法读取"));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  assert.equal(await page.locator("#worksLibraryDisabled").isVisible(), true);
  assert.equal(await page.locator("a[href$='works.html']").count(), 0);
  const pageText = await page.locator("body").innerText();
  for (const forbidden of ["checksum", "Work", "AssetVersion", "A13", "failure_code", "job-a12-browser", "asset-version-work-browser", "核验核验"]) assert.equal(pageText.includes(forbidden), false, `forbidden UI term: ${forbidden}`);
  for (const visible of ["文件完整性", "作品已登记", "正式文件版本已固定", "作品检查与交付功能暂未开放"]) assert.equal(pageText.includes(visible), true, `missing business copy: ${visible}`);
});
