CREATE TABLE copy_generation_jobs (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  type text NOT NULL CHECK (type = 'copy_generation'),
  status text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled','timed_out')),
  product_revision_id uuid NOT NULL,
  project_id uuid NOT NULL,
  product_id uuid NOT NULL,
  intent text NOT NULL,
  input_snapshot jsonb NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  copy_version_id uuid,
  failure_code text,
  lease_token uuid,
  started_at timestamptz,
  heartbeat_at timestamptz,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (product_revision_id, organization_id) REFERENCES project_content_product_revisions(id, organization_id),
  FOREIGN KEY (project_id, organization_id) REFERENCES project_content_projects(id, organization_id),
  FOREIGN KEY (product_id, organization_id) REFERENCES project_content_products(id, organization_id)
);

CREATE TABLE copy_versions (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  project_id uuid NOT NULL,
  product_id uuid NOT NULL,
  product_revision_id uuid NOT NULL,
  generation_job_id uuid REFERENCES copy_generation_jobs(id),
  intent text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','frozen','superseded')),
  version_number integer NOT NULL CHECK (version_number > 0),
  row_version integer NOT NULL DEFAULT 1 CHECK (row_version > 0),
  body text NOT NULL CHECK (length(btrim(body)) > 0),
  parent_copy_version_id uuid REFERENCES copy_versions(id),
  created_by_member_id text REFERENCES identity_members(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  frozen_at timestamptz,
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, product_revision_id, version_number),
  FOREIGN KEY (product_revision_id, organization_id) REFERENCES project_content_product_revisions(id, organization_id),
  FOREIGN KEY (project_id, organization_id) REFERENCES project_content_projects(id, organization_id),
  FOREIGN KEY (product_id, organization_id) REFERENCES project_content_products(id, organization_id)
);

ALTER TABLE copy_generation_jobs ADD CONSTRAINT copy_generation_job_copy_fk
  FOREIGN KEY (copy_version_id, organization_id) REFERENCES copy_versions(id, organization_id);

CREATE TABLE copy_generation_idempotency_receipts (
  receipt_key text PRIMARY KEY,
  payload_fingerprint text NOT NULL,
  job_id uuid REFERENCES copy_generation_jobs(id),
  copy_version_id uuid REFERENCES copy_versions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE copy_generation_audit_events (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  actor_member_id text REFERENCES identity_members(id),
  event_type text NOT NULL,
  product_revision_id uuid,
  copy_version_id uuid,
  copy_generation_job_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE INDEX copy_generation_jobs_claim_idx ON copy_generation_jobs(status, created_at);
CREATE INDEX copy_versions_revision_idx ON copy_versions(organization_id, product_revision_id, version_number);
CREATE UNIQUE INDEX copy_versions_one_current_draft_idx ON copy_versions(organization_id, product_revision_id) WHERE status = 'draft';

CREATE FUNCTION copy_generation_preserve_frozen_copy() RETURNS trigger AS $$
BEGIN
  IF OLD.status IN ('frozen','superseded') AND NEW.body IS DISTINCT FROM OLD.body THEN
    RAISE EXCEPTION 'frozen copy version body is immutable';
  END IF;
  IF OLD.status = 'superseded' AND NEW.status <> 'superseded' THEN
    RAISE EXCEPTION 'superseded copy version state is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER copy_generation_frozen_copy_immutable
BEFORE UPDATE ON copy_versions
FOR EACH ROW EXECUTE FUNCTION copy_generation_preserve_frozen_copy();
