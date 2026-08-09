import { randomUUID } from "node:crypto";

import { withTransaction } from "../identity/postgres.js";
import { assertManualExecutionSchemaCurrent } from "./postgres.js";

const failure = (code) => Object.assign(new Error(code), { code });
const one = (result) => result.rows[0] || null;
const iso = (value) => value instanceof Date ? value.toISOString() : value;
const json = (value) => JSON.stringify(value == null ? null : value);
const allowedTransitions = {
  draft: ["ready"], ready: ["waiting_for_executor"], waiting_for_executor: ["claimed", "cancelled"],
  claimed: ["running", "requires_action", "cancel_requested", "failed"], running: ["requires_action", "failed", "cancel_requested", "succeeded"],
  requires_action: ["running", "waiting_for_executor", "failed", "cancelled", "succeeded"], failed: ["waiting_for_executor", "cancelled"],
  cancel_requested: ["cancelled"], succeeded: [], cancelled: []
};

function attempt(row) {
  if (!row) return null;
  return { ...row, row_version: Number(row.row_version), package_version: Number(row.package_version),
    claimed_at: iso(row.claimed_at), started_at: iso(row.started_at), completed_at: iso(row.completed_at),
    lease_expires_at: iso(row.lease_expires_at), heartbeat_at: iso(row.heartbeat_at),
    created_at: iso(row.created_at), updated_at: iso(row.updated_at), status_history: row.status_history || [] };
}

function candidate(row) {
  if (!row) return null;
  return { ...row, row_version: Number(row.row_version), package_version: Number(row.package_version), size: Number(row.size),
    created_at: iso(row.created_at), updated_at: iso(row.updated_at), uploaded_at: iso(row.uploaded_at) };
}

function report(row) {
  if (!row) return null;
  return { ...row, report_version: Number(row.report_version), package_version: Number(row.package_version),
    submitted_at: iso(row.submitted_at), started_at: iso(row.started_at), completed_at: iso(row.completed_at),
    deviations: row.deviations || [], supporting_outputs: row.supporting_outputs || [] };
}

function receipt(row) {
  return row ? { fingerprint: row.payload_fingerprint, attempt_id: row.attempt_id, candidate_id: row.candidate_id, report_id: row.report_id } : null;
}

async function readReceipt(client, receiptKey, fingerprint) {
  const row = one(await client.query("SELECT * FROM manual_execution_idempotency_receipts WHERE receipt_key=$1", [receiptKey]));
  if (!row) return null;
  if (row.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
  return receipt(row);
}

async function transitionOrder(client, value) {
  if (!value) return null;
  const current = one(await client.query("SELECT * FROM production_orders WHERE organization_id=$1 AND id=$2 FOR UPDATE", [value.organizationId, value.orderId]));
  if (!current || Number(current.row_version) !== value.expectedRevision || !value.fromStatuses.includes(current.status)) {
    throw failure("PRODUCTION_ORDER_CONFLICT");
  }
  if (current.status !== value.toStatus && !allowedTransitions[current.status]?.includes(value.toStatus)) {
    throw failure("PRODUCTION_ORDER_TRANSITION_INVALID");
  }
  const history = [...(current.status_history || []), { from_status: current.status, to_status: value.toStatus,
    at: value.at, actor_member_id: value.actorMemberId || null, actor_agent_id: value.actorAgentId || null, reason: value.reason || null }];
  const updated = one(await client.query(`UPDATE production_orders
    SET status=$3,row_version=row_version+1,status_history=$4,updated_at=$5
    WHERE organization_id=$1 AND id=$2 AND row_version=$6 AND status=ANY($7::text[]) RETURNING *`,
    [value.organizationId, value.orderId, value.toStatus, json(history), value.at, value.expectedRevision, value.fromStatuses]));
  if (!updated) throw failure("PRODUCTION_ORDER_CONFLICT");
  await client.query(`INSERT INTO production_order_audit_events(id,organization_id,actor_member_id,production_order_id,event_type,metadata,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), value.organizationId, value.actorMemberId || null, value.orderId,
    `production_order.${value.toStatus}`, json({ from_status: current.status, to_status: value.toStatus, reason: value.reason || null,
      ...(value.actorAgentId ? { agent_id: value.actorAgentId } : {}) }), value.at]);
  return updated;
}

async function appendAudit(client, event) {
  if (!event) return;
  await client.query(`INSERT INTO manual_execution_audit_events
    (id,organization_id,actor_member_id,actor_agent_id,production_order_id,execution_attempt_id,candidate_id,report_id,package_id,event_type,metadata,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [event.id || randomUUID(), event.organization_id, event.actor_member_id || null,
    event.actor_agent_id || null, event.production_order_id, event.attempt_id || null, event.candidate_id || event.metadata?.candidate_id || null,
    event.report_id || event.metadata?.report_id || null, event.package_id || null, event.event_type, json(event.metadata || {}), event.created_at]);
}

async function appendLedger(client, { organizationId, attemptId, fromStatus, toStatus, actorMemberId = null, actorAgentId = null, reason = null, createdAt }) {
  await client.query(`INSERT INTO manual_execution_status_ledger
    (id,organization_id,execution_attempt_id,from_status,to_status,actor_member_id,actor_agent_id,reason,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [randomUUID(), organizationId, attemptId, fromStatus, toStatus, actorMemberId, actorAgentId, reason, createdAt]);
}

async function updateAttempt(pool, { receiptKey, fingerprint, attemptId, organizationId, expectedRevision, patch, fromStatus, orderTransition: orderChange, transitionOrder: externalTransition, toStatus, audit }) {
  return withTransaction(pool, async (client) => {
    const replay = await readReceipt(client, receiptKey, fingerprint);
    if (replay) return { attempt: attempt(one(await client.query("SELECT * FROM manual_execution_attempts WHERE organization_id=$1 AND id=$2", [organizationId, replay.attempt_id]))), replayed: true };
    const current = attempt(one(await client.query("SELECT * FROM manual_execution_attempts WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, attemptId])));
    if (!current) throw failure("MANUAL_EXECUTION_ATTEMPT_NOT_FOUND");
    if (current.row_version !== expectedRevision || current.status !== fromStatus) throw failure("MANUAL_EXECUTION_ATTEMPT_CONFLICT");
    if (orderChange) await transitionOrder(client, orderChange);
    else if (externalTransition && !(await externalTransition())) throw failure("PRODUCTION_ORDER_CONFLICT");
    const updated = attempt(one(await client.query(`UPDATE manual_execution_attempts SET status=$3,updated_at=$4,status_history=$5,row_version=row_version+1
      WHERE organization_id=$1 AND id=$2 AND row_version=$6 AND status=$7 RETURNING *`, [organizationId, attemptId, toStatus, patch.updated_at, json(patch.status_history), expectedRevision, fromStatus])));
    if (!updated) throw failure("MANUAL_EXECUTION_ATTEMPT_CONFLICT");
    await client.query(`INSERT INTO manual_execution_idempotency_receipts(receipt_key,organization_id,payload_fingerprint,attempt_id,created_at) VALUES ($1,$2,$3,$4,$5)`, [receiptKey, organizationId, fingerprint, attemptId, patch.updated_at]);
    await appendLedger(client, { organizationId, attemptId, fromStatus, toStatus, actorMemberId: current.operator_id, actorAgentId: current.executor_agent_id, createdAt: patch.updated_at });
    await appendAudit(client, audit);
    return { attempt: updated, replayed: false };
  });
}

export function createPostgresManualExecutionRepository({ pool, ownsPool = false } = {}) {
  if (!pool?.connect) throw new TypeError("pool is required");
  return {
    async initialize() { await assertManualExecutionSchemaCurrent(pool); },
    async close() { if (ownsPool) await pool.end(); },

    async getReceipt(receiptKey, fingerprint) { return readReceipt(pool, receiptKey, fingerprint); },

    async claimAttempt({ receiptKey, fingerprint, attempt: value, orderTransition, transitionOrder: externalTransition, audit }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`manual-execution-claim:${value.organization_id}:${value.production_order_id}`]);
        const replay = await readReceipt(client, receiptKey, fingerprint);
        if (replay) return { attempt: attempt(one(await client.query("SELECT * FROM manual_execution_attempts WHERE organization_id=$1 AND id=$2", [value.organization_id, replay.attempt_id]))), replayed: true };
        const active = one(await client.query("SELECT 1 FROM manual_execution_attempts WHERE organization_id=$1 AND production_order_id=$2 AND status IN ('claimed','running') FOR UPDATE", [value.organization_id, value.production_order_id]));
        if (active) throw failure("MANUAL_EXECUTION_ATTEMPT_ACTIVE");
        if (orderTransition) await transitionOrder(client, orderTransition);
        else if (externalTransition && !(await externalTransition())) throw failure("PRODUCTION_ORDER_CONFLICT");
        await client.query(`INSERT INTO manual_execution_attempts
          (id,organization_id,production_order_id,package_id,package_version,manifest_hash,package_hash,executor_type,operator_id,executor_agent_id,status,row_version,claimed_at,started_at,completed_at,lease_expires_at,heartbeat_at,progress_phase,created_at,updated_at,status_history)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`, [value.id, value.organization_id, value.production_order_id,
          value.package_id, value.package_version, value.manifest_hash, value.package_hash, value.executor_type, value.operator_id, value.executor_agent_id,
          value.status, value.row_version, value.claimed_at, value.started_at, value.completed_at, value.lease_expires_at, value.heartbeat_at,
          value.progress_phase, value.created_at, value.updated_at, json(value.status_history)]);
        await client.query(`INSERT INTO manual_execution_idempotency_receipts(receipt_key,organization_id,payload_fingerprint,attempt_id,created_at)
          VALUES ($1,$2,$3,$4,$5)`, [receiptKey, value.organization_id, fingerprint, value.id, value.created_at]);
        await appendLedger(client, { organizationId: value.organization_id, attemptId: value.id, fromStatus: null, toStatus: value.status,
          actorMemberId: value.operator_id, actorAgentId: value.executor_agent_id, createdAt: value.claimed_at });
        await appendAudit(client, audit);
        return { attempt: value, replayed: false };
      });
    },

    async startAttempt({ receiptKey, fingerprint, attemptId, organizationId, expectedRevision, patch, orderTransition, transitionOrder: externalTransition, audit }) {
      return withTransaction(pool, async (client) => {
        const replay = await readReceipt(client, receiptKey, fingerprint);
        if (replay) return { attempt: attempt(one(await client.query("SELECT * FROM manual_execution_attempts WHERE organization_id=$1 AND id=$2", [organizationId, replay.attempt_id]))), replayed: true };
        const current = attempt(one(await client.query("SELECT * FROM manual_execution_attempts WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, attemptId])));
        if (!current) throw failure("MANUAL_EXECUTION_ATTEMPT_NOT_FOUND");
        if (current.row_version !== expectedRevision || current.status !== "claimed") throw failure("MANUAL_EXECUTION_ATTEMPT_CONFLICT");
        if (orderTransition) await transitionOrder(client, orderTransition);
        else if (externalTransition && !(await externalTransition())) throw failure("PRODUCTION_ORDER_CONFLICT");
        const updated = attempt(one(await client.query(`UPDATE manual_execution_attempts
          SET status=$3,started_at=$4,lease_expires_at=$5,heartbeat_at=$6,progress_phase=$7,updated_at=$8,status_history=$9,row_version=row_version+1
          WHERE organization_id=$1 AND id=$2 AND row_version=$10 AND status='claimed' RETURNING *`,
          [organizationId, attemptId, patch.status, patch.started_at, patch.lease_expires_at, patch.heartbeat_at, patch.progress_phase,
            patch.updated_at, json(patch.status_history), expectedRevision])));
        if (!updated) throw failure("MANUAL_EXECUTION_ATTEMPT_CONFLICT");
        await client.query(`INSERT INTO manual_execution_idempotency_receipts(receipt_key,organization_id,payload_fingerprint,attempt_id,created_at)
          VALUES ($1,$2,$3,$4,$5)`, [receiptKey, organizationId, fingerprint, attemptId, patch.updated_at]);
        await appendLedger(client, { organizationId, attemptId, fromStatus: "claimed", toStatus: patch.status,
          actorMemberId: current.operator_id, actorAgentId: current.executor_agent_id, createdAt: patch.updated_at });
        await appendAudit(client, audit);
        return { attempt: updated, replayed: false };
      });
    },

    async heartbeatAttempt({ receiptKey, fingerprint, attemptId, organizationId, agentId, expectedRevision, now, leaseExpiresAt, progressPhase, audit }) {
      return withTransaction(pool, async (client) => {
        const replay = await readReceipt(client, receiptKey, fingerprint);
        if (replay) return { attempt: attempt(one(await client.query("SELECT * FROM manual_execution_attempts WHERE organization_id=$1 AND id=$2", [organizationId, replay.attempt_id]))), replayed: true };
        const current = attempt(one(await client.query("SELECT * FROM manual_execution_attempts WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, attemptId])));
        if (!current || current.executor_type !== "local_agent" || current.executor_agent_id !== agentId || current.operator_id !== null) throw failure("LOCAL_AGENT_ATTEMPT_NOT_FOUND");
        if (current.row_version !== expectedRevision || !["claimed", "running"].includes(current.status)) throw failure("LOCAL_AGENT_ATTEMPT_CONFLICT");
        const updated = attempt(one(await client.query(`UPDATE manual_execution_attempts
          SET heartbeat_at=$3,lease_expires_at=$4,progress_phase=$5,updated_at=$3,row_version=row_version+1
          WHERE organization_id=$1 AND id=$2 AND row_version=$6 AND status IN ('claimed','running') RETURNING *`,
          [organizationId, attemptId, now, leaseExpiresAt, progressPhase, expectedRevision])));
        if (!updated) throw failure("LOCAL_AGENT_ATTEMPT_CONFLICT");
        await client.query(`INSERT INTO manual_execution_idempotency_receipts(receipt_key,organization_id,payload_fingerprint,attempt_id,created_at) VALUES ($1,$2,$3,$4,$5)`, [receiptKey, organizationId, fingerprint, attemptId, now]);
        await appendAudit(client, audit);
        return { attempt: updated, replayed: false };
      });
    },

    async expireAgentAttempt({ receiptKey = null, fingerprint = null, attemptId, organizationId, agentId, expectedRevision, now, patch, orderTransition, transitionOrder: externalTransition, audit }) {
      return withTransaction(pool, async (client) => {
        const replay = receiptKey ? await readReceipt(client, receiptKey, fingerprint) : null;
        if (replay) return { attempt: attempt(one(await client.query("SELECT * FROM manual_execution_attempts WHERE organization_id=$1 AND id=$2", [organizationId, replay.attempt_id]))), replayed: true };
        const current = attempt(one(await client.query("SELECT * FROM manual_execution_attempts WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, attemptId])));
        if (!current || current.executor_type !== "local_agent" || current.executor_agent_id !== agentId || current.operator_id !== null) throw failure("LOCAL_AGENT_ATTEMPT_NOT_FOUND");
        if (current.row_version !== expectedRevision || !["claimed", "running"].includes(current.status)) throw failure("LOCAL_AGENT_ATTEMPT_CONFLICT");
        if (orderTransition) await transitionOrder(client, orderTransition);
        else if (externalTransition && !(await externalTransition())) throw failure("PRODUCTION_ORDER_CONFLICT");
        const updated = attempt(one(await client.query(`UPDATE manual_execution_attempts
          SET status=$3,lease_expires_at=NULL,heartbeat_at=$4,progress_phase=$5,updated_at=$4,status_history=$6,row_version=row_version+1
          WHERE organization_id=$1 AND id=$2 AND row_version=$7 AND status=$8 RETURNING *`,
          [organizationId, attemptId, patch.status, now, patch.progress_phase, json(patch.status_history), expectedRevision, current.status])));
        if (!updated) throw failure("LOCAL_AGENT_ATTEMPT_CONFLICT");
        if (receiptKey) await client.query(`INSERT INTO manual_execution_idempotency_receipts(receipt_key,organization_id,payload_fingerprint,attempt_id,created_at) VALUES ($1,$2,$3,$4,$5)`, [receiptKey, organizationId, fingerprint, attemptId, now]);
        await appendLedger(client, { organizationId, attemptId, fromStatus: current.status, toStatus: updated.status,
          actorAgentId: agentId, reason: "lease_expired", createdAt: now });
        await appendAudit(client, audit);
        return { attempt: updated, replayed: false };
      });
    },

    async createCandidateUpload({ receiptKey, fingerprint, candidate: value }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`manual-execution-candidate:${value.organization_id}:${value.execution_attempt_id}`]);
        const replay = await readReceipt(client, receiptKey, fingerprint);
        if (replay) return { candidate: candidate(one(await client.query("SELECT * FROM manual_execution_candidates WHERE organization_id=$1 AND id=$2", [value.organization_id, replay.candidate_id]))), replayed: true };
        if (value.role === "primary_video" && one(await client.query("SELECT 1 FROM manual_execution_candidates WHERE organization_id=$1 AND execution_attempt_id=$2 AND role='primary_video' AND status <> 'removed' FOR UPDATE", [value.organization_id, value.execution_attempt_id]))) {
          throw failure("MANUAL_EXECUTION_PRIMARY_OUTPUT_EXISTS");
        }
        await client.query(`INSERT INTO manual_execution_candidates
          (id,organization_id,production_order_id,execution_attempt_id,package_id,package_version,manifest_hash,role,original_filename,media_type,size,checksum,status,row_version,upload_token_digest,object_key,uploaded_by_member_id,uploaded_by_agent_id,created_at,updated_at,uploaded_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`, [value.id, value.organization_id, value.production_order_id,
          value.execution_attempt_id, value.package_id, value.package_version, value.manifest_hash, value.role, value.original_filename, value.media_type,
          value.size, value.checksum, value.status, value.row_version, value.upload_token_digest, value.object_key, value.uploaded_by_member_id ?? null,
          value.uploaded_by_agent_id ?? null, value.created_at, value.updated_at, value.uploaded_at]);
        await client.query(`INSERT INTO manual_execution_idempotency_receipts(receipt_key,organization_id,payload_fingerprint,candidate_id,created_at)
          VALUES ($1,$2,$3,$4,$5)`, [receiptKey, value.organization_id, fingerprint, value.id, value.created_at]);
        await appendAudit(client, value.audit);
        return { candidate: value, replayed: false };
      });
    },

    async getCandidate(organizationId, candidateId) {
      return candidate(one(await pool.query("SELECT * FROM manual_execution_candidates WHERE organization_id=$1 AND id=$2", [organizationId, candidateId])));
    },

    async findCandidateByTokenDigest(organizationId, digest) {
      return candidate(one(await pool.query("SELECT * FROM manual_execution_candidates WHERE organization_id=$1 AND upload_token_digest=$2", [organizationId, digest])));
    },

    async rotateCandidateUploadToken({ organizationId, candidateId, tokenDigest, now }) {
      return withTransaction(pool, async (client) => {
        const current = candidate(one(await client.query("SELECT * FROM manual_execution_candidates WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, candidateId])));
        if (!current) throw failure("MANUAL_EXECUTION_CANDIDATE_NOT_FOUND");
        if (current.status !== "upload_pending") return current;
        return candidate(one(await client.query(`UPDATE manual_execution_candidates SET upload_token_digest=$3,updated_at=$4,row_version=row_version+1
          WHERE organization_id=$1 AND id=$2 AND row_version=$5 AND status='upload_pending' RETURNING *`, [organizationId, candidateId, tokenDigest, now, current.row_version])));
      });
    },

    async markCandidateUploaded({ organizationId, candidateId, now, receiptKey, fingerprint, audit }) {
      return withTransaction(pool, async (client) => {
        const replay = receiptKey ? await readReceipt(client, receiptKey, fingerprint) : null;
        if (replay) return { candidate: candidate(one(await client.query("SELECT * FROM manual_execution_candidates WHERE organization_id=$1 AND id=$2", [organizationId, replay.candidate_id]))), replayed: true };
        const current = candidate(one(await client.query("SELECT * FROM manual_execution_candidates WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, candidateId])));
        if (!current) throw failure("MANUAL_EXECUTION_CANDIDATE_NOT_FOUND");
        if (current.status === "uploaded") {
          if (receiptKey) await client.query(`INSERT INTO manual_execution_idempotency_receipts(receipt_key,organization_id,payload_fingerprint,candidate_id,created_at) VALUES ($1,$2,$3,$4,$5)`, [receiptKey, organizationId, fingerprint, candidateId, now]);
          return { candidate: current, replayed: true };
        }
        if (current.status !== "upload_pending") throw failure("MANUAL_EXECUTION_CANDIDATE_CONFLICT");
        const updated = candidate(one(await client.query(`UPDATE manual_execution_candidates SET status='uploaded',uploaded_at=$3,updated_at=$3,row_version=row_version+1
          WHERE organization_id=$1 AND id=$2 AND row_version=$4 AND status='upload_pending' RETURNING *`, [organizationId, candidateId, now, current.row_version])));
        if (!updated) throw failure("MANUAL_EXECUTION_CANDIDATE_CONFLICT");
        if (receiptKey) await client.query(`INSERT INTO manual_execution_idempotency_receipts(receipt_key,organization_id,payload_fingerprint,candidate_id,created_at) VALUES ($1,$2,$3,$4,$5)`, [receiptKey, organizationId, fingerprint, candidateId, now]);
        await appendAudit(client, audit);
        return { candidate: updated, replayed: false };
      });
    },

    async recordCandidateUpload({ receiptKey, fingerprint, organizationId, candidateId, now }) {
      return withTransaction(pool, async (client) => {
        const replay = await readReceipt(client, receiptKey, fingerprint);
        if (replay) return { candidate: candidate(one(await client.query("SELECT * FROM manual_execution_candidates WHERE organization_id=$1 AND id=$2", [organizationId, replay.candidate_id]))), replayed: true };
        const current = candidate(one(await client.query("SELECT * FROM manual_execution_candidates WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, candidateId])));
        if (!current) throw failure("MANUAL_EXECUTION_CANDIDATE_NOT_FOUND");
        await client.query(`INSERT INTO manual_execution_idempotency_receipts(receipt_key,organization_id,payload_fingerprint,candidate_id,created_at)
          VALUES ($1,$2,$3,$4,$5)`, [receiptKey, organizationId, fingerprint, candidateId, now]);
        return { candidate: current, replayed: false };
      });
    },

    async markCandidateVerification({ organizationId, candidateId, verificationStatus, verificationJobId = null, failureKind = null, failureCode = null, now, transactionClient = null }) {
      const work = async (client) => {
        const updated = candidate(one(await client.query(
          `UPDATE manual_execution_candidates
              SET verification_status=$3, verification_job_id=$4, verification_failure_kind=$5,
                  verification_failure_code=$6, verification_updated_at=$7, updated_at=$7, row_version=row_version+1
            WHERE organization_id=$1 AND id=$2 RETURNING *`,
          [organizationId, candidateId, verificationStatus, verificationJobId, failureKind, failureCode, now]
        )));
        if (!updated) throw failure("MANUAL_EXECUTION_CANDIDATE_NOT_FOUND");
        return updated;
      };
      if (transactionClient) return work(transactionClient);
      return withTransaction(pool, work);
    },

    async saveReport({ receiptKey, fingerprint, report: value, attemptId, organizationId, expectedRevision, patchAttempt, candidatePatches = [], orderTransition, transitionOrder: externalTransition, audit }) {
      return withTransaction(pool, async (client) => {
        const replay = await readReceipt(client, receiptKey, fingerprint);
        if (replay) return { report: report(one(await client.query("SELECT * FROM manual_execution_reports WHERE organization_id=$1 AND id=$2", [organizationId, replay.report_id]))), attempt: attempt(one(await client.query("SELECT * FROM manual_execution_attempts WHERE organization_id=$1 AND id=$2", [organizationId, replay.attempt_id]))), replayed: true };
        const current = attempt(one(await client.query("SELECT * FROM manual_execution_attempts WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, attemptId])));
        if (!current) throw failure("MANUAL_EXECUTION_ATTEMPT_NOT_FOUND");
        if (current.row_version !== expectedRevision) throw failure("MANUAL_EXECUTION_ATTEMPT_CONFLICT");
        const existingReport = one(await client.query("SELECT organization_id FROM manual_execution_reports WHERE id=$1", [value.id]));
        if (existingReport && existingReport.organization_id !== organizationId) throw failure("MANUAL_EXECUTION_REPORT_CONFLICT");
        if (orderTransition) await transitionOrder(client, orderTransition);
        else if (externalTransition && !(await externalTransition())) throw failure("PRODUCTION_ORDER_CONFLICT");
        const leaseExpiresAt = Object.hasOwn(patchAttempt, "lease_expires_at") ? patchAttempt.lease_expires_at : current.lease_expires_at;
        const heartbeatAt = Object.hasOwn(patchAttempt, "heartbeat_at") ? patchAttempt.heartbeat_at : current.heartbeat_at;
        const progressPhase = Object.hasOwn(patchAttempt, "progress_phase") ? patchAttempt.progress_phase : current.progress_phase;
        const updatedAttempt = attempt(one(await client.query(`UPDATE manual_execution_attempts
          SET status=$3,completed_at=$4,lease_expires_at=$5,heartbeat_at=$6,progress_phase=$7,updated_at=$8,status_history=$9,row_version=row_version+1
          WHERE organization_id=$1 AND id=$2 AND row_version=$10 RETURNING *`,
          [organizationId, attemptId, patchAttempt.status, patchAttempt.completed_at, leaseExpiresAt, heartbeatAt, progressPhase,
            patchAttempt.updated_at, json(patchAttempt.status_history), expectedRevision])));
        if (!updatedAttempt) throw failure("MANUAL_EXECUTION_ATTEMPT_CONFLICT");
        for (const patch of candidatePatches) {
          await client.query(`UPDATE manual_execution_candidates SET status=$3,updated_at=$4,row_version=row_version+1
            WHERE organization_id=$1 AND id=$2`, [organizationId, patch.id, patch.values.status, value.submitted_at]);
        }
        await client.query(`INSERT INTO manual_execution_reports
          (id,organization_id,report_version,production_order_id,execution_attempt_id,package_id,package_version,manifest_hash,submitted_by,submitted_by_agent_id,submitted_at,supersedes_report_id,outcome,started_at,completed_at,operator_note,deviations,primary_output,supporting_outputs,error_category,failure_stage,requires_action_reason,retryability,upstream_return_target)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)`, [value.id, value.organization_id, value.report_version,
          value.production_order_id, value.execution_attempt_id, value.package_id, value.package_version, value.manifest_hash, value.submitted_by,
          value.submitted_by_agent_id ?? null, value.submitted_at, value.supersedes_report_id, value.outcome, value.started_at, value.completed_at, value.operator_note, json(value.deviations),
          json(value.primary_output), json(value.supporting_outputs), value.error_category, value.failure_stage, value.requires_action_reason,
          value.retryability, value.upstream_return_target]);
        await client.query(`INSERT INTO manual_execution_idempotency_receipts(receipt_key,organization_id,payload_fingerprint,report_id,attempt_id,created_at)
          VALUES ($1,$2,$3,$4,$5,$6)`, [receiptKey, organizationId, fingerprint, value.id, attemptId, value.submitted_at]);
        await appendLedger(client, { organizationId, attemptId, fromStatus: patchAttempt.previous_status, toStatus: patchAttempt.status,
          actorMemberId: value.submitted_by ?? null, actorAgentId: value.submitted_by_agent_id ?? null, createdAt: value.submitted_at });
        await appendAudit(client, audit);
        return { report: value, attempt: updatedAttempt, replayed: false };
      });
    },

    async recoverAttempt({ receiptKey, fingerprint, attemptId, organizationId, expectedRevision, patch, orderTransition, transitionOrder: externalTransition, audit }) {
      return updateAttempt(pool, { receiptKey, fingerprint, attemptId, organizationId, expectedRevision, patch,
        fromStatus: "requires_action", orderTransition, transitionOrder: externalTransition, toStatus: patch.status, audit });
    },

    async supersedeFailedAttempt({ receiptKey, fingerprint, attemptId, organizationId, expectedRevision, patch, orderTransition, transitionOrder: externalTransition, audit }) {
      return updateAttempt(pool, { receiptKey, fingerprint, attemptId, organizationId, expectedRevision, patch,
        fromStatus: "failed", orderTransition, transitionOrder: externalTransition, toStatus: patch.status, audit });
    },

    async cancelAttempt({ receiptKey, fingerprint, attemptId, organizationId, expectedRevision, patch, orderTransition, transitionOrder: externalTransition, audit }) {
      return updateAttempt(pool, { receiptKey, fingerprint, attemptId, organizationId, expectedRevision, patch,
        fromStatus: patch.previous_status, orderTransition, transitionOrder: externalTransition, toStatus: patch.status, audit });
    },

    async cancelWaitingOrder({ receiptKey, fingerprint, organizationId, orderId, orderTransition, transitionOrder: externalTransition, audit, now }) {
      return withTransaction(pool, async (client) => {
        const replay = await readReceipt(client, receiptKey, fingerprint);
        if (replay) return { order_id: replay.order_id, replayed: true };
        if (orderTransition) await transitionOrder(client, orderTransition);
        else if (externalTransition && !(await externalTransition())) throw failure("PRODUCTION_ORDER_CONFLICT");
        await client.query(`INSERT INTO manual_execution_idempotency_receipts(receipt_key,organization_id,payload_fingerprint,created_at)
          VALUES ($1,$2,$3,$4)`, [receiptKey, organizationId, fingerprint, now]);
        await appendAudit(client, audit);
        return { order_id: orderId, replayed: false };
      });
    },

    async getAttempt(organizationId, attemptId) { return attempt(one(await pool.query("SELECT * FROM manual_execution_attempts WHERE organization_id=$1 AND id=$2", [organizationId, attemptId]))); },
    async getReport(organizationId, reportId) { return report(one(await pool.query("SELECT * FROM manual_execution_reports WHERE organization_id=$1 AND id=$2", [organizationId, reportId]))); },
    async listAttempts(organizationId, productionOrderId) {
      const result = productionOrderId
        ? await pool.query("SELECT * FROM manual_execution_attempts WHERE organization_id=$1 AND production_order_id=$2 ORDER BY created_at,id", [organizationId, productionOrderId])
        : await pool.query("SELECT * FROM manual_execution_attempts WHERE organization_id=$1 ORDER BY created_at,id", [organizationId]);
      return result.rows.map(attempt);
    },
    async listReports(organizationId, attemptId) {
      const result = attemptId
        ? await pool.query("SELECT * FROM manual_execution_reports WHERE organization_id=$1 AND execution_attempt_id=$2 ORDER BY report_version,id", [organizationId, attemptId])
        : await pool.query("SELECT * FROM manual_execution_reports WHERE organization_id=$1 ORDER BY submitted_at,id", [organizationId]);
      return result.rows.map(report);
    },
    async listCandidates(organizationId, attemptId) {
      const result = attemptId
        ? await pool.query("SELECT * FROM manual_execution_candidates WHERE organization_id=$1 AND execution_attempt_id=$2 ORDER BY created_at,id", [organizationId, attemptId])
        : await pool.query("SELECT * FROM manual_execution_candidates WHERE organization_id=$1 ORDER BY created_at,id", [organizationId]);
      return result.rows.map(candidate);
    },
    async listAuditEvents(organizationId = null) {
      const result = organizationId ? await pool.query("SELECT * FROM manual_execution_audit_events WHERE organization_id=$1 ORDER BY created_at,id", [organizationId]) : await pool.query("SELECT * FROM manual_execution_audit_events ORDER BY created_at,id");
      return result.rows.map((row) => ({ ...row, created_at: iso(row.created_at) }));
    },
    async listStatusTransitions(organizationId = null) {
      const result = organizationId ? await pool.query("SELECT * FROM manual_execution_status_ledger WHERE organization_id=$1 ORDER BY created_at,id", [organizationId]) : await pool.query("SELECT * FROM manual_execution_status_ledger ORDER BY created_at,id");
      return result.rows.map((row) => ({ ...row, created_at: iso(row.created_at) }));
    }
  };
}
