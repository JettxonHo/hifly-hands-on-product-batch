import { randomUUID } from "node:crypto";
import { withTransaction } from "../identity/postgres.js";
import { assertProductionOrderSchemaCurrent } from "./postgres.js";

const failure = (code) => Object.assign(new Error(code), { code });
const allowedTransitions = {
  draft: ["ready"], ready: ["waiting_for_executor"], waiting_for_executor: ["claimed", "cancelled"],
  claimed: ["running", "requires_action", "cancel_requested", "failed"], running: ["requires_action", "failed", "cancel_requested"],
  requires_action: ["running", "waiting_for_executor", "failed", "cancelled"], failed: ["waiting_for_executor", "cancelled"],
  cancel_requested: ["cancelled"], succeeded: [], cancelled: []
};
const one = (result) => result.rows[0] || null;
const iso = (value) => value instanceof Date ? value.toISOString() : value;
const order = (row) => row ? { ...row, row_version: Number(row.row_version),
  created_at: iso(row.created_at), updated_at: iso(row.updated_at) } : null;

async function readReceipt(client, receiptKey, fingerprint) {
  const found = one(await client.query("SELECT * FROM production_order_idempotency_receipts WHERE receipt_key=$1", [receiptKey]));
  if (!found) return null;
  if (found.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
  return found.result;
}

export function createPostgresProductionOrderRepository({ pool, ownsPool = false } = {}) {
  if (!pool?.connect) throw new TypeError("pool is required");
  return {
    async initialize() { await assertProductionOrderSchemaCurrent(pool); },
    async close() { if (ownsPool) await pool.end(); },

    async getReceipt(receiptKey, fingerprint) { return readReceipt(pool, receiptKey, fingerprint); },

    async updateReceiptResult(receiptKey, result) {
      await pool.query("UPDATE production_order_idempotency_receipts SET result=$2 WHERE receipt_key=$1", [receiptKey, JSON.stringify(result)]);
    },

    async createOrder({ receiptKey, fingerprint, order: value, auditEvents, outboxEvent }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`production-order-receipt:${receiptKey}`]);
        const replay = await readReceipt(client, receiptKey, fingerprint);
        if (replay) return { order: order(one(await client.query("SELECT * FROM production_orders WHERE organization_id=$1 AND id=$2", [value.organization_id, replay.order_id]))), replayed: true };
        await client.query(`INSERT INTO production_orders(id,organization_id,product_id,video_plan_version_id,execution_purpose,status,row_version,input_snapshot,status_history,created_by_member_id,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [value.id, value.organization_id, value.product_id,
          value.video_plan_version_id, value.execution_purpose, value.status, value.row_version, JSON.stringify(value.input_snapshot),
          JSON.stringify(value.status_history), value.created_by_member_id, value.created_at, value.updated_at]);
        await client.query("INSERT INTO production_order_idempotency_receipts(receipt_key,payload_fingerprint,result,created_at) VALUES ($1,$2,$3,$4)",
          [receiptKey, fingerprint, JSON.stringify({ order_id: value.id }), value.created_at]);
        for (const event of auditEvents) await client.query(`INSERT INTO production_order_audit_events(id,organization_id,actor_member_id,production_order_id,event_type,metadata,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [event.id, event.organization_id, event.actor_member_id || null, event.production_order_id,
          event.event_type, JSON.stringify(event.metadata || {}), event.created_at]);
        await client.query(`INSERT INTO production_order_outbox_events(id,organization_id,production_order_id,event_type,payload,created_at,published_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [outboxEvent.id, outboxEvent.organization_id, outboxEvent.aggregate_id,
          outboxEvent.event_type, JSON.stringify(outboxEvent.payload), outboxEvent.created_at, outboxEvent.published_at]);
        return { order: value, replayed: false };
      });
    },

    async listOrders(organizationId, productId) {
      const params = productId ? [organizationId, productId] : [organizationId];
      const where = productId ? "organization_id=$1 AND product_id=$2" : "organization_id=$1";
      return (await pool.query(`SELECT * FROM production_orders WHERE ${where} ORDER BY created_at,id`, params)).rows.map(order);
    },

    async getOrder(organizationId, orderId) {
      return order(one(await pool.query("SELECT * FROM production_orders WHERE organization_id=$1 AND id=$2", [organizationId, orderId])));
    },

    async transitionOrder({ organizationId, orderId, expectedRevision, fromStatuses = [], toStatus, at, actorMemberId = null, reason = null }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`production-order-transition:${organizationId}:${orderId}`]);
        const current = order(one(await client.query("SELECT * FROM production_orders WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, orderId])));
        if (!current || current.row_version !== expectedRevision || !fromStatuses.includes(current.status)) return null;
        if (current.status !== toStatus && !allowedTransitions[current.status]?.includes(toStatus)) throw failure("PRODUCTION_ORDER_TRANSITION_INVALID");
        const history = [...(current.status_history || []), { from_status: current.status, to_status: toStatus, at, actor_member_id: actorMemberId, reason }];
        const updated = order(one(await client.query(`UPDATE production_orders SET status=$3,row_version=row_version+1,status_history=$4,updated_at=$5
          WHERE organization_id=$1 AND id=$2 AND row_version=$6 AND status = ANY($7::text[]) RETURNING *`,
          [organizationId, orderId, toStatus, JSON.stringify(history), at, expectedRevision, fromStatuses])));
        if (!updated) return null;
        await client.query(`INSERT INTO production_order_audit_events(id,organization_id,actor_member_id,production_order_id,event_type,metadata,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), organizationId, actorMemberId, orderId,
          `production_order.${toStatus}`, JSON.stringify({ from_status: current.status, to_status: toStatus, reason }), at]);
        return updated;
      });
    },

    async listAuditEvents(organizationId = null) {
      const result = organizationId
        ? await pool.query("SELECT * FROM production_order_audit_events WHERE organization_id=$1 ORDER BY created_at,id", [organizationId])
        : await pool.query("SELECT * FROM production_order_audit_events ORDER BY created_at,id");
      return result.rows.map((row) => ({ ...row, created_at: iso(row.created_at) }));
    },

    async listOutboxEvents(organizationId = null) {
      const result = organizationId
        ? await pool.query("SELECT * FROM production_order_outbox_events WHERE organization_id=$1 ORDER BY created_at,id", [organizationId])
        : await pool.query("SELECT * FROM production_order_outbox_events ORDER BY created_at,id");
      return result.rows.map((row) => ({ ...row, created_at: iso(row.created_at) }));
    }
  };
}
