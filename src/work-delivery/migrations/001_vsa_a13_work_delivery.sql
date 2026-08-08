CREATE TABLE work_inspections (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  work_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','passed','rework_required','superseded')),
  revision integer NOT NULL CHECK (revision > 0),
  category text,
  reason text,
  target_upstream_stage text,
  inspected_by_member_id text REFERENCES identity_members(id),
  inspected_at timestamptz NOT NULL,
  superseded_by_inspection_id uuid,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, work_id, revision),
  FOREIGN KEY (work_id, organization_id) REFERENCES works(id, organization_id),
  FOREIGN KEY (superseded_by_inspection_id, organization_id) REFERENCES work_inspections(id, organization_id),
  CHECK (category IS NULL OR category IN ('content_not_as_planned','visual_quality','audio_or_avatar','file_or_format','other')),
  CHECK (target_upstream_stage IS NULL OR target_upstream_stage IN ('video_plan','copy_review','avatar_selection','project_content')),
  CHECK (reason IS NULL OR length(reason) <= 2000),
  CHECK ((status = 'superseded' AND superseded_by_inspection_id IS NOT NULL) OR
         (status <> 'superseded' AND superseded_by_inspection_id IS NULL)),
  CHECK (
    (status IN ('pending','passed') AND category IS NULL AND reason IS NULL AND target_upstream_stage IS NULL)
    OR
    (status = 'rework_required' AND category IS NOT NULL AND reason IS NOT NULL AND length(btrim(reason)) > 0 AND target_upstream_stage IS NOT NULL)
    OR status = 'superseded'
  )
);

CREATE TABLE work_delivery_records (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  work_id uuid NOT NULL,
  delivered_by text NOT NULL REFERENCES identity_members(id),
  delivered_at timestamptz NOT NULL,
  delivery_method text NOT NULL CHECK (delivery_method IN ('manual_transfer','email','enterprise_drive','other')),
  note text,
  recipient_reference text,
  created_at timestamptz NOT NULL,
  UNIQUE (id, organization_id),
  FOREIGN KEY (work_id, organization_id) REFERENCES works(id, organization_id),
  CHECK (note IS NULL OR length(note) <= 2000),
  CHECK (recipient_reference IS NULL OR length(recipient_reference) <= 255)
);

CREATE TABLE work_delivery_idempotency_receipts (
  receipt_key text PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  operation text NOT NULL CHECK (operation IN ('inspection','delivery')),
  payload_fingerprint text NOT NULL,
  work_id uuid NOT NULL,
  inspection_id uuid,
  delivery_id uuid,
  created_at timestamptz NOT NULL,
  CHECK ((operation = 'inspection' AND inspection_id IS NOT NULL AND delivery_id IS NULL) OR
         (operation = 'delivery' AND inspection_id IS NULL AND delivery_id IS NOT NULL)),
  FOREIGN KEY (work_id, organization_id) REFERENCES works(id, organization_id),
  FOREIGN KEY (inspection_id, organization_id) REFERENCES work_inspections(id, organization_id),
  FOREIGN KEY (delivery_id, organization_id) REFERENCES work_delivery_records(id, organization_id)
);

CREATE TABLE work_delivery_audit_events (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  actor_member_id text REFERENCES identity_members(id),
  work_id uuid NOT NULL,
  inspection_id uuid,
  delivery_id uuid,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (work_id, organization_id) REFERENCES works(id, organization_id),
  FOREIGN KEY (inspection_id, organization_id) REFERENCES work_inspections(id, organization_id),
  FOREIGN KEY (delivery_id, organization_id) REFERENCES work_delivery_records(id, organization_id)
);

CREATE TABLE work_delivery_status_ledger (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  work_id uuid NOT NULL,
  inspection_id uuid NOT NULL,
  from_status text,
  to_status text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (work_id, organization_id) REFERENCES works(id, organization_id),
  FOREIGN KEY (inspection_id, organization_id) REFERENCES work_inspections(id, organization_id)
);

CREATE INDEX work_inspections_work_idx ON work_inspections(organization_id, work_id, revision);
CREATE INDEX work_delivery_records_work_idx ON work_delivery_records(organization_id, work_id, delivered_at, id);
CREATE INDEX work_delivery_audit_work_idx ON work_delivery_audit_events(organization_id, work_id, created_at, id);
CREATE INDEX work_delivery_ledger_work_idx ON work_delivery_status_ledger(organization_id, work_id, created_at, id);

CREATE OR REPLACE FUNCTION work_delivery_inspection_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.status = 'superseded' OR NEW.id <> OLD.id OR NEW.organization_id <> OLD.organization_id OR NEW.work_id <> OLD.work_id OR
     NEW.revision <> OLD.revision OR NEW.category IS DISTINCT FROM OLD.category OR NEW.reason IS DISTINCT FROM OLD.reason OR
     NEW.target_upstream_stage IS DISTINCT FROM OLD.target_upstream_stage OR NEW.inspected_by_member_id IS DISTINCT FROM OLD.inspected_by_member_id OR
     NEW.inspected_at IS DISTINCT FROM OLD.inspected_at OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.status <> 'superseded' OR
     NEW.superseded_by_inspection_id IS NULL THEN
    RAISE EXCEPTION 'work inspection history is append-only';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION work_delivery_history_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'work delivery history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER work_inspections_no_history_mutation BEFORE UPDATE OR DELETE ON work_inspections FOR EACH ROW EXECUTE FUNCTION work_delivery_inspection_append_only();
CREATE TRIGGER work_delivery_records_no_mutation BEFORE UPDATE OR DELETE ON work_delivery_records FOR EACH ROW EXECUTE FUNCTION work_delivery_history_append_only();
CREATE TRIGGER work_delivery_receipts_no_mutation BEFORE UPDATE OR DELETE ON work_delivery_idempotency_receipts FOR EACH ROW EXECUTE FUNCTION work_delivery_history_append_only();
CREATE TRIGGER work_delivery_audit_no_mutation BEFORE UPDATE OR DELETE ON work_delivery_audit_events FOR EACH ROW EXECUTE FUNCTION work_delivery_history_append_only();
CREATE TRIGGER work_delivery_ledger_no_mutation BEFORE UPDATE OR DELETE ON work_delivery_status_ledger FOR EACH ROW EXECUTE FUNCTION work_delivery_history_append_only();
