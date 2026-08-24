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

async function launchBrowser(t) {
  try { return await chromium.launch({ headless: true, executablePath: process.env.IDENTITY_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }); }
  catch (_systemError) {
    try { return await chromium.launch({ headless: true }); }
    catch (error) { t.skip(`Chrome/Chromium unavailable: ${error.message}`); return null; }
  }
}

test("方案 A 作品库使用服务端六项分页并在桌面与手机安全恢复精确作品", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-post-stage-works-browser-"));
  const port = await findAvailablePort(59420);
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const organizationId = "org-post-stage-works";
  const identityRepository = createMemoryIdentityRepository();
  const seeded = await seedInitialAdmin(identityRepository, {
    organizationId,
    organizationName: "作品库验收组织",
    adminEmail: "post-stage-works@example.test",
    adminDisplayName: "作品库验收管理员",
    adminTempPassword: "Temporary-Post-Stage-Works-9!"
  });
  const downloadBody = Buffer.from("post-stage-work-video");
  const downloadChecksum = createHash("sha256").update(downloadBody).digest("hex");
  const works = Array.from({ length: 9 }, (_, index) => {
    const number = index + 1;
    return {
      id: `work-post-${number}`,
      organization_id: organizationId,
      production_order_id: `order-post-${number}`,
      execution_attempt_id: `attempt-post-${number}`,
      manual_execution_report_id: `report-post-${number}`,
      package_id: `package-post-${number}`,
      primary_asset_version_id: `private-asset-version-${number}`,
      primary_candidate_id: `private-candidate-${number}`,
      primary_output_checksum: downloadChecksum,
      primary_output_media_type: "video/mp4",
      primary_output_size: downloadBody.length,
      status: "available",
      created_at: `2026-08-${String(number === 8 ? 9 : number).padStart(2, "0")}T00:00:00.000Z`,
      updated_at: `2026-08-${String(number === 8 ? 9 : number).padStart(2, "0")}T00:00:00.000Z`
    };
  });
  const hiddenWork = { ...works[0], id: "work-post-hidden", organization_id: "org-hidden", production_order_id: "order-hidden" };
  const workPort = {
    async listWorks(requestOrganizationId) {
      return [...works, hiddenWork].filter((work) => work.organization_id === requestOrganizationId).map((work) => structuredClone(work));
    },
    async getWork(requestOrganizationId, workId) {
      return structuredClone([...works, hiddenWork].find((work) => work.organization_id === requestOrganizationId && work.id === workId) || null);
    }
  };
  const orderPort = {
    async getOrder({ organizationId: requestOrganizationId, orderId }) {
      const number = Number(orderId.replace("order-post-", ""));
      if (requestOrganizationId !== organizationId || !Number.isInteger(number) || number < 1 || number > 9) {
        throw Object.assign(new Error("PRODUCTION_ORDER_NOT_FOUND"), { code: "PRODUCTION_ORDER_NOT_FOUND" });
      }
      return {
        id: orderId,
        organization_id: organizationId,
        product_id: `product-post-${number}`,
        input_snapshot: { product_revision_snapshot: {
          id: `revision-post-${number}`,
          organization_id: organizationId,
          project_id: number > 7 ? "project-post-b" : "project-post-a",
          product_id: `product-post-${number}`,
          product_name: `验收商品 ${number}`,
          status: "ready"
        } }
      };
    }
  };
  const repository = createMemoryWorkDeliveryRepository();
  const assetPort = {
    async createDownloadAuthorization({ assetVersionId }) {
      return {
        token: `token-${assetVersionId}`,
        expires_at: "2026-08-25T02:00:00.000Z",
        asset_version_id: assetVersionId,
        original_filename: `${assetVersionId}.mp4`,
        verified_content_type: "video/mp4",
        verified_size: downloadBody.length,
        verified_checksum_sha256: downloadChecksum
      };
    },
    async downloadObject({ token }) {
      return {
        body: downloadBody,
        original_filename: "已核验作品.mp4",
        verified_content_type: "video/mp4",
        verified_size: downloadBody.length,
        verified_checksum_sha256: downloadChecksum
      };
    }
  };
  const service = createWorkDeliveryService({ repository, workPort, orderPort, assetPort, now: () => Date.parse("2026-08-25T01:00:00.000Z") });
  const actor = { organizationId, actorMemberId: seeded.member.id, actorRole: "admin" };
  const seededWorks = await service.listWorks(actor);
  const byNumber = (number) => seededWorks.find((work) => work.id === `work-post-${number}`);
  const pass = async (number, key) => {
    const pending = byNumber(number).current_inspection;
    return service.markDeliverable({ ...actor, workId: `work-post-${number}`, expectedInspectionId: pending.id, expectedRevision: pending.revision, idempotencyKey: key });
  };
  await pass(8, "works-pass-8");
  const delivered = await pass(7, "works-pass-7");
  await service.createDelivery({ ...actor, workId: "work-post-7", expectedInspectionId: delivered.inspection.id,
    expectedRevision: delivered.inspection.revision, idempotencyKey: "works-delivery-7", deliveryMethod: "manual_transfer" });
  const reworked = await pass(6, "works-pass-6");
  await service.createDelivery({ ...actor, workId: "work-post-6", expectedInspectionId: reworked.inspection.id,
    expectedRevision: reworked.inspection.revision, idempotencyKey: "works-delivery-6", deliveryMethod: "manual_transfer" });
  await service.requestRework({ ...actor, workId: "work-post-6", expectedInspectionId: reworked.inspection.id,
    expectedRevision: reworked.inspection.revision, idempotencyKey: "works-rework-6", category: "visual_quality",
    reason: "商品标签需要重新核对", targetUpstreamStage: "video_plan" });

  const app = await buildApp({
    root,
    executor: createFakeExecutor(),
    identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin], cookieSecure: false, seed: { enabled: false } },
    workDelivery: { enabled: true, service }
  });
  try { await app.listen({ host: "127.0.0.1", port }); }
  catch (error) { await app.close(); if (error.code === "EPERM") return t.skip("sandbox disallows local TCP listening"); throw error; }
  t.after(() => app.close());

  const browser = await launchBrowser(t);
  if (!browser) return;
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${origin}/login.html`);
  await page.getByLabel("工作邮箱").fill("post-stage-works@example.test");
  await page.getByLabel("密码", { exact: true }).fill("Temporary-Post-Stage-Works-9!");
  await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("Post-Stage-Works-Password-9!");
  await page.getByRole("button", { name: "保存并进入工作台" }).click();
  await page.waitForURL(`${origin}/`);

  await page.goto(`${origin}/works.html`);
  await page.getByText("第 1–6 项，共 9 项", { exact: true }).waitFor();
  assert.equal(await page.locator("#worksList .work-list-item").count(), 6);
  assert.deepEqual(await page.locator("#worksList .work-list-item").evaluateAll((items) => items.map((item) => item.dataset.workId)),
    ["work-post-9", "work-post-8", "work-post-7", "work-post-6", "work-post-5", "work-post-4"]);
  assert.equal((await page.locator("#selectedWorkName").textContent()).trim(), "验收商品 9");
  assert.equal((await page.locator("#sourceSnapshotGrid").innerText()).includes("private-asset-version"), false);

  const assertUniqueRecommended = async (workId, expectedSelector) => {
    await page.locator(`#worksList [data-work-id="${workId}"]`).click();
    await page.waitForFunction((id) => new URL(location.href).searchParams.get("work") === id, workId);
    assert.equal(await page.locator(`#worksList [data-work-id="${workId}"]`).evaluate((node) => node === document.activeElement), true);
    assert.equal(await page.locator('#mainContent [data-recommended-action="true"]').count(), 1);
    assert.equal(await page.locator(expectedSelector).getAttribute("data-recommended-action"), "true");
  };
  await assertUniqueRecommended("work-post-8", "#recordDelivery");
  await assertUniqueRecommended("work-post-7", "#viewDeliveryHistory");
  await assertUniqueRecommended("work-post-6", "#upstreamActionLink");
  await assertUniqueRecommended("work-post-5", "#passInspection");

  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.getByText("第 7–9 项，共 9 项", { exact: true }).waitFor();
  assert.equal(await page.locator('#worksPageNumbers [data-page="2"]').evaluate((node) => node === document.activeElement), true);
  assert.equal(await page.locator("#worksList .work-list-item").count(), 3);
  assert.equal(new URL(page.url()).searchParams.get("page"), "2");
  await page.goBack();
  await page.getByText("第 1–6 项，共 9 项", { exact: true }).waitFor();
  assert.equal(await page.locator("#worksList .work-list-item").count(), 6);

  await page.goto(`${origin}/works.html?work=work-post-2`);
  await page.getByText("第 7–9 项，共 9 项", { exact: true }).waitFor();
  assert.equal(new URL(page.url()).searchParams.get("page"), "2");
  assert.equal((await page.locator("#selectedWorkName").textContent()).trim(), "验收商品 2");
  await page.locator('#worksList [data-work-id="work-post-1"]').click();
  await page.locator("#selectedWorkName").filter({ hasText: "验收商品 1" }).waitFor();
  await page.goBack();
  await page.locator("#selectedWorkName").filter({ hasText: "验收商品 2" }).waitFor();
  await page.goForward();
  await page.locator("#selectedWorkName").filter({ hasText: "验收商品 1" }).waitFor();

  await page.goto(`${origin}/works.html`);
  await page.getByText("第 1–6 项，共 9 项", { exact: true }).waitFor();

  await page.locator("#deliveryFilter").selectOption("delivered");
  await page.getByText("第 1–1 项，共 1 项", { exact: true }).waitFor();
  assert.equal(await page.locator("#worksList .work-list-item").count(), 1);
  assert.equal(await page.locator("#worksList .work-list-item").getAttribute("data-work-id"), "work-post-7");
  assert.equal(new URL(page.url()).searchParams.get("deliveryStatus"), "delivered");
  assert.equal(new URL(page.url()).searchParams.has("work"), false);

  await page.goto(`${origin}/works.html?work=${hiddenWork.id}`);
  await page.getByText("指定作品不可查看，未选择其他作品。", { exact: true }).waitFor();
  assert.equal(await page.locator("#workDetail").isVisible(), false);
  assert.equal(await page.locator("#passInspection").isDisabled(), true);
  assert.equal(await page.locator("#requestRework").isDisabled(), true);
  assert.equal(await page.locator("#recordDelivery").isDisabled(), true);
  assert.equal((await page.locator("body").innerText()).includes("org-hidden"), false);
  assert.equal(new URL(page.url()).searchParams.has("work"), false);

  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto(`${origin}/works.html`);
  await page.getByText("第 1–6 项，共 9 项", { exact: true }).waitFor();
  assert.equal(await page.locator("#worksList").isVisible(), true);
  assert.equal(await page.locator("#workDetail").isVisible(), false);
  const tabletSource = page.locator('#worksList [data-work-id="work-post-8"]');
  await tabletSource.click();
  assert.equal(await page.locator("#workDetail").isVisible(), true);
  assert.equal(await page.locator("#selectedWorkName").evaluate((node) => node === document.activeElement), true);
  await page.getByRole("button", { name: /返回作品列表/ }).click();
  assert.equal(await tabletSource.evaluate((node) => node === document.activeElement), true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/works.html`);
  await page.getByText("第 1–6 项，共 9 项", { exact: true }).waitFor();
  assert.equal(await page.locator("#worksList").isVisible(), true);
  assert.equal(await page.locator("#workDetail").isVisible(), false);
  const mobileSource = page.locator('#worksList [data-work-id="work-post-8"]');
  await mobileSource.click();
  assert.equal(await page.locator("#workDetail").isVisible(), true);
  assert.equal(await page.locator("#selectedWorkName").evaluate((node) => node === document.activeElement), true);
  assert.equal(new URL(page.url()).searchParams.get("work"), "work-post-8");
  await page.getByRole("button", { name: /返回作品列表/ }).click();
  assert.equal(await page.locator("#worksList").isVisible(), true);
  assert.equal(await mobileSource.evaluate((node) => node === document.activeElement), true);
  assert.equal(new URL(page.url()).searchParams.has("work"), false);
  assert.equal(await page.locator('#mainContent [data-recommended-action="true"]').count(), 1);
  assert.equal(await page.locator("#mobilePrimaryAction").getAttribute("data-recommended-action"), "true");
  assert.equal(await page.locator("#mobilePrimaryAction").isVisible(), true);

  let releaseOldList;
  let signalOldList;
  const oldListStarted = new Promise((resolve) => { signalOldList = resolve; });
  const oldListGate = new Promise((resolve) => { releaseOldList = resolve; });
  let heldOldList = false;
  await page.route("**/api/works?*", async (route) => {
    const url = new URL(route.request().url());
    if (!heldOldList && url.pathname === "/api/works" && url.searchParams.get("deliveryStatus") === "all") {
      heldOldList = true;
      const response = await route.fetch();
      signalOldList();
      await oldListGate;
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/works.html`);
  await oldListStarted;
  await page.locator("#deliveryFilter").selectOption("delivered");
  await page.getByText("第 1–1 项，共 1 项", { exact: true }).waitFor();
  releaseOldList();
  await page.waitForTimeout(50);
  assert.equal(await page.locator("#worksList .work-list-item").count(), 1);
  assert.equal(await page.locator("#worksList .work-list-item").getAttribute("data-work-id"), "work-post-7");
  assert.equal(new URL(page.url()).searchParams.get("deliveryStatus"), "delivered");
  await page.unroute("**/api/works?*");

  await page.goto(`${origin}/works.html`);
  await page.getByText("第 1–6 项，共 9 项", { exact: true }).waitFor();
  await page.locator('#worksList [data-work-id="work-post-5"]').click();
  let releaseOldPreview;
  let signalOldPreview;
  const oldPreviewStarted = new Promise((resolve) => { signalOldPreview = resolve; });
  const oldPreviewGate = new Promise((resolve) => { releaseOldPreview = resolve; });
  let heldOldPreview = false;
  await page.route("**/api/works/*/download-authorizations", async (route) => {
    const url = new URL(route.request().url());
    if (!heldOldPreview && url.pathname.includes("work-post-5")) {
      heldOldPreview = true;
      const response = await route.fetch();
      signalOldPreview();
      await oldPreviewGate;
      await route.fulfill({ response });
      return;
    }
    await route.continue();
  });
  await page.locator("#previewWork").click();
  await oldPreviewStarted;
  await page.locator('#worksList [data-work-id="work-post-4"]').click();
  await page.locator("#previewWork").click();
  await page.waitForFunction(() => document.querySelector("#workVideo")?.dataset.workId === "work-post-4");
  releaseOldPreview();
  await page.waitForTimeout(50);
  assert.equal(await page.locator("#workVideo").getAttribute("data-work-id"), "work-post-4");
  assert.equal((await page.locator("#downloadWork").getAttribute("href")).includes("work-post-4"), true);
  await page.unroute("**/api/works/*/download-authorizations");

  await page.locator('#worksList [data-work-id="work-post-5"]').click();
  await page.locator("#requestRework").click();
  await page.waitForFunction(() => document.activeElement?.id === "reworkCategory");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#reworkDialog").evaluate((node) => node.open), false);
  assert.equal(await page.locator("#requestRework").evaluate((node) => node === document.activeElement), true);
  await page.locator("#passInspection").click();
  await page.waitForFunction(() => document.activeElement?.id === "passDialogTitle");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#passInspection").evaluate((node) => node === document.activeElement), true);

  await page.locator("#requestRework").click();
  await page.locator("#reworkCategory").selectOption("visual_quality");
  await page.locator("#reworkReason").fill("409 后仍需保留的返工原因");
  await page.locator("#reworkTarget").selectOption("video_plan");
  const workFiveBeforeConflict = await service.getWork({ ...actor, workId: "work-post-5" });
  await service.markDeliverable({ ...actor, workId: "work-post-5", idempotencyKey: "external-pass-five",
    expectedInspectionId: workFiveBeforeConflict.current_inspection.id,
    expectedRevision: workFiveBeforeConflict.current_inspection.revision });
  await page.locator("#submitRework").click();
  await page.locator("#reloadReworkState").waitFor({ state: "visible" });
  assert.equal(await page.locator("#reworkReason").inputValue(), "409 后仍需保留的返工原因");
  assert.equal(await page.locator("#reworkCategory").inputValue(), "visual_quality");
  assert.equal(await page.locator("#reworkTarget").inputValue(), "video_plan");
  await page.locator("#reloadReworkState").click();
  await page.locator("#reworkError").filter({ hasText: "最新作品状态已载入；已填写内容仍保留，请确认后再提交。" }).waitFor();
  assert.equal(await page.locator("#submitRework").isEnabled(), true);
  await page.locator("#submitRework").click();
  await page.locator("#reworkDialog").waitFor({ state: "hidden" });
  await page.getByText("需要返工", { exact: true }).first().waitFor();

  await page.locator('#worksList [data-work-id="work-post-4"]').click();
  await page.locator("#passInspection").click();
  const passIntentKeys = [];
  let rejectFirstPass = true;
  await page.route("**/api/works/work-post-4/inspections/pass", async (route) => {
    passIntentKeys.push(JSON.parse(route.request().postData() || "{}").idempotency_key);
    if (rejectFirstPass) {
      rejectFirstPass = false;
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "WORK_DELIVERY_INSPECTION_CONFLICT" }) });
      return;
    }
    await route.continue();
  });
  await page.locator("#submitPass").click();
  await page.locator("#reloadPassState").waitFor({ state: "visible" });
  await page.locator("#reloadPassState").click();
  await page.locator("#passError").filter({ hasText: "最新作品状态已载入；已填写内容仍保留，请确认后再提交。" }).waitFor();
  assert.equal(await page.locator("#submitPass").isEnabled(), true);
  await page.locator("#submitPass").click();
  await page.locator("#passDialog").waitFor({ state: "hidden" });
  assert.equal(passIntentKeys.length, 2);
  assert.notEqual(passIntentKeys[0], passIntentKeys[1]);
  await page.unroute("**/api/works/work-post-4/inspections/pass");

  await page.getByRole("button", { name: "下一页", exact: true }).click();
  await page.getByText("第 7–9 项，共 9 项", { exact: true }).waitFor();
  await page.locator('#worksList [data-work-id="work-post-3"]').click();
  await page.locator("#passInspection").click();
  const uncertainPassKeys = [];
  let hidePassBeforeCommit = true;
  await page.route("**/api/works/work-post-3/inspections/pass", async (route) => {
    uncertainPassKeys.push(JSON.parse(route.request().postData() || "{}").idempotency_key);
    if (hidePassBeforeCommit) {
      hidePassBeforeCommit = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "PROXY_UNCERTAIN" }) });
      return;
    }
    await route.continue();
  });
  await page.locator("#submitPass").click();
  await page.locator("#reloadPassState").waitFor({ state: "visible" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.locator("#selectedWorkName").filter({ hasText: "验收商品 3" }).waitFor();
  await page.locator("#passInspection").click();
  assert.equal(await page.locator("#reloadPassState").isVisible(), true);
  assert.equal(await page.locator("#submitPass").isDisabled(), true);
  await page.locator("#passForm").evaluate((form) => form.requestSubmit());
  assert.equal(uncertainPassKeys.length, 1);
  await page.locator("#reloadPassState").click();
  await page.locator("#passError").filter({ hasText: "可使用同一操作标识显式重放" }).waitFor();
  await page.locator("#submitPass").click();
  await page.locator("#passDialog").waitFor({ state: "hidden" });
  assert.equal(uncertainPassKeys.length, 2);
  assert.equal(uncertainPassKeys[0], uncertainPassKeys[1]);
  await page.unroute("**/api/works/work-post-3/inspections/pass");

  await page.goto(`${origin}/works.html?work=work-post-8`);
  await page.locator("#selectedWorkName").filter({ hasText: "验收商品 8" }).waitFor();
  await page.locator("#recordDelivery").click();
  await page.locator("#deliveryRecipient").fill("本次验收团队");
  await page.locator("#deliveryNote").fill("不可误认他人写入");
  const ambiguousIntentKeys = [];
  let hideBeforeCommit = true;
  await page.route("**/api/works/work-post-8/deliveries", async (route) => {
    ambiguousIntentKeys.push(JSON.parse(route.request().postData() || "{}").idempotency_key);
    if (hideBeforeCommit) {
      hideBeforeCommit = false;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "PROXY_UNCERTAIN" }) });
      return;
    }
    await route.continue();
  });
  await page.locator("#submitDelivery").click();
  await page.locator("#reloadDeliveryState").waitFor({ state: "visible" });
  const workEightBeforeOther = await service.getWork({ ...actor, workId: "work-post-8" });
  await service.createDelivery({ ...actor, workId: "work-post-8", deliveryMethod: "email",
    recipientReference: "另一位操作人", note: "另一项真实交付", idempotencyKey: "other-actor-delivery-eight",
    expectedInspectionId: workEightBeforeOther.current_inspection.id,
    expectedRevision: workEightBeforeOther.current_inspection.revision });
  await page.locator("#reloadDeliveryState").click();
  await page.locator("#deliveryError").filter({ hasText: "权威状态已载入，但仅凭业务状态无法确认本次写入；可使用同一操作标识显式重放，系统不会创建重复记录。" }).waitFor();
  assert.equal(await page.locator("#deliveryDialog").evaluate((node) => node.open), true);
  assert.equal(await page.locator("#deliveryRecipient").inputValue(), "本次验收团队");
  await page.locator("#submitDelivery").click();
  await page.locator("#deliveryDialog").waitFor({ state: "hidden" });
  assert.deepEqual(ambiguousIntentKeys.length, 2);
  assert.equal(ambiguousIntentKeys[0], ambiguousIntentKeys[1]);
  const workEightAfterReplay = await service.getWork({ ...actor, workId: "work-post-8" });
  assert.deepEqual(workEightAfterReplay.deliveries.map((item) => item.recipient_reference).sort(), ["另一位操作人", "本次验收团队"].sort());
  await page.unroute("**/api/works/work-post-8/deliveries");

  await page.locator("#recordDelivery").click();
  await page.waitForFunction(() => document.activeElement?.id === "deliveryMethod");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#recordDelivery").evaluate((node) => node === document.activeElement), true);
  await page.locator("#recordDelivery").click();
  await page.locator("#deliveryRecipient").fill("验收团队");
  await page.locator("#deliveryNote").fill("服务端已提交但响应被隐藏");
  let deliveryPostCount = 0;
  const deliveryIntentKeys = [];
  const beforeCommittedRecovery = (await service.getWork({ ...actor, workId: "work-post-8" })).delivery_count;
  await page.route("**/api/works/work-post-8/deliveries", async (route) => {
    deliveryPostCount += 1;
    deliveryIntentKeys.push(JSON.parse(route.request().postData() || "{}").idempotency_key);
    if (deliveryPostCount === 1) {
      const response = await route.fetch();
      assert.equal(response.status(), 201);
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "PROXY_RESPONSE_LOST" }) });
      return;
    }
    await route.continue();
  });
  await page.locator("#submitDelivery").click();
  await page.locator("#reloadDeliveryState").waitFor({ state: "visible" });
  assert.equal(await page.locator("#deliveryNote").inputValue(), "服务端已提交但响应被隐藏");
  assert.equal(typeof deliveryIntentKeys[0], "string");
  await page.locator("#reloadDeliveryState").click();
  await page.locator("#deliveryError").filter({ hasText: "权威状态已载入，但仅凭业务状态无法确认本次写入；可使用同一操作标识显式重放，系统不会创建重复记录。" }).waitFor();
  assert.equal(await page.locator("#deliveryDialog").evaluate((node) => node.open), true);
  await page.locator("#submitDelivery").click();
  await page.locator("#deliveryDialog").waitFor({ state: "hidden" });
  assert.equal(deliveryPostCount, 2);
  assert.equal(deliveryIntentKeys[0], deliveryIntentKeys[1]);
  assert.equal([...repository._records.deliveries.values()].filter((item) => item.work_id === "work-post-8").length, beforeCommittedRecovery + 1);
  assert.equal((await page.locator("#selectedDeliveryStatus").textContent()).trim(), "已交付");
  assert.equal(await page.locator("#recordDelivery").isEnabled(), true);
  await page.unroute("**/api/works/work-post-8/deliveries");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/works.html?work=work-post-8`);
  await page.locator("#selectedWorkName").filter({ hasText: "验收商品 8" }).waitFor();
  let failed = false;
  await page.route("**/api/works?*", async (route) => {
    if (!failed && new URL(route.request().url()).pathname === "/api/works") {
      failed = true;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "TEMPORARY_FAILURE" }) });
      return;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.getByText("作品列表读取失败", { exact: false }).waitFor();
  assert.equal(await page.locator("#workDetail").isVisible(), false);
  assert.equal(await page.locator('#mainContent [data-recommended-action="true"]').count(), 1);
  assert.equal(await page.locator("#refreshWorks").getAttribute("data-recommended-action"), "true");
  await page.unroute("**/api/works?*");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/works?*", async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.pagination = { ...body.pagination, page: 5, total_items: 60, total_pages: 10 };
    await route.fulfill({ response, json: body });
  });
  await page.goto(`${origin}/works.html?page=5`);
  await page.getByText(/第 25–\d+ 项，共 60 项/).waitFor();
  const paginationGeometry = await page.locator("#worksPagination").evaluate((nav) => {
    const numbers = nav.querySelector("#worksPageNumbers");
    const previous = nav.querySelector("#previousWorksPage").getBoundingClientRect();
    const next = nav.querySelector("#nextWorksPage").getBoundingClientRect();
    const first = numbers.querySelector("button")?.getBoundingClientRect();
    const last = [...numbers.querySelectorAll("button")].at(-1)?.getBoundingClientRect();
    return { clientWidth: numbers.clientWidth, scrollWidth: numbers.scrollWidth,
      firstLeft: first?.left, previousRight: previous.right, lastRight: last?.right, nextLeft: next.left,
      pageButtons: numbers.querySelectorAll("button").length };
  });
  assert.equal(paginationGeometry.scrollWidth <= paginationGeometry.clientWidth, true, JSON.stringify(paginationGeometry));
  assert.equal(paginationGeometry.firstLeft >= paginationGeometry.previousRight, true, JSON.stringify(paginationGeometry));
  assert.equal(paginationGeometry.lastRight <= paginationGeometry.nextLeft, true, JSON.stringify(paginationGeometry));
  assert.equal(paginationGeometry.pageButtons <= 3, true, JSON.stringify(paginationGeometry));
  await page.unroute("**/api/works?*");

  await page.goto(`${origin}/works.html`);
  await page.getByText("第 1–6 项，共 9 项", { exact: true }).waitFor();
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.getByRole("button", { name: "刷新", exact: true }).click();
    await page.getByText("第 1–6 项，共 9 项", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, `${viewport.width}px overflow`);
    if (viewport.width === 1440) {
      const vertical = await page.evaluate(() => {
        const last = document.querySelector("#worksList .work-list-item:last-child")?.getBoundingClientRect();
        const pagination = document.querySelector("#worksPagination")?.getBoundingClientRect();
        return { lastBottom: last?.bottom, paginationBottom: pagination?.bottom, paginationVisible: Boolean(pagination && pagination.height > 0) };
      });
      assert.equal(vertical.paginationVisible, true, JSON.stringify(vertical));
      assert.equal(vertical.lastBottom <= viewport.height, true, JSON.stringify(vertical));
      assert.equal(vertical.paginationBottom <= viewport.height, true, JSON.stringify(vertical));
    }
  }
  const transitionDuration = await page.locator(".work-list-item").first().evaluate((node) => getComputedStyle(node).transitionDuration);
  assert.equal(transitionDuration.split(",").every((value) => Number.parseFloat(value) <= 0.001), true, transitionDuration);

  const screenshotDir = "/private/tmp/hifly-post-stage-works-screenshots-20260825";
  await mkdir(screenshotDir, { recursive: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const screenshot = path.join(screenshotDir, `works-${viewport.width}x${viewport.height}.png`);
    await page.screenshot({ path: screenshot, fullPage: false });
    assert.deepEqual(pngDimensions(await readFile(screenshot)), viewport);
  }
});
