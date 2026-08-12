import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCloudExecutorConfig } from "../src/cloud-executor/config.js";
import { createCloudExecutorLoginRuntime } from "../src/cloud-executor/login.js";
import { createCloudPlaywrightAdapter } from "../src/cloud-executor/playwright-adapter.js";
import { createCloudExecutorRuntime } from "../src/cloud-executor/runtime.js";
import { main as cloudExecutorMain } from "../scripts/cloud-executor.js";

const LOGIN_CONFIG = {
  enabled: true,
  configured: true,
  mode: "login",
  executorType: "cloud_executor",
  workspace: {
    root: "/var/lib/hifly-executor",
    profileDir: "/var/lib/hifly-executor/profile"
  }
};

test("cloud login mode exposes only a login operation and never constructs a claim service", async () => {
  let loginCalls = 0;
  const runtime = createCloudExecutorLoginRuntime({
    config: LOGIN_CONFIG,
    adapterFactory: () => ({
      async login({ waitForInput }) {
        loginCalls += 1;
        await waitForInput();
        return { status: "ready" };
      },
      async close() {}
    })
  });

  assert.equal(runtime.service, null);
  assert.equal(runtime.worker, null);
  assert.equal("runOnce" in runtime, false);
  assert.equal("claim" in runtime, false);

  const result = await runtime.login({ waitForInput: async () => undefined });
  assert.deepEqual(result, { status: "ready" });
  assert.equal(loginCalls, 1);

  await runtime.close();
});

test("standalone Cloud Executor runtime dispatches login mode without a worker or runOnce seam", async () => {
  let loginCalls = 0;
  const runtime = createCloudExecutorRuntime({
    config: LOGIN_CONFIG,
    loginAdapterFactory: () => ({
      async login() { loginCalls += 1; return { status: "ready" }; },
      async close() {}
    })
  });

  assert.equal(runtime.mode, "login");
  assert.equal(runtime.service, null);
  assert.equal(runtime.worker, null);
  assert.equal(typeof runtime.login, "function");
  assert.equal("runOnce" in runtime, false);
  assert.deepEqual(await runtime.login(), { status: "ready" });
  assert.equal(loginCalls, 1);
  await runtime.close();
});

test("playwright readiness keeps preflight details out of the public readiness seam", async () => {
  const executor = {
    async preflight() {
      return { ready: false, status: "requires_login", reason: "session-detail=private-value", profileDir: "/private/profile" };
    },
    async close() {}
  };
  const repository = Object.fromEntries([
    "getReceipt", "claimAttempt", "startAttempt", "getAttempt", "listAttempts", "heartbeatCloudAttempt",
    "expireCloudAttempt", "createCandidateUpload", "markCandidateUploaded", "saveReport"
  ].map((name) => [name, async () => null]));
  const orderPort = {
    async listOrdersForCloudExecutor() { return []; },
    async getOrderForCloudExecutor() { return null; },
    async transitionOrderForCloudExecutor() { return null; }
  };
  const packagePort = {
    async listPackagesForCloudExecutor() { return []; },
    async getPackageForCloudExecutor() { return null; },
    async downloadPackageForCloudExecutor() { return { body: Buffer.from("fake") }; }
  };
  const candidateStore = { async put() {}, async head() {}, async get() {} };
  const runtime = createCloudExecutorRuntime({
    config: {
      enabled: true,
      configured: true,
      mode: "playwright",
      executorCloudId: "cloud-executor-test",
      organizationId: "org-test",
      workspace: { root: "/var/lib/hifly-executor", profileDir: "/var/lib/hifly-executor/profile" }
    },
    repository,
    orderPort,
    packagePort,
    candidateStore,
    executor
  });
  const readiness = await runtime.readiness.check();
  assert.deepEqual(readiness, { ready: false, status: "requires_login" });
  await runtime.close();
});

test("cloud executor login command delegates only to login mode", async () => {
  const events = [];
  const result = await cloudExecutorMain({
    argv: ["login"],
    env: { CLOUD_EXECUTOR_ENABLED: "true", CLOUD_EXECUTOR_MODE: "login" },
    root: "/tmp/cloud-executor-login-command-test",
    loadHiflyConfig: () => ({ hiflyWorkbenchUrl: "https://fake.invalid" }),
    waitForInput: async () => events.push("waitForInput"),
    runtimeFactory: ({ config }) => ({
      service: null,
      worker: null,
      async login({ waitForInput }) {
        events.push(["login", config.mode, config.noVnc.public]);
        await waitForInput();
        return { status: "ready" };
      },
      async close() { events.push("close"); }
    }),
    logger: { info(message) { events.push(message); }, error(message) { events.push(message); } }
  });

  assert.deepEqual(result, { status: "ready", exitCode: 0 });
  assert.deepEqual(events, [["login", "login", false], "waitForInput", "close"]);
});

test("cloud login configuration is explicit and keeps noVNC private by default", () => {
  const config = createCloudExecutorConfig({
    root: "/tmp/cloud-executor-login-test",
    env: {
      CLOUD_EXECUTOR_ENABLED: "true",
      CLOUD_EXECUTOR_MODE: "login",
      CLOUD_EXECUTOR_ROOT: "/var/lib/hifly-executor"
    }
  });

  assert.equal(config.configured, true);
  assert.equal(config.organizationId, null);
  assert.equal(config.executorCloudId, null);
  assert.equal(config.display, ":99");
  assert.deepEqual(config.xvfb, { enabled: true, display: ":99" });
  assert.deepEqual(config.noVnc, {
    bindHost: "127.0.0.1",
    port: 6080,
    access: "private",
    public: false
  });
});

test("cloud login configuration rejects a public noVNC bind host", () => {
  assert.throws(
    () => createCloudExecutorConfig({
      root: "/tmp/cloud-executor-login-test",
      env: {
        CLOUD_EXECUTOR_ENABLED: "true",
        CLOUD_EXECUTOR_MODE: "login",
        CLOUD_EXECUTOR_NOVNC_BIND_HOST: "0.0.0.0"
      }
    }),
    { code: "CLOUD_EXECUTOR_NOVNC_BIND_HOST_PUBLIC" }
  );
});

test("login deployment fragment keeps Profile persistent and noVNC private", async () => {
  const compose = await readFile(new URL("../deploy/cloud-executor-login.yml", import.meta.url), "utf8");
  assert.match(compose, /command: \["node", "scripts\/cloud-executor\.js", "login"\]/);
  assert.match(compose, /cloud_executor_profile:\/var\/lib\/hifly-executor\/profile/);
  assert.match(compose, /CLOUD_EXECUTOR_NOVNC_BIND_HOST: "127\.0\.0\.1"/);
  assert.match(compose, /CLOUD_EXECUTOR_MODE: "login"/);
  assert.match(compose, /internal: true/);
  assert.doesNotMatch(compose, /^\s+ports:/m);
});

function fakeContext(page) {
  return {
    pages() { return [page]; },
    async newPage() { return page; },
    async close() {}
  };
}

function adapterFor(workspace, calls) {
  const page = { setDefaultTimeout() {} };
  return createCloudPlaywrightAdapter({
    workspace,
    contextFactory: async () => fakeContext(page),
    hiflyPageFactory() {
      return {
        async openWorkbench() { calls.push("openWorkbench"); },
        async preflight() { calls.push("preflight"); return { status: "ready" }; },
        async prepareAsset() { calls.push("prepareAsset"); },
        async submitVideo() { calls.push("submitVideo"); },
        async querySubmission() {},
        async downloadArtifact() {},
        async reconcileSubmission() {}
      };
    }
  });
}

test("cloud login reuses the existing page preflight and never enters execution flow", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cloud-executor-login-"));
  const workspace = { root, profileDir: path.join(root, "profile") };
  const calls = [];
  const adapter = adapterFor(workspace, calls);
  try {
    const result = await adapter.login({ waitForInput: async () => calls.push("waitForLogin") });
    assert.deepEqual(result, { status: "ready" });
    assert.deepEqual(calls, ["openWorkbench", "waitForLogin", "preflight"]);
  } finally {
    await adapter.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("persistent cloud Profile marker and fake readiness survive a runtime restart", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cloud-executor-profile-"));
  const workspace = { root, profileDir: path.join(root, "profile") };
  const markerPath = path.join(workspace.profileDir, ".cloud-executor-profile.marker");
  try {
    const first = adapterFor(workspace, []);
    assert.deepEqual(await first.preflight(), { status: "ready" });
    const firstMarker = await readFile(markerPath, "utf8");
    await first.close();

    const second = adapterFor(workspace, []);
    assert.deepEqual(await second.preflight(), { status: "ready" });
    assert.equal(await readFile(markerPath, "utf8"), firstMarker);
    await second.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
