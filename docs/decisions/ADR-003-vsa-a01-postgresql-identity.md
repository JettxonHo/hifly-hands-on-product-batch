# ADR-003: PostgreSQL is the authoritative VSA-A01 identity store

## Status

Accepted

## Date

2026-08-06

## Context

VSA-A01 introduces multi-user enterprise identity, Organization membership,
server-side sessions, immutable credential history, and append-only audit events.
These records are relational security data and require transactional updates,
foreign keys, uniqueness constraints, and optimistic concurrency.

D-026 requires PostgreSQL as the sole authoritative relational business database
in both the personal Docker Compose validation environment and the managed
production environment. The existing JSON batch store is not an authorized
identity persistence option. The existing local workbench request guard is also
single-process and loopback-only; it is not a Cloud Web identity boundary.

## Decision

- Identity-enabled deployments require PostgreSQL and run versioned migrations.
  Startup fails closed if the database configuration, connection, or migration
  is unavailable. There is no file-store fallback.
- `Organization`, `Member`, `Membership`, password credential history, sessions,
  and `AuditEvent` are represented by relational tables with database constraints.
  Role belongs to `Membership`, following D-028.
- Password credential rows and audit event rows are append-only. Session tokens
  and CSRF tokens are stored only as SHA-256 digests.
- Member lifecycle mutations use `row_version` optimistic concurrency. Password
  reset does not reactivate a disabled member; A01 has no re-enable command.
- The production repository is behind a narrow interface. Unit and API tests may
  inject an in-memory repository, but production startup never selects it.
- The ordinary Ubuntu and Windows Node 22 CI matrix remains database-independent.
  A separate Ubuntu job starts PostgreSQL and verifies migration from a clean
  database plus the identity integration path.
- Identity-disabled mode retains the existing loopback host/session-proof guard.
  Identity-enabled mode instead requires explicit trusted Host and Origin lists,
  HttpOnly session cookies, per-session CSRF, and server-side authorization.
- Secure cookies are the production default. Local HTTP integration tests must
  opt out explicitly.

## Alternatives Considered

### JSON file identity store

Rejected. It contradicts D-026, cannot provide the required relational
constraints and cross-process concurrency guarantees, and would create an
unsafe migration path for security data.

### Reusing the local workbench session proof

Rejected for identity-enabled deployments. Its process-wide token and loopback
Host restriction are appropriate for the legacy single-user local tool, not a
multi-user Cloud Web application.

### Requiring PostgreSQL in every test job

Rejected. It would unnecessarily break the existing Windows/no-database matrix.
Repository injection keeps fast tests portable while a dedicated integration job
holds the real database contract.

## Consequences

- Local identity development requires Docker/PostgreSQL and an explicit database
  URL; this is intentional fail-closed behavior.
- Schema changes must be delivered as ordered migrations and verified from a
  clean database.
- The current login limiter is process-local. It provides a minimum A01 control,
  but production multi-instance deployment still needs a shared gateway or
  database-backed limiter before security hardening is considered complete.
- The legacy local GUI remains usable with identity disabled and does not require
  PostgreSQL.
