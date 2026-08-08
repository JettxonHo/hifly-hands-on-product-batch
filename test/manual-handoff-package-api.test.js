import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryManualHandoffPackageStore } from "../src/manual-handoff/manual-handoff-package-store.js";
import { createMemoryManualHandoffRepository } from "../src/manual-handoff/memory-manual-handoff-repository.js";
import { createMemoryProductionOrderRepository } from "../src/production-orders/memory-production-order-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { activateAdmin, identityApp, identityHeaders, login } from "./helpers/identity-world.js";

function videoPlanningOptions() {
  return { enabled: true, repository: { async initialize() {}, async close() {} }, worker: { autoStart: false },
    upstreamPort: { async resolveCurrent() { return null; } }, capabilitySnapshotPort: { async resolve() { return null; } },
    agentReadinessPort: { async isOnline() { return false; } } };
}

function productionOptions() {
  return {
    enabled: true, repository: { async initialize() {}, async close() {}, async getReceipt() { return null; }, async createOrder({ order }) { return { order, replayed: false }; }, async listOrders() { return []; }, async getOrder() { return null; } },
    inputSnapshotPort: { async freezeForOrder() {
      return { approved_copy_snapshot: { copy_version_id: "copy-a", product_revision_id: "revision-a", version_number: 1, status: "frozen", intent: "product_recommendation", body: "API 链路冻结文案正文", review: { id: "review-a", status: "approved" } },
        product_revision_snapshot: { id: "revision-a", organization_id: "org_test", project_id: "project-a", product_id: "product-a", status: "ready", revision_number: 1, product_name: "云感保湿乳", product_description: "日常保湿", asset_version_ids: ["product-image-a"] },
        asset_references: [{ asset_id: "asset-a", asset_version_id: "product-image-a", role: "product_image", display_name: "商品图", media_type: "image/png", size: 5, checksum: "6105d6cc76af400325e94d588ce511be5bfdbb73b437dc51eca43917d7a43e3d", retrieval_mode: "embedded", access_scope: "organization", body: Buffer.from("image") }],
        avatar_selection_snapshot: { avatar_selection_id: "selection-a", copy_version_id: "copy-a", asset_version_id: "avatar-a", status: "confirmed", version_number: 1, avatar_asset_id: "avatar-asset-a", display_name: "人物甲", source_type: "enterprise", authorization_status: "valid", capability_status: "verified", capabilities: [{ code: "speech", evidence_reference: "seed:speech" }] } };
    } },
    planPort: { async resolveCurrentApprovedPlan({ organizationId, productId }) {
      if (organizationId !== "org_test" || productId !== "product-a") return null;
      return { current_valid: true, gate: { can_create: true, reasons: [] },
        plan: { id: "plan-a", organization_id: organizationId, product_id: productId, version_number: 2, status: "frozen",
          output_instructions: "竖版商品种草口播", upstream_snapshot: { product_revision_id: "revision-a", copy_version_id: "copy-a", avatar_selection_id: "selection-a", avatar_asset_version_id: "avatar-a" }, capability_config_snapshot: { snapshot_version: "capability-a" } },
        plan_review: { id: "review-a", status: "approved" }, preflight_result: { id: "preflight-a", status: "warning" } };
    } }, agentReadinessPort: { async isOnline() { return false; } }
  };
}

test("manual handoff API generates, authorizes, downloads, and preserves order state without exposing secrets", async (t) => {
  const production = productionOptions();
  production.repository = createMemoryProductionOrderRepository();
  const { app } = await identityApp(t, {
    videoPlanning: videoPlanningOptions(), productionOrders: production,
    manualHandoff: { enabled: true, repository: createMemoryManualHandoffRepository(), packageStore: createMemoryManualHandoffPackageStore(), worker: { autoStart: false } }
  });
  const auth = await activateAdmin(app);
  const read = identityHeaders({ cookies: auth.cookies });
  const mutation = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  const order = await app.productionOrders.service.createProductionOrder({ organizationId: "org_test", actorMemberId: auth.body.member.id, actorRole: "admin", productId: "product-a", executionPurpose: "first_production", videoPlanVersionId: "plan-a", idempotencyKey: "order-a" });
  const anonymous = await app.inject({ method: "GET", url: "/api/production-orders/not-an-order/manual-handoff-packages", headers: identityHeaders() });
  assert.equal(anonymous.statusCode, 401);
  assert.equal((await app.inject({ method: "GET", url: "/api/runtime", headers: read })).json().manualHandoffEnabled, true);
  const generation = await app.inject({ method: "POST", url: `/api/production-orders/${order.order.id}/manual-handoff-packages`, headers: { ...mutation, "idempotency-key": "api-generation" }, payload: { generation_request_id: "api-generation" } });
  assert.equal(generation.statusCode, 202);
  assert.equal(generation.json().package.status, "generating");
  assert.equal("token" in generation.json(), false);
  const replay = await app.inject({ method: "POST", url: `/api/production-orders/${order.order.id}/manual-handoff-packages`, headers: { ...mutation, "idempotency-key": "api-generation" }, payload: { generation_request_id: "api-generation" } });
  assert.equal(replay.json().package.package_id, generation.json().package.package_id);
  await app.manualHandoff.worker.runNext();
  const listed = await app.inject({ method: "GET", url: `/api/production-orders/${order.order.id}/manual-handoff-packages`, headers: read });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().packages[0].status, "ready");
  assert.equal("organization_id" in listed.json().packages[0], false);
  assert.equal(JSON.stringify(listed.json()).includes("storage_key"), false);
  const authorized = await app.inject({ method: "POST", url: `/api/manual-handoff-packages/${order.order.id}/download-authorizations`, headers: mutation, payload: {} });
  assert.equal(authorized.statusCode, 404);
  const packageId = listed.json().packages[0].package_id;
  const grant = await app.inject({ method: "POST", url: `/api/manual-handoff-packages/${packageId}/download-authorizations`, headers: mutation, payload: {} });
  assert.equal(grant.statusCode, 201);
  assert.equal("token" in grant.json().download, false);
  assert.equal("url" in grant.json().download, false);
  const downloadCookies = [auth.cookies, grant.headers["set-cookie"]?.split(";", 1)[0]].filter(Boolean).join("; ");
  const downloaded = await app.inject({ method: "GET", url: `/api/manual-handoff-packages/${packageId}/download`, headers: identityHeaders({ cookies: downloadCookies }) });
  assert.equal(downloaded.statusCode, 200);
  assert.equal(downloaded.rawPayload.subarray(0, 2).toString(), "PK");
  const orderAfter = await app.productionOrders.service.getOrder({ organizationId: "org_test", actorMemberId: auth.body.member.id, actorRole: "admin", orderId: order.order.id });
  assert.equal(orderAfter.status, "waiting_for_executor");
  assert.equal((await app.inject({ method: "GET", url: `/api/production-orders/not-an-order/manual-handoff-packages`, headers: read })).statusCode, 404);
});

test("manual handoff feature remains conservatively disabled by default", async (t) => {
  const { app } = await identityApp(t);
  const auth = await activateAdmin(app);
  const runtime = await app.inject({ method: "GET", url: "/api/runtime", headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(runtime.statusCode, 200);
  assert.equal(runtime.json().manualHandoffEnabled, false);
  assert.equal((await app.inject({ method: "GET", url: "/api/production-orders/order/manual-handoff-packages", headers: identityHeaders({ cookies: auth.cookies }) })).statusCode, 404);
});

test("a foreign organization cannot inspect a manual handoff package", async (t) => {
  const identityRepository = await (await import("./helpers/identity-world.js")).seededRepository();
  await seedInitialAdmin(identityRepository, { organizationId: "org-other", organizationName: "Other", adminEmail: "other-manual@example.test", adminDisplayName: "Other", adminTempPassword: "Other-Manual-Temp-9!" });
  const { app } = await identityApp(t, { repository: identityRepository, seed: false });
  const other = await login(app, { email: "other-manual@example.test", password: "Other-Manual-Temp-9!" });
  await app.inject({ method: "POST", url: "/api/auth/change-password", headers: identityHeaders({ cookies: other.cookies, csrf: other.csrf, mutation: true }), payload: { new_password: "Other-Manual-Password-9!" } });
  const response = await app.inject({ method: "GET", url: "/api/production-orders/foreign/manual-handoff-packages", headers: identityHeaders({ cookies: other.cookies }) });
  assert.equal(response.statusCode, 404);
});
