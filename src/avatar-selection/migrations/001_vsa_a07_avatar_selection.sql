CREATE TABLE avatar_assets (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  source_type text NOT NULL CHECK (source_type IN ('public','enterprise')),
  display_name text NOT NULL,
  description text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','disabled','deleted')),
  controlled_seed boolean NOT NULL DEFAULT false,
  seed_key text NOT NULL,
  seed_label text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, seed_key)
);

CREATE TABLE avatar_asset_versions (
  id uuid PRIMARY KEY,
  asset_id uuid NOT NULL,
  organization_id text NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  status text NOT NULL CHECK (status IN ('available','unavailable')),
  authorization_status text NOT NULL CHECK (authorization_status IN ('valid','expiring','expired','incomplete')),
  authorization_expires_at timestamptz,
  authorization_scope text NOT NULL CHECK (authorization_scope IN ('current_organization')),
  capability_status text NOT NULL CHECK (capability_status IN ('verified','unverified','incompatible','unavailable')),
  materials_accessible boolean NOT NULL,
  preview_kind text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, organization_id),
  UNIQUE (asset_id, version_number),
  FOREIGN KEY (asset_id, organization_id) REFERENCES avatar_assets(id, organization_id)
);

CREATE TABLE avatar_verified_capabilities (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  asset_version_id uuid NOT NULL,
  capability_code text NOT NULL,
  capability_label text NOT NULL,
  verification_status text NOT NULL CHECK (verification_status IN ('verified')),
  evidence_reference text NOT NULL CHECK (length(evidence_reference) > 0),
  created_at timestamptz NOT NULL,
  UNIQUE (asset_version_id, capability_code),
  FOREIGN KEY (asset_version_id, organization_id) REFERENCES avatar_asset_versions(id, organization_id)
);

CREATE TABLE avatar_selections (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  product_id uuid NOT NULL,
  copy_version_id uuid NOT NULL,
  asset_version_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  created_by_member_id text NOT NULL REFERENCES identity_members(id),
  created_at timestamptz NOT NULL,
  UNIQUE (id, organization_id),
  UNIQUE (organization_id, product_id, version_number),
  FOREIGN KEY (product_id, organization_id) REFERENCES project_content_products(id, organization_id),
  FOREIGN KEY (copy_version_id, organization_id) REFERENCES copy_versions(id, organization_id),
  FOREIGN KEY (asset_version_id, organization_id) REFERENCES avatar_asset_versions(id, organization_id)
);

CREATE TABLE avatar_selection_states (
  avatar_selection_id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  product_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','confirmed','superseded')),
  row_version integer NOT NULL CHECK (row_version > 0),
  confirmed_at timestamptz,
  superseded_at timestamptz,
  superseded_by_selection_id uuid,
  updated_at timestamptz NOT NULL,
  FOREIGN KEY (avatar_selection_id, organization_id) REFERENCES avatar_selections(id, organization_id),
  FOREIGN KEY (superseded_by_selection_id, organization_id) REFERENCES avatar_selections(id, organization_id)
);

CREATE TABLE avatar_product_selection_heads (
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  product_id uuid NOT NULL,
  current_selection_id uuid,
  row_version integer NOT NULL CHECK (row_version >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, product_id),
  FOREIGN KEY (product_id, organization_id) REFERENCES project_content_products(id, organization_id),
  FOREIGN KEY (current_selection_id, organization_id) REFERENCES avatar_selections(id, organization_id)
);

CREATE TABLE avatar_selection_events (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL,
  product_id uuid NOT NULL,
  avatar_selection_id uuid NOT NULL,
  actor_member_id text REFERENCES identity_members(id),
  from_status text CHECK (from_status IN ('draft','confirmed')),
  to_status text NOT NULL CHECK (to_status IN ('draft','confirmed','superseded')),
  created_at timestamptz NOT NULL,
  FOREIGN KEY (avatar_selection_id, organization_id) REFERENCES avatar_selections(id, organization_id)
);

CREATE TABLE avatar_selection_idempotency_receipts (
  receipt_key text PRIMARY KEY,
  payload_fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE avatar_selection_audit_events (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  actor_member_id text REFERENCES identity_members(id),
  event_type text NOT NULL,
  product_id uuid NOT NULL,
  avatar_selection_id uuid NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (avatar_selection_id, organization_id) REFERENCES avatar_selections(id, organization_id)
);

CREATE INDEX avatar_catalog_org_idx ON avatar_assets(organization_id, source_type, display_name);
CREATE INDEX avatar_selection_history_idx ON avatar_selections(organization_id, product_id, version_number);
CREATE INDEX avatar_selection_events_idx ON avatar_selection_events(organization_id, product_id, created_at);

CREATE FUNCTION avatar_selection_preserve_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'avatar selection record is append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER avatar_assets_immutable BEFORE UPDATE OR DELETE ON avatar_assets FOR EACH ROW EXECUTE FUNCTION avatar_selection_preserve_append_only();
CREATE TRIGGER avatar_asset_versions_immutable BEFORE UPDATE OR DELETE ON avatar_asset_versions FOR EACH ROW EXECUTE FUNCTION avatar_selection_preserve_append_only();
CREATE TRIGGER avatar_verified_capabilities_immutable BEFORE UPDATE OR DELETE ON avatar_verified_capabilities FOR EACH ROW EXECUTE FUNCTION avatar_selection_preserve_append_only();
CREATE TRIGGER avatar_selections_immutable BEFORE UPDATE OR DELETE ON avatar_selections FOR EACH ROW EXECUTE FUNCTION avatar_selection_preserve_append_only();
CREATE TRIGGER avatar_selection_events_append_only BEFORE UPDATE OR DELETE ON avatar_selection_events FOR EACH ROW EXECUTE FUNCTION avatar_selection_preserve_append_only();
