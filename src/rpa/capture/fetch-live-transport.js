function fail(code, message) {
  throw Object.assign(new Error(message || code), { code });
}

function parseContentDispositionFilename(value) {
  if (typeof value !== "string") return null;
  const star = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) return decodeURIComponent(star[1].trim());
  const quoted = value.match(/filename="([^"]+)"/i);
  if (quoted) return quoted[1].trim();
  const plain = value.match(/filename=([^;]+)/i);
  return plain ? plain[1].trim() : null;
}

function isJsonContentType(value) {
  return typeof value === "string" && /(?:^|;|\s)application\/json(?:;|\s|$)/i.test(value);
}

function looksLikeJson(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function isArtifactContentType(value) {
  if (typeof value !== "string") return false;
  return /^video\//i.test(value) ||
    /(?:^|;|\s)application\/octet-stream(?:;|\s|$)/i.test(value);
}

function findHeaderValue(headers, wantedKey) {
  return Object.entries(headers || {}).find(([key]) => key.toLowerCase() === wantedKey)?.[1];
}

function requestBody(body, headers) {
  if (body == null) return undefined;
  if (typeof body === "string" || body instanceof Uint8Array || body instanceof ArrayBuffer) return body;
  const contentType = findHeaderValue(headers, "content-type");
  if (isJsonContentType(contentType) || typeof body === "object") return JSON.stringify(body);
  return body;
}

function headersObject(headers) {
  return Object.fromEntries(headers.entries());
}

async function readLimitedBytes(response, maxBytes) {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    fail("CAPTURE_HTTP_ARTIFACT_TOO_LARGE", "Downloaded artifact exceeds the configured limit.");
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      fail("CAPTURE_HTTP_ARTIFACT_TOO_LARGE", "Downloaded artifact exceeds the configured limit.");
    }
    return bytes;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > maxBytes) {
        fail("CAPTURE_HTTP_ARTIFACT_TOO_LARGE", "Downloaded artifact exceeds the configured limit.");
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock?.();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function createFetchLiveTransport({
  fetchImpl = globalThis.fetch,
  allowedProtocols = ["https:"],
  maxBytes = 200 * 1024 * 1024
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetch live transport requires fetchImpl");
  const protocols = new Set(allowedProtocols);
  return {
    async request({ method, url, headers = {}, body = null, timeoutMs = 30000 }) {
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
        fail("CAPTURE_HTTP_TRANSPORT_URL_REJECTED", "Live transport URL is invalid.");
      }
      if (!protocols.has(parsed.protocol)) {
        fail("CAPTURE_HTTP_TRANSPORT_URL_REJECTED", "Live transport only accepts HTTPS URLs.");
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(parsed.href, {
          method,
          headers,
          body: requestBody(body, headers),
          signal: controller.signal
        });
        const responseHeaders = headersObject(response.headers);
        const contentType = response.headers.get("content-type") || "";
        if (isJsonContentType(contentType)) {
          const parsedBody = await response.json();
          return { status: response.status, headers: responseHeaders, body: parsedBody };
        }

        if (/^text\/plain\b/i.test(contentType)) {
          const text = await response.text();
          if (looksLikeJson(text)) {
            try {
              return { status: response.status, headers: responseHeaders, body: JSON.parse(text) };
            } catch {
              fail("CAPTURE_HTTP_UNEXPECTED_CONTENT_TYPE", "Live HTTP text response is not valid JSON.");
            }
          }
        }

        if (!isArtifactContentType(contentType)) {
          fail("CAPTURE_HTTP_UNEXPECTED_CONTENT_TYPE", "Live HTTP response is not JSON or an allowed artifact type.");
        }
        const bytes = await readLimitedBytes(response, maxBytes);
        const filename = parseContentDispositionFilename(response.headers.get("content-disposition"));
        return {
          status: response.status,
          headers: responseHeaders,
          body: { artifact_filename: filename },
          artifact: { bytes, filename }
        };
      } catch (error) {
        if (error?.code) throw error;
        fail("CAPTURE_HTTP_TRANSPORT_FAILED", "Live HTTP request failed.");
      } finally {
        clearTimeout(timer);
      }
    }
  };
}
