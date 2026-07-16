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
