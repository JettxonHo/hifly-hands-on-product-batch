import { mkdir, readFile, statfs as readStatfs, writeFile } from "node:fs/promises";
import path from "node:path";

export const CLOUD_EXECUTOR_PROFILE_MARKER = ".cloud-executor-profile.marker";
export const DEFAULT_CLOUD_EXECUTOR_MIN_FREE_BYTES = 1024 * 1024 * 1024;
const PROFILE_MARKER_CONTENT = "cloud-executor-profile-v1\n";

const failure = (code) => Object.assign(new Error(code), { code });

const clean = (value) => typeof value === "string" ? value.trim() : "";

function requiredAbsolute(value, name) {
  const selected = clean(value);
  if (!selected || !path.isAbsolute(selected)) throw new TypeError(`${name} must be an absolute path`);
  return path.resolve(selected);
}

export function createCloudWorkspaceConfig(workspace = {}) {
  if (!workspace || typeof workspace !== "object" || Array.isArray(workspace)) {
    throw new TypeError("cloud workspace is required");
  }
  const root = requiredAbsolute(workspace.root || workspace.workspaceRoot, "workspace.root");
  const profileDir = requiredAbsolute(workspace.profileDir, "workspace.profileDir");
  const assetsDir = requiredAbsolute(workspace.assetsDir || path.join(root, "assets"), "workspace.assetsDir");
  const outputsDir = requiredAbsolute(workspace.outputsDir || workspace.downloadDir || path.join(root, "outputs"), "workspace.outputsDir");
  const evidenceDir = requiredAbsolute(workspace.evidenceDir || path.join(root, "evidence"), "workspace.evidenceDir");
  const batchDir = requiredAbsolute(workspace.batchDir || path.join(root, "batches"), "workspace.batchDir");
  const lockDir = requiredAbsolute(workspace.lockDir || path.join(root, "locks"), "workspace.lockDir");
  return Object.freeze({ root, profileDir, assetsDir, outputsDir, evidenceDir, batchDir, lockDir,
    profileMarkerPath: path.join(profileDir, CLOUD_EXECUTOR_PROFILE_MARKER) });
}

function safeByteCount(value) {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function availableBytes(stats) {
  const direct = safeByteCount(stats?.availableBytes);
  if (direct !== null) return direct;
  const blocks = safeByteCount(stats?.bavail ?? stats?.blocksAvailable);
  const blockSize = safeByteCount(stats?.bsize ?? stats?.blockSize);
  if (blocks === null || blockSize === null || blocks > Math.floor(Number.MAX_SAFE_INTEGER / Math.max(blockSize, 1))) return null;
  return blocks * blockSize;
}

export async function checkCloudExecutorStorage({ root, minFreeBytes = DEFAULT_CLOUD_EXECUTOR_MIN_FREE_BYTES,
  statfsImpl = readStatfs, statfs = null } = {}) {
  const target = clean(root);
  const readCapacity = typeof statfs === "function" ? statfs : statfsImpl;
  if (!target || !Number.isSafeInteger(minFreeBytes) || minFreeBytes < 0 || typeof readCapacity !== "function") {
    return { ready: false, status: "storage_blocked" };
  }
  try {
    const freeBytes = availableBytes(await readCapacity(path.resolve(target)));
    if (freeBytes === null) return { ready: false, status: "storage_blocked" };
    return { ready: freeBytes >= minFreeBytes, status: freeBytes >= minFreeBytes ? "available" : "storage_blocked" };
  } catch {
    return { ready: false, status: "storage_blocked" };
  }
}

export function createCloudExecutorStorageReadiness({ workspace = null, root = workspace?.root,
  minFreeBytes = DEFAULT_CLOUD_EXECUTOR_MIN_FREE_BYTES, statfsImpl = readStatfs, statfs = null } = {}) {
  const targets = workspace ? [root, workspace.assetsDir, workspace.outputsDir, workspace.evidenceDir,
    workspace.batchDir, workspace.lockDir] : [root];
  return {
    async check() {
      const states = await Promise.all(targets.map((target) => checkCloudExecutorStorage({
        root: target, minFreeBytes, statfsImpl, statfs
      })));
      return states.every((state) => state.ready)
        ? { ready: true, status: "available" }
        : { ready: false, status: "storage_blocked" };
    }
  };
}

export function cloudExecutorProfileMarkerPath(profileDir) {
  return path.join(profileDir, CLOUD_EXECUTOR_PROFILE_MARKER);
}

export async function ensureCloudExecutorWorkspace(workspace) {
  const profileMarkerPath = workspace.profileMarkerPath || cloudExecutorProfileMarkerPath(workspace.profileDir);
  await Promise.all([
    mkdir(workspace.root, { recursive: true, mode: 0o700 }),
    mkdir(workspace.profileDir, { recursive: true, mode: 0o700 }),
    mkdir(workspace.assetsDir, { recursive: true, mode: 0o700 }),
    mkdir(workspace.outputsDir, { recursive: true, mode: 0o700 }),
    mkdir(workspace.evidenceDir, { recursive: true, mode: 0o700 }),
    mkdir(workspace.batchDir, { recursive: true, mode: 0o700 }),
    mkdir(workspace.lockDir, { recursive: true, mode: 0o700 })
  ]);

  try {
    const marker = await readFile(profileMarkerPath, "utf8");
    if (marker !== PROFILE_MARKER_CONTENT) throw failure("CLOUD_EXECUTOR_PROFILE_MARKER_INVALID");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    await writeFile(profileMarkerPath, PROFILE_MARKER_CONTENT, { encoding: "utf8", flag: "wx", mode: 0o600 });
  }

  return Object.freeze({ ...workspace, profileMarkerPath });
}
