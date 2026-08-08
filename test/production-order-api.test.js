import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryProductionOrderRepository } from "../src/production-orders/memory-production-order-repository.js";
import { createMemoryVideoPlanningRepository } from "../src/video-planning/memory-video-planning-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { activateAdmin, identityApp, identityHeaders, login } from "./helpers/identity-world.js";

function productionOptions({ blocked = false } = {}) {
  return {
    enabled: true,
    repository: createMemoryProductionOrderRepository(),
    planPort: {
      async resolveCurrentApprovedPlan({ organizationId, productId, videoPlanVersionId }) {
        if (organizationId !== "org_test" || productId !== "product-a") return null;
        if (videoPlanVersionId && videoPlanVersionId !== "plan-a-v2") return null;
        return {
          current_valid: !blocked,
          gate: { can_create: !blocked, reasons: blocked ? ["plan_review_revoked"] : [] },
          plan: { id: "plan-a-v2", organization_id: "org_test", product_id: productId, version_number: 2, status: "frozen",
            output_instructions: "竖版商品种草口播", upstream_snapshot: { product_revision_id: "revision-a", copy_version_id: "copy-a",
              avatar_selection_id: "selection-a", avatar_asset_version_id: "avatar-a" },
            capability_config_snapshot: { snapshot_version: "capability-v1", verified_capabilities: [{ code: "speech", evidence_reference: "seed:speech" }] } },
          plan_review: { id: "review-a", status: "approved", reviewer_member_id: "member-reviewer" },
          preflight_result: { id: "preflight-a", status: "warning", groups: { production_readiness: { status: "warning", checks: [] } } }
        };
      }
    },
    inputSnapshotPort: { async freezeForOrder() {
      return { approved_copy_snapshot: { copy_version_id: "copy-a", product_revision_id: "revision-a", version_number: 1, status: "frozen", intent: "product_recommendation", body: "API 冻结文案正文", review: { id: "review-a", status: "approved" } },
        product_revision_snapshot: { id: "revision-a", organization_id: "org_test", project_id: "project-a", product_id: "product-a", status: "ready", revision_number: 1, product_name: "云朵抱枕", product_description: "日常使用", asset_version_ids: ["product-image-a"] },
        asset_references: [{ asset_id: "asset-a", asset_version_id: "product-image-a", role: "product_image", display_name: "商品图", media_type: "image/png", size: 5, checksum: "6105d6cc76af400325e94d588ce511be5bfdbb73b437dc51eca43917d7a43e3d", retrieval_mode: "embedded", access_scope: "organization", body: Buffer.from("image") }],
        avatar_selection_snapshot: { avatar_selection_id: "selection-a", copy_version_id: "copy-a", asset_version_id: "avatar-a", status: "confirmed", version_number: 1, avatar_asset_id: "avatar-asset-a", display_name: "人物甲", source_type: "enterprise", authorization_status: "valid", capability_status: "verified", capabilities: [{ code: "speech", evidence_reference: "seed:speech" }] } };
    } },
    agentReadinessPort: { async isOnline() { return false; } }
  };
}

function videoPlanningOptions() {
  return { enabled: true, repository: createMemoryVideoPlanningRepository(), worker: { autoStart: false },
    upstreamPort: { async resolveCurrent() { return null; } },
    capabilitySnapshotPort: { async resolve() { return null; } },
    agentReadinessPort: { async isOnline() { return false; } } };
}

test("production order API requires identity, creates an offline waiting order, and restores list/detail/workspace", async (t) => {
  const { app, repository } = await identityApp(t, { videoPlanning: videoPlanningOptions(), productionOrders: productionOptions() });
  const auth = await activateAdmin(app);
  const read = identityHeaders({ cookies: auth.cookies });
  const mutation = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });

  assert.equal((await app.inject({ method: "GET", url: "/api/products/product-a/production-workspace", headers: identityHeaders() })).statusCode, 401);
  const empty = await app.inject({ method: "GET", url: "/api/products/product-a/production-workspace", headers: read });
  assert.equal(empty.statusCode, 200);
  assert.deepEqual(empty.json().orders, []);
  assert.equal(empty.json().gate.can_create, true);
  assert.equal(empty.json().execution_environment.online, false);
  assert.equal(empty.json().execution_environment.blocks_manual_creation, false);

  const created = await app.inject({ method: "POST", url: "/api/products/product-a/production-orders",
    headers: { ...mutation, "idempotency-key": "api-order-create" },
    payload: { video_plan_version_id: "plan-a-v2", execution_purpose: "first_production" } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().order.status, "waiting_for_executor");
  assert.equal(created.json().order.execution_purpose, "first_production");
  assert.equal("organization_id" in created.json().order, false);
  assert.equal(created.json().execution_environment.online, false);

  const replay = await app.inject({ method: "POST", url: "/api/products/product-a/production-orders",
    headers: { ...mutation, "idempotency-key": "api-order-create" },
    payload: { video_plan_version_id: "plan-a-v2", execution_purpose: "first_production" } });
  assert.equal(replay.statusCode, 201);
  assert.equal(replay.json().order.id, created.json().order.id);
  assert.equal(replay.json().replayed, true);

  const conflict = await app.inject({ method: "POST", url: "/api/products/product-a/production-orders",
    headers: { ...mutation, "idempotency-key": "api-order-create" },
    payload: { video_plan_version_id: "plan-a-v2", execution_purpose: "rework" } });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error, "IDEMPOTENCY_CONFLICT");

  const list = await app.inject({ method: "GET", url: "/api/products/product-a/production-orders", headers: read });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().orders.length, 1);
  const detail = await app.inject({ method: "GET", url: `/api/production-orders/${created.json().order.id}`, headers: read });
  assert.equal(detail.statusCode, 200);
  assert.equal(detail.json().order.id, created.json().order.id);

  const workspace = await app.inject({ method: "GET", url: `/api/products/product-a/production-workspace?orderId=${created.json().order.id}`, headers: read });
  assert.equal(workspace.statusCode, 200);
  assert.equal(workspace.json().selected_order.id, created.json().order.id);
  assert.equal(workspace.json().current_plan.id, "plan-a-v2");
  assert.equal("organization_id" in workspace.json().current_plan, false);

  const memberCreated = (await app.inject({ method: "POST", url: "/api/identity/members", headers: mutation,
    payload: { email: "production-member@example.test", display_name: "Production Member", role: "member" } })).json();
  const memberAuth = await login(app, { email: "production-member@example.test", password: memberCreated.temporary_password });
  await app.inject({ method: "POST", url: "/api/auth/change-password",
    headers: identityHeaders({ cookies: memberAuth.cookies, csrf: memberAuth.csrf, mutation: true }), payload: { new_password: "Production-Member-9!" } });
  const memberMutation = identityHeaders({ cookies: memberAuth.cookies, csrf: memberAuth.csrf, mutation: true });
  const memberCreatedOrder = await app.inject({ method: "POST", url: "/api/products/product-a/production-orders",
    headers: { ...memberMutation, "idempotency-key": "member-order-create" }, payload: { video_plan_version_id: "plan-a-v2", execution_purpose: "reproduction" } });
  assert.equal(memberCreatedOrder.statusCode, 201);

  await seedInitialAdmin(repository, { organizationId: "org_other", organizationName: "Other Organization",
    adminEmail: "other-production-admin@example.test", adminDisplayName: "Other Admin", adminTempPassword: "Other-Production-Temp-9!" });
  const otherAuth = await login(app, { email: "other-production-admin@example.test", password: "Other-Production-Temp-9!" });
  await app.inject({ method: "POST", url: "/api/auth/change-password",
    headers: identityHeaders({ cookies: otherAuth.cookies, csrf: otherAuth.csrf, mutation: true }), payload: { new_password: "Other-Production-Password-9!" } });
  const foreignDetail = await app.inject({ method: "GET", url: `/api/production-orders/${created.json().order.id}`,
    headers: identityHeaders({ cookies: otherAuth.cookies }) });
  assert.equal(foreignDetail.statusCode, 404);
});

test("production order API returns gate failure and not-found without leaking cross-scope data", async (t) => {
  const { app } = await identityApp(t, { videoPlanning: videoPlanningOptions(), productionOrders: productionOptions({ blocked: true }) });
  const auth = await activateAdmin(app);
  const mutation = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  const blocked = await app.inject({ method: "POST", url: "/api/products/product-a/production-orders",
    headers: { ...mutation, "idempotency-key": "blocked-order" },
    payload: { video_plan_version_id: "plan-a-v2", execution_purpose: "rework" } });
  assert.equal(blocked.statusCode, 422);
  assert.deepEqual(blocked.json().reasons, ["plan_review_revoked"]);

  const missing = await app.inject({ method: "GET", url: "/api/production-orders/not-an-order", headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(missing.statusCode, 404);
  assert.equal(missing.json().error, "PRODUCTION_ORDER_NOT_FOUND");

  const invalidPurpose = await app.inject({ method: "POST", url: "/api/products/product-a/production-orders",
    headers: { ...mutation, "idempotency-key": "invalid-purpose" },
    payload: { video_plan_version_id: "plan-a-v2", execution_purpose: "automatic_dispatch" } });
  assert.equal(invalidPurpose.statusCode, 400);
  assert.equal(invalidPurpose.json().error, "PRODUCTION_ORDER_PURPOSE_INVALID");
});

test("production orders remain feature-off by default and do not register routes", async (t) => {
  const { app } = await identityApp(t);
  const auth = await activateAdmin(app);
  const runtime = await app.inject({ method: "GET", url: "/api/runtime", headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(runtime.statusCode, 200);
  assert.equal(runtime.json().productionOrdersEnabled, false);
  const route = await app.inject({ method: "GET", url: "/api/products/product-a/production-workspace", headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(route.statusCode, 404);
});
