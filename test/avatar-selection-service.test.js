import assert from "node:assert/strict";
import test from "node:test";

import { createAvatarSelectionService, createCurrentApprovedCopyPort } from "../src/avatar-selection/avatar-selection-service.js";
import { createMemoryAvatarSelectionRepository } from "../src/avatar-selection/memory-avatar-selection-repository.js";

const actor = { organizationId: "org-a", actorMemberId: "member-a", actorRole: "member" };

function world({ approved = true, now = "2026-08-07T08:00:00.000Z" } = {}) {
  let copyApproved = approved;
  const repository = createMemoryAvatarSelectionRepository();
  const copyApprovalPort = {
    async getCurrentApprovedCopy({ organizationId, productId, copyVersionId }) {
      if (organizationId !== "org-a" || productId !== "product-a" || copyVersionId !== "copy-a") return null;
      return copyApproved ? { copy_version_id: "copy-a", product_revision_id: "revision-a", current_valid: true } : null;
    },
    async resolveCurrentApprovedCopy({ organizationId, productId }) {
      if (organizationId !== "org-a" || productId !== "product-a") return null;
      return copyApproved ? { copy_version_id: "copy-a", product_revision_id: "revision-a", current_valid: true } : null;
    }
  };
  const productRevisionPort = {
    async getSnapshot({ organizationId, productRevisionId }) {
      if (organizationId !== "org-a" || productRevisionId !== "revision-a") {
        throw Object.assign(new Error("PRODUCT_REVISION_NOT_FOUND"), { code: "PRODUCT_REVISION_NOT_FOUND" });
      }
      return { organization_id: organizationId, product_id: "product-a", primary_category: "general" };
    }
  };
  return {
    repository,
    service: createAvatarSelectionService({ repository, copyApprovalPort, productRevisionPort, now: () => Date.parse(now) }),
    revokeCopy() { copyApproved = false; }
  };
}

function taggedRepository(tagsByName) {
  const repository = createMemoryAvatarSelectionRepository();
  const listCatalog = repository.listCatalog.bind(repository);
  repository.listCatalog = async (organizationId) => (await listCatalog(organizationId)).map((entry) => ({
    ...entry, asset: { ...entry.asset, category_tags: tagsByName[entry.asset.display_name] || [] }
  }));
  return repository;
}

function recommendationService({ primaryCategory, tagsByName = {}, approved = true } = {}) {
  const repository = taggedRepository(tagsByName);
  const copyApprovalPort = {
    async getCurrentApprovedCopy() {
      return approved ? { copy_version_id: "copy-a", product_revision_id: "revision-a", current_valid: true } : null;
    },
    async resolveCurrentApprovedCopy() {
      return approved ? { copy_version_id: "copy-a", product_revision_id: "revision-a", current_valid: true } : null;
    }
  };
  const productRevisionPort = {
    async getSnapshot({ organizationId, productRevisionId }) {
      assert.equal(organizationId, "org-a");
      assert.equal(productRevisionId, "revision-a");
      return { organization_id: organizationId, product_id: "product-a", primary_category: primaryCategory };
    }
  };
  return { repository, service: createAvatarSelectionService({ repository, copyApprovalPort, productRevisionPort }) };
}

test("recommendations use authoritative exact category matches and stable priority", async () => {
  const { service } = recommendationService({ primaryCategory: "  BEAUTY ", tagsByName: {
    "林小满": ["护肤"], "周言": [" Beauty ", "beauty"], "青禾企业主播": ["美妆"]
  } });
  const workspace = await service.getWorkspace({ ...actor, productId: "product-a", copyVersionId: "copy-a" });
  const recommended = workspace.catalog.filter((item) => item.recommendation.recommended);

  assert.deepEqual(recommended.map((item) => item.display_name), ["周言"]);
  assert.deepEqual(recommended[0].recommendation, {
    recommended: true, reason_code: "exact_category_match", reason: "匹配商品主品类「beauty」。", matched_tags: ["beauty"]
  });
  assert.equal(workspace.recommendation.reason_code, "exact_category_match");
  assert.equal(workspace.catalog[0].display_name, "周言");
  assert.ok(workspace.catalog.find((item) => item.display_name === "林小满").gate.can_confirm);
  assert.equal(workspace.catalog.find((item) => item.display_name === "林小满").recommendation.recommended, false);
});

test("recommendations fall back to the confirmable general pool when no exact match exists", async () => {
  const { service } = recommendationService({ primaryCategory: "美妆", tagsByName: {
    "林小满": ["护肤"], "周言": ["口播"], "青禾企业主播": []
  } });
  const workspace = await service.getWorkspace({ ...actor, productId: "product-a", copyVersionId: "copy-a" });
  const recommended = workspace.catalog.filter((item) => item.recommendation.recommended);

  assert.deepEqual(recommended.map((item) => item.display_name), ["青禾企业主播"]);
  assert.equal(workspace.recommendation.reason_code, "general_pool_fallback");
  assert.match(workspace.recommendation.reason, /未找到.*精确匹配/);
  assert.deepEqual(recommended[0].recommendation.matched_tags, []);
  assert.equal(recommended[0].recommendation.reason_code, "general_pool_fallback");
});

test("recommendations explain when no eligible exact or general candidate exists and exclude blocked avatars", async () => {
  const { service } = recommendationService({ primaryCategory: "美妆", tagsByName: {
    "林小满": ["护肤"], "周言": ["口播"], "青禾企业主播": ["口播"], "能力待核验人物": ["美妆"]
  } });
  const workspace = await service.getWorkspace({ ...actor, productId: "product-a", copyVersionId: "copy-a" });
  const blocked = workspace.catalog.find((item) => item.display_name === "能力待核验人物");

  assert.equal(workspace.catalog.some((item) => item.recommendation.recommended), false);
  assert.equal(workspace.recommendation.reason_code, "no_eligible_recommendation");
  assert.equal(blocked.gate.can_confirm, false);
  assert.equal(blocked.recommendation.recommended, false);
  assert.equal(blocked.recommendation.reason_code, "not_confirmable");
});

test("workspace recommendation reads the approved copy bound revision and never creates a selection", async () => {
  const calls = [];
  const state = world();
  state.service = createAvatarSelectionService({ repository: state.repository,
    copyApprovalPort: {
      async getCurrentApprovedCopy() { return { copy_version_id: "copy-a", product_revision_id: "revision-a", current_valid: true }; }
    },
    productRevisionPort: {
      async getSnapshot(input) {
        calls.push(input);
        return { organization_id: input.organizationId, product_id: "product-a", primary_category: "护肤" };
      }
    }
  });
  const before = await state.repository.getSelectionState("org-a", "product-a");
  const workspace = await state.service.getWorkspace({ ...actor, productId: "product-a", copyVersionId: "copy-a" });
  const after = await state.repository.getSelectionState("org-a", "product-a");

  assert.deepEqual(calls, [{ organizationId: "org-a", productRevisionId: "revision-a" }]);
  assert.equal(workspace.recommendation.primary_category, "护肤");
  assert.equal(before.current_selection, null);
  assert.equal(after.current_selection, null);
  assert.equal(after.selection_revision, before.selection_revision);
});

test("controlled existing-only catalog exposes public and enterprise avatars without unsupported capability claims", async () => {
  const { service } = world();
  const workspace = await service.getWorkspace({ ...actor, productId: "product-a", copyVersionId: "copy-a" });

  assert.deepEqual(new Set(workspace.catalog.map((item) => item.source_type)), new Set(["public", "enterprise"]));
  assert.ok(workspace.catalog.every((item) => item.controlled_seed === true && item.seed_label === "Phase 1 受控预置"));
  assert.ok(workspace.catalog.every((item) => item.creation_supported === false));
  const unknown = workspace.catalog.find((item) => item.capability_status === "unverified");
  assert.deepEqual(unknown.verified_capabilities, []);
  assert.equal(unknown.gate.can_confirm, false);
  assert.ok(unknown.gate.reasons.includes("capability_evidence_missing"));
});

test("member explicitly confirms an evidenced authorized avatar and refresh restores it", async () => {
  const { service, repository } = world();
  const catalog = (await service.getWorkspace({ ...actor, productId: "product-a", copyVersionId: "copy-a" })).catalog;
  const available = catalog.find((item) => item.gate.can_confirm);

  const confirmed = await service.confirmSelection({ ...actor, productId: "product-a", copyVersionId: "copy-a",
    assetVersionId: available.asset_version.id, expectedRevision: 0, idempotencyKey: "confirm-a" });
  assert.equal(confirmed.current_selection.status, "confirmed");
  assert.equal(confirmed.selection_revision, 1);
  assert.equal(confirmed.current_valid, true);
  assert.deepEqual(confirmed.history.map((item) => item.status), ["confirmed"]);

  const restored = await service.getWorkspace({ ...actor, productId: "product-a", copyVersionId: "copy-a" });
  assert.equal(restored.selection.current_selection.id, confirmed.current_selection.id);
  assert.ok((await repository.listAuditEvents()).some((event) => event.event_type === "avatar.selection_confirmed"));
});

test("same idempotency key replays, conflicting payload rejects, and stale selection revision conflicts", async () => {
  const { service } = world();
  const catalog = (await service.getWorkspace({ ...actor, productId: "product-a", copyVersionId: "copy-a" })).catalog;
  const available = catalog.filter((item) => item.gate.can_confirm);
  const input = { ...actor, productId: "product-a", copyVersionId: "copy-a", assetVersionId: available[0].asset_version.id,
    expectedRevision: 0, idempotencyKey: "confirm-idempotent" };
  const first = await service.confirmSelection(input);
  const replay = await service.confirmSelection(input);
  assert.equal(replay.current_selection.id, first.current_selection.id);
  await assert.rejects(service.confirmSelection({ ...input, assetVersionId: available[1].asset_version.id }), { code: "IDEMPOTENCY_CONFLICT" });
  await assert.rejects(service.confirmSelection({ ...input, assetVersionId: available[1].asset_version.id,
    idempotencyKey: "confirm-stale" }), { code: "AVATAR_SELECTION_CONFLICT" });
});

test("an old confirmation key replays its complete original result after the avatar changes", async () => {
  const { service } = world();
  const available = (await service.getWorkspace({ ...actor, productId: "product-a", copyVersionId: "copy-a" }))
    .catalog.filter((item) => item.gate.can_confirm);
  const firstInput = { ...actor, productId: "product-a", copyVersionId: "copy-a",
    assetVersionId: available[0].asset_version.id, expectedRevision: 0, idempotencyKey: "original-a" };
  const original = await service.confirmSelection(firstInput);
  await service.confirmSelection({ ...actor, productId: "product-a", copyVersionId: "copy-a",
    assetVersionId: available[1].asset_version.id, expectedRevision: 1, idempotencyKey: "change-to-b" });

  const replay = await service.confirmSelection(firstInput);
  assert.deepEqual(replay, original);
  assert.equal(replay.selection_revision, 1);
  assert.deepEqual(replay.history.map((item) => [item.asset_version_id, item.status]),
    [[available[0].asset_version.id, "confirmed"]]);
});

test("workspace resolves the product current approved copy when copyVersionId is omitted", async () => {
  const { service } = world();
  const workspace = await service.getWorkspace({ ...actor, productId: "product-a" });

  assert.equal(workspace.resolved_copy_version_id, "copy-a");
  assert.equal(workspace.copy_gate.approved, true);
  assert.ok(workspace.catalog.some((item) => item.gate.can_confirm));
});

test("changing avatar retains and supersedes history", async () => {
  const { service } = world();
  const available = (await service.getWorkspace({ ...actor, productId: "product-a", copyVersionId: "copy-a" }))
    .catalog.filter((item) => item.gate.can_confirm);
  const first = await service.confirmSelection({ ...actor, productId: "product-a", copyVersionId: "copy-a",
    assetVersionId: available[0].asset_version.id, expectedRevision: 0, idempotencyKey: "first" });
  const changed = await service.confirmSelection({ ...actor, productId: "product-a", copyVersionId: "copy-a",
    assetVersionId: available[1].asset_version.id, expectedRevision: first.selection_revision, idempotencyKey: "change" });

  assert.equal(changed.selection_revision, 2);
  assert.equal(changed.current_selection.asset_version_id, available[1].asset_version.id);
  assert.deepEqual(changed.history.map((item) => item.status), ["superseded", "confirmed"]);
  assert.equal(changed.history[0].superseded_by_selection_id, changed.current_selection.id);
});

test("expired or incomplete authorization and cross-organization versions cannot be confirmed", async () => {
  const { service } = world();
  const catalog = (await service.getWorkspace({ ...actor, productId: "product-a", copyVersionId: "copy-a" })).catalog;
  for (const status of ["expired", "incomplete"]) {
    const item = catalog.find((avatar) => avatar.authorization_status === status);
    assert.equal(item.gate.can_confirm, false);
    await assert.rejects(service.confirmSelection({ ...actor, productId: "product-a", copyVersionId: "copy-a",
      assetVersionId: item.asset_version.id, expectedRevision: 0, idempotencyKey: `blocked-${status}` }),
    { code: "AVATAR_SELECTION_GATE_BLOCKED" });
  }
  await assert.rejects(service.confirmSelection({ ...actor, productId: "product-a", copyVersionId: "copy-a",
    assetVersionId: "other-org-version", expectedRevision: 0, idempotencyKey: "cross-org" }),
  { code: "AVATAR_ASSET_VERSION_NOT_FOUND" });
});

test("catalog remains browsable without approved copy but confirmation is blocked", async () => {
  const { service } = world({ approved: false });
  const workspace = await service.getWorkspace({ ...actor, productId: "product-a", copyVersionId: "copy-a" });
  assert.ok(workspace.catalog.length > 0);
  assert.equal(workspace.copy_gate.approved, false);
  assert.ok(workspace.catalog.every((item) => item.gate.reasons.includes("approved_copy_missing")));
  await assert.rejects(service.confirmSelection({ ...actor, productId: "product-a", copyVersionId: "copy-a",
    assetVersionId: workspace.catalog[0].asset_version.id, expectedRevision: 0, idempotencyKey: "no-copy" }),
  { code: "AVATAR_SELECTION_GATE_BLOCKED" });
});

test("approved copy invalidation changes current validity projection while retaining confirmed history", async () => {
  const state = world();
  const available = (await state.service.getWorkspace({ ...actor, productId: "product-a", copyVersionId: "copy-a" }))
    .catalog.find((item) => item.gate.can_confirm);
  const confirmed = await state.service.confirmSelection({ ...actor, productId: "product-a", copyVersionId: "copy-a",
    assetVersionId: available.asset_version.id, expectedRevision: 0, idempotencyKey: "confirm-before-revoke" });
  state.revokeCopy();
  const projected = await state.service.getWorkspace({ ...actor, productId: "product-a", copyVersionId: "copy-a" });
  assert.equal(projected.selection.current_selection.id, confirmed.current_selection.id);
  assert.equal(projected.selection.current_selection.status, "confirmed");
  assert.equal(projected.selection.current_valid, false);
  assert.ok(projected.selection.invalidation_reasons.includes("approved_copy_missing"));
});

test("confirmation return projection rechecks A06 when approval changes after persistence", async () => {
  let approved = true;
  const repository = createMemoryAvatarSelectionRepository();
  const service = createAvatarSelectionService({ repository,
    copyApprovalPort: { async getCurrentApprovedCopy() { return approved ?
      { copy_version_id: "copy-a", product_revision_id: "revision-a", current_valid: true } : null; } },
    confirmationReturnBarrier: async () => { approved = false; },
    now: () => Date.parse("2026-08-07T08:00:00.000Z") });
  const available = (await service.getWorkspace({ ...actor, productId: "product-a", copyVersionId: "copy-a" }))
    .catalog.find((item) => item.gate.can_confirm);
  const result = await service.confirmSelection({ ...actor, productId: "product-a", copyVersionId: "copy-a",
    assetVersionId: available.asset_version.id, expectedRevision: 0, idempotencyKey: "confirm-race" });
  assert.equal(result.current_selection.status, "confirmed");
  assert.equal(result.current_valid, false);
  assert.deepEqual(result.invalidation_reasons, ["approved_copy_missing"]);
});

test("A06 current approved copy adapter rejects mismatched products and revoked approval gates", async () => {
  let approved = true;
  const port = createCurrentApprovedCopyPort({
    copyService: { async getCopyVersion() { return { id: "copy-a", product_id: "product-a", product_revision_id: "revision-a" }; } },
    copyReviewService: { async getCurrentApprovedGate() { return { approved }; } }
  });
  assert.deepEqual(await port.getCurrentApprovedCopy({ organizationId: "org-a", actorMemberId: "member-a",
    productId: "product-a", copyVersionId: "copy-a" }),
  { copy_version_id: "copy-a", product_revision_id: "revision-a", current_valid: true });
  assert.equal(await port.getCurrentApprovedCopy({ organizationId: "org-a", actorMemberId: "member-a",
    productId: "other-product", copyVersionId: "copy-a" }), null);
  approved = false;
  assert.equal(await port.getCurrentApprovedCopy({ organizationId: "org-a", actorMemberId: "member-a",
    productId: "product-a", copyVersionId: "copy-a" }), null);
});

test("A06 adapter resolves the newest current effective approved copy for a product", async () => {
  const port = createCurrentApprovedCopyPort({
    copyService: {
      async listCopyVersionsForProduct() {
        return [
          { id: "copy-current", product_id: "product-a", product_revision_id: "revision-current" },
          { id: "copy-old", product_id: "product-a", product_revision_id: "revision-old" }
        ];
      }
    },
    copyReviewService: { async getCurrentApprovedGate({ copyVersionId }) { return { approved: copyVersionId === "copy-current" }; } }
  });

  assert.deepEqual(await port.resolveCurrentApprovedCopy({ organizationId: "org-a", actorMemberId: "member-a", productId: "product-a" }),
    { copy_version_id: "copy-current", product_revision_id: "revision-current", current_valid: true });
});

test("admin public avatar sync is idempotent, renames in place, isolates organizations, and stays non-confirmable", async () => {
  const state = world();
  let entries = [
    { provider_key: "hifly-public:101", display_name: "公共人物一", source_type: "public" },
    { provider_key: "hifly-public:102", display_name: "公共人物二", source_type: "public" }
  ];
  const service = createAvatarSelectionService({
    repository: state.repository,
    copyApprovalPort: state.service ? {
      async getCurrentApprovedCopy() { return { copy_version_id: "copy-a", product_revision_id: "revision-a", current_valid: true }; },
      async resolveCurrentApprovedCopy() { return { copy_version_id: "copy-a", product_revision_id: "revision-a", current_valid: true }; }
    } : null,
    publicAvatarCatalog: { async list() { return entries; } },
    now: () => Date.parse("2026-08-12T00:00:00.000Z")
  });

  const first = await service.syncPublicCatalog({ organizationId: "org-a", actorMemberId: "admin-a", actorRole: "admin" });
  assert.deepEqual(first, { total: 2, created: 2, updated: 0, unchanged: 0, synced_at: "2026-08-12T00:00:00.000Z" });
  const replay = await service.syncPublicCatalog({ organizationId: "org-a", actorMemberId: "admin-a", actorRole: "admin" });
  assert.deepEqual(replay, { total: 2, created: 0, updated: 0, unchanged: 2, synced_at: "2026-08-12T00:00:00.000Z" });

  entries = [{ ...entries[0], display_name: "公共人物一改名" }, entries[1]];
  const renamed = await service.syncPublicCatalog({ organizationId: "org-a", actorMemberId: "admin-a", actorRole: "admin" });
  assert.deepEqual(renamed, { total: 2, created: 0, updated: 1, unchanged: 1, synced_at: "2026-08-12T00:00:00.000Z" });
  const catalog = await state.repository.listCatalog("org-a");
  const renamedEntry = catalog.find((entry) => entry.asset.display_name === "公共人物一改名");
  assert.ok(renamedEntry);
  assert.equal(renamedEntry.asset.controlled_seed, false);
  assert.equal(renamedEntry.asset.source_type, "public");
  assert.equal(renamedEntry.asset.seed_key, "hifly-public:101");
  assert.equal(renamedEntry.asset_version.materials_accessible, false);
  assert.equal(renamedEntry.asset_version.capability_status, "unverified");
  assert.deepEqual(renamedEntry.capabilities, []);

  const workspace = await service.getWorkspace({ ...actor, productId: "product-a", copyVersionId: "copy-a" });
  const publicEntry = workspace.catalog.find((entry) => entry.display_name === "公共人物一改名");
  assert.equal(publicEntry.gate.can_confirm, false);
  assert.equal(JSON.stringify(workspace).includes("hifly-public:101"), false);
  await assert.rejects(service.confirmSelection({ ...actor, productId: "product-a", copyVersionId: "copy-a",
    assetVersionId: publicEntry.asset_version.id, expectedRevision: 0, idempotencyKey: "public-blocked" }),
  { code: "AVATAR_SELECTION_GATE_BLOCKED" });

  await service.syncPublicCatalog({ organizationId: "org-b", actorMemberId: "admin-b", actorRole: "admin" });
  assert.equal((await state.repository.listCatalog("org-b")).filter((entry) => entry.asset.seed_key === "hifly-public:101").length, 1);
  assert.equal((await state.repository.listCatalog("org-a")).filter((entry) => entry.asset.seed_key === "hifly-public:101").length, 1);
});

test("public avatar sync is admin-only and fails closed without a provider", async () => {
  const state = world();
  const service = createAvatarSelectionService({ repository: state.repository, copyApprovalPort: state.service && {
    async getCurrentApprovedCopy() { return null; }
  } });
  await assert.rejects(service.syncPublicCatalog({ organizationId: "org-a", actorMemberId: "member-a", actorRole: "member" }),
    { code: "HIFLY_PUBLIC_AVATAR_SYNC_FORBIDDEN" });
  await assert.rejects(service.syncPublicCatalog({ organizationId: "org-a", actorMemberId: "admin-a", actorRole: "admin" }),
    { code: "HIFLY_PUBLIC_AVATAR_SYNC_UNAVAILABLE" });
});
