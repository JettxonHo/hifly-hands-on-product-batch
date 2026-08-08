import { randomUUID } from "node:crypto";

import { withTransaction } from "../identity/postgres.js";
import { assertWorkDeliverySchemaCurrent } from "./postgres.js";

const failure = (code) => Object.assign(new Error(code), { code });
const one = (result) => result.rows[0] || null;
const iso = (value) => value instanceof Date ? value.toISOString() : value;
const json = (value) => JSON.stringify(value == null ? {} : value);

function inspectionProjection(row) {
  if (!row) return null;
  return { ...row, revision: Number(row.revision), inspected_at: iso(row.inspected_at), created_at: iso(row.created_at), updated_at: iso(row.updated_at) };
}

function deliveryProjection(row) {
  if (!row) return null;
  return { ...row, delivered_at: iso(row.delivered_at), created_at: iso(row.created_at) };
}

async function readReceipt(client, receiptKey, fingerprint) {
  const row = one(await client.query("SELECT * FROM work_delivery_idempotency_receipts WHERE receipt_key=$1", [receiptKey]));
  if (!row) return null;
  if (row.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
  return row;
}

async function lockWork(client, organizationId, workId) {
  const work = one(await client.query("SELECT id FROM works WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, workId]));
  if (!work) throw failure("WORK_DELIVERY_WORK_NOT_FOUND");
  return work;
}

async function currentInspection(client, organizationId, workId, forUpdate = false) {
  const suffix = forUpdate ? " FOR UPDATE" : "";
  return inspectionProjection(one(await client.query(
    `SELECT * FROM work_inspections WHERE organization_id=$1 AND work_id=$2 AND status <> 'superseded'
       ORDER BY revision DESC, id DESC LIMIT 1${suffix}`,
    [organizationId, workId]
  )));
}

async function appendAudit(client, event) {
  await client.query(
    `INSERT INTO work_delivery_audit_events
       (id,organization_id,actor_member_id,work_id,inspection_id,delivery_id,event_type,metadata,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [event.id || randomUUID(), event.organization_id, event.actor_member_id || null, event.work_id,
      event.inspection_id || null, event.delivery_id || null, event.event_type, json(event.metadata), event.created_at]
  );
}

async function appendLedger(client, inspection, fromStatus) {
  await client.query(
    `INSERT INTO work_delivery_status_ledger
       (id,organization_id,work_id,inspection_id,from_status,to_status,reason,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [randomUUID(), inspection.organization_id, inspection.work_id, inspection.id, fromStatus || null,
      inspection.status, inspection.reason || null, inspection.inspected_at]
  );
}

export function createPostgresWorkDeliveryRepository({ pool, ownsPool = false } = {}) {
  if (!pool?.query || !pool?.connect) throw new TypeError("pool is required");

  return {
    async initialize() { await assertWorkDeliverySchemaCurrent(pool); },

    async close() { if (ownsPool) await pool.end(); },

    async ensurePendingInspection({ organizationId, workId, now }) {
      return withTransaction(pool, async (client) => {
        await lockWork(client, organizationId, workId);
        const existing = await currentInspection(client, organizationId, workId, true);
        if (existing) return existing;
        const value = { id: randomUUID(), organization_id: organizationId, work_id: workId, status: "pending", revision: 1,
          category: null, reason: null, target_upstream_stage: null, inspected_by_member_id: null, inspected_at: now,
          superseded_by_inspection_id: null, created_at: now, updated_at: now };
        const saved = inspectionProjection(one(await client.query(
          `INSERT INTO work_inspections
             (id,organization_id,work_id,status,revision,category,reason,target_upstream_stage,inspected_by_member_id,inspected_at,superseded_by_inspection_id,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [value.id, value.organization_id, value.work_id, value.status, value.revision, value.category, value.reason,
            value.target_upstream_stage, value.inspected_by_member_id, value.inspected_at, value.superseded_by_inspection_id,
            value.created_at, value.updated_at]
        )));
        await appendLedger(client, saved, null);
        await appendAudit(client, { organization_id: organizationId, work_id: workId, inspection_id: saved.id,
          event_type: "work_inspection.pending_created", metadata: {}, created_at: now });
        return saved;
      });
    },

    async getInspectionState(organizationId, workId) {
      const [currentResult, historyResult] = await Promise.all([
        pool.query(
          `SELECT * FROM work_inspections WHERE organization_id=$1 AND work_id=$2 AND status <> 'superseded'
             ORDER BY revision DESC,id DESC LIMIT 1`, [organizationId, workId]
        ),
        pool.query("SELECT * FROM work_inspections WHERE organization_id=$1 AND work_id=$2 ORDER BY revision,id", [organizationId, workId])
      ]);
      return { current: inspectionProjection(one(currentResult)), history: historyResult.rows.map(inspectionProjection) };
    },

    async createInspection({ receiptKey, fingerprint, inspection, expectedInspectionId = null, expectedRevision = null, audit = null }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`work-delivery-receipt:${receiptKey}`]);
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`work-delivery-work:${inspection.organization_id}:${inspection.work_id}`]);
        const replay = await readReceipt(client, receiptKey, fingerprint);
        if (replay) return { inspection: inspectionProjection(one(await client.query("SELECT * FROM work_inspections WHERE organization_id=$1 AND id=$2", [inspection.organization_id, replay.inspection_id]))), replayed: true };
        await lockWork(client, inspection.organization_id, inspection.work_id);
        const prior = await currentInspection(client, inspection.organization_id, inspection.work_id, true);
        if (expectedInspectionId && prior?.id !== expectedInspectionId) throw failure("WORK_DELIVERY_INSPECTION_CONFLICT");
        if (expectedRevision != null && (!prior || Number(prior.revision) !== Number(expectedRevision))) throw failure("WORK_DELIVERY_INSPECTION_CONFLICT");
        if (prior?.status === "rework_required") throw failure("WORK_DELIVERY_REWORK_BLOCKED");
        const next = { ...inspection, revision: (prior?.revision || 0) + 1 };
        const saved = inspectionProjection(one(await client.query(
          `INSERT INTO work_inspections
             (id,organization_id,work_id,status,revision,category,reason,target_upstream_stage,inspected_by_member_id,inspected_at,superseded_by_inspection_id,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [next.id, next.organization_id, next.work_id, next.status, next.revision, next.category, next.reason, next.target_upstream_stage,
            next.inspected_by_member_id, next.inspected_at, null, next.created_at, next.updated_at]
        )));
        if (prior) {
          await client.query(
            "UPDATE work_inspections SET status='superseded',superseded_by_inspection_id=$3,updated_at=$4 WHERE organization_id=$1 AND id=$2",
            [inspection.organization_id, prior.id, saved.id, saved.inspected_at]
          );
        }
        await client.query(
          `INSERT INTO work_delivery_idempotency_receipts
             (receipt_key,organization_id,operation,payload_fingerprint,work_id,inspection_id,delivery_id,created_at)
           VALUES ($1,$2,'inspection',$3,$4,$5,NULL,$6)`,
          [receiptKey, inspection.organization_id, fingerprint, inspection.work_id, saved.id, saved.created_at]
        );
        await appendLedger(client, saved, prior?.status || null);
        if (audit) await appendAudit(client, { ...audit, inspection_id: saved.id });
        return { inspection: saved, replayed: false };
      });
    },

    async createDelivery({ receiptKey, fingerprint, delivery, expectedInspectionId = null, expectedRevision = null, audit = null }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`work-delivery-receipt:${receiptKey}`]);
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`work-delivery-work:${delivery.organization_id}:${delivery.work_id}`]);
        const replay = await readReceipt(client, receiptKey, fingerprint);
        if (replay) return { delivery: deliveryProjection(one(await client.query("SELECT * FROM work_delivery_records WHERE organization_id=$1 AND id=$2", [delivery.organization_id, replay.delivery_id]))), replayed: true };
        await lockWork(client, delivery.organization_id, delivery.work_id);
        const prior = await currentInspection(client, delivery.organization_id, delivery.work_id, true);
        if (!prior) throw failure("WORK_DELIVERY_INSPECTION_REQUIRED");
        if (expectedInspectionId && prior.id !== expectedInspectionId) throw failure("WORK_DELIVERY_INSPECTION_CONFLICT");
        if (expectedRevision != null && Number(prior.revision) !== Number(expectedRevision)) throw failure("WORK_DELIVERY_INSPECTION_CONFLICT");
        if (prior.status !== "passed") throw failure(prior.status === "rework_required" ? "WORK_DELIVERY_REWORK_BLOCKED" : "WORK_DELIVERY_INSPECTION_REQUIRED");
        const saved = deliveryProjection(one(await client.query(
          `INSERT INTO work_delivery_records
             (id,organization_id,work_id,delivered_by,delivered_at,delivery_method,note,recipient_reference,created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
          [delivery.id, delivery.organization_id, delivery.work_id, delivery.delivered_by, delivery.delivered_at, delivery.delivery_method,
            delivery.note, delivery.recipient_reference, delivery.created_at]
        )));
        await client.query(
          `INSERT INTO work_delivery_idempotency_receipts
             (receipt_key,organization_id,operation,payload_fingerprint,work_id,inspection_id,delivery_id,created_at)
           VALUES ($1,$2,'delivery',$3,$4,NULL,$5,$6)`,
          [receiptKey, delivery.organization_id, fingerprint, delivery.work_id, saved.id, saved.created_at]
        );
        if (audit) await appendAudit(client, { ...audit, delivery_id: saved.id });
        return { delivery: saved, replayed: false };
      });
    },

    async listDeliveries(organizationId, workId) {
      const result = await pool.query("SELECT * FROM work_delivery_records WHERE organization_id=$1 AND work_id=$2 ORDER BY delivered_at,id", [organizationId, workId]);
      return result.rows.map(deliveryProjection);
    },

    async getDelivery(organizationId, deliveryId) {
      return deliveryProjection(one(await pool.query("SELECT * FROM work_delivery_records WHERE organization_id=$1 AND id=$2", [organizationId, deliveryId])));
    },

    async listAuditEvents(organizationId = null) {
      const result = organizationId ? await pool.query("SELECT * FROM work_delivery_audit_events WHERE organization_id=$1 ORDER BY created_at,id", [organizationId]) : await pool.query("SELECT * FROM work_delivery_audit_events ORDER BY created_at,id");
      return result.rows.map((row) => ({ ...row, metadata: row.metadata || {}, created_at: iso(row.created_at) }));
    },

    async listStatusTransitions(organizationId = null) {
      const result = organizationId ? await pool.query("SELECT * FROM work_delivery_status_ledger WHERE organization_id=$1 ORDER BY created_at,id", [organizationId]) : await pool.query("SELECT * FROM work_delivery_status_ledger ORDER BY created_at,id");
      return result.rows.map((row) => ({ ...row, created_at: iso(row.created_at) }));
    }
  };
}
