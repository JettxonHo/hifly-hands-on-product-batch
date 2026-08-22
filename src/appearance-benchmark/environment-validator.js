import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  AppearanceBenchmarkError,
  BENCHMARK_LANES,
  BENCHMARK_STORAGE_ALIAS
} from "./contracts.js";

const SHA256 = /^[a-f0-9]{64}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

export async function validateBenchmarkEnvironment({
  storageAlias,
  manifestPath,
  environmentLockPath,
  lane,
  env = process.env,
  platform = os.platform(),
  architecture = normalizeArchitecture(os.arch())
}) {
  if (storageAlias !== BENCHMARK_STORAGE_ALIAS) {
    fail("BENCHMARK_STORAGE_ALIAS_INVALID", "The benchmark storage alias is not allowed");
  }
  const root = env[`${BENCHMARK_STORAGE_ALIAS}_ROOT`];
  if (!root) fail("BENCHMARK_STORAGE_ROOT_REQUIRED", "The benchmark storage root is not configured");

  const expectedLane = BENCHMARK_LANES[lane];
  if (!expectedLane) fail("BENCHMARK_LANE_INVALID", "The benchmark lane is not allowed");
  if (expectedLane.os !== platform || expectedLane.architecture !== architecture) {
    fail("BENCHMARK_LANE_MISMATCH", "The benchmark lane does not match this runtime");
  }

  const manifestFile = resolveControlledPath(root, manifestPath, "BENCHMARK_MANIFEST_PATH_INVALID");
  const manifest = await readJsonFile(manifestFile, "BENCHMARK_MANIFEST_INVALID");
  validateManifestShape(manifest);

  await validateDatasetTree(root, new Set([
    normalizeRelativePath(manifestPath),
    ...manifest.samples.flatMap((sample) => [sample.source.relative_path, sample.candidate.relative_path]
      .map(normalizeRelativePath))
  ]));

  const lock = await readJsonFile(environmentLockPath, "BENCHMARK_ENVIRONMENT_LOCK_INVALID");
  validateEnvironmentLock(lock, { storageAlias, lane, expectedLane });

  for (const sample of manifest.samples) {
    await validateImage(root, sample.source);
    await validateImage(root, sample.candidate);
  }

  return {
    status: "synthetic_contract_validated",
    storage_alias: storageAlias,
    lane,
    samples: manifest.samples.length
  };
}

function normalizeArchitecture(value) {
  return value === "x64" ? "amd64" : value;
}

async function validateDatasetTree(root, allowedFiles) {
  const resolvedRoot = path.resolve(root);
  const rootStat = await safeLstat(resolvedRoot, "BENCHMARK_STORAGE_ROOT_INVALID");
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    fail("BENCHMARK_STORAGE_ROOT_INVALID", "The benchmark storage root is not a regular directory");
  }

  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      const relative = path.relative(resolvedRoot, filename).split(path.sep).join("/");
      if (entry.isSymbolicLink()) {
        fail("BENCHMARK_DATASET_SYMLINK", "The benchmark dataset contains a symbolic link");
      }
      if (entry.isDirectory()) {
        await walk(filename);
      } else if (!entry.isFile() || !allowedFiles.has(relative)) {
        fail("BENCHMARK_DATASET_EXTRA_FILE", "The benchmark dataset contains an unregistered file");
      }
    }
  }

  await walk(resolvedRoot);
}

function validateManifestShape(manifest) {
  if (!manifest || manifest.schema_version !== 1 || !Array.isArray(manifest.samples) || manifest.samples.length === 0) {
    fail("BENCHMARK_MANIFEST_INVALID", "The benchmark manifest shape is invalid");
  }
  const ids = new Set();
  for (const sample of manifest.samples) {
    if (!sample || typeof sample.sample_id !== "string" || ids.has(sample.sample_id)) {
      fail("BENCHMARK_MANIFEST_INVALID", "The benchmark sample identity is invalid");
    }
    ids.add(sample.sample_id);
    validateImageDescriptor(sample.source);
    validateImageDescriptor(sample.candidate);
  }
}

function validateImageDescriptor(value) {
  if (!value || typeof value.relative_path !== "string" || !Number.isSafeInteger(value.bytes) || value.bytes < 1 ||
      !SHA256.test(value.sha256) || !["image/png", "image/jpeg"].includes(value.media_type) ||
      !Number.isSafeInteger(value.encoded_width) || value.encoded_width < 1 ||
      !Number.isSafeInteger(value.encoded_height) || value.encoded_height < 1) {
    fail("BENCHMARK_MANIFEST_INVALID", "A benchmark image descriptor is invalid");
  }
}

function validateEnvironmentLock(lock, { storageAlias, lane, expectedLane }) {
  const selected = lock?.lanes?.[lane];
  if (lock?.schema_version !== 1 || lock?.validation_mode !== "synthetic_contract_only" ||
      lock?.storage_alias !== storageAlias || !selected ||
      selected.os !== expectedLane.os || selected.architecture !== expectedLane.architecture ||
      selected.python !== "3.11.16" || !SHA256.test(selected.dependency_lock_sha256)) {
    fail("BENCHMARK_ENVIRONMENT_LOCK_INVALID", "The benchmark environment lock is invalid");
  }
  if (lane === "linux-amd64-canonical" && !DIGEST.test(selected.oci_manifest_digest || "")) {
    fail("BENCHMARK_ENVIRONMENT_LOCK_INVALID", "The canonical OCI manifest digest is invalid");
  }
}

async function validateImage(root, descriptor) {
  const filename = resolveControlledPath(root, descriptor.relative_path, "BENCHMARK_IMAGE_PATH_INVALID");
  const stat = await safeLstat(filename, "BENCHMARK_IMAGE_UNAVAILABLE");
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail("BENCHMARK_IMAGE_UNAVAILABLE", "A benchmark image is not a regular file");
  }
  const bytes = await readFile(filename);
  if (bytes.length !== descriptor.bytes || sha256(bytes) !== descriptor.sha256) {
    fail("BENCHMARK_IMAGE_IDENTITY_MISMATCH", "A benchmark image identity does not match the manifest");
  }
  const observed = imageIdentity(bytes);
  if (observed.media_type !== descriptor.media_type || observed.encoded_width !== descriptor.encoded_width ||
      observed.encoded_height !== descriptor.encoded_height) {
    fail("BENCHMARK_IMAGE_IDENTITY_MISMATCH", "A benchmark image media identity does not match the manifest");
  }
}

function imageIdentity(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return {
      media_type: "image/png",
      encoded_width: bytes.readUInt32BE(16),
      encoded_height: bytes.readUInt32BE(20)
    };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        return {
          media_type: "image/jpeg",
          encoded_height: bytes.readUInt16BE(offset + 5),
          encoded_width: bytes.readUInt16BE(offset + 7)
        };
      }
      if (marker === 0xd9 || marker === 0xda) break;
      const segmentLength = bytes.readUInt16BE(offset + 2);
      if (segmentLength < 2) break;
      offset += 2 + segmentLength;
    }
  }
  fail("BENCHMARK_IMAGE_MEDIA_UNSUPPORTED", "A benchmark image has unsupported media bytes");
}

function resolveControlledPath(root, relativePath, code) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) {
    fail(code, "A benchmark path must be controlled and relative");
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (resolved === resolvedRoot || !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    fail(code, "A benchmark path escapes the controlled root");
  }
  return resolved;
}

function normalizeRelativePath(value) {
  if (typeof value !== "string" || path.isAbsolute(value)) {
    fail("BENCHMARK_MANIFEST_PATH_INVALID", "A benchmark path must be controlled and relative");
  }
  return value.split("\\").join("/");
}

async function readJsonFile(filename, code) {
  try {
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink()) fail(code, "A benchmark JSON input is not a regular file");
    return JSON.parse(await readFile(filename, "utf8"));
  } catch (error) {
    if (error instanceof AppearanceBenchmarkError) throw error;
    fail(code, "A benchmark JSON input is unavailable or invalid");
  }
}

async function safeLstat(filename, code) {
  try {
    return await lstat(filename);
  } catch {
    fail(code, "A benchmark input is unavailable");
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fail(code, message) {
  throw new AppearanceBenchmarkError(code, message);
}
