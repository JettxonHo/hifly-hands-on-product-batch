import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { extractRawStepsFromHar } from "../src/rpa/capture/har-extractor.js";

function har(entries) {
  return { log: { version: "1.2", creator: { name: "test", version: "1" }, entries } };
}

function entry({ url, method = "POST", status = 200, body = { ok: true }, mimeType = "application/json" }) {
  return {
    request: {
      method,
      url,
      headers: [{ name: "content-type", value: "application/json" }]
    },
    response: {
      status,
      headers: [{ name: "content-type", value: mimeType }],
      content: { mimeType, text: typeof body === "string" ? body : JSON.stringify(body) }
    }
  };
}

test("extracts hifly JSON requests from HAR and skips static assets", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "har-extractor-"));
  const harPath = path.join(root, "sample.har");
  await writeFile(harPath, JSON.stringify(har([
    entry({ url: "https://hifly.cc/api/goods/upload", body: { code: 0, data: { image_id: "img-1" } } }),
    entry({ url: "https://hifly.cc/assets/app.js", method: "GET", body: "console.log(1)", mimeType: "application/javascript" }),
    entry({ url: "https://example.com/api/goods/upload", body: { ignored: true } })
  ])));

  const raw = await extractRawStepsFromHar({ harPath });

  assert.equal(raw.source, "hifly_goods");
  assert.equal(raw.steps.length, 1);
  assert.equal(raw.steps[0].id, "candidate_001");
  assert.equal(raw.steps[0].phase, "unclassified");
  assert.equal(raw.steps[0].method, "POST");
  assert.equal(raw.steps[0].url_template, "https://hifly.cc/api/goods/upload");
  assert.deepEqual(raw.steps[0].response.body, { code: 0, data: { image_id: "img-1" } });
});

test("writes extracted raw steps when outputPath is supplied", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "har-extractor-write-"));
  const harPath = path.join(root, "sample.har");
  const outputPath = path.join(root, "raw-steps.json");
  await writeFile(harPath, JSON.stringify(har([
    entry({ url: "https://hifly.cc/api/goods/status/work-1", method: "GET", body: { code: 0, data: { status: "ready" } } })
  ])));

  await extractRawStepsFromHar({ harPath, outputPath });
  const written = JSON.parse(await readFile(outputPath, "utf8"));

  assert.equal(written.steps.length, 1);
  assert.equal(written.steps[0].method, "GET");
});
