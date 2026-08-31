import assert from "node:assert/strict";
import test from "node:test";

import { createControlledCopyProvider } from "../src/copy-generation/controlled-provider.js";
import { createMemoryCopyGenerationRepository } from "../src/copy-generation/memory-copy-generation-repository.js";
import { createControlledQualityEvaluator } from "../src/copy-quality/controlled-evaluator.js";
import { createMemoryCopyQualityRepository } from "../src/copy-quality/memory-copy-quality-repository.js";
import { createMemoryProjectContentRepository } from "../src/project-content/memory-project-content-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { activateAdmin, identityApp, identityHeaders, login } from "./helpers/identity-world.js";

const assetReferencePort = { async bindAvailableVersion(input) { return { reference: input }; } };

async function seedCopy(app, auth) {
  const headers = identityHeaders({ cookies: auth.cookies, csrf: auth.csrf, mutation: true });
  const project = (await app.inject({ method: "POST", url: "/api/projects", headers: { ...headers, "idempotency-key": "qc-api-project" }, payload: { name: "质检项目" } })).json().project;
  const created = (await app.inject({ method: "POST", url: `/api/projects/${project.id}/products`, headers: { ...headers, "idempotency-key": "qc-api-product" }, payload: { product_name: "云朵抱枕" } })).json();
  let revision = (await app.inject({ method: "PATCH", url: `/api/product-revisions/${created.revision.id}`, headers, payload: {
    expected_revision: 1, product_name: "云朵抱枕", primary_category: "home",
    selling_points: [{ text: "柔软亲肤" }], asset_version_ids: ["asset_available_1"]
  } })).json().revision;
  revision = (await app.inject({ method: "POST", url: `/api/product-revisions/${revision.id}/selling-points/${revision.selling_points[0].id}/confirm`, headers, payload: { expected_revision: revision.revision_number } })).json().revision;
  revision = (await app.inject({ method: "POST", url: `/api/product-revisions/${revision.id}/ready`, headers: { ...headers, "idempotency-key": "qc-api-ready" }, payload: { expected_revision: revision.revision_number } })).json().revision;
  const generated = (await app.inject({ method: "POST", url: `/api/product-revisions/${revision.id}/copy-generations`, headers: { ...headers, "idempotency-key": "qc-api-generate" }, payload: { intent: "product_recommendation" } })).json();
  await app.copyGeneration.worker.runNext();
  const copy = (await app.inject({ method: "GET", url: `/api/product-revisions/${revision.id}/copy-versions`, headers: identityHeaders({ cookies: auth.cookies }) })).json().copy_versions[0];
  return { headers, revision, copy, generationJob: generated.job };
}

test("formal QC API restores async state, resolves findings, and isolates organizations", async (t) => {
  const qualityRepository = createMemoryCopyQualityRepository();
  const evaluator = createControlledQualityEvaluator({ async evaluate() { return { checks_complete: true, findings: [
    { code: "TONE_REVIEW", kind: "review", severity: "medium", title: "语气待判断",
      matched_text: "全网最好", message: "请人工判断语气", evidence_reference: "copy:text:12-16",
      rule_source: "brand_policy", suggestion: "改为有事实依据的体验描述" }
  ] }; } });
  const { app, repository: identityRepository } = await identityApp(t, {
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort },
    copyGeneration: { enabled: true, repository: createMemoryCopyGenerationRepository(), provider: createControlledCopyProvider(), worker: { autoStart: false } },
    copyQuality: { enabled: true, repository: qualityRepository, evaluator, worker: { autoStart: false } }
  });
  const auth = await activateAdmin(app);
  const seeded = await seedCopy(app, auth);
  const startHeaders = { ...seeded.headers, "idempotency-key": "qc-api-start" };
  const started = await app.inject({ method: "POST", url: `/api/copy-versions/${seeded.copy.id}/quality-runs`, headers: startHeaders,
    payload: { expected_revision: seeded.copy.row_version, profile_version: "commerce-cn-v1", rule_version: "rules-2026-08" } });
  assert.equal(started.statusCode, 202);
  assert.equal(started.json().copy_version.status, "frozen");
  assert.equal(started.json().quality_run.status, "queued");

  const concurrent = await app.inject({ method: "POST", url: `/api/copy-versions/${seeded.copy.id}/quality-runs`, headers: { ...seeded.headers, "idempotency-key": "qc-api-other-key" },
    payload: { expected_revision: started.json().copy_version.row_version, profile_version: "commerce-cn-v1", rule_version: "rules-2026-08" } });
  assert.equal(concurrent.json().quality_run.id, started.json().quality_run.id);
  await app.copyQuality.worker.runNext();

  const details = await app.inject({ method: "GET", url: `/api/quality-runs/${started.json().quality_run.id}`, headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(details.statusCode, 200);
  assert.equal(details.json().quality_result.conclusion, "needs_review");
  assert.equal("lease_token" in details.json().quality_run, false);
  const finding = details.json().quality_findings[0];
  assert.deepEqual({ severity: finding.severity, matched_text: finding.matched_text,
    evidence_reference: finding.evidence_reference, rule_source: finding.rule_source, suggestion: finding.suggestion },
  { severity: "medium", matched_text: "全网最好", evidence_reference: "copy:text:12-16",
    rule_source: "brand_policy", suggestion: "改为有事实依据的体验描述" });
  const rewriteRequest = { method: "POST", url: `/api/copy-versions/${seeded.copy.id}/rewrite-jobs`,
    headers: { ...seeded.headers, "idempotency-key": "qc-api-rewrite" },
    payload: { finding_id: finding.id, scope: "matched_text", instruction: "保留卖点，改成可验证的体验表达" } };
  const [rewrite, rewriteReplay] = await Promise.all([app.inject(rewriteRequest), app.inject(rewriteRequest)]);
  assert.equal(rewrite.statusCode, 202);
  assert.equal(rewriteReplay.json().rewrite_job.id, rewrite.json().rewrite_job.id);
  assert.equal(rewrite.json().rewrite_job.status, "queued");
  assert.equal(rewrite.json().rewrite_job.instruction, "保留卖点，改成可验证的体验表达");
  assert.equal("lease_token" in rewrite.json().rewrite_job, false);
  assert.equal("rewritten_body" in rewrite.json().rewrite_job, false);
  const restored = await app.inject({ method: "GET", url: `/api/rewrite-jobs/${rewrite.json().rewrite_job.id}`,
    headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(restored.statusCode, 200);
  assert.equal(restored.json().rewrite_job.status, "queued");
  const listedRewrite = await app.inject({ method: "GET", url: `/api/copy-versions/${seeded.copy.id}/rewrite-jobs`,
    headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(listedRewrite.json().rewrite_jobs.length, 1);
  assert.equal(listedRewrite.json().rewrite_jobs[0].id, rewrite.json().rewrite_job.id);
  await app.copyQuality.rewriteWorker.runNext();
  const completedRewrite = await app.inject({ method: "GET", url: `/api/rewrite-jobs/${rewrite.json().rewrite_job.id}`,
    headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(completedRewrite.json().rewrite_job.status, "succeeded");
  assert.equal(completedRewrite.json().copy_version.parent_copy_version_id, seeded.copy.id);
  assert.equal(completedRewrite.json().quality_run.status, "queued");
  const missingReason = await app.inject({ method: "POST", url: `/api/quality-findings/${finding.id}/resolutions`, headers: { ...seeded.headers, "idempotency-key": "qc-api-empty-reason" }, payload: { resolution: "accepted_with_reason", reason: "" } });
  assert.equal(missingReason.statusCode, 400);
  const resolved = await app.inject({ method: "POST", url: `/api/quality-findings/${finding.id}/resolutions`, headers: { ...seeded.headers, "idempotency-key": "qc-api-resolve" }, payload: { resolution: "accepted_with_reason", reason: "符合品牌表达规范" } });
  assert.equal(resolved.statusCode, 200);
  assert.equal(resolved.json().quality_result.conclusion, "needs_review");
  assert.equal(resolved.json().quality_result.effective_conclusion, "passed");

  await seedInitialAdmin(identityRepository, { organizationId: "org_qc_other", organizationName: "Other", adminEmail: "qc-other@example.test", adminDisplayName: "Other Admin", adminTempPassword: "Temporary-Other-9!" });
  const other = await login(app, { email: "qc-other@example.test", password: "Temporary-Other-9!" });
  await app.inject({ method: "POST", url: "/api/auth/change-password", headers: identityHeaders({ cookies: other.cookies, csrf: other.csrf, mutation: true }), payload: { new_password: "Other-Permanent-Password-9!" } });
  assert.equal((await app.inject({ method: "GET", url: `/api/quality-runs/${started.json().quality_run.id}`, headers: identityHeaders({ cookies: other.cookies }) })).statusCode, 404);
  assert.equal((await app.inject({ method: "GET", url: `/api/rewrite-jobs/${rewrite.json().rewrite_job.id}`, headers: identityHeaders({ cookies: other.cookies }) })).statusCode, 404);
  assert.ok((await qualityRepository.listAuditEvents()).some((event) => event.event_type === "copy.quality_finding_resolved"));
});

test("strict QC API projects one-attempt provider truth and forbids retry or second logical run", async (t) => {
  const qualityRepository = createMemoryCopyQualityRepository();
  let providerCalls = 0;
  const evaluator = {
    kind: "fake_provider",
    async evaluate({ providerRequest }) {
      await providerRequest({ providerName: "DeepSeek", providerKind: "deepseek_hybrid", model: "deepseek-v4-flash", execute: async () => {
        providerCalls += 1;
        if (providerCalls > 1) throw Object.assign(new Error("ambiguous provider failure"), { code: "DEEPSEEK_UNAVAILABLE" });
        return { choices: [{ message: { content: '{"findings":[]}' } }], usage: { prompt_tokens: 4, completion_tokens: 3, total_tokens: 7 }, secret: "must-not-project" };
      } });
      return { checks_complete: true, findings: [] };
    }
  };
  const { app } = await identityApp(t, {
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort },
    copyGeneration: { enabled: true, repository: createMemoryCopyGenerationRepository(), provider: createControlledCopyProvider(), worker: { autoStart: false } },
    copyQuality: { enabled: true, repository: qualityRepository, evaluator, worker: { autoStart: false } }
  });
  const auth = await activateAdmin(app);
  const seeded = await seedCopy(app, auth);
  const start = await app.inject({ method: "POST", url: `/api/copy-versions/${seeded.copy.id}/quality-runs`,
    headers: { ...seeded.headers, "idempotency-key": "strict-api-start" },
    payload: { expected_revision: seeded.copy.row_version } });
  assert.equal(start.statusCode, 202, start.body);
  const initial = start.json().quality_run;
  assert.equal(initial.attempt_policy, "provider_at_most_once_v1");
  assert.equal(initial.max_attempts, 1);
  assert.equal(initial.provider_dispatch_count, 0);
  assert.equal(initial.provider_http_request_count, 0);
  assert.equal(initial.provider_usage_status, "not_applicable");
  assert.equal(initial.provider_charge_status, "not_applicable");

  const duplicate = await app.inject({ method: "POST", url: `/api/copy-versions/${seeded.copy.id}/quality-runs`,
    headers: { ...seeded.headers, "idempotency-key": "strict-api-start-other" },
    payload: { expected_revision: start.json().copy_version.row_version } });
  assert.equal(duplicate.statusCode, 202, duplicate.body);
  assert.equal(duplicate.json().quality_run.id, initial.id);

  await app.copyQuality.worker.runNext();
  const details = await app.inject({ method: "GET", url: `/api/quality-runs/${initial.id}`,
    headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(details.statusCode, 200, details.body);
  const projected = details.json();
  assert.equal(projected.quality_run.provider_dispatch_count, 1);
  assert.equal(projected.quality_run.provider_http_request_count, 1);
  assert.equal(projected.quality_run.provider_usage_status, "reported");
  assert.equal(projected.quality_run.provider_input_tokens, 4);
  assert.equal(projected.quality_run.provider_output_tokens, 3);
  assert.equal(projected.quality_run.provider_total_tokens, 7);
  assert.equal(projected.quality_run.provider_charge_status, "unknown");
  assert.equal(JSON.stringify(projected).includes("must-not-project"), false);
  assert.equal(JSON.stringify(projected).includes("providerRequest"), false);
  assert.equal(JSON.stringify(projected).includes("secret"), false);
  assert.equal((await app.copyQuality.service.listQualityRuns({ organizationId: auth.body.organization.id,
    actorMemberId: auth.body.member.id, copyVersionId: seeded.copy.id })).length, 1);

  const currentCopy = await app.copyGeneration.service.getCopyVersion({ organizationId: auth.body.organization.id,
    actorMemberId: auth.body.member.id, copyVersionId: seeded.copy.id });
  const child = await app.copyGeneration.service.editCopyVersion({ organizationId: auth.body.organization.id,
    actorMemberId: auth.body.member.id, copyVersionId: currentCopy.id, expectedRevision: currentCopy.row_version,
    body: "严格 API 第二版文案" });
  const childStart = await app.inject({ method: "POST", url: `/api/copy-versions/${child.id}/quality-runs`,
    headers: { ...seeded.headers, "idempotency-key": "strict-api-failure" },
    payload: { expected_revision: child.row_version } });
  assert.equal(childStart.statusCode, 202, childStart.body);
  await app.copyQuality.worker.runNext();
  const childRetry = await app.inject({ method: "POST", url: `/api/quality-runs/${childStart.json().quality_run.id}/retry`,
    headers: { ...seeded.headers, "idempotency-key": "strict-api-retry" }, payload: {} });
  assert.equal(childRetry.statusCode, 409, childRetry.body);
  assert.equal(childRetry.json().error, "QUALITY_ONE_ATTEMPT_RETRY_BLOCKED");
  assert.equal(providerCalls, 2);
});

test("strict QC API rejects cancellation after a provider dispatch reservation", async (t) => {
  const qualityRepository = createMemoryCopyQualityRepository();
  const { app } = await identityApp(t, {
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort },
    copyGeneration: { enabled: true, repository: createMemoryCopyGenerationRepository(), provider: createControlledCopyProvider(), worker: { autoStart: false } },
    copyQuality: { enabled: true, repository: qualityRepository, worker: { autoStart: false } }
  });
  const auth = await activateAdmin(app);
  const seeded = await seedCopy(app, auth);
  const started = await app.inject({ method: "POST", url: `/api/copy-versions/${seeded.copy.id}/quality-runs`,
    headers: { ...seeded.headers, "idempotency-key": "strict-api-cancel-start" },
    payload: { expected_revision: seeded.copy.row_version } });
  assert.equal(started.statusCode, 202);
  const lease = await app.copyQuality.service.claimNextQualityRun({ leaseMs: 30_000 });
  await qualityRepository.beginProviderRequest({ runId: lease.id, leaseToken: lease.lease_token,
    providerName: "DeepSeek", providerKind: "deepseek_hybrid", model: "deepseek-v4-flash", now: new Date().toISOString() });
  const cancelled = await app.inject({ method: "POST", url: `/api/quality-runs/${lease.id}/cancel`, headers: seeded.headers, payload: {} });
  assert.equal(cancelled.statusCode, 409, cancelled.body);
  assert.equal(cancelled.json().error, "QUALITY_ONE_ATTEMPT_CANCEL_BLOCKED");
  const details = await app.inject({ method: "GET", url: `/api/quality-runs/${lease.id}`, headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(details.json().quality_run.status, "running");
  assert.equal(details.json().quality_run.provider_dispatch_count, 1);
  assert.equal(details.json().quality_run.provider_http_request_count, 0);
});

test("strict QC API refuses migrated legacy unknown runs and cannot retry them", async (t) => {
  const qualityRepository = createMemoryCopyQualityRepository();
  const { app } = await identityApp(t, {
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort },
    copyGeneration: { enabled: true, repository: createMemoryCopyGenerationRepository(), provider: createControlledCopyProvider(), worker: { autoStart: false } },
    copyQuality: { enabled: true, repository: qualityRepository, worker: { autoStart: false } }
  });
  const auth = await activateAdmin(app);
  const seeded = await seedCopy(app, auth);
  const legacyRun = { id: "legacy-api-unknown", organization_id: auth.body.organization.id, copy_version_id: seeded.copy.id,
    product_revision_id: seeded.revision.id, profile_version: "legacy-profile", rule_version: "legacy-rules", status: "failed",
    attempts: 1, max_attempts: 3, attempt_policy: "legacy", provider_request_state: "unknown",
    provider_request_outcome: "unknown", failure_code: "QUALITY_PROVIDER_OUTCOME_UNKNOWN" };
  await qualityRepository.createRun({ receiptKey: "legacy-api-unknown", fingerprint: "legacy-api-unknown", run: legacyRun,
    audit: { id: "legacy-api-unknown-audit", organization_id: auth.body.organization.id, event_type: "copy.quality_provider_outcome_unknown" } });

  const start = await app.inject({ method: "POST", url: `/api/copy-versions/${seeded.copy.id}/quality-runs`,
    headers: { ...seeded.headers, "idempotency-key": "strict-api-after-legacy-unknown" }, payload: { expected_revision: seeded.copy.row_version } });
  assert.equal(start.statusCode, 409, start.body);
  assert.equal(start.json().error, "QUALITY_ONE_ATTEMPT_LEGACY_OUTCOME_UNKNOWN");
  const retry = await app.inject({ method: "POST", url: `/api/quality-runs/${legacyRun.id}/retry`,
    headers: { ...seeded.headers, "idempotency-key": "legacy-api-unknown-retry" }, payload: {} });
  assert.equal(retry.statusCode, 409, retry.body);
  assert.equal(retry.json().error, "QUALITY_ONE_ATTEMPT_RETRY_BLOCKED");
  assert.equal((await app.copyQuality.service.listQualityRuns({ organizationId: auth.body.organization.id,
    actorMemberId: auth.body.member.id, copyVersionId: seeded.copy.id })).length, 1);
});

test("strict QC API owner-gates an invalid terminal result without a new retry", async (t) => {
  const qualityRepository = createMemoryCopyQualityRepository();
  const evaluator = { kind: "controlled_test_double", async evaluate() { return { checks_complete: false, findings: [] }; } };
  const { app } = await identityApp(t, {
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort },
    copyGeneration: { enabled: true, repository: createMemoryCopyGenerationRepository(), provider: createControlledCopyProvider(), worker: { autoStart: false } },
    copyQuality: { enabled: true, repository: qualityRepository, evaluator, worker: { autoStart: false } }
  });
  const auth = await activateAdmin(app);
  const seeded = await seedCopy(app, auth);
  const started = await app.inject({ method: "POST", url: `/api/copy-versions/${seeded.copy.id}/quality-runs`,
    headers: { ...seeded.headers, "idempotency-key": "strict-api-invalid-start" }, payload: { expected_revision: seeded.copy.row_version } });
  await app.copyQuality.worker.runNext();
  const details = await app.inject({ method: "GET", url: `/api/quality-runs/${started.json().quality_run.id}`,
    headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(details.json().quality_run.attempt_policy, "provider_at_most_once_v1");
  assert.equal(details.json().quality_run.max_attempts, 1);
  assert.equal(details.json().quality_result.effective_conclusion, "invalid");
  assert.equal(details.json().quality_run.provider_dispatch_count, 0);
  assert.equal(details.json().quality_run.provider_http_request_count, 0);
  const retry = await app.inject({ method: "POST", url: `/api/quality-runs/${started.json().quality_run.id}/retry`,
    headers: { ...seeded.headers, "idempotency-key": "strict-api-invalid-retry" }, payload: {} });
  assert.equal(retry.statusCode, 409, retry.body);
  assert.equal(retry.json().error, "QUALITY_ONE_ATTEMPT_RETRY_BLOCKED");
});

test("QC API uses server-owned policy and returns a stable stale-facts error", async (t) => {
  const qualityRepository = createMemoryCopyQualityRepository();
  const projectRepository = createMemoryProjectContentRepository();
  let policy = { profileVersion: "server-profile-v2", ruleVersion: "server-rules-v3" };
  const { app } = await identityApp(t, {
    projectContent: { enabled: true, repository: projectRepository, assetReferencePort },
    copyGeneration: { enabled: true, repository: createMemoryCopyGenerationRepository(), provider: createControlledCopyProvider(), worker: { autoStart: false } },
    copyQuality: { enabled: true, repository: qualityRepository,
      profileResolver: { async resolve() { return { ...policy }; } }, attemptPolicy: "legacy",
      worker: { autoStart: false, qualityMaxAttempts: 3, maxAttempts: 3 } }
  });
  const auth = await activateAdmin(app);
  const seeded = await seedCopy(app, auth);
  const started = await app.inject({ method: "POST", url: `/api/copy-versions/${seeded.copy.id}/quality-runs`,
    headers: { ...seeded.headers, "idempotency-key": "qc-server-policy" },
    payload: { expected_revision: seeded.copy.row_version, profile_version: "client-profile", rule_version: "client-rules" } });
  assert.equal(started.statusCode, 202);
  assert.equal(started.json().quality_run.profile_version, "server-profile-v2");
  assert.equal(started.json().quality_run.rule_version, "server-rules-v3");
  const queuedRewrite = await app.inject({ method: "POST", url: `/api/copy-versions/${seeded.copy.id}/rewrite-jobs`,
    headers: { ...seeded.headers, "idempotency-key": "qc-rewrite-before-stale" },
    payload: { scope: "full", instruction: "整体改得更自然" } });
  assert.equal(queuedRewrite.statusCode, 202);
  policy = { profileVersion: "server-profile-v3", ruleVersion: "server-rules-v4" };
  await app.copyQuality.worker.runNext();
  const policyFailed = await app.inject({ method: "GET", url: `/api/quality-runs/${started.json().quality_run.id}`,
    headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(policyFailed.json().quality_run.status, "failed");
  assert.equal(policyFailed.json().quality_run.failure_code, "COPY_QUALITY_POLICY_CHANGED");
  assert.equal(policyFailed.json().quality_result, null);
  const policyRetry = await app.inject({ method: "POST", url: `/api/quality-runs/${started.json().quality_run.id}/retry`,
    headers: { ...seeded.headers, "idempotency-key": "qc-policy-retry" }, payload: {} });
  assert.equal(policyRetry.statusCode, 202);
  assert.equal(policyRetry.json().quality_run.profile_version, "server-profile-v3");
  assert.equal(policyRetry.json().quality_run.rule_version, "server-rules-v4");

  let nextRevision = await app.projectContent.service.saveRevision({
    organizationId: auth.body.organization.id, actorMemberId: auth.body.member.id,
    productRevisionId: seeded.revision.id, expectedRevision: seeded.revision.revision_number,
    productName: "云朵抱枕升级版", sellingPoints: [{ text: "柔软亲肤" }], assetVersionIds: ["asset_available_1"]
  });
  assert.equal(nextRevision.status, "draft");
  nextRevision = await app.projectContent.service.confirmSellingPoint({
    organizationId: auth.body.organization.id, actorMemberId: auth.body.member.id,
    productRevisionId: nextRevision.id, pointId: nextRevision.selling_points[0].id,
    expectedRevision: nextRevision.revision_number
  });
  nextRevision = await app.projectContent.service.readyRevision({
    organizationId: auth.body.organization.id, actorMemberId: auth.body.member.id,
    productRevisionId: nextRevision.id, expectedRevision: nextRevision.revision_number,
    idempotencyKey: "qc-new-ready"
  });
  assert.equal(nextRevision.status, "ready");
  const stale = await app.inject({ method: "POST", url: `/api/copy-versions/${seeded.copy.id}/quality-runs`,
    headers: { ...seeded.headers, "idempotency-key": "qc-stale-facts" }, payload: { expected_revision: started.json().copy_version.row_version } });
  assert.equal(stale.statusCode, 422);
  assert.equal(stale.json().error, "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT");
  const staleRewriteStart = await app.inject({ method: "POST", url: `/api/copy-versions/${seeded.copy.id}/rewrite-jobs`,
    headers: { ...seeded.headers, "idempotency-key": "qc-rewrite-after-stale" },
    payload: { scope: "full", instruction: "整体改得更自然" } });
  assert.equal(staleRewriteStart.statusCode, 422);
  assert.equal(staleRewriteStart.json().error, "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT");
  await app.copyQuality.rewriteWorker.runNext();
  const staleRewrite = await app.inject({ method: "GET", url: `/api/rewrite-jobs/${queuedRewrite.json().rewrite_job.id}`,
    headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(staleRewrite.json().rewrite_job.status, "failed");
  assert.equal(staleRewrite.json().rewrite_job.failure_code, "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT");
  const staleRewriteRetry = await app.inject({ method: "POST", url: `/api/rewrite-jobs/${queuedRewrite.json().rewrite_job.id}/retry`,
    headers: { ...seeded.headers, "idempotency-key": "qc-rewrite-stale-retry" }, payload: {} });
  assert.equal(staleRewriteRetry.statusCode, 422);
  assert.equal(staleRewriteRetry.json().error, "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT");
  await app.copyQuality.worker.runNext();
  const staleQueued = await app.inject({ method: "GET", url: `/api/quality-runs/${policyRetry.json().quality_run.id}`,
    headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(staleQueued.json().quality_run.status, "failed");
  assert.equal(staleQueued.json().quality_run.failure_code, "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT");
});

test("QC API leaves a copy draft unfrozen when an unready child ProductRevision is current", async (t) => {
  const { app } = await identityApp(t, {
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort },
    copyGeneration: { enabled: true, repository: createMemoryCopyGenerationRepository(),
      provider: createControlledCopyProvider(), worker: { autoStart: false } },
    copyQuality: { enabled: true, repository: createMemoryCopyQualityRepository(), worker: { autoStart: false } }
  });
  const auth = await activateAdmin(app);
  const seeded = await seedCopy(app, auth);
  const replacement = await app.projectContent.service.saveRevision({
    organizationId: auth.body.organization.id, actorMemberId: auth.body.member.id,
    productRevisionId: seeded.revision.id, expectedRevision: seeded.revision.revision_number,
    productName: "云朵抱枕新事实", sellingPoints: [{ text: "柔软亲肤" }], assetVersionIds: ["asset_available_1"]
  });
  assert.equal(replacement.status, "draft");

  const start = await app.inject({ method: "POST", url: `/api/copy-versions/${seeded.copy.id}/quality-runs`,
    headers: { ...seeded.headers, "idempotency-key": "qc-stale-draft" },
    payload: { expected_revision: seeded.copy.row_version } });
  assert.equal(start.statusCode, 422);
  assert.equal(start.json().error, "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT");
  const copy = await app.inject({ method: "GET", url: `/api/copy-versions/${seeded.copy.id}`,
    headers: identityHeaders({ cookies: auth.cookies }) });
  assert.equal(copy.json().copy_version.status, "draft");
});

test("QC API projects completed result validity after policy and current facts change", async (t) => {
  let policy = { profileVersion: "profile-v1", ruleVersion: "rules-v1" };
  const { app } = await identityApp(t, {
    projectContent: { enabled: true, repository: createMemoryProjectContentRepository(), assetReferencePort },
    copyGeneration: { enabled: true, repository: createMemoryCopyGenerationRepository(),
      provider: createControlledCopyProvider(), worker: { autoStart: false } },
    copyQuality: { enabled: true, repository: createMemoryCopyQualityRepository(),
      profileResolver: { async resolve() { return { ...policy }; } }, worker: { autoStart: false } }
  });
  const auth = await activateAdmin(app);
  const seeded = await seedCopy(app, auth);
  const started = await app.inject({ method: "POST", url: `/api/copy-versions/${seeded.copy.id}/quality-runs`,
    headers: { ...seeded.headers, "idempotency-key": "qc-validity-start" },
    payload: { expected_revision: seeded.copy.row_version } });
  await app.copyQuality.worker.runNext();
  const getDetails = () => app.inject({ method: "GET", url: `/api/quality-runs/${started.json().quality_run.id}`,
    headers: identityHeaders({ cookies: auth.cookies }) });

  let details = (await getDetails()).json();
  assert.deepEqual({ conclusion: details.quality_result.conclusion, current_valid: details.quality_result.current_valid,
    invalidation_reason: details.quality_result.invalidation_reason },
  { conclusion: "passed", current_valid: true, invalidation_reason: null });

  policy = { profileVersion: "profile-v2", ruleVersion: "rules-v2" };
  details = (await getDetails()).json();
  assert.equal(details.quality_result.current_valid, false);
  assert.equal(details.quality_result.invalidation_reason, "quality_policy_changed");

  policy = { profileVersion: "profile-v1", ruleVersion: "rules-v1" };
  await app.projectContent.service.saveRevision({
    organizationId: auth.body.organization.id, actorMemberId: auth.body.member.id,
    productRevisionId: seeded.revision.id, expectedRevision: seeded.revision.revision_number,
    productName: "云朵抱枕待确认事实", sellingPoints: seeded.revision.selling_points,
    assetVersionIds: seeded.revision.asset_version_ids
  });
  details = (await getDetails()).json();
  assert.equal(details.quality_result.conclusion, "passed");
  assert.equal(details.quality_result.current_valid, false);
  assert.equal(details.quality_result.invalidation_reason, "product_revision_changed");
});
