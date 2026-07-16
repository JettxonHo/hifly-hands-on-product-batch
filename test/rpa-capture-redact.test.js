import test from "node:test";
import assert from "node:assert/strict";
import { redactCaptureSource } from "../src/rpa/capture/redact.js";
import { parseCaptureManifest } from "../src/rpa/capture/manifest.js";

const RAW = {
  source: "hifly_goods",
  captured_at: "2026-07-16T00:00:00Z",
  steps: [
    {
      id: "upload_product_image",
      phase: "asset_generation",
      method: "POST",
      url_template: "https://hifly.cc/api/goods/upload?sign=abc",
      placeholders: ["{{product_image_path}}"],
      request: {
        headers: { "content-type": "multipart/form-data", cookie: "sid=x", authorization: "Bearer t" },
        body: { image_id: "{{product_image_id}}", csrf_token: "private" }
      },
      response: {
        status: 200,
        headers: { "set-cookie": "sid=y" },
        body: { code: 0, data: { image_id: "img-1", access_token: "secret" } }
      },
      produces: { product_image_id: "$response.body.data.image_id" }
    }
  ]
};

test("strips sensitive request/response headers", () => {
  const { sanitized, report } = redactCaptureSource(RAW);
  const step = sanitized.steps[0];
  assert.deepEqual(step.request_template.headers, { "content-type": "multipart/form-data" });
  assert.deepEqual(step.request_template.body, { image_id: "{{product_image_id}}" });
  assert.equal(step.request, undefined);
  assert.equal(step.response.headers, undefined);
  assert.ok(report.removed.some((p) => p.includes("cookie")));
  assert.ok(report.removed.some((p) => p.includes("authorization")));
  assert.ok(report.removed.some((p) => p.includes("csrf_token")));
  assert.ok(report.removed.some((p) => p.includes("set-cookie")));
});

test("removes sensitive body fields and records them", () => {
  const { sanitized, report } = redactCaptureSource(RAW);
  assert.equal(sanitized.steps[0].response.body.data.access_token, undefined);
  assert.equal(sanitized.steps[0].response.body.data.image_id, "img-1");
  assert.ok(report.removed.some((p) => p.includes("access_token")));
});

test("drops sensitive url query params", () => {
  const { sanitized } = redactCaptureSource(RAW);
  assert.equal(sanitized.steps[0].url_template, "https://hifly.cc/api/goods/upload");
});

test("preserves literal query placeholders while dropping sensitive query keys", () => {
  const { sanitized } = redactCaptureSource({
    ...RAW,
    steps: [{
      ...RAW.steps[0],
      url_template: "https://hifly.cc/api/goods/status?id={{asset_id}}&remote_id={{remote_id}}&api_key=private"
    }]
  });
  assert.equal(
    sanitized.steps[0].url_template,
    "https://hifly.cc/api/goods/status?id={{asset_id}}&remote_id={{remote_id}}"
  );
});

test("output is loadable by parseCaptureManifest", () => {
  const { sanitized } = redactCaptureSource(RAW);
  const manifest = parseCaptureManifest(sanitized);
  assert.equal(manifest.sanitized, true);
});

test("preserves usable request templates and risk metadata", () => {
  const { sanitized } = redactCaptureSource({
    ...RAW,
    steps: [{
      ...RAW.steps[0],
      request_template: {
        headers: { "content-type": "application/json", authorization: "Bearer t" },
        body: { image_id: "{{product_image_id}}", token: "private" }
      },
      risk: { requires_auth: true, may_consume_points: true, replayability: "unknown" }
    }]
  });
  assert.deepEqual(sanitized.steps[0].request_template, {
    headers: { "content-type": "application/json" },
    body: { image_id: "{{product_image_id}}" }
  });
  assert.deepEqual(sanitized.steps[0].risk, {
    requires_auth: true,
    may_consume_points: true,
    replayability: "unknown"
  });
  assert.deepEqual(parseCaptureManifest(sanitized).steps[0].request_template, sanitized.steps[0].request_template);
});

test("removes common credential keys from headers and bodies before manifest validation", () => {
  const { sanitized, report } = redactCaptureSource({
    ...RAW,
    steps: [{
      ...RAW.steps[0],
      request_template: {
        headers: { "x-api-key": "private", credential: "private", "content-type": "application/json" },
        body: { password: "private", passwd: "private", api_key: "private", nested: { credential: "private" } }
      },
      response: { ...RAW.steps[0].response, body: { data: { private_key: "private", image_id: "img-1" } } }
    }]
  });
  assert.deepEqual(sanitized.steps[0].request_template, { headers: { "content-type": "application/json" }, body: { nested: {} } });
  assert.deepEqual(sanitized.steps[0].response.body, { data: { image_id: "img-1" } });
  assert.equal(report.removed.some((entry) => entry.includes("x-api-key")), true);
  assert.equal(parseCaptureManifest(sanitized).sanitized, true);
});

test("report is safe: only paths, no secret values", () => {
  const { report } = redactCaptureSource(RAW);
  const blob = JSON.stringify(report);
  assert.equal(blob.includes("sid=x"), false);
  assert.equal(blob.includes("Bearer t"), false);
  assert.equal(blob.includes("secret"), false);
});
