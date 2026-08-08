import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryWorkDeliveryRepository } from "../src/work-delivery/memory-work-delivery-repository.js";
import { createWorkDeliveryService } from "../src/work-delivery/work-delivery-service.js";

const actor = { organizationId: "org-a", actorMemberId: "member-a", actorRole: "member" };

function world() {
  const work = {
    id: "work-a", organization_id: actor.organizationId, production_order_id: "order-a", product_id: "product-a",
    status: "available", primary_output_media_type: "video/mp4", primary_output_size: 16,
    created_at: "2026-08-09T00:00:00.000Z", updated_at: "2026-08-09T00:00:00.000Z"
  };
  const workPort = {
    async listWorks(organizationId) { return organizationId === work.organization_id ? [structuredClone(work)] : []; },
    async getWork(organizationId, workId) { return organizationId === work.organization_id && workId === work.id ? structuredClone(work) : null; }
  };
  const repository = createMemoryWorkDeliveryRepository();
  const service = createWorkDeliveryService({ repository, workPort, now: () => Date.parse("2026-08-09T01:00:00.000Z") });
  return { work, workPort, repository, service };
}

test("listing a formal work creates a pending inspection projection", async () => {
  const { service } = world();

  const result = await service.listWorks(actor);

  assert.equal(result.length, 1);
  assert.equal(result[0].current_inspection.status, "pending");
  assert.equal(result[0].inspection_history.length, 1);
  assert.equal(result[0].delivery_status, "pending_review");
});

test("passing a work creates an inspection and unlocks delivery", async () => {
  const { service } = world();

  const pending = (await service.listWorks(actor))[0].current_inspection;
  const result = await service.markDeliverable({ ...actor, workId: "work-a", idempotencyKey: "pass-1",
    expectedInspectionId: pending.id, expectedRevision: pending.revision });

  assert.equal(result.inspection.status, "passed");
  assert.equal(result.work.current_inspection.status, "passed");
  assert.equal(result.work.delivery_status, "deliverable");
  assert.equal(result.replayed, false);
});

test("rework creates a new inspection, supersedes only the prior status projection, and keeps the work", async () => {
  const { service, repository, work } = world();

  const pending = (await service.listWorks(actor))[0].current_inspection;
  const first = await service.markDeliverable({ ...actor, workId: work.id, idempotencyKey: "pass-history",
    expectedInspectionId: pending.id, expectedRevision: pending.revision });
  const rework = await service.requestRework({ ...actor, workId: work.id, idempotencyKey: "rework-history",
    category: "visual_quality", reason: "画面主体不清晰，需要重新检查。", targetUpstreamStage: "video_plan",
    expectedInspectionId: first.inspection.id, expectedRevision: first.inspection.revision });

  assert.notEqual(rework.inspection.id, first.inspection.id);
  assert.equal(rework.inspection.status, "rework_required");
  assert.equal(rework.inspection.category, "visual_quality");
  assert.equal(rework.inspection.target_upstream_stage, "video_plan");
  assert.equal(rework.work.id, work.id);
  assert.equal(rework.work.current_inspection.status, "rework_required");
  assert.equal(rework.work.inspection_history.length, 3);
  assert.equal(rework.work.inspection_history[0].status, "superseded");
  assert.equal(rework.work.inspection_history[0].reason, null);
  assert.equal(repository._records.inspections.size, 3);
  const transitions = await repository.listStatusTransitions(actor.organizationId);
  assert.equal(transitions.find((entry) => entry.to_status === "passed").from_status, "pending");
  assert.equal(transitions.find((entry) => entry.to_status === "rework_required").from_status, "passed");
});

test("inspection and delivery commands require the current inspection identity and revision", async () => {
  const { service } = world();

  await assert.rejects(
    service.markDeliverable({ ...actor, workId: "work-a", idempotencyKey: "missing-pass-precondition" }),
    (error) => error.code === "WORK_DELIVERY_INSPECTION_PRECONDITION_REQUIRED"
  );
  const pending = (await service.listWorks(actor))[0].current_inspection;
  const passed = await service.markDeliverable({ ...actor, workId: "work-a", idempotencyKey: "precondition-pass",
    expectedInspectionId: pending.id, expectedRevision: pending.revision });
  await assert.rejects(
    service.requestRework({ ...actor, workId: "work-a", idempotencyKey: "missing-rework-precondition",
      category: "visual_quality", reason: "需要返工", targetUpstreamStage: "video_plan" }),
    (error) => error.code === "WORK_DELIVERY_INSPECTION_PRECONDITION_REQUIRED"
  );
  await assert.rejects(
    service.createDelivery({ ...actor, workId: "work-a", deliveryMethod: "email", idempotencyKey: "missing-delivery-precondition" }),
    (error) => error.code === "WORK_DELIVERY_INSPECTION_PRECONDITION_REQUIRED"
  );
  await assert.rejects(
    service.markDeliverable({ ...actor, workId: "work-a", idempotencyKey: "stale-precondition", expectedInspectionId: pending.id, expectedRevision: pending.revision }),
    (error) => error.code === "WORK_DELIVERY_INSPECTION_CONFLICT"
  );
  assert.equal(passed.inspection.status, "passed");
});

test("delivery is gated by the current passed inspection and duplicate requests are idempotent", async () => {
  const { service } = world();

  const pending = (await service.listWorks(actor))[0].current_inspection;
  await assert.rejects(
    service.createDelivery({ ...actor, workId: "work-a", deliveryMethod: "email", idempotencyKey: "delivery-before-pass",
      expectedInspectionId: pending.id, expectedRevision: pending.revision }),
    (error) => error.code === "WORK_DELIVERY_INSPECTION_REQUIRED"
  );
  const passed = await service.markDeliverable({ ...actor, workId: "work-a", idempotencyKey: "pass-delivery",
    expectedInspectionId: pending.id, expectedRevision: pending.revision });
  const input = { ...actor, workId: "work-a", deliveryMethod: "email", note: "发送给运营团队", idempotencyKey: "delivery-one",
    expectedInspectionId: passed.inspection.id, expectedRevision: passed.inspection.revision };
  const first = await service.createDelivery(input);
  const replay = await service.createDelivery(input);
  const second = await service.createDelivery({ ...input, idempotencyKey: "delivery-two" });

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.delivery.id, first.delivery.id);
  assert.notEqual(second.delivery.id, first.delivery.id);
  assert.equal(second.work.delivery_count, 2);
  await assert.rejects(service.createDelivery({ ...input, note: "不同载荷" }), (error) => error.code === "IDEMPOTENCY_CONFLICT");
  await service.requestRework({ ...actor, workId: "work-a", idempotencyKey: "rework-after-delivery", category: "visual_quality", reason: "重新检查画面", targetUpstreamStage: "video_plan",
    expectedInspectionId: passed.inspection.id, expectedRevision: passed.inspection.revision });
  const replayAfterStateChange = await service.createDelivery(input);
  assert.equal(replayAfterStateChange.replayed, true);
});

test("cross-organization work IDs and stale inspection revisions are rejected", async () => {
  const { service } = world();

  await assert.rejects(service.listWorks({ ...actor, actorRole: "viewer" }), (error) => error.code === "WORK_DELIVERY_FORBIDDEN");
  await assert.rejects(service.getWork({ ...actor, workId: "work-from-other-org" }), (error) => error.code === "WORK_DELIVERY_WORK_NOT_FOUND");
  const pending = (await service.listWorks(actor))[0].current_inspection;
  await assert.rejects(service.markDeliverable({ ...actor, workId: "work-a", expectedInspectionId: pending.id, expectedRevision: pending.revision + 1, idempotencyKey: "stale-pass" }),
    (error) => error.code === "WORK_DELIVERY_INSPECTION_CONFLICT");
});
