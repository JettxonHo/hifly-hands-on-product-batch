import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { extractRawStepsFromHar } from "../src/rpa/capture/har-extractor.js";

function har(entries) {
  return { log: { version: "1.2", creator: { name: "test", version: "1" }, entries } };
}

function entry({
  url,
  method = "POST",
  status = 200,
  body = { ok: true },
  requestBody = null,
  mimeType = "application/json"
}) {
  return {
    request: {
      method,
      url,
      headers: [{ name: "content-type", value: "application/json" }],
      ...(requestBody ? { postData: { mimeType: "application/json", text: JSON.stringify(requestBody) } } : {})
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

test("classifies hiflyworks goods-in-hand requests into replayable phases", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "har-extractor-hiflyworks-"));
  const harPath = path.join(root, "sample.har");
  await writeFile(harPath, JSON.stringify(har([
    entry({
      url: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/goods_holding_image_generation?identifier=old",
      method: "GET",
      body: {
        code: 0,
        data: {
          status: 3,
          gen_id: "old-gen",
          image_url: "https://example.invalid/old.png",
          human_image_oss_key: "old-human/key.png",
          goods_image_oss_key: "old-goods/key.png"
        }
      }
    }),
    entry({
      url: "https://hiflyworks-api.lingverse.co/api/app/v1/upload_url",
      requestBody: { extension: "png", media_type: "image" },
      body: { code: 0, data: { oss_key: "goods/key.png", public_url: "https://example.invalid/goods.png" } }
    }),
    entry({
      url: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/goods_holding_image_generation",
      requestBody: {
        identifier: "identifier-1",
        human_image_oss_key: "human/key.png",
        goods_image_oss_key: "goods/key.png",
        goods_size: "auto"
      },
      body: { code: 0, data: {} }
    }),
    entry({
      url: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/goods_holding_image_generation?identifier=identifier-1",
      method: "GET",
      body: {
        code: 0,
        data: {
          status: 3,
          gen_id: "gen-1",
          image_url: "https://example.invalid/asset.png",
          human_image_oss_key: "human/key.png",
          goods_image_oss_key: "goods/key.png"
        }
      }
    }),
    entry({
      url: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos",
      requestBody: { gen_id: "gen-1", text: "hello" },
      body: { code: 0, data: {} }
    }),
    entry({
      url: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos?id=gen-1&identifier=identifier-1",
      method: "GET",
      body: { code: 0, data: { list: [{ id: "work-1", status: 1, preview_url: "https://example.invalid/p.png" }] } }
    }),
    entry({
      url: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos?id=gen-1&identifier=identifier-1",
      method: "GET",
      body: {
        code: 0,
        data: { list: [{ id: "work-1", title: "work-1", status: 2, url: "https://example.invalid/work-1.mp4" }] }
      }
    }),
    entry({
      url: "https://hiflyworks-api.lingverse.co/api/app/v1/credits_logs",
      method: "GET",
      body: { code: 0, data: [] }
    })
  ])));

  const raw = await extractRawStepsFromHar({ harPath });

  assert.deepEqual(raw.steps.map((step) => step.id), [
    "upload_image_001",
    "create_hands_on_image",
    "poll_hands_on_image_ready",
    "submit_video",
    "poll_video_submitted",
    "download_video"
  ]);
  assert.deepEqual(raw.steps.map((step) => step.phase), [
    "asset_generation",
    "asset_generation",
    "asset_generation",
    "remote_submit",
    "remote_submit",
    "download"
  ]);
  assert.deepEqual(raw.steps[0].produces, { goods_image_oss_key: "$response.body.data.oss_key" });
  assert.deepEqual(raw.steps[2].produces, { asset_id: "$response.body.data.gen_id" });
  assert.deepEqual(raw.steps[4].produces, { remote_id: "$response.body.data.list.0.id" });
  assert.deepEqual(raw.steps[5].produces, { artifact_filename: "$response.body.data.list.0.title" });
  assert.deepEqual(raw.steps[3].request_template, {
    headers: { "content-type": "application/json" },
    body: { gen_id: "{{asset_id}}", text: "hello" }
  });
  assert.deepEqual(raw.steps[3].risk, {
    requires_auth: true,
    may_consume_points: true,
    replayability: "unknown"
  });
  assert.equal(raw.steps[4].url_template.includes("id={{asset_id}}"), true);
});

test("templates short captured ids in URL query values without changing stable path segments", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "har-extractor-short-id-"));
  const harPath = path.join(root, "sample.har");
  await writeFile(harPath, JSON.stringify(har([
    entry({
      url: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/goods_holding_image_generation",
      requestBody: { goods_image_oss_key: "goods/key.png" },
      body: { code: 0, data: {} }
    }),
    entry({
      url: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/goods_holding_image_generation?identifier=short",
      method: "GET",
      body: { code: 0, data: { status: 3, gen_id: "1" } }
    }),
    entry({
      url: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos",
      requestBody: { gen_id: "1" },
      body: { code: 0, data: {} }
    }),
    entry({
      url: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos?id=1&identifier=11&remote_id=remote-123",
      method: "GET",
      body: { code: 0, data: { list: [{ id: "remote-123", status: 1 }] } }
    }),
    entry({
      url: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos?id=1&identifier=11&remote_id=remote-123",
      method: "GET",
      body: { code: 0, data: { list: [{ id: "remote-123", status: 1 }] } }
    })
  ])));

  const raw = await extractRawStepsFromHar({ harPath });
  const submit = raw.steps.find((step) => step.id === "submit_video");
  const query = raw.steps.find((step) => step.id === "poll_video_status");
  assert.equal(submit.url_template.includes("/v1/"), true);
  assert.equal(submit.url_template.includes("{{asset_id}}"), false);
  assert.deepEqual(submit.request_template.body, { gen_id: "{{asset_id}}" });
  assert.equal(query.url_template.includes("/v1/"), true);
  assert.equal(query.url_template.includes("id={{asset_id}}"), true);
  assert.equal(query.url_template.includes("identifier=11"), true);
  assert.equal(query.url_template.includes("remote_id={{remote_id}}"), true);
});
