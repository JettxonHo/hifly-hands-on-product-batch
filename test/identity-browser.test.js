import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chromium } from "playwright";

import { createMemoryIdentityRepository } from "../src/identity/memory-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { buildApp } from "../src/server/app.js";
import { findAvailablePort } from "../src/server/start.js";
import { ADMIN_EMAIL, ADMIN_TEMP_PASSWORD } from "./helpers/identity-world.js";

test("real browser completes login, forced password change, and logout", { skip: process.env.IDENTITY_BROWSER_SMOKE !== "1" }, async (t) => {
  const port = await findAvailablePort(55000);
  const host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;
  const repository = createMemoryIdentityRepository();
  await seedInitialAdmin(repository, {
    organizationId: "org_browser",
    organizationName: "Browser Organization",
    adminEmail: ADMIN_EMAIL,
    adminDisplayName: "Browser Admin",
    adminTempPassword: ADMIN_TEMP_PASSWORD
  });
  const app = await buildApp({
    root: await mkdtemp(path.join(os.tmpdir(), "hifly-browser-")),
    executor: createFakeExecutor(),
    identity: {
      enabled: true,
      repository,
      trustedHosts: [host],
      trustedOrigins: [origin],
      cookieSecure: false,
      seed: { enabled: false }
    }
  });
  await app.listen({ host: "127.0.0.1", port });
  t.after(() => app.close());
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.IDENTITY_BROWSER_EXECUTABLE || chromium.executablePath()
  });
  t.after(() => browser.close());
  const page = await browser.newPage();

  await page.goto(`${origin}/login.html`);
  await page.getByLabel("工作邮箱").fill(ADMIN_EMAIL);
  await page.getByLabel("密码", { exact: true }).fill(ADMIN_TEMP_PASSWORD);
  await page.getByRole("button", { name: "登录" }).click();
  await page.getByRole("heading", { name: "设置新密码" }).waitFor();
  await page.reload();
  await page.getByRole("heading", { name: "设置新密码" }).waitFor();
  await page.goto(`${origin}/members.html`);
  await page.waitForURL(`${origin}/login.html`);
  await page.getByRole("heading", { name: "设置新密码" }).waitFor();
  await page.locator("#newPassword").fill("Browser-Permanent-9!");
  const passwordResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/auth/change-password"));
  await page.getByRole("button", { name: "保存并进入工作台" }).click();
  const passwordResponse = await passwordResponsePromise;
  assert.equal(passwordResponse.status(), 200);
  await page.waitForURL(`${origin}/`);
  const authenticatedCookies = await page.context().cookies();
  const authenticatedToken = authenticatedCookies.find((cookie) => cookie.name === "hifly_identity")?.value;
  assert.ok(authenticatedToken);
  const logoutResponsePromise = page.waitForResponse((response) => response.url().endsWith("/api/auth/logout"));
  await page.getByRole("button", { name: "退出" }).click();
  const logoutResponse = await logoutResponsePromise;
  assert.equal(logoutResponse.status(), 200);
  const logoutSetCookies = await logoutResponse.headerValues("set-cookie");
  assert.equal(logoutSetCookies.length, 2, JSON.stringify(await logoutResponse.allHeaders()));
  assert.ok(logoutSetCookies.every((value) => value.includes("Max-Age=0")), JSON.stringify(logoutSetCookies));
  await page.waitForURL(`${origin}/login.html`);

  const cookies = await page.context().cookies();
  const anonymousToken = cookies.find((cookie) => cookie.name === "hifly_identity")?.value;
  assert.ok(anonymousToken);
  assert.notEqual(anonymousToken, authenticatedToken);
  assert.equal(await page.evaluate(async () => (await fetch("/api/auth/me")).status), 401);
});
