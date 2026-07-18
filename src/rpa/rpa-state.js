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
    await rename(tempPath, filePath);
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
