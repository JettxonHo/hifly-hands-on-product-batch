import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_PLATFORM_HARD_RULES,
  createDeterministicQualityEvaluator
} from "../src/copy-quality/deterministic-evaluator.js";

const copyVersion = { body: "这是一段有效的商品文案。" };

test("evaluate rejects snapshots without an authoritative confirmed selling point", async () => {
  const evaluator = createDeterministicQualityEvaluator({ platformHardRules: [] });

  for (const productRevision of [
    { product_name: "商品", selling_points: [] },
    { product_name: "商品", selling_points: [{ text: "", confirmed: true }] },
    { product_name: "商品", selling_points: [{ text: "未确认卖点", confirmed: false }] },
    { product_name: "商品", selling_points: [{ text: "旧确认状态", confirmation_status: "confirmed" }] }
  ]) {
    await assert.rejects(
      evaluator.evaluate({ copyVersion, productRevision, profileVersion: "profile-v1", ruleVersion: "rules-v1" }),
      (error) => error?.code === "QUALITY_EVALUATION_INVALID"
    );
  }
});

test("evaluate gates numeric claims against authoritative textual facts", async () => {
  const evaluator = createDeterministicQualityEvaluator({ platformHardRules: [] });
  const result = await evaluator.evaluate({
    copyVersion: { body: "产品 2.0，容量 300ml，轻便，容量 500ml。" },
    productRevision: {
      product_name: "净水杯 2.0",
      product_description: "容量 300ml，适合日常饮水",
      selling_points: [
        { id: "confirmed-light", text: "轻便", confirmed: true },
        { id: "unconfirmed-filter", text: "过滤 99%", confirmed: false }
      ]
    },
    profileVersion: "profile-v1",
    ruleVersion: "rules-v1"
  });

  assert.deepEqual(result.findings, [{
    code: "FACT_NUMERIC_UNSUPPORTED",
    kind: "fact_gate",
    severity: "high",
    title: "数字事实缺少已确认依据",
    matched_text: "500ml",
    message: "文案中的数字表达未在已确认商品事实中找到直接依据",
    evidence_reference: "product_revision:confirmed_selling_points",
    rule_source: "confirmed_product_facts",
    suggestion: "删除该数字表达，或先补充并确认对应商品事实"
  }]);
});

test("clean copy passes with no project-invented default hard rules", async () => {
  assert.deepEqual(DEFAULT_PLATFORM_HARD_RULES, []);
  assert.equal(Object.isFrozen(DEFAULT_PLATFORM_HARD_RULES), true);

  const evaluator = createDeterministicQualityEvaluator();
  const result = await evaluator.evaluate({
    copyVersion: { body: "这款商品不含糖，容量 300 ML，比例 50％，全网最好。" },
    productRevision: {
      product_name: "商品",
      product_description: "容量 300ml，比例 50%",
      selling_points: [{ id: "sugar", text: "不含糖", confirmed: true }]
    }
  });

  assert.deepEqual(result, { checks_complete: true, findings: [] });
});

test("direct contradiction matching supports both 不含X and 含X directions", async () => {
  const evaluator = createDeterministicQualityEvaluator({ platformHardRules: [] });

  const negativeFact = await evaluator.evaluate({
    copyVersion: { body: "本品含糖。" },
    productRevision: { selling_points: [{ id: "sugar", text: "不含糖", confirmed: true }] }
  });
  assert.equal(negativeFact.findings.length, 1);
  assert.equal(negativeFact.findings[0].code, "FACT_CONTRADICTION");
  assert.equal(negativeFact.findings[0].matched_text, "含糖");

  const positiveFact = await evaluator.evaluate({
    copyVersion: { body: "本品不含糖。" },
    productRevision: { selling_points: [{ id: "sugar", text: "含糖", confirmed: true }] }
  });
  assert.equal(positiveFact.findings.length, 1);
  assert.equal(positiveFact.findings[0].code, "FACT_CONTRADICTION");
  assert.equal(positiveFact.findings[0].matched_text, "不含糖");
});

test("contradiction matching does not infer broad negation pairs or overlong subjects", async () => {
  const evaluator = createDeterministicQualityEvaluator({ platformHardRules: [] });
  const cases = [
    ["无糖", "有糖"],
    ["无需安装", "需要安装"],
    ["不添加香精", "添加香精"],
    [`不含${"a".repeat(41)}`, `含${"a".repeat(41)}`]
  ];

  for (const [fact, body] of cases) {
    const result = await evaluator.evaluate({
      copyVersion: { body },
      productRevision: { selling_points: [{ id: "fact", text: fact, confirmed: true }] }
    });
    assert.deepEqual(result.findings, [], `unexpected finding for ${fact}`);
  }
});

test("explicit injected platform hard rules remain public and deterministic", async () => {
  const evaluator = createDeterministicQualityEvaluator({
    platformHardRules: [{
      code: "PLATFORM_TEST_RULE",
      pattern: "全网最好",
      title: "测试平台规则",
      message: "命中显式注入规则",
      suggestion: "修改表达"
    }]
  });
  const result = await evaluator.evaluate({
    copyVersion: { body: "这款商品全网最好。" },
    productRevision: { selling_points: [{ id: "quality", text: "轻便", confirmed: true }] }
  });

  assert.deepEqual(result.findings, [{
    code: "PLATFORM_TEST_RULE",
    kind: "hard_block",
    severity: "critical",
    title: "测试平台规则",
    matched_text: "全网最好",
    message: "命中显式注入规则",
    evidence_reference: "platform:PLATFORM_TEST_RULE",
    rule_source: "platform_policy",
    suggestion: "修改表达"
  }]);
});

test("numeric fact matching retains units and normalizes equivalent formatting", async () => {
  const evaluator = createDeterministicQualityEvaluator({ platformHardRules: [] });
  const result = await evaluator.evaluate({
    copyVersion: { body: "容量 300g。" },
    productRevision: {
      product_description: "容量 300ml，比例 50%",
      selling_points: [
        { id: "volume", text: "容量 300ml", confirmed: true },
        { id: "ratio", text: "比例 50%", confirmed: true }
      ]
    }
  });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].code, "FACT_NUMERIC_UNSUPPORTED");
  assert.equal(result.findings[0].matched_text, "300g");

  const normalized = await evaluator.evaluate({
    copyVersion: { body: "容量 300 ML，比例 50％。" },
    productRevision: {
      selling_points: [
        { id: "volume", text: "容量 300ml", confirmed: true },
        { id: "ratio", text: "比例 50%", confirmed: true }
      ]
    }
  });
  assert.deepEqual(normalized.findings, []);
});

test("duplicate confirmed facts do not duplicate the same contradiction occurrence", async () => {
  const evaluator = createDeterministicQualityEvaluator({ platformHardRules: [] });
  const result = await evaluator.evaluate({
    copyVersion: { body: "本品含糖。" },
    productRevision: {
      selling_points: [
        { id: "sugar-a", text: "不含糖", confirmed: true },
        { id: "sugar-b", text: "不含糖", confirmed: true }
      ]
    }
  });

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].code, "FACT_CONTRADICTION");
});
