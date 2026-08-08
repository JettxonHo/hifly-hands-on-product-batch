import assert from "node:assert/strict";
import test from "node:test";

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
});
