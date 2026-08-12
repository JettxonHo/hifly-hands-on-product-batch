import assert from "node:assert/strict";
import test from "node:test";

import {
  DEEPSEEK_BASE_URL,
  DEEPSEEK_DEFAULT_MODEL,
  createDeepSeekClient
} from "../src/llm/deepseek-client.js";
import { createFetchTransport } from "../src/llm/http-transport.js";

test("provider-neutral HTTP transport sends JSON and parses a JSON response", async () => {
  let request;
  const transport = createFetchTransport({
    fetchImpl: async (url, init) => {
      request = { url, init };
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });

  const result = await transport.request({
    url: "https://api.deepseek.com/chat/completions",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { hello: "world" },
    timeoutMs: 1_000
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(request.url, "https://api.deepseek.com/chat/completions");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.body, JSON.stringify({ hello: "world" }));
});

test("DeepSeek client constructs the official non-thinking JSON Output request", async () => {
  let request;
  const client = createDeepSeekClient({
    apiKey: "unit-test-key",
    transport: {
      async request(input) {
        request = input;
        return {
          status: 200,
          body: { choices: [{ message: { content: '{"body":"测试文案"}' } }] }
        };
      }
    }
  });

  const response = await client.complete({
    messages: [
      { role: "system", content: "Return a JSON object." },
      { role: "user", content: "商品事实" }
    ]
  });

  assert.deepEqual(response, { choices: [{ message: { content: '{"body":"测试文案"}' } }] });
  assert.equal(request.url, `${DEEPSEEK_BASE_URL}/chat/completions`);
  assert.equal(request.method, "POST");
  assert.deepEqual(request.headers, {
    authorization: "Bearer unit-test-key",
    "content-type": "application/json"
  });
  assert.equal(request.body.model, DEEPSEEK_DEFAULT_MODEL);
  assert.deepEqual(request.body.thinking, { type: "disabled" });
  assert.deepEqual(request.body.response_format, { type: "json_object" });
  assert.equal(request.body.max_tokens, 512);
  assert.deepEqual(request.body.messages, [
    { role: "system", content: "Return a JSON object." },
    { role: "user", content: "商品事实" }
  ]);
});

test("DeepSeek client maps HTTP and transport failures without exposing provider details", async () => {
  const sensitive = "unit-test-key prompt https://api.deepseek.com/chat/completions";
  for (const [status, code] of [[401, "DEEPSEEK_AUTH_INVALID"], [429, "DEEPSEEK_RATE_LIMITED"], [500, "DEEPSEEK_UNAVAILABLE"]]) {
    const client = createDeepSeekClient({
      apiKey: "unit-test-key",
      transport: { async request() { return { status, body: { error: { message: sensitive } } }; } }
    });
    await assert.rejects(client.complete({ messages: [] }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.message, code);
      assert.equal(error.message.includes("unit-test-key"), false);
      assert.equal(error.message.includes("api.deepseek.com"), false);
      return true;
    });
  }

  const unavailable = createDeepSeekClient({
    apiKey: "unit-test-key",
    transport: { async request() { throw new Error(sensitive); } }
  });
  await assert.rejects(unavailable.complete({ messages: [] }), { code: "DEEPSEEK_UNAVAILABLE", message: "DEEPSEEK_UNAVAILABLE" });
});

test("DeepSeek client rejects an invalid successful response without returning raw content", async () => {
  const client = createDeepSeekClient({
    apiKey: "unit-test-key",
    transport: { async request() { return { status: 200, body: { choices: [] } }; } }
  });

  await assert.rejects(client.complete({ messages: [] }), { code: "DEEPSEEK_RESPONSE_INVALID", message: "DEEPSEEK_RESPONSE_INVALID" });
});
