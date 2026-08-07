import assert from "node:assert/strict";
import test from "node:test";

import { createControlledCopyProvider } from "../src/copy-generation/controlled-provider.js";
import { createCopyGenerationService } from "../src/copy-generation/copy-generation-service.js";
import { createCopyGenerationWorker } from "../src/copy-generation/copy-generation-worker.js";
import { createMemoryCopyGenerationRepository } from "../src/copy-generation/memory-copy-generation-repository.js";

const actor = { organizationId: "org_copy", actorMemberId: "member_copy" };
const readySnapshot = {
  id: "revision_ready",
  organization_id: actor.organizationId,
  project_id: "project_copy",
  product_id: "product_copy",
  status: "ready",
  revision_number: 3,
  product_name: "云朵抱枕",
  product_description: "适合办公室午休",
  primary_category: "home",
  content_brief: { expression_style: "自然分享" },
  selling_points: [{ id: "point_1", text: "柔软亲肤", confirmed: true }],
  asset_version_ids: ["asset_version_1"]
};

function world({ provider, now } = {}) {
  const repository = createMemoryCopyGenerationRepository();
  let revisionStatus = "ready";
  const productRevisionPort = {
    async getSnapshot({ organizationId, productRevisionId }) {
      if (organizationId !== actor.organizationId || productRevisionId !== readySnapshot.id) {
        throw Object.assign(new Error("PRODUCT_REVISION_NOT_FOUND"), { code: "PRODUCT_REVISION_NOT_FOUND" });
      }
      return structuredClone({ ...readySnapshot, status: revisionStatus });
    },
    async getReadySnapshot({ organizationId, productRevisionId }) {
      const snapshot = await this.getSnapshot({ organizationId, productRevisionId });
      if (snapshot.status !== "ready") {
        throw Object.assign(new Error("PRODUCT_REVISION_NOT_FOUND"), { code: "PRODUCT_REVISION_NOT_FOUND" });
      }
      if (organizationId !== actor.organizationId || productRevisionId !== readySnapshot.id) {
        throw Object.assign(new Error("PRODUCT_REVISION_NOT_FOUND"), { code: "PRODUCT_REVISION_NOT_FOUND" });
      }
      return snapshot;
    },
    async getCurrentReadySnapshot(input) {
      return this.getReadySnapshot(input);
    }
  };
  const service = createCopyGenerationService({ repository, productRevisionPort, now });
  const worker = createCopyGenerationWorker({
    service,
    provider: provider || createControlledCopyProvider()
  });
  return { repository, service, worker, supersedeRevision() { revisionStatus = "superseded"; } };
}

test("ready product revision generates one editable copy draft asynchronously", async () => {
  const ctx = world();

  const requested = await ctx.service.requestGeneration({
    ...actor,
    productRevisionId: readySnapshot.id,
    intent: "product_recommendation",
    idempotencyKey: "generate-copy-1"
  });

  assert.equal(requested.job.status, "queued");
  assert.equal(requested.copy_version, null);
  assert.deepEqual(await ctx.service.listCopyVersions({ ...actor, productRevisionId: readySnapshot.id }), []);

  await ctx.worker.runNext();

  const restored = await ctx.service.getGenerationJob({ ...actor, jobId: requested.job.id });
  const copies = await ctx.service.listCopyVersions({ ...actor, productRevisionId: readySnapshot.id });
  assert.equal(restored.status, "succeeded");
  assert.equal(copies.length, 1);
  assert.equal(copies[0].status, "draft");
  assert.equal(copies[0].version_number, 1);
  assert.match(copies[0].body, /云朵抱枕/);
  assert.match(copies[0].body, /柔软亲肤/);
  assert.equal(copies[0].generation_job_id, requested.job.id);
});

test("superseded product revisions retain copy history while blocking new generation", async () => {
  const ctx = world();
  const draft = await generatedDraft(ctx, "historical-copy");
  ctx.supersedeRevision();

  assert.equal((await ctx.service.listCopyVersions({ ...actor, productRevisionId: readySnapshot.id }))[0].id, draft.id);
  assert.equal((await ctx.service.listGenerationJobs({ ...actor, productRevisionId: readySnapshot.id }))[0].status, "succeeded");
  await assert.rejects(ctx.service.requestGeneration({
    ...actor, productRevisionId: readySnapshot.id, intent: "product_recommendation", idempotencyKey: "historical-new-generation"
  }), { code: "PRODUCT_REVISION_NOT_FOUND" });
});

async function generatedDraft(ctx, idempotencyKey = "generate-copy-lifecycle") {
  const requested = await ctx.service.requestGeneration({
    ...actor, productRevisionId: readySnapshot.id, intent: "product_recommendation", idempotencyKey
  });
  await ctx.worker.runNext();
  return (await ctx.service.listCopyVersions({ ...actor, productRevisionId: readySnapshot.id })).at(-1);
}

test("editing a frozen copy creates a new draft and preserves immutable history", async () => {
  const ctx = world();
  const draft = await generatedDraft(ctx);
  const edited = await ctx.service.editCopyVersion({
    ...actor, copyVersionId: draft.id, expectedRevision: 1, body: "第一版人工调整文案"
  });
  assert.equal(edited.id, draft.id);
  assert.equal(edited.row_version, 2);

  const frozen = await ctx.service.freezeCopyVersion({
    ...actor, copyVersionId: edited.id, expectedRevision: edited.row_version, idempotencyKey: "freeze-copy-1"
  });
  assert.equal(frozen.status, "frozen");

  const child = await ctx.service.editCopyVersion({
    ...actor, copyVersionId: frozen.id, expectedRevision: frozen.row_version, body: "冻结后形成的新草稿"
  });
  assert.notEqual(child.id, frozen.id);
  assert.equal(child.status, "draft");
  assert.equal(child.parent_copy_version_id, frozen.id);
  assert.equal((await ctx.service.getCopyVersion({ ...actor, copyVersionId: frozen.id })).status, "frozen");

  const nextFrozen = await ctx.service.freezeCopyVersion({
    ...actor, copyVersionId: child.id, expectedRevision: child.row_version, idempotencyKey: "freeze-copy-2"
  });
  assert.equal(nextFrozen.status, "frozen");
  assert.equal((await ctx.service.getCopyVersion({ ...actor, copyVersionId: frozen.id })).status, "superseded");
  assert.equal((await ctx.service.getCopyVersion({ ...actor, copyVersionId: frozen.id })).body, "第一版人工调整文案");

  await assert.rejects(ctx.service.editCopyVersion({
    ...actor, copyVersionId: child.id, expectedRevision: 1, body: "旧页面覆盖"
  }), { code: "COPY_VERSION_CONFLICT" });
});

test("editing an older frozen copy allocates the next repository version", async () => {
  const ctx = world();
  const firstDraft = await generatedDraft(ctx, "version-one");
  const firstFrozen = await ctx.service.freezeCopyVersion({
    ...actor, copyVersionId: firstDraft.id, expectedRevision: firstDraft.row_version, idempotencyKey: "freeze-version-one"
  });
  const secondDraft = await generatedDraft(ctx, "version-two");
  const secondFrozen = await ctx.service.freezeCopyVersion({
    ...actor, copyVersionId: secondDraft.id, expectedRevision: secondDraft.row_version, idempotencyKey: "freeze-version-two"
  });

  const derived = await ctx.service.editCopyVersion({
    ...actor, copyVersionId: firstFrozen.id, expectedRevision: firstFrozen.row_version, body: "从旧版本派生的新文案"
  });

  assert.equal(secondFrozen.version_number, 2);
  assert.equal(derived.version_number, 3);
  assert.equal(derived.parent_copy_version_id, firstFrozen.id);
  assert.deepEqual((await ctx.service.listCopyVersions({ ...actor, productRevisionId: readySnapshot.id })).map((copy) => copy.version_number), [1, 2, 3]);
});

test("deriving from frozen history replaces the previous current draft", async () => {
  const ctx = world();
  const firstDraft = await generatedDraft(ctx, "single-draft-version-one");
  const frozen = await ctx.service.freezeCopyVersion({
    ...actor, copyVersionId: firstDraft.id, expectedRevision: firstDraft.row_version, idempotencyKey: "single-draft-freeze"
  });
  const priorDraft = await ctx.service.editCopyVersion({
    ...actor, copyVersionId: frozen.id, expectedRevision: frozen.row_version, body: "先前尚未冻结的草稿"
  });

  const replacement = await ctx.service.editCopyVersion({
    ...actor,
    copyVersionId: frozen.id,
    expectedRevision: (await ctx.service.getCopyVersion({ ...actor, copyVersionId: frozen.id })).row_version,
    body: "重新从冻结历史派生的草稿"
  });
  const copies = await ctx.service.listCopyVersions({ ...actor, productRevisionId: readySnapshot.id });

  assert.equal(copies.find((copy) => copy.id === priorDraft.id).status, "superseded");
  assert.equal(copies.find((copy) => copy.id === replacement.id).status, "draft");
  assert.equal(copies.filter((copy) => copy.status === "draft").length, 1);
});

test("generation request is idempotent and a failed job retries without duplicate copy", async () => {
  let attempts = 0;
  const ctx = world({ provider: createControlledCopyProvider({
    async generate({ productRevision }) {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("temporary provider failure"), { code: "COPY_PROVIDER_TEMPORARY_FAILURE" });
      return { body: `${productRevision.product_name}重试后生成成功` };
    }
  }) });
  const command = { ...actor, productRevisionId: readySnapshot.id, intent: "product_recommendation", idempotencyKey: "generation-retry" };
  const requested = await ctx.service.requestGeneration(command);
  const replay = await ctx.service.requestGeneration(command);
  assert.equal(replay.job.id, requested.job.id);
  await assert.rejects(ctx.service.requestGeneration({ ...command, intent: "short_rewrite" }), { code: "IDEMPOTENCY_CONFLICT" });

  await ctx.worker.runNext();
  assert.equal((await ctx.service.getGenerationJob({ ...actor, jobId: requested.job.id })).status, "failed");
  assert.deepEqual(await ctx.service.listCopyVersions({ ...actor, productRevisionId: readySnapshot.id }), []);

  const retried = await ctx.service.retryGenerationJob({
    ...actor, jobId: requested.job.id, idempotencyKey: "retry-generation-1"
  });
  assert.equal(retried.id, requested.job.id);
  assert.equal(retried.status, "queued");
  assert.equal((await ctx.service.retryGenerationJob({ ...actor, jobId: requested.job.id, idempotencyKey: "retry-generation-1" })).id, retried.id);

  await ctx.worker.runNext();
  const copies = await ctx.service.listCopyVersions({ ...actor, productRevisionId: readySnapshot.id });
  assert.equal(copies.length, 1);
  assert.match(copies[0].body, /重试后生成成功/);
  assert.equal((await ctx.service.getGenerationJob({ ...actor, jobId: requested.job.id })).attempts, 2);
});

test("an accepted retry remains replayable after the final attempt is exhausted", async () => {
  const ctx = world({ provider: createControlledCopyProvider({
    async generate() {
      throw Object.assign(new Error("controlled failure"), { code: "COPY_PROVIDER_TEMPORARY_FAILURE" });
    }
  }) });
  const requested = await ctx.service.requestGeneration({
    ...actor, productRevisionId: readySnapshot.id, intent: "product_recommendation", idempotencyKey: "retry-replay-generation"
  });

  await ctx.worker.runNext();
  await ctx.service.retryGenerationJob({ ...actor, jobId: requested.job.id, idempotencyKey: "retry-attempt-two" });
  await ctx.worker.runNext();
  const acceptedFinalRetry = await ctx.service.retryGenerationJob({
    ...actor, jobId: requested.job.id, idempotencyKey: "retry-attempt-three"
  });
  await ctx.worker.runNext();

  const replay = await ctx.service.retryGenerationJob({
    ...actor, jobId: requested.job.id, idempotencyKey: "retry-attempt-three"
  });
  assert.equal(replay.id, acceptedFinalRetry.id);
  assert.equal(replay.attempts, 3);
  assert.equal(replay.status, "failed");
  await assert.rejects(ctx.service.retryGenerationJob({
    ...actor, jobId: requested.job.id, idempotencyKey: "retry-after-exhaustion"
  }), { code: "COPY_GENERATION_RETRY_EXHAUSTED" });
});

test("expired leases recover safely and stale workers cannot complete the job", async () => {
  let clock = Date.parse("2026-08-06T10:00:00.000Z");
  const ctx = world({ now: () => clock });
  const requested = await ctx.service.requestGeneration({
    ...actor, productRevisionId: readySnapshot.id, intent: "product_recommendation", idempotencyKey: "lease-recovery"
  });
  const firstLease = await ctx.service.claimNextGenerationJob({ leaseMs: 1_000 });
  assert.equal(firstLease.id, requested.job.id);
  assert.equal(firstLease.attempts, 1);

  clock += 500;
  const heartbeat = await ctx.service.heartbeatGenerationJob({ job: firstLease, leaseMs: 1_000 });
  assert.equal(heartbeat.status, "running");
  clock += 600;
  assert.equal(await ctx.service.claimNextGenerationJob({ leaseMs: 1_000 }), null);

  clock += 500;
  const recovered = await ctx.service.claimNextGenerationJob({ leaseMs: 1_000 });
  assert.equal(recovered.id, firstLease.id);
  assert.equal(recovered.attempts, 2);
  assert.notEqual(recovered.lease_token, firstLease.lease_token);
  await assert.rejects(ctx.service.completeGenerationJob({ job: firstLease, body: "迟到结果" }), { code: "COPY_GENERATION_LEASE_LOST" });

  const cancelled = await ctx.service.abortGenerationJob({ ...actor, jobId: recovered.id });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(await ctx.service.claimNextGenerationJob({ leaseMs: 1_000 }), null);
});

test("expired leases stop at max attempts and finish as timed out", async () => {
  let clock = Date.parse("2026-08-06T11:00:00.000Z");
  const ctx = world({ now: () => clock });
  const requested = await ctx.service.requestGeneration({
    ...actor, productRevisionId: readySnapshot.id, intent: "product_recommendation", idempotencyKey: "lease-timeout"
  });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const claimed = await ctx.service.claimNextGenerationJob({ leaseMs: 1_000 });
    assert.equal(claimed.attempts, attempt);
    clock += 1_001;
  }

  assert.equal(await ctx.service.claimNextGenerationJob({ leaseMs: 1_000 }), null);
  const timedOut = await ctx.service.getGenerationJob({ ...actor, jobId: requested.job.id });
  assert.equal(timedOut.status, "timed_out");
  assert.equal(timedOut.attempts, timedOut.max_attempts);
  assert.ok(timedOut.completed_at);
});

test("concurrent generation completions allocate ordered versions with one current draft", async () => {
  const ctx = world();
  await ctx.service.requestGeneration({ ...actor, productRevisionId: readySnapshot.id, intent: "product_recommendation", idempotencyKey: "parallel-1" });
  await ctx.service.requestGeneration({ ...actor, productRevisionId: readySnapshot.id, intent: "product_recommendation", idempotencyKey: "parallel-2" });
  const first = await ctx.service.claimNextGenerationJob();
  const second = await ctx.service.claimNextGenerationJob();
  await Promise.all([
    ctx.service.completeGenerationJob({ job: first, body: "并发文案一" }),
    ctx.service.completeGenerationJob({ job: second, body: "并发文案二" })
  ]);
  const copies = await ctx.service.listCopyVersions({ ...actor, productRevisionId: readySnapshot.id });
  assert.deepEqual(copies.map((copy) => copy.version_number), [1, 2]);
  assert.deepEqual(copies.map((copy) => copy.status), ["superseded", "draft"]);
});
