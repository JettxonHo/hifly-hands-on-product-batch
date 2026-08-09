ALTER TABLE manual_execution_candidates
  ALTER COLUMN uploaded_by_member_id DROP NOT NULL,
  ADD COLUMN uploaded_by_agent_id text;

ALTER TABLE manual_execution_candidates
  ADD CONSTRAINT manual_execution_candidate_uploader_identity_check
  CHECK ((uploaded_by_member_id IS NOT NULL) <> (uploaded_by_agent_id IS NOT NULL));

ALTER TABLE manual_execution_reports
  ALTER COLUMN submitted_by DROP NOT NULL,
  ADD COLUMN submitted_by_agent_id text;

ALTER TABLE manual_execution_reports
  ADD CONSTRAINT manual_execution_report_submitter_identity_check
  CHECK ((submitted_by IS NOT NULL) <> (submitted_by_agent_id IS NOT NULL));

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
    OLD.uploaded_by_agent_id IS NOT DISTINCT FROM NEW.uploaded_by_agent_id AND OLD.created_at = NEW.created_at AND
    NEW.row_version = OLD.row_version + 1 THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'manual execution candidate binding is immutable';
END;
$$ LANGUAGE plpgsql;
