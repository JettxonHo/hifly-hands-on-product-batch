import { randomUUID } from "node:crypto";
import { constants, copyFileSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertTaskId, RPA_RENAME_MAX_ATTEMPTS, rpaRenameBackoffMs } from "./rpa-state.js";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);

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

function requireSafeDirectory(parentRealPath, directoryPath, label) {
  const existing = lstatSync(directoryPath, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink() || existing && !existing.isDirectory()) {
    throw new Error(`${label} must be a regular directory`);
  }
  if (!existing) mkdirSync(directoryPath);
  const realDirectoryPath = realpathSync(directoryPath);
  if (!contained(parentRealPath, realDirectoryPath)) {
    throw new Error(`${label} is outside batch directory`);
  }
  return realDirectoryPath;
}

function copyPersonImageIntoBatch(batchDirectory, taskId, filePath) {
  if (!filePath) return "";
  const absolute = path.resolve(filePath);
  const batchRealPath = realpathSync(batchDirectory);
  const info = lstatSync(absolute);
  if (info.isSymbolicLink()) {
    const target = realpathSync(absolute);
    if (!contained(batchRealPath, target)) throw new Error("person_image_path is outside batch directory");
    throw new Error("person_image_path must be a supported image file");
  }
  const extension = path.extname(absolute).toLowerCase();
  if (!info.isFile() || !IMAGE_EXTENSIONS.has(extension)) {
    throw new Error("person_image_path must be a supported image file");
  }

  const rpaDirectory = requireSafeDirectory(
    batchRealPath,
    path.join(path.resolve(batchDirectory), "rpa"),
    "RPA directory"
  );
  const inputRealPath = requireSafeDirectory(
    batchRealPath,
    path.join(rpaDirectory, "inputs"),
    "RPA inputs directory"
  );

  const destination = path.join(inputRealPath, `${taskId}-person-${randomUUID()}${extension}`);
  copyFileSync(absolute, destination, constants.COPYFILE_EXCL);
  const copiedRealPath = realpathSync(destination);
  if (!lstatSync(destination).isFile() || !contained(batchRealPath, copiedRealPath)) {
    throw new Error("Copied person_image_path is outside batch directory");
  }
  return destination;
}

function callbackUrl(baseUrl) {
  const url = new URL("/api/rpa/callback", baseUrl);
  if (url.protocol !== "http:") {
    throw new Error("RPA callback base URL must use http");
  }
  if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)) {
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
    person_image_path: copyPersonImageIntoBatch(batchDirectory, task.task_id, personImagePath),
    person_strategy: batch.person_strategy || "auto_pool",
    script_strategy: batch.script_strategy || "mixed",
    script: task.script || "",
    resolved_script_mode: task.resolved_script_mode || "hifly_ai",
    download_dir: path.resolve(batchDirectory),
    callback_url: callbackUrl(callbackBaseUrl),
    callback_token: randomUUID()
  };
}

function tasksDirectory(batchDirectory) {
  return path.join(batchDirectory, "rpa", "tasks");
}

// Phase 1 of the two-phase publication (CI-003 / #49): write the COMPLETE
// package JSON to a unique temp file inside the final directory. The temp
// name is dot-prefixed and .tmp-suffixed, so it can never match the RPA
// watcher's <taskId>.json pattern (task ids must start with an alphanumeric
// character): the watcher can never pick up a not-yet-published package.
export async function prepareRpaTaskPackage({ batchDirectory, taskId, packageData }) {
  assertTaskId(taskId);
  if (!packageData || packageData.task_id !== taskId) {
    throw new Error("packageData.task_id must match taskId");
  }
  const dir = tasksDirectory(batchDirectory);
  await mkdir(dir, { recursive: true });
  const tempPath = path.join(dir, `.rpa-package.${process.pid}.${randomUUID()}.tmp`);
  const finalPath = path.join(dir, `${taskId}.json`);
  try {
    await writeFile(tempPath, `${JSON.stringify(packageData, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
  return { tempPath, finalPath };
}

// Failure cleanup for a prepared-but-never-published package. Idempotent and
// best-effort: a missing temp file is not an error.
export async function removePreparedRpaTaskPackage(prepared) {
  if (!prepared?.tempPath) return;
  await rm(prepared.tempPath, { force: true }).catch(() => {});
}

// Phase 2b of the two-phase publication: atomically rename the prepared temp
// file onto the final <taskId>.json path. The atomic appearance of the final
// path IS the publication signal for the RPA watcher. Same-directory rename
// keeps it atomic on one filesystem; the capped EPERM/EBUSY retry contract is
// shared with the rpa-state atomic writer (single source of truth). On
// failure the temp file is removed and the original error propagates: the
// final package never appears as a runnable task.
export async function publishRpaTaskPackage({ tempPath, finalPath, delay, renameImpl } = {}) {
  if (!tempPath || !finalPath) {
    throw new Error("publishRpaTaskPackage requires tempPath and finalPath");
  }
  const backoff = typeof delay === "function" ? delay : (attempt) =>
    new Promise((resolve) => setTimeout(resolve, rpaRenameBackoffMs(attempt)));
  const doRename = typeof renameImpl === "function" ? renameImpl : rename;
  for (let attempt = 0; attempt < RPA_RENAME_MAX_ATTEMPTS; attempt++) {
    try {
      await doRename(tempPath, finalPath);
      return finalPath;
    } catch (error) {
      if ((error.code === "EPERM" || error.code === "EBUSY") && attempt < RPA_RENAME_MAX_ATTEMPTS - 1) {
        await backoff(attempt);
        continue;
      }
      await rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }
}

// One-shot publication for callers that do not need the prepare/state-ready/
// publish split: prepare + atomic publish. The final file only ever appears
// complete (never partially written).
export async function writeRpaTaskPackage({ batchDirectory, taskId, packageData, delay, renameImpl } = {}) {
  const prepared = await prepareRpaTaskPackage({ batchDirectory, taskId, packageData });
  try {
    return await publishRpaTaskPackage({ tempPath: prepared.tempPath, finalPath: prepared.finalPath, delay, renameImpl });
  } catch (error) {
    await removePreparedRpaTaskPackage(prepared);
    throw error;
  }
}
