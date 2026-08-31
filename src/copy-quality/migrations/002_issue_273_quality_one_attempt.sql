ALTER TABLE copy_quality_runs
  ADD COLUMN attempt_policy text NOT NULL DEFAULT 'legacy',
  ADD COLUMN provider_name text,
  ADD COLUMN provider_kind text,
  ADD COLUMN provider_model text,
  ADD COLUMN provider_dispatch_count integer,
  ADD COLUMN provider_http_request_count integer,
  ADD COLUMN provider_request_state text NOT NULL DEFAULT 'not_started',
  ADD COLUMN provider_request_outcome text,
  ADD COLUMN provider_dispatch_reserved_at timestamptz,
  ADD COLUMN provider_request_started_at timestamptz,
  ADD COLUMN provider_request_completed_at timestamptz,
  ADD COLUMN provider_usage_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN provider_input_tokens integer,
  ADD COLUMN provider_output_tokens integer,
  ADD COLUMN provider_total_tokens integer,
  ADD COLUMN provider_charge_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN provider_charge_amount numeric,
  ADD COLUMN provider_charge_currency text,
  ADD COLUMN provider_local_cost_status text NOT NULL DEFAULT 'not_calculated',
  ADD COLUMN provider_local_cost_amount numeric,
  ADD COLUMN provider_local_cost_currency text;

UPDATE copy_quality_runs
SET status = 'failed',
    failure_code = CASE WHEN status = 'running' THEN 'QUALITY_PROVIDER_OUTCOME_UNKNOWN' ELSE 'QUALITY_ONE_ATTEMPT_NOT_DISPATCHED' END,
    provider_request_state = CASE WHEN status = 'running' THEN 'unknown' ELSE 'terminal' END,
    provider_request_outcome = CASE WHEN status = 'running' THEN 'unknown' ELSE 'not_dispatched' END,
    completed_at = coalesce(completed_at, now()),
    lease_expires_at = NULL,
    lease_token = NULL,
    updated_at = now()
WHERE status IN ('queued', 'running') AND attempt_policy = 'legacy';

ALTER TABLE copy_quality_runs
  ADD CONSTRAINT copy_quality_attempt_policy_ck
    CHECK (attempt_policy IN ('legacy', 'provider_at_most_once_v1')),
  ADD CONSTRAINT copy_quality_provider_request_count_ck
    CHECK (provider_http_request_count IS NULL OR provider_http_request_count BETWEEN 0 AND 1),
  ADD CONSTRAINT copy_quality_provider_dispatch_count_ck
    CHECK (provider_dispatch_count IS NULL OR provider_dispatch_count BETWEEN 0 AND 1),
  ADD CONSTRAINT copy_quality_provider_http_not_over_dispatch_ck
    CHECK (provider_http_request_count IS NULL OR provider_dispatch_count IS NULL OR provider_http_request_count <= provider_dispatch_count),
  ADD CONSTRAINT copy_quality_strict_counts_present_ck
    CHECK (attempt_policy <> 'provider_at_most_once_v1' OR (provider_dispatch_count IS NOT NULL AND provider_http_request_count IS NOT NULL)),
  ADD CONSTRAINT copy_quality_provider_request_state_ck
    CHECK (provider_request_state IN ('not_started', 'reserved', 'started', 'response_received', 'terminal', 'unknown')),
  ADD CONSTRAINT copy_quality_provider_request_outcome_ck
    CHECK (provider_request_outcome IS NULL OR provider_request_outcome IN
      ('success', 'response_received', 'http_error', 'parse_failure', 'schema_failure',
       'semantic_failure', 'timeout', 'network_failure', 'not_dispatched', 'unknown')),
  ADD CONSTRAINT copy_quality_provider_usage_status_ck
    CHECK (provider_usage_status IN ('not_applicable', 'reported', 'unknown')),
  ADD CONSTRAINT copy_quality_provider_tokens_ck
    CHECK (provider_input_tokens IS NULL OR provider_input_tokens >= 0),
  ADD CONSTRAINT copy_quality_provider_output_tokens_ck
    CHECK (provider_output_tokens IS NULL OR provider_output_tokens >= 0),
  ADD CONSTRAINT copy_quality_provider_total_tokens_ck
    CHECK (provider_total_tokens IS NULL OR provider_total_tokens >= 0),
  ADD CONSTRAINT copy_quality_provider_charge_status_ck
    CHECK (provider_charge_status IN ('not_applicable', 'reported', 'unknown')),
  ADD CONSTRAINT copy_quality_provider_charge_amount_ck
    CHECK (provider_charge_amount IS NULL OR provider_charge_amount >= 0),
  ADD CONSTRAINT copy_quality_provider_charge_reported_ck
    CHECK (provider_charge_status <> 'reported' OR (provider_charge_amount IS NOT NULL AND provider_charge_currency IS NOT NULL AND btrim(provider_charge_currency) <> '')),
  ADD CONSTRAINT copy_quality_provider_usage_reported_ck
    CHECK (provider_usage_status <> 'reported' OR provider_input_tokens IS NOT NULL OR provider_output_tokens IS NOT NULL OR provider_total_tokens IS NOT NULL),
  ADD CONSTRAINT copy_quality_provider_local_cost_status_ck
    CHECK (provider_local_cost_status IN ('not_calculated', 'calculated', 'unknown')),
  ADD CONSTRAINT copy_quality_provider_local_cost_amount_ck
    CHECK (provider_local_cost_amount IS NULL OR provider_local_cost_amount >= 0);

CREATE UNIQUE INDEX copy_quality_one_strict_run_per_copy_idx
  ON copy_quality_runs(organization_id, copy_version_id)
  WHERE attempt_policy = 'provider_at_most_once_v1';
