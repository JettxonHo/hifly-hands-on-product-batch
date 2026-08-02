import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createBatchStore, RENAME_MAX_RETRIES } from "../src/core/batch-store.js";

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
