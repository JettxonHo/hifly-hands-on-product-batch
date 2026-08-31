import { randomUUID } from "node:crypto";

import { withTransaction } from "../identity/postgres.js";
import { assertCopyQualitySchemaCurrent } from "./postgres.js";

const failure = (code) => Object.assign(new Error(code), { code });
const one = (result) => result.rows[0] || null;
const iso = (value) => value instanceof Date ? value.toISOString() : value;
const nullableNumber = (value) => {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};
const run = (row) => row ? { ...row, attempts: Number(row.attempts), max_attempts: Number(row.max_attempts),
  provider_http_request_count: nullableNumber(row.provider_http_request_count),
  provider_dispatch_count: nullableNumber(row.provider_dispatch_count),
  provider_input_tokens: nullableNumber(row.provider_input_tokens),
  provider_output_tokens: nullableNumber(row.provider_output_tokens),
  provider_total_tokens: nullableNumber(row.provider_total_tokens),
  provider_charge_amount: nullableNumber(row.provider_charge_amount),
  provider_local_cost_amount: nullableNumber(row.provider_local_cost_amount),
  started_at: iso(row.started_at), heartbeat_at: iso(row.heartbeat_at), lease_expires_at: iso(row.lease_expires_at),
  provider_dispatch_reserved_at: iso(row.provider_dispatch_reserved_at),
  provider_request_started_at: iso(row.provider_request_started_at), provider_request_completed_at: iso(row.provider_request_completed_at),
  completed_at: iso(row.completed_at), created_at: iso(row.created_at), updated_at: iso(row.updated_at) } : null;
const result = (row) => row ? { ...row, created_at: iso(row.created_at) } : null;
const finding = (row) => row ? { ...row, created_at: iso(row.created_at) } : null;
const resolution = (row) => row ? { ...row, created_at: iso(row.created_at) } : null;
const rewriteJob = (row) => row ? { ...row, attempts: Number(row.attempts), max_attempts: Number(row.max_attempts),
  started_at: iso(row.started_at), heartbeat_at: iso(row.heartbeat_at), lease_expires_at: iso(row.lease_expires_at),
  completed_at: iso(row.completed_at), created_at: iso(row.created_at), updated_at: iso(row.updated_at) } : null;
const copy = (row) => row ? { ...row, version_number: Number(row.version_number), row_version: Number(row.row_version),
  created_at: iso(row.created_at), updated_at: iso(row.updated_at), frozen_at: iso(row.frozen_at) } : null;

async function appendAudit(client, event) {
  await client.query(`INSERT INTO copy_quality_audit_events(id,organization_id,actor_member_id,event_type,copy_version_id,quality_run_id,quality_result_id,quality_finding_id,metadata,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [event.id,event.organization_id,event.actor_member_id || null,event.event_type,
    event.copy_version_id || null,event.quality_run_id || null,event.quality_result_id || null,event.quality_finding_id || null,
    JSON.stringify(event.metadata || {}),event.created_at]);
}

export function createPostgresCopyQualityRepository({ pool, ownsPool = false } = {}) {
  if (!pool?.connect) throw new TypeError("pool is required");

  async function getRunDetails(organizationId, runId) {
    const runRow = run(one(await pool.query("SELECT * FROM copy_quality_runs WHERE organization_id=$1 AND id=$2", [organizationId,runId])));
    if (!runRow) return null;
    const resultRow = runRow.quality_result_id ? result(one(await pool.query("SELECT * FROM copy_quality_results WHERE organization_id=$1 AND id=$2", [organizationId,runRow.quality_result_id]))) : null;
    const findingRows = resultRow ? (await pool.query("SELECT * FROM copy_quality_findings WHERE organization_id=$1 AND quality_result_id=$2 ORDER BY created_at,id", [organizationId,resultRow.id])).rows.map(finding) : [];
    const projected = [];
    for (const item of findingRows) {
      const history = (await pool.query("SELECT * FROM copy_quality_finding_resolutions WHERE organization_id=$1 AND quality_finding_id=$2 ORDER BY created_at,id", [organizationId,item.id])).rows.map(resolution);
      projected.push({ ...item, resolutions: history });
    }
    return { run: runRow, result: resultRow, findings: projected };
  }

  return {
    async initialize() { await assertCopyQualitySchemaCurrent(pool); },
    async close() { if (ownsPool) await pool.end(); },
    async createRun({ receiptKey, fingerprint, run: value, audit }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`copy-quality-receipt:${receiptKey}`]);
        const receipt = one(await client.query("SELECT * FROM copy_quality_idempotency_receipts WHERE receipt_key=$1", [receiptKey]));
        if (receipt) {
          if (receipt.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
          return run(one(await client.query("SELECT * FROM copy_quality_runs WHERE id=$1", [receipt.quality_run_id])));
        }
        if (value.attempt_policy === "provider_at_most_once_v1") {
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`copy-quality-strict:${value.organization_id}:${value.copy_version_id}`]);
          const strict = run(one(await client.query(`SELECT * FROM copy_quality_runs
            WHERE organization_id=$1 AND copy_version_id=$2 AND attempt_policy='provider_at_most_once_v1'
            ORDER BY created_at,id LIMIT 1`, [value.organization_id, value.copy_version_id])));
          if (strict) {
            await client.query("INSERT INTO copy_quality_idempotency_receipts(receipt_key,payload_fingerprint,quality_run_id,created_at) VALUES ($1,$2,$3,$4)", [receiptKey,fingerprint,strict.id,value.created_at]);
            return strict;
          }
          const legacyUnknown = run(one(await client.query(`SELECT * FROM copy_quality_runs
            WHERE organization_id=$1 AND copy_version_id=$2 AND status NOT IN ('queued','running')
              AND coalesce(attempt_policy,'legacy') <> 'provider_at_most_once_v1'
              AND (provider_request_state='unknown' OR provider_request_outcome='unknown' OR failure_code='QUALITY_PROVIDER_OUTCOME_UNKNOWN')
            ORDER BY created_at,id LIMIT 1`, [value.organization_id, value.copy_version_id])));
          if (legacyUnknown) throw failure("QUALITY_ONE_ATTEMPT_LEGACY_OUTCOME_UNKNOWN");
          const legacyActive = run(one(await client.query(`SELECT * FROM copy_quality_runs
            WHERE organization_id=$1 AND copy_version_id=$2 AND status IN ('queued','running')
              AND coalesce(attempt_policy,'legacy') <> 'provider_at_most_once_v1'
            ORDER BY created_at,id LIMIT 1`, [value.organization_id, value.copy_version_id])));
          if (legacyActive) throw failure("QUALITY_ONE_ATTEMPT_LEGACY_RUN_ACTIVE");
        }
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`copy-quality-active:${value.organization_id}:${value.copy_version_id}:${value.profile_version}:${value.rule_version}`]);
        if (value.attempt_policy === "provider_at_most_once_v1") {
          const strict = run(one(await client.query(`SELECT * FROM copy_quality_runs
            WHERE organization_id=$1 AND copy_version_id=$2 AND attempt_policy='provider_at_most_once_v1'
            ORDER BY created_at,id LIMIT 1`, [value.organization_id, value.copy_version_id])));
          if (strict) {
            await client.query("INSERT INTO copy_quality_idempotency_receipts(receipt_key,payload_fingerprint,quality_run_id,created_at) VALUES ($1,$2,$3,$4)", [receiptKey,fingerprint,strict.id,value.created_at]);
            return strict;
          }
          const legacyUnknown = run(one(await client.query(`SELECT * FROM copy_quality_runs
            WHERE organization_id=$1 AND copy_version_id=$2 AND status NOT IN ('queued','running')
              AND coalesce(attempt_policy,'legacy') <> 'provider_at_most_once_v1'
              AND (provider_request_state='unknown' OR provider_request_outcome='unknown' OR failure_code='QUALITY_PROVIDER_OUTCOME_UNKNOWN')
            ORDER BY created_at,id LIMIT 1`, [value.organization_id, value.copy_version_id])));
          if (legacyUnknown) throw failure("QUALITY_ONE_ATTEMPT_LEGACY_OUTCOME_UNKNOWN");
          const legacyActive = run(one(await client.query(`SELECT * FROM copy_quality_runs
            WHERE organization_id=$1 AND copy_version_id=$2 AND status IN ('queued','running')
              AND coalesce(attempt_policy,'legacy') <> 'provider_at_most_once_v1'
            ORDER BY created_at,id LIMIT 1`, [value.organization_id, value.copy_version_id])));
          if (legacyActive) throw failure("QUALITY_ONE_ATTEMPT_LEGACY_RUN_ACTIVE");
        }
        const active = run(one(await client.query(`SELECT * FROM copy_quality_runs WHERE organization_id=$1 AND copy_version_id=$2 AND profile_version=$3 AND rule_version=$4 AND status IN ('queued','running') ORDER BY created_at LIMIT 1`, [value.organization_id,value.copy_version_id,value.profile_version,value.rule_version])));
        if (active) {
          await client.query("INSERT INTO copy_quality_idempotency_receipts(receipt_key,payload_fingerprint,quality_run_id,created_at) VALUES ($1,$2,$3,$4)", [receiptKey,fingerprint,active.id,value.created_at]);
          return active;
        }
        await client.query(`INSERT INTO copy_quality_runs(id,organization_id,copy_version_id,product_revision_id,profile_version,rule_version,input_snapshot,status,attempts,max_attempts,attempt_policy,quality_result_id,failure_code,lease_token,started_at,heartbeat_at,lease_expires_at,completed_at,created_at,updated_at,provider_name,provider_kind,provider_model,provider_dispatch_count,provider_http_request_count,provider_request_state,provider_request_outcome,provider_dispatch_reserved_at,provider_request_started_at,provider_request_completed_at,provider_usage_status,provider_input_tokens,provider_output_tokens,provider_total_tokens,provider_charge_status,provider_charge_amount,provider_charge_currency,provider_local_cost_status,provider_local_cost_amount,provider_local_cost_currency)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40)`, [value.id,value.organization_id,value.copy_version_id,value.product_revision_id,value.profile_version,value.rule_version,JSON.stringify(value.input_snapshot),value.status,value.attempts,value.max_attempts,value.attempt_policy || "legacy",value.quality_result_id,value.failure_code,value.lease_token,value.started_at,value.heartbeat_at,value.lease_expires_at,value.completed_at,value.created_at,value.updated_at,value.provider_name,value.provider_kind,value.provider_model,value.provider_dispatch_count || 0,value.provider_http_request_count || 0,value.provider_request_state || "not_started",value.provider_request_outcome,value.provider_dispatch_reserved_at,value.provider_request_started_at,value.provider_request_completed_at,value.provider_usage_status || "unknown",value.provider_input_tokens,value.provider_output_tokens,value.provider_total_tokens,value.provider_charge_status || "unknown",value.provider_charge_amount,value.provider_charge_currency,value.provider_local_cost_status || "not_calculated",value.provider_local_cost_amount,value.provider_local_cost_currency]);
        await client.query("INSERT INTO copy_quality_idempotency_receipts(receipt_key,payload_fingerprint,quality_run_id,created_at) VALUES ($1,$2,$3,$4)", [receiptKey,fingerprint,value.id,value.created_at]);
        await appendAudit(client,audit);
        return value;
      });
    },
    async getRun(organizationId, id) { return run(one(await pool.query("SELECT * FROM copy_quality_runs WHERE organization_id=$1 AND id=$2", [organizationId,id]))); },
    async listRuns(organizationId, copyVersionId) { return (await pool.query("SELECT * FROM copy_quality_runs WHERE organization_id=$1 AND copy_version_id=$2 ORDER BY created_at,id", [organizationId,copyVersionId])).rows.map(run); },
    async beginProviderRequest({ runId, leaseToken, providerName, providerKind, model, now, audit }) {
      return withTransaction(pool, async (client) => {
        const updated = run(one(await client.query(`UPDATE copy_quality_runs SET provider_name=$3,provider_kind=$4,provider_model=$5,
          provider_dispatch_count=provider_dispatch_count+1,provider_request_state='reserved',provider_request_outcome=NULL,
          provider_dispatch_reserved_at=$6,provider_request_started_at=NULL,provider_usage_status='not_applicable',provider_input_tokens=NULL,provider_output_tokens=NULL,
          provider_total_tokens=NULL,provider_charge_status='not_applicable',provider_charge_amount=NULL,provider_charge_currency=NULL,
          updated_at=$6 WHERE id=$1 AND status='running' AND lease_token=$2 AND provider_dispatch_count=0 RETURNING *`,
        [runId,leaseToken,providerName,providerKind,model,now])));
        if (updated) {
          if (audit) await appendAudit(client, audit);
          return updated;
        }
        const current = run(one(await client.query("SELECT * FROM copy_quality_runs WHERE id=$1", [runId])));
        if (!current || current.status !== "running" || current.lease_token !== leaseToken) throw failure("QUALITY_RUN_LEASE_LOST");
        if (current.provider_dispatch_count !== 1) throw failure("QUALITY_PROVIDER_REQUEST_NOT_RESERVED");
        return null;
      });
    },
    async markProviderHttpRequestStarted({ runId, leaseToken, now, audit }) {
      return withTransaction(pool, async (client) => {
        const saved = run(one(await client.query(`UPDATE copy_quality_runs SET provider_http_request_count=provider_http_request_count+1,
          provider_request_state='started',provider_request_started_at=$3,provider_usage_status='unknown',provider_charge_status='unknown',updated_at=$3
          WHERE id=$1 AND status='running' AND lease_token=$2 AND provider_dispatch_count=1 AND provider_http_request_count=0 RETURNING *`,
        [runId,leaseToken,now])));
        if (saved) {
          if (audit) await appendAudit(client, audit);
          return saved;
        }
        const current = run(one(await client.query("SELECT * FROM copy_quality_runs WHERE id=$1", [runId])));
        if (!current || current.status !== "running" || current.lease_token !== leaseToken) throw failure("QUALITY_RUN_LEASE_LOST");
        if (current.provider_dispatch_count !== 1) throw failure("QUALITY_PROVIDER_REQUEST_NOT_RESERVED");
        return null;
      });
    },
    async recordProviderResponse({ runId, leaseToken, outcome, usage, charge, now, audit }) {
      const usageReported = usage?.status === "reported";
      const chargeReported = charge?.status === "reported";
      return withTransaction(pool, async (client) => {
        const saved = run(one(await client.query(`UPDATE copy_quality_runs SET provider_request_state=$3,provider_request_outcome=$4,
          provider_request_completed_at=$5,provider_usage_status=$6,provider_input_tokens=$7,provider_output_tokens=$8,
          provider_total_tokens=$9,provider_charge_status=$10,provider_charge_amount=$11,provider_charge_currency=$12,updated_at=$5
          WHERE id=$1 AND status='running' AND lease_token=$2 AND provider_http_request_count=1 AND provider_request_state='started' RETURNING *`,
        [runId,leaseToken,outcome === "response_received" ? "response_received" : "terminal",outcome,now,
          usageReported ? "reported" : "unknown",usageReported ? usage.inputTokens : null,
          usageReported ? usage.outputTokens : null,usageReported ? usage.totalTokens : null,
          chargeReported ? "reported" : "unknown",chargeReported ? charge.amount : null,
          chargeReported ? charge.currency : null])));
        if (saved) {
          if (audit) await appendAudit(client, audit);
          return saved;
        }
        const current = run(one(await client.query("SELECT * FROM copy_quality_runs WHERE id=$1", [runId])));
        if (!current || current.status !== "running" || current.lease_token !== leaseToken) throw failure("QUALITY_RUN_LEASE_LOST");
        if (current.provider_http_request_count !== 1) throw failure("QUALITY_PROVIDER_REQUEST_NOT_STARTED");
        throw failure("QUALITY_PROVIDER_RESPONSE_ALREADY_RECORDED");
      });
    },
    getRunDetails,
    async getFinding(organizationId, findingId) {
      const findingRow = finding(one(await pool.query("SELECT * FROM copy_quality_findings WHERE organization_id=$1 AND id=$2", [organizationId,findingId])));
      if (!findingRow) return null;
      const resultRow = result(one(await pool.query("SELECT * FROM copy_quality_results WHERE organization_id=$1 AND id=$2", [organizationId,findingRow.quality_result_id])));
      const runRow = resultRow && run(one(await pool.query("SELECT * FROM copy_quality_runs WHERE organization_id=$1 AND id=$2", [organizationId,resultRow.quality_run_id])));
      const history = (await pool.query("SELECT * FROM copy_quality_finding_resolutions WHERE organization_id=$1 AND quality_finding_id=$2 ORDER BY created_at,id", [organizationId,findingId])).rows.map(resolution);
      return { finding: findingRow, result: resultRow, run: runRow, resolutions: history };
    },
    async appendResolution({ receiptKey, fingerprint, findingId, resolution: value, audit }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`copy-quality-receipt:${receiptKey}`]);
        const receipt = one(await client.query("SELECT * FROM copy_quality_idempotency_receipts WHERE receipt_key=$1", [receiptKey]));
        if (receipt) {
          if (receipt.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
          return resolution(one(await client.query("SELECT * FROM copy_quality_finding_resolutions WHERE id=$1", [receipt.resolution_id])));
        }
        const exists = one(await client.query("SELECT id FROM copy_quality_findings WHERE organization_id=$1 AND id=$2", [value.organization_id,findingId]));
        if (!exists) return null;
        const saved = resolution(one(await client.query(`INSERT INTO copy_quality_finding_resolutions(id,organization_id,quality_finding_id,state,reason,actor_member_id,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [value.id,value.organization_id,value.quality_finding_id,value.state,value.reason,value.actor_member_id,value.created_at])));
        await client.query("INSERT INTO copy_quality_idempotency_receipts(receipt_key,payload_fingerprint,resolution_id,created_at) VALUES ($1,$2,$3,$4)", [receiptKey,fingerprint,saved.id,value.created_at]);
        await appendAudit(client,audit);
        return saved;
      });
    },
    async claimNextRun({ now, leaseExpiresAt, leaseToken }) {
      return withTransaction(pool, async (client) => {
        const strictExpired = (await client.query(`SELECT * FROM copy_quality_runs
          WHERE status='running' AND lease_expires_at <= $1 AND attempt_policy='provider_at_most_once_v1'
          FOR UPDATE SKIP LOCKED`, [now])).rows.map(run);
        for (const candidate of strictExpired) {
          const dispatched = candidate.provider_http_request_count > 0;
          const failureCode = dispatched ? "QUALITY_PROVIDER_OUTCOME_UNKNOWN" : "QUALITY_ONE_ATTEMPT_NOT_DISPATCHED";
          await client.query(`UPDATE copy_quality_runs SET status='failed',failure_code=$2,
            provider_request_state=$3,provider_request_outcome=$4,completed_at=$5,lease_expires_at=NULL,
            lease_token=NULL,updated_at=$5 WHERE id=$1`, [candidate.id, failureCode,
            dispatched ? "unknown" : "terminal", dispatched ? "unknown" : "not_dispatched", now]);
          await appendAudit(client, { id: randomUUID(), organization_id: candidate.organization_id,
            event_type: dispatched ? "copy.quality_provider_outcome_unknown" : "copy.quality_provider_not_dispatched",
            copy_version_id: candidate.copy_version_id,
            quality_run_id: candidate.id, metadata: { attempts: candidate.attempts,
              provider_dispatch_count: candidate.provider_dispatch_count, provider_http_request_count: candidate.provider_http_request_count }, created_at: now });
        }
        const exhausted = (await client.query("SELECT * FROM copy_quality_runs WHERE status='running' AND lease_expires_at <= $1 AND attempt_policy='legacy' AND attempts >= max_attempts FOR UPDATE SKIP LOCKED", [now])).rows.map(run);
        for (const candidate of exhausted) {
          await client.query("UPDATE copy_quality_runs SET status='failed',failure_code='QUALITY_RUN_TIMED_OUT',completed_at=$2,lease_expires_at=NULL,lease_token=NULL,updated_at=$2 WHERE id=$1", [candidate.id,now]);
          await appendAudit(client, { id: randomUUID(), organization_id: candidate.organization_id,
            event_type: "copy.quality_timed_out", copy_version_id: candidate.copy_version_id,
            quality_run_id: candidate.id, metadata: { attempts: candidate.attempts }, created_at: now });
        }
        return run(one(await client.query(`UPDATE copy_quality_runs SET status='running',attempts=attempts+1,lease_token=$1,started_at=coalesce(started_at,$2),heartbeat_at=$2,lease_expires_at=$3,updated_at=$2
        WHERE id=(SELECT id FROM copy_quality_runs WHERE (status='queued' OR (status='running' AND attempt_policy='legacy' AND lease_expires_at <= $2)) AND attempts < max_attempts ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [leaseToken,now,leaseExpiresAt])));
      });
    },
    async heartbeatRun({ runId, leaseToken, now, leaseExpiresAt }) {
      const saved = run(one(await pool.query("UPDATE copy_quality_runs SET heartbeat_at=$3,lease_expires_at=$4,updated_at=$3 WHERE id=$1 AND status='running' AND lease_token=$2 RETURNING *", [runId,leaseToken,now,leaseExpiresAt])));
      if (!saved) throw failure("QUALITY_RUN_LEASE_LOST");
      return saved;
    },
    async completeRun({ runId, leaseToken, result: resultValue, findingRows, audit, now, providerOutcome = null }) {
      return withTransaction(pool, async (client) => {
        const current = run(one(await client.query("SELECT * FROM copy_quality_runs WHERE id=$1 FOR UPDATE", [runId])));
        if (!current || current.status !== "running" || current.lease_token !== leaseToken) throw failure("QUALITY_RUN_LEASE_LOST");
        if (current.provider_dispatch_count > 0 && current.provider_http_request_count === 0) throw failure("QUALITY_PROVIDER_REQUEST_NOT_STARTED");
        if (current.provider_dispatch_count > 0 && current.provider_request_state !== "response_received") throw failure("QUALITY_PROVIDER_RESPONSE_NOT_READY");
        const savedResult = result(one(await client.query(`INSERT INTO copy_quality_results(id,organization_id,quality_run_id,copy_version_id,profile_version,rule_version,conclusion,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [resultValue.id,resultValue.organization_id,resultValue.quality_run_id,resultValue.copy_version_id,resultValue.profile_version,resultValue.rule_version,resultValue.conclusion,resultValue.created_at])));
        const savedFindings = [];
        for (const value of findingRows) savedFindings.push(finding(one(await client.query(`INSERT INTO copy_quality_findings(id,organization_id,quality_result_id,code,kind,severity,title,matched_text,message,evidence_reference,rule_source,suggestion,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [value.id,value.organization_id,
          value.quality_result_id,value.code,value.kind,value.severity,value.title,value.matched_text,value.message,
          value.evidence_reference,value.rule_source,value.suggestion,value.created_at]))));
        const savedRun = run(one(await client.query(`UPDATE copy_quality_runs SET status='succeeded',quality_result_id=$2,
          completed_at=$3,heartbeat_at=$3,lease_expires_at=NULL,lease_token=NULL,failure_code=NULL,
          provider_request_state=CASE WHEN provider_http_request_count > 0 THEN 'terminal' ELSE provider_request_state END,
          provider_request_outcome=CASE WHEN provider_http_request_count > 0 THEN coalesce($4,'success') ELSE provider_request_outcome END,
          provider_request_completed_at=CASE WHEN provider_http_request_count > 0 THEN $3 ELSE provider_request_completed_at END,
          updated_at=$3 WHERE id=$1 RETURNING *`, [runId,savedResult.id,now,providerOutcome])));
        await appendAudit(client,audit);
        return { run: savedRun, result: savedResult, findings: savedFindings.map((item) => ({ ...item, resolutions: [] })) };
      });
    },
    async failRun({ runId, leaseToken, failureCode, audit, now, providerOutcome = null }) {
      return withTransaction(pool, async (client) => {
        const saved = run(one(await client.query(`UPDATE copy_quality_runs SET status='failed',failure_code=$3,
          completed_at=$4,lease_expires_at=NULL,lease_token=NULL,
          provider_request_state=CASE WHEN provider_dispatch_count > 0 AND coalesce($5,'unknown') IN ('unknown','network_failure') THEN 'unknown'
            WHEN provider_dispatch_count > 0 THEN 'terminal' ELSE provider_request_state END,
          provider_request_outcome=CASE WHEN provider_dispatch_count > 0 THEN coalesce($5,'unknown') ELSE provider_request_outcome END,
          provider_request_completed_at=CASE WHEN provider_dispatch_count > 0 THEN $4 ELSE provider_request_completed_at END,
          updated_at=$4 WHERE id=$1 AND status='running' AND lease_token=$2 RETURNING *`, [runId,leaseToken,failureCode,now,providerOutcome])));
        if (!saved) throw failure("QUALITY_RUN_LEASE_LOST");
        await appendAudit(client,audit); return saved;
      });
    },
    async cancelRun({ organizationId, runId, audit, now }) {
      return withTransaction(pool, async (client) => {
        const current = run(one(await client.query("SELECT * FROM copy_quality_runs WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId,runId])));
        if (!current) return null;
        if (!["queued","running"].includes(current.status)) throw failure("QUALITY_RUN_CANCEL_BLOCKED");
        if (current.attempt_policy === "provider_at_most_once_v1" && current.provider_dispatch_count > 0) {
          throw failure("QUALITY_ONE_ATTEMPT_CANCEL_BLOCKED");
        }
        const saved = run(one(await client.query(`UPDATE copy_quality_runs SET status='cancelled',completed_at=$2,
          lease_expires_at=NULL,lease_token=NULL,
          provider_request_state=CASE WHEN attempt_policy='provider_at_most_once_v1' THEN 'terminal' ELSE provider_request_state END,
          provider_request_outcome=CASE WHEN attempt_policy='provider_at_most_once_v1' THEN 'not_dispatched' ELSE provider_request_outcome END,
          updated_at=$2 WHERE id=$1 RETURNING *`, [runId,now])));
        await appendAudit(client,audit); return saved;
      });
    },
    async createRewriteJob({ receiptKey, fingerprint, job, audit }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`copy-rewrite-receipt:${receiptKey}`]);
        const receipt = one(await client.query("SELECT * FROM copy_quality_idempotency_receipts WHERE receipt_key=$1", [receiptKey]));
        if (receipt) {
          if (receipt.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
          return rewriteJob(one(await client.query("SELECT * FROM copy_rewrite_jobs WHERE id=$1", [receipt.rewrite_job_id])));
        }
        const saved = rewriteJob(one(await client.query(`INSERT INTO copy_rewrite_jobs(id,organization_id,actor_member_id,source_copy_version_id,finding_id,scope,instruction,status,attempts,max_attempts,output_copy_version_id,quality_run_id,rewritten_body,failure_code,lease_token,started_at,heartbeat_at,lease_expires_at,completed_at,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *`,
        [job.id,job.organization_id,job.actor_member_id,job.source_copy_version_id,job.finding_id,job.scope,job.instruction,
          job.status,job.attempts,job.max_attempts,job.output_copy_version_id,job.quality_run_id,job.rewritten_body,job.failure_code,job.lease_token,
          job.started_at,job.heartbeat_at,job.lease_expires_at,job.completed_at,job.created_at,job.updated_at])));
        await client.query("INSERT INTO copy_quality_idempotency_receipts(receipt_key,payload_fingerprint,rewrite_job_id,created_at) VALUES ($1,$2,$3,$4)", [receiptKey,fingerprint,saved.id,saved.created_at]);
        await appendAudit(client,audit);
        return saved;
      });
    },
    async getRewriteJob(organizationId, id) {
      return rewriteJob(one(await pool.query("SELECT * FROM copy_rewrite_jobs WHERE organization_id=$1 AND id=$2", [organizationId,id])));
    },
    async listRewriteJobs(organizationId, copyVersionId) {
      return (await pool.query("SELECT * FROM copy_rewrite_jobs WHERE organization_id=$1 AND source_copy_version_id=$2 ORDER BY created_at,id", [organizationId,copyVersionId])).rows.map(rewriteJob);
    },
    async claimNextRewriteJob({ now, leaseExpiresAt, leaseToken }) {
      return withTransaction(pool, async (client) => {
        const timedOut = (await client.query(`UPDATE copy_rewrite_jobs SET status='timed_out',failure_code='COPY_REWRITE_TIMED_OUT',completed_at=$1,lease_expires_at=NULL,lease_token=NULL,updated_at=$1
          WHERE status='running' AND lease_expires_at <= $1 AND attempts >= max_attempts RETURNING *`, [now])).rows.map(rewriteJob);
        for (const candidate of timedOut) await appendAudit(client, { id: randomUUID(),
          organization_id: candidate.organization_id, event_type: "copy.rewrite_timed_out",
          copy_version_id: candidate.source_copy_version_id, quality_finding_id: candidate.finding_id,
          metadata: { rewrite_job_id: candidate.id, attempts: candidate.attempts }, created_at: now });
        return rewriteJob(one(await client.query(`UPDATE copy_rewrite_jobs SET status='running',attempts=attempts+1,lease_token=$1,started_at=coalesce(started_at,$2),heartbeat_at=$2,lease_expires_at=$3,updated_at=$2
          WHERE id=(SELECT id FROM copy_rewrite_jobs WHERE (status='queued' OR (status='running' AND lease_expires_at <= $2)) AND attempts < max_attempts ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`,
        [leaseToken,now,leaseExpiresAt])));
      });
    },
    async heartbeatRewriteJob({ jobId, leaseToken, now, leaseExpiresAt }) {
      const saved = rewriteJob(one(await pool.query("UPDATE copy_rewrite_jobs SET heartbeat_at=$3,lease_expires_at=$4,updated_at=$3 WHERE id=$1 AND status='running' AND lease_token=$2 RETURNING *", [jobId,leaseToken,now,leaseExpiresAt])));
      if (!saved) throw failure("COPY_REWRITE_LEASE_LOST");
      return saved;
    },
    async saveRewriteOutput({ jobId, leaseToken, body, now }) {
      const saved = rewriteJob(one(await pool.query("UPDATE copy_rewrite_jobs SET rewritten_body=coalesce(rewritten_body,$3),updated_at=$4 WHERE id=$1 AND status='running' AND lease_token=$2 RETURNING *", [jobId,leaseToken,body,now])));
      if (!saved) throw failure("COPY_REWRITE_LEASE_LOST");
      return saved;
    },
    async completeRewriteJob({ jobId, leaseToken, outputCopyVersionId, qualityRunId, audit, now }) {
      return withTransaction(pool, async (client) => {
        const saved = rewriteJob(one(await client.query(`UPDATE copy_rewrite_jobs SET status='succeeded',output_copy_version_id=$3,quality_run_id=$4,failure_code=NULL,completed_at=$5,heartbeat_at=$5,lease_expires_at=NULL,lease_token=NULL,updated_at=$5
          WHERE id=$1 AND status='running' AND lease_token=$2 RETURNING *`, [jobId,leaseToken,outputCopyVersionId,qualityRunId,now])));
        if (!saved) throw failure("COPY_REWRITE_LEASE_LOST");
        await appendAudit(client,audit);
        return saved;
      });
    },
    async failRewriteJob({ jobId, leaseToken, failureCode, audit, now }) {
      return withTransaction(pool, async (client) => {
        const saved = rewriteJob(one(await client.query("UPDATE copy_rewrite_jobs SET status='failed',failure_code=$3,completed_at=$4,lease_expires_at=NULL,lease_token=NULL,updated_at=$4 WHERE id=$1 AND status='running' AND lease_token=$2 RETURNING *", [jobId,leaseToken,failureCode,now])));
        if (!saved) throw failure("COPY_REWRITE_LEASE_LOST");
        await appendAudit(client,audit);
        return saved;
      });
    },
    async retryRewriteJob({ organizationId, jobId, receiptKey, fingerprint, audit, now }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`copy-rewrite-retry:${receiptKey}`]);
        const receipt = one(await client.query("SELECT * FROM copy_quality_idempotency_receipts WHERE receipt_key=$1", [receiptKey]));
        if (receipt) {
          if (receipt.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
          return rewriteJob(one(await client.query("SELECT * FROM copy_rewrite_jobs WHERE id=$1", [receipt.rewrite_job_id])));
        }
        const saved = rewriteJob(one(await client.query(`UPDATE copy_rewrite_jobs SET status='queued',failure_code=NULL,completed_at=NULL,updated_at=$3
          WHERE organization_id=$1 AND id=$2 AND status IN ('failed','timed_out') AND attempts < max_attempts RETURNING *`, [organizationId,jobId,now])));
        if (!saved) throw failure("COPY_REWRITE_RETRY_BLOCKED");
        await client.query("INSERT INTO copy_quality_idempotency_receipts(receipt_key,payload_fingerprint,rewrite_job_id,created_at) VALUES ($1,$2,$3,$4)", [receiptKey,fingerprint,saved.id,now]);
        await appendAudit(client,audit);
        return saved;
      });
    },
    async listAuditEvents() { return (await pool.query("SELECT * FROM copy_quality_audit_events ORDER BY created_at,id")).rows.map((row) => ({ ...row, created_at: iso(row.created_at) })); }
  };
}
