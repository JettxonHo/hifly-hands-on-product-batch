CREATE TABLE project_content_projects (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  name text NOT NULL CHECK (char_length(name) > 0),
  description text,
  delivery_date text,
  created_by_member_id text NOT NULL REFERENCES identity_members(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, organization_id)
);

CREATE TABLE project_content_products (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  project_id uuid NOT NULL,
  current_revision_id uuid,
  created_by_member_id text NOT NULL REFERENCES identity_members(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, organization_id),
  FOREIGN KEY (project_id, organization_id) REFERENCES project_content_projects(id, organization_id)
);

CREATE TABLE project_content_product_revisions (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  project_id uuid NOT NULL,
  product_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','ready','superseded')),
  revision_number integer NOT NULL CHECK (revision_number > 0),
  product_name text NOT NULL DEFAULT '',
  product_description text,
  primary_category text NOT NULL DEFAULT 'general',
  content_brief jsonb,
  asset_version_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(asset_version_ids) = 'array'),
  selling_points jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(selling_points) = 'array'),
  parent_revision_id uuid REFERENCES project_content_product_revisions(id),
  created_by_member_id text NOT NULL REFERENCES identity_members(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  ready_at timestamptz,
  UNIQUE (id, organization_id),
  FOREIGN KEY (project_id, organization_id) REFERENCES project_content_projects(id, organization_id),
  FOREIGN KEY (product_id, organization_id) REFERENCES project_content_products(id, organization_id)
);

ALTER TABLE project_content_products ADD CONSTRAINT project_content_current_revision_fk
  FOREIGN KEY (current_revision_id, organization_id) REFERENCES project_content_product_revisions(id, organization_id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE project_content_idempotency_receipts (
  receipt_key text PRIMARY KEY,
  payload_fingerprint text NOT NULL,
  response_json jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_content_audit_events (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  actor_member_id text REFERENCES identity_members(id),
  event_type text NOT NULL,
  project_id uuid,
  product_id uuid,
  product_revision_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE INDEX project_content_projects_org_idx ON project_content_projects(organization_id, created_at DESC);
CREATE INDEX project_content_products_project_idx ON project_content_products(organization_id, project_id);
CREATE INDEX project_content_revisions_product_idx ON project_content_product_revisions(organization_id, product_id, created_at DESC);

CREATE FUNCTION project_content_preserve_frozen_revision() RETURNS trigger AS $$
BEGIN
  IF (OLD.status = 'ready' AND NEW.status NOT IN ('ready','superseded')) OR
     (OLD.status = 'superseded' AND NEW.status <> 'superseded') THEN
    RAISE EXCEPTION 'frozen product revision state cannot move backward';
  END IF;
  IF OLD.status IN ('ready','superseded') AND (
    NEW.product_name IS DISTINCT FROM OLD.product_name OR
    NEW.product_description IS DISTINCT FROM OLD.product_description OR
    NEW.primary_category IS DISTINCT FROM OLD.primary_category OR
    NEW.content_brief IS DISTINCT FROM OLD.content_brief OR
    NEW.asset_version_ids IS DISTINCT FROM OLD.asset_version_ids OR
    NEW.selling_points IS DISTINCT FROM OLD.selling_points OR
    NEW.parent_revision_id IS DISTINCT FROM OLD.parent_revision_id
  ) THEN
    RAISE EXCEPTION 'ready product revision snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER project_content_frozen_revision_immutable
BEFORE UPDATE ON project_content_product_revisions
FOR EACH ROW EXECUTE FUNCTION project_content_preserve_frozen_revision();
