DO $$
DECLARE
  old_constraint record;
BEGIN
  FOR old_constraint IN
    SELECT constraint_record.conname
    FROM pg_constraint AS constraint_record
    WHERE constraint_record.conrelid = 'work_verification_jobs'::regclass
      AND constraint_record.contype = 'u'
      AND (
        SELECT array_agg(attribute.attname ORDER BY key_position.ordinality)
        FROM unnest(constraint_record.conkey) WITH ORDINALITY AS key_position(attnum, ordinality)
        JOIN pg_attribute AS attribute
          ON attribute.attrelid = constraint_record.conrelid
         AND attribute.attnum = key_position.attnum
      ) = ARRAY['organization_id', 'production_order_id', 'execution_attempt_id', 'primary_output_checksum']::name[]
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT %I', current_schema(), 'work_verification_jobs', old_constraint.conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'work_verification_jobs'::regclass
      AND conname = 'work_verification_jobs_report_candidate_checksum_key'
  ) THEN
    ALTER TABLE work_verification_jobs
      ADD CONSTRAINT work_verification_jobs_report_candidate_checksum_key
      UNIQUE (organization_id, production_order_id, execution_attempt_id, report_id, candidate_id, primary_output_checksum);
  END IF;
END;
$$;
