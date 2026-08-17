import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";

import { createMemoryAvatarSelectionRepository } from "../src/avatar-selection/memory-avatar-selection-repository.js";
import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { createMemoryIdentityRepository } from "../src/identity/memory-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
import { buildApp } from "../src/server/app.js";
import { findAvailablePort } from "../src/server/start.js";
import { ADMIN_EMAIL, ADMIN_TEMP_PASSWORD } from "./helpers/identity-world.js";

test("avatar workspace confirms, changes, restores history, and remains responsive without Hifly", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-avatar-browser-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(57700), host = `127.0.0.1:${port}`, origin = `http://${host}`;
  const identityRepository = createMemoryIdentityRepository();
  const avatarRepository = createMemoryAvatarSelectionRepository();
  const seeded = await seedInitialAdmin(identityRepository, { organizationId: "org-avatar-browser", organizationName: "星桥人物工作台",
    adminEmail: ADMIN_EMAIL, adminDisplayName: "人物运营", adminTempPassword: ADMIN_TEMP_PASSWORD });
  const app = await buildApp({ root, executor: createFakeExecutor(),
    identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin], cookieSecure: false, seed: { enabled: false } },
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort: { async bindAvailableVersion(input) { return { reference: input }; } } },
    avatarSelection: { enabled: true, repository: avatarRepository, copyApprovalPort: {
      async getCurrentApprovedCopy({ organizationId, productId, copyVersionId }) {
        const resolved = productId === product.id ? "copy-approved" : productId === secondProduct.id ? "copy-second" : null;
        return organizationId === "org-avatar-browser" && copyVersionId === resolved ?
          { copy_version_id: copyVersionId, product_revision_id: productId === product.id ? revision.id : secondRevision.id, current_valid: true } : null;
      },
      async resolveCurrentApprovedCopy({ organizationId, productId }) {
        if (organizationId !== "org-avatar-browser") return null;
        if (productId === product.id) return { copy_version_id: "copy-approved", product_revision_id: revision.id, current_valid: true };
        if (productId === secondProduct.id) return { copy_version_id: "copy-second", product_revision_id: secondRevision.id, current_valid: true };
        return null;
      }
    } }
  });
  await avatarRepository.syncPublicCatalog({ organizationId: "org-avatar-browser", now: "2026-08-12T00:00:00.000Z",
    entries: [{ provider_key: "hifly-public:browser-001", display_name: "同步公共人物", source_type: "public" }] });
  const project = await app.projectContent.service.createProject({ organizationId: "org-avatar-browser", actorMemberId: seeded.member.id,
    idempotencyKey: "avatar-browser-project", name: "秋季人物选择" });
  const { product, revision } = await app.projectContent.service.createProduct({ organizationId: "org-avatar-browser", actorMemberId: seeded.member.id,
    projectId: project.id, idempotencyKey: "avatar-browser-product", productName: "云感保湿乳" });
  const { product: secondProduct, revision: secondRevision } = await app.projectContent.service.createProduct({
    organizationId: "org-avatar-browser", actorMemberId: seeded.member.id, projectId: project.id,
    idempotencyKey: "avatar-browser-second-product", productName: "轻盈防晒霜" });
  try { await app.listen({ host: "127.0.0.1", port }); }
  catch (error) { await app.close(); if (error.code === "EPERM") return t.skip("sandbox disallows local TCP listening"); throw error; }
  t.after(() => app.close());
  let browser;
  const executablePath = process.env.IDENTITY_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  try { browser = await chromium.launch({ headless: true, executablePath }); }
  catch (_systemError) {
    try { browser = await chromium.launch({ headless: true }); }
    catch (error) { return t.skip(`Chrome/Chromium unavailable: ${error.message}`); }
  }
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${origin}/login.html`); await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD); await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("Avatar-Browser-Password-9!"); await page.getByRole("button", { name: "保存并进入工作台" }).click();
  await page.waitForURL(`${origin}/projects.html`);

  const url = `${origin}/avatar.html?project=${project.id}&product=${product.id}&copy=copy-approved`;
  let releaseRuntime;
  let runtimeAttempts = 0;
  let initialAvatarBootstrapFailed = false;
  const runtimeGate = new Promise((resolve) => { releaseRuntime = resolve; });
  const delayedRuntime = async (route) => {
    runtimeAttempts += 1;
    if (!initialAvatarBootstrapFailed && new URL(page.url()).pathname === "/avatar.html") {
      initialAvatarBootstrapFailed = true;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "TEMPORARY_RUNTIME_FAILURE" }) });
      return;
    }
    const response = await route.fetch();
    const body = await response.json();
    await runtimeGate;
    await route.fulfill({ response, json: { ...body, videoPlanningEnabled: true } });
  };
  await page.route("**/api/runtime", delayedRuntime);
  await page.goto(url);
  const taskSummary = page.getByRole("region", { name: "当前任务" });
  assert.equal(await taskSummary.count(), 1, "Avatar should expose the operator task summary in the first screen");
  await taskSummary.getByText("加载失败", { exact: true }).waitFor();
  await page.locator("#refreshAvatar[data-recommended-action='true']").click();
  for (const selector of ["#planStageLink", "#mobilePlanStageLink", "#nextPlanLink"]) {
    assert.equal(await page.locator(selector).getAttribute("href"), null);
  }
  await page.getByText("视频方案尚未开放", { exact: true }).waitFor();
  releaseRuntime();
  await page.getByRole("heading", { name: "人物与素材" }).waitFor();
  assert.equal(initialAvatarBootstrapFailed, true, "The injected failure must target Avatar's own initial bootstrap");
  assert.ok(runtimeAttempts >= 2, "Refresh should issue a fresh runtime request after the injected initial failure");
  await taskSummary.getByText("秋季人物选择 · 云感保湿乳", { exact: true }).waitFor();
  await taskSummary.getByText("人物 · 3/5", { exact: true }).waitFor();
  await taskSummary.getByText("确认此人物", { exact: true }).waitFor();
  await page.getByText("Phase 1 受控预置", { exact: true }).first().waitFor();
  const visibleBusinessText = await page.evaluate(() => {
    const container = document.createElement("div");
    for (const selector of ["#taskSummary", "#productContext", "#avatarWorkspace"]) {
      const node = document.querySelector(selector);
      if (!node) continue;
      const copy = node.cloneNode(true);
      copy.querySelectorAll("[hidden]").forEach((hidden) => hidden.remove());
      copy.querySelectorAll("details:not([open])").forEach((details) => details.remove());
      container.append(copy);
    }
    return container.textContent;
  });
  assert.doesNotMatch(visibleBusinessText, /copy-app\b/i, "Main business content must not expose a shortened copy version ID");
  assert.doesNotMatch(visibleBusinessText, /avatar_image|Evidence|verified capability|Organization/i,
    "Main business content must not expose internal asset, evidence, capability, or organization labels");
  assert.match(visibleBusinessText, /当前企业/);
  assert.match(visibleBusinessText, /已验证能力/);
  assert.equal(await page.locator("#avatarAuditDetails").getAttribute("open"), null,
    "Technical and audit details must be opt-in and folded by default");
  await page.locator("#avatarAuditDetails > summary").click();
  const auditText = await page.locator("#avatarAuditDetails").innerText();
  assert.match(auditText, /copy-approved/, "Audit details must preserve the full copy version ID");
  assert.match(await page.locator("#avatarAuditAssetId").innerText(), /\S+/,
    "Audit details must preserve the selected avatar asset ID when available");
  assert.match(await page.locator("#avatarAuditAssetVersionId").innerText(), /\S+/,
    "Audit details must preserve the selected avatar version ID");
  assert.match(await page.locator("#avatarAuditCapabilityCode").innerText(), /\S+/,
    "Audit details must preserve the raw capability code when available");
  assert.match(await page.locator("#avatarAuditEvidenceReference").innerText(), /\S+/,
    "Audit details must preserve the evidence reference when available");
  assert.match(await page.locator("#avatarAuditAuthorizationScope").innerText(), /\S+/,
    "Audit details must preserve the authorization scope when available");
  assert.match(await page.locator("#avatarAuditSourceCode").innerText(), /\S+/,
    "Audit details must preserve the source code");
  await page.locator("#avatarAuditDetails > summary").click();
  assert.equal(await page.locator("#factsStageLink").getAttribute("data-stage-state"), "available");
  assert.equal(await page.locator("#copyStageLink").getAttribute("data-stage-state"), "completed");
  assert.equal(await page.locator('.stage-desktop [aria-current="step"]').getAttribute("data-stage-state"), "current");
  assert.equal(await page.locator("#planStageLink").getAttribute("data-stage-state"), "available");
  assert.deepEqual(
    await page.locator(".stage-mobile li").evaluateAll((items) => items.map((item) => item.dataset.stageState)),
    ["available", "completed", "current", "available", "blocked"]
  );
  for (const selector of ["#planStageLink", "#mobilePlanStageLink", "#nextPlanLink"]) {
    assert.match(await page.locator(selector).getAttribute("href"), /^\/plan\.html\?/);
  }
  assert.equal(await page.locator("#avatarWorkspace").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length), 3);
  assert.ok(await page.getByText("推荐", { exact: true }).count() > 0);
  await page.getByText(/未找到商品主品类精确匹配/).first().waitFor();

  await page.getByRole("button", { name: /同步公共人物/ }).click();
  await page.getByText("公共目录", { exact: true }).first().waitFor();
  await page.getByText("能力未验证，不承诺生产效果。").waitFor();
  assert.equal(await page.locator("#verifiedCapabilities .capability-supported").count(), 0);

  await page.getByRole("button", { name: /林小满/ }).click();
  await page.getByRole("button", { name: "确认此人物" }).click();
  const confirmDialog = page.getByRole("dialog", { name: "确认人物选择" });
  await confirmDialog.getByText("林小满").waitFor();
  await confirmDialog.getByRole("button", { name: "确认选择此人物" }).click();
  await page.getByText("人物已确认。", { exact: true }).waitFor();
  await taskSummary.getByText("人物已确认", { exact: true }).waitFor();
  await taskSummary.getByText("进入视频方案", { exact: true }).waitFor();

  await page.getByRole("button", { name: /周言/ }).click();
  await taskSummary.getByText("确认是否更换人物", { exact: true }).waitFor();
  await taskSummary.getByText("更换人物", { exact: true }).waitFor();
  await page.getByRole("button", { name: "更换人物" }).click();
  const changeDialog = page.getByRole("dialog", { name: "更换人物" });
  await changeDialog.getByText(/当前选择保留为历史/).waitFor();
  await changeDialog.getByRole("button", { name: "确认更换人物" }).click();
  await page.getByText("人物已更换，原选择已保留在历史中。", { exact: true }).waitFor();
  await page.reload();
  await page.getByText(/当前选择.*周言/).waitFor();
  await page.getByText(/历史选择（1）/).click();
  await page.locator("#selectionHistory").getByText("林小满").waitFor();

  await page.locator("#productSelector").selectOption(secondProduct.id);
  await page.waitForURL((current) => current.searchParams.get("product") === secondProduct.id && current.searchParams.get("copy") === "copy-second");
  await page.getByText("当前文案已人工批准", { exact: true }).waitFor();
  await taskSummary.getByText("秋季人物选择 · 轻盈防晒霜", { exact: true }).waitFor();
  await taskSummary.getByText("确认此人物", { exact: true }).waitFor();
  await page.getByRole("button", { name: /林小满/ }).click();
  await page.getByRole("button", { name: "确认此人物" }).click();
  await page.getByRole("dialog", { name: "确认人物选择" }).getByRole("button", { name: "确认选择此人物" }).click();
  await page.getByText("人物已确认。", { exact: true }).waitFor();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /人物目录/ }).click();
  await page.getByRole("dialog", { name: "人物目录" }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  await page.getByRole("button", { name: "关闭人物目录" }).click();
  await page.unroute("**/api/runtime", delayedRuntime);
  await page.reload();
  for (const selector of ["#planStageLink", "#mobilePlanStageLink", "#nextPlanLink"]) {
    assert.equal(await page.locator(selector).getAttribute("href"), null);
  }
  await page.getByText("视频方案尚未开放", { exact: true }).waitFor();
  await taskSummary.getByText("等待视频方案能力开放", { exact: true }).waitFor();

  const screenshotDir = process.env.SLICE_B_SCREENSHOTS_DIR;
  if (screenshotDir) await mkdir(screenshotDir, { recursive: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement?.blur(); });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false,
      `Avatar should not overflow at ${viewport.width}px`);
    if (screenshotDir) {
      await page.screenshot({ path: path.join(screenshotDir, `avatar-${viewport.width}x${viewport.height}.png`) });
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.ok(await page.locator("button").first().evaluate((node) => parseFloat(getComputedStyle(node).transitionDuration) <= 0.001));

  const copyMarkup = await readFile(new URL("../web/copy.html", import.meta.url), "utf8");
  assert.match(copyMarkup, /id="mobileAvatarStageLink" href="\/avatar\.html"/);
});

test("avatar admin GUI registers verified material and members remain read-only", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-avatar-admin-browser-"));
  const avatarPath = path.join(root, "avatar.png");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  await writeFile(avatarPath, png);
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(57800), host = `127.0.0.1:${port}`, origin = `http://${host}`;
  const identityRepository = createMemoryIdentityRepository();
  const seeded = await seedInitialAdmin(identityRepository, { organizationId: "org-avatar-admin-browser", organizationName: "管理员人物工作台",
    adminEmail: "avatar-admin-browser@example.test", adminDisplayName: "人物管理员", adminTempPassword: "Temporary-Avatar-Admin-9!" });
  const app = await buildApp({ root, executor: createFakeExecutor(),
    identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin], cookieSecure: false, seed: { enabled: false } },
    assets: { enabled: true, repository: createMemoryAssetRepository(), objectStore: createMemoryObjectStore(), worker: { autoStart: true, pollIntervalMs: 20 } },
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort: { async bindAvailableVersion(input) { return { reference: input }; } } },
    avatarSelection: { enabled: true, repository: createMemoryAvatarSelectionRepository(), copyApprovalPort: {
      async getCurrentApprovedCopy({ copyVersionId }) { return copyVersionId ? { copy_version_id: copyVersionId, product_revision_id: "revision-admin-browser", current_valid: true } : null; },
      async resolveCurrentApprovedCopy() { return { copy_version_id: "copy-admin-browser", product_revision_id: "revision-admin-browser", current_valid: true }; }
    }, productRevisionPort: {
      async getSnapshot({ organizationId, productRevisionId }) {
        return organizationId === "org-avatar-admin-browser" && productRevisionId === "revision-admin-browser" ?
          { organization_id: organizationId, product_id: product.id, primary_category: "美妆" } : null;
      }
    } }
  });
  const project = await app.projectContent.service.createProject({ organizationId: "org-avatar-admin-browser", actorMemberId: seeded.member.id,
    idempotencyKey: "avatar-admin-browser-project", name: "管理员人物项目" });
  const { product } = await app.projectContent.service.createProduct({ organizationId: "org-avatar-admin-browser", actorMemberId: seeded.member.id,
    projectId: project.id, idempotencyKey: "avatar-admin-browser-product", productName: "管理员人物商品" });
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
  await page.goto(`${origin}/login.html`); await page.getByLabel("工作邮箱").fill("avatar-admin-browser@example.test");
  await page.getByLabel("密码", { exact: true }).fill("Temporary-Avatar-Admin-9!"); await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("Avatar-Admin-Browser-9!"); await page.getByRole("button", { name: "保存并进入工作台" }).click();
  await page.waitForURL(`${origin}/projects.html`);
  await page.goto(`${origin}/avatar.html?project=${project.id}&product=${product.id}&copy=copy-admin-browser`);
  await page.locator("#enterpriseAvatarAdmin").waitFor({ state: "visible" });
  await page.locator("#enterpriseAvatarFile").setInputFiles(avatarPath);
  await page.locator("#enterpriseAvatarName").fill("GUI 企业人物"); await page.locator("#enterpriseAvatarDescription").fill("由管理员登记的人物素材");
  await page.getByText("技术选项：能力依据", { exact: true }).click();
  await page.locator("#enterpriseAvatarTags").fill(" 美妆，护肤， 美妆 "); await page.locator("#enterpriseAvatarCapabilityCode").fill("hands_on_product");
  await page.locator("#enterpriseAvatarCapabilityLabel").fill("手持商品图"); await page.locator("#enterpriseAvatarCapabilityEvidence").fill("gui:evidence:1");
  await page.getByRole("button", { name: "上传、核验并登记" }).click();
  await page.getByRole("button", { name: /GUI 企业人物/ }).waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: /GUI 企业人物/ }).click();
  await page.getByText(/可访问 · available/).waitFor(); await page.getByText("美妆、护肤").waitFor();
  await page.getByText("✓ 手持商品图", { exact: true }).waitFor();
  const adminAudit = page.locator("#avatarAuditDetails");
  assert.equal(await adminAudit.getAttribute("open"), null);
  assert.equal(await adminAudit.getByText(/gui:evidence:1/).isVisible(), false);
  await adminAudit.locator("summary").click();
  await adminAudit.getByText(/gui:evidence:1/).waitFor();
  page.once("dialog", (dialog) => dialog.accept()); await page.getByRole("button", { name: "禁用企业人物" }).click();
  await page.getByText("企业人物已禁用；历史选择仍保留。", { exact: true }).waitFor();
  assert.equal(await page.locator("#disableAvatar").isHidden(), true);

  const createdMember = await page.evaluate(async () => {
    const csrf = decodeURIComponent((document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hifly_identity_csrf=")) || "=").split("=").slice(1).join("="));
    const response = await fetch("/api/identity/members", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-identity-csrf": csrf },
      body: JSON.stringify({ email: "avatar-readonly-browser@example.test", display_name: "只读成员", role: "member" }) });
    return response.json();
  });
  const memberPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await memberPage.goto(`${origin}/login.html`); await memberPage.getByLabel("工作邮箱").fill("avatar-readonly-browser@example.test");
  await memberPage.getByLabel("密码", { exact: true }).fill(createdMember.temporary_password); await memberPage.getByRole("button", { name: "登录" }).click();
  await memberPage.locator("#newPassword").fill("Avatar-Readonly-Browser-9!"); await memberPage.getByRole("button", { name: "保存并进入工作台" }).click();
  await memberPage.waitForURL(`${origin}/projects.html`); await memberPage.goto(`${origin}/avatar.html?project=${project.id}&product=${product.id}&copy=copy-admin-browser`);
  await memberPage.locator("#avatarWorkspace").waitFor(); assert.equal(await memberPage.locator("#enterpriseAvatarAdmin").isHidden(), true);
  await memberPage.getByRole("button", { name: /GUI 企业人物/ }).click(); assert.equal(await memberPage.locator("#disableAvatar").isHidden(), true);
  await memberPage.close();
});
