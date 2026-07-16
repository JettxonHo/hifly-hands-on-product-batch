import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createExecutorForBackend } from "../src/server/start.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.resolve(here, "..", "rpa", "capture", "fixtures", "hifly-goods-sample.json");

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

test("yingdao_rpa defaults to the existing bridge when rpa.mode is unset", () => {
  const executor = createExecutorForBackend(process.cwd(), { executionBackend: "yingdao_rpa" });
  assert.equal(executor.backend, "yingdao_rpa");
  assert.equal(executor.mode, undefined);
});

test("yingdao_rpa with rpa.mode capture_http selects the capture executor", () => {
  const executor = createExecutorForBackend(process.cwd(), {
    executionBackend: "yingdao_rpa",
    rpa: { mode: "capture_http", manifestPath: FIXTURE }
  });
  assert.equal(executor.backend, "yingdao_rpa");
  assert.equal(executor.mode, "capture_http");
});

test("playwright default is unaffected by rpa.mode capture_http", () => {
  const executor = createExecutorForBackend(process.cwd(), {
    executionBackend: "playwright",
    rpa: { mode: "capture_http", manifestPath: FIXTURE }
  });
  assert.equal(executor.backend, "playwright");
});

test("playwright executor can be configured with a per-run HAR path", () => {
  const executor = createExecutorForBackend(process.cwd(), {}, {
    recordHarPath: "rpa/capture/raw/batch-one.har"
  });
  assert.equal(executor.backend, "playwright");
  assert.equal(executor.recordHarPath, "rpa/capture/raw/batch-one.har");
});

test("capture_http executor preserves configured dry-run mode", () => {
  const executor = createExecutorForBackend(process.cwd(), {
    executionBackend: "yingdao_rpa",
    rpa: { mode: "capture_http", manifestPath: "rpa/capture/fixtures/hifly-goods-sample.json", captureHttpMode: "real_dry_run" }
  });
  assert.equal(executor.backend, "yingdao_rpa");
  assert.equal(executor.mode, "capture_http");
  assert.equal(executor.captureHttpMode, "real_dry_run");
});
