import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { ADMIN_TEMP_PASSWORD, activateAdmin, identityApp, identityHeaders, login, seededRepository } from "./helpers/identity-world.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { buildApp } from "../src/server/app.js";
import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const CHECKSUM = createHash("sha256").update(PNG).digest("hex");

async function assetWorld(t) {
  const assetRepository = createMemoryAssetRepository();
  const objectStore = createMemoryObjectStore();
  const result = await identityApp(t, { assets: { enabled: true, repository: assetRepository, objectStore, worker: { autoStart: false } } });
  return { ...result, assetRepository, objectStore };
}

function authHeaders(auth, mutation = false, contentType = "application/json") {
  return { ...identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation }), ...(mutation ? { "content-type": contentType } : {}) };
}

async function authorize(app, auth, extra = {}, idempotencyKey = randomUUID()) {
  return app.inject({
    method: "POST", url: "/api/assets/upload-authorizations", headers: { ...authHeaders(auth, true), "idempotency-key": idempotencyKey },
    payload: { filename: "product.png", content_type: "image/png", size: PNG.length, checksum_sha256: CHECKSUM, organization_id: "forged_org", ...extra }
  });
}

test("upload authorization requires Idempotency-Key and replays without duplicate objects", async (t) => {
  const { app, assetRepository } = await assetWorld(t);
  const auth = await activateAdmin(app);
  const missing = await app.inject({
    method: "POST", url: "/api/assets/upload-authorizations", headers: authHeaders(auth, true),
    payload: { filename: "product.png", content_type: "image/png", size: PNG.length, checksum_sha256: CHECKSUM }
  });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().error, "INVALID_IDEMPOTENCY_KEY");
  const first = await authorize(app, auth, {}, "authorization-key");
  const replay = await authorize(app, auth, { filename: " product.png " }, "authorization-key");
  assert.equal(replay.statusCode, 201);
  assert.equal(replay.json().asset.id, first.json().asset.id);
  assert.equal(replay.json().asset_version.id, first.json().asset_version.id);
  assert.equal(replay.json().upload_session_id, first.json().upload_session_id);
  assert.notEqual(replay.json().upload.url, first.json().upload.url);
  assert.equal((await assetRepository.listAuditEvents()).filter((event) => event.event_type === "asset.upload_authorized").length, 1);
  const conflict = await authorize(app, auth, { size: PNG.length + 1 }, "authorization-key");
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error, "IDEMPOTENCY_CONFLICT");
});

test("asset API requires a fully active identity", async (t) => {
  const { app } = await assetWorld(t);
  const anonymous = await app.inject({ method: "GET", url: "/api/assets", headers: identityHeaders() });
  assert.equal(anonymous.statusCode, 401);
  const passwordChange = await login(app);
  const restricted = await app.inject({ method: "GET", url: "/api/assets", headers: identityHeaders({ cookies: passwordChange.cookies }) });
  assert.equal(restricted.statusCode, 403);
  assert.equal(restricted.json().error, "PASSWORD_CHANGE_REQUIRED");
});

test("disabled membership is rejected on the next asset request", async (t) => {
  const { app } = await assetWorld(t);
  const admin = await activateAdmin(app);
  const adminMutation = authHeaders(admin, true);
  const created = (await app.inject({
    method: "POST", url: "/api/identity/members", headers: adminMutation,
    payload: { email: "asset-member@example.test", display_name: "Asset Member", role: "member" }
  })).json();
  const member = await login(app, { email: "asset-member@example.test", password: created.temporary_password });
  await app.inject({ method: "POST", url: "/api/auth/change-password", headers: authHeaders(member, true), payload: { new_password: "Asset-Member-Password-9!" } });
  const current = (await app.inject({ method: "GET", url: "/api/identity/members", headers: authHeaders(admin) })).json().members.find((item) => item.id === created.member.id);
  await app.inject({
    method: "POST", url: `/api/identity/members/${created.member.id}/disable`, headers: adminMutation,
    payload: { expected_revision: current.revision_number }
  });
  const denied = await app.inject({ method: "GET", url: "/api/assets", headers: authHeaders(member) });
  assert.equal(denied.statusCode, 401);
});

test("ordinary members may upload but cannot disable assets", async (t) => {
  const { app } = await assetWorld(t);
  const admin = await activateAdmin(app);
  const createdMember = (await app.inject({
    method: "POST", url: "/api/identity/members", headers: authHeaders(admin, true),
    payload: { email: "uploader@example.test", display_name: "Uploader", role: "member" }
  })).json();
  const member = await login(app, { email: "uploader@example.test", password: createdMember.temporary_password });
  await app.inject({ method: "POST", url: "/api/auth/change-password", headers: authHeaders(member, true), payload: { new_password: "Uploader-Password-9!" } });
  const created = await authorize(app, member);
  assert.equal(created.statusCode, 201);
  const renamed = await app.inject({
    method: "PATCH", url: `/api/assets/${created.json().asset.id}`, headers: authHeaders(member, true),
    payload: { display_name: "商品主图", expected_revision: 1 }
  });
  assert.equal(renamed.statusCode, 200);
  assert.equal(renamed.json().asset.display_name, "商品主图");
  assert.equal(renamed.json().asset.revision_number, 2);
  assert.equal((await app.inject({ method: "GET", url: "/api/assets", headers: authHeaders(member) })).json().assets[0].versions.length, 1);
  const stale = await app.inject({
    method: "PATCH", url: `/api/assets/${created.json().asset.id}`, headers: authHeaders(member, true),
    payload: { display_name: "旧写入", expected_revision: 1 }
  });
  assert.equal(stale.statusCode, 409);
  const forbidden = await app.inject({
    method: "POST", url: `/api/assets/${created.json().asset.id}/disable`, headers: authHeaders(member, true), payload: { expected_revision: 2 }
  });
  assert.equal(forbidden.statusCode, 403);
  assert.equal(forbidden.json().error, "ADMIN_REQUIRED");
});

test("a second Organization cannot read or complete the first Organization upload", async (t) => {
  const identityRepository = await seededRepository();
  await seedInitialAdmin(identityRepository, {
    organizationId: "org_other", organizationName: "Other Organization", adminEmail: "other-admin@example.test",
    adminDisplayName: "Other Admin", adminTempPassword: ADMIN_TEMP_PASSWORD
  });
  const { app } = await identityApp(t, {
    repository: identityRepository, seed: false,
    assets: { enabled: true, repository: createMemoryAssetRepository(), objectStore: createMemoryObjectStore(), worker: { autoStart: false } }
  });
  const first = await activateAdmin(app);
  const created = (await authorize(app, first)).json();
  const other = await login(app, { email: "other-admin@example.test", password: ADMIN_TEMP_PASSWORD });
  await app.inject({ method: "POST", url: "/api/auth/change-password", headers: authHeaders(other, true), payload: { new_password: "Other-Admin-Password-9!" } });
  assert.equal((await app.inject({ method: "GET", url: `/api/asset-versions/${created.asset_version.id}`, headers: authHeaders(other) })).statusCode, 404);
  assert.equal((await app.inject({
    method: "POST", url: "/api/assets/upload-completions", headers: authHeaders(other, true),
    payload: { upload_session_id: created.upload_session_id, idempotency_key: "cross-org" }
  })).statusCode, 404);
});

test("identity and assets disabled leave the Playwright workbench route contract unchanged", async (t) => {
  const app = await buildApp({ root: await mkdtemp(path.join(os.tmpdir(), "hifly-assets-off-")), executor: createFakeExecutor() });
  t.after(() => app.close());
  const runtime = await app.inject({ method: "GET", url: "/api/runtime", headers: { host: "127.0.0.1:4317" } });
  assert.equal(runtime.json().executionBackend, "playwright");
  assert.equal(runtime.json().assetsEnabled, false);
  assert.equal((await app.inject({ method: "GET", url: "/api/assets", headers: { host: "127.0.0.1:4317" } })).statusCode, 404);
});

test("identity-enabled runtime reports that the material center is disabled", async (t) => {
  const { app } = await identityApp(t);
  const auth = await activateAdmin(app);
  const runtime = await app.inject({ method: "GET", url: "/api/runtime", headers: authHeaders(auth) });
  assert.equal(runtime.statusCode, 200);
  assert.equal(runtime.json().assetsEnabled, false);
});

test("injected identity repository requires an explicit assets repository", async (t) => {
  await assert.rejects(identityApp(t, { assets: { enabled: true, objectStore: createMemoryObjectStore() } }), { code: "ASSET_REPOSITORY_REQUIRED_WITH_INJECTED_IDENTITY" });
});

test("controlled upload and completion restore server state without claiming available", async (t) => {
  const { app } = await assetWorld(t);
  const auth = await activateAdmin(app);
  const authorized = await authorize(app, auth);
  assert.equal(authorized.statusCode, 201);
  const created = authorized.json();
  assert.equal(created.asset.organization_id, "org_test");
  assert.match(created.upload.url, /^\/api\/assets\/uploads\//);
  assert.equal(JSON.stringify(created).includes("object_key"), false);

  const uploaded = await app.inject({
    method: "PUT", url: created.upload.url,
    headers: authHeaders(auth, true, "image/png"), payload: PNG
  });
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  const completed = await app.inject({
    method: "POST", url: "/api/assets/upload-completions", headers: authHeaders(auth, true),
    payload: { upload_session_id: created.upload_session_id, idempotency_key: "complete-api-1", organization_id: "forged_org" }
  });
  assert.equal(completed.statusCode, 202);
  assert.equal(completed.json().asset_version.status, "verifying");
  assert.equal(completed.body.includes("object_key"), false);

  const refreshed = await app.inject({ method: "GET", url: `/api/asset-versions/${created.asset_version.id}`, headers: authHeaders(auth) });
  assert.equal(refreshed.statusCode, 200);
  assert.equal(refreshed.json().asset_version.status, "verifying");
  assert.equal(refreshed.body.includes("object_key"), false);
  await app.assets.service.runNextVerificationJob();
  const available = await app.inject({ method: "GET", url: `/api/asset-versions/${created.asset_version.id}`, headers: authHeaders(auth) });
  assert.equal(available.json().asset_version.status, "available");
  const assets = await app.inject({ method: "GET", url: "/api/assets", headers: authHeaders(auth) });
  assert.equal(assets.body.includes("object_key"), false);
  const next = await authorize(app, auth, { asset_id: created.asset.id, filename: "product-v2.png" }, "asset-version-2");
  assert.equal(next.statusCode, 201);
  assert.equal(next.json().asset.id, created.asset.id);
  assert.equal(next.json().asset_version.version_number, 2);
});

test("completion replay is stable and conflicting idempotency returns 409", async (t) => {
  const { app } = await assetWorld(t);
  const auth = await activateAdmin(app);
  const first = (await authorize(app, auth)).json();
  await app.inject({ method: "PUT", url: first.upload.url, headers: authHeaders(auth, true, "image/png"), payload: PNG });
  const payload = { upload_session_id: first.upload_session_id, idempotency_key: "same-key" };
  const one = await app.inject({ method: "POST", url: "/api/assets/upload-completions", headers: authHeaders(auth, true), payload });
  const two = await app.inject({ method: "POST", url: "/api/assets/upload-completions", headers: authHeaders(auth, true), payload });
  assert.deepEqual(two.json(), one.json());
  const conflicting = await app.inject({ method: "POST", url: "/api/assets/upload-completions", headers: authHeaders(auth, true), payload: { ...payload, upload_session_id: "different" } });
  assert.equal(conflicting.statusCode, 409);
  assert.equal(conflicting.json().error, "IDEMPOTENCY_CONFLICT");
});

test("asset mutation exposes optimistic conflict and download authorization never exposes a permanent URL", async (t) => {
  const { app } = await assetWorld(t);
  const auth = await activateAdmin(app);
  const created = (await authorize(app, auth)).json();
  await app.inject({ method: "PUT", url: created.upload.url, headers: authHeaders(auth, true, "image/png"), payload: PNG });
  await app.inject({ method: "POST", url: "/api/assets/upload-completions", headers: authHeaders(auth, true), payload: { upload_session_id: created.upload_session_id, idempotency_key: "complete" } });
  await app.assets.service.runNextVerificationJob();
  const download = await app.inject({ method: "POST", url: `/api/asset-versions/${created.asset_version.id}/download-authorizations`, headers: authHeaders(auth, true), payload: {} });
  assert.equal(download.statusCode, 201);
  assert.match(download.json().download.url, /^\/api\/assets\/downloads\//);
  assert.equal(JSON.stringify(download.json()).includes("file://"), false);
  const downloaded = await app.inject({ method: "GET", url: download.json().download.url, headers: authHeaders(auth) });
  assert.equal(downloaded.statusCode, 200);
  assert.deepEqual(downloaded.rawPayload, PNG);

  const disabled = await app.inject({ method: "POST", url: `/api/assets/${created.asset.id}/disable`, headers: authHeaders(auth, true), payload: { expected_revision: 1 } });
  assert.equal(disabled.statusCode, 200);
  const conflict = await app.inject({ method: "DELETE", url: `/api/assets/${created.asset.id}`, headers: authHeaders(auth, true), payload: { expected_revision: 1 } });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error, "ASSET_VERSION_CONFLICT");
});
