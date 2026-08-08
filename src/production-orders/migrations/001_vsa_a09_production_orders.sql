CREATE TABLE production_orders (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  product_id uuid NOT NULL,
  video_plan_version_id uuid NOT NULL,
  execution_purpose text NOT NULL CHECK (execution_purpose IN ('first_production','rework','supplemental_version','reproduction')),
  status text NOT NULL CHECK (status IN ('draft','ready','waiting_for_executor','claimed','running','requires_action','succeeded','failed','cancel_requested','cancelled')),
  row_version integer NOT NULL CHECK (row_version > 0),
  input_snapshot jsonb NOT NULL,
  status_history jsonb NOT NULL,
  created_by_member_id text NOT NULL REFERENCES identity_members(id),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  UNIQUE (id, organization_id),
  FOREIGN KEY (product_id, organization_id) REFERENCES project_content_products(id, organization_id),
  FOREIGN KEY (video_plan_version_id, organization_id) REFERENCES video_plan_versions(id, organization_id)
);

CREATE TABLE production_order_idempotency_receipts (
  receipt_key text PRIMARY KEY,
  payload_fingerprint text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE production_order_audit_events (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  actor_member_id text REFERENCES identity_members(id),
  production_order_id uuid NOT NULL,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL,
  FOREIGN KEY (production_order_id, organization_id) REFERENCES production_orders(id, organization_id)
);

CREATE TABLE production_order_outbox_events (
  id uuid PRIMARY KEY,
  organization_id text NOT NULL REFERENCES identity_organizations(id),
  production_order_id uuid NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  published_at timestamptz,
  FOREIGN KEY (production_order_id, organization_id) REFERENCES production_orders(id, organization_id)
);

CREATE INDEX production_orders_product_idx ON production_orders(organization_id, product_id, created_at, id);
CREATE INDEX production_order_audit_order_idx ON production_order_audit_events(organization_id, production_order_id, created_at, id);
CREATE INDEX production_order_outbox_pending_idx ON production_order_outbox_events(organization_id, published_at, created_at, id);

CREATE FUNCTION production_order_preserve_snapshot() RETURNS trigger AS $$
BEGIN
  IF OLD.organization_id = NEW.organization_id AND OLD.product_id = NEW.product_id AND
    OLD.video_plan_version_id = NEW.video_plan_version_id AND OLD.execution_purpose = NEW.execution_purpose AND
    OLD.input_snapshot = NEW.input_snapshot AND OLD.created_by_member_id = NEW.created_by_member_id AND
    OLD.created_at = NEW.created_at AND NEW.row_version > OLD.row_version THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'production order input snapshot is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER production_orders_guard BEFORE UPDATE ON production_orders FOR EACH ROW EXECUTE FUNCTION production_order_preserve_snapshot();
CREATE FUNCTION production_order_no_delete() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'production order history is append-only'; END; $$ LANGUAGE plpgsql;
CREATE TRIGGER production_orders_no_delete BEFORE DELETE ON production_orders FOR EACH ROW EXECUTE FUNCTION production_order_no_delete();
CREATE TRIGGER production_order_audit_no_delete BEFORE UPDATE OR DELETE ON production_order_audit_events FOR EACH ROW EXECUTE FUNCTION production_order_no_delete();
CREATE FUNCTION production_order_outbox_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.id = NEW.id AND OLD.organization_id = NEW.organization_id AND
      OLD.production_order_id = NEW.production_order_id AND OLD.event_type = NEW.event_type AND
      OLD.payload = NEW.payload AND OLD.created_at = NEW.created_at AND
      OLD.published_at IS NULL AND NEW.published_at IS NOT NULL THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'production order outbox is immutable';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER production_order_outbox_no_delete BEFORE UPDATE OR DELETE ON production_order_outbox_events FOR EACH ROW EXECUTE FUNCTION production_order_outbox_guard();
