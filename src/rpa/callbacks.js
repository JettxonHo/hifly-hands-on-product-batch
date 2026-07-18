import { readRpaState, writeRpaState } from "./rpa-state.js";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import {
  isRpaCallbackTokenActive,
  revokeRpaCallbackToken
} from "./callback-token-registry.js";

const CALLBACK_STATUSES = new Set([
  "asset_confirmed",
  "submitted",
  "download_pending",
  "completed",
  "failed_pre_submit",
  "failed_remote",
  "interrupted_unknown"
]);

const ALLOWED_TRANSITIONS = new Map([
  ["generating_asset", new Set(["asset_confirmed", "failed_pre_submit", "failed_remote", "interrupted_unknown"])],
  ["asset_confirmed", new Set(["submitted", "failed_remote", "interrupted_unknown"])],
  ["submitted", new Set(["download_pending", "completed", "failed_remote", "interrupted_unknown"])],
  ["download_pending", new Set(["completed", "failed_remote", "interrupted_unknown"])],
  ["completed", new Set()],
  ["failed_pre_submit", new Set()],
  ["failed_remote", new Set()],
  ["interrupted_unknown", new Set()]
]);

const TERMINAL_STATUSES = new Set([
  "completed",
  "failed_pre_submit",
  "failed_remote",
  "interrupted_unknown"
]);

function invalidCallback(message) {
  return Object.assign(new Error(message), { code: "INVALID_RPA_CALLBACK", statusCode: 400 });
}

function isLocalhost(ip) {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip);
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

async function assertSafeArtifact(batchDirectory, artifact, required) {
  if (artifact === undefined || artifact === null) {
    if (required) throw invalidCallback("RPA completed callback requires a valid existing artifact");
    return;
  }
  const relativePath = artifact?.relative_path;
  const artifactKeys = Object.keys(artifact ?? {}).sort();
  if (
    artifactKeys.length !== 2 ||
    artifactKeys[0] !== "artifact_id" ||
    artifactKeys[1] !== "relative_path" ||
    typeof artifact?.artifact_id !== "string" ||
    artifact.artifact_id.length === 0 ||
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]+/).some((segment) => segment === "" || segment === "..") ||
    !isInside(path.resolve(batchDirectory), path.resolve(batchDirectory, relativePath))
  ) {
    throw invalidCallback(required
      ? "RPA completed callback requires a valid existing artifact"
      : "RPA callback artifact must use a safe batch-relative path");
  }

  try {
    const batchPath = path.resolve(batchDirectory);
    const artifactPath = path.resolve(batchPath, relativePath);
    const [batchRealPath, artifactRealPath, info] = await Promise.all([
      realpath(batchPath),
      realpath(artifactPath),
      lstat(artifactPath)
    ]);
    if (info.isSymbolicLink() || !info.isFile() || !isInside(batchRealPath, artifactRealPath)) {
      throw new Error("unsafe artifact");
    }
  } catch {
    throw invalidCallback(required
      ? "RPA completed callback requires a valid existing artifact"
      : "RPA callback artifact must reference an existing regular file");
  }
}

export async function applyRpaCallback({ batchDirectory, currentTask, callback, token, requestIp }) {
  if (!isLocalhost(requestIp)) throw invalidCallback("RPA callback must come from localhost");
  const state = await readRpaState(batchDirectory, callback?.task_id);
  if (!state || state.callback_token !== token) throw invalidCallback("Invalid RPA callback token");
  if (callback.execution_key !== currentTask.execution_key) throw invalidCallback("RPA callback execution_key mismatch");
  if (callback.task_id !== currentTask.task_id) throw invalidCallback("RPA callback task_id mismatch");
  if (!CALLBACK_STATUSES.has(callback.status)) throw invalidCallback(`Invalid RPA callback status: ${callback.status}`);
  if (!isRpaCallbackTokenActive({
    batchDirectory,
    taskId: currentTask.task_id,
    executionKey: currentTask.execution_key,
    token
  })) {
    throw invalidCallback("No active RPA callback session for this token");
  }
  if (state.last_callback && sameJson(state.last_callback, callback)) {
    return { accepted: true, duplicate: true, state };
  }

  const currentStatus = state.status || currentTask.status;
  if (!ALLOWED_TRANSITIONS.get(currentStatus)?.has(callback.status)) {
    return { accepted: false, ignored: true, state };
  }
  await assertSafeArtifact(batchDirectory, callback.artifact, callback.status === "completed");

  const nextState = await writeRpaState(batchDirectory, currentTask.task_id, {
    status: callback.status,
    phase: callback.phase || null,
    remote_evidence: callback.remote_evidence || state.remote_evidence || null,
    artifact: callback.artifact || state.artifact || null,
    error: callback.error || null,
    last_callback: callback
  });
  if (TERMINAL_STATUSES.has(callback.status)) {
    revokeRpaCallbackToken({
      batchDirectory,
      taskId: currentTask.task_id,
      executionKey: currentTask.execution_key
    });
  }
  return { accepted: true, duplicate: false, state: nextState };
}
