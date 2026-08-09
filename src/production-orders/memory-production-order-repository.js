const clone = (value) => value == null ? value : structuredClone(value);
const failure = (code) => Object.assign(new Error(code), { code });
const allowedTransitions = {
  draft: ["ready"], ready: ["waiting_for_executor"], waiting_for_executor: ["claimed", "cancelled"],
  claimed: ["running", "requires_action", "cancel_requested", "failed"], running: ["requires_action", "failed", "cancel_requested", "succeeded"],
  requires_action: ["running", "waiting_for_executor", "failed", "cancelled", "succeeded"], failed: ["waiting_for_executor", "cancelled"],
  cancel_requested: ["cancelled"], succeeded: [], cancelled: []
};

export function createMemoryProductionOrderRepository() {
  const orders = new Map();
  const receipts = new Map();
  const audits = [];
  const outbox = [];

  function readReceipt(receiptKey, fingerprint) {
    const found = receipts.get(receiptKey);
    if (!found) return null;
    if (found.fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
    return clone(found.result);
  }

  return {
    async initialize() {},
    async close() {},

    async getReceipt(receiptKey, fingerprint) {
      return readReceipt(receiptKey, fingerprint);
    },

    async updateReceiptResult(receiptKey, result) {
      const found = receipts.get(receiptKey);
      if (found) found.result = clone(result);
    },

    async createOrder({ receiptKey, fingerprint, order, auditEvents, outboxEvent }) {
      const replay = readReceipt(receiptKey, fingerprint);
      if (replay) return { order: clone(orders.get(replay.order_id)), replayed: true };
      orders.set(order.id, clone(order));
      receipts.set(receiptKey, { fingerprint, result: { order_id: order.id } });
      audits.push(...auditEvents.map(clone));
      outbox.push(clone(outboxEvent));
      return { order: clone(order), replayed: false };
    },

    async listOrders(organizationId, productId) {
      return [...orders.values()]
        .filter((order) => order.organization_id === organizationId && (!productId || order.product_id === productId))
        .map(clone);
    },

    async getOrder(organizationId, orderId) {
      const order = orders.get(orderId);
      return clone(order?.organization_id === organizationId ? order : null);
    },

    async transitionOrder({ organizationId, orderId, expectedRevision, fromStatuses = [], toStatus, at, actorMemberId = null, actorAgentId = null, reason = null, transactionClient = null }) {
      const value = orders.get(orderId);
      if (!value || value.organization_id !== organizationId) return null;
      if (value.row_version !== expectedRevision || !fromStatuses.includes(value.status)) return null;
      const fromStatus = value.status;
      if (fromStatus !== toStatus && !allowedTransitions[fromStatus]?.includes(toStatus)) throw failure("PRODUCTION_ORDER_TRANSITION_INVALID");
      const previous = clone(value);
      Object.assign(value, { status: toStatus, row_version: value.row_version + 1, updated_at: at });
      value.status_history = [...(value.status_history || []), { from_status: fromStatus, to_status: toStatus, at, actor_member_id: actorMemberId, actor_agent_id: actorAgentId, reason }];
      const audit = { id: `${value.id}-transition-${value.row_version}`, organization_id: organizationId, actor_member_id: actorMemberId,
        event_type: `production_order.${toStatus}`, production_order_id: value.id,
        metadata: { from_status: fromStatus, to_status: toStatus, reason, ...(actorAgentId ? { agent_id: actorAgentId } : {}) }, created_at: at };
      audits.push(audit);
      transactionClient?.onRollback?.(() => {
        orders.set(value.id, previous);
        const index = audits.lastIndexOf(audit);
        if (index >= 0) audits.splice(index, 1);
      });
      return clone(value);
    },

    async listAuditEvents(organizationId = null) {
      return clone(organizationId ? audits.filter((event) => event.organization_id === organizationId) : audits);
    },

    async listOutboxEvents(organizationId = null) {
      return clone(organizationId ? outbox.filter((event) => event.organization_id === organizationId) : outbox);
    }
  };
}
