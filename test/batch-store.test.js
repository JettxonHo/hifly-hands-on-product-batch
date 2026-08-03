import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createBatchStore, RENAME_MAX_RETRIES } from "../src/core/batch-store.js";
import { CURRENT_BATCH_SCHEMA_VERSION } from "../src/core/batch-schema.js";

async function withStore(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-batch-store-"));
  try {
    return await run(createBatchStore(root), root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("store creates, reads, updates and lists batches", async () => {
  await withStore(async (store) => {
    const created = await store.create({ batch_id: "batch-a", name: "First", items: [] });
    assert.equal(created.batch_id, "batch-a");
    assert.ok(created.created_at);

    const updated = await store.update("batch-a", (batch) => ({ ...batch, name: "Updated" }));
    assert.equal(updated.name, "Updated");
    assert.equal((await store.read("batch-a")).name, "Updated");
    assert.deepEqual((await store.list()).map((batch) => batch.batch_id), ["batch-a"]);
  });
});

test("failed updates and abandoned temporary files preserve the committed batch", async () => {
  await withStore(async (store, root) => {
    await store.create({ batch_id: "batch-a", name: "Committed", items: [] });

    await assert.rejects(
      store.update("batch-a", () => {
        throw new Error("simulated crash before rename");
      }),
      /simulated crash/
    );
    await writeFile(path.join(root, "batch-a", ".batch.json.abandoned.tmp"), "{broken", "utf8");

    assert.equal((await store.read("batch-a")).name, "Committed");
    assert.equal(JSON.parse(await readFile(path.join(root, "batch-a", "batch.json"), "utf8")).name, "Committed");
  });
});

test("artifact registration stores only an id and a batch-relative path", async () => {
  await withStore(async (store) => {
    await store.create({ batch_id: "batch-a", items: [] });
    const batch = await store.registerArtifact("batch-a", {
      artifact_id: "shot-1",
      relative_path: "screenshots/failure.png"
    });

    assert.deepEqual(batch.artifacts, [{
      artifact_id: "shot-1",
      relative_path: "screenshots/failure.png"
    }]);
    await assert.rejects(
      store.registerArtifact("batch-a", { artifact_id: "bad", relative_path: "../secret.txt" }),
      /relative path/i
    );
    await assert.rejects(
      store.registerArtifact("batch-a", { artifact_id: "bad-2", relative_path: path.resolve("secret.txt") }),
      /relative path/i
    );
    await assert.rejects(
      store.registerArtifact("batch-a", {
        artifact_id: "bad-3",
        relative_path: "logs/run.txt",
        absolute_path: "/tmp/run.txt"
      }),
      /only artifact_id and relative_path/i
    );
  });
});

test("duplicate batch and artifact identifiers are rejected", async () => {
  await withStore(async (store) => {
    await store.create({ batch_id: "batch-a", items: [] });
    await assert.rejects(store.create({ batch_id: "batch-a", items: [] }), /already exists/i);
    await store.registerArtifact("batch-a", { artifact_id: "log-1", relative_path: "logs/one.txt" });
    await assert.rejects(
      store.registerArtifact("batch-a", { artifact_id: "log-1", relative_path: "logs/two.txt" }),
      /already exists/i
    );
  });
});

// --- Windows filesystem hardening: EPERM/EBUSY rename retry -------------------
// These tests drive the retry with an INJECTED rename implementation and an
// injected (zero-time) backoff — no real-time sleep, and no reliance on a file
// actually being locked on the host. The retry is filesystem hardening, not the
// interrupted_unknown root cause.

// Build a store whose rename fails with `code` for the first `failCount` calls
// (within this store instance), then delegates to the real rename.
async function withFailingRenameStore(code, failCount, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-batch-store-retry-"));
  const realRename = (await import("node:fs/promises")).rename;
  let calls = 0;
  const renameImpl = async (...args) => {
    calls += 1;
    if (calls <= failCount) {
      const error = new Error(`simulated ${code} on rename`);
      error.code = code;
      throw error;
    }
    return realRename(...args);
  };
  const store = createBatchStore(root, { delay: () => Promise.resolve(), renameImpl });
  try {
    return await run(store, root, () => calls);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function leftoverTempFiles(root) {
  const files = await readdir(path.join(root, "batch-a")).catch(() => []);
  return files.filter((name) => name.startsWith(".batch.json.") && name.endsWith(".tmp"));
}

test("a rename that fails EPERM for the first N attempts then succeeds", async () => {
  await withFailingRenameStore("EPERM", 3, async (store, root, calls) => {
    await store.create({ batch_id: "batch-a", name: "Retried", items: [] });
    assert.equal(calls(), 4, "3 injected EPERM failures + 1 real rename");
    assert.equal((await store.read("batch-a")).name, "Retried");
    assert.deepEqual(await leftoverTempFiles(root), [], "temp file must be moved into place");
  });
});

test("a rename that fails EBUSY for the first N attempts then succeeds", async () => {
  await withFailingRenameStore("EBUSY", 2, async (store, root, calls) => {
    await store.create({ batch_id: "batch-a", name: "BusyRetried", items: [] });
    assert.equal(calls(), 3, "2 injected EBUSY failures + 1 real rename");
    assert.equal((await store.read("batch-a")).name, "BusyRetried");
    assert.deepEqual(await leftoverTempFiles(root), []);
  });
});

test("a rename that keeps failing past the old 5-attempt window still succeeds within the widened budget", async () => {
  // Regression for CI run 30741311736: a Windows transient lock held batch.json
  // for ~214ms, exhausting the old 5x/100ms window. Fail 6 times (past 5) so the
  // store only survives because the budget is wider.
  await withFailingRenameStore("EPERM", 6, async (store, root, calls) => {
    await store.create({ batch_id: "batch-a", name: "WideWindow", items: [] });
    assert.equal(calls(), 7, "6 injected EPERM failures + 1 real rename");
    assert.equal((await store.read("batch-a")).name, "WideWindow");
    assert.deepEqual(await leftoverTempFiles(root), []);
  });
});

test("a rename that exceeds the max retries throws the original error and cleans the temp file", async () => {
  // Fail every attempt (more than RENAME_MAX_RETRIES): the store must surface the
  // original EPERM, not swallow it, and must not leave the temp file behind.
  await withFailingRenameStore("EPERM", 99, async (store, root, calls) => {
    await assert.rejects(store.create({ batch_id: "batch-a", items: [] }), (error) => {
      assert.equal(error.code, "EPERM", "the original rename error is rethrown");
      return true;
    });
    assert.equal(calls(), RENAME_MAX_RETRIES, "exactly maxRetries attempts were made");
    // The failed create removes the whole batch directory, so no temp file survives.
    assert.deepEqual(await readdir(root), [], "failed create cleans the batch directory");
  });
});

test("a non-retryable rename error fails immediately without retrying", async () => {
  await withFailingRenameStore("EACCES", 99, async (store, root, calls) => {
    await assert.rejects(store.create({ batch_id: "batch-a", items: [] }), (error) => {
      assert.equal(error.code, "EACCES");
      return true;
    });
    assert.equal(calls(), 1, "EACCES is not retried");
    assert.deepEqual(await readdir(root), [], "failed create cleans the batch directory");
  });
});

// --- In-process committed snapshot (GET polling reader) ----------------------
// The high-frequency GET /api/batches/:id reader reads the committed snapshot via
// readCommitted() instead of opening batch.json, eliminating the Windows
// file-handle race with the writer's atomic rename.

test("readCommitted serves the committed snapshot without reading batch.json and returns an isolated clone", async () => {
  await withStore(async (store, root) => {
    await store.create({ batch_id: "batch-a", name: "Committed", items: [] });
    // If readCommitted touched batch.json, this corruption would make JSON.parse throw.
    await writeFile(path.join(root, "batch-a", "batch.json"), "{not-json", "utf8");

    const observed = await store.readCommitted("batch-a");
    assert.equal(observed.name, "Committed", "served from the in-memory snapshot, not the corrupted disk");
    // Mutating the returned value must not affect the snapshot (immutable clone).
    observed.name = "mutated";
    assert.equal((await store.readCommitted("batch-a")).name, "Committed", "returns an isolated clone");
  });
});

test("readCommitted stays in sync with committed writes and agrees with the on-disk value", async () => {
  await withStore(async (store) => {
    await store.create({ batch_id: "batch-a", name: "V1", items: [] });
    assert.equal((await store.readCommitted("batch-a")).name, "V1");
    await store.update("batch-a", (batch) => ({ ...batch, name: "V2" }));
    assert.equal((await store.readCommitted("batch-a")).name, "V2", "snapshot reflects the latest committed update");
    assert.equal((await store.read("batch-a")).name, "V2", "snapshot and disk agree within one process");
  });
});

test("readCommitted falls back to disk on a cold snapshot (second instance / post-restart) and back-fills it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-batch-store-cold-"));
  try {
    const writer = createBatchStore(root);
    await writer.create({ batch_id: "batch-a", name: "Persisted", items: [] });

    // A second store instance (separate process / after restart) has an empty snapshot.
    const reader = createBatchStore(root);
    assert.equal((await reader.readCommitted("batch-a")).name, "Persisted", "cold read falls back to disk");
    // After back-fill, a subsequent read stays off memory: corrupt the disk and
    // confirm readCommitted no longer touches it.
    await writeFile(path.join(root, "batch-a", "batch.json"), "{not-json", "utf8");
    assert.equal((await reader.readCommitted("batch-a")).name, "Persisted", "back-filled snapshot now serves from memory");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent readCommitted readers add no rename contention during a writer's retry window", async () => {
  // Owner scenario (1): the in-process GET reader must not open batch.json while
  // the writer retries a contended rename. readCommitted serves the committed
  // snapshot, so 50 concurrent reads issued during a writer's EPERM retry window
  // add ZERO rename calls — reader and writer no longer contend on the same file.
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-batch-store-race-"));
  const realRename = (await import("node:fs/promises")).rename;
  let armedCalls = 0;
  let armed = false;
  const failuresPerArm = 4;
  const renameImpl = async (...args) => {
    if (!armed) return realRename(...args);
    armedCalls += 1;
    if (armedCalls <= failuresPerArm) {
      const error = new Error("simulated EPERM on rename");
      error.code = "EPERM";
      throw error;
    }
    return realRename(...args);
  };
  const store = createBatchStore(root, { delay: () => Promise.resolve(), renameImpl });
  try {
    // Seed without arming: create's rename goes straight through and populates the snapshot.
    await store.create({ batch_id: "batch-a", name: "Seed", items: [] });

    armed = true;
    const writer = store.update("batch-a", (batch) => ({ ...batch, name: "Updated" }));

    // Hammer the GET-polling reader path during the retry window.
    const observed = await Promise.all(
      Array.from({ length: 50 }, () => store.readCommitted("batch-a"))
    );

    await writer;
    assert.equal(armedCalls, failuresPerArm + 1, "only the writer renamed (4 EPERM + 1 success); readers added zero");
    assert.ok(
      observed.every((batch) => batch && (batch.name === "Seed" || batch.name === "Updated")),
      "every reader saw a committed value and none threw during the retry window"
    );
    assert.equal((await store.readCommitted("batch-a")).name, "Updated", "snapshot reflects the committed update");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- cold readCommitted vs concurrent commit (per-batch queue) ---------------
// A cold read and an update for the SAME batch serialize through one per-batch
// queue, so a cold back-fill can never overwrite a snapshot committed mid-read.
// The read/rename gates are INJECTED so every race is deterministic with no
// real-time sleep.

test("cold-first: a cold read returns V1 (last committed) then a queued update commits V2; final is V2", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-batch-store-coldfirst-"));
  const realReadFile = readFile;
  try {
    // Seed batch-a via a SEPARATE store so the test store's snapshot is cold for it.
    await createBatchStore(root).create({ batch_id: "batch-a", name: "V1", items: [] });

    let release;
    let pausedOnce = false;
    const readFileImpl = async (file, enc) => {
      if (!pausedOnce && file.endsWith(path.join("batch-a", "batch.json"))) {
        pausedOnce = true;
        const captured = await realReadFile(file, enc); // V1
        await new Promise((resolve) => { release = resolve; }); // hold the cold read open
        return captured;
      }
      return realReadFile(file, enc);
    };
    const store = createBatchStore(root, { readFileImpl });

    const cold = store.readCommitted("batch-a"); // hot miss -> queued -> paused reading V1
    while (!release) await new Promise((resolve) => setImmediate(resolve));

    // The update is queued BEHIND the paused cold read, so it cannot commit yet.
    let updateSettled = false;
    const update = store.update("batch-a", (b) => ({ ...b, name: "V2" })).then((value) => {
      updateSettled = true;
      return value;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(updateSettled, false, "update cannot commit while the cold read holds the queue");

    release(); // cold read resumes -> returns V1 (the last committed value), back-fills V1
    const observed = await cold;
    assert.equal(observed.name, "V1", "cold read returns the last committed value (V1)");

    await update; // now the update commits V2
    assert.equal(updateSettled, true);
    assert.equal((await store.readCommitted("batch-a")).name, "V2", "final readCommitted returns V2");
    assert.equal((await store.read("batch-a")).name, "V2", "disk agrees");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("update-first: an update commits V2 then a queued cold read returns V2", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-batch-store-updatefirst-"));
  const realRename = rename;
  try {
    // Seed via a separate store (real rename) so the test store's snapshot is cold.
    await createBatchStore(root).create({ batch_id: "batch-a", name: "V1", items: [] });

    let releaseRename;
    let renamePaused = false;
    const renameImpl = async (from, to) => {
      if (!renamePaused && to.endsWith(path.join("batch-a", "batch.json"))) {
        renamePaused = true;
        await new Promise((resolve) => { releaseRename = resolve; }); // hold the commit open
      }
      return realRename(from, to);
    };
    const store = createBatchStore(root, { renameImpl });

    // Start the update: it reads V1, computes V2, then pauses at the rename.
    let updateSettled = false;
    const update = store.update("batch-a", (b) => ({ ...b, name: "V2" })).then((value) => {
      updateSettled = true;
      return value;
    });
    while (!renamePaused) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(updateSettled, false, "update paused at rename, not yet committed");

    // The cold read enters the queue BEHIND the update and waits for it to commit.
    const cold = store.readCommitted("batch-a");

    releaseRename(); // update renames V2 and installs the snapshot
    await update;
    assert.equal(updateSettled, true);

    const observed = await cold;
    assert.equal(observed.name, "V2", "cold read re-checks the snapshot and returns the committed V2");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("eviction pressure during a cold read still ends at the latest committed value", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-batch-store-evictcold-"));
  const realReadFile = readFile;
  try {
    await createBatchStore(root).create({ batch_id: "batch-a", name: "V1", items: [] });

    let release;
    let pausedOnce = false;
    const readFileImpl = async (file, enc) => {
      if (!pausedOnce && file.endsWith(path.join("batch-a", "batch.json"))) {
        pausedOnce = true;
        const captured = await realReadFile(file, enc);
        await new Promise((resolve) => { release = resolve; });
        return captured;
      }
      return realReadFile(file, enc);
    };
    // Small snapshot cache so other batches apply real LRU eviction pressure.
    const store = createBatchStore(root, { snapshotMaxEntries: 2, readFileImpl });

    const cold = store.readCommitted("batch-a"); // paused reading V1
    while (!release) await new Promise((resolve) => setImmediate(resolve));

    // Create other batches (independent queues) to apply LRU eviction pressure.
    await store.create({ batch_id: "batch-b", name: "B", items: [] });
    await store.create({ batch_id: "batch-c", name: "C", items: [] });

    // Start update A (queued behind the cold read).
    let updateSettled = false;
    const update = store.update("batch-a", (b) => ({ ...b, name: "V2" })).then((value) => {
      updateSettled = true;
      return value;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(updateSettled, false, "update A waits behind the cold read");

    release(); // cold read back-fills V1
    assert.equal((await cold).name, "V1");

    await update; // update A commits V2 (re-installs A regardless of eviction)
    assert.equal(updateSettled, true);
    assert.equal((await store.readCommitted("batch-a")).name, "V2", "final A is V2 despite eviction pressure");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent cold reads coalesce: exactly one disk read populates the snapshot", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-batch-store-coalesce-"));
  const realReadFile = readFile;
  let diskReads = 0;
  try {
    await createBatchStore(root).create({ batch_id: "batch-a", name: "V1", items: [] });
    const readFileImpl = async (file, enc) => {
      if (file.endsWith(path.join("batch-a", "batch.json"))) diskReads += 1;
      return realReadFile(file, enc);
    };
    const store = createBatchStore(root, { readFileImpl });

    // 50 concurrent cold reads: the first reads disk + back-fills; the rest hit the snapshot.
    const results = await Promise.all(Array.from({ length: 50 }, () => store.readCommitted("batch-a")));
    assert.equal(diskReads, 1, "exactly one disk read; the rest coalesced on the snapshot");
    assert.ok(results.every((r) => r.name === "V1"), "every read returns the committed value");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// --- snapshot cache bounded LRU ----------------------------------------------

test("snapshot cache evicts LRU; evicted batches cold-restore and the next LRU is evicted correctly", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-batch-store-lru-"));
  const realReadFile = readFile;
  async function mutateDiskName(batchId, newName) {
    const filePath = path.join(root, batchId, "batch.json");
    const current = JSON.parse(await realReadFile(filePath, "utf8"));
    await writeFile(filePath, `${JSON.stringify({ ...current, name: newName }, null, 2)}\n`, "utf8");
  }
  try {
    const store = createBatchStore(root, { snapshotMaxEntries: 2 });
    await store.create({ batch_id: "batch-a", name: "A", items: [] });
    await store.create({ batch_id: "batch-b", name: "B", items: [] });
    await store.readCommitted("batch-a"); // touch A -> B becomes LRU
    await store.create({ batch_id: "batch-c", name: "C", items: [] }); // overflows -> evicts B
    assert.equal(store.snapshotCacheSize(), 2, "cache at the limit (A and C retained; B evicted)");

    // C is retained (cached): a disk mutation is NOT visible through readCommitted.
    await mutateDiskName("batch-c", "C-from-disk");
    assert.equal((await store.readCommitted("batch-c")).name, "C", "C served from cache; disk mutation invisible");

    // B was evicted -> readCommitted(B) cold-reads disk (mutation visible) and back-fills,
    // which evicts the now-LRU entry (A).
    await mutateDiskName("batch-b", "B-from-disk");
    assert.equal((await store.readCommitted("batch-b")).name, "B-from-disk", "B cold-restores from disk");

    // A was evicted by B's restore -> readCommitted(A) cold-reads disk.
    await mutateDiskName("batch-a", "A-from-disk");
    assert.equal((await store.readCommitted("batch-a")).name, "A-from-disk", "A re-evicted after B restore -> cold read");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("snapshot cache size never exceeds snapshotMaxEntries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-batch-store-bound-"));
  try {
    const store = createBatchStore(root, { snapshotMaxEntries: 3 });
    for (let i = 0; i < 8; i += 1) {
      await store.create({ batch_id: `batch-${i}`, items: [] });
      await store.readCommitted(`batch-${i}`);
      assert.ok(store.snapshotCacheSize() <= 3, `iter ${i}: size ${store.snapshotCacheSize()} must be <= 3`);
    }
    assert.equal(store.snapshotCacheSize(), 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("snapshotMaxEntries must be a finite positive integer (Infinity rejected)", () => {
  assert.throws(() => createBatchStore(path.join(os.tmpdir(), "nul"), { snapshotMaxEntries: Infinity }), /finite positive integer/);
  assert.throws(() => createBatchStore(path.join(os.tmpdir(), "nul"), { snapshotMaxEntries: 0 }), /finite positive integer/);
  assert.throws(() => createBatchStore(path.join(os.tmpdir(), "nul"), { snapshotMaxEntries: 2.5 }), /finite positive integer/);
});

// --- Batch schema versioning and migrations (CORE-001 / Issue #20) -----------
// Legacy (unversioned) batches are internal schema v0. The store migrates them
// to the current schema at create/initialize/read/readCommitted/update/list
// boundaries; invalid and future versions fail closed. All concurrency tests
// use injected read/rename gates — no real-time sleep.

function legacyBatchDoc(overrides = {}) {
  return {
    batch_id: "batch-a",
    status: "needs_input",
    items: [],
    uploads: [],
    artifacts: [],
    created_at: "2026-07-01T10:00:00.000Z",
    updated_at: "2026-07-01T10:00:00.000Z",
    historical_unknown_field: { keep: true },
    ...overrides
  };
}

async function seedLegacyBatch(root, doc = legacyBatchDoc()) {
  const directory = path.join(root, doc.batch_id);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "batch.json"), JSON.stringify(doc, null, 2), "utf8");
}

async function readDiskBatch(root, batchId) {
  return JSON.parse(await readFile(path.join(root, batchId, "batch.json"), "utf8"));
}

test("create persists schemaVersion at the current version", async () => {
  await withStore(async (store, root) => {
    await store.create({ batch_id: "batch-a", items: [] });
    assert.equal((await readDiskBatch(root, "batch-a")).schemaVersion, CURRENT_BATCH_SCHEMA_VERSION);
  });
});

test("create rejects caller-controlled schema versions", async () => {
  await withStore(async (store, root) => {
    for (const schemaVersion of [0, 2, "1"]) {
      await assert.rejects(
        store.create({ batch_id: "batch-x", items: [], schemaVersion }),
        (error) => error.code === "BATCH_SCHEMA_INVALID" && error.batchId === "batch-x"
      );
    }
    assert.deepEqual(await readdir(root).catch(() => []), [], "rejected creates persist nothing");
    const created = await store.create({ batch_id: "batch-ok", items: [], schemaVersion: CURRENT_BATCH_SCHEMA_VERSION });
    assert.equal(created.schemaVersion, CURRENT_BATCH_SCHEMA_VERSION, "explicit current version accepted");
  });
});

test("initialize migrates existing legacy batches to the current schema", async () => {
  await withStore(async (store, root) => {
    await seedLegacyBatch(root);
    await store.initialize();
    const onDisk = await readDiskBatch(root, "batch-a");
    assert.equal(onDisk.schemaVersion, CURRENT_BATCH_SCHEMA_VERSION);
    assert.equal(onDisk.status, "needs_input");
    assert.deepEqual(onDisk.historical_unknown_field, { keep: true }, "unknown historical fields preserved");
    assert.equal(onDisk.created_at, "2026-07-01T10:00:00.000Z", "created_at unchanged by migration");
    assert.equal(onDisk.updated_at, "2026-07-01T10:00:00.000Z", "updated_at unchanged by migration");
    assert.equal((await store.readCommitted("batch-a")).schemaVersion, CURRENT_BATCH_SCHEMA_VERSION);
  });
});

test("initialize is idempotent and never rewrites current-schema batches", async () => {
  await withStore(async (store, root) => {
    await seedLegacyBatch(root);
    await store.initialize();
    let renames = 0;
    const counting = createBatchStore(root, {
      renameImpl: async (...args) => {
        renames += 1;
        return rename(...args);
      }
    });
    await counting.initialize();
    await counting.initialize();
    assert.equal(renames, 0, "current-schema batches must not be rewritten");
  });
});

test("read migrates a legacy batch before returning it", async () => {
  await withStore(async (store, root) => {
    await seedLegacyBatch(root);
    const batch = await store.read("batch-a");
    assert.equal(batch.schemaVersion, CURRENT_BATCH_SCHEMA_VERSION);
    assert.equal((await readDiskBatch(root, "batch-a")).schemaVersion, CURRENT_BATCH_SCHEMA_VERSION);
  });
});

test("readCommitted cold read migrates before back-filling the snapshot", async () => {
  await withStore(async (store, root) => {
    await seedLegacyBatch(root);
    const cold = await store.readCommitted("batch-a");
    assert.equal(cold.schemaVersion, CURRENT_BATCH_SCHEMA_VERSION, "cold read returns migrated v1, never legacy");
    assert.equal((await store.readCommitted("batch-a")).schemaVersion, CURRENT_BATCH_SCHEMA_VERSION, "hot snapshot is v1");
    assert.equal((await readDiskBatch(root, "batch-a")).schemaVersion, CURRENT_BATCH_SCHEMA_VERSION);
  });
});

test("list migrates legacy batches and returns only current-schema documents", async () => {
  await withStore(async (store, root) => {
    await seedLegacyBatch(root, legacyBatchDoc({ batch_id: "batch-legacy-1" }));
    await seedLegacyBatch(root, legacyBatchDoc({ batch_id: "batch-legacy-2" }));
    await store.create({ batch_id: "batch-new", items: [] });
    const batches = await store.list();
    assert.equal(batches.length, 3);
    for (const batch of batches) {
      assert.equal(batch.schemaVersion, CURRENT_BATCH_SCHEMA_VERSION);
    }
    for (const batchId of ["batch-legacy-1", "batch-legacy-2"]) {
      assert.equal((await readDiskBatch(root, batchId)).schemaVersion, CURRENT_BATCH_SCHEMA_VERSION);
    }
  });
});

test("list fails closed on an unsupported future schema instead of skipping it", async () => {
  await withStore(async (store, root) => {
    await seedLegacyBatch(root, legacyBatchDoc({ batch_id: "batch-future", schemaVersion: 2 }));
    await assert.rejects(store.list(), (error) => error.code === "BATCH_SCHEMA_UNSUPPORTED");
  });
});

test("update migrates a legacy batch before applying the updater", async () => {
  await withStore(async (store, root) => {
    await seedLegacyBatch(root);
    const updated = await store.update("batch-a", (batch) => ({ ...batch, status: "ready" }));
    assert.equal(updated.schemaVersion, CURRENT_BATCH_SCHEMA_VERSION);
    assert.equal(updated.status, "ready");
    assert.deepEqual(updated.historical_unknown_field, { keep: true });
    const onDisk = await readDiskBatch(root, "batch-a");
    assert.equal(onDisk.schemaVersion, CURRENT_BATCH_SCHEMA_VERSION);
    assert.equal(onDisk.status, "ready");
    assert.equal(onDisk.created_at, "2026-07-01T10:00:00.000Z", "created_at preserved across migration + update");
  });
});

test("updaters cannot remove, downgrade, upgrade, or retype schemaVersion", async () => {
  await withStore(async (store, root) => {
    await store.create({ batch_id: "batch-a", name: "Guarded", items: [] });
    const mutations = [
      (batch) => {
        const next = { ...batch };
        delete next.schemaVersion;
        return next;
      },
      (batch) => ({ ...batch, schemaVersion: 0 }),
      (batch) => ({ ...batch, schemaVersion: 2 }),
      (batch) => ({ ...batch, schemaVersion: "1" })
    ];
    for (const updater of mutations) {
      await assert.rejects(
        store.update("batch-a", updater),
        (error) => error.code === "BATCH_SCHEMA_MUTATION_NOT_ALLOWED" && error.batchId === "batch-a"
      );
    }
    const onDisk = await readDiskBatch(root, "batch-a");
    assert.equal(onDisk.schemaVersion, CURRENT_BATCH_SCHEMA_VERSION, "disk keeps the current version");
    assert.equal(onDisk.name, "Guarded", "rejected updater changes are not persisted");
  });
});

test("unsupported and invalid schema files are rejected without touching the file", async () => {
  await withStore(async (store, root) => {
    const futureDoc = legacyBatchDoc({ batch_id: "batch-a", schemaVersion: 2 });
    await seedLegacyBatch(root, futureDoc);
    await assert.rejects(store.read("batch-a"), (error) => error.code === "BATCH_SCHEMA_UNSUPPORTED" && error.detectedVersion === 2);
    assert.equal(await readFile(path.join(root, "batch-a", "batch.json"), "utf8"), JSON.stringify(futureDoc, null, 2));

    const invalidDoc = legacyBatchDoc({ batch_id: "batch-b", schemaVersion: "1" });
    await seedLegacyBatch(root, invalidDoc);
    await assert.rejects(store.read("batch-b"), (error) => error.code === "BATCH_SCHEMA_INVALID" && error.detectedVersion === "string");
    assert.equal(await readFile(path.join(root, "batch-b", "batch.json"), "utf8"), JSON.stringify(invalidDoc, null, 2));
  });
});

test("a migration whose rename fails keeps the original file, leaves the snapshot empty, and cleans up", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-batch-store-schema-fail-"));
  try {
    await seedLegacyBatch(root);
    const renameImpl = async () => {
      const error = new Error("simulated EACCES on rename");
      error.code = "EACCES";
      throw error;
    };
    const store = createBatchStore(root, { delay: () => Promise.resolve(), renameImpl });
    await assert.rejects(store.read("batch-a"), (error) => error.code === "EACCES");
    const onDisk = await readDiskBatch(root, "batch-a");
    assert.equal("schemaVersion" in onDisk, false, "original file keeps the legacy shape");
    assert.equal(store.snapshotCacheSize(), 0, "failed migration never populates the snapshot");
    assert.deepEqual(await leftoverTempFiles(root), [], "temp file cleaned up");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent initialize and read produce exactly one migration commit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-batch-store-schema-conc-"));
  try {
    await seedLegacyBatch(root);
    const realReadFile = (await import("node:fs/promises")).readFile;
    let release;
    let pausedOnce = false;
    const readFileImpl = async (file, enc) => {
      if (!pausedOnce && file.endsWith(path.join("batch-a", "batch.json"))) {
        pausedOnce = true;
        const captured = await realReadFile(file, enc);
        await new Promise((resolve) => {
          release = resolve;
        });
        return captured;
      }
      return realReadFile(file, enc);
    };
    let renames = 0;
    const renameImpl = async (...args) => {
      renames += 1;
      return rename(...args);
    };
    const store = createBatchStore(root, { readFileImpl, renameImpl, delay: () => Promise.resolve() });

    const initialize = store.initialize(); // queues the migration read (paused)
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    const cold = store.readCommitted("batch-a"); // queues behind the migration
    release();
    await initialize;
    const value = await cold;

    assert.equal(value.schemaVersion, CURRENT_BATCH_SCHEMA_VERSION);
    assert.equal(renames, 1, "exactly one migration commit for concurrent initialize + read");
    assert.equal((await readDiskBatch(root, "batch-a")).schemaVersion, CURRENT_BATCH_SCHEMA_VERSION);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent migration and update keep both the migration and the updater change", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-batch-store-schema-upd-"));
  try {
    await seedLegacyBatch(root);
    const realReadFile = (await import("node:fs/promises")).readFile;
    let release;
    let pausedOnce = false;
    const readFileImpl = async (file, enc) => {
      if (!pausedOnce && file.endsWith(path.join("batch-a", "batch.json"))) {
        pausedOnce = true;
        const captured = await realReadFile(file, enc);
        await new Promise((resolve) => {
          release = resolve;
        });
        return captured;
      }
      return realReadFile(file, enc);
    };
    const store = createBatchStore(root, { readFileImpl, delay: () => Promise.resolve() });

    const readPromise = store.read("batch-a"); // queued migration, paused on disk read
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    const updatePromise = store.update("batch-a", (batch) => ({ ...batch, status: "ready" })); // queued behind
    release();

    const [readValue, updated] = await Promise.all([readPromise, updatePromise]);
    assert.equal(readValue.schemaVersion, CURRENT_BATCH_SCHEMA_VERSION);
    assert.equal(updated.schemaVersion, CURRENT_BATCH_SCHEMA_VERSION);
    assert.equal(updated.status, "ready", "updater change not lost");
    const onDisk = await readDiskBatch(root, "batch-a");
    assert.equal(onDisk.schemaVersion, CURRENT_BATCH_SCHEMA_VERSION);
    assert.equal(onDisk.status, "ready");
    assert.deepEqual(onDisk.historical_unknown_field, { keep: true });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("migrations of different batches hold no global lock", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-batch-store-schema-parallel-"));
  try {
    await seedLegacyBatch(root, legacyBatchDoc({ batch_id: "batch-a" }));
    await seedLegacyBatch(root, legacyBatchDoc({ batch_id: "batch-b" }));
    const realReadFile = (await import("node:fs/promises")).readFile;
    let releaseA;
    const readFileImpl = async (file, enc) => {
      if (file.endsWith(path.join("batch-a", "batch.json"))) {
        await new Promise((resolve) => {
          releaseA = resolve;
        });
      }
      return realReadFile(file, enc);
    };
    const store = createBatchStore(root, { readFileImpl, delay: () => Promise.resolve() });

    const migrationA = store.read("batch-a"); // held open
    const b = await store.read("batch-b"); // completes while batch-a is held
    assert.equal(b.schemaVersion, CURRENT_BATCH_SCHEMA_VERSION, "batch-b migrated without waiting on batch-a");
    releaseA();
    const a = await migrationA;
    assert.equal(a.schemaVersion, CURRENT_BATCH_SCHEMA_VERSION);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
