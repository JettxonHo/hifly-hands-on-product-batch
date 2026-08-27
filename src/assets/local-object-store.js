import { link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const putLocks = new Map();

async function withObjectLock(root, key, operation) {
  const namespace = path.resolve(root);
  let locks = putLocks.get(namespace);
  if (!locks) {
    locks = new Map();
    putLocks.set(namespace, locks);
  }
  const previous = locks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  locks.set(key, current);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
    if (locks.size === 0) putLocks.delete(namespace);
  }
}

function alreadyExists(key) {
  return Object.assign(new Error(`EEXIST: object already exists: ${key}`), { code: "EEXIST" });
}

export function createLocalObjectStore({ root }) {
  if (!root) throw new TypeError("local object store root is required");
  const location = (key) => path.join(root, ...key.split("/"));
  const metadataLocation = (key) => `${location(key)}.metadata.json`;
  const committedMetadataLocation = (key) => `${location(key)}.metadata.v2.json`;
  const readMetadataFile = async (target, source) => {
    try {
      const raw = await readFile(target, "utf8");
      let values;
      try { values = JSON.parse(raw); }
      catch { return { status: "invalid", source }; }
      if (!values || typeof values !== "object" || typeof values.contentType !== "string" || !values.contentType) {
        return { status: "invalid", source };
      }
      return { status: "valid", source, values };
    } catch (error) {
      if (error.code === "ENOENT") return { status: "missing", source };
      if (error.code === "EISDIR") return { status: "invalid", source };
      throw error;
    }
  };
  const metadataState = async (key) => {
    const committed = await readMetadataFile(committedMetadataLocation(key), "committed");
    if (committed.status !== "missing") return committed;
    return readMetadataFile(metadataLocation(key), "legacy");
  };
  const head = async (key) => {
    try {
      const details = await stat(location(key));
      const state = await metadataState(key);
      if (state.status !== "valid") return null;
      return { size: details.size, contentType: state.values.contentType, metadata: state.values };
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  };
  return {
    async initialize() { await mkdir(root, { recursive: true }); },
    async put({ key, body, contentType, metadata: values }) {
      return withObjectLock(root, key, async () => {
        const serialized = JSON.stringify({ contentType, ...values });
        const target = location(key);
        const metadataTarget = committedMetadataLocation(key);
        await mkdir(path.dirname(target), { recursive: true });
        let existingBody = null;
        try { existingBody = await readFile(target); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
        const existingMetadata = await metadataState(key);
        if (existingMetadata.status === "valid" || existingMetadata.source === "committed") throw alreadyExists(key);
        if (existingBody !== null && !Buffer.from(body).equals(existingBody)) throw alreadyExists(key);
        if (existingBody === null && existingMetadata.status === "invalid") throw alreadyExists(key);
        let bodyWritten = false;
        if (existingBody === null) {
          await writeFile(target, body, { flag: "wx", mode: 0o600 });
          bodyWritten = true;
        }
        const metadataTemp = `${metadataTarget}.${process.pid}.${randomUUID()}.tmp`;
        try {
          await writeFile(metadataTemp, serialized, { flag: "wx", mode: 0o600 });
          await link(metadataTemp, metadataTarget);
          await rm(metadataTemp, { force: true });
        } catch (error) {
          await rm(metadataTemp, { force: true }).catch(() => undefined);
          if (bodyWritten && error.code !== "EEXIST") {
            const latestMetadata = await metadataState(key);
            if (latestMetadata.status !== "valid") await rm(target, { force: true });
          }
          throw error;
        }
      });
    },
    async head(key) { return withObjectLock(root, key, () => head(key)); },
    async get(key) {
      return withObjectLock(root, key, async () => {
        if (!await head(key)) return null;
        try { return await readFile(location(key)); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
      });
    },
    async remove(key) {
      return withObjectLock(root, key, async () => {
        await Promise.all([
          rm(location(key), { force: true }),
          rm(metadataLocation(key), { force: true }),
          rm(committedMetadataLocation(key), { force: true })
        ]);
      });
    }
  };
}

export function createReadFallbackObjectStore({ primary, fallback }) {
  if (!primary || !fallback) throw new TypeError("primary and fallback object stores are required");
  return {
    async initialize() { await primary.initialize?.(); },
    async put(input) { return primary.put(input); },
    async head(key) {
      const result = await primary.head(key);
      return result ?? fallback.head(key);
    },
    async get(key) {
      const result = await primary.get(key);
      return result ?? fallback.get(key);
    },
    async remove(key) { return primary.remove(key); },
    async close() { await primary.close?.(); }
  };
}
