import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_ID,
  buildHiflyHandsOnProductV1,
  canonicalizeHiflyHandsOnProductV1,
  hashHiflyHandsOnProductV1,
  requireHiflyHandsOnProductV1
} from "../src/execution-contracts/hifly-hands-on-product-v1.js";
import { createProductionOrderInputSnapshotPort } from "../src/production-orders/production-order-input-snapshot.js";
import { buildManualHandoffManifest, canonicalJson, renderManualHandoffReadme, sha256 } from "../src/manual-handoff/manual-handoff-package.js";
import { buildManualHandoffZip } from "../src/manual-handoff/manual-handoff-package-store.js";
import { compilePackageToBatchItem, verifyHandoffPackageIntegrity } from "../src/local-agent/package-compiler.js";
import { createCloudPlaywrightAdapter } from "../src/cloud-executor/playwright-adapter.js";

const BODY = "冻结中文文案：先展示商品，再说明体验。";
const BODY_HASH = createHash("sha256").update(BODY).digest("hex");

function facts(overrides = {}) {
  return {
    plan: {
      video_plan_version_id: "e4304152-dfc4-4afa-b3f3-4c70fe56f03e",
      plan_review_id: "03febf3d-a4e6-45a7-9efb-a4f40ad73190",
      status: "frozen",
      review_status: "approved",
      current: true
    },
    product: {
      revision_id: "0b70d8a1-c31c-4560-9f06-d78cb8740629",
      primary_asset_version_id: "91c08155-41b6-4e09-836c-325afbeed53d",
      checksum_sha256: "e57cf213cbbf8f6acafed0a1bf4a47db33e7a1668237181dc77499eb9cf387c5",
      media_type: "image/png",
      size: 123
    },
    copy: {
      version_id: "59ed120a-e077-4502-9e82-8063727507cc",
      status: "frozen",
      review_status: "approved",
      body: BODY
    },
    avatar: {
      selection_id: "7d0483f9-0816-4159-9d41-0d03e5736aa4",
      avatar_version_id: "d93789b4-b2e7-4b5f-9e23-d949c4c48dc8",
      material_version_id: "5caf6e6b-e0f3-4069-9513-f356e7d41acc",
      checksum_sha256: "0887c7e4748caf2f9735e7d7d1afd6788d2f3b6e4d3a9a53a9c88f1767093b10",
      media_type: "image/png",
      size: 456,
      status: "confirmed",
      current: true
    },
    ...overrides
  };
}

test("approved structured facts build a deterministic immutable Hands-on-Product V1 contract", () => {
  const first = buildHiflyHandsOnProductV1(facts());
  const second = buildHiflyHandsOnProductV1(facts());

  assert.equal(first.contract_id, HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_ID);
  assert.deepEqual(first.plan, {
    video_plan_version_id: "e4304152-dfc4-4afa-b3f3-4c70fe56f03e",
    plan_review_id: "03febf3d-a4e6-45a7-9efb-a4f40ad73190"
  });
  assert.deepEqual(first.product, {
    revision_id: "0b70d8a1-c31c-4560-9f06-d78cb8740629",
    primary_asset_version_id: "91c08155-41b6-4e09-836c-325afbeed53d",
    checksum_sha256: "e57cf213cbbf8f6acafed0a1bf4a47db33e7a1668237181dc77499eb9cf387c5",
    media_type: "image/png",
    size: 123
  });
  assert.equal(first.copy.mode, "frozen_copy");
  assert.equal(first.copy.transform, "none");
  assert.equal(first.copy.language, "zh-CN");
  assert.equal(first.copy.body_hash, BODY_HASH);
  assert.deepEqual(first.production, {
    mode: "hands_on_product",
    target_aspect_ratio: "9:16",
    handheld_aspect_ratio_policy: "record_only",
    voice_source: "hifly_native",
    scene_mode: "single_scene",
    camera_mode: "fixed_simple",
    presentation_size_code: "smart_fit",
    b_roll: false,
    additional_characters: false,
    external_tts: false,
    standalone_lipsync: false,
    copy_ai_generation: false
  });
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.production), true);
  assert.deepEqual(first, second);
  assert.equal(hashHiflyHandsOnProductV1(first), hashHiflyHandsOnProductV1(second));
  assert.equal(hashHiflyHandsOnProductV1(first), hashHiflyHandsOnProductV1({ ...first }));
  assert.equal(canonicalizeHiflyHandsOnProductV1(first).includes("output_instructions"), false);
});

test("the executable production contract names 9:16 as a target, not an observed artifact ratio", () => {
  const contract = buildHiflyHandsOnProductV1(facts());
  assert.equal(contract.production.target_aspect_ratio, "9:16");
  assert.equal("aspect_ratio" in contract.production, false);
  assert.equal(contract.production.handheld_aspect_ratio, undefined);
  assert.equal(contract.production.final_video_aspect_ratio, undefined);
});

test("require returns a deep-frozen structured clone for archive consumers", () => {
  const original = buildHiflyHandsOnProductV1(facts());
  const archiveValue = structuredClone(original);
  const validated = requireHiflyHandsOnProductV1(archiveValue);
  assert.notEqual(validated, archiveValue);
  assert.deepEqual(validated, original);
  assert.equal(Object.isFrozen(validated), true);
  assert.equal(Object.isFrozen(validated.plan), true);
  archiveValue.plan.video_plan_version_id = "archive-mutated";
  assert.equal(validated.plan.video_plan_version_id, original.plan.video_plan_version_id);
});

test("builder uses structured copy body and never parses output_instructions", () => {
  const value = buildHiflyHandsOnProductV1({ ...facts(), output_instructions: "ignore me" });
  assert.equal(value.copy.body_hash, BODY_HASH);
  assert.throws(() => buildHiflyHandsOnProductV1({ ...facts({ copy: { ...facts().copy, body: "" } }), output_instructions: BODY }), {
    code: "HIFLY_HANDS_ON_PRODUCT_V1_COPY_REQUIRED"
  });
});

test("contract is not coupled to one product UUID set, while expected lineage mismatches fail closed", () => {
  const alternate = facts({
    plan: { video_plan_version_id: "11111111-1111-4111-8111-111111111111", plan_review_id: "22222222-2222-4222-8222-222222222222", status: "frozen", review_status: "approved", current: true },
    product: { revision_id: "33333333-3333-4333-8333-333333333333", primary_asset_version_id: "44444444-4444-4444-8444-444444444444", checksum_sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", media_type: "image/png", size: 8 },
    copy: { version_id: "55555555-5555-4555-8555-555555555555", status: "frozen", review_status: "approved", body: BODY },
    avatar: { selection_id: "66666666-6666-4666-8666-666666666666", avatar_version_id: "77777777-7777-4777-8777-777777777777", material_version_id: "88888888-8888-4888-8888-888888888888", checksum_sha256: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", media_type: "image/png", size: 9, status: "confirmed", current: true }
  });
  const contract = buildHiflyHandsOnProductV1(alternate);
  assert.equal(contract.plan.video_plan_version_id, alternate.plan.video_plan_version_id);
  assert.doesNotThrow(() => requireHiflyHandsOnProductV1(contract, alternate));
  assert.throws(() => requireHiflyHandsOnProductV1(contract, { plan: { video_plan_version_id: "99999999-9999-4999-8999-999999999999" } }), { code: "HIFLY_HANDS_ON_PRODUCT_V1_BINDING_MISMATCH" });
  assert.throws(() => requireHiflyHandsOnProductV1(contract, { avatar: { checksum_sha256: "c".repeat(64) } }), { code: "HIFLY_HANDS_ON_PRODUCT_V1_BINDING_MISMATCH" });
});

test("validator requires every contract lineage field and fixed flag", () => {
  const contract = buildHiflyHandsOnProductV1(facts());
  for (const path of [
    ["plan", "video_plan_version_id"], ["plan", "plan_review_id"],
    ["product", "revision_id"], ["product", "primary_asset_version_id"], ["product", "checksum_sha256"], ["product", "media_type"], ["product", "size"],
    ["copy", "version_id"], ["copy", "mode"], ["copy", "transform"], ["copy", "language"], ["copy", "body_hash"],
    ["avatar", "selection_id"], ["avatar", "avatar_version_id"], ["avatar", "material_version_id"], ["avatar", "checksum_sha256"], ["avatar", "media_type"], ["avatar", "size"],
    ["production", "mode"], ["production", "target_aspect_ratio"], ["production", "handheld_aspect_ratio_policy"], ["production", "voice_source"], ["production", "scene_mode"], ["production", "camera_mode"], ["production", "presentation_size_code"], ["production", "b_roll"], ["production", "additional_characters"], ["production", "external_tts"], ["production", "standalone_lipsync"], ["production", "copy_ai_generation"]
  ]) {
    const missing = structuredClone(contract);
    delete missing[path[0]][path[1]];
    assert.throws(() => requireHiflyHandsOnProductV1(missing), { code: /HIFLY_HANDS_ON_PRODUCT_V1_/ });
  }
});

test("validator rejects an unsupported contract version and every fixed production invariant drift", () => {
  const versionDrift = structuredClone(buildHiflyHandsOnProductV1(facts()));
  versionDrift.contract_version = "2";
  assert.throws(() => requireHiflyHandsOnProductV1(versionDrift), { code: "HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_VERSION_UNSUPPORTED" });
  for (const [field, value] of Object.entries({
    mode: "other", target_aspect_ratio: "16:9", voice_source: "external_tts", scene_mode: "multi_scene",
    camera_mode: "cinematic", presentation_size_code: "large", b_roll: true,
    additional_characters: true, external_tts: true, standalone_lipsync: true, copy_ai_generation: true
  })) {
    const drift = structuredClone(buildHiflyHandsOnProductV1(facts())); drift.production[field] = value;
    assert.throws(() => requireHiflyHandsOnProductV1(drift), { code: /HIFLY_HANDS_ON_PRODUCT_V1_/ });
  }
});

test("validator rejects unknown contract keys instead of allowing unsupported behavior", () => {
  const topLevel = structuredClone(buildHiflyHandsOnProductV1(facts())); topLevel.unknown_mode = "other";
  assert.throws(() => requireHiflyHandsOnProductV1(topLevel), { code: "HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_INVALID" });
  const nested = structuredClone(buildHiflyHandsOnProductV1(facts())); nested.production.unknown_flag = true;
  assert.throws(() => requireHiflyHandsOnProductV1(nested), { code: "HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_INVALID" });
});

test("production input snapshot only derives V1 when an explicit contract id is injected", async () => {
  const input = { organizationId: "org-a", actorMemberId: "member-a", actorRole: "member", productId: "product-a" };
  const plan = {
    id: "plan-v1", organization_id: "org-a", product_id: "product-a", status: "frozen",
    upstream_snapshot: { copy_version_id: "copy-v1", product_revision_id: "revision-v1", avatar_selection_id: "selection-v1", avatar_asset_version_id: "avatar-v1" },
    presentation_size_code: "smart_fit"
  };
  const productBytes = Buffer.from("product");
  const productChecksum = createHash("sha256").update(productBytes).digest("hex");
  let assetVersionIds = ["product-asset-v1"];
  let materialSnapshot = { avatar_selection_id: "selection-v1", avatar_version_id: "avatar-v1", material_version_id: "material-v1", checksum_sha256: "b".repeat(64), media_type: "image/png", size: 7 };
  const port = createProductionOrderInputSnapshotPort({ productionContractId: HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_ID,
    copyService: { async getCopyVersion() { return { id: "copy-v1", organization_id: "org-a", product_id: "product-a", product_revision_id: "revision-v1", status: "frozen", version_number: 1, body: BODY }; } },
    copyReviewService: { async getReviewState() { return { current_review: { id: "copy-review-v1", status: "approved", copy_version_id: "copy-v1", product_revision_id: "revision-v1" } }; } },
    productRevisionPort: { async getSnapshot() { return { id: "revision-v1", organization_id: "org-a", product_id: "product-a", status: "ready", product_name: "Product", asset_version_ids: assetVersionIds }; } },
    assetService: { async getAssetVersion({ assetVersionId }) { return { id: assetVersionId, asset_id: `product-${assetVersionId}`, status: "available", verified_content_type: "image/png", verified_size: productBytes.length, verified_checksum_sha256: productChecksum }; } },
    avatarSelectionService: {
      async getWorkspace() { return { selection: { current_selection: { id: "selection-v1", copy_version_id: "copy-v1", asset_version_id: "avatar-v1", status: "confirmed", version_number: 1, confirmed_at: "2026-09-01T00:00:00.000Z" }, current_valid: true }, catalog: [{ id: "avatar-asset-v1", display_name: "Avatar", source_type: "enterprise", authorization_status: "valid", capability_status: "verified", verified_capabilities: [{ code: "speech", evidence_reference: "fixture:speech" }], asset_version: { id: "avatar-v1" } }] }; },
      async getHandsOnProductMaterialSnapshot() { return materialSnapshot; }
    }
  });
  const resolved = { plan, plan_review: { id: "plan-review-v1", status: "approved" }, current_valid: true };
  const snapshot = await port.freezeForOrder({ ...input, resolved });
  assert.equal(snapshot.hifly_hands_on_product_v1.contract_id, HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_ID);
  assert.equal(snapshot.hifly_hands_on_product_v1.plan.video_plan_version_id, "plan-v1");
  assert.equal(snapshot.hifly_hands_on_product_v1.avatar.material_version_id, "material-v1");
  assetVersionIds = ["product-asset-v1", "product-asset-v2"];
  await assert.rejects(() => port.freezeForOrder({ ...input, resolved }), { code: "HIFLY_HANDS_ON_PRODUCT_V1_PRODUCT_ASSET_REQUIRED" });
  assetVersionIds = ["product-asset-v1"];
  plan.presentation_size_code = "small";
  await assert.rejects(() => port.freezeForOrder({ ...input, resolved }), { code: "HIFLY_HANDS_ON_PRODUCT_V1_PRESENTATION_SIZE_INVALID" });
  plan.presentation_size_code = "smart_fit";
  materialSnapshot = { ...materialSnapshot, avatar_selection_id: "stale-selection", avatar_version_id: "stale-avatar" };
  await assert.rejects(() => port.freezeForOrder({ ...input, resolved }), { code: "HIFLY_HANDS_ON_PRODUCT_V1_AVATAR_BINDING_MISMATCH" });
});

test("handoff copies and hashes the immutable V1 contract without accepting lineage drift", () => {
  const productBytes = Buffer.from("product");
  const productChecksum = createHash("sha256").update(productBytes).digest("hex");
  const contract = buildHiflyHandsOnProductV1({
    plan: { video_plan_version_id: "plan-handoff", plan_review_id: "plan-review-handoff", status: "frozen", review_status: "approved", current: true },
    product: { revision_id: "revision-handoff", primary_asset_version_id: "asset-handoff", checksum_sha256: productChecksum, media_type: "image/png", size: productBytes.length },
    copy: { version_id: "copy-handoff", status: "frozen", review_status: "approved", body: BODY },
    avatar: { selection_id: "selection-handoff", avatar_version_id: "avatar-handoff", material_version_id: "material-handoff", checksum_sha256: "b".repeat(64), media_type: "image/png", size: 7, status: "confirmed", current: true }
  });
  const order = {
    id: "order-handoff", organization_id: "org-a", product_id: "product-handoff", video_plan_version_id: "plan-handoff", execution_purpose: "first_production",
    input_snapshot: {
      hifly_hands_on_product_v1: contract,
      plan_review: { id: "plan-review-handoff", status: "approved" },
      video_plan_version: { id: "plan-handoff", status: "frozen", presentation_size_code: "smart_fit", output_instructions: "operator text" },
      product_revision_snapshot: { id: "revision-handoff", status: "ready", product_name: "Handoff Product", asset_version_ids: ["asset-handoff"] },
      approved_copy_snapshot: { copy_version_id: "copy-handoff", version_number: 1, status: "frozen", body: BODY, review: { id: "copy-review", status: "approved" } },
      avatar_selection_snapshot: { avatar_selection_id: "selection-handoff", avatar_asset_id: "avatar-asset", avatar_asset_version_id: "avatar-handoff", status: "confirmed", version_number: 1, display_name: "Avatar", source_type: "enterprise", authorization_status: "valid", capability_status: "verified", capabilities: [{ code: "speech", evidence_reference: "fixture:speech" }] },
      asset_references: [{ asset_id: "asset", asset_version_id: "asset-handoff", role: "product_image", display_name: "product", media_type: "image/png", size: productBytes.length, checksum: productChecksum, retrieval_mode: "embedded", access_scope: "organization", body: productBytes }]
    }
  };
  const manifest = buildManualHandoffManifest({ order, packageId: "package-handoff", packageVersion: 1, createdAt: "2026-09-01T00:00:00.000Z", createdByMemberId: "member-a" });
  assert.deepEqual(manifest.hifly_hands_on_product_v1, contract);
  assert.notEqual(manifest.hifly_hands_on_product_v1, contract);
  assert.equal(Object.isFrozen(manifest.hifly_hands_on_product_v1), true);
  assert.equal(typeof manifest.manifest_hash, "string");
  assert.equal(manifest.manifest_hash.length, 64);
  const mismatchedOrder = structuredClone(order); mismatchedOrder.video_plan_version_id = "other-plan";
  assert.throws(() => buildManualHandoffManifest({ order: mismatchedOrder, packageId: "package-order-drift", packageVersion: 1, createdAt: "2026-09-01T00:00:00.000Z", createdByMemberId: "member-a" }), { code: "HIFLY_HANDS_ON_PRODUCT_V1_PLAN_BINDING_MISMATCH" });
  const drifted = structuredClone(order); drifted.input_snapshot.hifly_hands_on_product_v1 = structuredClone(contract); drifted.input_snapshot.hifly_hands_on_product_v1.plan.plan_review_id = "other-review";
  assert.throws(() => buildManualHandoffManifest({ order: drifted, packageId: "package-drift", packageVersion: 1, createdAt: "2026-09-01T00:00:00.000Z", createdByMemberId: "member-a" }), { code: "HIFLY_HANDS_ON_PRODUCT_V1_BINDING_MISMATCH" });
});

test("archive integrity binds manifest and package hashes to the expected package record", async () => {
  const assetBody = Buffer.from("embedded-product");
  const manifestBase = {
    contract_type: "manual_handoff", contract_version: "1.0", package_id: "package-integrity", package_version: 1, package_status: "ready",
    created_at: "2026-09-01T00:00:00.000Z", created_by: "member-a", organization_id: "org-a", project_id: "project-a", product_id: "product-a",
    production_order_id: "order-integrity", execution_purpose: "first_production", video_plan_version_id: "plan-a", copy_version_id: "copy-a", avatar_asset_version_id: "avatar-a",
    product_revision: { id: "revision-a", status: "ready", product_name: "Product", sku: "SKU-A", asset_version_ids: ["asset-a"] },
    copy_snapshot: { copy_version_id: "copy-a", version_number: 1, status: "frozen", intent: "product_recommendation", copy_body: "copy", approved_review_id: "copy-review", approved_at: "2026-09-01T00:00:00.000Z", review: { id: "copy-review", status: "approved" } },
    avatar_snapshot: { avatar_selection_id: "selection-a", avatar_asset_id: "avatar-asset", avatar_asset_version_id: "avatar-a", status: "confirmed", version_number: 1, confirmed_at: "2026-09-01T00:00:00.000Z", display_name: "Avatar", source_type: "enterprise", authorization_status: "valid", authorization_scope: "current_organization", capability_status: "verified", materials_accessible: true, capabilities: [{ code: "speech", evidence_reference: "fixture:speech" }], authorization_summary: "fixture", verified_capability_snapshot: { verified_capabilities: [{ code: "speech", evidence_reference: "fixture:speech" }] } },
    video_plan_snapshot: { id: "plan-a", status: "frozen", output_instructions: "fixed", presentation_size_code: "smart_fit" },
    configuration_snapshot: {}, execution_steps: ["fixed"], business_constraints: [], expected_behavior: ["fixed"], known_limitations: [], human_confirmation_points: ["fixed"],
    primary_output: { role: "primary_video", accepted_media_types: ["video/*"], expected_quantity: 1 }, supporting_outputs: [], file_naming_rule: "{product}.mp4", accepted_media_types: ["video/*"], expected_quantity: 1, minimum_validation_requirements: ["readable"],
    asset_references: [{ asset_id: "asset", asset_version_id: "asset-a", role: "product_image", display_name: "product", media_type: "image/png", size: assetBody.length, checksum: sha256(assetBody), retrieval_mode: "embedded", access_scope: "organization" }],
    generated_by_system: true, access_scope: "organization_members_with_order_access", retention_notice: "fixture", manifest_hash: null, package_hash: null
  };
  const manifestHash = sha256(canonicalJson(manifestBase));
  const manifestWithHash = { ...manifestBase, manifest_hash: manifestHash };
  const assetNames = ["assets/asset-a"];
  const provisionalPackageHash = sha256(canonicalJson({ manifest: { ...manifestWithHash, package_hash: null }, assets: assetNames }));
  const provisionalReadme = renderManualHandoffReadme({ ...manifestWithHash, package_hash: provisionalPackageHash });
  const packageHash = sha256(canonicalJson({ manifest: { ...manifestWithHash, package_hash: null }, readme: provisionalReadme, assets: [["assets/asset-a", sha256(assetBody)]] }));
  const manifest = { ...manifestWithHash, package_hash: packageHash };
  const readme = renderManualHandoffReadme(manifest);
  const body = await buildManualHandoffZip([{ name: "manifest.json", body: JSON.stringify(manifest) }, { name: "README.md", body: readme }, { name: "assets/asset-a", body: assetBody }]);
  const expectedPackage = { id: "package-integrity", production_order_id: "order-integrity", package_version: 1, manifest_hash: manifestHash, package_hash: packageHash };
  await verifyHandoffPackageIntegrity({ body, manifest, expectedPackage });
  await assert.rejects(() => verifyHandoffPackageIntegrity({ body, manifest, expectedPackage,
    expectedAttempt: { package_id: "other-package", production_order_id: "order-integrity", package_version: 1, manifest_hash: manifestHash, package_hash: packageHash } }), { code: "MANUAL_HANDOFF_PACKAGE_INTEGRITY_MISMATCH" });
  const tamperedBase = { ...manifest, product_id: "tampered" };
  const tamperedHash = sha256(canonicalJson({ ...tamperedBase, manifest_hash: null, package_hash: null }));
  const tamperedManifest = { ...tamperedBase, manifest_hash: tamperedHash, package_hash: null };
  const tamperedProvisional = sha256(canonicalJson({ manifest: { ...tamperedManifest, package_hash: null }, assets: assetNames }));
  const tamperedReadme = renderManualHandoffReadme({ ...tamperedManifest, package_hash: tamperedProvisional });
  const tamperedPackageHash = sha256(canonicalJson({ manifest: { ...tamperedManifest, package_hash: null }, readme: tamperedReadme, assets: [["assets/asset-a", sha256(assetBody)]] }));
  const tamperedFinal = { ...tamperedManifest, package_hash: tamperedPackageHash };
  const tamperedBody = await buildManualHandoffZip([{ name: "manifest.json", body: JSON.stringify(tamperedFinal) }, { name: "README.md", body: renderManualHandoffReadme(tamperedFinal) }, { name: "assets/asset-a", body: assetBody }]);
  await assert.rejects(() => verifyHandoffPackageIntegrity({ body: tamperedBody, manifest: tamperedFinal, expectedPackage }), { code: "MANUAL_HANDOFF_PACKAGE_INTEGRITY_MISMATCH" });

  const legacyManifest = { ...manifestBase, manifest_hash: null, package_hash: null };
  const legacyBody = await buildManualHandoffZip([
    { name: "manifest.json", body: JSON.stringify(legacyManifest) },
    { name: "README.md", body: "legacy package" },
    { name: "assets/asset-a", body: assetBody }
  ]);
  await assert.rejects(() => verifyHandoffPackageIntegrity({ body: legacyBody, expectedPackage: { id: "other-package", production_order_id: "order-integrity", package_version: 1 } }), { code: "MANUAL_HANDOFF_PACKAGE_INTEGRITY_MISMATCH" });
});

test("package compiler cross-checks V1 lineage and actual product/avatar bytes before producing a task", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-hands-on-v1-compiler-"));
  const productBytes = Buffer.from("product");
  const avatarBytes = Buffer.from("avatar");
  const productChecksum = createHash("sha256").update(productBytes).digest("hex");
  const avatarChecksum = createHash("sha256").update(avatarBytes).digest("hex");
  const contract = buildHiflyHandsOnProductV1({
    plan: { video_plan_version_id: "plan-compile", plan_review_id: "review-compile", status: "frozen", review_status: "approved", current: true },
    product: { revision_id: "revision-compile", primary_asset_version_id: "asset-compile", checksum_sha256: productChecksum, media_type: "image/png", size: productBytes.length },
    copy: { version_id: "copy-compile", status: "frozen", review_status: "approved", body: BODY },
    avatar: { selection_id: "selection-compile", avatar_version_id: "avatar-compile", material_version_id: "material-compile", checksum_sha256: avatarChecksum, media_type: "image/png", size: avatarBytes.length, status: "confirmed", current: true }
  });
  const manifest = {
    package_id: "package-compile", package_version: 1, organization_id: "org-a", production_order_id: "order-compile", product_id: "product-compile",
    video_plan_version_id: "plan-compile", copy_version_id: "copy-compile", avatar_asset_version_id: "avatar-compile", hifly_hands_on_product_v1: contract,
    product_revision: { id: "revision-compile", status: "ready", product_name: "Compile Product", sku: "SKU-C", asset_version_ids: ["asset-compile"] },
    copy_snapshot: { copy_version_id: "copy-compile", version_number: 1, status: "frozen", copy_body: BODY, review: { id: "copy-review", status: "approved" } },
    avatar_snapshot: { avatar_selection_id: "selection-compile", avatar_asset_version_id: "avatar-compile", status: "confirmed" },
    video_plan_snapshot: { id: "plan-compile", status: "frozen", presentation_size_code: "smart_fit" },
    plan_review: { id: "review-compile", status: "approved" },
    asset_references: [{ asset_id: "product-asset", asset_version_id: "asset-compile", role: "product_image", media_type: "image/png", size: productBytes.length, checksum: productChecksum, retrieval_mode: "embedded" }]
  };
  await mkdir(path.join(root, "assets"), { recursive: true });
  await writeFile(path.join(root, "assets", "asset-compile"), productBytes);
  const avatarPath = path.join(root, "avatar.png"); await writeFile(avatarPath, avatarBytes);
  try {
    const item = await compilePackageToBatchItem({ manifest: structuredClone(manifest), extractionRoot: root, avatarMappings: { "avatar-compile": avatarPath }, taskId: "task-compile" });
    assert.equal(item.contract_id, HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_ID);
    assert.equal(item.hifly_hands_on_product_v1.avatar.material_version_id, "material-compile");
    assert.equal(Object.isFrozen(item.hifly_hands_on_product_v1), true);
    assert.equal(Object.isFrozen(item.hifly_hands_on_product_v1.avatar), true);
    assert.equal(item.target_aspect_ratio, "9:16");
    assert.equal(item.voice_source, "hifly_native");
    await assert.rejects(() => compilePackageToBatchItem({ manifest, extractionRoot: root, avatarMappings: {} }), { code: "AVATAR_MAPPING_REQUIRED" });
    const bad = structuredClone(manifest); bad.hifly_hands_on_product_v1 = structuredClone(contract); bad.hifly_hands_on_product_v1.product.checksum_sha256 = "f".repeat(64);
    await assert.rejects(() => compilePackageToBatchItem({ manifest: bad, extractionRoot: root, avatarMappings: { "avatar-compile": avatarPath } }), { code: "HIFLY_HANDS_ON_PRODUCT_V1_CONTRACT_MISMATCH" });
    await writeFile(path.join(root, "assets", "asset-compile"), Buffer.from("tampered-product"));
    await assert.rejects(() => compilePackageToBatchItem({ manifest, extractionRoot: root, avatarMappings: { "avatar-compile": avatarPath } }), { code: "HIFLY_HANDS_ON_PRODUCT_V1_PRODUCT_INTEGRITY_MISMATCH" });
    await writeFile(path.join(root, "assets", "asset-compile"), productBytes);
    await writeFile(avatarPath, Buffer.from("tampered"));
    await assert.rejects(() => compilePackageToBatchItem({ manifest, extractionRoot: root, avatarMappings: { "avatar-compile": avatarPath } }), { code: "HIFLY_HANDS_ON_PRODUCT_V1_AVATAR_INTEGRITY_MISMATCH" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("V1 package compiler uses the explicit contract primary asset instead of the first reference", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-hands-on-v1-primary-"));
  const first = Buffer.from("first-product");
  const second = Buffer.from("second-product");
  const avatar = Buffer.from("avatar-primary");
  const contract = buildHiflyHandsOnProductV1({
    plan: { video_plan_version_id: "plan-primary", plan_review_id: "review-primary", status: "frozen", review_status: "approved", current: true },
    product: { revision_id: "revision-primary", primary_asset_version_id: "asset-primary-2", checksum_sha256: createHash("sha256").update(second).digest("hex"), media_type: "image/png", size: second.length },
    copy: { version_id: "copy-primary", status: "frozen", review_status: "approved", body: "copy" },
    avatar: { selection_id: "selection-primary", avatar_version_id: "avatar-primary", material_version_id: "material-primary", checksum_sha256: createHash("sha256").update(avatar).digest("hex"), media_type: "image/png", size: avatar.length, status: "confirmed", current: true }
  });
  const manifest = {
    package_id: "package-primary", package_version: 1, organization_id: "org-a", production_order_id: "order-primary", product_id: "product-primary",
    video_plan_version_id: "plan-primary", copy_version_id: "copy-primary", avatar_asset_version_id: "avatar-primary", hifly_hands_on_product_v1: contract,
    plan_review: { id: "review-primary", status: "approved" },
    product_revision: { id: "revision-primary", status: "ready", product_name: "Primary Product", sku: "SKU-P", asset_version_ids: ["asset-primary-1", "asset-primary-2"] },
    copy_snapshot: { copy_version_id: "copy-primary", version_number: 1, status: "frozen", copy_body: "copy", review: { id: "copy-review", status: "approved" } },
    avatar_snapshot: { avatar_selection_id: "selection-primary", avatar_asset_version_id: "avatar-primary", status: "confirmed" },
    video_plan_snapshot: { id: "plan-primary", status: "frozen", presentation_size_code: "smart_fit" },
    asset_references: [
      { asset_id: "asset-1", asset_version_id: "asset-primary-1", role: "product_image", media_type: "image/png", size: first.length, checksum: createHash("sha256").update(first).digest("hex"), retrieval_mode: "embedded" },
      { asset_id: "asset-2", asset_version_id: "asset-primary-2", role: "product_image", media_type: "image/png", size: second.length, checksum: createHash("sha256").update(second).digest("hex"), retrieval_mode: "embedded" }
    ]
  };
  await mkdir(path.join(root, "assets"), { recursive: true });
  await writeFile(path.join(root, "assets", "asset-primary-1"), first);
  await writeFile(path.join(root, "assets", "asset-primary-2"), second);
  const avatarPath = path.join(root, "avatar.png"); await writeFile(avatarPath, avatar);
  try {
    const item = await compilePackageToBatchItem({ manifest, extractionRoot: root, avatarMappings: { "avatar-primary": avatarPath }, taskId: "task-primary" });
    assert.match(item.image_path, /asset-primary-2\.png$/);
    await writeFile(path.join(root, "assets", "asset-primary-2"), Buffer.from("tampered-primary"));
    await assert.rejects(() => compilePackageToBatchItem({ manifest, extractionRoot: root, avatarMappings: { "avatar-primary": avatarPath } }), { code: "HIFLY_HANDS_ON_PRODUCT_V1_PRODUCT_INTEGRITY_MISMATCH" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Cloud adapter blocks before browser/delegate without an injected proven ratio/voice verifier", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-hands-on-v1-cloud-"));
  const calls = [];
  const contract = buildHiflyHandsOnProductV1({
    plan: { video_plan_version_id: "plan-cloud", plan_review_id: "review-cloud", status: "frozen", review_status: "approved", current: true },
    product: { revision_id: "revision-cloud", primary_asset_version_id: "asset-cloud", checksum_sha256: "a".repeat(64), media_type: "image/png", size: 1 },
    copy: { version_id: "copy-cloud", status: "frozen", review_status: "approved", body: "copy" },
    avatar: { selection_id: "selection-cloud", avatar_version_id: "avatar-cloud", material_version_id: "material-cloud", checksum_sha256: "b".repeat(64), media_type: "image/png", size: 1, status: "confirmed", current: true }
  });
  const workspace = { root, profileDir: path.join(root, "profile"), assetsDir: path.join(root, "assets"), outputsDir: path.join(root, "outputs"), evidenceDir: path.join(root, "evidence") };
  try {
    const adapter = createCloudPlaywrightAdapter({ workspace, taskFactory: async () => ({
      task_id: "cloud", script: "copy", resolved_script_mode: "frozen_copy", presentation_size_code: "smart_fit",
      hifly_hands_on_product_v1: contract, contract_id: contract.contract_id,
      video_plan_version_id: contract.plan.video_plan_version_id, plan_review_id: contract.plan.plan_review_id,
      product_revision_id: contract.product.revision_id, product_asset_version_id: contract.product.primary_asset_version_id,
      copy_version_id: contract.copy.version_id, avatar_selection_id: contract.avatar.selection_id,
      avatar_version_id: contract.avatar.avatar_version_id, avatar_material_version_id: contract.avatar.material_version_id,
      production_mode: contract.production.mode, target_aspect_ratio: contract.production.target_aspect_ratio, voice_source: contract.production.voice_source,
      handheld_aspect_ratio_policy: contract.production.handheld_aspect_ratio_policy,
      avatar: { asset_version_id: contract.avatar.avatar_version_id }
    }), browserType: { async launchPersistentContext() { calls.push("browser"); throw new Error("must not launch"); } } });
    const result = await adapter.run({ attempt: { id: "attempt-cloud" } });
    assert.equal(result.status, "requires_action");
    assert.equal(result.outcome, "requires_action");
    assert.equal(result.code, "CONTRACT_FIELD_NOT_MACHINE_VERIFIABLE");
    assert.equal(result.failureStage, "pre_point_gate");
    assert.deepEqual(result.fields, ["target_aspect_ratio", "voice_source"]);
    assert.deepEqual(calls, []);
    await adapter.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const [name, mutate, code] of [
  ["wrong plan", (value) => { value.plan.status = "draft"; }, "HIFLY_HANDS_ON_PRODUCT_V1_PLAN_INVALID"],
  ["unapproved plan review", (value) => { value.plan.review_status = "pending"; }, "HIFLY_HANDS_ON_PRODUCT_V1_PLAN_INVALID"],
  ["copy not frozen", (value) => { value.copy.status = "draft"; }, "HIFLY_HANDS_ON_PRODUCT_V1_COPY_INVALID"],
  ["wrong mode", (value) => { value.production.mode = "talking_text"; }, "HIFLY_HANDS_ON_PRODUCT_V1_MODE_INVALID"],
  ["wrong ratio", (value) => { value.production.target_aspect_ratio = "16:9"; }, "HIFLY_HANDS_ON_PRODUCT_V1_ASPECT_RATIO_INVALID"],
  ["wrong voice", (value) => { value.production.voice_source = "external_tts"; }, "HIFLY_HANDS_ON_PRODUCT_V1_VOICE_SOURCE_INVALID"]
]) {
  test(`rejects ${name} before an execution boundary`, () => {
    if (name === "wrong plan" || name === "unapproved plan review" || name === "copy not frozen") {
      const input = facts(); mutate(input); assert.throws(() => buildHiflyHandsOnProductV1(input), { code });
      return;
    }
    const value = structuredClone(buildHiflyHandsOnProductV1(facts()));
    mutate(value); assert.throws(() => requireHiflyHandsOnProductV1(value), { code });
  });
}
