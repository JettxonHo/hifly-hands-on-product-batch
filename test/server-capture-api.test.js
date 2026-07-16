import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildApp } from "../src/server/app.js";
import { createBatchStore } from "../src/core/batch-store.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { createInitialCaptureState, updateCaptureState } from "../src/rpa/capture/workflow-state.js";

const HOST = "127.0.0.1:4317";
const ORIGIN = `http://${HOST}`;

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-capture-api-"));
  const app = await buildApp({ root, executor: createFakeExecutor() });
  const response = await app.inject({ method: "GET", url: "/api/session", headers: { host: HOST } });
  const session = {
    cookie: response.headers["set-cookie"].split(";")[0],
    token: response.json().token
  };
  return { app, root, session };
}

function headers(session, extra = {}) {
  return {
    host: HOST,
    origin: ORIGIN,
    cookie: session.cookie,
    "x-local-session-token": session.token,
    "content-type": "application/json",
    ...extra
  };
}

function sampleHar() {
  return {
    log: {
      version: "1.2",
      creator: { name: "test", version: "1" },
      entries: [{
        request: {
          method: "POST",
          url: "https://hifly.cc/api/goods/upload",
          headers: [{ name: "content-type", value: "application/json" }]
        },
        response: {
          status: 200,
          headers: [{ name: "content-type", value: "application/json" }],
          content: { mimeType: "application/json", text: "{\"code\":0,\"data\":{\"image_id\":\"img-1\"}}" }
        }
      }]
    }
  };
}

function harEntry({ url, method = "POST", body, requestBody = null }) {
  return {
    request: {
      method,
      url,
      headers: [{ name: "content-type", value: "application/json" }],
      ...(requestBody ? { postData: { mimeType: "application/json", text: JSON.stringify(requestBody) } } : {})
    },
    response: {
      status: 200,
      headers: [{ name: "content-type", value: "application/json" }],
      content: { mimeType: "application/json", text: JSON.stringify(body) }
    }
  };
}

function hiflyworksHar() {
  return {
    log: {
      version: "1.2",
      creator: { name: "test", version: "1" },
      entries: [
        harEntry({
          url: "https://hiflyworks-api.lingverse.co/api/app/v1/upload_url",
          requestBody: { extension: "png", media_type: "image" },
          body: { code: 0, data: { oss_key: "goods/key.png" } }
        }),
        harEntry({
          url: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/goods_holding_image_generation",
          requestBody: { goods_image_oss_key: "goods/key.png" },
          body: { code: 0, data: {} }
        }),
        harEntry({
          url: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/goods_holding_image_generation?identifier=id-1",
          method: "GET",
          body: { code: 0, data: { status: 3, gen_id: "gen-1", image_url: "https://example.invalid/asset.png" } }
        }),
        harEntry({
          url: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos",
          requestBody: { gen_id: "gen-1" },
          body: { code: 0, data: {} }
        }),
        harEntry({
          url: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos?id=gen-1",
          method: "GET",
          body: { code: 0, data: { list: [{ id: 99, status: 1 }] } }
        }),
        harEntry({
          url: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos?id=gen-1",
          method: "GET",
          body: { code: 0, data: { list: [{ id: 99, status: 1 }] } }
        }),
        harEntry({
          url: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos?id=gen-1",
          method: "GET",
          body: { code: 0, data: { list: [{ id: 99, title: "demo.mp4", status: 2, url: "https://example.invalid/demo.mp4" }] } }
        })
      ]
    }
  };
}

function classifiedRawSteps() {
  return {
    source: "hifly_goods",
    captured_at: "2026-07-16T00:00:00Z",
    steps: [
      {
        id: "upload_product_image",
        phase: "asset_generation",
        method: "POST",
        url_template: "https://hifly.cc/api/goods/upload?sign=secret",
        placeholders: ["{{product_image_path}}"],
        request: { headers: { cookie: "sid=private", "content-type": "application/json" } },
        response: {
          status: 200,
          headers: { "set-cookie": "sid=private" },
          body: { code: 0, data: { image_id: "img-1", token: "private-token" } }
        },
        produces: { product_image_id: "$response.body.data.image_id" }
      },
      {
        id: "upload_person_image",
        phase: "asset_generation",
        method: "POST",
        url_template: "https://hifly.cc/api/goods/upload",
        placeholders: ["{{person_image_path}}"],
        response: { status: 200, body: { code: 0, data: { image_id: "person-1" } } },
        produces: { person_image_id: "$response.body.data.image_id" }
      },
      {
        id: "create_hands_on_image",
        phase: "asset_generation",
        method: "POST",
        url_template: "https://hifly.cc/api/goods/hands-on",
        placeholders: ["{{product_image_id}}", "{{person_image_id}}"],
        response: { status: 200, body: { code: 0, data: { asset_id: "asset-1" } } },
        produces: { asset_id: "$response.body.data.asset_id" }
      },
      {
        id: "submit_video",
        phase: "remote_submit",
        method: "POST",
        url_template: "https://hifly.cc/api/goods/submit",
        placeholders: ["{{asset_id}}"],
        response: { status: 200, body: { code: 0, data: { work_id: "work-1" } } },
        produces: { remote_id: "$response.body.data.work_id" }
      },
      {
        id: "download_video",
        phase: "download",
        method: "GET",
        url_template: "https://hifly.cc/api/goods/download/{{remote_id}}",
        placeholders: ["{{remote_id}}"],
        response: { status: 200, body: { code: 0, data: { filename: "work-1.mp4" } } },
        produces: { artifact_filename: "$response.body.data.filename" }
      }
    ]
  };
}

test("extract capture API writes raw steps and updates batch state", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = createBatchStore(path.join(root, "batches"));
  const harPath = "rpa/capture/raw/batch-capture.har";
  await mkdir(path.join(root, "rpa", "capture", "raw"), { recursive: true });
  await writeFile(path.join(root, harPath), JSON.stringify(sampleHar()));
  await store.create({
    batch_id: "batch-capture-api",
    status: "completed",
    items: [],
    uploads: [],
    capture: updateCaptureState(createInitialCaptureState({ enabled: true }), {
      status: "recorded",
      har_path: harPath
    })
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/batches/batch-capture-api/capture/extract",
    headers: headers(session),
    payload: {}
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().batch.capture.status, "extracted");
  assert.equal(response.json().batch.capture.raw_steps_path, "batches/batch-capture-api/capture/raw-steps.json");
  const raw = JSON.parse(await readFile(path.join(root, "batches", "batch-capture-api", "capture", "raw-steps.json"), "utf8"));
  assert.equal(raw.steps.length, 1);
});

test("redact and replay capture APIs produce a sanitized manifest and replay status", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = createBatchStore(path.join(root, "batches"));
  const rawStepsRelativePath = "batches/batch-redact-replay/capture/raw-steps.json";
  await store.create({
    batch_id: "batch-redact-replay",
    status: "completed",
    items: [],
    uploads: [],
    capture: updateCaptureState(createInitialCaptureState({ enabled: true }), {
      status: "extracted",
      raw_steps_path: rawStepsRelativePath
    })
  });
  await mkdir(path.join(root, "batches", "batch-redact-replay", "capture"), { recursive: true });
  await writeFile(path.join(root, rawStepsRelativePath), JSON.stringify(classifiedRawSteps()));

  const redacted = await app.inject({
    method: "POST",
    url: "/api/batches/batch-redact-replay/capture/redact",
    headers: headers(session),
    payload: {}
  });
  const replayed = await app.inject({
    method: "POST",
    url: "/api/batches/batch-redact-replay/capture/replay",
    headers: headers(session),
    payload: {}
  });

  assert.equal(redacted.statusCode, 200);
  assert.equal(redacted.json().batch.capture.status, "redacted");
  assert.equal(redacted.json().batch.capture.manifest_path, "batches/batch-redact-replay/capture/manifest.json");
  const manifestText = await readFile(path.join(root, "batches", "batch-redact-replay", "capture", "manifest.json"), "utf8");
  assert.equal(manifestText.includes("private-token"), false);
  assert.equal(manifestText.includes("cookie"), false);
  assert.equal(replayed.statusCode, 200);
  assert.equal(replayed.json().batch.capture.status, "replay_passed");
  assert.equal(replayed.json().batch.capture.replay_summary.remote_id, "work-1");
});

test("capture APIs can process a hiflyworks HAR through offline replay", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = createBatchStore(path.join(root, "batches"));
  const harPath = "rpa/capture/raw/batch-hiflyworks.har";
  await mkdir(path.join(root, "rpa", "capture", "raw"), { recursive: true });
  await writeFile(path.join(root, harPath), JSON.stringify(hiflyworksHar()));
  await store.create({
    batch_id: "batch-hiflyworks",
    status: "completed",
    items: [],
    uploads: [],
    capture: updateCaptureState(createInitialCaptureState({ enabled: true }), {
      status: "recorded",
      har_path: harPath
    })
  });

  const extracted = await app.inject({
    method: "POST",
    url: "/api/batches/batch-hiflyworks/capture/extract",
    headers: headers(session),
    payload: {}
  });
  const redacted = await app.inject({
    method: "POST",
    url: "/api/batches/batch-hiflyworks/capture/redact",
    headers: headers(session),
    payload: {}
  });
  const replayed = await app.inject({
    method: "POST",
    url: "/api/batches/batch-hiflyworks/capture/replay",
    headers: headers(session),
    payload: {}
  });

  assert.equal(extracted.statusCode, 200);
  assert.equal(extracted.json().batch.capture.extract_summary.step_count, 7);
  assert.equal(redacted.statusCode, 200);
  assert.equal(replayed.statusCode, 200);
  assert.equal(replayed.json().batch.capture.status, "replay_passed");
  assert.equal(replayed.json().batch.capture.replay_summary.remote_id, 99);
  assert.equal(replayed.json().batch.capture.replay_summary.artifact_filename, "demo.mp4");
});
