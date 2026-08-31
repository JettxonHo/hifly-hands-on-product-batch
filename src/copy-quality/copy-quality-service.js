import { randomUUID } from "node:crypto";

import { createStaticQualityProfileResolver } from "./static-profile-resolver.js";

const failure = (code) => Object.assign(new Error(code), { code });
const clean = (value) => typeof value === "string" ? value.trim() : "";
const stableJson = (value) => Array.isArray(value) ? `[${value.map(stableJson).join(",")}]` :
  value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}` : JSON.stringify(value);
const STRICT_ATTEMPT_POLICY = "provider_at_most_once_v1";
const QUALITY_PROVIDER_REQUEST_OUTCOMES = new Set(["success", "response_received", "http_error", "parse_failure",
  "schema_failure", "semantic_failure", "timeout", "network_failure", "not_dispatched", "unknown"]);

function requireContext(input) {
  if (!clean(input.organizationId) || !clean(input.actorMemberId)) throw failure("COPY_QUALITY_CONTEXT_REQUIRED");
}

function requireKey(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 128) throw failure("INVALID_IDEMPOTENCY_KEY");
  return value;
}

function conclusionFor(evaluation) {
  if (evaluation?.checks_complete !== true) return "invalid";
  if ((evaluation.findings || []).some((finding) => ["hard_block", "fact_gate"].includes(finding.kind))) return "blocked";
  if ((evaluation.findings || []).some((finding) => finding.kind === "review")) return "needs_review";
  return "passed";
}

function token(value) {
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function providerUsage(response) {
  const usage = response?.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return { status: "unknown", inputTokens: null, outputTokens: null, totalTokens: null };
  }
  const inputTokens = token(usage.prompt_tokens ?? usage.input_tokens);
  const outputTokens = token(usage.completion_tokens ?? usage.output_tokens);
  const totalTokens = token(usage.total_tokens);
  const reported = inputTokens !== null || outputTokens !== null || totalTokens !== null;
  return { status: reported ? "reported" : "unknown", inputTokens, outputTokens, totalTokens };
}

function providerCharge(response) {
  const charge = response?.charge || response?.cost;
  if (!charge || typeof charge !== "object" || Array.isArray(charge)) {
    return { status: "unknown", amount: null, currency: null };
  }
  const amount = typeof charge.amount === "number" && Number.isFinite(charge.amount) && charge.amount >= 0 ? charge.amount : null;
  const currency = clean(charge.currency) || null;
  return { status: amount !== null && currency ? "reported" : "unknown", amount, currency: currency || null };
}

function outcomeForError(error) {
  const code = error?.code;
  if (code === "DEEPSEEK_RESPONSE_INVALID") return "schema_failure";
  if (code === "QUALITY_EVALUATION_OUTPUT_INVALID" || code === "QUALITY_EVALUATION_OUTPUT_MALFORMED") return "parse_failure";
  if (code === "QUALITY_EVALUATION_SCHEMA_INVALID") return "schema_failure";
  if (code === "QUALITY_EVALUATION_INVALID") return "semantic_failure";
  if (["DEEPSEEK_AUTH_INVALID", "DEEPSEEK_RATE_LIMITED", "DEEPSEEK_REQUEST_FAILED"].includes(code)) return "http_error";
  if (["DEEPSEEK_UNAVAILABLE", "LLM_TRANSPORT_UNAVAILABLE", "QUALITY_EVALUATOR_TEMPORARY_FAILURE"].includes(code)) return "unknown";
  return QUALITY_PROVIDER_REQUEST_OUTCOMES.has(code) ? code : "unknown";
}

export function createCopyQualityService({ repository, copyService,
  profileResolver = createStaticQualityProfileResolver(), reviewInvalidationCoordinator,
  now = () => Date.now(), qualityMaxAttempts = 1, maxAttempts = 3, rewriteMaxAttempts = maxAttempts,
  attemptPolicy = STRICT_ATTEMPT_POLICY } = {}) {
  if (!repository || !copyService) throw new TypeError("repository and copyService are required");
  if (!profileResolver?.resolve) throw new TypeError("profileResolver is required");
  if (!Number.isInteger(qualityMaxAttempts) || qualityMaxAttempts < 1) throw new TypeError("qualityMaxAttempts must be a positive integer");
  if (!Number.isInteger(rewriteMaxAttempts) || rewriteMaxAttempts < 1) throw new TypeError("rewriteMaxAttempts must be a positive integer");
  if (!["legacy", STRICT_ATTEMPT_POLICY].includes(attemptPolicy)) throw new TypeError("attemptPolicy is invalid");
  if (attemptPolicy === STRICT_ATTEMPT_POLICY && qualityMaxAttempts !== 1) throw new TypeError("strict quality attempt policy requires qualityMaxAttempts=1");
  const timestamp = () => new Date(now()).toISOString();

  async function currentRevision(input, copy) {
    try {
      return await copyService.getCurrentProductRevisionSnapshot({ ...input,
        productRevisionId: copy.product_revision_id });
    } catch (error) {
      if (error?.code === "PRODUCT_REVISION_NOT_FOUND") throw failure("COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT");
      throw error;
    }
  }

  async function currentPolicy(input, copy, productRevision) {
    const policy = await profileResolver.resolve({ organizationId: input.organizationId, copyVersion: copy, productRevision });
    const profileVersion = clean(policy?.profileVersion), ruleVersion = clean(policy?.ruleVersion);
    if (!profileVersion || !ruleVersion) throw failure("QUALITY_PROFILE_REQUIRED");
    return { profileVersion, ruleVersion };
  }

  async function projectDetails(input, runId) {
    const details = await repository.getRunDetails(input.organizationId, runId);
    if (!details) throw failure("QUALITY_RUN_NOT_FOUND");
    const unresolvedReview = details.findings.filter((finding) => finding.kind === "review" &&
      finding.resolutions.at(-1)?.state !== "accepted_with_reason");
    const effective = details.result?.conclusion === "needs_review" && unresolvedReview.length === 0 ? "passed" : details.result?.conclusion;
    let currentValid = true, invalidationReason = null;
    if (details.result) {
      const copy = await copyService.getCopyVersion({ ...input, copyVersionId: details.run.copy_version_id });
      let productRevision;
      try {
        productRevision = await currentRevision(input, copy);
      } catch (error) {
        if (error?.code !== "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT") throw error;
        currentValid = false; invalidationReason = "product_revision_changed";
      }
      if (currentValid) {
        const policy = await currentPolicy(input, copy, productRevision);
        if (policy.profileVersion !== details.result.profile_version || policy.ruleVersion !== details.result.rule_version) {
          currentValid = false; invalidationReason = "quality_policy_changed";
        }
      }
    }
    return {
      quality_run: details.run,
      quality_result: details.result ? { ...details.result, effective_conclusion: effective,
        current_valid: currentValid, invalidation_reason: invalidationReason } : null,
      quality_findings: details.findings
    };
  }

  return {
    async startQualityCheck(input) {
      requireContext(input);
      const key = requireKey(input.idempotencyKey);
      let copy = await copyService.getCopyVersion({ ...input, copyVersionId: input.copyVersionId });
      const productRevision = await currentRevision(input, copy);
      if (copy.status === "draft") {
        try {
          copy = await copyService.freezeCopyVersion({ ...input, copyVersionId: copy.id,
            expectedRevision: input.expectedRevision, supersedeParent: false,
            idempotencyKey: `quality-freeze:${key}` });
        } catch (error) {
          if (error?.code !== "COPY_VERSION_CONFLICT") throw error;
          copy = await copyService.getCopyVersion({ ...input, copyVersionId: input.copyVersionId });
          if (copy.status !== "frozen") throw error;
        }
      } else if (copy.status !== "frozen") throw failure("COPY_VERSION_IMMUTABLE");
      const { profileVersion, ruleVersion } = await currentPolicy(input, copy, productRevision);
      const at = timestamp();
      const run = {
        id: randomUUID(), organization_id: input.organizationId, copy_version_id: copy.id,
        product_revision_id: copy.product_revision_id, profile_version: profileVersion, rule_version: ruleVersion,
        input_snapshot: { copy_version: copy, product_revision: productRevision, profile_version: profileVersion, rule_version: ruleVersion },
        status: "queued", attempts: 0, max_attempts: qualityMaxAttempts, attempt_policy: attemptPolicy,
        quality_result_id: null, failure_code: null, lease_token: null, started_at: null, heartbeat_at: null,
        lease_expires_at: null, completed_at: null, created_at: at, updated_at: at,
        provider_name: null, provider_kind: null, provider_model: null, provider_dispatch_count: 0,
        provider_http_request_count: 0, provider_request_state: "not_started", provider_request_outcome: null,
        provider_dispatch_reserved_at: null, provider_request_started_at: null, provider_request_completed_at: null,
        provider_usage_status: "not_applicable", provider_input_tokens: null,
        provider_output_tokens: null, provider_total_tokens: null,
        provider_charge_status: "not_applicable", provider_charge_amount: null,
        provider_charge_currency: null, provider_local_cost_status: "not_calculated",
        provider_local_cost_amount: null, provider_local_cost_currency: null
      };
      const created = await repository.createRun({
        receiptKey: `${input.organizationId}:quality-start:${key}`,
        fingerprint: stableJson({ copy_version_id: copy.id, profile_version: profileVersion, rule_version: ruleVersion }),
        run,
        audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId,
          event_type: "copy.quality_requested", copy_version_id: copy.id, quality_run_id: run.id,
          metadata: { profile_version: profileVersion, rule_version: ruleVersion }, created_at: at }
      });
      return { copy_version: copy, quality_run: created };
    },
    async executeProviderRequest({ run, providerName, providerKind, model, execute } = {}) {
      if (!run?.id || !run?.lease_token || typeof execute !== "function") throw failure("QUALITY_PROVIDER_REQUEST_INVALID");
      const at = timestamp();
      const reserved = await repository.beginProviderRequest({ runId: run.id, leaseToken: run.lease_token,
        providerName: clean(providerName) || null, providerKind: clean(providerKind) || clean(providerName) || null,
        model: clean(model) || null, now: at,
        audit: { id: randomUUID(), organization_id: run.organization_id,
          event_type: "copy.quality_provider_dispatch_reserved", copy_version_id: run.copy_version_id,
          quality_run_id: run.id, metadata: { provider_name: clean(providerName) || null,
            provider_kind: clean(providerKind) || clean(providerName) || null, provider_model: clean(model) || null,
            provider_dispatch_count: 1 }, created_at: at } });
      if (!reserved) throw failure("QUALITY_PROVIDER_REQUEST_ALREADY_USED");
      const startedAt = timestamp();
      const requestStarted = await repository.markProviderHttpRequestStarted({ runId: run.id, leaseToken: run.lease_token,
        now: startedAt,
        audit: { id: randomUUID(), organization_id: run.organization_id,
          event_type: "copy.quality_provider_http_request_started", copy_version_id: run.copy_version_id,
          quality_run_id: run.id, metadata: { provider_name: clean(providerName) || null,
            provider_kind: clean(providerKind) || clean(providerName) || null, provider_model: clean(model) || null,
            provider_http_request_count: 1 }, created_at: startedAt } });
      if (!requestStarted) throw failure("QUALITY_PROVIDER_REQUEST_ALREADY_USED");
      let response;
      try {
        response = await execute();
      } catch (error) {
        const outcome = outcomeForError(error), responseAt = timestamp();
        await repository.recordProviderResponse({ runId: run.id, leaseToken: run.lease_token,
          outcome, usage: null, charge: null, now: responseAt,
          audit: { id: randomUUID(), organization_id: run.organization_id,
            event_type: "copy.quality_provider_response_recorded", copy_version_id: run.copy_version_id,
            quality_run_id: run.id, metadata: { outcome, usage_status: "unknown", charge_status: "unknown" }, created_at: responseAt } }).catch((recordError) => {
          if (recordError?.code !== "QUALITY_RUN_LEASE_LOST") throw recordError;
        });
        throw error;
      }
      const usage = providerUsage(response), charge = providerCharge(response);
      const responseAt = timestamp();
      await repository.recordProviderResponse({ runId: run.id, leaseToken: run.lease_token,
        outcome: "response_received", usage, charge, now: responseAt,
        audit: { id: randomUUID(), organization_id: run.organization_id,
          event_type: "copy.quality_provider_response_recorded", copy_version_id: run.copy_version_id,
          quality_run_id: run.id, metadata: { outcome: "response_received", usage_status: usage.status,
            charge_status: charge.status }, created_at: responseAt } });
      return response;
    },
    async getQualityRun(input) {
      requireContext(input);
      return projectDetails(input, input.qualityRunId);
    },
    async listQualityRuns(input) {
      requireContext(input);
      await copyService.getCopyVersion({ ...input, copyVersionId: input.copyVersionId });
      return repository.listRuns(input.organizationId, input.copyVersionId);
    },
    async getApprovalCandidate(input) {
      requireContext(input);
      const runs = await repository.listRuns(input.organizationId, input.copyVersionId);
      for (const run of [...runs].reverse()) {
        const details = await projectDetails(input, run.id);
        if (details.quality_result) return {
          ...details.quality_result,
          product_revision_id: details.quality_run.product_revision_id
        };
      }
      return null;
    },
    async claimNextQualityRun({ leaseMs = 30_000 } = {}) {
      const at = timestamp();
      return repository.claimNextRun({ now: at, leaseExpiresAt: new Date(Date.parse(at) + leaseMs).toISOString(), leaseToken: randomUUID() });
    },
    async heartbeatQualityRun({ run, leaseMs = 30_000 }) {
      const at = timestamp();
      return repository.heartbeatRun({ runId: run.id, leaseToken: run.lease_token, now: at,
        leaseExpiresAt: new Date(Date.parse(at) + leaseMs).toISOString() });
    },
    async completeQualityRun({ run, evaluation }) {
      const copy = await copyService.getCopyVersion({ organizationId: run.organization_id,
        actorMemberId: "copy-quality-worker", copyVersionId: run.copy_version_id });
      const currentRun = await repository.getRun(run.organization_id, run.id);
      if (!currentRun) throw failure("QUALITY_RUN_NOT_FOUND");
      if (Number(currentRun.provider_dispatch_count || 0) > 0 && Number(currentRun.provider_http_request_count || 0) === 0) {
        throw failure("QUALITY_PROVIDER_REQUEST_NOT_STARTED");
      }
      if (Number(currentRun.provider_dispatch_count || 0) > 0 && currentRun.provider_request_state !== "response_received") {
        throw failure("QUALITY_PROVIDER_RESPONSE_NOT_READY");
      }
      const productRevision = await currentRevision({ organizationId: run.organization_id,
        actorMemberId: "copy-quality-worker" }, copy);
      const policy = await currentPolicy({ organizationId: run.organization_id,
        actorMemberId: "copy-quality-worker" }, copy, productRevision);
      if (policy.profileVersion !== run.profile_version || policy.ruleVersion !== run.rule_version) {
        throw failure("COPY_QUALITY_POLICY_CHANGED");
      }
      const at = timestamp(), conclusion = conclusionFor(evaluation);
      const result = { id: randomUUID(), organization_id: run.organization_id, quality_run_id: run.id,
        copy_version_id: run.copy_version_id, profile_version: run.profile_version, rule_version: run.rule_version,
        conclusion, created_at: at };
      const findingRows = (evaluation.findings || []).map((finding) => ({
        id: randomUUID(), organization_id: run.organization_id, quality_result_id: result.id,
        code: clean(finding.code), kind: finding.kind, severity: finding.severity,
        title: clean(finding.title), matched_text: clean(finding.matched_text),
        message: clean(finding.message), evidence_reference: clean(finding.evidence_reference),
        rule_source: clean(finding.rule_source), suggestion: clean(finding.suggestion),
        created_at: at
      }));
      await repository.completeRun({ runId: run.id, leaseToken: run.lease_token, result, findingRows, now: at,
        providerOutcome: run.provider_http_request_count > 0 ? "success" : null,
        audit: { id: randomUUID(), organization_id: run.organization_id, event_type: "copy.quality_succeeded",
          copy_version_id: run.copy_version_id, quality_run_id: run.id, quality_result_id: result.id,
          metadata: { conclusion, finding_count: findingRows.length }, created_at: at } });
      await reviewInvalidationCoordinator?.copyVersionChanged({ organizationId: run.organization_id,
        copyVersionId: run.copy_version_id });
      return projectDetails({ organizationId: run.organization_id, actorMemberId: "copy-quality-worker" }, run.id);
    },
    async failQualityRun({ run, failureCode = "QUALITY_EVALUATION_FAILED" }) {
      const at = timestamp();
      const current = await repository.getRun(run.organization_id, run.id);
      const dispatchReserved = Number(current?.provider_dispatch_count || 0) > 0;
      const httpDispatched = Number(current?.provider_http_request_count || run.provider_http_request_count || 0) > 0;
      const providerOutcome = dispatchReserved ? (httpDispatched
        ? (['terminal', 'unknown'].includes(current?.provider_request_state) && current?.provider_request_outcome
          ? current.provider_request_outcome : outcomeForError({ code: failureCode }))
        : "not_dispatched") : null;
      return repository.failRun({ runId: run.id, leaseToken: run.lease_token, failureCode,
        providerOutcome, now: at,
        audit: { id: randomUUID(), organization_id: run.organization_id, event_type: "copy.quality_failed",
          copy_version_id: run.copy_version_id, quality_run_id: run.id, metadata: { failure_code: failureCode }, created_at: at } });
    },
    async retryQualityCheck(input) {
      requireContext(input);
      const current = await repository.getRun(input.organizationId, input.qualityRunId);
      if (!current) throw failure("QUALITY_RUN_NOT_FOUND");
      if (current.attempt_policy === STRICT_ATTEMPT_POLICY || (current.attempt_policy == null && current.max_attempts === 1)) {
        throw failure("QUALITY_ONE_ATTEMPT_RETRY_BLOCKED");
      }
      if (current.provider_request_state === "unknown" || current.provider_request_outcome === "unknown" ||
        current.failure_code === "QUALITY_PROVIDER_OUTCOME_UNKNOWN") {
        throw failure("QUALITY_ONE_ATTEMPT_RETRY_BLOCKED");
      }
      if (current.status !== "failed") throw failure("QUALITY_RUN_RETRY_BLOCKED");
      const copy = await copyService.getCopyVersion({ ...input, copyVersionId: current.copy_version_id });
      await currentRevision(input, copy);
      return this.startQualityCheck({ ...input, copyVersionId: copy.id, expectedRevision: copy.row_version });
    },
    async resolveFinding(input) {
      requireContext(input);
      const key = requireKey(input.idempotencyKey);
      const allowed = ["accepted_with_reason", "change_requested", "returned_to_facts"];
      if (!allowed.includes(input.resolution)) throw failure("QUALITY_FINDING_RESOLUTION_INVALID");
      const reason = clean(input.reason);
      if (input.resolution === "accepted_with_reason" && !reason) throw failure("QUALITY_FINDING_REASON_REQUIRED");
      const details = await repository.getFinding(input.organizationId, input.findingId);
      if (!details) throw failure("QUALITY_FINDING_NOT_FOUND");
      if (input.resolution === "accepted_with_reason" && ["hard_block", "fact_gate"].includes(details.finding.kind)) {
        throw failure("QUALITY_FINDING_ACCEPT_BLOCKED");
      }
      const at = timestamp();
      const resolution = { id: randomUUID(), organization_id: input.organizationId, quality_finding_id: details.finding.id,
        state: input.resolution, reason: reason || null, actor_member_id: input.actorMemberId, created_at: at };
      const saved = await repository.appendResolution({
        receiptKey: `${input.organizationId}:quality-resolution:${key}`,
        fingerprint: stableJson({ finding_id: details.finding.id, resolution: input.resolution, reason }),
        findingId: details.finding.id, resolution,
        audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId,
          event_type: "copy.quality_finding_resolved", copy_version_id: details.run.copy_version_id,
          quality_run_id: details.run.id, quality_result_id: details.result.id, quality_finding_id: details.finding.id,
          metadata: { state: input.resolution }, created_at: at }
      });
      await reviewInvalidationCoordinator?.copyVersionChanged({ organizationId: input.organizationId,
        actorMemberId: input.actorMemberId, copyVersionId: details.run.copy_version_id });
      return { resolution: saved, ...(await projectDetails(input, details.run.id)) };
    },
    async requestCopyRewrite(input) {
      requireContext(input);
      const key = requireKey(input.idempotencyKey);
      const scope = clean(input.scope);
      const instruction = clean(input.instruction);
      if (!['matched_text', 'full'].includes(scope)) throw failure("COPY_REWRITE_SCOPE_INVALID");
      if (!instruction || instruction.length > 1000) throw failure("COPY_REWRITE_INSTRUCTION_REQUIRED");
      const fingerprint = stableJson({ copy_version_id: input.copyVersionId, finding_id: input.findingId || null,
        scope, instruction });
      const receiptKey = `${input.organizationId}:quality-rewrite:${key}`;
      const copy = await copyService.getCopyVersion({ ...input, copyVersionId: input.copyVersionId });
      if (copy.status !== "frozen") throw failure("COPY_REWRITE_REQUIRES_FROZEN_VERSION");
      await currentRevision(input, copy);
      let finding = null;
      if (input.findingId) {
        const found = await repository.getFinding(input.organizationId, input.findingId);
        if (!found || found.run.copy_version_id !== copy.id) throw failure("QUALITY_FINDING_NOT_FOUND");
        finding = found.finding;
      }
      const at = timestamp();
      const job = { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId,
        source_copy_version_id: copy.id, finding_id: finding?.id || null, scope, instruction,
        status: "queued", attempts: 0, max_attempts: rewriteMaxAttempts, output_copy_version_id: null,
        quality_run_id: null, rewritten_body: null, failure_code: null, lease_token: null, started_at: null, heartbeat_at: null,
        lease_expires_at: null, completed_at: null, created_at: at, updated_at: at };
      const created = await repository.createRewriteJob({ receiptKey, fingerprint, job,
        audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId,
          event_type: "copy.rewrite_requested", copy_version_id: copy.id, quality_finding_id: finding?.id || null,
          metadata: { scope }, created_at: at } });
      return { rewrite_job: created };
    },
    async getRewriteJob(input) {
      requireContext(input);
      const job = await repository.getRewriteJob(input.organizationId, input.rewriteJobId);
      if (!job) throw failure("COPY_REWRITE_JOB_NOT_FOUND");
      return { rewrite_job: job,
        copy_version: job.output_copy_version_id ? await copyService.getCopyVersion({ ...input, copyVersionId: job.output_copy_version_id }) : null,
        quality_run: job.quality_run_id ? await repository.getRun(input.organizationId, job.quality_run_id) : null };
    },
    async listRewriteJobs(input) {
      requireContext(input);
      await copyService.getCopyVersion({ ...input, copyVersionId: input.copyVersionId });
      return repository.listRewriteJobs(input.organizationId, input.copyVersionId);
    },
    async claimNextRewriteJob({ leaseMs = 30_000 } = {}) {
      const at = timestamp();
      return repository.claimNextRewriteJob({ now: at,
        leaseExpiresAt: new Date(Date.parse(at) + leaseMs).toISOString(), leaseToken: randomUUID() });
    },
    async heartbeatRewriteJob({ job, leaseMs = 30_000 }) {
      const at = timestamp();
      return repository.heartbeatRewriteJob({ jobId: job.id, leaseToken: job.lease_token, now: at,
        leaseExpiresAt: new Date(Date.parse(at) + leaseMs).toISOString() });
    },
    async executeRewriteJob({ job, rewriter }) {
      const copy = await copyService.getCopyVersion({ organizationId: job.organization_id,
        actorMemberId: job.actor_member_id, copyVersionId: job.source_copy_version_id });
      const productRevision = await currentRevision({ organizationId: job.organization_id,
        actorMemberId: job.actor_member_id }, copy);
      const found = job.finding_id ? await repository.getFinding(job.organization_id, job.finding_id) : null;
      if (job.finding_id && (!found || found.run.copy_version_id !== copy.id)) throw failure("QUALITY_FINDING_NOT_FOUND");
      let body = clean(job.rewritten_body);
      if (!body) {
        const rewritten = await rewriter.rewrite({ copyVersion: copy, productRevision,
          finding: found?.finding || null, scope: job.scope, instruction: job.instruction });
        body = clean(rewritten?.body);
        if (!body) throw failure("COPY_REWRITE_EMPTY_RESULT");
        if (body === copy.body) throw failure("COPY_REWRITE_NO_CHANGE");
        await repository.saveRewriteOutput({ jobId: job.id, leaseToken: job.lease_token, body, now: timestamp() });
      }
      await currentRevision({ organizationId: job.organization_id, actorMemberId: job.actor_member_id }, copy);
      const draft = await copyService.editCopyVersion({ organizationId: job.organization_id,
        actorMemberId: job.actor_member_id, copyVersionId: copy.id, expectedRevision: copy.row_version,
        body, idempotencyKey: `rewrite-job-copy:${job.id}` });
      const started = await this.startQualityCheck({ organizationId: job.organization_id,
        actorMemberId: job.actor_member_id, copyVersionId: draft.id, expectedRevision: draft.row_version,
        idempotencyKey: `rewrite-job-qc:${job.id}` });
      const at = timestamp();
      await repository.completeRewriteJob({ jobId: job.id, leaseToken: job.lease_token,
        outputCopyVersionId: started.copy_version.id, qualityRunId: started.quality_run.id, now: at,
        audit: { id: randomUUID(), organization_id: job.organization_id, actor_member_id: job.actor_member_id,
          event_type: "copy.rewrite_succeeded", copy_version_id: started.copy_version.id,
          quality_run_id: started.quality_run.id, quality_finding_id: job.finding_id,
          metadata: { rewrite_job_id: job.id }, created_at: at } });
      return this.getRewriteJob({ organizationId: job.organization_id, actorMemberId: job.actor_member_id,
        rewriteJobId: job.id });
    },
    async failRewriteJob({ job, failureCode = "COPY_REWRITE_FAILED" }) {
      const at = timestamp();
      return repository.failRewriteJob({ jobId: job.id, leaseToken: job.lease_token, failureCode, now: at,
        audit: { id: randomUUID(), organization_id: job.organization_id, actor_member_id: job.actor_member_id,
          event_type: "copy.rewrite_failed", copy_version_id: job.source_copy_version_id,
          quality_finding_id: job.finding_id, metadata: { failure_code: failureCode }, created_at: at } });
    },
    async retryCopyRewrite(input) {
      requireContext(input);
      const key = requireKey(input.idempotencyKey);
      const job = await repository.getRewriteJob(input.organizationId, input.rewriteJobId);
      if (!job) throw failure("COPY_REWRITE_JOB_NOT_FOUND");
      const copy = await copyService.getCopyVersion({ ...input, copyVersionId: job.source_copy_version_id });
      await currentRevision(input, copy);
      const at = timestamp();
      return { rewrite_job: await repository.retryRewriteJob({ organizationId: input.organizationId,
        jobId: job.id, receiptKey: `${input.organizationId}:quality-rewrite-retry:${key}`,
        fingerprint: stableJson({ rewrite_job_id: job.id }), now: at,
        audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId,
          event_type: "copy.rewrite_retried", copy_version_id: job.source_copy_version_id,
          quality_finding_id: job.finding_id, metadata: { rewrite_job_id: job.id }, created_at: at } }) };
    },
    async cancelQualityCheck(input) {
      requireContext(input);
      const current = await repository.getRun(input.organizationId, input.qualityRunId);
      if (!current) throw failure("QUALITY_RUN_NOT_FOUND");
      if (current.attempt_policy === STRICT_ATTEMPT_POLICY && Number(current.provider_dispatch_count || 0) > 0) {
        throw failure("QUALITY_ONE_ATTEMPT_CANCEL_BLOCKED");
      }
      const at = timestamp();
      const cancelled = await repository.cancelRun({ organizationId: input.organizationId, runId: current.id, now: at,
        audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId,
          event_type: "copy.quality_cancelled", copy_version_id: current.copy_version_id,
          quality_run_id: current.id, created_at: at } });
      if (!cancelled) throw failure("QUALITY_RUN_NOT_FOUND");
      return cancelled;
    }
  };
}
