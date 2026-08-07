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
  return {
    repository,
    service: createAvatarSelectionService({ repository, copyApprovalPort, now: () => Date.parse(now) }),
    revokeCopy() { copyApproved = false; }
  };
}

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
