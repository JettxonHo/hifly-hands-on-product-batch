import assert from "node:assert/strict";
import test from "node:test";

import { createControlledCopyProvider } from "../src/copy-generation/controlled-provider.js";
import { createMemoryCopyGenerationRepository } from "../src/copy-generation/memory-copy-generation-repository.js";
import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { activateAdmin, identityApp, identityHeaders, login } from "./helpers/identity-world.js";

const assetReferencePort = {
  async bindAvailableVersion({ organizationId, assetVersionId, referenceId, role }) {
    return { reference: { organization_id: organizationId, asset_version_id: assetVersionId, reference_id: referenceId, role } };
  }
};

async function readyProductRevision(app, auth) {
  const headers = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  const project = (await app.inject({ method: "POST", url: "/api/projects", headers: { ...headers, "idempotency-key": "copy-api-project" }, payload: { name: "文案项目" } })).json().project;
  const created = (await app.inject({ method: "POST", url: `/api/projects/${project.id}/products`, headers: { ...headers, "idempotency-key": "copy-api-product" }, payload: { product_name: "云朵抱枕" } })).json();
  let revision = (await app.inject({ method: "PATCH", url: `/api/product-revisions/${created.revision.id}`, headers, payload: {
    expected_revision: 1, product_name: "云朵抱枕", product_description: "办公室午休使用",
    primary_category: "home", content_brief: { expression_style: "自然分享" },
    selling_points: [{ text: "柔软亲肤" }], asset_version_ids: ["asset_available_1"]
  } })).json().revision;
  revision = (await app.inject({ method: "POST", url: `/api/product-revisions/${revision.id}/selling-points/${revision.selling_points[0].id}/confirm`, headers, payload: { expected_revision: revision.revision_number } })).json().revision;
  return (await app.inject({ method: "POST", url: `/api/product-revisions/${revision.id}/ready`, headers: { ...headers, "idempotency-key": "copy-api-ready" }, payload: { expected_revision: revision.revision_number } })).json().revision;
}

test("authenticated user generates and restores copy through formal HTTP API", async (t) => {
  const copyRepository = createMemoryCopyGenerationRepository();
  const { app, repository: identityRepository } = await identityApp(t, {
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort },
    copyGeneration: { enabled: true, repository: copyRepository, provider: createControlledCopyProvider(), worker: { autoStart: false } }
  });
  const auth = await activateAdmin(app);
  const ready = await readyProductRevision(app, auth);
  const mutationHeaders = { ...identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true }), "idempotency-key": "copy-api-generate" };

  const requested = await app.inject({ method: "POST", url: `/api/product-revisions/${ready.id}/copy-generations`, headers: mutationHeaders, payload: { intent: "product_recommendation" } });
  assert.equal(requested.statusCode, 202);
  assert.equal(requested.json().job.status, "queued");
  const replay = await app.inject({ method: "POST", url: `/api/product-revisions/${ready.id}/copy-generations`, headers: mutationHeaders, payload: { intent: "product_recommendation" } });
  assert.equal(replay.json().job.id, requested.json().job.id);
  const conflict = await app.inject({ method: "POST", url: `/api/product-revisions/${ready.id}/copy-generations`, headers: mutationHeaders, payload: { intent: "short_rewrite" } });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error, "IDEMPOTENCY_CONFLICT");
  const runningState = await app.inject({ method: "GET", url: `/api/product-revisions/${ready.id}/copy-generation-jobs`, headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(runningState.statusCode, 200);
  assert.deepEqual(runningState.json().jobs.map((job) => job.id), [requested.json().job.id]);

  await app.copyGeneration.worker.runNext();

  const job = await app.inject({ method: "GET", url: `/api/copy-generation-jobs/${requested.json().job.id}`, headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(job.statusCode, 200);
  assert.equal(job.json().job.status, "succeeded");
  const listed = await app.inject({ method: "GET", url: `/api/product-revisions/${ready.id}/copy-versions`, headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.json().copy_versions.length, 1);
  assert.equal(listed.json().copy_versions[0].status, "draft");
  assert.equal("input_snapshot" in job.json().job, false);

  const copy = listed.json().copy_versions[0];
  const staleEdit = await app.inject({ method: "PATCH", url: `/api/copy-versions/${copy.id}`, headers: mutationHeaders, payload: { expected_revision: 99, body: "旧页面覆盖" } });
  assert.equal(staleEdit.statusCode, 409);
  const edited = await app.inject({ method: "PATCH", url: `/api/copy-versions/${copy.id}`, headers: mutationHeaders, payload: { expected_revision: copy.row_version, body: "人工调整文案" } });
  const frozen = await app.inject({ method: "POST", url: `/api/copy-versions/${copy.id}/freeze`, headers: { ...mutationHeaders, "idempotency-key": "copy-api-freeze" }, payload: { expected_revision: edited.json().copy_version.row_version } });
  assert.equal(frozen.json().copy_version.status, "frozen");
  const child = await app.inject({ method: "PATCH", url: `/api/copy-versions/${copy.id}`, headers: mutationHeaders, payload: { expected_revision: frozen.json().copy_version.row_version, body: "冻结后的新草稿" } });
  assert.equal(child.json().copy_version.parent_copy_version_id, copy.id);

  const anonymous = await app.inject({ method: "GET", url: `/api/copy-versions/${copy.id}`, headers: { host: "app.test" } });
  assert.equal(anonymous.statusCode, 401);
  await seedInitialAdmin(identityRepository, { organizationId: "org_other", organizationName: "Other", adminEmail: "other@example.test", adminDisplayName: "Other Admin", adminTempPassword: "Temporary-Other-9!" });
  const otherLogin = await login(app, { email: "other@example.test", password: "Temporary-Other-9!" });
  const otherActivated = await app.inject({ method: "POST", url: "/api/auth/change-password", headers: identityHeaders({ cookies: otherLogin.cookies, csrf: otherLogin.csrf, mutation: true }), payload: { new_password: "Other-Permanent-Password-9!" } });
  assert.equal(otherActivated.statusCode, 200);
  const otherHeaders = identityHeaders({ cookies: otherLogin.cookies });
  assert.equal((await app.inject({ method: "GET", url: `/api/copy-versions/${copy.id}`, headers: otherHeaders })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: `/api/copy-generation-jobs/${requested.json().job.id}`, headers: otherHeaders })).statusCode, 404);
  assert.ok((await copyRepository.listAuditEvents()).some((event) => event.event_type === "copy.generation_succeeded"));
});
