function actor(request) {
  return { organizationId: request.identity.organization.id, actorMemberId: request.identity.member.id,
    actorRole: request.identity.membership.role };
}

function publicSelection(value) {
  if (!value) return null;
  return { id: value.id, product_id: value.product_id, copy_version_id: value.copy_version_id,
    asset_version_id: value.asset_version_id, version_number: value.version_number, created_by_member_id: value.created_by_member_id,
    status: value.status, row_version: value.row_version, confirmed_at: value.confirmed_at,
    superseded_at: value.superseded_at, superseded_by_selection_id: value.superseded_by_selection_id,
    created_at: value.created_at, updated_at: value.updated_at };
}

function publicSelectionState(state) {
  return { current_selection: publicSelection(state.current_selection), selection_revision: state.selection_revision,
    current_valid: state.current_valid, invalidation_reasons: state.invalidation_reasons,
    history: state.history.map(publicSelection) };
}

function publicWorkspace(value) {
  return { catalog_kind: value.catalog_kind, provider_integration: value.provider_integration,
    recommendation: value.recommendation, controlled_seed_notice: value.controlled_seed_notice,
    resolved_copy_version_id: value.resolved_copy_version_id,
    copy_gate: { approved: value.copy_gate.approved, reasons: value.copy_gate.reasons,
      copy_version_id: value.copy_gate.copy?.copy_version_id || null },
    catalog: value.catalog, selection: publicSelectionState(value.selection) };
}

export async function registerAvatarSelectionRoutes(app, { service }) {
  app.post("/api/avatar-catalog/hifly-public/sync", async (request) => service.syncPublicCatalog(actor(request)));

  app.get("/api/products/:productId/avatar-workspace", async (request) => publicWorkspace(await service.getWorkspace({
    ...actor(request), productId: request.params.productId, copyVersionId: request.query?.copyVersionId
  })));

  app.post("/api/products/:productId/avatar-selections", async (request, reply) => {
    const selection = await service.confirmSelection({ ...actor(request), productId: request.params.productId,
      copyVersionId: request.body?.copy_version_id, assetVersionId: request.body?.asset_version_id,
      expectedRevision: request.body?.expected_revision, idempotencyKey: request.headers["idempotency-key"] });
    reply.code(201).send({ selection: publicSelectionState(selection) });
  });
}
