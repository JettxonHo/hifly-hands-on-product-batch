import { randomUUID } from "node:crypto";

const clone = (value) => value == null ? value : structuredClone(value);
const conflict = (code) => Object.assign(new Error(code), { code });

export function createMemoryCopyQualityRepository() {
  const runs = new Map();
  const results = new Map();
  const findings = new Map();
  const resolutions = new Map();
  const receipts = new Map();
  const rewriteJobs = new Map();
  const audits = [];

  function resultForRun(runId) {
    return [...results.values()].find((value) => value.quality_run_id === runId) || null;
  }

  return {
    async initialize() {},
    async close() {},
    async createRun({ receiptKey, fingerprint, run, audit }) {
      const receipt = receipts.get(receiptKey);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw conflict("IDEMPOTENCY_CONFLICT");
        return clone(runs.get(receipt.runId));
      }
      const active = [...runs.values()].find((value) => value.organization_id === run.organization_id &&
        value.copy_version_id === run.copy_version_id && value.profile_version === run.profile_version &&
        value.rule_version === run.rule_version && ["queued", "running"].includes(value.status));
      if (active) {
        receipts.set(receiptKey, { fingerprint, runId: active.id });
        return clone(active);
      }
      runs.set(run.id, clone(run));
      receipts.set(receiptKey, { fingerprint, runId: run.id });
      audits.push(clone(audit));
      return clone(run);
    },
    async getRun(organizationId, id) {
      const run = runs.get(id);
      return clone(run?.organization_id === organizationId ? run : null);
    },
    async listRuns(organizationId, copyVersionId) {
      return [...runs.values()].filter((run) => run.organization_id === organizationId && run.copy_version_id === copyVersionId)
        .sort((left, right) => left.created_at.localeCompare(right.created_at)).map(clone);
    },
    async getRunDetails(organizationId, runId) {
      const run = runs.get(runId);
      if (!run || run.organization_id !== organizationId) return null;
      const result = resultForRun(runId);
      const runFindings = result ? [...findings.values()].filter((finding) => finding.quality_result_id === result.id) : [];
      return clone({ run, result, findings: runFindings.map((finding) => ({ ...finding, resolutions: resolutions.get(finding.id) || [] })) });
    },
    async getFinding(organizationId, findingId) {
      const finding = findings.get(findingId);
      if (!finding || finding.organization_id !== organizationId) return null;
      const result = results.get(finding.quality_result_id);
      const run = result && runs.get(result.quality_run_id);
      return clone({ finding, result, run, resolutions: resolutions.get(findingId) || [] });
    },
    async appendResolution({ receiptKey, fingerprint, findingId, resolution, audit }) {
      const receipt = receipts.get(receiptKey);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw conflict("IDEMPOTENCY_CONFLICT");
        return clone((resolutions.get(findingId) || []).find((value) => value.id === receipt.resolutionId));
      }
      const finding = findings.get(findingId);
      if (!finding) return null;
      const history = resolutions.get(findingId) || [];
      history.push(clone(resolution));
      resolutions.set(findingId, history);
      receipts.set(receiptKey, { fingerprint, resolutionId: resolution.id });
      audits.push(clone(audit));
      return clone(resolution);
    },
    async createRewriteJob({ receiptKey, fingerprint, job, audit }) {
      const receipt = receipts.get(receiptKey);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw conflict("IDEMPOTENCY_CONFLICT");
        return clone(rewriteJobs.get(receipt.rewriteJobId));
      }
      rewriteJobs.set(job.id, clone(job));
      receipts.set(receiptKey, { fingerprint, rewriteJobId: job.id });
      audits.push(clone(audit));
      return clone(job);
    },
    async getRewriteJob(organizationId, id) {
      const job = rewriteJobs.get(id);
      return clone(job?.organization_id === organizationId ? job : null);
    },
    async listRewriteJobs(organizationId, copyVersionId) {
      return [...rewriteJobs.values()].filter((job) => job.organization_id === organizationId &&
        job.source_copy_version_id === copyVersionId).sort((left, right) => left.created_at.localeCompare(right.created_at)).map(clone);
    },
    async claimNextRewriteJob({ now, leaseExpiresAt, leaseToken }) {
      for (const candidate of rewriteJobs.values()) {
        if (candidate.status === "running" && candidate.lease_expires_at && candidate.lease_expires_at <= now &&
          candidate.attempts >= candidate.max_attempts) {
          Object.assign(candidate, { status: "timed_out", failure_code: "COPY_REWRITE_TIMED_OUT",
            completed_at: now, lease_expires_at: null, lease_token: null, updated_at: now });
          audits.push({ id: randomUUID(), organization_id: candidate.organization_id, actor_member_id: null,
            event_type: "copy.rewrite_timed_out", copy_version_id: candidate.source_copy_version_id,
            quality_finding_id: candidate.finding_id, metadata: { rewrite_job_id: candidate.id,
              attempts: candidate.attempts }, created_at: now });
        }
      }
      const candidate = [...rewriteJobs.values()].find((job) => job.status === "queued" ||
        (job.status === "running" && job.lease_expires_at && job.lease_expires_at <= now && job.attempts < job.max_attempts));
      if (!candidate) return null;
      Object.assign(candidate, { status: "running", attempts: candidate.attempts + 1, lease_token: leaseToken,
        started_at: candidate.started_at || now, heartbeat_at: now, lease_expires_at: leaseExpiresAt, updated_at: now });
      return clone(candidate);
    },
    async heartbeatRewriteJob({ jobId, leaseToken, now, leaseExpiresAt }) {
      const job = rewriteJobs.get(jobId);
      if (!job || job.status !== "running" || job.lease_token !== leaseToken) throw conflict("COPY_REWRITE_LEASE_LOST");
      Object.assign(job, { heartbeat_at: now, lease_expires_at: leaseExpiresAt, updated_at: now });
      return clone(job);
    },
    async saveRewriteOutput({ jobId, leaseToken, body, now }) {
      const job = rewriteJobs.get(jobId);
      if (!job || job.status !== "running" || job.lease_token !== leaseToken) throw conflict("COPY_REWRITE_LEASE_LOST");
      if (!job.rewritten_body) job.rewritten_body = body;
      job.updated_at = now;
      return clone(job);
    },
    async completeRewriteJob({ jobId, leaseToken, outputCopyVersionId, qualityRunId, audit, now }) {
      const job = rewriteJobs.get(jobId);
      if (!job || job.status !== "running" || job.lease_token !== leaseToken) throw conflict("COPY_REWRITE_LEASE_LOST");
      Object.assign(job, { status: "succeeded", output_copy_version_id: outputCopyVersionId,
        quality_run_id: qualityRunId, failure_code: null, completed_at: now, heartbeat_at: now,
        lease_expires_at: null, lease_token: null, updated_at: now });
      audits.push(clone(audit));
      return clone(job);
    },
    async failRewriteJob({ jobId, leaseToken, failureCode, audit, now }) {
      const job = rewriteJobs.get(jobId);
      if (!job || job.status !== "running" || job.lease_token !== leaseToken) throw conflict("COPY_REWRITE_LEASE_LOST");
      Object.assign(job, { status: "failed", failure_code: failureCode, completed_at: now,
        lease_expires_at: null, lease_token: null, updated_at: now });
      audits.push(clone(audit));
      return clone(job);
    },
    async retryRewriteJob({ organizationId, jobId, receiptKey, fingerprint, audit, now }) {
      const receipt = receipts.get(receiptKey);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) throw conflict("IDEMPOTENCY_CONFLICT");
        return clone(rewriteJobs.get(receipt.rewriteJobId));
      }
      const job = rewriteJobs.get(jobId);
      if (!job || job.organization_id !== organizationId) return null;
      if (!['failed', 'timed_out'].includes(job.status) || job.attempts >= job.max_attempts) {
        throw conflict("COPY_REWRITE_RETRY_BLOCKED");
      }
      Object.assign(job, { status: "queued", failure_code: null, completed_at: null, updated_at: now });
      receipts.set(receiptKey, { fingerprint, rewriteJobId: job.id });
      audits.push(clone(audit));
      return clone(job);
    },
    async claimNextRun({ now, leaseExpiresAt, leaseToken }) {
      for (const candidate of runs.values()) {
        if (candidate.status === "running" && candidate.lease_expires_at && candidate.lease_expires_at <= now &&
          candidate.attempts >= candidate.max_attempts) {
          Object.assign(candidate, { status: "failed", failure_code: "QUALITY_RUN_TIMED_OUT", completed_at: now,
            lease_expires_at: null, lease_token: null, updated_at: now });
          audits.push({ id: randomUUID(), organization_id: candidate.organization_id, actor_member_id: null,
            event_type: "copy.quality_timed_out", copy_version_id: candidate.copy_version_id,
            quality_run_id: candidate.id, metadata: { attempts: candidate.attempts }, created_at: now });
        }
      }
      const candidate = [...runs.values()].find((run) => run.status === "queued" ||
        (run.status === "running" && run.lease_expires_at && run.lease_expires_at <= now && run.attempts < run.max_attempts));
      if (!candidate) return null;
      Object.assign(candidate, { status: "running", attempts: candidate.attempts + 1, lease_token: leaseToken,
        started_at: candidate.started_at || now, heartbeat_at: now, lease_expires_at: leaseExpiresAt, updated_at: now });
      return clone(candidate);
    },
    async heartbeatRun({ runId, leaseToken, now, leaseExpiresAt }) {
      const run = runs.get(runId);
      if (!run || run.status !== "running" || run.lease_token !== leaseToken) throw conflict("QUALITY_RUN_LEASE_LOST");
      Object.assign(run, { heartbeat_at: now, lease_expires_at: leaseExpiresAt, updated_at: now });
      return clone(run);
    },
    async completeRun({ runId, leaseToken, result, findingRows, audit, now }) {
      const run = runs.get(runId);
      if (!run || run.status !== "running" || run.lease_token !== leaseToken) throw conflict("QUALITY_RUN_LEASE_LOST");
      if (resultForRun(runId)) return clone(await this.getRunDetails(run.organization_id, runId));
      results.set(result.id, clone(result));
      for (const finding of findingRows) findings.set(finding.id, clone(finding));
      Object.assign(run, { status: "succeeded", quality_result_id: result.id, completed_at: now,
        heartbeat_at: now, lease_expires_at: null, lease_token: null, failure_code: null, updated_at: now });
      audits.push(clone(audit));
      return clone({ run, result, findings: findingRows.map((finding) => ({ ...finding, resolutions: [] })) });
    },
    async failRun({ runId, leaseToken, failureCode, audit, now }) {
      const run = runs.get(runId);
      if (!run || run.status !== "running" || run.lease_token !== leaseToken) throw conflict("QUALITY_RUN_LEASE_LOST");
      Object.assign(run, { status: "failed", failure_code: failureCode, completed_at: now,
        lease_expires_at: null, lease_token: null, updated_at: now });
      audits.push(clone(audit));
      return clone(run);
    },
    async cancelRun({ organizationId, runId, audit, now }) {
      const run = runs.get(runId);
      if (!run || run.organization_id !== organizationId) return null;
      if (!["queued", "running"].includes(run.status)) throw conflict("QUALITY_RUN_CANCEL_BLOCKED");
      Object.assign(run, { status: "cancelled", completed_at: now, lease_expires_at: null,
        lease_token: null, updated_at: now });
      audits.push(clone(audit));
      return clone(run);
    },
    async listAuditEvents() { return clone(audits); }
  };
}
