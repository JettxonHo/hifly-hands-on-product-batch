import { randomUUID } from "node:crypto";
import {
  lstat, open, readdir, realpath, rename, stat, unlink,
} from "node:fs/promises";
import path from "node:path";
import { fileTypeFromFile } from "file-type";
import sharp from "sharp";

const DEFAULT_LIMITS = {
  maxImageBytes: 10 * 1024 * 1024,
  maxTableBytes: 20 * 1024 * 1024,
  maxBatchFiles: 500,
  maxBatchBytes: 1024 * 1024 * 1024,
  maxImagePixels: 40_000_000,
};

const TYPES = {
  ".jpg": { kind: "image", signatures: ["jpg"], mimes: ["image/jpeg"] },
  ".jpeg": { kind: "image", signatures: ["jpg"], mimes: ["image/jpeg"] },
  ".png": { kind: "image", signatures: ["png"], mimes: ["image/png"] },
  ".csv": { kind: "table", signatures: [], mimes: ["text/csv", "application/csv", "text/plain"] },
  ".xlsx": {
    kind: "table",
    signatures: ["xlsx"],
    mimes: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  },
};
const uploadQueues = new Map();

function uploadError(code) {
  return Object.assign(new Error(code), { code });
}

function isContained(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function validateMetadata(metadata) {
  if (metadata?.isDirectory) throw uploadError("DIRECTORY_UPLOAD_NOT_ALLOWED");
  if (metadata?.isSymbolicLink) throw uploadError("SYMLINK_UPLOAD_NOT_ALLOWED");
  const filename = String(metadata?.filename ?? "").normalize("NFC");
  if (
    !filename
    || filename === "."
    || filename === ".."
    || path.isAbsolute(filename)
    || path.win32.isAbsolute(filename)
    || filename.includes("/")
    || filename.includes("\\")
    || /[\0-\x1f\x7f]/.test(filename)
  ) {
    throw uploadError("INVALID_UPLOAD_NAME");
  }
  const extension = path.extname(filename).toLowerCase();
  const type = TYPES[extension];
  if (!type) throw uploadError("UNSUPPORTED_UPLOAD_TYPE");
  if (metadata?.declaredMime && !type.mimes.includes(String(metadata.declaredMime).toLowerCase())) {
    throw uploadError("DECLARED_MIME_MISMATCH");
  }
  return { filename, extension, type };
}

async function validateDirectories(batchPaths) {
  const root = path.resolve(batchPaths?.root ?? "");
  const uploadsDir = path.resolve(batchPaths?.uploadsDir ?? "");
  if (!batchPaths?.root || !batchPaths?.uploadsDir) throw uploadError("INVALID_BATCH_PATHS");
  const [rootInfo, uploadInfo] = await Promise.all([lstat(root), lstat(uploadsDir)]);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || !uploadInfo.isDirectory() || uploadInfo.isSymbolicLink()) {
    throw uploadError("UNSAFE_UPLOAD_DIRECTORY");
  }
  const [realRoot, realUploads] = await Promise.all([realpath(root), realpath(uploadsDir)]);
  if (!isContained(realRoot, realUploads) || realRoot === realUploads) {
    throw uploadError("UNSAFE_UPLOAD_DIRECTORY");
  }
  return { root: realRoot, uploadsDir: realUploads };
}

async function currentUsage(uploadsDir) {
  const names = await readdir(uploadsDir);
  let files = 0;
  let bytes = 0;
  for (const name of names) {
    const info = await lstat(path.join(uploadsDir, name));
    if (info.isSymbolicLink()) throw uploadError("UNSAFE_UPLOAD_DIRECTORY");
    if (info.isFile() && !name.endsWith(".uploading")) {
      files += 1;
      bytes += info.size;
    }
  }
  return { files, bytes };
}

async function writeStream(stream, temporaryPath, maxFileBytes, existingBytes, maxBatchBytes) {
  const handle = await open(temporaryPath, "wx", 0o600);
  let bytes = 0;
  try {
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxFileBytes) throw uploadError("UPLOAD_TOO_LARGE");
      if (existingBytes + bytes > maxBatchBytes) throw uploadError("BATCH_BYTE_LIMIT");
      await handle.write(buffer);
    }
  } finally {
    await handle.close();
  }
  return bytes;
}

async function validateImage(filePath, expected, limits) {
  const detected = await fileTypeFromFile(filePath);
  if (!detected || !expected.signatures.includes(detected.ext)) {
    throw uploadError("INVALID_IMAGE_SIGNATURE");
  }
  let metadata;
  try {
    metadata = await sharp(filePath, { failOn: "error", limitInputPixels: false }).metadata();
  } catch {
    throw uploadError("INVALID_IMAGE");
  }
  if (!metadata.width || !metadata.height) throw uploadError("INVALID_IMAGE");
  const pages = Math.max(1, metadata.pages || 1);
  const pixels = metadata.width * metadata.height * pages;
  if (!Number.isSafeInteger(pixels) || pixels > limits.maxImagePixels) {
    throw uploadError("IMAGE_PIXEL_LIMIT");
  }
  try {
    await sharp(filePath, {
      failOn: "error",
      limitInputPixels: limits.maxImagePixels,
    }).stats();
  } catch {
    throw uploadError("INVALID_IMAGE");
  }
}

async function validateTable(filePath, extension, expected) {
  if (extension === ".csv") {
    const data = await import("node:fs/promises").then(({ readFile }) => readFile(filePath));
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(data);
      if (text.includes("\0")) throw new Error("NUL");
    } catch {
      throw uploadError("INVALID_CSV_ENCODING");
    }
    return;
  }
  const detected = await fileTypeFromFile(filePath);
  if (!detected || !expected.signatures.includes(detected.ext)) {
    throw uploadError("INVALID_TABLE_SIGNATURE");
  }
}

async function storeUploadImpl(stream, metadata, batchPaths) {
  if (!stream || typeof stream[Symbol.asyncIterator] !== "function") {
    throw uploadError("INVALID_UPLOAD_STREAM");
  }
  const { filename, extension, type } = validateMetadata(metadata);
  const directories = await validateDirectories(batchPaths);
  const limits = { ...DEFAULT_LIMITS, ...(batchPaths.limits || {}) };
  const usage = await currentUsage(directories.uploadsDir);
  if (usage.files >= limits.maxBatchFiles) throw uploadError("BATCH_FILE_LIMIT");

  const artifactId = randomUUID();
  const temporaryPath = path.join(directories.uploadsDir, `${artifactId}.uploading`);
  const storageName = `${artifactId}${extension}`;
  const finalPath = path.join(directories.uploadsDir, storageName);
  const maxFileBytes = type.kind === "image" ? limits.maxImageBytes : limits.maxTableBytes;
  let bytes;
  try {
    bytes = await writeStream(stream, temporaryPath, maxFileBytes, usage.bytes, limits.maxBatchBytes);
    if (type.kind === "image") await validateImage(temporaryPath, type, limits);
    else await validateTable(temporaryPath, extension, type);
    try {
      await stat(finalPath);
      throw uploadError("INTERNAL_NAME_COLLISION");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await rename(temporaryPath, finalPath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => {});
    throw error;
  }

  return {
    artifact_id: artifactId,
    logical_name: filename,
    storage_name: storageName,
    extension,
    kind: type.kind,
    size: bytes,
  };
}

export async function storeUpload(stream, metadata, batchPaths) {
  const queueKey = path.resolve(batchPaths?.uploadsDir ?? "");
  const previous = uploadQueues.get(queueKey) || Promise.resolve();
  const current = previous.catch(() => {}).then(() => storeUploadImpl(stream, metadata, batchPaths));
  uploadQueues.set(queueKey, current);
  try {
    return await current;
  } finally {
    if (uploadQueues.get(queueKey) === current) uploadQueues.delete(queueKey);
  }
}
