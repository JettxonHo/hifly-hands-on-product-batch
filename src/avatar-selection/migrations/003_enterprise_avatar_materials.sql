ALTER TABLE avatar_assets
  ADD COLUMN category_tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN row_version integer NOT NULL DEFAULT 1;

ALTER TABLE avatar_assets
  ADD CONSTRAINT avatar_assets_category_tags_array_check CHECK (jsonb_typeof(category_tags) = 'array'),
  ADD CONSTRAINT avatar_assets_row_version_check CHECK (row_version > 0);

ALTER TABLE avatar_asset_versions
  ADD COLUMN material_asset_version_id uuid,
  ADD CONSTRAINT avatar_asset_versions_material_fk
    FOREIGN KEY (material_asset_version_id, organization_id)
    REFERENCES asset_versions(id, organization_id),
  ADD CONSTRAINT avatar_asset_versions_material_unique
    UNIQUE (organization_id, material_asset_version_id);

CREATE INDEX avatar_asset_material_version_idx
  ON avatar_asset_versions(organization_id, material_asset_version_id);

DROP TRIGGER IF EXISTS avatar_assets_sync_update_guard ON avatar_assets;

CREATE OR REPLACE FUNCTION avatar_asset_sync_update_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.source_type = 'public' AND OLD.controlled_seed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'avatar asset record is append-only';
  END IF;

  IF OLD.source_type = 'public' AND OLD.controlled_seed = false THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.source_type IS DISTINCT FROM OLD.source_type
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.controlled_seed IS DISTINCT FROM OLD.controlled_seed
      OR NEW.seed_key IS DISTINCT FROM OLD.seed_key
      OR NEW.seed_label IS DISTINCT FROM OLD.seed_label
      OR NEW.category_tags IS DISTINCT FROM OLD.category_tags
      OR NEW.row_version IS DISTINCT FROM OLD.row_version
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'avatar asset record is append-only';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.source_type = 'enterprise' AND OLD.controlled_seed = false THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
      OR NEW.source_type IS DISTINCT FROM OLD.source_type
      OR NEW.controlled_seed IS DISTINCT FROM OLD.controlled_seed
      OR NEW.seed_key IS DISTINCT FROM OLD.seed_key
      OR NEW.seed_label IS DISTINCT FROM OLD.seed_label
      OR NEW.display_name IS DISTINCT FROM OLD.display_name
      OR NEW.description IS DISTINCT FROM OLD.description
      OR NEW.category_tags IS DISTINCT FROM OLD.category_tags
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR OLD.status IS DISTINCT FROM 'active'
      OR NEW.status IS DISTINCT FROM 'disabled'
      OR NEW.row_version IS DISTINCT FROM OLD.row_version + 1 THEN
      RAISE EXCEPTION 'enterprise avatar metadata is append-only';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'avatar asset record is append-only';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER avatar_assets_sync_update_guard
  BEFORE UPDATE ON avatar_assets
  FOR EACH ROW EXECUTE FUNCTION avatar_asset_sync_update_guard();
