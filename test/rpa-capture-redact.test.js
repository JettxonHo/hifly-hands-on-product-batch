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
      request: { headers: { "content-type": "multipart/form-data", cookie: "sid=x", authorization: "Bearer t" } },
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
  assert.deepEqual(step.request.headers, { "content-type": "multipart/form-data" });
  assert.equal(step.response.headers, undefined);
  assert.ok(report.removed.some((p) => p.includes("cookie")));
  assert.ok(report.removed.some((p) => p.includes("authorization")));
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

test("output is loadable by parseCaptureManifest", () => {
  const { sanitized } = redactCaptureSource(RAW);
  const manifest = parseCaptureManifest(sanitized);
  assert.equal(manifest.sanitized, true);
});

test("report is safe: only paths, no secret values", () => {
  const { report } = redactCaptureSource(RAW);
  const blob = JSON.stringify(report);
  assert.equal(blob.includes("sid=x"), false);
  assert.equal(blob.includes("Bearer t"), false);
  assert.equal(blob.includes("secret"), false);
});
