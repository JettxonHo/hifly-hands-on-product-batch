import { randomUUID } from "node:crypto";

const failure = (code) => Object.assign(new Error(code), { code });
const cleanText = (value) => typeof value === "string" ? value.trim() : "";

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function context(input) {
  if (!cleanText(input.organizationId) || !cleanText(input.actorMemberId)) throw failure("COPY_GENERATION_CONTEXT_REQUIRED");
}

function idempotencyKey(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 128) throw failure("INVALID_IDEMPOTENCY_KEY");
  return value;
}

export function createCopyGenerationService({ repository, productRevisionPort, now = () => Date.now(), maxAttempts = 3 } = {}) {
  if (!repository || !productRevisionPort?.getReadySnapshot || !productRevisionPort?.getSnapshot ||
    !productRevisionPort?.getCurrentReadySnapshot) throw new TypeError("repository and productRevisionPort are required");
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new TypeError("maxAttempts must be a positive integer");
  const timestamp = () => new Date(now()).toISOString();

  return {
    async requestGeneration(input) {
      context(input);
      const intent = cleanText(input.intent) || "product_recommendation";
      const key = idempotencyKey(input.idempotencyKey);
      const productRevision = await productRevisionPort.getReadySnapshot({ organizationId: input.organizationId, productRevisionId: input.productRevisionId });
      const at = timestamp();
      const job = {
        id: randomUUID(), organization_id: input.organizationId, type: "copy_generation", status: "queued",
        product_revision_id: productRevision.id, project_id: productRevision.project_id, product_id: productRevision.product_id,
        intent, input_snapshot: productRevision, attempts: 0, max_attempts: maxAttempts, copy_version_id: null, failure_code: null,
        started_at: null, heartbeat_at: null, lease_expires_at: null, completed_at: null, created_at: at, updated_at: at
      };
      return repository.createGenerationRequest({
        receiptKey: `${input.organizationId}:generation:${key}`,
        fingerprint: stableJson({ product_revision_id: productRevision.id, intent }),
        job,
        audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, event_type: "copy.generation_requested", product_revision_id: productRevision.id, copy_generation_job_id: job.id, metadata: { intent }, created_at: at }
      });
    },
    async getGenerationJob(input) {
      context(input);
      const job = await repository.getJob(input.organizationId, input.jobId);
      if (!job) throw failure("COPY_GENERATION_JOB_NOT_FOUND");
      return job;
    },
    async listGenerationJobs(input) {
      context(input);
      await productRevisionPort.getSnapshot({ organizationId: input.organizationId, productRevisionId: input.productRevisionId });
      return repository.listJobs(input.organizationId, input.productRevisionId);
    },
    async listCopyVersions(input) {
      context(input);
      await productRevisionPort.getSnapshot({ organizationId: input.organizationId, productRevisionId: input.productRevisionId });
      return repository.listCopies(input.organizationId, input.productRevisionId);
    },
    async getCopyVersion(input) {
      context(input);
      const copy = await repository.getCopy(input.organizationId, input.copyVersionId);
      if (!copy) throw failure("COPY_VERSION_NOT_FOUND");
      return copy;
    },
    async getProductRevisionSnapshot(input) {
      context(input);
      return productRevisionPort.getSnapshot({ organizationId: input.organizationId, productRevisionId: input.productRevisionId });
    },
    async getCurrentProductRevisionSnapshot(input) {
      context(input);
      return productRevisionPort.getCurrentReadySnapshot({ organizationId: input.organizationId,
        productRevisionId: input.productRevisionId });
    },
    async editCopyVersion(input) {
      context(input);
      const body = cleanText(input.body);
      if (!body) throw failure("COPY_BODY_REQUIRED");
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) throw failure("INVALID_COPY_REVISION");
      const current = await repository.getCopy(input.organizationId, input.copyVersionId);
      if (!current) throw failure("COPY_VERSION_NOT_FOUND");
      const deriveKey = current.status === "frozen" && input.idempotencyKey ? idempotencyKey(input.idempotencyKey) : null;
      const at = timestamp();
      const childCopyVersion = {
        ...current,
        id: randomUUID(), status: "draft", version_number: null, row_version: 1,
        body, parent_copy_version_id: current.id, generation_job_id: null,
        created_by_member_id: input.actorMemberId, created_at: at, updated_at: at, frozen_at: null
      };
      const result = await repository.editCopy({
        organizationId: input.organizationId, copyVersionId: current.id, expectedRevision: input.expectedRevision,
        body, childCopyVersion, now: at,
        receiptKey: deriveKey ? `${input.organizationId}:derive-copy:${deriveKey}` : null,
        fingerprint: deriveKey ? stableJson({ copy_version_id: current.id, body }) : null,
        audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId,
          event_type: current.status === "draft" ? "copy.draft_edited" : "copy.child_draft_created",
          product_revision_id: current.product_revision_id, copy_version_id: current.status === "draft" ? current.id : childCopyVersion.id,
          metadata: current.status === "draft" ? {} : { parent_copy_version_id: current.id }, created_at: at }
      });
      if (!result) throw failure("COPY_VERSION_NOT_FOUND");
      return result;
    },
    async freezeCopyVersion(input) {
      context(input);
      const key = idempotencyKey(input.idempotencyKey);
      if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) throw failure("INVALID_COPY_REVISION");
      const at = timestamp();
      const result = await repository.freezeCopy({
        organizationId: input.organizationId, copyVersionId: input.copyVersionId, expectedRevision: input.expectedRevision,
        receiptKey: `${input.organizationId}:freeze:${key}`,
        fingerprint: stableJson({ copy_version_id: input.copyVersionId, expected_revision: input.expectedRevision }), now: at,
        audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId,
          event_type: "copy.frozen", copy_version_id: input.copyVersionId, created_at: at }
      });
      if (!result) throw failure("COPY_VERSION_NOT_FOUND");
      return result;
    },
    async claimNextGenerationJob({ leaseMs = 30_000 } = {}) {
      const at = timestamp();
      return repository.claimNextJob(at, new Date(Date.parse(at) + leaseMs).toISOString(), randomUUID());
    },
    async heartbeatGenerationJob({ job, leaseMs = 30_000 }) {
      const at = timestamp();
      return repository.heartbeatJob({
        jobId: job.id, leaseToken: job.lease_token, now: at,
        leaseExpiresAt: new Date(Date.parse(at) + leaseMs).toISOString()
      });
    },
    async completeGenerationJob({ job, body }) {
      const cleanBody = cleanText(body);
      if (!cleanBody) throw failure("COPY_GENERATION_EMPTY_RESULT");
      const at = timestamp();
      const copyVersion = {
        id: randomUUID(), organization_id: job.organization_id, project_id: job.project_id, product_id: job.product_id,
        product_revision_id: job.product_revision_id, generation_job_id: job.id, intent: job.intent,
        status: "draft", version_number: null, row_version: 1, body: cleanBody, parent_copy_version_id: null,
        created_by_member_id: null, created_at: at, updated_at: at, frozen_at: null, lease_token: job.lease_token
      };
      return repository.completeJob({
        jobId: job.id, copyVersion, now: at,
        audit: { id: randomUUID(), organization_id: job.organization_id, event_type: "copy.generation_succeeded", product_revision_id: job.product_revision_id, copy_version_id: copyVersion.id, copy_generation_job_id: job.id, created_at: at }
      });
    },
    async failGenerationJob({ job, failureCode = "COPY_GENERATION_FAILED" }) {
      const at = timestamp();
      return repository.failJob({
        jobId: job.id, leaseToken: job.lease_token, failureCode, now: at,
        audit: { id: randomUUID(), organization_id: job.organization_id, event_type: "copy.generation_failed",
          product_revision_id: job.product_revision_id, copy_generation_job_id: job.id,
          metadata: { failure_code: failureCode }, created_at: at }
      });
    },
    async retryGenerationJob(input) {
      context(input);
      const key = idempotencyKey(input.idempotencyKey);
      const job = await repository.getJob(input.organizationId, input.jobId);
      if (!job) throw failure("COPY_GENERATION_JOB_NOT_FOUND");
      const at = timestamp();
      const retried = await repository.retryJob({
        organizationId: input.organizationId, jobId: job.id,
        receiptKey: `${input.organizationId}:retry:${key}`,
        fingerprint: stableJson({ job_id: job.id }), now: at,
        audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId,
          event_type: "copy.generation_retried", product_revision_id: job.product_revision_id,
          copy_generation_job_id: job.id, metadata: { next_attempt: job.attempts + 1 }, created_at: at }
      });
      if (!retried) throw failure("COPY_GENERATION_JOB_NOT_FOUND");
      return retried;
    },
    async abortGenerationJob(input) {
      context(input);
      const job = await repository.getJob(input.organizationId, input.jobId);
      if (!job) throw failure("COPY_GENERATION_JOB_NOT_FOUND");
      const at = timestamp();
      const cancelled = await repository.abortJob({
        organizationId: input.organizationId, jobId: input.jobId, now: at,
        audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId,
          event_type: "copy.generation_cancelled", product_revision_id: job.product_revision_id,
          copy_generation_job_id: job.id, created_at: at }
      });
      if (!cancelled) throw failure("COPY_GENERATION_JOB_NOT_FOUND");
      return cancelled;
    }
  };
}
