import { randomUUID } from "node:crypto";

import { withTransaction } from "../identity/postgres.js";
import { assertWorkVerificationSchemaCurrent } from "./postgres.js";

const failure = (code) => Object.assign(new Error(code), { code });
const one = (result) => result.rows[0] || null;
const iso = (value) => value instanceof Date ? value.toISOString() : value;
const json = (value) => JSON.stringify(value == null ? null : value);

function jobProjection(row) {
  if (!row) return null;
  return { ...row, attempts: Number(row.attempts), max_attempts: Number(row.max_attempts), created_at: iso(row.created_at), updated_at: iso(row.updated_at),
    lease_expires_at: iso(row.lease_expires_at), started_at: iso(row.started_at), heartbeat_at: iso(row.heartbeat_at), completed_at: iso(row.completed_at), checks: row.checks || [] };
}

function workProjection(row) {
  if (!row) return null;
  return { ...row, package_version: Number(row.package_version), primary_output_size: Number(row.primary_output_size),
    created_at: iso(row.created_at), updated_at: iso(row.updated_at), production_config_snapshot: row.production_config_snapshot || {}, package_manifest_snapshot: row.package_manifest_snapshot || {} };
}

async function readReceipt(client, receiptKey, fingerprint) {
  const row = one(await client.query("SELECT * FROM work_verification_idempotency_receipts WHERE receipt_key=$1", [receiptKey]));
  if (!row) return null;
  if (row.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
  return { fingerprint: row.payload_fingerprint, job_id: row.job_id, work_id: row.work_id };
}

async function transitionOrder(client, value) {
  const current = one(await client.query("SELECT * FROM production_orders WHERE organization_id=$1 AND id=$2 FOR UPDATE", [value.organizationId, value.orderId]));
  if (!current || Number(current.row_version) !== Number(value.expectedRevision) || !value.fromStatuses.includes(current.status)) return null;
  const history = [...(current.status_history || []), { from_status: current.status, to_status: value.toStatus, at: value.at,
    actor_member_id: value.actorMemberId || null, reason: value.reason || null }];
  const updated = one(await client.query(
    `UPDATE production_orders SET status=$3,row_version=row_version+1,status_history=$4,updated_at=$5
      WHERE organization_id=$1 AND id=$2 AND row_version=$6 AND status=ANY($7::text[]) RETURNING *`,
    [value.organizationId, value.orderId, value.toStatus, json(history), value.at, value.expectedRevision, value.fromStatuses]
  ));
  if (!updated) return null;
  await client.query(
    `INSERT INTO production_order_audit_events(id,organization_id,actor_member_id,production_order_id,event_type,metadata,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [randomUUID(), value.organizationId, value.actorMemberId || null, value.orderId, `production_order.${value.toStatus}`,
      { from_status: current.status, to_status: value.toStatus, reason: value.reason || null }, value.at]
  );
  return { ...updated, row_version: Number(updated.row_version), status_history: history };
}

export function createPostgresWorkVerificationRepository({ pool, ownsPool = false } = {}) {
  if (!pool?.query || !pool?.connect) throw new TypeError("pool is required");

  async function appendAudit(client, event) {
    await client.query(
      `INSERT INTO work_verification_audit_events(id,organization_id,actor_member_id,production_order_id,job_id,work_id,candidate_id,asset_version_id,event_type,metadata,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [event.id || randomUUID(), event.organization_id, event.actor_member_id || null, event.production_order_id, event.job_id || null, event.work_id || null,
        event.candidate_id || null, event.asset_version_id || null, event.event_type, event.metadata || {}, event.created_at]
    );
  }

  async function appendLedger(client, { organizationId, jobId, fromStatus, toStatus, failureKind = null, reason = null, createdAt }) {
    await client.query(
      `INSERT INTO work_verification_status_ledger(id,organization_id,job_id,from_status,to_status,failure_kind,reason,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [randomUUID(), organizationId, jobId, fromStatus || null, toStatus, failureKind, reason, createdAt]
    );
  }

  return {
    async initialize() { await assertWorkVerificationSchemaCurrent(pool); },
    async close() { if (ownsPool) await pool.end(); },

    async getReceipt(receiptKey, fingerprint) { return readReceipt(pool, receiptKey, fingerprint); },

    async createVerificationRequest({ receiptKey, fingerprint, job }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`work-verification-request:${receiptKey}`]);
        const replay = await readReceipt(client, receiptKey, fingerprint);
        if (replay) return { job: jobProjection(one(await client.query("SELECT * FROM work_verification_jobs WHERE organization_id=$1 AND id=$2", [job.organization_id, replay.job_id]))), work: replay.work_id ? workProjection(one(await client.query("SELECT * FROM works WHERE organization_id=$1 AND id=$2", [job.organization_id, replay.work_id]))) : null, replayed: true };
        const existing = one(await client.query(
          `SELECT * FROM work_verification_jobs WHERE organization_id=$1 AND production_order_id=$2 AND execution_attempt_id=$3 AND primary_output_checksum=$4 FOR UPDATE`,
          [job.organization_id, job.production_order_id, job.execution_attempt_id, job.primary_output_checksum]
        ));
        if (existing) {
          if (existing.report_id !== job.report_id || existing.candidate_id !== job.candidate_id) throw failure("WORK_VERIFICATION_CONFLICT");
          const existingWork = existing.work_id ? workProjection(one(await client.query("SELECT * FROM works WHERE organization_id=$1 AND id=$2", [job.organization_id, existing.work_id]))) : null;
          await client.query("INSERT INTO work_verification_idempotency_receipts(receipt_key,organization_id,payload_fingerprint,job_id,work_id,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [receiptKey, job.organization_id, fingerprint, existing.id, existing.work_id, job.created_at]);
          return { job: jobProjection(existing), work: existingWork, replayed: true };
        }
        const conflicting = one(await client.query("SELECT 1 FROM works WHERE organization_id=$1 AND production_order_id=$2 LIMIT 1 FOR UPDATE", [job.organization_id, job.production_order_id]));
        if (conflicting) throw failure("WORK_VERIFICATION_PRIMARY_WORK_EXISTS");
        await client.query(
          `INSERT INTO work_verification_jobs(id,organization_id,type,production_order_id,execution_attempt_id,report_id,candidate_id,primary_output_checksum,
             requested_by_member_id,requested_by_role,status,verification_status,failure_kind,failure_code,failure_reason,attempts,max_attempts,lease_token,
             lease_expires_at,started_at,heartbeat_at,completed_at,work_id,receipt_key,checks,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
          [job.id, job.organization_id, job.type, job.production_order_id, job.execution_attempt_id, job.report_id, job.candidate_id, job.primary_output_checksum,
            job.requested_by_member_id, job.requested_by_role, job.status, job.verification_status, job.failure_kind, job.failure_code, job.failure_reason,
            job.attempts, job.max_attempts, job.lease_token, job.lease_expires_at, job.started_at, job.heartbeat_at, job.completed_at, job.work_id,
            job.receipt_key, json(job.checks), job.created_at, job.updated_at]
        );
        await client.query("INSERT INTO work_verification_idempotency_receipts(receipt_key,organization_id,payload_fingerprint,job_id,work_id,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [receiptKey, job.organization_id, fingerprint, job.id, null, job.created_at]);
        await appendLedger(client, { organizationId: job.organization_id, jobId: job.id, fromStatus: null, toStatus: "queued", createdAt: job.created_at });
        await appendAudit(client, { organization_id: job.organization_id, actor_member_id: job.requested_by_member_id, production_order_id: job.production_order_id,
          job_id: job.id, candidate_id: job.candidate_id, event_type: "work_verification.requested", metadata: { checksum: job.primary_output_checksum }, created_at: job.created_at });
        return { job: jobProjection(job), work: null, replayed: false };
      });
    },

    async claimNextVerificationJob({ now, leaseExpiresAt, leaseToken, onExpired = null }) {
      return withTransaction(pool, async (client) => {
        const expired = (await client.query("SELECT * FROM work_verification_jobs WHERE status='running' AND lease_expires_at <= $1 ORDER BY created_at,id FOR UPDATE SKIP LOCKED", [now])).rows;
        for (const item of expired) {
          const job = jobProjection(item);
          if (job.attempts >= job.max_attempts) {
            const reason = "产物核验重试次数已用尽。";
            await client.query(
              `UPDATE work_verification_jobs SET status='failed',verification_status='failed',failure_kind='technical',failure_code='WORK_VERIFICATION_RETRY_EXHAUSTED',
                 failure_reason=$2,completed_at=$3,lease_token=NULL,lease_expires_at=NULL,updated_at=$3 WHERE id=$1`, [job.id, reason, now]
            );
            if (onExpired) await onExpired({ ...job, status: "failed", verification_status: "failed" }, { failureKind: "technical", failureCode: "WORK_VERIFICATION_RETRY_EXHAUSTED", now, transactionClient: client });
            await appendAudit(client, { organization_id: job.organization_id, production_order_id: job.production_order_id, job_id: job.id,
              candidate_id: job.candidate_id, event_type: "work_verification.technical_failed", metadata: { failure_code: "WORK_VERIFICATION_RETRY_EXHAUSTED" }, created_at: now });
            await appendLedger(client, { organizationId: job.organization_id, jobId: job.id, fromStatus: "running", toStatus: "failed", failureKind: "technical", reason, createdAt: now });
          } else {
            await client.query("UPDATE work_verification_jobs SET status='queued',verification_status='queued',lease_token=NULL,lease_expires_at=NULL,updated_at=$2 WHERE id=$1", [job.id, now]);
            if (onExpired) await onExpired({ ...job, status: "queued", verification_status: "queued" }, { failureKind: null, failureCode: null, now, transactionClient: client });
            await appendLedger(client, { organizationId: job.organization_id, jobId: job.id, fromStatus: "running", toStatus: "queued", createdAt: now });
          }
        }
        const current = one(await client.query("SELECT * FROM work_verification_jobs WHERE status='queued' AND attempts < max_attempts ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1", []));
        if (!current) return null;
        const claimed = jobProjection(one(await client.query(
          `UPDATE work_verification_jobs SET status='running',verification_status='running',attempts=attempts+1,lease_token=$2,
             lease_expires_at=$3,started_at=coalesce(started_at,$1),heartbeat_at=$1,updated_at=$1 WHERE id=$4 RETURNING *`, [now, leaseToken, leaseExpiresAt, current.id]
        )));
        await appendLedger(client, { organizationId: claimed.organization_id, jobId: claimed.id, fromStatus: "queued", toStatus: "running", createdAt: now });
        return claimed;
      });
    },

    async heartbeatVerificationJob({ jobId, leaseToken, now, leaseExpiresAt }) {
      const updated = jobProjection(one(await pool.query("UPDATE work_verification_jobs SET heartbeat_at=$3,lease_expires_at=$4,updated_at=$3 WHERE id=$1 AND status='running' AND lease_token=$2 RETURNING *", [jobId, leaseToken, now, leaseExpiresAt])));
      if (!updated) throw failure("WORK_VERIFICATION_LEASE_LOST");
      return updated;
    },

    async completeVerificationJob({ jobId, leaseToken, now, verificationStatus, failureKind = null, failureCode = null, failureReason = null, checks = [], work = null,
      assetRegistration = null, candidateProjection = null, orderTransition = null, transitionOrder: externalTransition = null, audit = null }) {
      return withTransaction(pool, async (client) => {
        const current = jobProjection(one(await client.query("SELECT * FROM work_verification_jobs WHERE id=$1 FOR UPDATE", [jobId])));
        if (!current || current.status !== "running" || current.lease_token !== leaseToken) throw failure("WORK_VERIFICATION_LEASE_LOST");
        if (verificationStatus === "passed") {
          const existing = workProjection(one(await client.query("SELECT * FROM works WHERE organization_id=$1 AND production_order_id=$2 FOR UPDATE", [current.organization_id, current.production_order_id])));
          if (existing) {
            if (existing.execution_attempt_id !== current.execution_attempt_id || existing.primary_output_checksum !== current.primary_output_checksum) throw failure("WORK_VERIFICATION_PRIMARY_WORK_EXISTS");
            if (candidateProjection) await candidateProjection({ verificationStatus: "passed", failureKind: null, failureCode: null, now, transactionClient: client });
            await client.query("UPDATE work_verification_jobs SET status='succeeded',verification_status='passed',failure_kind=NULL,failure_code=NULL,failure_reason=NULL,work_id=$2,completed_at=$3,lease_token=NULL,lease_expires_at=NULL,checks=$4,updated_at=$3 WHERE id=$1", [jobId, existing.id, now, json(checks)]);
            await client.query("UPDATE work_verification_idempotency_receipts SET work_id=$2 WHERE job_id=$1", [jobId, existing.id]);
            return { job: jobProjection(one(await client.query("SELECT * FROM work_verification_jobs WHERE id=$1", [jobId]))), work: existing, replayed: true };
          }
          if (!assetRegistration || !work) throw failure("WORK_VERIFICATION_ASSET_VERSION_REQUIRED");
          const registered = await assetRegistration({ transactionClient: client });
          if (!registered?.asset_version?.id) throw failure("WORK_VERIFICATION_ASSET_VERSION_REQUIRED");
          const finalWork = { ...work, primary_asset_version_id: registered.asset_version.id };
          const inserted = workProjection(one(await client.query(
            `INSERT INTO works(id,organization_id,production_order_id,execution_attempt_id,manual_execution_report_id,package_id,package_version,manifest_hash,
               video_plan_version_id,copy_version_id,avatar_asset_version_id,production_config_snapshot,package_manifest_snapshot,primary_asset_version_id,
               primary_candidate_id,primary_output_checksum,primary_output_media_type,primary_output_size,status,created_at,updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$20) RETURNING *`,
            [finalWork.id, finalWork.organization_id, finalWork.production_order_id, finalWork.execution_attempt_id, finalWork.manual_execution_report_id, finalWork.package_id,
              finalWork.package_version, finalWork.manifest_hash, finalWork.video_plan_version_id, finalWork.copy_version_id, finalWork.avatar_asset_version_id,
              json(finalWork.production_config_snapshot), json(finalWork.package_manifest_snapshot), finalWork.primary_asset_version_id, finalWork.primary_candidate_id,
              finalWork.primary_output_checksum, finalWork.primary_output_media_type, finalWork.primary_output_size, finalWork.status, finalWork.created_at]
          )));
          if (candidateProjection) await candidateProjection({ verificationStatus: "passed", failureKind: null, failureCode: null, now, transactionClient: client });
          const transitioned = orderTransition ? await transitionOrder(client, orderTransition) : externalTransition ? await externalTransition({ transactionClient: client }) : true;
          if (!transitioned) throw failure("PRODUCTION_ORDER_CONFLICT");
          await appendAudit(client, { ...audit, organization_id: current.organization_id, production_order_id: current.production_order_id, job_id: current.id,
            work_id: inserted.id, candidate_id: current.candidate_id, asset_version_id: inserted.primary_asset_version_id, event_type: "work_verification.passed", created_at: now });
          await client.query("UPDATE work_verification_jobs SET status='succeeded',verification_status='passed',failure_kind=NULL,failure_code=NULL,failure_reason=NULL,work_id=$2,completed_at=$3,lease_token=NULL,lease_expires_at=NULL,checks=$4,updated_at=$3 WHERE id=$1", [jobId, inserted.id, now, json(checks)]);
          await client.query("UPDATE work_verification_idempotency_receipts SET work_id=$2 WHERE job_id=$1", [jobId, inserted.id]);
          await appendLedger(client, { organizationId: current.organization_id, jobId: current.id, fromStatus: "running", toStatus: "passed", createdAt: now });
          return { job: jobProjection(one(await client.query("SELECT * FROM work_verification_jobs WHERE id=$1", [jobId]))), work: inserted, replayed: false };
        }
        if (!["failed", "requires_action"].includes(verificationStatus)) throw failure("WORK_VERIFICATION_STATE_INVALID");
        if (candidateProjection) await candidateProjection({ verificationStatus, failureKind, failureCode, now, transactionClient: client });
        await appendAudit(client, { ...audit, organization_id: current.organization_id, production_order_id: current.production_order_id, job_id: current.id,
          candidate_id: current.candidate_id, event_type: `work_verification.${verificationStatus}`, created_at: now });
        await client.query("UPDATE work_verification_jobs SET status='succeeded',verification_status=$2,failure_kind=$3,failure_code=$4,failure_reason=$5,completed_at=$6,lease_token=NULL,lease_expires_at=NULL,checks=$7,updated_at=$6 WHERE id=$1", [jobId, verificationStatus, failureKind, failureCode, failureReason, now, json(checks)]);
        await appendLedger(client, { organizationId: current.organization_id, jobId: current.id, fromStatus: "running", toStatus: verificationStatus, failureKind, reason: failureReason, createdAt: now });
        return { job: jobProjection(one(await client.query("SELECT * FROM work_verification_jobs WHERE id=$1", [jobId]))), work: null, replayed: false };
      });
    },

    async failVerificationJob({ jobId, leaseToken, now, failureCode, failureReason, candidateProjection = null, audit = null }) {
      return withTransaction(pool, async (client) => {
        const current = jobProjection(one(await client.query("SELECT * FROM work_verification_jobs WHERE id=$1 FOR UPDATE", [jobId])));
        if (!current || current.status !== "running" || current.lease_token !== leaseToken) throw failure("WORK_VERIFICATION_LEASE_LOST");
        if (candidateProjection) await candidateProjection({ verificationStatus: "failed", failureKind: "technical", failureCode, now, transactionClient: client });
        await appendAudit(client, { ...audit, organization_id: current.organization_id, production_order_id: current.production_order_id, job_id: current.id,
          candidate_id: current.candidate_id, event_type: "work_verification.technical_failed", created_at: now });
        await client.query("UPDATE work_verification_jobs SET status='failed',verification_status='failed',failure_kind='technical',failure_code=$2,failure_reason=$3,completed_at=$4,lease_token=NULL,lease_expires_at=NULL,updated_at=$4 WHERE id=$1", [jobId, failureCode, failureReason, now]);
        await appendLedger(client, { organizationId: current.organization_id, jobId: current.id, fromStatus: "running", toStatus: "failed", failureKind: "technical", reason: failureReason, createdAt: now });
        return { job: jobProjection(one(await client.query("SELECT * FROM work_verification_jobs WHERE id=$1", [jobId]))), work: null, replayed: false };
      });
    },

    async retryVerificationJob({ organizationId, jobId, receiptKey, fingerprint, now, candidateProjection = null, audit = null }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`work-verification-retry:${receiptKey}`]);
        const replay = await readReceipt(client, receiptKey, fingerprint);
        if (replay) return { job: jobProjection(one(await client.query("SELECT * FROM work_verification_jobs WHERE organization_id=$1 AND id=$2", [organizationId, replay.job_id]))), replayed: true };
        const current = jobProjection(one(await client.query("SELECT * FROM work_verification_jobs WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, jobId])));
        if (!current) throw failure("WORK_VERIFICATION_JOB_NOT_FOUND");
        if (current.status !== "failed" || current.failure_kind !== "technical") throw failure("WORK_VERIFICATION_RETRY_BLOCKED");
        if (current.attempts >= current.max_attempts) throw failure("WORK_VERIFICATION_RETRY_EXHAUSTED");
        const updated = jobProjection(one(await client.query("UPDATE work_verification_jobs SET status='queued',verification_status='queued',failure_kind=NULL,failure_code=NULL,failure_reason=NULL,completed_at=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=$3 WHERE organization_id=$1 AND id=$2 RETURNING *", [organizationId, jobId, now])));
        if (candidateProjection) await candidateProjection({ verificationStatus: "queued", failureKind: null, failureCode: null, now, transactionClient: client });
        if (audit) await appendAudit(client, { ...audit, organization_id: organizationId, production_order_id: current.production_order_id, job_id: current.id, candidate_id: current.candidate_id, event_type: "work_verification.retry_requested", created_at: now });
        await client.query("INSERT INTO work_verification_idempotency_receipts(receipt_key,organization_id,payload_fingerprint,job_id,work_id,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [receiptKey, organizationId, fingerprint, jobId, null, now]);
        await appendLedger(client, { organizationId, jobId, fromStatus: "failed", toStatus: "queued", createdAt: now });
        return { job: updated, replayed: false };
      });
    },

    async recoverVerificationJob({ organizationId, jobId, receiptKey, fingerprint, now, candidateProjection = null, audit = null }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`work-verification-recover:${receiptKey}`]);
        const replay = await readReceipt(client, receiptKey, fingerprint);
        if (replay) return { job: jobProjection(one(await client.query("SELECT * FROM work_verification_jobs WHERE organization_id=$1 AND id=$2", [organizationId, replay.job_id]))), replayed: true };
        const current = jobProjection(one(await client.query("SELECT * FROM work_verification_jobs WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, jobId])));
        if (!current) throw failure("WORK_VERIFICATION_JOB_NOT_FOUND");
        if (current.status !== "succeeded" || current.verification_status !== "requires_action") throw failure("WORK_VERIFICATION_RECOVERY_BLOCKED");
        if (current.attempts >= current.max_attempts) throw failure("WORK_VERIFICATION_RETRY_EXHAUSTED");
        const updated = jobProjection(one(await client.query("UPDATE work_verification_jobs SET status='queued',verification_status='queued',failure_kind=NULL,failure_code=NULL,failure_reason=NULL,completed_at=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=$3 WHERE organization_id=$1 AND id=$2 RETURNING *", [organizationId, jobId, now])));
        if (candidateProjection) await candidateProjection({ verificationStatus: "queued", failureKind: null, failureCode: null, now, transactionClient: client });
        if (audit) await appendAudit(client, { ...audit, organization_id: organizationId, production_order_id: current.production_order_id, job_id: current.id, candidate_id: current.candidate_id, event_type: "work_verification.recovery_requested", created_at: now });
        await client.query("INSERT INTO work_verification_idempotency_receipts(receipt_key,organization_id,payload_fingerprint,job_id,work_id,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [receiptKey, organizationId, fingerprint, jobId, null, now]);
        await appendLedger(client, { organizationId, jobId, fromStatus: "requires_action", toStatus: "queued", createdAt: now });
        return { job: updated, replayed: false };
      });
    },

    async getVerificationJob(organizationId, jobId) { return jobProjection(one(await pool.query("SELECT * FROM work_verification_jobs WHERE organization_id=$1 AND id=$2", [organizationId, jobId]))); },
    async getLatestVerificationJob(organizationId, productionOrderId) { return jobProjection(one(await pool.query("SELECT * FROM work_verification_jobs WHERE organization_id=$1 AND production_order_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1", [organizationId, productionOrderId]))); },
    async listVerificationJobs(organizationId, productionOrderId = null) {
      const result = productionOrderId ? await pool.query("SELECT * FROM work_verification_jobs WHERE organization_id=$1 AND production_order_id=$2 ORDER BY created_at,id", [organizationId, productionOrderId]) : await pool.query("SELECT * FROM work_verification_jobs WHERE organization_id=$1 ORDER BY created_at,id", [organizationId]);
      return result.rows.map(jobProjection);
    },
    async listWorks(organizationId, productionOrderId = null) {
      const result = productionOrderId ? await pool.query("SELECT * FROM works WHERE organization_id=$1 AND production_order_id=$2 ORDER BY created_at,id", [organizationId, productionOrderId]) : await pool.query("SELECT * FROM works WHERE organization_id=$1 ORDER BY created_at,id", [organizationId]);
      return result.rows.map(workProjection);
    },
    async getWork(organizationId, workId) { return workProjection(one(await pool.query("SELECT * FROM works WHERE organization_id=$1 AND id=$2", [organizationId, workId]))); },
    async listAuditEvents(organizationId = null) { const result = organizationId ? await pool.query("SELECT * FROM work_verification_audit_events WHERE organization_id=$1 ORDER BY created_at,id", [organizationId]) : await pool.query("SELECT * FROM work_verification_audit_events ORDER BY created_at,id"); return result.rows.map((row) => ({ ...row, created_at: iso(row.created_at) })); },
    async listStatusTransitions(organizationId = null) { const result = organizationId ? await pool.query("SELECT * FROM work_verification_status_ledger WHERE organization_id=$1 ORDER BY created_at,id", [organizationId]) : await pool.query("SELECT * FROM work_verification_status_ledger ORDER BY created_at,id"); return result.rows.map((row) => ({ ...row, created_at: iso(row.created_at) })); }
  };
}
