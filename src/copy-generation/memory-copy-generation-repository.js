import { randomUUID } from "node:crypto";

const clone = (value) => value == null ? value : structuredClone(value);

export function createMemoryCopyGenerationRepository() {
  const jobs = new Map();
  const copies = new Map();
  const receipts = new Map();
  const audits = [];

  return {
    async initialize() {},
    async close() {},
    async createGenerationRequest({ receiptKey, fingerprint, job, audit }) {
      const receipt = receipts.get(receiptKey);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw Object.assign(new Error("IDEMPOTENCY_CONFLICT"), { code: "IDEMPOTENCY_CONFLICT" });
        return clone({ job: jobs.get(receipt.jobId), copy_version: receipt.copyVersionId ? copies.get(receipt.copyVersionId) : null });
      }
      jobs.set(job.id, clone(job));
      receipts.set(receiptKey, { fingerprint, jobId: job.id, copyVersionId: null });
      audits.push(clone(audit));
      return clone({ job, copy_version: null });
    },
    async getJob(organizationId, id) {
      const job = jobs.get(id);
      return clone(job?.organization_id === organizationId ? job : null);
    },
    async listJobs(organizationId, productRevisionId) {
      return [...jobs.values()].filter((job) => job.organization_id === organizationId && job.product_revision_id === productRevisionId)
        .sort((left, right) => right.created_at.localeCompare(left.created_at)).map(clone);
    },
    async listCopies(organizationId, productRevisionId) {
      return [...copies.values()]
        .filter((copy) => copy.organization_id === organizationId && copy.product_revision_id === productRevisionId)
        .sort((left, right) => left.version_number - right.version_number)
        .map(clone);
    },
    async getCopy(organizationId, id) {
      const copy = copies.get(id);
      return clone(copy?.organization_id === organizationId ? copy : null);
    },
    async editCopy({ organizationId, copyVersionId, expectedRevision, body, childCopyVersion, audit, now }) {
      const current = copies.get(copyVersionId);
      if (!current || current.organization_id !== organizationId) return null;
      if (current.row_version !== expectedRevision) throw Object.assign(new Error("COPY_VERSION_CONFLICT"), { code: "COPY_VERSION_CONFLICT" });
      if (current.status === "superseded") throw Object.assign(new Error("COPY_VERSION_IMMUTABLE"), { code: "COPY_VERSION_IMMUTABLE" });
      if (current.body === body) return clone(current);
      if (current.status === "draft") {
        Object.assign(current, { body, row_version: current.row_version + 1, updated_at: now });
        audits.push(clone(audit));
        return clone(current);
      }
      current.row_version += 1;
      current.updated_at = now;
      for (const candidate of copies.values()) {
        if (candidate.organization_id === organizationId && candidate.product_revision_id === current.product_revision_id && candidate.status === "draft") {
          Object.assign(candidate, { status: "superseded", row_version: candidate.row_version + 1, updated_at: now });
        }
      }
      childCopyVersion.version_number = Math.max(0, ...[...copies.values()]
        .filter((copy) => copy.organization_id === organizationId && copy.product_revision_id === current.product_revision_id)
        .map((copy) => copy.version_number)) + 1;
      copies.set(childCopyVersion.id, clone(childCopyVersion));
      audits.push(clone(audit));
      return clone(childCopyVersion);
    },
    async freezeCopy({ organizationId, copyVersionId, expectedRevision, receiptKey, fingerprint, audit, now }) {
      const receipt = receipts.get(receiptKey);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw Object.assign(new Error("IDEMPOTENCY_CONFLICT"), { code: "IDEMPOTENCY_CONFLICT" });
        return clone(copies.get(receipt.copyVersionId));
      }
      const current = copies.get(copyVersionId);
      if (!current || current.organization_id !== organizationId) return null;
      if (current.row_version !== expectedRevision) throw Object.assign(new Error("COPY_VERSION_CONFLICT"), { code: "COPY_VERSION_CONFLICT" });
      if (current.status !== "draft") throw Object.assign(new Error("COPY_VERSION_IMMUTABLE"), { code: "COPY_VERSION_IMMUTABLE" });
      Object.assign(current, { status: "frozen", row_version: current.row_version + 1, frozen_at: now, updated_at: now });
      const parent = current.parent_copy_version_id ? copies.get(current.parent_copy_version_id) : null;
      if (parent?.status === "frozen") Object.assign(parent, { status: "superseded", row_version: parent.row_version + 1, updated_at: now });
      receipts.set(receiptKey, { fingerprint, copyVersionId: current.id });
      audits.push(clone(audit));
      return clone(current);
    },
    async claimNextJob(now, leaseExpiresAt, leaseToken) {
      for (const candidate of jobs.values()) {
        if (candidate.status === "running" && candidate.lease_expires_at && candidate.lease_expires_at <= now && candidate.attempts >= candidate.max_attempts) {
          Object.assign(candidate, { status: "timed_out", failure_code: "COPY_GENERATION_TIMED_OUT", completed_at: now, lease_expires_at: null, lease_token: null, updated_at: now });
          audits.push({ id: randomUUID(), organization_id: candidate.organization_id, actor_member_id: null,
            event_type: "copy.generation_timed_out", product_revision_id: candidate.product_revision_id,
            copy_generation_job_id: candidate.id, metadata: { attempts: candidate.attempts }, created_at: now });
        }
      }
      const job = [...jobs.values()].find((candidate) => (candidate.status === "queued" && candidate.attempts < candidate.max_attempts) ||
        (candidate.status === "running" && candidate.lease_expires_at && candidate.lease_expires_at <= now && candidate.attempts < candidate.max_attempts));
      if (!job) return null;
      Object.assign(job, { status: "running", attempts: job.attempts + 1, lease_token: leaseToken, started_at: job.started_at || now, heartbeat_at: now, lease_expires_at: leaseExpiresAt, updated_at: now });
      return clone(job);
    },
    async heartbeatJob({ jobId, leaseToken, now, leaseExpiresAt }) {
      const job = jobs.get(jobId);
      if (!job || job.status !== "running" || job.lease_token !== leaseToken) throw Object.assign(new Error("COPY_GENERATION_LEASE_LOST"), { code: "COPY_GENERATION_LEASE_LOST" });
      Object.assign(job, { heartbeat_at: now, lease_expires_at: leaseExpiresAt, updated_at: now });
      return clone(job);
    },
    async completeJob({ jobId, copyVersion, audit, now }) {
      const job = jobs.get(jobId);
      if (!job) throw Object.assign(new Error("COPY_GENERATION_JOB_NOT_FOUND"), { code: "COPY_GENERATION_JOB_NOT_FOUND" });
      if (job.status === "succeeded") return clone(copies.get(job.copy_version_id));
      if (job.status !== "running" || job.lease_token !== copyVersion.lease_token) throw Object.assign(new Error("COPY_GENERATION_LEASE_LOST"), { code: "COPY_GENERATION_LEASE_LOST" });
      delete copyVersion.lease_token;
      copyVersion.version_number = Math.max(0, ...[...copies.values()].filter((copy) => copy.organization_id === copyVersion.organization_id && copy.product_revision_id === copyVersion.product_revision_id).map((copy) => copy.version_number)) + 1;
      for (const current of copies.values()) {
        if (current.organization_id === copyVersion.organization_id && current.product_revision_id === copyVersion.product_revision_id && current.status === "draft") {
          Object.assign(current, { status: "superseded", row_version: current.row_version + 1, updated_at: now });
        }
      }
      copies.set(copyVersion.id, clone(copyVersion));
      Object.assign(job, { status: "succeeded", copy_version_id: copyVersion.id, completed_at: now, heartbeat_at: now, lease_expires_at: null, lease_token: null, updated_at: now, failure_code: null });
      for (const receipt of receipts.values()) if (receipt.jobId === jobId) receipt.copyVersionId = copyVersion.id;
      audits.push(clone(audit));
      return clone(copyVersion);
    },
    async failJob({ jobId, leaseToken, failureCode, audit, now }) {
      const job = jobs.get(jobId);
      if (!job) return null;
      if (job.status !== "running" || job.lease_token !== leaseToken) throw Object.assign(new Error("COPY_GENERATION_LEASE_LOST"), { code: "COPY_GENERATION_LEASE_LOST" });
      Object.assign(job, { status: "failed", failure_code: failureCode, completed_at: now, lease_expires_at: null, lease_token: null, updated_at: now });
      audits.push(clone(audit));
      return clone(job);
    },
    async abortJob({ organizationId, jobId, audit, now }) {
      const job = jobs.get(jobId);
      if (!job || job.organization_id !== organizationId) return null;
      if (!["queued", "running"].includes(job.status)) throw Object.assign(new Error("COPY_GENERATION_ABORT_BLOCKED"), { code: "COPY_GENERATION_ABORT_BLOCKED" });
      Object.assign(job, { status: "cancelled", completed_at: now, lease_expires_at: null, lease_token: null, updated_at: now });
      audits.push(clone(audit));
      return clone(job);
    },
    async retryJob({ organizationId, jobId, receiptKey, fingerprint, audit, now }) {
      const receipt = receipts.get(receiptKey);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw Object.assign(new Error("IDEMPOTENCY_CONFLICT"), { code: "IDEMPOTENCY_CONFLICT" });
        return clone(jobs.get(receipt.jobId));
      }
      const job = jobs.get(jobId);
      if (!job || job.organization_id !== organizationId) return null;
      if (job.status !== "failed") throw Object.assign(new Error("COPY_GENERATION_RETRY_BLOCKED"), { code: "COPY_GENERATION_RETRY_BLOCKED" });
      if (job.attempts >= job.max_attempts) throw Object.assign(new Error("COPY_GENERATION_RETRY_EXHAUSTED"), { code: "COPY_GENERATION_RETRY_EXHAUSTED" });
      Object.assign(job, { status: "queued", failure_code: null, completed_at: null, updated_at: now });
      receipts.set(receiptKey, { fingerprint, jobId: job.id });
      audits.push(clone(audit));
      return clone(job);
    },
    async listAuditEvents() { return clone(audits); }
  };
}
