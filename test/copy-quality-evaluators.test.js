import assert from "node:assert/strict";
import test from "node:test";

import { createDeepSeekClient } from "../src/llm/deepseek-client.js";
import { createCopyQualityService } from "../src/copy-quality/copy-quality-service.js";
import { createCopyQualityWorker } from "../src/copy-quality/copy-quality-worker.js";
import { createDeterministicQualityEvaluator } from "../src/copy-quality/deterministic-evaluator.js";
import { createDeepSeekQualityEvaluator } from "../src/copy-quality/deepseek-evaluator.js";
import { createHybridQualityEvaluator } from "../src/copy-quality/hybrid-evaluator.js";
import { createMemoryCopyQualityRepository } from "../src/copy-quality/memory-copy-quality-repository.js";

const productRevision = {
  id: "revision-quality-evaluator",
  organization_id: "org-quality-evaluator",
  product_name: "轻盈水杯",
  product_description: "适合日常饮水",
  primary_category: "家居",
  content_brief: { expression_style: "自然口语化" },
  asset_version_ids: ["asset-secret-path"],
  selling_points: [
    { id: "point-volume", text: "容量 300ml", confirmed: true },
    { id: "point-sugar", text: "不含糖", confirmed: true },
    { id: "point-unconfirmed", text: "含有 50% 棉", confirmed: false },
    { id: "point-legacy", text: "含有 70% 棉", confirmation_status: "confirmed" }
  ]
};

const copyVersion = {
  id: "copy-quality-evaluator",
  organization_id: "org-quality-evaluator",
  product_revision_id: productRevision.id,
  body: "这款水杯容量 500ml，而且含糖，号称全网最好。采用 50% 棉。",
  generation_job_id: "generation-secret",
  asset_url: "https://private.example/product.png"
};

function response(content, status = 200) {
  return { status, body: { choices: [{ message: { content } }] } };
}

function qualityWorld({ evaluator }) {
  const copy = { ...copyVersion, status: "frozen", row_version: 1 };
  const revision = structuredClone(productRevision);
  const copyService = {
    async getCopyVersion() { return structuredClone(copy); },
    async getCurrentProductRevisionSnapshot() { return structuredClone(revision); },
    async freezeCopyVersion() { return structuredClone(copy); }
  };
  const repository = createMemoryCopyQualityRepository();
  const service = createCopyQualityService({
    repository,
    copyService,
    profileResolver: { async resolve() { return { profileVersion: "profile-test", ruleVersion: "rules-test" }; } }
  });
  const worker = createCopyQualityWorker({ service, evaluator, pollIntervalMs: 1 });
  return { copy, repository, service, worker };
}

test("deterministic evaluator uses only confirmed boolean facts and retains hard authority", async () => {
  const evaluator = createDeterministicQualityEvaluator({
    platformHardRules: [{
      code: "PLATFORM_ABSOLUTE_CLAIM",
      pattern: "全网最好",
      title: "平台禁用绝对化表达",
      message: "平台规则不允许该表达",
      suggestion: "删除绝对化表达"
    }]
  });
  const result = await evaluator.evaluate({ copyVersion, productRevision,
    providerRequest: async ({ execute }) => execute() });

  assert.equal(result.checks_complete, true);
  assert.equal(result.findings.some((finding) => finding.code === "FACT_NUMERIC_UNSUPPORTED" && finding.kind === "fact_gate"), true);
  assert.equal(result.findings.some((finding) => finding.code === "FACT_CONTRADICTION" && finding.kind === "fact_gate"), true);
  assert.equal(result.findings.some((finding) => finding.code === "PLATFORM_ABSOLUTE_CLAIM" && finding.kind === "hard_block"), true);
  assert.equal(result.findings.every((finding) => ["fact_gate", "hard_block"].includes(finding.kind)), true);
  assert.equal(result.findings.some((finding) => finding.matched_text.includes("70%")), false);
  assert.equal(result.findings.some((finding) => finding.code === "FACT_NUMERIC_UNSUPPORTED" &&
    finding.matched_text === "50%"), true);
});

test("deterministic contradiction matching stays narrow and does not infer arbitrary negation", async () => {
  const evaluator = createDeterministicQualityEvaluator({ platformHardRules: [] });
  const result = await evaluator.evaluate({
    copyVersion: { body: "这款水杯柔软亲肤。" },
    productRevision: {
      ...productRevision,
      selling_points: [{ id: "point-tone", text: "柔软亲肤", confirmed: true }]
    }
  });
  assert.deepEqual(result.findings, []);
});

test("DeepSeek semantic evaluator projects allowed snapshots and converts model output to review findings", async () => {
  const calls = [];
  const client = createDeepSeekClient({
    apiKey: "server-only-key",
    transport: { async request(request) { calls.push(request); return response(JSON.stringify({
      conclusion: "blocked",
      findings: [{
        dimension: "factuality",
        code: "MODEL_HARD_BLOCK",
        kind: "hard_block",
        matched_excerpt: "全网最好",
        claim_summary: "绝对化表达",
        finding_type: "absolute_claim",
        severity_suggestion: "high",
        evidence_refs: ["model-secret-evidence"],
        reason: "请人工判断该表达是否需要修改",
        remediation: "改为可验证的表达",
        confidence: "high"
      }]
    })); } }
  });
  const evaluator = createDeepSeekQualityEvaluator({ client });
  const result = await evaluator.evaluate({ copyVersion, productRevision,
    providerRequest: async ({ execute }) => execute() });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.thinking.type, "disabled");
  assert.deepEqual(calls[0].body.response_format, { type: "json_object" });
  const projected = JSON.parse(calls[0].body.messages.at(-1).content);
  assert.equal(projected.copy.body, copyVersion.body);
  assert.deepEqual(projected.product_facts.confirmed_selling_points, ["容量 300ml", "不含糖"]);
  assert.equal(JSON.stringify(projected).includes("asset-secret-path"), false);
  assert.equal(JSON.stringify(projected).includes("generation-secret"), false);
  assert.equal(JSON.stringify(projected).includes("private.example"), false);
  assert.equal(JSON.stringify(projected.product_facts).includes("50%"), false);
  assert.equal(JSON.stringify(projected.product_facts).includes("70%"), false);

  assert.equal(result.checks_complete, true);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].kind, "review");
  assert.equal(result.findings[0].code, "SEMANTIC_REVIEW_1");
  assert.equal(result.findings[0].rule_source, "llm_semantic_qc");
  assert.equal(result.findings[0].evidence_reference.startsWith("copy:text:"), true);
  assert.equal(result.findings[0].evidence_reference.includes("model-secret"), false);
});

test("DeepSeek semantic evaluator fails closed after one malformed output", async () => {
  let calls = 0;
  const client = createDeepSeekClient({
    apiKey: "server-only-key",
    transport: { async request() {
      calls += 1;
      return calls === 1 ? response("not-json") : response(JSON.stringify({ findings: [] }));
    } }
  });
  const evaluator = createDeepSeekQualityEvaluator({ client });
  await assert.rejects(evaluator.evaluate({ copyVersion, productRevision,
    providerRequest: async ({ execute }) => execute() }), { code: "QUALITY_EVALUATION_OUTPUT_MALFORMED" });
  assert.equal(calls, 1);
});

test("DeepSeek semantic evaluator fails safely after one structural failure", async () => {
  let calls = 0;
  const client = createDeepSeekClient({
    apiKey: "server-only-key",
    transport: { async request() {
      calls += 1;
      return response(JSON.stringify({ findings: [{ dimension: "quality" }] }));
    } }
  });
  const evaluator = createDeepSeekQualityEvaluator({ client });

  await assert.rejects(evaluator.evaluate({ copyVersion, productRevision,
    providerRequest: async ({ execute }) => execute() }), { code: "QUALITY_EVALUATION_SCHEMA_INVALID" });
  assert.equal(calls, 1);
});

test("DeepSeek provider failures do not retry and use a stable evaluator error", async () => {
  let calls = 0;
  const client = createDeepSeekClient({
    apiKey: "server-only-key",
    transport: { async request() { calls += 1; return response("temporary", 503); } }
  });
  const evaluator = createDeepSeekQualityEvaluator({ client });
  await assert.rejects(evaluator.evaluate({ copyVersion, productRevision,
    providerRequest: async ({ execute }) => execute() }), { code: "QUALITY_EVALUATOR_TEMPORARY_FAILURE" });
  assert.equal(calls, 1);
});

test("hybrid evaluator preserves deterministic blocks and requires semantic completion", async () => {
  const deterministic = createDeterministicQualityEvaluator({ platformHardRules: [] });
  const semantic = { kind: "fake_semantic", async evaluate() {
    return { checks_complete: true, findings: [{
      code: "MODEL_SUPPLIED_CODE", kind: "hard_block", severity: "critical", title: "模型结论",
      matched_text: "含糖", message: "请人工判断", evidence_reference: "model-evidence",
      rule_source: "model-rule", suggestion: "请人工判断"
    }] };
  } };
  const hybrid = createHybridQualityEvaluator({ deterministicEvaluator: deterministic, semanticEvaluator: semantic });
  const result = await hybrid.evaluate({ copyVersion, productRevision });
  assert.equal(result.findings.some((finding) => finding.code === "FACT_NUMERIC_UNSUPPORTED" && finding.kind === "fact_gate"), true);
  assert.equal(result.findings.some((finding) => finding.code === "SEMANTIC_REVIEW_1" && finding.kind === "review"), true);
  assert.equal(result.findings.some((finding) => finding.kind === "hard_block" && finding.code === "SEMANTIC_REVIEW_1"), false);
  assert.equal(result.findings.some((finding) => finding.rule_source === "llm_semantic_qc" && finding.evidence_reference.startsWith("copy:text:")), true);
});

test("hybrid semantic findings remain reviewable and server aggregation owns the conclusion", async () => {
  const revision = {
    ...productRevision,
    selling_points: [{ id: "point-commute", text: "适合通勤", confirmed: true }]
  };
  const semantic = { kind: "fake_semantic", async evaluate() {
    return { checks_complete: true, findings: [{
      severity: "high", title: "表达需要复核", matched_text: "适合通勤",
      message: "表达较宽泛", suggestion: "补充具体使用场景"
    }] };
  } };
  const evaluator = createHybridQualityEvaluator({
    deterministicEvaluator: createDeterministicQualityEvaluator(),
    semanticEvaluator: semantic
  });
  const copy = { ...copyVersion, body: "这款水杯适合通勤。", status: "frozen", row_version: 1 };
  const copyService = {
    async getCopyVersion() { return structuredClone(copy); },
    async getCurrentProductRevisionSnapshot() { return structuredClone(revision); },
    async freezeCopyVersion() { return structuredClone(copy); }
  };
  const repository = createMemoryCopyQualityRepository();
  const service = createCopyQualityService({
    repository,
    copyService,
    profileResolver: { async resolve() { return { profileVersion: "profile-test", ruleVersion: "rules-test" }; } }
  });
  const worker = createCopyQualityWorker({ service, evaluator, pollIntervalMs: 1 });
  const started = await service.startQualityCheck({
    organizationId: "org-quality-evaluator", actorMemberId: "member-quality-evaluator",
    copyVersionId: copy.id, expectedRevision: 1, idempotencyKey: "hybrid-review"
  });

  await worker.runNext();
  const details = await service.getQualityRun({
    organizationId: "org-quality-evaluator", actorMemberId: "member-quality-evaluator",
    qualityRunId: started.quality_run.id
  });
  assert.equal(details.quality_run.status, "succeeded");
  assert.equal(details.quality_result.conclusion, "needs_review");
  assert.equal(details.quality_findings[0].kind, "review");
});

test("hybrid semantic technical failure leaves the QualityRun failed without a QualityResult", async () => {
  const deterministic = createDeterministicQualityEvaluator({ platformHardRules: [] });
  const semantic = { kind: "fake_semantic", async evaluate() {
    throw Object.assign(new Error("provider detail must not escape"), { code: "QUALITY_EVALUATOR_TEMPORARY_FAILURE" });
  } };
  const { service, worker } = qualityWorld({
    evaluator: createHybridQualityEvaluator({ deterministicEvaluator: deterministic, semanticEvaluator: semantic })
  });
  const started = await service.startQualityCheck({
    organizationId: "org-quality-evaluator", actorMemberId: "member-quality-evaluator",
    copyVersionId: copyVersion.id, expectedRevision: 1, idempotencyKey: "hybrid-failure"
  });
  await worker.runNext();
  const details = await service.getQualityRun({
    organizationId: "org-quality-evaluator", actorMemberId: "member-quality-evaluator",
    qualityRunId: started.quality_run.id
  });
  assert.equal(details.quality_run.status, "failed");
  assert.equal(details.quality_result, null);
  assert.equal(details.quality_run.failure_code, "QUALITY_EVALUATOR_TEMPORARY_FAILURE");
});
