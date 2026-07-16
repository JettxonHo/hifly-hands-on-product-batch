import { isSensitiveKey } from "./sensitive.js";

function queryKey(part) {
  const encoded = part.split("=", 1)[0].replace(/\+/g, " ");
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

function stripUrl(url) {
  if (typeof url !== "string") return url;
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return url;
  const base = url.slice(0, queryStart);
  const queryAndHash = url.slice(queryStart + 1);
  const hashStart = queryAndHash.indexOf("#");
  const query = hashStart === -1 ? queryAndHash : queryAndHash.slice(0, hashStart);
  const hash = hashStart === -1 ? "" : queryAndHash.slice(hashStart);
  // Keep the raw query text so {{placeholders}} survive the redaction pass.
  const retained = query.split("&").filter((part) => !isSensitiveKey(queryKey(part)));
  return retained.length > 0 && retained.some(Boolean) ? `${base}?${retained.join("&")}${hash}` : `${base}${hash}`;
}

function removeSensitiveHeaders(headers, basePath, removed) {
  if (!headers || typeof headers !== "object") return null;
  const next = {};
  for (const [key, value] of Object.entries(headers)) {
    if (isSensitiveKey(key)) removed.push(`${basePath}.${key}`);
    else next[key] = value;
  }
  return next;
}

function removeSensitiveBody(node, basePath, removed) {
  if (Array.isArray(node)) return node.map((entry, i) => removeSensitiveBody(entry, `${basePath}[${i}]`, removed));
  if (node && typeof node === "object") {
    const next = {};
    for (const [key, value] of Object.entries(node)) {
      const childPath = `${basePath}.${key}`;
      if (isSensitiveKey(key)) {
        removed.push(childPath);
      } else {
        next[key] = removeSensitiveBody(value, childPath, removed);
      }
    }
    return next;
  }
  return node;
}

export function redactCaptureSource({ source = "", captured_at = null, steps = [] } = {}) {
  const report = { removed: [] };
  const sanitizedSteps = steps.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`steps[${index}] must be an object`);
    // Response headers are never kept in the sanitized manifest, but we still scan
    // them so the report records any sensitive header that was present.
    removeSensitiveHeaders(raw.response?.headers, `steps[${index}].response.headers`, report.removed);
    const request = raw.request_template || raw.request || {};
    const requestHeaders = removeSensitiveHeaders(request.headers, `steps[${index}].request.headers`, report.removed);
    const requestBody = request.body === undefined
      ? undefined
      : removeSensitiveBody(request.body, `steps[${index}].request.body`, report.removed);
    const step = {
      id: raw.id,
      phase: raw.phase,
      method: raw.method,
      url_template: stripUrl(raw.url_template),
      placeholders: Array.isArray(raw.placeholders) ? [...raw.placeholders] : [],
      response: {
        status: raw.response?.status,
        body: removeSensitiveBody(raw.response?.body, `steps[${index}].response.body`, report.removed)
      },
      produces: raw.produces && typeof raw.produces === "object" ? { ...raw.produces } : {}
    };
    if (requestHeaders && Object.keys(requestHeaders).length > 0 || requestBody !== undefined) {
      step.request_template = {
        ...(requestHeaders && Object.keys(requestHeaders).length > 0 ? { headers: requestHeaders } : {}),
        ...(requestBody !== undefined ? { body: requestBody } : {})
      };
    }
    if (raw.risk && typeof raw.risk === "object") step.risk = { ...raw.risk };
    return step;
  });

  return {
    sanitized: {
      schema_version: 1,
      source,
      captured_at,
      sanitized: true,
      steps: sanitizedSteps
    },
    report
  };
}
