export const HIFLY_API_BASE_URL = "https://hfw-api.hifly.cc";

const ACCOUNT_CREDIT_PATH = "/api/v2/hifly/account/credit";

function fail(code) {
  return Object.assign(new Error(code), { code });
}

export function createHiflyApiClient({ token, fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
  if (typeof token !== "string" || token.trim() === "") throw fail("HIFLY_API_TOKEN_REQUIRED");
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 60_000) throw fail("HIFLY_API_TIMEOUT_INVALID");

  const bearerToken = token.trim();

  async function getAccountCredit() {
    let response;
    try {
      response = await fetchImpl(`${HIFLY_API_BASE_URL}${ACCOUNT_CREDIT_PATH}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${bearerToken}` },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch {
      throw fail("HIFLY_API_UNAVAILABLE");
    }

    if (response.status === 401) throw fail("HIFLY_API_AUTH_INVALID");
    if (!response.ok) throw fail("HIFLY_API_UNAVAILABLE");

    let body;
    try {
      body = await response.json();
    } catch {
      throw fail("HIFLY_API_RESPONSE_INVALID");
    }
    if (!body || typeof body !== "object" || !Number.isInteger(body.code)) {
      throw fail("HIFLY_API_RESPONSE_INVALID");
    }
    if (body.code !== 0) throw fail("HIFLY_API_REQUEST_FAILED");
    if (!Number.isInteger(body.left) || body.left < 0) throw fail("HIFLY_API_RESPONSE_INVALID");

    return {
      left: body.left,
      requestId: typeof body.request_id === "string" && body.request_id ? body.request_id : null
    };
  }

  return { getAccountCredit };
}
