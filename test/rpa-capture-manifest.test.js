import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CAPTURE_PHASES,
  parseCaptureManifest,
  loadCaptureManifest,
  selectStepsByPhase,
  findStep
} from "../src/rpa/capture/manifest.js";

const SAMPLE = {
  schema_version: 1,
  source: "hifly_goods",
  captured_at: "2026-07-16T00:00:00Z",
  sanitized: true,
  steps: [
    {
      id: "upload_product_image",
      phase: "asset_generation",
      method: "POST",
      url_template: "https://hifly.cc/api/goods/upload",
      placeholders: ["{{product_image_path}}"],
      response: { status: 200, body: { code: 0, data: { image_id: "img-1" } } },
      produces: { product_image_id: "$response.body.data.image_id" }
    },
    {
      id: "submit_video",
      phase: "remote_submit",
      method: "POST",
      url_template: "https://hifly.cc/api/goods/submit",
      placeholders: ["{{asset_id}}"],
      response: { status: 200, body: { code: 0, data: { work_id: "632410" } } },
      produces: { remote_id: "$response.body.data.work_id" }
    }
  ]
};

test("parses a valid sanitized manifest", () => {
  const manifest = parseCaptureManifest(SAMPLE);
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.sanitized, true);
  assert.equal(manifest.steps.length, 2);
  assert.equal(Object.isFrozen(manifest), true);
});

test("selectStepsByPhase and findStep work", () => {
  const manifest = parseCaptureManifest(SAMPLE);
  assert.equal(selectStepsByPhase(manifest, "remote_submit").length, 1);
  assert.equal(findStep(manifest, "submit_video").method, "POST");
  assert.equal(findStep(manifest, "missing"), null);
});

test("rejects unsupported schema version", () => {
  assert.throws(() => parseCaptureManifest({ ...SAMPLE, schema_version: 2 }), /schema_version must be 1/);
});

test("rejects manifest that was not sanitized", () => {
  assert.throws(() => parseCaptureManifest({ ...SAMPLE, sanitized: false }), /sanitized/);
});

test("rejects duplicate step ids", () => {
  const bad = { ...SAMPLE, steps: [SAMPLE.steps[0], { ...SAMPLE.steps[0] }] };
  assert.throws(() => parseCaptureManifest(bad), /duplicate step id/i);
});

test("rejects unknown phase", () => {
  const bad = { ...SAMPLE, steps: [{ ...SAMPLE.steps[0], phase: "unknown_phase" }] };
  assert.throws(() => parseCaptureManifest(bad), /unknown phase/i);
});

test("redaction gate rejects a manifest still carrying cookies", () => {
  const bad = {
    ...SAMPLE,
    steps: [{ ...SAMPLE.steps[0], request: { headers: { cookie: "sid=secret" } } }]
  };
  assert.throws(() => parseCaptureManifest(bad), /sensitive/i);
});

test("loadCaptureManifest reads and parses a file", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "capture-manifest-"));
  try {
    const file = path.join(dir, "manifest.json");
    await writeFile(file, JSON.stringify(SAMPLE));
    const manifest = await loadCaptureManifest(file);
    assert.equal(manifest.steps.length, 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("CAPTURE_PHASES lists the four executor phases", () => {
  assert.deepEqual(CAPTURE_PHASES, ["asset_generation", "remote_submit", "remote_query", "download"]);
});
