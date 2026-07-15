import test from "node:test";
import assert from "node:assert/strict";
import { createExecutorForBackend } from "../src/server/start.js";

test("execution backend defaults to playwright", () => {
  const executor = createExecutorForBackend(process.cwd(), {});
  assert.equal(executor.backend, "playwright");
  assert.equal(typeof executor.createAsset, "function");
});

test("execution backend can select yingdao_rpa", () => {
  const executor = createExecutorForBackend(process.cwd(), {
    executionBackend: "yingdao_rpa",
    rpa: { callbackBaseUrl: "http://127.0.0.1:4317" }
  });
  assert.equal(executor.backend, "yingdao_rpa");
  assert.equal(typeof executor.createAsset, "function");
  assert.equal(typeof executor.setCallbackBaseUrl, "function");
});

test("unknown execution backend throws a clear error", () => {
  assert.throws(
    () => createExecutorForBackend(process.cwd(), { executionBackend: "robot_surprise" }),
    /Unsupported executionBackend/
  );
});
