import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryProductionOrderRepository } from "../src/production-orders/memory-production-order-repository.js";
import { createMemoryVideoPlanningRepository } from "../src/video-planning/memory-video-planning-repository.js";
import { activateAdmin, identityApp, identityHeaders } from "./helpers/identity-world.js";

function options({ agentOnline = false } = {}) {
  return { enabled: true, repository: createMemoryVideoPlanningRepository(), worker: { autoStart: false },
    upstreamPort: { async resolveCurrent({ organizationId, productId }) {
      if (organizationId !== "org_test" || !["product-a", "product-b"].includes(productId)) return null;
      return { product_revision_id: `revision-${productId.at(-1)}`, copy_version_id: `copy-${productId.at(-1)}`,
        avatar_selection_id: `selection-${productId.at(-1)}`, avatar_asset_version_id: `avatar-${productId.at(-1)}`,
        current_valid: true };
    } },
    capabilitySnapshotPort: { async resolve() { return { snapshot_version: "verified-v1",
      verified_capabilities: [{ code: "mandarin_speech", evidence_reference: "evidence:controlled" }] }; } },
    agentReadinessPort: { async isOnline() { return agentOnline; } } };
}

function productionOptions() {
  return { enabled: true, repository: createMemoryProductionOrderRepository(),
    planPort: { async resolveCurrentApprovedPlan() { return null; } },
    inputSnapshotPort: { async freezeForOrder() { return { approved_copy_snapshot: { copy_version_id: "copy", product_revision_id: "revision", version_number: 1, status: "frozen", body: "copy", review: { id: "review", status: "approved" } }, product_revision_snapshot: { id: "revision", product_id: "product-a", status: "ready", product_name: "商品", asset_version_ids: ["asset"] }, asset_references: [{ asset_id: "asset", asset_version_id: "asset", role: "product_image", media_type: "image/png", size: 5, checksum: "6105d6cc76af400325e94d588ce511be5bfdbb73b437dc51eca43917d7a43e3d", retrieval_mode: "embedded", body: Buffer.from("image") }], avatar_selection_snapshot: { avatar_selection_id: "selection", copy_version_id: "copy", asset_version_id: "avatar", status: "confirmed", avatar_asset_id: "avatar", display_name: "人物", source_type: "enterprise", authorization_status: "valid", capability_status: "verified", capabilities: [{ code: "speech", evidence_reference: "seed:speech" }] } }; } },
    agentReadinessPort: { async isOnline() { return false; } } };
}

test("video planning API preserves passed vs approved and restores state", async (t) => {
  const videoPlanning = options();
  const { app } = await identityApp(t, { videoPlanning });
  const auth = await activateAdmin(app);
  const mutation = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  const read = identityHeaders({ cookies: auth.cookies });

  assert.equal((await app.inject({ method: "GET", url: "/api/products/product-a/video-plan-workspace",
    headers: identityHeaders() })).statusCode, 401);
  const empty = await app.inject({ method: "GET", url: "/api/products/product-a/video-plan-workspace", headers: read });
  assert.equal(empty.statusCode, 200);
  assert.equal(empty.json().current_plan, null);

  const created = await app.inject({ method: "POST", url: "/api/products/product-a/video-plans",
    headers: { ...mutation, "idempotency-key": "api-create-plan" },
    payload: { output_instructions: "竖版种草口播，突出核心卖点。", expected_head_revision: 0 } });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().current_plan.status, "draft");
  assert.equal(created.json().current_plan.presentation_size_code, "smart_fit");
  assert.equal("organization_id" in created.json().current_plan, false);

  const preflight = await app.inject({ method: "POST", url: `/api/products/product-a/video-plans/${created.json().current_plan.id}/preflight`,
    headers: { ...mutation, "idempotency-key": "api-preflight" },
    payload: { expected_revision: created.json().current_plan.row_version } });
  assert.equal(preflight.statusCode, 202);
  await app.videoPlanning.worker.runNext();
  const restored = (await app.inject({ method: "GET", url: "/api/products/product-a/video-plan-workspace", headers: read })).json();
  assert.equal(restored.preflight.current_run.status, "succeeded");
  assert.equal(restored.preflight.current_result.status, "warning");
  assert.equal("lease_token" in restored.preflight.current_run, false);
  assert.equal(restored.review.current_review, null);

  const submitted = await app.inject({ method: "POST", url: `/api/products/product-a/video-plans/${created.json().current_plan.id}/reviews`,
    headers: { ...mutation, "idempotency-key": "api-submit-review" }, payload: {} });
  assert.equal(submitted.statusCode, 201);
  assert.equal(submitted.json().review.current_review.status, "pending");
  assert.equal(submitted.json().preflight.current_result.status, "warning");
  const approved = await app.inject({ method: "POST", url: `/api/products/product-a/plan-reviews/${submitted.json().review.current_review.id}/approve`,
    headers: { ...mutation, "idempotency-key": "api-approve-review" }, payload: { expected_revision: 1 } });
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.json().review.current_review.status, "approved");
  assert.equal(approved.json().production_order_available, false);
  assert.match(approved.json().production_order_notice, /尚未开放/);
});

test("video planning API projects enabled production availability and rejects historical plan entry", async (t) => {
  const { app } = await identityApp(t, { videoPlanning: options(), productionOrders: productionOptions() });
  const auth = await activateAdmin(app);
  const mutation = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  const read = identityHeaders({ cookies: auth.cookies });
  const created = await app.inject({ method: "POST", url: "/api/products/product-a/video-plans",
    headers: { ...mutation, "idempotency-key": "api-production-plan" },
    payload: { output_instructions: "竖版种草口播，突出核心卖点。", expected_head_revision: 0 } });
  const planId = created.json().current_plan.id;
  const preflight = await app.inject({ method: "POST", url: `/api/products/product-a/video-plans/${planId}/preflight`,
    headers: { ...mutation, "idempotency-key": "api-production-preflight" },
    payload: { expected_revision: created.json().current_plan.row_version } });
  await app.videoPlanning.worker.runNext();
  assert.equal(preflight.statusCode, 202);
  const submitted = await app.inject({ method: "POST", url: `/api/products/product-a/video-plans/${planId}/reviews`,
    headers: { ...mutation, "idempotency-key": "api-production-submit" }, payload: {} });
  const approved = await app.inject({ method: "POST", url: `/api/products/product-a/plan-reviews/${submitted.json().review.current_review.id}/approve`,
    headers: { ...mutation, "idempotency-key": "api-production-approve" }, payload: { expected_revision: 1 } });
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.json().production_order_available, true);
  assert.equal(approved.json().production_order_notice, "当前方案已批准，可以进入生产工单。");

  const derived = await app.inject({ method: "POST", url: `/api/products/product-a/video-plans/${planId}/derive`,
    headers: { ...mutation, "idempotency-key": "api-production-derive" },
    payload: { output_instructions: "基于当前方案创建新版本", expected_head_revision: approved.json().head_revision } });
  assert.equal(derived.statusCode, 201);
  const historical = await app.inject({ method: "GET", url: `/api/products/product-a/video-plan-workspace?planVersionId=${planId}`, headers: read });
  assert.equal(historical.statusCode, 200);
  assert.equal(historical.json().production_order_available, false);
  assert.equal(historical.json().production_order_notice, "当前方案尚未满足生产工单创建条件。");
});

test("video planning API maps conflict, gate and cross-organization errors", async (t) => {
  const { app } = await identityApp(t, { videoPlanning: options({ agentOnline: true }) });
  const auth = await activateAdmin(app);
  const headers = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  const created = (await app.inject({ method: "POST", url: "/api/products/product-a/video-plans",
    headers: { ...headers, "idempotency-key": "conflict-create" },
    payload: { output_instructions: "一条完整制作说明", expected_head_revision: 0 } })).json();
  const stale = await app.inject({ method: "PATCH", url: `/api/products/product-a/video-plans/${created.current_plan.id}`,
    headers, payload: { output_instructions: "他人更新", expected_revision: 0 } });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error, "VIDEO_PLAN_CONFLICT");

  const conflictReplay = await app.inject({ method: "POST", url: "/api/products/product-a/video-plans",
    headers: { ...headers, "idempotency-key": "conflict-create" },
    payload: { output_instructions: "冲突内容", expected_head_revision: 0 } });
  assert.equal(conflictReplay.statusCode, 409);
  assert.equal(conflictReplay.json().error, "IDEMPOTENCY_CONFLICT");

  const cross = await app.inject({ method: "GET",
    url: `/api/products/product-b/video-plan-workspace?planVersionId=${created.current_plan.id}`,
    headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(cross.statusCode, 404);
  assert.equal(cross.json().error, "VIDEO_PLAN_NOT_FOUND");

  const invalidSize = await app.inject({ method: "POST", url: "/api/products/product-b/video-plans",
    headers: { ...headers, "idempotency-key": "invalid-presentation-size" },
    payload: { output_instructions: "完整制作说明", presentation_size_code: "second-button", expected_head_revision: 0 } });
  assert.equal(invalidSize.statusCode, 400);
  assert.equal(invalidSize.json().error, "VIDEO_PLAN_PRESENTATION_SIZE_UNSUPPORTED");
});

test("video planning API rejects a stale review decision after the exact plan head changes", async (t) => {
  const { app } = await identityApp(t, { videoPlanning: options({ agentOnline: true }) });
  const auth = await activateAdmin(app);
  const mutation = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  const read = identityHeaders({ cookies: auth.cookies });
  const created = (await app.inject({ method: "POST", url: "/api/products/product-a/video-plans",
    headers: { ...mutation, "idempotency-key": "stale-review-create" },
    payload: { output_instructions: "首版方案", expected_head_revision: 0 } })).json();
  await app.inject({ method: "POST", url: `/api/products/product-a/video-plans/${created.current_plan.id}/preflight`,
    headers: { ...mutation, "idempotency-key": "stale-review-preflight" },
    payload: { expected_revision: created.current_plan.row_version } });
  await app.videoPlanning.worker.runNext();
  const submitted = (await app.inject({ method: "POST",
    url: `/api/products/product-a/video-plans/${created.current_plan.id}/reviews`,
    headers: { ...mutation, "idempotency-key": "stale-review-submit" }, payload: {} })).json();
  const derived = await app.inject({ method: "POST",
    url: `/api/products/product-a/video-plans/${created.current_plan.id}/derive`,
    headers: { ...mutation, "idempotency-key": "stale-review-derive" },
    payload: { output_instructions: "并发后的新方案", expected_head_revision: submitted.head_revision } });
  assert.equal(derived.statusCode, 201);

  const approval = await app.inject({ method: "POST",
    url: `/api/products/product-a/plan-reviews/${submitted.review.current_review.id}/approve`,
    headers: { ...mutation, "idempotency-key": "stale-review-approve" }, payload: { expected_revision: 1 } });
  assert.equal(approval.statusCode, 409);
  assert.deepEqual(approval.json(), { error: "VIDEO_PLAN_REVIEW_CONFLICT" });
  const historical = (await app.inject({ method: "GET",
    url: `/api/products/product-a/video-plan-workspace?planVersionId=${created.current_plan.id}`, headers: read })).json();
  assert.equal(historical.current_plan.status, "superseded");
  assert.equal(historical.review.current_review.status, "pending");
});

test("video planning API binds both review decisions to the URL product with zero wrong-product writes", async (t) => {
  const videoPlanning = options({ agentOnline: true });
  const { app } = await identityApp(t, { videoPlanning });
  const auth = await activateAdmin(app);
  const mutation = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  const created = (await app.inject({ method: "POST", url: "/api/products/product-a/video-plans",
    headers: { ...mutation, "idempotency-key": "wrong-product-create" },
    payload: { output_instructions: "严格绑定商品的方案", expected_head_revision: 0 } })).json();
  await app.inject({ method: "POST", url: `/api/products/product-a/video-plans/${created.current_plan.id}/preflight`,
    headers: { ...mutation, "idempotency-key": "wrong-product-preflight" },
    payload: { expected_revision: created.current_plan.row_version } });
  await app.videoPlanning.worker.runNext();
  const submitted = (await app.inject({ method: "POST",
    url: `/api/products/product-a/video-plans/${created.current_plan.id}/reviews`,
    headers: { ...mutation, "idempotency-key": "wrong-product-submit" }, payload: {} })).json();
  const reviewId = submitted.review.current_review.id;
  const beforeReview = await videoPlanning.repository.getReview("org_test", reviewId);
  const beforeEvents = await videoPlanning.repository.listReviewEvents();
  const beforeAudits = await videoPlanning.repository.listAuditEvents();

  const approve = await app.inject({ method: "POST", url: `/api/products/product-b/plan-reviews/${reviewId}/approve`,
    headers: { ...mutation, "idempotency-key": "wrong-product-approve" }, payload: { expected_revision: 1 } });
  assert.equal(approve.statusCode, 404);
  assert.deepEqual(approve.json(), { error: "VIDEO_PLAN_REVIEW_NOT_FOUND" });
  const changes = await app.inject({ method: "POST", url: `/api/products/product-b/plan-reviews/${reviewId}/request-changes`,
    headers: { ...mutation, "idempotency-key": "wrong-product-changes" },
    payload: { expected_revision: 1, reason: "不应写入" } });
  assert.equal(changes.statusCode, 404);
  assert.deepEqual(changes.json(), { error: "VIDEO_PLAN_REVIEW_NOT_FOUND" });
  assert.deepEqual(await videoPlanning.repository.getReview("org_test", reviewId), beforeReview);
  assert.deepEqual(await videoPlanning.repository.listReviewEvents(), beforeEvents);
  assert.deepEqual(await videoPlanning.repository.listAuditEvents(), beforeAudits);
});
