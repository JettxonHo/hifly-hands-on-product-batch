CREATE TABLE manual_execution_attempts (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  production_order_id uuid NOT NULL,
  package_id uuid NOT NULL,
  package_version integer NOT NULL CHECK (package_version > 0),
  manifest_hash text NOT NULL,
  package_hash text,
  executor_type text NOT NULL CHECK (executor_type = 'manual'),
  operator_id text NOT NULL REFERENCES identity_members(id),
  status text NOT NULL CHECK (status IN ('claimed','running','succeeded','requires_action','failed','cancel_requested','cancelled','superseded')),
  row_version integer NOT NULL CHECK (row_version > 0),
  claimed_at timestamptz NOT NULL,
  started_at timestamptz,
  completed_at timestamptz,
  failure_category text,
  failure_stage text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  status_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (id, organization_id),
  FOREIGN KEY (production_order_id, organization_id) REFERENCES production_orders(id, organization_id),
  FOREIGN KEY (package_id, organization_id) REFERENCES manual_handoff_packages(id, organization_id)
);

CREATE UNIQUE INDEX manual_execution_one_active_attempt_per_order
  ON manual_execution_attempts(organization_id, production_order_id)
  WHERE status IN ('claimed', 'running');
CREATE INDEX manual_execution_attempt_order_idx
  ON manual_execution_attempts(organization_id, production_order_id, created_at, id);

CREATE TABLE manual_execution_candidates (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  production_order_id uuid NOT NULL,
  execution_attempt_id uuid NOT NULL,
  package_id uuid NOT NULL,
  package_version integer NOT NULL CHECK (package_version > 0),
  manifest_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('primary_video','supporting_output')),
  original_filename text NOT NULL CHECK (char_length(original_filename) BETWEEN 1 AND 255),
  media_type text NOT NULL,
  size bigint NOT NULL CHECK (size > 0),
  checksum text NOT NULL CHECK (checksum ~ '^[0-9a-fA-F]{64}$'),
  status text NOT NULL CHECK (status IN ('upload_pending','uploaded','pending_verification','removed')),
  row_version integer NOT NULL CHECK (row_version > 0),
  upload_token_digest text NOT NULL,
  object_key text NOT NULL,
  uploaded_by_member_id text NOT NULL REFERENCES identity_members(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  uploaded_at timestamptz,
  UNIQUE (id, organization_id),
  FOREIGN KEY (production_order_id, organization_id) REFERENCES production_orders(id, organization_id),
  FOREIGN KEY (execution_attempt_id, organization_id) REFERENCES manual_execution_attempts(id, organization_id),
  FOREIGN KEY (package_id, organization_id) REFERENCES manual_handoff_packages(id, organization_id)
);
CREATE UNIQUE INDEX manual_execution_one_primary_candidate
  ON manual_execution_candidates(organization_id, execution_attempt_id, role)
  WHERE role = 'primary_video' AND status <> 'removed';
CREATE INDEX manual_execution_candidate_token_idx
  ON manual_execution_candidates(organization_id, upload_token_digest);
CREATE INDEX manual_execution_candidate_attempt_idx
  ON manual_execution_candidates(organization_id, execution_attempt_id, created_at, id);

CREATE TABLE manual_execution_reports (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  report_version integer NOT NULL CHECK (report_version > 0),
  production_order_id uuid NOT NULL,
  execution_attempt_id uuid NOT NULL,
  package_id uuid NOT NULL,
  package_version integer NOT NULL CHECK (package_version > 0),
  manifest_hash text NOT NULL,
  submitted_by text NOT NULL REFERENCES identity_members(id),
  submitted_at timestamptz NOT NULL,
  supersedes_report_id uuid,
  outcome text NOT NULL CHECK (outcome IN ('completed','requires_action','failed','cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  operator_note text NOT NULL DEFAULT '',
  deviations jsonb NOT NULL DEFAULT '[]'::jsonb,
  primary_output jsonb,
  supporting_outputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_category text,
  failure_stage text,
  requires_action_reason text,
  retryability text CHECK (retryability IS NULL OR retryability IN ('retryable','not_retryable')),
  upstream_return_target text,
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, execution_attempt_id, report_version),
  FOREIGN KEY (production_order_id, organization_id) REFERENCES production_orders(id, organization_id),
  FOREIGN KEY (execution_attempt_id, organization_id) REFERENCES manual_execution_attempts(id, organization_id),
  FOREIGN KEY (package_id, organization_id) REFERENCES manual_handoff_packages(id, organization_id),
  FOREIGN KEY (supersedes_report_id, organization_id) REFERENCES manual_execution_reports(id, organization_id)
);
CREATE INDEX manual_execution_report_attempt_idx
  ON manual_execution_reports(organization_id, execution_attempt_id, report_version, submitted_at, id);

CREATE TABLE manual_execution_idempotency_receipts (
  receipt_key text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  payload_fingerprint text NOT NULL,
  attempt_id uuid,
  candidate_id uuid,
  report_id uuid,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (attempt_id, organization_id) REFERENCES manual_execution_attempts(id, organization_id),
  FOREIGN KEY (candidate_id, organization_id) REFERENCES manual_execution_candidates(id, organization_id),
  FOREIGN KEY (report_id, organization_id) REFERENCES manual_execution_reports(id, organization_id)
);

CREATE TABLE manual_execution_audit_events (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  actor_member_id text REFERENCES identity_members(id),
  production_order_id uuid NOT NULL,
  execution_attempt_id uuid,
  candidate_id uuid,
  report_id uuid,
  package_id uuid,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (production_order_id, organization_id) REFERENCES production_orders(id, organization_id),
  FOREIGN KEY (execution_attempt_id, organization_id) REFERENCES manual_execution_attempts(id, organization_id),
  FOREIGN KEY (candidate_id, organization_id) REFERENCES manual_execution_candidates(id, organization_id),
  FOREIGN KEY (report_id, organization_id) REFERENCES manual_execution_reports(id, organization_id),
  FOREIGN KEY (package_id, organization_id) REFERENCES manual_handoff_packages(id, organization_id)
);

CREATE TABLE manual_execution_status_ledger (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  execution_attempt_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_member_id text REFERENCES identity_members(id),
  reason text,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (execution_attempt_id, organization_id) REFERENCES manual_execution_attempts(id, organization_id)
);

CREATE INDEX manual_execution_audit_attempt_idx
  ON manual_execution_audit_events(organization_id, execution_attempt_id, created_at, id);
CREATE INDEX manual_execution_ledger_attempt_idx
  ON manual_execution_status_ledger(organization_id, execution_attempt_id, created_at, id);

CREATE FUNCTION manual_execution_attempt_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.id = NEW.id AND OLD.organization_id = NEW.organization_id AND
    OLD.production_order_id = NEW.production_order_id AND OLD.package_id = NEW.package_id AND
    OLD.package_version = NEW.package_version AND OLD.manifest_hash = NEW.manifest_hash AND
    OLD.package_hash IS NOT DISTINCT FROM NEW.package_hash AND
    OLD.executor_type = NEW.executor_type AND OLD.operator_id = NEW.operator_id AND
    OLD.claimed_at = NEW.claimed_at AND OLD.created_at = NEW.created_at AND
    NEW.row_version = OLD.row_version + 1 THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'manual execution attempt binding is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER manual_execution_attempts_guard BEFORE UPDATE ON manual_execution_attempts FOR EACH ROW EXECUTE FUNCTION manual_execution_attempt_guard();

CREATE FUNCTION manual_execution_candidate_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.id = NEW.id AND OLD.organization_id = NEW.organization_id AND
    OLD.production_order_id = NEW.production_order_id AND OLD.execution_attempt_id = NEW.execution_attempt_id AND
    OLD.package_id = NEW.package_id AND OLD.package_version = NEW.package_version AND
    OLD.manifest_hash = NEW.manifest_hash AND OLD.role = NEW.role AND
    OLD.original_filename = NEW.original_filename AND OLD.media_type = NEW.media_type AND
    OLD.size = NEW.size AND OLD.checksum = NEW.checksum AND
    (OLD.upload_token_digest = NEW.upload_token_digest OR (OLD.status = 'upload_pending' AND NEW.status = 'upload_pending')) AND
    OLD.object_key = NEW.object_key AND OLD.uploaded_by_member_id = NEW.uploaded_by_member_id AND
    OLD.created_at = NEW.created_at AND NEW.row_version = OLD.row_version + 1 THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'manual execution candidate binding is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER manual_execution_candidates_guard BEFORE UPDATE ON manual_execution_candidates FOR EACH ROW EXECUTE FUNCTION manual_execution_candidate_guard();

CREATE FUNCTION manual_execution_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'manual execution history is append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER manual_execution_attempts_no_delete BEFORE DELETE ON manual_execution_attempts FOR EACH ROW EXECUTE FUNCTION manual_execution_append_only();
CREATE TRIGGER manual_execution_candidates_no_delete BEFORE DELETE ON manual_execution_candidates FOR EACH ROW EXECUTE FUNCTION manual_execution_append_only();
CREATE TRIGGER manual_execution_reports_no_change BEFORE UPDATE OR DELETE ON manual_execution_reports FOR EACH ROW EXECUTE FUNCTION manual_execution_append_only();
CREATE TRIGGER manual_execution_receipts_no_change BEFORE UPDATE OR DELETE ON manual_execution_idempotency_receipts FOR EACH ROW EXECUTE FUNCTION manual_execution_append_only();
CREATE TRIGGER manual_execution_audit_no_change BEFORE UPDATE OR DELETE ON manual_execution_audit_events FOR EACH ROW EXECUTE FUNCTION manual_execution_append_only();
CREATE TRIGGER manual_execution_ledger_no_change BEFORE UPDATE OR DELETE ON manual_execution_status_ledger FOR EACH ROW EXECUTE FUNCTION manual_execution_append_only();
