import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { loadConfig } from "../src/config.js";
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

test("playwright executor reloads an explicit config path and preserves the root fallback", async (t) => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "hifly-executor-config-"));
  const runtimeRoot = path.join(temporaryRoot, "runtime");
  const externalRoot = path.join(temporaryRoot, "external");
  const externalConfigPath = path.join(externalRoot, "agent-config.json");
  const template = JSON.parse(await readFile(path.resolve(here, "..", "config.example.json"), "utf8"));
  const runtimeProfile = "runtime-profile";
  const initialExternalProfile = "external-profile-before";
  const reloadedExternalProfile = "external-profile-after";
  const configFor = (profileDir, marker) => ({
    ...template,
    browser: { ...template.browser, profileDir },
    batch: { ...template.batch, defaultTimeoutMs: marker },
    downloadDir: path.join(temporaryRoot, `downloads-${marker}`),
    logDir: path.join(temporaryRoot, `logs-${marker}`),
    screenshotDir: path.join(temporaryRoot, `screenshots-${marker}`)
  });

  await mkdir(runtimeRoot, { recursive: true });
  await mkdir(externalRoot, { recursive: true });
  await writeFile(
    path.join(runtimeRoot, "config.local.json"),
    JSON.stringify(configFor(runtimeProfile, 101))
  );
  await writeFile(externalConfigPath, JSON.stringify(configFor(initialExternalProfile, 202)));

  const externalConfig = loadConfig(externalConfigPath);
  const executor = createExecutorForBackend(runtimeRoot, externalConfig);
  await writeFile(externalConfigPath, JSON.stringify(configFor(reloadedExternalProfile, 303)));

  const originalLaunchPersistentContext = chromium.launchPersistentContext;
  let launchedProfileDir = null;
  let defaultTimeoutMs = null;
  const hiddenLocator = {
    first() { return this; },
    async isVisible() { return false; },
    async waitFor() { throw new Error("not visible"); }
  };
  const page = {
    async goto() {},
    async waitForLoadState() {},
    setDefaultTimeout(value) { defaultTimeoutMs = value; },
    getByPlaceholder() { return hiddenLocator; },
    getByText() { return hiddenLocator; }
  };
  chromium.launchPersistentContext = async (profileDir) => {
    launchedProfileDir = profileDir;
    return {
      pages() { return [page]; },
      async newPage() { return page; },
      async close() {}
    };
  };
  t.after(async () => {
    chromium.launchPersistentContext = originalLaunchPersistentContext;
    await executor.close();
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  assert.deepEqual(await executor.preflight(), { status: "ready" });
  assert.equal(launchedProfileDir, path.join(externalRoot, reloadedExternalProfile));
  assert.equal(defaultTimeoutMs, 303);

  await executor.close();
  launchedProfileDir = null;
  defaultTimeoutMs = null;
  const fallbackExecutor = createExecutorForBackend(runtimeRoot, { executionBackend: "playwright" });
  t.after(() => fallbackExecutor.close());

  assert.deepEqual(await fallbackExecutor.preflight(), { status: "ready" });
  assert.equal(launchedProfileDir, path.join(runtimeRoot, runtimeProfile));
  assert.equal(defaultTimeoutMs, 101);
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
