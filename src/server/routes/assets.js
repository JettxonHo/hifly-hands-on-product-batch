function integerRevision(value) {
  const revision = Number(value);
  if (!Number.isInteger(revision) || revision < 1) throw Object.assign(new Error("INVALID_ASSET_REVISION"), { code: "INVALID_ASSET_REVISION" });
  return revision;
}

function publicVersion(version) {
  const { object_key: _privateObjectKey, ...result } = version;
  return result;
}

function publicAsset(asset) {
  return { ...asset, ...(asset.versions ? { versions: asset.versions.map(publicVersion) } : {}) };
}

export async function registerAssetRoutes(app, { service, worker }) {
  const organizationId = (request) => request.identity.organization.id;
  const requireAdmin = (request) => {
    if (request.identity.membership.role !== "admin") throw Object.assign(new Error("ADMIN_REQUIRED"), { code: "ADMIN_REQUIRED" });
  };

  app.get("/api/assets", async (request) => ({ assets: (await service.listAssets({ organizationId: organizationId(request) })).map(publicAsset) }));

  app.post("/api/assets/upload-authorizations", async (request, reply) => {
    const result = await service.createUploadAuthorization({
      organizationId: organizationId(request), actorMemberId: request.identity.member.id,
      idempotencyKey: request.headers["idempotency-key"], assetId: request.body?.asset_id,
      filename: request.body?.filename, contentType: request.body?.content_type, size: request.body?.size,
      checksumSha256: request.body?.checksum_sha256
    });
    const { object_key: _hidden, ...publicResult } = result;
    publicResult.asset_version = publicVersion(publicResult.asset_version);
    publicResult.upload.url = `/api/assets/uploads/${encodeURIComponent(result.upload.token)}`;
    reply.code(201).send(publicResult);
  });

  app.put("/api/assets/uploads/:token", async (request) => service.uploadObject({
    organizationId: organizationId(request), uploadToken: request.params.token, body: request.body,
    contentType: String(request.headers["content-type"] || "").split(";", 1)[0]
  }));

  app.post("/api/assets/upload-completions", async (request, reply) => {
    const result = await service.completeUpload({
      organizationId: organizationId(request), uploadSessionId: request.body?.upload_session_id,
      idempotencyKey: request.body?.idempotency_key, actorMemberId: request.identity.member.id
    });
    worker?.wake();
    reply.code(202).send({ ...result, asset_version: publicVersion(result.asset_version) });
  });

  app.get("/api/asset-versions/:assetVersionId", async (request) => ({
    asset_version: publicVersion(await service.getAssetVersion({ organizationId: organizationId(request), assetVersionId: request.params.assetVersionId }))
  }));

  app.patch("/api/assets/:assetId", async (request) => ({
    asset: await service.updateAssetMetadata({
      organizationId: organizationId(request), assetId: request.params.assetId,
      expectedRevision: integerRevision(request.body?.expected_revision), displayName: request.body?.display_name,
      actorMemberId: request.identity.member.id
    })
  }));

  app.post("/api/assets/:assetId/disable", async (request) => {
    requireAdmin(request);
    return { asset: await service.disableAsset({ organizationId: organizationId(request), assetId: request.params.assetId, expectedRevision: integerRevision(request.body?.expected_revision), actorMemberId: request.identity.member.id }) };
  });

  app.delete("/api/assets/:assetId", async (request) => {
    requireAdmin(request);
    return { asset: await service.deleteAsset({ organizationId: organizationId(request), assetId: request.params.assetId, expectedRevision: integerRevision(request.body?.expected_revision), actorMemberId: request.identity.member.id }) };
  });

  app.post("/api/asset-versions/:assetVersionId/download-authorizations", async (request, reply) => {
    const result = await service.createDownloadAuthorization({ organizationId: organizationId(request), assetVersionId: request.params.assetVersionId });
    reply.code(201).send({ download: { url: `/api/assets/downloads/${encodeURIComponent(result.token)}`, expires_at: result.expires_at } });
  });

  app.get("/api/assets/downloads/:token", async (request, reply) => {
    const result = await service.downloadObject({ organizationId: organizationId(request), token: request.params.token });
    reply.type(result.contentType).send(result.body);
  });
}
