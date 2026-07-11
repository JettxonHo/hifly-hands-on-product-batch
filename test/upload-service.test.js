import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { mkdtemp, mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

import { storeUpload } from "../src/server/upload-service.js";

function streamOf(value) {
  return Readable.from([Buffer.isBuffer(value) ? value : Buffer.from(value)]);
}

async function batchPaths(options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-upload-"));
  const uploadsDir = path.join(root, "uploads");
  await mkdir(uploadsDir);
  return { root, uploadsDir, ...options };
}

async function png(width = 2, height = 2) {
  return sharp({ create: { width, height, channels: 3, background: "white" } }).png().toBuffer();
}

async function rejectionCode(promise) {
  try {
    await promise;
  } catch (error) {
    return error.code;
  }
  return null;
}

test("stores a decoded image under an internal UUID name", async () => {
  const paths = await batchPaths();
  const record = await storeUpload(streamOf(await png()), {
    filename: "SKU001.png",
    declaredMime: "image/png",
  }, paths);

  assert.equal(record.logical_name, "SKU001.png");
  assert.equal(record.kind, "image");
  assert.match(record.artifact_id, /^[0-9a-f-]{36}$/);
  assert.match(record.storage_name, /^[0-9a-f-]{36}\.png$/);
  assert.equal("absolute_path" in record, false);
  assert.deepEqual(await readdir(paths.uploadsDir), [record.storage_name]);
});

test("rejects traversal and forged image content and cleans temporary files", async () => {
  const paths = await batchPaths();
  const code = await rejectionCode(storeUpload(streamOf("not png"), {
    filename: "../SKU001.png",
    declaredMime: "image/png",
  }, paths));

  assert.equal(code, "INVALID_UPLOAD_NAME");
  assert.deepEqual(await readdir(paths.uploadsDir), []);

  const forgedCode = await rejectionCode(storeUpload(streamOf("not png"), {
    filename: "SKU001.png",
    declaredMime: "image/png",
  }, paths));
  assert.equal(forgedCode, "INVALID_IMAGE_SIGNATURE");
  assert.deepEqual(await readdir(paths.uploadsDir), []);
});

test("counts bytes while streaming and aborts above the configured image limit", async () => {
  const paths = await batchPaths({ limits: { maxImageBytes: 8 } });
  const code = await rejectionCode(storeUpload(streamOf(Buffer.alloc(9)), {
    filename: "large.png",
    declaredMime: "image/png",
  }, paths));

  assert.equal(code, "UPLOAD_TOO_LARGE");
  assert.deepEqual(await readdir(paths.uploadsDir), []);
});

test("rejects decoded images above the configured pixel limit", async () => {
  const paths = await batchPaths({ limits: { maxImagePixels: 3 } });
  const code = await rejectionCode(storeUpload(streamOf(await png(2, 2)), {
    filename: "large-pixels.png",
    declaredMime: "image/png",
  }, paths));

  assert.equal(code, "IMAGE_PIXEL_LIMIT");
  assert.deepEqual(await readdir(paths.uploadsDir), []);
});

test("rejects images whose metadata is readable but pixel data is corrupt", async () => {
  const paths = await batchPaths();
  const corrupt = Buffer.from(await png(20, 20));
  const idat = corrupt.indexOf(Buffer.from("IDAT"));
  assert.notEqual(idat, -1);
  corrupt[idat + 8] ^= 0xff;

  const code = await rejectionCode(storeUpload(streamOf(corrupt), {
    filename: "corrupt.png",
    declaredMime: "image/png",
  }, paths));

  assert.equal(code, "INVALID_IMAGE");
  assert.deepEqual(await readdir(paths.uploadsDir), []);
});

test("enforces configurable batch file and byte limits", async () => {
  const paths = await batchPaths({ limits: { maxBatchFiles: 1, maxBatchBytes: 1_000 } });
  await writeFile(path.join(paths.uploadsDir, "existing.csv"), "x");
  const fileCode = await rejectionCode(storeUpload(streamOf("sku\n1\n"), {
    filename: "products.csv",
    declaredMime: "text/csv",
  }, paths));
  assert.equal(fileCode, "BATCH_FILE_LIMIT");

  const bytePaths = await batchPaths({ limits: { maxBatchFiles: 500, maxBatchBytes: 2 } });
  const byteCode = await rejectionCode(storeUpload(streamOf("sku\n"), {
    filename: "products.csv",
    declaredMime: "text/csv",
  }, bytePaths));
  assert.equal(byteCode, "BATCH_BYTE_LIMIT");
});

test("rejects directory and symlink upload metadata", async () => {
  const paths = await batchPaths();
  assert.equal(await rejectionCode(storeUpload(streamOf("x"), {
    filename: "folder.png", isDirectory: true,
  }, paths)), "DIRECTORY_UPLOAD_NOT_ALLOWED");
  assert.equal(await rejectionCode(storeUpload(streamOf("x"), {
    filename: "link.png", isSymbolicLink: true,
  }, paths)), "SYMLINK_UPLOAD_NOT_ALLOWED");
});

test("rejects a symlinked upload directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-upload-root-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "hifly-upload-outside-"));
  const uploadsDir = path.join(root, "uploads");
  await symlink(outside, uploadsDir);

  const code = await rejectionCode(storeUpload(streamOf("sku\n"), {
    filename: "products.csv",
    declaredMime: "text/csv",
  }, { root, uploadsDir }));
  assert.equal(code, "UNSAFE_UPLOAD_DIRECTORY");
  assert.deepEqual(await readdir(outside), []);
});

test("uses the 20MB table limit independently from the image limit", async () => {
  const paths = await batchPaths({ limits: { maxImageBytes: 1, maxTableBytes: 32 } });
  const record = await storeUpload(streamOf("sku,product_name\n1,A\n"), {
    filename: "products.csv",
    declaredMime: "text/csv",
  }, paths);

  assert.equal(record.kind, "table");
  assert.equal(record.extension, ".csv");
});

test("serializes concurrent uploads before enforcing batch limits", async () => {
  const paths = await batchPaths({ limits: { maxBatchFiles: 1 } });
  const results = await Promise.allSettled([
    storeUpload(streamOf("sku\n1\n"), { filename: "one.csv", declaredMime: "text/csv" }, paths),
    storeUpload(streamOf("sku\n2\n"), { filename: "two.csv", declaredMime: "text/csv" }, paths),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.code, "BATCH_FILE_LIMIT");
  assert.equal((await readdir(paths.uploadsDir)).length, 1);
});
