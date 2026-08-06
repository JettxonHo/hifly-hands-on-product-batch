import { randomUUID } from "node:crypto";

import { assertIdentitySchemaCurrent, withTransaction } from "./postgres.js";

function conflict(code) {
  return Object.assign(new Error(code), { code });
}

function one(result) {
  return result.rows[0] ?? null;
}

function memberProjection(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    display_name: row.display_name,
    status: row.status,
    requires_password_change: row.requires_password_change,
    current_password_credential_id: row.current_password_credential_id,
    revision_number: row.row_version,
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function contextProjection(row) {
  if (!row) return null;
  return {
    session: {
      id: row.session_id,
      intent: row.intent,
      expires_at: row.expires_at,
      revoked_at: row.revoked_at,
      revision_number: row.session_row_version
    },
    member: memberProjection(row),
    membership: {
      id: row.membership_id,
      member_id: row.id,
      organization_id: row.organization_id,
      role: row.role,
      status: row.membership_status
    },
    organization: {
      id: row.organization_id,
      name: row.organization_name
    }
  };
}

const CONTEXT_SQL = `
  SELECT s.id AS session_id, s.intent, s.expires_at, s.revoked_at,
         s.row_version AS session_row_version,
         m.id, m.email, m.display_name, m.status,
         m.requires_password_change, m.current_password_credential_id,
         m.row_version, m.created_at, m.updated_at,
         ms.id AS membership_id, ms.organization_id, ms.role,
         ms.status AS membership_status, o.name AS organization_name
    FROM identity_sessions s
    JOIN identity_members m ON m.id = s.member_id
    JOIN identity_memberships ms
      ON ms.member_id = m.id AND ms.organization_id = s.organization_id
    JOIN identity_organizations o ON o.id = ms.organization_id
`;

export function createPostgresIdentityRepository({ pool, ownsPool = true } = {}) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("pool is required");

  async function initialize() {
    await assertIdentitySchemaCurrent(pool);
  }

  async function createLoginIntent({ id, tokenDigest, csrfDigest, expiresAt, createdAt }) {
    const result = await pool.query(
      `INSERT INTO identity_sessions
         (id, token_digest, csrf_digest, intent, created_at, expires_at)
       VALUES ($1, $2, $3, 'anonymous', $4, $5)
       RETURNING id, intent, expires_at, row_version AS revision_number`,
      [id, tokenDigest, csrfDigest, createdAt, expiresAt]
    );
    return one(result);
  }

  async function findSessionByTokenDigest(tokenDigest) {
    return one(await pool.query(
      `SELECT id, token_digest, csrf_digest, member_id, organization_id, login_credential_id, intent,
              expires_at, revoked_at, row_version AS revision_number
         FROM identity_sessions WHERE token_digest = $1`,
      [tokenDigest]
    ));
  }

  async function findMemberForAuthentication(email) {
    const result = await pool.query(
      `SELECT m.id, m.email, m.display_name, m.status, m.requires_password_change,
              m.current_password_credential_id, m.row_version, m.created_at, m.updated_at,
              c.password_hash
         FROM identity_members m
         LEFT JOIN identity_password_credentials c
           ON c.id = m.current_password_credential_id
        WHERE lower(m.email) = lower($1)`,
      [email]
    );
    const row = one(result);
    return row ? { ...memberProjection(row), password_hash: row.password_hash } : null;
  }

  async function getMember(id) {
    return memberProjection(one(await pool.query("SELECT * FROM identity_members WHERE id = $1", [id])));
  }

  async function findCurrentCredential(memberId) {
    return one(await pool.query(
      `SELECT c.id, c.member_id, c.password_hash, c.purpose, c.created_at
         FROM identity_members m
         JOIN identity_password_credentials c ON c.id = m.current_password_credential_id
        WHERE m.id = $1`,
      [memberId]
    ));
  }

  async function findCredential(id) {
    return one(await pool.query(
      `SELECT id, member_id, password_hash, purpose, created_at
         FROM identity_password_credentials WHERE id = $1`,
      [id]
    ));
  }

  async function findEffectiveMembership(memberId) {
    const rows = await pool.query(
      `SELECT ms.*, o.name AS organization_name
         FROM identity_memberships ms
         JOIN identity_organizations o ON o.id = ms.organization_id
        WHERE ms.member_id = $1 AND ms.status = 'active'`,
      [memberId]
    );
    if (rows.rowCount === 0) return null;
    if (rows.rowCount > 1) throw conflict("MULTIPLE_ACTIVE_MEMBERSHIPS");
    return one(rows);
  }

  async function appendAudit(client, event) {
    await client.query(
      `INSERT INTO identity_audit_events
         (id, event_type, actor_member_id, subject_member_id, organization_id, outcome, occurred_at, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
      [
        event.id ?? `audit_${randomUUID()}`,
        event.type,
        event.actor_member_id ?? null,
        event.subject_member_id ?? null,
        event.organization_id ?? null,
        event.outcome ?? "success",
        event.at,
        JSON.stringify(event.meta ?? {})
      ]
    );
  }

  async function recordLoginFailure({ sessionId, event }) {
    return withTransaction(pool, async (client) => {
      const current = one(await client.query("SELECT * FROM identity_sessions WHERE id = $1 FOR UPDATE", [sessionId]));
      if (!current) throw conflict("AUTH_INTENT_REQUIRED");
      if (current.intent === "failed") return { idempotent: true };
      if (current.intent !== "anonymous") throw conflict("AUTH_INTENT_CONFLICT");
      await client.query(
        "UPDATE identity_sessions SET intent = 'failed', row_version = row_version + 1 WHERE id = $1",
        [sessionId]
      );
      await appendAudit(client, event);
      return { idempotent: false };
    });
  }

  async function completeLogin({ sessionId, memberId, organizationId, credentialId, intent, event }) {
    return withTransaction(pool, async (client) => {
      const current = one(await client.query("SELECT * FROM identity_sessions WHERE id = $1 FOR UPDATE", [sessionId]));
      if (!current) throw conflict("AUTH_INTENT_REQUIRED");
      if (current.intent === intent && current.member_id === memberId && current.organization_id === organizationId) {
        return { idempotent: true };
      }
      if (current.intent !== "anonymous") throw conflict("AUTH_INTENT_CONFLICT");
      const member = one(await client.query("SELECT status FROM identity_members WHERE id = $1 FOR UPDATE", [memberId]));
      if (!member || member.status === "disabled") throw conflict("ACCOUNT_UNAVAILABLE");
      const membership = one(await client.query(
        `SELECT id FROM identity_memberships
          WHERE member_id = $1 AND organization_id = $2 AND status = 'active' FOR UPDATE`,
        [memberId, organizationId]
      ));
      if (!membership) throw conflict("NO_ACTIVE_MEMBERSHIP");
      await client.query(
        `UPDATE identity_sessions
            SET member_id = $2, organization_id = $3, login_credential_id = $4,
                intent = $5, row_version = row_version + 1
          WHERE id = $1`,
        [sessionId, memberId, organizationId, credentialId, intent]
      );
      await appendAudit(client, event);
      return { idempotent: false };
    });
  }

  async function completePasswordChange({ sessionId, memberId, expectedRevision, credential, at, event }) {
    return withTransaction(pool, async (client) => {
      const session = one(await client.query("SELECT * FROM identity_sessions WHERE id = $1 FOR UPDATE", [sessionId]));
      if (!session || session.member_id !== memberId) throw conflict("AUTH_INTENT_REQUIRED");
      if (session.intent === "authenticated") {
        return { member: memberProjection(one(await client.query("SELECT * FROM identity_members WHERE id = $1", [memberId]))), idempotent: true };
      }
      if (session.intent !== "password_change") throw conflict("PASSWORD_CHANGE_SESSION_REQUIRED");
      const member = one(await client.query("SELECT * FROM identity_members WHERE id = $1 FOR UPDATE", [memberId]));
      if (!member) throw conflict("MEMBER_NOT_FOUND");
      if (member.status === "disabled") throw conflict("ACCOUNT_UNAVAILABLE");
      if (member.row_version !== expectedRevision) throw conflict("MEMBER_VERSION_CONFLICT");
      const membership = one(await client.query(
        `SELECT * FROM identity_memberships
          WHERE member_id = $1 AND organization_id = $2 AND status = 'active'
          FOR UPDATE`,
        [memberId, session.organization_id]
      ));
      if (!membership) throw conflict("NO_ACTIVE_MEMBERSHIP");
      await client.query(
        `INSERT INTO identity_password_credentials
           (id, member_id, password_hash, purpose, created_by_member_id, created_at)
         VALUES ($1, $2, $3, 'password_change', $2, $4)`,
        [credential.id, memberId, credential.password_hash, at]
      );
      const updated = one(await client.query(
        `UPDATE identity_members
            SET current_password_credential_id = $2,
                requires_password_change = false,
                status = 'active',
                row_version = row_version + 1,
                updated_at = $3
          WHERE id = $1 AND row_version = $4
        RETURNING *`,
        [memberId, credential.id, at, expectedRevision]
      ));
      if (!updated) throw conflict("MEMBER_VERSION_CONFLICT");
      await client.query(
        `UPDATE identity_sessions
            SET revoked_at = $2, row_version = row_version + 1
          WHERE member_id = $1 AND id <> $3 AND revoked_at IS NULL`,
        [memberId, at, sessionId]
      );
      await client.query(
        "UPDATE identity_sessions SET intent = 'authenticated', row_version = row_version + 1 WHERE id = $1",
        [sessionId]
      );
      await appendAudit(client, event);
      return { member: memberProjection(updated), idempotent: false };
    });
  }

  async function resolveContext(tokenDigest, at) {
    const row = one(await pool.query(
      `${CONTEXT_SQL}
        WHERE s.token_digest = $1
          AND s.intent IN ('password_change', 'authenticated')
          AND s.revoked_at IS NULL AND s.expires_at > $2
          AND m.status <> 'disabled' AND ms.status = 'active'`,
      [tokenDigest, at]
    ));
    return contextProjection(row);
  }

  async function revokeSession(tokenDigest, event) {
    return withTransaction(pool, async (client) => {
      const session = one(await client.query(
        "SELECT * FROM identity_sessions WHERE token_digest = $1 FOR UPDATE",
        [tokenDigest]
      ));
      if (!session || session.revoked_at) return null;
      await client.query(
        "UPDATE identity_sessions SET revoked_at = $2, row_version = row_version + 1 WHERE id = $1",
        [session.id, event.at]
      );
      await appendAudit(client, event);
      return session;
    });
  }

  async function listMembers(organizationId) {
    const result = await pool.query(
      `SELECT m.*, ms.role, ms.status AS membership_status, ms.id AS membership_id
         FROM identity_members m
         JOIN identity_memberships ms ON ms.member_id = m.id
        WHERE ms.organization_id = $1 ORDER BY lower(m.email)`,
      [organizationId]
    );
    return result.rows.map((row) => ({
      ...memberProjection(row),
      role: row.role,
      membership_status: row.membership_status,
      membership_id: row.membership_id
    }));
  }

  async function createMember({ actor, member, membership, credential, at, event }) {
    try {
      return await withTransaction(pool, async (client) => {
      const duplicate = one(await client.query(
        "SELECT id FROM identity_members WHERE lower(email) = lower($1)",
        [member.email]
      ));
      if (duplicate) throw conflict("MEMBER_EMAIL_CONFLICT");
      await client.query(
        `INSERT INTO identity_members
           (id, email, display_name, status, requires_password_change, current_password_credential_id, row_version, created_at, updated_at)
         VALUES ($1, $2, $3, 'pending_activation', true, $4, 1, $5, $5)`,
        [member.id, member.email, member.display_name, credential.id, at]
      );
      await client.query(
        `INSERT INTO identity_password_credentials
           (id, member_id, password_hash, purpose, created_by_member_id, created_at)
         VALUES ($1, $2, $3, 'initial', $4, $5)`,
        [credential.id, member.id, credential.password_hash, actor.member.id, at]
      );
      const created = one(await client.query("SELECT * FROM identity_members WHERE id = $1", [member.id]));
      await client.query(
        `INSERT INTO identity_memberships
           (id, member_id, organization_id, role, status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'active', $5, $5)`,
        [membership.id, member.id, actor.organization.id, membership.role, at]
      );
      await appendAudit(client, event);
        return { ...memberProjection(created), role: membership.role, membership_status: "active" };
      });
    } catch (error) {
      if (error?.code === "23505" && error?.constraint === "identity_members_email_unique") throw conflict("MEMBER_EMAIL_CONFLICT");
      throw error;
    }
  }

  async function disableMember({ actor, targetMemberId, expectedRevision, at, event }) {
    return withTransaction(pool, async (client) => {
      const target = one(await client.query(
        `SELECT m.* FROM identity_members m
          JOIN identity_memberships ms ON ms.member_id = m.id
         WHERE m.id = $1 AND ms.organization_id = $2 FOR UPDATE OF m`,
        [targetMemberId, actor.organization.id]
      ));
      if (!target) throw conflict("MEMBER_NOT_FOUND");
      if (target.status === "disabled") return memberProjection(target);
      if (target.row_version !== expectedRevision) throw conflict("MEMBER_VERSION_CONFLICT");
      const updated = one(await client.query(
        `UPDATE identity_members SET status = 'disabled', row_version = row_version + 1, updated_at = $3
          WHERE id = $1 AND row_version = $2 RETURNING *`,
        [targetMemberId, expectedRevision, at]
      ));
      if (!updated) throw conflict("MEMBER_VERSION_CONFLICT");
      await client.query(
        "UPDATE identity_sessions SET revoked_at = $2, row_version = row_version + 1 WHERE member_id = $1 AND revoked_at IS NULL",
        [targetMemberId, at]
      );
      await appendAudit(client, event);
      return memberProjection(updated);
    });
  }

  async function resetMemberPassword({ actor, targetMemberId, expectedRevision, credential, at, event }) {
    return withTransaction(pool, async (client) => {
      const target = one(await client.query(
        `SELECT m.* FROM identity_members m
          JOIN identity_memberships ms ON ms.member_id = m.id
         WHERE m.id = $1 AND ms.organization_id = $2 FOR UPDATE OF m`,
        [targetMemberId, actor.organization.id]
      ));
      if (!target) throw conflict("MEMBER_NOT_FOUND");
      if (target.status === "disabled") throw conflict("ACCOUNT_UNAVAILABLE");
      if (target.row_version !== expectedRevision) throw conflict("MEMBER_VERSION_CONFLICT");
      await client.query(
        `INSERT INTO identity_password_credentials
           (id, member_id, password_hash, purpose, created_by_member_id, created_at)
         VALUES ($1, $2, $3, 'admin_reset', $4, $5)`,
        [credential.id, targetMemberId, credential.password_hash, actor.member.id, at]
      );
      const updated = one(await client.query(
        `UPDATE identity_members
            SET current_password_credential_id = $2, requires_password_change = true,
                row_version = row_version + 1, updated_at = $3
          WHERE id = $1 AND row_version = $4 RETURNING *`,
        [targetMemberId, credential.id, at, expectedRevision]
      ));
      if (!updated) throw conflict("MEMBER_VERSION_CONFLICT");
      await client.query(
        "UPDATE identity_sessions SET revoked_at = $2, row_version = row_version + 1 WHERE member_id = $1 AND revoked_at IS NULL",
        [targetMemberId, at]
      );
      await appendAudit(client, event);
      return memberProjection(updated);
    });
  }

  async function seedInitialAdmin(seed) {
    return withTransaction(pool, async (client) => {
      const existing = one(await client.query(
        `SELECT m.*, ms.organization_id, ms.role, ms.status AS membership_status
           FROM identity_members m
           LEFT JOIN identity_memberships ms ON ms.member_id = m.id
          WHERE lower(m.email) = lower($1)`,
        [seed.email]
      ));
      if (existing) {
        if (existing.organization_id !== seed.organization_id || existing.role !== "admin" || existing.membership_status !== "active") {
          throw conflict("SEED_IDENTITY_CONFLICT");
        }
        return { seeded: false, member: memberProjection(existing) };
      }
      await client.query(
        "INSERT INTO identity_organizations(id, name, created_at) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
        [seed.organization_id, seed.organization_name, seed.at]
      );
      await client.query(
        `INSERT INTO identity_members
           (id, email, display_name, status, requires_password_change, current_password_credential_id, row_version, created_at, updated_at)
         VALUES ($1, $2, $3, 'pending_activation', true, $4, 1, $5, $5)`,
        [seed.member_id, seed.email, seed.display_name, seed.credential_id, seed.at]
      );
      await client.query(
        `INSERT INTO identity_password_credentials
           (id, member_id, password_hash, purpose, created_by_member_id, created_at)
         VALUES ($1, $2, $3, 'initial', $2, $4)`,
        [seed.credential_id, seed.member_id, seed.password_hash, seed.at]
      );
      await client.query(
        `INSERT INTO identity_memberships
           (id, member_id, organization_id, role, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'admin', 'active', $4, $4)`,
        [seed.membership_id, seed.member_id, seed.organization_id, seed.at]
      );
      await appendAudit(client, seed.event);
      return { seeded: true, member: memberProjection(one(await client.query("SELECT * FROM identity_members WHERE id = $1", [seed.member_id]))) };
    });
  }

  async function listAuditEvents() {
    return (await pool.query("SELECT * FROM identity_audit_events ORDER BY occurred_at, id")).rows;
  }

  return {
    initialize,
    createLoginIntent,
    findSessionByTokenDigest,
    findMemberForAuthentication,
    getMember,
    findCurrentCredential,
    findCredential,
    findEffectiveMembership,
    recordLoginFailure,
    completeLogin,
    completePasswordChange,
    resolveContext,
    revokeSession,
    listMembers,
    createMember,
    disableMember,
    resetMemberPassword,
    seedInitialAdmin,
    listAuditEvents,
    close: () => ownsPool ? pool.end() : Promise.resolve()
  };
}
