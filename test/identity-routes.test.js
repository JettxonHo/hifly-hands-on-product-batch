import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { buildApp } from "../src/server/app.js";
import { createMemoryIdentityRepository } from "../src/identity/memory-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import {
  ADMIN_EMAIL,
  ADMIN_TEMP_PASSWORD,
  activateAdmin,
  identityApp,
  identityHeaders,
  intent,
  login
} from "./helpers/identity-world.js";

test("identity disabled preserves legacy local workbench behavior", async (t) => {
  const app = await buildApp({ root: await mkdtemp(path.join(os.tmpdir(), "hifly-local-")), executor: createFakeExecutor() });
  t.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/api/session", headers: { host: "127.0.0.1:4317" } });
  assert.equal(response.statusCode, 200);
});

test("identity-enabled startup fails closed without PostgreSQL or injected repository", async () => {
  await assert.rejects(buildApp({
    root: "/tmp/hifly-no-db",
    executor: createFakeExecutor(),
    identity: { enabled: true, trustedHosts: ["app.test"], trustedOrigins: ["https://app.test"] }
  }), { code: "IDENTITY_DATABASE_URL_REQUIRED" });
});

test("cloud security rejects untrusted host and origin", async (t) => {
  const { app } = await identityApp(t);
  assert.equal((await app.inject({ method: "GET", url: "/login.html", headers: { host: "evil.test" } })).statusCode, 403);
  const auth = await intent(app);
  const response = await app.inject({
    method: "POST", url: "/api/auth/login",
    headers: { host: "app.test", origin: "https://evil.test", cookie: auth.cookies, "content-type": "application/json", "x-identity-csrf": auth.csrf },
    payload: { email: ADMIN_EMAIL, password: ADMIN_TEMP_PASSWORD }
  });
  assert.equal(response.statusCode, 403);
});

test("forced password change blocks organization APIs and never trusts client member or organization ids", async (t) => {
  const { app } = await identityApp(t);
  const auth = await login(app);
  assert.equal(auth.response.statusCode, 200);
  assert.equal(auth.body.status, "password_change_required");
  const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().status, "password_change_required");
  assert.equal("organization" in me.json(), false);
  const blocked = await app.inject({ method: "GET", url: "/api/runtime", headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(blocked.statusCode, 403);
  assert.equal(blocked.json().error, "PASSWORD_CHANGE_REQUIRED");
  const changed = await app.inject({
    method: "POST", url: "/api/auth/change-password",
    headers: identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true }),
    payload: { member_id: "attacker", organization_id: "other", new_password: "Permanent-Password-9!" }
  });
  assert.equal(changed.statusCode, 200);
  assert.equal(changed.json().organization.id, "org_test");
});

test("public auth allowlist is exact and mutation CSRF is per session", async (t) => {
  const { app } = await identityApp(t);
  const unknown = await app.inject({ method: "POST", url: "/api/auth/not-a-route", headers: identityHeaders({ mutation: true }), payload: {} });
  assert.equal(unknown.statusCode, 401);
  const auth = await intent(app);
  const missing = await app.inject({ method: "POST", url: "/api/auth/login", headers: { host: "app.test", origin: "https://app.test", cookie: auth.cookies, "content-type": "application/json" }, payload: {} });
  assert.equal(missing.statusCode, 403);
  assert.equal(missing.json().error, "CSRF_REQUIRED");
});

test("admin creates, lists, resets and disables a member with optimistic concurrency", async (t) => {
  const { app, repository } = await identityApp(t);
  const admin = await activateAdmin(app);
  const headers = identityHeaders({ cookies: admin.cookies, csrf: admin.csrf, mutation: true });
  const createdResponse = await app.inject({
    method: "POST", url: "/api/identity/members", headers,
    payload: { email: "member@example.test", display_name: "Member", role: "member", organization_id: "attacker" }
  });
  assert.equal(createdResponse.statusCode, 201);
  const created = createdResponse.json();
  assert.match(created.temporary_password, /^Tmp-/);
  assert.equal(created.member.status, "pending_activation");
  const stored = JSON.stringify(repository.snapshot());
  assert.equal(stored.includes(created.temporary_password), false);

  const reset = await app.inject({
    method: "POST", url: `/api/identity/members/${created.member.id}/reset-password`, headers,
    payload: { expected_revision: created.member.revision_number }
  });
  assert.equal(reset.statusCode, 200);
  const afterReset = reset.json();
  const staleDisable = await app.inject({
    method: "POST", url: `/api/identity/members/${created.member.id}/disable`, headers,
    payload: { expected_revision: created.member.revision_number }
  });
  assert.equal(staleDisable.statusCode, 409);
  const disabled = await app.inject({
    method: "POST", url: `/api/identity/members/${created.member.id}/disable`, headers,
    payload: { expected_revision: afterReset.member.revision_number }
  });
  assert.equal(disabled.statusCode, 200);
  const resetDisabled = await app.inject({
    method: "POST", url: `/api/identity/members/${created.member.id}/reset-password`, headers,
    payload: { expected_revision: disabled.json().member.revision_number }
  });
  assert.equal(resetDisabled.statusCode, 403);
  assert.equal(resetDisabled.json().error, "ACCOUNT_UNAVAILABLE");
});

test("ordinary member cannot use administrator APIs", async (t) => {
  const repository = createMemoryIdentityRepository();
  const { app } = await identityApp(t, { repository });
  const admin = await activateAdmin(app);
  const adminHeaders = identityHeaders({ cookies: admin.cookies, csrf: admin.csrf, mutation: true });
  const created = (await app.inject({ method: "POST", url: "/api/identity/members", headers: adminHeaders, payload: { email: "user@example.test", display_name: "User", role: "member" } })).json();
  const memberAuth = await login(app, { email: "user@example.test", password: created.temporary_password });
  const changed = await app.inject({ method: "POST", url: "/api/auth/change-password", headers: identityHeaders({ cookies: memberAuth.cookies, csrf: memberAuth.csrf, mutation: true }), payload: { new_password: "Member-Password-9!" } });
  assert.equal(changed.statusCode, 200);
  const forbidden = await app.inject({ method: "GET", url: "/api/identity/members", headers: identityHeaders({ cookies: memberAuth.cookies }) });
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.json().error, "ADMIN_REQUIRED");

  const listed = (await app.inject({ method: "GET", url: "/api/identity/members", headers: identityHeaders({ cookies: admin.cookies }) })).json().members;
  const target = listed.find((entry) => entry.id === created.member.id);
  assert.equal("current_password_credential_id" in target, false);
  const disabled = await app.inject({
    method: "POST", url: `/api/identity/members/${target.id}/disable`, headers: adminHeaders,
    payload: { expected_revision: target.revision_number }
  });
  assert.equal(disabled.statusCode, 200);
  assert.equal("current_password_credential_id" in disabled.json().member, false);
  const denied = await app.inject({ method: "GET", url: "/api/runtime", headers: identityHeaders({ cookies: memberAuth.cookies }) });
  assert.equal(denied.statusCode, 401);
  const repeated = await app.inject({
    method: "POST", url: `/api/identity/members/${target.id}/disable`, headers: adminHeaders,
    payload: { expected_revision: target.revision_number }
  });
  assert.equal(repeated.statusCode, 200);
  const audits = await repository.listAuditEvents();
  assert.equal(audits.filter((event) => event.type === "identity.member_disabled" && event.subject_member_id === target.id).length, 1);
});

test("administrator commands treat a member from another organization as missing", async (t) => {
  const repository = createMemoryIdentityRepository();
  const { app } = await identityApp(t, { repository });
  const other = await seedInitialAdmin(repository, {
    organizationId: "org_other",
    organizationName: "Other Organization",
    adminEmail: "other-admin@example.test",
    adminDisplayName: "Other Admin",
    adminTempPassword: "Other-Temporary-9!"
  });
  const admin = await activateAdmin(app);

  const response = await app.inject({
    method: "POST",
    url: `/api/identity/members/${other.member.id}/disable`,
    headers: identityHeaders({ cookies: admin.cookies, csrf: admin.csrf, mutation: true }),
    payload: { expected_revision: other.member.revision_number }
  });

  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, "MEMBER_NOT_FOUND");
});

test("resetting an active member requires a new password without reversing lifecycle", async (t) => {
  const { app } = await identityApp(t);
  const admin = await activateAdmin(app);
  const adminHeaders = identityHeaders({ cookies: admin.cookies, csrf: admin.csrf, mutation: true });
  const created = (await app.inject({
    method: "POST", url: "/api/identity/members", headers: adminHeaders,
    payload: { email: "active@example.test", display_name: "Active Member", role: "member" }
  })).json();
  const memberAuth = await login(app, { email: "active@example.test", password: created.temporary_password });
  const changed = await app.inject({
    method: "POST", url: "/api/auth/change-password",
    headers: identityHeaders({ cookies: memberAuth.cookies, csrf: memberAuth.csrf, mutation: true }),
    payload: { new_password: "Active-Member-Password-9!" }
  });
  assert.equal(changed.statusCode, 200);

  const target = (await app.inject({
    method: "GET", url: "/api/identity/members", headers: identityHeaders({ cookies: admin.cookies })
  })).json().members.find((member) => member.id === created.member.id);
  const reset = await app.inject({
    method: "POST", url: `/api/identity/members/${target.id}/reset-password`, headers: adminHeaders,
    payload: { expected_revision: target.revision_number }
  });

  assert.equal(reset.statusCode, 200);
  assert.equal(reset.json().member.status, "active");
  assert.equal(reset.json().member.requires_password_change, true);
  assert.equal((await app.inject({
    method: "GET", url: "/api/runtime", headers: identityHeaders({ cookies: memberAuth.cookies })
  })).statusCode, 401);
});

test("logout revokes the server session and clears both cookies", async (t) => {
  const { app } = await identityApp(t);
  const auth = await activateAdmin(app);
  const response = await app.inject({ method: "POST", url: "/api/auth/logout", headers: identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true }), payload: {} });
  assert.equal(response.statusCode, 200);
  const values = response.headers["set-cookie"];
  assert.equal(Array.isArray(values), true);
  assert.ok(values.every((value) => value.includes("Max-Age=0")));
  const me = await app.inject({ method: "GET", url: "/api/auth/me", headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(me.statusCode, 401);
});
