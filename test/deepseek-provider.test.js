import assert from "node:assert/strict";
import test from "node:test";

import { createDeepSeekCopyProvider } from "../src/copy-generation/deepseek-provider.js";
import { createCopyGenerationService } from "../src/copy-generation/copy-generation-service.js";
import { createCopyGenerationWorker } from "../src/copy-generation/copy-generation-worker.js";
import { createMemoryCopyGenerationRepository } from "../src/copy-generation/memory-copy-generation-repository.js";
import { createDeepSeekClient } from "../src/llm/deepseek-client.js";

const revision = {
  id: "revision-ready",
  product_name: "云朵抱枕",
  product_description: "适合办公室午休",
  primary_category: "home",
  content_brief: {
    expression_style: "自然分享",
    selling_angle: "办公舒适",
    expected_length: "短文案",
    ending_style: "自然收尾",
    additional_requirements: "只使用已确认事实",
    image_url: "https://example.invalid/product.png"
  },
  selling_points: [
    { text: "柔软亲肤", confirmed: true },
    { text: "未经确认的卖点", confirmed: false }
  ],
  asset_version_ids: ["asset-version-1"],
  image_path: "/private/product.png",
  hifly_token: "hifly-secret",
  cookie: "session=secret"
};

function response(content) {
  return { choices: [{ message: { content, reasoning_content: "不应被保存" } }] };
}

test("DeepSeek copy adapter sends only confirmed textual facts and allowed ContentBrief fields", async () => {
  const requests = [];
  const provider = createDeepSeekCopyProvider({
    client: {
      async complete(input) {
        requests.push(input);
        return response(JSON.stringify({ body: "云朵抱枕，柔软亲肤，适合办公室午休。" }));
      }
    }
  });

  assert.deepEqual(
    await provider.generateCopy({ productRevision: revision, intent: "product_recommendation" }),
    { body: "云朵抱枕，柔软亲肤，适合办公室午休。" }
  );
  assert.equal(requests.length, 1);
  assert.match(requests[0].messages[0].content, /json/i);
  assert.match(requests[0].messages[0].content, /body/);

  const promptInput = JSON.parse(requests[0].messages[1].content);
  assert.deepEqual(promptInput, {
    product_facts: {
      product_name: "云朵抱枕",
      product_description: "适合办公室午休",
      primary_category: "home",
      confirmed_selling_points: ["柔软亲肤"]
    },
    content_brief: {
      expression_style: "自然分享",
      selling_angle: "办公舒适",
      expected_length: "短文案",
      ending_style: "自然收尾",
      additional_requirements: "只使用已确认事实"
    }
  });
  const serialized = JSON.stringify(promptInput);
  for (const forbidden of ["asset-version-1", "product.png", "hifly-secret", "session=secret", "example.invalid"]) {
    assert.equal(serialized.includes(forbidden), false, `forbidden value leaked: ${forbidden}`);
  }
});

test("DeepSeek copy adapter applies D-022 defaults without making ContentBrief required", async () => {
  let request;
  const provider = createDeepSeekCopyProvider({
    client: {
      async complete(input) {
        request = input;
        return response('{"body":"默认文案"}');
      }
    }
  });

  const result = await provider.generateCopy({
    productRevision: { ...revision, content_brief: null },
    intent: "product_recommendation"
  });

  assert.deepEqual(result, { body: "默认文案" });
  assert.deepEqual(JSON.parse(request.messages[1].content).content_brief, {
    expression_style: "自然口语化种草",
    ending_style: "自然收尾"
  });
});

test("empty or malformed output is retried once with the same request and then fails", async () => {
  const requests = [];
  const outputs = [response(""), response('{"text":"缺少 body"}')];
  const provider = createDeepSeekCopyProvider({
    client: {
      async complete(input) {
        requests.push(structuredClone(input));
        return outputs.shift();
      }
    }
  });

  await assert.rejects(provider.generateCopy({ productRevision: revision }), {
    code: "COPY_PROVIDER_OUTPUT_INVALID",
    message: "COPY_PROVIDER_OUTPUT_INVALID"
  });
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[0], requests[1]);
});

test("a structural failure retries once and accepts a valid second JSON body", async () => {
  let calls = 0;
  const provider = createDeepSeekCopyProvider({
    client: {
      async complete() {
        calls += 1;
        return response(calls === 1 ? '{"body":"截断' : '{"body":"第二次成功"}');
      }
    }
  });

  assert.deepEqual(await provider.generateCopy({ productRevision: revision }), { body: "第二次成功" });
  assert.equal(calls, 2);
});

test("HTTP/provider errors are not retried or replaced by another provider", async () => {
  let calls = 0;
  const provider = createDeepSeekCopyProvider({
    client: {
      async complete() {
        calls += 1;
        throw Object.assign(new Error("DEEPSEEK_RATE_LIMITED"), { code: "DEEPSEEK_RATE_LIMITED" });
      }
    }
  });

  await assert.rejects(provider.generateCopy({ productRevision: revision }), {
    code: "COPY_PROVIDER_FAILED",
    message: "COPY_PROVIDER_FAILED"
  });
  assert.equal(calls, 1);
});

test("allowed textual fields are preserved while asset and credential fields remain excluded", async () => {
  let calls = 0;
  let request;
  const provider = createDeepSeekCopyProvider({
    client: { async complete(input) { calls += 1; request = input; return response('{"body":"正常文案"}'); } }
  });

  assert.deepEqual(await provider.generateCopy({
    productRevision: {
      ...revision,
      content_brief: { additional_requirements: "不要朗读品牌官网 https://example.com" }
    }
  }), { body: "正常文案" });
  assert.equal(calls, 1);
  const promptInput = JSON.parse(request.messages[1].content);
  assert.equal(promptInput.content_brief.additional_requirements, "不要朗读品牌官网 https://example.com");
  assert.equal(JSON.stringify(promptInput).includes("/private/product.png"), false);
  assert.equal(JSON.stringify(promptInput).includes("hifly-secret"), false);
});

test("malformed typed snapshot fields fail before transport", async () => {
  let calls = 0;
  const provider = createDeepSeekCopyProvider({
    client: { async complete() { calls += 1; return response('{"body":"不应调用"}'); } }
  });

  await assert.rejects(provider.generateCopy({
    productRevision: { ...revision, product_description: { text: "错误结构" } }
  }), { code: "COPY_PROVIDER_INPUT_INVALID", message: "COPY_PROVIDER_INPUT_INVALID" });
  assert.equal(calls, 0);
});

test("unknown client failures are mapped to the safe provider error", async () => {
  const provider = createDeepSeekCopyProvider({
    client: {
      async complete() {
        throw new Error("sensitive upstream detail");
      }
    }
  });

  await assert.rejects(provider.generateCopy({ productRevision: revision }), {
    code: "COPY_PROVIDER_FAILED",
    message: "COPY_PROVIDER_FAILED"
  });
});

test("DeepSeek adapter completes the existing async job as one draft CopyVersion", async () => {
  const repository = createMemoryCopyGenerationRepository();
  let request;
  const client = createDeepSeekClient({
    apiKey: "unit-test-key",
    transport: {
      async request(input) {
        request = input;
        return {
          status: 200,
          body: response('{"body":"异步生成的草稿"}')
        };
      }
    }
  });
  const productRevisionPort = {
    async getReadySnapshot() {
      return structuredClone({
        id: "revision-async",
        project_id: "project-async",
        product_id: "product-async",
        status: "ready",
        product_name: "异步商品",
        product_description: "异步描述",
        primary_category: "general",
        content_brief: null,
        selling_points: [{ text: "异步卖点", confirmed: true }]
      });
    },
    async getSnapshot() { return this.getReadySnapshot(); },
    async getCurrentReadySnapshot() { return this.getReadySnapshot(); }
  };
  const service = createCopyGenerationService({ repository, productRevisionPort });
  const worker = createCopyGenerationWorker({ service, provider: createDeepSeekCopyProvider({ client }) });

  const requested = await service.requestGeneration({
    organizationId: "org-async",
    actorMemberId: "member-async",
    productRevisionId: "revision-async",
    intent: "product_recommendation",
    idempotencyKey: "deepseek-async"
  });
  await worker.runNext();

  const job = await service.getGenerationJob({ organizationId: "org-async", actorMemberId: "member-async", jobId: requested.job.id });
  const copies = await service.listCopyVersions({ organizationId: "org-async", actorMemberId: "member-async", productRevisionId: "revision-async" });
  assert.equal(job.status, "succeeded");
  assert.equal(copies.length, 1);
  assert.deepEqual({ status: copies[0].status, body: copies[0].body }, { status: "draft", body: "异步生成的草稿" });
  assert.equal(request.body.model, "deepseek-v4-flash");
  assert.deepEqual(request.body.thinking, { type: "disabled" });
  assert.deepEqual(request.body.response_format, { type: "json_object" });
});
