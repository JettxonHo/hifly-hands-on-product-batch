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

async function atomicWriteJson(filePath, value) {
  const tempPath = path.join(path.dirname(filePath), `.batch.json.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

export function createBatchStore(root) {
  const storeRoot = path.resolve(root);
  const updateQueues = new Map();

  const batchDirectory = (batchId) => {
    assertBatchId(batchId);
    return path.join(storeRoot, batchId);
  };
  const batchFile = (batchId) => path.join(batchDirectory(batchId), "batch.json");

  async function read(batchId) {
    return JSON.parse(await readFile(batchFile(batchId), "utf8"));
  }

  async function create(batch) {
    assertBatchId(batch?.batch_id);
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
      artifacts: Array.isArray(batch.artifacts) ? structuredClone(batch.artifacts) : []
    };
    try {
      await atomicWriteJson(batchFile(batch.batch_id), value);
      return structuredClone(value);
    } catch (error) {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }

  function update(batchId, updater) {
    assertBatchId(batchId);
    if (typeof updater !== "function") return Promise.reject(new TypeError("updater must be a function"));

    const previous = updateQueues.get(batchId) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      const current = await read(batchId);
      const proposed = await updater(structuredClone(current));
      if (!proposed || typeof proposed !== "object") throw new Error("updater must return a batch object");
      if (proposed.batch_id !== batchId) throw new Error("batch_id cannot be changed");
      const next = { ...structuredClone(proposed), updated_at: new Date().toISOString() };
      await atomicWriteJson(batchFile(batchId), next);
      return structuredClone(next);
    });
    updateQueues.set(batchId, operation);
    operation.finally(() => {
      if (updateQueues.get(batchId) === operation) updateQueues.delete(batchId);
    }).catch(() => {});
    return operation;
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

  return { create, read, update, list, registerArtifact };
}
