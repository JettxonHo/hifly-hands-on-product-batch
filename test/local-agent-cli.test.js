import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { buildManualHandoffZip } from "../src/manual-handoff/manual-handoff-package-store.js";
import { MINIMAL_MP4_FIXTURE } from "../src/local-agent/fake-executor.js";
import { createLocalAgentHttpClient } from "../src/local-agent/agent-http-client.js";
import {
  EXIT_CODES,
  main,
  runLocalAgentOnce,
  selectLocalAgentExecutor
} from "../src/local-agent/local-agent-runner.js";

const TOKEN = "cloud-agent-token-must-not-leak";

function manifest(overrides = {}) {
  return {
    package_id: "package-1",
    package_version: 1,
    organization_id: "org-1",
    production_order_id: "order-1",
    product_id: "product-1",
    avatar_asset_version_id: "avatar-version-1",
    product_revision: {
      id: "revision-1",
      status: "ready",
      product_name: "Alpha",
      sku: "SKU-1",
      selling_points: "Useful",
      category: "beauty",
      asset_version_ids: ["product-version-1"]
    },
    copy_snapshot: {
      copy_version_id: "copy-1",
      copy_body: "先展示商品，再说明体验。"
    },
    avatar_snapshot: {
      avatar_asset_version_id: "avatar-version-1",
      display_name: "Ava",
      source_type: "seeded"
    },
    video_plan_snapshot: { id: "plan-1", presentation_size_code: "smart_fit", output_instructions: "竖版口播" },
    asset_references: [{
      asset_id: "product-asset-1",
      asset_version_id: "product-version-1",
      role: "product_image",
      media_type: "image/png",
      retrieval_mode: "embedded"
    }],
    ...overrides
  };
}

async function packageBody(value = manifest()) {
  return buildManualHandoffZip([
    { name: "manifest.json", body: JSON.stringify(value) },
    { name: "assets/product-version-1", body: Buffer.from("product-image") }
  ]);
}

function createFakeHttp({ events, body, heartbeatTaskError = null, claimAttempt = { id: "attempt-1" } }) {
  return {
    async heartbeat(input) {
      events.push(["heartbeat", input]);
      return { ok: true };
    },
    async claim(input) {
      events.push(["claim", input]);
      return { attempt: { ...claimAttempt }, replayed: false };
    },
    async start(input) {
      events.push(["start", input]);
      return { attempt: { id: input.attemptId, status: "running" }, replayed: false };
    },
    async downloadPackage(input) {
      events.push(["download", input]);
      return { body, contentType: "application/zip" };
    },
    async heartbeatTask(input) {
      events.push(["heartbeat_task", input]);
      if (heartbeatTaskError) throw heartbeatTaskError;
      return { attempt: { id: input.attemptId, progress_phase: input.progressPhase }, replayed: false };
    },
    async authorizeCandidate(input) {
      events.push(["authorize", input]);
      return { candidate: { id: "candidate-1", role: "primary_video" }, replayed: false };
    },
    async uploadCandidate(input) {
      events.push(["upload", { ...input, body: Buffer.from(input.body) }]);
      return { status: "uploaded", candidate: { id: input.candidateId, status: "uploaded" } };
    },
    async completeCandidate(input) {
      events.push(["complete", input]);
      return { candidate: { id: input.candidateId, status: "uploaded" }, replayed: false };
    },
    async report(input) {
      events.push(["report", input]);
      return { report: { id: input.reportId, outcome: input.outcome }, replayed: false };
    }
  };
}

function createRecordingExecutor({ events, failAt = null } = {}) {
  const calls = [];
  const record = (method) => {
    calls.push(method);
    events?.push([`executor:${method}`]);
    if (failAt === method) throw new Error(`unsafe executor failure at ${method} https://secret.example token=${TOKEN}`);
  };
  return {
    calls,
    async preflight() {
      record("preflight");
      return { status: "ready" };
    },
    async createAsset(task) {
      record("createAsset");
      return { asset_id: `asset-${task.task_id}` };
    },
    async submitVideo() {
      record("submitVideo");
      return { status: "submitted", remoteEvidence: { evidence_source: "direct_submission", remote_id: "local-fake-1" } };
    },
    async querySubmission(remoteEvidence) {
      record("querySubmission");
      return { status: "ready", remoteEvidence };
    },
    async downloadArtifact(_remoteEvidence, destination) {
      record("downloadArtifact");
      await writeFile(path.join(destination, "local-fake-1.mp4"), MINIMAL_MP4_FIXTURE);
      return { artifact_id: "local-fake-1", relative_path: "downloads/local-fake-1.mp4" };
    },
    async reconcileSubmission() {
      record("reconcileSubmission");
      return { candidates: [] };
    }
  };
}

async function runFixture({
  packageManifest = manifest(),
  avatarMappings = {},
  executor,
  fakeExecutor,
  realExecutor,
  argv = ["run-once"],
  env = {},
  events = [],
  logs = [],
  heartbeatIntervalMs = 5_000,
  setIntervalImpl,
  clearIntervalImpl,
  heartbeatTaskError = null,
  claimAttempt = { id: "attempt-1" }
} = {}) {
  const parent = await mkdtemp(path.join(os.tmpdir(), "local-agent-cli-parent-"));
  const temporaryDirectories = [];
  const body = await packageBody(packageManifest);
  const client = createFakeHttp({ events, body, heartbeatTaskError, claimAttempt });
  const result = await runLocalAgentOnce({
    client,
    avatarMappings,
    executor,
    fakeExecutor,
    realExecutor,
    argv,
    env,
    heartbeatIntervalMs,
    ...(setIntervalImpl ? { setIntervalImpl } : {}),
    ...(clearIntervalImpl ? { clearIntervalImpl } : {}),
    tempDirectoryFactory: async () => {
      const directory = await mkdtemp(path.join(parent, "run-"));
      temporaryDirectories.push(directory);
      return directory;
    },
    logger: {
      info(event, fields) { logs.push(["info", event, fields]); },
      error(event, fields) { logs.push(["error", event, fields]); }
    }
  });
  return { result, client, events, logs, parent, temporaryDirectories };
}

test("run-once completes one fake item in the required serial order and uploads only bytes", async () => {
  const events = [];
  const avatarPath = path.join(os.tmpdir(), `local-agent-avatar-${process.pid}.png`);
  await writeFile(avatarPath, "avatar-image");
  const executor = createRecordingExecutor({ events });
  try {
    const state = await runFixture({ avatarMappings: { "avatar-version-1": avatarPath }, executor, events });
    assert.equal(state.result.status, "completed");
    assert.equal(state.result.exitCode, EXIT_CODES.success);
    assert.deepEqual(events.map(([event]) => event), [
      "heartbeat", "claim", "start", "download",
      "executor:createAsset", "executor:submitVideo", "executor:querySubmission", "executor:downloadArtifact",
      "heartbeat_task", "authorize", "upload", "complete", "heartbeat_task", "report"
    ]);
    const upload = events.find(([event]) => event === "upload")[1];
    assert.deepEqual(upload.body, MINIMAL_MP4_FIXTURE);
    assert.equal(Object.hasOwn(upload, "uploadToken"), false);
    assert.equal(upload.body.toString().includes(avatarPath), false);
    const report = events.find(([event]) => event === "report")[1];
    assert.equal(report.outcome, "completed");
    assert.equal(report.primaryCandidateId, "candidate-1");
    assert.match(report.reportId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(JSON.stringify(report).includes("upload_token"), false);
    assert.deepEqual(await readdir(state.parent), [], "temporary batch/package data must be cleaned up");
    await rm(state.parent, { recursive: true, force: true });
  } finally {
    await rm(avatarPath, { force: true });
  }
});

test("attributed package manifest hash drift stops local agent before executor calls", async () => {
  const events = [];
  const executor = createRecordingExecutor({ events });
  const state = await runFixture({
    packageManifest: { ...manifest(), manifest_hash: "tampered-manifest-hash" },
    avatarMappings: { "avatar-version-1": path.join(os.tmpdir(), `unused-avatar-${process.pid}.png`) },
    executor,
    claimAttempt: { id: "attempt-1", package_id: "package-1", production_order_id: "order-1", package_version: 1, manifest_hash: "expected-manifest-hash", package_hash: null },
    events
  });
  assert.equal(state.result.status, "failed");
  assert.deepEqual(executor.calls, []);
  assert.equal(events.some(([event]) => event === "executor:createAsset" || event === "executor:submitVideo"), false);
  await rm(state.parent, { recursive: true, force: true });
});

test("without both real gates the real executor receives zero calls", async () => {
  const events = [];
  const avatarPath = path.join(os.tmpdir(), `local-agent-avatar-${process.pid}-default.png`);
  await writeFile(avatarPath, "avatar-image");
  const fake = createRecordingExecutor({ events });
  const real = createRecordingExecutor({ events });
  try {
    const state = await runFixture({
      avatarMappings: { "avatar-version-1": avatarPath },
      fakeExecutor: fake,
      realExecutor: real,
      argv: ["run-once"],
      env: { LOCAL_AGENT_REAL_EXECUTION: "true" },
      events
    });
    assert.equal(state.result.status, "completed");
    assert.equal(real.calls.length, 0);
    assert.ok(fake.calls.length > 0);
    await rm(state.parent, { recursive: true, force: true });
  } finally {
    await rm(avatarPath, { force: true });
  }
});

test("real executor selection requires --real and LOCAL_AGENT_REAL_EXECUTION=true", () => {
  const fake = { name: "fake" };
  const real = { name: "real" };
  assert.equal(selectLocalAgentExecutor({ argv: ["run-once"], env: { LOCAL_AGENT_REAL_EXECUTION: "true" }, fakeExecutor: fake, realExecutor: real }), fake);
  assert.equal(selectLocalAgentExecutor({ argv: ["run-once", "--real"], env: {}, fakeExecutor: fake, realExecutor: real }), fake);
  assert.equal(selectLocalAgentExecutor({ argv: ["run-once", "--real"], env: { LOCAL_AGENT_REAL_EXECUTION: "true" }, fakeExecutor: fake, realExecutor: real }), real);
});

test("both real gates select the injected real adapter and still keep execution serial", async () => {
  const events = [];
  const avatarPath = path.join(os.tmpdir(), `local-agent-avatar-${process.pid}-real-gated.png`);
  await writeFile(avatarPath, "avatar-image");
  const fake = createRecordingExecutor({ events });
  const real = createRecordingExecutor({ events });
  try {
    const state = await runFixture({
      avatarMappings: { "avatar-version-1": avatarPath },
      fakeExecutor: fake,
      realExecutor: real,
      argv: ["run-once", "--real"],
      env: { LOCAL_AGENT_REAL_EXECUTION: "true" },
      events
    });
    assert.equal(state.result.status, "completed");
    assert.equal(fake.calls.length, 0);
    assert.ok(real.calls.length > 0);
    await rm(state.parent, { recursive: true, force: true });
  } finally {
    await rm(avatarPath, { force: true });
  }
});

test("real preflight login failure stops before heartbeat and claim", async () => {
  const events = [];
  const real = createRecordingExecutor({ events });
  real.preflight = async () => {
    events.push(["executor:preflight"]);
    throw Object.assign(new Error("LOGIN_REQUIRED"), {
      code: "LOGIN_REQUIRED",
      outcome: "requires_action"
    });
  };

  const state = await runFixture({
    realExecutor: real,
    argv: ["run-once", "--real"],
    env: { LOCAL_AGENT_REAL_EXECUTION: "true" },
    events
  });

  assert.equal(state.result.status, "requires_action");
  assert.equal(state.result.exitCode, EXIT_CODES.requiresAction);
  assert.equal(state.result.attemptId, null);
  assert.deepEqual(events.map(([event]) => event), ["executor:preflight"]);
  await rm(state.parent, { recursive: true, force: true });
});

test("login expiry after claim submits a controlled requires_action report", async () => {
  const events = [];
  const avatarPath = path.join(os.tmpdir(), `local-agent-avatar-${process.pid}-login-expired.png`);
  await writeFile(avatarPath, "avatar-image");
  const real = createRecordingExecutor({ events });
  real.createAsset = async () => {
    events.push(["executor:createAsset"]);
    throw Object.assign(new Error("LOGIN_REQUIRED"), {
      code: "LOGIN_REQUIRED",
      outcome: "requires_action"
    });
  };
  try {
    const state = await runFixture({
      avatarMappings: { "avatar-version-1": avatarPath },
      realExecutor: real,
      argv: ["run-once", "--real"],
      env: { LOCAL_AGENT_REAL_EXECUTION: "true" },
      events
    });
    assert.equal(state.result.status, "requires_action");
    const report = events.at(-1)[1];
    assert.equal(report.outcome, "requires_action");
    assert.equal(report.errorCode, "LOGIN_REQUIRED");
    assert.equal(events.some(([event]) => event === "authorize"), false);
    await rm(state.parent, { recursive: true, force: true });
  } finally {
    await rm(avatarPath, { force: true });
  }
});

test("long execution renews the lease with a controlled progress phase and stops the timer in finally", async () => {
  const events = [];
  const avatarPath = path.join(os.tmpdir(), `local-agent-avatar-${process.pid}-heartbeat.png`);
  await writeFile(avatarPath, "avatar-image");
  const executor = createRecordingExecutor({ events });
  let releaseAsset;
  const assetGate = new Promise((resolve) => { releaseAsset = resolve; });
  const originalCreateAsset = executor.createAsset;
  executor.createAsset = async (task) => {
    const result = await originalCreateAsset(task);
    await assetGate;
    return result;
  };
  let timerCallback;
  let clearCount = 0;
  try {
    const running = runFixture({
      avatarMappings: { "avatar-version-1": avatarPath },
      executor,
      events,
      heartbeatIntervalMs: 5,
      setIntervalImpl(callback) {
        timerCallback = callback;
        return { unref() {} };
      },
      clearIntervalImpl() {
        clearCount += 1;
      }
    });
    while (!timerCallback) await new Promise((resolve) => setImmediate(resolve));
    while (!executor.calls.includes("createAsset")) await new Promise((resolve) => setImmediate(resolve));
    await timerCallback();
    assert.equal(events.filter(([event]) => event === "heartbeat_task").length, 1);
    assert.equal(events.find(([event]) => event === "heartbeat_task")[1].progressPhase, "executing");
    releaseAsset();
    const state = await running;
    assert.equal(state.result.status, "completed");
    assert.equal(clearCount, 1);
    await rm(state.parent, { recursive: true, force: true });
  } finally {
    releaseAsset?.();
    await rm(avatarPath, { force: true });
  }
});

test("lease renewal failure stops before candidate upload or terminal report", async () => {
  const events = [];
  const avatarPath = path.join(os.tmpdir(), `local-agent-avatar-${process.pid}-lease-failed.png`);
  await writeFile(avatarPath, "avatar-image");
  try {
    const state = await runFixture({
      avatarMappings: { "avatar-version-1": avatarPath },
      executor: createRecordingExecutor({ events }),
      events,
      heartbeatTaskError: new Error(`unsafe lease error https://secret.example token=${TOKEN}`)
    });
    assert.equal(state.result.status, "failed");
    assert.equal(state.result.report, null);
    assert.equal(events.some(([event]) => event === "authorize"), false);
    assert.equal(events.some(([event]) => event === "upload"), false);
    assert.equal(events.some(([event]) => event === "report"), false);
    await rm(state.parent, { recursive: true, force: true });
  } finally {
    await rm(avatarPath, { force: true });
  }
});

test("missing avatar mapping reports requires_action before invoking any executor", async () => {
  const events = [];
  const executor = createRecordingExecutor({ events });
  const state = await runFixture({ avatarMappings: {}, executor, events });
  assert.equal(state.result.status, "requires_action");
  assert.equal(state.result.exitCode, EXIT_CODES.requiresAction);
  assert.equal(executor.calls.length, 0);
  assert.deepEqual(events.map(([event]) => event), ["heartbeat", "claim", "start", "download", "heartbeat_task", "report"]);
  const report = events.at(-1)[1];
  assert.equal(report.outcome, "requires_action");
  assert.equal(report.errorCode, "AVATAR_MAPPING_REQUIRED");
  assert.equal(JSON.stringify(report).includes("/"), false, "report must not contain a local path");
  await rm(state.parent, { recursive: true, force: true });
});

test("multiple package items report requires_action and do not start execution", async () => {
  const events = [];
  const executor = createRecordingExecutor({ events });
  const state = await runFixture({
    packageManifest: manifest({ items: [{ product_id: "product-1" }, { product_id: "product-2" }] }),
    avatarMappings: { "avatar-version-1": path.join(os.tmpdir(), "unused-avatar.png") },
    executor,
    events
  });
  assert.equal(state.result.status, "requires_action");
  assert.equal(executor.calls.length, 0);
  const report = events.at(-1)[1];
  assert.equal(report.errorCode, "PACKAGE_ITEM_COUNT_UNSUPPORTED");
  await rm(state.parent, { recursive: true, force: true });
});

test("executor failures report only LOCAL_EXECUTION_FAILED and never log token or raw URL", async () => {
  const events = [];
  const logs = [];
  const avatarPath = path.join(os.tmpdir(), `local-agent-avatar-${process.pid}-failed.png`);
  await writeFile(avatarPath, "avatar-image");
  try {
    const state = await runFixture({
      avatarMappings: { "avatar-version-1": avatarPath },
      executor: createRecordingExecutor({ events, failAt: "createAsset" }),
      events,
      logs
    });
    assert.equal(state.result.status, "failed");
    assert.equal(state.result.exitCode, EXIT_CODES.failed);
    const report = events.at(-1)[1];
    assert.equal(report.outcome, "failed");
    assert.equal(report.errorCode, "LOCAL_EXECUTION_FAILED");
    const serializedLogs = JSON.stringify(logs);
    assert.equal(serializedLogs.includes(TOKEN), false);
    assert.equal(serializedLogs.includes("https://secret.example"), false);
    assert.equal(serializedLogs.includes("unsafe executor failure"), false);
    await rm(state.parent, { recursive: true, force: true });
  } finally {
    await rm(avatarPath, { force: true });
  }
});

test("Agent HTTP client centralizes endpoints and never logs its bearer token", async () => {
  const calls = [];
  const logs = [];
  const jsonResponses = [
    { ok: true, status: 200, body: { heartbeat: true } },
    { ok: true, status: 201, body: { attempt: { id: "attempt-1" } } }
  ];
  const client = createLocalAgentHttpClient({
    baseUrl: "https://agent.example.test",
    token: TOKEN,
    logger: { info(event, fields) { logs.push([event, fields]); } },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init: { ...init, headers: { ...init.headers } } });
      const response = jsonResponses.shift();
      return {
        ok: response.ok,
        status: response.status,
        async json() { return response.body; },
        headers: { get() { return "application/json"; } }
      };
    }
  });
  await client.heartbeat({ idempotencyKey: "heartbeat-1" });
  await client.claim({ idempotencyKey: "claim-1" });
  assert.equal(calls[0].url, "https://agent.example.test/api/agent/v1/heartbeat");
  assert.equal(calls[1].url, "https://agent.example.test/api/agent/v1/tasks/claim");
  assert.equal(calls[0].init.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(JSON.stringify(logs).includes(TOKEN), false);
});

test("Agent binary candidate PUT uses the server video/mp4 content-type contract", async () => {
  const calls = [];
  const client = createLocalAgentHttpClient({
    baseUrl: "https://agent.example.test",
    token: TOKEN,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 200, async json() { return { status: "uploaded" }; } };
    }
  });
  await client.uploadCandidate({
    attemptId: "attempt-1",
    candidateId: "candidate-1",
    body: Buffer.from("fixture"),
    mediaType: "video/mp4",
    idempotencyKey: "upload-1"
  });
  assert.equal(calls[0].init.headers["content-type"], "video/mp4");
  assert.equal(calls[0].init.headers["x-manual-upload-token"], undefined);
  assert.equal(calls[0].init.headers.authorization, `Bearer ${TOKEN}`);
  assert.deepEqual(calls[0].init.body, Buffer.from("fixture"));
  assert.equal(calls[0].init.body.toString(), "fixture");
  await assert.rejects(
    () => client.uploadCandidate({ attemptId: "attempt-1", candidateId: "candidate-1", body: Buffer.from("fixture"), mediaType: "video/webm", idempotencyKey: "upload-2" }),
    { code: "LOCAL_AGENT_MEDIA_TYPE_UNSUPPORTED" }
  );
  await client.completeCandidate({ attemptId: "attempt-1", candidateId: "candidate-1", idempotencyKey: "complete-1" });
  assert.equal(calls[1].init.headers["x-manual-upload-token"], undefined);
  assert.equal(calls[1].init.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[1].url, "https://agent.example.test/api/agent/v1/tasks/attempt-1/candidates/candidate-1/complete");
  assert.deepEqual(JSON.parse(calls[1].init.body), {});
});

test("Agent report uses the server reason_code contract for requires_action", async () => {
  const calls = [];
  const client = createLocalAgentHttpClient({
    baseUrl: "https://agent.example.test",
    token: TOKEN,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return { ok: true, status: 201, async json() { return { report: { outcome: "requires_action" } }; } };
    }
  });
  await client.report({
    attemptId: "attempt-1",
    reportId: "a0000000-0000-4000-8000-000000000001",
    outcome: "requires_action",
    errorCode: "AVATAR_MAPPING_REQUIRED",
    idempotencyKey: "report-1"
  });
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.reason_code, "AVATAR_MAPPING_REQUIRED");
  assert.equal(Object.hasOwn(body, "requires_action_reason"), false);
});

test("main defaults to standby, while fake and real execution require explicit gates", async () => {
  const clientEvents = [];
  const idleClient = () => ({
    async heartbeat() { clientEvents.push("heartbeat"); },
    async claim() { clientEvents.push("claim"); return { attempt: null, replayed: false }; },
    async start() {},
    async heartbeatTask() {},
    async downloadPackage() {},
    async authorizeCandidate() {},
    async uploadCandidate() {},
    async completeCandidate() {},
    async report() {}
  });
  let factoryCalls = 0;
  let closeCalls = 0;
  const realExecutorFactory = async () => {
    factoryCalls += 1;
    return {
      async preflight() {},
      async close() { closeCalls += 1; },
      async createAsset() {},
      async submitVideo() {},
      async querySubmission() {},
      async downloadArtifact() {},
      async reconcileSubmission() {}
    };
  };
  const env = { LOCAL_AGENT_REAL_EXECUTION: "true" };
  const defaultRun = await main({ argv: ["run-once"], env, clientFactory: async () => idleClient(), realExecutorFactory });
  assert.equal(defaultRun.status, "standby");
  assert.equal(factoryCalls, 0);
  assert.deepEqual(clientEvents, ["heartbeat"]);
  const fakeRun = await main({ argv: ["run-once"], env: { LOCAL_AGENT_FAKE_EXECUTION: "true" }, clientFactory: async () => idleClient(), realExecutorFactory });
  assert.equal(fakeRun.status, "idle");
  assert.deepEqual(clientEvents, ["heartbeat", "heartbeat", "claim"]);
  const realRun = await main({ argv: ["run-once", "--real"], env, clientFactory: async () => idleClient(), realExecutorFactory });
  assert.equal(realRun.status, "idle");
  assert.equal(factoryCalls, 1);
  assert.equal(closeCalls, 1);
});
