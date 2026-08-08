import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryProductionOrderRepository } from "../src/production-orders/memory-production-order-repository.js";
import { createProductionOrderService } from "../src/production-orders/production-order-service.js";

const actor = {
  organizationId: "org-a",
  actorMemberId: "member-a",
  actorRole: "member",
  productId: "product-a"
};

function approvedPlan(overrides = {}) {
  return {
    current_valid: true,
    plan: {
      id: "plan-a-v2",
      organization_id: actor.organizationId,
      product_id: actor.productId,
      version_number: 2,
      status: "frozen",
      row_version: 3,
      output_instructions: "竖版商品种草口播，先展示使用场景。",
      upstream_snapshot: {
        product_revision_id: "revision-a-v4",
        copy_version_id: "copy-a-v3",
        avatar_selection_id: "selection-a-v2",
        avatar_asset_version_id: "avatar-version-a-v2"
      },
      capability_config_snapshot: {
        snapshot_version: "capability-v2",
        verified_capabilities: [{ code: "mandarin_speech", evidence_reference: "seed:speech-v2" }]
      },
      created_at: "2026-08-08T08:00:00.000Z",
      updated_at: "2026-08-08T08:05:00.000Z"
    },
    plan_review: {
      id: "review-a-v2",
      status: "approved",
      reviewer_member_id: "reviewer-a",
      decision_reason: "方案完整",
      updated_at: "2026-08-08T08:10:00.000Z"
    },
    preflight_result: {
      id: "preflight-result-a-v2",
      status: "warning",
      groups: { production_readiness: { status: "warning", checks: [{ code: "local_agent_offline" }] } }
    },
    ...overrides
  };
}

function frozenInputSnapshot() {
  return {
    approved_copy_snapshot: {
      copy_version_id: "copy-a-v3",
      product_revision_id: "revision-a-v4",
      version_number: 3,
      status: "frozen",
      intent: "product_recommendation",
      body: "真实冻结文案：先展示使用场景，再说明保湿体验。",
      frozen_at: "2026-08-08T08:06:00.000Z",
      review: {
        id: "review-a-v2",
        status: "approved",
        quality_result_id: "quality-a-v2",
        profile_version: "commerce-cn-v1",
        rule_version: "rules-2026-08",
        reviewer_member_id: "reviewer-a",
        decision_reason: "方案完整",
        decided_at: "2026-08-08T08:10:00.000Z"
      }
    },
    product_revision_snapshot: {
      id: "revision-a-v4",
      organization_id: actor.organizationId,
      project_id: "project-a",
      product_id: actor.productId,
      status: "ready",
      revision_number: 4,
      product_name: "云感保湿乳",
      product_description: "日常保湿护理",
      primary_category: "beauty",
      content_brief: { expression_style: "自然口语" },
      selling_points: [{ id: "point-a", text: "清爽不黏", confirmed: true }],
      asset_version_ids: ["product-asset-version-a"],
      ready_at: "2026-08-08T08:02:00.000Z"
    },
    asset_references: [{
      asset_id: "product-asset-a",
      asset_version_id: "product-asset-version-a",
      role: "product_image",
      display_name: "商品主图",
      media_type: "image/png",
      size: 5,
      checksum: "6105d6cc76af400325e94d588ce511be5bfdbb73b437dc51eca43917d7a43e3d",
      retrieval_mode: "embedded",
      access_scope: "organization",
      body: Buffer.from("image")
    }],
    avatar_selection_snapshot: {
      avatar_selection_id: "selection-a-v2",
      copy_version_id: "copy-a-v3",
      asset_version_id: "avatar-version-a-v2",
      status: "confirmed",
      version_number: 2,
      confirmed_at: "2026-08-08T08:04:00.000Z",
      avatar_asset_id: "avatar-a",
      display_name: "林小满",
      source_type: "enterprise",
      authorization_status: "valid",
      authorization_expires_at: "2027-12-31T15:59:59.000Z",
      authorization_scope: "current_organization",
      capability_status: "verified",
      materials_accessible: true,
      capabilities: [{ code: "mandarin_speech", evidence_reference: "seed:speech-v2" }]
    }
  };
}

function world({ plan = approvedPlan(), agentOnline = false } = {}) {
  const repository = createMemoryProductionOrderRepository();
  const service = createProductionOrderService({
    repository,
    planPort: { async resolveCurrentApprovedPlan() { return structuredClone(plan); } },
    inputSnapshotPort: { async freezeForOrder() { return structuredClone(frozenInputSnapshot()); } },
    agentReadinessPort: { async isOnline() { return agentOnline; } },
    now: () => Date.parse("2026-08-08T09:00:00.000Z")
  });
  return { repository, service };
}

test("creates a purpose-bound immutable snapshot and completes draft-ready-waiting chain", async () => {
  const { repository, service } = world();
  const result = await service.createProductionOrder({ ...actor, executionPurpose: "first_production", idempotencyKey: "create-one" });

  assert.equal(result.order.status, "waiting_for_executor");
  assert.equal(result.order.execution_purpose, "first_production");
  assert.equal(result.order.input_snapshot.video_plan_version.id, "plan-a-v2");
  assert.equal(result.order.input_snapshot.plan_review.status, "approved");
  assert.equal(result.order.input_snapshot.upstream_snapshot.copy_version_id, "copy-a-v3");
  assert.equal(result.order.input_snapshot.capability_config_snapshot.snapshot_version, "capability-v2");
  assert.equal(result.order.input_snapshot.approved_copy_snapshot.body, "真实冻结文案：先展示使用场景，再说明保湿体验。");
  assert.equal(result.order.input_snapshot.approved_copy_snapshot.review.status, "approved");
  assert.equal(result.order.input_snapshot.product_revision_snapshot.product_name, "云感保湿乳");
  assert.deepEqual(result.order.input_snapshot.product_revision_snapshot.asset_version_ids, ["product-asset-version-a"]);
  assert.equal(result.order.input_snapshot.asset_references[0].asset_version_id, "product-asset-version-a");
  assert.equal(result.order.input_snapshot.avatar_selection_snapshot.display_name, "林小满");
  assert.equal(result.order.input_snapshot.avatar_selection_snapshot.authorization_status, "valid");
  assert.equal(result.order.input_snapshot.avatar_selection_snapshot.capabilities[0].code, "mandarin_speech");

  const events = await repository.listAuditEvents();
  assert.deepEqual(events.map((event) => event.event_type), [
    "production_order.created",
    "production_order.ready",
    "production_order.waiting_for_executor"
  ]);
  const outbox = await repository.listOutboxEvents();
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].event_type, "production_order.created");
  assert.deepEqual(outbox[0].payload.status_chain, ["draft", "ready", "waiting_for_executor"]);
});

test("rejects unsupported purpose values before writing a production order", async () => {
  const { repository, service } = world();
  await assert.rejects(service.createProductionOrder({ ...actor, executionPurpose: "video_now", idempotencyKey: "bad-purpose" }), {
    code: "PRODUCTION_ORDER_PURPOSE_INVALID"
  });
  assert.deepEqual(await repository.listOrders(actor.organizationId, actor.productId), []);
});

test("re-verifies the approved plan gate and does not trust a client plan snapshot", async () => {
  const blocked = approvedPlan({ current_valid: false, gate_reasons: ["plan_review_revoked", "preflight_invalidated"] });
  const { repository, service } = world({ plan: blocked });
  await assert.rejects(service.createProductionOrder({ ...actor, executionPurpose: "rework", idempotencyKey: "blocked" }), {
    code: "PRODUCTION_ORDER_PLAN_GATE_BLOCKED",
    details: ["plan_review_revoked", "preflight_invalidated"]
  });
  assert.deepEqual(await repository.listOrders(actor.organizationId, actor.productId), []);
});

test("Local Agent offline is an amber projection and never blocks manual order creation", async () => {
  const { service } = world({ agentOnline: false });
  const workspace = await service.getWorkspace(actor);
  assert.equal(workspace.execution_environment.online, false);
  assert.equal(workspace.execution_environment.blocks_manual_creation, false);
  const result = await service.createProductionOrder({ ...actor, executionPurpose: "supplemental_version", idempotencyKey: "offline" });
  assert.equal(result.order.status, "waiting_for_executor");
  assert.equal(result.execution_environment.online, false);
});

test("same idempotency key replays the original order, conflicting payload is rejected, and a new key creates a new order", async () => {
  const { service } = world();
  const first = await service.createProductionOrder({ ...actor, executionPurpose: "reproduction", idempotencyKey: "same-key" });
  const replay = await service.createProductionOrder({ ...actor, executionPurpose: "reproduction", idempotencyKey: "same-key" });
  assert.equal(replay.replayed, true);
  assert.equal(replay.order.id, first.order.id);
  await assert.rejects(service.createProductionOrder({ ...actor, executionPurpose: "rework", idempotencyKey: "same-key" }), {
    code: "IDEMPOTENCY_CONFLICT"
  });
  const second = await service.createProductionOrder({ ...actor, executionPurpose: "reproduction", idempotencyKey: "new-intent" });
  assert.notEqual(second.order.id, first.order.id);
});

test("list, detail, and workspace preserve older orders with their real status", async () => {
  const { service } = world();
  const first = await service.createProductionOrder({ ...actor, executionPurpose: "first_production", idempotencyKey: "first" });
  const second = await service.createProductionOrder({ ...actor, executionPurpose: "rework", idempotencyKey: "second" });
  const listed = await service.listOrders(actor);
  assert.deepEqual(listed.map((order) => order.id), [first.order.id, second.order.id]);
  assert.ok(listed.every((order) => order.status === "waiting_for_executor"));
  assert.equal((await service.getOrder({ ...actor, orderId: first.order.id })).id, first.order.id);
  const workspace = await service.getWorkspace({ ...actor, orderId: second.order.id });
  assert.equal(workspace.selected_order.id, second.order.id);
  assert.equal(workspace.orders.length, 2);
});

test("cross-organization order reads are not exposed", async () => {
  const { service } = world();
  const created = await service.createProductionOrder({ ...actor, executionPurpose: "first_production", idempotencyKey: "scope" });
  await assert.rejects(service.getOrder({ ...actor, organizationId: "org-other", orderId: created.order.id }), {
    code: "PRODUCTION_ORDER_NOT_FOUND"
  });
});
