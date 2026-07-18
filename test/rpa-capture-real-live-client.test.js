import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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

test("real_live requires matching runtime auth headers for the target host", async () => {
  let called = false;
  const client = createRealLiveHttpClient({
    manifest: manifestWith(),
    config: { enabled: true },
    runtimeAuth: {
      headersForUrl(url) {
        return url.includes("example.invalid") ? { cookie: "wrong-host-only" } : {};
      }
    },
    transport: { request: async () => { called = true; return { status: 200, body: {} }; } }
  });
  await assert.rejects(
    client.request({
      stepId: "submit_video",
      variables: { asset_id: "asset-1" },
      context: { allowRealLive: true, acknowledgePointRisk: true }
    }),
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

test("real_live rejects invalid placeholder declarations before transport", async () => {
  for (const placeholders of [
    ["asset_id"],
    ["{{asset-id}}"],
    ["{{{asset_id}}}"],
    ["{{asset_id}}}"],
    ["{{asset_id"]
  ]) {
    let called = false;
    const client = createRealLiveHttpClient({
      manifest: manifestWith({
        placeholders,
        risk: { requires_auth: false, may_consume_points: false, replayability: "unknown" }
      }),
      config: { enabled: true },
      transport: { request: async () => { called = true; return { status: 200, body: {} }; } }
    });
    await assert.rejects(
      client.request({ stepId: "submit_video", variables: { asset_id: "asset-1" }, context: { allowRealLive: true } }),
      { code: "CAPTURE_HTTP_INVALID_PLACEHOLDER" }
    );
    assert.equal(called, false);
  }
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

test("real_live rejects sensitive query keys introduced by URL substitution before transport", async () => {
  for (const query_key of ["token", "apiKey"]) {
    let called = false;
    const client = createRealLiveHttpClient({
      manifest: manifestWith({
        url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/status?{{query_key}}=x",
        placeholders: ["{{asset_id}}", "{{query_key}}"],
        risk: { requires_auth: false, may_consume_points: false, replayability: "unknown" }
      }),
      config: { enabled: true },
      transport: { request: async () => { called = true; return { status: 200, body: {} }; } }
    });
    await assert.rejects(
      client.request({
        stepId: "submit_video",
        variables: { asset_id: "asset-1", query_key },
        context: { allowRealLive: true }
      }),
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

test("real_live rejects POSIX and UNC-like local path values before transport", async () => {
  for (const stepPatch of [
    {
      url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/status?source=%2F%2Fetc%2Fpasswd",
      request_template: { headers: {}, body: null }
    },
    {
      request_template: { headers: { "x-source-file": "///etc/passwd" }, body: null }
    },
    {
      request_template: { headers: {}, body: { source_file: "//server/share/secret.png" } }
    }
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
      { code: "CAPTURE_HTTP_LOCAL_PATH_FORBIDDEN" }
    );
    assert.equal(called, false);
  }
});

test("real_live rejects runtime auth local paths after header merge", async () => {
  let called = false;
  const client = createRealLiveHttpClient({
    manifest: manifestWith({ risk: { requires_auth: true, may_consume_points: false, replayability: "unknown" } }),
    config: { enabled: true },
    runtimeAuth: { headers: { "x-source": "/etc/passwd" } },
    transport: { request: async () => { called = true; return { status: 200, body: {} }; } }
  });
  await assert.rejects(
    client.request({ stepId: "submit_video", variables: { asset_id: "asset-1" }, context: { allowRealLive: true } }),
    { code: "CAPTURE_HTTP_LOCAL_PATH_FORBIDDEN" }
  );
  assert.equal(called, false);
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
    { request_template: { headers: {}, body: { gen_id: "{{asset-id}}" } } },
    { url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/status?id={{asset_id" },
    { request_template: { headers: {}, body: { gen_id: "{{{asset_id}}}" } } },
    { request_template: { headers: {}, body: { gen_id: "{{asset_id}}}" } } }
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

test("real_live rejects malformed header and body template keys before transport", async () => {
  for (const request_template of [
    { headers: { "{{asset_id": "x" }, body: null },
    { headers: {}, body: { "{{asset-id}}": "x" } }
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
      { code: "CAPTURE_HTTP_UNDECLARED_PLACEHOLDER" }
    );
    assert.equal(called, false);
  }
});

test("real_live permits normal runtime auth and remote URL request values", async () => {
  const calls = [];
  const client = createRealLiveHttpClient({
    manifest: manifestWith({
      request_template: {
        headers: {
          "content-type": "application/json",
          "x-remote-source": "https://example.com/path"
        },
        body: { gen_id: "{{asset_id}}", source_url: "https://example.com/path" }
      }
    }),
    config: { enabled: true },
    runtimeAuth: { headers: { cookie: "sid=abc" } },
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
  assert.equal(calls[0].headers.cookie, "sid=abc");
  assert.deepEqual(calls[0].body, { gen_id: "asset-1", source_url: "https://example.com/path" });
  assert.equal(result.produced.remote_id, 987);
  assert.equal(result.request_plan.host, "hiflyworks-api.lingverse.co");
});

test("real_live rejects unsafe produced variable names and values", async () => {
  for (const stepPatch of [
    {
      produces: { access_token: "$response.body.data.token" },
      responseBody: { data: { token: "private" } }
    },
    {
      produces: { remote_id: "$response.body.data.url" },
      responseBody: { data: { url: "https://example.invalid/video.mp4?sign=private" } }
    },
    {
      produces: { remote_id: "$response.body.data.path" },
      responseBody: { data: { path: "/Users/private/video.mp4" } }
    },
    {
      produces: { remote_id: "$response.body.data.payload" },
      responseBody: { data: { payload: { id: "nested" } } }
    }
  ]) {
    let called = false;
    const client = createRealLiveHttpClient({
      manifest: manifestWith({
        produces: stepPatch.produces,
        risk: { requires_auth: false, may_consume_points: false, replayability: "unknown" }
      }),
      config: { enabled: true },
      transport: {
        request: async () => {
          called = true;
          return { status: 200, headers: {}, body: stepPatch.responseBody };
        }
      }
    });
    await assert.rejects(
      client.request({
        stepId: "submit_video",
        variables: { asset_id: "asset-1" },
        context: { allowRealLive: true }
      }),
      { code: "CAPTURE_HTTP_PRODUCES_UNSAFE" }
    );
    assert.equal(called, true);
  }
});

test("real_live uses per-request runtime auth headers", async () => {
  const calls = [];
  const client = createRealLiveHttpClient({
    manifest: manifestWith(),
    config: { enabled: true },
    runtimeAuth: {
      headersForUrl(url) {
        return url.includes("hiflyworks-api.lingverse.co")
          ? { cookie: "api-cookie-only" }
          : { cookie: "wrong-host-cookie" };
      }
    },
    transport: {
      request: async (request) => {
        calls.push(request);
        return { status: 200, headers: {}, body: { code: 0, data: { list: [{ id: 987, status: 1 }] } } };
      }
    }
  });
  await client.request({
    stepId: "submit_video",
    variables: { asset_id: "asset-1" },
    context: { allowRealLive: true, acknowledgePointRisk: true }
  });
  assert.equal(calls[0].headers.cookie, "api-cookie-only");
});

test("real_live rejects non-2xx transport responses before producing variables", async () => {
  const client = createRealLiveHttpClient({
    manifest: manifestWith(),
    config: { enabled: true },
    runtimeAuth: { headers: { cookie: "in-memory-only" } },
    transport: {
      request: async () => ({
        status: 401,
        headers: {},
        body: { code: 401, message: "login required", data: { list: [{ id: 987 }] } }
      })
    }
  });
  await assert.rejects(
    client.request({
      stepId: "submit_video",
      variables: { asset_id: "asset-1" },
      context: { allowRealLive: true, acknowledgePointRisk: true }
    }),
    { code: "CAPTURE_HTTP_STATUS_NOT_OK" }
  );
});

test("real_live rejects non-zero Hifly response codes before producing variables", async () => {
  const client = createRealLiveHttpClient({
    manifest: manifestWith(),
    config: { enabled: true },
    runtimeAuth: { headers: { authorization: "Bearer in-memory-only" } },
    transport: {
      request: async () => ({
        status: 200,
        headers: {},
        body: { code: 12, message: "用户未认证" }
      })
    }
  });
  await assert.rejects(
    client.request({
      stepId: "submit_video",
      variables: { asset_id: "asset-1" },
      context: { allowRealLive: true, acknowledgePointRisk: true }
    }),
    { code: "CAPTURE_HTTP_REMOTE_REJECTED" }
  );
});

test("real_live uploads product bytes after receiving an upload URL", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-real-live-upload-"));
  try {
    const imagePath = path.join(root, "product.jpeg");
    await writeFile(imagePath, new Uint8Array([9, 8, 7, 6]));
    const calls = [];
    const client = createRealLiveHttpClient({
      manifest: {
        schema_version: 1,
        sanitized: true,
        source: "test",
        captured_at: "2026-07-18T00:00:00.000Z",
        steps: [{
          id: "upload_image_001",
          phase: "asset_generation",
          method: "POST",
          url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/upload_url",
          placeholders: [],
          request_template: {
            headers: { "content-type": "application/json" },
            body: { extension: "jpeg", media_type: 3 }
          },
          response: { status: 200, body: { code: 0, data: {} } },
          produces: { goods_image_oss_key: "$response.body.data.oss_key" },
          risk: { requires_auth: true, may_consume_points: false, replayability: "unknown" }
        }]
      },
      config: { enabled: true },
      runtimeAuth: { headers: { authorization: "Bearer in-memory-only" } },
      transport: {
        request: async (request) => {
          calls.push(request);
          if (request.method === "PUT") return { status: 200, headers: {}, body: {} };
          return {
            status: 200,
            headers: {},
            body: {
              code: 0,
              data: {
                safe_url: "https://prod-metarium.oss-cn-shanghai.aliyuncs.com/public/product.jpeg?Expires=1&Signature=test",
                oss_key: "public/hf/local/100/images/product.jpeg",
                content_type: "image/jpeg"
              }
            }
          };
        }
      }
    });
    const result = await client.request({
      stepId: "upload_image_001",
      variables: { product_image_path: imagePath },
      context: { allowRealLive: true, acknowledgePointRisk: true }
    });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[1].method, "PUT");
    assert.equal(calls[1].url.startsWith("https://prod-metarium.oss-cn-shanghai.aliyuncs.com/"), true);
    assert.deepEqual([...calls[1].body], [9, 8, 7, 6]);
    assert.equal(calls[1].headers["content-type"], "image/jpeg");
    assert.equal(result.produced.goods_image_oss_key, "public/hf/local/100/images/product.jpeg");
    assert.equal(JSON.stringify(result).includes("Signature=test"), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real_live polls until produced variables appear for GET steps", async () => {
  const calls = [];
  const client = createRealLiveHttpClient({
    manifest: {
      schema_version: 1,
      sanitized: true,
      source: "test",
      captured_at: "2026-07-18T00:00:00.000Z",
      steps: [{
        id: "poll_hands_on_image_ready",
        phase: "asset_generation",
        method: "GET",
        url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/goods_holding_image_generation?identifier=goods",
        placeholders: [],
        request_template: { headers: {}, body: null },
        response: { status: 200, body: { code: 0, data: {} } },
        produces: { asset_id: "$response.body.data.gen_id" },
        risk: { requires_auth: true, may_consume_points: false, replayability: "unknown" }
      }]
    },
    config: { enabled: true, pollAttempts: 3, pollIntervalMs: 0 },
    runtimeAuth: { headers: { authorization: "Bearer in-memory-only" } },
    transport: {
      request: async (request) => {
        calls.push(request);
        return {
          status: 200,
          headers: {},
          body: calls.length < 2
            ? { code: 0, data: { status: 2 } }
            : { code: 0, data: { status: 3, gen_id: "asset-ready" } }
        };
      }
    }
  });
  const result = await client.request({
    stepId: "poll_hands_on_image_ready",
    variables: {},
    context: { allowRealLive: true, acknowledgePointRisk: true }
  });
  assert.equal(calls.length, 2);
  assert.equal(result.produced.asset_id, "asset-ready");
});

test("real_live downloads artifact bytes from a matched video list URL without exposing the URL", async () => {
  const calls = [];
  let listCalls = 0;
  const client = createRealLiveHttpClient({
    manifest: {
      schema_version: 1,
      sanitized: true,
      source: "test",
      captured_at: "2026-07-18T00:00:00.000Z",
      steps: [{
        id: "download_video",
        phase: "download",
        method: "GET",
        url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos?id=0&identifier=goods",
        placeholders: ["{{remote_id}}"],
        request_template: { headers: {}, body: null },
        response: { status: 200, body: { code: 0, data: { list: [] } } },
        produces: { artifact_filename: "$response.body.data.list.0.title" },
        risk: { requires_auth: true, may_consume_points: false, replayability: "unknown" }
      }]
    },
    config: { enabled: true, pollAttempts: 3, pollIntervalMs: 0 },
    runtimeAuth: { headers: { authorization: "Bearer in-memory-only" } },
    transport: {
      request: async (request) => {
        calls.push(request);
        if (request.url.startsWith("https://hfcdn.lingverse.co/")) {
          return {
            status: 200,
            headers: { "content-type": "video/mp4" },
            body: { artifact_filename: "verified.mp4" },
            artifact: { bytes: new Uint8Array([1, 2, 3]), filename: "verified.mp4" }
          };
        }
        listCalls += 1;
        return {
          status: 200,
          headers: {},
          body: {
            code: 0,
            data: {
              list: listCalls < 2
                ? [
                    { id: 100, title: "old", url: "https://hfcdn.lingverse.co/videos/old.mp4", preview_url: "https://hfcdn.lingverse.co/previews/old.png" },
                    { id: 640477, title: "未命名", status: 1 }
                  ]
                : [
                    { id: 100, title: "old", url: "https://hfcdn.lingverse.co/videos/old.mp4", preview_url: "https://hfcdn.lingverse.co/previews/old.png" },
                    { id: 640477, title: "未命名", status: 2, url: "https://hfcdn.lingverse.co/videos/current.mp4", preview_url: "https://hfcdn.lingverse.co/previews/current.png" }
                  ]
            }
          }
        };
      }
    }
  });
  const result = await client.request({
    stepId: "download_video",
    variables: { remote_id: 640477 },
    context: { allowRealLive: true, acknowledgePointRisk: true }
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[2].url, "https://hfcdn.lingverse.co/videos/current.mp4");
  assert.deepEqual([...result.artifact.bytes], [1, 2, 3]);
  assert.equal(result.artifact.filename, "verified.mp4");
  assert.equal(result.produced.artifact_filename, "未命名");
  assert.equal(JSON.stringify(result).includes("current.mp4"), false);
  assert.equal(JSON.stringify(result).includes("preview_url"), false);
});

test("real_live refuses artifact URLs outside the artifact host allowlist", async () => {
  const calls = [];
  const client = createRealLiveHttpClient({
    manifest: {
      schema_version: 1,
      sanitized: true,
      source: "test",
      captured_at: "2026-07-18T00:00:00.000Z",
      steps: [{
        id: "download_video",
        phase: "download",
        method: "GET",
        url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos?id=0&identifier=goods",
        placeholders: ["{{remote_id}}"],
        request_template: { headers: {}, body: null },
        response: { status: 200, body: { code: 0, data: { list: [] } } },
        produces: { artifact_filename: "$response.body.data.list.0.title" },
        risk: { requires_auth: true, may_consume_points: false, replayability: "unknown" }
      }]
    },
    config: { enabled: true, artifactAllowedHosts: ["hfcdn.lingverse.co"] },
    runtimeAuth: { headers: { authorization: "Bearer in-memory-only" } },
    transport: {
      request: async (request) => {
        calls.push(request);
        return {
          status: 200,
          headers: {},
          body: {
            code: 0,
            data: {
              list: [{ id: "work-1", title: "blocked", url: "https://example.invalid/video.mp4" }]
            }
          }
        };
      }
    }
  });
  await assert.rejects(
    client.request({
      stepId: "download_video",
      variables: { remote_id: "work-1" },
      context: { allowRealLive: true, acknowledgePointRisk: true }
    }),
    { code: "CAPTURE_HTTP_ARTIFACT_URL_UNAVAILABLE" }
  );
  assert.equal(calls.length, 1);
});
