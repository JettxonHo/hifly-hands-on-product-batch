import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createPostgresIdentityRepository } from "../src/identity/postgres-identity-repository.js";
import { createIdentityPool, runIdentityMigrations } from "../src/identity/postgres.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { buildApp } from "../src/server/app.js";
import { ADMIN_EMAIL, ADMIN_TEMP_PASSWORD, IDENTITY_HOST, IDENTITY_ORIGIN, identityHeaders, intent } from "./helpers/identity-world.js";

const connectionString = process.env.IDENTITY_TEST_DATABASE_URL;

test("clean PostgreSQL migration and identity API flow", { skip: !connectionString }, async (t) => {
  const pool = createIdentityPool({ connectionString });
  t.after(() => pool.end());
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  const repository = createPostgresIdentityRepository({ pool });
  await assert.rejects(repository.initialize(), { code: "IDENTITY_SCHEMA_NOT_READY" });
  await runIdentityMigrations(pool);
  await repository.initialize();

  const tables = (await pool.query(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'identity_%' ORDER BY tablename"
  )).rows.map((row) => row.tablename);
  assert.deepEqual(tables, [
    "identity_audit_events",
    "identity_members",
    "identity_memberships",
    "identity_organizations",
    "identity_password_credentials",
    "identity_schema_migrations",
    "identity_sessions"
  ]);

  await seedInitialAdmin(repository, {
    organizationId: "org_pg",
    organizationName: "PostgreSQL Organization",
    adminEmail: ADMIN_EMAIL,
    adminDisplayName: "PostgreSQL Admin",
    adminTempPassword: ADMIN_TEMP_PASSWORD
  });
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-pg-api-"));
  const app = await buildApp({
    root,
    executor: createFakeExecutor(),
    identity: {
      enabled: true,
      repository,
      trustedHosts: [IDENTITY_HOST],
      trustedOrigins: [IDENTITY_ORIGIN],
      cookieSecure: false,
      seed: { enabled: false }
    }
  });
  t.after(() => app.close());

  const auth = await intent(app);
  const signedIn = await app.inject({
    method: "POST", url: "/api/auth/login",
    headers: identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true }),
    payload: { email: ADMIN_EMAIL, password: ADMIN_TEMP_PASSWORD }
  });
  assert.equal(signedIn.statusCode, 200);
  assert.equal(signedIn.json().status, "password_change_required");
  const passwordChangeHeaders = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  const passwordChanges = await Promise.all([
    app.inject({
      method: "POST", url: "/api/auth/change-password", headers: passwordChangeHeaders,
      payload: { new_password: "Postgres-Permanent-A9!" }
    }),
    app.inject({
      method: "POST", url: "/api/auth/change-password", headers: passwordChangeHeaders,
      payload: { new_password: "Postgres-Permanent-B9!" }
    })
  ]);
  const changed = passwordChanges.find((response) => response.statusCode === 200);
  const conflicting = passwordChanges.find((response) => response.statusCode !== 200);
  assert.ok(changed);
  assert.equal(conflicting?.statusCode, 409);
  assert.equal(conflicting?.json().error, "AUTH_INTENT_CONFLICT");
  assert.equal(changed.json().organization.id, "org_pg");
  const replayed = await app.inject({
    method: "POST", url: "/api/auth/login",
    headers: identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true }),
    payload: { email: ADMIN_EMAIL, password: ADMIN_TEMP_PASSWORD }
  });
  assert.equal(replayed.statusCode, 200);
  assert.equal(replayed.json().status, "ok");

  const adminHeaders = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  const created = (await app.inject({
    method: "POST", url: "/api/identity/members", headers: adminHeaders,
    payload: { email: "postgres-member@example.test", display_name: "PostgreSQL Member", role: "member" }
  })).json();
  const memberIntent = await intent(app);
  const memberLogin = await app.inject({
    method: "POST", url: "/api/auth/login",
    headers: identityHeaders({ cookies: memberIntent.cookies, csrf: memberIntent.csrf, mutation: true }),
    payload: { email: "postgres-member@example.test", password: created.temporary_password }
  });
  assert.equal(memberLogin.statusCode, 200);
  assert.equal((await app.inject({
    method: "POST", url: "/api/auth/change-password",
    headers: identityHeaders({ cookies: memberIntent.cookies, csrf: memberIntent.csrf, mutation: true }),
    payload: { new_password: "Postgres-Member-Password-9!" }
  })).statusCode, 200);
  const target = (await app.inject({
    method: "GET", url: "/api/identity/members", headers: identityHeaders({ cookies: auth.cookies })
  })).json().members.find((member) => member.id === created.member.id);
  const reset = await app.inject({
    method: "POST", url: `/api/identity/members/${target.id}/reset-password`, headers: adminHeaders,
    payload: { expected_revision: target.revision_number }
  });
  assert.equal(reset.statusCode, 200);
  assert.equal(reset.json().member.status, "active");
  assert.equal(reset.json().member.requires_password_change, true);

  const credential = await pool.query("SELECT id FROM identity_password_credentials ORDER BY created_at LIMIT 1");
  await assert.rejects(pool.query(
    "UPDATE identity_password_credentials SET password_hash = 'forbidden' WHERE id = $1",
    [credential.rows[0].id]
  ), /immutable/);
  const audit = await pool.query("SELECT metadata::text FROM identity_audit_events");
  assert.equal(JSON.stringify(audit.rows).includes(ADMIN_TEMP_PASSWORD), false);
  assert.equal((await pool.query(
    "SELECT 1 FROM identity_audit_events WHERE event_type = 'identity.sign_in' AND subject_member_id = $1",
    [changed.json().member.id]
  )).rowCount, 1);
});
