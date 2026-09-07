import assert from "node:assert/strict";
import test from "node:test";

import { createControlledCopyProvider } from "../src/copy-generation/controlled-provider.js";
import { createMemoryCopyGenerationRepository } from "../src/copy-generation/memory-copy-generation-repository.js";
import { createMemoryCopyQualityRepository } from "../src/copy-quality/memory-copy-quality-repository.js";
import { createMemoryCopyReviewRepository } from "../src/copy-review/memory-copy-review-repository.js";
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

test("authenticated user can enter one manual copy and complete local QC plus explicit human review", async (t) => {
  let providerCalls = 0;
  const copyRepository = createMemoryCopyGenerationRepository();
  const { app } = await identityApp(t, {
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort },
    copyGeneration: {
      enabled: true,
      repository: copyRepository,
      provider: createControlledCopyProvider({ generate: async () => { providerCalls += 1; return { body: "不应生成" }; } }),
      worker: { autoStart: false }
    },
    copyQuality: { enabled: true, repository: createMemoryCopyQualityRepository(), worker: { autoStart: false } },
    copyReview: { enabled: true, repository: createMemoryCopyReviewRepository() }
  });
  const auth = await activateAdmin(app);
  const ready = await readyProductRevision(app, auth);
  const mutationHeaders = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  const manualRequest = (key, payload = { body: "这款商品全网最好，适合日常使用。" }) => app.inject({
    method: "POST", url: `/api/product-revisions/${ready.id}/copy-versions`,
    headers: { ...mutationHeaders, "idempotency-key": key }, payload
  });

  const [created, replay] = await Promise.all([manualRequest("manual-api-1"), manualRequest("manual-api-1")]);
  assert.equal(created.statusCode, 201, created.body);
  assert.equal(replay.statusCode, 201, replay.body);
  const copy = created.json().copy_version;
  assert.equal(replay.json().copy_version.id, copy.id);
  assert.equal(copy.status, "draft");
  assert.equal(copy.intent, "manual_input");
  assert.equal(copy.generation_job_id, null);
  assert.equal(copy.parent_copy_version_id, null);
  assert.equal(providerCalls, 0);
  assert.deepEqual((await (await app.inject({ method: "GET", url: `/api/product-revisions/${ready.id}/copy-generation-jobs`, headers: identityHeaders({ cookies: auth.cookies }) })).json()).jobs, []);

  const forgedManualGeneration = await app.inject({ method: "POST", url: `/api/product-revisions/${ready.id}/copy-generations`,
    headers: { ...mutationHeaders, "idempotency-key": "manual-api-forged-generation" }, payload: { intent: "manual_input" } });
  assert.equal(forgedManualGeneration.statusCode, 400);
  assert.equal(forgedManualGeneration.json().error, "COPY_GENERATION_INTENT_INVALID");

  const changedKey = await manualRequest("manual-api-1", { body: "同一幂等键不能替换正文" });
  assert.equal(changedKey.statusCode, 409);
  assert.equal(changedKey.json().error, "IDEMPOTENCY_CONFLICT");
  const extraField = await manualRequest("manual-api-extra", { body: copy.body, status: "approved" });
  assert.equal(extraField.statusCode, 400);
  assert.equal(extraField.json().error, "COPY_MANUAL_INPUT_PAYLOAD_INVALID");
  const wrongType = await app.inject({ method: "POST", url: `/api/product-revisions/${ready.id}/copy-versions`, headers: { ...mutationHeaders, "idempotency-key": "manual-api-type" }, payload: { body: 1 } });
  assert.equal(wrongType.statusCode, 400);
  assert.equal(wrongType.json().error, "COPY_MANUAL_INPUT_PAYLOAD_INVALID");
  const oversized = await manualRequest("manual-api-large", { body: "x".repeat(10_001) });
  assert.equal(oversized.statusCode, 400);
  assert.equal(oversized.json().error, "COPY_BODY_TOO_LARGE");

  const started = await app.inject({ method: "POST", url: `/api/copy-versions/${copy.id}/quality-runs`,
    headers: { ...mutationHeaders, "idempotency-key": "manual-api-quality" }, payload: { expected_revision: copy.row_version } });
  assert.equal(started.statusCode, 202, started.body);
  assert.equal(started.json().copy_version.status, "frozen");
  assert.equal(started.json().quality_run.rule_version, "manual_input_local_rules");
  await app.copyQuality.worker.runNext();
  const details = await app.inject({ method: "GET", url: `/api/quality-runs/${started.json().quality_run.id}`, headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(details.statusCode, 200, details.body);
  const quality = details.json();
  assert.equal(quality.quality_result.conclusion, "needs_review");
  assert.equal(quality.quality_result.rule_version, "manual_input_local_rules");
  assert.equal(quality.quality_findings.length, 1);
  assert.equal(quality.quality_findings[0].code, "MANUAL_SEMANTIC_REVIEW_REQUIRED");
  assert.equal(providerCalls, 0);

  const findingId = quality.quality_findings[0].id;
  const resolved = await app.inject({ method: "POST", url: `/api/quality-findings/${findingId}/resolutions`,
    headers: { ...mutationHeaders, "idempotency-key": "manual-api-resolution" },
    payload: { resolution: "accepted_with_reason", reason: "负责人已核对商品事实与表达边界" } });
  assert.equal(resolved.statusCode, 200, resolved.body);
  assert.equal(resolved.json().quality_result.effective_conclusion, "passed");

  const submitted = await app.inject({ method: "POST", url: `/api/copy-versions/${copy.id}/reviews`,
    headers: { ...mutationHeaders, "idempotency-key": "manual-api-review-submit" }, payload: {} });
  assert.equal(submitted.statusCode, 201, submitted.body);
  assert.equal(submitted.json().current_review.status, "pending");
  const review = submitted.json().current_review;
  const approved = await app.inject({ method: "POST", url: `/api/copy-reviews/${review.id}/approve`,
    headers: { ...mutationHeaders, "idempotency-key": "manual-api-review-approve" }, payload: { expected_revision: review.row_version } });
  assert.equal(approved.statusCode, 200, approved.body);
  assert.equal(approved.json().current_review.status, "approved");
  assert.equal(approved.json().current_review.review_mode, "self_review");
  assert.equal(providerCalls, 0);
});
