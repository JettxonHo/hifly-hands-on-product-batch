import path from "node:path";
import { mkdir, open, readFile, unlink } from "node:fs/promises";

const DEFAULT_HEARTBEAT_MS = 5_000;
const DEFAULT_SUSPICIOUS_MS = 30_000;
const acquiredHandles = new WeakMap();

export class ExecutionLockError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ExecutionLockError";
    this.code = details.code ?? "EXECUTION_LOCK_ERROR";
    this.suspicious = details.suspicious ?? false;
    this.owner = details.owner ?? null;
  }
}

async function readMetadata(lockPath) {
  return JSON.parse(await readFile(lockPath, "utf8"));
}

function owns(metadata, identity) {
  return metadata?.instanceId === identity.instanceId &&
    metadata?.batchId === identity.batchId &&
    metadata?.pid === identity.pid;
}

function isSuspicious(metadata, now, thresholdMs) {
  const heartbeat = Date.parse(metadata?.heartbeatAt);
  return !Number.isFinite(heartbeat) || now - heartbeat > thresholdMs;
}

function hasFreshHeartbeat(metadata, thresholdMs) {
  const heartbeat = Date.parse(metadata?.heartbeatAt);
  return Number.isFinite(heartbeat) && Date.now() - heartbeat <= thresholdMs;
}

export async function assertExecutionLockOwnership(handle, { batchId } = {}) {
  const acquisition = acquiredHandles.get(handle);
  if (!acquisition) {
    throw new Error("A genuine acquired lock is required");
  }
  const { identity, inspect, heartbeat, suspiciousAfterMs } = acquisition;
  if (identity.batchId !== batchId) {
    throw new Error("Lock ownership does not match this batch");
  }

  try {
    const inspected = await inspect();
    if (!owns(inspected, identity) || !hasFreshHeartbeat(inspected, suspiciousAfterMs)) {
      throw new Error("Lock ownership is no longer live");
    }
    const heartbeated = await heartbeat();
    if (!owns(heartbeated, identity)) throw new Error("Lock heartbeat lost ownership");
    const current = await inspect();
    if (!owns(current, identity) || !hasFreshHeartbeat(current, suspiciousAfterMs)) {
      throw new Error("Lock ownership changed during verification");
    }
    return current;
  } catch (error) {
    throw new Error(`A genuine acquired live lock is required: ${error.message}`);
  }
}

export async function acquireExecutionLock({
  root,
  batchId,
  instanceId,
  heartbeatIntervalMs = DEFAULT_HEARTBEAT_MS,
  suspiciousAfterMs = DEFAULT_SUSPICIOUS_MS,
  now = () => Date.now()
}) {
  if (typeof root !== "string" || root.length === 0) throw new TypeError("root is required");
  if (typeof batchId !== "string" || batchId.length === 0) throw new TypeError("batchId is required");
  if (typeof instanceId !== "string" || instanceId.length === 0) throw new TypeError("instanceId is required");
  if (!(heartbeatIntervalMs > 0) || !(suspiciousAfterMs > heartbeatIntervalMs)) {
    throw new RangeError("Lock timing requires a positive heartbeat and a larger suspicious threshold");
  }

  await mkdir(root, { recursive: true });
  const lockPath = path.join(path.resolve(root), "execution.lock");
  let fileHandle;
  try {
    fileHandle = await open(lockPath, "wx", 0o600);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let owner = null;
    try {
      owner = await readMetadata(lockPath);
    } catch {
      // A concurrently-created or damaged lock still blocks execution.
    }
    throw new ExecutionLockError("Execution is already locked", {
      code: "EXECUTION_LOCKED",
      owner,
      suspicious: isSuspicious(owner, now(), suspiciousAfterMs)
    });
  }

  const identity = { instanceId, batchId, pid: process.pid };
  const timestamp = new Date(now()).toISOString();
  let metadata = { ...identity, createdAt: timestamp, heartbeatAt: timestamp };
  try {
    await fileHandle.writeFile(`${JSON.stringify(metadata)}\n`, "utf8");
    await fileHandle.sync();
  } catch (error) {
    await fileHandle.close().catch(() => {});
    await unlink(lockPath).catch(() => {});
    throw error;
  }
  await fileHandle.close();

  let released = false;
  let timer;

  async function inspect() {
    return readMetadata(lockPath);
  }

  async function heartbeat() {
    if (released) throw new ExecutionLockError("Cannot heartbeat a released lock");
    const handle = await open(lockPath, "r+");
    try {
      const current = JSON.parse(await handle.readFile("utf8"));
      if (!owns(current, identity)) {
        throw new ExecutionLockError("Lock identity changed; heartbeat refused", { code: "LOCK_IDENTITY_MISMATCH" });
      }
      metadata = { ...current, heartbeatAt: new Date(now()).toISOString() };
      const serialized = `${JSON.stringify(metadata)}\n`;
      await handle.truncate(0);
      await handle.write(serialized, 0, "utf8");
      await handle.sync();
      return { ...metadata };
    } finally {
      await handle.close();
    }
  }

  function stopHeartbeat() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }

  async function release() {
    if (released) return;
    stopHeartbeat();
    const current = await inspect();
    if (!owns(current, identity)) {
      throw new ExecutionLockError("Lock identity changed; release refused", { code: "LOCK_IDENTITY_MISMATCH" });
    }
    await unlink(lockPath);
    released = true;
  }

  timer = setInterval(() => {
    heartbeat().catch(() => stopHeartbeat());
  }, heartbeatIntervalMs);
  timer.unref?.();

  const lock = Object.freeze({
    lockPath,
    metadata: Object.freeze({ ...metadata }),
    inspect,
    heartbeat,
    stopHeartbeat,
    release
  });
  acquiredHandles.set(lock, Object.freeze({
    identity: Object.freeze({ ...identity }),
    inspect,
    heartbeat,
    suspiciousAfterMs
  }));
  return lock;
}

export const EXECUTION_LOCK_DEFAULTS = Object.freeze({
  heartbeatIntervalMs: DEFAULT_HEARTBEAT_MS,
  suspiciousAfterMs: DEFAULT_SUSPICIOUS_MS
});
