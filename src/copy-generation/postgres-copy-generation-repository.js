import { withTransaction } from "../identity/postgres.js";
import { assertCopyGenerationSchemaCurrent } from "./postgres.js";
import { randomUUID } from "node:crypto";

const failure = (code) => Object.assign(new Error(code), { code });
const one = (result) => result.rows[0] || null;
const iso = (value) => value instanceof Date ? value.toISOString() : value;
const job = (row) => row ? { ...row, attempts: Number(row.attempts), max_attempts: Number(row.max_attempts), started_at: iso(row.started_at), heartbeat_at: iso(row.heartbeat_at), lease_expires_at: iso(row.lease_expires_at), completed_at: iso(row.completed_at), created_at: iso(row.created_at), updated_at: iso(row.updated_at) } : null;
const copy = (row) => row ? { ...row, version_number: Number(row.version_number), row_version: Number(row.row_version), created_at: iso(row.created_at), updated_at: iso(row.updated_at), frozen_at: iso(row.frozen_at) } : null;

async function appendAudit(client, event) {
  await client.query(`INSERT INTO copy_generation_audit_events(id,organization_id,actor_member_id,event_type,product_revision_id,copy_version_id,copy_generation_job_id,metadata,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [event.id, event.organization_id, event.actor_member_id || null, event.event_type, event.product_revision_id || null, event.copy_version_id || null, event.copy_generation_job_id || null, JSON.stringify(event.metadata || {}), event.created_at]);
}

export function createPostgresCopyGenerationRepository({ pool, ownsPool = false } = {}) {
  if (!pool?.connect) throw new TypeError("pool is required");
  return {
    async initialize() { await assertCopyGenerationSchemaCurrent(pool); },
    async close() { if (ownsPool) await pool.end(); },
    async createGenerationRequest({ receiptKey, fingerprint, job: value, audit }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`copy-generation:${receiptKey}`]);
        const receipt = one(await client.query("SELECT * FROM copy_generation_idempotency_receipts WHERE receipt_key=$1", [receiptKey]));
        if (receipt) {
          if (receipt.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
          return { job: job(one(await client.query("SELECT * FROM copy_generation_jobs WHERE id=$1", [receipt.job_id]))), copy_version: receipt.copy_version_id ? copy(one(await client.query("SELECT * FROM copy_versions WHERE id=$1", [receipt.copy_version_id]))) : null };
        }
        await client.query(`INSERT INTO copy_generation_jobs(id,organization_id,type,status,product_revision_id,project_id,product_id,intent,input_snapshot,attempts,max_attempts,copy_version_id,failure_code,lease_token,started_at,heartbeat_at,lease_expires_at,completed_at,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`, [value.id,value.organization_id,value.type,value.status,value.product_revision_id,value.project_id,value.product_id,value.intent,JSON.stringify(value.input_snapshot),value.attempts,value.max_attempts,value.copy_version_id,value.failure_code,value.lease_token || null,value.started_at,value.heartbeat_at,value.lease_expires_at,value.completed_at,value.created_at,value.updated_at]);
        await client.query("INSERT INTO copy_generation_idempotency_receipts(receipt_key,payload_fingerprint,job_id,created_at) VALUES ($1,$2,$3,$4)", [receiptKey,fingerprint,value.id,value.created_at]);
        await appendAudit(client, audit);
        return { job: value, copy_version: null };
      });
    },
    async getJob(organizationId, id) { return job(one(await pool.query("SELECT * FROM copy_generation_jobs WHERE organization_id=$1 AND id=$2", [organizationId,id]))); },
    async listJobs(organizationId, productRevisionId) { return (await pool.query("SELECT * FROM copy_generation_jobs WHERE organization_id=$1 AND product_revision_id=$2 ORDER BY created_at DESC", [organizationId,productRevisionId])).rows.map(job); },
    async listCopies(organizationId, productRevisionId) { return (await pool.query("SELECT * FROM copy_versions WHERE organization_id=$1 AND product_revision_id=$2 ORDER BY version_number", [organizationId,productRevisionId])).rows.map(copy); },
    async listCopiesByProduct(organizationId, productId) { return (await pool.query("SELECT * FROM copy_versions WHERE organization_id=$1 AND product_id=$2 ORDER BY created_at DESC,id DESC", [organizationId,productId])).rows.map(copy); },
    async getCopy(organizationId, id) { return copy(one(await pool.query("SELECT * FROM copy_versions WHERE organization_id=$1 AND id=$2", [organizationId,id]))); },
    async editCopy({ organizationId, copyVersionId, expectedRevision, body, childCopyVersion, receiptKey, fingerprint, audit, now }) {
      return withTransaction(pool, async (client) => {
        if (receiptKey) {
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`copy-generation:${receiptKey}`]);
          const receipt = one(await client.query("SELECT * FROM copy_generation_idempotency_receipts WHERE receipt_key=$1", [receiptKey]));
          if (receipt) {
            if (receipt.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
            return copy(one(await client.query("SELECT * FROM copy_versions WHERE id=$1", [receipt.copy_version_id])));
          }
        }
        const current = copy(one(await client.query("SELECT * FROM copy_versions WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId,copyVersionId])));
        if (!current) return null;
        if (current.row_version !== expectedRevision) throw failure("COPY_VERSION_CONFLICT");
        if (current.status === "superseded") throw failure("COPY_VERSION_IMMUTABLE");
        if (current.body === body) return current;
        let result;
        if (current.status === "draft") result = copy(one(await client.query("UPDATE copy_versions SET body=$2,row_version=row_version+1,updated_at=$3 WHERE id=$1 RETURNING *", [current.id,body,now])));
        else {
          const value = childCopyVersion;
          await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`copy-version:${current.organization_id}:${current.product_revision_id}`]);
          const nextVersion = Number(one(await client.query("SELECT coalesce(max(version_number),0)+1 next FROM copy_versions WHERE organization_id=$1 AND product_revision_id=$2", [current.organization_id,current.product_revision_id])).next);
          await client.query("UPDATE copy_versions SET row_version=row_version+1,updated_at=$2 WHERE id=$1", [current.id,now]);
          await client.query("UPDATE copy_versions SET status='superseded',row_version=row_version+1,updated_at=$3 WHERE organization_id=$1 AND product_revision_id=$2 AND status='draft'", [current.organization_id,current.product_revision_id,now]);
          result = copy(one(await client.query(`INSERT INTO copy_versions(id,organization_id,project_id,product_id,product_revision_id,generation_job_id,intent,status,version_number,row_version,body,parent_copy_version_id,created_by_member_id,created_at,updated_at,frozen_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`, [value.id,value.organization_id,value.project_id,value.product_id,value.product_revision_id,value.generation_job_id,value.intent,value.status,nextVersion,value.row_version,value.body,value.parent_copy_version_id,value.created_by_member_id,value.created_at,value.updated_at,value.frozen_at])));
          if (receiptKey) await client.query("INSERT INTO copy_generation_idempotency_receipts(receipt_key,payload_fingerprint,copy_version_id,created_at) VALUES ($1,$2,$3,$4)", [receiptKey,fingerprint,result.id,now]);
        }
        await appendAudit(client, audit);
        return result;
      });
    },
    async freezeCopy({ organizationId, copyVersionId, expectedRevision, supersedeParent = true, receiptKey, fingerprint, audit, now }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`copy-generation:${receiptKey}`]);
        const receipt = one(await client.query("SELECT * FROM copy_generation_idempotency_receipts WHERE receipt_key=$1", [receiptKey]));
        if (receipt) {
          if (receipt.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
          return copy(one(await client.query("SELECT * FROM copy_versions WHERE id=$1", [receipt.copy_version_id])));
        }
        const current = copy(one(await client.query("SELECT * FROM copy_versions WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId,copyVersionId])));
        if (!current) return null;
        if (current.row_version !== expectedRevision) throw failure("COPY_VERSION_CONFLICT");
        if (current.status !== "draft") throw failure("COPY_VERSION_IMMUTABLE");
        const result = copy(one(await client.query("UPDATE copy_versions SET status='frozen',row_version=row_version+1,frozen_at=$2,updated_at=$2 WHERE id=$1 RETURNING *", [current.id,now])));
        if (supersedeParent && current.parent_copy_version_id) await client.query("UPDATE copy_versions SET status='superseded',row_version=row_version+1,updated_at=$2 WHERE id=$1 AND status='frozen'", [current.parent_copy_version_id,now]);
        await client.query("INSERT INTO copy_generation_idempotency_receipts(receipt_key,payload_fingerprint,copy_version_id,created_at) VALUES ($1,$2,$3,$4)", [receiptKey,fingerprint,result.id,now]);
        await appendAudit(client, audit);
        return result;
      });
    },
    async claimNextJob(now, leaseExpiresAt, leaseToken) {
      return withTransaction(pool, async (client) => {
        const exhausted = (await client.query("SELECT * FROM copy_generation_jobs WHERE status='running' AND lease_expires_at <= $1 AND attempts >= max_attempts FOR UPDATE SKIP LOCKED", [now])).rows.map(job);
        for (const candidate of exhausted) {
          await client.query("UPDATE copy_generation_jobs SET status='timed_out',failure_code='COPY_GENERATION_TIMED_OUT',completed_at=$2,lease_expires_at=NULL,lease_token=NULL,updated_at=$2 WHERE id=$1", [candidate.id,now]);
          await appendAudit(client, { id: randomUUID(), organization_id: candidate.organization_id, event_type: "copy.generation_timed_out",
            product_revision_id: candidate.product_revision_id, copy_generation_job_id: candidate.id, metadata: { attempts: candidate.attempts }, created_at: now });
        }
        return job(one(await client.query(`UPDATE copy_generation_jobs SET status='running',attempts=attempts+1,lease_token=$1,started_at=coalesce(started_at,$2),heartbeat_at=$2,lease_expires_at=$3,updated_at=$2
          WHERE id=(SELECT id FROM copy_generation_jobs WHERE (status='queued' OR (status='running' AND lease_expires_at <= $2)) AND attempts < max_attempts ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [leaseToken,now,leaseExpiresAt])));
      });
    },
    async heartbeatJob({ jobId, leaseToken, now, leaseExpiresAt }) {
      const result = job(one(await pool.query("UPDATE copy_generation_jobs SET heartbeat_at=$3,lease_expires_at=$4,updated_at=$3 WHERE id=$1 AND status='running' AND lease_token=$2 RETURNING *", [jobId,leaseToken,now,leaseExpiresAt])));
      if (!result) throw failure("COPY_GENERATION_LEASE_LOST");
      return result;
    },
    async completeJob({ jobId, copyVersion, audit, now }) {
      return withTransaction(pool, async (client) => {
        const current = job(one(await client.query("SELECT * FROM copy_generation_jobs WHERE id=$1 FOR UPDATE", [jobId])));
        if (!current) throw failure("COPY_GENERATION_JOB_NOT_FOUND");
        if (current.status === "succeeded") return copy(one(await client.query("SELECT * FROM copy_versions WHERE id=$1", [current.copy_version_id])));
        if (current.status !== "running" || current.lease_token !== copyVersion.lease_token) throw failure("COPY_GENERATION_LEASE_LOST");
        const value = copyVersion;
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`copy-version:${value.organization_id}:${value.product_revision_id}`]);
        const nextVersion = Number(one(await client.query("SELECT coalesce(max(version_number),0)+1 next FROM copy_versions WHERE organization_id=$1 AND product_revision_id=$2", [value.organization_id,value.product_revision_id])).next);
        await client.query("UPDATE copy_versions SET status='superseded',row_version=row_version+1,updated_at=$3 WHERE organization_id=$1 AND product_revision_id=$2 AND status='draft'", [value.organization_id,value.product_revision_id,now]);
        const inserted = copy(one(await client.query(`INSERT INTO copy_versions(id,organization_id,project_id,product_id,product_revision_id,generation_job_id,intent,status,version_number,row_version,body,parent_copy_version_id,created_by_member_id,created_at,updated_at,frozen_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`, [value.id,value.organization_id,value.project_id,value.product_id,value.product_revision_id,value.generation_job_id,value.intent,value.status,nextVersion,value.row_version,value.body,value.parent_copy_version_id,value.created_by_member_id,value.created_at,value.updated_at,value.frozen_at])));
        await client.query("UPDATE copy_generation_jobs SET status='succeeded',copy_version_id=$2,completed_at=$3,heartbeat_at=$3,lease_expires_at=NULL,lease_token=NULL,failure_code=NULL,updated_at=$3 WHERE id=$1", [jobId,inserted.id,now]);
        await client.query("UPDATE copy_generation_idempotency_receipts SET copy_version_id=$2 WHERE job_id=$1", [jobId,inserted.id]);
        await appendAudit(client, audit);
        return inserted;
      });
    },
    async failJob({ jobId, leaseToken, failureCode, audit, now }) {
      return withTransaction(pool, async (client) => {
        const result = job(one(await client.query("UPDATE copy_generation_jobs SET status='failed',failure_code=$3,completed_at=$4,lease_expires_at=NULL,lease_token=NULL,updated_at=$4 WHERE id=$1 AND status='running' AND lease_token=$2 RETURNING *", [jobId,leaseToken,failureCode,now])));
        if (!result) throw failure("COPY_GENERATION_LEASE_LOST");
        await appendAudit(client, audit);
        return result;
      });
    },
    async retryJob({ organizationId, jobId, receiptKey, fingerprint, audit, now }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`copy-generation:${receiptKey}`]);
        const receipt = one(await client.query("SELECT * FROM copy_generation_idempotency_receipts WHERE receipt_key=$1", [receiptKey]));
        if (receipt) {
          if (receipt.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
          return job(one(await client.query("SELECT * FROM copy_generation_jobs WHERE id=$1", [receipt.job_id])));
        }
        const current = job(one(await client.query("SELECT * FROM copy_generation_jobs WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId,jobId])));
        if (!current) return null;
        if (current.status !== "failed") throw failure("COPY_GENERATION_RETRY_BLOCKED");
        if (current.attempts >= current.max_attempts) throw failure("COPY_GENERATION_RETRY_EXHAUSTED");
        const result = job(one(await client.query("UPDATE copy_generation_jobs SET status='queued',failure_code=NULL,completed_at=NULL,updated_at=$2 WHERE id=$1 RETURNING *", [jobId,now])));
        await client.query("INSERT INTO copy_generation_idempotency_receipts(receipt_key,payload_fingerprint,job_id,created_at) VALUES ($1,$2,$3,$4)", [receiptKey,fingerprint,jobId,now]);
        await appendAudit(client, audit);
        return result;
      });
    },
    async abortJob({ organizationId, jobId, audit, now }) {
      return withTransaction(pool, async (client) => {
        const result = job(one(await client.query("UPDATE copy_generation_jobs SET status='cancelled',completed_at=$3,lease_expires_at=NULL,lease_token=NULL,updated_at=$3 WHERE organization_id=$1 AND id=$2 AND status IN ('queued','running') RETURNING *", [organizationId,jobId,now])));
        if (!result) {
          const existing = one(await client.query("SELECT 1 FROM copy_generation_jobs WHERE organization_id=$1 AND id=$2", [organizationId,jobId]));
          if (!existing) return null;
          throw failure("COPY_GENERATION_ABORT_BLOCKED");
        }
        await appendAudit(client, audit);
        return result;
      });
    },
    async listAuditEvents() { return (await pool.query("SELECT * FROM copy_generation_audit_events ORDER BY created_at,id")).rows.map((row) => ({ ...row, created_at: iso(row.created_at) })); }
  };
}
