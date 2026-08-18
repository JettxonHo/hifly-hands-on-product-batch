function actor(request) {
  return {
    organizationId: request.identity.organization.id,
    actorMemberId: request.identity.member.id
  };
}

export async function registerProjectContentRoutes(app, { service }) {
  app.get("/api/projects", async (request) => ({ projects: await service.listProjects(actor(request)) }));

  app.post("/api/projects", async (request, reply) => {
    const project = await service.createProject({
      ...actor(request), idempotencyKey: request.headers["idempotency-key"], name: request.body?.name,
      description: request.body?.description, deliveryDate: request.body?.delivery_date
    });
    reply.code(201).send({ project });
  });

  app.get("/api/projects/:projectId", async (request) => ({
    project: await service.getProject({ ...actor(request), projectId: request.params.projectId })
  }));

  app.get("/api/product-revisions/:revisionId", async (request) => ({
    revision: await service.getRevision({ ...actor(request), productRevisionId: request.params.revisionId })
  }));

  app.post("/api/projects/:projectId/products", async (request, reply) => {
    const result = await service.createProduct({
      ...actor(request), projectId: request.params.projectId, idempotencyKey: request.headers["idempotency-key"],
      productName: request.body?.product_name
    });
    reply.code(201).send(result);
  });

  app.patch("/api/product-revisions/:revisionId", async (request) => ({
    revision: await service.saveRevision({
      ...actor(request), productRevisionId: request.params.revisionId, expectedRevision: request.body?.expected_revision,
      productName: request.body?.product_name, productDescription: request.body?.product_description,
      primaryCategory: request.body?.primary_category, contentBrief: request.body?.content_brief,
      ...(Object.hasOwn(request.body || {}, "physical_dimensions") ? { physicalDimensions: request.body.physical_dimensions } : {}),
      sellingPoints: request.body?.selling_points, assetVersionIds: request.body?.asset_version_ids
    })
  }));

  app.post("/api/product-revisions/:revisionId/selling-points/:pointId/confirm", async (request) => ({
    revision: await service.confirmSellingPoint({
      ...actor(request), productRevisionId: request.params.revisionId, pointId: request.params.pointId,
      expectedRevision: request.body?.expected_revision
    })
  }));

  app.post("/api/product-revisions/:revisionId/ready", async (request) => ({
    revision: await service.readyRevision({
      ...actor(request), productRevisionId: request.params.revisionId, expectedRevision: request.body?.expected_revision,
      idempotencyKey: request.headers["idempotency-key"]
    })
  }));
}
