const SAFE_FAILURE_CODES = new Set(["QUALITY_EVALUATION_FAILED", "QUALITY_EVALUATION_INVALID",
  "QUALITY_EVALUATOR_TEMPORARY_FAILURE", "QUALITY_RUN_TIMED_OUT", "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT",
  "COPY_QUALITY_POLICY_CHANGED"]);
const SAFE_REWRITE_FAILURE_CODES = new Set(["COPY_REWRITER_TEMPORARY_FAILURE", "COPY_REWRITE_EMPTY_RESULT",
  "COPY_REWRITE_NO_CHANGE", "COPY_REWRITE_TIMED_OUT", "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT"]);

function actor(request) {
  return { organizationId: request.identity.organization.id, actorMemberId: request.identity.member.id };
}

function publicRun(run) {
  return {
    id: run.id, copy_version_id: run.copy_version_id, product_revision_id: run.product_revision_id,
    profile_version: run.profile_version, rule_version: run.rule_version, status: run.status,
    attempts: run.attempts, max_attempts: run.max_attempts, quality_result_id: run.quality_result_id,
    failure_code: run.failure_code ? (SAFE_FAILURE_CODES.has(run.failure_code) ? run.failure_code : "QUALITY_EVALUATION_FAILED") : null,
    started_at: run.started_at, completed_at: run.completed_at, created_at: run.created_at, updated_at: run.updated_at
  };
}

function publicResult(result) {
  return result ? {
    id: result.id, quality_run_id: result.quality_run_id, copy_version_id: result.copy_version_id,
    profile_version: result.profile_version, rule_version: result.rule_version,
    conclusion: result.conclusion, effective_conclusion: result.effective_conclusion,
    current_valid: result.current_valid, invalidation_reason: result.invalidation_reason, created_at: result.created_at
  } : null;
}

function publicFinding(finding) {
  return {
    id: finding.id, quality_result_id: finding.quality_result_id, code: finding.code, kind: finding.kind,
    severity: finding.severity, title: finding.title, matched_text: finding.matched_text, message: finding.message,
    evidence_reference: finding.evidence_reference, rule_source: finding.rule_source,
    suggestion: finding.suggestion, created_at: finding.created_at,
    resolutions: (finding.resolutions || []).map((resolution) => ({ id: resolution.id,
      quality_finding_id: resolution.quality_finding_id, state: resolution.state, reason: resolution.reason,
      actor_member_id: resolution.actor_member_id, created_at: resolution.created_at }))
  };
}

function publicDetails(details) {
  return { quality_run: publicRun(details.quality_run), quality_result: publicResult(details.quality_result),
    quality_findings: details.quality_findings.map(publicFinding) };
}

function publicRewriteJob(job) {
  return { id: job.id, source_copy_version_id: job.source_copy_version_id, finding_id: job.finding_id,
    scope: job.scope, instruction: job.instruction, status: job.status, attempts: job.attempts,
    max_attempts: job.max_attempts, output_copy_version_id: job.output_copy_version_id,
    quality_run_id: job.quality_run_id,
    failure_code: job.failure_code ? (SAFE_REWRITE_FAILURE_CODES.has(job.failure_code) ? job.failure_code : "COPY_REWRITE_FAILED") : null,
    started_at: job.started_at, completed_at: job.completed_at, created_at: job.created_at, updated_at: job.updated_at };
}

function publicRewriteDetails(details) {
  return { rewrite_job: publicRewriteJob(details.rewrite_job), copy_version: details.copy_version,
    quality_run: details.quality_run ? publicRun(details.quality_run) : null };
}

export async function registerCopyQualityRoutes(app, { service, worker, rewriteWorker }) {
  app.post("/api/copy-versions/:copyVersionId/quality-runs", async (request, reply) => {
    const result = await service.startQualityCheck({ ...actor(request), copyVersionId: request.params.copyVersionId,
      expectedRevision: request.body?.expected_revision, idempotencyKey: request.headers["idempotency-key"] });
    reply.code(202).send({ copy_version: result.copy_version, quality_run: publicRun(result.quality_run) });
  });
  app.get("/api/copy-versions/:copyVersionId/quality-runs", async (request) => ({
    quality_runs: (await service.listQualityRuns({ ...actor(request), copyVersionId: request.params.copyVersionId })).map(publicRun)
  }));
  app.get("/api/quality-runs/:qualityRunId", async (request) => publicDetails(await service.getQualityRun({ ...actor(request), qualityRunId: request.params.qualityRunId })));
  app.post("/api/quality-runs/:qualityRunId/retry", async (request, reply) => {
    const result = await service.retryQualityCheck({ ...actor(request), qualityRunId: request.params.qualityRunId,
      idempotencyKey: request.headers["idempotency-key"] });
    reply.code(202).send({ copy_version: result.copy_version, quality_run: publicRun(result.quality_run) });
  });
  app.post("/api/quality-runs/:qualityRunId/cancel", async (request) => ({
    quality_run: publicRun(await service.cancelQualityCheck({ ...actor(request), qualityRunId: request.params.qualityRunId }))
  }));
  app.post("/api/quality-findings/:findingId/resolutions", async (request) => publicDetails(await service.resolveFinding({
    ...actor(request), findingId: request.params.findingId, resolution: request.body?.resolution,
    reason: request.body?.reason, idempotencyKey: request.headers["idempotency-key"]
  })));
  app.post("/api/copy-versions/:copyVersionId/rewrite-jobs", async (request, reply) => {
    const result = await service.requestCopyRewrite({ ...actor(request), copyVersionId: request.params.copyVersionId,
      findingId: request.body?.finding_id, scope: request.body?.scope, instruction: request.body?.instruction,
      idempotencyKey: request.headers["idempotency-key"] });
    reply.code(202).send({ rewrite_job: publicRewriteJob(result.rewrite_job) });
  });
  app.get("/api/rewrite-jobs/:rewriteJobId", async (request) => publicRewriteDetails(await service.getRewriteJob({
    ...actor(request), rewriteJobId: request.params.rewriteJobId })));
  app.get("/api/copy-versions/:copyVersionId/rewrite-jobs", async (request) => ({ rewrite_jobs:
    (await service.listRewriteJobs({ ...actor(request), copyVersionId: request.params.copyVersionId })).map(publicRewriteJob) }));
  app.post("/api/rewrite-jobs/:rewriteJobId/retry", async (request, reply) => {
    const result = await service.retryCopyRewrite({ ...actor(request), rewriteJobId: request.params.rewriteJobId,
      idempotencyKey: request.headers["idempotency-key"] });
    reply.code(202).send({ rewrite_job: publicRewriteJob(result.rewrite_job) });
  });
  app.decorate("runNextCopyQualityJob", worker.runNext);
  app.decorate("runNextCopyRewriteJob", rewriteWorker.runNext);
}
