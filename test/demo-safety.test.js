import assert from "node:assert/strict";
import test from "node:test";

import {
  createDemoCaptureLive,
  createDemoExecutor,
  demoLoginUrl
} from "../src/server/demo-start.js";

test("demo execution uses the fake executor and blocks real capture transport", async () => {
  const executor = createDemoExecutor();
  const asset = await executor.createAsset({ task_id: "demo-task-1" }, {});
  assert.deepEqual(asset, { asset_id: "asset-demo-task-1" });
  assert.equal(executor.calls[0].method, "createAsset");

  const captureLive = createDemoCaptureLive();
  await assert.rejects(
    captureLive.authProvider.getRuntimeAuth(),
    { code: "DEMO_REAL_CAPTURE_DISABLED" }
  );
  await assert.rejects(
    captureLive.transport.request({ url: "https://example.invalid" }),
    { code: "CAPTURE_HTTP_REAL_LIVE_DISABLED" }
  );
});

test("demo opens the existing login page on the selected loopback port", () => {
  assert.equal(demoLoginUrl("http://127.0.0.1:4399"), "http://127.0.0.1:4399/login.html");
  assert.throws(() => demoLoginUrl("https://127.0.0.1:4399"), { code: "DEMO_LOGIN_URL_MUST_BE_LOOPBACK" });
});
