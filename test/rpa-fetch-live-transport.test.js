import test from "node:test";
import assert from "node:assert/strict";

import { createFetchLiveTransport } from "../src/rpa/capture/fetch-live-transport.js";

test("fetch live transport rejects non-https URLs before fetch", async () => {
  let called = false;
  const transport = createFetchLiveTransport({
    fetchImpl: async () => {
      called = true;
      return new Response("{}");
    }
  });
  await assert.rejects(
    transport.request({ method: "GET", url: "http://hiflyworks-api.lingverse.co/api", headers: {}, body: null }),
    { code: "CAPTURE_HTTP_TRANSPORT_URL_REJECTED" }
  );
  assert.equal(called, false);
});

test("fetch live transport sends JSON request and parses JSON response", async () => {
  const calls = [];
  const transport = createFetchLiveTransport({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ code: 0, data: { id: 123 } }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
  });
  const result = await transport.request({
    method: "POST",
    url: "https://hiflyworks-api.lingverse.co/api/app/v1/test",
    headers: { "content-type": "application/json", cookie: "sid=memory" },
    body: { hello: "world" },
    timeoutMs: 1000
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://hiflyworks-api.lingverse.co/api/app/v1/test");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.cookie, "sid=memory");
  assert.equal(calls[0].init.body, JSON.stringify({ hello: "world" }));
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { code: 0, data: { id: 123 } });
});

test("fetch live transport parses text/plain JSON responses", async () => {
  const transport = createFetchLiveTransport({
    fetchImpl: async () => new Response(JSON.stringify({ code: 12, message: "用户未认证" }), {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" }
    })
  });
  const result = await transport.request({
    method: "POST",
    url: "https://hiflyworks-api.lingverse.co/api/app/v1/upload_url",
    headers: { "content-type": "application/json" },
    body: { extension: "jpeg", media_type: 3 },
    timeoutMs: 1000
  });
  assert.deepEqual(result.body, { code: 12, message: "用户未认证" });
});

test("fetch live transport returns binary artifact for non-json responses", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const transport = createFetchLiveTransport({
    fetchImpl: async () => new Response(bytes, {
      status: 200,
      headers: { "content-type": "video/mp4", "content-disposition": "attachment; filename=\"demo.mp4\"" }
    })
  });
  const result = await transport.request({
    method: "GET",
    url: "https://hiflyworks-api.lingverse.co/download/demo.mp4",
    headers: {},
    body: null,
    timeoutMs: 1000
  });
  assert.equal(result.status, 200);
  assert.deepEqual([...result.artifact.bytes], [1, 2, 3, 4]);
  assert.equal(result.artifact.filename, "demo.mp4");
  assert.deepEqual(result.body, { artifact_filename: "demo.mp4" });
});

test("fetch live transport rejects artifacts larger than maxBytes", async () => {
  const transport = createFetchLiveTransport({
    maxBytes: 3,
    fetchImpl: async () => new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 200,
      headers: { "content-type": "application/octet-stream" }
    })
  });
  await assert.rejects(
    transport.request({
      method: "GET",
      url: "https://hiflyworks-api.lingverse.co/download/large.bin",
      headers: {},
      body: null,
      timeoutMs: 1000
    }),
    { code: "CAPTURE_HTTP_ARTIFACT_TOO_LARGE" }
  );
});

test("fetch live transport rejects oversized artifacts from content-length before buffering", async () => {
  let buffered = false;
  const transport = createFetchLiveTransport({
    maxBytes: 3,
    fetchImpl: async () => ({
      status: 200,
      headers: new Headers({ "content-type": "video/mp4", "content-length": "4" }),
      async arrayBuffer() {
        buffered = true;
        return new Uint8Array([1, 2, 3, 4]).buffer;
      }
    })
  });
  await assert.rejects(
    transport.request({
      method: "GET",
      url: "https://hiflyworks-api.lingverse.co/download/large.mp4",
      headers: {},
      body: null,
      timeoutMs: 1000
    }),
    { code: "CAPTURE_HTTP_ARTIFACT_TOO_LARGE" }
  );
  assert.equal(buffered, false);
});

test("fetch live transport rejects html error pages as artifacts", async () => {
  const transport = createFetchLiveTransport({
    fetchImpl: async () => new Response("<html>login</html>", {
      status: 401,
      headers: { "content-type": "text/html" }
    })
  });
  await assert.rejects(
    transport.request({
      method: "GET",
      url: "https://hiflyworks-api.lingverse.co/download/login",
      headers: {},
      body: null,
      timeoutMs: 1000
    }),
    { code: "CAPTURE_HTTP_UNEXPECTED_CONTENT_TYPE" }
  );
});

test("fetch live transport wraps fetch failures without leaking request details", async () => {
  const transport = createFetchLiveTransport({
    fetchImpl: async () => {
      throw new Error("connect ECONNREFUSED https://secret.example/token=abc");
    }
  });
  await assert.rejects(
    transport.request({
      method: "GET",
      url: "https://hiflyworks-api.lingverse.co/api",
      headers: { cookie: "sid=memory" },
      body: null,
      timeoutMs: 1000
    }),
    (error) => {
      assert.equal(error.code, "CAPTURE_HTTP_TRANSPORT_FAILED");
      assert.equal(error.message.includes("secret"), false);
      assert.equal(error.message.includes("sid=memory"), false);
      return true;
    }
  );
});
