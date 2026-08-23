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

async function world(t) {
  const repository = createMemoryProjectContentRepository();
  const result = await identityApp(t, { projectContent: { enabled: true, repository, assetReferencePort } });
  return { ...result, repository, auth: await activateAdmin(result.app) };
}

async function operatorWorld(t, { repository = createMemoryProjectContentRepository() } = {}) {
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
    operatorWorkspace: { enabled: true },
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
