import { readRpaState, writeRpaState } from "./rpa-state.js";

const ORDER = new Map([
  ["generating_asset", 1],
  ["asset_confirmed", 2],
  ["submitted", 3],
  ["download_pending", 4],
  ["completed", 5],
  ["failed_pre_submit", 90],
  ["failed_remote", 91],
  ["interrupted_unknown", 92]
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

export async function applyRpaCallback({ batchDirectory, currentTask, callback, token, requestIp }) {
  if (!isLocalhost(requestIp)) throw invalidCallback("RPA callback must come from localhost");
  const state = await readRpaState(batchDirectory, callback?.task_id);
  if (!state || state.callback_token !== token) throw invalidCallback("Invalid RPA callback token");
  if (callback.execution_key !== currentTask.execution_key) throw invalidCallback("RPA callback execution_key mismatch");
  if (callback.task_id !== currentTask.task_id) throw invalidCallback("RPA callback task_id mismatch");
  if (!ORDER.has(callback.status)) throw invalidCallback(`Invalid RPA callback status: ${callback.status}`);

  if (state.last_callback && sameJson(state.last_callback, callback)) {
    return { accepted: true, duplicate: true, state };
  }

  const currentRank = ORDER.get(state.status || currentTask.status) || 0;
  const nextRank = ORDER.get(callback.status);
  if (nextRank < currentRank) {
    const nextState = await writeRpaState(batchDirectory, currentTask.task_id, {
      ignored_callback: callback,
      ignored_reason: "status_regression"
    });
    return { accepted: false, ignored: true, state: nextState };
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
