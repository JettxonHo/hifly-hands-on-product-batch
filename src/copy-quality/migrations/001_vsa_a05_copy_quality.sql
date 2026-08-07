CREATE TABLE copy_quality_runs (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  copy_version_id uuid NOT NULL,
  product_revision_id uuid NOT NULL,
  profile_version text NOT NULL,
  rule_version text NOT NULL,
  input_snapshot jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  quality_result_id uuid,
  failure_code text,
  lease_token uuid,
  started_at timestamptz,
  heartbeat_at timestamptz,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, organization_id),
  FOREIGN KEY (copy_version_id, organization_id) REFERENCES copy_versions(id, organization_id),
  FOREIGN KEY (product_revision_id, organization_id) REFERENCES project_content_product_revisions(id, organization_id)
);

CREATE TABLE copy_quality_results (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  quality_run_id uuid NOT NULL UNIQUE,
  copy_version_id uuid NOT NULL,
  profile_version text NOT NULL,
  rule_version text NOT NULL,
  conclusion text NOT NULL CHECK (conclusion IN ('invalid','blocked','needs_review','passed')),
  created_at timestamptz NOT NULL,
  UNIQUE (id, organization_id),
  FOREIGN KEY (quality_run_id, organization_id) REFERENCES copy_quality_runs(id, organization_id),
  FOREIGN KEY (copy_version_id, organization_id) REFERENCES copy_versions(id, organization_id)
);

ALTER TABLE copy_quality_runs ADD CONSTRAINT copy_quality_run_result_fk
  FOREIGN KEY (quality_result_id, organization_id) REFERENCES copy_quality_results(id, organization_id);

CREATE TABLE copy_quality_findings (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  quality_result_id uuid NOT NULL,
  code text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('review','hard_block','fact_gate')),
  severity text NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  title text NOT NULL,
  matched_text text NOT NULL,
  message text NOT NULL,
  evidence_reference text NOT NULL,
  rule_source text NOT NULL,
  suggestion text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (id, organization_id),
  FOREIGN KEY (quality_result_id, organization_id) REFERENCES copy_quality_results(id, organization_id)
);

CREATE TABLE copy_quality_finding_resolutions (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  quality_finding_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('accepted_with_reason','change_requested','returned_to_facts')),
  reason text,
  actor_member_id text NOT NULL REFERENCES identity_members(id),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (quality_finding_id, organization_id) REFERENCES copy_quality_findings(id, organization_id)
);

CREATE TABLE copy_rewrite_jobs (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  actor_member_id text NOT NULL REFERENCES identity_members(id),
  source_copy_version_id uuid NOT NULL,
  finding_id uuid,
  scope text NOT NULL CHECK (scope IN ('matched_text','full')),
  instruction text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled','timed_out')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts > 0),
  output_copy_version_id uuid,
  quality_run_id uuid,
  rewritten_body text,
  failure_code text,
  lease_token uuid,
  started_at timestamptz,
  heartbeat_at timestamptz,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, organization_id),
  FOREIGN KEY (source_copy_version_id, organization_id) REFERENCES copy_versions(id, organization_id),
  FOREIGN KEY (finding_id, organization_id) REFERENCES copy_quality_findings(id, organization_id),
  FOREIGN KEY (output_copy_version_id, organization_id) REFERENCES copy_versions(id, organization_id),
  FOREIGN KEY (quality_run_id, organization_id) REFERENCES copy_quality_runs(id, organization_id)
);

CREATE TABLE copy_quality_idempotency_receipts (
  receipt_key text PRIMARY KEY,
  payload_fingerprint text NOT NULL,
  quality_run_id uuid REFERENCES copy_quality_runs(id),
  resolution_id uuid REFERENCES copy_quality_finding_resolutions(id),
  rewrite_job_id uuid REFERENCES copy_rewrite_jobs(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE copy_quality_audit_events (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  actor_member_id text REFERENCES identity_members(id),
  event_type text NOT NULL,
  copy_version_id uuid,
  quality_run_id uuid,
  quality_result_id uuid,
  quality_finding_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX copy_quality_one_active_run_idx
  ON copy_quality_runs(organization_id, copy_version_id, profile_version, rule_version)
  WHERE status IN ('queued','running');
CREATE INDEX copy_quality_runs_claim_idx ON copy_quality_runs(status, created_at);
CREATE INDEX copy_quality_findings_result_idx ON copy_quality_findings(quality_result_id, created_at);
CREATE INDEX copy_quality_resolutions_finding_idx ON copy_quality_finding_resolutions(quality_finding_id, created_at);
CREATE INDEX copy_rewrite_jobs_claim_idx ON copy_rewrite_jobs(status, created_at);

CREATE FUNCTION copy_quality_preserve_immutable_record() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'copy quality record is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER copy_quality_results_immutable
BEFORE UPDATE OR DELETE ON copy_quality_results
FOR EACH ROW EXECUTE FUNCTION copy_quality_preserve_immutable_record();

CREATE TRIGGER copy_quality_findings_immutable
BEFORE UPDATE OR DELETE ON copy_quality_findings
FOR EACH ROW EXECUTE FUNCTION copy_quality_preserve_immutable_record();

CREATE TRIGGER copy_quality_resolutions_append_only
BEFORE UPDATE OR DELETE ON copy_quality_finding_resolutions
FOR EACH ROW EXECUTE FUNCTION copy_quality_preserve_immutable_record();
