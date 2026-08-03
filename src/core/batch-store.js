import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import {
  CURRENT_BATCH_SCHEMA_VERSION,
  batchSchemaError,
  describeDetectedVersion,
  migrateBatchDocument
} from "./batch-schema.js";

const BATCH_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function assertBatchId(batchId) {
  if (typeof batchId !== "string" || !BATCH_ID_PATTERN.test(batchId) || batchId === "." || batchId === "..") {
    throw new Error("Invalid batch_id");
  }
}

function assertRelativePath(relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]+/).some((segment) => segment === ".." || segment === "")
  ) {
    throw new Error("Artifact must use a safe batch-relative path");
  }
}

// Retry budget for the Windows EPERM/EBUSY rename hardening. Exported so tests
// assert the exact attempt count from a single source of truth instead of
// hard-coding a number that drifts from the implementation.
export const RENAME_MAX_RETRIES = 8;

async function atomicWriteJson(filePath, value, { delay, renameImpl } = {}) {
  // Backoff and the rename implementation are injectable so tests can drive the
  // Windows EPERM/EBUSY retry deterministically (no real-time sleep in the test).
  //
  // Default backoff: capped exponential (10ms, doubling, capped at 250ms). A
  // transient Windows lock on the target — a concurrent reader polling
  // GET /api/batches/:id, or antivirus / Search-indexer scanning the just-written
  // file — routinely holds batch.json for several hundred milliseconds, which a
  // short fixed 5x/100ms window does not survive (observed: CI run 30741311736,
  // 5 consecutive EPERM in ~214ms). The wider window below (~1.2s worst case)
  // covers that without an unbounded hang: a genuinely non-retryable error still
  // fails fast, and a persistent lock still throws the original EPERM.
  const backoff = typeof delay === "function" ? delay : (attempt) =>
    new Promise((resolve) => setTimeout(resolve, Math.min(250, 10 * 2 ** attempt)));
  const doRename = typeof renameImpl === "function" ? renameImpl : rename;
  const tempPath = path.join(path.dirname(filePath), `.batch.json.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    // On Windows, rename can fail with EPERM/EBUSY if another handle has the target
    // file open (e.g. a concurrent reader polling GET /api/batches/:id). Retry with
    // backoff, matching the contract already used in src/rpa/rpa-state.js.
    // This is Windows filesystem hardening, NOT the root cause of interrupted_unknown.
    const maxRetries = RENAME_MAX_RETRIES;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await doRename(tempPath, filePath);
        return;
      } catch (error) {
        if ((error.code === "EPERM" || error.code === "EBUSY") && attempt < maxRetries - 1) {
          await backoff(attempt);
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

// Bounded LRU cache for the in-process committed snapshots. Map insertion order
// is the LRU order (oldest first): get() refreshes recency via delete+set, set()
// evicts the oldest entry past maxEntries. Eviction drops only the in-memory
// snapshot — never disk — so an evicted batch cold-reads + back-fills on next
// access. maxEntries must be a finite positive integer (Infinity is rejected) so
// the cache cannot be configured to grow without bound.
function createSnapshotCache(maxEntries) {
  if (!Number.isInteger(maxEntries) || maxEntries <= 0 || !Number.isFinite(maxEntries)) {
    throw new TypeError("snapshotMaxEntries must be a finite positive integer");
  }
  const entries = new Map();
  return {
    get(id) {
      if (!entries.has(id)) return undefined;
      const value = entries.get(id);
      entries.delete(id);
      entries.set(id, value);
      return value;
    },
    has(id) {
      return entries.has(id);
    },
    set(id, value) {
      if (entries.has(id)) entries.delete(id);
      entries.set(id, value);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value;
        entries.delete(oldest);
      }
    },
    size() {
      return entries.size;
    }
  };
}

export function createBatchStore(root, { delay, renameImpl, snapshotMaxEntries, readFileImpl } = {}) {
  const storeRoot = path.resolve(root);
  // In-process committed snapshot (bounded LRU): the last value durably renamed
  // into batch.json. The high-frequency GET /api/batches/:id polling reader reads
  // this via readCommitted() instead of opening batch.json, so it can never hold a
  // file handle that collides with the writer's atomic rename — the Windows EPERM
  // race between the in-process reader and writer. Strong-consistency callers
  // (batch-runner, executions, imports, capture gates) keep using read(), which
  // still hits disk. Populated only AFTER a successful rename, so it always holds
  // an already-committed value; missed on cold start / a second process / LRU
  // eviction and falls back to disk + back-fills. Bounded to snapshotMaxEntries
  // (default 256); evicted batches cold-read + back-fill on next access.
  const snapshots = createSnapshotCache(snapshotMaxEntries ?? 256);
  const doReadFile = typeof readFileImpl === "function" ? readFileImpl : readFile;

  // Per-batch operation queue. update() and a cold readCommitted() for the SAME
  // batch both run through this queue, so a cold disk read can never race a
  // concurrent commit on the same batch — they serialize. Cold-first: the cold
  // read back-fills the then-current value, and the later update commits on top.
  // Update-first: the update commits, and the later cold read re-checks the
  // snapshot and returns the newer value. Concurrent cold reads coalesce (the
  // first reads disk + back-fills; the rest hit the snapshot). Different batches
  // use independent queues (parallel); there is NO global lock and NO generation
  // counter — serialization alone makes a stale overwrite impossible.
  const batchQueues = new Map();
  function enqueueBatchOperation(batchId, operation) {
    const previous = batchQueues.get(batchId) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(operation);
    batchQueues.set(batchId, run);
    run.finally(() => {
      if (batchQueues.get(batchId) === run) batchQueues.delete(batchId);
    }).catch(() => {});
    return run;
  }

  const batchDirectory = (batchId) => {
    assertBatchId(batchId);
    return path.join(storeRoot, batchId);
  };
  const batchFile = (batchId) => path.join(batchDirectory(batchId), "batch.json");

  // Core read: parse + schema migration (+ atomic persist of the migration).
  // Callers already inside a per-batch queue (update, readCommitted cold,
  // initialize) call this directly; the public read() wraps it in the queue so
  // a migration write can never race a concurrent commit on the same batch.
  async function readAndMigrate(batchId) {
    const parsed = JSON.parse(await doReadFile(batchFile(batchId), "utf8"));
    // Schema boundary: every document leaving the store is at the current
    // schema. Legacy (unversioned) batches are migrated here — read-time
    // migration covers second store instances, batches copied in after
    // startup, cold snapshots, and tests that seed legacy batch.json files.
    const { batch, migrated } = migrateBatchDocument(parsed, { batchId });
    if (migrated) {
      // Persist the migration atomically before anyone observes the migrated
      // document. The committed snapshot is updated only AFTER the rename
      // succeeds; on rename failure the original file stays untouched, the
      // snapshot is not populated, and the original error propagates.
      await atomicWriteJson(batchFile(batchId), batch, { delay, renameImpl });
      snapshots.set(batchId, structuredClone(batch));
    }
    return batch;
  }

  function read(batchId) {
    return enqueueBatchOperation(batchId, () => readAndMigrate(batchId));
  }

  async function readCommitted(batchId) {
    assertBatchId(batchId);
    // Hot path: serve the committed snapshot with no queue and no disk read — no
    // file handle, so it cannot collide with the writer's atomic rename (the
    // Windows EPERM race). get() refreshes LRU recency so an actively-polled batch
    // stays warm.
    const cached = snapshots.get(batchId);
    if (cached !== undefined) return structuredClone(cached);
    // Cold path (restart / second process / evicted entry): serialize with this
    // batch's update queue so a concurrent commit cannot be clobbered. Once inside
    // the queue, re-check the snapshot — a preceding update or cold read may have
    // already populated it; only read disk + back-fill if it is still a miss.
    return enqueueBatchOperation(batchId, async () => {
      const filled = snapshots.get(batchId);
      if (filled !== undefined) return structuredClone(filled);
      const value = await readAndMigrate(batchId);
      snapshots.set(batchId, structuredClone(value));
      return structuredClone(value);
    });
  }

  async function create(batch) {
    assertBatchId(batch?.batch_id);
    // Callers cannot control the persisted schema version: only the current
    // version is accepted (or absence, which the store fills in); anything
    // else is rejected at the boundary.
    if (batch.schemaVersion !== undefined && batch.schemaVersion !== CURRENT_BATCH_SCHEMA_VERSION) {
      throw batchSchemaError("BATCH_SCHEMA_INVALID", {
        batchId: batch.batch_id,
        detectedVersion: describeDetectedVersion(batch.schemaVersion),
        message: "create() persists only the current batch schema version"
      });
    }
    await mkdir(storeRoot, { recursive: true });
    const directory = batchDirectory(batch.batch_id);
    try {
      await mkdir(directory);
    } catch (error) {
      if (error.code === "EEXIST") throw new Error(`Batch ${batch.batch_id} already exists`);
      throw error;
    }

    const now = new Date().toISOString();
    const value = {
      ...structuredClone(batch),
      created_at: batch.created_at ?? now,
      updated_at: batch.updated_at ?? now,
      artifacts: Array.isArray(batch.artifacts) ? structuredClone(batch.artifacts) : [],
      schemaVersion: CURRENT_BATCH_SCHEMA_VERSION
    };
    try {
      await atomicWriteJson(batchFile(batch.batch_id), value, { delay, renameImpl });
      snapshots.set(batch.batch_id, structuredClone(value));
      return structuredClone(value);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  function update(batchId, updater) {
    assertBatchId(batchId);
    if (typeof updater !== "function") return Promise.reject(new TypeError("updater must be a function"));
    return enqueueBatchOperation(batchId, async () => {
      // readAndMigrate migrates legacy batches first, so the updater always
      // sees — and must preserve — a current-schema document.
      const current = await readAndMigrate(batchId);
      const proposed = await updater(structuredClone(current));
      if (!proposed || typeof proposed !== "object") throw new Error("updater must return a batch object");
      if (proposed.batch_id !== batchId) throw new Error("batch_id cannot be changed");
      // Updaters may not delete, downgrade, upgrade, or retype the schema
      // version; only the store layer controls versioning.
      if (proposed.schemaVersion !== CURRENT_BATCH_SCHEMA_VERSION) {
        throw batchSchemaError("BATCH_SCHEMA_MUTATION_NOT_ALLOWED", {
          batchId,
          detectedVersion: describeDetectedVersion(proposed.schemaVersion),
          message: "updaters cannot add, remove, or change batch schemaVersion"
        });
      }
      const next = { ...structuredClone(proposed), updated_at: new Date().toISOString() };
      await atomicWriteJson(batchFile(batchId), next, { delay, renameImpl });
      snapshots.set(batchId, structuredClone(next));
      return structuredClone(next);
    });
  }

  // Startup migration: bring every existing batch to the current schema BEFORE
  // the app starts serving requests. Each batch migrates independently and
  // atomically (per-batch, no global transaction): a failing batch fails
  // startup, already-migrated batches are not rolled back. Idempotent — a
  // second run over current-schema batches performs no rewrites. Read-time
  // migration in read() remains the safety net for batches appearing later.
  async function initialize() {
    await mkdir(storeRoot, { recursive: true });
    const entries = await readdir(storeRoot, { withFileTypes: true });
    for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!BATCH_ID_PATTERN.test(entry.name)) continue;
      try {
        await enqueueBatchOperation(entry.name, () => readAndMigrate(entry.name));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }

  async function list() {
    await mkdir(storeRoot, { recursive: true });
    const entries = await readdir(storeRoot, { withFileTypes: true });
    const batches = [];
    for (const entry of entries.filter((candidate) => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!BATCH_ID_PATTERN.test(entry.name)) continue;
      try {
        batches.push(await read(entry.name));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return batches;
  }

  async function registerArtifact(batchId, artifact) {
    const keys = Object.keys(artifact ?? {}).sort();
    if (keys.length !== 2 || keys[0] !== "artifact_id" || keys[1] !== "relative_path") {
      throw new Error("Artifacts may contain only artifact_id and relative_path");
    }
    if (typeof artifact.artifact_id !== "string" || artifact.artifact_id.length === 0) {
      throw new Error("artifact_id is required");
    }
    assertRelativePath(artifact.relative_path);

    return update(batchId, (batch) => {
      const artifacts = Array.isArray(batch.artifacts) ? batch.artifacts : [];
      if (artifacts.some((item) => item.artifact_id === artifact.artifact_id)) {
        throw new Error(`Artifact ${artifact.artifact_id} already exists`);
      }
      return { ...batch, artifacts: [...artifacts, { ...artifact }] };
    });
  }

  function snapshotCacheSize() {
    return snapshots.size();
  }

  return { create, read, readCommitted, update, list, initialize, registerArtifact, snapshotCacheSize };
}
