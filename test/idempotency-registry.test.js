import test from "node:test";
import assert from "node:assert/strict";

import { createIdempotencyRegistry } from "../src/core/idempotency-registry.js";

// Deterministic clock: tests advance time by mutating clock.t instead of sleeping.
function registry({ maxEntries = 512, ttlMs = 1000 } = {}) {
  const clock = { t: 0 };
  return {
    clock,
    r: createIdempotencyRegistry({ maxEntries, ttlMs, now: () => clock.t })
  };
}

test("a recorded key is a live duplicate until its TTL expires, then reusable", () => {
  const { r, clock } = registry({ ttlMs: 100 });
  assert.equal(r.check("k1"), null, "absent key is not a duplicate");
  r.record("k1", { batchId: "b1", executionId: "e1", active: true });
  assert.ok(r.check("k1"), "within TTL the key is a live duplicate");
  clock.t = 100;
  assert.equal(r.check("k1"), null, "at expiry the key becomes reusable");
});

test("settle marks a receipt inactive but retains it for the TTL", () => {
  const { r } = registry({ ttlMs: 100 });
  r.record("k1", { batchId: "b1", executionId: "e1", active: true });
  assert.equal(r.peek("k1").active, true);
  r.settle("k1");
  assert.equal(r.peek("k1").active, false, "settled -> inactive");
  assert.ok(r.check("k1"), "still a live duplicate until TTL expires");
  r.settle("absent-key"); // no-op; must not throw
});

test("release drops the key so it can be reused immediately (lock/prep failure)", () => {
  const { r } = registry({ ttlMs: 100 });
  r.record("k1", { batchId: "b1", executionId: null, active: true });
  r.release("k1");
  assert.equal(r.check("k1"), null, "released -> reusable immediately");
  assert.equal(r.size(), 0);
});

test("check drops an expired entry even when nothing else evicts it", () => {
  const { r, clock } = registry({ ttlMs: 50 });
  r.record("k1", { batchId: "b1", executionId: "e1", active: false });
  assert.equal(r.size(), 1);
  clock.t = 50;
  assert.equal(r.check("k1"), null, "expired -> not a duplicate");
  assert.equal(r.size(), 0, "expired entry removed lazily on check");
});

test("LRU eviction drops the oldest non-active receipt at capacity, keeping the newest", () => {
  const { r } = registry({ maxEntries: 2, ttlMs: 1000 });
  r.record("k1", { batchId: "b1", executionId: "e1", active: false });
  r.record("k2", { batchId: "b2", executionId: "e2", active: false });
  r.record("k3", { batchId: "b3", executionId: "e3", active: false }); // evicts k1 (oldest)
  assert.equal(r.check("k1"), null, "oldest non-active evicted");
  assert.ok(r.check("k2"), "k2 retained");
  assert.ok(r.check("k3"), "newest retained");
  assert.equal(r.size(), 2);
});

test("an active receipt is never evicted; a settled one is evicted in its place", () => {
  const { r } = registry({ maxEntries: 2, ttlMs: 1000 });
  r.record("k1", { batchId: "b1", executionId: "e1", active: false });
  r.record("k2", { batchId: "b2", executionId: "e2", active: true }); // active
  // Adding a third at capacity must NOT evict the active k2; it evicts k1 instead.
  r.record("k3", { batchId: "b3", executionId: "e3", active: false });
  assert.ok(r.check("k2"), "active receipt protected from eviction");
  assert.equal(r.check("k1"), null, "non-active evicted in its place");
  assert.ok(r.check("k3"));
});

test("record refreshes recency so a touched key survives LRU eviction", () => {
  const { r } = registry({ maxEntries: 2, ttlMs: 1000 });
  r.record("k1", { batchId: "b1", executionId: "e1", active: false });
  r.record("k2", { batchId: "b2", executionId: "e2", active: false });
  r.record("k1", { batchId: "b1", executionId: "e1", active: false }); // touch -> newest
  r.record("k3", { batchId: "b3", executionId: "e3", active: false }); // evicts k2 (now oldest)
  assert.ok(r.check("k1"), "touched key survives");
  assert.equal(r.check("k2"), null, "untouched oldest evicted");
});

test("record stores the latest receipt fields (executionId backfill after prep)", () => {
  const { r } = registry({ ttlMs: 1000 });
  r.record("k1", { batchId: "b1", executionId: null, active: true });
  r.record("k1", { batchId: "b1", executionId: "snap-key", active: true });
  assert.equal(r.peek("k1").executionId, "snap-key");
});

test("constructor rejects invalid bounds (Infinity / zero / non-integer / bad types)", () => {
  assert.throws(() => createIdempotencyRegistry({ maxEntries: Infinity }), /finite positive integer/);
  assert.throws(() => createIdempotencyRegistry({ maxEntries: 0 }), /finite positive integer/);
  assert.throws(() => createIdempotencyRegistry({ maxEntries: 2.5 }), /finite positive integer/);
  assert.throws(() => createIdempotencyRegistry({ maxEntries: -1 }), /finite positive integer/);
  assert.throws(() => createIdempotencyRegistry({ ttlMs: 0 }), /finite positive number/);
  assert.throws(() => createIdempotencyRegistry({ ttlMs: Infinity }), /finite positive number/);
  assert.throws(() => createIdempotencyRegistry({ now: "x" }), /now must be a function/);
});
