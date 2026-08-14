import assert from "node:assert/strict";
import test from "node:test";

import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
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

test("project content is disabled by default and reported by runtime", async (t) => {
  const { app } = await identityApp(t);
  const auth = await activateAdmin(app);
  const runtime = await app.inject({ method: "GET", url: "/api/runtime", headers: headers(auth) });
  assert.equal(runtime.json().projectContentEnabled, false);
  assert.equal((await app.inject({ method: "GET", url: "/api/projects", headers: headers(auth) })).statusCode, 404);
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
    payload: { expected_revision: revision.revision_number, product_name: "云朵抱枕", selling_points: [{ text: "柔软亲肤" }], asset_version_ids: ["asset-version-1"], content_brief: { expression_style: "自然口语" } }
  });
  assert.equal(saved.statusCode, 200, saved.body);
  revision = saved.json().revision;
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
