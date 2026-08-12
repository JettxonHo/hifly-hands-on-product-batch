DROP TRIGGER IF EXISTS avatar_assets_immutable ON avatar_assets;

CREATE FUNCTION avatar_asset_sync_update_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.source_type <> 'public'
    OR OLD.controlled_seed IS DISTINCT FROM false
    OR NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.source_type IS DISTINCT FROM OLD.source_type
    OR NEW.status IS DISTINCT FROM OLD.status
    OR NEW.controlled_seed IS DISTINCT FROM OLD.controlled_seed
    OR NEW.seed_key IS DISTINCT FROM OLD.seed_key
    OR NEW.seed_label IS DISTINCT FROM OLD.seed_label
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'avatar asset record is append-only';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER avatar_assets_sync_update_guard
  BEFORE UPDATE ON avatar_assets
  FOR EACH ROW EXECUTE FUNCTION avatar_asset_sync_update_guard();

CREATE TRIGGER avatar_assets_delete_immutable
  BEFORE DELETE ON avatar_assets
  FOR EACH ROW EXECUTE FUNCTION avatar_selection_preserve_append_only();
