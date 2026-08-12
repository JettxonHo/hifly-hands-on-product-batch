import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const CLOUD_EXECUTOR_PROFILE_MARKER = ".cloud-executor-profile.marker";
const PROFILE_MARKER_CONTENT = "cloud-executor-profile-v1\n";

const failure = (code) => Object.assign(new Error(code), { code });

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
