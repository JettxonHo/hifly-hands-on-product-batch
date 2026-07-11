import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { acquireExecutionLock } from "../src/core/execution-lock.js";

async function withRoot(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-lock-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("only one process-level lock acquisition succeeds", async () => {
  await withRoot(async (root) => {
    const results = await Promise.allSettled([
      acquireExecutionLock({ root, batchId: "batch-a", instanceId: "instance-a" }),
      acquireExecutionLock({ root, batchId: "batch-b", instanceId: "instance-b" })
    ]);
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.code, "EXECUTION_LOCKED");
    await fulfilled[0].value.release();
  });
});

test("a suspicious stale lock is reported but never auto-reclaimed", async () => {
  await withRoot(async (root) => {
    const old = new Date(Date.now() - 60_000).toISOString();
    await writeFile(path.join(root, "execution.lock"), JSON.stringify({
      instanceId: "old-instance",
      batchId: "old-batch",
      pid: 123,
      createdAt: old,
      heartbeatAt: old
    }));

    await assert.rejects(
      acquireExecutionLock({ root, batchId: "new-batch", instanceId: "new-instance" }),
      (error) => error.code === "EXECUTION_LOCKED" && error.suspicious === true
    );
    assert.equal(JSON.parse(await readFile(path.join(root, "execution.lock"), "utf8")).batchId, "old-batch");
  });
});

test("release refuses to remove a lock whose identity changed", async () => {
  await withRoot(async (root) => {
    const handle = await acquireExecutionLock({
      root,
      batchId: "batch-a",
      instanceId: "instance-a",
      heartbeatIntervalMs: 10_000
    });
    const lockPath = path.join(root, "execution.lock");
    const metadata = JSON.parse(await readFile(lockPath, "utf8"));
    await writeFile(lockPath, JSON.stringify({ ...metadata, batchId: "batch-b" }));

    await assert.rejects(handle.release(), /identity/i);
    assert.equal(JSON.parse(await readFile(lockPath, "utf8")).batchId, "batch-b");
    handle.stopHeartbeat();
  });
});

test("heartbeat preserves ownership and advances heartbeat time", async () => {
  await withRoot(async (root) => {
    const handle = await acquireExecutionLock({
      root,
      batchId: "batch-a",
      instanceId: "instance-a",
      heartbeatIntervalMs: 10_000
    });
    const before = await handle.inspect();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const after = await handle.heartbeat();

    assert.equal(after.instanceId, "instance-a");
    assert.equal(after.batchId, "batch-a");
    assert.ok(Date.parse(after.heartbeatAt) > Date.parse(before.heartbeatAt));
    await handle.release();
  });
});
