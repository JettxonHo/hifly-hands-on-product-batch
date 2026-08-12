export const HIFLY_API_BASE_URL = "https://hfw-api.hifly.cc";

const ACCOUNT_CREDIT_PATH = "/api/v2/hifly/account/credit";
const PUBLIC_AVATAR_LIST_PATH = "/api/v2/hifly/avatar/list";

function fail(code) {
  return Object.assign(new Error(code), { code });
}

function paginationValue(value, fallback, name, maximum) {
  const selected = value ?? fallback;
  if (!Number.isInteger(selected) || selected < 1 || selected > maximum) throw fail(`HIFLY_API_${name}_INVALID`);
  return selected;
}

function responseItems(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || !Number.isInteger(body.code)) {
    throw fail("HIFLY_API_RESPONSE_INVALID");
  }
  if (body.code !== 0) throw fail("HIFLY_API_REQUEST_FAILED");
  if (!Array.isArray(body.data)) throw fail("HIFLY_API_RESPONSE_INVALID");
  return body.data.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
      !((typeof item.avatar === "string" && item.avatar.trim()) ||
        (Number.isSafeInteger(item.avatar) && item.avatar >= 0)) ||
      item.kind !== 2 || typeof item.title !== "string" || !item.title.trim()) {
      throw fail("HIFLY_API_RESPONSE_INVALID");
    }
    return {
      avatar: typeof item.avatar === "string" ? item.avatar.trim() : item.avatar,
      kind: 2,
      title: item.title.trim()
    };
  });
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

  async function listPublicAvatars({ page, size } = {}) {
    const selectedPage = paginationValue(page, 1, "PAGE", 100_000);
    const selectedSize = paginationValue(size, 100, "PAGE_SIZE", 1_000);
    const url = new URL(`${HIFLY_API_BASE_URL}${PUBLIC_AVATAR_LIST_PATH}`);
    url.searchParams.set("page", String(selectedPage));
    url.searchParams.set("size", String(selectedSize));
    url.searchParams.set("kind", "2");

    let response;
    try {
      response = await fetchImpl(String(url), {
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
    return {
      items: responseItems(body),
      requestId: typeof body.request_id === "string" && body.request_id ? body.request_id : null
    };
  }

  return { getAccountCredit, listPublicAvatars };
}
