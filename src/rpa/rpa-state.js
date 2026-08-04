import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export function assertTaskId(taskId) {
  if (typeof taskId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(taskId)) {
    throw new Error("Invalid RPA task id");
  }
}

function statePath(batchDirectory, taskId) {
  assertTaskId(taskId);
  return path.join(batchDirectory, "rpa", "state", `${taskId}.json`);
}

// Retry budget for the Windows EPERM/EBUSY rename hardening (CI-003 / #49).
// Exported so tests and any deadline that wraps an RPA state write derive from
// a single source of truth instead of hard-coding numbers that drift from the
// implementation. Matches src/core/batch-store.js (RENAME_MAX_RETRIES).
export const RPA_RENAME_MAX_ATTEMPTS = 8;

// Capped exponential backoff applied before each rename retry.
export function rpaRenameBackoffMs(attempt) {
  return Math.min(250, 10 * 2 ** attempt);
}

// Worst-case total backoff for a single atomic state write: the sum of the
// backoffs before attempts 1..RPA_RENAME_MAX_ATTEMPTS-1 (the final attempt
// has no backoff after it). With the defaults above: 10+20+40+80+160+250+250
// = 810ms. Any deadline budgeted around an RPA state write — notably the
// asset_confirmed handshake observed by createYingdaoRpaExecutor — must allow
// at least this window, or a legitimate transient Windows file lock produces
// a spurious timeout (the CI-003 failure mode).
export function rpaWorstCaseRenameBackoffMs() {
  let total = 0;
  for (let attempt = 0; attempt < RPA_RENAME_MAX_ATTEMPTS - 1; attempt += 1) {
    total += rpaRenameBackoffMs(attempt);
  }
  return total;
}

async function atomicWriteJson(filePath, value, { delay, renameImpl } = {}) {
  // Backoff and the rename implementation are injectable so tests can drive
  // the Windows EPERM/EBUSY retry deterministically (no real-time sleep in
  // the test). Production defaults are unchanged: real rename + setTimeout.
  const backoff = typeof delay === "function" ? delay : (attempt) =>
    new Promise((resolve) => setTimeout(resolve, rpaRenameBackoffMs(attempt)));
  const doRename = typeof renameImpl === "function" ? renameImpl : rename;
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.rpa.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    // On Windows, rename can fail with EPERM/EBUSY if another handle has the
    // target file open (e.g. a concurrent reader, or antivirus / Search-indexer
    // scanning the just-written file). Retry with a capped exponential backoff.
    // Matches the widened budget in src/core/batch-store.js (RENAME_MAX_RETRIES):
    // a short fixed window does not survive a lock held for a few hundred ms.
    for (let attempt = 0; attempt < RPA_RENAME_MAX_ATTEMPTS; attempt++) {
      try {
        await doRename(tempPath, filePath);
        return;
      } catch (error) {
        if ((error.code === "EPERM" || error.code === "EBUSY") && attempt < RPA_RENAME_MAX_ATTEMPTS - 1) {
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

export async function readRpaState(batchDirectory, taskId) {
  try {
    return JSON.parse(await readFile(statePath(batchDirectory, taskId), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeRpaState(batchDirectory, taskId, update, options = {}) {
  const current = await readRpaState(batchDirectory, taskId);
  const next = {
    ...(current || {}),
    ...structuredClone(update),
    task_id: taskId,
    updated_at: new Date().toISOString()
  };
  await atomicWriteJson(statePath(batchDirectory, taskId), next, options);
  return next;
}
