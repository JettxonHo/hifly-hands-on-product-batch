import assert from "node:assert/strict";
import test from "node:test";

import { createCopyGenerationService } from "../src/copy-generation/copy-generation-service.js";
import { createMemoryCopyGenerationRepository } from "../src/copy-generation/memory-copy-generation-repository.js";
import { createCopyQualityService } from "../src/copy-quality/copy-quality-service.js";
import { createCopyQualityWorker } from "../src/copy-quality/copy-quality-worker.js";
import { createDeepSeekQualityEvaluator } from "../src/copy-quality/deepseek-evaluator.js";
import { createMemoryCopyQualityRepository } from "../src/copy-quality/memory-copy-quality-repository.js";

const actor = { organizationId: "org-quality-one-attempt", actorMemberId: "member-quality-one-attempt" };
const revision = {
  id: "revision-quality-one-attempt", organization_id: actor.organizationId,
  project_id: "project-quality-one-attempt", product_id: "product-quality-one-attempt",
  status: "ready", product_name: "轻盈水杯", selling_points: [{ text: "容量 300ml", confirmed: true }]
};

function deepSeekResponse(content, usage = undefined) {
  return { choices: [{ message: { content } }], ...(usage ? { usage } : {}) };
}

async function world({ qualityMaxAttempts, evaluator, repository: providedRepository,
  now = () => Date.parse("2026-08-31T08:00:00.000Z") } = {}) {
  const copyRepository = createMemoryCopyGenerationRepository();
  let currentRevision = structuredClone(revision);
  const productRevisionPort = {
    async getReadySnapshot() { return structuredClone(currentRevision); },
    async getSnapshot() { return structuredClone(currentRevision); },
    async getCurrentReadySnapshot() { return structuredClone(currentRevision); }
  };
  const copyService = createCopyGenerationService({ repository: copyRepository, productRevisionPort, now });
  await copyService.requestGeneration({ ...actor, productRevisionId: revision.id, idempotencyKey: "seed" });
  const generation = await copyService.claimNextGenerationJob();
  const first = await copyService.completeGenerationJob({ job: generation, body: "第一版商品文案。" });
  const frozen = await copyService.freezeCopyVersion({ ...actor, copyVersionId: first.id,
    expectedRevision: first.row_version, idempotencyKey: "freeze-first" });
  const second = await copyService.editCopyVersion({ ...actor, copyVersionId: frozen.id,
    expectedRevision: frozen.row_version, body: "第二版商品文案。" });
  const qualityRepository = providedRepository || createMemoryCopyQualityRepository();
  const service = createCopyQualityService({ repository: qualityRepository, copyService,
    qualityMaxAttempts, profileResolver: { async resolve() { return { profileVersion: "profile-v1", ruleVersion: "rules-v1" }; } },
    now });
  const worker = createCopyQualityWorker({ service, evaluator: evaluator || {
    kind: "controlled_test_double", async evaluate() { return { checks_complete: true, findings: [] }; }
  }, pollIntervalMs: 1 });
  return { copyService, first: frozen, second, qualityRepository, service, worker,
    setCurrentRevision(value) { currentRevision = structuredClone(value); } };
}

test("DeepSeek semantic evaluator never retries malformed JSON", async () => {
  let calls = 0;
  const evaluator = createDeepSeekQualityEvaluator({ client: { async complete() {
    calls += 1;
    return deepSeekResponse("not-json");
  } } });

  await assert.rejects(evaluator.evaluate({ copyVersion: { body: "容量 300ml" }, productRevision: revision,
    providerRequest: async ({ execute }) => execute() }), { code: "QUALITY_EVALUATION_OUTPUT_MALFORMED" });
  assert.equal(calls, 1);
});

test("DeepSeek semantic evaluator requires the durable provider request seam", async () => {
  let calls = 0;
  const evaluator = createDeepSeekQualityEvaluator({ client: { async complete() { calls += 1; return deepSeekResponse(JSON.stringify({ findings: [] })); } } });
  await assert.rejects(evaluator.evaluate({ copyVersion: { body: "容量 300ml" }, productRevision: revision }),
    { code: "QUALITY_PROVIDER_REQUEST_REQUIRED" });
  assert.equal(calls, 0);
});

test("DeepSeek semantic evaluator never retries a schema-invalid response", async () => {
  let calls = 0;
  const evaluator = createDeepSeekQualityEvaluator({ client: { async complete() {
    calls += 1;
    return deepSeekResponse(JSON.stringify({ findings: [{ dimension: "factuality" }] }));
  } } });

  await assert.rejects(evaluator.evaluate({ copyVersion: { body: "容量 300ml" }, productRevision: revision,
    providerRequest: async ({ execute }) => execute() }), { code: "QUALITY_EVALUATION_SCHEMA_INVALID" });
  assert.equal(calls, 1);
});

test("strict quality start freezes v2 while preserving frozen parent", async () => {
  const ctx = await world({ qualityMaxAttempts: 1 });
  const parentBefore = await ctx.copyService.getCopyVersion({ ...actor, copyVersionId: ctx.first.id });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "strict-start" });

  assert.equal(started.copy_version.status, "frozen");
  assert.equal(started.quality_run.attempt_policy, "provider_at_most_once_v1");
  assert.equal(started.quality_run.max_attempts, 1);
  const parent = await ctx.copyService.getCopyVersion({ ...actor, copyVersionId: ctx.first.id });
  assert.equal(parent.status, "frozen");
  assert.equal(parent.body, "第一版商品文案。");
  assert.equal(parent.row_version, parentBefore.row_version);
});

test("quality run creation failure leaves a frozen v2 but no provider work or retryable run", async () => {
  const baseRepository = createMemoryCopyQualityRepository();
  const failingRepository = {
    ...baseRepository,
    async createRun() { throw Object.assign(new Error("injected run persistence failure"), { code: "QUALITY_RUN_CREATE_FAILED" }); }
  };
  const ctx = await world({ qualityMaxAttempts: 1, repository: failingRepository });
  const parentBefore = await ctx.copyService.getCopyVersion({ ...actor, copyVersionId: ctx.first.id });
  await assert.rejects(ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "strict-create-failure" }), { code: "QUALITY_RUN_CREATE_FAILED" });
  const child = await ctx.copyService.getCopyVersion({ ...actor, copyVersionId: ctx.second.id });
  const parent = await ctx.copyService.getCopyVersion({ ...actor, copyVersionId: ctx.first.id });
  assert.equal(child.status, "frozen");
  assert.equal(parent.status, parentBefore.status);
  assert.equal(parent.body, parentBefore.body);
  assert.equal(parent.row_version, parentBefore.row_version);
  assert.deepEqual(await failingRepository.listRuns(actor.organizationId, ctx.second.id), []);
  assert.equal((await failingRepository.listAuditEvents()).some((event) => event.event_type.startsWith("copy.quality_provider_")), false);
  await assert.rejects(ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: child.row_version, idempotencyKey: "strict-create-failure-replay" }), { code: "QUALITY_RUN_CREATE_FAILED" });
});

test("strict quality retry cannot create another logical run", async () => {
  let calls = 0;
  const ctx = await world({ qualityMaxAttempts: 1, evaluator: {
    kind: "controlled_test_double", async evaluate() {
      calls += 1;
      throw Object.assign(new Error("controlled failure"), { code: "QUALITY_EVALUATOR_TEMPORARY_FAILURE" });
    }
  } });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "strict-retry-start" });
  await ctx.worker.runNext();

  await assert.rejects(ctx.service.retryQualityCheck({ ...actor, qualityRunId: started.quality_run.id,
    idempotencyKey: "strict-retry" }), { code: "QUALITY_ONE_ATTEMPT_RETRY_BLOCKED" });
  assert.equal(calls, 1);
  assert.equal((await ctx.service.listQualityRuns({ ...actor, copyVersionId: ctx.second.id })).length, 1);
});

test("strict quality start fails closed when a legacy run is already active", async () => {
  const repository = createMemoryCopyQualityRepository();
  const ctx = await world({ qualityMaxAttempts: 1, repository });
  await repository.createRun({ receiptKey: "legacy-active", fingerprint: "legacy-active", run: {
    id: "legacy-quality-run", organization_id: actor.organizationId, copy_version_id: ctx.second.id,
    profile_version: "profile-v1", rule_version: "rules-v1", status: "queued", attempts: 0, max_attempts: 3
  }, audit: { id: "legacy-quality-audit", organization_id: actor.organizationId, event_type: "copy.quality_requested" } });
  await assert.rejects(ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "strict-with-legacy-active" }),
  { code: "QUALITY_ONE_ATTEMPT_LEGACY_RUN_ACTIVE" });
  assert.equal((await repository.listRuns(actor.organizationId, ctx.second.id)).length, 1);
});

test("strict start and retry fail closed on a migrated legacy unknown outcome", async () => {
  const repository = createMemoryCopyQualityRepository();
  const ctx = await world({ qualityMaxAttempts: 1, repository });
  const legacy = { id: "legacy-unknown-quality-run", organization_id: actor.organizationId, copy_version_id: ctx.second.id,
    profile_version: "legacy-profile", rule_version: "legacy-rules", status: "failed", attempts: 1, max_attempts: 3,
    attempt_policy: "legacy", provider_request_state: "unknown", provider_request_outcome: "unknown",
    failure_code: "QUALITY_PROVIDER_OUTCOME_UNKNOWN" };
  await repository.createRun({ receiptKey: "legacy-unknown", fingerprint: "legacy-unknown", run: legacy,
    audit: { id: "legacy-unknown-audit", organization_id: actor.organizationId, event_type: "copy.quality_provider_outcome_unknown" } });
  await assert.rejects(ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "strict-after-legacy-unknown" }),
  { code: "QUALITY_ONE_ATTEMPT_LEGACY_OUTCOME_UNKNOWN" });
  await assert.rejects(ctx.service.retryQualityCheck({ ...actor, qualityRunId: legacy.id,
    idempotencyKey: "legacy-unknown-retry" }), { code: "QUALITY_ONE_ATTEMPT_RETRY_BLOCKED" });
});

test("strict quality cancel is blocked after a provider dispatch reservation", async () => {
  const ctx = await world({ qualityMaxAttempts: 1 });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "strict-cancel-after-dispatch" });
  const lease = await ctx.service.claimNextQualityRun({ leaseMs: 1_000 });
  await ctx.qualityRepository.beginProviderRequest({ runId: lease.id, leaseToken: lease.lease_token,
    providerName: "DeepSeek", model: "deepseek-v4-flash", now: new Date().toISOString() });
  await assert.rejects(ctx.service.cancelQualityCheck({ ...actor, qualityRunId: started.quality_run.id }),
    { code: "QUALITY_ONE_ATTEMPT_CANCEL_BLOCKED" });
  assert.equal((await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id })).quality_run.status, "running");
});

test("strict queued quality cancellation records a terminal not-dispatched outcome", async () => {
  const ctx = await world({ qualityMaxAttempts: 1 });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "strict-cancel-before-dispatch" });
  const cancelled = await ctx.service.cancelQualityCheck({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.provider_request_state, "terminal");
  assert.equal(cancelled.provider_request_outcome, "not_dispatched");
  assert.equal(cancelled.provider_dispatch_count, 0);
  assert.equal(cancelled.provider_http_request_count, 0);
  await assert.rejects(ctx.service.retryQualityCheck({ ...actor, qualityRunId: cancelled.id,
    idempotencyKey: "strict-cancel-before-dispatch-retry" }), { code: "QUALITY_ONE_ATTEMPT_RETRY_BLOCKED" });
});

test("provider success reserves and persists exactly one request with reported usage", async () => {
  let calls = 0;
  const ctx = await world({ qualityMaxAttempts: 1, evaluator: {
    kind: "fake_provider", async evaluate({ providerRequest }) {
      await providerRequest({ providerName: "DeepSeek", providerKind: "deepseek_hybrid",
        model: "deepseek-v4-flash", execute: async () => {
          calls += 1;
          return deepSeekResponse(JSON.stringify({ findings: [] }), {
            prompt_tokens: 11, completion_tokens: 7, total_tokens: 18
          });
        } });
      return { checks_complete: true, findings: [] };
    }
  } });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "provider-success" });
  const replay = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: started.copy_version.row_version, idempotencyKey: "provider-success-other-key" });
  assert.equal(replay.quality_run.id, started.quality_run.id);

  await ctx.worker.runNext();
  const details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(calls, 1);
  assert.equal(details.quality_run.provider_dispatch_count, 1);
  assert.equal(details.quality_run.provider_http_request_count, 1);
  assert.equal(details.quality_run.provider_request_state, "terminal");
  assert.equal(details.quality_run.provider_request_outcome, "success");
  assert.equal(details.quality_run.provider_usage_status, "reported");
  assert.equal(details.quality_run.provider_input_tokens, 11);
  assert.equal(details.quality_run.provider_output_tokens, 7);
  assert.equal(details.quality_run.provider_total_tokens, 18);
  assert.equal(details.quality_run.provider_charge_status, "unknown");
  assert.equal(details.quality_run.provider_local_cost_status, "not_calculated");
  assert.equal(details.quality_result.conclusion, "passed");
  assert.equal((await ctx.service.listQualityRuns({ ...actor, copyVersionId: ctx.second.id })).length, 1);
  const auditTypes = (await ctx.qualityRepository.listAuditEvents()).map((event) => event.event_type);
  assert.equal(auditTypes.includes("copy.quality_provider_dispatch_reserved"), true);
  assert.equal(auditTypes.includes("copy.quality_provider_http_request_started"), true);
  assert.equal(auditTypes.includes("copy.quality_provider_response_recorded"), true);
});

test("malformed provider output records one response and never re-enters provider", async () => {
  let calls = 0;
  const ctx = await world({ qualityMaxAttempts: 1, evaluator: {
    kind: "fake_provider", async evaluate({ providerRequest }) {
      await providerRequest({ providerName: "DeepSeek", providerKind: "deepseek_hybrid",
        model: "deepseek-v4-flash", execute: async () => {
          calls += 1;
          return deepSeekResponse("not-json");
        } });
      throw Object.assign(new Error("malformed"), { code: "QUALITY_EVALUATION_OUTPUT_INVALID" });
    }
  } });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "provider-malformed" });
  await ctx.worker.runNext();
  const details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(calls, 1);
  assert.equal(details.quality_run.status, "failed");
  assert.equal(details.quality_run.failure_code, "QUALITY_EVALUATION_OUTPUT_INVALID");
  assert.equal(details.quality_run.provider_dispatch_count, 1);
  assert.equal(details.quality_run.provider_http_request_count, 1);
  assert.equal(details.quality_run.provider_request_outcome, "parse_failure");
  assert.equal(details.quality_run.provider_usage_status, "unknown");
  assert.equal(details.quality_result, null);
  await assert.rejects(ctx.service.retryQualityCheck({ ...actor, qualityRunId: started.quality_run.id,
    idempotencyKey: "provider-malformed-retry" }), { code: "QUALITY_ONE_ATTEMPT_RETRY_BLOCKED" });
  assert.equal(calls, 1);
});

test("ambiguous provider transport failure is terminal unknown and does not retry", async () => {
  let calls = 0;
  const ctx = await world({ qualityMaxAttempts: 1, evaluator: {
    kind: "fake_provider", async evaluate({ providerRequest }) {
      await providerRequest({ providerName: "DeepSeek", providerKind: "deepseek_hybrid",
        model: "deepseek-v4-flash", execute: async () => {
          calls += 1;
          throw Object.assign(new Error("timeout"), { code: "DEEPSEEK_UNAVAILABLE" });
        } });
      return { checks_complete: true, findings: [] };
    }
  } });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "provider-timeout" });
  await ctx.worker.runNext();
  const details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(calls, 1);
  assert.equal(details.quality_run.status, "failed");
  assert.equal(details.quality_run.provider_request_state, "unknown");
  assert.equal(details.quality_run.provider_request_outcome, "unknown");
  assert.equal(details.quality_run.provider_usage_status, "unknown");
  assert.equal(details.quality_run.provider_charge_status, "unknown");
  assert.equal(await ctx.worker.runNext(), null);
  assert.equal(calls, 1);
});

test("an evaluator that swallows provider failure cannot complete a passed QualityResult", async () => {
  let calls = 0;
  const ctx = await world({ qualityMaxAttempts: 1, evaluator: {
    kind: "fake_provider", async evaluate({ providerRequest }) {
      try {
        await providerRequest({ providerName: "DeepSeek", model: "deepseek-v4-flash", execute: async () => {
          calls += 1;
          throw Object.assign(new Error("ambiguous"), { code: "DEEPSEEK_UNAVAILABLE" });
        } });
      } catch {
        // Deliberately swallow the provider error to verify the durable response gate.
      }
      return { checks_complete: true, findings: [] };
    }
  } });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "provider-swallowed-error" });
  await ctx.worker.runNext();
  const details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(calls, 1);
  assert.equal(details.quality_run.status, "failed");
  assert.equal(details.quality_run.failure_code, "QUALITY_PROVIDER_RESPONSE_NOT_READY");
  assert.equal(details.quality_run.provider_request_state, "unknown");
  assert.equal(details.quality_run.provider_request_outcome, "unknown");
  assert.equal(details.quality_result, null);
});

test("expired strict lease with a dispatch reservation becomes unknown without reclaim", async () => {
  let clock = Date.parse("2026-08-31T08:00:00.000Z");
  const ctx = await world({ qualityMaxAttempts: 1, now: () => clock });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "provider-lease" });
  const lease = await ctx.service.claimNextQualityRun({ leaseMs: 1_000 });
  await ctx.service.executeProviderRequest({ run: lease, providerName: "DeepSeek", providerKind: "deepseek_hybrid",
    model: "deepseek-v4-flash", execute: async () => {
      throw Object.assign(new Error("crash after reservation"), { code: "QUALITY_PROVIDER_WORKER_CRASH" });
    } }).catch(() => undefined);
  clock += 1_001;
  assert.equal(await ctx.service.claimNextQualityRun({ leaseMs: 1_000 }), null);
  const details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(details.quality_run.status, "failed");
  assert.equal(details.quality_run.failure_code, "QUALITY_PROVIDER_OUTCOME_UNKNOWN");
  assert.equal(details.quality_run.provider_dispatch_count, 1);
  assert.equal(details.quality_run.provider_http_request_count, 1);
});

test("strict worker crash before dispatch reservation is terminal not-dispatched", async () => {
  let clock = Date.parse("2026-08-31T08:00:00.000Z");
  const ctx = await world({ qualityMaxAttempts: 1, now: () => clock });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "provider-crash-before-reservation" });
  await ctx.service.claimNextQualityRun({ leaseMs: 1_000 });
  clock += 1_001;
  assert.equal(await ctx.service.claimNextQualityRun({ leaseMs: 1_000 }), null);
  const details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(details.quality_run.failure_code, "QUALITY_ONE_ATTEMPT_NOT_DISPATCHED");
  assert.equal(details.quality_run.provider_dispatch_count, 0);
  assert.equal(details.quality_run.provider_http_request_count, 0);
  assert.equal(details.quality_run.provider_request_outcome, "not_dispatched");
});

test("duplicate workers cannot both reserve a provider request", async () => {
  let calls = 0;
  const ctx = await world({ qualityMaxAttempts: 1, evaluator: {
    kind: "fake_provider", async evaluate({ providerRequest }) {
      await providerRequest({ providerName: "DeepSeek", providerKind: "deepseek_hybrid",
        model: "deepseek-v4-flash", execute: async () => {
          calls += 1;
          return deepSeekResponse(JSON.stringify({ findings: [] }));
        } });
      return { checks_complete: true, findings: [] };
    }
  } });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "provider-duplicate-workers" });
  await Promise.all([ctx.worker.runNext(), ctx.worker.runNext()]);
  const details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(calls, 1);
  assert.equal(details.quality_run.provider_dispatch_count, 1);
  assert.equal(details.quality_run.provider_http_request_count, 1);
  assert.equal(details.quality_result.conclusion, "passed");
});

test("a duplicate provider callback cannot reserve or mark a second dispatch", async () => {
  const ctx = await world({ qualityMaxAttempts: 1 });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "provider-duplicate-callback" });
  const lease = await ctx.service.claimNextQualityRun({ leaseMs: 1_000 });
  const [first, second] = await Promise.all([
    ctx.qualityRepository.beginProviderRequest({ runId: lease.id, leaseToken: lease.lease_token,
      providerName: "DeepSeek", model: "deepseek-v4-flash", now: new Date().toISOString() }),
    ctx.qualityRepository.beginProviderRequest({ runId: lease.id, leaseToken: lease.lease_token,
      providerName: "DeepSeek", model: "deepseek-v4-flash", now: new Date().toISOString() })
  ]);
  assert.equal(Boolean(first) + Boolean(second), 1);
  const marked = await ctx.qualityRepository.markProviderHttpRequestStarted({ runId: lease.id,
    leaseToken: lease.lease_token, now: new Date().toISOString() });
  assert.equal(marked.provider_dispatch_count, 1);
  assert.equal(marked.provider_http_request_count, 1);
  assert.equal((await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id })).quality_run.provider_http_request_count, 1);
});

test("a reserved but unstarted dispatch cannot complete a QualityResult", async () => {
  const ctx = await world({ qualityMaxAttempts: 1, evaluator: {
    kind: "fake_provider", async evaluate({ qualityRun }) {
      await ctx.qualityRepository.beginProviderRequest({ runId: qualityRun.id, leaseToken: qualityRun.lease_token,
        providerName: "DeepSeek", model: "deepseek-v4-flash", now: new Date().toISOString() });
      return { checks_complete: true, findings: [] };
    }
  } });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "provider-reserved-no-start" });
  await ctx.worker.runNext();
  const details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(details.quality_run.status, "failed");
  assert.equal(details.quality_run.failure_code, "QUALITY_PROVIDER_REQUEST_NOT_STARTED");
  assert.equal(details.quality_run.provider_dispatch_count, 1);
  assert.equal(details.quality_run.provider_http_request_count, 0);
  assert.equal(details.quality_result, null);
});

test("HTTP marker persistence failure closes a reserved dispatch as not-dispatched", async () => {
  const baseRepository = createMemoryCopyQualityRepository();
  const failingRepository = {
    ...baseRepository,
    async markProviderHttpRequestStarted() { throw Object.assign(new Error("injected marker failure"), { code: "QUALITY_PROVIDER_MARK_FAILED" }); }
  };
  const ctx = await world({ qualityMaxAttempts: 1, repository: failingRepository, evaluator: {
    kind: "fake_provider", async evaluate({ providerRequest }) {
      await providerRequest({ providerName: "DeepSeek", model: "deepseek-v4-flash", execute: async () => ({ findings: [] }) });
      return { checks_complete: true, findings: [] };
    }
  } });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "provider-marker-failure" });
  await ctx.worker.runNext();
  const details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(details.quality_run.failure_code, "QUALITY_PROVIDER_MARK_FAILED");
  assert.equal(details.quality_run.provider_dispatch_count, 1);
  assert.equal(details.quality_run.provider_http_request_count, 0);
  assert.equal(details.quality_run.provider_request_state, "terminal");
  assert.equal(details.quality_run.provider_request_outcome, "not_dispatched");
});

test("provider callback is the only DeepSeek dispatch seam and preserves sanitized metadata", async () => {
  let callbackInput;
  const evaluator = createDeepSeekQualityEvaluator({ client: {
    providerName: "DeepSeek", model: "deepseek-v4-flash",
    async complete() { return deepSeekResponse(JSON.stringify({ findings: [] })); }
  } });
  await evaluator.evaluate({ copyVersion: { body: "容量 300ml" }, productRevision: revision,
    providerRequest: async (input) => { callbackInput = input; return input.execute(); } });
  assert.equal(callbackInput.providerName, "DeepSeek");
  assert.equal(callbackInput.providerKind, "deepseek");
  assert.equal(callbackInput.model, "deepseek-v4-flash");
  assert.equal(typeof callbackInput.execute, "function");
  assert.equal(JSON.stringify(callbackInput.request).includes("server-only-key"), false);
});

test("semantic validation failure after a provider response remains one-call terminal failure", async () => {
  let calls = 0;
  const ctx = await world({ qualityMaxAttempts: 1, evaluator: {
    kind: "fake_provider", async evaluate({ providerRequest }) {
      await providerRequest({ providerName: "DeepSeek", providerKind: "deepseek_hybrid",
        model: "deepseek-v4-flash", execute: async () => {
          calls += 1;
          return deepSeekResponse(JSON.stringify({ findings: [] }));
        } });
      throw Object.assign(new Error("semantic validation"), { code: "QUALITY_EVALUATION_INVALID" });
    }
  } });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "provider-semantic-invalid" });
  await ctx.worker.runNext();
  const details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(calls, 1);
  assert.equal(details.quality_run.failure_code, "QUALITY_EVALUATION_INVALID");
  assert.equal(details.quality_run.provider_request_outcome, "semantic_failure");
  assert.equal(details.quality_run.provider_dispatch_count, 1);
  assert.equal(details.quality_run.provider_http_request_count, 1);
  assert.equal(details.quality_result, null);
});

test("schema mismatch after a provider response remains one-call terminal failure", async () => {
  let calls = 0;
  const ctx = await world({ qualityMaxAttempts: 1, evaluator: {
    kind: "fake_provider", async evaluate({ providerRequest }) {
      await providerRequest({ providerName: "DeepSeek", model: "deepseek-v4-flash", execute: async () => {
        calls += 1;
        return deepSeekResponse(JSON.stringify({ wrong: true }));
      } });
      throw Object.assign(new Error("schema mismatch"), { code: "DEEPSEEK_RESPONSE_INVALID" });
    }
  } });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "provider-schema-invalid" });
  await ctx.worker.runNext();
  const details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(calls, 1);
  assert.equal(details.quality_run.failure_code, "DEEPSEEK_RESPONSE_INVALID");
  assert.equal(details.quality_run.provider_request_outcome, "schema_failure");
  assert.equal(details.quality_run.provider_dispatch_count, 1);
  assert.equal(details.quality_run.provider_http_request_count, 1);
  assert.equal(details.quality_result, null);
});

test("provider response envelope failure remains schema-classified after evaluator normalization", async () => {
  let calls = 0;
  const evaluator = createDeepSeekQualityEvaluator({ client: {
    providerName: "DeepSeek", providerKind: "deepseek_hybrid", model: "deepseek-v4-flash",
    async complete() { calls += 1; throw Object.assign(new Error("invalid response envelope"), { code: "DEEPSEEK_RESPONSE_INVALID" }); }
  } });
  const ctx = await world({ qualityMaxAttempts: 1, evaluator });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "provider-envelope-invalid" });
  await ctx.worker.runNext();
  const details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(calls, 1);
  assert.equal(details.quality_run.provider_request_outcome, "schema_failure");
  assert.equal(details.quality_run.provider_http_request_count, 1);
});

test("crash after reservation but before execute leaves zero transport calls and no replacement permit", async () => {
  let calls = 0;
  let clock = Date.parse("2026-08-31T08:00:00.000Z");
  const ctx = await world({ qualityMaxAttempts: 1, now: () => clock, evaluator: {
    kind: "fake_provider", async evaluate({ providerRequest }) {
      await providerRequest({ providerName: "DeepSeek", model: "deepseek-v4-flash", execute: async () => {
        calls += 1;
        return deepSeekResponse(JSON.stringify({ findings: [] }));
      } });
      return { checks_complete: true, findings: [] };
    }
  } });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "provider-crash-before-execute" });
  const lease = await ctx.service.claimNextQualityRun({ leaseMs: 1_000 });
  await ctx.qualityRepository.beginProviderRequest({ runId: lease.id, leaseToken: lease.lease_token,
    providerName: "DeepSeek", providerKind: "deepseek_hybrid", model: "deepseek-v4-flash", now: new Date(clock).toISOString() });
  clock += 1_001;
  assert.equal(await ctx.service.claimNextQualityRun({ leaseMs: 1_000 }), null);
  assert.equal(calls, 0);
  const details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(details.quality_run.failure_code, "QUALITY_ONE_ATTEMPT_NOT_DISPATCHED");
  assert.equal(details.quality_run.provider_request_state, "terminal");
  assert.equal(details.quality_run.provider_request_outcome, "not_dispatched");
  assert.equal(details.quality_run.provider_dispatch_count, 1);
  assert.equal(details.quality_run.provider_http_request_count, 0);
});

test("late completion from a stale worker cannot overwrite unknown terminal state", async () => {
  let clock = Date.parse("2026-08-31T08:00:00.000Z");
  const ctx = await world({ qualityMaxAttempts: 1, now: () => clock });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.second.id,
    expectedRevision: ctx.second.row_version, idempotencyKey: "provider-late-stale" });
  const lease = await ctx.service.claimNextQualityRun({ leaseMs: 1_000 });
  await ctx.qualityRepository.beginProviderRequest({ runId: lease.id, leaseToken: lease.lease_token,
    providerName: "DeepSeek", model: "deepseek-v4-flash", now: new Date(clock).toISOString() });
  await ctx.qualityRepository.markProviderHttpRequestStarted({ runId: lease.id, leaseToken: lease.lease_token,
    now: new Date(clock).toISOString() });
  clock += 1_001;
  await ctx.service.claimNextQualityRun({ leaseMs: 1_000 });
  await assert.rejects(ctx.qualityRepository.recordProviderResponse({ runId: lease.id, leaseToken: lease.lease_token,
    outcome: "response_received", usage: { status: "reported", inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    charge: { status: "unknown", amount: null, currency: null }, now: new Date(clock).toISOString() }),
  { code: "QUALITY_RUN_LEASE_LOST" });
  const details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(details.quality_run.failure_code, "QUALITY_PROVIDER_OUTCOME_UNKNOWN");
  assert.equal(details.quality_run.provider_request_outcome, "unknown");
});

test("concurrent strict starts with different keys still create one logical run", async () => {
  const ctx = await world({ qualityMaxAttempts: 1 });
  const [first, second] = await Promise.all([1, 2, 3, 4].map((value) => ctx.service.startQualityCheck({
    ...actor, copyVersionId: ctx.second.id, expectedRevision: ctx.second.row_version,
    idempotencyKey: `concurrent-strict-${value}`
  })));
  assert.equal(first.quality_run.id, second.quality_run.id);
  assert.equal((await ctx.service.listQualityRuns({ ...actor, copyVersionId: ctx.second.id })).length, 1);
});
