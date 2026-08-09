import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright";

import { createAssetService } from "../src/assets/asset-service.js";
import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createControlledCopyProvider } from "../src/copy-generation/controlled-provider.js";
import { createMemoryCopyGenerationRepository } from "../src/copy-generation/memory-copy-generation-repository.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { createMemoryIdentityRepository } from "../src/identity/memory-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
import { buildApp } from "../src/server/app.js";
import { findAvailablePort } from "../src/server/start.js";
import { ADMIN_EMAIL, ADMIN_TEMP_PASSWORD } from "./helpers/identity-world.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("copy workspace restores async generation, preserves frozen history, and recovers version conflicts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-copy-browser-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(57400), host = `127.0.0.1:${port}`, origin = `http://${host}`;
  const identityRepository = createMemoryIdentityRepository();
  const seeded = await seedInitialAdmin(identityRepository, { organizationId: "org_copy_browser", organizationName: "Copy Browser", adminEmail: ADMIN_EMAIL, adminDisplayName: "Copy Admin", adminTempPassword: ADMIN_TEMP_PASSWORD });
  const assetRepository = createMemoryAssetRepository(), objectStore = createMemoryObjectStore();
  const assetService = createAssetService({ repository: assetRepository, objectStore });
  const authorized = await assetService.createUploadAuthorization({ organizationId: "org_copy_browser", actorMemberId: seeded.member.id, idempotencyKey: "copy-browser-asset", filename: "product.png", contentType: "image/png", size: PNG.length, checksumSha256: createHash("sha256").update(PNG).digest("hex") });
  await assetService.uploadObject({ organizationId: "org_copy_browser", uploadToken: authorized.upload.token, body: PNG, contentType: "image/png" });
  await assetService.completeUpload({ organizationId: "org_copy_browser", actorMemberId: seeded.member.id, uploadSessionId: authorized.upload_session_id, idempotencyKey: "copy-browser-complete" });
  await assetService.runNextVerificationJob();
  let providerAttempts = 0;
  const provider = createControlledCopyProvider({ async generate({ productRevision }) {
    providerAttempts += 1;
    if (providerAttempts === 1) throw Object.assign(new Error("controlled failure"), { code: "COPY_PROVIDER_TEMPORARY_FAILURE" });
    return { body: `${productRevision.product_name}，${productRevision.selling_points[0].text}。` };
  } });
  const app = await buildApp({
    root, executor: createFakeExecutor(),
    identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin], cookieSecure: false, seed: { enabled: false } },
    assets: { enabled: true, repository: assetRepository, objectStore, worker: { autoStart: false } },
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort: assetService.assetReferencePort },
    copyGeneration: { enabled: true, repository: createMemoryCopyGenerationRepository(), provider, worker: { autoStart: false } }
  });
  try { await app.listen({ host: "127.0.0.1", port }); } catch (error) { await app.close(); if (error.code === "EPERM") return t.skip("sandbox disallows local TCP listening"); throw error; }
  t.after(() => app.close());
  let browser;
  const systemChrome = process.env.IDENTITY_BROWSER_EXECUTABLE || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  try { browser = await chromium.launch({ headless: true, executablePath: systemChrome }); } catch (error) { return t.skip(`system Chrome unavailable: ${error.message}`); }
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`${origin}/login.html`); await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL); await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD); await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("Copy-Browser-Password-9!"); await page.getByRole("button", { name: "保存并进入工作台" }).click(); await page.waitForURL(`${origin}/projects.html`);
  await page.goto(`${origin}/projects.html`); await page.getByRole("button", { name: "创建项目" }).click(); await page.getByLabel("项目名称").fill("文案项目"); await page.getByRole("dialog", { name: "创建项目" }).getByRole("button", { name: "创建项目", exact: true }).click(); await page.getByRole("link", { name: "打开" }).click();
  await page.getByRole("button", { name: "创建商品" }).click(); await page.getByRole("dialog", { name: "创建商品" }).getByLabel("商品名称", { exact: true }).fill("云朵抱枕"); await page.getByRole("dialog", { name: "创建商品" }).getByRole("button", { name: "创建商品", exact: true }).click();
  await page.getByRole("button", { name: "新增卖点" }).click(); await page.locator(".point-row input").fill("柔软亲肤"); await page.getByRole("button", { name: "保存草稿" }).click(); await page.getByText("草稿已保存。").waitFor();
  await page.getByRole("button", { name: "确认", exact: true }).click(); await page.getByText(/已确认。$/).waitFor(); await page.locator("#assetOptions input").check(); await page.getByRole("button", { name: "设为 Ready" }).click(); await page.getByText("商品快照已 Ready。").waitFor();

  await page.getByRole("link", { name: "进入文案与质检" }).click();
  await page.waitForURL(/\/copy\.html\?project=/);
  await page.getByRole("heading", { name: "文案与质检" }).waitFor();
  assert.match(await page.locator("#productFactsLink").getAttribute("href"), /[?&]revision=[^&]+/);
  await page.getByRole("navigation", { name: "项目阶段" }).locator('[aria-current="step"]').waitFor();
  await page.getByRole("button", { name: "生成文案" }).click();
  await page.getByText("文案正在生成，可离开此页面。", { exact: true }).waitFor();
  await page.reload();
  await page.getByText("文案正在生成，可离开此页面。", { exact: true }).waitFor();
  await app.copyGeneration.worker.runNext();
  await page.getByText("文案生成失败，未产生文案版本。可以安全重试。", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "选择文案版本" }).click();
  await page.getByRole("dialog", { name: "选择版本" }).getByRole("button", { name: "重试生成" }).click();
  await page.getByText("文案正在生成，可离开此页面。", { exact: true }).waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await app.copyGeneration.worker.runNext();
  await page.getByRole("textbox", { name: "文案正文" }).waitFor();
  await page.getByRole("textbox", { name: "文案正文" }).fill("人工调整后的第一版文案");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await page.getByText("文案草稿已保存。", { exact: true }).waitFor();

  const csrf = await page.evaluate(() => decodeURIComponent(document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hifly_identity_csrf="))?.split("=").slice(1).join("=") || ""));
  const copies = await page.evaluate(async () => (await fetch(`/api/product-revisions/${new URLSearchParams(location.search).get("revision")}/copy-versions`)).json());
  const first = copies.copy_versions[0];
  const frozenStatus = await page.evaluate(async ({ id, rowVersion, csrfToken }) => (await fetch(`/api/copy-versions/${id}/freeze`, {
    method: "POST", credentials: "same-origin",
    headers: { "content-type": "application/json", "x-identity-csrf": csrfToken, "idempotency-key": "browser-freeze-copy" },
    body: JSON.stringify({ expected_revision: rowVersion })
  })).status, { id: first.id, rowVersion: first.row_version, csrfToken: csrf });
  assert.equal(frozenStatus, 200);
  await page.getByRole("button", { name: "刷新" }).click();
  await page.getByRole("button", { name: /v1.*已冻结/ }).waitFor();
  await page.getByRole("button", { name: "基于此版本修改" }).click();
  await page.getByRole("textbox", { name: "文案正文" }).fill("冻结后形成的新草稿");
  await page.getByRole("button", { name: "保存为新草稿" }).click();
  await page.getByRole("button", { name: /v2.*草稿/ }).waitFor();
  if (process.env.A04_SCREENSHOT_DIR) {
    await mkdir(process.env.A04_SCREENSHOT_DIR, { recursive: true });
    await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement?.blur(); });
    await page.screenshot({ path: path.join(process.env.A04_SCREENSHOT_DIR, "copy-workspace-desktop.png"), fullPage: true });
  }

  const current = (await page.evaluate(async () => (await fetch(`/api/product-revisions/${new URLSearchParams(location.search).get("revision")}/copy-versions`)).json())).copy_versions.at(-1);
  await page.getByRole("textbox", { name: "文案正文" }).fill("我尚未保存的页面修改");
  const remoteEditStatus = await page.evaluate(async ({ id, rowVersion, csrfToken }) => (await fetch(`/api/copy-versions/${id}`, {
    method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json", "x-identity-csrf": csrfToken },
    body: JSON.stringify({ expected_revision: rowVersion, body: "另一位成员先保存的修改" })
  })).status, { id: current.id, rowVersion: current.row_version, csrfToken: csrf });
  assert.equal(remoteEditStatus, 200);
  await page.getByRole("button", { name: "保存草稿" }).click();
  await page.getByText("此内容已被他人更新，你的修改未保存。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "查看最新版本" }).waitFor();
  await page.getByRole("button", { name: "复制我的修改" }).waitFor();
  await page.getByRole("button", { name: "放弃修改" }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "文案正文" }).inputValue(), "我尚未保存的页面修改");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: /当前版本 v2/ }).waitFor();
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  assert.equal(horizontalOverflow, false);
  if (process.env.A04_SCREENSHOT_DIR) {
    await page.evaluate(() => { window.scrollTo(0, 0); document.activeElement?.blur(); });
    await page.screenshot({ path: path.join(process.env.A04_SCREENSHOT_DIR, "copy-workspace-mobile.png"), fullPage: true });
  }
});
