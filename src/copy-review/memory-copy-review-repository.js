const clone = (value) => value === undefined ? undefined : structuredClone(value);
const failure = (code) => Object.assign(new Error(code), { code });

export function createMemoryCopyReviewRepository() {
  const reviews = new Map();
  const heads = new Map();
  const events = [];
  const receipts = new Map();
  const audits = [];

  function replay(receiptKey, fingerprint) {
    const receipt = receipts.get(receiptKey);
    if (!receipt) return null;
    if (receipt.fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
    return clone(receipt.resultHead);
  }

  function record({ receiptKey, fingerprint, reviewId, resultHead }) {
    receipts.set(receiptKey, { fingerprint, reviewId, resultHead: clone(resultHead) });
  }

  return {
    async initialize() {},
    async close() {},
    async createReview({ receiptKey, fingerprint, review, head, event, audit }) {
      const existing = replay(receiptKey, fingerprint);
      if (existing) return existing;
      const active = [...heads.values()].find((value) => value.organization_id === review.organization_id &&
        value.copy_version_id === review.copy_version_id && ["pending", "approved"].includes(value.status));
      if (active) throw failure("COPY_REVIEW_ACTIVE_EXISTS");
      reviews.set(review.id, clone(review)); heads.set(review.id, clone(head));
      events.push(clone(event)); audits.push(clone(audit)); record({ receiptKey, fingerprint, reviewId: review.id, resultHead: head });
      return clone(head);
    },
    async transition({ receiptKey, fingerprint, resultReceiptKey = null, reviewId, organizationId, expectedRevision, fromStatuses, patch, event, audit }) {
      const existing = replay(receiptKey, fingerprint);
      if (existing) return existing;
      const head = heads.get(reviewId);
      if (!head || head.organization_id !== organizationId) throw failure("COPY_REVIEW_NOT_FOUND");
      if (head.row_version !== expectedRevision || !fromStatuses.includes(head.status)) throw failure("COPY_REVIEW_CONFLICT");
      const next = { ...head, ...clone(patch), row_version: head.row_version + 1, updated_at: event.created_at };
      heads.set(reviewId, next); events.push(clone(event)); audits.push(clone(audit));
      record({ receiptKey, fingerprint, reviewId, resultHead: next });
      if (resultReceiptKey && receipts.has(resultReceiptKey)) receipts.get(resultReceiptKey).resultHead = clone(next);
      return clone(next);
    },
    async getReceipt(receiptKey, fingerprint) { return replay(receiptKey, fingerprint); },
    async updateReceiptResult(receiptKey, resultHead) {
      const receipt = receipts.get(receiptKey);
      if (receipt) receipt.resultHead = clone(resultHead);
    },
    async getReview(organizationId, reviewId) {
      const head = heads.get(reviewId);
      return head?.organization_id === organizationId ? clone(head) : null;
    },
    async listReviews(organizationId, copyVersionId) {
      return [...heads.values()].filter((value) => value.organization_id === organizationId && value.copy_version_id === copyVersionId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).map(clone);
    },
    async listEvents(organizationId, copyVersionId) {
      return events.filter((value) => value.organization_id === organizationId && value.copy_version_id === copyVersionId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).map(clone);
    },
    async listAuditEvents() { return clone(audits); }
  };
}
