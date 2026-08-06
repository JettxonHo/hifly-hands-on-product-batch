import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createMemoryIdentityRepository } from "../../src/identity/memory-identity-repository.js";
import { seedInitialAdmin } from "../../src/identity/seed-admin.js";
import { createFakeExecutor } from "../../src/executors/fake-executor.js";
import { buildApp } from "../../src/server/app.js";

export const IDENTITY_HOST = "app.test";
export const IDENTITY_ORIGIN = "https://app.test";
export const ADMIN_EMAIL = "admin@example.test";
export const ADMIN_TEMP_PASSWORD = "Temporary-Admin-9!";

export async function seededRepository() {
  const repository = createMemoryIdentityRepository();
  await seedInitialAdmin(repository, {
    organizationId: "org_test",
    organizationName: "Test Organization",
    adminEmail: ADMIN_EMAIL,
    adminDisplayName: "Test Admin",
    adminTempPassword: ADMIN_TEMP_PASSWORD
  }, { now: () => Date.parse("2026-08-06T00:00:00.000Z") });
  return repository;
}

export function cookieJar(setCookie) {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie];
  return values.filter(Boolean).map((value) => value.split(";", 1)[0]).join("; ");
}

export function cookieValue(cookies, name) {
  const part = cookies.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
}

export function identityHeaders({ cookies = "", csrf = "", mutation = false } = {}) {
  return {
    host: IDENTITY_HOST,
    ...(cookies ? { cookie: cookies } : {}),
    ...(mutation ? { origin: IDENTITY_ORIGIN, "content-type": "application/json", "x-identity-csrf": csrf } : {})
  };
}

export async function identityApp(t, { repository = null, seed = true, cookieSecure = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-identity-api-"));
  const repo = repository || createMemoryIdentityRepository();
  const app = await buildApp({
    root,
    executor: createFakeExecutor(),
    identity: {
      enabled: true,
      repository: repo,
      trustedHosts: [IDENTITY_HOST],
      trustedOrigins: [IDENTITY_ORIGIN],
      cookieSecure,
      seed: seed ? {
        enabled: true,
        organizationId: "org_test",
        organizationName: "Test Organization",
        adminEmail: ADMIN_EMAIL,
        adminDisplayName: "Test Admin",
        adminTempPassword: ADMIN_TEMP_PASSWORD
      } : { enabled: false }
    }
  });
  t.after(() => app.close());
  return { app, repository: repo, root };
}

export async function intent(app) {
  const response = await app.inject({ method: "GET", url: "/api/auth/intent", headers: identityHeaders() });
  const body = response.json();
  return { response, body, cookies: cookieJar(response.headers["set-cookie"]), csrf: body.csrf_token };
}

export async function login(app, { email = ADMIN_EMAIL, password = ADMIN_TEMP_PASSWORD } = {}) {
  const auth = await intent(app);
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true }),
    payload: { email, password }
  });
  return { ...auth, response, body: response.json() };
}

export async function activateAdmin(app, newPassword = "New-Admin-Password-9!") {
  const auth = await login(app);
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/change-password",
    headers: identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true }),
    payload: { new_password: newPassword }
  });
  return { ...auth, response, body: response.json(), newPassword };
}
