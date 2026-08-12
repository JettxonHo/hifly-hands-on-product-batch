import assert from "node:assert/strict";
import test from "node:test";

import { createDeepSeekCopyRewriter } from "../src/copy-quality/deepseek-rewriter.js";
import { createDeepSeekClient } from "../src/llm/deepseek-client.js";

const sourceBody = "这是一条待改写的商品种草文案。";
const copyVersion = {
  id: "copy-source",
  organization_id: "org-secret",
  product_revision_id: "revision-source",
  generation_job_id: "generation-secret",
  asset_url: "https://private.example/asset.png",
  status: "frozen",
  body: sourceBody
};
const productRevision = {
  id: "revision-source",
  organization_id: "org-secret",
  project_id: "project-secret",
  product_id: "product-secret",
  status: "ready",
  product_name: "轻盈水杯",
  product_description: "适合日常饮水",
  primary_category: "家居",
  asset_version_ids: ["asset-secret-path"],
  content_brief: {
    expression_style: "自然口语化",
    selling_angle: "通勤便携",
    expected_length: "30秒",
    ending_style: "轻松收尾",
    additional_requirements: "避免绝对化表达",
    secret_field: "must-not-be-sent"
  },
  selling_points: [
    { id: "confirmed-1", text: "容量 300ml", confirmed: true },
    { id: "confirmed-2", text: "不含糖", confirmed: true },
    { id: "unconfirmed", text: "未确认功效", confirmed: false },
    { id: "legacy", text: "旧确认方式", confirmation_status: "confirmed" }
  ]
};
const finding = {
  id: "finding-secret",
  code: "MODEL_SECRET_CODE",
  kind: "review",
  severity: "high",
  title: "表达需要复核",
  matched_text: "全网最好",
  message: "该表达缺少可核验依据",
  suggestion: "改为可验证的体验描述",
  evidence_reference: "provider-secret-evidence",
  rule_source: "provider-secret-rule",
  resolutions: [{ state: "accepted_with_reason", reason: "secret" }]
};

function response(content, status = 200) {
  return { status, body: { choices: [{ message: { content } }] } };
}

function rewriterWithTransport(requests, requestResponse) {
  const client = createDeepSeekClient({
    apiKey: "server-only-key",
    transport: {
      async request(request) {
        requests.push(request);
        return typeof requestResponse === "function" ? requestResponse(requests.length) : requestResponse;
      }
    }
  });
  return createDeepSeekCopyRewriter({ client });
}

test("DeepSeek rewriter projects only the frozen copy, confirmed facts, normalized brief, and minimum finding fields", async () => {
  const requests = [];
  const rewriter = rewriterWithTransport(requests, response(JSON.stringify({ body: "改写后的商品种草文案。" })));

  const result = await rewriter.rewrite({
    copyVersion,
    productRevision,
    finding,
    scope: "matched_text",
    instruction: "保留卖点，改成可验证的表达"
  });

  assert.deepEqual(result, { body: "改写后的商品种草文案。" });
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body.thinking, { type: "disabled" });
  assert.deepEqual(requests[0].body.response_format, { type: "json_object" });

  const projected = JSON.parse(requests[0].body.messages.at(-1).content);
  assert.deepEqual(projected, {
    copy: { body: sourceBody },
    product_facts: {
      product_name: "轻盈水杯",
      product_description: "适合日常饮水",
      primary_category: "家居",
      confirmed_selling_points: ["容量 300ml", "不含糖"]
    },
    content_brief: {
      expression_style: "自然口语化",
      selling_angle: "通勤便携",
      expected_length: "30秒",
      ending_style: "轻松收尾",
      additional_requirements: "避免绝对化表达"
    },
    scope: "matched_text",
    instruction: "保留卖点，改成可验证的表达",
    finding: {
      kind: "review",
      title: "表达需要复核",
      matched_text: "全网最好",
      message: "该表达缺少可核验依据",
      suggestion: "改为可验证的体验描述"
    }
  });

  const serialized = JSON.stringify(projected);
  for (const excluded of [
    "org-secret", "project-secret", "product-secret", "generation-secret", "asset-secret-path",
    "private.example", "must-not-be-sent", "未确认功效", "旧确认方式", "MODEL_SECRET_CODE",
    "provider-secret-evidence", "provider-secret-rule", "secret"
  ]) assert.equal(serialized.includes(excluded), false, excluded);
});

test("DeepSeek rewriter normalizes missing brief fields and omits an absent finding", async () => {
  const requests = [];
  const rewriter = rewriterWithTransport(requests, response(JSON.stringify({ body: "规范化后的文案。" })));

  await rewriter.rewrite({
    copyVersion: { status: "frozen", body: sourceBody },
    productRevision: {
      product_name: "轻盈水杯",
      product_description: null,
      primary_category: null,
      content_brief: { selling_angle: "便携" },
      selling_points: [{ text: "容量 300ml", confirmed: true }]
    },
    scope: "full",
    instruction: "整体改得更自然"
  });

  const projected = JSON.parse(requests[0].body.messages.at(-1).content);
  assert.deepEqual(projected.content_brief, {
    expression_style: "自然口语化种草",
    selling_angle: "便携",
    ending_style: "自然收尾"
  });
  assert.equal("finding" in projected, false);
  assert.equal("product_description" in projected.product_facts, false);
  assert.equal("primary_category" in projected.product_facts, false);
});

test("DeepSeek rewriter retries exactly once for a structural output failure", async () => {
  let calls = 0;
  const rewriter = rewriterWithTransport([], (attempt) => {
    calls = attempt;
    return attempt === 1 ? response("not-json") : response(JSON.stringify({ body: "重试后的文案。" }));
  });

  assert.deepEqual(await rewriter.rewrite({ copyVersion, productRevision, scope: "full", instruction: "整体改写" }), {
    body: "重试后的文案。"
  });
  assert.equal(calls, 2);
});

test("DeepSeek rewriter exposes a stable invalid-output code after the second structural failure", async () => {
  let calls = 0;
  const requests = [];
  const rewriter = rewriterWithTransport(requests, () => {
    calls += 1;
    return response(JSON.stringify({ body: "" }));
  });

  await assert.rejects(
    rewriter.rewrite({ copyVersion, productRevision, scope: "full", instruction: "整体改写" }),
    (error) => error?.code === "COPY_REWRITE_OUTPUT_INVALID" &&
      error.message === "COPY_REWRITE_OUTPUT_INVALID" &&
      !error.message.includes("raw")
  );
  assert.equal(calls, 2);
  assert.equal(requests.length, 2);
});

test("DeepSeek HTTP and unknown provider failures do not retry or leak raw errors", async (t) => {
  await t.test("HTTP failure", async () => {
    let calls = 0;
    const rewriter = rewriterWithTransport([], () => {
      calls += 1;
      return response("provider detail", 503);
    });

    await assert.rejects(
      rewriter.rewrite({ copyVersion, productRevision, scope: "full", instruction: "整体改写" }),
      (error) => error?.code === "COPY_REWRITER_TEMPORARY_FAILURE" && error.message === "COPY_REWRITER_TEMPORARY_FAILURE"
    );
    assert.equal(calls, 1);
  });

  await t.test("unknown provider failure", async () => {
    let calls = 0;
    const rewriter = createDeepSeekCopyRewriter({
      client: {
        async complete() {
          calls += 1;
          throw Object.assign(new Error("raw provider secret"), { code: "DEEPSEEK_UNKNOWN_PROVIDER_ERROR" });
        }
      }
    });

    await assert.rejects(
      rewriter.rewrite({ copyVersion, productRevision, scope: "full", instruction: "整体改写" }),
      (error) => error?.code === "COPY_REWRITER_TEMPORARY_FAILURE" &&
        error.message === "COPY_REWRITER_TEMPORARY_FAILURE" &&
        !error.message.includes("raw provider secret")
    );
    assert.equal(calls, 1);
  });
});
