import test from "node:test";
import assert from "node:assert/strict";

import { parseCaptureManifest } from "../src/rpa/capture/manifest.js";
import { createDryRunHttpClient } from "../src/rpa/capture/dry-run-http-client.js";

const MANIFEST = parseCaptureManifest({
  schema_version: 1,
  source: "hifly_goods",
  captured_at: "2026-07-16T00:00:00Z",
  sanitized: true,
  steps: [{
    id: "submit_video",
    phase: "remote_submit",
    method: "POST",
    url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos/{{asset_id}}",
    placeholders: ["{{asset_id}}"],
    request_template: {
      headers: { "content-type": "application/json" },
      body: { gen_id: "{{asset_id}}" }
    },
    risk: { requires_auth: true, may_consume_points: true, replayability: "unknown" },
    response: { status: 200, body: { data: { list: [{ id: 634505 }] } } },
    produces: { remote_id: "$response.body.data.list.0.id" }
  }]
});

test("dry-run builds a resolved request plan without network access", async () => {
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("network should not be called");
  };
  try {
    const client = createDryRunHttpClient({ manifest: MANIFEST });
    const result = await client.request({ stepId: "submit_video", variables: { asset_id: "asset-1" } });
    assert.equal(fetchCalled, false);
    assert.equal(result.status, 200);
    assert.deepEqual(result.produced, { remote_id: 634505 });
    assert.deepEqual(result.request_plan, {
      step_id: "submit_video",
      phase: "remote_submit",
      method: "POST",
      host: "hiflyworks-api.lingverse.co",
      path: "/api/app/v1/one_stop/goods_in_hand/videos/asset-1",
      url: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos/asset-1",
      headers: { "content-type": "application/json" },
      body: { gen_id: "asset-1" },
      placeholders: ["asset_id"],
      risk_flags: ["auth_required", "may_consume_points", "replayability_unknown"]
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("dry-run rejects unresolved placeholders", async () => {
  const client = createDryRunHttpClient({ manifest: MANIFEST });
  await assert.rejects(
    () => client.request({ stepId: "submit_video", variables: {} }),
    { code: "CAPTURE_HTTP_UNRESOLVED_PLACEHOLDER" }
  );
});

test("dry-run marks api_unavailable steps", async () => {
  const manifest = parseCaptureManifest({
    ...MANIFEST,
    steps: [{ ...MANIFEST.steps[0], risk: { replayability: "api_unavailable" } }]
  });
  const client = createDryRunHttpClient({ manifest });
  await assert.rejects(
    () => client.request({ stepId: "submit_video", variables: { asset_id: "asset-1" } }),
    { code: "CAPTURE_HTTP_API_UNAVAILABLE" }
  );
});
