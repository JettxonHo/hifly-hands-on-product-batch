import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  RPA_RENAME_MAX_ATTEMPTS,
  rpaRenameBackoffMs,
  rpaWorstCaseRenameBackoffMs,
  readRpaState,
  writeRpaState
} from "../src/rpa/rpa-state.js";

// Drives the Windows EPERM/EBUSY rename retry deterministically: the injected
// renameImpl fails with the requested error code for the first failCount
// attempts, then delegates to the real rename. delay resolves instantly so the
// test never spends real time in backoff (same pattern as batch-store tests).
async function withFailingRenameRpaState(code, failCount, run) {
  const batchDirectory = await mkdtemp(path.join(os.tmpdir(), "hifly-rpa-state-retry-"));
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
  const options = { delay: () => Promise.resolve(), renameImpl };
  try {
    return await run(batchDirectory, () => calls, options);
  } finally {
    await rm(batchDirectory, { recursive: true, force: true });
  }
}

async function leftoverTempFiles(batchDirectory) {
  const stateDirectory = path.join(batchDirectory, "rpa", "state");
  const files = await readdir(stateDirectory).catch(() => []);
  return files.filter((name) => name.startsWith(".rpa.") && name.endsWith(".tmp"));
}

test("writeRpaState retries a rename that fails EPERM for the first N attempts then succeeds (CI-003)", async () => {
  await withFailingRenameRpaState("EPERM", 3, async (batchDirectory, calls, options) => {
    await writeRpaState(batchDirectory, "task-1", { status: "generating_asset" }, options);
    assert.equal(calls(), 4, "3 injected EPERM failures + 1 real rename");
    assert.equal((await readRpaState(batchDirectory, "task-1")).status, "generating_asset");
    assert.deepEqual(await leftoverTempFiles(batchDirectory), [], "temp file must be moved into place");
  });
});

test("writeRpaState retries a rename that fails EBUSY for the first N attempts then succeeds (CI-003)", async () => {
  await withFailingRenameRpaState("EBUSY", 2, async (batchDirectory, calls, options) => {
    await writeRpaState(batchDirectory, "task-1", { status: "asset_confirmed" }, options);
    assert.equal(calls(), 3, "2 injected EBUSY failures + 1 real rename");
    assert.equal((await readRpaState(batchDirectory, "task-1")).status, "asset_confirmed");
    assert.deepEqual(await leftoverTempFiles(batchDirectory), []);
  });
});

test("writeRpaState rethrows the original error past the retry budget and cleans the temp file (CI-003)", async () => {
  await withFailingRenameRpaState("EPERM", 99, async (batchDirectory, calls, options) => {
    await assert.rejects(
      writeRpaState(batchDirectory, "task-1", { status: "generating_asset" }, options),
      (error) => {
        assert.equal(error.code, "EPERM", "the original rename error is rethrown");
        return true;
      }
    );
    assert.equal(calls(), RPA_RENAME_MAX_ATTEMPTS, "exactly the retry budget was attempted");
    assert.deepEqual(await leftoverTempFiles(batchDirectory), [], "failed write cleans the temp file");
  });
});

test("a non-retryable rename error fails immediately without retrying (CI-003)", async () => {
  await withFailingRenameRpaState("EACCES", 99, async (batchDirectory, calls, options) => {
    await assert.rejects(
      writeRpaState(batchDirectory, "task-1", { status: "generating_asset" }, options),
      (error) => error.code === "EACCES"
    );
    assert.equal(calls(), 1, "EACCES is not retried");
  });
});

test("the rename retry contract is exported as a single source of truth and exceeds the pre-CI-003 500ms test budget (CI-003)", () => {
  assert.equal(RPA_RENAME_MAX_ATTEMPTS, 8);
  assert.deepEqual(
    [0, 1, 2, 3, 4, 5, 6].map(rpaRenameBackoffMs),
    [10, 20, 40, 80, 160, 250, 250],
    "capped exponential backoff schedule"
  );
  const worstCaseMs = rpaWorstCaseRenameBackoffMs();
  assert.equal(worstCaseMs, 810, "10+20+40+80+160+250+250");
  // CI-003 root contract clash, pinned arithmetically: the flaky Windows test
  // gave the executor a 500ms asset budget, smaller than the legal retry
  // window of the very state write the handshake performs. Any deadline
  // wrapped around an RPA state write must be at least this wide.
  assert.ok(worstCaseMs > 500, "the legal retry window exceeds the old hard-coded 500ms test budget");
});
