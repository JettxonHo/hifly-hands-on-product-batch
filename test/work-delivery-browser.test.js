import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";

import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { createMemoryIdentityRepository } from "../src/identity/memory-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createMemoryWorkDeliveryRepository } from "../src/work-delivery/memory-work-delivery-repository.js";
import { createWorkDeliveryService } from "../src/work-delivery/work-delivery-service.js";
import { buildApp } from "../src/server/app.js";
import { findAvailablePort } from "../src/server/start.js";

test("A13 works library supports inspection, delivery history, feature entry, and 1440/390 layouts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-a13-browser-"));
  const port = await findAvailablePort(58340), host = `127.0.0.1:${port}`, origin = `http://${host}`;
  const identityRepository = createMemoryIdentityRepository();
  const seeded = await seedInitialAdmin(identityRepository, { organizationId: "org-a13-browser", organizationName: "A13 浏览器", adminEmail: "a13-browser@example.test", adminDisplayName: "A13 浏览器", adminTempPassword: "Temporary-A13-Browser-9!" });
  const works = [
    { id: "work-a13-browser", organization_id: "org-a13-browser", project_id: "project-a13-browser", product_id: "product-a13-browser", project_name: "A13 浏览器项目", product_name: "云感保湿乳", production_order_id: "order-a13-browser", primary_asset_version_id: "asset-version-a13-browser", primary_output_media_type: "video/mp4", primary_output_size: 42, status: "available", created_at: "2026-08-09T00:00:00.000Z", updated_at: "2026-08-09T00:00:00.000Z" },
    { id: "work-a13-rework", organization_id: "org-a13-browser", project_id: "project-a13-browser", product_id: "product-a13-rework", project_name: "A13 浏览器项目", product_name: "返工测试商品", production_order_id: "order-a13-rework", primary_asset_version_id: "asset-version-a13-rework", primary_output_media_type: "video/mp4", primary_output_size: 42, status: "available", created_at: "2026-08-09T00:01:00.000Z", updated_at: "2026-08-09T00:01:00.000Z" },
    { id: "work-a13-no-upstream", organization_id: "org-a13-browser", project_id: null, product_id: null, project_name: null, product_name: "无上游上下文作品", production_order_id: "order-a13-no-upstream", primary_asset_version_id: "asset-version-a13-no-upstream", primary_output_media_type: "video/mp4", primary_output_size: 42, status: "available", created_at: "2026-08-09T00:02:00.000Z", updated_at: "2026-08-09T00:02:00.000Z" }
  ];
  const workPort = { async listWorks(organizationId) { return works.filter((work) => work.organization_id === organizationId).map((work) => structuredClone(work)); }, async getWork(organizationId, workId) { return structuredClone(works.find((work) => work.organization_id === organizationId && work.id === workId) || null); } };
  const service = createWorkDeliveryService({ repository: createMemoryWorkDeliveryRepository(), workPort, now: () => Date.parse("2026-08-09T01:00:00.000Z") });
  const app = await buildApp({ root, executor: createFakeExecutor(), identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin], cookieSecure: false, seed: { enabled: false } }, workDelivery: { enabled: true, service } });
  try { await app.listen({ host: "127.0.0.1", port }); }
  catch (error) { await app.close(); if (error.code === "EPERM") return t.skip("sandbox disallows local TCP listening"); throw error; }
  t.after(() => app.close());

  let browser;
  try { browser = await chromium.launch({ headless: true, executablePath: process.env.IDENTITY_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }); }
  catch (_error) { try { browser = await chromium.launch({ headless: true }); } catch (error) { return t.skip(`Chrome/Chromium unavailable: ${error.message}`); } }
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${origin}/login.html`);
  await page.getByLabel("工作邮箱").fill("a13-browser@example.test"); await page.getByLabel("密码", { exact: true }).fill("Temporary-A13-Browser-9!"); await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("A13-Browser-Password-9!"); await page.getByRole("button", { name: "保存并进入工作台" }).click(); await page.waitForURL(`${origin}/`);

  await page.goto(`${origin}/works.html?work=work-a13-browser`);
  await page.getByRole("heading", { name: "作品库", exact: true }).waitFor(); await page.getByText("云感保湿乳", { exact: true }).first().waitFor();
  const worksLink = page.locator('a[data-feature="works"]'); await worksLink.waitFor();
  assert.deepEqual(await page.locator(".app-nav [data-page]").evaluateAll((links) => links.map((link) => link.dataset.page)), ["projects", "assets", "works", "members"]);
  assert.equal(await worksLink.getAttribute("aria-current"), "page"); assert.equal(await worksLink.isVisible(), true);
  assert.equal(await page.locator(".works-layout").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length), 3);
  await page.getByRole("button", { name: "标记为通过", exact: true }).click();
  const passDialog = page.getByRole("dialog", { name: "确认通过检查" }); await passDialog.waitFor();
  assert.equal(await passDialog.getByText("作品：云感保湿乳", { exact: false }).count(), 1);
  assert.equal(await passDialog.getByText("确认此作品通过检查，可交付。", { exact: true }).count(), 1);
  assert.equal((await page.locator("#selectedDeliveryStatus").textContent()).trim(), "待检查");
  await passDialog.getByRole("button", { name: "确认通过检查", exact: true }).click(); await page.locator("#selectedDeliveryStatus").filter({ hasText: "可交付" }).waitFor();
  await page.getByRole("button", { name: "登记一次交付", exact: true }).click();
  const deliveryDialog = page.getByRole("dialog", { name: "登记一次交付" });
  const chosenDeliveryTime = "2026-08-09T10:15";
  await deliveryDialog.getByLabel("交付时间").fill(chosenDeliveryTime); await deliveryDialog.getByLabel("接收方（可选）").fill("品牌运营团队");
  assert.equal(await deliveryDialog.getByLabel("交付时间").inputValue(), chosenDeliveryTime);
  await deliveryDialog.getByRole("button", { name: "确认登记交付" }).click();
  await page.getByText("交付已登记", { exact: false }).waitFor(); await page.getByText("共 1 次", { exact: true }).waitFor(); await page.locator("#selectedDeliveryStatus").filter({ hasText: "已交付" }).waitFor();
  const expectedDeliveryTime = await page.evaluate((value) => new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)), chosenDeliveryTime);
  assert.equal((await page.locator("#deliveryHistoryList time").first().textContent()).trim(), expectedDeliveryTime);

  await page.getByRole("button", { name: /返工测试商品/ }).click(); await page.getByRole("button", { name: "登记返工", exact: true }).click();
  const reworkDialog = page.getByRole("dialog", { name: "登记返工" }); await reworkDialog.getByLabel("返工分类").selectOption("visual_quality"); await reworkDialog.getByLabel("返工原因").fill("画面主体需要重新检查"); await reworkDialog.getByLabel("返回阶段").selectOption("video_plan"); await reworkDialog.getByRole("button", { name: "确认登记返工" }).click();
  await page.locator("#selectedDeliveryStatus").filter({ hasText: "需要返工" }).waitFor(); await page.locator("#inspectionHistoryList").getByText("画面主体需要重新检查", { exact: false }).waitFor();
  assert.equal(await page.locator("#passInspection").isDisabled(), true); assert.equal(await page.locator("#requestRework").isDisabled(), true);
  assert.equal((await page.locator("#actionExplanation").textContent()).includes("新的上游生产周期和新工单"), true);
  assert.equal((await page.locator("#actionExplanation").textContent()).includes("原作品与检查历史会保留"), true);
  assert.equal(await page.locator("#upstreamActionLink").isVisible(), true);
  assert.equal(await page.locator("#upstreamActionLink").getAttribute("href"), "/plan.html?project=project-a13-browser&product=product-a13-rework");

  await page.setViewportSize({ width: 390, height: 844 }); await page.getByText("作品库", { exact: true }).first().waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  assert.equal(await page.locator(".works-mobile-action button").isVisible(), true);
  assert.equal(await page.locator(".works-mobile-action button").count(), 1);
  assert.equal(await page.locator(".works-mobile-action").evaluate((node) => getComputedStyle(node).position), "fixed");
  assert.equal(await page.locator("#passInspection").isDisabled(), true); assert.equal(await page.locator("#requestRework").isDisabled(), true);
  assert.equal(await page.locator("#mobilePrimaryAction").isDisabled(), false); assert.equal((await page.locator("#mobilePrimaryAction").textContent()).trim(), "选择其他作品");
  await page.locator("#mobilePrimaryAction").click();
  assert.equal((await page.locator("#selectedDeliveryStatus").textContent()).trim(), "需要返工");
  await page.getByRole("dialog", { name: "选择作品" }).getByRole("button", { name: /无上游上下文作品/ }).click();
  await page.getByRole("button", { name: "登记返工", exact: true }).click();
  const noContextRework = page.getByRole("dialog", { name: "登记返工" }); await noContextRework.getByLabel("返工分类").selectOption("visual_quality"); await noContextRework.getByLabel("返工原因").fill("需要返回上游处理"); await noContextRework.getByLabel("返回阶段").selectOption("video_plan"); await noContextRework.getByRole("button", { name: "确认登记返工" }).click();
  await page.locator("#selectedDeliveryStatus").filter({ hasText: "需要返工" }).waitFor(); assert.equal(await page.locator("#upstreamActionLink").isVisible(), false);
  const pageText = await page.locator("body").innerText();
  for (const forbidden of ["WorkInspection", "DeliveryRecord", "manifest", "checksum", "Playwright", "Token", "Cookie", "签名 URL"]) assert.equal(pageText.includes(forbidden), false, `forbidden UI term: ${forbidden}`);
});
