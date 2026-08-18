ALTER TABLE project_content_product_revisions
  ADD COLUMN physical_dimensions jsonb;

ALTER TABLE project_content_product_revisions
  ADD CONSTRAINT project_content_physical_dimensions_object_check
  CHECK (physical_dimensions IS NULL OR jsonb_typeof(physical_dimensions) = 'object');

CREATE OR REPLACE FUNCTION project_content_preserve_frozen_revision() RETURNS trigger AS $$
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
    NEW.physical_dimensions IS DISTINCT FROM OLD.physical_dimensions OR
    NEW.asset_version_ids IS DISTINCT FROM OLD.asset_version_ids OR
    NEW.selling_points IS DISTINCT FROM OLD.selling_points OR
    NEW.parent_revision_id IS DISTINCT FROM OLD.parent_revision_id
  ) THEN
    RAISE EXCEPTION 'ready product revision snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
