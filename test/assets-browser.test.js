import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chromium } from "playwright";

import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createMemoryIdentityRepository } from "../src/identity/memory-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { buildApp } from "../src/server/app.js";
import { findAvailablePort } from "../src/server/start.js";
import { ADMIN_EMAIL, ADMIN_TEMP_PASSWORD } from "./helpers/identity-world.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("material center restores verifying and available states after refresh", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-assets-browser-"));
  const imagePath = path.join(root, "browser-product.png");
  await writeFile(imagePath, PNG);
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(56000);
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const identityRepository = createMemoryIdentityRepository();
  await seedInitialAdmin(identityRepository, {
    organizationId: "org_browser_assets", organizationName: "Browser Assets", adminEmail: ADMIN_EMAIL,
    adminDisplayName: "Browser Admin", adminTempPassword: ADMIN_TEMP_PASSWORD
  });
  const app = await buildApp({
    root, executor: createFakeExecutor(),
    identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin], cookieSecure: false, seed: { enabled: false } },
    assets: { enabled: true, repository: createMemoryAssetRepository(), objectStore: createMemoryObjectStore(), worker: { autoStart: false } }
  });
  try { await app.listen({ host: "127.0.0.1", port }); } catch (error) { await app.close(); if (error.code === "EPERM") return t.skip("sandbox disallows local TCP listening"); throw error; }
  t.after(() => app.close());
  let browser;
  try { browser = await chromium.launch({ headless: true, executablePath: process.env.IDENTITY_BROWSER_EXECUTABLE || chromium.executablePath() }); } catch (error) { if (error.message.includes("Executable doesn't exist") || error.message.includes("browserType.launch")) return t.skip("Playwright browser is unavailable"); throw error; }
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`${origin}/login.html`);
  await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("Browser-Assets-Password-9!");
  await page.getByRole("button", { name: "保存并进入工作台" }).click();
  await page.waitForURL(`${origin}/`);
  await page.goto(`${origin}/assets.html`);
  await page.locator("#assetFile").setInputFiles(imagePath);
  await page.getByRole("button", { name: "上传并开始核验" }).click();
  await page.getByText("核验中", { exact: true }).waitFor();
  await page.reload();
  await page.getByText("核验中", { exact: true }).waitFor();
  assert.equal(await page.getByText("核验通过", { exact: true }).count(), 0);
  await app.assets.service.runNextVerificationJob();
  await page.reload();
  await page.getByText("核验通过", { exact: true }).waitFor();
});

test("identity and assets disabled preserve the real browser Playwright workbench", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-assets-off-browser-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(56500);
  const app = await buildApp({ root, executor: createFakeExecutor(), allowedHost: `127.0.0.1:${port}` });
  try { await app.listen({ host: "127.0.0.1", port }); } catch (error) { await app.close(); if (error.code === "EPERM") return t.skip("sandbox disallows local TCP listening"); throw error; }
  t.after(() => app.close());
  let browser;
  try { browser = await chromium.launch({ headless: true, executablePath: process.env.IDENTITY_BROWSER_EXECUTABLE || chromium.executablePath() }); } catch (error) { if (error.message.includes("Executable doesn't exist") || error.message.includes("browserType.launch")) return t.skip("Playwright browser is unavailable"); throw error; }
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.getByRole("heading", { name: "飞影批量工作台" }).waitFor();
  assert.equal(await page.getByText("素材中心", { exact: true }).count(), 0);
  assert.equal(await page.getByText("项目", { exact: true }).count(), 0);
  const runtime = await page.evaluate(async () => await (await fetch("/api/runtime")).json());
  assert.equal(runtime.executionBackend, "playwright");
  assert.equal(runtime.projectContentEnabled, false);
});

test("identity-enabled workbench hides the material center when assets are disabled", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-assets-disabled-browser-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const port = await findAvailablePort(56700);
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const identityRepository = createMemoryIdentityRepository();
  await seedInitialAdmin(identityRepository, {
    organizationId: "org_browser_no_assets", organizationName: "Browser No Assets", adminEmail: ADMIN_EMAIL,
    adminDisplayName: "Browser Admin", adminTempPassword: ADMIN_TEMP_PASSWORD
  });
  const app = await buildApp({
    root, executor: createFakeExecutor(),
    identity: { enabled: true, repository: identityRepository, trustedHosts: [host], trustedOrigins: [origin], cookieSecure: false, seed: { enabled: false } }
  });
  try { await app.listen({ host: "127.0.0.1", port }); } catch (error) { await app.close(); if (error.code === "EPERM") return t.skip("sandbox disallows local TCP listening"); throw error; }
  t.after(() => app.close());
  let browser;
  try { browser = await chromium.launch({ headless: true, executablePath: process.env.IDENTITY_BROWSER_EXECUTABLE || chromium.executablePath() }); } catch (error) { if (error.message.includes("Executable doesn't exist") || error.message.includes("browserType.launch")) return t.skip("Playwright browser is unavailable"); throw error; }
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(`${origin}/login.html`);
  await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.locator("#newPassword").fill("Browser-No-Assets-Password-9!");
  await page.getByRole("button", { name: "保存并进入工作台" }).click();
  await page.waitForURL(`${origin}/`);
  assert.equal(await page.getByText("素材中心", { exact: true }).count(), 0);
  assert.equal(await page.evaluate(async () => (await (await fetch("/api/runtime")).json()).assetsEnabled), false);
});
