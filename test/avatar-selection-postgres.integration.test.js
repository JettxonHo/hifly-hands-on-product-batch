import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createAssetService } from "../src/assets/asset-service.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createPostgresAssetRepository } from "../src/assets/postgres-asset-repository.js";
import { createAvatarSelectionService } from "../src/avatar-selection/avatar-selection-service.js";
import { createPostgresAvatarSelectionRepository } from "../src/avatar-selection/postgres-avatar-selection-repository.js";
import { runAvatarSelectionMigrations } from "../src/avatar-selection/postgres.js";
import { runAssetMigrations } from "../src/assets/postgres.js";
import { runCopyGenerationMigrations } from "../src/copy-generation/postgres.js";
import { runCopyQualityMigrations } from "../src/copy-quality/postgres.js";
import { runCopyReviewMigrations } from "../src/copy-review/postgres.js";
import { createPostgresIdentityRepository } from "../src/identity/postgres-identity-repository.js";
import { createIdentityPool, runIdentityMigrations } from "../src/identity/postgres.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { runProjectContentMigrations } from "../src/project-content/postgres.js";

const connectionString = process.env.TEST_DATABASE_URL || process.env.IDENTITY_TEST_DATABASE_URL;
const isolatedUrl = (value, schema) => { const url = new URL(value); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); };

test("clean PostgreSQL avatar migration seeds controlled catalog and serializes selection changes", { skip: !connectionString }, async (t) => {
  const schema = `avatar_selection_${randomUUID().replaceAll("-", "")}`;
  const adminPool = createIdentityPool({ connectionString });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = createIdentityPool({ connectionString: isolatedUrl(connectionString, schema) });
  t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`); await adminPool.end(); });
  await runIdentityMigrations(pool); await runAssetMigrations(pool); await runProjectContentMigrations(pool);
  await runCopyGenerationMigrations(pool); await runCopyQualityMigrations(pool); await runCopyReviewMigrations(pool);
  await runAvatarSelectionMigrations(pool);
  assert.equal((await pool.query("SELECT max(version)::integer version FROM avatar_selection_schema_migrations")).rows[0].version, 3);

  const seeded = await seedInitialAdmin(createPostgresIdentityRepository({ pool, ownsPool: false }), {
    organizationId: "org-avatar-pg", organizationName: "Avatar PG", adminEmail: "avatar-pg@example.test",
    adminDisplayName: "Avatar Admin", adminTempPassword: "Temporary-Avatar-PG-9!"
  });
  const ids = { project: randomUUID(), product: randomUUID(), revision: randomUUID(), copy: randomUUID() };
  const at = "2026-08-07T08:00:00.000Z";
  const materialAssetId = randomUUID(), materialVersionId = randomUUID();
  await pool.query(`INSERT INTO asset_assets(id,organization_id,kind,display_name,status,row_version,created_by_member_id,created_at,updated_at)
    VALUES ($1,'org-avatar-pg','avatar_image','企业人物素材','active',1,$2,$3,$3)`, [materialAssetId, seeded.member.id, at]);
  await pool.query(`INSERT INTO asset_versions(id,asset_id,organization_id,version_number,status,object_key,original_filename,expected_content_type,expected_size,expected_checksum_sha256,verified_content_type,verified_size,verified_checksum_sha256,verified_at,created_at,updated_at)
    VALUES ($1,$2,'org-avatar-pg',1,'available','org-avatar-pg/material/avatar','avatar.png','image/png',1,$3,'image/png',1,$3,$4,$4,$4)`, [materialVersionId, materialAssetId, "a".repeat(64), at]);
  await pool.query("INSERT INTO project_content_projects(id,organization_id,name,created_by_member_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5)", [ids.project,"org-avatar-pg","人物项目",seeded.member.id,at]);
  await pool.query("INSERT INTO project_content_products(id,organization_id,project_id,created_by_member_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5)", [ids.product,"org-avatar-pg",ids.project,seeded.member.id,at]);
  await pool.query(`INSERT INTO project_content_product_revisions(id,organization_id,project_id,product_id,status,revision_number,product_name,created_by_member_id,created_at,updated_at,ready_at)
    VALUES ($1,$2,$3,$4,'ready',1,'人物商品',$5,$6,$6,$6)`, [ids.revision,"org-avatar-pg",ids.project,ids.product,seeded.member.id,at]);
  await pool.query("UPDATE project_content_products SET current_revision_id=$1 WHERE id=$2", [ids.revision,ids.product]);
  await pool.query(`INSERT INTO copy_versions(id,organization_id,project_id,product_id,product_revision_id,intent,status,version_number,row_version,body,created_by_member_id,created_at,updated_at,frozen_at)
    VALUES ($1,$2,$3,$4,$5,'product_recommendation','frozen',1,2,'人物文案。',$6,$7,$7,$7)`, [ids.copy,"org-avatar-pg",ids.project,ids.product,ids.revision,seeded.member.id,at]);

  const repository = createPostgresAvatarSelectionRepository({ pool });
  await repository.initialize();
  await repository.ensureControlledCatalog("org-avatar-pg", at);
  const enterpriseInput = { organizationId: "org-avatar-pg", actorMemberId: seeded.member.id, materialAssetVersionId: materialVersionId,
    displayName: "PG 企业人物", description: "PG 企业人物素材", authorizationStatus: "valid",
    authorizationExpiresAt: "2027-12-31T23:59:59.000Z", categoryTags: ["护肤"], capabilities: [
      { code: "hands_on_product", label: "手持商品图", evidence_reference: "pg:evidence:1", verification_status: "verified" }
    ], now: at };
  const enterprise = await repository.registerEnterpriseAvatar(enterpriseInput);
  const enterpriseReplay = await repository.registerEnterpriseAvatar({ ...enterpriseInput, displayName: "不应重复" });
  assert.equal(enterpriseReplay.asset.id, enterprise.asset.id);
  assert.equal(enterprise.asset_version.material_asset_version_id, materialVersionId);
  assert.equal(enterprise.asset_version.materials_accessible, true);
  assert.deepEqual(enterprise.asset.category_tags, ["护肤"]);
  const exact = await repository.getCatalogAsset("org-avatar-pg", enterprise.asset.id);
  assert.ok(exact);
  assert.equal(exact.asset.id, enterprise.asset.id);
  assert.equal(exact.asset_version.id, enterprise.asset_version.id);
  assert.equal(exact.asset_version.material_asset_version_id, materialVersionId);
  assert.equal(await repository.getCatalogAsset("org-other", enterprise.asset.id), null);
  assert.equal((await repository.getCatalogVersion("org-avatar-pg", enterprise.asset_version.id)).asset.id, enterprise.asset.id);

  const deletedAssetId = randomUUID(), deletedVersionId = randomUUID();
  await pool.query(`INSERT INTO avatar_assets(id,organization_id,source_type,display_name,description,status,controlled_seed,seed_key,seed_label,category_tags,row_version,created_at,updated_at)
    VALUES ($1,'org-avatar-pg','enterprise','已删除人物','已删除人物素材','deleted',false,$2,'企业上传','[]'::jsonb,1,$3,$3)`,
  [deletedAssetId, `deleted:${deletedAssetId}`, at]);
  await pool.query(`INSERT INTO avatar_asset_versions(id,asset_id,organization_id,version_number,status,authorization_status,authorization_scope,capability_status,materials_accessible,preview_kind,created_at,updated_at)
    VALUES ($1,$2,'org-avatar-pg',1,'available','valid','current_organization','verified',false,'uploaded',$3,$3)`,
  [deletedVersionId, deletedAssetId, at]);
  assert.equal(await repository.getCatalogAsset("org-avatar-pg", deletedAssetId), null);
  assert.equal(await repository.getCatalogVersion("org-avatar-pg", deletedVersionId), null);
  assert.equal((await repository.listCatalog("org-avatar-pg")).some((entry) => entry.asset.id === deletedAssetId), false);
  assert.equal((await repository.listCatalog("org-avatar-pg")).filter((entry) => entry.asset_version.material_asset_version_id === materialVersionId).length, 1);
  const disabled = await repository.disableEnterpriseAvatar({ organizationId: "org-avatar-pg", assetId: enterprise.asset.id,
    expectedRevision: enterprise.asset.revision_number, actorMemberId: seeded.member.id, now: at });
  assert.equal(disabled.asset.status, "disabled");
  await assert.rejects(pool.query("UPDATE avatar_assets SET status='active',row_version=row_version+1 WHERE id=$1", [enterprise.asset.id]),
    /enterprise avatar metadata is append-only/);
  await assert.rejects(repository.disableEnterpriseAvatar({ organizationId: "org-avatar-pg", assetId: enterprise.asset.id,
    expectedRevision: enterprise.asset.revision_number, actorMemberId: seeded.member.id, now: at }), { code: "AVATAR_ASSET_VERSION_CONFLICT" });
  await assert.rejects(repository.disableEnterpriseAvatar({ organizationId: "org-avatar-pg", assetId: enterprise.asset.id,
    expectedRevision: disabled.asset.revision_number, actorMemberId: seeded.member.id, now: at }), { code: "AVATAR_ASSET_NOT_ACTIVE" });
  const publicEntries = [
    { provider_key: "hifly-public:pg-101", display_name: "PG 公共人物", source_type: "public" },
    { provider_key: "hifly-public:pg-102", display_name: "PG 第二人物", source_type: "public" }
  ];
  assert.deepEqual(await repository.syncPublicCatalog({ organizationId: "org-avatar-pg", entries: publicEntries, now: at }),
    { total: 2, created: 2, updated: 0, unchanged: 0 });
  assert.deepEqual(await repository.syncPublicCatalog({ organizationId: "org-avatar-pg", entries: publicEntries, now: at }),
    { total: 2, created: 0, updated: 0, unchanged: 2 });
  assert.deepEqual(await repository.syncPublicCatalog({ organizationId: "org-avatar-pg", entries: [
    { ...publicEntries[0], display_name: "PG 公共人物改名" }, publicEntries[1]
  ], now: at }), { total: 2, created: 0, updated: 1, unchanged: 1 });
  const synced = (await repository.listCatalog("org-avatar-pg")).find((entry) => entry.asset.seed_key === "hifly-public:pg-101");
  assert.ok(synced);
  assert.equal(synced.asset.display_name, "PG 公共人物改名");
  assert.equal(synced.asset.controlled_seed, false);
  assert.equal(synced.asset_version.materials_accessible, false);
  assert.equal(synced.asset_version.capability_status, "unverified");
  assert.deepEqual(synced.capabilities, []);
  const catalog = await repository.listCatalog("org-avatar-pg");
  assert.ok(catalog.length >= 6);
  assert.deepEqual(new Set(catalog.map((entry) => entry.asset.source_type)), new Set(["public", "enterprise"]));
  const available = catalog.filter((entry) => entry.asset_version.authorization_status === "valid" && entry.asset_version.capability_status === "verified");
  const confirm = (key, versionId, expectedRevision) => repository.confirmSelection({ organizationId: "org-avatar-pg",
    productId: ids.product, copyVersionId: ids.copy, assetVersionId: versionId, actorMemberId: seeded.member.id,
    expectedRevision, receiptKey: key, fingerprint: `${versionId}:${expectedRevision}`, now: at });
  const first = await confirm("pg-first", available[0].asset_version.id, 0);
  assert.equal(first.current_selection.status, "confirmed");
  const originalResult = { ...first, current_valid: true, invalidation_reasons: [], history: [first.current_selection] };
  await repository.updateReceiptResult("pg-first", originalResult);
  assert.equal((await repository.getReceipt("pg-first", `${available[0].asset_version.id}:0`)).current_selection.id,
    first.current_selection.id);
  await assert.rejects(repository.getReceipt("pg-first", "other"), { code: "IDEMPOTENCY_CONFLICT" });

  const outcomes = await Promise.allSettled([
    confirm("pg-change-a", available[1].asset_version.id, 1),
    confirm("pg-change-b", available[1].asset_version.id, 1)
  ]);
  assert.equal(outcomes.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(outcomes.find((item) => item.status === "rejected").reason.code, "AVATAR_SELECTION_CONFLICT");
  assert.deepEqual(await repository.getReceipt("pg-first", `${available[0].asset_version.id}:0`), originalResult);
  const state = await repository.getSelectionState("org-avatar-pg", ids.product);
  assert.deepEqual(state.history.map((item) => item.status), ["superseded", "confirmed"]);
  assert.equal((await repository.listEvents("org-avatar-pg", ids.product)).length, 5);
  await assert.rejects(pool.query("UPDATE avatar_selections SET copy_version_id=$1 WHERE id=$2", [ids.copy,first.current_selection.id]), /append-only/);

  const assetRepository = createPostgresAssetRepository({ pool });
  const assetService = createAssetService({ repository: assetRepository, objectStore: createMemoryObjectStore(),
    now: () => Date.parse("2026-08-24T00:00:00.000Z") });
  const previewService = createAvatarSelectionService({ repository, materialAssetPort: assetService,
    now: () => Date.parse("2026-08-24T00:00:00.000Z"),
    copyApprovalPort: { async getCurrentApprovedCopy() { return null; } } });
  assert.equal(typeof repository.authorizePreview, "function", "PostgreSQL catalog authorization must expose one transaction gate");
  assert.equal(typeof assetService.authorizeAvatarPreview, "function", "Asset authorization must join the catalog transaction gate");
  async function insertMaterial(label) {
    const assetId = randomUUID(), versionId = randomUUID();
    await pool.query(`INSERT INTO asset_assets(id,organization_id,kind,display_name,status,row_version,created_by_member_id,created_at,updated_at)
      VALUES ($1,'org-avatar-pg','avatar_image',$2,'active',1,$3,$4,$4)`, [assetId, label, seeded.member.id, at]);
    await pool.query(`INSERT INTO asset_versions(id,asset_id,organization_id,version_number,status,object_key,original_filename,
        expected_content_type,expected_size,expected_checksum_sha256,verified_content_type,verified_size,verified_checksum_sha256,
        verified_at,created_at,updated_at)
      VALUES ($1,$2,'org-avatar-pg',1,'available',$3,$4,'image/png',1,$5,'image/png',1,$5,$6,$6,$6)`,
    [versionId, assetId, `org-avatar-pg/material/${versionId}`, `${label}.png`, "c".repeat(64), at]);
    const avatar = await repository.registerEnterpriseAvatar({ organizationId: "org-avatar-pg", actorMemberId: seeded.member.id,
      materialAssetVersionId: versionId, displayName: label, description: `${label} preview`, authorizationStatus: "valid",
      capabilities: [], now: at });
    return { assetId, versionId, avatar };
  }

  const catalogRace = await insertMaterial("目录竞态人物");
  const catalogBlocker = await pool.connect();
  await catalogBlocker.query("BEGIN");
  await catalogBlocker.query("SELECT 1 FROM avatar_assets WHERE id=$1 FOR UPDATE", [catalogRace.avatar.asset.id]);
  let catalogMaterialCalled = false;
  const originalAssetAuthorize = assetService.authorizeAvatarPreview.bind(assetService);
  assetService.authorizeAvatarPreview = async (input) => { catalogMaterialCalled = true; return originalAssetAuthorize(input); };
  const catalogAuthorization = previewService.authorizePreview({ organizationId: "org-avatar-pg", actorMemberId: seeded.member.id,
    actorRole: "admin", avatarId: catalogRace.avatar.asset.id });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(catalogMaterialCalled, false, "catalog row lock must stop grant creation before the private binding gate");
  await catalogBlocker.query("UPDATE avatar_assets SET status='disabled',row_version=row_version+1,updated_at=$2 WHERE id=$1",
    [catalogRace.avatar.asset.id, "2026-08-24T00:00:01.000Z"]);
  await catalogBlocker.query("COMMIT");
  catalogBlocker.release();
  await assert.rejects(catalogAuthorization, { code: "AVATAR_PREVIEW_NOT_FOUND" });
  assert.equal(catalogMaterialCalled, false);

  const parentRace = await insertMaterial("父素材竞态人物");
  const parentBlocker = await pool.connect();
  await parentBlocker.query("BEGIN");
  await parentBlocker.query("SELECT 1 FROM asset_assets WHERE id=$1 FOR UPDATE", [parentRace.assetId]);
  let parentGateEntered;
  const parentGateStarted = new Promise((resolve) => { parentGateEntered = resolve; });
  const originalRepositoryAuthorize = assetRepository.authorizeAvatarPreviewMaterial.bind(assetRepository);
  assetRepository.authorizeAvatarPreviewMaterial = async (input) => {
    parentGateEntered();
    return originalRepositoryAuthorize(input);
  };
  const parentAuthorization = previewService.authorizePreview({ organizationId: "org-avatar-pg", actorMemberId: seeded.member.id,
    actorRole: "admin", avatarId: parentRace.avatar.asset.id });
  const parentGateReached = await Promise.race([
    parentGateStarted.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 100))
  ]);
  if (!parentGateReached) {
    await parentBlocker.query("ROLLBACK");
    parentBlocker.release();
  }
  assert.equal(parentGateReached, true, "authorization must enter the atomic parent Asset gate");
  await parentBlocker.query("UPDATE asset_assets SET status='disabled',row_version=row_version+1,updated_at=$2 WHERE id=$1",
    [parentRace.assetId, "2026-08-24T00:00:02.000Z"]);
  await parentBlocker.query("COMMIT");
  parentBlocker.release();
  await assert.rejects(parentAuthorization, { code: "AVATAR_PREVIEW_UNAVAILABLE" });
});
