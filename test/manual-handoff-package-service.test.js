import assert from "node:assert/strict";
import test from "node:test";

import { createManualHandoffPackageService } from "../src/manual-handoff/manual-handoff-package-service.js";
import { createManualHandoffPackageWorker } from "../src/manual-handoff/manual-handoff-package-worker.js";
import { createMemoryManualHandoffRepository } from "../src/manual-handoff/memory-manual-handoff-repository.js";
import { buildManualHandoffZip, createMemoryManualHandoffPackageStore, extractManualHandoffArchive } from "../src/manual-handoff/manual-handoff-package-store.js";
import { canonicalJson, renderManualHandoffReadme, sha256 } from "../src/manual-handoff/manual-handoff-package.js";
import { verifyHandoffPackageIntegrity } from "../src/local-agent/package-compiler.js";

const actor = { organizationId: "org-a", actorMemberId: "member-a", actorRole: "member" };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const ASSET_BYTES = Buffer.from("png");
const ASSET_CHECKSUM = sha256(ASSET_BYTES);
const order = {
  id: "order-a", organization_id: "org-a", project_id: "project-a", product_id: "product-a",
  video_plan_version_id: "plan-a-v2", execution_purpose: "first_production", status: "waiting_for_executor",
  created_by_member_id: "member-a", created_at: "2026-08-08T09:00:00.000Z", updated_at: "2026-08-08T09:00:00.000Z",
  input_snapshot: {
    project_id: "project-a",
    product_revision: { id: "revision-a-v4", version_number: 4, status: "ready", product_name: "云感保湿乳",
      physical_dimensions: { height: 18, width: 12, depth: 4, unit: "cm", capacity: { value: 500, unit: "ml" }, weight: { value: 520, unit: "g" } },
      asset_version_ids: ["asset-version-a"] },
    copy_snapshot: { copy_version_id: "copy-a-v3", version_number: 3, status: "frozen", intent: "product_recommendation", copy_body: "先展示使用场景，再说明保湿体验。", approved_review_id: "review-copy-a", approved_at: "2026-08-08T08:10:00.000Z", review: { id: "review-copy-a", status: "approved", decided_at: "2026-08-08T08:10:00.000Z" } },
    avatar_snapshot: { avatar_selection_id: "selection-a-v2", avatar_asset_id: "avatar-a", avatar_asset_version_id: "avatar-version-a-v2", status: "confirmed", version_number: 2, display_name: "林小满", source_type: "seeded", authorization_status: "valid", capability_status: "verified", authorization_summary: "企业授权有效", capabilities: [{ code: "speech", evidence_reference: "seed:speech" }], verified_capability_snapshot: { speech: "mandarin" } },
    video_plan_version: { id: "plan-a-v2", version_number: 2, status: "frozen", presentation_size_code: "small", output_instructions: "竖版商品种草口播" },
    configuration_snapshot: { snapshot_version: "capability-v2", verified_capabilities: [{ code: "mandarin_speech", evidence_reference: "seed:speech-v2" }], password: "should-not-ship", permanent_url: "https://permanent.example" },
    execution_steps: ["确认人物与商品素材", "按说明完成人工制作"],
    business_constraints: ["不得修改已批准文案"],
    expected_behavior: ["输出一条竖版视频"],
    known_limitations: ["人工执行者需自行确认执行环境"],
    human_confirmation_points: ["开始前核对包版本与完整性摘要"],
    primary_output: { role: "primary_video", accepted_media_types: ["video/mp4"], expected_quantity: 1 },
    supporting_outputs: [],
    file_naming_rule: "product-a-primary.mp4",
    minimum_validation_requirements: ["视频可播放"],
    asset_references: [{ asset_id: "asset-a", asset_version_id: "asset-version-a", role: "product_image", display_name: "商品主图", media_type: "image/png", size: ASSET_BYTES.length, checksum: ASSET_CHECKSUM, retrieval_mode: "embedded", access_scope: "organization", body: ASSET_BYTES }]
  }
};

function world({ now = () => Date.parse("2026-08-08T09:00:00.000Z"), archiveBuilder, grantTtlMs = 300000, sourceOrder = order } = {}) {
  const repository = createMemoryManualHandoffRepository();
  const packageStore = createMemoryManualHandoffPackageStore();
  const executionAttempts = [];
  const service = createManualHandoffPackageService({
    repository, packageStore, now, grantTtlMs,
    orderPort: {
      async getOrder(input) {
        if (input.organizationId !== sourceOrder.organization_id || input.orderId !== sourceOrder.id) return null;
        return structuredClone(sourceOrder);
      }
    },
    executionAttemptPort: { async createAttempt(input) { executionAttempts.push(input); } },
    ...(archiveBuilder ? { archiveBuilder } : {})
  });
  const worker = createManualHandoffPackageWorker({ service, pollIntervalMs: 5 });
  return { repository, packageStore, service, worker, executionAttempts };
}

test("generates an immutable authoritative manifest and derived README without starting execution", async () => {
  const { service, worker, packageStore, executionAttempts } = world();
  const requested = await service.requestGeneration({ ...actor, productionOrderId: order.id, generationRequestId: "generation-a" });
  const replay = await service.requestGeneration({ ...actor, productionOrderId: order.id, generationRequestId: "generation-a" });
  assert.equal(replay.package.id, requested.package.id);
  assert.equal(replay.job.id, requested.job.id);
  assert.equal(replay.replayed, true);

  await worker.runNext();
  const ready = await service.getPackage({ ...actor, packageId: requested.package.id });
  assert.equal(ready.status, "ready");
  assert.equal(ready.package_version, 1);
  assert.equal(ready.contract_type, "manual_handoff");
  assert.equal(ready.contract_version, "1.0");
  assert.equal(ready.manifest.video_plan_snapshot.presentation_size_code, "small");
  assert.deepEqual(ready.manifest.product_revision.physical_dimensions,
    { height: 18, width: 12, depth: 4, unit: "cm", capacity: { value: 500, unit: "ml" }, weight: { value: 520, unit: "g" } });
  assert.match(ready.manifest_hash, /^[a-f0-9]{64}$/);
  assert.match(ready.package_hash, /^[a-f0-9]{64}$/);
  assert.equal(ready.manifest_hash, sha256(canonicalJson({ ...ready.manifest, manifest_hash: null, package_hash: null })));

  const entries = await extractManualHandoffArchive(await packageStore.get(ready.storage_key));
  assert.deepEqual(Object.keys(entries).sort(), ["README.md", "assets/asset-version-a", "manifest.json"]);
  assert.equal(entries["README.md"], ready.readme);
  assert.equal(entries["README.md"], renderManualHandoffReadme(ready.manifest));
  assert.deepEqual(JSON.parse(entries["manifest.json"]), ready.manifest);
  assert.equal(entries["README.md"].includes("manifest.json"), true);
  assert.equal(entries["README.md"].includes("输出一条竖版视频"), true);
  assert.equal(entries["README.md"].includes("人工执行者需自行确认执行环境"), true);
  assert.equal(entries["README.md"].includes("开始前核对包版本与完整性摘要"), true);
  assert.equal(entries["README.md"].includes("商品呈现大小：小（small）"), true);
  assert.equal(entries["README.md"].includes("实物尺寸：18 × 12 × 4 cm"), true);
  assert.equal(entries["README.md"].includes("容量：500 ml"), true);
  assert.equal(entries["README.md"].includes("重量：520 g"), true);
  assert.equal(entries["README.md"].includes("呈现大小不保证瓶盖、包装、标签或商品形态保真"), true);
  const inspected = JSON.stringify(entries);
  assert.equal(/secret|cookie|password|token|permanent\.example/i.test(inspected), false);
  assert.equal(executionAttempts.length, 0);
  assert.equal((await service.getOrder({ ...actor, orderId: order.id })).status, "waiting_for_executor");
});

test("package hash preserves producer asset insertion order for legitimate multi-asset archives", async () => {
  const twoAssetOrder = structuredClone(order);
  const secondBody = Buffer.from("second-image");
  const firstReference = twoAssetOrder.input_snapshot.asset_references[0];
  twoAssetOrder.input_snapshot.product_revision.asset_version_ids = ["asset-version-b", "asset-version-a"];
  twoAssetOrder.input_snapshot.asset_references = [{
    asset_id: "asset-b", asset_version_id: "asset-version-b", role: "product_image", display_name: "商品辅图",
    media_type: "image/png", size: secondBody.length, checksum: sha256(secondBody), retrieval_mode: "embedded", access_scope: "organization", body: secondBody
  }, firstReference];
  const { service, worker, packageStore } = world({ sourceOrder: twoAssetOrder });
  const requested = await service.requestGeneration({ ...actor, productionOrderId: twoAssetOrder.id, generationRequestId: "two-assets" });
  await worker.runNext();
  const ready = await service.getPackage({ ...actor, packageId: requested.package.id });
  const body = await packageStore.get(ready.storage_key);
  const entries = await extractManualHandoffArchive(body);
  const expected = { id: ready.id, production_order_id: ready.production_order_id, package_version: ready.package_version, manifest_hash: ready.manifest_hash, package_hash: ready.package_hash };
  await verifyHandoffPackageIntegrity({ body, manifest: ready.manifest, expectedPackage: expected });

  const assetEntries = Object.entries(entries).filter(([name]) => name.startsWith("assets/") && !name.endsWith("/"));
  const reordered = await buildManualHandoffZip([
    { name: "manifest.json", body: entries["manifest.json"] },
    { name: "README.md", body: entries["README.md"] },
    ...assetEntries.reverse().map(([name, value]) => ({ name, body: value }))
  ]);
  await assert.rejects(() => verifyHandoffPackageIntegrity({ body: reordered, manifest: ready.manifest, expectedPackage: expected }), { code: "MANUAL_HANDOFF_PACKAGE_INTEGRITY_MISMATCH" });

  const tampered = await buildManualHandoffZip([
    { name: "manifest.json", body: entries["manifest.json"] },
    { name: "README.md", body: entries["README.md"] },
    { name: assetEntries[0][0], body: Buffer.from("tampered-image") },
    { name: assetEntries[1][0], body: assetEntries[1][1] }
  ]);
  await assert.rejects(() => verifyHandoffPackageIntegrity({ body: tampered, manifest: ready.manifest, expectedPackage: expected }), { code: "MANUAL_HANDOFF_PACKAGE_INTEGRITY_MISMATCH" });
});

test("package verifier accepts the historical hybrid hash ordering and rejects reordered final digests", async () => {
  const historicalOrder = structuredClone(order);
  const firstReference = historicalOrder.input_snapshot.asset_references[0];
  const secondBody = Buffer.from("historical-second-image");
  historicalOrder.input_snapshot.product_revision.asset_version_ids = ["asset-version-z", "asset-version-a"];
  historicalOrder.input_snapshot.asset_references = [{
    asset_id: "asset-z", asset_version_id: "asset-version-z", role: "product_image", display_name: "商品辅图",
    media_type: "image/png", size: secondBody.length, checksum: sha256(secondBody), retrieval_mode: "embedded", access_scope: "organization", body: secondBody
  }, { ...firstReference, asset_id: "asset-a", asset_version_id: "asset-version-a" }];
  const { service, worker, packageStore } = world({ sourceOrder: historicalOrder });
  const requested = await service.requestGeneration({ ...actor, productionOrderId: historicalOrder.id, generationRequestId: "historical-hybrid" });
  await worker.runNext();
  const ready = await service.getPackage({ ...actor, packageId: requested.package.id });
  const entries = await extractManualHandoffArchive(await packageStore.get(ready.storage_key));
  const assetEntries = Object.entries(entries).filter(([name]) => name.startsWith("assets/") && !name.endsWith("/"));
  const manifestWithPlaceholder = { ...ready.manifest, package_hash: null };
  const oldProvisionalHash = sha256(canonicalJson({ manifest: manifestWithPlaceholder, assets: assetEntries.map(([name]) => name).sort() }));
  const oldProvisionalReadme = renderManualHandoffReadme({ ...manifestWithPlaceholder, package_hash: oldProvisionalHash });
  const oldPackageHash = sha256(canonicalJson({ manifest: manifestWithPlaceholder, readme: oldProvisionalReadme,
    assets: assetEntries.map(([name, body]) => [name, sha256(body)]) }));
  const historicalManifest = { ...ready.manifest, package_hash: oldPackageHash };
  const archiveEntries = [
    { name: "manifest.json", body: JSON.stringify(historicalManifest) },
    { name: "README.md", body: renderManualHandoffReadme(historicalManifest) },
    ...assetEntries.map(([name, body]) => ({ name, body }))
  ];
  const historicalBody = await buildManualHandoffZip(archiveEntries);
  const expected = { id: ready.id, production_order_id: ready.production_order_id, package_version: ready.package_version,
    manifest_hash: ready.manifest_hash, package_hash: oldPackageHash };
  await verifyHandoffPackageIntegrity({ body: historicalBody, manifest: historicalManifest, expectedPackage: expected });
  const reorderedBody = await buildManualHandoffZip([archiveEntries[0], archiveEntries[1], ...assetEntries.slice().reverse().map(([name, body]) => ({ name, body }))]);
  await assert.rejects(() => verifyHandoffPackageIntegrity({ body: reorderedBody, manifest: historicalManifest, expectedPackage: expected }), { code: "MANUAL_HANDOFF_PACKAGE_INTEGRITY_MISMATCH" });
});

test("same generation request conflicts on payload and a new package version retains superseded history", async () => {
  const { service, worker, repository } = world();
  const first = await service.requestGeneration({ ...actor, productionOrderId: order.id, generationRequestId: "same" });
  await assert.rejects(service.requestGeneration({ ...actor, productionOrderId: order.id, generationRequestId: "same", packageVersion: 2 }), { code: "IDEMPOTENCY_CONFLICT" });
  await worker.runNext();
  const second = await service.requestGeneration({ ...actor, productionOrderId: order.id, generationRequestId: "new-intent" });
  assert.equal(second.package.package_version, 2);
  const old = await service.getPackage({ ...actor, packageId: first.package.id });
  assert.equal(old.status, "superseded");
  assert.equal((await service.listPackages({ ...actor, productionOrderId: order.id })).length, 2);
  await worker.runNext();
  assert.equal((await repository.listStatusTransitions()).filter((event) => event.to_status === "superseded").length, 1);
  const secondReady = await service.getPackage({ ...actor, packageId: second.package.id });
  assert.equal(secondReady.manifest.supersedes_package_id, first.package.id);
});

test("generation failure is business-safe and retry recovers the same package", async () => {
  let fail = true;
  const { service, worker } = world({ archiveBuilder: async ({ finalManifest, readme }) => {
    if (fail) throw new Error("provider secret=do-not-leak https://permanent.example");
    return buildManualHandoffZip([{ name: "manifest.json", body: JSON.stringify(finalManifest) }, { name: "README.md", body: readme }]);
  } });
  const requested = await service.requestGeneration({ ...actor, productionOrderId: order.id, generationRequestId: "retryable" });
  await worker.runNext();
  const failed = await service.getPackage({ ...actor, packageId: requested.package.id });
  assert.equal(failed.status, "generation_failed");
  assert.match(failed.failure_reason, /生成|输入|重试/);
  assert.equal(failed.failure_reason.includes("secret"), false);
  assert.equal(failed.failure_reason.includes("permanent.example"), false);
  fail = false;
  const retry = await service.retryGeneration({ ...actor, packageId: requested.package.id, generationRequestId: "retry-command" });
  assert.equal(retry.package.id, requested.package.id);
  await worker.runNext();
  assert.equal((await service.getPackage({ ...actor, packageId: requested.package.id })).status, "ready");
});

test("repeated download and expired authorization keep the same package version and audit each download", async () => {
  let clock = Date.parse("2026-08-08T09:00:00.000Z");
  const { service, worker, repository } = world({ now: () => clock, grantTtlMs: 1000 });
  const requested = await service.requestGeneration({ ...actor, productionOrderId: order.id, generationRequestId: "download" });
  await worker.runNext();
  const one = await service.authorizeDownload({ ...actor, packageId: requested.package.id });
  const first = await service.downloadPackage({ ...actor, packageId: requested.package.id, authorizationToken: one.token });
  const two = await service.authorizeDownload({ ...actor, packageId: requested.package.id });
  const second = await service.downloadPackage({ ...actor, packageId: requested.package.id, authorizationToken: two.token });
  assert.deepEqual(second.body, first.body);
  clock += 1001;
  assert.equal((await service.getPackage({ ...actor, packageId: requested.package.id })).status, "expired");
  assert.equal((await service.getPackage({ ...actor, packageId: requested.package.id })).status_history.some((item) => item.to_status === "expired"), true);
  const renewed = await service.authorizeDownload({ ...actor, packageId: requested.package.id });
  assert.equal(renewed.package.id, requested.package.id);
  assert.equal(renewed.package.package_version, 1);
  assert.equal(renewed.package.status, "ready");
  assert.equal((await service.downloadPackage({ ...actor, packageId: requested.package.id, authorizationToken: renewed.token })).body.length > 0, true);
  assert.equal((await repository.listAuditEvents()).filter((event) => event.event_type === "manual_handoff.downloaded").length, 3);
  await assert.rejects(service.transitionPackage({ ...actor, packageId: requested.package.id, status: "revoked", reason: "安全处置" }), { code: "MANUAL_HANDOFF_FORBIDDEN" });
  const revoked = await service.transitionPackage({ ...actor, actorRole: "admin", packageId: requested.package.id, status: "revoked", reason: "安全处置" });
  assert.equal(revoked.status, "revoked");
  assert.equal((await service.listPackages({ ...actor, productionOrderId: order.id })).some((item) => item.status === "revoked"), true);
});

test("package inspection rejects cross-organization references and omits forbidden material", async () => {
  const unsafeOrder = structuredClone(order);
  unsafeOrder.input_snapshot.asset_references.push({ asset_id: "foreign", asset_version_id: "foreign-v", organization_id: "org-other", retrieval_mode: "provider_existing" });
  const { service } = world();
  await assert.rejects(service.buildManifest({ ...actor, order: unsafeOrder }), { code: "MANUAL_HANDOFF_CROSS_ORGANIZATION_DATA" });
});

test("manual handoff rejects a plan without a canonical presentation size", async () => {
  const legacyOrder = structuredClone(order);
  delete legacyOrder.input_snapshot.video_plan_version.presentation_size_code;
  const { service } = world({ sourceOrder: legacyOrder });
  await assert.rejects(service.buildManifest({ ...actor, order: legacyOrder }), { code: "VIDEO_PLAN_PRESENTATION_SIZE_REQUIRED" });
});

test("legacy orders without frozen business facts fail safely and never become ready", async () => {
  const legacyOrder = structuredClone(order);
  delete legacyOrder.input_snapshot.copy_snapshot;
  delete legacyOrder.input_snapshot.approved_copy_snapshot;
  delete legacyOrder.input_snapshot.product_revision;
  delete legacyOrder.input_snapshot.product_revision_snapshot;
  delete legacyOrder.input_snapshot.avatar_snapshot;
  delete legacyOrder.input_snapshot.avatar_selection_snapshot;
  delete legacyOrder.input_snapshot.asset_references;
  const { service, worker } = world({ sourceOrder: legacyOrder });
  const requested = await service.requestGeneration({ ...actor, productionOrderId: legacyOrder.id, generationRequestId: "legacy-order" });
  await worker.runNext();
  const failed = await service.getPackage({ ...actor, packageId: requested.package.id });
  assert.equal(failed.status, "generation_failed");
  assert.equal(failed.failure_reason, "交接包输入快照不完整，请返回视频方案补齐固定输入。");
  assert.equal(failed.manifest, null);
});

test("a legal image with URL metadata is embedded without binary URL scanning", async () => {
  const imageOrder = structuredClone(order);
  const metadata = Buffer.from("\nXMP=https://vendor.example/license\n", "utf8");
  imageOrder.input_snapshot.asset_references[0].body = Buffer.concat([PNG, metadata]);
  imageOrder.input_snapshot.asset_references[0].size = imageOrder.input_snapshot.asset_references[0].body.length;
  imageOrder.input_snapshot.asset_references[0].checksum = sha256(imageOrder.input_snapshot.asset_references[0].body);
  const { service, worker, packageStore } = world({ sourceOrder: imageOrder });
  const requested = await service.requestGeneration({ ...actor, productionOrderId: imageOrder.id, generationRequestId: "image-metadata" });
  await worker.runNext();
  const ready = await service.getPackage({ ...actor, packageId: requested.package.id });
  const entries = await extractManualHandoffArchive(await packageStore.get(ready.storage_key));
  assert.equal(entries["assets/asset-version-a"].includes("vendor.example"), true);
  assert.equal(entries["manifest.json"].includes("vendor.example"), false);
  assert.equal(entries["README.md"].includes("vendor.example"), false);
  assert.equal(/secret|cookie|profile|permanent[_ -]?url/i.test(`${entries["manifest.json"]}\n${entries["README.md"]}`), false);
});

test("wrong embedded bytes fail generation and never create a ready package", async () => {
  const corruptedOrder = structuredClone(order);
  corruptedOrder.input_snapshot.asset_references[0].body = Buffer.from("bad");
  const { service, worker, packageStore } = world({ sourceOrder: corruptedOrder });
  const requested = await service.requestGeneration({ ...actor, productionOrderId: corruptedOrder.id, generationRequestId: "asset-integrity-bytes" });
  await worker.runNext();
  const failed = await service.getPackage({ ...actor, packageId: requested.package.id });
  assert.equal(failed.status, "generation_failed");
  assert.equal(failed.failure_reason, "交接包所需素材完整性校验失败，请检查素材状态后重试。");
  assert.equal(failed.manifest, null);
  assert.equal(await packageStore.get(failed.storage_key), null);
});

test("wrong frozen asset size fails generation and never creates a ready package", async () => {
  const mismatchedOrder = structuredClone(order);
  mismatchedOrder.input_snapshot.asset_references[0].size += 1;
  const { service, worker, packageStore } = world({ sourceOrder: mismatchedOrder });
  const requested = await service.requestGeneration({ ...actor, productionOrderId: mismatchedOrder.id, generationRequestId: "asset-integrity-size" });
  await worker.runNext();
  const failed = await service.getPackage({ ...actor, packageId: requested.package.id });
  assert.equal(failed.status, "generation_failed");
  assert.equal(failed.failure_reason, "交接包所需素材完整性校验失败，请检查素材状态后重试。");
  assert.equal(failed.manifest, null);
  assert.equal(await packageStore.get(failed.storage_key), null);
});

test("wrong frozen asset checksum fails generation and never creates a ready package", async () => {
  const mismatchedOrder = structuredClone(order);
  mismatchedOrder.input_snapshot.asset_references[0].checksum = "0".repeat(64);
  const { service, worker, packageStore } = world({ sourceOrder: mismatchedOrder });
  const requested = await service.requestGeneration({ ...actor, productionOrderId: mismatchedOrder.id, generationRequestId: "asset-integrity-checksum" });
  await worker.runNext();
  const failed = await service.getPackage({ ...actor, packageId: requested.package.id });
  assert.equal(failed.status, "generation_failed");
  assert.equal(failed.failure_reason, "交接包所需素材完整性校验失败，请检查素材状态后重试。");
  assert.equal(failed.manifest, null);
  assert.equal(await packageStore.get(failed.storage_key), null);
});
