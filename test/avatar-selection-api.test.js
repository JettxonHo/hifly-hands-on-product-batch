import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryAvatarSelectionRepository } from "../src/avatar-selection/memory-avatar-selection-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { activateAdmin, identityApp, identityHeaders, login } from "./helpers/identity-world.js";

const approvalPort = {
  async getCurrentApprovedCopy({ organizationId, productId, copyVersionId }) {
    const expected = productId === "product-a" ? "copy-a" : productId === "product-b" ? "copy-b" : null;
    return copyVersionId === expected ?
      { copy_version_id: copyVersionId, product_revision_id: "revision-a", current_valid: true, organization_id: organizationId } : null;
  },
  async resolveCurrentApprovedCopy({ organizationId, productId }) {
    const copyVersionId = productId === "product-a" ? "copy-a" : productId === "product-b" ? "copy-b" : null;
    return copyVersionId ?
      { copy_version_id: copyVersionId, product_revision_id: `revision-${productId.at(-1)}`, current_valid: true, organization_id: organizationId } : null;
  }
};

test("avatar API lets members browse and explicitly confirm without exposing organization fields", async (t) => {
  const repository = createMemoryAvatarSelectionRepository();
  const { app, repository: identityRepository } = await identityApp(t, {
    avatarSelection: { enabled: true, repository, copyApprovalPort: approvalPort }
  });
  const admin = await activateAdmin(app);
  const mutation = identityHeaders({ cookies: admin.cookies, csrf: admin.csrf, mutation: true });
  const read = identityHeaders({ cookies: admin.cookies });

  assert.equal((await app.inject({ method: "GET", url: "/api/products/product-a/avatar-workspace?copyVersionId=copy-a",
    headers: identityHeaders() })).statusCode, 401);
  const workspaceResponse = await app.inject({ method: "GET", url: "/api/products/product-a/avatar-workspace?copyVersionId=copy-a", headers: read });
  assert.equal(workspaceResponse.statusCode, 200);
  const workspace = workspaceResponse.json();
  assert.equal(workspace.catalog_kind, "existing_only");
  assert.equal(workspace.provider_integration, false);
  assert.ok(workspace.catalog.every((item) => !("organization_id" in item)));
  const available = workspace.catalog.find((item) => item.gate.can_confirm);

  const confirmed = await app.inject({ method: "POST", url: "/api/products/product-a/avatar-selections",
    headers: { ...mutation, "idempotency-key": "api-confirm" },
    payload: { copy_version_id: "copy-a", asset_version_id: available.asset_version.id, expected_revision: 0 } });
  assert.equal(confirmed.statusCode, 201);
  assert.equal(confirmed.json().selection.current_selection.status, "confirmed");
  assert.equal("organization_id" in confirmed.json().selection.current_selection, false);

  const resolvedWorkspace = await app.inject({ method: "GET", url: "/api/products/product-a/avatar-workspace", headers: read });
  assert.equal(resolvedWorkspace.statusCode, 200);
  assert.equal(resolvedWorkspace.json().resolved_copy_version_id, "copy-a");
  assert.equal(resolvedWorkspace.json().copy_gate.approved, true);

  const switchedWorkspace = await app.inject({ method: "GET", url: "/api/products/product-b/avatar-workspace", headers: read });
  assert.equal(switchedWorkspace.statusCode, 200);
  assert.equal(switchedWorkspace.json().resolved_copy_version_id, "copy-b");
  const switchedAvatar = switchedWorkspace.json().catalog.find((item) => item.gate.can_confirm);
  const switchedConfirm = await app.inject({ method: "POST", url: "/api/products/product-b/avatar-selections",
    headers: { ...mutation, "idempotency-key": "api-confirm-product-b" },
    payload: { copy_version_id: switchedWorkspace.json().resolved_copy_version_id,
      asset_version_id: switchedAvatar.asset_version.id, expected_revision: 0 } });
  assert.equal(switchedConfirm.statusCode, 201);
  assert.equal(switchedConfirm.json().selection.current_selection.copy_version_id, "copy-b");

  const replay = await app.inject({ method: "POST", url: "/api/products/product-a/avatar-selections",
    headers: { ...mutation, "idempotency-key": "api-confirm" },
    payload: { copy_version_id: "copy-a", asset_version_id: available.asset_version.id, expected_revision: 0 } });
  assert.equal(replay.statusCode, 201);
  assert.equal(replay.json().selection.current_selection.id, confirmed.json().selection.current_selection.id);

  const memberCreated = (await app.inject({ method: "POST", url: "/api/identity/members", headers: mutation,
    payload: { email: "avatar-member@example.test", display_name: "Avatar Member", role: "member" } })).json();
  const member = await login(app, { email: "avatar-member@example.test", password: memberCreated.temporary_password });
  await app.inject({ method: "POST", url: "/api/auth/change-password",
    headers: identityHeaders({ cookies: member.cookies, csrf: member.csrf, mutation: true }),
    payload: { new_password: "Member-Permanent-Avatar-9!" } });
  assert.equal((await app.inject({ method: "GET", url: "/api/products/product-a/avatar-workspace?copyVersionId=copy-a",
    headers: identityHeaders({ cookies: member.cookies }) })).statusCode, 200);

  await seedInitialAdmin(identityRepository, { organizationId: "org-other", organizationName: "Other",
    adminEmail: "avatar-other@example.test", adminDisplayName: "Other Admin", adminTempPassword: "Temporary-Other-Avatar-9!" });
  const other = await login(app, { email: "avatar-other@example.test", password: "Temporary-Other-Avatar-9!" });
  await app.inject({ method: "POST", url: "/api/auth/change-password",
    headers: identityHeaders({ cookies: other.cookies, csrf: other.csrf, mutation: true }),
    payload: { new_password: "Other-Permanent-Avatar-9!" } });
  const cross = await app.inject({ method: "POST", url: "/api/products/product-a/avatar-selections",
    headers: { ...identityHeaders({ cookies: other.cookies, csrf: other.csrf, mutation: true }), "idempotency-key": "cross-org" },
    payload: { copy_version_id: "copy-a", asset_version_id: available.asset_version.id, expected_revision: 0 } });
  assert.equal(cross.statusCode, 404);
  assert.equal(cross.json().error, "AVATAR_ASSET_VERSION_NOT_FOUND");
});

test("avatar API maps business gate, idempotency and concurrency failures", async (t) => {
  const { app } = await identityApp(t, {
    avatarSelection: { enabled: true, repository: createMemoryAvatarSelectionRepository(), copyApprovalPort: approvalPort }
  });
  const auth = await activateAdmin(app);
  const headers = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  const workspace = (await app.inject({ method: "GET", url: "/api/products/product-a/avatar-workspace?copyVersionId=copy-a",
    headers: identityHeaders({ cookies: auth.cookies }) })).json();
  const available = workspace.catalog.filter((item) => item.gate.can_confirm);
  const expired = workspace.catalog.find((item) => item.authorization_status === "expired");

  const blocked = await app.inject({ method: "POST", url: "/api/products/product-a/avatar-selections",
    headers: { ...headers, "idempotency-key": "expired" }, payload: { copy_version_id: "copy-a",
      asset_version_id: expired.asset_version.id, expected_revision: 0 } });
  assert.equal(blocked.statusCode, 422);
  assert.ok(blocked.json().reasons.includes("authorization_expired"));

  await app.inject({ method: "POST", url: "/api/products/product-a/avatar-selections",
    headers: { ...headers, "idempotency-key": "first" }, payload: { copy_version_id: "copy-a",
      asset_version_id: available[0].asset_version.id, expected_revision: 0 } });
  const conflict = await app.inject({ method: "POST", url: "/api/products/product-a/avatar-selections",
    headers: { ...headers, "idempotency-key": "stale" }, payload: { copy_version_id: "copy-a",
      asset_version_id: available[1].asset_version.id, expected_revision: 0 } });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error, "AVATAR_SELECTION_CONFLICT");

  const idempotencyConflict = await app.inject({ method: "POST", url: "/api/products/product-a/avatar-selections",
    headers: { ...headers, "idempotency-key": "first" }, payload: { copy_version_id: "copy-a",
      asset_version_id: available[1].asset_version.id, expected_revision: 1 } });
  assert.equal(idempotencyConflict.statusCode, 409);
  assert.equal(idempotencyConflict.json().error, "IDEMPOTENCY_CONFLICT");
});
