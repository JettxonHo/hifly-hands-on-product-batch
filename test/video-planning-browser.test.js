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
import { createMemoryVideoPlanningRepository } from "../src/video-planning/memory-video-planning-repository.js";
import { ADMIN_EMAIL, ADMIN_TEMP_PASSWORD } from "./helpers/identity-world.js";

test("video plan workspace creates, preflights, reviews, restores, and remains responsive", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-plan-browser-")); t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(57800), host = `127.0.0.1:${port}`, origin = `http://${host}`;
  const identityRepository = createMemoryIdentityRepository();
  const seeded = await seedInitialAdmin(identityRepository, { organizationId: "org-plan-browser", organizationName: "星桥方案工作台",
    adminEmail: ADMIN_EMAIL, adminDisplayName: "方案运营", adminTempPassword: ADMIN_TEMP_PASSWORD });
  const app = await buildApp({ root, executor: createFakeExecutor(),
    identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin], cookieSecure: false, seed: { enabled: false } },
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort: { async bindAvailableVersion(input) { return { reference: input }; } } },
    videoPlanning: { enabled: true, repository: createMemoryVideoPlanningRepository(), worker: { autoStart: true, pollIntervalMs: 20 },
      upstreamPort: { async resolveCurrent({ productId }) { return productId === product.id ? { product_revision_id: revision.id,
        copy_version_id: "copy-approved", avatar_selection_id: "selection-confirmed", avatar_asset_version_id: "avatar-version",
        current_valid: true } : null; } },
      capabilitySnapshotPort: { async resolve() { return { snapshot_version: "verified-v1",
        verified_capabilities: [{ code: "mandarin_speech", evidence_reference: "seed:mandarin" }] }; } },
      agentReadinessPort: { async isOnline() { return false; } } }
  });
  const project = await app.projectContent.service.createProject({ organizationId: "org-plan-browser", actorMemberId: seeded.member.id,
    idempotencyKey: "plan-browser-project", name: "秋季视频方案" });
  const { product, revision } = await app.projectContent.service.createProduct({ organizationId: "org-plan-browser", actorMemberId: seeded.member.id,
    projectId: project.id, idempotencyKey: "plan-browser-product", productName: "云感保湿乳" });
  const { product: secondProduct } = await app.projectContent.service.createProduct({ organizationId: "org-plan-browser",
    actorMemberId: seeded.member.id, projectId: project.id, idempotencyKey: "plan-browser-product-two", productName: "轻盈防晒霜" });
  try { await app.listen({ host: "127.0.0.1", port }); }
  catch (error) { await app.close(); if (error.code === "EPERM") return t.skip("sandbox disallows local TCP listening"); throw error; }
  t.after(() => app.close());
  let browser; const executablePath = process.env.IDENTITY_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  try { browser = await chromium.launch({ headless: true, executablePath }); }
  catch (_systemError) { try { browser = await chromium.launch({ headless: true }); } catch (error) { return t.skip(`Chrome/Chromium unavailable: ${error.message}`); } }
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${origin}/login.html`); await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD); await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("Plan-Browser-Password-9!"); await page.getByRole("button", { name: "保存并进入工作台" }).click(); await page.waitForURL(`${origin}/projects.html`);

  let runtimeAttempts = 0;
  let initialPlanBootstrapFailed = false;
  const failRuntimeOnce = async (route) => {
    runtimeAttempts += 1;
    if (!initialPlanBootstrapFailed && new URL(page.url()).pathname === "/plan.html") {
      initialPlanBootstrapFailed = true;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "TEMPORARY_RUNTIME_FAILURE" }) });
      return;
    }
    await route.fallback();
  };
  await page.route("**/api/runtime", failRuntimeOnce);
  await page.goto(`${origin}/plan.html?project=${project.id}&product=${product.id}`);
  const taskSummary = page.getByRole("region", { name: "当前任务" });
  assert.equal(await taskSummary.count(), 1, "Plan should expose the operator task summary in the first screen");
  await taskSummary.getByText("加载失败", { exact: true }).waitFor();
  await page.locator("#refreshPlan[data-recommended-action='true']").click();
  await page.getByRole("heading", { name: "视频方案", exact: true }).waitFor(); await page.getByText("还没有视频方案").waitFor();
  assert.equal(initialPlanBootstrapFailed, true, "The injected failure must target Plan's own initial bootstrap");
  assert.ok(runtimeAttempts >= 2, "Refresh should issue a fresh runtime request after the injected initial failure");
  await page.unroute("**/api/runtime", failRuntimeOnce);
  await taskSummary.getByText("秋季视频方案 · 云感保湿乳", { exact: true }).waitFor();
  await taskSummary.getByText("视频方案 · 4/5", { exact: true }).waitFor();
  await taskSummary.getByText("填写制作说明并创建方案", { exact: true }).waitFor();
  await page.locator("#firstInstructions").fill("竖版种草口播，突出保湿体验与使用场景。"); await page.getByRole("button", { name: "创建视频方案" }).click();
  await page.getByText("方案 v1", { exact: true }).first().waitFor();
  assert.equal(await page.locator("#taskContext").textContent(), "秋季视频方案 · 云感保湿乳");
  assert.doesNotMatch((await taskSummary.textContent()) || "", /copy-app|selectio/,
    "Primary task context must not expose shortened upstream identifiers");
  assert.doesNotMatch((await page.locator("#contextSummary").textContent()) || "", /copy-app|selectio/,
    "Primary product context must not expose shortened upstream identifiers");
  const upstreamCards = page.locator("#upstreamCards .upstream-card");
  assert.deepEqual(await upstreamCards.locator("strong").allTextContents(), ["商品快照", "文案已人工批准", "人物已确认"]);
  assert.doesNotMatch((await page.locator("#upstreamCards").textContent()) || "", /copy-app|selectio/,
    "Upstream cards must not expose shortened upstream identifiers");
  const technicalDetails = page.locator("details.operator-technical-details");
  assert.equal(await technicalDetails.getAttribute("open"), null, "Upstream technical details should remain folded by default");
  await technicalDetails.locator("summary").click();
  for (const [label, value] of [[
    "product_revision_id", revision.id
  ], [
    "copy_version_id", "copy-approved"
  ], [
    "avatar_selection_id", "selection-confirmed"
  ], [
    "avatar_asset_version_id", "avatar-version"
  ]]) {
    assert.equal(await technicalDetails.getByText(label, { exact: true }).count(), 1, `Technical details should label ${label}`);
    assert.equal(await technicalDetails.getByText(value, { exact: true }).count(), 1, `Technical details should preserve ${label}`);
  }
  await technicalDetails.locator("summary").click();
  const decisionTabs = page.getByRole("tablist");
  assert.equal(await decisionTabs.count(), 1, "Plan should expose one decision tablist");
  const tabs = decisionTabs.getByRole("tab");
  assert.equal(await tabs.count(), 2, "Plan should expose preflight and review tabs");
  for (const [tabId, panelId] of [["showPreflight", "preflightPanel"], ["showReview", "reviewPanel"]]) {
    const tab = page.locator(`#${tabId}`), panel = page.locator(`#${panelId}`);
    assert.equal(await tab.getAttribute("aria-controls"), panelId, `${tabId} should point to its panel`);
    assert.equal(await tab.getAttribute("aria-selected"), tabId === "showPreflight" ? "true" : "false");
    assert.equal(await panel.getAttribute("role"), "tabpanel", `${panelId} should be a tabpanel`);
    assert.equal(await panel.getAttribute("aria-labelledby"), tabId, `${panelId} should point back to its tab`);
  }
  assert.equal(await decisionTabs.locator("[role='tab'][tabindex='0']").count(), 1, "Exactly one Plan tab should be the keyboard entry point");
  const assertTabState = async (tabId, panelId, otherTabId, otherPanelId) => {
    assert.equal(await page.locator(`#${tabId}`).getAttribute("aria-selected"), "true");
    assert.equal(await page.locator(`#${otherTabId}`).getAttribute("aria-selected"), "false");
    assert.equal(await page.locator(`#${panelId}`).isVisible(), true);
    assert.equal(await page.locator(`#${otherPanelId}`).isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement?.id), tabId);
    assert.equal(await decisionTabs.locator("[role='tab'][tabindex='0']").count(), 1);
    assert.equal(await decisionTabs.locator("[role='tab'][tabindex='0']").getAttribute("id"), tabId);
  };
  await page.locator("#showReview").click();
  await assertTabState("showReview", "reviewPanel", "showPreflight", "preflightPanel");
  await page.locator("#showReview").press("ArrowLeft");
  await assertTabState("showPreflight", "preflightPanel", "showReview", "reviewPanel");
  await page.locator("#showPreflight").press("ArrowRight");
  await assertTabState("showReview", "reviewPanel", "showPreflight", "preflightPanel");
  await page.locator("#showReview").press("Home");
  await assertTabState("showPreflight", "preflightPanel", "showReview", "reviewPanel");
  await page.locator("#showPreflight").press("End");
  await assertTabState("showReview", "reviewPanel", "showPreflight", "preflightPanel");
  await page.locator("#showPreflight").click();
  await assertTabState("showPreflight", "preflightPanel", "showReview", "reviewPanel");
  await taskSummary.getByText("开始预检", { exact: true }).waitFor();
  assert.equal(await page.locator("#planWorkspace").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length), 3);
  await page.locator("#outputInstructions").fill("尚未保存的新制作说明");
  await taskSummary.getByText("保存草稿", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "开始预检" }).isDisabled(), true);
  await page.getByText("有未保存的修改，请先保存后预检。", { exact: true }).waitFor();
  await page.locator("#productSelector").selectOption(secondProduct.id);
  const unsavedDialog = page.getByRole("dialog", { name: "有未保存的修改" });
  await unsavedDialog.waitFor();
  await unsavedDialog.getByRole("button", { name: "保存并继续" }).waitFor();
  await unsavedDialog.getByRole("button", { name: "放弃修改" }).waitFor();
  await unsavedDialog.getByRole("button", { name: "取消" }).click();
  assert.equal(await page.locator("#productSelector").inputValue(), product.id);
  assert.equal(await page.locator("#outputInstructions").inputValue(), "尚未保存的新制作说明");
  await page.locator("#productSelector").selectOption(secondProduct.id);
  await page.getByRole("dialog", { name: "有未保存的修改" }).getByRole("button", { name: "保存并继续" }).click();
  await page.getByText("还没有视频方案").waitFor();
  await page.locator("#productSelector").selectOption(product.id);
  await page.getByText("方案 v1", { exact: true }).first().waitFor();
  assert.equal(await page.locator("#outputInstructions").inputValue(), "尚未保存的新制作说明");
  await page.getByRole("button", { name: "开始预检" }).click(); await page.getByText("存在提醒", { exact: true }).first().waitFor();
  await page.getByText(/不影响方案审核/).waitFor(); assert.equal(await page.getByText(/预检通过不等于人工批准/).count() > 0, true);
  await taskSummary.getByText("预检已完成，等待人工审核", { exact: true }).waitFor();
  await taskSummary.getByText("提交方案审核", { exact: true }).waitFor();
  assert.equal(await taskSummary.getByText("方案已批准", { exact: true }).count(), 0);

  await page.getByRole("tab", { name: "审核", exact: true }).click(); await page.getByRole("button", { name: "提交方案审核" }).click();
  await page.getByRole("dialog", { name: "提交方案审核" }).getByRole("button", { name: "确认提交" }).click();
  await page.getByText("审核中", { exact: true }).first().waitFor();
  await taskSummary.getByText("方案待人工决策", { exact: true }).waitFor();
  await page.getByRole("button", { name: "批准方案" }).click();
  await page.getByRole("dialog", { name: "批准方案" }).getByRole("button", { name: "确认批准" }).click();
  await page.getByText("已批准", { exact: true }).first().waitFor();
  await taskSummary.getByText("方案已批准", { exact: true }).waitFor();
  await taskSummary.getByText("等待生产工单能力开放", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "创建生产工单尚未开放" }).isDisabled(), true);

  await page.reload(); await page.getByText("已批准", { exact: true }).first().waitFor();
  await page.setViewportSize({ width: 390, height: 844 }); await page.getByRole("button", { name: "方案版本" }).click();
  await page.getByRole("dialog", { name: "方案版本" }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  await page.getByRole("button", { name: "关闭方案版本" }).click();
  const screenshotDir = process.env.SLICE_B_SCREENSHOTS_DIR;
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement?.blur(); });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false,
      `Plan should not overflow at ${viewport.width}px`);
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, `plan-${viewport.width}x${viewport.height}.png`) });
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.ok(await page.locator("button").first().evaluate((node) => parseFloat(getComputedStyle(node).transitionDuration) <= 0.001));
});
