CREATE TABLE video_plan_versions (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  product_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL CHECK (status IN ('draft','frozen','superseded')),
  row_version integer NOT NULL CHECK (row_version > 0),
  upstream_snapshot jsonb NOT NULL,
  capability_config_snapshot jsonb NOT NULL,
  output_instructions text NOT NULL CHECK (length(output_instructions) > 0),
  parent_plan_version_id uuid,
  created_by_member_id text NOT NULL REFERENCES identity_members(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  frozen_at timestamptz,
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, product_id, version_number),
  FOREIGN KEY (product_id, organization_id) REFERENCES project_content_products(id, organization_id),
  FOREIGN KEY (parent_plan_version_id, organization_id) REFERENCES video_plan_versions(id, organization_id)
);

CREATE TABLE video_plan_heads (
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  product_id uuid NOT NULL,
  current_plan_id uuid,
  row_version integer NOT NULL CHECK (row_version >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, product_id),
  FOREIGN KEY (product_id, organization_id) REFERENCES project_content_products(id, organization_id),
  FOREIGN KEY (current_plan_id, organization_id) REFERENCES video_plan_versions(id, organization_id)
);

CREATE TABLE video_preflight_runs (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  video_plan_version_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  input_snapshot jsonb NOT NULL,
  preflight_result_id uuid,
  failure_code text,
  lease_token text,
  created_by_member_id text NOT NULL REFERENCES identity_members(id),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, organization_id),
  FOREIGN KEY (video_plan_version_id, organization_id) REFERENCES video_plan_versions(id, organization_id)
);

CREATE TABLE video_preflight_results (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  video_plan_version_id uuid NOT NULL,
  preflight_run_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('passed','warning','blocked','invalidated')),
  groups_json jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  invalidated_at timestamptz,
  invalidation_reason text,
  UNIQUE (id, organization_id),
  UNIQUE (preflight_run_id),
  FOREIGN KEY (video_plan_version_id, organization_id) REFERENCES video_plan_versions(id, organization_id),
  FOREIGN KEY (preflight_run_id, organization_id) REFERENCES video_preflight_runs(id, organization_id)
);
ALTER TABLE video_preflight_runs ADD CONSTRAINT video_preflight_result_fk
  FOREIGN KEY (preflight_result_id, organization_id) REFERENCES video_preflight_results(id, organization_id);

CREATE TABLE video_plan_reviews (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  video_plan_version_id uuid NOT NULL,
  author_member_id text NOT NULL REFERENCES identity_members(id),
  created_at timestamptz NOT NULL,
  UNIQUE (id, organization_id),
  FOREIGN KEY (video_plan_version_id, organization_id) REFERENCES video_plan_versions(id, organization_id)
);
CREATE TABLE video_plan_review_heads (
  plan_review_id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  video_plan_version_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','approved','changes_requested','revoked')),
  row_version integer NOT NULL CHECK (row_version > 0),
  reviewer_member_id text REFERENCES identity_members(id),
  review_mode text CHECK (review_mode IN ('self_review','standard')),
  decision_reason text,
  updated_at timestamptz NOT NULL,
  decided_at timestamptz,
  revoked_at timestamptz,
  revoke_reason_code text,
  FOREIGN KEY (plan_review_id, organization_id) REFERENCES video_plan_reviews(id, organization_id),
  FOREIGN KEY (video_plan_version_id, organization_id) REFERENCES video_plan_versions(id, organization_id)
);
CREATE UNIQUE INDEX video_plan_one_pending_review_idx ON video_plan_review_heads(organization_id,video_plan_version_id) WHERE status='pending';
CREATE TABLE video_plan_review_events (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  plan_review_id uuid NOT NULL,
  video_plan_version_id uuid NOT NULL,
  actor_member_id text REFERENCES identity_members(id),
  from_status text NOT NULL CHECK (from_status IN ('not_submitted','pending','approved')),
  to_status text NOT NULL CHECK (to_status IN ('pending','approved','changes_requested','revoked')),
  reason text,
  reason_code text,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (plan_review_id, organization_id) REFERENCES video_plan_reviews(id, organization_id)
);

CREATE TABLE video_planning_idempotency_receipts (
  receipt_key text PRIMARY KEY,
  payload_fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE video_planning_audit_events (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  actor_member_id text REFERENCES identity_members(id),
  event_type text NOT NULL,
  video_plan_version_id uuid,
  plan_review_id uuid,
  preflight_run_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE INDEX video_plan_versions_product_idx ON video_plan_versions(organization_id,product_id,version_number);
CREATE INDEX video_preflight_runs_plan_idx ON video_preflight_runs(organization_id,video_plan_version_id,created_at);
CREATE INDEX video_plan_reviews_plan_idx ON video_plan_reviews(organization_id,video_plan_version_id,created_at);

CREATE FUNCTION video_plan_preserve_version() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status IN ('draft','frozen','superseded') AND
    OLD.upstream_snapshot = NEW.upstream_snapshot AND OLD.capability_config_snapshot = NEW.capability_config_snapshot AND
    OLD.parent_plan_version_id IS NOT DISTINCT FROM NEW.parent_plan_version_id THEN RETURN NEW; END IF;
  IF OLD.status = 'frozen' AND NEW.status = 'superseded' AND
    OLD.upstream_snapshot = NEW.upstream_snapshot AND OLD.capability_config_snapshot = NEW.capability_config_snapshot AND
    OLD.output_instructions = NEW.output_instructions THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'video plan version is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER video_plan_versions_guard BEFORE UPDATE ON video_plan_versions FOR EACH ROW EXECUTE FUNCTION video_plan_preserve_version();
CREATE FUNCTION video_plan_no_delete() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'video planning history is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER video_plan_versions_no_delete BEFORE DELETE ON video_plan_versions FOR EACH ROW EXECUTE FUNCTION video_plan_no_delete();
CREATE TRIGGER video_preflight_results_no_delete BEFORE DELETE ON video_preflight_results FOR EACH ROW EXECUTE FUNCTION video_plan_no_delete();
CREATE TRIGGER video_plan_reviews_no_delete BEFORE DELETE ON video_plan_reviews FOR EACH ROW EXECUTE FUNCTION video_plan_no_delete();
CREATE TRIGGER video_plan_review_events_no_delete BEFORE UPDATE OR DELETE ON video_plan_review_events FOR EACH ROW EXECUTE FUNCTION video_plan_no_delete();
