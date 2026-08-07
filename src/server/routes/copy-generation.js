const SAFE_FAILURE_CODES = new Set(["COPY_GENERATION_FAILED", "COPY_GENERATION_EMPTY_RESULT", "COPY_PROVIDER_TEMPORARY_FAILURE", "COPY_GENERATION_TIMED_OUT"]);

function actor(request) {
  return { organizationId: request.identity.organization.id, actorMemberId: request.identity.member.id };
}

function publicJob(job) {
  return {
    id: job.id, type: job.type, status: job.status, product_revision_id: job.product_revision_id,
    project_id: job.project_id, product_id: job.product_id, intent: job.intent, attempts: job.attempts, max_attempts: job.max_attempts,
    copy_version_id: job.copy_version_id,
    failure_code: job.failure_code ? (SAFE_FAILURE_CODES.has(job.failure_code) ? job.failure_code : "COPY_GENERATION_FAILED") : null,
    started_at: job.started_at, completed_at: job.completed_at, created_at: job.created_at, updated_at: job.updated_at
  };
}

export async function registerCopyGenerationRoutes(app, { service, worker }) {
  app.post("/api/product-revisions/:revisionId/copy-generations", async (request, reply) => {
    const result = await service.requestGeneration({
      ...actor(request), productRevisionId: request.params.revisionId, intent: request.body?.intent,
      idempotencyKey: request.headers["idempotency-key"]
    });
    reply.code(202).send({ job: publicJob(result.job), copy_version: result.copy_version });
  });
  app.get("/api/copy-generation-jobs/:jobId", async (request) => ({
    job: publicJob(await service.getGenerationJob({ ...actor(request), jobId: request.params.jobId }))
  }));
  app.get("/api/product-revisions/:revisionId/copy-generation-jobs", async (request) => ({
    jobs: (await service.listGenerationJobs({ ...actor(request), productRevisionId: request.params.revisionId })).map(publicJob)
  }));
  app.get("/api/product-revisions/:revisionId/copy-versions", async (request) => ({
    copy_versions: await service.listCopyVersions({ ...actor(request), productRevisionId: request.params.revisionId })
  }));
  app.get("/api/copy-versions/:copyVersionId", async (request) => ({
    copy_version: await service.getCopyVersion({ ...actor(request), copyVersionId: request.params.copyVersionId })
  }));
  app.patch("/api/copy-versions/:copyVersionId", async (request) => ({
    copy_version: await service.editCopyVersion({
      ...actor(request), copyVersionId: request.params.copyVersionId,
      expectedRevision: request.body?.expected_revision, body: request.body?.body
    })
  }));
  app.post("/api/copy-versions/:copyVersionId/freeze", async (request) => ({
    copy_version: await service.freezeCopyVersion({
      ...actor(request), copyVersionId: request.params.copyVersionId,
      expectedRevision: request.body?.expected_revision, idempotencyKey: request.headers["idempotency-key"]
    })
  }));
  app.post("/api/copy-generation-jobs/:jobId/retry", async (request, reply) => {
    const job = await service.retryGenerationJob({ ...actor(request), jobId: request.params.jobId, idempotencyKey: request.headers["idempotency-key"] });
    reply.code(202).send({ job: publicJob(job) });
  });
  app.post("/api/copy-generation-jobs/:jobId/abort", async (request) => ({
    job: publicJob(await service.abortGenerationJob({ ...actor(request), jobId: request.params.jobId }))
  }));
  app.decorate("runNextCopyGenerationJob", worker.runNext);
}
