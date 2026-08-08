import { createHash, randomUUID } from "node:crypto";

import { withTransaction } from "../identity/postgres.js";
import { assertManualHandoffSchemaCurrent } from "./postgres.js";

const failure = (code) => Object.assign(new Error(code), { code });
const one = (result) => result.rows[0] || null;
const iso = (value) => value instanceof Date ? value.toISOString() : value;
const json = (value) => value == null ? null : JSON.stringify(value);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const allowedTransitions = {
  generating: ["ready", "generation_failed", "superseded", "revoked"],
  ready: ["expired", "superseded", "revoked"],
  generation_failed: ["generating", "superseded", "revoked"],
  expired: ["ready", "superseded", "revoked"],
  superseded: [],
  revoked: []
};
const packageProjection = (row) => row ? { ...row, package_version: Number(row.package_version), row_version: Number(row.row_version), created_at: iso(row.created_at), updated_at: iso(row.updated_at) } : null;
const jobProjection = (row) => row ? { ...row, attempts: Number(row.attempts), max_attempts: Number(row.max_attempts), created_at: iso(row.created_at), updated_at: iso(row.updated_at), started_at: iso(row.started_at), heartbeat_at: iso(row.heartbeat_at), lease_expires_at: iso(row.lease_expires_at), completed_at: iso(row.completed_at) } : null;
const grantProjection = (row) => row ? { ...row, created_at: iso(row.created_at), expires_at: iso(row.expires_at), consumed_at: iso(row.consumed_at) } : null;

async function appendAudit(client, event) {
  await client.query(`INSERT INTO manual_handoff_audit_events(id,organization_id,actor_member_id,package_id,generation_job_id,event_type,metadata,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [event.id, event.organization_id, event.actor_member_id || null, event.package_id || null, event.job_id || null, event.event_type, json(event.metadata || {}), event.created_at]);
}

async function appendLedger(client, { id, organizationId, packageId, fromStatus, toStatus, reason = null, actorMemberId = null, createdAt }) {
  await client.query(`INSERT INTO manual_handoff_status_ledger(id,organization_id,package_id,from_status,to_status,reason,actor_member_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, organizationId, packageId, fromStatus, toStatus, reason, actorMemberId, createdAt]);
}

export function createPostgresManualHandoffRepository({ pool, ownsPool = false } = {}) {
  if (!pool?.query || !pool?.connect) throw new TypeError("pool is required");
  return {
    async initialize() { await assertManualHandoffSchemaCurrent(pool); },
    async close() { if (ownsPool) await pool.end(); },
    async getGenerationReceipt(receiptKey, fingerprint, scope = null) {
      const parts = receiptKey.split(":");
      const organizationId = scope?.organizationId || parts[0];
      const productionOrderId = scope?.productionOrderId || parts[1];
      const contractVersion = scope?.contractVersion || parts[2];
      const generationRequestId = scope?.generationRequestId || parts.slice(3).join(":");
      const row = one(await pool.query("SELECT * FROM manual_handoff_generation_receipts WHERE organization_id=$1 AND production_order_id=$2 AND contract_version=$3 AND generation_request_id=$4", [organizationId, productionOrderId, contractVersion, generationRequestId]));
      if (!row) return null;
      if (row.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
      return { fingerprint: row.payload_fingerprint, package_id: row.package_id, job_id: row.job_id };
    },
    async nextPackageVersion(organizationId, productionOrderId, contractVersion) {
      return Number(one(await pool.query("SELECT coalesce(max(package_version),0)+1 next FROM manual_handoff_packages WHERE organization_id=$1 AND production_order_id=$2 AND contract_version=$3", [organizationId, productionOrderId, contractVersion])).next);
    },
    async createGenerationRequest({ receiptKey, fingerprint, package: value, job, supersedePackageIds = [], audit }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`manual-handoff:${receiptKey}`]);
        const receipt = one(await client.query(`SELECT * FROM manual_handoff_generation_receipts WHERE organization_id=$1 AND production_order_id=$2 AND contract_version=$3 AND generation_request_id=$4`, [value.organization_id, value.production_order_id, value.contract_version, value.generation_request_id]));
        if (receipt) {
          if (receipt.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
          return { package: packageProjection(one(await client.query("SELECT * FROM manual_handoff_packages WHERE organization_id=$1 AND id=$2", [value.organization_id, receipt.package_id]))), job: jobProjection(one(await client.query("SELECT * FROM manual_handoff_package_generation_jobs WHERE organization_id=$1 AND id=$2", [value.organization_id, receipt.job_id]))), replayed: true };
        }
        if ((await client.query("SELECT 1 FROM manual_handoff_packages WHERE organization_id=$1 AND production_order_id=$2 AND contract_version=$3 AND package_version=$4", [value.organization_id, value.production_order_id, value.contract_version, value.package_version])).rowCount) throw failure("MANUAL_HANDOFF_PACKAGE_VERSION_CONFLICT");
        for (const packageId of supersedePackageIds) {
          const prior = one(await client.query("SELECT * FROM manual_handoff_packages WHERE organization_id=$1 AND id=$2 FOR UPDATE", [value.organization_id, packageId]));
          if (prior && ["generating", "ready", "generation_failed", "expired"].includes(prior.status)) {
            const statusHistory = [...(prior.status_history || []), { from_status: prior.status, to_status: "superseded", at: value.created_at, actor_member_id: null, reason: "已由新交接包版本替代" }];
            await client.query("UPDATE manual_handoff_packages SET status='superseded',status_history=$2,row_version=row_version+1,updated_at=$3 WHERE id=$1", [prior.id, json(statusHistory), value.created_at]);
            await appendLedger(client, { id: cryptoRandomUuid(), organizationId: value.organization_id, packageId: prior.id, fromStatus: prior.status, toStatus: "superseded", reason: "已由新交接包版本替代", createdAt: value.created_at });
          }
        }
        await client.query(`INSERT INTO manual_handoff_packages(id,organization_id,production_order_id,contract_type,contract_version,package_version,status,generation_request_id,generation_job_id,manifest,readme,manifest_hash,package_hash,storage_key,failure_reason,supersedes_package_id,created_by_member_id,created_at,updated_at,row_version,status_history)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`, [value.id, value.organization_id, value.production_order_id, value.contract_type, value.contract_version, value.package_version, value.status, value.generation_request_id, value.generation_job_id, json(value.manifest), value.readme, value.manifest_hash, value.package_hash, value.storage_key, value.failure_reason, value.supersedes_package_id, value.created_by_member_id, value.created_at, value.updated_at, value.row_version, json(value.status_history)]);
        await client.query(`INSERT INTO manual_handoff_package_generation_jobs(id,organization_id,package_id,type,status,attempts,max_attempts,order_snapshot,failure_reason,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [job.id, job.organization_id, job.package_id, job.type, job.status, job.attempts, job.max_attempts, json(job.order_snapshot), job.failure_reason, job.created_at, job.updated_at]);
        await client.query(`INSERT INTO manual_handoff_generation_receipts(organization_id,production_order_id,contract_version,generation_request_id,payload_fingerprint,package_id,job_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [value.organization_id, value.production_order_id, value.contract_version, value.generation_request_id, fingerprint, value.id, job.id, value.created_at]);
        await appendAudit(client, audit);
        await appendLedger(client, { id: cryptoRandomUuid(), organizationId: value.organization_id, packageId: value.id, fromStatus: null, toStatus: value.status, createdAt: value.created_at, actorMemberId: value.created_by_member_id });
        return { package: value, job, replayed: false };
      });
    },
    async getPackage(organizationId, packageId) { return packageProjection(one(await pool.query("SELECT * FROM manual_handoff_packages WHERE organization_id=$1 AND id=$2", [organizationId, packageId]))); },
    async listPackages(organizationId, productionOrderId) { return (await pool.query("SELECT * FROM manual_handoff_packages WHERE organization_id=$1 AND production_order_id=$2 ORDER BY package_version DESC,created_at DESC", [organizationId, productionOrderId])).rows.map(packageProjection); },
    async getJob(organizationId, jobId) { return jobProjection(one(await pool.query("SELECT * FROM manual_handoff_package_generation_jobs WHERE organization_id=$1 AND id=$2", [organizationId, jobId]))); },
    async claimNextJob(now, leaseExpiresAt, leaseToken) {
      return withTransaction(pool, async (client) => {
        const expired = (await client.query("SELECT * FROM manual_handoff_package_generation_jobs WHERE status='running' AND lease_expires_at <= $1 FOR UPDATE SKIP LOCKED", [now])).rows;
        for (const item of expired) {
          if (Number(item.attempts) >= Number(item.max_attempts)) {
            await client.query("UPDATE manual_handoff_package_generation_jobs SET status='failed',failure_reason=$2,completed_at=$3,lease_token=NULL,lease_expires_at=NULL,updated_at=$3 WHERE id=$1", [item.id, "交接包生成未完成，请稍后重试。", now]);
            const pkg = one(await client.query("SELECT * FROM manual_handoff_packages WHERE id=$1 FOR UPDATE", [item.package_id]));
            if (pkg && pkg.status === "generating") {
              const history = [...(pkg.status_history || []), { from_status: pkg.status, to_status: "generation_failed", at: now, actor_member_id: null, reason: "交接包生成未完成，请稍后重试。" }];
              await client.query("UPDATE manual_handoff_packages SET status='generation_failed',failure_reason=$2,status_history=$3,row_version=row_version+1,updated_at=$4 WHERE id=$1", [pkg.id, "交接包生成未完成，请稍后重试。", json(history), now]);
              await appendLedger(client, { id: cryptoRandomUuid(), organizationId: pkg.organization_id, packageId: pkg.id, fromStatus: "generating", toStatus: "generation_failed", reason: "交接包生成未完成，请稍后重试。", createdAt: now });
            }
          } else await client.query("UPDATE manual_handoff_package_generation_jobs SET status='queued',lease_token=NULL,lease_expires_at=NULL,updated_at=$2 WHERE id=$1", [item.id, now]);
        }
        return jobProjection(one(await client.query(`UPDATE manual_handoff_package_generation_jobs SET status='running',attempts=attempts+1,lease_token=$1,lease_expires_at=$3,started_at=coalesce(started_at,$2),heartbeat_at=$2,updated_at=$2
          WHERE id=(SELECT id FROM manual_handoff_package_generation_jobs WHERE status='queued' AND attempts < max_attempts ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [leaseToken, now, leaseExpiresAt])));
      });
    },
    async heartbeatJob({ jobId, leaseToken, now, leaseExpiresAt }) {
      const value = jobProjection(one(await pool.query("UPDATE manual_handoff_package_generation_jobs SET heartbeat_at=$3,lease_expires_at=$4,updated_at=$3 WHERE id=$1 AND status='running' AND lease_token=$2 RETURNING *", [jobId, leaseToken, now, leaseExpiresAt])));
      if (!value) throw failure("MANUAL_HANDOFF_LEASE_LOST");
      return value;
    },
    async completeJob({ jobId, leaseToken, manifest, readme, manifestHash, packageHash, storageKey, now, audit }) {
      return withTransaction(pool, async (client) => {
        const job = jobProjection(one(await client.query("SELECT * FROM manual_handoff_package_generation_jobs WHERE id=$1 FOR UPDATE", [jobId])));
        if (!job) throw failure("MANUAL_HANDOFF_JOB_NOT_FOUND");
        if (job.status === "succeeded") return packageProjection(one(await client.query("SELECT * FROM manual_handoff_packages WHERE id=$1", [job.package_id])));
        if (job.status !== "running" || job.lease_token !== leaseToken) throw failure("MANUAL_HANDOFF_LEASE_LOST");
        const current = packageProjection(one(await client.query("SELECT * FROM manual_handoff_packages WHERE id=$1 FOR UPDATE", [job.package_id])));
        const history = [...(current.status_history || []), { from_status: current.status, to_status: "ready", at: now, actor_member_id: null, reason: null }];
        const updated = packageProjection(one(await client.query("UPDATE manual_handoff_packages SET status='ready',manifest=$2,readme=$3,manifest_hash=$4,package_hash=$5,storage_key=$6,failure_reason=NULL,status_history=$7,row_version=row_version+1,updated_at=$8 WHERE id=$1 RETURNING *", [current.id, json(manifest), readme, manifestHash, packageHash, storageKey, json(history), now])));
        await client.query("UPDATE manual_handoff_package_generation_jobs SET status='succeeded',completed_at=$2,lease_token=NULL,lease_expires_at=NULL,failure_reason=NULL,updated_at=$2 WHERE id=$1", [jobId, now]);
        await appendAudit(client, audit);
        await appendLedger(client, { id: cryptoRandomUuid(), organizationId: current.organization_id, packageId: current.id, fromStatus: current.status, toStatus: "ready", createdAt: now });
        return updated;
      });
    },
    async failJob({ jobId, leaseToken, failureReason, now, audit }) {
      return withTransaction(pool, async (client) => {
        const job = jobProjection(one(await client.query("SELECT * FROM manual_handoff_package_generation_jobs WHERE id=$1 FOR UPDATE", [jobId])));
        if (!job || job.status !== "running" || job.lease_token !== leaseToken) throw failure("MANUAL_HANDOFF_LEASE_LOST");
        const current = packageProjection(one(await client.query("SELECT * FROM manual_handoff_packages WHERE id=$1 FOR UPDATE", [job.package_id])));
        const history = [...(current.status_history || []), { from_status: current.status, to_status: "generation_failed", at: now, actor_member_id: null, reason: failureReason }];
        const updated = packageProjection(one(await client.query("UPDATE manual_handoff_packages SET status='generation_failed',failure_reason=$2,status_history=$3,row_version=row_version+1,updated_at=$4 WHERE id=$1 RETURNING *", [current.id, failureReason, json(history), now])));
        await client.query("UPDATE manual_handoff_package_generation_jobs SET status='failed',completed_at=$2,lease_token=NULL,lease_expires_at=NULL,failure_reason=$3,updated_at=$2 WHERE id=$1", [jobId, now, failureReason]);
        await appendAudit(client, audit);
        await appendLedger(client, { id: cryptoRandomUuid(), organizationId: current.organization_id, packageId: current.id, fromStatus: current.status, toStatus: "generation_failed", reason: failureReason, createdAt: now });
        return updated;
      });
    },
    async retryJob({ organizationId, packageId, productionOrderId, contractVersion, generationRequestId, receiptKey, fingerprint, now, audit }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`manual-handoff-retry:${receiptKey}`]);
        const existing = one(await client.query("SELECT * FROM manual_handoff_generation_receipts WHERE organization_id=$1 AND production_order_id=$2 AND contract_version=$3 AND generation_request_id=$4", [organizationId, productionOrderId, contractVersion, generationRequestId]));
        if (existing) {
          if (existing.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
          return { package: packageProjection(one(await client.query("SELECT * FROM manual_handoff_packages WHERE organization_id=$1 AND id=$2", [organizationId, existing.package_id]))), job: jobProjection(one(await client.query("SELECT * FROM manual_handoff_package_generation_jobs WHERE organization_id=$1 AND id=$2", [organizationId, existing.job_id]))), replayed: true };
        }
        const current = packageProjection(one(await client.query("SELECT * FROM manual_handoff_packages WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, packageId])));
        if (!current) return null;
        const job = jobProjection(one(await client.query("SELECT * FROM manual_handoff_package_generation_jobs WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, current.generation_job_id])));
        if (current.status !== "generation_failed" || !job || job.attempts >= job.max_attempts) throw failure("MANUAL_HANDOFF_RETRY_BLOCKED");
        const history = [...(current.status_history || []), { from_status: current.status, to_status: "generating", at: now, actor_member_id: null, reason: null }];
        const updated = packageProjection(one(await client.query("UPDATE manual_handoff_packages SET status='generating',failure_reason=NULL,status_history=$2,row_version=row_version+1,updated_at=$3 WHERE id=$1 RETURNING *", [current.id, json(history), now])));
        const queued = jobProjection(one(await client.query("UPDATE manual_handoff_package_generation_jobs SET status='queued',failure_reason=NULL,completed_at=NULL,updated_at=$2 WHERE id=$1 RETURNING *", [job.id, now])));
        await client.query("INSERT INTO manual_handoff_generation_receipts(organization_id,production_order_id,contract_version,generation_request_id,payload_fingerprint,package_id,job_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [organizationId, current.production_order_id, current.contract_version, generationRequestId, fingerprint, current.id, job.id, now]);
        await appendAudit(client, audit);
        await appendLedger(client, { id: cryptoRandomUuid(), organizationId, packageId: current.id, fromStatus: current.status, toStatus: "generating", createdAt: now });
        return { package: updated, job: queued, replayed: false };
      });
    },
    async reconcileDownloadExpiry({ organizationId, packageId, now }) {
      return withTransaction(pool, async (client) => {
        const current = packageProjection(one(await client.query("SELECT * FROM manual_handoff_packages WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, packageId])));
        const latest = one(await client.query("SELECT * FROM manual_handoff_download_authorizations WHERE organization_id=$1 AND package_id=$2 ORDER BY created_at DESC LIMIT 1", [organizationId, packageId]));
        if (current?.status === "ready" && latest && Date.parse(latest.expires_at) <= Date.parse(now)) {
          const history = [...(current.status_history || []), { from_status: "ready", to_status: "expired", at: now, actor_member_id: null, reason: "下载授权已过期" }];
          await client.query("UPDATE manual_handoff_download_authorizations SET status='expired' WHERE id=$1 AND status='active'", [latest.id]);
          const updated = packageProjection(one(await client.query("UPDATE manual_handoff_packages SET status='expired',status_history=$2,row_version=row_version+1,updated_at=$3 WHERE id=$1 RETURNING *", [packageId, json(history), now])));
          await appendLedger(client, { id: cryptoRandomUuid(), organizationId, packageId, fromStatus: "ready", toStatus: "expired", reason: "下载授权已过期", createdAt: now });
          return updated;
        }
        return current;
      });
    },
    async createDownloadGrant({ organizationId, packageId, memberId, token, expiresAt, now, audit }) {
      return withTransaction(pool, async (client) => {
        const row = one(await client.query("INSERT INTO manual_handoff_download_authorizations(id,organization_id,package_id,member_id,token_digest,status,expires_at,created_at) VALUES (gen_random_uuid(),$1,$2,$3,$4,'active',$5,$6) RETURNING *", [organizationId, packageId, memberId, digest(token), expiresAt, now]));
        await appendAudit(client, audit);
        return grantProjection(row);
      });
    },
    async getDownloadGrant({ organizationId, packageId, memberId, token, now }) {
      const row = one(await pool.query("SELECT * FROM manual_handoff_download_authorizations WHERE organization_id=$1 AND package_id=$2 AND member_id=$3 AND token_digest=$4", [organizationId, packageId, memberId, digest(token)]));
      if (!row || row.status !== "active" || Date.parse(row.expires_at) <= Date.parse(now)) {
        if (row?.status === "active") await pool.query("UPDATE manual_handoff_download_authorizations SET status='expired' WHERE id=$1", [row.id]);
        return null;
      }
      return grantProjection(row);
    },
    async consumeDownloadGrant({ grantId, now }) { await pool.query("UPDATE manual_handoff_download_authorizations SET status='consumed',consumed_at=$2 WHERE id=$1 AND status='active'", [grantId, now]); },
    async appendAudit(event) { await withTransaction(pool, async (client) => appendAudit(client, event)); },
    async transitionPackage({ organizationId, packageId, status, reason, actorMemberId, now }) {
      return withTransaction(pool, async (client) => {
        const current = packageProjection(one(await client.query("SELECT * FROM manual_handoff_packages WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, packageId])));
        if (!current) return null;
        if (current.status === status) return current;
        if (!allowedTransitions[current.status]?.includes(status)) throw failure("MANUAL_HANDOFF_PACKAGE_TRANSITION_INVALID");
        const history = [...(current.status_history || []), { from_status: current.status, to_status: status, at: now, actor_member_id: actorMemberId || null, reason }];
        const updated = packageProjection(one(await client.query("UPDATE manual_handoff_packages SET status=$2,status_history=$3,row_version=row_version+1,updated_at=$4 WHERE id=$1 RETURNING *", [packageId, status, json(history), now])));
        await appendLedger(client, { id: cryptoRandomUuid(), organizationId, packageId, fromStatus: current.status, toStatus: status, reason, actorMemberId, createdAt: now });
        return updated;
      });
    },
    async listAuditEvents(organizationId = null) {
      const result = organizationId ? await pool.query("SELECT * FROM manual_handoff_audit_events WHERE organization_id=$1 ORDER BY created_at,id", [organizationId]) : await pool.query("SELECT * FROM manual_handoff_audit_events ORDER BY created_at,id");
      return result.rows.map((row) => ({ ...row, created_at: iso(row.created_at) }));
    },
    async listStatusTransitions(organizationId = null) {
      const result = organizationId ? await pool.query("SELECT * FROM manual_handoff_status_ledger WHERE organization_id=$1 ORDER BY created_at,id", [organizationId]) : await pool.query("SELECT * FROM manual_handoff_status_ledger ORDER BY created_at,id");
      return result.rows.map((row) => ({ ...row, created_at: iso(row.created_at) }));
    }
  };
}

function cryptoRandomUuid() { return randomUUID(); }
