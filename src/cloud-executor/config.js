import path from "node:path";

import { DEFAULT_CLOUD_EXECUTOR_MIN_FREE_BYTES } from "./workspace.js";

const MODES = new Set(["fail_closed", "fake", "playwright", "login"]);
const DEFAULT_ROOT = "/var/lib/hifly/cloud-executor";

function boolean(value, name, fallback = false) {
  if (value === undefined || value === "") return fallback;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  throw Object.assign(new Error(`${name}_INVALID`), { code: `${name}_INVALID` });
}

function duration(value, name, fallback) {
  const selected = Number(value || fallback);
  if (!Number.isSafeInteger(selected) || selected < 1_000 || selected > 30 * 60 * 1_000) {
    throw Object.assign(new Error(`${name}_INVALID`), { code: `${name}_INVALID` });
  }
  return selected;
}

function port(value, name, fallback) {
  const selected = Number(value || fallback);
  if (!Number.isSafeInteger(selected) || selected < 1 || selected > 65_535) {
    throw Object.assign(new Error(`${name}_INVALID`), { code: `${name}_INVALID` });
  }
  return selected;
}

function bytes(value, name, fallback) {
  const selected = Number(value === undefined || value === "" ? fallback : value);
  if (!Number.isSafeInteger(selected) || selected < 0) {
    throw Object.assign(new Error(`${name}_INVALID`), { code: `${name}_INVALID` });
  }
  return selected;
}

function privateBindHost(value) {
  const selected = value?.trim() || "127.0.0.1";
  const loopback = selected === "localhost" || selected === "127.0.0.1" || selected === "::1";
  const octets = selected.split(".").map((octet) => Number(octet));
  const validIpv4 = octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255);
  const privateIpv4 = validIpv4 && (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
  if (!loopback && !privateIpv4) {
    throw Object.assign(new Error("CLOUD_EXECUTOR_NOVNC_BIND_HOST_PUBLIC"), {
      code: "CLOUD_EXECUTOR_NOVNC_BIND_HOST_PUBLIC"
    });
  }
  return selected;
}

export function createCloudExecutorConfig({ root = process.cwd(), env = process.env } = {}) {
  const enabled = boolean(env.CLOUD_EXECUTOR_ENABLED, "CLOUD_EXECUTOR_ENABLED", false);
  const mode = env.CLOUD_EXECUTOR_MODE?.trim() || "fail_closed";
  if (!MODES.has(mode)) throw Object.assign(new Error("CLOUD_EXECUTOR_MODE_UNSUPPORTED"), { code: "CLOUD_EXECUTOR_MODE_UNSUPPORTED" });
  const executorCloudId = env.CLOUD_EXECUTOR_ID?.trim() || null;
  const organizationId = env.CLOUD_EXECUTOR_ORGANIZATION_ID?.trim() || null;
  const storageRoot = path.resolve(root, env.CLOUD_EXECUTOR_ROOT || DEFAULT_ROOT);
  const profileDir = path.resolve(root, env.CLOUD_EXECUTOR_PROFILE_DIR || path.join(storageRoot, "profile"));
  const workspaceRoot = path.resolve(root, env.CLOUD_EXECUTOR_WORKSPACE_ROOT || storageRoot);
  const avatarMappingPath = env.CLOUD_EXECUTOR_AVATAR_MAPPING_FILE?.trim()
    ? path.resolve(root, env.CLOUD_EXECUTOR_AVATAR_MAPPING_FILE.trim())
    : null;
  const hiflyConfigPath = path.resolve(root, env.CLOUD_EXECUTOR_HIFLY_CONFIG_PATH || env.LOCAL_AGENT_HIFLY_CONFIG_PATH || "config.local.json");
  const display = env.CLOUD_EXECUTOR_DISPLAY?.trim() || ":99";
  const minFreeBytes = bytes(env.CLOUD_EXECUTOR_MIN_FREE_BYTES, "CLOUD_EXECUTOR_MIN_FREE_BYTES", DEFAULT_CLOUD_EXECUTOR_MIN_FREE_BYTES);
  const heartbeatUrl = env.CLOUD_EXECUTOR_HEARTBEAT_URL?.trim() || null;
  const heartbeatToken = env.CLOUD_EXECUTOR_HEARTBEAT_TOKEN?.trim() || null;
  const standbyHeartbeatEnabled = boolean(
    env.CLOUD_EXECUTOR_STANDBY_HEARTBEAT_ENABLED,
    "CLOUD_EXECUTOR_STANDBY_HEARTBEAT_ENABLED",
    false
  );
  const heartbeatTimeoutMs = duration(env.CLOUD_EXECUTOR_HEARTBEAT_TIMEOUT_MS, "CLOUD_EXECUTOR_HEARTBEAT_TIMEOUT_MS", 15_000);
  const handoffDir = path.resolve(root, env.CLOUD_EXECUTOR_HANDOFF_DIR || "/var/lib/hifly/manual-handoff-packages");
  const healthHost = privateBindHost(env.CLOUD_EXECUTOR_HEALTH_HOST);
  const healthPort = port(env.CLOUD_EXECUTOR_HEALTH_PORT, "CLOUD_EXECUTOR_HEALTH_PORT", 3001);
  const databaseUrl = env.DATABASE_URL?.trim() || null;
  const databasePoolMax = Number(env.CLOUD_EXECUTOR_DATABASE_POOL_MAX || env.DATABASE_POOL_MAX || 3);
  if (!Number.isSafeInteger(databasePoolMax) || databasePoolMax < 1 || databasePoolMax > 16) {
    throw Object.assign(new Error("CLOUD_EXECUTOR_DATABASE_POOL_MAX_INVALID"), { code: "CLOUD_EXECUTOR_DATABASE_POOL_MAX_INVALID" });
  }
  const databaseSsl = boolean(env.DATABASE_SSL, "DATABASE_SSL", false);
  const concurrency = Number(env.CLOUD_EXECUTOR_CONCURRENCY || 1);
  if (concurrency !== 1) throw Object.assign(new Error("CLOUD_EXECUTOR_CONCURRENCY_INVALID"), { code: "CLOUD_EXECUTOR_CONCURRENCY_INVALID" });
  const workspace = {
    root: workspaceRoot,
    profileDir,
    assetsDir: path.resolve(root, env.CLOUD_EXECUTOR_ASSETS_DIR || path.join(workspaceRoot, "assets")),
    outputsDir: path.resolve(root, env.CLOUD_EXECUTOR_OUTPUTS_DIR || path.join(workspaceRoot, "outputs")),
    evidenceDir: path.resolve(root, env.CLOUD_EXECUTOR_EVIDENCE_DIR || path.join(workspaceRoot, "evidence"))
  };
  const configured = enabled && (
    mode === "login"
      ? Boolean(workspace.root && workspace.profileDir)
      : ["fake", "playwright"].includes(mode) && Boolean(executorCloudId && organizationId && workspace.root && workspace.profileDir)
  );
  if (standbyHeartbeatEnabled && (!heartbeatUrl || !heartbeatToken || !executorCloudId || !organizationId)) {
    throw Object.assign(new Error("CLOUD_EXECUTOR_STANDBY_HEARTBEAT_CONFIG_REQUIRED"), {
      code: "CLOUD_EXECUTOR_STANDBY_HEARTBEAT_CONFIG_REQUIRED"
    });
  }
  const activeHeartbeatEnabled = enabled && configured && ["fake", "playwright"].includes(mode);
  return {
    enabled,
    configured,
    mode,
    executorType: "cloud_executor",
    organizationId,
    executorCloudId,
    workspace,
    avatarMappingPath,
    hiflyConfigPath,
    profileDir,
    storageRoot: workspaceRoot,
    storage: { root: workspaceRoot, minFreeBytes },
    display,
    xvfb: { enabled: true, display },
    noVnc: {
      bindHost: privateBindHost(env.CLOUD_EXECUTOR_NOVNC_BIND_HOST),
      port: port(env.CLOUD_EXECUTOR_NOVNC_PORT, "CLOUD_EXECUTOR_NOVNC_PORT", 6080),
      access: "private",
      public: false
    },
    databaseUrl,
    databasePoolMax,
    databaseSsl,
    handoffDir,
    heartbeat: {
      enabled: Boolean(heartbeatUrl && heartbeatToken) && (activeHeartbeatEnabled || standbyHeartbeatEnabled),
      standbyEnabled: standbyHeartbeatEnabled,
      url: heartbeatUrl,
      token: heartbeatToken,
      timeoutMs: heartbeatTimeoutMs
    },
    health: { host: healthHost, port: healthPort },
    worker: {
      pollIntervalMs: duration(env.CLOUD_EXECUTOR_POLL_INTERVAL_MS, "CLOUD_EXECUTOR_POLL_INTERVAL_MS", 1_000),
      leaseMs: duration(env.CLOUD_EXECUTOR_LEASE_MS, "CLOUD_EXECUTOR_LEASE_MS", 30_000),
      heartbeatIntervalMs: duration(env.CLOUD_EXECUTOR_HEARTBEAT_INTERVAL_MS, "CLOUD_EXECUTOR_HEARTBEAT_INTERVAL_MS", 5_000),
      concurrency
    }
  };
}
