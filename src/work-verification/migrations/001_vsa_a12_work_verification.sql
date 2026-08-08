ALTER TABLE asset_assets DROP CONSTRAINT IF EXISTS asset_assets_kind_check;
ALTER TABLE asset_assets ADD CONSTRAINT asset_assets_kind_check CHECK (kind IN ('product_image', 'work_video'));

ALTER TABLE manual_execution_candidates
  ADD COLUMN IF NOT EXISTS verification_status text,
  ADD COLUMN IF NOT EXISTS verification_job_id uuid,
  ADD COLUMN IF NOT EXISTS verification_failure_kind text,
  ADD COLUMN IF NOT EXISTS verification_failure_code text,
  ADD COLUMN IF NOT EXISTS verification_updated_at timestamptz;
ALTER TABLE manual_execution_candidates
  ADD CONSTRAINT manual_execution_candidate_verification_status_check
  CHECK (verification_status IS NULL OR verification_status IN ('queued','running','passed','failed','requires_action'));
ALTER TABLE manual_execution_candidates
  ADD CONSTRAINT manual_execution_candidate_verification_failure_kind_check
  CHECK (verification_failure_kind IS NULL OR verification_failure_kind IN ('business','technical'));

CREATE TABLE work_verification_jobs (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  type text NOT NULL CHECK (type = 'artifact_verification'),
  production_order_id uuid NOT NULL,
  execution_attempt_id uuid NOT NULL,
  report_id uuid NOT NULL,
  candidate_id uuid NOT NULL,
  primary_output_checksum char(64) NOT NULL CHECK (primary_output_checksum ~ '^[0-9a-f]{64}$'),
  requested_by_member_id text NOT NULL REFERENCES identity_members(id),
  requested_by_role text NOT NULL CHECK (requested_by_role IN ('member','admin')),
  status text NOT NULL CHECK (status IN ('queued','running','succeeded','failed')),
  verification_status text NOT NULL CHECK (verification_status IN ('queued','running','passed','failed','requires_action')),
  failure_kind text CHECK (failure_kind IS NULL OR failure_kind IN ('business','technical')),
  failure_code text,
  failure_reason text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts > 0),
  lease_token uuid,
  lease_expires_at timestamptz,
  started_at timestamptz,
  heartbeat_at timestamptz,
  completed_at timestamptz,
  work_id uuid,
  receipt_key text NOT NULL,
  checks jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, production_order_id, execution_attempt_id, primary_output_checksum),
  FOREIGN KEY (production_order_id, organization_id) REFERENCES production_orders(id, organization_id),
  FOREIGN KEY (execution_attempt_id, organization_id) REFERENCES manual_execution_attempts(id, organization_id),
  FOREIGN KEY (report_id, organization_id) REFERENCES manual_execution_reports(id, organization_id),
  FOREIGN KEY (candidate_id, organization_id) REFERENCES manual_execution_candidates(id, organization_id)
);

CREATE TABLE works (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  production_order_id uuid NOT NULL,
  execution_attempt_id uuid NOT NULL,
  manual_execution_report_id uuid NOT NULL,
  package_id uuid NOT NULL,
  package_version integer NOT NULL CHECK (package_version > 0),
  manifest_hash text NOT NULL,
  video_plan_version_id uuid NOT NULL,
  copy_version_id uuid NOT NULL,
  avatar_asset_version_id uuid NOT NULL,
  production_config_snapshot jsonb NOT NULL,
  package_manifest_snapshot jsonb NOT NULL,
  primary_asset_version_id uuid NOT NULL,
  primary_candidate_id uuid NOT NULL,
  primary_output_checksum char(64) NOT NULL CHECK (primary_output_checksum ~ '^[0-9a-f]{64}$'),
  primary_output_media_type text NOT NULL,
  primary_output_size bigint NOT NULL CHECK (primary_output_size > 0),
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','unavailable','withdrawn')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, production_order_id),
  UNIQUE (organization_id, production_order_id, execution_attempt_id, primary_output_checksum),
  FOREIGN KEY (production_order_id, organization_id) REFERENCES production_orders(id, organization_id),
  FOREIGN KEY (execution_attempt_id, organization_id) REFERENCES manual_execution_attempts(id, organization_id),
  FOREIGN KEY (manual_execution_report_id, organization_id) REFERENCES manual_execution_reports(id, organization_id),
  FOREIGN KEY (package_id, organization_id) REFERENCES manual_handoff_packages(id, organization_id),
  FOREIGN KEY (video_plan_version_id, organization_id) REFERENCES video_plan_versions(id, organization_id),
  FOREIGN KEY (copy_version_id, organization_id) REFERENCES copy_versions(id, organization_id),
  FOREIGN KEY (avatar_asset_version_id, organization_id) REFERENCES avatar_asset_versions(id, organization_id),
  FOREIGN KEY (primary_asset_version_id, organization_id) REFERENCES asset_versions(id, organization_id),
  FOREIGN KEY (primary_candidate_id, organization_id) REFERENCES manual_execution_candidates(id, organization_id)
);

ALTER TABLE work_verification_jobs
  ADD CONSTRAINT work_verification_job_work_fk
  FOREIGN KEY (work_id, organization_id) REFERENCES works(id, organization_id);

CREATE TABLE work_verification_idempotency_receipts (
  receipt_key text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  payload_fingerprint text NOT NULL,
  job_id uuid NOT NULL,
  work_id uuid,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (job_id, organization_id) REFERENCES work_verification_jobs(id, organization_id),
  FOREIGN KEY (work_id, organization_id) REFERENCES works(id, organization_id)
);

CREATE TABLE work_verification_audit_events (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  actor_member_id text REFERENCES identity_members(id),
  production_order_id uuid NOT NULL,
  job_id uuid,
  work_id uuid,
  candidate_id uuid,
  asset_version_id uuid,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (production_order_id, organization_id) REFERENCES production_orders(id, organization_id),
  FOREIGN KEY (job_id, organization_id) REFERENCES work_verification_jobs(id, organization_id),
  FOREIGN KEY (work_id, organization_id) REFERENCES works(id, organization_id),
  FOREIGN KEY (candidate_id, organization_id) REFERENCES manual_execution_candidates(id, organization_id),
  FOREIGN KEY (asset_version_id, organization_id) REFERENCES asset_versions(id, organization_id)
);

CREATE TABLE work_verification_status_ledger (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  job_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  failure_kind text,
  reason text,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (job_id, organization_id) REFERENCES work_verification_jobs(id, organization_id)
);

CREATE INDEX work_verification_jobs_claim_idx ON work_verification_jobs(status, lease_expires_at, created_at, id);
CREATE INDEX work_verification_jobs_order_idx ON work_verification_jobs(organization_id, production_order_id, created_at, id);
CREATE INDEX works_org_created_idx ON works(organization_id, created_at, id);
CREATE INDEX work_verification_audit_order_idx ON work_verification_audit_events(organization_id, production_order_id, created_at, id);
CREATE INDEX work_verification_ledger_job_idx ON work_verification_status_ledger(organization_id, job_id, created_at, id);

CREATE FUNCTION work_verification_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'work verification history is append-only'; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER works_no_delete_or_mutation BEFORE UPDATE OR DELETE ON works FOR EACH ROW EXECUTE FUNCTION work_verification_append_only();
CREATE TRIGGER work_verification_audit_no_change BEFORE UPDATE OR DELETE ON work_verification_audit_events FOR EACH ROW EXECUTE FUNCTION work_verification_append_only();
CREATE TRIGGER work_verification_ledger_no_change BEFORE UPDATE OR DELETE ON work_verification_status_ledger FOR EACH ROW EXECUTE FUNCTION work_verification_append_only();
