ALTER TABLE asset_assets DROP CONSTRAINT IF EXISTS asset_assets_kind_check;
ALTER TABLE asset_assets
  ADD CONSTRAINT asset_assets_kind_check CHECK (kind IN ('product_image', 'avatar_image', 'work_video', 'appearance_candidate_image'));

CREATE TABLE appearance_capture_requests (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  requested_by_member_id text NOT NULL REFERENCES identity_members(id),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  idempotency_payload text NOT NULL CHECK (char_length(idempotency_payload) > 0),
  upstream_fingerprint text NOT NULL CHECK (char_length(upstream_fingerprint) > 0),
  upstream_snapshot jsonb NOT NULL,
  workspace_revision integer NOT NULL CHECK (workspace_revision >= 0),
  status text NOT NULL CHECK (status IN ('awaiting_authorization', 'queued', 'running', 'succeeded', 'failed', 'cancelled')),
  row_version integer NOT NULL CHECK (row_version > 0),
  status_history jsonb NOT NULL CHECK (jsonb_typeof(status_history) = 'array'),
  authorized_by_member_id text REFERENCES identity_members(id),
  authorized_at timestamptz,
  claimed_by_system_id text,
  max_candidate_generations integer NOT NULL CHECK (max_candidate_generations = 1),
  product_id uuid NOT NULL,
  product_revision_id uuid NOT NULL,
  source_asset_version_id uuid NOT NULL,
  source_asset_kind text NOT NULL,
  source_asset_status text NOT NULL,
  source_asset_version_status text NOT NULL,
  source_asset_media_type text NOT NULL,
  source_asset_size bigint NOT NULL CHECK (source_asset_size > 0),
  source_asset_checksum_sha256 char(64) NOT NULL CHECK (source_asset_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  copy_version_id uuid NOT NULL,
  copy_review_id uuid NOT NULL,
  avatar_selection_id uuid NOT NULL,
  avatar_asset_version_id uuid NOT NULL,
  video_plan_version_id uuid NOT NULL,
  plan_review_id uuid NOT NULL,
  preflight_result_id uuid NOT NULL,
  presentation_size_code text NOT NULL,
  appearance_candidate_id uuid,
  failure_code text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, requested_by_member_id, idempotency_key),
  FOREIGN KEY (source_asset_version_id, organization_id) REFERENCES asset_versions(id, organization_id)
);

CREATE UNIQUE INDEX appearance_capture_active_upstream_unique
  ON appearance_capture_requests (organization_id, upstream_fingerprint)
  WHERE status IN ('awaiting_authorization', 'queued', 'running');
CREATE INDEX appearance_capture_claim_idx
  ON appearance_capture_requests (status, created_at, id);
CREATE INDEX appearance_capture_org_idx
  ON appearance_capture_requests (organization_id, created_at, id);

CREATE TABLE appearance_capture_idempotency_receipts (
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  actor_member_id text NOT NULL REFERENCES identity_members(id),
  operation text NOT NULL CHECK (operation IN ('create', 'authorize', 'cancel')),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  payload_fingerprint text NOT NULL CHECK (char_length(payload_fingerprint) > 0),
  request_id uuid NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, actor_member_id, operation, idempotency_key),
  FOREIGN KEY (request_id, organization_id) REFERENCES appearance_capture_requests(id, organization_id)
);

CREATE TABLE appearance_candidates (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  capture_request_id uuid NOT NULL,
  product_id uuid NOT NULL,
  product_revision_id uuid NOT NULL,
  source_asset_version_id uuid NOT NULL,
  source_asset_media_type text NOT NULL,
  source_asset_size bigint NOT NULL CHECK (source_asset_size > 0),
  source_asset_checksum_sha256 char(64) NOT NULL CHECK (source_asset_checksum_sha256 ~ '^[0-9a-f]{64}$'),
  copy_version_id uuid NOT NULL,
  copy_review_id uuid NOT NULL,
  avatar_selection_id uuid NOT NULL,
  avatar_asset_version_id uuid NOT NULL,
  video_plan_version_id uuid NOT NULL,
  plan_review_id uuid NOT NULL,
  preflight_result_id uuid NOT NULL,
  presentation_size_code text NOT NULL,
  candidate_asset_id uuid NOT NULL,
  candidate_asset_version_id uuid NOT NULL,
  media_type text NOT NULL CHECK (media_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size bigint NOT NULL CHECK (size > 0),
  checksum_sha256 char(64) NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  provider text NOT NULL CHECK (char_length(provider) > 0),
  provider_reference_type text NOT NULL CHECK (char_length(provider_reference_type) > 0),
  provider_reference jsonb NOT NULL CHECK (jsonb_typeof(provider_reference) = 'object'),
  generation_context_version text NOT NULL CHECK (char_length(generation_context_version) > 0),
  created_at timestamptz NOT NULL,
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, capture_request_id),
  FOREIGN KEY (capture_request_id, organization_id) REFERENCES appearance_capture_requests(id, organization_id),
  FOREIGN KEY (candidate_asset_version_id, candidate_asset_id, organization_id) REFERENCES asset_versions(id, asset_id, organization_id)
);

ALTER TABLE appearance_capture_requests
  ADD CONSTRAINT appearance_capture_candidate_fk
  FOREIGN KEY (appearance_candidate_id, organization_id) REFERENCES appearance_candidates(id, organization_id);

CREATE TABLE appearance_candidate_states (
  candidate_id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('available', 'candidate_unavailable', 'upstream_changed', 'reference_unavailable', 'superseded')),
  row_version integer NOT NULL CHECK (row_version > 0),
  reason_code text,
  observed_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  superseded_by_candidate_id uuid,
  FOREIGN KEY (candidate_id, organization_id) REFERENCES appearance_candidates(id, organization_id),
  FOREIGN KEY (superseded_by_candidate_id, organization_id) REFERENCES appearance_candidates(id, organization_id),
  CHECK ((state = 'superseded') = (superseded_by_candidate_id IS NOT NULL))
);

CREATE TABLE appearance_provider_reference_observations (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  candidate_id uuid NOT NULL,
  reference_fingerprint char(64) NOT NULL CHECK (reference_fingerprint ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('available', 'unavailable', 'unknown')),
  method text NOT NULL CHECK (char_length(method) > 0),
  seam_version text NOT NULL CHECK (char_length(seam_version) > 0),
  policy_version text NOT NULL CHECK (char_length(policy_version) > 0),
  observed_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  reason_code text,
  created_at timestamptz NOT NULL,
  UNIQUE (id, organization_id),
  FOREIGN KEY (candidate_id, organization_id) REFERENCES appearance_candidates(id, organization_id),
  CHECK (valid_until >= observed_at)
);

CREATE INDEX appearance_candidate_state_org_idx ON appearance_candidate_states(organization_id, state, updated_at, candidate_id);
CREATE INDEX appearance_observation_candidate_idx ON appearance_provider_reference_observations(organization_id, candidate_id, created_at, id);

CREATE TABLE appearance_capture_events (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  capture_request_id uuid NOT NULL,
  actor_member_id text REFERENCES identity_members(id),
  actor_system_id text,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (capture_request_id, organization_id) REFERENCES appearance_capture_requests(id, organization_id)
);

CREATE TABLE appearance_capture_audit_events (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  capture_request_id uuid NOT NULL,
  actor_member_id text REFERENCES identity_members(id),
  actor_system_id text,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (capture_request_id, organization_id) REFERENCES appearance_capture_requests(id, organization_id)
);

CREATE INDEX appearance_capture_events_request_idx ON appearance_capture_events(organization_id, capture_request_id, created_at, id);
CREATE INDEX appearance_capture_audit_request_idx ON appearance_capture_audit_events(organization_id, capture_request_id, created_at, id);

CREATE FUNCTION appearance_capture_request_transition_guard() RETURNS trigger AS $$
BEGIN
  IF NEW.row_version <= OLD.row_version THEN
    RAISE EXCEPTION 'capture request revision must increase';
  END IF;
  IF OLD.status = 'awaiting_authorization' AND NEW.status NOT IN ('awaiting_authorization', 'queued', 'cancelled') THEN
    RAISE EXCEPTION 'capture request state cannot move backward';
  END IF;
  IF OLD.status = 'queued' AND NEW.status NOT IN ('queued', 'running', 'cancelled') THEN
    RAISE EXCEPTION 'capture request state cannot move backward';
  END IF;
  IF OLD.status = 'running' AND NEW.status NOT IN ('running', 'succeeded', 'failed') THEN
    RAISE EXCEPTION 'capture request state cannot move backward';
  END IF;
  IF OLD.status IN ('succeeded', 'failed', 'cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'terminal request state is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER appearance_capture_request_transition_guard
BEFORE UPDATE ON appearance_capture_requests
FOR EACH ROW EXECUTE FUNCTION appearance_capture_request_transition_guard();

CREATE FUNCTION appearance_candidate_state_transition_guard() RETURNS trigger AS $$
DECLARE
  old_rank integer;
  new_rank integer;
BEGIN
  IF NEW.row_version <= OLD.row_version THEN
    RAISE EXCEPTION 'candidate state revision must increase';
  END IF;
  IF OLD.state = 'superseded' AND NEW.state <> 'superseded' THEN
    RAISE EXCEPTION 'candidate state cannot regress';
  END IF;
  old_rank := CASE OLD.state WHEN 'available' THEN 1 WHEN 'reference_unavailable' THEN 2 WHEN 'candidate_unavailable' THEN 3 WHEN 'upstream_changed' THEN 4 WHEN 'superseded' THEN 5 END;
  new_rank := CASE NEW.state WHEN 'available' THEN 1 WHEN 'reference_unavailable' THEN 2 WHEN 'candidate_unavailable' THEN 3 WHEN 'upstream_changed' THEN 4 WHEN 'superseded' THEN 5 END;
  IF new_rank < old_rank THEN
    RAISE EXCEPTION 'candidate state cannot regress';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER appearance_candidate_state_transition_guard
BEFORE UPDATE ON appearance_candidate_states
FOR EACH ROW EXECUTE FUNCTION appearance_candidate_state_transition_guard();

CREATE FUNCTION appearance_fidelity_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'appearance fidelity history is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER appearance_candidates_append_only
BEFORE UPDATE OR DELETE ON appearance_candidates
FOR EACH ROW EXECUTE FUNCTION appearance_fidelity_append_only();
CREATE TRIGGER appearance_provider_observations_append_only
BEFORE UPDATE OR DELETE ON appearance_provider_reference_observations
FOR EACH ROW EXECUTE FUNCTION appearance_fidelity_append_only();
CREATE TRIGGER appearance_capture_events_append_only
BEFORE UPDATE OR DELETE ON appearance_capture_events
FOR EACH ROW EXECUTE FUNCTION appearance_fidelity_append_only();
CREATE TRIGGER appearance_capture_audit_events_append_only
BEFORE UPDATE OR DELETE ON appearance_capture_audit_events
FOR EACH ROW EXECUTE FUNCTION appearance_fidelity_append_only();
CREATE TRIGGER appearance_capture_receipts_append_only
BEFORE UPDATE OR DELETE ON appearance_capture_idempotency_receipts
FOR EACH ROW EXECUTE FUNCTION appearance_fidelity_append_only();
