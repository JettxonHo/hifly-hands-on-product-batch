function clone(value) {
  return value == null ? value : structuredClone(value);
}

function conflict(code) {
  return Object.assign(new Error(code), { code });
}

export function createMemoryIdentityRepository() {
  const organizations = new Map();
  const members = new Map();
  const memberships = new Map();
  const credentials = new Map();
  const sessions = new Map();
  const audits = [];

  function membershipFor(memberId) {
    const rows = [...memberships.values()].filter((row) => row.member_id === memberId && row.status === "active");
    if (rows.length > 1) throw conflict("MULTIPLE_ACTIVE_MEMBERSHIPS");
    return rows[0] ?? null;
  }

  function context(session) {
    if (!session?.member_id) return null;
    const member = members.get(session.member_id);
    const membership = membershipFor(session.member_id);
    const organization = membership && organizations.get(membership.organization_id);
    if (!member || !membership || !organization) return null;
    return clone({ session, member, membership, organization });
  }

  function append(event) {
    audits.push(clone(event));
  }

  return {
    async initialize() {},
    async close() {},
    async createLoginIntent(input) {
      const row = {
        id: input.id,
        token_digest: input.tokenDigest,
        csrf_digest: input.csrfDigest,
        member_id: null,
        organization_id: null,
        login_credential_id: null,
        intent: "anonymous",
        created_at: input.createdAt,
        expires_at: input.expiresAt,
        revoked_at: null,
        revision_number: 1
      };
      sessions.set(row.id, row);
      return clone(row);
    },
    async findSessionByTokenDigest(value) {
      return clone([...sessions.values()].find((row) => row.token_digest === value) ?? null);
    },
    async findMemberForAuthentication(email) {
      const member = [...members.values()].find((row) => row.email.toLowerCase() === email.toLowerCase());
      if (!member) return null;
      const credential = credentials.get(member.current_password_credential_id);
      return clone({ ...member, password_hash: credential?.password_hash ?? null });
    },
    async getMember(id) {
      return clone(members.get(id) ?? null);
    },
    async findCurrentCredential(memberId) {
      const member = members.get(memberId);
      return clone(member ? credentials.get(member.current_password_credential_id) : null);
    },
    async findCredential(id) {
      return clone(credentials.get(id) ?? null);
    },
    async findEffectiveMembership(memberId) {
      return clone(membershipFor(memberId));
    },
    async recordLoginFailure({ sessionId, event }) {
      const row = sessions.get(sessionId);
      if (!row) throw conflict("AUTH_INTENT_REQUIRED");
      if (row.intent === "failed") return { idempotent: true };
      if (row.intent !== "anonymous") throw conflict("AUTH_INTENT_CONFLICT");
      row.intent = "failed";
      row.revision_number += 1;
      append(event);
      return { idempotent: false };
    },
    async completeLogin({ sessionId, memberId, organizationId, credentialId, intent, event }) {
      const row = sessions.get(sessionId);
      if (!row) throw conflict("AUTH_INTENT_REQUIRED");
      if (row.intent === intent && row.member_id === memberId && row.organization_id === organizationId) return { idempotent: true };
      if (row.intent !== "anonymous") throw conflict("AUTH_INTENT_CONFLICT");
      const member = members.get(memberId);
      const membership = membershipFor(memberId);
      if (!member || member.status === "disabled") throw conflict("ACCOUNT_UNAVAILABLE");
      if (!membership || membership.organization_id !== organizationId) throw conflict("NO_ACTIVE_MEMBERSHIP");
      Object.assign(row, {
        member_id: memberId,
        organization_id: organizationId,
        login_credential_id: credentialId,
        intent,
        revision_number: row.revision_number + 1
      });
      append(event);
      return { idempotent: false };
    },
    async completePasswordChange({ sessionId, memberId, expectedRevision, credential, at, event }) {
      const session = sessions.get(sessionId);
      if (!session || session.member_id !== memberId) throw conflict("AUTH_INTENT_REQUIRED");
      if (session.intent === "authenticated") return { member: clone(members.get(memberId)), idempotent: true };
      if (session.intent !== "password_change") throw conflict("PASSWORD_CHANGE_SESSION_REQUIRED");
      const member = members.get(memberId);
      if (member?.status === "disabled") throw conflict("ACCOUNT_UNAVAILABLE");
      if (member.revision_number !== expectedRevision) throw conflict("MEMBER_VERSION_CONFLICT");
      const activeMembership = membershipFor(memberId);
      if (!activeMembership || activeMembership.organization_id !== session.organization_id) throw conflict("NO_ACTIVE_MEMBERSHIP");
      credentials.set(credential.id, { ...credential, member_id: memberId, purpose: "password_change", created_at: at });
      Object.assign(member, {
        current_password_credential_id: credential.id,
        requires_password_change: false,
        status: "active",
        revision_number: member.revision_number + 1,
        updated_at: at
      });
      for (const row of sessions.values()) {
        if (row.member_id === memberId && row.id !== sessionId && !row.revoked_at) row.revoked_at = at;
      }
      session.intent = "authenticated";
      session.revision_number += 1;
      append(event);
      return { member: clone(member), idempotent: false };
    },
    async resolveContext(tokenDigest, at) {
      const session = [...sessions.values()].find((row) => row.token_digest === tokenDigest);
      if (!session || session.revoked_at || Date.parse(session.expires_at) <= Date.parse(at)) return null;
      if (!["password_change", "authenticated"].includes(session.intent)) return null;
      const result = context(session);
      if (!result || result.member.status === "disabled" || result.membership.status !== "active") return null;
      return result;
    },
    async revokeSession(tokenDigest, event) {
      const session = [...sessions.values()].find((row) => row.token_digest === tokenDigest);
      if (!session || session.revoked_at) return null;
      session.revoked_at = event.at;
      session.revision_number += 1;
      append(event);
      return clone(session);
    },
    async listMembers(organizationId) {
      return [...members.values()].flatMap((member) => {
        const membership = [...memberships.values()].find((row) => row.member_id === member.id && row.organization_id === organizationId);
        return membership ? [{ ...clone(member), role: membership.role, membership_status: membership.status, membership_id: membership.id }] : [];
      });
    },
    async createMember({ actor, member, membership, credential, at, event }) {
      if ([...members.values()].some((row) => row.email.toLowerCase() === member.email.toLowerCase())) throw conflict("MEMBER_EMAIL_CONFLICT");
      const row = {
        ...member,
        status: "pending_activation",
        requires_password_change: true,
        current_password_credential_id: credential.id,
        revision_number: 1,
        created_at: at,
        updated_at: at
      };
      members.set(row.id, row);
      credentials.set(credential.id, { ...credential, member_id: row.id, purpose: "initial", created_at: at });
      memberships.set(membership.id, { ...membership, member_id: row.id, organization_id: actor.organization.id, status: "active" });
      append(event);
      return clone({ ...row, role: membership.role, membership_status: "active" });
    },
    async disableMember({ actor, targetMemberId, expectedRevision, at, event }) {
      const member = members.get(targetMemberId);
      const membership = member && membershipFor(member.id);
      if (!member || membership?.organization_id !== actor.organization.id) throw conflict("MEMBER_NOT_FOUND");
      if (member.status === "disabled") return clone(member);
      if (member.revision_number !== expectedRevision) throw conflict("MEMBER_VERSION_CONFLICT");
      Object.assign(member, { status: "disabled", revision_number: member.revision_number + 1, updated_at: at });
      for (const row of sessions.values()) if (row.member_id === member.id && !row.revoked_at) row.revoked_at = at;
      append(event);
      return clone(member);
    },
    async resetMemberPassword({ actor, targetMemberId, expectedRevision, credential, at, event }) {
      const member = members.get(targetMemberId);
      const membership = member && membershipFor(member.id);
      if (!member || membership?.organization_id !== actor.organization.id) throw conflict("MEMBER_NOT_FOUND");
      if (member.status === "disabled") throw conflict("ACCOUNT_UNAVAILABLE");
      if (member.revision_number !== expectedRevision) throw conflict("MEMBER_VERSION_CONFLICT");
      credentials.set(credential.id, { ...credential, member_id: member.id, purpose: "admin_reset", created_at: at });
      Object.assign(member, {
        current_password_credential_id: credential.id,
        requires_password_change: true,
        revision_number: member.revision_number + 1,
        updated_at: at
      });
      for (const row of sessions.values()) if (row.member_id === member.id && !row.revoked_at) row.revoked_at = at;
      append(event);
      return clone(member);
    },
    async seedInitialAdmin(seed) {
      const existing = [...members.values()].find((row) => row.email.toLowerCase() === seed.email.toLowerCase());
      if (existing) {
        const membership = membershipFor(existing.id);
        if (membership?.organization_id !== seed.organization_id || membership.role !== "admin") throw conflict("SEED_IDENTITY_CONFLICT");
        return { seeded: false, member: clone(existing) };
      }
      organizations.set(seed.organization_id, { id: seed.organization_id, name: seed.organization_name });
      const member = {
        id: seed.member_id,
        email: seed.email,
        display_name: seed.display_name,
        status: "pending_activation",
        requires_password_change: true,
        current_password_credential_id: seed.credential_id,
        revision_number: 1,
        created_at: seed.at,
        updated_at: seed.at
      };
      members.set(member.id, member);
      credentials.set(seed.credential_id, { id: seed.credential_id, member_id: member.id, password_hash: seed.password_hash, purpose: "initial", created_at: seed.at });
      memberships.set(seed.membership_id, { id: seed.membership_id, member_id: member.id, organization_id: seed.organization_id, role: "admin", status: "active" });
      append(seed.event);
      return { seeded: true, member: clone(member) };
    },
    async listAuditEvents() {
      return clone(audits);
    },
    async testingSetMembershipStatus(memberId, status) {
      const membership = membershipFor(memberId);
      if (!membership) throw conflict("NO_ACTIVE_MEMBERSHIP");
      membership.status = status;
    },
    snapshot() {
      return clone({ organizations: [...organizations.values()], members: [...members.values()], memberships: [...memberships.values()], credentials: [...credentials.values()], sessions: [...sessions.values()], audits });
    }
  };
}
