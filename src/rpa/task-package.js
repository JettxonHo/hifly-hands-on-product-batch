import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertTaskId } from "./rpa-state.js";

function contained(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function requireInsideBatch(batchDirectory, filePath, label) {
  if (!filePath) return "";
  const absolute = path.resolve(filePath);
  const batchAbsolutePath = path.resolve(batchDirectory);
  const batchRealPath = realpathSync(batchDirectory);
  if (!contained(batchAbsolutePath, absolute)) {
    throw new Error(`${label} is outside batch directory`);
  }
  const realPath = realpathSync(absolute);
  if (!lstatSync(realPath).isFile() || !contained(batchRealPath, realPath)) {
    throw new Error(`${label} is outside batch directory`);
  }
  return absolute;
}

function callbackUrl(baseUrl) {
  const url = new URL("/api/rpa/callback", baseUrl);
  if (url.protocol !== "http:") {
    throw new Error("RPA callback base URL must use http");
  }
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost" && url.hostname !== "::1") {
    throw new Error("RPA callback base URL must be localhost");
  }
  return url.toString();
}

export function createRpaTaskPackage({ batch, task, batchDirectory, callbackBaseUrl }) {
  assertTaskId(task.task_id);
  const productImagePath = requireInsideBatch(batchDirectory, task.image_path, "product_image_path");
  const personImagePath = task.__resolved_person_image_path || task.resolved_person_image_path || task.person_image_path || "";
  return {
    schema_version: 1,
    batch_id: batch.batch_id,
    task_id: task.task_id,
    execution_key: task.execution_key,
    sku: task.sku || "",
    product_name: task.product_name || "",
    selling_points: task.selling_points || "",
    category: task.category || "",
    product_image_path: productImagePath,
    person_image_path: personImagePath ? requireInsideBatch(batchDirectory, personImagePath, "person_image_path") : "",
    person_strategy: batch.person_strategy || "auto_pool",
    script_strategy: batch.script_strategy || "mixed",
    script: task.script || "",
    resolved_script_mode: task.resolved_script_mode || "hifly_ai",
    download_dir: path.resolve(batchDirectory),
    callback_url: callbackUrl(callbackBaseUrl),
    callback_token: randomUUID()
  };
}

export async function writeRpaTaskPackage({ batchDirectory, taskId, packageData }) {
  assertTaskId(taskId);
  if (!packageData || packageData.task_id !== taskId) {
    throw new Error("packageData.task_id must match taskId");
  }
  const dir = path.join(batchDirectory, "rpa", "tasks");
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${taskId}.json`);
  await writeFile(filePath, `${JSON.stringify(packageData, null, 2)}\n`, "utf8");
  return filePath;
}
