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

function sanitizeAllowedDomains(allowedDomains) {
  if (!Array.isArray(allowedDomains)) return [];
  return allowedDomains.map(normalizeDomain).filter(Boolean);
}

export function createPlaywrightRuntimeAuthProvider({
  chromium,
  profileDir,
  allowedDomains = ["hiflyworks-api.lingverse.co", "hifly.cc"],
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

        logger.info?.(`Loaded ${allowedCookies.length} runtime auth cookie(s) for capture HTTP.`);

        return {
          headers: {},
          cookie_count: allowedCookies.length,
          headersForUrl(url) {
            const parsed = new URL(url);
            const cookie = buildCookieHeader(allowedCookies, parsed.hostname);
            return cookie ? { cookie } : {};
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
