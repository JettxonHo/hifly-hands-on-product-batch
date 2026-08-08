function actor(request) {
  return { organizationId: request.identity.organization.id, actorMemberId: request.identity.member.id, actorRole: request.identity.membership.role };
}

function cookieName(packageId) { return `hifly_manual_download_${packageId}`; }

function readCookie(request, name) {
  const cookie = String(request.headers.cookie || "");
  const part = cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
  return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
}

function cookieHeader(packageId, token, expiresAt) {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  return `${cookieName(packageId)}=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/api/manual-handoff-packages/${packageId}; HttpOnly; SameSite=Lax`;
}

function publicPackage(service, value) { return service.publicPackage(value); }

export async function registerManualHandoffRoutes(app, { service }) {
  app.get("/api/production-orders/:orderId/manual-handoff-packages", async (request) => ({
    packages: await service.listPackages({ ...actor(request), productionOrderId: request.params.orderId })
  }));

  app.post("/api/production-orders/:orderId/manual-handoff-packages", async (request, reply) => {
    const result = await service.requestGeneration({ ...actor(request), productionOrderId: request.params.orderId,
      generationRequestId: request.body?.generation_request_id || request.headers["idempotency-key"],
      contractVersion: request.body?.contract_version, packageVersion: request.body?.package_version });
    reply.code(202).send({ package: result.package, job: result.job, replayed: result.replayed });
  });

  app.get("/api/manual-handoff-packages/:packageId", async (request) => ({
    package: publicPackage(service, await service.getPackage({ ...actor(request), packageId: request.params.packageId }))
  }));

  app.get("/api/manual-handoff-jobs/:jobId", async (request) => ({
    job: await service.getGenerationJob({ ...actor(request), jobId: request.params.jobId }).then((value) => ({ id: value.id, type: value.type, status: value.status, package_id: value.package_id, attempts: value.attempts, max_attempts: value.max_attempts, created_at: value.created_at, updated_at: value.updated_at, completed_at: value.completed_at || null }))
  }));

  app.post("/api/manual-handoff-packages/:packageId/retry", async (request, reply) => {
    const result = await service.retryGeneration({ ...actor(request), packageId: request.params.packageId,
      generationRequestId: request.body?.generation_request_id || request.headers["idempotency-key"] });
    reply.code(202).send({ package: result.package, job: result.job, replayed: result.replayed });
  });

  app.post("/api/manual-handoff-packages/:packageId/download-authorizations", async (request, reply) => {
    const result = await service.authorizeDownload({ ...actor(request), packageId: request.params.packageId });
    reply.header("Set-Cookie", cookieHeader(request.params.packageId, result.token, result.expires_at));
    reply.code(201).send({ download: { package_id: result.package.id, package_version: result.package.package_version, expires_at: result.expires_at } });
  });

  app.get("/api/manual-handoff-packages/:packageId/download", async (request, reply) => {
    const token = readCookie(request, cookieName(request.params.packageId));
    if (!token) throw Object.assign(new Error("MANUAL_HANDOFF_DOWNLOAD_AUTHORIZATION_REQUIRED"), { code: "MANUAL_HANDOFF_DOWNLOAD_AUTHORIZATION_REQUIRED" });
    const result = await service.downloadPackage({ ...actor(request), packageId: request.params.packageId, authorizationToken: token });
    reply.type(result.contentType);
    reply.header("Content-Disposition", `attachment; filename="manual-handoff-${result.package.id}.zip"`);
    reply.send(result.body);
  });
}
