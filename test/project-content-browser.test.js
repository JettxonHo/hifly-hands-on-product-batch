import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";

import { createAssetService } from "../src/assets/asset-service.js";
import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { createMemoryIdentityRepository } from "../src/identity/memory-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
import { buildApp } from "../src/server/app.js";
import { findAvailablePort } from "../src/server/start.js";
import { ADMIN_EMAIL, ADMIN_TEMP_PASSWORD } from "./helpers/identity-world.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("system Chrome completes and restores the project-content flow", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-project-content-browser-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(56800), host = `127.0.0.1:${port}`, origin = `http://${host}`;
  const identityRepository = createMemoryIdentityRepository();
  const seeded = await seedInitialAdmin(identityRepository, { organizationId: "org_browser_content", organizationName: "Content Browser", adminEmail: ADMIN_EMAIL, adminDisplayName: "Browser Admin", adminTempPassword: ADMIN_TEMP_PASSWORD });
  const assetRepository = createMemoryAssetRepository(), objectStore = createMemoryObjectStore();
  const assetService = createAssetService({ repository: assetRepository, objectStore });
  const authorized = await assetService.createUploadAuthorization({ organizationId: "org_browser_content", actorMemberId: seeded.member.id, idempotencyKey: "browser-asset", filename: "product.png", contentType: "image/png", size: PNG.length, checksumSha256: createHash("sha256").update(PNG).digest("hex") });
  await assetService.uploadObject({ organizationId: "org_browser_content", uploadToken: authorized.upload.token, body: PNG, contentType: "image/png" });
  await assetService.completeUpload({ organizationId: "org_browser_content", actorMemberId: seeded.member.id, uploadSessionId: authorized.upload_session_id, idempotencyKey: "browser-complete" });
  await assetService.runNextVerificationJob();
  const app = await buildApp({ root, executor: createFakeExecutor(), identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin], cookieSecure: false, seed: { enabled: false } }, assets: { enabled: true, repository: assetRepository, objectStore, worker: { autoStart: false } }, projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort: assetService.assetReferencePort } });
  try { await app.listen({ host: "127.0.0.1", port }); } catch (error) { await app.close(); if (error.code === "EPERM") return t.skip("sandbox disallows local TCP listening"); throw error; }
  t.after(() => app.close());
  let browser;
  const systemChrome = process.env.IDENTITY_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  try { browser = await chromium.launch({ headless: true, executablePath: systemChrome }); } catch (error) { return t.skip(`system Chrome unavailable: ${error.message}`); }
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`${origin}/login.html`); await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL); await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD); await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("Browser-Content-Password-9!"); await page.getByRole("button", { name: "保存并进入工作台" }).click(); await page.waitForURL(`${origin}/projects.html`);
  await page.getByRole("link", { name: "项目", exact: true }).click(); await page.getByRole("button", { name: "创建项目" }).click(); await page.getByLabel("项目名称").fill("八月新品"); await page.getByRole("dialog", { name: "创建项目" }).getByRole("button", { name: "创建项目", exact: true }).click(); await page.getByText("打开", { exact: true }).click();
  await page.getByRole("button", { name: "创建商品" }).click(); await page.getByRole("dialog", { name: "创建商品" }).getByLabel("商品名称", { exact: true }).fill("云朵抱枕"); await page.getByRole("dialog", { name: "创建商品" }).getByRole("button", { name: "创建商品", exact: true }).click();
  await page.getByRole("button", { name: "新增卖点" }).click(); await page.locator(".point-row input").fill("柔软亲肤"); await page.getByRole("button", { name: "保存草稿" }).click(); await page.getByText("草稿已保存。").waitFor();
  await page.getByRole("button", { name: "确认", exact: true }).click(); await page.getByText(/已确认。$/).waitFor(); await page.locator("#assetOptions input").check();
  await page.getByRole("button", { name: "设为 Ready" }).click(); await page.getByText("商品快照已 Ready。").waitFor(); assert.match(await page.locator("#revisionState").textContent(), /^已 Ready/);
  const revisionId = new URL(page.url()).searchParams.get("revision");
  assert.ok(revisionId);
  await page.reload(); await page.locator("#revisionState").waitFor(); assert.match(await page.locator("#revisionState").textContent(), /^已 Ready/);
  assert.equal(new URL(page.url()).searchParams.get("revision"), revisionId);
  assert.equal(await page.getByRole("button", { name: "设为 Ready" }).isDisabled(), true);

  await page.route(new RegExp(`/api/product-revisions/${revisionId}$`), (route) => route.fulfill({
    status: 409,
    contentType: "application/json",
    body: JSON.stringify({ error: "PRODUCT_REVISION_CONFLICT" })
  }));
  await page.locator('textarea[name="product_description"]').fill("并发修改");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await page.getByText("页面内容已过期，请刷新后继续。", { exact: true }).waitFor();
  await page.unroute(new RegExp(`/api/product-revisions/${revisionId}$`));
});
