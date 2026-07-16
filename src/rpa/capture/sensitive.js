const EXACT = new Set([
  "cookie",
  "set_cookie",
  "authorization",
  "proxy_authorization",
  "csrf_token",
  "x_csrf_token",
  "x_xsrf_token",
  "password",
  "passwd",
  "api_key",
  "x_api_key",
  "credential",
  "credentials",
  "client_secret",
  "private_key",
  "access_key",
  "x_access_key"
]);

const SUBSTRING = [
  "token", "session", "auth", "ticket", "sign", "secret",
  "password", "passwd", "credential", "api_key", "apikey",
  "private_key", "privatekey", "access_key", "accesskey", "clientkey"
];

export const SENSITIVE_KEY_PATTERNS = Object.freeze([...EXACT, ...SUBSTRING]);

function normalizeKey(name) {
  return name
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

export function isSensitiveKey(name) {
  if (typeof name !== "string" || name.length === 0) return false;
  const normalized = normalizeKey(name);
  const compact = normalized.replaceAll("_", "");
  if (EXACT.has(normalized) || EXACT.has(compact)) return true;
  return SUBSTRING.some((needle) => normalized.includes(needle) || compact.includes(needle.replaceAll("_", "")));
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
