CREATE TABLE copy_human_reviews (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  copy_version_id uuid NOT NULL,
  author_member_id text NOT NULL REFERENCES identity_members(id),
  quality_result_id uuid NOT NULL,
  product_revision_id uuid NOT NULL,
  profile_version text NOT NULL,
  rule_version text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (id, organization_id),
  FOREIGN KEY (copy_version_id, organization_id) REFERENCES copy_versions(id, organization_id),
  FOREIGN KEY (quality_result_id, organization_id) REFERENCES copy_quality_results(id, organization_id),
  FOREIGN KEY (product_revision_id, organization_id) REFERENCES project_content_product_revisions(id, organization_id)
);

CREATE TABLE copy_human_review_heads (
  human_review_id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  copy_version_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('pending','approved','changes_requested','revoked')),
  row_version integer NOT NULL CHECK (row_version > 0),
  reviewer_member_id text REFERENCES identity_members(id),
  review_mode text CHECK (review_mode IN ('standard','self_review')),
  decision_reason text,
  decided_at timestamptz,
  revoked_at timestamptz,
  revoke_reason text,
  revoke_reason_code text,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (human_review_id, organization_id) REFERENCES copy_human_reviews(id, organization_id),
  FOREIGN KEY (copy_version_id, organization_id) REFERENCES copy_versions(id, organization_id)
);

CREATE UNIQUE INDEX copy_review_one_active_cycle_idx
  ON copy_human_review_heads(organization_id, copy_version_id)
  WHERE status IN ('pending','approved');

CREATE TABLE copy_human_review_events (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  human_review_id uuid NOT NULL,
  copy_version_id uuid NOT NULL,
  actor_member_id text REFERENCES identity_members(id),
  from_status text NOT NULL CHECK (from_status IN ('not_submitted','pending','approved')),
  to_status text NOT NULL CHECK (to_status IN ('pending','approved','changes_requested','revoked')),
  reason text,
  reason_code text,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (human_review_id, organization_id) REFERENCES copy_human_reviews(id, organization_id),
  FOREIGN KEY (copy_version_id, organization_id) REFERENCES copy_versions(id, organization_id)
);

CREATE TABLE copy_review_idempotency_receipts (
  receipt_key text PRIMARY KEY,
  payload_fingerprint text NOT NULL,
  human_review_id uuid NOT NULL REFERENCES copy_human_reviews(id),
  result_head jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE copy_review_audit_events (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  actor_member_id text REFERENCES identity_members(id),
  event_type text NOT NULL,
  human_review_id uuid NOT NULL,
  copy_version_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (human_review_id, organization_id) REFERENCES copy_human_reviews(id, organization_id),
  FOREIGN KEY (copy_version_id, organization_id) REFERENCES copy_versions(id, organization_id)
);

CREATE INDEX copy_review_heads_copy_idx ON copy_human_review_heads(organization_id, copy_version_id, updated_at);
CREATE INDEX copy_review_events_copy_idx ON copy_human_review_events(organization_id, copy_version_id, created_at);

CREATE FUNCTION copy_review_preserve_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'copy review record is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER copy_human_reviews_immutable BEFORE UPDATE OR DELETE ON copy_human_reviews
FOR EACH ROW EXECUTE FUNCTION copy_review_preserve_append_only();
CREATE TRIGGER copy_human_review_events_append_only BEFORE UPDATE OR DELETE ON copy_human_review_events
FOR EACH ROW EXECUTE FUNCTION copy_review_preserve_append_only();
