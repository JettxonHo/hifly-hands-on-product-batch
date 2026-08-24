import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createFakeExecutor } from "../src/executors/fake-executor.js";
import { createMemoryIdentityRepository } from "../src/identity/memory-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
import { createMemoryCopyGenerationRepository } from "../src/copy-generation/memory-copy-generation-repository.js";
import { createControlledCopyProvider } from "../src/copy-generation/controlled-provider.js";
import { createMemoryCopyQualityRepository } from "../src/copy-quality/memory-copy-quality-repository.js";
import { createControlledQualityEvaluator } from "../src/copy-quality/controlled-evaluator.js";
import { createControlledCopyRewriter } from "../src/copy-quality/controlled-rewriter.js";
import { createMemoryCopyReviewRepository } from "../src/copy-review/memory-copy-review-repository.js";
import { createMemoryAvatarSelectionRepository } from "../src/avatar-selection/memory-avatar-selection-repository.js";
import { createMemoryVideoPlanningRepository } from "../src/video-planning/memory-video-planning-repository.js";
import { createMemoryProductionOrderRepository } from "../src/production-orders/memory-production-order-repository.js";
import { createMemoryManualHandoffRepository } from "../src/manual-handoff/memory-manual-handoff-repository.js";
import { createMemoryManualHandoffPackageStore } from "../src/manual-handoff/manual-handoff-package-store.js";
import { createMemoryWorkDeliveryRepository } from "../src/work-delivery/memory-work-delivery-repository.js";
import { createWorkDeliveryService } from "../src/work-delivery/work-delivery-service.js";
import { buildApp } from "../src/server/app.js";
import { activateAdmin, identityApp, identityHeaders } from "./helpers/identity-world.js";

const assetReferencePort = {
  async bindAvailableVersion(input) {
    return { reference: { asset_version_id: input.assetVersionId }, asset_version: { id: input.assetVersionId, status: "available" } };
  }
};

const headers = (auth, mutation = false, key = null) => ({
  ...identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation }),
  ...(key ? { "idempotency-key": key } : {})
});

async function readyOperatorProduct(service, actor, projectId, key, name) {
  const created = await service.createProduct({ ...actor, projectId, idempotencyKey: key, productName: name });
  let revision = await service.saveRevision({ ...actor, productRevisionId: created.revision.id,
    expectedRevision: created.revision.revision_number, productName: name,
    sellingPoints: [{ text: `${name}核心卖点` }], assetVersionIds: [`${key}-image`] });
  revision = await service.confirmSellingPoint({ ...actor, productRevisionId: revision.id,
    pointId: revision.selling_points[0].id, expectedRevision: revision.revision_number });
  revision = await service.readyRevision({ ...actor, productRevisionId: revision.id,
    expectedRevision: revision.revision_number, idempotencyKey: `${key}-ready` });
  return { product: created.product, revision };
}

async function world(t) {
  const repository = createMemoryProjectContentRepository();
  const result = await identityApp(t, { projectContent: { enabled: true, repository, assetReferencePort } });
  return { ...result, repository, auth: await activateAdmin(result.app) };
}

async function operatorWorld(t, { repository = createMemoryProjectContentRepository(), operatorWorkspaceOptions = {} } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-operator-workspace-api-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const identityRepository = createMemoryIdentityRepository();
  await seedInitialAdmin(identityRepository, {
    organizationId: "org_test",
    organizationName: "Test Organization",
    adminEmail: "admin@example.test",
    adminDisplayName: "Test Admin",
    adminTempPassword: "Temporary-Admin-9!"
  });
  const app = await buildApp({
    root,
    executor: createFakeExecutor(),
    operatorWorkspace: { enabled: true, ...operatorWorkspaceOptions },
    projectContent: { enabled: true, repository, assetReferencePort },
    identity: {
      enabled: true,
      repository: identityRepository,
      trustedHosts: ["app.test"],
      trustedOrigins: ["https://app.test"],
      cookieSecure: false,
      seed: { enabled: false }
    }
  });
  t.after(() => app.close());
  return { app, repository, auth: await activateAdmin(app) };
}

async function copyOperatorWorld(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-operator-copy-workspace-api-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const identityRepository = createMemoryIdentityRepository();
  await seedInitialAdmin(identityRepository, {
    organizationId: "org_test",
    organizationName: "Test Organization",
    adminEmail: "admin@example.test",
    adminDisplayName: "Test Admin",
    adminTempPassword: "Temporary-Admin-9!"
  });
  const copyGenerationRepository = createMemoryCopyGenerationRepository();
  const app = await buildApp({
    root,
    executor: createFakeExecutor(),
    operatorWorkspace: { enabled: true },
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort },
    copyGeneration: {
      enabled: true,
      repository: copyGenerationRepository,
      provider: createControlledCopyProvider(),
      worker: { autoStart: false }
    },
    copyQuality: {
      enabled: true,
      repository: createMemoryCopyQualityRepository(),
      evaluator: createControlledQualityEvaluator(),
      rewriter: createControlledCopyRewriter(),
      worker: { autoStart: false }
    },
    copyReview: { enabled: true, repository: createMemoryCopyReviewRepository() },
    identity: {
      enabled: true,
      repository: identityRepository,
      trustedHosts: ["app.test"],
      trustedOrigins: ["https://app.test"],
      cookieSecure: false,
      seed: { enabled: false }
    }
  });
  t.after(() => app.close());
  return { app, auth: await activateAdmin(app), copyGenerationRepository };
}

async function avatarOperatorWorld(t, { avatarRepository = createMemoryAvatarSelectionRepository(), includeCopyGeneration = true,
  downstreamStagePorts = {}, videoPlanning = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-operator-avatar-workspace-api-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const identityRepository = createMemoryIdentityRepository();
  await seedInitialAdmin(identityRepository, {
    organizationId: "org_test",
    organizationName: "Test Organization",
    adminEmail: "admin@example.test",
    adminDisplayName: "Test Admin",
    adminTempPassword: "Temporary-Admin-9!"
  });
  const approvals = new Map();
  const copyApprovalPort = {
    async getCurrentApprovedCopy({ productId, copyVersionId }) {
      const approved = approvals.get(productId);
      return approved?.copy_version_id === copyVersionId ? { ...approved } : null;
    },
    async resolveCurrentApprovedCopy({ productId }) {
      const approved = approvals.get(productId);
      return approved ? { ...approved } : null;
    }
  };
  const copyGenerationRepository = includeCopyGeneration ? createMemoryCopyGenerationRepository() : null;
  const app = await buildApp({
    root,
    executor: createFakeExecutor(),
    operatorWorkspace: { enabled: true, ...downstreamStagePorts },
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort },
    ...(includeCopyGeneration ? {
      copyGeneration: {
        enabled: true,
        repository: copyGenerationRepository,
        provider: createControlledCopyProvider(),
        worker: { autoStart: false }
      }
    } : {}),
    avatarSelection: { enabled: true, repository: avatarRepository, copyApprovalPort },
    ...(videoPlanning ? {
      videoPlanning: { enabled: true, repository: createMemoryVideoPlanningRepository(), worker: { autoStart: false } }
    } : {}),
    identity: {
      enabled: true,
      repository: identityRepository,
      trustedHosts: ["app.test"],
      trustedOrigins: ["https://app.test"],
      cookieSecure: false,
      seed: { enabled: false }
    }
  });
  t.after(() => app.close());
  return { app, auth: await activateAdmin(app), approvals, copyGenerationRepository, avatarRepository };
}

test("project content is disabled by default and reported by runtime", async (t) => {
  const { app } = await identityApp(t);
  const auth = await activateAdmin(app);
  const runtime = await app.inject({ method: "GET", url: "/api/runtime", headers: headers(auth) });
  assert.equal(runtime.json().projectContentEnabled, false);
  assert.equal(runtime.json().operatorWorkspaceEnabled, false);
  assert.equal((await app.inject({ method: "GET", url: "/api/projects", headers: headers(auth) })).statusCode, 404);
});

test("operator workspace rejects an invalid stage with its stable client error", async (t) => {
  const { app, auth } = await operatorWorld(t);
  const response = await app.inject({
    method: "GET",
    url: "/api/projects/project-a/products/product-a/operator-workspace?stage=unknown",
    headers: headers(auth)
  });
  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json(), { error: "INVALID_OPERATOR_WORKSPACE_STAGE" });
});

test("operator workspace cannot be enabled without Project Content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-operator-workspace-requires-content-"));
  await assert.rejects(
    buildApp({ root, executor: createFakeExecutor(), operatorWorkspace: { enabled: true } }),
    { code: "OPERATOR_WORKSPACE_REQUIRES_PROJECT_CONTENT" }
  );
});

test("operator workspace returns the Product Content projection and legacy stage identities", async (t) => {
  const { app, auth } = await operatorWorld(t);
  assert.equal((await app.inject({ method: "GET", url: "/api/runtime", headers: headers(auth) })).json().operatorWorkspaceEnabled, true);
  const projectResponse = await app.inject({
    method: "POST",
    url: "/api/projects",
    headers: headers(auth, true, "operator-project"),
    payload: { name: "单任务项目" }
  });
  const project = projectResponse.json().project;
  const productResponse = await app.inject({
    method: "POST",
    url: `/api/projects/${project.id}/products`,
    headers: headers(auth, true, "operator-product"),
    payload: { product_name: "待完善商品" }
  });
  const product = productResponse.json();

  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/products/${product.product.id}/operator-workspace?stage=product_content`,
    headers: headers(auth)
  });
  assert.equal(response.statusCode, 200, response.body);
  const workspace = response.json().workspace;
  assert.equal(workspace.projection_version, 1);
  assert.equal(workspace.action_registry_version, 1);
  assert.deepEqual(workspace.project, { id: project.id, name: "单任务项目" });
  assert.deepEqual(workspace.product, {
    id: product.product.id,
    name: "待完善商品",
    current_revision_id: product.revision.id
  });
  assert.equal(workspace.render_mode, "workspace");
  assert.equal(workspace.recommended_stage, "product_content");
  assert.deepEqual(workspace.recommended_action, {
    code: "review_product_blockers",
    stage: "product_content",
    kind: "focus"
  });
  assert.deepEqual(workspace.stages[0], {
    code: "product_content",
    implementation_status: "workspace",
    read_status: "ok",
    navigation_state: "current",
    business_status: "商品资料待完善",
    blocker_codes: ["SELLING_POINT_REQUIRED", "IMAGE_REQUIRED"],
    current_object: { type: "product_revision", id: product.revision.id }
  });
  for (const stage of workspace.stages.slice(1)) {
    assert.deepEqual(stage, {
      code: stage.code,
      implementation_status: "legacy",
      read_status: "not_loaded",
      navigation_state: null,
      business_status: null,
      blocker_codes: [],
      current_object: null
    });
  }

  const legacy = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/products/${product.product.id}/operator-workspace?stage=copy`,
    headers: headers(auth)
  });
  assert.equal(legacy.statusCode, 200, legacy.body);
  assert.equal(legacy.json().workspace.render_mode, "legacy");
  assert.equal(legacy.json().workspace.recommended_stage, null);
  assert.equal(legacy.json().workspace.recommended_action, null);
  assert.equal(legacy.json().workspace.stages[0].read_status, "ok");
  assert.equal(legacy.json().workspace.stages[0].navigation_state, "available");
});

test("operator workspace default app wiring exposes Copy only when the existing Copy stack is enabled", async (t) => {
  const { app, auth } = await copyOperatorWorld(t);
  const project = (await app.inject({
    method: "POST", url: "/api/projects", headers: headers(auth, true, "copy-workspace-project"), payload: { name: "文案工作区" }
  })).json().project;
  let revision = (await app.inject({
    method: "POST", url: `/api/projects/${project.id}/products`, headers: headers(auth, true, "copy-workspace-product"), payload: { product_name: "清透防晒乳" }
  })).json().revision;
  revision = (await app.inject({
    method: "PATCH", url: `/api/product-revisions/${revision.id}`, headers: headers(auth, true),
    payload: { expected_revision: revision.revision_number, product_name: revision.product_name,
      selling_points: [{ text: "清爽不黏腻" }], asset_version_ids: ["asset-version-a"] }
  })).json().revision;
  revision = (await app.inject({
    method: "POST", url: `/api/product-revisions/${revision.id}/selling-points/${revision.selling_points[0].id}/confirm`,
    headers: headers(auth, true), payload: { expected_revision: revision.revision_number }
  })).json().revision;
  revision = (await app.inject({
    method: "POST", url: `/api/product-revisions/${revision.id}/ready`, headers: headers(auth, true, "copy-workspace-ready"),
    payload: { expected_revision: revision.revision_number }
  })).json().revision;

  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/products/${revision.product_id}/operator-workspace?stage=copy`,
    headers: headers(auth)
  });
  assert.equal(response.statusCode, 200, response.body);
  const workspace = response.json().workspace;
  assert.equal(workspace.render_mode, "workspace");
  assert.equal(workspace.stages[1].implementation_status, "workspace");
  assert.equal(workspace.stages[1].read_status, "ok");
  assert.deepEqual(workspace.recommended_action, { code: "request_copy_generation", stage: "copy", kind: "command" });
  assert.equal(workspace.stages[2].read_status, "not_loaded");
  assert.equal(workspace.stages[3].read_status, "not_loaded");
  assert.equal(workspace.stages[4].read_status, "not_loaded");
});

test("operator workspace API projects the newest active Copy generation job", async (t) => {
  const { app, auth, copyGenerationRepository } = await copyOperatorWorld(t);
  const project = (await app.inject({
    method: "POST", url: "/api/projects", headers: headers(auth, true, "copy-order-project"), payload: { name: "任务顺序" }
  })).json().project;
  let revision = (await app.inject({
    method: "POST", url: `/api/projects/${project.id}/products`, headers: headers(auth, true, "copy-order-product"), payload: { product_name: "顺序商品" }
  })).json().revision;
  revision = (await app.inject({
    method: "PATCH", url: `/api/product-revisions/${revision.id}`, headers: headers(auth, true), payload: {
      expected_revision: revision.revision_number, product_name: revision.product_name,
      selling_points: [{ text: "顺序卖点" }], asset_version_ids: ["asset-version-a"]
    }
  })).json().revision;
  revision = (await app.inject({
    method: "POST", url: `/api/product-revisions/${revision.id}/selling-points/${revision.selling_points[0].id}/confirm`,
    headers: headers(auth, true), payload: { expected_revision: revision.revision_number }
  })).json().revision;
  revision = (await app.inject({
    method: "POST", url: `/api/product-revisions/${revision.id}/ready`, headers: headers(auth, true, "copy-order-ready"),
    payload: { expected_revision: revision.revision_number }
  })).json().revision;
  const job = (id, status, createdAt) => ({
    id, organization_id: "org_test", type: "copy_generation", status,
    product_revision_id: revision.id, project_id: project.id, product_id: revision.product_id,
    intent: "product_recommendation", input_snapshot: revision, attempts: status === "failed" ? 1 : 0,
    max_attempts: 3, copy_version_id: null, failure_code: status === "failed" ? "COPY_GENERATION_FAILED" : null,
    started_at: null, heartbeat_at: null, lease_expires_at: null, completed_at: status === "failed" ? createdAt : null,
    created_at: createdAt, updated_at: createdAt
  });
  await copyGenerationRepository.createGenerationRequest({
    receiptKey: "old", fingerprint: "old", job: job("job-old", "failed", "2026-08-24T01:00:00.000Z"), audit: { id: "audit-old" }
  });
  await copyGenerationRepository.createGenerationRequest({
    receiptKey: "new", fingerprint: "new", job: job("job-new", "queued", "2026-08-24T02:00:00.000Z"), audit: { id: "audit-new" }
  });

  const response = await app.inject({
    method: "GET", url: `/api/projects/${project.id}/products/${revision.product_id}/operator-workspace?stage=copy`, headers: headers(auth)
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().workspace.stages[1].generation.current_job_id, "job-new");
  assert.equal(response.json().workspace.stages[1].generation.status, "queued");
  assert.equal(response.json().workspace.recommended_action, null);
});

test("buildApp operator workspace projects an enabled Avatar stage and keeps later stages unloaded", async (t) => {
  const laterStageReads = { videoPlan: 0, production: 0 };
  const { app, auth, approvals } = await avatarOperatorWorld(t, { downstreamStagePorts: {
    videoPlanningService: { async getWorkspace() { laterStageReads.videoPlan += 1; throw new Error("Stage 4 must not be read"); } },
    productionService: { async getWorkspace() { laterStageReads.production += 1; throw new Error("Stage 5 must not be read"); } }
  } });
  const project = (await app.inject({ method: "POST", url: "/api/projects", headers: headers(auth, true, "avatar-workspace-project"), payload: { name: "人物工作区" } })).json().project;
  let revision = (await app.inject({ method: "POST", url: `/api/projects/${project.id}/products`, headers: headers(auth, true, "avatar-workspace-product"), payload: { product_name: "待配人物商品" } })).json().revision;
  revision = (await app.inject({ method: "PATCH", url: `/api/product-revisions/${revision.id}`, headers: headers(auth, true), payload: {
    expected_revision: revision.revision_number, product_name: revision.product_name,
    selling_points: [{ text: "人物工作区卖点" }], asset_version_ids: ["product-image-avatar"]
  } })).json().revision;
  revision = (await app.inject({ method: "POST", url: `/api/product-revisions/${revision.id}/selling-points/${revision.selling_points[0].id}/confirm`, headers: headers(auth, true), payload: { expected_revision: revision.revision_number } })).json().revision;
  revision = (await app.inject({ method: "POST", url: `/api/product-revisions/${revision.id}/ready`, headers: headers(auth, true, "avatar-workspace-ready"), payload: { expected_revision: revision.revision_number } })).json().revision;

  await app.copyGeneration.service.requestGeneration({ organizationId: "org_test", actorMemberId: auth.body.member.id, productRevisionId: revision.id, idempotencyKey: "avatar-copy-generation" });
  const job = await app.copyGeneration.service.claimNextGenerationJob();
  const copy = await app.copyGeneration.service.completeGenerationJob({ job, body: "人物工作区批准文案" });
  const frozen = await app.copyGeneration.service.freezeCopyVersion({ organizationId: "org_test", actorMemberId: auth.body.member.id,
    copyVersionId: copy.id, expectedRevision: copy.row_version, idempotencyKey: "avatar-copy-freeze" });
  approvals.set(revision.product_id, { copy_version_id: frozen.id, product_revision_id: revision.id, current_valid: true });

  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/products/${revision.product_id}/operator-workspace?stage=avatar`,
    headers: headers(auth)
  });
  assert.equal(response.statusCode, 200, response.body);
  const workspace = response.json().workspace;
  assert.equal(workspace.render_mode, "workspace");
  assert.equal(workspace.recommended_stage, "avatar");
  assert.deepEqual(workspace.recommended_action, { code: "select_avatar", stage: "avatar", kind: "focus" });
  assert.equal(workspace.stages[2].implementation_status, "workspace");
  assert.equal(workspace.stages[2].read_status, "ok");
  assert.equal(workspace.stages[2].current_copy_version_id, frozen.id);
  assert.equal(workspace.stages[2].avatar_workspace.copy_gate.approved, true);
  assert.equal(workspace.stages[2].avatar_workspace.copy_gate.copy_version_id, frozen.id);
  assert.equal(workspace.stages[2].avatar_workspace.resolved_copy_version_id, frozen.id);
  assert.equal(workspace.stages[2].current_object, null);
  assert.equal(workspace.stages[3].read_status, "not_loaded");
  assert.equal(workspace.stages[4].read_status, "not_loaded");
  assert.deepEqual(laterStageReads, { videoPlan: 0, production: 0 });

  const avatarWorkspace = await app.avatarSelection.service.getWorkspace({ organizationId: "org_test",
    actorMemberId: auth.body.member.id, actorRole: "admin", productId: revision.product_id, copyVersionId: frozen.id });
  const avatar = avatarWorkspace.catalog.find((entry) => entry.gate.can_confirm);
  const confirmed = await app.avatarSelection.service.confirmSelection({ organizationId: "org_test",
    actorMemberId: auth.body.member.id, actorRole: "admin", productId: revision.product_id,
    copyVersionId: frozen.id, assetVersionId: avatar.asset_version.id, expectedRevision: 0,
    idempotencyKey: "avatar-workspace-confirm-old-copy" });
  assert.equal(confirmed.current_valid, true);

  await app.copyGeneration.service.requestGeneration({ organizationId: "org_test", actorMemberId: auth.body.member.id,
    productRevisionId: revision.id, idempotencyKey: "avatar-copy-generation-current" });
  const currentJob = await app.copyGeneration.service.claimNextGenerationJob();
  const currentDraft = await app.copyGeneration.service.completeGenerationJob({ job: currentJob, body: "替换后的批准文案" });
  const currentCopy = await app.copyGeneration.service.freezeCopyVersion({ organizationId: "org_test",
    actorMemberId: auth.body.member.id, copyVersionId: currentDraft.id, expectedRevision: currentDraft.row_version,
    idempotencyKey: "avatar-copy-freeze-current" });
  approvals.set(revision.product_id, { copy_version_id: currentCopy.id, product_revision_id: revision.id, current_valid: true });

  const replaced = await app.inject({ method: "GET",
    url: `/api/projects/${project.id}/products/${revision.product_id}/operator-workspace?stage=avatar`, headers: headers(auth) });
  assert.equal(replaced.statusCode, 200, replaced.body);
  const replacedAvatar = replaced.json().workspace.stages[2];
  assert.equal(replacedAvatar.current_copy_version_id, currentCopy.id);
  assert.equal(replacedAvatar.current_object.id, confirmed.current_selection.id);
  assert.equal(replacedAvatar.avatar_workspace.selection.current_valid, false);
  assert.deepEqual(replacedAvatar.avatar_workspace.selection.invalidation_reasons, ["copy_version_changed"]);
  assert.deepEqual(replaced.json().workspace.recommended_action, { code: "select_avatar", stage: "avatar", kind: "focus" });
  assert.deepEqual(laterStageReads, { videoPlan: 0, production: 0 });
});

test("buildApp operator workspace clears Avatar projection on a read error without stale action", async (t) => {
  const avatarRepository = createMemoryAvatarSelectionRepository();
  avatarRepository.listCatalog = async () => { throw new Error("avatar authority unavailable"); };
  const { app, auth } = await avatarOperatorWorld(t, { avatarRepository, includeCopyGeneration: false });
  const project = (await app.inject({ method: "POST", url: "/api/projects", headers: headers(auth, true, "avatar-error-project"), payload: { name: "人物错误工作区" } })).json().project;
  const product = (await app.inject({ method: "POST", url: `/api/projects/${project.id}/products`, headers: headers(auth, true, "avatar-error-product"), payload: { product_name: "待读取商品" } })).json();

  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/products/${product.product.id}/operator-workspace?stage=product_content`,
    headers: headers(auth)
  });
  assert.equal(response.statusCode, 200, response.body);
  const avatarStage = response.json().workspace.stages[2];
  assert.deepEqual(avatarStage, {
    code: "avatar",
    implementation_status: "workspace",
    read_status: "error",
    navigation_state: null,
    business_status: null,
    blocker_codes: [],
    current_object: null
  });
  assert.equal(avatarStage.copy_version, undefined);
  assert.equal(avatarStage.avatar_workspace, undefined);
  assert.equal(avatarStage.recommended_action, undefined);
});

test("operator workspace unifies missing and mismatched products without leaking organization truth", async (t) => {
  const { app, auth } = await operatorWorld(t);
  const project = (await app.inject({
    method: "POST", url: "/api/projects", headers: headers(auth, true, "operator-errors-project"), payload: { name: "隔离项目" }
  })).json().project;
  const product = (await app.inject({
    method: "POST", url: `/api/projects/${project.id}/products`, headers: headers(auth, true, "operator-errors-product"), payload: { product_name: "隔离商品" }
  })).json().product;

  const missing = await app.inject({
    method: "GET", url: `/api/projects/${project.id}/products/missing-product/operator-workspace?stage=product_content`, headers: headers(auth)
  });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: "OPERATOR_WORKSPACE_NOT_FOUND" });

  const otherProject = (await app.inject({
    method: "POST", url: "/api/projects", headers: headers(auth, true, "operator-errors-other-project"), payload: { name: "另一项目" }
  })).json().project;
  const otherProduct = (await app.inject({
    method: "POST", url: `/api/projects/${otherProject.id}/products`, headers: headers(auth, true, "operator-errors-other-product"), payload: { product_name: "另一商品" }
  })).json().product;
  const mismatch = await app.inject({
    method: "GET", url: `/api/projects/${project.id}/products/${otherProduct.id}/operator-workspace?stage=product_content`, headers: headers(auth)
  });
  assert.equal(mismatch.statusCode, 404);
  assert.deepEqual(mismatch.json(), { error: "OPERATOR_WORKSPACE_NOT_FOUND" });

  const unauthenticated = await app.inject({
    method: "GET", url: `/api/projects/${project.id}/products/${product.id}/operator-workspace?stage=product_content`, headers: identityHeaders()
  });
  assert.equal(unauthenticated.statusCode, 401);
  assert.deepEqual(unauthenticated.json(), { error: "AUTH_REQUIRED" });
});

test("operator workspace returns 503 when the Product Content authority cannot be read", async (t) => {
  const repository = {
    async initialize() {},
    async close() {},
    async transaction() {
      throw new Error("project content repository unavailable");
    }
  };
  const { app, auth } = await operatorWorld(t, { repository });
  const response = await app.inject({
    method: "GET",
    url: "/api/projects/project-a/products/product-a/operator-workspace?stage=product_content",
    headers: headers(auth)
  });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "OPERATOR_WORKSPACE_UNAVAILABLE" });
});

test("authenticated API creates, restores, edits, confirms, and readies a product snapshot", async (t) => {
  const { app, auth } = await world(t);
  assert.equal((await app.inject({ method: "GET", url: "/api/runtime", headers: headers(auth) })).json().projectContentEnabled, true);
  const created = await app.inject({
    method: "POST", url: "/api/projects", headers: headers(auth, true, "project-api"),
    payload: { name: "新品计划", description: "首批", organization_id: "forged" }
  });
  assert.equal(created.statusCode, 201, created.body);
  const replay = await app.inject({
    method: "POST", url: "/api/projects", headers: headers(auth, true, "project-api"),
    payload: { description: "首批", name: " 新品计划 " }
  });
  assert.equal(replay.json().project.id, created.json().project.id);
  const conflict = await app.inject({ method: "POST", url: "/api/projects", headers: headers(auth, true, "project-api"), payload: { name: "另一个计划" } });
  assert.equal(conflict.statusCode, 409);

  const projectId = created.json().project.id;
  const product = await app.inject({
    method: "POST", url: `/api/projects/${projectId}/products`, headers: headers(auth, true, "product-api"), payload: { product_name: "云朵抱枕" }
  });
  assert.equal(product.statusCode, 201, product.body);
  let revision = product.json().revision;
  const saved = await app.inject({
    method: "PATCH", url: `/api/product-revisions/${revision.id}`, headers: headers(auth, true),
    payload: {
      expected_revision: revision.revision_number,
      product_name: "云朵抱枕",
      physical_dimensions: { height: 18, width: 12, unit: "cm", capacity: { value: 500, unit: "ml" } },
      selling_points: [{ text: "柔软亲肤" }],
      asset_version_ids: ["asset-version-1"],
      content_brief: { expression_style: "自然口语" }
    }
  });
  assert.equal(saved.statusCode, 200, saved.body);
  revision = saved.json().revision;
  assert.deepEqual(revision.physical_dimensions, { height: 18, width: 12, unit: "cm", capacity: { value: 500, unit: "ml" } });
  const confirmed = await app.inject({
    method: "POST", url: `/api/product-revisions/${revision.id}/selling-points/${revision.selling_points[0].id}/confirm`, headers: headers(auth, true), payload: { expected_revision: revision.revision_number }
  });
  revision = confirmed.json().revision;
  const ready = await app.inject({
    method: "POST", url: `/api/product-revisions/${revision.id}/ready`, headers: headers(auth, true, "ready-api"), payload: { expected_revision: revision.revision_number }
  });
  assert.equal(ready.statusCode, 200, ready.body);
  assert.equal(ready.json().revision.status, "ready");
  const restored = await app.inject({ method: "GET", url: `/api/projects/${projectId}`, headers: headers(auth) });
  assert.equal(restored.json().project.products[0].revision.status, "ready");
});

test("API exposes ready blockers and stale revisions without internal details", async (t) => {
  const { app, auth } = await world(t);
  const project = (await app.inject({ method: "POST", url: "/api/projects", headers: headers(auth, true, "p"), payload: { name: "计划" } })).json().project;
  const revision = (await app.inject({ method: "POST", url: `/api/projects/${project.id}/products`, headers: headers(auth, true, "x"), payload: { product_name: "" } })).json().revision;
  const blocked = await app.inject({ method: "POST", url: `/api/product-revisions/${revision.id}/ready`, headers: headers(auth, true, "r"), payload: { expected_revision: 1 } });
  assert.equal(blocked.statusCode, 422);
  assert.deepEqual(blocked.json().reasons.map((item) => item.code).sort(), ["IMAGE_REQUIRED", "PRODUCT_NAME_REQUIRED", "SELLING_POINT_REQUIRED"]);
  const saved = await app.inject({ method: "PATCH", url: `/api/product-revisions/${revision.id}`, headers: headers(auth, true), payload: { expected_revision: 1, product_name: "商品", selling_points: [], asset_version_ids: [] } });
  assert.equal(saved.statusCode, 200);
  const stale = await app.inject({ method: "PATCH", url: `/api/product-revisions/${revision.id}`, headers: headers(auth, true), payload: { expected_revision: 1, product_name: "旧页面", selling_points: [], asset_version_ids: [] } });
  assert.equal(stale.statusCode, 409);
  assert.deepEqual(stale.json(), { error: "PRODUCT_REVISION_CONFLICT" });
  const invalid = await app.inject({ method: "PATCH", url: `/api/product-revisions/${revision.id}`, headers: headers(auth, true), payload: { expected_revision: 2, product_name: "商品", selling_points: "not-an-array", asset_version_ids: [] } });
  assert.equal(invalid.statusCode, 400);
  assert.deepEqual(invalid.json(), { error: "INVALID_SELLING_POINTS" });
  const invalidDimensions = await app.inject({ method: "PATCH", url: `/api/product-revisions/${revision.id}`, headers: headers(auth, true), payload: { expected_revision: 2, product_name: "商品", physical_dimensions: { height: 18, width: 12, unit: "pixels" }, selling_points: [], asset_version_ids: [] } });
  assert.equal(invalidDimensions.statusCode, 400);
  assert.deepEqual(invalidDimensions.json(), { error: "INVALID_PHYSICAL_DIMENSIONS" });
});

test("product revision read seam preserves organization-scoped not-found semantics", async (t) => {
  const { app, auth, repository } = await world(t);
  const project = (await app.inject({ method: "POST", url: "/api/projects", headers: headers(auth, true, "read-project"), payload: { name: "历史版本读取" } })).json().project;
  const revision = (await app.inject({ method: "POST", url: `/api/projects/${project.id}/products`, headers: headers(auth, true, "read-product"), payload: { product_name: "可见商品" } })).json().revision;

  const visible = await app.inject({ method: "GET", url: `/api/product-revisions/${revision.id}`, headers: headers(auth) });
  assert.equal(visible.statusCode, 200, visible.body);
  assert.deepEqual(visible.json(), { revision });

  const missing = await app.inject({ method: "GET", url: "/api/product-revisions/missing-revision", headers: headers(auth) });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), { error: "PRODUCT_REVISION_NOT_FOUND" });

  await repository.transaction(async (uow) => {
    await uow.insertRevision({
      ...revision,
      id: "other-organization-revision",
      organization_id: "org_other",
      project_id: "other-project",
      product_id: "other-product",
      product_name: "不可见商品"
    });
  });
  const invisible = await app.inject({ method: "GET", url: "/api/product-revisions/other-organization-revision", headers: headers(auth) });
  assert.equal(invisible.statusCode, 404);
  assert.deepEqual(invisible.json(), missing.json());

  const unauthenticated = await app.inject({ method: "GET", url: `/api/product-revisions/${revision.id}`, headers: identityHeaders() });
  assert.equal(unauthenticated.statusCode, 401);
  assert.deepEqual(unauthenticated.json(), { error: "AUTH_REQUIRED" });
});

test("default buildApp wiring projects exact VideoPlan query and keeps Production at zero reads", async (t) => {
  let productionReads = 0;
  const { app, auth, approvals } = await avatarOperatorWorld(t, {
    videoPlanning: true,
    downstreamStagePorts: {
      productionService: { async getWorkspace() { productionReads += 1; throw new Error("Stage 5 must remain unread"); } }
    }
  });
  const actor = { organizationId: "org_test", actorMemberId: auth.body.member.id, actorRole: "admin" };
  const project = (await app.inject({ method: "POST", url: "/api/projects",
    headers: headers(auth, true, "plan-workspace-project"), payload: { name: "方案工作区" } })).json().project;
  let revision = (await app.inject({ method: "POST", url: `/api/projects/${project.id}/products`,
    headers: headers(auth, true, "plan-workspace-product"), payload: { product_name: "方案商品" } })).json().revision;
  revision = (await app.inject({ method: "PATCH", url: `/api/product-revisions/${revision.id}`,
    headers: headers(auth, true), payload: { expected_revision: revision.revision_number, product_name: revision.product_name,
      selling_points: [{ text: "方案卖点" }], asset_version_ids: ["product-image-plan"] } })).json().revision;
  revision = (await app.inject({ method: "POST",
    url: `/api/product-revisions/${revision.id}/selling-points/${revision.selling_points[0].id}/confirm`,
    headers: headers(auth, true), payload: { expected_revision: revision.revision_number } })).json().revision;
  revision = (await app.inject({ method: "POST", url: `/api/product-revisions/${revision.id}/ready`,
    headers: headers(auth, true, "plan-workspace-ready"), payload: { expected_revision: revision.revision_number } })).json().revision;

  await app.copyGeneration.service.requestGeneration({ ...actor, productRevisionId: revision.id,
    idempotencyKey: "plan-workspace-copy-generation" });
  const generation = await app.copyGeneration.service.claimNextGenerationJob();
  const draft = await app.copyGeneration.service.completeGenerationJob({ job: generation, body: "已批准方案文案" });
  const copy = await app.copyGeneration.service.freezeCopyVersion({ ...actor, copyVersionId: draft.id,
    expectedRevision: draft.row_version, idempotencyKey: "plan-workspace-copy-freeze" });
  approvals.set(revision.product_id, { copy_version_id: copy.id, product_revision_id: revision.id, current_valid: true });
  const avatarWorkspace = await app.avatarSelection.service.getWorkspace({ ...actor, productId: revision.product_id,
    copyVersionId: copy.id });
  const avatar = avatarWorkspace.catalog.find((entry) => entry.gate.can_confirm);
  const selection = await app.avatarSelection.service.confirmSelection({ ...actor, productId: revision.product_id,
    copyVersionId: copy.id, assetVersionId: avatar.asset_version.id, expectedRevision: 0,
    idempotencyKey: "plan-workspace-avatar-confirm" });
  assert.equal(selection.current_valid, true);

  const created = await app.videoPlanning.service.createPlan({ ...actor, productId: revision.product_id,
    outputInstructions: "竖版产品说明", presentationSizeCode: "small", expectedHeadRevision: 0,
    idempotencyKey: "plan-workspace-create" });
  const planId = created.current_plan.id;
  const response = await app.inject({ method: "GET",
    url: `/api/projects/${project.id}/products/${revision.product_id}/operator-workspace?stage=video_plan&plan=${planId}`,
    headers: headers(auth) });

  assert.equal(response.statusCode, 200, response.body);
  const workspace = response.json().workspace;
  assert.equal(workspace.render_mode, "workspace");
  assert.equal(workspace.recommended_stage, "video_plan");
  assert.equal(workspace.stages[3].current_object.id, planId);
  assert.equal(workspace.stages[3].video_plan_workspace.current_plan.id, planId);
  assert.equal(workspace.stages[3].video_plan_workspace.current_plan.presentation_size_code, "small");
  assert.deepEqual(workspace.recommended_action, {
    code: "run_video_plan_preflight", stage: "video_plan", kind: "command"
  });
  assert.deepEqual(workspace.stages[4], {
    code: "production", implementation_status: "legacy", read_status: "not_loaded", navigation_state: null,
    business_status: null, blocker_codes: [], current_object: null
  });
  assert.equal(JSON.stringify(workspace).includes("organization_id"), false);
  assert.equal(JSON.stringify(workspace).includes("lease_token"), false);
  assert.equal(JSON.stringify(workspace).includes("input_snapshot"), false);
  assert.equal(productionReads, 0);
});

test("operator workspace API hides foreign VideoPlan history when no current plan is selected", async (t) => {
  const marker = "FOREIGN_SECRET";
  const { app, auth } = await avatarOperatorWorld(t, {
    videoPlanning: true,
    downstreamStagePorts: {
      videoPlanningService: {
        async getWorkspace() {
          return {
            current_plan: null,
            head_revision: 0,
            versions: [{ id: "foreign-plan", organization_id: "org_other", product_id: "foreign-product",
              version_number: 1, status: "superseded", output_instructions: marker }],
            preflight: { current_run: null, current_result: null, history: [] },
            review: { current_review: null, history: [], gate: { can_submit: false, can_decide: false, reasons: ["plan_missing"] } }
          };
        }
      }
    }
  });
  const project = (await app.inject({ method: "POST", url: "/api/projects",
    headers: headers(auth, true, "foreign-plan-project"), payload: { name: "安全项目" } })).json().project;
  const product = (await app.inject({ method: "POST", url: `/api/projects/${project.id}/products`,
    headers: headers(auth, true, "foreign-plan-product"), payload: { product_name: "安全商品" } })).json().product;

  const response = await app.inject({ method: "GET",
    url: `/api/projects/${project.id}/products/${product.id}/operator-workspace?stage=video_plan`,
    headers: headers(auth) });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: "OPERATOR_WORKSPACE_NOT_FOUND" });
  assert.equal(response.body.includes(marker), false);
  assert.equal(response.body.includes("foreign-product"), false);
});

test("operator workspace API forwards the exact Stage 5 order and returns a safe Production projection", async (t) => {
  let received;
  const order = {
    id: "order-stage-5", organization_id: "org_test", product_id: null,
    video_plan_version_id: "plan-stage-5", execution_purpose: "first_production",
    status: "failed", row_version: 4
  };
  const { app, auth } = await operatorWorld(t, {
    operatorWorkspaceOptions: {
      productionService: {
        async getOperatorWorkspace(input) {
          received = input;
          const exactOrder = { ...order, product_id: input.productId };
          return {
            workspace: {
              current_plan: { id: "plan-stage-5", organization_id: input.organizationId,
                product_id: input.productId, status: "frozen" },
              gate: { can_create: false, reasons: ["existing_order"] },
              orders: [exactOrder],
              selected_order: exactOrder
            },
            packages: [{ id: "package-stage-5", production_order_id: exactOrder.id, status: "ready" }],
            execution: {
              order: exactOrder,
              current_attempt: { id: "attempt-stage-5", production_order_id: exactOrder.id, status: "failed" },
              attempts: [{ id: "attempt-stage-5", production_order_id: exactOrder.id, status: "failed" }], candidates: [],
              reports: [{ id: "report-stage-5", execution_attempt_id: "attempt-stage-5",
                production_order_id: exactOrder.id, report_version: 1, outcome: "failed" }]
            },
            verification: { order: exactOrder, job: null, work: null, works: [] },
            work: null,
            read_errors: []
          };
        }
      }
    }
  });
  const project = (await app.inject({ method: "POST", url: "/api/projects",
    headers: headers(auth, true, "stage-5-project"), payload: { name: "生产工作区" } })).json().project;
  const product = (await app.inject({ method: "POST", url: `/api/projects/${project.id}/products`,
    headers: headers(auth, true, "stage-5-product"), payload: { product_name: "生产商品" } })).json().product;

  const response = await app.inject({
    method: "GET",
    url: `/api/projects/${project.id}/products/${product.id}/operator-workspace?stage=production&orderId=order-stage-5`,
    headers: headers(auth)
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(received.orderId, "order-stage-5");
  assert.equal(received.productId, product.id);
  assert.equal(response.json().workspace.stages[4].business_status, "生产失败，已停止");
  assert.deepEqual(response.json().workspace.recommended_action, {
    code: "view_production_failure_details", stage: "production", kind: "focus"
  });
  for (const secret of ["organization_id", "input_snapshot", "lease_token", "storage_key"]) {
    assert.equal(response.body.includes(secret), false, secret);
  }
});

test("operator workspace API rejects a cross-attempt Production evidence chain without leaking markers", async (t) => {
  const marker = "FOREIGN_PRODUCTION_MARKER";
  const { app, auth } = await operatorWorld(t, {
    operatorWorkspaceOptions: {
      productionService: {
        async getOperatorWorkspace(input) {
          const order = { id: "order-exact", organization_id: input.organizationId, product_id: input.productId,
            video_plan_version_id: "plan-exact", execution_purpose: "first_production", status: "succeeded", row_version: 1 };
          const attempt = { id: "attempt-exact", production_order_id: order.id, status: "succeeded" };
          return {
            workspace: { current_plan: { id: "plan-exact", organization_id: input.organizationId,
              product_id: input.productId, status: "frozen" }, gate: { can_create: false, reasons: [] },
              orders: [order], selected_order: order },
            packages: [],
            execution: { order, current_attempt: attempt, attempts: [attempt], candidates: [], reports: [{
              id: "report-other", production_order_id: order.id, execution_attempt_id: "attempt-other",
              report_version: 1, outcome: "completed", failure_reason: marker
            }] },
            verification: { order, job: { id: "job-other", production_order_id: order.id,
              execution_attempt_id: "attempt-other", report_id: "report-other", verification_status: "passed" },
              work: null, works: [] }, work: null, read_errors: []
          };
        }
      }
    }
  });
  const project = (await app.inject({ method: "POST", url: "/api/projects",
    headers: headers(auth, true, "stage-5-binding-project"), payload: { name: "生产绑定" } })).json().project;
  const product = (await app.inject({ method: "POST", url: `/api/projects/${project.id}/products`,
    headers: headers(auth, true, "stage-5-binding-product"), payload: { product_name: "绑定商品" } })).json().product;

  const response = await app.inject({ method: "GET",
    url: `/api/projects/${project.id}/products/${product.id}/operator-workspace?stage=production&orderId=order-exact`,
    headers: headers(auth) });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: "OPERATOR_WORKSPACE_NOT_FOUND" });
  assert.equal(response.body.includes(marker), false);
});

test("operator workspace API rejects A12 and Work truth bound to a superseded execution report", async (t) => {
  const marker = "SUPERSEDED_REPORT_WORK_MARKER";
  let exactProjectId;
  const { app, auth } = await operatorWorld(t, {
    operatorWorkspaceOptions: {
      productionService: {
        async getOperatorWorkspace(input) {
          const order = { id: "order-report-head", organization_id: input.organizationId, product_id: input.productId,
            video_plan_version_id: "plan-report-head", execution_purpose: "first_production",
            status: "succeeded", row_version: 1 };
          const attempt = { id: "attempt-report-head", production_order_id: order.id, status: "succeeded" };
          const oldReport = { id: "report-v1", production_order_id: order.id,
            execution_attempt_id: attempt.id, report_version: 1, outcome: "completed" };
          const latestReport = { id: "report-v2", production_order_id: order.id,
            execution_attempt_id: attempt.id, report_version: 2, supersedes_report_id: oldReport.id,
            outcome: "completed", input_changed: true };
          const oldWork = { id: "work-v1", production_order_id: order.id, project_id: exactProjectId,
            product_id: input.productId, execution_attempt_id: attempt.id,
            manual_execution_report_id: oldReport.id, delivery_status: "pending_review", marker };
          return {
            workspace: { current_plan: { id: "plan-report-head", organization_id: input.organizationId,
              product_id: input.productId, status: "frozen" }, gate: { can_create: false, reasons: [] },
              orders: [order], selected_order: order },
            packages: [],
            execution: { order, current_attempt: attempt, attempts: [attempt], candidates: [],
              reports: [latestReport, oldReport] },
            verification: { order, job: { id: "job-v1", production_order_id: order.id,
              execution_attempt_id: attempt.id, report_id: oldReport.id, verification_status: "passed" },
              work: oldWork, works: [oldWork] },
            work: oldWork,
            read_errors: []
          };
        }
      }
    }
  });
  const project = (await app.inject({ method: "POST", url: "/api/projects",
    headers: headers(auth, true, "stage-5-report-head-project"), payload: { name: "报告头绑定" } })).json().project;
  exactProjectId = project.id;
  const product = (await app.inject({ method: "POST", url: `/api/projects/${project.id}/products`,
    headers: headers(auth, true, "stage-5-report-head-product"), payload: { product_name: "报告头商品" } })).json().product;

  const response = await app.inject({ method: "GET",
    url: `/api/projects/${project.id}/products/${product.id}/operator-workspace?stage=production&orderId=order-report-head`,
    headers: headers(auth) });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.json(), { error: "OPERATOR_WORKSPACE_NOT_FOUND" });
  assert.equal(response.body.includes(marker), false);
});

test("operator workspace API rejects cross-organization execution and verification orders before public stripping", async (t) => {
  const marker = "FOREIGN_CHILD_ORDER_MARKER";
  let foreignChild = "execution";
  const { app, auth } = await operatorWorld(t, { operatorWorkspaceOptions: { productionService: {
    async getOperatorWorkspace(input) {
      const order = { id: "order-child-org", organization_id: input.organizationId, product_id: input.productId,
        video_plan_version_id: "plan-child-org", execution_purpose: "first_production", status: "running", row_version: 1 };
      const foreignOrder = { ...order, organization_id: "org-foreign", failure_reason: marker };
      const attempt = { id: "attempt-child-org", production_order_id: order.id, status: "running" };
      return {
        workspace: { current_plan: { id: "plan-child-org", organization_id: input.organizationId,
          product_id: input.productId, status: "frozen" }, gate: { can_create: false, reasons: [] },
          orders: [order], selected_order: order }, packages: [],
        execution: { order: foreignChild === "execution" ? foreignOrder : order,
          current_attempt: attempt, attempts: [attempt], candidates: [], reports: [] },
        verification: { order: foreignChild === "verification" ? foreignOrder : order,
          job: null, work: null, works: [] }, work: null, read_errors: []
      };
    }
  } } });
  const project = (await app.inject({ method: "POST", url: "/api/projects",
    headers: headers(auth, true, "stage-5-child-org-project"), payload: { name: "子对象组织绑定" } })).json().project;
  const product = (await app.inject({ method: "POST", url: `/api/projects/${project.id}/products`,
    headers: headers(auth, true, "stage-5-child-org-product"), payload: { product_name: "组织绑定商品" } })).json().product;

  for (const child of ["execution", "verification"]) {
    foreignChild = child;
    const response = await app.inject({ method: "GET",
      url: `/api/projects/${project.id}/products/${product.id}/operator-workspace?stage=production&orderId=order-child-org`,
      headers: headers(auth) });
    assert.equal(response.statusCode, 404, child);
    assert.deepEqual(response.json(), { error: "OPERATOR_WORKSPACE_NOT_FOUND" });
    assert.equal(response.body.includes(marker), false);
  }
});

test("operator workspace default App wiring reads the existing Production and handoff services", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hifly-operator-production-default-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const identityRepository = createMemoryIdentityRepository();
  await seedInitialAdmin(identityRepository, { organizationId: "org_test", organizationName: "Test Organization",
    adminEmail: "admin@example.test", adminDisplayName: "Test Admin", adminTempPassword: "Temporary-Admin-9!" });
  let productId;
  const app = await buildApp({ root, executor: createFakeExecutor(),
    identity: { enabled: true, repository: identityRepository, trustedHosts: ["app.test"],
      trustedOrigins: ["https://app.test"], cookieSecure: false, seed: { enabled: false } },
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort },
    operatorWorkspace: { enabled: true },
    videoPlanning: { enabled: true, repository: createMemoryVideoPlanningRepository(), worker: { autoStart: false },
      upstreamPort: { async resolveCurrent() { return null; } }, capabilitySnapshotPort: { async resolve() { return null; } },
      agentReadinessPort: { async isOnline() { return false; } } },
    productionOrders: { enabled: true, repository: createMemoryProductionOrderRepository(),
      planPort: { async resolveCurrentApprovedPlan({ organizationId, productId: requestedProductId }) {
        if (organizationId !== "org_test" || requestedProductId !== productId) return null;
        return { current_valid: true, gate: { can_create: true, reasons: [] },
          plan: { id: "plan-default-stage-5", organization_id: organizationId, product_id: requestedProductId,
            status: "frozen", version_number: 1, upstream_snapshot: {}, capability_config_snapshot: {}, output_instructions: "视频方案" },
          plan_review: { id: "review-default-stage-5", status: "approved" },
          preflight_result: { id: "preflight-default-stage-5", status: "passed" } };
      } }, inputSnapshotPort: { async freezeForOrder() { return {}; } },
      agentReadinessPort: { async isOnline() { return false; } } },
    manualHandoff: { enabled: true, repository: createMemoryManualHandoffRepository(),
      packageStore: createMemoryManualHandoffPackageStore(), worker: { autoStart: false } }
  });
  t.after(() => app.close());
  const auth = await activateAdmin(app);
  const actor = { organizationId: "org_test", actorMemberId: auth.body.member.id, actorRole: "admin" };
  const project = await app.projectContent.service.createProject({ ...actor, idempotencyKey: "default-stage-5-project",
    name: "默认生产装配" });
  const ready = await readyOperatorProduct(app.projectContent.service, actor, project.id, "default-stage-5-product", "生产商品");
  productId = ready.product.id;
  const created = await app.productionOrders.service.createProductionOrder({ ...actor, productId,
    executionPurpose: "first_production", idempotencyKey: "default-stage-5-order" });

  const response = await app.inject({ method: "GET",
    url: `/api/projects/${project.id}/products/${productId}/operator-workspace?stage=production&orderId=${created.order.id}`,
    headers: headers(auth) });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json().workspace.render_mode, "workspace");
  assert.equal(response.json().workspace.stages[4].business_status, "生产交接资料待生成");
  assert.equal(response.json().workspace.recommended_action.code, "generate_handoff_package");

  const terminalOrder = { ...created.order, status: "succeeded" };
  const attempt = { id: "attempt-default-stage-5", production_order_id: terminalOrder.id, status: "succeeded" };
  const report = { id: "report-default-stage-5", production_order_id: terminalOrder.id,
    execution_attempt_id: attempt.id, report_version: 1, outcome: "completed" };
  const job = { id: "job-default-stage-5", production_order_id: terminalOrder.id,
    execution_attempt_id: attempt.id, report_id: report.id, status: "succeeded", verification_status: "passed" };
  const work = { id: "work-default-stage-5", organization_id: actor.organizationId,
    production_order_id: terminalOrder.id, execution_attempt_id: attempt.id,
    manual_execution_report_id: report.id, status: "available" };
  let handoffReads = 0;
  app.productionOrders.service.getWorkspace = async () => ({
    current_plan: { id: "plan-default-stage-5", organization_id: actor.organizationId,
      product_id: productId, status: "frozen" }, gate: { can_create: false, reasons: [] },
    orders: [terminalOrder], selected_order: terminalOrder
  });
  app.manualHandoff.service.listPackages = async () => {
    handoffReads += 1;
    return [{ id: "package-default-stage-5", production_order_id: terminalOrder.id, status: "ready" }];
  };
  app.manualExecution = { service: { async getExecutionWorkspace() {
    return { order: terminalOrder, current_attempt: attempt, attempts: [attempt], candidates: [], reports: [report] };
  } } };
  app.artifactVerification = { service: { async getVerificationWorkspace() {
    return { order: terminalOrder, job, work, works: [work] };
  } } };
  const deliveryRepository = createMemoryWorkDeliveryRepository();
  app.workDelivery = { service: createWorkDeliveryService({ repository: deliveryRepository,
    workPort: { async listWorks() { return [work]; }, async getWork(_organizationId, workId) {
      return workId === work.id ? work : null;
    } }, orderPort: { async getOrder() {
      return { ...terminalOrder, input_snapshot: { product_revision_snapshot: { project_id: project.id } } };
    } } }) };

  const runningOrder = { ...terminalOrder, status: "running" };
  const verificationAction = { ...job, verification_status: "requires_action" };
  app.productionOrders.service.getWorkspace = async () => ({
    current_plan: { id: "plan-default-stage-5", organization_id: actor.organizationId,
      product_id: productId, status: "frozen" }, gate: { can_create: false, reasons: [] },
    orders: [runningOrder], selected_order: runningOrder
  });
  app.manualExecution.service.getExecutionWorkspace = async () => ({
    order: runningOrder, current_attempt: attempt, attempts: [attempt], candidates: [], reports: [report]
  });
  app.artifactVerification.service.getVerificationWorkspace = async () => ({
    order: runningOrder, job: verificationAction, work: null, works: []
  });
  const verificationActionResponse = await app.inject({ method: "GET",
    url: `/api/projects/${project.id}/products/${productId}/operator-workspace?stage=production&orderId=${runningOrder.id}`,
    headers: headers(auth) });
  assert.equal(verificationActionResponse.statusCode, 200, verificationActionResponse.body);
  assert.equal(verificationActionResponse.json().workspace.stages[4].business_status, "作品文件核验需要处理");
  assert.equal(verificationActionResponse.json().workspace.recommended_action.code, "view_verification_details");

  app.artifactVerification.service.getVerificationWorkspace = async () => ({
    order: terminalOrder, job, work, works: [work]
  });
  const mixedGeneration = await app.inject({ method: "GET",
    url: `/api/projects/${project.id}/products/${productId}/operator-workspace?stage=production&orderId=${runningOrder.id}`,
    headers: headers(auth) });
  assert.equal(mixedGeneration.statusCode, 200, mixedGeneration.body);
  assert.equal(mixedGeneration.json().workspace.stages[4].business_status, "生产状态已变化，请刷新");
  assert.equal(mixedGeneration.json().workspace.recommended_action.code, "retry_production_read");
  assert.equal(mixedGeneration.json().workspace.stages[4].production.verification.job, null);
  assert.equal(mixedGeneration.json().workspace.stages[4].production.work, null);

  app.artifactVerification.service.getVerificationWorkspace = async () => ({
    order: terminalOrder, job, work, works: [work]
  });
  app.productionOrders.service.getWorkspace = async () => ({
    current_plan: { id: "plan-default-stage-5", organization_id: actor.organizationId,
      product_id: productId, status: "frozen" }, gate: { can_create: false, reasons: [] },
    orders: [terminalOrder], selected_order: terminalOrder
  });
  app.manualExecution.service.getExecutionWorkspace = async () => ({
    order: terminalOrder, current_attempt: attempt, attempts: [attempt], candidates: [], reports: [report]
  });

  for (const stage of ["production", "product_content"]) {
    const terminal = await app.inject({ method: "GET",
      url: `/api/projects/${project.id}/products/${productId}/operator-workspace?stage=${stage}&orderId=${terminalOrder.id}`,
      headers: headers(auth) });
    assert.equal(terminal.statusCode, 200, terminal.body);
    assert.equal(terminal.json().workspace.stages[4].production.package.status, "ready");
    assert.equal(terminal.json().workspace.stages[4].production.work.delivery_status, "pending_review");
  }
  assert.equal(handoffReads, 4);
  assert.equal(deliveryRepository._records.inspections.size, 0);
  assert.equal(deliveryRepository._records.audits.length, 0);
  assert.equal(deliveryRepository._records.ledger.length, 0);

  let verificationReadsAfterExecutionFailure = 0;
  let workReadsAfterExecutionFailure = 0;
  app.manualExecution.service.getExecutionWorkspace = async () => {
    throw new Error("transient execution read failure");
  };
  app.artifactVerification.service.getVerificationWorkspace = async () => {
    verificationReadsAfterExecutionFailure += 1;
    return { order: terminalOrder, job, work, works: [work] };
  };
  app.workDelivery.service.getWorkProjection = async () => {
    workReadsAfterExecutionFailure += 1;
    return { ...work, delivery_status: "pending_review" };
  };
  const executionFailure = await app.inject({ method: "GET",
    url: `/api/projects/${project.id}/products/${productId}/operator-workspace?stage=production&orderId=${terminalOrder.id}`,
    headers: headers(auth) });
  assert.equal(executionFailure.statusCode, 200, executionFailure.body);
  assert.equal(executionFailure.json().workspace.stages[4].business_status, "生产执行状态读取失败");
  assert.equal(executionFailure.json().workspace.recommended_action.code, "retry_production_read");
  assert.equal(executionFailure.json().workspace.stages[4].production.verification.job, null);
  assert.equal(executionFailure.json().workspace.stages[4].production.work, null);
  assert.equal(verificationReadsAfterExecutionFailure, 0);
  assert.equal(workReadsAfterExecutionFailure, 0);
});

test("operator workspace Production read failures return a safe 503 envelope", async (t) => {
  const { app, auth } = await operatorWorld(t, { operatorWorkspaceOptions: { productionService: {
    async getOperatorWorkspace() {
      throw Object.assign(new Error("sensitive production read failed"), {
        token: "must-not-leak", provider_url: "https://provider.invalid/private"
      });
    }
  } } });
  const project = (await app.inject({ method: "POST", url: "/api/projects",
    headers: headers(auth, true, "stage-5-error-project"), payload: { name: "生产读取错误" } })).json().project;
  const product = (await app.inject({ method: "POST", url: `/api/projects/${project.id}/products`,
    headers: headers(auth, true, "stage-5-error-product"), payload: { product_name: "安全商品" } })).json().product;

  const response = await app.inject({ method: "GET",
    url: `/api/projects/${project.id}/products/${product.id}/operator-workspace?stage=production`,
    headers: headers(auth) });
  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), { error: "OPERATOR_WORKSPACE_UNAVAILABLE" });
  assert.equal(response.body.includes("sensitive"), false);
  assert.equal(response.body.includes("must-not-leak"), false);
  assert.equal(response.body.includes("provider.invalid"), false);
});
