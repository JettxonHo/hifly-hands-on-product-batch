import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
import { createProjectContentService } from "../src/project-content/project-content-service.js";

const ORG = "org_test";
const MEMBER = "member_test";

function availableAssetPort({ unavailable = new Set(), failAfter = null } = {}) {
  const references = [];
  let calls = 0;
  return {
    references,
    async bindAvailableVersion(input) {
      calls += 1;
      if (unavailable.has(input.assetVersionId)) {
        throw Object.assign(new Error("ASSET_VERSION_NOT_AVAILABLE"), { code: "ASSET_VERSION_NOT_AVAILABLE" });
      }
      if (failAfter != null && calls > failAfter) {
        throw Object.assign(new Error("ASSET_BIND_FAILED"), { code: "ASSET_BIND_FAILED" });
      }
      const reference = {
        organization_id: input.organizationId,
        asset_version_id: input.assetVersionId,
        reference_type: input.referenceType,
        reference_id: input.referenceId,
        role: input.role
      };
      input.transactionClient?.onCommit?.(() => references.push(reference));
      if (!input.transactionClient?.onCommit) references.push(reference);
      return {
        reference,
        asset: { id: `asset-${input.assetVersionId}`, status: "active" },
        asset_version: { id: input.assetVersionId, status: "available", version_number: 1 },
        verification: { content_type: "image/png", size: 42, checksum_sha256: "a".repeat(64) }
      };
    }
  };
}

function world(options = {}) {
  let tick = 0;
  const repository = createMemoryProjectContentRepository();
  const assetReferencePort = options.assetReferencePort || availableAssetPort();
  const service = createProjectContentService({
    repository,
    assetReferencePort,
    now: () => Date.parse("2026-08-06T01:00:00.000Z") + tick++
  });
  const actor = { organizationId: ORG, actorMemberId: MEMBER };
  return { repository, assetReferencePort, service, actor };
}

async function createProductDraft(ctx, overrides = {}) {
  const project = await ctx.service.createProject({
    ...ctx.actor,
    idempotencyKey: "project-1",
    name: "新品种草",
    description: "八月批次"
  });
  const result = await ctx.service.createProduct({
    ...ctx.actor,
    projectId: project.id,
    idempotencyKey: "product-1",
    productName: "云朵抱枕",
    ...overrides
  });
  return { project, ...result };
}

test("blank project and product creation are idempotent without duplicate audit", async () => {
  const ctx = world();
  const command = {
    ...ctx.actor,
    idempotencyKey: "same-project",
    name: "  新品计划  ",
    description: " 可选说明 "
  };
  const first = await ctx.service.createProject(command);
  const replay = await ctx.service.createProject(command);
  assert.deepEqual(replay, first);
  assert.equal(first.name, "新品计划");
  assert.equal((await ctx.repository.listAuditEvents()).filter((event) => event.event_type === "project.created").length, 1);
  await assert.rejects(ctx.service.createProject({ ...command, name: "冲突计划" }), { code: "IDEMPOTENCY_CONFLICT" });

  const productCommand = {
    ...ctx.actor,
    projectId: first.id,
    idempotencyKey: "same-product",
    productName: "  云朵抱枕  "
  };
  const created = await ctx.service.createProduct(productCommand);
  const productReplay = await ctx.service.createProduct(productCommand);
  assert.deepEqual(productReplay, created);
  assert.equal(created.revision.status, "draft");
  assert.equal(created.revision.primary_category, "general");
  assert.equal((await ctx.repository.listAuditEvents()).filter((event) => event.event_type === "product.created").length, 1);
  await assert.rejects(ctx.service.createProduct({ ...productCommand, productName: "冲突商品" }), { code: "IDEMPOTENCY_CONFLICT" });
});

test("saving an incomplete snapshot remains draft and stale writes are rejected", async () => {
  const ctx = world();
  const { revision } = await createProductDraft(ctx);
  const saved = await ctx.service.saveRevision({
    ...ctx.actor,
    productRevisionId: revision.id,
    expectedRevision: 1,
    productName: "云朵抱枕",
    sellingPoints: [{ text: "柔软亲肤" }],
    assetVersionIds: [],
    contentBrief: { expression_style: "自然口语化种草", additional_requirements: "避免夸大" }
  });
  assert.equal(saved.status, "draft");
  assert.equal(saved.revision_number, 2);
  assert.equal(saved.selling_points[0].confirmed, false);
  assert.equal(saved.content_brief.additional_requirements, "避免夸大");
  await assert.rejects(ctx.service.saveRevision({
    ...ctx.actor,
    productRevisionId: revision.id,
    expectedRevision: 1,
    productName: "旧页面覆盖",
    sellingPoints: [],
    assetVersionIds: []
  }), { code: "PRODUCT_REVISION_CONFLICT" });
});

test("selling points have stable ids and editing confirmed text forces unconfirmed", async () => {
  const ctx = world();
  const { revision } = await createProductDraft(ctx);
  const saved = await ctx.service.saveRevision({
    ...ctx.actor,
    productRevisionId: revision.id,
    expectedRevision: 1,
    productName: "云朵抱枕",
    sellingPoints: [{ text: "柔软亲肤" }],
    assetVersionIds: ["asset-version-1"]
  });
  const point = saved.selling_points[0];
  const confirmed = await ctx.service.confirmSellingPoint({
    ...ctx.actor,
    productRevisionId: saved.id,
    pointId: point.id,
    expectedRevision: saved.revision_number
  });
  assert.equal(confirmed.selling_points[0].confirmed, true);
  assert.equal(confirmed.selling_points[0].id, point.id);
  const edited = await ctx.service.saveRevision({
    ...ctx.actor,
    productRevisionId: confirmed.id,
    expectedRevision: confirmed.revision_number,
    productName: confirmed.product_name,
    sellingPoints: [{ id: point.id, text: "柔软且易清洁" }],
    assetVersionIds: confirmed.asset_version_ids
  });
  assert.equal(edited.selling_points[0].id, point.id);
  assert.equal(edited.selling_points[0].confirmed, false);
});

test("ready reports structured reasons and only binds server-verified images", async () => {
  const ctx = world({ assetReferencePort: availableAssetPort({ unavailable: new Set(["not-ready"]) }) });
  const { revision } = await createProductDraft(ctx, { productName: "" });
  await assert.rejects(ctx.service.readyRevision({
    ...ctx.actor,
    productRevisionId: revision.id,
    expectedRevision: revision.revision_number,
    idempotencyKey: "ready-empty"
  }), (error) => {
    assert.equal(error.code, "PRODUCT_REVISION_READY_BLOCKED");
    assert.deepEqual(error.reasons.map((reason) => reason.code).sort(), ["IMAGE_REQUIRED", "PRODUCT_NAME_REQUIRED", "SELLING_POINT_REQUIRED"]);
    return true;
  });

  let saved = await ctx.service.saveRevision({
    ...ctx.actor,
    productRevisionId: revision.id,
    expectedRevision: revision.revision_number,
    productName: "云朵抱枕",
    sellingPoints: [{ text: "柔软亲肤" }],
    assetVersionIds: ["not-ready"]
  });
  saved = await ctx.service.confirmSellingPoint({ ...ctx.actor, productRevisionId: saved.id, pointId: saved.selling_points[0].id, expectedRevision: saved.revision_number });
  await assert.rejects(ctx.service.readyRevision({
    ...ctx.actor,
    productRevisionId: saved.id,
    expectedRevision: saved.revision_number,
    idempotencyKey: "ready-unavailable"
  }), { code: "ASSET_VERSION_NOT_AVAILABLE" });
  assert.equal((await ctx.service.getRevision({ ...ctx.actor, productRevisionId: saved.id })).status, "draft");
});

test("ready is idempotent, immutable, and a later draft supersedes it only after success", async () => {
  const ctx = world();
  const { revision } = await createProductDraft(ctx);
  let draft = await ctx.service.saveRevision({
    ...ctx.actor,
    productRevisionId: revision.id,
    expectedRevision: 1,
    productName: "云朵抱枕",
    productDescription: "适合办公室午休",
    sellingPoints: [{ text: "柔软亲肤" }],
    assetVersionIds: ["asset-version-1"]
  });
  draft = await ctx.service.confirmSellingPoint({ ...ctx.actor, productRevisionId: draft.id, pointId: draft.selling_points[0].id, expectedRevision: draft.revision_number });
  const readyCommand = { ...ctx.actor, productRevisionId: draft.id, expectedRevision: draft.revision_number, idempotencyKey: "ready-1" };
  const ready = await ctx.service.readyRevision(readyCommand);
  const replay = await ctx.service.readyRevision(readyCommand);
  assert.deepEqual(replay, ready);
  assert.equal(ready.status, "ready");
  assert.equal(ctx.assetReferencePort.references.length, 1);
  assert.equal((await ctx.repository.listAuditEvents()).filter((event) => event.event_type === "product_revision.ready").length, 1);

  const child = await ctx.service.saveRevision({
    ...ctx.actor,
    productRevisionId: ready.id,
    expectedRevision: ready.revision_number,
    productName: ready.product_name,
    productDescription: "新的办公场景说明",
    sellingPoints: ready.selling_points,
    assetVersionIds: ready.asset_version_ids
  });
  assert.equal(child.status, "draft");
  assert.equal(child.parent_revision_id, ready.id);
  assert.notEqual(child.id, ready.id);
  assert.equal((await ctx.service.getRevision({ ...ctx.actor, productRevisionId: ready.id })).status, "ready");
  const childConfirmed = await ctx.service.confirmSellingPoint({ ...ctx.actor, productRevisionId: child.id, pointId: child.selling_points[0].id, expectedRevision: child.revision_number });
  const nextReady = await ctx.service.readyRevision({ ...ctx.actor, productRevisionId: child.id, expectedRevision: childConfirmed.revision_number, idempotencyKey: "ready-2" });
  assert.equal(nextReady.status, "ready");
  assert.equal((await ctx.service.getRevision({ ...ctx.actor, productRevisionId: ready.id })).status, "superseded");
});

test("saving an unchanged ready snapshot does not create a duplicate revision", async () => {
  const ctx = world();
  const { revision } = await createProductDraft(ctx);
  let draft = await ctx.service.saveRevision({
    ...ctx.actor,
    productRevisionId: revision.id,
    expectedRevision: 1,
    productName: "云朵抱枕",
    sellingPoints: [{ text: "柔软亲肤" }],
    assetVersionIds: ["asset-version-1"]
  });
  draft = await ctx.service.confirmSellingPoint({
    ...ctx.actor,
    productRevisionId: draft.id,
    pointId: draft.selling_points[0].id,
    expectedRevision: draft.revision_number
  });
  const ready = await ctx.service.readyRevision({
    ...ctx.actor,
    productRevisionId: draft.id,
    expectedRevision: draft.revision_number,
    idempotencyKey: "ready-once"
  });

  const replayedSave = await ctx.service.saveRevision({
    ...ctx.actor,
    productRevisionId: ready.id,
    expectedRevision: ready.revision_number,
    productName: ready.product_name,
    productDescription: ready.product_description,
    primaryCategory: ready.primary_category,
    contentBrief: ready.content_brief,
    sellingPoints: ready.selling_points,
    assetVersionIds: ready.asset_version_ids
  });

  assert.deepEqual(replayedSave, ready);
  assert.equal((await ctx.repository.listAuditEvents()).filter((event) => event.event_type === "product_revision.child_draft_created").length, 0);
});

test("only the product's current revision can create a child or become ready", async () => {
  const ctx = world();
  const { revision } = await createProductDraft(ctx);
  let draft = await ctx.service.saveRevision({ ...ctx.actor, productRevisionId: revision.id, expectedRevision: 1, productName: "云朵抱枕", sellingPoints: [{ text: "柔软亲肤" }], assetVersionIds: ["asset-version-1"] });
  draft = await ctx.service.confirmSellingPoint({ ...ctx.actor, productRevisionId: draft.id, pointId: draft.selling_points[0].id, expectedRevision: draft.revision_number });
  const ready = await ctx.service.readyRevision({ ...ctx.actor, productRevisionId: draft.id, expectedRevision: draft.revision_number, idempotencyKey: "current-ready" });
  const child = await ctx.service.saveRevision({ ...ctx.actor, productRevisionId: ready.id, expectedRevision: ready.revision_number, productName: ready.product_name, productDescription: "更新后的商品说明", sellingPoints: ready.selling_points, assetVersionIds: ready.asset_version_ids });
  await assert.rejects(ctx.service.saveRevision({ ...ctx.actor, productRevisionId: ready.id, expectedRevision: ready.revision_number, productName: "第二个旧页面", sellingPoints: ready.selling_points, assetVersionIds: ready.asset_version_ids }), { code: "PRODUCT_REVISION_CONFLICT" });

  const replacement = await ctx.service.saveRevision({ ...ctx.actor, productRevisionId: child.id, expectedRevision: child.revision_number, productName: child.product_name, sellingPoints: child.selling_points, assetVersionIds: child.asset_version_ids });
  assert.equal(replacement.id, child.id);
});

test("asset binding failure rolls back ready state and staged references", async () => {
  const port = availableAssetPort({ failAfter: 1 });
  const ctx = world({ assetReferencePort: port });
  const { revision } = await createProductDraft(ctx);
  let draft = await ctx.service.saveRevision({
    ...ctx.actor,
    productRevisionId: revision.id,
    expectedRevision: 1,
    productName: "云朵抱枕",
    sellingPoints: [{ text: "柔软亲肤" }],
    assetVersionIds: ["asset-version-1", "asset-version-2"]
  });
  draft = await ctx.service.confirmSellingPoint({ ...ctx.actor, productRevisionId: draft.id, pointId: draft.selling_points[0].id, expectedRevision: draft.revision_number });
  await assert.rejects(ctx.service.readyRevision({
    ...ctx.actor,
    productRevisionId: draft.id,
    expectedRevision: draft.revision_number,
    idempotencyKey: "ready-fails"
  }), { code: "ASSET_BIND_FAILED" });
  assert.equal(port.references.length, 0);
  assert.equal((await ctx.service.getRevision({ ...ctx.actor, productRevisionId: draft.id })).status, "draft");
});

test("cross-organization project and revision commands do not reveal object existence", async () => {
  const ctx = world();
  const { project, revision } = await createProductDraft(ctx);
  const outsider = { organizationId: "org_other", actorMemberId: "member_other" };

  await assert.rejects(ctx.service.getProject({ ...outsider, projectId: project.id }), { code: "PROJECT_NOT_FOUND" });
  await assert.rejects(ctx.service.createProduct({
    ...outsider,
    projectId: project.id,
    idempotencyKey: "other-org-product",
    productName: "不应创建"
  }), { code: "PROJECT_NOT_FOUND" });
  await assert.rejects(ctx.service.saveRevision({
    ...outsider,
    productRevisionId: revision.id,
    expectedRevision: revision.revision_number,
    productName: "不应覆盖",
    sellingPoints: [],
    assetVersionIds: []
  }), { code: "PRODUCT_REVISION_NOT_FOUND" });
  await assert.rejects(ctx.service.readyRevision({
    ...outsider,
    productRevisionId: revision.id,
    expectedRevision: revision.revision_number,
    idempotencyKey: "other-org-ready"
  }), { code: "PRODUCT_REVISION_NOT_FOUND" });
});

test("downstream port returns only same-organization ready immutable snapshots", async () => {
  const ctx = world();
  const { revision } = await createProductDraft(ctx);
  let draft = await ctx.service.saveRevision({
    ...ctx.actor, productRevisionId: revision.id, expectedRevision: 1, productName: "云朵抱枕",
    sellingPoints: [{ text: "柔软亲肤" }], assetVersionIds: ["asset-version-1"]
  });
  draft = await ctx.service.confirmSellingPoint({ ...ctx.actor, productRevisionId: draft.id, pointId: draft.selling_points[0].id, expectedRevision: draft.revision_number });
  const ready = await ctx.service.readyRevision({ ...ctx.actor, productRevisionId: draft.id, expectedRevision: draft.revision_number, idempotencyKey: "ready-port" });
  const snapshot = await ctx.service.productRevisionPort.getReadySnapshot({ organizationId: ORG, productRevisionId: ready.id });
  assert.equal(snapshot.status, "ready");
  assert.equal((await ctx.service.productRevisionPort.getCurrentReadySnapshot({ organizationId: ORG,
    productRevisionId: ready.id })).id, ready.id);
  assert.deepEqual(snapshot.selling_points.map((point) => point.text), ["柔软亲肤"]);
  await assert.rejects(ctx.service.productRevisionPort.getReadySnapshot({ organizationId: "org_other", productRevisionId: ready.id }), { code: "PRODUCT_REVISION_NOT_FOUND" });

  let child = await ctx.service.saveRevision({
    ...ctx.actor, productRevisionId: ready.id, expectedRevision: ready.revision_number,
    productName: "云朵抱枕升级款", sellingPoints: [{ text: "柔软亲肤" }], assetVersionIds: ["asset-version-1"]
  });
  await assert.rejects(ctx.service.productRevisionPort.getCurrentReadySnapshot({ organizationId: ORG,
    productRevisionId: ready.id }), { code: "PRODUCT_REVISION_NOT_FOUND" });
  child = await ctx.service.confirmSellingPoint({ ...ctx.actor, productRevisionId: child.id, pointId: child.selling_points[0].id, expectedRevision: child.revision_number });
  await ctx.service.readyRevision({ ...ctx.actor, productRevisionId: child.id, expectedRevision: child.revision_number, idempotencyKey: "ready-child-port" });

  const historical = await ctx.service.productRevisionPort.getSnapshot({ organizationId: ORG, productRevisionId: ready.id });
  assert.equal(historical.status, "superseded");
  assert.equal(historical.product_name, "云朵抱枕");
  await assert.rejects(ctx.service.productRevisionPort.getReadySnapshot({ organizationId: ORG, productRevisionId: ready.id }), { code: "PRODUCT_REVISION_NOT_FOUND" });
  await assert.rejects(ctx.service.productRevisionPort.getSnapshot({ organizationId: "org_other", productRevisionId: ready.id }), { code: "PRODUCT_REVISION_NOT_FOUND" });
});
