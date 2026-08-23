import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createMemoryAvatarSelectionRepository } from "../src/avatar-selection/memory-avatar-selection-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { activateAdmin, identityApp, identityHeaders, intent, login } from "./helpers/identity-world.js";

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

test("avatar workspace projects authoritative category recommendations without mutating selection", async (t) => {
  const repository = createMemoryAvatarSelectionRepository();
  const listCatalog = repository.listCatalog.bind(repository);
  repository.listCatalog = async (organizationId) => (await listCatalog(organizationId)).map((entry) => ({
    ...entry, asset: { ...entry.asset, category_tags: entry.asset.display_name === "林小满" ? [" Beauty "] : ["护肤"] }
  }));
  const revisionCalls = [];
  const { app } = await identityApp(t, {
    avatarSelection: { enabled: true, repository, copyApprovalPort: approvalPort,
      productRevisionPort: { async getSnapshot(input) {
        revisionCalls.push(input);
        return { organization_id: input.organizationId, product_id: "product-a", primary_category: "  BEAUTY " };
      } } }
  });
  const admin = await activateAdmin(app);
  const read = identityHeaders({ cookies: admin.cookies });
  const first = await app.inject({ method: "GET", url: "/api/products/product-a/avatar-workspace?copyVersionId=copy-a", headers: read });
  assert.equal(first.statusCode, 200);
  const workspace = first.json();
  const recommended = workspace.catalog.filter((item) => item.recommendation.recommended);

  assert.deepEqual(recommended.map((item) => item.display_name), ["林小满"]);
  assert.equal(workspace.recommendation.primary_category, "beauty");
  assert.equal(workspace.recommendation.reason_code, "exact_category_match");
  assert.deepEqual(recommended[0].recommendation, {
    recommended: true, reason_code: "exact_category_match", reason: "匹配商品主品类「beauty」。", matched_tags: ["beauty"]
  });
  assert.equal(first.body.includes("provider_key"), false);
  assert.equal(first.body.includes("object_key"), false);
  assert.equal(first.body.includes("upload_token"), false);
  assert.equal(workspace.selection.current_selection, null);
  assert.equal(workspace.selection.selection_revision, 0);
  assert.deepEqual(revisionCalls, [{ organizationId: "org_test", productRevisionId: "revision-a" }]);

  const refreshed = await app.inject({ method: "GET", url: "/api/products/product-a/avatar-workspace?copyVersionId=copy-a", headers: read });
  assert.equal(refreshed.json().selection.current_selection, null);
  assert.equal(refreshed.json().selection.selection_revision, 0);
  assert.equal(revisionCalls.length, 2);
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

test("public avatar sync is an explicit admin-only API and never exposes provider identifiers", async (t) => {
  let calls = 0;
  const repository = createMemoryAvatarSelectionRepository();
  const { app } = await identityApp(t, {
    avatarSelection: {
      enabled: true,
      repository,
      copyApprovalPort: approvalPort,
      publicAvatarCatalog: {
        async list() {
          calls += 1;
          return [{ provider_key: "hifly-public:api-101", display_name: "API 公共人物", source_type: "public" }];
        }
      }
    }
  });
  const admin = await activateAdmin(app);
  const mutation = identityHeaders({ cookies: admin.cookies, csrf: admin.csrf, mutation: true });
  const synced = await app.inject({ method: "POST", url: "/api/avatar-catalog/hifly-public/sync", headers: mutation, payload: {} });
  assert.equal(synced.statusCode, 200);
  assert.deepEqual(synced.json(), {
    total: 1, created: 1, updated: 0, unchanged: 0, synced_at: synced.json().synced_at
  });
  assert.equal(calls, 1);
  assert.equal(synced.body.includes("api-101"), false);

  const workspace = await app.inject({ method: "GET", url: "/api/products/product-a/avatar-workspace?copyVersionId=copy-a",
    headers: identityHeaders({ cookies: admin.cookies }) });
  assert.equal(workspace.statusCode, 200);
  assert.equal(workspace.body.includes("api-101"), false);
  assert.equal(workspace.json().catalog.find((item) => item.display_name === "API 公共人物").gate.can_confirm, false);

  const memberCreated = (await app.inject({ method: "POST", url: "/api/identity/members", headers: mutation,
    payload: { email: "public-sync-member@example.test", display_name: "Public Sync Member", role: "member" } })).json();
  const member = await login(app, { email: "public-sync-member@example.test", password: memberCreated.temporary_password });
  await app.inject({ method: "POST", url: "/api/auth/change-password", headers: identityHeaders({ cookies: member.cookies, csrf: member.csrf, mutation: true }),
    payload: { new_password: "Public-Sync-Member-Password-9!" } });
  const forbidden = await app.inject({ method: "POST", url: "/api/avatar-catalog/hifly-public/sync",
    headers: identityHeaders({ cookies: member.cookies, csrf: member.csrf, mutation: true }), payload: {} });
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.json().error, "HIFLY_PUBLIC_AVATAR_SYNC_FORBIDDEN");
  assert.equal(calls, 1);
});

test("public avatar sync without a provider client fails stably and ordinary workspace reads do not call a provider", async (t) => {
  let calls = 0;
  const { app } = await identityApp(t, {
    avatarSelection: { enabled: true, repository: createMemoryAvatarSelectionRepository(), copyApprovalPort: approvalPort,
      publicAvatarCatalog: { async list() { calls += 1; return []; } } }
  });
  const admin = await activateAdmin(app);
  const read = await app.inject({ method: "GET", url: "/api/products/product-a/avatar-workspace?copyVersionId=copy-a",
    headers: identityHeaders({ cookies: admin.cookies }) });
  assert.equal(read.statusCode, 200);
  assert.equal(calls, 0);

  const { app: noProvider } = await identityApp(t, {
    avatarSelection: { enabled: true, repository: createMemoryAvatarSelectionRepository(), copyApprovalPort: approvalPort }
  });
  const noProviderAdmin = await activateAdmin(noProvider);
  const response = await noProvider.inject({ method: "POST", url: "/api/avatar-catalog/hifly-public/sync",
    headers: identityHeaders({ cookies: noProviderAdmin.cookies, csrf: noProviderAdmin.csrf, mutation: true }), payload: {} });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error, "HIFLY_PUBLIC_AVATAR_SYNC_UNAVAILABLE");
});

test("public avatar sync maps provider failures without returning provider messages", async (t) => {
  const { app } = await identityApp(t, {
    avatarSelection: { enabled: true, repository: createMemoryAvatarSelectionRepository(), copyApprovalPort: approvalPort,
      publicAvatarCatalog: { async list() { throw Object.assign(new Error("provider token=secret"), { code: "HIFLY_API_AUTH_INVALID" }); } } }
  });
  const admin = await activateAdmin(app);
  const response = await app.inject({ method: "POST", url: "/api/avatar-catalog/hifly-public/sync",
    headers: identityHeaders({ cookies: admin.cookies, csrf: admin.csrf, mutation: true }), payload: {} });
  assert.equal(response.statusCode, 502);
  assert.deepEqual(response.json(), { error: "HIFLY_API_AUTH_INVALID" });
  assert.doesNotMatch(response.body, /provider token=secret/);
});

test("enterprise avatar API reuses verified upload, projects safe fields, and keeps management admin-only", async (t) => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
  const replacementPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGP4zwAAAgEBAScY42YAAAAASUVORK5CYII=", "base64");
  const checksum = createHash("sha256").update(png).digest("hex");
  const assetRepository = createMemoryAssetRepository();
  const objectStore = createMemoryObjectStore();
  const { app, repository: identityRepository } = await identityApp(t, {
    assets: { enabled: true, repository: assetRepository, objectStore, worker: { autoStart: false } },
    avatarSelection: { enabled: true, repository: createMemoryAvatarSelectionRepository(), copyApprovalPort: approvalPort }
  });
  const admin = await activateAdmin(app);
  const mutation = identityHeaders({ cookies: admin.cookies, csrf: admin.csrf, mutation: true });
  const authorized = await app.inject({ method: "POST", url: "/api/assets/upload-authorizations",
    headers: { ...mutation, "idempotency-key": "api-avatar-upload" },
    payload: { filename: "avatar.png", content_type: "image/png", size: png.length, checksum_sha256: checksum, kind: "avatar_image" } });
  assert.equal(authorized.statusCode, 201);
  assert.equal(authorized.json().asset.kind, "avatar_image");
  assert.equal(Object.hasOwn(authorized.json().upload, "token"), false);
  assert.equal(authorized.body.includes("object_key"), false);
  await app.inject({ method: "PUT", url: authorized.json().upload.url, headers: { ...mutation, "content-type": "image/png" }, payload: png });
  await app.inject({ method: "POST", url: "/api/assets/upload-completions", headers: mutation,
    payload: { upload_session_id: authorized.json().upload_session_id, idempotency_key: "api-avatar-complete" } });
  await app.assets.service.runNextVerificationJob();

  const registered = await app.inject({ method: "POST", url: "/api/avatar-catalog/enterprise", headers: mutation, payload: {
    material_asset_version_id: authorized.json().asset_version.id, display_name: "API 企业人物", description: "企业人物说明",
    authorization_status: "valid", authorization_expires_at: "2027-12-31T23:59:59.000Z", category_tags: [" 美妆 ", "美妆"],
    capabilities: [{ code: "hands_on_product", label: "手持商品图", evidence_reference: "api:evidence:1" }]
  } });
  assert.equal(registered.statusCode, 201);
  assert.deepEqual(registered.json().avatar.category_tags, ["美妆"]);
  assert.equal(registered.json().avatar.materials_accessible, true);
  assert.equal(registered.body.includes("object_key"), false);
  assert.equal(registered.body.includes("upload_token"), false);
  assert.equal(registered.body.includes("provider_key"), false);
  assert.equal(registered.body.includes("/tmp/"), false);
  const replay = await app.inject({ method: "POST", url: "/api/avatar-catalog/enterprise", headers: mutation, payload: {
    material_asset_version_id: authorized.json().asset_version.id, display_name: "不同名字", description: "不应覆盖", authorization_status: "valid"
  } });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().avatar.id, registered.json().avatar.id);
  const anonymousIntent = await intent(app);
  const unauthenticatedPreview = await app.inject({ method: "POST",
    url: `/api/avatar-catalog/${encodeURIComponent(registered.json().avatar.id)}/preview-authorizations`,
    headers: identityHeaders({ cookies: anonymousIntent.cookies, csrf: anonymousIntent.csrf, mutation: true }), payload: {} });
  assert.equal(unauthenticatedPreview.statusCode, 401);

  const memberCreated = (await app.inject({ method: "POST", url: "/api/identity/members", headers: mutation,
    payload: { email: "avatar-material-member@example.test", display_name: "Avatar Material Member", role: "member" } })).json();
  const member = await login(app, { email: memberCreated.member.email, password: memberCreated.temporary_password });
  await app.inject({ method: "POST", url: "/api/auth/change-password", headers: identityHeaders({ cookies: member.cookies, csrf: member.csrf, mutation: true }),
    payload: { new_password: "Avatar-Material-Member-9!" } });
  const memberMutation = identityHeaders({ cookies: member.cookies, csrf: member.csrf, mutation: true });
  const forbidden = await app.inject({ method: "POST", url: "/api/avatar-catalog/enterprise", headers: memberMutation, payload: {
    material_asset_version_id: authorized.json().asset_version.id, display_name: "成员人物", description: "x", authorization_status: "valid"
  } });
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.json().error, "AVATAR_REGISTRATION_FORBIDDEN");

  const workspace = await app.inject({ method: "GET", url: "/api/products/product-a/avatar-workspace?copyVersionId=copy-a",
    headers: identityHeaders({ cookies: member.cookies }) });
  const enterprise = workspace.json().catalog.find((item) => item.display_name === "API 企业人物");
  assert.equal(enterprise.category_tags[0], "美妆");
  assert.equal(Object.hasOwn(enterprise, "material_asset_version_id"), false);
  assert.equal(workspace.body.includes("enterprise:"), false);

  const previewAuthorization = await app.inject({ method: "POST",
    url: `/api/avatar-catalog/${encodeURIComponent(enterprise.id)}/preview-authorizations`, headers: memberMutation, payload: {} });
  assert.equal(previewAuthorization.statusCode, 201);
  assert.deepEqual(Object.keys(previewAuthorization.json().preview).sort(),
    ["checksum_sha256", "expires_at", "media_type", "size", "url"]);
  assert.equal(previewAuthorization.json().preview.media_type, "image/png");
  assert.equal(previewAuthorization.json().preview.size, png.length);
  assert.equal(previewAuthorization.json().preview.checksum_sha256, checksum);
  assert.equal(previewAuthorization.body.includes(authorized.json().asset_version.id), false);
  assert.equal(previewAuthorization.body.includes("object_key"), false);
  assert.equal(previewAuthorization.body.includes("token"), false);
  const previewBytes = await app.inject({ method: "GET", url: previewAuthorization.json().preview.url,
    headers: identityHeaders({ cookies: member.cookies }) });
  assert.equal(previewBytes.statusCode, 200);
  assert.equal(previewBytes.headers["content-type"], "image/png");
  assert.equal(createHash("sha256").update(previewBytes.rawPayload).digest("hex"), checksum);
  const privateVersion = await assetRepository.getAssetVersion("org_test", authorized.json().asset_version.id);
  await objectStore.replace(privateVersion.object_key, replacementPng);
  const swappedPreviewBytes = await app.inject({ method: "GET", url: previewAuthorization.json().preview.url,
    headers: identityHeaders({ cookies: member.cookies }) });
  assert.equal(swappedPreviewBytes.statusCode, 500);
  assert.deepEqual(swappedPreviewBytes.json(), { error: "INTERNAL_ERROR" });
  await objectStore.replace(privateVersion.object_key, png);
  const recoveredPreviewBytes = await app.inject({ method: "GET", url: previewAuthorization.json().preview.url,
    headers: identityHeaders({ cookies: member.cookies }) });
  assert.equal(recoveredPreviewBytes.statusCode, 200);
  assert.equal(createHash("sha256").update(recoveredPreviewBytes.rawPayload).digest("hex"), checksum);

  const exactAssetAuthorize = app.assets.service.authorizeAvatarPreview;
  app.assets.service.authorizeAvatarPreview = async () => {
    throw new Error("temporary grant failure credential=secret-value");
  };
  const transientPreview = await app.inject({ method: "POST",
    url: `/api/avatar-catalog/${encodeURIComponent(enterprise.id)}/preview-authorizations`, headers: memberMutation, payload: {} });
  assert.equal(transientPreview.statusCode, 503);
  assert.deepEqual(transientPreview.json(), { error: "AVATAR_PREVIEW_AUTHORIZATION_UNAVAILABLE" });
  assert.doesNotMatch(transientPreview.body, /secret-value|credential/);
  app.assets.service.authorizeAvatarPreview = exactAssetAuthorize;

  const disabled = await app.inject({ method: "POST", url: `/api/avatar-catalog/enterprise/${encodeURIComponent(enterprise.id)}/disable`,
    headers: mutation, payload: { expected_revision: enterprise.revision_number } });
  assert.equal(disabled.statusCode, 200);
  assert.equal(disabled.json().avatar.status, "disabled");
  const disabledPreview = await app.inject({ method: "POST",
    url: `/api/avatar-catalog/${encodeURIComponent(enterprise.id)}/preview-authorizations`, headers: memberMutation, payload: {} });
  assert.equal(disabledPreview.statusCode, 404);
  assert.equal(disabledPreview.json().error, "AVATAR_PREVIEW_NOT_FOUND");
  const controlled = workspace.json().catalog.find((item) => item.controlled_seed);
  const unavailablePreview = await app.inject({ method: "POST",
    url: `/api/avatar-catalog/${encodeURIComponent(controlled.id)}/preview-authorizations`, headers: memberMutation, payload: {} });
  assert.equal(unavailablePreview.statusCode, 422);
  assert.equal(unavailablePreview.json().error, "AVATAR_PREVIEW_UNAVAILABLE");
  const controlledDisable = await app.inject({ method: "POST", url: `/api/avatar-catalog/enterprise/${controlled.id}/disable`,
    headers: mutation, payload: { expected_revision: controlled.revision_number } });
  assert.equal(controlledDisable.statusCode, 403);

  await seedInitialAdmin(identityRepository, { organizationId: "org-avatar-material-other", organizationName: "Other",
    adminEmail: "avatar-material-other@example.test", adminDisplayName: "Other", adminTempPassword: "Temporary-Other-Avatar-Material-9!" });
  const other = await login(app, { email: "avatar-material-other@example.test", password: "Temporary-Other-Avatar-Material-9!" });
  await app.inject({ method: "POST", url: "/api/auth/change-password", headers: identityHeaders({ cookies: other.cookies, csrf: other.csrf, mutation: true }),
    payload: { new_password: "Other-Avatar-Material-9!" } });
  const cross = await app.inject({ method: "POST", url: "/api/avatar-catalog/enterprise", headers: identityHeaders({ cookies: other.cookies, csrf: other.csrf, mutation: true }), payload: {
    material_asset_version_id: authorized.json().asset_version.id, display_name: "跨组织", description: "x", authorization_status: "valid"
  } });
  assert.equal(cross.statusCode, 404);
  const crossPreview = await app.inject({ method: "POST",
    url: `/api/avatar-catalog/${encodeURIComponent(enterprise.id)}/preview-authorizations`,
    headers: identityHeaders({ cookies: other.cookies, csrf: other.csrf, mutation: true }), payload: {} });
  assert.equal(crossPreview.statusCode, 404);
  assert.equal(crossPreview.json().error, "AVATAR_PREVIEW_NOT_FOUND");
});
