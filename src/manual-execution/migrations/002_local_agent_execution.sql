ALTER TABLE manual_execution_attempts
  ALTER COLUMN operator_id DROP NOT NULL;

ALTER TABLE manual_execution_attempts
  ADD COLUMN executor_agent_id text,
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN heartbeat_at timestamptz,
  ADD COLUMN progress_phase text;

ALTER TABLE manual_execution_attempts
  DROP CONSTRAINT IF EXISTS manual_execution_attempts_executor_type_check;

ALTER TABLE manual_execution_attempts
  ADD CONSTRAINT manual_execution_attempts_executor_type_check
  CHECK (executor_type IN ('manual', 'local_agent'));

ALTER TABLE manual_execution_attempts
  ADD CONSTRAINT manual_execution_attempts_identity_check
  CHECK ((executor_type = 'manual' AND operator_id IS NOT NULL AND executor_agent_id IS NULL)
    OR (executor_type = 'local_agent' AND operator_id IS NULL AND executor_agent_id IS NOT NULL));

ALTER TABLE manual_execution_audit_events
  ADD COLUMN actor_agent_id text;

ALTER TABLE manual_execution_status_ledger
  ADD COLUMN actor_agent_id text;

CREATE INDEX manual_execution_attempt_agent_idx
  ON manual_execution_attempts(organization_id, executor_agent_id, status, lease_expires_at);

CREATE OR REPLACE FUNCTION manual_execution_attempt_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.id = NEW.id AND OLD.organization_id = NEW.organization_id AND
    OLD.production_order_id = NEW.production_order_id AND OLD.package_id = NEW.package_id AND
    OLD.package_version = NEW.package_version AND OLD.manifest_hash = NEW.manifest_hash AND
    OLD.package_hash IS NOT DISTINCT FROM NEW.package_hash AND
    OLD.executor_type = NEW.executor_type AND OLD.operator_id IS NOT DISTINCT FROM NEW.operator_id AND
    OLD.executor_agent_id IS NOT DISTINCT FROM NEW.executor_agent_id AND
    OLD.claimed_at = NEW.claimed_at AND OLD.created_at = NEW.created_at AND
    NEW.row_version = OLD.row_version + 1 THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'manual execution attempt binding is immutable';
END;
$$ LANGUAGE plpgsql;
