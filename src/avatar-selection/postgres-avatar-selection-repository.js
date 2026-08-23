import { randomUUID } from "node:crypto";

import { withTransaction } from "../identity/postgres.js";
import { CONTROLLED_AVATARS, PUBLIC_CATALOG_DESCRIPTION, PUBLIC_CATALOG_SEED_LABEL } from "./memory-avatar-selection-repository.js";
import { assertAvatarSelectionSchemaCurrent } from "./postgres.js";

const failure = (code) => Object.assign(new Error(code), { code });
const iso = (value) => value instanceof Date ? value.toISOString() : value;
const normalizeSelection = (row) => row ? { ...row, version_number: Number(row.version_number), row_version: Number(row.row_version),
  created_at: iso(row.created_at), updated_at: iso(row.updated_at), confirmed_at: iso(row.confirmed_at), superseded_at: iso(row.superseded_at) } : null;
const normalizeVersion = (row) => ({ ...row, version_number: Number(row.version_number), authorization_expires_at: iso(row.authorization_expires_at),
  created_at: iso(row.created_at), updated_at: iso(row.updated_at) });
const normalizeAsset = (row) => ({ ...row, category_tags: Array.isArray(row.category_tags) ? row.category_tags : [],
  revision_number: Number(row.row_version ?? row.revision_number ?? 1), created_at: iso(row.created_at), updated_at: iso(row.updated_at) });

async function lockAvatarMaterialBoundary(client, organizationId) {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`avatar-material-boundary:${organizationId}`]);
}

async function replay(client, receiptKey, fingerprint) {
  const row = (await client.query("SELECT * FROM avatar_selection_idempotency_receipts WHERE receipt_key=$1", [receiptKey])).rows[0];
  if (!row) return null;
  if (row.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
  return row.result;
}

export function createPostgresAvatarSelectionRepository({ pool, ownsPool = false } = {}) {
  if (!pool?.connect) throw new TypeError("pool is required");
  const selectionSql = `SELECT s.*,st.status,st.row_version,st.confirmed_at,st.superseded_at,st.superseded_by_selection_id,st.updated_at
    FROM avatar_selections s JOIN avatar_selection_states st ON st.avatar_selection_id=s.id`;
  async function catalogEntry(client, organizationId, assetVersionId) {
    const row = (await client.query(`SELECT a.*,v.id version_id,v.version_number,v.status version_status,v.authorization_status,v.authorization_expires_at,
        v.authorization_scope,v.capability_status,v.materials_accessible stored_materials_accessible,v.preview_kind,
        v.material_asset_version_id,m.status material_status,ma.status material_asset_status,ma.kind material_asset_kind,
        v.created_at version_created_at,v.updated_at version_updated_at
        FROM avatar_assets a JOIN avatar_asset_versions v ON v.asset_id=a.id AND v.organization_id=a.organization_id
        LEFT JOIN asset_versions m ON m.id=v.material_asset_version_id AND m.organization_id=v.organization_id
        LEFT JOIN asset_assets ma ON ma.id=m.asset_id AND ma.organization_id=m.organization_id
        WHERE a.organization_id=$1 AND v.id=$2`, [organizationId, assetVersionId])).rows[0];
    if (!row) return null;
    const materialsAccessible = row.material_asset_version_id
      ? row.material_status === "available" && row.material_asset_status === "active" && row.material_asset_kind === "avatar_image"
      : row.stored_materials_accessible === true;
    const capabilities = (await client.query(`SELECT capability_code code,capability_label label,verification_status,evidence_reference
      FROM avatar_verified_capabilities WHERE organization_id=$1 AND asset_version_id=$2 ORDER BY capability_code`, [organizationId, row.version_id])).rows;
    return {
      asset: normalizeAsset(row),
      asset_version: normalizeVersion({ id: row.version_id, asset_id: row.id, organization_id: row.organization_id,
        version_number: row.version_number, status: row.version_status, authorization_status: row.authorization_status,
        authorization_expires_at: row.authorization_expires_at, authorization_scope: row.authorization_scope,
        capability_status: row.capability_status, materials_accessible: materialsAccessible, material_status: row.material_asset_version_id ? (materialsAccessible ? "available" : "unavailable") : (row.material_status || null),
        material_asset_version_id: row.material_asset_version_id, preview_kind: row.preview_kind,
        created_at: row.version_created_at, updated_at: row.version_updated_at }),
      capabilities
    };
  }
  return {
    async initialize() { await assertAvatarSelectionSchemaCurrent(pool); },
    async close() { if (ownsPool) await pool.end(); },
    async ensureControlledCatalog(organizationId, now) {
      await withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`avatar-catalog:${organizationId}`]);
        for (const item of CONTROLLED_AVATARS) {
          if ((await client.query("SELECT 1 FROM avatar_assets WHERE organization_id=$1 AND seed_key=$2", [organizationId,item.key])).rowCount) continue;
          const assetId = randomUUID(), versionId = randomUUID();
          await client.query(`INSERT INTO avatar_assets(id,organization_id,source_type,display_name,description,status,controlled_seed,seed_key,seed_label,created_at,updated_at)
            VALUES ($1,$2,$3,$4,$5,'active',true,$6,'Phase 1 受控预置',$7,$7)`, [assetId,organizationId,item.source_type,item.display_name,item.description,item.key,now]);
          await client.query(`INSERT INTO avatar_asset_versions(id,asset_id,organization_id,version_number,status,authorization_status,authorization_expires_at,authorization_scope,capability_status,materials_accessible,preview_kind,created_at,updated_at)
            VALUES ($1,$2,$3,1,'available',$4,$5,'current_organization',$6,true,'controlled_placeholder',$7,$7)`,
          [versionId,assetId,organizationId,item.authorization_status,item.authorization_expires_at,item.capability_status,now]);
          for (const capability of item.capabilities) await client.query(`INSERT INTO avatar_verified_capabilities(id,organization_id,asset_version_id,capability_code,capability_label,verification_status,evidence_reference,created_at)
            VALUES ($1,$2,$3,$4,$5,'verified',$6,$7)`, [randomUUID(),organizationId,versionId,capability.code,capability.label,capability.evidence_reference,now]);
        }
      });
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
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`avatar-public-sync:${organizationId}`]);
        let created = 0, updated = 0, unchanged = 0;
        for (const entry of unique.values()) {
          const existing = (await client.query(
            "SELECT * FROM avatar_assets WHERE organization_id=$1 AND seed_key=$2 FOR UPDATE",
            [organizationId, entry.provider_key]
          )).rows[0];
          if (existing) {
            if (existing.source_type !== "public" || existing.controlled_seed !== false) throw failure("AVATAR_CATALOG_KEY_CONFLICT");
            const changed = existing.display_name !== entry.display_name || existing.description !== PUBLIC_CATALOG_DESCRIPTION ||
              existing.seed_label !== PUBLIC_CATALOG_SEED_LABEL;
            if (!changed) { unchanged += 1; continue; }
            await client.query(`UPDATE avatar_assets SET display_name=$3,description=$4,seed_label=$5,updated_at=$6
              WHERE organization_id=$1 AND id=$2`, [organizationId, existing.id, entry.display_name, PUBLIC_CATALOG_DESCRIPTION, PUBLIC_CATALOG_SEED_LABEL, now]);
            updated += 1;
            continue;
          }
          const assetId = randomUUID(), versionId = randomUUID();
          await client.query(`INSERT INTO avatar_assets(id,organization_id,source_type,display_name,description,status,controlled_seed,seed_key,seed_label,created_at,updated_at)
            VALUES ($1,$2,'public',$3,$4,'active',false,$5,$6,$7,$7)`,
          [assetId, organizationId, entry.display_name, PUBLIC_CATALOG_DESCRIPTION, entry.provider_key, PUBLIC_CATALOG_SEED_LABEL, now]);
          await client.query(`INSERT INTO avatar_asset_versions(id,asset_id,organization_id,version_number,status,authorization_status,authorization_scope,capability_status,materials_accessible,preview_kind,created_at,updated_at)
            VALUES ($1,$2,$3,1,'available','incomplete','current_organization','unverified',false,'none',$4,$4)`,
          [versionId, assetId, organizationId, now]);
          created += 1;
        }
        return { total: unique.size, created, updated, unchanged };
      });
    },
    async listCatalog(organizationId) {
      const rows = (await pool.query(`SELECT a.*,v.id version_id,v.version_number,v.status version_status,v.authorization_status,v.authorization_expires_at,
        v.authorization_scope,v.capability_status,v.materials_accessible stored_materials_accessible,v.preview_kind,v.material_asset_version_id,
        m.status material_status,ma.status material_asset_status,ma.kind material_asset_kind,
        v.created_at version_created_at,v.updated_at version_updated_at
        FROM avatar_assets a JOIN avatar_asset_versions v ON v.asset_id=a.id AND v.organization_id=a.organization_id
        LEFT JOIN asset_versions m ON m.id=v.material_asset_version_id AND m.organization_id=v.organization_id
        LEFT JOIN asset_assets ma ON ma.id=m.asset_id AND ma.organization_id=m.organization_id
        WHERE a.organization_id=$1 AND a.status<>'deleted' ORDER BY a.display_name,a.id`, [organizationId])).rows;
      return Promise.all(rows.map(async (row) => {
        const materialsAccessible = row.material_asset_version_id
          ? row.material_status === "available" && row.material_asset_status === "active" && row.material_asset_kind === "avatar_image"
          : row.stored_materials_accessible === true;
        return {
          asset: normalizeAsset(row),
          asset_version: normalizeVersion({ id: row.version_id, asset_id: row.id, organization_id: row.organization_id,
            version_number: row.version_number, status: row.version_status, authorization_status: row.authorization_status,
            authorization_expires_at: row.authorization_expires_at, authorization_scope: row.authorization_scope,
            capability_status: row.capability_status, materials_accessible: materialsAccessible, material_status: row.material_asset_version_id ? (materialsAccessible ? "available" : "unavailable") : (row.material_status || null),
            material_asset_version_id: row.material_asset_version_id, preview_kind: row.preview_kind,
            created_at: row.version_created_at, updated_at: row.version_updated_at }),
          capabilities: (await pool.query(`SELECT capability_code code,capability_label label,verification_status,evidence_reference
            FROM avatar_verified_capabilities WHERE organization_id=$1 AND asset_version_id=$2 ORDER BY capability_code`, [organizationId,row.version_id])).rows
        };
      }));
    },
    async getCatalogAsset(organizationId, avatarAssetId) {
      const client = await pool.connect();
      try {
        const row = (await client.query(`SELECT v.id version_id
          FROM avatar_assets a JOIN avatar_asset_versions v ON v.asset_id=a.id AND v.organization_id=a.organization_id
          WHERE a.organization_id=$1 AND a.id=$2 AND a.status<>'deleted'
          ORDER BY v.version_number DESC LIMIT 1`, [organizationId, avatarAssetId])).rows[0];
        return row ? catalogEntry(client, organizationId, row.version_id) : null;
      } finally { client.release(); }
    },
    async authorizePreview({ organizationId, avatarId, authorizeMaterial }) {
      if (typeof authorizeMaterial !== "function") throw failure("AVATAR_PREVIEW_AUTHORIZATION_UNAVAILABLE");
      return withTransaction(pool, async (client) => {
        await lockAvatarMaterialBoundary(client, organizationId);
        const row = (await client.query(`SELECT a.status asset_status,v.status version_status,v.material_asset_version_id
          FROM avatar_assets a JOIN avatar_asset_versions v ON v.asset_id=a.id AND v.organization_id=a.organization_id
          WHERE a.organization_id=$1 AND a.id=$2
          ORDER BY v.version_number DESC LIMIT 1 FOR UPDATE OF a,v`, [organizationId, avatarId])).rows[0];
        if (!row || row.asset_status !== "active") throw failure("AVATAR_PREVIEW_NOT_FOUND");
        if (row.version_status !== "available" || !row.material_asset_version_id) throw failure("AVATAR_PREVIEW_UNAVAILABLE");
        return authorizeMaterial({ materialAssetVersionId: row.material_asset_version_id, transactionClient: client });
      });
    },
    async getCatalogVersion(organizationId, assetVersionId) {
      const catalog = await this.listCatalog(organizationId);
      return catalog.find((entry) => entry.asset_version.id === assetVersionId) || null;
    },
    async registerEnterpriseAvatar({ organizationId, actorMemberId = null, materialAssetVersionId, displayName, description,
      authorizationStatus, authorizationExpiresAt = null, categoryTags = [], capabilities: verified = [], now }) {
      return withTransaction(pool, async (client) => {
        await lockAvatarMaterialBoundary(client, organizationId);
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`avatar-enterprise-material:${organizationId}:${materialAssetVersionId}`]);
        const material = (await client.query(`SELECT av.id version_id,av.status version_status,aa.id asset_id,aa.kind,aa.status asset_status
          FROM asset_versions av JOIN asset_assets aa ON aa.id=av.asset_id AND aa.organization_id=av.organization_id
          WHERE av.id=$1 AND av.organization_id=$2 FOR UPDATE`, [materialAssetVersionId, organizationId])).rows[0];
        if (!material) throw failure("AVATAR_MATERIAL_VERSION_NOT_FOUND");
        if (material.kind !== "avatar_image") throw failure("AVATAR_MATERIAL_KIND_INVALID");
        if (material.asset_status !== "active" || material.version_status !== "available") throw failure("AVATAR_MATERIAL_NOT_AVAILABLE");
        const existing = (await client.query("SELECT id FROM avatar_asset_versions WHERE organization_id=$1 AND material_asset_version_id=$2 FOR UPDATE", [organizationId, materialAssetVersionId])).rows[0];
        if (existing) return { ...(await catalogEntry(client, organizationId, existing.id)), replayed: true };
        const assetId = randomUUID(), versionId = randomUUID();
        await client.query(`INSERT INTO avatar_assets(id,organization_id,source_type,display_name,description,status,controlled_seed,seed_key,seed_label,category_tags,row_version,created_at,updated_at)
          VALUES ($1,$2,'enterprise',$3,$4,'active',false,$5,'企业上传',$6,1,$7,$7)`,
        [assetId, organizationId, displayName, description, `enterprise:${randomUUID()}`, JSON.stringify(categoryTags), now]);
        await client.query(`INSERT INTO avatar_asset_versions(id,asset_id,organization_id,version_number,status,authorization_status,authorization_expires_at,authorization_scope,capability_status,materials_accessible,material_asset_version_id,preview_kind,created_at,updated_at)
          VALUES ($1,$2,$3,1,'available',$4,$5,'current_organization',$6,true,$7,'uploaded',$8,$8)`,
        [versionId, assetId, organizationId, authorizationStatus, authorizationExpiresAt, verified.length ? "verified" : "unverified", materialAssetVersionId, now]);
        for (const capability of verified) await client.query(`INSERT INTO avatar_verified_capabilities(id,organization_id,asset_version_id,capability_code,capability_label,verification_status,evidence_reference,created_at)
          VALUES ($1,$2,$3,$4,$5,'verified',$6,$7)`, [randomUUID(), organizationId, versionId, capability.code, capability.label, capability.evidence_reference, now]);
        return { ...(await catalogEntry(client, organizationId, versionId)), replayed: false };
      });
    },
    async disableEnterpriseAvatar({ organizationId, assetId, expectedRevision, actorMemberId = null, now }) {
      return withTransaction(pool, async (client) => {
        const asset = (await client.query("SELECT * FROM avatar_assets WHERE id=$1 AND organization_id=$2 FOR UPDATE", [assetId, organizationId])).rows[0];
        if (!asset) throw failure("AVATAR_ASSET_NOT_FOUND");
        if (asset.source_type !== "enterprise" || asset.controlled_seed) throw failure("AVATAR_ASSET_DISABLE_FORBIDDEN");
        if (Number(asset.row_version) !== expectedRevision) throw failure("AVATAR_ASSET_VERSION_CONFLICT");
        if (asset.status !== "active") throw failure("AVATAR_ASSET_NOT_ACTIVE");
        const updated = (await client.query("UPDATE avatar_assets SET status='disabled',row_version=row_version+1,updated_at=$3 WHERE id=$1 AND organization_id=$2 RETURNING *", [assetId, organizationId, now])).rows[0];
        const version = (await client.query("SELECT id FROM avatar_asset_versions WHERE asset_id=$1 AND organization_id=$2 ORDER BY version_number DESC LIMIT 1", [assetId, organizationId])).rows[0];
        return catalogEntry(client, organizationId, version.id);
      });
    },
    async getReceipt(receiptKey, fingerprint) {
      const client = await pool.connect();
      try { return await replay(client, receiptKey, fingerprint); } finally { client.release(); }
    },
    async updateReceiptResult(receiptKey, result) {
      const updated = await pool.query("UPDATE avatar_selection_idempotency_receipts SET result=$2 WHERE receipt_key=$1", [receiptKey,JSON.stringify(result)]);
      if (!updated.rowCount) throw failure("AVATAR_SELECTION_RECEIPT_NOT_FOUND");
    },
    async confirmSelection({ organizationId, productId, copyVersionId, assetVersionId, actorMemberId,
      expectedRevision, receiptKey, fingerprint, now }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`avatar-receipt:${receiptKey}`]);
        const prior = await replay(client, receiptKey, fingerprint);
        if (prior) return prior;
        await client.query(`INSERT INTO avatar_product_selection_heads(organization_id,product_id,current_selection_id,row_version,updated_at)
          VALUES ($1,$2,NULL,0,$3) ON CONFLICT (organization_id,product_id) DO NOTHING`, [organizationId,productId,now]);
        const aggregate = (await client.query("SELECT * FROM avatar_product_selection_heads WHERE organization_id=$1 AND product_id=$2 FOR UPDATE", [organizationId,productId])).rows[0];
        if (Number(aggregate.row_version) !== expectedRevision) throw failure("AVATAR_SELECTION_CONFLICT");
        const current = aggregate.current_selection_id ? normalizeSelection((await client.query(`${selectionSql} WHERE s.organization_id=$1 AND s.id=$2`, [organizationId,aggregate.current_selection_id])).rows[0]) : null;
        if (current?.asset_version_id === assetVersionId && current.copy_version_id === copyVersionId && current.status === "confirmed") {
          const history = (await client.query(`${selectionSql} WHERE s.organization_id=$1 AND s.product_id=$2 ORDER BY s.version_number`, [organizationId,productId])).rows.map(normalizeSelection);
          const result = { current_selection: current, selection_revision: Number(aggregate.row_version), history,
            current_valid: true, invalidation_reasons: [] };
          await client.query("INSERT INTO avatar_selection_idempotency_receipts(receipt_key,payload_fingerprint,result,created_at) VALUES ($1,$2,$3,$4)", [receiptKey,fingerprint,JSON.stringify(result),now]);
          return result;
        }
        const selectionId = randomUUID(), versionNumber = Number(aggregate.row_version) + 1;
        await client.query(`INSERT INTO avatar_selections(id,organization_id,product_id,copy_version_id,asset_version_id,version_number,created_by_member_id,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [selectionId,organizationId,productId,copyVersionId,assetVersionId,versionNumber,actorMemberId,now]);
        await client.query(`INSERT INTO avatar_selection_states(avatar_selection_id,organization_id,product_id,status,row_version,updated_at)
          VALUES ($1,$2,$3,'draft',1,$4)`, [selectionId,organizationId,productId,now]);
        await client.query(`INSERT INTO avatar_selection_events(id,organization_id,product_id,avatar_selection_id,actor_member_id,from_status,to_status,created_at)
          VALUES ($1,$2,$3,$4,$5,NULL,'draft',$6)`, [randomUUID(),organizationId,productId,selectionId,actorMemberId,now]);
        if (current) {
          await client.query(`UPDATE avatar_selection_states SET status='superseded',row_version=row_version+1,superseded_at=$3,
            superseded_by_selection_id=$4,updated_at=$3 WHERE organization_id=$1 AND avatar_selection_id=$2`, [organizationId,current.id,now,selectionId]);
          await client.query(`INSERT INTO avatar_selection_events(id,organization_id,product_id,avatar_selection_id,actor_member_id,from_status,to_status,created_at)
            VALUES ($1,$2,$3,$4,$5,'confirmed','superseded',$6)`, [randomUUID(),organizationId,productId,current.id,actorMemberId,now]);
        }
        await client.query(`UPDATE avatar_selection_states SET status='confirmed',row_version=2,confirmed_at=$3,updated_at=$3
          WHERE organization_id=$1 AND avatar_selection_id=$2`, [organizationId,selectionId,now]);
        await client.query(`INSERT INTO avatar_selection_events(id,organization_id,product_id,avatar_selection_id,actor_member_id,from_status,to_status,created_at)
          VALUES ($1,$2,$3,$4,$5,'draft','confirmed',$6)`, [randomUUID(),organizationId,productId,selectionId,actorMemberId,now]);
        await client.query(`UPDATE avatar_product_selection_heads SET current_selection_id=$3,row_version=$4,updated_at=$5
          WHERE organization_id=$1 AND product_id=$2`, [organizationId,productId,selectionId,versionNumber,now]);
        await client.query(`INSERT INTO avatar_selection_audit_events(id,organization_id,actor_member_id,event_type,product_id,avatar_selection_id,metadata,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [randomUUID(),organizationId,actorMemberId,current ? "avatar.selection_changed" : "avatar.selection_confirmed",
          productId,selectionId,JSON.stringify({ previous_selection_id: current?.id || null }),now]);
        const selected = normalizeSelection((await client.query(`${selectionSql} WHERE s.organization_id=$1 AND s.id=$2`, [organizationId,selectionId])).rows[0]);
        const history = (await client.query(`${selectionSql} WHERE s.organization_id=$1 AND s.product_id=$2 ORDER BY s.version_number`, [organizationId,productId])).rows.map(normalizeSelection);
        const result = { current_selection: selected, selection_revision: versionNumber, history,
          current_valid: true, invalidation_reasons: [] };
        await client.query("INSERT INTO avatar_selection_idempotency_receipts(receipt_key,payload_fingerprint,result,created_at) VALUES ($1,$2,$3,$4)", [receiptKey,fingerprint,JSON.stringify(result),now]);
        return result;
      });
    },
    async getSelectionState(organizationId, productId) {
      const aggregate = (await pool.query("SELECT * FROM avatar_product_selection_heads WHERE organization_id=$1 AND product_id=$2", [organizationId,productId])).rows[0];
      const history = (await pool.query(`${selectionSql} WHERE s.organization_id=$1 AND s.product_id=$2 ORDER BY s.version_number`, [organizationId,productId])).rows.map(normalizeSelection);
      return { current_selection: aggregate?.current_selection_id ? history.find((value) => value.id === aggregate.current_selection_id) : null,
        selection_revision: Number(aggregate?.row_version || 0), history };
    },
    async listEvents(organizationId, productId) {
      return (await pool.query("SELECT * FROM avatar_selection_events WHERE organization_id=$1 AND product_id=$2 ORDER BY created_at,id", [organizationId,productId])).rows.map((row) => ({ ...row, created_at: iso(row.created_at) }));
    },
    async listAuditEvents() {
      return (await pool.query("SELECT * FROM avatar_selection_audit_events ORDER BY created_at,id")).rows.map((row) => ({ ...row, created_at: iso(row.created_at) }));
    }
  };
}
