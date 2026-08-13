import { inflateRaw } from "node:zlib";
import { promisify } from "node:util";
import { ZipArchive } from "archiver";

const inflate = promisify(inflateRaw);

export const MANUAL_HANDOFF_PACKAGE_CONTENT_TYPE = "application/zip";

export function createMemoryManualHandoffPackageStore() {
  const objects = new Map();
  return {
    async initialize() {},
    async close() {},
    async put({ key, body, contentType, metadata = {} }) {
      objects.set(key, { body: Buffer.from(body), contentType, metadata: { ...metadata } });
    },
    async get(key) {
      const value = objects.get(key);
      return value ? Buffer.from(value.body) : null;
    },
    async head(key) {
      const value = objects.get(key);
      return value ? { size: value.body.length, contentType: value.contentType, metadata: { ...value.metadata } } : null;
    },
    async remove(key) { objects.delete(key); }
  };
}

export async function buildManualHandoffZip(entries) {
  const archive = new ZipArchive({ zlib: { level: 9 } });
  const chunks = [];
  const output = new Promise((resolve, reject) => {
    archive.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    archive.on("error", reject);
    archive.on("end", () => resolve(Buffer.concat(chunks)));
  });
  for (const entry of entries) archive.append(Buffer.isBuffer(entry.body) ? entry.body : Buffer.from(String(entry.body)), { name: entry.name });
  await archive.finalize();
  return output;
}

function findEndOfCentralDirectory(buffer) {
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 0xffff - 22); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("invalid zip archive");
}

/**
 * Small inspection helper used by package tests. It intentionally supports
 * the ZIP methods emitted by buildManualHandoffZip (stored and deflated).
 */
export async function extractManualHandoffArchive(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError("archive buffer is required");
  const eocd = findEndOfCentralDirectory(buffer);
  const count = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);
  if (centralOffset + centralSize > buffer.length) throw new Error("invalid zip central directory");
  const result = {};
  let cursor = centralOffset;
  for (let index = 0; index < count; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("invalid zip central entry");
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("invalid zip local entry");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const compressed = buffer.subarray(localOffset + 30 + localNameLength + localExtraLength, localOffset + 30 + localNameLength + localExtraLength + compressedSize);
    const body = method === 0 ? Buffer.from(compressed) : method === 8 ? await inflate(compressed) : (() => { throw new Error("unsupported zip method"); })();
    result[name] = name === "README.md" || name === "manifest.json" ? body.toString("utf8") : body;
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return result;
}
