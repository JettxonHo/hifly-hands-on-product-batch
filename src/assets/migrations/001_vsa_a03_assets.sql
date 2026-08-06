CREATE TABLE asset_assets (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  kind text NOT NULL CHECK (kind = 'product_image'),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 120),
  status text NOT NULL CHECK (status IN ('active', 'disabled', 'deleted')),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_by_member_id text REFERENCES identity_members(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, organization_id)
);

CREATE TABLE asset_versions (
  id uuid PRIMARY KEY,
  asset_id uuid NOT NULL,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL CHECK (status IN ('upload_pending', 'uploading', 'verifying', 'available', 'verification_failed', 'unavailable')),
  object_key text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  expected_content_type text NOT NULL,
  expected_size bigint NOT NULL CHECK (expected_size > 0),
  expected_checksum_sha256 char(64) NOT NULL,
  verified_content_type text,
  verified_size bigint,
  verified_checksum_sha256 char(64),
  verified_at timestamptz,
  failure_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (asset_id, version_number),
  UNIQUE (id, organization_id),
  UNIQUE (id, asset_id, organization_id),
  FOREIGN KEY (asset_id, organization_id) REFERENCES asset_assets(id, organization_id)
);

CREATE TABLE asset_upload_sessions (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  asset_version_id uuid NOT NULL,
  object_key text NOT NULL,
  token_digest char(64) NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('upload_pending', 'uploaded', 'completed', 'expired')),
  expires_at timestamptz NOT NULL,
  uploaded_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (asset_version_id, organization_id) REFERENCES asset_versions(id, organization_id)
);

CREATE TABLE asset_async_jobs (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  type text NOT NULL CHECK (type = 'asset_verification'),
  asset_version_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (asset_version_id, organization_id) REFERENCES asset_versions(id, organization_id),
  UNIQUE (type, asset_version_id)
);

CREATE TABLE asset_idempotency_receipts (
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  idempotency_key text NOT NULL,
  payload_fingerprint text NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, idempotency_key)
);

CREATE TABLE asset_upload_authorization_receipts (
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  actor_member_id text NOT NULL REFERENCES identity_members(id),
  idempotency_key text NOT NULL,
  payload_fingerprint text NOT NULL,
  asset_id uuid NOT NULL,
  asset_version_id uuid NOT NULL,
  upload_session_id uuid NOT NULL REFERENCES asset_upload_sessions(id),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (asset_id, organization_id) REFERENCES asset_assets(id, organization_id),
  FOREIGN KEY (asset_version_id, asset_id, organization_id) REFERENCES asset_versions(id, asset_id, organization_id),
  PRIMARY KEY (organization_id, actor_member_id, idempotency_key)
);

CREATE TABLE asset_references (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  asset_id uuid NOT NULL,
  asset_version_id uuid NOT NULL,
  reference_type text NOT NULL CHECK (reference_type = 'product_revision'),
  reference_id text NOT NULL,
  role text NOT NULL CHECK (role = 'product_image'),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (asset_version_id, asset_id, organization_id) REFERENCES asset_versions(id, asset_id, organization_id),
  UNIQUE (organization_id, asset_version_id, reference_type, reference_id, role)
);

CREATE TABLE asset_audit_events (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  actor_member_id text REFERENCES identity_members(id),
  event_type text NOT NULL,
  asset_id uuid REFERENCES asset_assets(id),
  asset_version_id uuid REFERENCES asset_versions(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE INDEX asset_versions_organization_status_idx ON asset_versions(organization_id, status);
CREATE INDEX asset_jobs_status_idx ON asset_async_jobs(status, created_at);

CREATE FUNCTION asset_reject_reference_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'asset references are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_references_immutable
BEFORE UPDATE OR DELETE ON asset_references
FOR EACH ROW EXECUTE FUNCTION asset_reject_reference_mutation();

CREATE FUNCTION asset_preserve_available_file_identity() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'available' AND (
    NEW.object_key IS DISTINCT FROM OLD.object_key OR
    NEW.expected_content_type IS DISTINCT FROM OLD.expected_content_type OR
    NEW.expected_size IS DISTINCT FROM OLD.expected_size OR
    NEW.expected_checksum_sha256 IS DISTINCT FROM OLD.expected_checksum_sha256 OR
    NEW.verified_content_type IS DISTINCT FROM OLD.verified_content_type OR
    NEW.verified_size IS DISTINCT FROM OLD.verified_size OR
    NEW.verified_checksum_sha256 IS DISTINCT FROM OLD.verified_checksum_sha256
  ) THEN
    RAISE EXCEPTION 'available asset version file identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER asset_available_file_identity_immutable
BEFORE UPDATE ON asset_versions
FOR EACH ROW EXECUTE FUNCTION asset_preserve_available_file_identity();
