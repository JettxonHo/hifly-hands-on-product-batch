const clone = (value) => value == null ? value : structuredClone(value);
const failure = (code) => Object.assign(new Error(code), { code });

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

    async listAuditEvents(organizationId = null) {
      return clone(organizationId ? audits.filter((event) => event.organization_id === organizationId) : audits);
    },

    async listOutboxEvents(organizationId = null) {
      return clone(organizationId ? outbox.filter((event) => event.organization_id === organizationId) : outbox);
    }
  };
}
