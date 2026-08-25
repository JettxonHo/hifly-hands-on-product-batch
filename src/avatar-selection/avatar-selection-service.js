const clean = (value) => typeof value === "string" ? value.trim() : "";
const failure = (code, details = null) => Object.assign(new Error(code), { code, details });
const stableJson = (value) => Array.isArray(value) ? `[${value.map(stableJson).join(",")}]` :
  value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}` : JSON.stringify(value);
const AUTHORIZATION_STATUSES = new Set(["valid", "expiring", "expired", "incomplete"]);
const MAX_CATEGORY_TAGS = 12;
const MAX_CATEGORY_TAG_LENGTH = 40;
const MAX_CAPABILITIES = 12;
const MAX_CAPABILITY_FIELD_LENGTH = 120;
const PREVIEW_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// Keep provider bytes bounded before entering the repository transaction. The catalog
// pagination contract is unchanged; entries beyond either cap are neutral/unavailable.
const MAX_PUBLIC_THUMBNAIL_SOURCE_ITEMS = 100;
const MAX_PUBLIC_THUMBNAIL_SOURCE_BYTES = 64 * 1024 * 1024;
const RECOMMENDATION_REASON = Object.freeze({
  exact_category_match: (category) => `匹配商品主品类「${category}」。`,
  general_pool_fallback: "未找到商品主品类精确匹配，使用未设置分类标签的通用人物。",
  category_mismatch: "未匹配商品主品类，仍可浏览。",
  not_confirmable: "当前人物不可确认，不参与推荐。",
  approved_copy_missing: "当前批准文案不可用，暂不生成推荐。",
  product_revision_unavailable: "当前商品版本信息不可用，暂不生成推荐。",
  no_eligible_recommendation: "没有品类标签精确匹配，也没有未设置分类标签的可确认人物。"
});

function validateContext(input) {
  if (!clean(input.organizationId) || !clean(input.actorMemberId) || !clean(input.productId)) throw failure("AVATAR_SELECTION_CONTEXT_REQUIRED");
  if (!["member", "admin"].includes(input.actorRole)) throw failure("AVATAR_SELECTION_FORBIDDEN");
}

function validateKey(value) {
  if (!clean(value) || value.length > 128) throw failure("INVALID_IDEMPOTENCY_KEY");
}

function normalizeCategoryTags(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_CATEGORY_TAGS) throw failure("INVALID_AVATAR_CATEGORY_TAGS");
  const tags = [];
  for (const item of value) {
    const tag = clean(item);
    if (!tag || tag.length > MAX_CATEGORY_TAG_LENGTH) throw failure("INVALID_AVATAR_CATEGORY_TAGS");
    if (!tags.includes(tag)) tags.push(tag);
  }
  return tags;
}

function normalizeRecommendationCategory(value) {
  return clean(value).toLowerCase();
}

function normalizedRecommendationTags(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeRecommendationCategory).filter(Boolean))];
}

function normalizeCapabilities(value) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > MAX_CAPABILITIES) throw failure("INVALID_AVATAR_CAPABILITIES");
  const codes = new Set();
  return value.map((item) => {
    const code = clean(item?.code), label = clean(item?.label), evidenceReference = clean(item?.evidenceReference || item?.evidence_reference);
    if (!code || !label || !evidenceReference || [code, label, evidenceReference].some((field) => field.length > MAX_CAPABILITY_FIELD_LENGTH) || codes.has(code)) {
      throw failure("INVALID_AVATAR_CAPABILITIES");
    }
    codes.add(code);
    return { code, label, evidence_reference: evidenceReference, verification_status: "verified" };
  });
}

function normalizeAuthorizationExpiresAt(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) throw failure("INVALID_AVATAR_AUTHORIZATION");
  return new Date(value).toISOString();
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
  confirmationReturnBarrier = async () => {}, publicAvatarCatalog = null, materialAssetPort = null,
  publicAvatarThumbnailSource = null, productRevisionPort = null } = {}) {
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
    const sourceRead = publicAvatarThumbnailSource?.read || publicAvatarThumbnailSource?.readThumbnail || publicAvatarThumbnailSource?.getThumbnail;
    const registerThumbnail = materialAssetPort?.registerPublicAvatarThumbnail || materialAssetPort?.register;
    const bindThumbnail = repository.bindPublicAvatarMaterial;
    if (typeof sourceRead !== "function" || typeof registerThumbnail !== "function" || typeof bindThumbnail !== "function") {
      const summary = await repository.syncPublicCatalog({ organizationId: input.organizationId, entries, now: syncedAt });
      return { ...summary, synced_at: syncedAt };
    }

    const thumbnails = [];
    let sourceReadCount = 0;
    let sourceBytes = 0;
    let sourceBudgetExhausted = false;
    for (const entry of entries) {
      if (sourceBudgetExhausted || sourceReadCount >= MAX_PUBLIC_THUMBNAIL_SOURCE_ITEMS) {
        thumbnails.push({ entry, thumbnail: null, status: "unavailable" });
        continue;
      }
      sourceReadCount += 1;
      try {
        const thumbnail = await sourceRead.call(publicAvatarThumbnailSource, {
          provider_key: entry.provider_key, providerKey: entry.provider_key,
          title: entry.display_name, display_name: entry.display_name
        });
        if (!thumbnail || !Buffer.isBuffer(thumbnail.bytes) || thumbnail.bytes.length < 1) {
          throw failure("HIFLY_PUBLIC_AVATAR_THUMBNAIL_UNAVAILABLE");
        }
        if (sourceBytes + thumbnail.bytes.length > MAX_PUBLIC_THUMBNAIL_SOURCE_BYTES) {
          sourceBudgetExhausted = true;
          thumbnails.push({ entry, thumbnail: null, status: "unavailable" });
          continue;
        }
        sourceBytes += thumbnail.bytes.length;
        if (sourceBytes >= MAX_PUBLIC_THUMBNAIL_SOURCE_BYTES) sourceBudgetExhausted = true;
        thumbnails.push({ entry, thumbnail, status: "available" });
      } catch {
        thumbnails.push({ entry, thumbnail: null, status: "unavailable" });
      }
    }

    const run = async (transactionClient = null) => {
      const summary = await repository.syncPublicCatalog({ organizationId: input.organizationId, entries, now: syncedAt, transactionClient });
      let thumbnailImported = 0, thumbnailUnchanged = 0, thumbnailUnavailable = 0;
      for (const item of thumbnails) {
        if (item.status !== "available") { thumbnailUnavailable += 1; continue; }
        const material = await registerThumbnail.call(materialAssetPort, {
          organizationId: input.organizationId, providerKey: item.entry.provider_key,
          displayName: item.entry.display_name, bytes: item.thumbnail.bytes,
          mediaType: item.thumbnail.media_type, size: item.thumbnail.size,
          checksumSha256: item.thumbnail.checksum_sha256, transactionClient
        });
        const bound = await bindThumbnail.call(repository, {
          organizationId: input.organizationId, providerKey: item.entry.provider_key,
          materialAsset: material.asset, materialVersion: material.asset_version,
          now: syncedAt, transactionClient
        });
        if (bound.replayed || material.replayed) thumbnailUnchanged += 1;
        else thumbnailImported += 1;
      }
      return { ...summary, thumbnail_total: entries.length, thumbnail_imported: thumbnailImported,
        thumbnail_unchanged: thumbnailUnchanged, thumbnail_unavailable: thumbnailUnavailable, synced_at: syncedAt };
    };
    if (typeof repository.withPublicAvatarSync === "function") {
      return repository.withPublicAvatarSync({ organizationId: input.organizationId, work: ({ transactionClient }) => run(transactionClient) });
    }
    return run(null);
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

  function managementProjection(entry) {
    const { asset, asset_version: version, capabilities } = entry;
    return {
      id: asset.id, display_name: asset.display_name, description: asset.description,
      category_tags: Array.isArray(asset.category_tags) ? [...asset.category_tags] : [],
      source_type: asset.source_type, status: asset.status, controlled_seed: asset.controlled_seed,
      revision_number: asset.revision_number || 1,
      authorization_status: version.authorization_status, authorization_expires_at: version.authorization_expires_at,
      authorization_scope: version.authorization_scope, materials_accessible: version.materials_accessible === true,
      material_status: version.material_status || (version.materials_accessible === true ? "available" : "unavailable"),
      capability_status: version.capability_status,
      verified_capabilities: capabilities.filter((item) => item.verification_status === "verified" && clean(item.evidence_reference))
        .map(({ code, label, evidence_reference }) => ({ code, label, evidence_reference })),
      asset_version: { id: version.id, version_number: version.version_number, status: version.status, preview_kind: version.preview_kind }
    };
  }

  async function refreshMaterialState(entry) {
    const materialVersionId = entry?.asset_version?.material_asset_version_id;
    if (!materialVersionId || !materialAssetPort?.getAssetVersion || !materialAssetPort?.getAsset) return entry;
    try {
      const materialVersion = await materialAssetPort.getAssetVersion({ organizationId: entry.asset.organization_id, assetVersionId: materialVersionId });
      const materialAsset = await materialAssetPort.getAsset({ organizationId: entry.asset.organization_id, assetId: materialVersion.asset_id });
      const accessible = materialAsset.organization_id === entry.asset.organization_id && materialAsset.kind === "avatar_image" &&
        materialAsset.status === "active" && materialVersion.status === "available";
      return { ...entry, asset_version: { ...entry.asset_version, materials_accessible: accessible, material_status: accessible ? "available" : "unavailable" } };
    } catch (error) {
      if (["ASSET_VERSION_NOT_FOUND", "ASSET_NOT_FOUND"].includes(error?.code)) {
        return { ...entry, asset_version: { ...entry.asset_version, materials_accessible: false, material_status: "unavailable" } };
      }
      throw error;
    }
  }

  function publicCatalog(entry, approvedGate) {
    return { ...managementProjection(entry), seed_label: entry.asset.seed_label, creation_supported: false,
      gate: catalogGate(entry, approvedGate) };
  }

  async function recommendationContext(input, approvedGate) {
    if (!approvedGate.approved) return { available: false, primary_category: null,
      reason_code: "approved_copy_missing", reason: RECOMMENDATION_REASON.approved_copy_missing };
    if (typeof productRevisionPort?.getSnapshot !== "function") return { available: false, primary_category: null,
      reason_code: "product_revision_unavailable", reason: RECOMMENDATION_REASON.product_revision_unavailable };
    const revision = await productRevisionPort.getSnapshot({ organizationId: input.organizationId,
      productRevisionId: approvedGate.copy.product_revision_id });
    if (!revision || (revision.organization_id && revision.organization_id !== input.organizationId) ||
      (revision.product_id && revision.product_id !== input.productId)) throw failure("PRODUCT_REVISION_NOT_FOUND");
    return { available: true, primary_category: normalizeRecommendationCategory(revision.primary_category) || null };
  }

  function recommendationProjection(reasonCode, primaryCategory, matchedTags = []) {
    const reason = reasonCode === "exact_category_match" ? RECOMMENDATION_REASON.exact_category_match(primaryCategory) : RECOMMENDATION_REASON[reasonCode];
    return { recommended: reasonCode === "exact_category_match" || reasonCode === "general_pool_fallback",
      reason_code: reasonCode, reason, matched_tags: [...matchedTags] };
  }

  function projectRecommendedCatalog(entries, approvedGate, context) {
    const candidates = entries.map((entry) => {
      const projection = publicCatalog(entry, approvedGate);
      const tags = normalizedRecommendationTags(entry.asset.category_tags);
      const matchedTags = context.primary_category ? tags.filter((tag) => tag === context.primary_category) : [];
      return { entry, projection, tags, matchedTags };
    });
    const exact = context.available ? candidates.filter((candidate) => candidate.projection.gate.can_confirm && candidate.matchedTags.length > 0) : [];
    const general = exact.length === 0 ? candidates.filter((candidate) => candidate.projection.gate.can_confirm && candidate.tags.length === 0) : [];
    const summaryReasonCode = !context.available ? context.reason_code : exact.length > 0 ? "exact_category_match" :
      general.length > 0 ? "general_pool_fallback" : "no_eligible_recommendation";
    const summaryReason = summaryReasonCode === "exact_category_match" ? RECOMMENDATION_REASON.exact_category_match(context.primary_category) :
      RECOMMENDATION_REASON[summaryReasonCode];
    const catalog = candidates.map((candidate) => {
      let reasonCode;
      let matchedTags = [];
      if (!candidate.projection.gate.can_confirm) reasonCode = "not_confirmable";
      else if (!context.available) reasonCode = context.reason_code;
      else if (exact.length > 0 && candidate.matchedTags.length > 0) { reasonCode = "exact_category_match"; matchedTags = candidate.matchedTags; }
      else if (exact.length === 0 && candidate.tags.length === 0) reasonCode = "general_pool_fallback";
      else reasonCode = "category_mismatch";
      return { ...candidate.projection, recommendation: recommendationProjection(reasonCode, context.primary_category, matchedTags) };
    }).sort((left, right) => {
      const rank = (item) => item.recommendation.recommended ? (item.recommendation.reason_code === "exact_category_match" ? 0 : 1) : item.gate.can_confirm ? 2 : 3;
      return rank(left) - rank(right) || left.display_name.localeCompare(right.display_name, "zh-CN") || left.asset_version.id.localeCompare(right.asset_version.id);
    });
    return { catalog, recommendation: { primary_category: context.primary_category, has_recommendations: exact.length > 0 || general.length > 0,
      recommended_count: exact.length || general.length, reason_code: summaryReasonCode, reason: summaryReason } };
  }

  async function selectionProjection(input, approvedGate = null) {
    const state = await repository.getSelectionState(input.organizationId, input.productId);
    const gate = approvedGate || await copyGate(input);
    const reasons = [...gate.reasons];
    if (state.current_selection && clean(input.copyVersionId) && state.current_selection.copy_version_id !== input.copyVersionId) reasons.push("copy_version_changed");
    if (state.current_selection) {
      const entry = await refreshMaterialState(await repository.getCatalogVersion(input.organizationId, state.current_selection.asset_version_id));
      if (!entry) reasons.push("avatar_asset_unavailable");
      else reasons.push(...catalogGate(entry, { approved: true, reasons: [], copy: gate.copy }).reasons);
    }
    return { ...state, current_valid: Boolean(state.current_selection) && reasons.length === 0,
      invalidation_reasons: [...new Set(reasons)] };
  }

  return {
    syncPublicCatalog,
    syncHiflyPublicCatalog: syncPublicCatalog,
    projectCatalogEntry: managementProjection,
    async registerEnterpriseAvatar(input = {}) {
      if (!clean(input.organizationId) || !clean(input.actorMemberId)) throw failure("AVATAR_REGISTRATION_CONTEXT_REQUIRED");
      if (input.actorRole !== "admin") throw failure("AVATAR_REGISTRATION_FORBIDDEN");
      if (!clean(input.materialAssetVersionId) || !clean(input.displayName) || input.displayName.length > 120 || !clean(input.description) || input.description.length > 1000) {
        throw failure("INVALID_ENTERPRISE_AVATAR_PAYLOAD");
      }
      if (!AUTHORIZATION_STATUSES.has(input.authorizationStatus)) throw failure("INVALID_AVATAR_AUTHORIZATION");
      const authorizationExpiresAt = normalizeAuthorizationExpiresAt(input.authorizationExpiresAt);
      const categoryTags = normalizeCategoryTags(input.categoryTags || input.category_tags);
      const capabilities = normalizeCapabilities(input.capabilities || input.verifiedCapabilities || input.verified_capabilities);
      if (!materialAssetPort?.getAssetVersion || !materialAssetPort?.getAsset) throw failure("AVATAR_MATERIALS_UNAVAILABLE");
      let materialVersion, materialAsset;
      try {
        materialVersion = await materialAssetPort.getAssetVersion({ organizationId: input.organizationId, assetVersionId: input.materialAssetVersionId });
        materialAsset = await materialAssetPort.getAsset({ organizationId: input.organizationId, assetId: materialVersion.asset_id });
      } catch (error) {
        if (["ASSET_VERSION_NOT_FOUND", "ASSET_NOT_FOUND"].includes(error?.code)) throw failure("AVATAR_MATERIAL_VERSION_NOT_FOUND");
        throw error;
      }
      if (materialAsset.organization_id !== input.organizationId || materialVersion.organization_id !== input.organizationId) throw failure("AVATAR_MATERIAL_VERSION_NOT_FOUND");
      if (materialAsset.kind !== "avatar_image") throw failure("AVATAR_MATERIAL_KIND_INVALID");
      if (materialAsset.status !== "active" || materialVersion.status !== "available") throw failure("AVATAR_MATERIAL_NOT_AVAILABLE");
      return repository.registerEnterpriseAvatar({ organizationId: input.organizationId, actorMemberId: input.actorMemberId,
        materialAssetVersionId: materialVersion.id, materialAsset, materialVersion, displayName: input.displayName.trim(),
        description: input.description.trim(), authorizationStatus: input.authorizationStatus,
        authorizationExpiresAt, categoryTags, capabilities, now: timestamp() });
    },
    async disableEnterpriseAvatar(input = {}) {
      if (!clean(input.organizationId) || !clean(input.actorMemberId)) throw failure("AVATAR_REGISTRATION_CONTEXT_REQUIRED");
      if (input.actorRole !== "admin") throw failure("AVATAR_REGISTRATION_FORBIDDEN");
      if (!clean(input.assetId) || !Number.isInteger(input.expectedRevision) || input.expectedRevision < 1) throw failure("INVALID_AVATAR_ASSET_REVISION");
      return repository.disableEnterpriseAvatar({ organizationId: input.organizationId, assetId: input.assetId,
        expectedRevision: input.expectedRevision, actorMemberId: input.actorMemberId, now: timestamp() });
    },
    async authorizePreview(input = {}) {
      if (!clean(input.organizationId) || !clean(input.actorMemberId) || !["member", "admin"].includes(input.actorRole)) {
        throw failure("AVATAR_SELECTION_FORBIDDEN");
      }
      if (!clean(input.avatarId)) throw failure("AVATAR_PREVIEW_NOT_FOUND");
      if (typeof repository.authorizePreview !== "function" || typeof materialAssetPort?.authorizeAvatarPreview !== "function") {
        throw failure("AVATAR_PREVIEW_AUTHORIZATION_UNAVAILABLE");
      }
      let grant;
      try {
        grant = await repository.authorizePreview({ organizationId: input.organizationId, avatarId: input.avatarId,
          authorizeMaterial: ({ materialAssetVersionId, transactionClient }) => materialAssetPort.authorizeAvatarPreview({
            organizationId: input.organizationId, assetVersionId: materialAssetVersionId,
            actorMemberId: input.actorMemberId, transactionClient
          }) });
      } catch (error) {
        if (["AVATAR_PREVIEW_NOT_FOUND", "AVATAR_PREVIEW_UNAVAILABLE"].includes(error?.code)) throw error;
        if (["ASSET_VERSION_NOT_FOUND", "ASSET_NOT_FOUND", "ASSET_VERSION_NOT_AVAILABLE", "ASSET_NOT_ACTIVE"].includes(error?.code)) {
          throw failure("AVATAR_PREVIEW_UNAVAILABLE");
        }
        throw failure("AVATAR_PREVIEW_AUTHORIZATION_UNAVAILABLE");
      }
      const mediaType = grant?.verified_content_type;
      const size = grant?.verified_size;
      const checksum = grant?.verified_checksum_sha256;
      if (!PREVIEW_MEDIA_TYPES.has(mediaType)) throw failure("AVATAR_PREVIEW_UNAVAILABLE");
      if (!clean(grant?.token) || !clean(grant?.expires_at) || !Number.isFinite(Date.parse(grant.expires_at)) ||
          Date.parse(grant.expires_at) <= now() || !Number.isInteger(size) || size < 1 ||
          !/^[a-f0-9]{64}$/.test(checksum || "")) {
        throw failure("AVATAR_PREVIEW_AUTHORIZATION_UNAVAILABLE");
      }
      return { token: grant.token, expires_at: grant.expires_at, media_type: mediaType, size, checksum_sha256: checksum };
    },
    async getWorkspace(input) {
      validateContext(input);
      const at = timestamp();
      await repository.ensureControlledCatalog(input.organizationId, at);
      const approvedGate = await copyGate(input);
      const resolvedCopyVersionId = approvedGate.copy?.copy_version_id || clean(input.copyVersionId) || null;
      const effectiveInput = { ...input, copyVersionId: resolvedCopyVersionId };
      const entries = await Promise.all((await repository.listCatalog(input.organizationId)).map(refreshMaterialState));
      const context = await recommendationContext(effectiveInput, approvedGate);
      const projectedCatalog = projectRecommendedCatalog(entries, approvedGate, context);
      return { catalog_kind: "existing_only", provider_integration: false, recommendation: projectedCatalog.recommendation,
        controlled_seed_notice: "Phase 1 受控预置；不连接真实飞影，不代表推荐或真实生产能力。",
        resolved_copy_version_id: resolvedCopyVersionId,
        copy_gate: approvedGate, catalog: projectedCatalog.catalog,
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
      const entry = await refreshMaterialState(await repository.getCatalogVersion(input.organizationId, input.assetVersionId));
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
      const entry = await refreshMaterialState(await repository.getCatalogVersion(input.organizationId, selection.current_selection.asset_version_id));
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
