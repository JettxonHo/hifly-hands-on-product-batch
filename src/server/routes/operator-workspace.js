function actor(request) {
  return {
    organizationId: request.identity.organization.id,
    actorMemberId: request.identity.member.id
  };
}

export async function registerOperatorWorkspaceRoutes(app, { service }) {
  app.get("/api/projects/:projectId/products/:productId/operator-workspace", async (request) => ({
    workspace: await service.getWorkspace({
      ...actor(request),
      projectId: request.params.projectId,
      productId: request.params.productId,
      stage: request.query?.stage
    })
  }));
}
