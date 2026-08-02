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

async function atomicWriteJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(path.dirname(filePath), `.rpa.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    // On Windows, rename can fail with EPERM/EBUSY if another handle has the
    // target file open (e.g. a concurrent reader, or antivirus / Search-indexer
    // scanning the just-written file). Retry with a capped exponential backoff.
    // Matches the widened budget in src/core/batch-store.js (RENAME_MAX_RETRIES):
    // a short fixed window does not survive a lock held for a few hundred ms.
    const maxRetries = 8;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await rename(tempPath, filePath);
        return;
      } catch (error) {
        if ((error.code === "EPERM" || error.code === "EBUSY") && attempt < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, Math.min(250, 10 * 2 ** attempt)));
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

export async function writeRpaState(batchDirectory, taskId, update) {
  const current = await readRpaState(batchDirectory, taskId);
  const next = {
    ...(current || {}),
    ...structuredClone(update),
    task_id: taskId,
    updated_at: new Date().toISOString()
  };
  await atomicWriteJson(statePath(batchDirectory, taskId), next);
  return next;
}
