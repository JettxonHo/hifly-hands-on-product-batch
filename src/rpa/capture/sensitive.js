const EXACT = new Set([
  "cookie",
  "set-cookie",
  "authorization",
  "proxy-authorization",
  "csrf-token",
  "x-csrf-token",
  "x-xsrf-token",
  "password",
  "passwd",
  "api_key",
  "api-key",
  "x-api-key",
  "credential",
  "credentials",
  "client_secret",
  "client-secret",
  "private_key",
  "private-key",
  "access_key",
  "access-key",
  "x-access-key"
]);

const SUBSTRING = [
  "token", "session", "auth", "ticket", "sign", "secret",
  "password", "passwd", "credential", "api_key", "api-key", "apikey",
  "private_key", "private-key", "access_key", "access-key"
];

export const SENSITIVE_KEY_PATTERNS = Object.freeze([...EXACT, ...SUBSTRING]);

export function isSensitiveKey(name) {
  if (typeof name !== "string" || name.length === 0) return false;
  const lower = name.toLowerCase();
  if (EXACT.has(lower)) return true;
  return SUBSTRING.some((needle) => lower.includes(needle));
}

export function findSensitiveKeys(value, basePath = "") {
  const hits = [];
  walk(value, basePath);
  return hits;

  function walk(node, currentPath) {
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${currentPath}[${index}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        const childPath = currentPath ? `${currentPath}.${key}` : key;
        if (isSensitiveKey(key)) hits.push(childPath);
        walk(child, childPath);
      }
    }
  }
}
