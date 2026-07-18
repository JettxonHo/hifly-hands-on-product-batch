function safeError(code, message) {
  return Object.assign(new Error(message || code), { code });
}

function normalizeDomain(value) {
  return String(value || "").trim().replace(/^\./, "").toLowerCase();
}

function domainMatches(cookieDomain, allowedDomain) {
  const domain = normalizeDomain(cookieDomain);
  const allowed = normalizeDomain(allowedDomain);
  if (!domain || !allowed) return false;
  return domain === allowed || domain.endsWith(`.${allowed}`) || allowed.endsWith(`.${domain}`);
}

function cookieMatchesRequestHost(cookieDomain, requestHost) {
  const domain = normalizeDomain(cookieDomain);
  const host = normalizeDomain(requestHost);
  if (!domain || !host) return false;
  return host === domain || host.endsWith(`.${domain}`);
}

function cookiePair(cookie) {
  if (!cookie || typeof cookie.name !== "string" || cookie.name.length === 0 || cookie.value == null) return null;
  return `${encodeURIComponent(cookie.name)}=${encodeURIComponent(String(cookie.value))}`;
}

function buildCookieHeader(cookies, host) {
  const pairs = cookies
    .filter((cookie) => cookieMatchesRequestHost(cookie.domain, host))
    .map(cookiePair)
    .filter(Boolean);
  return pairs.join("; ");
}

function bearerHeader(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^Bearer\s+eyJ[A-Za-z0-9_-]+\./.test(trimmed)) return trimmed;
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(trimmed)) return `Bearer ${trimmed}`;
  return null;
}

function sanitizeAllowedDomains(allowedDomains) {
  if (!Array.isArray(allowedDomains)) return [];
  return allowedDomains.map(normalizeDomain).filter(Boolean);
}

export function createPlaywrightRuntimeAuthProvider({
  chromium,
  profileDir,
  allowedDomains = ["hiflyworks-api.lingverse.co", "hifly.cc"],
  tokenOrigin = "https://hifly.cc",
  tokenKeys = ["authorization", "access_token", "accessToken", "token"],
  logger = console
} = {}) {
  if (!chromium || typeof chromium.launchPersistentContext !== "function") {
    throw new TypeError("runtime auth provider requires chromium.launchPersistentContext");
  }
  if (!profileDir) throw new TypeError("runtime auth provider requires profileDir");

  const allowed = sanitizeAllowedDomains(allowedDomains);

  return {
    async getRuntimeAuth() {
      let context;
      try {
        context = await chromium.launchPersistentContext(profileDir, { headless: true });
        let cookies;
        try {
          cookies = await context.cookies();
        } catch {
          throw safeError("CAPTURE_HTTP_RUNTIME_AUTH_FAILED", "Failed to load runtime auth cookies.");
        }

        const allowedCookies = cookies.filter((cookie) =>
          allowed.some((domain) => domainMatches(cookie.domain, domain))
        );
        let authorization = null;
        if (tokenOrigin && typeof context.newPage === "function") {
          let page;
          try {
            page = await context.newPage();
            await page.goto(tokenOrigin, { waitUntil: "domcontentloaded" });
            const candidates = await page.evaluate((keys) => {
              const values = [];
              for (const key of keys) {
                const value = window.localStorage.getItem(key) || window.sessionStorage.getItem(key);
                if (value) values.push(value);
              }
              for (let index = 0; index < window.localStorage.length; index += 1) {
                const key = window.localStorage.key(index);
                if (key && /token|authorization/i.test(key)) {
                  const value = window.localStorage.getItem(key);
                  if (value) values.push(value);
                }
              }
              return values;
            }, tokenKeys);
            authorization = (Array.isArray(candidates) ? candidates : []).map(bearerHeader).find(Boolean) || null;
          } catch {
            logger.warn?.("Runtime auth token lookup failed; continuing with cookies only.");
          } finally {
            await page?.close?.();
          }
        }

        logger.info?.(`Loaded ${allowedCookies.length} runtime auth cookie(s) and ${authorization ? 1 : 0} bearer token(s) for capture HTTP.`);

        return {
          headers: {},
          cookie_count: allowedCookies.length,
          bearer_count: authorization ? 1 : 0,
          headersForUrl(url) {
            const parsed = new URL(url);
            const cookie = buildCookieHeader(allowedCookies, parsed.hostname);
            const headers = {};
            if (cookie) headers.cookie = cookie;
            if (authorization && parsed.hostname === "hiflyworks-api.lingverse.co") headers.authorization = authorization;
            return headers;
          }
        };
      } finally {
        if (context && typeof context.close === "function") {
          await context.close();
        }
      }
    }
  };
}
