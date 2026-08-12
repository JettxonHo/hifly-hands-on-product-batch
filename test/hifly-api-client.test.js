import assert from "node:assert/strict";
import test from "node:test";

import { createHiflyApiClient, HIFLY_API_BASE_URL } from "../src/providers/hifly-api-client.js";

test("Hifly API client reads account credit with the configured Bearer token", async () => {
  let request;
  const client = createHiflyApiClient({
    token: "test-hifly-token",
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return new Response(JSON.stringify({ code: 0, message: "", left: 1234, request_id: "req-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.deepEqual(await client.getAccountCredit(), { left: 1234, requestId: "req-1" });
  assert.equal(request.url, `${HIFLY_API_BASE_URL}/api/v2/hifly/account/credit`);
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.headers.Authorization, "Bearer test-hifly-token");
});

test("Hifly API client maps authentication failure without exposing the token", async () => {
  const token = "private-token-value";
  const client = createHiflyApiClient({
    token,
    fetchImpl: async () => new Response(JSON.stringify({ code: 1001, message: `bad ${token}` }), { status: 401 })
  });

  await assert.rejects(client.getAccountCredit(), (error) => {
    assert.equal(error.code, "HIFLY_API_AUTH_INVALID");
    assert.doesNotMatch(error.message, new RegExp(token));
    return true;
  });
});

test("Hifly API client rejects unsuccessful or malformed business responses", async () => {
  const failed = createHiflyApiClient({
    token: "test-token",
    fetchImpl: async () => new Response(JSON.stringify({ code: 2002, message: "provider detail" }), { status: 200 })
  });
  await assert.rejects(failed.getAccountCredit(), { code: "HIFLY_API_REQUEST_FAILED" });

  const malformed = createHiflyApiClient({
    token: "test-token",
    fetchImpl: async () => new Response(JSON.stringify({ code: 0, left: "unknown" }), { status: 200 })
  });
  await assert.rejects(malformed.getAccountCredit(), { code: "HIFLY_API_RESPONSE_INVALID" });
});

test("Hifly API client lists public avatars with documented pagination and kind", async () => {
  let request;
  const client = createHiflyApiClient({
    token: "test-hifly-token",
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return new Response(JSON.stringify({ code: 0, message: "ok", data: [
        { avatar: "avatar-101", kind: 2, title: "Public One" }
      ], request_id: "req-list-1" }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  assert.deepEqual(await client.listPublicAvatars({ page: 3, size: 25 }), {
    items: [{ avatar: "avatar-101", kind: 2, title: "Public One" }],
    requestId: "req-list-1"
  });
  assert.equal(request.url, `${HIFLY_API_BASE_URL}/api/v2/hifly/avatar/list?page=3&size=25&kind=2`);
  assert.equal(request.options.method, "GET");
  assert.equal(request.options.headers.Authorization, "Bearer test-hifly-token");
});

test("Hifly public avatar list maps auth, business, and malformed responses to stable errors", async () => {
  const auth = createHiflyApiClient({
    token: "private-token-value",
    fetchImpl: async () => new Response(JSON.stringify({ code: 1001, message: "provider secret" }), { status: 401 })
  });
  await assert.rejects(auth.listPublicAvatars(), (error) => {
    assert.equal(error.code, "HIFLY_API_AUTH_INVALID");
    assert.doesNotMatch(error.message, /provider secret|private-token-value/);
    return true;
  });

  const failed = createHiflyApiClient({
    token: "test-token",
    fetchImpl: async () => new Response(JSON.stringify({ code: 2002, message: "provider detail" }), { status: 200 })
  });
  await assert.rejects(failed.listPublicAvatars(), { code: "HIFLY_API_REQUEST_FAILED" });

  const malformed = createHiflyApiClient({
    token: "test-token",
    fetchImpl: async () => new Response(JSON.stringify({ code: 0, data: [{ avatar: "a", kind: 2 }] }), { status: 200 })
  });
  await assert.rejects(malformed.listPublicAvatars(), { code: "HIFLY_API_RESPONSE_INVALID" });
});
