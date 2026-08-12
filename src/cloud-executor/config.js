import path from "node:path";

const MODES = new Set(["fail_closed", "fake", "playwright"]);
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
  const workspace = {
    root: workspaceRoot,
    profileDir,
    assetsDir: path.resolve(root, env.CLOUD_EXECUTOR_ASSETS_DIR || path.join(workspaceRoot, "assets")),
    outputsDir: path.resolve(root, env.CLOUD_EXECUTOR_OUTPUTS_DIR || path.join(workspaceRoot, "outputs")),
    evidenceDir: path.resolve(root, env.CLOUD_EXECUTOR_EVIDENCE_DIR || path.join(workspaceRoot, "evidence"))
  };
  const configured = enabled && ["fake", "playwright"].includes(mode) && Boolean(executorCloudId && organizationId && workspace.root && workspace.profileDir);
  return {
    enabled,
    configured,
    mode,
    executorType: "cloud_executor",
    organizationId,
    executorCloudId,
    workspace,
    avatarMappingPath,
    profileDir,
    storageRoot: workspaceRoot,
    worker: {
      pollIntervalMs: duration(env.CLOUD_EXECUTOR_POLL_INTERVAL_MS, "CLOUD_EXECUTOR_POLL_INTERVAL_MS", 1_000),
      leaseMs: duration(env.CLOUD_EXECUTOR_LEASE_MS, "CLOUD_EXECUTOR_LEASE_MS", 30_000),
      heartbeatIntervalMs: duration(env.CLOUD_EXECUTOR_HEARTBEAT_INTERVAL_MS, "CLOUD_EXECUTOR_HEARTBEAT_INTERVAL_MS", 5_000)
    }
  };
}
