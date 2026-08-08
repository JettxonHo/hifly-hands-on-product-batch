import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
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
import { buildManualHandoffZip } from "../src/manual-handoff/manual-handoff-package-store.js";
import { ADMIN_EMAIL, ADMIN_TEMP_PASSWORD } from "./helpers/identity-world.js";

test("manual handoff panel recovers generation, downloads without execution, and has no A11 executable entry at 390px", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-manual-handoff-browser-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(57920), host = `127.0.0.1:${port}`, origin = `http://${host}`;
  const identityRepository = createMemoryIdentityRepository();
  const seeded = await seedInitialAdmin(identityRepository, { organizationId: "org-manual-browser", organizationName: "交接包工作台", adminEmail: ADMIN_EMAIL, adminDisplayName: "生产运营", adminTempPassword: ADMIN_TEMP_PASSWORD });
  const projectContentRepository = createMemoryProjectContentRepository();
  const productionRepository = createMemoryProductionOrderRepository();
  let archiveAttempts = 0;
  const app = await buildApp({ root, executor: createFakeExecutor(),
    identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin], cookieSecure: false, seed: { enabled: false } },
    projectContent: { enabled: true, repository: projectContentRepository, assetReferencePort: { async bindAvailableVersion(input) { return { reference: input }; } } },
    videoPlanning: { enabled: true, repository: createMemoryVideoPlanningRepository(), worker: { autoStart: false }, upstreamPort: { async resolveCurrent() { return null; } }, capabilitySnapshotPort: { async resolve() { return null; } }, agentReadinessPort: { async isOnline() { return false; } } },
    productionOrders: { enabled: true, repository: productionRepository, inputSnapshotPort: { async freezeForOrder() {
      return { approved_copy_snapshot: { copy_version_id: "copy-browser", product_revision_id: "revision-browser", version_number: 1, status: "frozen", intent: "product_recommendation", body: "浏览器冻结文案正文", review: { id: "review-browser", status: "approved", reviewer_member_id: "member-browser", decided_at: "2026-08-08T08:00:00.000Z" } },
        product_revision_snapshot: { id: "revision-browser", organization_id: "org-manual-browser", project_id: "project-browser", product_id: product.id, status: "ready", revision_number: 1, product_name: "云感保湿乳", product_description: "日常保湿", primary_category: "beauty", content_brief: null, selling_points: [{ text: "清爽不黏", confirmed: true }], asset_version_ids: ["product-image-browser"] },
        asset_references: [{ asset_id: "asset-browser", asset_version_id: "product-image-browser", role: "product_image", display_name: "商品图", media_type: "image/png", size: 10, checksum: "9febe01bd41bfb69683e29d711d8adffc9ae38de17a6873464b416f3b67398b6", retrieval_mode: "embedded", access_scope: "organization", body: Buffer.from("test-image") }],
        avatar_selection_snapshot: { avatar_selection_id: "selection-browser", copy_version_id: "copy-browser", asset_version_id: "avatar-browser", status: "confirmed", version_number: 1, confirmed_at: "2026-08-08T08:00:00.000Z", avatar_asset_id: "avatar-browser", display_name: "浏览器人物", source_type: "enterprise", authorization_status: "valid", authorization_expires_at: "2027-12-31T15:59:59.000Z", authorization_scope: "current_organization", capability_status: "verified", materials_accessible: true, capabilities: [{ code: "speech", evidence_reference: "seed:speech" }] } };
    } }, planPort: { async resolveCurrentApprovedPlan({ organizationId, productId }) {
      if (organizationId !== "org-manual-browser" || productId !== product.id) return null;
      return { current_valid: true, gate: { can_create: true, reasons: [] }, plan: { id: "plan-browser", organization_id: organizationId, product_id: productId, version_number: 2, status: "frozen", output_instructions: "竖版商品种草口播", upstream_snapshot: { product_revision_id: "revision-browser", copy_version_id: "copy-browser", avatar_selection_id: "selection-browser", avatar_asset_version_id: "avatar-browser" }, capability_config_snapshot: { snapshot_version: "capability-browser" } }, plan_review: { id: "review-browser", status: "approved" }, preflight_result: { id: "preflight-browser", status: "warning" } };
      } }, agentReadinessPort: { async isOnline() { return false; } } },
    manualHandoff: { enabled: true, repository: createMemoryManualHandoffRepository(), packageStore: createMemoryManualHandoffPackageStore(),
      archiveBuilder: async ({ finalManifest, readme, assets }) => {
        archiveAttempts += 1;
        if (archiveAttempts === 1) throw new Error("controlled archive failure");
        return buildManualHandoffZip([
          { name: "manifest.json", body: `${JSON.stringify(finalManifest)}\n` },
          { name: "README.md", body: readme },
          ...Object.entries(assets).map(([name, body]) => ({ name, body }))
        ]);
      }, worker: { autoStart: false } }
  });
  const project = await app.projectContent.service.createProject({ organizationId: "org-manual-browser", actorMemberId: seeded.member.id, idempotencyKey: "manual-browser-project", name: "交接包项目" });
  const createdProduct = await app.projectContent.service.createProduct({ organizationId: "org-manual-browser", actorMemberId: seeded.member.id, projectId: project.id, idempotencyKey: "manual-browser-product", productName: "云感保湿乳" });
  const product = createdProduct.product;
  const order = await app.productionOrders.service.createProductionOrder({ organizationId: "org-manual-browser", actorMemberId: seeded.member.id, actorRole: "admin", productId: product.id, executionPurpose: "first_production", videoPlanVersionId: "plan-browser", idempotencyKey: "manual-browser-order" });
  try { await app.listen({ host: "127.0.0.1", port }); } catch (error) { await app.close(); if (error.code === "EPERM") return t.skip("sandbox disallows local TCP listening"); throw error; }
  t.after(() => app.close());
  let browser;
  try { browser = await chromium.launch({ headless: true, executablePath: process.env.IDENTITY_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }); }
  catch (_error) { try { browser = await chromium.launch({ headless: true }); } catch (error) { return t.skip(`Chrome/Chromium unavailable: ${error.message}`); } }
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  await page.goto(`${origin}/login.html`); await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL); await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD); await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("Manual-Handoff-Browser-Password-9!"); await page.getByRole("button", { name: "保存并进入工作台" }).click(); await page.waitForURL(`${origin}/`);
  await page.goto(`${origin}/production.html?project=${project.id}&product=${product.id}&orderId=${order.order.id}`);
  await page.getByText("等待执行", { exact: true }).first().waitFor();
  assert.equal(await page.getByRole("button", { name: "生成交接包", exact: true }).count(), 1);
  assert.equal(await page.getByRole("button", { name: "领取人工任务", exact: true }).isDisabled(), true);
  await page.getByRole("button", { name: "生成交接包", exact: true }).click();
  await page.getByText("生成中", { exact: true }).waitFor();
  await app.manualHandoff.worker.runNext();
  await page.reload(); await page.getByText("生成未完成", { exact: true }).waitFor();
  await page.getByText("交接包生成未完成，请稍后重试。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "重试生成", exact: true }).count(), 1);
  await page.getByRole("button", { name: "重试生成", exact: true }).click();
  await page.getByText("生成中", { exact: true }).waitFor();
  await app.manualHandoff.worker.runNext();
  await page.reload(); await page.getByText("可下载", { exact: true }).waitFor();
  assert.equal(archiveAttempts, 2);
  assert.equal(await page.getByText("下载不代表开始执行。", { exact: false }).count() > 0, true);
  const downloadPromise = page.waitForEvent("download"); await page.getByRole("button", { name: "下载交接包", exact: true }).click(); const download = await downloadPromise; assert.match(download.suggestedFilename(), /manual-handoff-.*\.zip/);
  await page.setViewportSize({ width: 390, height: 844 }); await page.reload(); await page.getByText("可下载", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  assert.equal(await page.locator("#claimManualTask").count(), 1);
  assert.equal(await page.locator("#claimManualTask").isDisabled(), true);
  assert.equal(await page.locator("#claimManualTask").evaluate((node) => node.closest("a")), null);
});
