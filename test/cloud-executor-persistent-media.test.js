import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createCloudExecutorConfig } from "../src/cloud-executor/config.js";
import { createCloudExecutorRuntime } from "../src/cloud-executor/runtime.js";
import {
  checkCloudExecutorStorage,
  createCloudWorkspaceConfig,
  ensureCloudExecutorWorkspace
} from "../src/cloud-executor/workspace.js";
import { createAssetService } from "../src/assets/asset-service.js";
import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createLocalObjectStore } from "../src/assets/local-object-store.js";
import { createMemoryManualExecutionRepository } from "../src/manual-execution/memory-manual-execution-repository.js";
import { createMemoryWorkDeliveryRepository } from "../src/work-delivery/memory-work-delivery-repository.js";
import { createWorkDeliveryService } from "../src/work-delivery/work-delivery-service.js";
import { createVerifiedOutputAssetPort } from "../src/work-verification/verified-output-asset-port.js";
import { activateAdmin, identityApp, identityHeaders } from "./helpers/identity-world.js";

test("cloud workspace persists fixed profile, asset, output, and evidence directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cloud-executor-persistent-media-"));
  try {
    const workspace = createCloudWorkspaceConfig({
      root,
      profileDir: path.join(root, "profile")
    });

    await ensureCloudExecutorWorkspace(workspace);

    for (const directory of [workspace.profileDir, workspace.assetsDir, workspace.outputsDir, workspace.evidenceDir]) {
      assert.equal((await stat(directory)).isDirectory(), true);
    }
    assert.equal((await stat(workspace.profileMarkerPath)).isFile(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cloud storage readiness uses injected statfs capacity and blocks below the configured threshold", async () => {
  const available = await checkCloudExecutorStorage({
    root: "/persistent/cloud-executor",
    minFreeBytes: 100,
    statfsImpl: async () => ({ bavail: 10, bsize: 20 })
  });
  assert.equal(available.ready, true);
  assert.equal(available.status, "available");

  const blocked = await checkCloudExecutorStorage({
    root: "/persistent/cloud-executor",
    minFreeBytes: 201,
    statfsImpl: async () => ({ bavail: 10, bsize: 20 })
  });
  assert.equal(blocked.ready, false);
  assert.equal(blocked.status, "storage_blocked");
});

test("runtime checks every writable workspace mount and blocks when only outputs is low", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cloud-executor-storage-blocked-"));
  const workspace = createCloudWorkspaceConfig({ root, profileDir: path.join(root, "profile") });
  const repository = createMemoryManualExecutionRepository();
  const checkedPaths = [];
  let listCalls = 0;
  let transitionCalls = 0;
  const runtime = createCloudExecutorRuntime({
    config: {
      enabled: true, configured: true, mode: "fake", organizationId: "org_test", executorCloudId: "cloud-executor-storage-blocked",
      workspace, storage: { root, minFreeBytes: 100, statfsImpl: async (target) => {
        checkedPaths.push(target);
        return { availableBytes: target === workspace.outputsDir ? 99 : 1_000 };
      } }, worker: { pollIntervalMs: 1 }
    },
    repository,
    orderPort: {
      async listOrdersForCloudExecutor() { listCalls += 1; return []; },
      async getOrderForCloudExecutor() { return null; },
      async transitionOrderForCloudExecutor() { transitionCalls += 1; return null; }
    },
    packagePort: {
      async listPackagesForCloudExecutor() { return []; },
      async getPackageForCloudExecutor() { return null; }
    }
  });

  try {
    const result = await runtime.runOnce();
    assert.equal(result.status, "storage_blocked");
    assert.equal(listCalls, 0);
    assert.equal(transitionCalls, 0);
    assert.equal((await repository.listAttempts("org_test")).length, 0);
    assert.deepEqual(new Set(checkedPaths), new Set([
      root, workspace.assetsDir, workspace.outputsDir, workspace.evidenceDir, workspace.batchDir, workspace.lockDir
    ]));
    assert.equal(checkedPaths.includes(workspace.profileDir), false);
    assert.equal(JSON.stringify(result).includes(root), false);
    assert.equal(JSON.stringify(result).includes("availableBytes"), false);
  } finally {
    await runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("cloud executor config exposes a configurable disk threshold without changing fail-closed defaults", () => {
  const config = createCloudExecutorConfig({
    root: "/tmp/cloud-executor-config-test",
    env: {
      CLOUD_EXECUTOR_ENABLED: "false",
      CLOUD_EXECUTOR_MIN_FREE_BYTES: "123456"
    }
  });

  assert.equal(config.enabled, false);
  assert.equal(config.mode, "fail_closed");
  assert.equal(config.storage.minFreeBytes, 123456);
  assert.equal(config.storage.root, config.workspace.root);
});

test("CE-05 deployment contract mounts only the persistent media directories and leaves Profile in CE-04", async () => {
  const contract = await readFile(new URL("../deploy/cloud-executor-storage.yml", import.meta.url), "utf8");
  assert.match(contract, /cloud_executor_assets:\/var\/lib\/hifly-executor\/assets/);
  assert.match(contract, /cloud_executor_outputs:\/var\/lib\/hifly-executor\/outputs/);
  assert.match(contract, /cloud_executor_evidence:\/var\/lib\/hifly-executor\/evidence/);
  assert.match(contract, /CLOUD_EXECUTOR_MIN_FREE_BYTES/);
  assert.doesNotMatch(contract, /profile:\/var\/lib\/hifly-executor\/profile/);
});

test("a restarted cloud runtime reuses persistent media and the authenticated Work download path", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cloud-executor-restart-media-"));
  const organizationId = "org_test";
  const executorCloudId = "cloud-executor-persistent";
  const workspace = createCloudWorkspaceConfig({ root, profileDir: path.join(root, "profile") });
  const order = {
    id: "order-cloud-persistent", organization_id: organizationId, status: "waiting_for_executor", row_version: 1,
    created_by_member_id: "member-owner", input_snapshot: {}, status_history: []
  };
  const packageRecord = {
    id: "package-cloud-persistent", organization_id: organizationId, production_order_id: order.id,
    package_version: 1, manifest_hash: "manifest-cloud-persistent", package_hash: null, status: "ready",
    manifest: { accepted_media_types: ["video/mp4"] }
  };
  const executionRepository = createMemoryManualExecutionRepository();
  let verificationRequest = null;
  const orderPort = {
    async listOrdersForCloudExecutor() { return [structuredClone(order)]; },
    async getOrderForCloudExecutor(input) { return input.orderId === order.id ? structuredClone(order) : null; },
    async transitionOrderForCloudExecutor(input) {
      if (input.orderId !== order.id || input.expectedRevision !== order.row_version || !input.fromStatuses.includes(order.status)) return null;
      order.status = input.toStatus;
      order.row_version += 1;
      return structuredClone(order);
    }
  };
  const packagePort = {
    async listPackagesForCloudExecutor() { return [structuredClone(packageRecord)]; },
    async getPackageForCloudExecutor(input) { return input.packageId === packageRecord.id ? structuredClone(packageRecord) : null; }
  };
  const verificationPort = {
    async requestVerification(input) {
      verificationRequest = input;
      return { job: { id: "verification-cloud-persistent" }, replayed: false };
    },
    async wake() {}
  };
  const config = {
    enabled: true, configured: true, mode: "fake", organizationId, executorCloudId, workspace,
    storage: { root: workspace.root, minFreeBytes: 0, statfsImpl: async () => ({ availableBytes: 1024 * 1024 * 1024 }) },
    worker: { pollIntervalMs: 1, leaseMs: 30_000, heartbeatIntervalMs: 5_000 }
  };
  const executor = { async run() { return { body: Buffer.from("persistent-video"), mediaType: "video/mp4", originalFilename: "persistent.mp4" }; } };

  try {
    const first = createCloudExecutorRuntime({ config, repository: executionRepository, orderPort, packagePort, verificationPort, executor });
    const firstResult = await first.runOnce();
    assert.equal(firstResult.status, "succeeded");
    assert.equal(verificationRequest.productionOrderId, order.id);
    const candidate = (await executionRepository.listCandidates(organizationId, firstResult.attempt.id))[0];
    assert.ok(candidate);
    assert.equal((await first.candidateStore.get(candidate.object_key)).toString(), "persistent-video");

    await writeFile(path.join(workspace.assetsDir, "product.png"), "persistent-product");
    await writeFile(path.join(workspace.assetsDir, "avatar.png"), "persistent-avatar");
    await writeFile(path.join(workspace.evidenceDir, "attempt.json"), JSON.stringify({ attempt_id: firstResult.attempt.id }));
    await first.close();

    const second = createCloudExecutorRuntime({
      config,
      repository: executionRepository,
      orderPort,
      packagePort,
      verificationPort,
      executor: { async run() { throw new Error("restart proof must not execute another attempt"); } }
    });
    assert.notEqual(second.service, first.service);
    assert.notEqual(second.candidateStore, first.candidateStore);
    assert.equal((await second.candidateStore.get(candidate.object_key)).toString(), "persistent-video");
    assert.equal((await readFile(path.join(workspace.assetsDir, "product.png"))).toString(), "persistent-product");
    assert.equal((await readFile(path.join(workspace.assetsDir, "avatar.png"))).toString(), "persistent-avatar");
    assert.equal(JSON.parse(await readFile(path.join(workspace.evidenceDir, "attempt.json"))).attempt_id, firstResult.attempt.id);

    const assetRepository = createMemoryAssetRepository();
    const assetService = createAssetService({ repository: assetRepository, objectStore: second.candidateStore });
    const verifiedOutputAssetPort = createVerifiedOutputAssetPort({ repository: assetRepository });
    const registered = await verifiedOutputAssetPort.registerVerifiedOutput({
      organizationId, actorMemberId: "member-owner", candidate, now: "2026-08-12T00:00:00.000Z"
    });
    const work = {
      id: "work-cloud-persistent", organization_id: organizationId, production_order_id: order.id, status: "available",
      primary_asset_version_id: registered.asset_version.id, primary_output_media_type: candidate.media_type,
      primary_output_size: candidate.size
    };
    const deliveryService = createWorkDeliveryService({
      repository: createMemoryWorkDeliveryRepository(),
      workPort: {
        async listWorks() { return [structuredClone(work)]; },
        async getWork(_organizationId, workId) { return workId === work.id ? structuredClone(work) : null; }
      },
      assetPort: assetService
    });
    const { app } = await identityApp(t, { workDelivery: { enabled: true, service: deliveryService } });
    const auth = await activateAdmin(app);
    const readHeaders = identityHeaders({ cookies: auth.cookies });
    const mutationHeaders = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
    const authorization = await app.inject({ method: "POST", url: `/api/works/${work.id}/download-authorizations`, headers: mutationHeaders, payload: {} });
    assert.equal(authorization.statusCode, 201);
    const downloadPath = authorization.json().download.url;
    const downloaded = await app.inject({ method: "GET", url: downloadPath, headers: readHeaders });
    assert.equal(downloaded.statusCode, 200);
    assert.equal(downloaded.headers["content-type"].startsWith("video/mp4"), true);
    assert.equal(downloaded.body, "persistent-video");

    const publicResult = JSON.stringify(firstResult);
    assert.equal(publicResult.includes(root), false);
    assert.equal(publicResult.includes(candidate.object_key), false);
    await second.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the Web app downloads a Cloud Executor output through the authenticated Work seam", async (t) => {
  const cloudRoot = await mkdtemp(path.join(os.tmpdir(), "cloud-executor-web-output-"));
  const appRoot = await mkdtemp(path.join(os.tmpdir(), "cloud-executor-web-primary-"));
  const organizationId = "org_test";
  const candidate = {
    id: "candidate-cloud-web",
    object_key: "cloud-executor/org_test/attempt-cloud-web/candidate-cloud-web.mp4",
    media_type: "video/mp4",
    size: Buffer.byteLength("cloud-web-video"),
    checksum: createHash("sha256").update("cloud-web-video").digest("hex"),
    original_filename: "cloud-web.mp4"
  };
  const cloudStore = createLocalObjectStore({ root: cloudRoot });
  await cloudStore.initialize();
  await cloudStore.put({
    key: candidate.object_key,
    body: Buffer.from("cloud-web-video"),
    contentType: candidate.media_type,
    metadata: { organizationId, candidateOutputId: candidate.id }
  });
  const assetRepository = createMemoryAssetRepository();
  const registered = await createVerifiedOutputAssetPort({ repository: assetRepository }).registerVerifiedOutput({
    organizationId,
    actorMemberId: "member-owner",
    candidate,
    now: "2026-08-13T00:00:00.000Z"
  });
  const work = {
    id: "work-cloud-web",
    organization_id: organizationId,
    status: "available",
    primary_asset_version_id: registered.asset_version.id,
    primary_output_media_type: candidate.media_type,
    primary_output_size: candidate.size
  };

  try {
    const { app } = await identityApp(t, {
      assets: {
        enabled: true,
        adapter: "local",
        localRoot: appRoot,
        readOnlyFallbackRoot: cloudRoot,
        repository: assetRepository,
        worker: { autoStart: false }
      },
      workDelivery: {
        enabled: true,
        repository: createMemoryWorkDeliveryRepository(),
        workPort: {
          async listWorks() { return [structuredClone(work)]; },
          async getWork(_organizationId, workId) { return workId === work.id ? structuredClone(work) : null; }
        }
      }
    });
    const auth = await activateAdmin(app);
    const readHeaders = identityHeaders({ cookies: auth.cookies });
    const mutationHeaders = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
    const authorization = await app.inject({ method: "POST", url: `/api/works/${work.id}/download-authorizations`, headers: mutationHeaders, payload: {} });
    assert.equal(authorization.statusCode, 201);
    const downloaded = await app.inject({ method: "GET", url: authorization.json().download.url, headers: readHeaders });
    assert.equal(downloaded.statusCode, 200);
    assert.equal(downloaded.headers["content-type"].startsWith("video/mp4"), true);
    assert.equal(downloaded.body, "cloud-web-video");
  } finally {
    await rm(cloudRoot, { recursive: true, force: true });
    await rm(appRoot, { recursive: true, force: true });
  }
});
