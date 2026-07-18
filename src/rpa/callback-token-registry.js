import path from "node:path";

const activeTokens = new Map();

function scopeKey({ batchDirectory, taskId, executionKey }) {
  return `${path.resolve(batchDirectory)}\0${taskId}\0${executionKey}`;
}

export function registerRpaCallbackToken(scope) {
  if (typeof scope?.token !== "string" || scope.token.length === 0) {
    throw new TypeError("RPA callback token is required");
  }
  activeTokens.set(scopeKey(scope), scope.token);
}

export function isRpaCallbackTokenActive(scope) {
  return activeTokens.get(scopeKey(scope)) === scope.token;
}

export function revokeRpaCallbackToken(scope) {
  activeTokens.delete(scopeKey(scope));
}

export function clearRpaCallbackTokens() {
  activeTokens.clear();
}
