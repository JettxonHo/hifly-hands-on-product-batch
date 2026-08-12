const clean = (value) => typeof value === "string" ? value.trim() : "";
const failure = (code, details = null) => Object.assign(new Error(code), { code, details });
const stableJson = (value) => Array.isArray(value) ? `[${value.map(stableJson).join(",")}]` :
  value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}` : JSON.stringify(value);

function validateContext(input) {
  if (!clean(input.organizationId) || !clean(input.actorMemberId) || !clean(input.productId)) throw failure("AVATAR_SELECTION_CONTEXT_REQUIRED");
  if (!["member", "admin"].includes(input.actorRole)) throw failure("AVATAR_SELECTION_FORBIDDEN");
}

function validateKey(value) {
  if (!clean(value) || value.length > 128) throw failure("INVALID_IDEMPOTENCY_KEY");
}

export function createCurrentApprovedCopyPort({ copyService, copyReviewService } = {}) {
  if (!copyService || !copyReviewService) throw new TypeError("copyService and copyReviewService are required");
  async function approvedCopy(input, copy) {
    if (!copy || copy.product_id !== input.productId) return null;
    const gate = await copyReviewService.getCurrentApprovedGate({ ...input, copyVersionId: copy.id });
    return gate.approved ? { copy_version_id: copy.id, product_revision_id: copy.product_revision_id, current_valid: true } : null;
  }
  return {
    async getCurrentApprovedCopy(input) {
      let copy;
      try { copy = await copyService.getCopyVersion(input); }
      catch (error) { if (error?.code === "COPY_VERSION_NOT_FOUND") return null; throw error; }
      return approvedCopy(input, copy);
    },
    async resolveCurrentApprovedCopy(input) {
      const copies = await copyService.listCopyVersionsForProduct(input);
      for (const copy of copies) {
        const approved = await approvedCopy(input, copy);
        if (approved) return approved;
      }
      return null;
    }
  };
}

export function createAvatarSelectionService({ repository, copyApprovalPort, now = Date.now,
  confirmationReturnBarrier = async () => {}, publicAvatarCatalog = null } = {}) {
  if (!repository || !copyApprovalPort) throw new TypeError("repository and copyApprovalPort are required");
  const timestamp = () => new Date(now()).toISOString();

  async function copyGate(input) {
    const copy = clean(input.copyVersionId) ? await copyApprovalPort.getCurrentApprovedCopy(input) :
      await copyApprovalPort.resolveCurrentApprovedCopy?.(input);
    return copy?.current_valid === true ? { approved: true, reasons: [], copy } :
      { approved: false, reasons: ["approved_copy_missing"], copy: null };
  }

  async function syncPublicCatalog(input = {}) {
    if (!clean(input.organizationId) || !clean(input.actorMemberId)) throw failure("HIFLY_PUBLIC_AVATAR_SYNC_CONTEXT_REQUIRED");
    if (input.actorRole !== "admin") throw failure("HIFLY_PUBLIC_AVATAR_SYNC_FORBIDDEN");
    const collect = publicAvatarCatalog?.list || publicAvatarCatalog?.listPublicAvatars;
    if (typeof collect !== "function") throw failure("HIFLY_PUBLIC_AVATAR_SYNC_UNAVAILABLE");
    let entries;
    try {
      entries = await collect.call(publicAvatarCatalog);
    } catch (error) {
      if (typeof error?.code === "string" && error.code.startsWith("HIFLY_API_")) throw failure(error.code);
      throw failure("HIFLY_API_UNAVAILABLE");
    }
    if (!Array.isArray(entries)) throw failure("HIFLY_PUBLIC_AVATAR_CATALOG_INVALID");
    const syncedAt = timestamp();
    const summary = await repository.syncPublicCatalog({ organizationId: input.organizationId, entries, now: syncedAt });
    return { ...summary, synced_at: syncedAt };
  }

  function catalogGate(entry, approvedGate) {
    const reasons = [...approvedGate.reasons];
    const { asset, asset_version: version, capabilities } = entry;
    if (asset.status !== "active") reasons.push("avatar_asset_unavailable");
    if (version.status !== "available") reasons.push("avatar_version_unavailable");
    if (!["valid", "expiring"].includes(version.authorization_status)) reasons.push(`authorization_${version.authorization_status}`);
    if (version.authorization_expires_at && Date.parse(version.authorization_expires_at) <= now()) reasons.push("authorization_expired");
    const verified = capabilities.filter((item) => item.verification_status === "verified" && clean(item.evidence_reference));
    if (version.capability_status !== "verified" || verified.length === 0) reasons.push("capability_evidence_missing");
    if (version.authorization_scope !== "current_organization") reasons.push("organization_use_not_authorized");
    if (version.materials_accessible !== true) reasons.push("avatar_materials_unavailable");
    return { can_confirm: reasons.length === 0, reasons: [...new Set(reasons)] };
  }

  function publicCatalog(entry, approvedGate) {
    const verified = entry.capabilities.filter((item) => item.verification_status === "verified" && clean(item.evidence_reference));
    return { id: entry.asset.id, display_name: entry.asset.display_name, description: entry.asset.description,
      source_type: entry.asset.source_type, status: entry.asset.status, controlled_seed: entry.asset.controlled_seed,
      seed_label: entry.asset.seed_label, creation_supported: false, authorization_status: entry.asset_version.authorization_status,
      authorization_expires_at: entry.asset_version.authorization_expires_at,
      authorization_scope: entry.asset_version.authorization_scope,
      materials_accessible: entry.asset_version.materials_accessible,
      capability_status: entry.asset_version.capability_status,
      verified_capabilities: verified.map(({ code, label, evidence_reference }) => ({ code, label, evidence_reference })),
      asset_version: { id: entry.asset_version.id, version_number: entry.asset_version.version_number,
        status: entry.asset_version.status, preview_kind: entry.asset_version.preview_kind },
      gate: catalogGate(entry, approvedGate) };
  }

  async function selectionProjection(input, approvedGate = null) {
    const state = await repository.getSelectionState(input.organizationId, input.productId);
    const gate = approvedGate || await copyGate(input);
    const reasons = [...gate.reasons];
    if (state.current_selection && clean(input.copyVersionId) && state.current_selection.copy_version_id !== input.copyVersionId) reasons.push("copy_version_changed");
    if (state.current_selection) {
      const entry = await repository.getCatalogVersion(input.organizationId, state.current_selection.asset_version_id);
      if (!entry) reasons.push("avatar_asset_unavailable");
      else reasons.push(...catalogGate(entry, { approved: true, reasons: [], copy: gate.copy }).reasons);
    }
    return { ...state, current_valid: Boolean(state.current_selection) && reasons.length === 0,
      invalidation_reasons: [...new Set(reasons)] };
  }

  return {
    syncPublicCatalog,
    syncHiflyPublicCatalog: syncPublicCatalog,
    async getWorkspace(input) {
      validateContext(input);
      const at = timestamp();
      await repository.ensureControlledCatalog(input.organizationId, at);
      const approvedGate = await copyGate(input);
      const resolvedCopyVersionId = approvedGate.copy?.copy_version_id || clean(input.copyVersionId) || null;
      const effectiveInput = { ...input, copyVersionId: resolvedCopyVersionId };
      const entries = await repository.listCatalog(input.organizationId);
      return { catalog_kind: "existing_only", provider_integration: false, recommendation: false,
        controlled_seed_notice: "Phase 1 受控预置；不连接真实飞影，不代表推荐或真实生产能力。",
        resolved_copy_version_id: resolvedCopyVersionId,
        copy_gate: approvedGate, catalog: entries.map((entry) => publicCatalog(entry, approvedGate)),
        selection: await selectionProjection(effectiveInput, approvedGate) };
    },
    async confirmSelection(input) {
      validateContext(input); validateKey(input.idempotencyKey);
      if (!clean(input.copyVersionId) || !clean(input.assetVersionId) || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 0) {
        throw failure("INVALID_AVATAR_SELECTION_PAYLOAD");
      }
      await repository.ensureControlledCatalog(input.organizationId, timestamp());
      const fingerprint = stableJson({ product_id: input.productId, copy_version_id: input.copyVersionId,
        asset_version_id: input.assetVersionId, expected_revision: input.expectedRevision });
      const receiptKey = `${input.organizationId}:avatar-confirm:${input.idempotencyKey}`;
      const replay = await repository.getReceipt(receiptKey, fingerprint);
      if (replay) return replay;
      const entry = await repository.getCatalogVersion(input.organizationId, input.assetVersionId);
      if (!entry) throw failure("AVATAR_ASSET_VERSION_NOT_FOUND");
      const approvedGate = await copyGate(input);
      const gate = catalogGate(entry, approvedGate);
      if (!gate.can_confirm) throw failure("AVATAR_SELECTION_GATE_BLOCKED", gate.reasons);
      await repository.confirmSelection({ ...input, receiptKey, fingerprint, now: timestamp() });
      await confirmationReturnBarrier({ organizationId: input.organizationId, productId: input.productId,
        copyVersionId: input.copyVersionId, assetVersionId: input.assetVersionId });
      const result = await selectionProjection(input);
      await repository.updateReceiptResult(receiptKey, result);
      return result;
    },
    async getPlanningInput(input) {
      validateContext(input);
      await repository.ensureControlledCatalog(input.organizationId, timestamp());
      const approvedGate = await copyGate(input);
      const resolvedCopyVersionId = approvedGate.copy?.copy_version_id || clean(input.copyVersionId) || null;
      const selection = await selectionProjection({ ...input, copyVersionId: resolvedCopyVersionId }, approvedGate);
      if (!selection.current_valid || !selection.current_selection) return null;
      const entry = await repository.getCatalogVersion(input.organizationId, selection.current_selection.asset_version_id);
      if (!entry) return null;
      const verified = entry.capabilities.filter((item) => item.verification_status === "verified" && clean(item.evidence_reference));
      return { product_revision_id: approvedGate.copy.product_revision_id,
        copy_version_id: approvedGate.copy.copy_version_id,
        avatar_selection_id: selection.current_selection.id,
        avatar_asset_version_id: selection.current_selection.asset_version_id,
        current_valid: true,
        capability_config_snapshot: { snapshot_version: `avatar-${entry.asset_version.id}-v${entry.asset_version.version_number}`,
          verified_capabilities: verified.map(({ code, evidence_reference }) => ({ code, evidence_reference })) } };
    }
  };
}
