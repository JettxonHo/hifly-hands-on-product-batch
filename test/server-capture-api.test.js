import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildApp } from "../src/server/app.js";
import { createBatchStore } from "../src/core/batch-store.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { createDryRunHttpClient } from "../src/rpa/capture/dry-run-http-client.js";
import { CAPTURE_PHASES, loadCaptureManifest, selectStepsByPhase } from "../src/rpa/capture/manifest.js";
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

  const manifestPath = path.join(root, "batches", "batch-hiflyworks", "capture", "manifest.json");
  const manifest = await loadCaptureManifest(manifestPath);
  const submit = manifest.steps.find((step) => step.id === "submit_video");
  assert.deepEqual(submit.request_template, {
    headers: { "content-type": "application/json" },
    body: { gen_id: "{{asset_id}}" }
  });
  assert.deepEqual(submit.risk, {
    requires_auth: true,
    may_consume_points: true,
    replayability: "unknown"
  });
  const client = createDryRunHttpClient({ manifest });
  const variables = { product_image_path: "product.png", person_image_path: "person.png" };
  const requestPlan = [];
  for (const phase of CAPTURE_PHASES) {
    for (const step of selectStepsByPhase(manifest, phase)) {
      const result = await client.request({ stepId: step.id, variables });
      Object.assign(variables, result.produced);
      requestPlan.push(result.request_plan);
    }
  }
  const submitPlan = requestPlan.find((step) => step.step_id === "submit_video");
  assert.deepEqual(submitPlan.headers, { "content-type": "application/json" });
  assert.deepEqual(submitPlan.body, { gen_id: "gen-1" });
  assert.equal(submitPlan.risk_flags.includes("auth_required"), true);
  assert.equal(submitPlan.risk_flags.includes("may_consume_points"), true);
});

test("dry-run capture API stores only a public-safe request plan summary", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-dry-run-api-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await buildApp({ root, openBrowser: async () => {} });
  t.after(() => app.close());
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-dry-run-api",
    status: "completed",
    items: [],
    artifacts: [],
    capture: {
      enabled: true,
      status: "redacted",
      manifest_path: "batches/batch-dry-run-api/capture/manifest.json"
    }
  });
  await mkdir(path.join(root, "batches", "batch-dry-run-api", "capture"), { recursive: true });
  await writeFile(path.join(root, "batches", "batch-dry-run-api", "capture", "manifest.json"), JSON.stringify({
    schema_version: 1,
    source: "hifly_goods",
    captured_at: "2026-07-16T00:00:00Z",
    sanitized: true,
    steps: [{
      id: "poll",
      phase: "remote_query",
      method: "GET",
      url_template: "https://example.test/jobs/{{opaque_context}}?tracking={{opaque_context}}",
      placeholders: ["{{opaque_context}}"],
      request_template: {
        headers: { "x-request-context": "{{opaque_context}}" },
        body: { request_context: "{{opaque_context}}" }
      },
      risk: { requires_auth: true, may_consume_points: true, replayability: "unknown" },
      response: { status: 200, body: { data: { ok: true } } }
    }]
  }));
  const session = await app.inject({ method: "GET", url: "/api/session", headers: { host: "127.0.0.1:4317" } });
  const token = session.json().token;
  const response = await app.inject({
    method: "POST",
    url: "/api/batches/batch-dry-run-api/capture/dry-run",
    headers: {
      host: "127.0.0.1:4317",
      origin: "http://127.0.0.1:4317",
      cookie: session.headers["set-cookie"],
      "x-local-session-token": token,
      "content-type": "application/json"
    },
    payload: { variables: { opaque_context: "non-sensitive-key-secret-value" } }
  });
  assert.equal(response.statusCode, 200);
  const responseBody = response.json();
  const capture = responseBody.batch.capture;
  assert.equal(capture.status, "dry_run_passed");
  assert.equal(capture.dry_run_summary.executed_step_count, 1);
  const [requestPlan] = capture.dry_run_summary.request_plan;
  assert.deepEqual(requestPlan, {
    step_id: "poll",
    phase: "remote_query",
    method: "GET",
    host: "example.test",
    placeholders: ["opaque_context"],
    risk_flags: ["auth_required", "may_consume_points", "replayability_unknown"]
  });
  for (const key of ["path", "headers", "body", "url"]) assert.equal(key in requestPlan, false);
  assert.equal(JSON.stringify(responseBody).includes("non-sensitive-key-secret-value"), false);

  const persisted = JSON.parse(await readFile(path.join(root, "batches", "batch-dry-run-api", "batch.json"), "utf8"));
  assert.equal(JSON.stringify(persisted).includes("non-sensitive-key-secret-value"), false);
});

test("real-live status API records disabled state without network or sensitive details", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const batchId = "batch-real-live-status";
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: batchId,
    status: "completed",
    items: [],
    uploads: [],
    capture: {
      enabled: true,
      status: "dry_run_passed",
      manifest_path: `batches/${batchId}/capture/manifest.json`,
      dry_run_summary: { executed_step_count: 1, request_plan: [] }
    }
  });

  const response = await app.inject({
    method: "POST",
    url: `/api/batches/${batchId}/capture/live-status`,
    headers: headers(session),
    payload: {}
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.batch.capture.status, "real_live_disabled");
  assert.equal(body.batch.capture.live_error.code, "CAPTURE_HTTP_REAL_LIVE_DISABLED");
  assert.equal(JSON.stringify(body).includes(root), false);
  assert.equal(JSON.stringify(body).includes("cookie"), false);
});

test("real-live run API executes one capture item with injected auth and transport", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-capture-live-api-"));
  const authCalls = [];
  const responses = [
    { status: 200, body: { data: { gen_id: "asset-live" } } },
    { status: 200, body: { data: { list: [{ id: "remote-live" }] } } },
    { status: 200, body: { data: { list: [{ id: "remote-live", status: 2 }] } } },
    {
      status: 200,
      body: { artifact_filename: "live-video.mp4" },
      artifact: { bytes: new Uint8Array([5, 6, 7]), filename: "live-video.mp4" }
    }
  ];
  const transportCalls = [];
  const app = await buildApp({
    root,
    executor: createFakeExecutor(),
    captureLive: {
      authProvider: {
        async getRuntimeAuth() {
          authCalls.push("auth");
          return { headers: { cookie: "runtime-cookie-secret" } };
        }
      },
      transport: {
        async request(request) {
          transportCalls.push(request);
          return responses.shift();
        }
      }
    }
  });
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const sessionResponse = await app.inject({ method: "GET", url: "/api/session", headers: { host: HOST } });
  const session = {
    cookie: sessionResponse.headers["set-cookie"].split(";")[0],
    token: sessionResponse.json().token
  };
  const batchId = "batch-live-run";
  const manifestRelativePath = `batches/${batchId}/capture/manifest.json`;
  await mkdir(path.join(root, "batches", batchId, "uploads"), { recursive: true });
  await mkdir(path.join(root, "batches", batchId, "capture"), { recursive: true });
  await writeFile(path.join(root, "batches", batchId, "uploads", "product.png"), "image");
  await writeFile(path.join(root, manifestRelativePath), JSON.stringify({
    schema_version: 1,
    sanitized: true,
    source: "test",
    captured_at: "2026-07-17T00:00:00.000Z",
    steps: [
      {
        id: "create_asset",
        phase: "asset_generation",
        method: "POST",
        url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/upload_url",
        response: { status: 200, body: { data: { gen_id: "asset-live" } } },
        produces: { asset_id: "$response.body.data.gen_id" },
        risk: { requires_auth: true, replayability: "unknown" }
      },
      {
        id: "submit_video",
        phase: "remote_submit",
        method: "POST",
        url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos",
        request_template: { body: { gen_id: "{{asset_id}}" } },
        placeholders: ["{{asset_id}}"],
        response: { status: 200, body: { data: { list: [{ id: "remote-live" }] } } },
        produces: { remote_id: "$response.body.data.list.0.id" },
        risk: { requires_auth: true, may_consume_points: true, replayability: "unknown" }
      },
      {
        id: "query_video",
        phase: "remote_query",
        method: "GET",
        url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos?id={{asset_id}}",
        placeholders: ["{{asset_id}}"],
        response: { status: 200, body: { data: { list: [{ id: "remote-live", status: 2 }] } } },
        risk: { requires_auth: true, replayability: "unknown" }
      },
      {
        id: "download_video",
        phase: "download",
        method: "GET",
        url_template: "https://hiflyworks-api.lingverse.co/api/app/v1/one_stop/goods_in_hand/videos/{{remote_id}}/download",
        placeholders: ["{{remote_id}}"],
        response: { status: 200, body: { artifact_filename: "live-video.mp4" } },
        produces: { artifact_filename: "$response.body.artifact_filename" },
        risk: { requires_auth: true, replayability: "unknown" }
      }
    ]
  }, null, 2));
  await writeFile(path.join(root, "batches", batchId, "batch.json"), JSON.stringify({
    batch_id: batchId,
    status: "completed",
    created_at: "2026-07-17T00:00:00.000Z",
    updated_at: "2026-07-17T00:00:00.000Z",
    uploads: [{ artifact_id: "product-1", kind: "image", storage_name: "product.png" }],
    artifacts: [{ artifact_id: "product-1", relative_path: "uploads/product.png" }],
    items: [{
      task_id: "task-1",
      sku: "SKU-LIVE",
      status: "completed",
      product_image_artifact_id: "product-1"
    }],
    capture: updateCaptureState(createInitialCaptureState({ enabled: true }), {
      status: "dry_run_passed",
      manifest_path: manifestRelativePath
    })
  }, null, 2));

  const response = await app.inject({
    method: "POST",
    url: `/api/batches/${batchId}/capture/live-run`,
    headers: headers(session),
    payload: { confirm: true, allowRealLive: true, acknowledgePointRisk: true, limitItems: 1 }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.batch.capture.status, "real_live_completed");
  assert.equal(body.batch.capture.live_summary.artifact_path, "artifacts/live-video.mp4");
  assert.equal(body.batch.capture.live_summary.remote_id, "remote-live");
  assert.equal(body.batch.items[0].output_path, "artifacts/live-video.mp4");
  assert.equal(authCalls.length, 1);
  assert.equal(transportCalls.length, 4);
  assert.equal(JSON.stringify(body).includes("runtime-cookie-secret"), false);
  assert.deepEqual([...await readFile(path.join(root, "batches", batchId, "artifacts", "live-video.mp4"))], [5, 6, 7]);
});

test("list and detail projections remove legacy full dry-run request details", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-legacy-projection-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await buildApp({ root, openBrowser: async () => {} });
  t.after(() => app.close());
  const store = createBatchStore(path.join(root, "batches"));
  const secret = "legacy-secret-value";
  await store.create({
    batch_id: "batch-legacy-dry-run",
    status: "completed",
    items: [],
    uploads: [],
    capture: {
      enabled: true,
      status: "dry_run_passed",
      dry_run_error: { code: "ATTACK_SECRET", message: `/Users/test/${secret}?token=abc` },
      replay_error: { code: "ATTACK_SECRET", message: `/Users/test/${secret}?token=abc` },
      dry_run_summary: {
        executed_step_count: 1,
        variables: { access_token: secret, safe_value: secret },
        request_plan: [{
          step_id: "submit",
          phase: "remote_submit",
          method: "POST",
          host: "example.test",
          path: `/jobs/${secret}?token=abc`,
          url: `https://example.test/jobs?access_token=${secret}`,
          headers: { authorization: `Bearer ${secret}` },
          body: { secret },
          placeholders: ["access_token", "asset_id"],
          risk_flags: ["auth_required", "may_consume_points", "not-a-real-flag"]
        }]
      }
    }
  });
  const session = await app.inject({ method: "GET", url: "/api/session", headers: { host: HOST } });
  const requestHeaders = headers({ cookie: session.headers["set-cookie"], token: session.json().token });
  const responses = await Promise.all([
    app.inject({ method: "GET", url: "/api/batches", headers: requestHeaders }),
    app.inject({ method: "GET", url: "/api/batches/batch-legacy-dry-run", headers: requestHeaders })
  ]);
  for (const response of responses) {
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.includes(secret), false);
    assert.equal(response.body.includes("token=abc"), false);
    assert.equal(response.body.includes(`/jobs/${secret}?token=abc`), false);
    const capture = response.json().batch?.capture || response.json().batches[0].capture;
    assert.deepEqual(capture.dry_run_error, {
      code: "CAPTURE_DRY_RUN_FAILED",
      message: "Unable to construct the dry-run request plan."
    });
    assert.deepEqual(capture.replay_error, {
      code: "CAPTURE_REPLAY_FAILED",
      message: "Unable to complete the offline replay."
    });
    const [requestPlan] = capture.dry_run_summary.request_plan;
    assert.deepEqual(requestPlan, {
      step_id: "submit",
      phase: "remote_submit",
      method: "POST",
      host: "example.test",
      placeholders: ["asset_id"],
      risk_flags: ["auth_required", "may_consume_points"]
    });
    for (const key of ["path", "url", "headers", "body", "variables"]) assert.equal(key in requestPlan, false);
  }
});

test("list and detail projections normalize legacy live error codes", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = createBatchStore(path.join(root, "batches"));
  const maliciousCode = "https://hiflyworks-api.lingverse.co/jobs?token=secret";
  const batches = [
    { batchId: "batch-legacy-live-url", code: maliciousCode },
    { batchId: "batch-legacy-live-object", code: { token: "secret", path: "/jobs/private" } }
  ];
  for (const { batchId, code } of batches) {
    await store.create({
      batch_id: batchId,
      status: "completed",
      items: [],
      uploads: [],
      capture: {
        enabled: true,
        status: "real_live_disabled",
        live_error: { code, message: "legacy error" }
      }
    });
  }

  const list = await app.inject({ method: "GET", url: "/api/batches", headers: headers(session) });
  assert.equal(list.statusCode, 200);
  for (const { batchId } of batches) {
    const capture = list.json().batches.find((batch) => batch.batch_id === batchId).capture;
    assert.deepEqual(capture.live_error, {
      code: "CAPTURE_HTTP_REAL_LIVE_DISABLED",
      message: "real_live is disabled until explicitly authorized."
    });
  }
  assert.equal(list.body.includes(maliciousCode), false);
  assert.equal(list.body.includes("token"), false);

  for (const { batchId } of batches) {
    const detail = await app.inject({ method: "GET", url: `/api/batches/${batchId}`, headers: headers(session) });
    assert.equal(detail.statusCode, 200);
    assert.deepEqual(detail.json().batch.capture.live_error, {
      code: "CAPTURE_HTTP_REAL_LIVE_DISABLED",
      message: "real_live is disabled until explicitly authorized."
    });
    assert.equal(detail.body.includes(maliciousCode), false);
    assert.equal(detail.body.includes("token"), false);
    assert.equal(detail.body.includes("/jobs/private"), false);
  }
});

test("replay failures persist stable errors and hide local manifest paths from public batch APIs", async (t) => {
  const { app, root, session } = await fixture();
  t.after(async () => {
    await app.close();
    await rm(root, { recursive: true, force: true });
  });
  const store = createBatchStore(path.join(root, "batches"));
  const batchId = "batch-replay-safe-error";
  const manifestRelativePath = `batches/${batchId}/capture/manifest.json`;
  await store.create({
    batch_id: batchId,
    status: "completed",
    items: [],
    uploads: [],
    capture: { enabled: true, status: "redacted", manifest_path: manifestRelativePath }
  });

  const replayed = await app.inject({
    method: "POST",
    url: `/api/batches/${batchId}/capture/replay`,
    headers: headers(session),
    payload: {}
  });
  assert.equal(replayed.statusCode, 200);
  assert.deepEqual(replayed.json().batch.capture.replay_error, {
    code: "CAPTURE_REPLAY_FAILED",
    message: "Unable to complete the offline replay."
  });

  const persisted = JSON.parse(await readFile(path.join(root, "batches", batchId, "batch.json"), "utf8"));
  assert.deepEqual(persisted.capture.replay_error, {
    code: "CAPTURE_REPLAY_FAILED",
    message: "Unable to complete the offline replay."
  });
  for (const response of await Promise.all([
    app.inject({ method: "GET", url: "/api/batches", headers: headers(session) }),
    app.inject({ method: "GET", url: `/api/batches/${batchId}`, headers: headers(session) })
  ])) {
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.includes(root), false);
    assert.equal(response.body.includes(path.join(root, manifestRelativePath)), false);
  }
});

test("dry-run fails when a later step needs an unproduced remote_id", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-dry-run-missing-remote-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await buildApp({ root, openBrowser: async () => {} });
  t.after(() => app.close());
  const store = createBatchStore(path.join(root, "batches"));
  await store.create({
    batch_id: "batch-dry-run-missing-remote",
    status: "completed",
    items: [],
    uploads: [],
    capture: { enabled: true, status: "redacted", manifest_path: "batches/batch-dry-run-missing-remote/capture/manifest.json" }
  });
  const captureDirectory = path.join(root, "batches", "batch-dry-run-missing-remote", "capture");
  await mkdir(captureDirectory, { recursive: true });
  await writeFile(path.join(captureDirectory, "manifest.json"), JSON.stringify({
    schema_version: 1,
    source: "hifly_goods",
    captured_at: "2026-07-16T00:00:00Z",
    sanitized: true,
    steps: [{
      id: "download",
      phase: "download",
      method: "GET",
      url_template: "https://example.test/jobs/{{remote_id}}/download",
      placeholders: ["{{remote_id}}"],
      response: { status: 200, body: { data: {} } }
    }]
  }));
  const session = await app.inject({ method: "GET", url: "/api/session", headers: { host: HOST } });
  const response = await app.inject({
    method: "POST",
    url: "/api/batches/batch-dry-run-missing-remote/capture/dry-run",
    headers: headers({ cookie: session.headers["set-cookie"], token: session.json().token }),
    payload: {}
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().batch.capture.status, "dry_run_failed");
  assert.deepEqual(response.json().batch.capture.dry_run_error, {
    code: "CAPTURE_DRY_RUN_FAILED",
    message: "Unable to construct the dry-run request plan."
  });
});

test("dry-run failure clears old summaries and keeps local manifest errors out of public batch APIs", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "capture-dry-run-safe-error-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = await buildApp({ root, openBrowser: async () => {} });
  t.after(() => app.close());
  const store = createBatchStore(path.join(root, "batches"));
  const batchId = "batch-dry-run-safe-error";
  const manifestRelativePath = `batches/${batchId}/capture/manifest.json`;
  const manifestPath = path.join(root, manifestRelativePath);
  await store.create({
    batch_id: batchId,
    status: "completed",
    items: [],
    uploads: [],
    capture: { enabled: true, status: "redacted", manifest_path: manifestRelativePath }
  });
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify({
    schema_version: 1,
    source: "hifly_goods",
    captured_at: "2026-07-16T00:00:00Z",
    sanitized: true,
    steps: [{
      id: "asset",
      phase: "asset_generation",
      method: "POST",
      url_template: "https://example.test/assets",
      response: { status: 200, body: { data: { asset_id: "asset-1" } } },
      produces: { asset_id: "$response.body.data.asset_id" }
    }]
  }));
  const session = await app.inject({ method: "GET", url: "/api/session", headers: { host: HOST } });
  const requestHeaders = headers({ cookie: session.headers["set-cookie"], token: session.json().token });
  const first = await app.inject({
    method: "POST",
    url: `/api/batches/${batchId}/capture/dry-run`,
    headers: requestHeaders,
    payload: {}
  });
  assert.equal(first.json().batch.capture.dry_run_summary.executed_step_count, 1);

  await rm(manifestPath);
  const failed = await app.inject({
    method: "POST",
    url: `/api/batches/${batchId}/capture/dry-run`,
    headers: requestHeaders,
    payload: {}
  });
  assert.equal(failed.statusCode, 200);
  assert.equal(failed.json().batch.capture.status, "dry_run_failed");
  assert.deepEqual(failed.json().batch.capture.dry_run_error, {
    code: "CAPTURE_DRY_RUN_FAILED",
    message: "Unable to construct the dry-run request plan."
  });
  assert.equal("dry_run_summary" in failed.json().batch.capture, false);

  const persisted = JSON.parse(await readFile(path.join(root, "batches", batchId, "batch.json"), "utf8"));
  assert.equal(persisted.capture.dry_run_summary, null);
  for (const response of await Promise.all([
    app.inject({ method: "GET", url: "/api/batches", headers: requestHeaders }),
    app.inject({ method: "GET", url: `/api/batches/${batchId}`, headers: requestHeaders })
  ])) {
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.includes(root), false);
    assert.equal(response.body.includes(manifestPath), false);
    assert.equal(response.body.includes("CAPTURE_HAR_MISSING"), false);
  }
});
