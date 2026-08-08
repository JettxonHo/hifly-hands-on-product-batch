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
  await page.goto(`${origin}/login.html`); await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD); await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("Production-Browser-Password-9!"); await page.getByRole("button", { name: "保存并进入工作台" }).click(); await page.waitForURL(`${origin}/`);

  await page.goto(`${origin}/production.html?project=${project.id}&product=${product.id}`);
  await page.getByRole("heading", { name: "生成与交付", exact: true }).waitFor();
  await page.locator("#orderListEmpty").waitFor();
  await page.getByText("当前没有可用的执行环境", { exact: false }).waitFor();
  assert.equal(await page.getByRole("button", { name: "生成交接包" }).count(), 0);

  await page.getByRole("button", { name: "+ 创建工单" }).click();
  const dialog = page.getByRole("dialog", { name: "创建生产工单" }); await dialog.waitFor();
  assert.equal(await dialog.locator("input[type=radio]:checked").count(), 0);
  assert.equal(await dialog.getByRole("button", { name: "确认创建工单" }).isDisabled(), true);
  await dialog.getByLabel("首次生产", { exact: false }).check();
  await dialog.getByRole("button", { name: "确认创建工单" }).dblclick();
  await page.getByText("等待执行", { exact: true }).first().waitFor();
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "a09-production-1440.png"), fullPage: true });
  assert.equal(await page.locator("#orderList [data-order-id]").count(), 1);
  assert.equal(await page.getByText("目的在创建时固定，不可修改。", { exact: true }).count() > 0, true);
  assert.equal(await page.getByRole("button", { name: "生成交接包" }).count(), 0);

  await page.reload(); await page.getByText("等待执行", { exact: true }).first().waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "a09-production-390.png"), fullPage: true });
});
