import test from "node:test";
import assert from "node:assert/strict";
import { parseCaptureManifest } from "../src/rpa/capture/manifest.js";
import { createMockHttpClient } from "../src/rpa/capture/mock-http-client.js";

const MANIFEST = parseCaptureManifest({
  schema_version: 1,
  source: "hifly_goods",
  captured_at: "2026-07-16T00:00:00Z",
  sanitized: true,
  steps: [
    {
      id: "submit_video",
      phase: "remote_submit",
      method: "POST",
      url_template: "https://hifly.cc/api/goods/submit",
      placeholders: ["{{asset_id}}"],
      response: { status: 200, body: { code: 0, data: { work_id: "{{asset_id}}-work", echo: "{{asset_id}}" } } },
      produces: { remote_id: "$response.body.data.work_id" }
    }
  ]
});

test("replays a recorded response with variable substitution", async () => {
  const client = createMockHttpClient({ manifest: MANIFEST });
  const result = await client.request({ stepId: "submit_video", variables: { asset_id: "asset-9" } });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.work_id, "asset-9-work");
  assert.equal(result.body.data.echo, "asset-9");
  assert.equal(result.produced.remote_id, "asset-9-work");
});

test("throws on unknown step id", async () => {
  const client = createMockHttpClient({ manifest: MANIFEST });
  await assert.rejects(
    () => client.request({ stepId: "nope", variables: {} }),
    (err) => err.code === "CAPTURE_STEP_NOT_FOUND"
  );
});

test("throws when a declared placeholder variable is missing", async () => {
  const client = createMockHttpClient({ manifest: MANIFEST });
  await assert.rejects(
    () => client.request({ stepId: "submit_video", variables: {} }),
    (err) => err.code === "CAPTURE_MISSING_VARIABLE"
  );
});

test("does not expose any network-performing method", () => {
  const client = createMockHttpClient({ manifest: MANIFEST });
  assert.equal(typeof client.request, "function");
  assert.equal(client.fetch, undefined);
});
