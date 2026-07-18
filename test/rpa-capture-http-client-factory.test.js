import test from "node:test";
import assert from "node:assert/strict";

import { parseCaptureManifest } from "../src/rpa/capture/manifest.js";
import { CAPTURE_HTTP_MODES, createCaptureHttpClient, normalizeCaptureHttpMode } from "../src/rpa/capture/http-client-factory.js";

const MANIFEST = parseCaptureManifest({
  schema_version: 1,
  source: "hifly_goods",
  captured_at: "2026-07-16T00:00:00Z",
  sanitized: true,
  steps: [{
    id: "poll",
    phase: "remote_query",
    method: "GET",
    url_template: "https://example.test/{{remote_id}}",
    placeholders: ["{{remote_id}}"],
    response: { status: 200, body: { data: { ok: true } } }
  }]
});

test("factory defaults to mock mode", async () => {
  assert.deepEqual(CAPTURE_HTTP_MODES, ["mock", "real_dry_run", "real_live"]);
  const client = createCaptureHttpClient({ manifest: MANIFEST });
  const result = await client.request({ stepId: "poll", variables: { remote_id: "work-1" } });
  assert.equal(result.status, 200);
  assert.equal(result.request_plan, undefined);
});

test("factory creates dry-run mode", async () => {
  const client = createCaptureHttpClient({ mode: "real_dry_run", manifest: MANIFEST });
  const result = await client.request({ stepId: "poll", variables: { remote_id: "work-1" } });
  assert.equal(result.request_plan.url, "https://example.test/work-1");
});

test("factory rejects invalid mode", () => {
  assert.throws(
    () => createCaptureHttpClient({ mode: "surprise", manifest: MANIFEST }),
    { code: "CAPTURE_HTTP_MODE_INVALID" }
  );
});

test("factory rejects falsy configured modes instead of silently selecting mock", () => {
  for (const mode of ["", null, false, 0]) {
    assert.throws(
      () => normalizeCaptureHttpMode(mode),
      { code: "CAPTURE_HTTP_MODE_INVALID" },
      `mode ${String(mode)} must be rejected`
    );
  }
});

test("factory creates a gated real_live mode", async () => {
  const client = createCaptureHttpClient({ mode: "real_live", manifest: MANIFEST });
  await assert.rejects(
    client.request({ stepId: "poll", variables: { remote_id: "work-1" }, context: { allowRealLive: true } }),
    { code: "CAPTURE_HTTP_REAL_LIVE_DISABLED" }
  );
});

test("factory passes real_live configuration to the injected transport", async () => {
  const manifest = {
    schema_version: 1,
    sanitized: true,
    source: "test",
    captured_at: "2026-07-17T00:00:00.000Z",
    steps: [{
      id: "live_step",
      phase: "remote_query",
      method: "GET",
      url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/status?id={{remote_id}}",
      placeholders: ["{{remote_id}}"],
      response: { status: 200, body: { data: { id: 12 } } },
      produces: {},
      risk: { requires_auth: false, may_consume_points: false, replayability: "unknown" }
    }]
  };
  let called = false;
  const client = createCaptureHttpClient({
    mode: "real_live",
    manifest,
    config: { enabled: true },
    transport: { request: async () => { called = true; return { status: 200, body: { data: { id: 12 } } }; } }
  });
  await client.request({ stepId: "live_step", variables: { remote_id: "r-1" }, context: { allowRealLive: true } });
  assert.equal(called, true);
});
