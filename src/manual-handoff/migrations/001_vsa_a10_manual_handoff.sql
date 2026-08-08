CREATE TABLE manual_handoff_packages (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  production_order_id uuid NOT NULL,
  contract_type text NOT NULL CHECK (contract_type = 'manual_handoff'),
  contract_version text NOT NULL CHECK (contract_version = '1.0'),
  package_version integer NOT NULL CHECK (package_version > 0),
  status text NOT NULL CHECK (status IN ('generating','ready','generation_failed','superseded','expired','revoked')),
  generation_request_id text NOT NULL,
  generation_job_id uuid NOT NULL,
  manifest jsonb,
  readme text,
  manifest_hash text,
  package_hash text,
  storage_key text,
  failure_reason text,
  supersedes_package_id uuid,
  created_by_member_id text NOT NULL REFERENCES identity_members(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  row_version integer NOT NULL CHECK (row_version > 0),
  status_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, production_order_id, contract_type, contract_version, package_version),
  FOREIGN KEY (production_order_id, organization_id) REFERENCES production_orders(id, organization_id),
  FOREIGN KEY (supersedes_package_id, organization_id) REFERENCES manual_handoff_packages(id, organization_id)
);

CREATE TABLE manual_handoff_package_generation_jobs (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  package_id uuid NOT NULL,
  type text NOT NULL CHECK (type = 'manual_handoff_package_generation'),
  status text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','timed_out')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  order_snapshot jsonb NOT NULL,
  failure_reason text,
  lease_token uuid,
  lease_expires_at timestamptz,
  started_at timestamptz,
  heartbeat_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (package_id),
  FOREIGN KEY (package_id, organization_id) REFERENCES manual_handoff_packages(id, organization_id)
);

ALTER TABLE manual_handoff_packages
  ADD CONSTRAINT manual_handoff_package_job_fk FOREIGN KEY (generation_job_id) REFERENCES manual_handoff_package_generation_jobs(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE manual_handoff_generation_receipts (
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  production_order_id uuid NOT NULL,
  contract_version text NOT NULL,
  generation_request_id text NOT NULL,
  payload_fingerprint text NOT NULL,
  package_id uuid NOT NULL,
  job_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, production_order_id, contract_version, generation_request_id),
  FOREIGN KEY (package_id, organization_id) REFERENCES manual_handoff_packages(id, organization_id),
  FOREIGN KEY (job_id) REFERENCES manual_handoff_package_generation_jobs(id)
);

CREATE TABLE manual_handoff_download_authorizations (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  package_id uuid NOT NULL,
  member_id text NOT NULL REFERENCES identity_members(id),
  token_digest text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','consumed','expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  consumed_at timestamptz,
  FOREIGN KEY (package_id, organization_id) REFERENCES manual_handoff_packages(id, organization_id)
);

CREATE TABLE manual_handoff_audit_events (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  actor_member_id text REFERENCES identity_members(id),
  package_id uuid,
  generation_job_id uuid,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (package_id, organization_id) REFERENCES manual_handoff_packages(id, organization_id),
  FOREIGN KEY (generation_job_id) REFERENCES manual_handoff_package_generation_jobs(id)
);

CREATE TABLE manual_handoff_status_ledger (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  package_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  reason text,
  actor_member_id text REFERENCES identity_members(id),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (package_id, organization_id) REFERENCES manual_handoff_packages(id, organization_id)
);

CREATE INDEX manual_handoff_packages_order_idx ON manual_handoff_packages(organization_id, production_order_id, package_version DESC);
CREATE INDEX manual_handoff_jobs_claim_idx ON manual_handoff_package_generation_jobs(status, lease_expires_at, created_at);
CREATE INDEX manual_handoff_grants_lookup_idx ON manual_handoff_download_authorizations(organization_id, package_id, member_id, status, expires_at);
CREATE INDEX manual_handoff_audit_package_idx ON manual_handoff_audit_events(organization_id, package_id, created_at, id);

CREATE FUNCTION manual_handoff_package_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.id = NEW.id AND OLD.organization_id = NEW.organization_id AND OLD.production_order_id = NEW.production_order_id AND
    OLD.contract_type = NEW.contract_type AND OLD.contract_version = NEW.contract_version AND OLD.package_version = NEW.package_version AND
    OLD.generation_request_id = NEW.generation_request_id AND OLD.generation_job_id = NEW.generation_job_id AND
    OLD.created_by_member_id = NEW.created_by_member_id AND OLD.created_at = NEW.created_at AND NEW.row_version = OLD.row_version + 1
    THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'manual handoff package contract is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER manual_handoff_packages_guard BEFORE UPDATE ON manual_handoff_packages FOR EACH ROW EXECUTE FUNCTION manual_handoff_package_guard();
CREATE FUNCTION manual_handoff_append_only() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'manual handoff history is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER manual_handoff_packages_no_delete BEFORE DELETE ON manual_handoff_packages FOR EACH ROW EXECUTE FUNCTION manual_handoff_append_only();
CREATE TRIGGER manual_handoff_audit_no_change BEFORE UPDATE OR DELETE ON manual_handoff_audit_events FOR EACH ROW EXECUTE FUNCTION manual_handoff_append_only();
CREATE TRIGGER manual_handoff_ledger_no_change BEFORE UPDATE OR DELETE ON manual_handoff_status_ledger FOR EACH ROW EXECUTE FUNCTION manual_handoff_append_only();
