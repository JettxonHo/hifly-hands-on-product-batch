const clean = (value) => typeof value === "string" ? value.trim() : "";
const failure = (code, details = null) => Object.assign(new Error(code), { code, details });

const missingSnapshotCodes = new Set([
  "COPY_VERSION_NOT_FOUND",
  "COPY_REVIEW_CONTEXT_REQUIRED",
  "PRODUCT_REVISION_NOT_FOUND",
  "AVATAR_SELECTION_CONTEXT_REQUIRED",
  "AVATAR_ASSET_VERSION_NOT_FOUND",
  "ASSET_VERSION_NOT_FOUND"
]);

function requireValue(value, field) {
  if (value == null || (typeof value === "string" && !clean(value))) throw failure("PRODUCTION_ORDER_INPUT_SNAPSHOT_REQUIRED", [field]);
  return value;
}

function requireSame(actual, expected, field) {
  if (actual !== expected) throw failure("PRODUCTION_ORDER_INPUT_SNAPSHOT_REQUIRED", [field]);
}

function copyReviewSnapshot(review) {
  return {
    id: review.id,
    status: review.status,
    quality_result_id: review.quality_result_id || null,
    profile_version: review.profile_version || null,
    rule_version: review.rule_version || null,
    reviewer_member_id: review.reviewer_member_id || null,
    decision_reason: review.decision_reason || null,
    decided_at: review.decided_at || null,
    updated_at: review.updated_at || null
  };
}

function assetReference(version) {
  if (!version || typeof version !== "object") throw failure("PRODUCTION_ORDER_INPUT_SNAPSHOT_REQUIRED", ["asset_references.version"]);
  requireValue(version.asset_id, "asset_references.asset_id");
  requireValue(version.id, "asset_references.asset_version_id");
  requireValue(version.verified_content_type, "asset_references.media_type");
  requireValue(version.verified_checksum_sha256, "asset_references.checksum");
  if (!Number.isInteger(version.verified_size) || version.verified_size < 1) throw failure("PRODUCTION_ORDER_INPUT_SNAPSHOT_REQUIRED", ["asset_references.size"]);
  if (version.status !== "available") throw failure("PRODUCTION_ORDER_INPUT_SNAPSHOT_REQUIRED", ["asset_references.status"]);
  return {
    asset_id: version.asset_id,
    asset_version_id: version.id,
    role: "product_image",
    display_name: version.original_filename || version.id,
    media_type: version.verified_content_type,
    size: version.verified_size,
    checksum: version.verified_checksum_sha256,
    retrieval_mode: "embedded",
    access_scope: "organization"
  };
}

export function createProductionOrderInputSnapshotPort({ copyService, copyReviewService, productRevisionPort, avatarSelectionService, assetService } = {}) {
  if (!copyService?.getCopyVersion || !copyReviewService?.getReviewState || !productRevisionPort?.getSnapshot ||
    !avatarSelectionService?.getWorkspace || !assetService?.getAssetVersion) {
    throw new TypeError("A04-A07 snapshot ports are required");
  }

  return {
    async freezeForOrder(input) {
      const plan = input.resolved?.plan;
      const upstream = plan?.upstream_snapshot || {};
      requireSame(plan?.organization_id, input.organizationId, "plan.organization_id");
      requireSame(plan?.product_id, input.productId, "plan.product_id");
      const copyVersionId = requireValue(upstream.copy_version_id, "upstream_snapshot.copy_version_id");
      const productRevisionId = requireValue(upstream.product_revision_id, "upstream_snapshot.product_revision_id");
      const avatarSelectionId = requireValue(upstream.avatar_selection_id, "upstream_snapshot.avatar_selection_id");
      const avatarAssetVersionId = requireValue(upstream.avatar_asset_version_id, "upstream_snapshot.avatar_asset_version_id");

      try {
        const copy = await copyService.getCopyVersion({ ...input, copyVersionId });
        requireSame(copy.id, copyVersionId, "approved_copy_snapshot.copy_version_id");
        requireSame(copy.organization_id, input.organizationId, "approved_copy_snapshot.organization_id");
        requireSame(copy.product_id, input.productId, "approved_copy_snapshot.product_id");
        requireSame(copy.product_revision_id, productRevisionId, "approved_copy_snapshot.product_revision_id");
        requireSame(copy.status, "frozen", "approved_copy_snapshot.status");
        requireValue(copy.body, "approved_copy_snapshot.body");
        if (!Number.isInteger(copy.version_number) || copy.version_number < 1) throw failure("PRODUCTION_ORDER_INPUT_SNAPSHOT_REQUIRED", ["approved_copy_snapshot.version_number"]);

        const reviewState = await copyReviewService.getReviewState({ ...input, copyVersionId });
        const review = reviewState?.current_review;
        requireValue(review?.id, "approved_copy_snapshot.review.id");
        requireSame(review.status, "approved", "approved_copy_snapshot.review.status");
        requireSame(review.copy_version_id, copyVersionId, "approved_copy_snapshot.review.copy_version_id");
        if (review.product_revision_id) requireSame(review.product_revision_id, productRevisionId, "approved_copy_snapshot.review.product_revision_id");

        const productRevision = await productRevisionPort.getSnapshot({ organizationId: input.organizationId, productRevisionId });
        requireSame(productRevision.id, productRevisionId, "product_revision_snapshot.id");
        requireSame(productRevision.organization_id, input.organizationId, "product_revision_snapshot.organization_id");
        requireSame(productRevision.product_id, input.productId, "product_revision_snapshot.product_id");
        requireSame(productRevision.status, "ready", "product_revision_snapshot.status");
        if (!Array.isArray(productRevision.asset_version_ids) || productRevision.asset_version_ids.length === 0) {
          throw failure("PRODUCTION_ORDER_INPUT_SNAPSHOT_REQUIRED", ["product_revision_snapshot.asset_version_ids"]);
        }
        const assetReferences = await Promise.all(productRevision.asset_version_ids.map(async (assetVersionId) => {
          const version = await assetService.getAssetVersion({ organizationId: input.organizationId, assetVersionId });
          return assetReference(version);
        }));

        const avatarWorkspace = await avatarSelectionService.getWorkspace({ ...input, productId: input.productId, copyVersionId });
        const selection = avatarWorkspace?.selection?.current_selection;
        requireValue(selection?.id, "avatar_selection_snapshot.avatar_selection_id");
        requireSame(selection.id, avatarSelectionId, "avatar_selection_snapshot.avatar_selection_id");
        requireSame(selection.copy_version_id, copyVersionId, "avatar_selection_snapshot.copy_version_id");
        requireSame(selection.asset_version_id, avatarAssetVersionId, "avatar_selection_snapshot.asset_version_id");
        if (avatarWorkspace.selection.current_valid !== true || selection.status !== "confirmed") {
          throw failure("PRODUCTION_ORDER_INPUT_SNAPSHOT_REQUIRED", ["avatar_selection_snapshot.current_valid"]);
        }
        const avatar = avatarWorkspace.catalog.find((entry) => entry.asset_version?.id === avatarAssetVersionId);
        requireValue(avatar?.id, "avatar_selection_snapshot.avatar_asset_id");
        requireValue(avatar.display_name, "avatar_selection_snapshot.display_name");
        requireValue(avatar.source_type, "avatar_selection_snapshot.source_type");
        requireValue(avatar.authorization_status, "avatar_selection_snapshot.authorization_status");
        requireValue(avatar.capability_status, "avatar_selection_snapshot.capability_status");
        if (!Array.isArray(avatar.verified_capabilities) || avatar.verified_capabilities.length === 0) {
          throw failure("PRODUCTION_ORDER_INPUT_SNAPSHOT_REQUIRED", ["avatar_selection_snapshot.capabilities"]);
        }

        return {
          approved_copy_snapshot: {
            copy_version_id: copy.id,
            product_revision_id: copy.product_revision_id,
            version_number: copy.version_number,
            status: copy.status,
            intent: copy.intent,
            body: copy.body,
            frozen_at: copy.frozen_at || null,
            review: copyReviewSnapshot(review)
          },
          product_revision_snapshot: structuredClone(productRevision),
          asset_references: assetReferences,
          avatar_selection_snapshot: {
            avatar_selection_id: selection.id,
            copy_version_id: selection.copy_version_id,
            asset_version_id: selection.asset_version_id,
            status: selection.status,
            version_number: selection.version_number,
            confirmed_at: selection.confirmed_at || null,
            avatar_asset_id: avatar.id,
            display_name: avatar.display_name,
            source_type: avatar.source_type,
            authorization_status: avatar.authorization_status,
            authorization_expires_at: avatar.authorization_expires_at || null,
            authorization_scope: avatar.authorization_scope || "current_organization",
            capability_status: avatar.capability_status,
            materials_accessible: avatar.materials_accessible !== false,
            capabilities: avatar.verified_capabilities.map(({ code, label, evidence_reference }) => ({ code, label: label || null, evidence_reference }))
          }
        };
      } catch (error) {
        if (missingSnapshotCodes.has(error?.code)) throw failure("PRODUCTION_ORDER_INPUT_SNAPSHOT_REQUIRED");
        throw error;
      }
    }
  };
}
