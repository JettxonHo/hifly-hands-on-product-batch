ALTER TABLE video_plan_versions
  ADD COLUMN presentation_size_code text NOT NULL DEFAULT 'smart_fit';

ALTER TABLE video_plan_versions
  ADD CONSTRAINT video_plan_presentation_size_code_check
  CHECK (presentation_size_code IN ('smart_fit','extra_large','large','medium','small','extra_small'));

CREATE OR REPLACE FUNCTION video_plan_preserve_version() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'draft' AND NEW.status IN ('draft','frozen','superseded') AND
    OLD.upstream_snapshot = NEW.upstream_snapshot AND OLD.capability_config_snapshot = NEW.capability_config_snapshot AND
    OLD.parent_plan_version_id IS NOT DISTINCT FROM NEW.parent_plan_version_id THEN RETURN NEW; END IF;
  IF OLD.status = 'frozen' AND NEW.status = 'superseded' AND
    OLD.upstream_snapshot = NEW.upstream_snapshot AND OLD.capability_config_snapshot = NEW.capability_config_snapshot AND
    OLD.output_instructions = NEW.output_instructions AND OLD.presentation_size_code = NEW.presentation_size_code THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'video plan version is immutable';
END;
$$ LANGUAGE plpgsql;
