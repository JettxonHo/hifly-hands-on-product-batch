const DEFAULT_TIMEOUT_MS = 30_000;

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function timeout(value) {
  const selected = value ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(selected) || selected < 1_000 || selected > 120_000) {
    throw failure("LLM_HTTP_TIMEOUT_INVALID");
  }
  return selected;
}

function httpsUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw failure("LLM_HTTP_URL_INVALID");
  }
  if (parsed.protocol !== "https:") throw failure("LLM_HTTP_URL_INVALID");
  return parsed.href;
}

export function createFetchTransport({ fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  const defaultTimeoutMs = timeout(timeoutMs);

  return {
    async request({ url, method = "GET", headers = {}, body, timeoutMs: requestTimeoutMs } = {}) {
      const selectedTimeoutMs = timeout(requestTimeoutMs ?? defaultTimeoutMs);
      const requestBody = body === undefined || body === null ? undefined : JSON.stringify(body);
      let response;
      try {
        response = await fetchImpl(httpsUrl(url), {
          method,
          headers: { ...headers },
          ...(requestBody === undefined ? {} : { body: requestBody }),
          signal: AbortSignal.timeout(selectedTimeoutMs)
        });
      } catch {
        throw failure("LLM_TRANSPORT_UNAVAILABLE");
      }

      let responseBody = null;
      try {
        const raw = await response.text();
        if (raw.trim()) {
          try { responseBody = JSON.parse(raw); } catch { responseBody = null; }
        }
      } catch {
        responseBody = null;
      }
      return { status: response.status, body: responseBody };
    }
  };
}
