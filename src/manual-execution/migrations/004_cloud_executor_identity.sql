ALTER TABLE manual_execution_attempts
  ADD COLUMN executor_cloud_id text;

ALTER TABLE manual_execution_attempts
  DROP CONSTRAINT IF EXISTS manual_execution_attempts_executor_type_check,
  DROP CONSTRAINT IF EXISTS manual_execution_attempts_identity_check;

ALTER TABLE manual_execution_attempts
  ADD CONSTRAINT manual_execution_attempts_executor_type_check
  CHECK (executor_type IN ('manual', 'local_agent', 'cloud_executor')),
  ADD CONSTRAINT manual_execution_attempts_identity_check
  CHECK (
    (executor_type = 'manual' AND operator_id IS NOT NULL AND executor_agent_id IS NULL AND executor_cloud_id IS NULL)
    OR (executor_type = 'local_agent' AND operator_id IS NULL AND executor_agent_id IS NOT NULL AND executor_cloud_id IS NULL)
    OR (executor_type = 'cloud_executor' AND operator_id IS NULL AND executor_agent_id IS NULL AND executor_cloud_id IS NOT NULL)
  );

CREATE INDEX manual_execution_attempt_cloud_idx
  ON manual_execution_attempts(organization_id, executor_cloud_id, status, lease_expires_at);

ALTER TABLE manual_execution_candidates
  ADD COLUMN uploaded_by_cloud_executor_id text;

ALTER TABLE manual_execution_candidates
  DROP CONSTRAINT IF EXISTS manual_execution_candidate_uploader_identity_check;

ALTER TABLE manual_execution_candidates
  ADD CONSTRAINT manual_execution_candidate_uploader_identity_check
  CHECK (num_nonnulls(uploaded_by_member_id, uploaded_by_agent_id, uploaded_by_cloud_executor_id) = 1);

ALTER TABLE manual_execution_reports
  ADD COLUMN submitted_by_cloud_executor_id text;

ALTER TABLE manual_execution_reports
  DROP CONSTRAINT IF EXISTS manual_execution_report_submitter_identity_check;

ALTER TABLE manual_execution_reports
  ADD CONSTRAINT manual_execution_report_submitter_identity_check
  CHECK (num_nonnulls(submitted_by, submitted_by_agent_id, submitted_by_cloud_executor_id) = 1);

ALTER TABLE manual_execution_audit_events
  ADD COLUMN actor_cloud_executor_id text;

ALTER TABLE manual_execution_status_ledger
  ADD COLUMN actor_cloud_executor_id text;

CREATE OR REPLACE FUNCTION manual_execution_attempt_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.id = NEW.id AND OLD.organization_id = NEW.organization_id AND
    OLD.production_order_id = NEW.production_order_id AND OLD.package_id = NEW.package_id AND
    OLD.package_version = NEW.package_version AND OLD.manifest_hash = NEW.manifest_hash AND
    OLD.package_hash IS NOT DISTINCT FROM NEW.package_hash AND
    OLD.executor_type = NEW.executor_type AND OLD.operator_id IS NOT DISTINCT FROM NEW.operator_id AND
    OLD.executor_agent_id IS NOT DISTINCT FROM NEW.executor_agent_id AND
    OLD.executor_cloud_id IS NOT DISTINCT FROM NEW.executor_cloud_id AND
    OLD.claimed_at = NEW.claimed_at AND OLD.created_at = NEW.created_at AND
    NEW.row_version = OLD.row_version + 1 THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'manual execution attempt binding is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION manual_execution_candidate_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.id = NEW.id AND OLD.organization_id = NEW.organization_id AND
    OLD.production_order_id = NEW.production_order_id AND OLD.execution_attempt_id = NEW.execution_attempt_id AND
    OLD.package_id = NEW.package_id AND OLD.package_version = NEW.package_version AND
    OLD.manifest_hash = NEW.manifest_hash AND OLD.role = NEW.role AND
    OLD.original_filename = NEW.original_filename AND OLD.media_type = NEW.media_type AND
    OLD.size = NEW.size AND OLD.checksum = NEW.checksum AND
    (OLD.upload_token_digest = NEW.upload_token_digest OR (OLD.status = 'upload_pending' AND NEW.status = 'upload_pending')) AND
    OLD.object_key = NEW.object_key AND OLD.uploaded_by_member_id IS NOT DISTINCT FROM NEW.uploaded_by_member_id AND
    OLD.uploaded_by_agent_id IS NOT DISTINCT FROM NEW.uploaded_by_agent_id AND
    OLD.uploaded_by_cloud_executor_id IS NOT DISTINCT FROM NEW.uploaded_by_cloud_executor_id AND
    OLD.created_at = NEW.created_at AND NEW.row_version = OLD.row_version + 1 THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'manual execution candidate binding is immutable';
END;
$$ LANGUAGE plpgsql;
