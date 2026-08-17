import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
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

function pngDimensions(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test("V2-C delivered work exposes one terminal primary action and an audited secondary delivery action", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-v2-c-works-browser-"));
  const port = await findAvailablePort(58440);
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const organizationId = "org-v2-c-works-browser";
  const identityRepository = createMemoryIdentityRepository();
  const seeded = await seedInitialAdmin(identityRepository, {
    organizationId,
    organizationName: "V2-C Works 浏览器",
    adminEmail: "v2-c-works-browser@example.test",
    adminDisplayName: "V2-C Works 管理员",
    adminTempPassword: "Temporary-V2-C-Works-9!"
  });
  const work = {
    id: "work-v2-c-delivered",
    organization_id: organizationId,
    project_id: "project-v2-c",
    product_id: "product-v2-c",
    project_name: "V2-C 作品项目",
    product_name: "终态动作测试商品",
    production_order_id: "order-v2-c",
    primary_asset_version_id: "asset-version-v2-c",
    primary_output_media_type: "video/mp4",
    primary_output_size: 1024,
    status: "available",
    created_at: "2026-08-17T00:00:00.000Z",
    updated_at: "2026-08-17T00:00:00.000Z"
  };
  const pendingWork = { ...work, id: "work-v2-c-pending", product_id: "product-v2-c-pending", product_name: "待检查测试商品",
    production_order_id: "order-v2-c-pending", primary_asset_version_id: "asset-version-v2-c-pending", created_at: "2026-08-17T00:01:00.000Z" };
  const hiddenWork = { ...work, id: "work-v2-c-hidden", organization_id: "org-v2-c-hidden", product_name: "其他组织隐藏作品" };
  const works = [pendingWork, work, hiddenWork];
  const workPort = {
    async listWorks(requestOrganizationId) { return works.filter((item) => item.organization_id === requestOrganizationId).map((item) => structuredClone(item)); },
    async getWork(requestOrganizationId, workId) { return structuredClone(works.find((item) => item.organization_id === requestOrganizationId && item.id === workId) || null); }
  };
  const downloadBody = Buffer.from("verified-v2-c-video");
  const downloadChecksum = createHash("sha256").update(downloadBody).digest("hex");
  const assetPort = {
    async createDownloadAuthorization({ assetVersionId }) { return {
      token: `token-${assetVersionId}`, expires_at: "2026-08-17T02:00:00.000Z", original_filename: "已核验成片.mp4",
      verified_content_type: "video/mp4", verified_size: downloadBody.length, verified_checksum_sha256: downloadChecksum
    }; },
    async downloadObject() { return { body: downloadBody, original_filename: "已核验成片.mp4", verified_content_type: "video/mp4",
      verified_size: downloadBody.length, verified_checksum_sha256: downloadChecksum }; }
  };
  const service = createWorkDeliveryService({
    repository: createMemoryWorkDeliveryRepository(),
    workPort,
    assetPort,
    now: () => Date.parse("2026-08-17T01:00:00.000Z")
  });
  const actor = { organizationId, actorMemberId: seeded.member.id, actorRole: "admin" };
  const pending = (await service.listWorks(actor)).find((item) => item.id === work.id);
  const deliverable = await service.markDeliverable({
    ...actor,
    workId: work.id,
    expectedInspectionId: pending.current_inspection.id,
    expectedRevision: pending.current_inspection.revision,
    idempotencyKey: "v2-c-seed-pass"
  });
  await service.createDelivery({
    ...actor,
    workId: work.id,
    expectedInspectionId: deliverable.work.current_inspection.id,
    expectedRevision: deliverable.work.current_inspection.revision,
    idempotencyKey: "v2-c-seed-delivery",
    deliveryMethod: "manual_transfer",
    deliveredAt: "2026-08-17T01:00:00.000Z",
    recipientReference: "V2-C 验收团队",
    note: "终态层级测试记录"
  });
  const refreshedWorks = (await service.listWorks(actor)).map((item) => structuredClone(item));
  const refreshedDeliveredWork = refreshedWorks.find((item) => item.id === work.id);
  refreshedDeliveredWork.current_inspection = {
    ...refreshedDeliveredWork.current_inspection,
    id: "inspection-v2-c-refreshed",
    revision: refreshedDeliveredWork.current_inspection.revision + 1
  };

  const app = await buildApp({
    root,
    executor: createFakeExecutor(),
    identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin], cookieSecure: false, seed: { enabled: false } },
    workDelivery: { enabled: true, service }
  });
  try { await app.listen({ host: "127.0.0.1", port }); }
  catch (error) { await app.close(); if (error.code === "EPERM") return t.skip("sandbox disallows local TCP listening"); throw error; }
  t.after(() => app.close());

  let browser;
  try { browser = await chromium.launch({ headless: true, executablePath: process.env.IDENTITY_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }); }
  catch (_systemError) {
    try { browser = await chromium.launch({ headless: true }); }
    catch (error) { return t.skip(`Chrome/Chromium unavailable: ${error.message}`); }
  }
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${origin}/login.html`);
  await page.getByLabel("工作邮箱").fill("v2-c-works-browser@example.test");
  await page.getByLabel("密码", { exact: true }).fill("Temporary-V2-C-Works-9!");
  await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("V2-C-Works-Browser-Password-9!");
  await page.getByRole("button", { name: "保存并进入工作台" }).click();
  await page.waitForURL(`${origin}/`);

  await page.goto(`${origin}/works.html?work=${work.id}`);
  await page.locator("#selectedDeliveryStatus").filter({ hasText: "已交付" }).waitFor();

  const primary = page.getByRole("button", { name: "查看交付记录", exact: true });
  const secondary = page.getByRole("button", { name: "新增一次交付", exact: true });
  assert.equal(await primary.count(), 1);
  assert.equal(await primary.isVisible(), true);
  assert.equal(await secondary.count(), 1);
  assert.equal(await secondary.isVisible(), true);
  assert.equal(await page.getByRole("button", { name: "标记为通过", exact: true }).isVisible(), false);
  assert.equal(await page.getByRole("button", { name: "登记返工", exact: true }).isVisible(), false);
  assert.equal(await page.locator('#mainContent [data-recommended-action="true"]').count(), 1);
  assert.equal(await primary.getAttribute("data-recommended-action"), "true");

  await page.getByRole("button", { name: "加载预览", exact: true }).click();
  await page.getByText("文件技术详情", { exact: true }).click();
  await page.getByText("已核验成片.mp4", { exact: true }).waitFor();
  assert.equal((await page.locator("#downloadMediaType").textContent()).trim(), "video/mp4");
  assert.equal((await page.locator("#downloadChecksum").textContent()).trim(), downloadChecksum);
  assert.equal(await page.locator("#downloadWork").getAttribute("download"), "已核验成片.mp4");
  assert.equal((await page.locator("#downloadBoundary").textContent()).includes("真实字节下载验收"), true);

  await page.goto(`${origin}/works.html?work=${hiddenWork.id}`);
  await page.locator("#selectedWorkName").filter({ hasText: "待检查测试商品" }).waitFor();
  assert.equal((await page.locator("body").innerText()).includes(hiddenWork.product_name), false);
  assert.equal(new URL(page.url()).searchParams.get("work"), pendingWork.id);

  let worksAttempts = 0;
  await page.route("**/api/works", async (route) => {
    if (new URL(route.request().url()).pathname === "/api/works" && worksAttempts++ === 0) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "TEMPORARY_FAILURE" }) });
      return;
    }
    await route.continue();
  });
  await page.goto(`${origin}/works.html?work=${work.id}`);
  await page.getByText("作品列表读取失败", { exact: false }).waitFor();
  assert.equal(await page.getByText("正在加载作品…", { exact: true }).count(), 0);
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.locator("#selectedWorkName").filter({ hasText: "终态动作测试商品" }).waitFor();
  assert.equal(worksAttempts >= 2, true);
  await page.unroute("**/api/works");

  const screenshotDir = "/private/tmp/hifly-v2-c-screenshots-20260817";
  await mkdir(screenshotDir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(await page.locator(".works-layout").evaluate((node) => getComputedStyle(node).display), "grid");
  assert.equal((await page.locator(".works-layout").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length)), 2);

  for (const viewport of [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    const screenshotPath = path.join(screenshotDir, `works-${viewport.width}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    assert.deepEqual(pngDimensions(await readFile(screenshotPath)), viewport);
  }

  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto(`${origin}/works.html`);
  assert.equal(await page.locator(".works-layout").evaluate((node) => getComputedStyle(node).display), "block");
  assert.equal(await page.locator("#worksList").isVisible(), true);
  assert.equal(await page.locator("#workDetail").isVisible(), false);
  const deliveredListItem = page.locator(`#worksList [data-work-id="${work.id}"]`);
  await deliveredListItem.click();
  assert.equal(await page.locator("#workDetail").isVisible(), true);
  assert.equal(await page.locator("#selectedWorkName").evaluate((node) => node === document.activeElement), true);
  await page.getByRole("button", { name: /返回作品列表/ }).click();
  assert.equal(await page.locator("#worksList").isVisible(), true);
  assert.equal(await page.locator("#workDetail").isVisible(), false);
  assert.equal(await deliveredListItem.evaluate((node) => node === document.activeElement), true);
  await page.getByRole("button", { name: "查看作品详情", exact: true }).click();
  assert.equal(await page.locator("#selectedWorkName").evaluate((node) => node === document.activeElement), true);
  await page.getByRole("button", { name: /返回作品列表/ }).click();
  assert.equal(await deliveredListItem.evaluate((node) => node === document.activeElement), true);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const transitionDuration = await page.locator(".work-list-item").first().evaluate((node) => getComputedStyle(node).transitionDuration);
  assert.equal(transitionDuration.split(",").every((value) => Number.parseFloat(value) <= 0.001), true, transitionDuration);

  await page.goto(`${origin}/works.html?work=${work.id}`);
  const addDelivery = page.getByRole("button", { name: "新增一次交付", exact: true });
  await addDelivery.click();
  const deliveryDialog = page.getByRole("dialog", { name: "登记一次交付" });
  await deliveryDialog.getByLabel("交付时间").fill("2026-08-17T10:30");
  await deliveryDialog.getByLabel("接收方（可选）").fill("保留此输入");
  const retryBodies = [];
  await page.route(`**/api/works/${work.id}/deliveries`, async (route) => {
    retryBodies.push(route.request().postDataJSON());
    if (retryBodies.length === 1) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "AMBIGUOUS_RESPONSE" }) });
      return;
    }
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ delivery: { id: "delivery-replayed" } }) });
  });
  await page.locator("#deliveryForm").evaluate((form) => form.requestSubmit());
  await deliveryDialog.getByText("交付登记未完成", { exact: false }).waitFor();
  await deliveryDialog.getByRole("button", { name: "确认登记交付", exact: true }).click();
  await deliveryDialog.waitFor({ state: "hidden" });
  assert.equal(retryBodies.length, 2);
  assert.equal(retryBodies[0].idempotency_key, retryBodies[1].idempotency_key);
  await page.unroute(`**/api/works/${work.id}/deliveries`);

  await addDelivery.click();
  await deliveryDialog.getByLabel("交付时间").fill("2026-08-17T11:30");
  await deliveryDialog.getByLabel("接收方（可选）").fill("保留冲突输入");
  const conflictBodies = [];
  await page.route(`**/api/works/${work.id}/deliveries`, async (route) => {
    conflictBodies.push(route.request().postDataJSON());
    if (conflictBodies.length === 1) {
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "WORK_DELIVERY_INSPECTION_CONFLICT" }) });
      return;
    }
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ delivery: { id: "delivery-after-refresh" } }) });
  });
  await page.route("**/api/works", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ works: refreshedWorks }) }));
  await deliveryDialog.getByRole("button", { name: "确认登记交付", exact: true }).click();
  await deliveryDialog.getByText("作品状态已被更新", { exact: false }).waitFor();
  assert.equal(await deliveryDialog.getByLabel("接收方（可选）").inputValue(), "保留冲突输入");
  await deliveryDialog.getByRole("button", { name: "载入最新作品状态", exact: true }).click();
  await deliveryDialog.getByText("最新作品状态已载入", { exact: false }).waitFor();
  assert.equal(await deliveryDialog.getByLabel("接收方（可选）").inputValue(), "保留冲突输入");
  await deliveryDialog.getByRole("button", { name: "确认登记交付", exact: true }).click();
  await deliveryDialog.waitFor({ state: "hidden" });
  assert.equal(conflictBodies.length, 2);
  assert.notEqual(conflictBodies[0].idempotency_key, conflictBodies[1].idempotency_key);
  assert.equal(conflictBodies[1].expected_inspection_id, "inspection-v2-c-refreshed");
  assert.equal(conflictBodies[1].expected_revision, refreshedDeliveredWork.current_inspection.revision);

  await page.unroute("**/api/works");
  await page.unroute(`**/api/works/${work.id}/deliveries`);
  await page.route("**/api/works", async (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ works: [] }) }));
  await page.goto(`${origin}/works.html`);
  await page.getByText("还没有已登记作品", { exact: true }).waitFor();
  assert.equal((await page.locator("#worksTaskStatus").textContent()).trim(), "暂无作品");
  assert.equal((await page.locator("#worksTaskNext").textContent()).trim(), "等待作品登记");
  assert.equal(await page.locator('#mainContent [data-recommended-action="true"]').count(), 0);
});
