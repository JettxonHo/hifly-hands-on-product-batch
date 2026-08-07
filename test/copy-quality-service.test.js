import assert from "node:assert/strict";
import test from "node:test";

import { createCopyGenerationService } from "../src/copy-generation/copy-generation-service.js";
import { createMemoryCopyGenerationRepository } from "../src/copy-generation/memory-copy-generation-repository.js";
import { createControlledQualityEvaluator } from "../src/copy-quality/controlled-evaluator.js";
import { createCopyQualityService } from "../src/copy-quality/copy-quality-service.js";
import { createCopyQualityWorker } from "../src/copy-quality/copy-quality-worker.js";
import { createCopyRewriteWorker } from "../src/copy-quality/copy-rewrite-worker.js";
import { createMemoryCopyQualityRepository } from "../src/copy-quality/memory-copy-quality-repository.js";

const actor = { organizationId: "org_qc", actorMemberId: "member_qc" };
const snapshot = {
  id: "revision_qc", organization_id: actor.organizationId, project_id: "project_qc", product_id: "product_qc",
  status: "ready", product_name: "云朵抱枕", selling_points: [{ text: "柔软亲肤", confirmation_status: "confirmed" }]
};
const finding = (overrides = {}) => ({
  code: "TONE_REVIEW", kind: "review", severity: "medium", title: "语气待判断",
  matched_text: "全网最好", message: "请人工判断表达是否合适",
  evidence_reference: "copy:text:12-16", rule_source: "brand_policy",
  suggestion: "改为有事实依据的体验描述", ...overrides
});

async function world({ evaluate, rewrite, now = () => Date.parse("2026-08-07T08:00:00.000Z"), maxAttempts = 3,
  profileVersion = "commerce-cn-v1", ruleVersion = "rules-2026-08" } = {}) {
  const copyRepository = createMemoryCopyGenerationRepository();
  let revisionSnapshot = structuredClone(snapshot);
  let currentRevisionId = snapshot.id;
  const productRevisionPort = {
    async getReadySnapshot() {
      if (revisionSnapshot.status !== "ready") throw Object.assign(new Error("PRODUCT_REVISION_NOT_FOUND"), { code: "PRODUCT_REVISION_NOT_FOUND" });
      return structuredClone(revisionSnapshot);
    },
    async getSnapshot() { return structuredClone(revisionSnapshot); },
    async getCurrentReadySnapshot() {
      if (revisionSnapshot.status !== "ready" || currentRevisionId !== revisionSnapshot.id) {
        throw Object.assign(new Error("PRODUCT_REVISION_NOT_FOUND"), { code: "PRODUCT_REVISION_NOT_FOUND" });
      }
      return structuredClone(revisionSnapshot);
    }
  };
  const copyService = createCopyGenerationService({ repository: copyRepository, productRevisionPort, now });
  await copyService.requestGeneration({ ...actor, productRevisionId: snapshot.id, intent: "product_recommendation", idempotencyKey: "seed-copy" });
  const job = await copyService.claimNextGenerationJob();
  const copy = await copyService.completeGenerationJob({ job, body: "这是一条待质检的商品种草文案。" });
  const repository = createMemoryCopyQualityRepository();
  let activePolicy = { profileVersion, ruleVersion };
  const service = createCopyQualityService({ repository, copyService,
    profileResolver: { async resolve() { return { ...activePolicy }; } },
    rewriter: { async rewrite(input) {
    return rewrite ? rewrite(input) : { body: `${input.copyVersion.body}\n已按质检建议完成改写。` };
  } }, now, maxAttempts });
  const evaluator = createControlledQualityEvaluator({ evaluate });
  const worker = createCopyQualityWorker({ service, evaluator, pollIntervalMs: 5 });
  const rewriteWorker = createCopyRewriteWorker({ service, rewriter: { async rewrite(input) {
    return rewrite ? rewrite(input) : { body: `${input.copyVersion.body}\n已按质检建议完成改写。` };
  } }, pollIntervalMs: 5 });
  return { copyRepository, copyService, copy, repository, service, worker, rewriteWorker,
    setRevisionStatus(status) { revisionSnapshot = { ...revisionSnapshot, status }; },
    setCurrentRevisionId(id) { currentRevisionId = id; },
    setPolicy(next) { activePolicy = { ...next }; } };
}

test("a child draft makes the old ready ProductRevision non-current without freezing its copy draft", async () => {
  const ctx = await world();
  ctx.setCurrentRevisionId("child_revision_draft");

  await assert.rejects(ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id,
    expectedRevision: ctx.copy.row_version, idempotencyKey: "child-draft-stale-start" }),
  { code: "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT" });
  assert.equal((await ctx.copyService.getCopyVersion({ ...actor, copyVersionId: ctx.copy.id })).status, "draft");
});

test("QC profile and rule versions are selected by the server policy, not request input", async () => {
  const ctx = await world({ profileVersion: "server-profile-v2", ruleVersion: "server-rules-v3" });
  const [first, duplicate] = await Promise.all([
    ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id, expectedRevision: ctx.copy.row_version,
      profileVersion: "client-profile-a", ruleVersion: "client-rules-a", idempotencyKey: "server-policy-1" }),
    ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id, expectedRevision: ctx.copy.row_version,
      profileVersion: "client-profile-b", ruleVersion: "client-rules-b", idempotencyKey: "server-policy-2" })
  ]);

  assert.equal(first.quality_run.profile_version, "server-profile-v2");
  assert.equal(first.quality_run.rule_version, "server-rules-v3");
  assert.equal(duplicate.quality_run.id, first.quality_run.id);
  assert.equal((await ctx.service.listQualityRuns({ ...actor, copyVersionId: ctx.copy.id })).length, 1);
});

test("start, retry, and rewrite reject a CopyVersion whose ProductRevision is no longer current ready", async () => {
  let rewriteCalls = 0;
  const ctx = await world({ evaluate: async () => { throw Object.assign(new Error("controlled outage"), { code: "QUALITY_EVALUATOR_TEMPORARY_FAILURE" }); },
    rewrite: async () => { rewriteCalls += 1; return { body: "不应产生的改写" }; } });
  ctx.setRevisionStatus("superseded");
  await assert.rejects(ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id,
    expectedRevision: ctx.copy.row_version, idempotencyKey: "stale-start" }), { code: "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT" });
  assert.equal((await ctx.copyService.getCopyVersion({ ...actor, copyVersionId: ctx.copy.id })).status, "draft");

  ctx.setRevisionStatus("ready");
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id,
    expectedRevision: ctx.copy.row_version, idempotencyKey: "ready-start" });
  await ctx.worker.runNext();
  ctx.setRevisionStatus("draft");
  await assert.rejects(ctx.service.retryQualityCheck({ ...actor, qualityRunId: started.quality_run.id,
    idempotencyKey: "stale-retry" }), { code: "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT" });
  await assert.rejects(ctx.service.requestCopyRewrite({ ...actor, copyVersionId: ctx.copy.id,
    idempotencyKey: "stale-rewrite", scope: "full", instruction: "改得更自然" }), { code: "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT" });
  assert.equal(rewriteCalls, 0);
});

test("a queued QC run cannot produce passed after its ProductRevision becomes stale", async () => {
  const ctx = await world({ evaluate: async () => ({ checks_complete: true, findings: [] }) });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id,
    expectedRevision: ctx.copy.row_version, idempotencyKey: "stale-before-evaluation" });
  ctx.setRevisionStatus("superseded");
  await ctx.worker.runNext();
  const details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(details.quality_run.status, "failed");
  assert.equal(details.quality_run.failure_code, "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT");
  assert.equal(details.quality_result, null);
});

test("a queued QC run cannot complete under a changed server policy and retry uses the current policy", async () => {
  const ctx = await world({ evaluate: async () => ({ checks_complete: true, findings: [] }),
    profileVersion: "profile-v1", ruleVersion: "rules-v1" });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id,
    expectedRevision: ctx.copy.row_version, idempotencyKey: "policy-before-change" });
  ctx.setPolicy({ profileVersion: "profile-v2", ruleVersion: "rules-v2" });
  await ctx.worker.runNext();
  const failed = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(failed.quality_run.status, "failed");
  assert.equal(failed.quality_run.failure_code, "COPY_QUALITY_POLICY_CHANGED");
  assert.equal(failed.quality_result, null);

  const retried = await ctx.service.retryQualityCheck({ ...actor, qualityRunId: started.quality_run.id,
    idempotencyKey: "policy-after-change" });
  assert.equal(retried.quality_run.profile_version, "profile-v2");
  assert.equal(retried.quality_run.rule_version, "rules-v2");
  await ctx.worker.runNext();
  const completed = await ctx.service.getQualityRun({ ...actor, qualityRunId: retried.quality_run.id });
  assert.equal(completed.quality_result.conclusion, "passed");
});

test("completed QualityResult keeps its conclusion while current validity follows facts and policy", async () => {
  const ctx = await world({ evaluate: async () => ({ checks_complete: true, findings: [] }),
    profileVersion: "profile-v1", ruleVersion: "rules-v1" });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id,
    expectedRevision: ctx.copy.row_version, idempotencyKey: "validity-projection" });
  await ctx.worker.runNext();

  let details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(details.quality_result.conclusion, "passed");
  assert.equal(details.quality_result.current_valid, true);
  assert.equal(details.quality_result.invalidation_reason, null);

  ctx.setPolicy({ profileVersion: "profile-v2", ruleVersion: "rules-v2" });
  details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(details.quality_result.conclusion, "passed");
  assert.equal(details.quality_result.current_valid, false);
  assert.equal(details.quality_result.invalidation_reason, "quality_policy_changed");

  ctx.setPolicy({ profileVersion: "profile-v1", ruleVersion: "rules-v1" });
  ctx.setCurrentRevisionId("child_revision_draft");
  details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(details.quality_result.conclusion, "passed");
  assert.equal(details.quality_result.current_valid, false);
  assert.equal(details.quality_result.invalidation_reason, "product_revision_changed");
});

test("starting QC freezes a draft and deduplicates concurrent effective runs across idempotency keys", async () => {
  const ctx = await world();
  const [first, second] = await Promise.all([
    ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id, expectedRevision: ctx.copy.row_version,
      profileVersion: "commerce-cn-v1", ruleVersion: "rules-2026-08", idempotencyKey: "qc-start-1" }),
    ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id, expectedRevision: ctx.copy.row_version,
      profileVersion: "commerce-cn-v1", ruleVersion: "rules-2026-08", idempotencyKey: "qc-start-2" })
  ]);

  assert.equal(first.copy_version.status, "frozen");
  assert.equal(first.quality_run.status, "queued");
  assert.equal(second.quality_run.id, first.quality_run.id);
  assert.equal((await ctx.service.listQualityRuns({ ...actor, copyVersionId: ctx.copy.id })).length, 1);
});

test("worker keeps technical state separate and aggregates immutable business conclusions", async (t) => {
  const cases = [
    { name: "incomplete checks", evaluation: { checks_complete: false, findings: [] }, conclusion: "invalid" },
    { name: "hard block", evaluation: { checks_complete: true, findings: [finding({ code: "ABSOLUTE_CLAIM",
      kind: "hard_block", severity: "critical", title: "绝对化功效", message: "不得使用绝对化功效表述",
      suggestion: "删除绝对化功效表述" })] }, conclusion: "blocked" },
    { name: "review finding", evaluation: { checks_complete: true, findings: [finding()] }, conclusion: "needs_review" },
    { name: "clean copy", evaluation: { checks_complete: true, findings: [] }, conclusion: "passed" }
  ];

  for (const current of cases) await t.test(current.name, async () => {
    const ctx = await world({ evaluate: async () => current.evaluation });
    const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id, expectedRevision: ctx.copy.row_version, profileVersion: "commerce-cn-v1", ruleVersion: "rules-2026-08", idempotencyKey: `start-${current.conclusion}` });
    await ctx.worker.runNext();
    const run = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
    assert.equal(run.quality_run.status, "succeeded");
    assert.equal(run.quality_result.conclusion, current.conclusion);
    assert.equal(run.quality_result.effective_conclusion, current.conclusion);
    assert.equal(run.quality_findings.length, current.evaluation.findings.length);
  });
});

test("QualityFinding preserves the minimum D-028 evidence fields", async () => {
  const ctx = await world({ evaluate: async () => ({ checks_complete: true, findings: [{
    code: "TONE_REVIEW", kind: "review", severity: "medium", title: "语气待判断",
    matched_text: "全网最好", message: "表达可能过于绝对",
    evidence_reference: "copy:text:12-16", rule_source: "brand_policy",
    suggestion: "改为可由商品事实支持的体验描述"
  }] }) });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id,
    expectedRevision: ctx.copy.row_version, idempotencyKey: "finding-evidence" });
  await ctx.worker.runNext();
  const details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.deepEqual(details.quality_findings[0], {
    id: details.quality_findings[0].id, organization_id: actor.organizationId,
    quality_result_id: details.quality_result.id, code: "TONE_REVIEW", kind: "review", severity: "medium",
    title: "语气待判断", matched_text: "全网最好", message: "表达可能过于绝对",
    evidence_reference: "copy:text:12-16", rule_source: "brand_policy",
    suggestion: "改为可由商品事实支持的体验描述", created_at: details.quality_findings[0].created_at,
    resolutions: []
  });
});

test("technical evaluator failure creates no business result and a rerun preserves history", async () => {
  let attempts = 0;
  const ctx = await world({ evaluate: async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error("controlled evaluator outage"), { code: "QUALITY_EVALUATOR_TEMPORARY_FAILURE" });
    return { checks_complete: true, findings: [] };
  } });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id, expectedRevision: ctx.copy.row_version, profileVersion: "commerce-cn-v1", ruleVersion: "rules-2026-08", idempotencyKey: "qc-failure" });
  await ctx.worker.runNext();
  const failed = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(failed.quality_run.status, "failed");
  assert.equal(failed.quality_result, null);

  const retried = await ctx.service.retryQualityCheck({ ...actor, qualityRunId: failed.quality_run.id, idempotencyKey: "qc-retry" });
  assert.notEqual(retried.quality_run.id, failed.quality_run.id);
  await ctx.worker.runNext();
  const completed = await ctx.service.getQualityRun({ ...actor, qualityRunId: retried.quality_run.id });
  assert.equal(completed.quality_result.conclusion, "passed");
  assert.deepEqual((await ctx.service.listQualityRuns({ ...actor, copyVersionId: ctx.copy.id })).map((entry) => entry.status), ["failed", "succeeded"]);
});

test("review findings are resolved one by one with append-only reasons and update only the effective conclusion", async () => {
  const ctx = await world({ evaluate: async () => ({ checks_complete: true, findings: [
    finding({ message: "请人工判断语气" }),
    finding({ code: "PRICE_REVIEW", severity: "high", title: "价格暗示", matched_text: "最低价",
      message: "请人工确认价格表达", evidence_reference: "copy:text:20-23",
      rule_source: "platform_policy", suggestion: "删除无法验证的价格比较" })
  ] }) });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id, expectedRevision: ctx.copy.row_version, profileVersion: "commerce-cn-v1", ruleVersion: "rules-2026-08", idempotencyKey: "qc-findings" });
  await ctx.worker.runNext();
  let details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  const [tone, price] = details.quality_findings;
  await assert.rejects(ctx.service.resolveFinding({ ...actor, findingId: tone.id, resolution: "accepted_with_reason", reason: "" , idempotencyKey: "resolve-empty" }), { code: "QUALITY_FINDING_REASON_REQUIRED" });
  await ctx.service.resolveFinding({ ...actor, findingId: tone.id, resolution: "accepted_with_reason", reason: "符合品牌自然分享语气", idempotencyKey: "resolve-tone" });
  details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(details.quality_result.conclusion, "needs_review");
  assert.equal(details.quality_result.effective_conclusion, "needs_review");
  assert.equal(details.quality_findings[0].resolutions[0].reason, "符合品牌自然分享语气");

  await ctx.service.resolveFinding({ ...actor, findingId: price.id, resolution: "change_requested", reason: "改为不含价格暗示的表述", idempotencyKey: "resolve-price" });
  details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(details.quality_result.conclusion, "needs_review");
  assert.equal(details.quality_result.effective_conclusion, "needs_review");

  await ctx.service.resolveFinding({ ...actor, findingId: price.id, resolution: "accepted_with_reason",
    reason: "运营复核后确认当前表达不构成价格承诺", idempotencyKey: "accept-price" });
  details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(details.quality_result.effective_conclusion, "passed");
});

test("hard block and fact gate findings cannot be accepted", async (t) => {
  for (const kind of ["hard_block", "fact_gate"]) await t.test(kind, async () => {
    const ctx = await world({ evaluate: async () => ({ checks_complete: true, findings: [finding({
      code: `GATE_${kind}`, kind, severity: "critical", title: "事实门禁",
      message: "必须修正文案或商品事实", suggestion: "返回商品事实修正" })] }) });
    const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id, expectedRevision: ctx.copy.row_version, profileVersion: "commerce-cn-v1", ruleVersion: "rules-2026-08", idempotencyKey: `qc-${kind}` });
    await ctx.worker.runNext();
    const details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
    await assert.rejects(ctx.service.resolveFinding({ ...actor, findingId: details.quality_findings[0].id, resolution: "accepted_with_reason", reason: "管理员接受", idempotencyKey: `accept-${kind}` }), { code: "QUALITY_FINDING_ACCEPT_BLOCKED" });
  });
});

test("AI rewrite is persistent async work and concurrent same-key requests execute once", async () => {
  let rewriteCalls = 0;
  const ctx = await world({ evaluate: async () => ({ checks_complete: true, findings: [finding({ message: "请改写" })] }), rewrite: async () => {
    rewriteCalls += 1;
    return { body: `改写后的完整商品种草文案 ${rewriteCalls}。` };
  } });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id, expectedRevision: ctx.copy.row_version, profileVersion: "commerce-cn-v1", ruleVersion: "rules-2026-08", idempotencyKey: "qc-before-rewrite" });
  await ctx.worker.runNext();
  const oldDetails = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  const request = { ...actor, copyVersionId: ctx.copy.id, findingId: oldDetails.quality_findings[0].id,
    scope: "matched_text", instruction: "保留卖点，弱化绝对化语气", idempotencyKey: "rewrite-copy" };
  const [rewritten, concurrentReplay] = await Promise.all([
    ctx.service.requestCopyRewrite(request), ctx.service.requestCopyRewrite(request)
  ]);

  assert.equal(rewritten.rewrite_job.status, "queued");
  assert.equal(concurrentReplay.rewrite_job.id, rewritten.rewrite_job.id);
  assert.equal((await ctx.service.requestCopyRewrite(request)).rewrite_job.id, rewritten.rewrite_job.id);
  assert.equal(rewriteCalls, 0);
  await Promise.all([ctx.rewriteWorker.runNext(), ctx.rewriteWorker.runNext()]);
  assert.equal(rewriteCalls, 1);
  const completed = await ctx.service.getRewriteJob({ ...actor, rewriteJobId: rewritten.rewrite_job.id });
  assert.equal(completed.rewrite_job.status, "succeeded");
  assert.notEqual(completed.copy_version.id, ctx.copy.id);
  assert.equal(completed.copy_version.body, "改写后的完整商品种草文案 1。");
  assert.equal(completed.copy_version.parent_copy_version_id, ctx.copy.id);
  assert.equal(completed.copy_version.status, "frozen");
  assert.equal(completed.quality_run.status, "queued");
  assert.equal((await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id })).quality_findings.length, 1);
  assert.equal((await ctx.copyService.listCopyVersions({ ...actor, productRevisionId: snapshot.id })).length, 2);
});

test("AI rewrite exposes running state and supports explicit failure retry", async () => {
  let release, calls = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const ctx = await world({ rewrite: async ({ copyVersion }) => {
    calls += 1;
    if (calls === 1) { await gate; throw Object.assign(new Error("temporary"), { code: "COPY_REWRITER_TEMPORARY_FAILURE" }); }
    return { body: `${copyVersion.body}\n重试后成功。` };
  } });
  await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id,
    expectedRevision: ctx.copy.row_version, idempotencyKey: "qc-before-rewrite-retry" });
  const requested = await ctx.service.requestCopyRewrite({ ...actor, copyVersionId: ctx.copy.id,
    scope: "full", instruction: "整体改得更自然", idempotencyKey: "rewrite-retry" });
  const runningPromise = ctx.rewriteWorker.runNext();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await ctx.service.getRewriteJob({ ...actor, rewriteJobId: requested.rewrite_job.id })).rewrite_job.status, "running");
  release();
  await runningPromise;
  let failed = await ctx.service.getRewriteJob({ ...actor, rewriteJobId: requested.rewrite_job.id });
  assert.equal(failed.rewrite_job.status, "failed");
  assert.equal(failed.rewrite_job.failure_code, "COPY_REWRITER_TEMPORARY_FAILURE");
  const retried = await ctx.service.retryCopyRewrite({ ...actor, rewriteJobId: requested.rewrite_job.id,
    idempotencyKey: "rewrite-retry-2" });
  assert.equal(retried.rewrite_job.status, "queued");
  await ctx.rewriteWorker.runNext();
  failed = await ctx.service.getRewriteJob({ ...actor, rewriteJobId: requested.rewrite_job.id });
  assert.equal(failed.rewrite_job.status, "succeeded");
  assert.equal(calls, 2);
  assert.equal((await ctx.copyService.listCopyVersions({ ...actor, productRevisionId: snapshot.id })).length, 2);
});

test("AI rewrite creates no CopyVersion when current ProductRevision changes while the provider runs", async () => {
  let releaseRewrite, markEntered;
  const entered = new Promise((resolve) => { markEntered = resolve; });
  const gate = new Promise((resolve) => { releaseRewrite = resolve; });
  const ctx = await world({ rewrite: async () => {
    markEntered();
    await gate;
    return { body: "不应落成新版本的改写文案。" };
  } });
  await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id,
    expectedRevision: ctx.copy.row_version, idempotencyKey: "qc-before-racing-rewrite" });
  const requested = await ctx.service.requestCopyRewrite({ ...actor, copyVersionId: ctx.copy.id,
    scope: "full", instruction: "整体改得更自然", idempotencyKey: "racing-rewrite" });

  const running = ctx.rewriteWorker.runNext();
  await entered;
  ctx.setCurrentRevisionId("child_revision_created_during_rewrite");
  releaseRewrite();
  await running;

  const failed = await ctx.service.getRewriteJob({ ...actor, rewriteJobId: requested.rewrite_job.id });
  assert.equal(failed.rewrite_job.status, "failed");
  assert.equal(failed.rewrite_job.failure_code, "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT");
  assert.equal(failed.rewrite_job.output_copy_version_id, null);
  assert.equal((await ctx.copyService.listCopyVersions({ ...actor, productRevisionId: snapshot.id })).length, 1);
});

test("rewrite job heartbeat extends its lease and an expired lease is safely reclaimed", async () => {
  let clock = Date.parse("2026-08-07T08:00:00.000Z");
  const ctx = await world({ now: () => clock });
  await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id,
    expectedRevision: ctx.copy.row_version, idempotencyKey: "qc-before-rewrite-lease" });
  const requested = await ctx.service.requestCopyRewrite({ ...actor, copyVersionId: ctx.copy.id,
    scope: "full", instruction: "整体改得更自然", idempotencyKey: "rewrite-lease" });
  const first = await ctx.service.claimNextRewriteJob({ leaseMs: 1000 });
  assert.equal(first.id, requested.rewrite_job.id);
  clock += 800;
  await ctx.service.heartbeatRewriteJob({ job: first, leaseMs: 1000 });
  clock += 500;
  assert.equal(await ctx.service.claimNextRewriteJob({ leaseMs: 1000 }), null);
  clock += 600;
  const reclaimed = await ctx.service.claimNextRewriteJob({ leaseMs: 1000 });
  assert.equal(reclaimed.id, first.id);
  assert.equal(reclaimed.attempts, 2);
});

test("queued quality runs can be cancelled without producing a business result", async () => {
  const ctx = await world();
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id,
    expectedRevision: ctx.copy.row_version, profileVersion: "commerce-cn-v1", ruleVersion: "rules-2026-08", idempotencyKey: "qc-cancel" });
  const cancelled = await ctx.service.cancelQualityCheck({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(cancelled.status, "cancelled");
  assert.equal((await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id })).quality_result, null);
  assert.equal(await ctx.worker.runNext(), null);
});

test("evaluator receives the frozen copy and authoritative product revision snapshots", async () => {
  let received;
  const ctx = await world({ evaluate: async (input) => { received = input; return { checks_complete: true, findings: [] }; } });
  await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id, expectedRevision: ctx.copy.row_version,
    profileVersion: "commerce-cn-v1", ruleVersion: "rules-2026-08", idempotencyKey: "qc-snapshots" });
  await ctx.worker.runNext();
  assert.equal(received.copyVersion.status, "frozen");
  assert.equal(received.copyVersion.body, "这是一条待质检的商品种草文案。");
  assert.equal(received.productRevision.id, snapshot.id);
  assert.equal(received.profileVersion, "commerce-cn-v1");
  assert.equal(received.ruleVersion, "rules-2026-08");
});

test("an incomplete evaluator Finding is a technical failure, not formal evidence", async () => {
  const incomplete = finding(); delete incomplete.suggestion;
  const ctx = await world({ evaluate: async () => ({ checks_complete: true, findings: [incomplete] }) });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id, expectedRevision: ctx.copy.row_version,
    profileVersion: "commerce-cn-v1", ruleVersion: "rules-2026-08", idempotencyKey: "qc-invalid-output" });
  await ctx.worker.runNext();
  const details = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(details.quality_run.status, "failed");
  assert.equal(details.quality_run.failure_code, "QUALITY_EVALUATION_INVALID");
  assert.equal(details.quality_result, null);
});

test("expired leases are reclaimed and become a technical failure after the final attempt", async () => {
  let current = Date.parse("2026-08-07T08:00:00.000Z");
  const ctx = await world({ now: () => current, maxAttempts: 2 });
  const started = await ctx.service.startQualityCheck({ ...actor, copyVersionId: ctx.copy.id,
    expectedRevision: ctx.copy.row_version, profileVersion: "commerce-cn-v1", ruleVersion: "rules-2026-08",
    idempotencyKey: "qc-lease-recovery" });

  const firstLease = await ctx.service.claimNextQualityRun({ leaseMs: 1000 });
  current += 1001;
  const recovered = await ctx.service.claimNextQualityRun({ leaseMs: 1000 });
  assert.equal(recovered.id, firstLease.id);
  assert.equal(recovered.attempts, 2);

  current += 1001;
  assert.equal(await ctx.service.claimNextQualityRun({ leaseMs: 1000 }), null);
  const failed = await ctx.service.getQualityRun({ ...actor, qualityRunId: started.quality_run.id });
  assert.equal(failed.quality_run.status, "failed");
  assert.equal(failed.quality_run.failure_code, "QUALITY_RUN_TIMED_OUT");
  assert.equal(failed.quality_result, null);
});
