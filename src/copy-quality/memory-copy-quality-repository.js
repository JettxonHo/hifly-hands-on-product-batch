import { randomUUID } from "node:crypto";

const clone = (value) => value == null ? value : structuredClone(value);
const conflict = (code) => Object.assign(new Error(code), { code });
const STRICT_ATTEMPT_POLICY = "provider_at_most_once_v1";

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
      if (run.attempt_policy === STRICT_ATTEMPT_POLICY) {
        const strictExisting = [...runs.values()].find((value) => value.organization_id === run.organization_id &&
          value.copy_version_id === run.copy_version_id && value.attempt_policy === STRICT_ATTEMPT_POLICY);
        if (strictExisting) {
          receipts.set(receiptKey, { fingerprint, runId: strictExisting.id });
          return clone(strictExisting);
        }
        const legacyUnknown = [...runs.values()].find((value) => value.organization_id === run.organization_id &&
          value.copy_version_id === run.copy_version_id && value.attempt_policy !== STRICT_ATTEMPT_POLICY &&
          !["queued", "running"].includes(value.status) &&
          (value.provider_request_state === "unknown" || value.provider_request_outcome === "unknown" ||
            value.failure_code === "QUALITY_PROVIDER_OUTCOME_UNKNOWN"));
        if (legacyUnknown) throw conflict("QUALITY_ONE_ATTEMPT_LEGACY_OUTCOME_UNKNOWN");
        const legacyActive = [...runs.values()].find((value) => value.organization_id === run.organization_id &&
          value.copy_version_id === run.copy_version_id && ["queued", "running"].includes(value.status) &&
          value.attempt_policy !== STRICT_ATTEMPT_POLICY);
        if (legacyActive) throw conflict("QUALITY_ONE_ATTEMPT_LEGACY_RUN_ACTIVE");
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
    async beginProviderRequest({ runId, leaseToken, providerName, providerKind, model, now, audit }) {
      const run = runs.get(runId);
      if (!run || run.status !== "running" || run.lease_token !== leaseToken) throw conflict("QUALITY_RUN_LEASE_LOST");
      if (Number(run.provider_dispatch_count || 0) >= 1) return null;
      Object.assign(run, { provider_name: providerName, provider_kind: providerKind,
        provider_model: model, provider_dispatch_count: 1, provider_request_state: "reserved",
        provider_request_outcome: null, provider_dispatch_reserved_at: now, provider_request_started_at: null,
        provider_usage_status: "not_applicable", provider_input_tokens: null,
        provider_output_tokens: null, provider_total_tokens: null,
        provider_charge_status: "not_applicable", provider_charge_amount: null,
        provider_charge_currency: null, provider_local_cost_status: "not_calculated",
        updated_at: now });
      if (audit) audits.push(clone(audit));
      return clone(run);
    },
    async markProviderHttpRequestStarted({ runId, leaseToken, now, audit }) {
      const run = runs.get(runId);
      if (!run || run.status !== "running" || run.lease_token !== leaseToken) throw conflict("QUALITY_RUN_LEASE_LOST");
      if (Number(run.provider_dispatch_count || 0) !== 1) throw conflict("QUALITY_PROVIDER_REQUEST_NOT_RESERVED");
      if (Number(run.provider_http_request_count || 0) >= 1) return null;
      Object.assign(run, { provider_http_request_count: 1, provider_request_state: "started",
        provider_request_started_at: now, provider_usage_status: "unknown", provider_charge_status: "unknown",
        updated_at: now });
      if (audit) audits.push(clone(audit));
      return clone(run);
    },
    async recordProviderResponse({ runId, leaseToken, outcome, usage, charge, now, audit }) {
      const run = runs.get(runId);
      if (!run || run.status !== "running" || run.lease_token !== leaseToken) throw conflict("QUALITY_RUN_LEASE_LOST");
      if (Number(run.provider_http_request_count || 0) !== 1) throw conflict("QUALITY_PROVIDER_REQUEST_NOT_STARTED");
      if (run.provider_request_state !== "started") throw conflict("QUALITY_PROVIDER_RESPONSE_ALREADY_RECORDED");
      const reportedUsage = usage?.status === "reported";
      const reportedCharge = charge?.status === "reported";
      Object.assign(run, { provider_request_state: outcome === "response_received" ? "response_received" : "terminal",
        provider_request_outcome: outcome, provider_request_completed_at: now,
        provider_usage_status: reportedUsage ? "reported" : "unknown",
        provider_input_tokens: reportedUsage ? usage.inputTokens : null,
        provider_output_tokens: reportedUsage ? usage.outputTokens : null,
        provider_total_tokens: reportedUsage ? usage.totalTokens : null,
        provider_charge_status: reportedCharge ? "reported" : "unknown",
        provider_charge_amount: reportedCharge ? charge.amount : null,
        provider_charge_currency: reportedCharge ? charge.currency : null,
        updated_at: now });
      if (audit) audits.push(clone(audit));
      return clone(run);
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
          (candidate.attempt_policy === STRICT_ATTEMPT_POLICY || candidate.attempts >= candidate.max_attempts)) {
          const strict = candidate.attempt_policy === STRICT_ATTEMPT_POLICY;
          const dispatched = Number(candidate.provider_http_request_count || 0) > 0;
          Object.assign(candidate, { status: "failed",
            failure_code: strict ? (dispatched ? "QUALITY_PROVIDER_OUTCOME_UNKNOWN" : "QUALITY_ONE_ATTEMPT_NOT_DISPATCHED") : "QUALITY_RUN_TIMED_OUT",
            provider_request_state: strict ? (dispatched ? "unknown" : "terminal") : candidate.provider_request_state,
            provider_request_outcome: strict ? (dispatched ? "unknown" : "not_dispatched") : candidate.provider_request_outcome,
            completed_at: now, lease_expires_at: null, lease_token: null, updated_at: now });
          audits.push({ id: randomUUID(), organization_id: candidate.organization_id, actor_member_id: null,
            event_type: strict && dispatched ? "copy.quality_provider_outcome_unknown" : strict ? "copy.quality_provider_not_dispatched" : "copy.quality_timed_out",
            copy_version_id: candidate.copy_version_id,
            quality_run_id: candidate.id, metadata: { attempts: candidate.attempts,
              provider_dispatch_count: candidate.provider_dispatch_count || 0,
              provider_http_request_count: candidate.provider_http_request_count || 0 }, created_at: now });
        }
      }
      const candidate = [...runs.values()].find((run) => (run.status === "queued" && run.attempts < run.max_attempts) ||
        (run.status === "running" && run.attempt_policy !== STRICT_ATTEMPT_POLICY &&
          run.lease_expires_at && run.lease_expires_at <= now && run.attempts < run.max_attempts));
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
    async completeRun({ runId, leaseToken, result, findingRows, audit, now, providerOutcome = null }) {
      const run = runs.get(runId);
      if (!run || run.status !== "running" || run.lease_token !== leaseToken) throw conflict("QUALITY_RUN_LEASE_LOST");
      if (resultForRun(runId)) return clone(await this.getRunDetails(run.organization_id, runId));
      if (Number(run.provider_dispatch_count || 0) > 0 && Number(run.provider_http_request_count || 0) === 0) {
        throw conflict("QUALITY_PROVIDER_REQUEST_NOT_STARTED");
      }
      if (Number(run.provider_dispatch_count || 0) > 0 && run.provider_request_state !== "response_received") {
        throw conflict("QUALITY_PROVIDER_RESPONSE_NOT_READY");
      }
      results.set(result.id, clone(result));
      for (const finding of findingRows) findings.set(finding.id, clone(finding));
      Object.assign(run, { status: "succeeded", quality_result_id: result.id, completed_at: now,
        heartbeat_at: now, lease_expires_at: null, lease_token: null, failure_code: null, updated_at: now });
      if (Number(run.provider_http_request_count || 0) > 0) Object.assign(run, {
        provider_request_state: "terminal", provider_request_outcome: providerOutcome || "success",
        provider_request_completed_at: now
      });
      audits.push(clone(audit));
      return clone({ run, result, findings: findingRows.map((finding) => ({ ...finding, resolutions: [] })) });
    },
    async failRun({ runId, leaseToken, failureCode, audit, now, providerOutcome = null }) {
      const run = runs.get(runId);
      if (!run || run.status !== "running" || run.lease_token !== leaseToken) throw conflict("QUALITY_RUN_LEASE_LOST");
      Object.assign(run, { status: "failed", failure_code: failureCode, completed_at: now,
        lease_expires_at: null, lease_token: null, updated_at: now });
      if (Number(run.provider_dispatch_count || 0) > 0) Object.assign(run, {
        provider_request_state: providerOutcome === "unknown" || providerOutcome === "network_failure" ? "unknown" : "terminal",
        provider_request_outcome: providerOutcome || "unknown", provider_request_completed_at: now
      });
      audits.push(clone(audit));
      return clone(run);
    },
    async cancelRun({ organizationId, runId, audit, now }) {
      const run = runs.get(runId);
      if (!run || run.organization_id !== organizationId) return null;
      if (!["queued", "running"].includes(run.status)) throw conflict("QUALITY_RUN_CANCEL_BLOCKED");
      if (run.attempt_policy === STRICT_ATTEMPT_POLICY && Number(run.provider_dispatch_count || 0) > 0) {
        throw conflict("QUALITY_ONE_ATTEMPT_CANCEL_BLOCKED");
      }
      Object.assign(run, { status: "cancelled", completed_at: now, lease_expires_at: null,
        lease_token: null, updated_at: now });
      if (run.attempt_policy === STRICT_ATTEMPT_POLICY) Object.assign(run, {
        provider_request_state: "terminal", provider_request_outcome: "not_dispatched"
      });
      audits.push(clone(audit));
      return clone(run);
    },
    async listAuditEvents() { return clone(audits); }
  };
}
