// Bounded TTL receipt registry for execution idempotency keys.
//
// A key that has been accepted is protected against starting a second execution:
//
//   - active receipts (an execution in flight) NEVER expire and are never removed
//     for capacity — a long-running execution keeps its retry protection for its
//     whole lifetime, no matter how long it takes.
//   - settled receipts are protected for a full TTL measured from the SETTLE
//     moment (not acceptance), so a near-term retry after settle is rejected as
//     DUPLICATE_IDEMPOTENCY_KEY (409) instead of double-spending points.
//   - Only EXPIRED settled receipts are ever cleaned up. The registry is
//     capacity-bounded by BACKPRESSURE, not eviction: when full, a new key is
//     rejected with IDEMPOTENCY_REGISTRY_FULL (503) rather than evicting an
//     unexpired receipt. With the defaults (512 receipts / 24h settled TTL) this
//     means that beyond 512 executions still inside their protection window, new
//     executions get 503 backpressure until the earliest receipt expires — a safe
//     trade-off (never silently lose retry protection), not a defect.
//
// In-memory only: a server restart empties the registry (idempotency across
// restart is a known, documented limitation; no persistence is introduced).

export function createIdempotencyRegistry({
  maxEntries = 512,
  ttlMs = 24 * 60 * 60 * 1000,
  now = () => Date.now()
} = {}) {
  if (!Number.isInteger(maxEntries) || maxEntries <= 0 || !Number.isFinite(maxEntries)) {
    throw new TypeError("idempotencyMaxEntries must be a finite positive integer");
  }
  if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new TypeError("idempotencyTtlMs must be a finite positive number");
  }
  if (typeof now !== "function") throw new TypeError("now must be a function");
  // key -> { batchId, executionId, acceptedAt, settledAt, expiresAt, active }
  const entries = new Map();
  // A receipt expires ONLY once it is settled (inactive) AND has a valid expiresAt
  // in the past. Active receipts never expire (expiresAt is null while active).
  const isExpired = (receipt) =>
    receipt.active === false && Number.isFinite(receipt.expiresAt) && now() >= receipt.expiresAt;
  function sweepExpired() {
    for (const [key, receipt] of entries) if (isExpired(receipt)) entries.delete(key);
  }
  function checkReceipt(key) {
    const receipt = entries.get(key);
    if (!receipt) return null;
    if (isExpired(receipt)) { entries.delete(key); return null; }
    return receipt;
  }
  function registryError(code, statusCode) {
    return Object.assign(new Error(code), { code, statusCode });
  }
  return {
    // Returns the live receipt if the key is present and unexpired, else null
    // (and drops it if expired). Active receipts are always live.
    check: checkReceipt,
    // Accept a NEW key as an active receipt. First cleans expired settled
    // receipts, then applies backpressure: if the registry is at capacity the new
    // key is rejected (503) instead of evicting an unexpired receipt.
    reserve(key, { batchId }) {
      sweepExpired();
      if (checkReceipt(key)) throw registryError("DUPLICATE_IDEMPOTENCY_KEY", 409);
      if (entries.size >= maxEntries) throw registryError("IDEMPOTENCY_REGISTRY_FULL", 503);
      entries.set(key, { batchId, executionId: null, acceptedAt: now(), settledAt: null, expiresAt: null, active: true });
    },
    // Back-fill the persisted executionId once prepareExecution succeeds.
    accept(key, { executionId }) {
      const receipt = entries.get(key);
      if (receipt) receipt.executionId = executionId;
    },
    // Mark the execution settled and start the full TTL from the settle moment.
    // The receipt is retained (not removed) so a near-term retry is rejected.
    // No-op if the key was already released (lock/prep failure before acceptance).
    settle(key) {
      const receipt = entries.get(key);
      if (!receipt) return;
      const settledAt = now();
      receipt.active = false;
      receipt.settledAt = settledAt;
      receipt.expiresAt = settledAt + ttlMs;
    },
    // Drop the key entirely — lock/prep failed before the execution was accepted,
    // so the client may retry with the same key.
    release(key) {
      entries.delete(key);
    },
    peek(key) {
      return entries.get(key) ?? null;
    },
    size() {
      return entries.size;
    }
  };
}
