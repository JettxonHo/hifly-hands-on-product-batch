import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createAssetService } from "../src/assets/asset-service.js";
import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createAvatarSelectionService } from "../src/avatar-selection/avatar-selection-service.js";
import { createMemoryAvatarSelectionRepository } from "../src/avatar-selection/memory-avatar-selection-repository.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const CHECKSUM = createHash("sha256").update(PNG).digest("hex");

async function createMaterial(assetService, { organizationId = "org-a", kind = "avatar_image", complete = true, key = `material-${Math.random()}` } = {}) {
  const created = await assetService.createUploadAuthorization({
    organizationId, actorMemberId: `${organizationId}-member`, idempotencyKey: key,
    filename: `${kind}.png`, contentType: "image/png", size: PNG.length, checksumSha256: CHECKSUM, assetKind: kind
  });
  await assetService.uploadObject({ organizationId, uploadToken: created.upload.token, body: PNG, contentType: "image/png" });
  if (complete) {
    await assetService.completeUpload({ organizationId, uploadSessionId: created.upload_session_id, idempotencyKey: `${key}-complete` });
    await assetService.runNextVerificationJob();
  }
  return created;
}

function world() {
  const assetRepository = createMemoryAssetRepository();
  const objectStore = createMemoryObjectStore();
  const assetService = createAssetService({ repository: assetRepository, objectStore, now: () => Date.parse("2026-08-12T00:00:00.000Z") });
  const repository = createMemoryAvatarSelectionRepository();
  const copyApprovalPort = {
    async getCurrentApprovedCopy() { return { copy_version_id: "copy-a", product_revision_id: "revision-a", current_valid: true }; },
    async resolveCurrentApprovedCopy() { return { copy_version_id: "copy-a", product_revision_id: "revision-a", current_valid: true }; }
  };
  const service = createAvatarSelectionService({ repository, copyApprovalPort, materialAssetPort: assetService,
    now: () => Date.parse("2026-08-12T00:00:00.000Z") });
  return { assetService, repository, service };
}

const admin = { organizationId: "org-a", actorMemberId: "admin-a", actorRole: "admin" };
const member = { organizationId: "org-a", actorMemberId: "member-a", actorRole: "member" };

test("admin registers a verified avatar material with normalized tags and explicit capability Evidence", async () => {
  const state = world();
  const material = await createMaterial(state.assetService);
  const result = await state.service.registerEnterpriseAvatar({ ...admin, materialAssetVersionId: material.asset_version.id,
    displayName: "青禾主播", description: "企业品牌人物", authorizationStatus: "valid",
    authorizationExpiresAt: "2027-12-31T23:59:59.000Z", categoryTags: [" 美妆 ", "护肤", "美妆"],
    capabilities: [{ code: "hands_on_product", label: "手持商品图", evidenceReference: "evidence:avatar-hands:v1" }] });

  assert.equal(result.asset.source_type, "enterprise");
  assert.equal(result.asset.controlled_seed, false);
  assert.deepEqual(result.asset.category_tags, ["美妆", "护肤"]);
  assert.equal(result.asset_version.material_asset_version_id, material.asset_version.id);
  assert.equal(result.asset_version.materials_accessible, true);
  assert.equal(result.asset_version.capability_status, "verified");
  assert.deepEqual(result.capabilities, [{ code: "hands_on_product", label: "手持商品图", evidence_reference: "evidence:avatar-hands:v1", verification_status: "verified" }]);
});

test("bare avatar material registration does not claim production capability and duplicate material registration is idempotent", async () => {
  const state = world();
  const material = await createMaterial(state.assetService, { key: "bare-material" });
  const input = { ...admin, materialAssetVersionId: material.asset_version.id, displayName: "无证据人物", description: "待核验",
    authorizationStatus: "valid", categoryTags: [] };
  const first = await state.service.registerEnterpriseAvatar(input);
  const duplicate = await state.service.registerEnterpriseAvatar({ ...input, displayName: "不应覆盖" });
  assert.equal(duplicate.asset.id, first.asset.id);
  assert.equal((await state.repository.listCatalog("org-a")).filter((entry) => entry.asset_version.material_asset_version_id === material.asset_version.id).length, 1);
  assert.equal(first.asset_version.capability_status, "unverified");
  assert.deepEqual(first.capabilities, []);
  const workspace = await state.service.getWorkspace({ ...member, productId: "product-a", copyVersionId: "copy-a" });
  const entry = workspace.catalog.find((item) => item.asset_version.id === first.asset_version.id);
  assert.equal(entry.gate.can_confirm, false);
  assert.ok(entry.gate.reasons.includes("capability_evidence_missing"));
});

test("materials_accessible is re-derived from the linked asset version after the source asset changes", async () => {
  const state = world();
  const material = await createMaterial(state.assetService, { key: "derived-material" });
  const avatar = await state.service.registerEnterpriseAvatar({ ...admin, materialAssetVersionId: material.asset_version.id,
    displayName: "动态素材人物", description: "x", authorizationStatus: "valid",
    capabilities: [{ code: "hands_on_product", label: "手持商品图", evidenceReference: "evidence:derived" }] });
  const available = (await state.service.getWorkspace({ ...member, productId: "product-derived", copyVersionId: "copy-a" })).catalog
    .find((item) => item.asset_version.id === avatar.asset_version.id);
  assert.equal(available.materials_accessible, true);
  await state.assetService.disableAsset({ organizationId: "org-a", assetId: material.asset.id, expectedRevision: 1, actorMemberId: admin.actorMemberId });
  const unavailable = (await state.service.getWorkspace({ ...member, productId: "product-derived", copyVersionId: "copy-a" })).catalog
    .find((item) => item.asset_version.id === avatar.asset_version.id);
  assert.equal(unavailable.materials_accessible, false);
  assert.equal(unavailable.material_status, "unavailable");
  assert.ok(unavailable.gate.reasons.includes("avatar_materials_unavailable"));
});

test("enterprise registration requires an admin and a same-organization available avatar_image version", async () => {
  const state = world();
  const material = await createMaterial(state.assetService, { key: "permission-material" });
  await assert.rejects(state.service.registerEnterpriseAvatar({ ...member, materialAssetVersionId: material.asset_version.id,
    displayName: "成员不能登记", description: "x", authorizationStatus: "valid" }), { code: "AVATAR_REGISTRATION_FORBIDDEN" });

  const product = await createMaterial(state.assetService, { kind: "product_image", key: "product-material" });
  await assert.rejects(state.service.registerEnterpriseAvatar({ ...admin, materialAssetVersionId: product.asset_version.id,
    displayName: "错误类型", description: "x", authorizationStatus: "valid" }), { code: "AVATAR_MATERIAL_KIND_INVALID" });

  const pending = await createMaterial(state.assetService, { complete: false, key: "pending-material" });
  await assert.rejects(state.service.registerEnterpriseAvatar({ ...admin, materialAssetVersionId: pending.asset_version.id,
    displayName: "未核验", description: "x", authorizationStatus: "valid" }), { code: "AVATAR_MATERIAL_NOT_AVAILABLE" });
  await assert.rejects(state.service.registerEnterpriseAvatar({ ...admin, materialAssetVersionId: "missing-version",
    displayName: "不存在", description: "x", authorizationStatus: "valid" }), { code: "AVATAR_MATERIAL_VERSION_NOT_FOUND" });
});

test("authorization, capability, material, and organization gates block confirmation", async () => {
  const state = world();
  const statuses = ["expired", "incomplete"];
  for (const status of statuses) {
    const material = await createMaterial(state.assetService, { key: `status-${status}` });
    const avatar = await state.service.registerEnterpriseAvatar({ ...admin, materialAssetVersionId: material.asset_version.id,
      displayName: `状态 ${status}`, description: "x", authorizationStatus: status,
      capabilities: [{ code: "hands_on_product", label: "手持商品图", evidenceReference: `evidence:${status}` }] });
    const workspace = await state.service.getWorkspace({ ...member, productId: "product-a", copyVersionId: "copy-a" });
    const entry = workspace.catalog.find((item) => item.asset_version.id === avatar.asset_version.id);
    assert.equal(entry.gate.can_confirm, false);
    assert.ok(entry.gate.reasons.some((reason) => reason.startsWith("authorization_")));
  }
});

test("admin can disable only non-controlled enterprise avatars while confirmed history remains", async () => {
  const state = world();
  const material = await createMaterial(state.assetService, { key: "disable-material" });
  const avatar = await state.service.registerEnterpriseAvatar({ ...admin, materialAssetVersionId: material.asset_version.id,
    displayName: "可停用人物", description: "x", authorizationStatus: "valid",
    capabilities: [{ code: "hands_on_product", label: "手持商品图", evidenceReference: "evidence:disable" }] });
  const confirmed = await state.service.confirmSelection({ ...member, productId: "product-a", copyVersionId: "copy-a",
    assetVersionId: avatar.asset_version.id, expectedRevision: 0, idempotencyKey: "disable-history-confirm" });
  const disabled = await state.service.disableEnterpriseAvatar({ ...admin, assetId: avatar.asset.id, expectedRevision: avatar.asset.revision_number });
  assert.equal(disabled.asset.status, "disabled");
  const workspace = await state.service.getWorkspace({ ...member, productId: "product-a", copyVersionId: "copy-a" });
  assert.equal(workspace.selection.current_selection.id, confirmed.current_selection.id);
  assert.equal(workspace.selection.current_valid, false);
  assert.ok(workspace.selection.invalidation_reasons.includes("avatar_asset_unavailable"));
  await assert.rejects(state.service.confirmSelection({ ...member, productId: "product-a", copyVersionId: "copy-a",
    assetVersionId: avatar.asset_version.id, expectedRevision: 1, idempotencyKey: "disabled-confirm" }), { code: "AVATAR_SELECTION_GATE_BLOCKED" });

  const controlled = (await state.service.getWorkspace({ ...member, productId: "product-b", copyVersionId: "copy-a" })).catalog.find((item) => item.controlled_seed);
  await assert.rejects(state.service.disableEnterpriseAvatar({ ...admin, assetId: controlled.id, expectedRevision: controlled.revision_number }), { code: "AVATAR_ASSET_DISABLE_FORBIDDEN" });
});

test("server-private production material snapshot resolves selection to exact verified material metadata", async () => {
  const state = world();
  const material = await createMaterial(state.assetService, { key: "hands-on-material-snapshot" });
  const avatar = await state.service.registerEnterpriseAvatar({ ...admin, materialAssetVersionId: material.asset_version.id,
    displayName: "生产人物", description: "x", authorizationStatus: "valid", capabilities: [{ code: "speech", label: "中文口播", evidenceReference: "evidence:speech" }] });
  const workspace = await state.service.getWorkspace({ ...member, productId: "product-a", copyVersionId: "copy-a" });
  const confirmed = await state.service.confirmSelection({ ...member, productId: "product-a", copyVersionId: "copy-a",
    assetVersionId: avatar.asset_version.id, expectedRevision: workspace.selection.selection_revision, idempotencyKey: "hands-on-material-select" });
  const snapshot = await state.service.getHandsOnProductMaterialSnapshot({ ...member, productId: "product-a", copyVersionId: "copy-a" });
  assert.deepEqual(snapshot, {
    avatar_selection_id: confirmed.current_selection.id,
    copy_version_id: "copy-a",
    avatar_version_id: avatar.asset_version.id,
    material_version_id: material.asset_version.id,
    material_asset_id: material.asset.id,
    media_type: "image/png",
    size: PNG.length,
    checksum_sha256: CHECKSUM
  });
  assert.equal("object_key" in snapshot, false);
  assert.equal("bytes" in snapshot, false);
  await assert.rejects(() => state.service.getHandsOnProductMaterialSnapshot({ ...member, productId: "product-a", copyVersionId: "copy-a", avatarSelectionId: "stale-selection", avatarAssetVersionId: avatar.asset_version.id }), { code: "HIFLY_HANDS_ON_PRODUCT_V1_AVATAR_BINDING_MISMATCH" });
});

test("enterprise avatar category tags reject empty or oversized input without inventing taxonomy", async () => {
  const state = world();
  const material = await createMaterial(state.assetService, { key: "tag-validation" });
  await assert.rejects(state.service.registerEnterpriseAvatar({ ...admin, materialAssetVersionId: material.asset_version.id,
    displayName: "标签人物", description: "x", authorizationStatus: "valid", categoryTags: [" "] }), { code: "INVALID_AVATAR_CATEGORY_TAGS" });
  await assert.rejects(state.service.registerEnterpriseAvatar({ ...admin, materialAssetVersionId: material.asset_version.id,
    displayName: "标签人物", description: "x", authorizationStatus: "valid", categoryTags: Array.from({ length: 13 }, (_, index) => `tag-${index}`) }), { code: "INVALID_AVATAR_CATEGORY_TAGS" });
});
