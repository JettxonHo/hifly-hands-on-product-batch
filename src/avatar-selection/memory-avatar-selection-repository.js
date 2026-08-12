import { randomUUID } from "node:crypto";

const clone = (value) => value == null ? value : structuredClone(value);
const failure = (code) => Object.assign(new Error(code), { code });
export const PUBLIC_CATALOG_SEED_LABEL = "飞影公共目录（能力待核验）";
export const PUBLIC_CATALOG_DESCRIPTION = "飞影公共目录同步条目；官方列表未提供预览或手里有货能力证据。";

export const CONTROLLED_AVATARS = [
  { key: "public-linxiaoman", source_type: "public", display_name: "林小满", description: "知性自然的中文口播人物形象。",
    authorization_status: "valid", authorization_expires_at: "2027-12-31T15:59:59.000Z", capability_status: "verified",
    capabilities: [{ code: "zh_cn_script", label: "中文口播", evidence_reference: "controlled-seed:zh-cn-script:v1" },
      { code: "aspect_9_16", label: "9:16 竖版", evidence_reference: "controlled-seed:aspect-9-16:v1" }] },
  { key: "public-zhouyan", source_type: "public", display_name: "周言", description: "沉稳清晰的产品讲解人物形象。",
    authorization_status: "expiring", authorization_expires_at: "2026-09-30T15:59:59.000Z", capability_status: "verified",
    capabilities: [{ code: "zh_cn_script", label: "中文口播", evidence_reference: "controlled-seed:zh-cn-script:v1" }] },
  { key: "enterprise-qinghe", source_type: "enterprise", display_name: "青禾企业主播", description: "当前企业受控使用的品牌主播形象。",
    authorization_status: "valid", authorization_expires_at: "2027-06-30T15:59:59.000Z", capability_status: "verified",
    capabilities: [{ code: "zh_cn_script", label: "中文口播", evidence_reference: "controlled-seed:enterprise-zh-cn:v1" }] },
  { key: "public-unknown", source_type: "public", display_name: "能力待核验人物", description: "人物存在，但生产能力尚无 Evidence。",
    authorization_status: "valid", authorization_expires_at: "2027-12-31T15:59:59.000Z", capability_status: "unverified", capabilities: [] },
  { key: "enterprise-expired", source_type: "enterprise", display_name: "历史授权人物", description: "授权已过期，仅保留用于历史查看。",
    authorization_status: "expired", authorization_expires_at: "2026-07-31T15:59:59.000Z", capability_status: "verified",
    capabilities: [{ code: "zh_cn_script", label: "中文口播", evidence_reference: "controlled-seed:historical:v1" }] },
  { key: "enterprise-incomplete", source_type: "enterprise", display_name: "授权待补全人物", description: "企业授权信息尚未补全。",
    authorization_status: "incomplete", authorization_expires_at: null, capability_status: "verified",
    capabilities: [{ code: "zh_cn_script", label: "中文口播", evidence_reference: "controlled-seed:pending-auth:v1" }] }
];

export function createMemoryAvatarSelectionRepository() {
  const assets = new Map(), versions = new Map(), capabilities = new Map();
  const selections = new Map(), heads = new Map(), productHeads = new Map(), receipts = new Map();
  const events = [], audits = [], seededOrganizations = new Set();

  function receipt(receiptKey, fingerprint) {
    const value = receipts.get(receiptKey);
    if (!value) return null;
    if (value.fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
    return clone(value.result);
  }

  function selectionState(organizationId, productId) {
    const aggregate = productHeads.get(`${organizationId}:${productId}`) || { row_version: 0, current_selection_id: null };
    const history = [...selections.values()].filter((value) => value.organization_id === organizationId && value.product_id === productId)
      .sort((left, right) => left.version_number - right.version_number)
      .map((value) => ({ ...clone(value), ...clone(heads.get(value.id)) }));
    return { current_selection: aggregate.current_selection_id ? history.find((value) => value.id === aggregate.current_selection_id) : null,
      selection_revision: aggregate.row_version, history };
  }

  return {
    async initialize() {},
    async close() {},
    async ensureControlledCatalog(organizationId, now) {
      if (seededOrganizations.has(organizationId)) return;
      for (const item of CONTROLLED_AVATARS) {
        const assetId = randomUUID(), versionId = randomUUID();
        assets.set(assetId, { id: assetId, organization_id: organizationId, source_type: item.source_type,
          display_name: item.display_name, description: item.description, status: "active", controlled_seed: true,
          seed_key: item.key, seed_label: "Phase 1 受控预置", created_at: now, updated_at: now });
        versions.set(versionId, { id: versionId, asset_id: assetId, organization_id: organizationId,
          version_number: 1, status: "available", authorization_status: item.authorization_status,
          authorization_expires_at: item.authorization_expires_at, authorization_scope: "current_organization",
          capability_status: item.capability_status, materials_accessible: true, preview_kind: "controlled_placeholder",
          created_at: now, updated_at: now });
        capabilities.set(versionId, item.capabilities.map((value) => ({ ...value, verification_status: "verified" })));
      }
      seededOrganizations.add(organizationId);
    },
    async syncPublicCatalog({ organizationId, entries = [], now } = {}) {
      const unique = new Map();
      for (const entry of entries) {
        if (!entry || entry.source_type !== "public" || typeof entry.provider_key !== "string" ||
          !entry.provider_key.startsWith("hifly-public:") || typeof entry.display_name !== "string" || !entry.display_name.trim()) {
          throw failure("HIFLY_PUBLIC_AVATAR_CATALOG_INVALID");
        }
        unique.set(entry.provider_key, { provider_key: entry.provider_key, display_name: entry.display_name.trim() });
      }
      let created = 0, updated = 0, unchanged = 0;
      for (const entry of unique.values()) {
        const existing = [...assets.values()].find((asset) => asset.organization_id === organizationId && asset.seed_key === entry.provider_key);
        if (existing) {
          if (existing.source_type !== "public" || existing.controlled_seed !== false) throw failure("AVATAR_CATALOG_KEY_CONFLICT");
          const changed = existing.display_name !== entry.display_name || existing.description !== PUBLIC_CATALOG_DESCRIPTION ||
            existing.seed_label !== PUBLIC_CATALOG_SEED_LABEL;
          if (!changed) { unchanged += 1; continue; }
          assets.set(existing.id, { ...existing, display_name: entry.display_name, description: PUBLIC_CATALOG_DESCRIPTION,
            seed_label: PUBLIC_CATALOG_SEED_LABEL, updated_at: now });
          updated += 1;
          continue;
        }
        const assetId = randomUUID(), versionId = randomUUID();
        assets.set(assetId, { id: assetId, organization_id: organizationId, source_type: "public",
          display_name: entry.display_name, description: PUBLIC_CATALOG_DESCRIPTION, status: "active", controlled_seed: false,
          seed_key: entry.provider_key, seed_label: PUBLIC_CATALOG_SEED_LABEL, created_at: now, updated_at: now });
        versions.set(versionId, { id: versionId, asset_id: assetId, organization_id: organizationId, version_number: 1,
          status: "available", authorization_status: "incomplete", authorization_expires_at: null,
          authorization_scope: "current_organization", capability_status: "unverified", materials_accessible: false,
          preview_kind: "none", created_at: now, updated_at: now });
        capabilities.set(versionId, []);
        created += 1;
      }
      return { total: unique.size, created, updated, unchanged };
    },
    async listCatalog(organizationId) {
      return [...assets.values()].filter((asset) => asset.organization_id === organizationId && asset.status !== "deleted")
        .map((asset) => {
          const version = [...versions.values()].find((value) => value.asset_id === asset.id);
          return { asset: clone(asset), asset_version: clone(version), capabilities: clone(capabilities.get(version.id) || []) };
        }).sort((left, right) => left.asset.display_name.localeCompare(right.asset.display_name, "zh-CN"));
    },
    async getCatalogVersion(organizationId, assetVersionId) {
      const version = versions.get(assetVersionId);
      if (!version || version.organization_id !== organizationId) return null;
      return { asset: clone(assets.get(version.asset_id)), asset_version: clone(version),
        capabilities: clone(capabilities.get(version.id) || []) };
    },
    async getReceipt(receiptKey, fingerprint) { return receipt(receiptKey, fingerprint); },
    async updateReceiptResult(receiptKey, result) {
      const current = receipts.get(receiptKey);
      if (!current) throw failure("AVATAR_SELECTION_RECEIPT_NOT_FOUND");
      current.result = clone(result);
    },
    async confirmSelection({ organizationId, productId, copyVersionId, assetVersionId, actorMemberId,
      expectedRevision, receiptKey, fingerprint, now }) {
      const replay = receipt(receiptKey, fingerprint);
      if (replay) return replay;
      const aggregate = productHeads.get(`${organizationId}:${productId}`) || { row_version: 0, current_selection_id: null };
      if (aggregate.row_version !== expectedRevision) throw failure("AVATAR_SELECTION_CONFLICT");
      const current = aggregate.current_selection_id ? { ...selections.get(aggregate.current_selection_id), ...heads.get(aggregate.current_selection_id) } : null;
      if (current?.asset_version_id === assetVersionId && current.copy_version_id === copyVersionId && current.status === "confirmed") {
        const state = selectionState(organizationId, productId);
        const result = { ...state, current_valid: true, invalidation_reasons: [] };
        receipts.set(receiptKey, { fingerprint, result: clone(result) });
        return result;
      }
      const selectionId = randomUUID();
      const selection = { id: selectionId, organization_id: organizationId, product_id: productId,
        copy_version_id: copyVersionId, asset_version_id: assetVersionId, version_number: aggregate.row_version + 1,
        created_by_member_id: actorMemberId, created_at: now };
      selections.set(selectionId, selection);
      heads.set(selectionId, { status: "draft", row_version: 1, confirmed_at: null, superseded_at: null,
        superseded_by_selection_id: null, updated_at: now });
      events.push({ id: randomUUID(), organization_id: organizationId, product_id: productId,
        avatar_selection_id: selectionId, actor_member_id: actorMemberId, from_status: null, to_status: "draft", created_at: now });
      if (current) {
        heads.set(current.id, { ...heads.get(current.id), status: "superseded", row_version: current.row_version + 1,
          superseded_at: now, superseded_by_selection_id: selectionId, updated_at: now });
        events.push({ id: randomUUID(), organization_id: organizationId, product_id: productId,
          avatar_selection_id: current.id, actor_member_id: actorMemberId, from_status: "confirmed", to_status: "superseded", created_at: now });
      }
      heads.set(selectionId, { ...heads.get(selectionId), status: "confirmed", row_version: 2, confirmed_at: now, updated_at: now });
      events.push({ id: randomUUID(), organization_id: organizationId, product_id: productId,
        avatar_selection_id: selectionId, actor_member_id: actorMemberId, from_status: "draft", to_status: "confirmed", created_at: now });
      const nextRevision = aggregate.row_version + 1;
      productHeads.set(`${organizationId}:${productId}`, { current_selection_id: selectionId, row_version: nextRevision });
      audits.push({ id: randomUUID(), organization_id: organizationId, actor_member_id: actorMemberId,
        event_type: current ? "avatar.selection_changed" : "avatar.selection_confirmed", product_id: productId,
        avatar_selection_id: selectionId, metadata: { previous_selection_id: current?.id || null }, created_at: now });
      const state = selectionState(organizationId, productId);
      const result = { ...state, current_valid: true, invalidation_reasons: [] };
      receipts.set(receiptKey, { fingerprint, result: clone(result) });
      return result;
    },
    async getSelectionState(organizationId, productId) { return selectionState(organizationId, productId); },
    async listEvents(organizationId, productId) {
      return clone(events.filter((value) => value.organization_id === organizationId && value.product_id === productId));
    },
    async listAuditEvents() { return clone(audits); }
  };
}
