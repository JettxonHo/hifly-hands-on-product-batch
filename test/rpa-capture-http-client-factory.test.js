import test from "node:test";
import assert from "node:assert/strict";

import { parseCaptureManifest } from "../src/rpa/capture/manifest.js";
import { CAPTURE_HTTP_MODES, createCaptureHttpClient } from "../src/rpa/capture/http-client-factory.js";

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

test("factory refuses real_live until explicitly implemented later", () => {
  assert.throws(
    () => createCaptureHttpClient({ mode: "real_live", manifest: MANIFEST }),
    { code: "CAPTURE_HTTP_REAL_LIVE_DISABLED" }
  );
});
