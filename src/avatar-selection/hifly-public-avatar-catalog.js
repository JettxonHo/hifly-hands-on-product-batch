const HIFLY_ERRORS = new Set([
  "HIFLY_API_AUTH_INVALID",
  "HIFLY_API_REQUEST_FAILED",
  "HIFLY_API_RESPONSE_INVALID",
  "HIFLY_API_UNAVAILABLE"
]);

function failure(code) {
  return Object.assign(new Error(code), { code });
}

function validPageSize(value) {
  if (!Number.isInteger(value) || value < 1 || value > 1_000) throw failure("HIFLY_API_PAGE_SIZE_INVALID");
  return value;
}

function providerAvatarKey(value) {
  const candidate = typeof value === "string" && value.trim() ? value.trim() : Number.isSafeInteger(value) && value >= 0 ? String(value) : "";
  const normalized = `hifly-public:${candidate}`;
  if (/^hifly-public:[^\u0000-\u001f\u007f-\u009f]{1,256}$/u.test(normalized)) return normalized;
  throw failure("HIFLY_API_RESPONSE_INVALID");
}

function normalizeItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item) || item.kind !== 2 ||
    typeof item.title !== "string" || !item.title.trim()) throw failure("HIFLY_API_RESPONSE_INVALID");
  return {
    provider_key: providerAvatarKey(item.avatar),
    display_name: item.title.trim(),
    source_type: "public"
  };
}

export function createHiflyPublicAvatarCatalog({ client, pageSize = 100, maxPages = 1_000 } = {}) {
  if (!client || typeof client.listPublicAvatars !== "function") throw new TypeError("client.listPublicAvatars is required");
  const selectedPageSize = validPageSize(pageSize);
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 10_000) throw failure("HIFLY_API_MAX_PAGES_INVALID");

  async function list() {
    const entries = new Map();
    for (let page = 1; page <= maxPages; page += 1) {
      let result;
      try {
        result = await client.listPublicAvatars({ page, size: selectedPageSize });
      } catch (error) {
        if (HIFLY_ERRORS.has(error?.code)) throw failure(error.code);
        throw failure("HIFLY_API_UNAVAILABLE");
      }
      const items = Array.isArray(result) ? result : result?.items || result?.data;
      if (!Array.isArray(items)) throw failure("HIFLY_API_RESPONSE_INVALID");
      for (const item of items) {
        const normalized = normalizeItem(item);
        entries.set(normalized.provider_key, normalized);
      }
      if (items.length < selectedPageSize) return [...entries.values()];
    }
    throw failure("HIFLY_API_RESPONSE_INVALID");
  }

  return { list, collect: list, listPublicAvatars: list };
}
