import { readRpaState, writeRpaState } from "./rpa-state.js";
import path from "node:path";

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

function assertSafeArtifact(batchDirectory, artifact) {
  if (artifact === undefined || artifact === null) return;
  const relativePath = artifact?.relative_path;
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    path.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    relativePath.split(/[\\/]+/).some((segment) => segment === "" || segment === "..") ||
    !isInside(path.resolve(batchDirectory), path.resolve(batchDirectory, relativePath))
  ) {
    throw invalidCallback("RPA callback artifact must use a safe batch-relative path");
  }
}

export async function applyRpaCallback({ batchDirectory, currentTask, callback, token, requestIp }) {
  if (!isLocalhost(requestIp)) throw invalidCallback("RPA callback must come from localhost");
  const state = await readRpaState(batchDirectory, callback?.task_id);
  if (!state || state.callback_token !== token) throw invalidCallback("Invalid RPA callback token");
  if (callback.execution_key !== currentTask.execution_key) throw invalidCallback("RPA callback execution_key mismatch");
  if (callback.task_id !== currentTask.task_id) throw invalidCallback("RPA callback task_id mismatch");
  if (!CALLBACK_STATUSES.has(callback.status)) throw invalidCallback(`Invalid RPA callback status: ${callback.status}`);
  assertSafeArtifact(batchDirectory, callback.artifact);

  if (state.last_callback && sameJson(state.last_callback, callback)) {
    return { accepted: true, duplicate: true, state };
  }

  const currentStatus = state.status || currentTask.status;
  if (!ALLOWED_TRANSITIONS.get(currentStatus)?.has(callback.status)) {
    return { accepted: false, ignored: true, state };
  }

  const nextState = await writeRpaState(batchDirectory, currentTask.task_id, {
    status: callback.status,
    phase: callback.phase || null,
    remote_evidence: callback.remote_evidence || state.remote_evidence || null,
    artifact: callback.artifact || state.artifact || null,
    error: callback.error || null,
    last_callback: callback
  });
  return { accepted: true, duplicate: false, state: nextState };
}
