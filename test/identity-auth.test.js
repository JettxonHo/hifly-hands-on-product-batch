import assert from "node:assert/strict";
import test from "node:test";

import { createAuthService } from "../src/identity/auth-service.js";
import { createMemoryIdentityRepository } from "../src/identity/memory-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { seededRepository, ADMIN_EMAIL, ADMIN_TEMP_PASSWORD, cookieValue } from "./helpers/identity-world.js";

async function world() {
  let clock = Date.parse("2026-08-06T01:00:00.000Z");
  const repository = await seededRepository();
  const service = createAuthService({ repository, cookieSecure: true, now: () => clock });
  const intent = await service.createIntent();
  const sessionToken = cookieValue(intent.cookies.join("; "), service.cookieName);
  return { repository, service, intent, sessionToken, advance: (ms) => { clock += ms; } };
}

test("temporary-password sign-in is bound to one restricted server session and is idempotent", async () => {
  const { service, repository, sessionToken } = await world();
  const first = await service.login(sessionToken, ADMIN_EMAIL, ADMIN_TEMP_PASSWORD, { clientKey: "client" });
  const duplicate = await service.login(sessionToken, ADMIN_EMAIL, ADMIN_TEMP_PASSWORD, { clientKey: "client" });
  assert.equal(first.status, "password_change_required");
  assert.equal(duplicate.idempotent, true);
  assert.equal(first.context.session.id, duplicate.context.session.id);
  await assert.rejects(service.login(sessionToken, ADMIN_EMAIL, "different"), { code: "AUTH_INTENT_CONFLICT" });
  const audits = await repository.listAuditEvents();
  assert.equal(audits.filter((event) => event.type === "identity.sign_in").length, 1);
});

test("first password change uses restricted session, activates once, and preserves credential history", async () => {
  const { service, repository, sessionToken } = await world();
  await service.login(sessionToken, ADMIN_EMAIL, ADMIN_TEMP_PASSWORD);
  const first = await service.changePassword(sessionToken, "Permanent-Password-9!");
  const duplicate = await service.changePassword(sessionToken, "Permanent-Password-9!");
  assert.equal(first.context.member.status, "active");
  assert.equal(first.context.session.intent, "authenticated");
  assert.equal(duplicate.idempotent, true);
  await assert.rejects(service.changePassword(sessionToken, "Different-Password-9!"), { code: "AUTH_INTENT_CONFLICT" });
  const snapshot = repository.snapshot();
  assert.equal(snapshot.credentials.length, 2);
  assert.equal(snapshot.audits.filter((event) => event.type === "identity.password_changed").length, 1);
});

test("concurrent first password changes accept one payload and reject the conflicting replay", async () => {
  const { service, repository, sessionToken } = await world();
  await service.login(sessionToken, ADMIN_EMAIL, ADMIN_TEMP_PASSWORD);

  const results = await Promise.allSettled([
    service.changePassword(sessionToken, "Concurrent-Password-A9!"),
    service.changePassword(sessionToken, "Concurrent-Password-B9!")
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected?.reason?.code, "AUTH_INTENT_CONFLICT");
  const snapshot = repository.snapshot();
  assert.equal(snapshot.credentials.length, 2);
  assert.equal(snapshot.audits.filter((event) => event.type === "identity.password_changed").length, 1);
});

test("original sign-in retry remains idempotent after password change", async () => {
  const { service, repository, sessionToken } = await world();
  await service.login(sessionToken, ADMIN_EMAIL, ADMIN_TEMP_PASSWORD);
  await service.changePassword(sessionToken, "Permanent-Password-9!");

  const retried = await service.login(sessionToken, ADMIN_EMAIL, ADMIN_TEMP_PASSWORD);

  assert.equal(retried.status, "ok");
  assert.equal(retried.idempotent, true);
  assert.equal((await repository.listAuditEvents()).filter((event) => event.type === "identity.sign_in").length, 1);
});

test("password change rechecks membership after temporary-password login", async () => {
  const { service, repository, sessionToken } = await world();
  const signedIn = await service.login(sessionToken, ADMIN_EMAIL, ADMIN_TEMP_PASSWORD);
  await repository.testingSetMembershipStatus(signedIn.context.member.id, "unavailable");

  await assert.rejects(
    service.changePassword(sessionToken, "Permanent-Password-9!"),
    { code: "NO_ACTIVE_MEMBERSHIP" }
  );

  const snapshot = repository.snapshot();
  assert.equal(snapshot.members[0].status, "pending_activation");
  assert.equal(snapshot.credentials.length, 1);
  assert.equal(snapshot.audits.filter((event) => event.type === "identity.password_changed").length, 0);
});

test("unknown and known emails return the same public credential error", async () => {
  for (const email of ["unknown@example.test", ADMIN_EMAIL]) {
    const { service, sessionToken } = await world();
    await assert.rejects(service.login(sessionToken, email, "wrong-password"), { code: "AUTH_INVALID_CREDENTIALS" });
  }
});

test("session cookies are Secure by default and raw tokens are never persisted", async () => {
  const { service, repository, intent } = await world();
  assert.ok(intent.cookies.every((value) => value.includes("Secure")));
  assert.match(intent.cookies[0], /HttpOnly/);
  assert.doesNotMatch(intent.cookies[1], /HttpOnly/);
  const snapshot = repository.snapshot();
  const serialized = JSON.stringify(snapshot);
  const rawToken = cookieValue(intent.cookies.join("; "), service.cookieName);
  assert.ok(rawToken);
  assert.equal(serialized.includes(rawToken), false);
  assert.match(snapshot.sessions[0].token_digest, /^[0-9a-f]{64}$/);
});

test("login rate limit rejects excess attempts without account enumeration", async () => {
  const repository = await seededRepository();
  const service = createAuthService({ repository, rateLimit: { maxAttempts: 1, windowMs: 60_000 } });
  let auth = await service.createIntent();
  let token = cookieValue(auth.cookies.join("; "), service.cookieName);
  await assert.rejects(service.login(token, "unknown@example.test", "bad", { clientKey: "same" }), { code: "AUTH_INVALID_CREDENTIALS" });
  auth = await service.createIntent();
  token = cookieValue(auth.cookies.join("; "), service.cookieName);
  await assert.rejects(service.login(token, "unknown@example.test", "bad", { clientKey: "same" }), { code: "AUTH_RATE_LIMITED" });
});

test("transient repository failure leaves login intent retryable and creates no partial audit", async () => {
  const repository = await seededRepository();
  const original = repository.completeLogin;
  repository.completeLogin = async () => { throw new Error("transient"); };
  const service = createAuthService({ repository });
  const auth = await service.createIntent();
  const sessionToken = cookieValue(auth.cookies.join("; "), service.cookieName);
  await assert.rejects(service.login(sessionToken, ADMIN_EMAIL, ADMIN_TEMP_PASSWORD), /transient/);
  assert.equal((await repository.listAuditEvents()).filter((event) => event.type === "identity.sign_in").length, 0);
  repository.completeLogin = original;
  const retried = await service.login(sessionToken, ADMIN_EMAIL, ADMIN_TEMP_PASSWORD);
  assert.equal(retried.status, "password_change_required");
});

test("enabled deployment seed rejects placeholder credentials", async () => {
  await assert.rejects(seedInitialAdmin(createMemoryIdentityRepository(), {
    organizationId: "org",
    adminEmail: "admin@example.test",
    adminTempPassword: "CHANGE_ME_now"
  }), { code: "SEED_PLACEHOLDER_PASSWORD_FORBIDDEN" });
});
