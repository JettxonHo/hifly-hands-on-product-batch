CREATE TABLE identity_organizations (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (length(trim(name)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identity_members (
  id text PRIMARY KEY,
  email text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending_activation', 'active', 'disabled')),
  requires_password_change boolean NOT NULL DEFAULT true,
  current_password_credential_id text NOT NULL,
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX identity_members_email_unique
  ON identity_members (lower(email));

CREATE TABLE identity_memberships (
  id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES identity_members(id),
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  role text NOT NULL CHECK (role IN ('admin', 'member')),
  status text NOT NULL CHECK (status IN ('active', 'unavailable')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (member_id, organization_id)
);

CREATE UNIQUE INDEX identity_single_active_membership_per_member
  ON identity_memberships (member_id)
  WHERE status = 'active';

CREATE TABLE identity_password_credentials (
  id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES identity_members(id),
  password_hash text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('initial', 'password_change', 'admin_reset')),
  created_by_member_id text REFERENCES identity_members(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE identity_members
  ADD CONSTRAINT identity_members_current_credential_fk
  FOREIGN KEY (current_password_credential_id)
  REFERENCES identity_password_credentials(id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE identity_sessions (
  id text PRIMARY KEY,
  token_digest text NOT NULL UNIQUE CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  csrf_digest text NOT NULL CHECK (csrf_digest ~ '^[0-9a-f]{64}$'),
  member_id text REFERENCES identity_members(id),
  organization_id text REFERENCES identity_organizations(id),
  login_credential_id text REFERENCES identity_password_credentials(id),
  intent text NOT NULL CHECK (intent IN ('anonymous', 'password_change', 'authenticated', 'failed')),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (
    (intent IN ('anonymous', 'failed') AND member_id IS NULL AND organization_id IS NULL AND login_credential_id IS NULL)
    OR
    (intent IN ('password_change', 'authenticated') AND member_id IS NOT NULL AND organization_id IS NOT NULL AND login_credential_id IS NOT NULL)
  )
);

CREATE INDEX identity_sessions_member_idx ON identity_sessions (member_id);

CREATE TABLE identity_audit_events (
  id text PRIMARY KEY,
  event_type text NOT NULL,
  actor_member_id text REFERENCES identity_members(id),
  subject_member_id text REFERENCES identity_members(id),
  organization_id text REFERENCES identity_organizations(id),
  outcome text NOT NULL CHECK (outcome IN ('success', 'failure')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE FUNCTION identity_reject_immutable_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'identity immutable record cannot be changed';
END;
$$;

CREATE TRIGGER identity_password_credentials_immutable
BEFORE UPDATE OR DELETE ON identity_password_credentials
FOR EACH ROW EXECUTE FUNCTION identity_reject_immutable_mutation();

CREATE TRIGGER identity_audit_events_immutable
BEFORE UPDATE OR DELETE ON identity_audit_events
FOR EACH ROW EXECUTE FUNCTION identity_reject_immutable_mutation();
