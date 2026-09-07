import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { access, chmod, mkdtemp, mkdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createHash } from "node:crypto";
import { createAssetService } from "../src/assets/asset-service.js";
import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createMemoryManualExecutionRepository } from "../src/manual-execution/memory-manual-execution-repository.js";
import { createMemoryManualHandoffRepository } from "../src/manual-handoff/memory-manual-handoff-repository.js";
import { createMemoryProductionOrderRepository } from "../src/production-orders/memory-production-order-repository.js";
import { createMemoryWorkVerificationRepository } from "../src/work-verification/memory-work-verification-repository.js";
import { buildManualHandoffZip } from "../src/manual-handoff/manual-handoff-package-store.js";
import { sha256 } from "../src/manual-handoff/manual-handoff-package.js";
import { buildHiflyHandsOnProductV1 } from "../src/execution-contracts/hifly-hands-on-product-v1.js";
import { createCloudExecutorHeartbeatClient } from "../src/cloud-executor/heartbeat.js";
import { createCloudExecutorWorker } from "../src/cloud-executor/cloud-executor-worker.js";
import { createCloudExecutorConfig } from "../src/cloud-executor/config.js";
import { createCloudExecutorProductionPorts, createCloudExecutorProductionRuntime } from "../src/cloud-executor/production.js";
import { createCloudExecutorRuntime } from "../src/cloud-executor/runtime.js";
import { createCloudExecutorHealthServer } from "../src/cloud-executor/standalone.js";
import { createCloudWorkspaceConfig } from "../src/cloud-executor/workspace.js";
import { safeArtifactPath } from "../src/cloud-executor/playwright-adapter.js";
import { createProductionConfig } from "../src/server/production-config.js";

const ORGANIZATION_ID = "org-ce07";
const EXECUTOR_ID = "cloud-executor-ce07";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const ENTRYPOINT_PATH = fileURLToPath(new URL("../deploy/cloud-executor-entrypoint.sh", import.meta.url));
const POSIX_ENTRYPOINT_SKIP = process.platform === "win32" ? "requires POSIX /tmp and process semantics" : false;
let displayCounter = 0;

async function writeExecutable(filePath, contents) {
  await writeFile(filePath, contents);
  await chmod(filePath, 0o755);
}

function runEntrypoint({ fixture, args = [] }) {
  return new Promise((resolve, reject) => {
    const child = spawn("sh", [ENTRYPOINT_PATH, ...args], {
      cwd: path.dirname(ENTRYPOINT_PATH),
      env: fixture.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function createEntrypointFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "ce07-entrypoint-"));
  const bin = path.join(root, "bin");
  await mkdir(bin);
  const eventLog = path.join(root, "events.log");
  const xvfbReady = path.join(root, "xvfb-ready");
  const stopFile = path.join(root, "stop");
  const activeServer = path.join(root, "active-server");
  const displayNumber = 1000 + ((process.pid + displayCounter++) % 1000);
  const display = `:${displayNumber}`;
  const lockPath = path.join("/tmp", `.X${displayNumber}-lock`);
  const socketPath = path.join("/tmp", ".X11-unix", `X${displayNumber}`);
  const socketDirectory = path.dirname(socketPath);
  let createdSocketDirectory = false;
  try {
    await access(socketDirectory);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(socketDirectory, { recursive: true });
    createdSocketDirectory = true;
  }

  await writeExecutable(path.join(bin, "xdpyinfo"), `#!/bin/sh
set -eu
printf '%s\\n' xdpyinfo >> "$FAKE_EVENT_LOG"
if [ -f "$FAKE_ACTIVE_SERVER" ] || [ -f "$FAKE_XVFB_READY" ]; then
  exit 0
fi
exit 1
`);
  await writeExecutable(path.join(bin, "Xvfb"), `#!/bin/sh
set -eu
exec >/dev/null 2>&1
printf '%s\\n' Xvfb >> "$FAKE_EVENT_LOG"
if [ -e "$FAKE_LOCK_PATH" ] || [ -e "$FAKE_SOCKET_PATH" ]; then
  printf '%s\\n' artifacts-present >> "$FAKE_EVENT_LOG"
  exit 42
fi
: > "$FAKE_XVFB_READY"
while [ ! -f "$FAKE_STOP_FILE" ]; do sleep 0.01; done
`);
  for (const command of ["x11vnc", "websockify"]) {
    await writeExecutable(path.join(bin, command), `#!/bin/sh
set -eu
exec >/dev/null 2>&1
printf '%s\\n' ${command} >> "$FAKE_EVENT_LOG"
while [ ! -f "$FAKE_STOP_FILE" ]; do sleep 0.01; done
`);
  }
  await writeExecutable(path.join(bin, "node"), `#!/bin/sh
set -eu
printf 'node:%s:%s\\n' "$1" "\${2:-}" >> "$FAKE_EVENT_LOG"
`);

  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH || "/usr/bin:/bin"}`,
    CLOUD_EXECUTOR_DISPLAY: display,
    CLOUD_EXECUTOR_NOVNC_PORT: "6080",
    FAKE_EVENT_LOG: eventLog,
    FAKE_XVFB_READY: xvfbReady,
    FAKE_STOP_FILE: stopFile,
    FAKE_ACTIVE_SERVER: activeServer,
    FAKE_LOCK_PATH: lockPath,
    FAKE_SOCKET_PATH: socketPath
  };

  return {
    env,
    eventLog,
    activeServer,
    lockPath,
    socketPath,
    stopFile,
    async stop() {
      await writeFile(stopFile, "stop");
      await new Promise((resolve) => setTimeout(resolve, 50));
    },
    async close() {
      await this.stop();
      await rm(root, { recursive: true, force: true });
      await rm(lockPath, { force: true });
      await rm(socketPath, { force: true });
      if (createdSocketDirectory) {
        try {
          await rmdir(socketDirectory);
        } catch (error) {
          if (!["ENOENT", "ENOTEMPTY"].includes(error.code)) throw error;
        }
      }
    }
  };
}

async function assertMissing(filePath) {
  await assert.rejects(access(filePath), { code: "ENOENT" });
}

function assertStartupEvents(events, terminalCommand) {
  const xvfbIndex = events.indexOf("Xvfb");
  assert.ok(xvfbIndex > 0, `Xvfb did not start after display preparation: ${events.join(",")}`);
  assert.ok(events.slice(0, xvfbIndex).every((event) => event === "xdpyinfo"));
  assert.deepEqual(events.slice(xvfbIndex), [
    "Xvfb",
    "xdpyinfo",
    "x11vnc",
    "websockify",
    terminalCommand
  ]);
}

test("production entrypoint removes stale display lock/socket before Xvfb and dispatches the default worker", { skip: POSIX_ENTRYPOINT_SKIP }, async () => {
  const fixture = await createEntrypointFixture();
  try {
    await writeFile(fixture.lockPath, "  2147483647  \t\n");
    await writeFile(fixture.socketPath, "stale X11 socket");

    const result = await runEntrypoint({ fixture });
    await fixture.stop();

    assert.equal(result.code, 0, result.stderr);
    await assertMissing(fixture.lockPath);
    await assertMissing(fixture.socketPath);
    assertStartupEvents(
      (await readFile(fixture.eventLog, "utf8")).trim().split("\n"),
      "node:scripts/cloud-executor-worker.js:"
    );
  } finally {
    await fixture.stop();
    await fixture.close();
  }
});

test("production entrypoint preserves a padded live PID when the display probe fails", { skip: POSIX_ENTRYPOINT_SKIP }, async () => {
  const fixture = await createEntrypointFixture();
  try {
    const paddedPid = `${String(process.pid).padStart(10, " ")}\n`;
    await writeFile(fixture.lockPath, paddedPid);
    await writeFile(fixture.socketPath, "active X11 socket");

    const result = await runEntrypoint({ fixture });

    assert.equal(result.code, 1);
    assert.match(result.stderr, /CLOUD_EXECUTOR_XVFB_ALREADY_RUNNING/);
    assert.deepEqual((await readFile(fixture.eventLog, "utf8")).trim().split("\n"), ["xdpyinfo"]);
    assert.equal(await readFile(fixture.lockPath, "utf8"), paddedPid);
    assert.equal(await readFile(fixture.socketPath, "utf8"), "active X11 socket");
  } finally {
    await fixture.stop();
    await fixture.close();
  }
});

test("production entrypoint dispatches login after the same display startup sequence", { skip: POSIX_ENTRYPOINT_SKIP }, async () => {
  const fixture = await createEntrypointFixture();
  try {
    await writeFile(fixture.lockPath, "2147483647\n");
    await writeFile(fixture.socketPath, "stale X11 socket");

    const result = await runEntrypoint({ fixture, args: ["login"] });
    await fixture.stop();

    assert.equal(result.code, 0, result.stderr);
    await assertMissing(fixture.lockPath);
    await assertMissing(fixture.socketPath);
    assertStartupEvents(
      (await readFile(fixture.eventLog, "utf8")).trim().split("\n"),
      "node:scripts/cloud-executor.js:login"
    );
  } finally {
    await fixture.stop();
    await fixture.close();
  }
});

function disabledConfig(workspace = null) {
  return {
    enabled: false,
    configured: false,
    mode: "fail_closed",
    executorType: "cloud_executor",
    organizationId: null,
    executorCloudId: null,
    workspace,
    storage: workspace ? { root: workspace.root, minFreeBytes: 0 } : null,
    heartbeat: { enabled: false, standbyEnabled: false, url: null, token: null, timeoutMs: 15_000 },
    worker: { pollIntervalMs: 1000, leaseMs: 30_000, heartbeatIntervalMs: 5000, concurrency: 1 },
    health: { host: "127.0.0.1", port: 0 }
  };
}

test("disabled production worker is a long-lived healthy standby without DB, Hifly, browser, or claim wiring", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ce07-disabled-workspace-"));
  const workspace = createCloudWorkspaceConfig({ root, profileDir: path.join(root, "profile") });
  let poolCalls = 0;
  let portsCalls = 0;
  let hiflyConfigReads = 0;
  try {
    const first = await createCloudExecutorProductionRuntime({
      config: disabledConfig(workspace),
      createPool: () => { poolCalls += 1; throw new Error("disabled worker must not create a pool"); },
      portsFactory: async () => { portsCalls += 1; throw new Error("disabled worker must not assemble ports"); },
      loadHiflyConfig: () => { hiflyConfigReads += 1; throw new Error("disabled worker must not read Hifly config"); }
    });

    assert.equal(first.startup.status, "disabled");
    assert.equal(first.runtime.status, "disabled");
    assert.equal(first.runtime.service, null);
    assert.equal(first.runtime.worker, null);
    const marker = await readFile(workspace.profileMarkerPath, "utf8");
    await first.close();

    const restarted = await createCloudExecutorProductionRuntime({ config: disabledConfig(workspace) });
    assert.equal(await readFile(workspace.profileMarkerPath, "utf8"), marker);
    await restarted.close();
    assert.equal(poolCalls, 0);
    assert.equal(portsCalls, 0);
    assert.equal(hiflyConfigReads, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("inactive production workspace failure stays no-side-effect and reports a controlled readiness", async () => {
  let poolCalls = 0;
  const config = disabledConfig(createCloudWorkspaceConfig({ root: "/tmp/ce07-blocked", profileDir: "/tmp/ce07-blocked/profile" }));
  const handle = await createCloudExecutorProductionRuntime({
    config,
    ensureWorkspace: async () => { throw Object.assign(new Error("private path"), { code: "EACCES" }); },
    createPool: () => { poolCalls += 1; throw new Error("inactive worker must not create a pool"); }
  });
  assert.equal(handle.startup.status, "storage_blocked");
  assert.equal(handle.runtime.service, null);
  assert.equal(handle.runtime.worker, null);
  assert.equal(poolCalls, 0);
  await handle.close();
});

test("explicit standby pairing reports disabled without DB, browser, Hifly, order, or claim wiring", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ce07-standby-heartbeat-"));
  const workspace = createCloudWorkspaceConfig({ root, profileDir: path.join(root, "profile") });
  const reports = [];
  let poolCalls = 0;
  let portsCalls = 0;
  let hiflyConfigReads = 0;
  try {
    const config = {
      ...disabledConfig(workspace),
      executorCloudId: EXECUTOR_ID,
      organizationId: ORGANIZATION_ID,
      heartbeat: {
        enabled: true,
        standbyEnabled: true,
        url: "http://app:3000/internal/cloud-executor/v1/heartbeat",
        token: "standby-test-token",
        timeoutMs: 15_000
      }
    };
    const handle = await createCloudExecutorProductionRuntime({
      config,
      heartbeatFactory: () => ({ async report(value) { reports.push(value); } }),
      createPool: () => { poolCalls += 1; throw new Error("standby must not create a pool"); },
      portsFactory: () => { portsCalls += 1; throw new Error("standby must not create ports"); },
      loadHiflyConfig: () => { hiflyConfigReads += 1; throw new Error("standby must not read Hifly config"); }
    });
    assert.deepEqual(reports, [{ readinessStatus: "disabled", progressPhase: "standby" }]);
    assert.equal(handle.runtime.service, null);
    assert.equal(handle.runtime.worker, null);
    assert.equal(poolCalls, 0);
    assert.equal(portsCalls, 0);
    assert.equal(hiflyConfigReads, 0);
    await handle.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("active production runtime assembles the standalone Worker with DB, ports, and heartbeat only", async () => {
  const calls = [];
  let runtimeOptions = null;
  let pool = null;
  const config = {
    enabled: true,
    configured: true,
    mode: "fake",
    organizationId: ORGANIZATION_ID,
    executorCloudId: EXECUTOR_ID,
    databaseUrl: "postgresql://worker@postgres/cloud",
    databasePoolMax: 3,
    databaseSsl: false,
    heartbeat: { enabled: true, url: "http://app:3000/internal/cloud-executor/v1/heartbeat", token: "test-token", timeoutMs: 15_000 },
    worker: { pollIntervalMs: 1000, leaseMs: 30_000, heartbeatIntervalMs: 5000, concurrency: 1 }
  };
  const ports = {
    runtimeOptions: { marker: "standalone-ports" },
    verificationWorker: { start() { calls.push("verification.start"); }, stop() { calls.push("verification.stop"); } },
    async close() { calls.push("ports.close"); }
  };
  const handle = await createCloudExecutorProductionRuntime({
    config,
    createPool(input) { calls.push(["pool", input]); pool = { async end() { calls.push("pool.end"); } }; return pool; },
    portsFactory(input) { calls.push(["ports", input.config.mode]); return ports; },
    heartbeatFactory(input) { calls.push(["heartbeat", input.url]); return { report() {} }; },
    runtimeFactory(input) {
      runtimeOptions = input;
      return { status: "standby", async start() { calls.push("runtime.start"); return { status: "running" }; }, async close() { calls.push("runtime.close"); } };
    },
    loadHiflyConfig() { throw new Error("fake mode must not read Hifly config"); }
  });

  assert.equal(handle.startup.status, "running");
  assert.equal(runtimeOptions.marker, "standalone-ports");
  assert.equal(typeof runtimeOptions.heartbeatPort.report, "function");
  assert.deepEqual(calls.slice(0, 4), [
    ["heartbeat", config.heartbeat.url],
    ["pool", { connectionString: config.databaseUrl, max: 3, ssl: false }],
    ["ports", "fake"],
    "runtime.start"
  ]);
  await handle.close();
  assert.deepEqual(calls.slice(-3), ["runtime.close", "ports.close", "pool.end"]);
});

test("production port assembly schema-checks PostgreSQL repositories and keeps worker ports separate from the Web app", async () => {
  const root = await new Promise((resolve, reject) => {
    import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(path.join(os.tmpdir(), "ce07-ports-"))).then(resolve, reject);
  });
  const workspace = createCloudWorkspaceConfig({ root, profileDir: path.join(root, "profile") });
  const initialized = [];
  const repositories = {
    identity: createMemoryIdentityRepositoryWithProbe("identity", initialized),
    assets: createMemoryAssetRepositoryWithProbe(initialized),
    productionOrders: createMemoryProductionOrderRepositoryWithProbe(initialized),
    manualHandoff: createMemoryManualHandoffRepositoryWithProbe(initialized),
    manualExecution: createMemoryManualExecutionRepositoryWithProbe(initialized),
    workVerification: createMemoryWorkVerificationRepositoryWithProbe(initialized)
  };
  const stores = new Map();
  const ports = await createCloudExecutorProductionPorts({
    pool: { marker: "postgres-pool" },
    config: {
      organizationId: ORGANIZATION_ID,
      executorCloudId: EXECUTOR_ID,
      workspace,
      handoffDir: path.join(root, "handoff"),
      worker: { pollIntervalMs: 1000, leaseMs: 30_000, heartbeatIntervalMs: 5000 }
    },
    repositoryFactories: {
      identity: () => repositories.identity,
      assets: () => repositories.assets,
      productionOrders: () => repositories.productionOrders,
      manualHandoff: () => repositories.manualHandoff,
      manualExecution: () => repositories.manualExecution,
      workVerification: () => repositories.workVerification
    },
    objectStoreFactory: ({ root: storeRoot }) => {
      const store = createMemoryObjectStore();
      stores.set(storeRoot, store);
      return store;
    },
    verificationWorkerFactory: () => ({ start() {}, stop() {}, wake() {} })
  });

  assert.deepEqual(initialized, ["identity", "assets", "productionOrders", "manualHandoff", "manualExecution", "workVerification"]);
  assert.equal(typeof ports.runtimeOptions.repository.claimAttempt, "function");
  assert.equal(typeof ports.runtimeOptions.orderPort.listOrdersForCloudExecutor, "function");
  assert.equal(typeof ports.runtimeOptions.orderPort.transitionOrderForCloudExecutor, "function");
  assert.equal(typeof ports.runtimeOptions.packagePort.downloadPackageForCloudExecutor, "function");
  assert.equal(typeof ports.runtimeOptions.verificationPort.requestVerification, "function");
  assert.equal(typeof ports.verificationWorker.start, "function");
  assert.equal(stores.size, 2);
  await ports.close();
});

test("playwright production ports resolve a current registered avatar from the read-only source store", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ce07-avatar-source-"));
  const workspace = createCloudWorkspaceConfig({ root, profileDir: path.join(root, "profile") });
  const initialized = [];
  const assets = createMemoryAssetRepositoryWithProbe(initialized);
  const repositories = {
    identity: createMemoryIdentityRepositoryWithProbe("identity", initialized),
    assets,
    productionOrders: createMemoryProductionOrderRepositoryWithProbe(initialized),
    manualHandoff: createMemoryManualHandoffRepositoryWithProbe(initialized),
    manualExecution: createMemoryManualExecutionRepositoryWithProbe(initialized),
    workVerification: createMemoryWorkVerificationRepositoryWithProbe(initialized)
  };
  const avatarSelection = {
    async initialize() { initialized.push("avatarSelection"); },
    async close() { initialized.push("avatarSelection.close"); },
    async getSelectionState() {
      return { current_selection: { organization_id: ORGANIZATION_ID, product_id: "product-source", id: "selection-source",
        copy_version_id: "copy-source", asset_version_id: "avatar-version-source", status: "confirmed" } };
    },
    async getCatalogVersion(_organizationId, _avatarVersionId) {
      return { asset: { organization_id: ORGANIZATION_ID, status: "active" }, asset_version: {
        organization_id: ORGANIZATION_ID, id: "avatar-version-source", status: "available", material_asset_version_id: materialVersionId,
        materials_accessible: true, material_status: "available", authorization_status: "valid", authorization_scope: "current_organization",
        capability_status: "verified", authorization_expires_at: null
      }, capabilities: [{ verification_status: "verified", evidence_reference: "fixture:avatar" }] };
    }
  };
  let materialVersionId = null;
  let sourceStore = null;
  let sourcePutCount = 0;
  let sourceInitializeCount = 0;
  const storeRoots = [];
  try {
    const ports = await createCloudExecutorProductionPorts({
      pool: { marker: "fake-pool" },
      config: { mode: "playwright", organizationId: ORGANIZATION_ID, executorCloudId: EXECUTOR_ID, workspace,
        handoffDir: path.join(root, "handoff"), sourceAssetsRoot: path.join(root, "source-objects"),
        worker: { pollIntervalMs: 1000, leaseMs: 30_000, heartbeatIntervalMs: 5000 } },
      repositoryFactories: {
        identity: () => repositories.identity, assets: () => repositories.assets,
        productionOrders: () => repositories.productionOrders, manualHandoff: () => repositories.manualHandoff,
        manualExecution: () => repositories.manualExecution, workVerification: () => repositories.workVerification,
        avatarSelection: () => avatarSelection
      },
      objectStoreFactory: ({ root: storeRoot, kind }) => {
        const store = createMemoryObjectStore();
        storeRoots.push({ root: storeRoot, kind });
        if (kind === "source") {
          sourceStore = store;
          const initialize = store.initialize;
          store.initialize = async () => { sourceInitializeCount += 1; await initialize(); };
          const put = store.put.bind(store);
          store.put = async (input) => { sourcePutCount += 1; return put(input); };
        }
        return store;
      },
      verificationWorkerFactory: () => ({ start() {}, stop() {}, wake() {} })
    });

    const sourceAssetService = createAssetService({ repository: assets, objectStore: sourceStore });
    const avatarBytes = PNG;
    const checksum = createHash("sha256").update(avatarBytes).digest("hex");
    const created = await sourceAssetService.createUploadAuthorization({ organizationId: ORGANIZATION_ID, actorMemberId: "member-source",
      idempotencyKey: "source-avatar-upload", filename: "avatar.png", contentType: "image/png", size: avatarBytes.length, checksumSha256: checksum, assetKind: "avatar_image" });
    materialVersionId = created.asset_version.id;
    await sourceAssetService.uploadObject({ organizationId: ORGANIZATION_ID, uploadToken: created.upload.token, body: avatarBytes, contentType: "image/png" });
    await sourceAssetService.completeUpload({ organizationId: ORGANIZATION_ID, uploadSessionId: created.upload_session_id, idempotencyKey: "source-avatar-complete" });
    await sourceAssetService.runNextVerificationJob();
    const beforeReadPuts = sourcePutCount;
    const source = await ports.runtimeOptions.avatarAssetSource.readVerifiedAvatarImage({ organizationId: ORGANIZATION_ID, productId: "product-source",
      copyVersionId: "copy-source", avatarSelectionId: "selection-source", avatarVersionId: "avatar-version-source", materialVersionId });
    assert.deepEqual(source.bytes, avatarBytes);
    assert.equal(source.asset_version_id, materialVersionId);
    assert.equal(source.kind, "avatar_image");
    assert.equal(sourcePutCount, beforeReadPuts);
    assert.equal(sourceInitializeCount, 0);
    assert.deepEqual(storeRoots.at(-1), { root: path.join(root, "source-objects"), kind: "source" });
    await ports.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("production ports pass the source resolver into the default Cloud runtime without a network or mapping path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ce07-runtime-source-"));
  const workspace = createCloudWorkspaceConfig({ root, profileDir: path.join(root, "profile") });
  const avatarBytes = PNG;
  const contract = buildHiflyHandsOnProductV1({
    plan: { video_plan_version_id: "plan-runtime-source", plan_review_id: "review-runtime-source", status: "frozen", review_status: "approved", current: true },
    product: { revision_id: "revision-runtime-source", primary_asset_version_id: "product-version-runtime-source", checksum_sha256: sha256(Buffer.from("product-runtime")), media_type: "image/png", size: Buffer.byteLength("product-runtime") },
    copy: { version_id: "copy-runtime-source", status: "frozen", review_status: "approved", body: "运行时源测试文案。" },
    avatar: { selection_id: "selection-runtime-source", avatar_version_id: "avatar-version-runtime-source", material_version_id: "material-version-runtime-source", checksum_sha256: sha256(avatarBytes), media_type: "image/png", size: avatarBytes.length, status: "confirmed", current: true }
  });
  const manifest = {
    package_id: "package-runtime-source", package_version: 1, organization_id: "org-runtime-source", production_order_id: "order-runtime-source", product_id: "product-runtime-source",
    video_plan_version_id: "plan-runtime-source", copy_version_id: "copy-runtime-source", avatar_asset_version_id: "avatar-version-runtime-source", hifly_hands_on_product_v1: contract,
    product_revision: { id: "revision-runtime-source", status: "ready", product_name: "Runtime source product", sku: "SKU-RUNTIME", asset_version_ids: ["product-version-runtime-source"] },
    copy_snapshot: { copy_version_id: "copy-runtime-source", version_number: 1, status: "frozen", copy_body: "运行时源测试文案。", review: { id: "copy-review-runtime-source", status: "approved" } },
    avatar_snapshot: { avatar_selection_id: "selection-runtime-source", avatar_asset_version_id: "avatar-version-runtime-source", status: "confirmed" },
    video_plan_snapshot: { id: "plan-runtime-source", status: "frozen", presentation_size_code: "smart_fit" },
    plan_review: { id: "review-runtime-source", status: "approved" },
    asset_references: [{ asset_id: "product-asset-runtime-source", asset_version_id: "product-version-runtime-source", role: "product_image", media_type: "image/png", size: Buffer.byteLength("product-runtime"), checksum: sha256(Buffer.from("product-runtime")), retrieval_mode: "embedded" }]
  };
  const packageArchive = await buildManualHandoffZip([
    { name: "manifest.json", body: JSON.stringify(manifest) },
    { name: "assets/product-version-runtime-source", body: Buffer.from("product-runtime") }
  ]);
  const sourceCalls = [];
  const contextCalls = [];
  const page = { setDefaultTimeout() {} };
  const context = { pages() { return [page]; }, async newPage() { return page; }, async close() { contextCalls.push("close"); } };
  const executionRepository = createMemoryManualExecutionRepository();
  const orderPort = {
    async listOrdersForCloudExecutor() { return []; },
    async getOrderForCloudExecutor() { return null; },
    async transitionOrderForCloudExecutor() { return null; }
  };
  const packagePort = {
    async listPackagesForCloudExecutor() { return []; },
    async getPackageForCloudExecutor() { return null; },
    async downloadPackageForCloudExecutor() { return null; }
  };
  const source = {
    async readVerifiedAvatarImage(input) {
      sourceCalls.push(input);
      return { asset_id: "avatar-asset-runtime-source", asset_version_id: "material-version-runtime-source", kind: "avatar_image",
        bytes: avatarBytes, media_type: "image/png", size: avatarBytes.length, checksum_sha256: sha256(avatarBytes) };
    }
  };
  let portsClosed = false;
  const config = {
    enabled: true, configured: true, mode: "playwright", organizationId: "org-runtime-source", executorCloudId: "cloud-runtime-source",
    databaseUrl: "postgresql://worker@postgres/cloud", databasePoolMax: 3, databaseSsl: false, workspace,
    handoffDir: path.join(root, "handoff"), storage: { root: workspace.root, minFreeBytes: 0 },
    heartbeat: { enabled: true, url: "http://app.test/heartbeat", token: "unused-test-token", timeoutMs: 15_000 },
    worker: { pollIntervalMs: 60_000, leaseMs: 30_000, heartbeatIntervalMs: 5000, concurrency: 1 },
    browserType: { async launchPersistentContext() { contextCalls.push("launch"); return context; } },
    hiflyPageFactory() {
      return { async preflight() { return { status: "ready" }; }, async createAsset() {}, async submitVideo() {}, async querySubmission() {}, async downloadArtifact() {}, async reconcileSubmission() {} };
    },
    executorFactory: ({ hiflyPage }) => hiflyPage,
    contractFieldVerifier: async () => false
  };
  const ports = {
    runtimeOptions: { repository: executionRepository, orderPort, packagePort, candidateStore: createMemoryObjectStore(), avatarAssetSource: source },
    verificationWorker: { start() {}, stop() {} },
    async close() { portsClosed = true; }
  };
  try {
    const handle = await createCloudExecutorProductionRuntime({
      config,
      createPool: () => ({ async end() {} }),
      portsFactory: async () => ports,
      runtimeFactory: createCloudExecutorRuntime,
      heartbeatFactory: () => ({ async report() {} }),
      loadHiflyConfig: () => ({})
    });
    handle.runtime.worker.stop();
    const result = await handle.runtime.executor.run({
      attempt: { id: "attempt-runtime-source" },
      packageArchive: { body: packageArchive, contentType: "application/zip" }
    });
    assert.equal(result.status, "requires_action");
    assert.equal(result.code, "CONTRACT_STRUCTURED_EVIDENCE_REQUIRED");
    assert.deepEqual(sourceCalls, [{
      organizationId: "org-runtime-source", productId: "product-runtime-source", copyVersionId: "copy-runtime-source",
      avatarSelectionId: "selection-runtime-source", avatarVersionId: "avatar-version-runtime-source",
      materialVersionId: "material-version-runtime-source", assetVersionId: "material-version-runtime-source"
    }]);
    assert.deepEqual(contextCalls, ["launch", "close"]);
    await handle.close();
    assert.equal(portsClosed, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("heartbeat sends only allowlisted state with the Bearer token from env and never exposes it", async () => {
  const requests = [];
  const client = createCloudExecutorHeartbeatClient({
    enabled: true,
    url: "https://pilot.example.test/internal/cloud-executor/v1/heartbeat",
    token: "heartbeat-secret-for-test",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return new Response(JSON.stringify({ status: "online", secret: "must-not-be-forwarded" }), { status: 200 });
    }
  });

  const result = await client.report({ readinessStatus: "available", progressPhase: "standby" });
  assert.equal(result.status, "online");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://pilot.example.test/internal/cloud-executor/v1/heartbeat");
  assert.equal(requests[0].init.headers.authorization, "Bearer heartbeat-secret-for-test");
  assert.deepEqual(JSON.parse(requests[0].init.body), { readiness_status: "available", progress_phase: "standby" });
  assert.doesNotMatch(JSON.stringify(result), /heartbeat-secret-for-test|must-not-be-forwarded/i);

  await assert.rejects(
    client.report({ readinessStatus: "available", progressPhase: "private_exception" }),
    { code: "CLOUD_EXECUTOR_HEARTBEAT_STATE_INVALID" }
  );
  assert.equal(requests.length, 1);
});

test("disabled heartbeat client is a no-op and does not require a token or URL", async () => {
  let fetchCalls = 0;
  const client = createCloudExecutorHeartbeatClient({ enabled: false, fetchImpl: async () => { fetchCalls += 1; } });
  assert.deepEqual(await client.report({ readinessStatus: "disabled", progressPhase: "standby" }), { status: "disabled", skipped: true });
  assert.equal(fetchCalls, 0);
});

test("standalone configuration fixes concurrency at one and rejects unsafe heartbeat URLs", () => {
  const config = createCloudExecutorConfig({
    root: "/tmp/ce07-config",
    env: { CLOUD_EXECUTOR_ENABLED: "false", CLOUD_EXECUTOR_CONCURRENCY: "1", DATABASE_URL: "postgresql://worker@db/pilot" }
  });
  assert.equal(config.worker.concurrency, 1);
  assert.equal(config.databaseUrl, "postgresql://worker@db/pilot");
  assert.equal(config.heartbeat.standbyEnabled, false);
  const paired = createCloudExecutorConfig({ env: {
    CLOUD_EXECUTOR_ENABLED: "false",
    CLOUD_EXECUTOR_STANDBY_HEARTBEAT_ENABLED: "true",
    CLOUD_EXECUTOR_ID: EXECUTOR_ID,
    CLOUD_EXECUTOR_ORGANIZATION_ID: ORGANIZATION_ID,
    CLOUD_EXECUTOR_HEARTBEAT_URL: "http://app:3000/internal/cloud-executor/v1/heartbeat",
    CLOUD_EXECUTOR_HEARTBEAT_TOKEN: "test-token"
  } });
  assert.equal(paired.heartbeat.enabled, true);
  assert.equal(paired.heartbeat.standbyEnabled, true);
  assert.throws(() => createCloudExecutorConfig({ env: {
    CLOUD_EXECUTOR_STANDBY_HEARTBEAT_ENABLED: "true",
    CLOUD_EXECUTOR_HEARTBEAT_URL: "http://app:3000/internal/cloud-executor/v1/heartbeat",
    CLOUD_EXECUTOR_HEARTBEAT_TOKEN: "test-token"
  } }), { code: "CLOUD_EXECUTOR_STANDBY_HEARTBEAT_CONFIG_REQUIRED" });
  assert.throws(() => createCloudExecutorConfig({ env: { CLOUD_EXECUTOR_CONCURRENCY: "2" } }), { code: "CLOUD_EXECUTOR_CONCURRENCY_INVALID" });
  assert.throws(() => createCloudExecutorHeartbeatClient({ enabled: true, url: "https://pilot.test/internal/cloud-executor/v1/heartbeat?token=secret", token: "test" }), { code: "CLOUD_EXECUTOR_HEARTBEAT_URL_INVALID" });
});

test("worker heartbeat reports busy and terminal state using only the public allowlist", async () => {
  const reports = [];
  const worker = createCloudExecutorWorker({
    service: { async runOnce() { return { status: "standby", claimed: false, private_error: "must-not-be-forwarded" }; } },
    pollIntervalMs: 1000,
    heartbeatIntervalMs: 1000,
    heartbeatPort: { async report(state) { reports.push(state); } }
  });
  await worker.runNext();
  worker.stop();
  assert.deepEqual(reports, [
    { readinessStatus: "busy", progressPhase: "executing" },
    { readinessStatus: "available", progressPhase: "standby" }
  ]);
  assert.doesNotMatch(JSON.stringify(reports), /private_error|must-not-be-forwarded/i);
});

test("standalone health server reports disabled standby without secrets or claim state", async () => {
  const handle = {
    config: { mode: "fail_closed", worker: { concurrency: 1 } },
    startup: { status: "disabled" },
    runtime: { status: "disabled", worker: null }
  };
  const health = createCloudExecutorHealthServer({ processRuntime: handle, host: "127.0.0.1", port: 0 });
  await health.listen();
  try {
    const address = health.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, {
      status: "ok",
      runtime: "cloud_executor",
      readiness: "disabled",
      worker: "standby",
      concurrency: 1,
      claim_enabled: false
    });
    assert.doesNotMatch(JSON.stringify(body), /token|profile|path|secret|available/i);
  } finally {
    await health.close();
  }
});

test("Windows separators are accepted for relative artifacts but drive and UNC paths fail closed", () => {
  const root = path.resolve(os.tmpdir(), "ce07-artifact-root");
  assert.equal(safeArtifactPath(root, "outputs\\video.mp4"), path.join(root, "outputs", "video.mp4"));
  for (const value of ["C:\\private\\video.mp4", "\\\\server\\share\\video.mp4"]) {
    assert.throws(() => safeArtifactPath(root, value), { code: "CLOUD_EXECUTOR_ARTIFACT_PATH_INVALID" });
  }
});

test("production Compose and image define one disabled worker with persistent media, Chrome/Xvfb, and loopback noVNC", async () => {
  const compose = await readFile(new URL("../docker-compose.production.yml", import.meta.url), "utf8");
  const dockerfile = await readFile(new URL("../deploy/cloud-executor.Dockerfile", import.meta.url), "utf8");
  const entrypoint = await readFile(new URL("../deploy/cloud-executor-entrypoint.sh", import.meta.url), "utf8");
  const envExample = await readFile(new URL("../.env.example", import.meta.url), "utf8");
  const runbook = await readFile(new URL("../docs/deployment/ALIYUN_CLOUD_EXECUTOR_CE07_RUNBOOK.md", import.meta.url), "utf8");

  assert.match(compose, /\r?\n  cloud_executor:\r?\n/);
  assert.match(compose, /dockerfile: deploy\/cloud-executor\.Dockerfile/);
  assert.match(compose, /CLOUD_EXECUTOR_ENABLED: \$\{CLOUD_EXECUTOR_ENABLED:-false\}/);
  assert.match(compose, /CLOUD_EXECUTOR_MODE: \$\{CLOUD_EXECUTOR_MODE:-fail_closed\}/);
  assert.match(compose, /CLOUD_EXECUTOR_CONCURRENCY: "1"/);
  const appService = compose.slice(compose.indexOf("\n  app:"), compose.indexOf("\n  postgres:"));
  const cloudService = compose.slice(compose.indexOf("\n  cloud_executor:"), compose.indexOf("\nvolumes:"));
  assert.match(appService, /CLOUD_EXECUTOR_OUTPUTS_DIR: \$\{CLOUD_EXECUTOR_OUTPUTS_DIR:-\/var\/lib\/hifly-executor\/outputs\}/);
  assert.match(appService, /cloud_executor_outputs:\$\{CLOUD_EXECUTOR_OUTPUTS_DIR:-\/var\/lib\/hifly-executor\/outputs\}:ro/);
  assert.match(cloudService, /cloud_executor_outputs:\$\{CLOUD_EXECUTOR_OUTPUTS_DIR:-\/var\/lib\/hifly-executor\/outputs\}\r?\n/);
  assert.doesNotMatch(cloudService, /cloud_executor_outputs:\$\{CLOUD_EXECUTOR_OUTPUTS_DIR:-\/var\/lib\/hifly-executor\/outputs\}:ro/);
  assert.match(cloudService, /networks:\r?\n      - internal\r?\n      - executor_egress/);
  assert.doesNotMatch(cloudService, /(?:0\.0\.0\.0|\$\{[^}]*\}):3001:3001/);
  assert.match(compose, /\n  executor_egress:\r?\n/);
  assert.match(compose, /TRUSTED_HOSTS: \$\{TRUSTED_HOSTS:-[^\r\n]*app:3000/);
  assert.equal(compose.match(/CLOUD_EXECUTOR_STANDBY_HEARTBEAT_ENABLED: \$\{CLOUD_EXECUTOR_STANDBY_HEARTBEAT_ENABLED:-false\}/g)?.length, 2);
  assert.match(cloudService, /CLOUD_EXECUTOR_HEARTBEAT_URL: \$\{CLOUD_EXECUTOR_HEARTBEAT_URL:-http:\/\/app:3000\/internal\/cloud-executor\/v1\/heartbeat\}/);
  assert.match(compose, /cloud_executor_profile:\/var\/lib\/hifly-executor\/profile/);
  assert.match(compose, /cloud_executor_assets:\/var\/lib\/hifly-executor\/assets/);
  assert.match(compose, /cloud_executor_outputs:\$\{CLOUD_EXECUTOR_OUTPUTS_DIR:-\/var\/lib\/hifly-executor\/outputs\}/);
  assert.match(compose, /cloud_executor_evidence:\/var\/lib\/hifly-executor\/evidence/);
  assert.match(compose, /127\.0\.0\.1:\$\{CLOUD_EXECUTOR_NOVNC_HOST_PORT:-6080\}:6080/);
  assert.doesNotMatch(compose, /0\.0\.0\.0:\$\{CLOUD_EXECUTOR_NOVNC_HOST_PORT/);
  assert.match(compose, /mem_limit: 1024m/);
  assert.match(compose, /cpus: 0\.75/);
  assert.match(compose, /pids_limit: 256/);
  assert.match(compose, /healthcheck:/);
  assert.match(compose, /restart: unless-stopped/);

  assert.match(dockerfile, /FROM node:22-bookworm-slim/);
  for (const packageName of ["xvfb", "x11vnc", "novnc", "websockify", "x11-utils"]) assert.match(dockerfile, new RegExp(`\\b${packageName}\\b`));
  assert.match(dockerfile, /playwright install --with-deps chromium/);
  const userNodeIndex = dockerfile.indexOf("USER node");
  const x11DirectoryIndex = dockerfile.indexOf("mkdir -p /tmp/.X11-unix");
  const x11ModeIndex = dockerfile.indexOf("chmod 1777 /tmp/.X11-unix");
  assert.ok(x11DirectoryIndex >= 0 && x11DirectoryIndex < userNodeIndex, "fresh images must create the X11 socket directory before dropping root");
  assert.ok(x11ModeIndex >= 0 && x11ModeIndex < userNodeIndex, "fresh images must make the X11 socket directory world-writable before dropping root");
  assert.match(dockerfile, /ENTRYPOINT \["\/app\/deploy\/cloud-executor-entrypoint\.sh"\]/);
  assert.match(entrypoint, /Xvfb "\$DISPLAY"/);
  assert.match(entrypoint, /x11vnc [^\n]*-listen 127\.0\.0\.1/);
  assert.match(entrypoint, /websockify .*"0\.0\.0\.0:\$NOVNC_PORT" "127\.0\.0\.1:5900"/);
  assert.match(entrypoint, /login\)[\s\S]*exec node scripts\/cloud-executor\.js login/);
  assert.match(entrypoint, /worker\|''\)[\s\S]*exec node scripts\/cloud-executor-worker\.js/);
  assert.doesNotMatch(entrypoint, /migrate:production|runProductionMigrations/);
  assert.match(runbook, /stop cloud_executor[\s\S]*run --rm --service-ports cloud_executor login[\s\S]*up -d cloud_executor/);

  for (const line of [
    "CLOUD_EXECUTOR_ENABLED=false",
    "CLOUD_EXECUTOR_MODE=fail_closed",
    "CLOUD_EXECUTOR_STANDBY_HEARTBEAT_ENABLED=false",
    "CLOUD_EXECUTOR_CONCURRENCY=1",
    "CLOUD_EXECUTOR_HEARTBEAT_URL=http://app:3000/internal/cloud-executor/v1/heartbeat",
    "CLOUD_EXECUTOR_HEARTBEAT_TOKEN=",
    "CLOUD_EXECUTOR_PROFILE_DIR=/var/lib/hifly-executor/profile",
    "CLOUD_EXECUTOR_ASSETS_DIR=/var/lib/hifly-executor/assets",
    "CLOUD_EXECUTOR_OUTPUTS_DIR=/var/lib/hifly-executor/outputs",
    "CLOUD_EXECUTOR_EVIDENCE_DIR=/var/lib/hifly-executor/evidence",
    "CLOUD_EXECUTOR_HEALTH_PORT=3001",
    "CLOUD_EXECUTOR_NOVNC_BIND_HOST=127.0.0.1"
  ]) assert.match(envExample, new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), line);
  assert.doesNotMatch(envExample, /Bearer\s+[A-Za-z0-9]/i);
});

test("production config keeps app writes on the main store and reads cloud outputs as an explicit fallback", () => {
  const env = {
    DATABASE_URL: "postgresql://pilot:secret@postgres:5432/hifly_pilot",
    PUBLIC_HOST: "pilot.example.test",
    PUBLIC_ORIGIN: "https://pilot.example.test",
    INITIAL_ADMIN_EMAIL: "admin@pilot.example.test",
    INITIAL_ADMIN_PASSWORD: "Pilot-Initial-Password-9!",
    INITIAL_ORGANIZATION_ID: "org_pilot",
    INITIAL_ORGANIZATION_NAME: "Pilot Organization"
  };
  const config = createProductionConfig({ root: "/tmp/hifly-production-config", env });
  assert.equal(config.assets.localRoot, path.resolve("/var/lib/hifly/objects"));
  assert.equal(config.assets.readOnlyFallbackRoot, path.resolve("/var/lib/hifly-executor/outputs"));
  const custom = createProductionConfig({ root: "/tmp/hifly-production-config", env: { ...env, CLOUD_EXECUTOR_OUTPUTS_DIR: "/srv/cloud-outputs" } });
  assert.equal(custom.assets.readOnlyFallbackRoot, path.resolve("/srv/cloud-outputs"));
});

function withInitialize(name, value, initialized) {
  return { ...value, async initialize() { initialized.push(name); await value.initialize?.(); } };
}

function createMemoryIdentityRepositoryWithProbe(name, initialized) {
  return withInitialize(name, { async initialize() {}, async close() {} }, initialized);
}

function createMemoryAssetRepositoryWithProbe(initialized) {
  const repository = createMemoryAssetRepository();
  return withInitialize("assets", repository, initialized);
}

function createMemoryProductionOrderRepositoryWithProbe(initialized) {
  const repository = createMemoryProductionOrderRepository();
  return withInitialize("productionOrders", repository, initialized);
}

function createMemoryManualHandoffRepositoryWithProbe(initialized) {
  const repository = createMemoryManualHandoffRepository();
  return withInitialize("manualHandoff", repository, initialized);
}

function createMemoryManualExecutionRepositoryWithProbe(initialized) {
  const repository = createMemoryManualExecutionRepository();
  return withInitialize("manualExecution", repository, initialized);
}

function createMemoryWorkVerificationRepositoryWithProbe(initialized) {
  const repository = createMemoryWorkVerificationRepository();
  return withInitialize("workVerification", repository, initialized);
}
