import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { createMemoryAssetRepository } from "../src/assets/memory-asset-repository.js";
import { createMemoryObjectStore } from "../src/assets/memory-object-store.js";
import { createControlledCopyProvider } from "../src/copy-generation/controlled-provider.js";
import { createMemoryCopyGenerationRepository } from "../src/copy-generation/memory-copy-generation-repository.js";
import { createMemoryCopyQualityRepository } from "../src/copy-quality/memory-copy-quality-repository.js";
import { createMemoryCopyReviewRepository } from "../src/copy-review/memory-copy-review-repository.js";
import { createMemoryAvatarSelectionRepository } from "../src/avatar-selection/memory-avatar-selection-repository.js";
import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
import { createMemoryVideoPlanningRepository } from "../src/video-planning/memory-video-planning-repository.js";
import { createMemoryProductionOrderRepository } from "../src/production-orders/memory-production-order-repository.js";
import { createMemoryManualHandoffPackageStore, extractManualHandoffArchive } from "../src/manual-handoff/manual-handoff-package-store.js";
import { renderManualHandoffReadme } from "../src/manual-handoff/manual-handoff-package.js";
import { createMemoryManualHandoffRepository } from "../src/manual-handoff/memory-manual-handoff-repository.js";
import { activateAdmin, identityApp, identityHeaders } from "./helpers/identity-world.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("the real A04-A09 service chain freezes facts consumed by an A10 package", async (t) => {
  const organizationId = "org_test";
  const assetRepository = createMemoryAssetRepository();
  const assetObjectStore = createMemoryObjectStore();
  const packageStore = createMemoryManualHandoffPackageStore();
  const { app } = await identityApp(t, {
    assets: { enabled: true, repository: assetRepository, objectStore: assetObjectStore, worker: { autoStart: false } },
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository() },
    copyGeneration: { enabled: true, repository: createMemoryCopyGenerationRepository(), provider: createControlledCopyProvider(), worker: { autoStart: false } },
    copyQuality: { enabled: true, repository: createMemoryCopyQualityRepository(), worker: { autoStart: false } },
    copyReview: { enabled: true, repository: createMemoryCopyReviewRepository() },
    avatarSelection: { enabled: true, repository: createMemoryAvatarSelectionRepository() },
    videoPlanning: { enabled: true, repository: createMemoryVideoPlanningRepository(), worker: { autoStart: false }, agentReadinessPort: { async isOnline() { return false; } } },
    productionOrders: { enabled: true, repository: createMemoryProductionOrderRepository() },
    manualHandoff: { enabled: true, repository: createMemoryManualHandoffRepository(), packageStore, worker: { autoStart: false } }
  });
  const auth = await activateAdmin(app);
  const actor = { organizationId, actorMemberId: auth.body.member.id, actorRole: "admin" };
  const mutation = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });

  const authorized = await app.assets.service.createUploadAuthorization({ ...actor, idempotencyKey: "real-chain-asset", filename: "product.png", contentType: "image/png", size: PNG.length, checksumSha256: createHash("sha256").update(PNG).digest("hex") });
  await app.assets.service.uploadObject({ organizationId, uploadToken: authorized.upload.token, body: PNG, contentType: "image/png" });
  await app.assets.service.completeUpload({ organizationId, actorMemberId: actor.actorMemberId, uploadSessionId: authorized.upload_session_id, idempotencyKey: "real-chain-asset-complete" });
  await app.assets.service.runNextVerificationJob();
  const assetVersionId = authorized.asset_version.id;

  const project = await app.projectContent.service.createProject({ ...actor, idempotencyKey: "real-chain-project", name: "A10 真实链路项目" });
  const created = await app.projectContent.service.createProduct({ ...actor, projectId: project.id, idempotencyKey: "real-chain-product", productName: "云感保湿乳" });
  const productActor = { ...actor, productId: created.product.id };
  let revision = await app.projectContent.service.saveRevision({ ...actor, productRevisionId: created.revision.id, expectedRevision: 1,
    productName: "云感保湿乳", productDescription: "日常保湿护理", primaryCategory: "beauty",
    contentBrief: { expression_style: "自然口语" }, sellingPoints: [{ text: "清爽不黏" }], assetVersionIds: [assetVersionId] });
  revision = await app.projectContent.service.confirmSellingPoint({ ...actor, productRevisionId: revision.id, pointId: revision.selling_points[0].id, expectedRevision: revision.revision_number });
  revision = await app.projectContent.service.readyRevision({ ...actor, productRevisionId: revision.id, expectedRevision: revision.revision_number, idempotencyKey: "real-chain-ready" });

  await app.copyGeneration.service.requestGeneration({ ...actor, productRevisionId: revision.id, intent: "product_recommendation", idempotencyKey: "real-chain-copy" });
  await app.copyGeneration.worker.runNext();
  let copy = (await app.copyGeneration.service.listCopyVersions({ ...actor, productRevisionId: revision.id })).at(-1);
  const quality = await app.copyQuality.service.startQualityCheck({ ...actor, copyVersionId: copy.id, expectedRevision: copy.row_version, idempotencyKey: "real-chain-quality" });
  await app.copyQuality.worker.runNext();
  copy = quality.copy_version;
  const copyDetails = await app.copyQuality.service.getQualityRun({ ...actor, qualityRunId: quality.quality_run.id });
  assert.equal(copyDetails.quality_result.effective_conclusion, "passed");

  const submittedCopyReview = await app.copyReview.service.submitReview({ ...actor, copyVersionId: copy.id, idempotencyKey: "real-chain-copy-review" });
  await app.copyReview.service.approveReview({ ...actor, reviewId: submittedCopyReview.current_review.id, expectedRevision: 1, idempotencyKey: "real-chain-copy-approve" });

  const avatarWorkspace = await app.avatarSelection.service.getWorkspace({ ...actor, productId: created.product.id, copyVersionId: copy.id });
  const avatar = avatarWorkspace.catalog.find((entry) => entry.gate.can_confirm);
  assert.ok(avatar);
  await app.avatarSelection.service.confirmSelection({ ...actor, productId: created.product.id, copyVersionId: copy.id,
    assetVersionId: avatar.asset_version.id, expectedRevision: 0, idempotencyKey: "real-chain-avatar" });

  let planWorkspace = await app.videoPlanning.service.createPlan({ ...productActor, outputInstructions: "竖版商品种草口播，先展示使用场景。", expectedHeadRevision: 0, idempotencyKey: "real-chain-plan" });
  await app.videoPlanning.service.requestPreflight({ ...productActor, planId: planWorkspace.current_plan.id, expectedRevision: planWorkspace.current_plan.row_version, idempotencyKey: "real-chain-preflight" });
  await app.videoPlanning.worker.runNext();
  planWorkspace = await app.videoPlanning.service.getWorkspace({ ...productActor, planId: planWorkspace.current_plan.id });
  assert.equal(planWorkspace.preflight.current_result.status, "warning");
  const submittedPlanReview = await app.videoPlanning.service.submitReview({ ...productActor, planId: planWorkspace.current_plan.id, idempotencyKey: "real-chain-plan-review" });
  await app.videoPlanning.service.approveReview({ ...productActor, reviewId: submittedPlanReview.review.current_review.id, expectedRevision: 1, idempotencyKey: "real-chain-plan-approve" });

  const createdOrder = await app.inject({ method: "POST", url: `/api/products/${created.product.id}/production-orders`,
    headers: { ...mutation, "idempotency-key": "real-chain-order" }, payload: { video_plan_version_id: planWorkspace.current_plan.id, execution_purpose: "first_production" } });
  assert.equal(createdOrder.statusCode, 201);
  const order = await app.productionOrders.service.getOrder({ ...actor, orderId: createdOrder.json().order.id });
  assert.equal(order.input_snapshot.approved_copy_snapshot.body, copy.body);
  assert.equal(order.input_snapshot.product_revision_snapshot.product_name, "云感保湿乳");
  assert.equal(order.input_snapshot.asset_references[0].asset_version_id, assetVersionId);
  assert.equal(order.input_snapshot.avatar_selection_snapshot.display_name, avatar.display_name);

  const generated = await app.inject({ method: "POST", url: `/api/production-orders/${order.id}/manual-handoff-packages`,
    headers: { ...mutation, "idempotency-key": "real-chain-package" }, payload: { generation_request_id: "real-chain-package" } });
  assert.equal(generated.statusCode, 202);
  await app.manualHandoff.worker.runNext();
  const packageId = generated.json().package.package_id;
  const ready = await app.manualHandoff.service.getPackage({ ...actor, packageId });
  assert.equal(ready.status, "ready");
  const entries = await extractManualHandoffArchive(await packageStore.get(ready.storage_key));
  const manifest = JSON.parse(entries["manifest.json"]);
  const readme = entries["README.md"];
  assert.deepEqual(manifest, ready.manifest);
  assert.equal(readme, renderManualHandoffReadme(manifest));
  assert.equal(readme.includes("云感保湿乳"), true);
  assert.equal(readme.includes(copy.body), true);
  assert.equal(readme.includes(avatar.display_name), true);
  assert.equal(readme.includes(avatar.source_type), true);
  assert.equal(readme.includes("竖版商品种草口播，先展示使用场景。"), true);
  assert.equal(readme.includes("按固定输入完成指定输出"), true);
  assert.equal(readme.includes("开始前核对包版本与完整性摘要"), true);
  assert.equal(/password|secret|cookie|token|permanent[_ -]?url|https?:\/\//i.test(readme), false);
  assert.equal(manifest.copy_snapshot.copy_body, copy.body);
  assert.equal(manifest.copy_snapshot.copy_version_id, copy.id);
  assert.equal(manifest.product_revision.product_name, "云感保湿乳");
  assert.equal(manifest.avatar_snapshot.display_name, avatar.display_name);
  assert.equal(manifest.avatar_snapshot.source_type, avatar.source_type);
  assert.equal(manifest.asset_references[0].asset_version_id, assetVersionId);
  assert.deepEqual(entries[`assets/${assetVersionId}`], PNG);
  assert.equal((await app.productionOrders.service.getOrder({ ...actor, orderId: order.id })).status, "waiting_for_executor");
});
