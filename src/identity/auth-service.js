import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

import { hashPassword, meetsNewPasswordPolicy, verifyPassword } from "./password.js";

export const IDENTITY_COOKIE_NAME = "hifly_identity";
export const IDENTITY_CSRF_COOKIE_NAME = "hifly_identity_csrf";
export const IDENTITY_CSRF_HEADER_NAME = "x-identity-csrf";

const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_RATE_LIMIT = Object.freeze({ maxAttempts: 5, windowMs: 15 * 60 * 1000 });
const DUMMY_PASSWORD = "Not-A-Real-Account-Password-1!";

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function token() {
  return randomBytes(32).toString("base64url");
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sameDigest(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readCookie(header, name) {
  if (typeof header !== "string") return null;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return null;
}

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function safeMember(member, membership = null) {
  return {
    id: member.id,
    email: member.email,
    display_name: member.display_name,
    status: member.status,
    requires_password_change: member.requires_password_change,
    revision_number: member.revision_number,
    ...(membership ? { role: membership.role } : {})
  };
}

export function createAuthService({
  repository,
  sessionTtlMs = DEFAULT_SESSION_TTL_MS,
  cookieSecure = true,
  rateLimit = DEFAULT_RATE_LIMIT,
  now = Date.now
} = {}) {
  if (!repository) throw new TypeError("repository is required");
  const dummyHash = hashPassword(DUMMY_PASSWORD);
  const attempts = new Map();

  function at() {
    return new Date(now()).toISOString();
  }

  function cookie(name, value, { httpOnly = false, maxAge = null } = {}) {
    const flags = ["Path=/", "SameSite=Strict"];
    if (httpOnly) flags.push("HttpOnly");
    if (cookieSecure) flags.push("Secure");
    if (Number.isFinite(maxAge)) flags.push(`Max-Age=${Math.floor(maxAge)}`);
    return `${name}=${encodeURIComponent(value)}; ${flags.join("; ")}`;
  }

  function clearCookies() {
    return [
      cookie(IDENTITY_COOKIE_NAME, "", { httpOnly: true, maxAge: 0 }),
      cookie(IDENTITY_CSRF_COOKIE_NAME, "", { maxAge: 0 })
    ].map((value) => `${value}; Expires=Thu, 01 Jan 1970 00:00:00 GMT`);
  }

  function sessionCookies(sessionToken, csrfToken) {
    const maxAge = sessionTtlMs / 1000;
    return [
      cookie(IDENTITY_COOKIE_NAME, sessionToken, { httpOnly: true, maxAge }),
      cookie(IDENTITY_CSRF_COOKIE_NAME, csrfToken, { maxAge })
    ];
  }

  async function createIntent() {
    const sessionToken = token();
    const csrfToken = token();
    const createdAt = now();
    await repository.createLoginIntent({
      id: `session_${randomUUID()}`,
      tokenDigest: digest(sessionToken),
      csrfDigest: digest(csrfToken),
      createdAt: new Date(createdAt).toISOString(),
      expiresAt: new Date(createdAt + sessionTtlMs).toISOString()
    });
    return { csrfToken, cookies: sessionCookies(sessionToken, csrfToken) };
  }

  async function intentSession(sessionToken) {
    if (!sessionToken) throw failure("AUTH_INTENT_REQUIRED");
    const session = await repository.findSessionByTokenDigest(digest(sessionToken));
    if (!session || session.revoked_at || Date.parse(session.expires_at) <= now()) throw failure("AUTH_INTENT_REQUIRED");
    return session;
  }

  function rateKey(email, clientKey) {
    return `${clientKey || "unknown"}:${normalizeEmail(email)}`;
  }

  function checkRateLimit(email, clientKey) {
    const key = rateKey(email, clientKey);
    const current = attempts.get(key);
    if (!current || current.resetAt <= now()) return key;
    if (current.count >= rateLimit.maxAttempts) throw failure("AUTH_RATE_LIMITED");
    return key;
  }

  function recordAttempt(key, succeeded) {
    if (succeeded) return attempts.delete(key);
    const current = attempts.get(key);
    attempts.set(key, current && current.resetAt > now()
      ? { ...current, count: current.count + 1 }
      : { count: 1, resetAt: now() + rateLimit.windowMs });
  }

  async function login(sessionToken, email, password, { clientKey } = {}) {
    const session = await intentSession(sessionToken);
    if (["password_change", "authenticated"].includes(session.intent)) {
      const context = await repository.resolveContext(digest(sessionToken), at());
      if (!context) throw failure("AUTH_INTENT_CONFLICT");
      const replayMember = await repository.findMemberForAuthentication(normalizeEmail(email));
      const loginCredential = await repository.findCredential(session.login_credential_id);
      if (replayMember?.id !== context.member.id || !loginCredential || !await verifyPassword(password ?? "", loginCredential.password_hash)) {
        throw failure("AUTH_INTENT_CONFLICT");
      }
      return { status: session.intent === "password_change" ? "password_change_required" : "ok", context, idempotent: true };
    }
    if (session.intent !== "anonymous") throw failure("AUTH_INVALID_CREDENTIALS");

    const key = checkRateLimit(email, clientKey);
    const member = await repository.findMemberForAuthentication(normalizeEmail(email));
    const storedHash = member?.password_hash || await dummyHash;
    const valid = await verifyPassword(password ?? "", storedHash);
    if (!valid || !member || member.status === "disabled") {
      recordAttempt(key, false);
      await repository.recordLoginFailure({
        sessionId: session.id,
        event: {
          id: `audit_${randomUUID()}`,
          type: "identity.sign_in",
          subject_member_id: member?.id ?? null,
          outcome: "failure",
          at: at(),
          meta: { reason: member?.status === "disabled" ? "account_unavailable" : "invalid_credentials" }
        }
      });
      throw failure(member?.status === "disabled" ? "ACCOUNT_UNAVAILABLE" : "AUTH_INVALID_CREDENTIALS");
    }
    const membership = await repository.findEffectiveMembership(member.id);
    if (!membership) throw failure("NO_ACTIVE_MEMBERSHIP");
    const intent = member.requires_password_change ? "password_change" : "authenticated";
    await repository.completeLogin({
      sessionId: session.id,
      memberId: member.id,
      organizationId: membership.organization_id,
      credentialId: member.current_password_credential_id,
      intent,
      event: {
        id: `audit_${randomUUID()}`,
        type: "identity.sign_in",
        actor_member_id: member.id,
        subject_member_id: member.id,
        organization_id: membership.organization_id,
        outcome: "success",
        at: at(),
        meta: { requires_password_change: intent === "password_change" }
      }
    });
    recordAttempt(key, true);
    const context = await repository.resolveContext(digest(sessionToken), at());
    return { status: intent === "password_change" ? "password_change_required" : "ok", context, idempotent: false };
  }

  async function changePassword(sessionToken, newPassword) {
    const session = await intentSession(sessionToken);
    if (session.intent === "authenticated") {
      const context = await repository.resolveContext(digest(sessionToken), at());
      if (!context) throw failure("AUTH_REQUIRED");
      const current = await repository.findCurrentCredential(context.member.id);
      if (!current || !await verifyPassword(newPassword, current.password_hash)) throw failure("AUTH_INTENT_CONFLICT");
      return { context, idempotent: true };
    }
    if (session.intent !== "password_change" || !session.member_id) throw failure("PASSWORD_CHANGE_SESSION_REQUIRED");
    if (!meetsNewPasswordPolicy(newPassword)) throw failure("PASSWORD_TOO_WEAK");
    const current = await repository.findCurrentCredential(session.member_id);
    if (!current) throw failure("IDENTITY_CREDENTIAL_MISSING");
    if (await verifyPassword(newPassword, current.password_hash)) throw failure("PASSWORD_MUST_DIFFER");
    const member = await repository.getMember(session.member_id);
    if (!member || member.status === "disabled") throw failure("ACCOUNT_UNAVAILABLE");
    const completed = await repository.completePasswordChange({
      sessionId: session.id,
      memberId: member.id,
      expectedRevision: member.revision_number,
      credential: { id: `credential_${randomUUID()}`, password_hash: await hashPassword(newPassword) },
      at: at(),
      event: {
        id: `audit_${randomUUID()}`,
        type: "identity.password_changed",
        actor_member_id: member.id,
        subject_member_id: member.id,
        organization_id: session.organization_id,
        outcome: "success",
        at: at(),
        meta: { source: "first_login" }
      }
    });
    const context = await repository.resolveContext(digest(sessionToken), at());
    if (completed.idempotent) {
      const applied = await repository.findCurrentCredential(member.id);
      if (!applied || !await verifyPassword(newPassword, applied.password_hash)) throw failure("AUTH_INTENT_CONFLICT");
    }
    return { context, idempotent: completed.idempotent };
  }

  async function resolveContext(sessionToken) {
    return sessionToken ? repository.resolveContext(digest(sessionToken), at()) : null;
  }

  async function verifyCsrf(sessionToken, csrfToken) {
    const session = await intentSession(sessionToken);
    if (!csrfToken || !sameDigest(session.csrf_digest, digest(csrfToken))) throw failure("CSRF_REQUIRED");
    return session;
  }

  async function logout(sessionToken) {
    if (!sessionToken) return null;
    return repository.revokeSession(digest(sessionToken), {
      id: `audit_${randomUUID()}`,
      type: "identity.sign_out",
      outcome: "success",
      at: at(),
      meta: {}
    });
  }

  function requireAdmin(context) {
    if (context?.membership?.role !== "admin") throw failure("ADMIN_REQUIRED");
  }

  async function listMembers(context) {
    requireAdmin(context);
    const members = await repository.listMembers(context.organization.id);
    return members.map((member) => safeMember(member, { role: member.role }));
  }

  function temporaryPassword() {
    return `Tmp-${randomBytes(12).toString("base64url")}!9a`;
  }

  async function createMember(context, { email, displayName, role = "member" }) {
    requireAdmin(context);
    const normalized = normalizeEmail(email);
    if (!normalized || typeof displayName !== "string" || !displayName.trim() || !["admin", "member"].includes(role)) {
      throw failure("INVALID_MEMBER_PAYLOAD");
    }
    const temporary_password = temporaryPassword();
    const memberId = `member_${randomUUID()}`;
    const created = await repository.createMember({
      actor: context,
      member: { id: memberId, email: normalized, display_name: displayName.trim() },
      membership: { id: `membership_${randomUUID()}`, role },
      credential: { id: `credential_${randomUUID()}`, password_hash: await hashPassword(temporary_password) },
      at: at(),
      event: {
        id: `audit_${randomUUID()}`,
        type: "identity.member_created",
        actor_member_id: context.member.id,
        subject_member_id: memberId,
        organization_id: context.organization.id,
        outcome: "success",
        at: at(),
        meta: { role }
      }
    });
    return { member: safeMember(created, { role }), temporary_password };
  }

  async function disableMember(context, memberId, expectedRevision) {
    requireAdmin(context);
    const member = await repository.disableMember({
      actor: context,
      targetMemberId: memberId,
      expectedRevision,
      at: at(),
      event: {
        id: `audit_${randomUUID()}`,
        type: "identity.member_disabled",
        actor_member_id: context.member.id,
        subject_member_id: memberId,
        organization_id: context.organization.id,
        outcome: "success",
        at: at(),
        meta: {}
      }
    });
    return safeMember(member);
  }

  async function resetMemberPassword(context, memberId, expectedRevision) {
    requireAdmin(context);
    const temporary_password = temporaryPassword();
    const member = await repository.resetMemberPassword({
      actor: context,
      targetMemberId: memberId,
      expectedRevision,
      credential: { id: `credential_${randomUUID()}`, password_hash: await hashPassword(temporary_password) },
      at: at(),
      event: {
        id: `audit_${randomUUID()}`,
        type: "identity.password_reset",
        actor_member_id: context.member.id,
        subject_member_id: memberId,
        organization_id: context.organization.id,
        outcome: "success",
        at: at(),
        meta: {}
      }
    });
    return { member: safeMember(member), temporary_password };
  }

  return {
    createIntent,
    login,
    changePassword,
    resolveContext,
    verifyCsrf,
    logout,
    listMembers,
    createMember,
    disableMember,
    resetMemberPassword,
    clearCookies,
    cookieName: IDENTITY_COOKIE_NAME,
    csrfCookieName: IDENTITY_CSRF_COOKIE_NAME,
    csrfHeaderName: IDENTITY_CSRF_HEADER_NAME,
    readSessionCookie: (header) => readCookie(header, IDENTITY_COOKIE_NAME),
    readCsrfCookie: (header) => readCookie(header, IDENTITY_CSRF_COOKIE_NAME),
    safeMember
  };
}
