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

test("an active receipt never expires, even well past the TTL", () => {
  const { r, clock } = registry({ ttlMs: 100 });
  r.reserve("k1", { batchId: "b1" });
  assert.equal(r.peek("k1").active, true);
  // Advance far beyond the TTL: an active receipt must stay live (long-running
  // executions keep their retry protection for their whole lifetime).
  clock.t = 100000;
  assert.ok(r.check("k1"), "active receipt still live after the TTL would have elapsed");
  assert.equal(r.peek("k1").active, true);
  assert.equal(r.size(), 1, "active receipt not removed");
});

test("a settled receipt's TTL starts at settle, not accept", () => {
  const { r, clock } = registry({ ttlMs: 100 });
  r.reserve("k1", { batchId: "b1" }); // accepted at t=0 (active, no expiry yet)
  clock.t = 500; // long-running execution; still active, so not expired
  assert.ok(r.check("k1"), "active across the would-be accept-TTL");
  r.settle("k1"); // settled at t=500 -> expiresAt = 600
  assert.equal(r.peek("k1").settledAt, 500);
  assert.equal(r.peek("k1").expiresAt, 600);

  clock.t = 599; // ttl-1 after settle
  assert.ok(r.check("k1"), "still a duplicate just before the settle-TTL elapses");
  clock.t = 600; // exactly at expiry
  assert.equal(r.check("k1"), null, "reusable once the settle-TTL elapses");
});

test("settling a missing/released key is a no-op", () => {
  const { r } = registry();
  r.settle("never-existed"); // must not throw
  r.reserve("k1", { batchId: "b1" });
  r.release("k1");
  r.settle("k1"); // released -> no-op
  assert.equal(r.peek("k1"), null);
});

test("capacity is enforced by backpressure (503), never by evicting unexpired receipts", () => {
  const { r } = registry({ maxEntries: 2, ttlMs: 1000 });
  r.reserve("k1", { batchId: "b1" }); r.settle("k1");
  r.reserve("k2", { batchId: "b2" }); r.settle("k2");
  // Two unexpired settled receipts fill the registry. A third unique key is
  // rejected rather than evicting either existing receipt.
  assert.throws(
    () => r.reserve("k3", { batchId: "b3" }),
    (error) => error.code === "IDEMPOTENCY_REGISTRY_FULL" && error.statusCode === 503
  );
  assert.equal(r.size(), 2, "no receipt evicted");
  assert.ok(r.check("k1"), "k1 retained");
  assert.ok(r.check("k2"), "k2 retained");
});

test("reserve sweeps expired settled receipts to free capacity", () => {
  const { r, clock } = registry({ maxEntries: 2, ttlMs: 100 });
  r.reserve("k1", { batchId: "b1" }); r.settle("k1"); // expiresAt = 100
  clock.t = 50;
  r.reserve("k2", { batchId: "b2" }); r.settle("k2"); // expiresAt = 150
  // At capacity (2). Expire k1 only.
  clock.t = 120;
  // Reserving k3 sweeps the expired k1 and succeeds; k2 (unexpired) is kept.
  r.reserve("k3", { batchId: "b3" });
  assert.equal(r.check("k1"), null, "expired k1 swept");
  assert.ok(r.check("k2"), "unexpired k2 kept");
  assert.ok(r.check("k3"), "k3 reserved after sweep");
  assert.equal(r.size(), 2);
});

test("an active receipt blocks eviction-free backpressure: full of active receipts rejects", () => {
  const { r, clock } = registry({ maxEntries: 2, ttlMs: 100 });
  r.reserve("k1", { batchId: "b1" }); // active (never expires)
  r.reserve("k2", { batchId: "b2" }); // active
  clock.t = 100000; // far past TTL; both still active
  assert.throws(
    () => r.reserve("k3", { batchId: "b3" }),
    (error) => error.code === "IDEMPOTENCY_REGISTRY_FULL"
  );
  assert.ok(r.check("k1") && r.check("k2"), "active receipts never evicted");
});

test("reserve rejects a duplicate key", () => {
  const { r } = registry();
  r.reserve("k1", { batchId: "b1" });
  assert.throws(
    () => r.reserve("k1", { batchId: "b1" }),
    (error) => error.code === "DUPLICATE_IDEMPOTENCY_KEY" && error.statusCode === 409
  );
});

test("release frees the key for immediate reuse (lock/prep failure)", () => {
  const { r } = registry();
  r.reserve("k1", { batchId: "b1" });
  r.release("k1");
  assert.equal(r.check("k1"), null, "released -> reusable");
  r.reserve("k1", { batchId: "b1" }); // re-reserve succeeds
  assert.ok(r.check("k1"));
});

test("accept back-fills the executionId on the reserved receipt", () => {
  const { r } = registry();
  r.reserve("k1", { batchId: "b1" });
  assert.equal(r.peek("k1").executionId, null);
  r.accept("k1", { executionId: "snap-key" });
  assert.equal(r.peek("k1").executionId, "snap-key");
  r.accept("absent", { executionId: "x" }); // no-op, must not throw
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
