import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export function createLocalObjectStore({ root }) {
  if (!root) throw new TypeError("local object store root is required");
  const location = (key) => path.join(root, ...key.split("/"));
  const metadataLocation = (key) => `${location(key)}.metadata.json`;
  return {
    async initialize() { await mkdir(root, { recursive: true }); },
    async put({ key, body, contentType, metadata: values }) {
      const target = location(key);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, body, { flag: "wx", mode: 0o600 });
      await writeFile(metadataLocation(key), JSON.stringify({ contentType, ...values }), { flag: "wx", mode: 0o600 });
    },
    async head(key) {
      try {
        const details = await stat(location(key));
        const values = JSON.parse(await readFile(metadataLocation(key), "utf8"));
        return { size: details.size, contentType: values.contentType, metadata: values };
      } catch (error) {
        if (error.code === "ENOENT") return null;
        throw error;
      }
    },
    async get(key) {
      try { return await readFile(location(key)); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
    },
    async remove(key) { await Promise.all([rm(location(key), { force: true }), rm(metadataLocation(key), { force: true })]); }
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
