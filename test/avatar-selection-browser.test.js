import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";

import { createMemoryAvatarSelectionRepository } from "../src/avatar-selection/memory-avatar-selection-repository.js";
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
  const seeded = await seedInitialAdmin(identityRepository, { organizationId: "org-avatar-browser", organizationName: "星桥人物工作台",
    adminEmail: ADMIN_EMAIL, adminDisplayName: "人物运营", adminTempPassword: ADMIN_TEMP_PASSWORD });
  const app = await buildApp({ root, executor: createFakeExecutor(),
    identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin], cookieSecure: false, seed: { enabled: false } },
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort: { async bindAvailableVersion(input) { return { reference: input }; } } },
    avatarSelection: { enabled: true, repository: createMemoryAvatarSelectionRepository(), copyApprovalPort: {
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
  const runtimeGate = new Promise((resolve) => { releaseRuntime = resolve; });
  const delayedRuntime = async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    await runtimeGate;
    await route.fulfill({ response, json: { ...body, videoPlanningEnabled: true } });
  };
  await page.route("**/api/runtime", delayedRuntime);
  await page.goto(url);
  for (const selector of ["#planStageLink", "#mobilePlanStageLink", "#nextPlanLink"]) {
    assert.equal(await page.locator(selector).getAttribute("href"), null);
  }
  await page.getByText("视频方案尚未开放", { exact: true }).waitFor();
  releaseRuntime();
  await page.getByRole("heading", { name: "人物与素材" }).waitFor();
  await page.getByText("Phase 1 受控预置", { exact: true }).first().waitFor();
  for (const selector of ["#planStageLink", "#mobilePlanStageLink", "#nextPlanLink"]) {
    assert.match(await page.locator(selector).getAttribute("href"), /^\/plan\.html\?/);
  }
  assert.equal(await page.locator("#avatarWorkspace").evaluate((node) => getComputedStyle(node).gridTemplateColumns.split(" ").length), 3);
  assert.equal(await page.getByText(/推荐/).count(), 0);

  await page.getByRole("button", { name: /能力待核验人物/ }).click();
  await page.getByText("能力未验证，不承诺生产效果。").waitFor();
  assert.equal(await page.locator("#verifiedCapabilities .capability-supported").count(), 0);

  await page.getByRole("button", { name: /林小满/ }).click();
  await page.getByRole("button", { name: "确认此人物" }).click();
  const confirmDialog = page.getByRole("dialog", { name: "确认人物选择" });
  await confirmDialog.getByText("林小满").waitFor();
  await confirmDialog.getByRole("button", { name: "确认选择此人物" }).click();
  await page.getByText("人物已确认。", { exact: true }).waitFor();

  await page.getByRole("button", { name: /周言/ }).click();
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
  await page.getByText("当前文案 copy-sec").waitFor();
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

  const copyMarkup = await readFile(new URL("../web/copy.html", import.meta.url), "utf8");
  assert.match(copyMarkup, /id="mobileAvatarStageLink" href="\/avatar\.html"/);
});
