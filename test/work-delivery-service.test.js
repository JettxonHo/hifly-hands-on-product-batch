import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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

function pagedWorld() {
  const works = Array.from({ length: 9 }, (_, index) => {
    const number = index + 1;
    return {
      id: `work-${String(number).padStart(2, "0")}`,
      organization_id: actor.organizationId,
      production_order_id: `order-${number}`,
      product_id: `product-${number}`,
      project_id: number <= 7 ? "project-a" : "project-b",
      status: "available",
      primary_output_media_type: "video/mp4",
      primary_output_size: 16,
      primary_asset_version_id: `private-asset-${number}`,
      primary_candidate_id: `private-candidate-${number}`,
      primary_output_checksum: "b".repeat(64),
      production_config_snapshot: { secret: `private-config-${number}` },
      package_manifest_snapshot: { object_key: `private-key-${number}` },
      created_at: `2026-08-${String(number === 8 ? 9 : number).padStart(2, "0")}T00:00:00.000Z`,
      updated_at: `2026-08-${String(number === 8 ? 9 : number).padStart(2, "0")}T00:00:00.000Z`
    };
  });
  const foreign = { ...works[0], id: "work-foreign", organization_id: "org-b" };
  const workPort = {
    async listWorks(organizationId) {
      return organizationId === actor.organizationId
        ? [...works.map((entry) => structuredClone(entry)), structuredClone(foreign)]
        : [];
    },
    async getWork(organizationId, workId) {
      const work = [...works, foreign].find((entry) => entry.organization_id === organizationId && entry.id === workId);
      return work ? structuredClone(work) : null;
    }
  };
  const repository = createMemoryWorkDeliveryRepository();
  const service = createWorkDeliveryService({ repository, workPort, now: () => Date.parse("2026-08-10T01:00:00.000Z") });
  return { works, repository, service };
}

test("listing a formal work creates a pending inspection projection", async () => {
  const { service } = world();

  const result = await service.listWorks(actor);

  assert.equal(result.length, 1);
  assert.equal(result[0].current_inspection.status, "pending");
  assert.equal(result[0].inspection_history.length, 1);
  assert.equal(result[0].delivery_status, "pending_review");
});

test("paged works use authoritative stable ordering and report a six-plus-three total", async () => {
  const { service, repository } = pagedWorld();

  const first = await service.listWorksPage({ ...actor, page: "1", pageSize: "6" });
  assert.deepEqual([...repository._records.inspections.values()].map((inspection) => inspection.work_id).sort(),
    ["work-04", "work-05", "work-06", "work-07", "work-08", "work-09"]);
  const second = await service.listWorksPage({ ...actor, page: 2, pageSize: 6 });

  assert.deepEqual(first.works.map((work) => work.id), ["work-09", "work-08", "work-07", "work-06", "work-05", "work-04"]);
  assert.deepEqual(second.works.map((work) => work.id), ["work-03", "work-02", "work-01"]);
  assert.deepEqual(first.pagination, { page: 1, page_size: 6, total_items: 9, total_pages: 2 });
  assert.deepEqual(second.pagination, { page: 2, page_size: 6, total_items: 9, total_pages: 2 });
  assert.equal(first.selected_work_id, null);
  for (const privateField of ["primary_asset_version_id", "primary_candidate_id", "primary_output_checksum", "production_config_snapshot", "package_manifest_snapshot"]) {
    assert.equal(Object.hasOwn(first.works[0], privateField), false, privateField);
  }
});

test("paged works resolve an unpaged anchor but explicit page wins without selecting another work", async () => {
  const { service } = pagedWorld();

  const resolved = await service.listWorksPage({ ...actor, pageSize: 6, anchorWorkId: "work-02" });
  assert.equal(resolved.pagination.page, 2);
  assert.equal(resolved.selected_work_id, "work-02");

  const explicit = await service.listWorksPage({ ...actor, page: 1, pageSize: 6, anchorWorkId: "work-02" });
  assert.equal(explicit.pagination.page, 1);
  assert.equal(explicit.selected_work_id, null);
  assert.equal(explicit.works.some((work) => work.id === explicit.selected_work_id), false);

  const missing = await service.listWorksPage({ ...actor, pageSize: 6, anchorWorkId: "work-missing" });
  const foreign = await service.listWorksPage({ ...actor, pageSize: 6, anchorWorkId: "work-foreign" });
  assert.equal(missing.pagination.page, 1);
  assert.equal(missing.selected_work_id, null);
  assert.equal(foreign.selected_work_id, null);
});

test("paged project filters run before inspection initialization and filtered anchors cannot become a write target", async () => {
  const { service, repository } = pagedWorld();

  const project = await service.listWorksPage({ ...actor, page: 1, pageSize: 6, projectId: "project-b", anchorWorkId: "work-07" });

  assert.deepEqual(project.works.map((work) => work.id), ["work-09", "work-08"]);
  assert.deepEqual(project.pagination, { page: 1, page_size: 6, total_items: 2, total_pages: 1 });
  assert.equal(project.selected_work_id, null);
  assert.deepEqual(
    [...repository._records.inspections.values()].map((inspection) => inspection.work_id).sort(),
    ["work-08", "work-09"]
  );
});

test("paged works clamp an out-of-range page and fail closed on invalid pagination or status", async () => {
  const { service } = pagedWorld();

  const clamped = await service.listWorksPage({ ...actor, page: 99, pageSize: 6 });
  assert.equal(clamped.pagination.page, 2);
  assert.deepEqual(clamped.works.map((work) => work.id), ["work-03", "work-02", "work-01"]);

  for (const input of [
    { page: 0, pageSize: 6 },
    { page: 1.5, pageSize: 6 },
    { page: "oops", pageSize: 6 },
    { page: 1, pageSize: 5 }
  ]) {
    await assert.rejects(service.listWorksPage({ ...actor, ...input }), (error) => error.code === "WORK_DELIVERY_PAGINATION_INVALID");
  }
  await assert.rejects(
    service.listWorksPage({ ...actor, page: 1, pageSize: 6, deliveryStatus: "surprise" }),
    (error) => error.code === "WORK_DELIVERY_FILTER_INVALID"
  );
});

test("paged projection fails closed when inspection truth changes while deliveries are read", async () => {
  const { service, repository } = world();
  const pending = (await service.listWorks(actor))[0].current_inspection;
  const passed = await service.markDeliverable({ ...actor, workId: "work-a", idempotencyKey: "torn-pass",
    expectedInspectionId: pending.id, expectedRevision: pending.revision });
  await service.createDelivery({ ...actor, workId: "work-a", idempotencyKey: "torn-delivery", deliveryMethod: "email",
    expectedInspectionId: passed.inspection.id, expectedRevision: passed.inspection.revision });

  const listDeliveries = repository.listDeliveries.bind(repository);
  let interleaved = false;
  repository.listDeliveries = async (organizationId, workId) => {
    if (!interleaved) {
      interleaved = true;
      const inspectedAt = "2026-08-09T01:05:00.000Z";
      await repository.createInspection({
        receiptKey: "org-a:work-inspection:torn-rework",
        fingerprint: "torn-rework",
        inspection: { id: "inspection-torn-rework", organization_id: organizationId, work_id: workId,
          status: "rework_required", category: "visual_quality", reason: "并发返工",
          target_upstream_stage: "video_plan", inspected_by_member_id: actor.actorMemberId,
          inspected_at: inspectedAt, superseded_by_inspection_id: null, created_at: inspectedAt, updated_at: inspectedAt },
        expectedInspectionId: passed.inspection.id,
        expectedRevision: passed.inspection.revision
      });
    }
    return listDeliveries(organizationId, workId);
  };

  await assert.rejects(
    service.listWorksPage({ ...actor, page: 1, pageSize: 6 }),
    (error) => error.code === "WORK_DELIVERY_PROJECTION_INVALID"
  );
});

test("legacy unpaged works keep their existing return shape and insertion order", async () => {
  const { service } = pagedWorld();

  const works = await service.listWorks(actor);

  assert.equal(Array.isArray(works), true);
  assert.deepEqual(works.map((work) => work.id), ["work-01", "work-02", "work-03", "work-04", "work-05", "work-06", "work-07", "work-08", "work-09"]);
});

test("operator projection reads a formal work without creating inspection truth", async () => {
  const { service, repository } = world();

  const result = await service.getWorkProjection({ ...actor, workId: "work-a" });

  assert.equal(result.id, "work-a");
  assert.equal(result.current_inspection, null);
  assert.deepEqual(result.inspection_history, []);
  assert.equal(result.delivery_status, "pending_review");
  assert.equal(repository._records.inspections.size, 0);
  assert.equal(repository._records.audits.length, 0);
  assert.equal(repository._records.ledger.length, 0);
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

test("rework blocks another inspection and preserves the original work history", async () => {
  const { service, repository } = world();
  const pending = (await service.listWorks(actor))[0].current_inspection;
  const passed = await service.markDeliverable({ ...actor, workId: "work-a", idempotencyKey: "blocked-pass-source",
    expectedInspectionId: pending.id, expectedRevision: pending.revision });
  const rework = await service.requestRework({ ...actor, workId: "work-a", idempotencyKey: "blocked-rework-source",
    category: "visual_quality", reason: "需要上游重新制作", targetUpstreamStage: "video_plan",
    expectedInspectionId: passed.inspection.id, expectedRevision: passed.inspection.revision });

  await assert.rejects(
    service.markDeliverable({ ...actor, workId: "work-a", idempotencyKey: "blocked-pass-after-rework",
      expectedInspectionId: rework.inspection.id, expectedRevision: rework.inspection.revision }),
    (error) => error.code === "WORK_DELIVERY_REWORK_BLOCKED"
  );
  await assert.rejects(
    service.requestRework({ ...actor, workId: "work-a", idempotencyKey: "blocked-rework-after-rework",
      category: "file_or_format", reason: "不能绕过上游周期", targetUpstreamStage: "project_content",
      expectedInspectionId: rework.inspection.id, expectedRevision: rework.inspection.revision }),
    (error) => error.code === "WORK_DELIVERY_REWORK_BLOCKED"
  );
  const current = await service.getWork({ ...actor, workId: "work-a" });
  assert.equal(repository._records.inspections.size, 3);
  assert.equal(current.current_inspection.status, "rework_required");
  assert.equal(current.current_inspection.reason, "需要上游重新制作");
  assert.equal(current.inspection_history.length, 3);
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
  const input = { ...actor, workId: "work-a", deliveryMethod: "email", note: "发送给运营团队", deliveredAt: "2026-08-09T09:15:00+08:00", idempotencyKey: "delivery-one",
    expectedInspectionId: passed.inspection.id, expectedRevision: passed.inspection.revision };
  const first = await service.createDelivery(input);
  const replay = await service.createDelivery(input);
  const second = await service.createDelivery({ ...input, idempotencyKey: "delivery-two" });

  assert.equal(first.replayed, false);
  assert.equal(replay.replayed, true);
  assert.equal(replay.delivery.id, first.delivery.id);
  assert.notEqual(second.delivery.id, first.delivery.id);
  assert.equal(second.work.delivery_count, 2);
  assert.equal((await service.getWork({ ...actor, workId: "work-a" })).deliveries[0].delivered_at, "2026-08-09T01:15:00.000Z");
  await assert.rejects(service.createDelivery({ ...input, note: "不同载荷" }), (error) => error.code === "IDEMPOTENCY_CONFLICT");
  await service.requestRework({ ...actor, workId: "work-a", idempotencyKey: "rework-after-delivery", category: "visual_quality", reason: "重新检查画面", targetUpstreamStage: "video_plan",
    expectedInspectionId: passed.inspection.id, expectedRevision: passed.inspection.revision });
  const replayAfterStateChange = await service.createDelivery(input);
  assert.equal(replayAfterStateChange.replayed, true);
  const reworkAfterDelivery = await service.getWork({ ...actor, workId: "work-a" });
  assert.equal(reworkAfterDelivery.delivery_count, 2);
  assert.equal(reworkAfterDelivery.current_inspection.status, "rework_required");
  assert.equal(reworkAfterDelivery.delivery_status, "rework_required");
});

test("cross-organization work IDs and stale inspection revisions are rejected", async () => {
  const { service } = world();

  await assert.rejects(service.listWorks({ ...actor, actorRole: "viewer" }), (error) => error.code === "WORK_DELIVERY_FORBIDDEN");
  await assert.rejects(service.getWork({ ...actor, workId: "work-from-other-org" }), (error) => error.code === "WORK_DELIVERY_WORK_NOT_FOUND");
  const pending = (await service.listWorks(actor))[0].current_inspection;
  await assert.rejects(service.markDeliverable({ ...actor, workId: "work-a", expectedInspectionId: pending.id, expectedRevision: pending.revision + 1, idempotencyKey: "stale-pass" }),
    (error) => error.code === "WORK_DELIVERY_INSPECTION_CONFLICT");
});

test("download authorizations are bound to the exact work and verified output bytes", async () => {
  const body = Buffer.from("work-a-video");
  const checksum = createHash("sha256").update(body).digest("hex");
  const works = ["a", "b"].map((suffix) => ({
    id: `work-${suffix}`, organization_id: actor.organizationId, production_order_id: `order-${suffix}`,
    product_id: `product-${suffix}`, status: "available", primary_asset_version_id: `asset-${suffix}`,
    primary_output_media_type: "video/mp4", primary_output_size: body.length, primary_output_checksum: checksum,
    created_at: "2026-08-09T00:00:00.000Z", updated_at: "2026-08-09T00:00:00.000Z"
  }));
  const grants = new Map();
  let downloadCalls = 0;
  const service = createWorkDeliveryService({
    repository: createMemoryWorkDeliveryRepository(),
    workPort: {
      async listWorks() { return works.map((work) => structuredClone(work)); },
      async getWork(organizationId, workId) {
        return structuredClone(works.find((work) => work.organization_id === organizationId && work.id === workId) || null);
      }
    },
    assetPort: {
      async createDownloadAuthorization({ assetVersionId }) {
        const token = `token-${assetVersionId}`;
        grants.set(token, assetVersionId);
        return { token, expires_at: "2026-08-09T02:00:00.000Z", asset_version_id: assetVersionId,
          original_filename: "video.mp4", verified_content_type: "video/mp4", verified_size: body.length,
          verified_checksum_sha256: checksum };
      },
      async downloadObject({ token }) {
        downloadCalls += 1;
        assert.equal(grants.has(token), true);
        return { body, original_filename: "video.mp4", verified_content_type: "video/mp4",
          verified_size: body.length, verified_checksum_sha256: checksum };
      }
    },
    now: () => Date.parse("2026-08-09T01:00:00.000Z")
  });

  const authorization = await service.createDownloadAuthorization({ ...actor, workId: "work-a" });
  await assert.rejects(
    service.downloadObject({ ...actor, workId: "work-b", token: authorization.token }),
    (error) => error.code === "DOWNLOAD_AUTHORIZATION_NOT_FOUND"
  );
  assert.equal(downloadCalls, 0);
  const downloaded = await service.downloadObject({ ...actor, workId: "work-a", token: authorization.token });
  assert.deepEqual(downloaded.body, body);
  assert.equal(downloadCalls, 1);
});
