// Bounded TTL/LRU receipt registry for execution idempotency keys.
//
// A key that has been accepted is retained for its TTL (even after the execution
// settles), so a retry within the window is rejected as DUPLICATE_IDEMPOTENCY_KEY
// (409) instead of starting a second execution — this is what prevents a late
// retry from double-spending points. Map insertion order is the LRU order; when
// capacity is exceeded the oldest NON-ACTIVE receipt is evicted, so an in-flight
// execution's receipt is never a victim. The registry is in-memory only: a server
// restart empties it (idempotency across restart is a known, documented
// limitation; no new persistence is introduced for it).

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
  // key -> { batchId, executionId, acceptedAt, expiresAt, active }
  const entries = new Map();
  const isExpired = (entry) => now() >= entry.expiresAt;
  function evict() {
    for (const [key, entry] of entries) if (isExpired(entry)) entries.delete(key);
    while (entries.size > maxEntries) {
      let removed = false;
      for (const [key, entry] of entries) {
        if (!entry.active) { entries.delete(key); removed = true; break; }
      }
      if (!removed) break; // only active receipts remain; they are protected
    }
  }
  return {
    // Returns the live receipt if the key is present and unexpired, else null
    // (and drops it if expired). Does not refresh LRU recency.
    check(key) {
      const entry = entries.get(key);
      if (!entry) return null;
      if (isExpired(entry)) { entries.delete(key); return null; }
      return entry;
    },
    // Accept/refresh a receipt (refreshes recency + recomputes the TTL window).
    record(key, { batchId, executionId, active }) {
      const t = now();
      entries.delete(key);
      entries.set(key, { batchId, executionId, acceptedAt: t, expiresAt: t + ttlMs, active: !!active });
      evict();
    },
    // Mark a settled execution's receipt inactive but retain it for its TTL so a
    // near-term retry is still rejected. No-op if the key was already released.
    settle(key) {
      const entry = entries.get(key);
      if (entry) entry.active = false;
    },
    // Drop the key entirely — used when lock/prep fails before the execution is
    // accepted, so the client may retry with the same key.
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
