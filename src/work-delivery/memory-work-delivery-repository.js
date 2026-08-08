import { randomUUID } from "node:crypto";

const clone = (value) => value == null ? value : structuredClone(value);
const failure = (code) => Object.assign(new Error(code), { code });

function scoped(map, organizationId, id) {
  const value = map.get(id);
  return value?.organization_id === organizationId ? value : null;
}

export function createMemoryWorkDeliveryRepository() {
  const inspections = new Map();
  const deliveries = new Map();
  const receipts = new Map();
  const audits = [];
  const ledger = [];

  function readReceipt(receiptKey, fingerprint) {
    const value = receipts.get(receiptKey);
    if (!value) return null;
    if (value.fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
    return clone(value);
  }

  function history(organizationId, workId) {
    return [...inspections.values()]
      .filter((value) => value.organization_id === organizationId && value.work_id === workId)
      .sort((left, right) => left.revision - right.revision || left.id.localeCompare(right.id));
  }

  function current(organizationId, workId) {
    return history(organizationId, workId).filter((value) => value.status !== "superseded").at(-1) || null;
  }

  function appendLedger(inspection, fromStatus, toStatus) {
    ledger.push({ id: randomUUID(), organization_id: inspection.organization_id, work_id: inspection.work_id,
      inspection_id: inspection.id, from_status: fromStatus, to_status: toStatus,
      reason: inspection.reason || null, created_at: inspection.inspected_at });
  }

  return {
    async initialize() {},
    async close() {},

    async ensurePendingInspection({ organizationId, workId, now }) {
      const existing = current(organizationId, workId);
      if (existing) return clone(existing);
      const inspection = {
        id: randomUUID(), organization_id: organizationId, work_id: workId, status: "pending", revision: 1,
        category: null, reason: null, target_upstream_stage: null, inspected_by_member_id: null,
        inspected_at: now, superseded_by_inspection_id: null, created_at: now, updated_at: now
      };
      inspections.set(inspection.id, inspection);
      appendLedger(inspection, null, "pending");
      audits.push({ id: randomUUID(), organization_id: organizationId, work_id: workId, inspection_id: inspection.id,
        event_type: "work_inspection.pending_created", actor_member_id: null, metadata: {}, created_at: now });
      return clone(inspection);
    },

    async getInspectionState(organizationId, workId) {
      return { current: clone(current(organizationId, workId)), history: clone(history(organizationId, workId)) };
    },

    async createInspection({ receiptKey, fingerprint, inspection, expectedInspectionId = null, expectedRevision = null, audit = null }) {
      const replay = readReceipt(receiptKey, fingerprint);
      if (replay) return { inspection: clone(inspections.get(replay.result_id)), replayed: true };
      const prior = current(inspection.organization_id, inspection.work_id);
      if (expectedInspectionId && prior?.id !== expectedInspectionId) throw failure("WORK_DELIVERY_INSPECTION_CONFLICT");
      if (expectedRevision != null && (!prior || Number(prior.revision) !== Number(expectedRevision))) throw failure("WORK_DELIVERY_INSPECTION_CONFLICT");
      if (prior?.status === "rework_required") throw failure("WORK_DELIVERY_REWORK_BLOCKED");
      const priorStatus = prior?.status || null;
      const next = { ...clone(inspection), revision: (prior?.revision || 0) + 1 };
      inspections.set(next.id, next);
      if (prior) {
        prior.status = "superseded";
        prior.superseded_by_inspection_id = next.id;
        prior.updated_at = next.inspected_at;
      }
      receipts.set(receiptKey, { fingerprint, operation: "inspection", result_id: next.id, work_id: next.work_id });
      appendLedger(next, priorStatus, next.status);
      if (audit) audits.push(clone({ ...audit, inspection_id: next.id }));
      return { inspection: clone(next), replayed: false };
    },

    async createDelivery({ receiptKey, fingerprint, delivery, expectedInspectionId = null, expectedRevision = null, audit = null }) {
      const replay = readReceipt(receiptKey, fingerprint);
      if (replay) return { delivery: clone(deliveries.get(replay.result_id)), replayed: true };
      const prior = current(delivery.organization_id, delivery.work_id);
      if (!prior) throw failure("WORK_DELIVERY_INSPECTION_REQUIRED");
      if (expectedInspectionId && prior.id !== expectedInspectionId) throw failure("WORK_DELIVERY_INSPECTION_CONFLICT");
      if (expectedRevision != null && Number(prior.revision) !== Number(expectedRevision)) throw failure("WORK_DELIVERY_INSPECTION_CONFLICT");
      if (prior.status !== "passed") throw failure(prior.status === "rework_required" ? "WORK_DELIVERY_REWORK_BLOCKED" : "WORK_DELIVERY_INSPECTION_REQUIRED");
      deliveries.set(delivery.id, clone(delivery));
      receipts.set(receiptKey, { fingerprint, operation: "delivery", result_id: delivery.id, work_id: delivery.work_id });
      if (audit) audits.push(clone({ ...audit, delivery_id: delivery.id }));
      return { delivery: clone(delivery), replayed: false };
    },

    async listDeliveries(organizationId, workId) {
      return clone([...deliveries.values()].filter((value) => value.organization_id === organizationId && value.work_id === workId)
        .sort((left, right) => left.delivered_at.localeCompare(right.delivered_at) || left.id.localeCompare(right.id)));
    },
    async getDelivery(organizationId, deliveryId) { return clone(scoped(deliveries, organizationId, deliveryId)); },
    async listAuditEvents(organizationId = null) { return clone(organizationId ? audits.filter((value) => value.organization_id === organizationId) : audits); },
    async listStatusTransitions(organizationId = null) { return clone(organizationId ? ledger.filter((value) => value.organization_id === organizationId) : ledger); },

    _records: { inspections, deliveries, receipts, audits, ledger }
  };
}
