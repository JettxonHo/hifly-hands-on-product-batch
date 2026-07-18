import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createBatchStore } from "../src/core/batch-store.js";

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
