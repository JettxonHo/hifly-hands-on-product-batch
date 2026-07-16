import test from "node:test";
import assert from "node:assert/strict";

import { createRealLiveHttpClient } from "../src/rpa/capture/real-live-http-client.js";

function manifestWith(stepPatch = {}) {
  return {
    schema_version: 1,
    sanitized: true,
    source: "test",
    captured_at: "2026-07-17T00:00:00.000Z",
    steps: [{
      id: "submit_video",
      phase: "remote_submit",
      method: "POST",
      url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos",
      placeholders: ["{{asset_id}}"],
      request_template: { headers: { "content-type": "application/json" }, body: { gen_id: "{{asset_id}}" } },
      response: { status: 200, body: { code: 0, data: { list: [{ id: 123, status: 1 }] } } },
      produces: { remote_id: "$response.body.data.list.0.id" },
      risk: { requires_auth: true, may_consume_points: true, replayability: "unknown" },
      ...stepPatch
    }]
  };
}

test("real_live is disabled by default before any transport call", async () => {
  let called = false;
  const client = createRealLiveHttpClient({
    manifest: manifestWith(),
    transport: { request: async () => { called = true; return { status: 200, body: {} }; } }
  });
  await assert.rejects(
    client.request({ stepId: "submit_video", variables: { asset_id: "asset-1" }, context: { allowRealLive: true, acknowledgePointRisk: true } }),
    { code: "CAPTURE_HTTP_REAL_LIVE_DISABLED" }
  );
  assert.equal(called, false);
});

test("real_live requires per-run authorization", async () => {
  let called = false;
  const client = createRealLiveHttpClient({
    manifest: manifestWith(),
    config: { enabled: true },
    runtimeAuth: { headers: { cookie: "in-memory-only" } },
    transport: { request: async () => { called = true; return { status: 200, body: {} }; } }
  });
  await assert.rejects(
    client.request({ stepId: "submit_video", variables: { asset_id: "asset-1" }, context: { acknowledgePointRisk: true } }),
    { code: "CAPTURE_HTTP_REAL_LIVE_NOT_AUTHORIZED" }
  );
  assert.equal(called, false);
});

test("real_live requires point-risk acknowledgement for point-consuming steps", async () => {
  let called = false;
  const client = createRealLiveHttpClient({
    manifest: manifestWith(),
    config: { enabled: true },
    runtimeAuth: { headers: { cookie: "in-memory-only" } },
    transport: { request: async () => { called = true; return { status: 200, body: {} }; } }
  });
  await assert.rejects(
    client.request({ stepId: "submit_video", variables: { asset_id: "asset-1" }, context: { allowRealLive: true } }),
    { code: "CAPTURE_HTTP_POINT_RISK_NOT_ACKNOWLEDGED" }
  );
  assert.equal(called, false);
});

test("real_live requires runtime auth for auth-required steps", async () => {
  let called = false;
  const client = createRealLiveHttpClient({
    manifest: manifestWith(),
    config: { enabled: true },
    transport: { request: async () => { called = true; return { status: 200, body: {} }; } }
  });
  await assert.rejects(
    client.request({ stepId: "submit_video", variables: { asset_id: "asset-1" }, context: { allowRealLive: true, acknowledgePointRisk: true } }),
    { code: "CAPTURE_HTTP_AUTH_REQUIRED" }
  );
  assert.equal(called, false);
});

test("real_live rejects hosts outside the allowlist before transport", async () => {
  let called = false;
  const client = createRealLiveHttpClient({
    manifest: manifestWith({ url_template: "https://example.invalid/api?asset={{asset_id}}" }),
    config: { enabled: true, allowedHosts: ["hiflyworks-api.lingverse.co"] },
    runtimeAuth: { headers: { cookie: "in-memory-only" } },
    transport: { request: async () => { called = true; return { status: 200, body: {} }; } }
  });
  await assert.rejects(
    client.request({ stepId: "submit_video", variables: { asset_id: "asset-1" }, context: { allowRealLive: true, acknowledgePointRisk: true } }),
    { code: "CAPTURE_HTTP_HOST_NOT_ALLOWED" }
  );
  assert.equal(called, false);
});

test("real_live rejects undeclared template placeholders before transport", async () => {
  let called = false;
  const client = createRealLiveHttpClient({
    manifest: manifestWith({
      placeholders: [],
      url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/status?id={{undeclared_id}}",
      request_template: { headers: {}, body: null },
      risk: { requires_auth: false, may_consume_points: false, replayability: "unknown" }
    }),
    config: { enabled: true },
    transport: { request: async () => { called = true; return { status: 200, body: {} }; } }
  });
  await assert.rejects(
    client.request({ stepId: "submit_video", variables: { undeclared_id: "work-1" }, context: { allowRealLive: true } }),
    { code: "CAPTURE_HTTP_UNDECLARED_PLACEHOLDER" }
  );
  assert.equal(called, false);
});

test("real_live rejects sensitive request templates before transport", async () => {
  for (const stepPatch of [
    { request_template: { headers: { authorization: "Bearer private" }, body: null } },
    { request_template: { headers: {}, body: { apiKey: "private" } } },
    { url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/status?token=private" }
  ]) {
    let called = false;
    const client = createRealLiveHttpClient({
      manifest: manifestWith({
        ...stepPatch,
        risk: { requires_auth: false, may_consume_points: false, replayability: "unknown" }
      }),
      config: { enabled: true },
      transport: { request: async () => { called = true; return { status: 200, body: {} }; } }
    });
    await assert.rejects(
      client.request({ stepId: "submit_video", variables: { asset_id: "asset-1" }, context: { allowRealLive: true } }),
      { code: "CAPTURE_HTTP_SENSITIVE_TEMPLATE" }
    );
    assert.equal(called, false);
  }
});

test("real_live rejects resolved absolute local paths before transport", async () => {
  for (const pathCase of [
    {
      url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/status?source={{local_path}}",
      request_template: { headers: {}, body: null },
      local_path: "/srv/private/secret.png"
    },
    {
      url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/status",
      request_template: { headers: { "x-source-file": "{{local_path}}" }, body: null },
      local_path: "C:\\secret\\file.png"
    },
    {
      url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/status",
      request_template: { headers: {}, body: { source_file: "{{local_path}}" } },
      local_path: "/srv/private/secret.png"
    },
    {
      url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/status",
      request_template: { headers: { "x-source-file": "{{local_path}}" }, body: null },
      local_path: "\\\\server\\share\\secret.png"
    },
    {
      url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/status",
      request_template: { headers: {}, body: { source_file: "{{local_path}}" } },
      local_path: "\\secret\\file.png"
    }
  ]) {
    let called = false;
    const client = createRealLiveHttpClient({
      manifest: manifestWith({
        url_template: pathCase.url_template,
        placeholders: ["{{asset_id}}", "{{local_path}}"],
        request_template: pathCase.request_template,
        risk: { requires_auth: false, may_consume_points: false, replayability: "unknown" }
      }),
      config: { enabled: true },
      transport: { request: async () => { called = true; return { status: 200, body: {} }; } }
    });
    await assert.rejects(
      client.request({ stepId: "submit_video", variables: { asset_id: "asset-1", local_path: pathCase.local_path }, context: { allowRealLive: true } }),
      { code: "CAPTURE_HTTP_LOCAL_PATH_FORBIDDEN" }
    );
    assert.equal(called, false);
  }
});

test("real_live rejects file URL request values before transport", async () => {
  for (const request_template of [
    { headers: { "x-source-file": "file:///srv/private/secret.png" }, body: null },
    { headers: {}, body: { source_file: "file:///srv/private/secret.png" } }
  ]) {
    let called = false;
    const client = createRealLiveHttpClient({
      manifest: manifestWith({
        request_template,
        risk: { requires_auth: false, may_consume_points: false, replayability: "unknown" }
      }),
      config: { enabled: true },
      transport: { request: async () => { called = true; return { status: 200, body: {} }; } }
    });
    await assert.rejects(
      client.request({ stepId: "submit_video", variables: { asset_id: "asset-1" }, context: { allowRealLive: true } }),
      { code: "CAPTURE_HTTP_LOCAL_PATH_FORBIDDEN" }
    );
    assert.equal(called, false);
  }
});

test("real_live permits normal URL pathnames", async () => {
  let called = false;
  const client = createRealLiveHttpClient({
    manifest: manifestWith({ risk: { requires_auth: false, may_consume_points: false, replayability: "unknown" } }),
    config: { enabled: true },
    transport: {
      request: async () => {
        called = true;
        return { status: 200, body: { data: { list: [{ id: 123 }] } } };
      }
    }
  });
  await client.request({
    stepId: "submit_video",
    variables: { asset_id: "asset-1" },
    context: { allowRealLive: true }
  });
  assert.equal(called, true);
});

test("real_live rejects malformed template placeholders before transport", async () => {
  for (const templatePatch of [
    { url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/status?id={{asset-id}}" },
    { request_template: { headers: {}, body: { gen_id: "{{asset-id}}" } } }
  ]) {
    let called = false;
    const client = createRealLiveHttpClient({
      manifest: manifestWith({
        ...templatePatch,
        risk: { requires_auth: false, may_consume_points: false, replayability: "unknown" }
      }),
      config: { enabled: true },
      transport: { request: async () => { called = true; return { status: 200, body: {} }; } }
    });
    await assert.rejects(
      client.request({ stepId: "submit_video", variables: { asset_id: "asset-1" }, context: { allowRealLive: true } }),
      { code: "CAPTURE_HTTP_UNDECLARED_PLACEHOLDER" }
    );
    assert.equal(called, false);
  }
});

test("real_live fake transport produces variables without using network APIs", async () => {
  const calls = [];
  const client = createRealLiveHttpClient({
    manifest: manifestWith({ risk: { requires_auth: false, may_consume_points: false, replayability: "unknown" } }),
    config: { enabled: true },
    transport: {
      request: async (request) => {
        calls.push(request);
        return { status: 200, headers: {}, body: { code: 0, data: { list: [{ id: 987, status: 1 }] } } };
      }
    }
  });
  const result = await client.request({
    stepId: "submit_video",
    variables: { asset_id: "asset-1" },
    context: { allowRealLive: true, acknowledgePointRisk: true }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].url, "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos");
  assert.deepEqual(calls[0].body, { gen_id: "asset-1" });
  assert.equal(result.produced.remote_id, 987);
  assert.equal(result.request_plan.host, "hiflyworks-api.lingverse.co");
});
