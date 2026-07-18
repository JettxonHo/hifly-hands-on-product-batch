import test from "node:test";
import assert from "node:assert/strict";

import { createPlaywrightRuntimeAuthProvider } from "../src/rpa/capture/playwright-runtime-auth.js";

function fakeChromium({ cookies = [], onCookies, onClose, calls = [] } = {}) {
  return {
    async launchPersistentContext(profileDir, options) {
      calls.push({ profileDir, options });
      return {
        async cookies() {
          if (onCookies) return onCookies();
          return cookies;
        },
        async close() {
          if (onClose) return onClose();
        }
      };
    }
  };
}

test("runtime auth provider builds per-host in-memory cookie headers for allowed domains", async () => {
  const calls = [];
  const provider = createPlaywrightRuntimeAuthProvider({
    chromium: fakeChromium({
      calls,
      cookies: [
        { name: "sid", value: "abc", domain: ".hifly.cc" },
        { name: "api", value: "def", domain: "hiflyworks-api.lingverse.co" },
        { name: "wide", value: "ghi", domain: ".lingverse.co" },
        { name: "other", value: "nope", domain: "example.com" }
      ]
    }),
    profileDir: "/tmp/profile"
  });

  const auth = await provider.getRuntimeAuth();

  assert.deepEqual(calls, [{ profileDir: "/tmp/profile", options: { headless: true } }]);
  assert.equal(auth.cookie_count, 3);
  assert.deepEqual(auth.headers, {});
  assert.equal(auth.headersForUrl("https://hifly.cc/goods").cookie, "sid=abc");
  assert.equal(auth.headersForUrl("https://hiflyworks-api.lingverse.co/api").cookie, "api=def; wide=ghi");
  assert.equal(auth.headersForUrl("https://lingverse.co/account").cookie, "wide=ghi");
  assert.deepEqual(auth.headersForUrl("https://example.com"), {});
});

test("runtime auth provider returns empty headers when no allowed cookies exist", async () => {
  const provider = createPlaywrightRuntimeAuthProvider({
    chromium: fakeChromium({ cookies: [{ name: "other", value: "nope", domain: "example.com" }] }),
    profileDir: "/tmp/profile"
  });

  const auth = await provider.getRuntimeAuth();
  assert.deepEqual(auth.headers, {});
  assert.equal(auth.cookie_count, 0);
  assert.deepEqual(auth.headersForUrl("https://hiflyworks-api.lingverse.co/api"), {});
});

test("runtime auth provider closes context when cookies throws and does not leak cookie values", async () => {
  let closed = false;
  const provider = createPlaywrightRuntimeAuthProvider({
    chromium: fakeChromium({
      onCookies: async () => {
        throw new Error("cookie failure secret-cookie-value");
      },
      onClose: async () => {
        closed = true;
      }
    }),
    profileDir: "/tmp/profile"
  });

  await assert.rejects(
    provider.getRuntimeAuth(),
    (error) => {
      assert.equal(error.code, "CAPTURE_HTTP_RUNTIME_AUTH_FAILED");
      assert.equal(error.message.includes("secret-cookie-value"), false);
      return true;
    }
  );
  assert.equal(closed, true);
});

test("runtime auth provider does not log cookie values", async () => {
  const logs = [];
  const provider = createPlaywrightRuntimeAuthProvider({
    chromium: fakeChromium({ cookies: [{ name: "sid", value: "secret-cookie", domain: ".hifly.cc" }] }),
    profileDir: "/tmp/profile",
    logger: { info: (message) => logs.push(message), warn: (message) => logs.push(message) }
  });

  await provider.getRuntimeAuth();

  assert.equal(logs.join("\n").includes("secret-cookie"), false);
});
