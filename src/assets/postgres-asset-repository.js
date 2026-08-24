import { createHash, randomUUID } from "node:crypto";

import { withTransaction } from "../identity/postgres.js";
import { assertAssetSchemaCurrent } from "./postgres.js";

const failure = (code) => Object.assign(new Error(code), { code });
const AVATAR_PREVIEW_MEDIA_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const one = (result) => result.rows[0] ?? null;
const iso = (value) => value instanceof Date ? value.toISOString() : value;
const versionProjection = (row) => row ? {
  ...row,
  version_number: Number(row.version_number),
  expected_size: Number(row.expected_size),
  verified_size: row.verified_size == null ? null : Number(row.verified_size),
  created_at: iso(row.created_at), updated_at: iso(row.updated_at), verified_at: iso(row.verified_at)
} : null;
const assetProjection = (row) => {
  if (!row) return null;
  const { row_version: rowVersion, ...rest } = row;
  return { ...rest, revision_number: Number(rowVersion ?? row.revision_number), created_at: iso(row.created_at), updated_at: iso(row.updated_at) };
};
const jobProjection = (row) => row ? { ...row, attempts: Number(row.attempts), created_at: iso(row.created_at), updated_at: iso(row.updated_at) } : null;
const sessionProjection = (row) => row ? { ...row, created_at: iso(row.created_at), expires_at: iso(row.expires_at), uploaded_at: iso(row.uploaded_at), completed_at: iso(row.completed_at) } : null;

export function createPostgresAssetRepository({ pool, ownsPool = false } = {}) {
  if (!pool || typeof pool.query !== "function") throw new TypeError("pool is required");

  async function appendAudit(client, event) {
    await client.query(
      `INSERT INTO asset_audit_events(id, organization_id, actor_member_id, event_type, asset_id, asset_version_id, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [event.id, event.organization_id, event.actor_member_id || null, event.event_type, event.asset_id || null, event.asset_version_id || null, event.metadata || {}, event.created_at]
    );
  }

  return {
    async initialize() { await assertAssetSchemaCurrent(pool); },
    async close() { if (ownsPool) await pool.end(); },
    async authorizeUpload({ organizationId, actorMemberId, idempotencyKey, fingerprint, tokenDigest, asset, assetKind = "product_image", version, session, audit, now }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`asset-upload:${organizationId}:${actorMemberId}:${idempotencyKey}`]);
        const receipt = one(await client.query(
          `SELECT * FROM asset_upload_authorization_receipts
           WHERE organization_id=$1 AND actor_member_id=$2 AND idempotency_key=$3`,
          [organizationId, actorMemberId, idempotencyKey]
        ));
        if (receipt) {
          if (receipt.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
          const existingSession = sessionProjection(one(await client.query("SELECT * FROM asset_upload_sessions WHERE id=$1 FOR UPDATE", [receipt.upload_session_id])));
          if (existingSession.status === "completed" || Date.parse(existingSession.expires_at) <= Date.parse(now)) throw failure("UPLOAD_AUTHORIZATION_NOT_REPLAYABLE");
          await client.query("UPDATE asset_upload_sessions SET token_digest=$2 WHERE id=$1", [existingSession.id, tokenDigest]);
          existingSession.token_digest = tokenDigest;
          return {
            asset: assetProjection(one(await client.query("SELECT * FROM asset_assets WHERE id=$1", [receipt.asset_id]))),
            asset_version: versionProjection(one(await client.query("SELECT * FROM asset_versions WHERE id=$1", [receipt.asset_version_id]))),
            upload_session: existingSession
          };
        }

        let targetAsset;
        let versionNumber = 1;
        if (asset) {
          targetAsset = assetProjection(one(await client.query(
            `INSERT INTO asset_assets(id, organization_id, kind, display_name, status, row_version, created_by_member_id, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
            [asset.id, asset.organization_id, asset.kind, asset.display_name, asset.status, asset.revision_number, asset.created_by_member_id, asset.created_at, asset.updated_at]
          )));
        } else {
          targetAsset = assetProjection(one(await client.query(
            "SELECT * FROM asset_assets WHERE id=$1 AND organization_id=$2 FOR UPDATE", [version.asset_id, organizationId]
          )));
          if (!targetAsset) throw failure("ASSET_NOT_FOUND");
          if (targetAsset.status !== "active") throw failure("ASSET_NOT_ACTIVE");
          if (targetAsset.kind !== assetKind) throw failure("ASSET_KIND_CONFLICT");
          versionNumber = Number(one(await client.query("SELECT coalesce(max(version_number),0)+1 AS next FROM asset_versions WHERE asset_id=$1", [targetAsset.id])).next);
        }
        const insertedVersion = versionProjection(one(await client.query(
          `INSERT INTO asset_versions(id, asset_id, organization_id, version_number, status, object_key, original_filename,
             expected_content_type, expected_size, expected_checksum_sha256, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
          [version.id, version.asset_id, version.organization_id, versionNumber, version.status, version.object_key, version.original_filename,
            version.expected_content_type, version.expected_size, version.expected_checksum_sha256, version.created_at, version.updated_at]
        )));
        const insertedSession = sessionProjection(one(await client.query(
          `INSERT INTO asset_upload_sessions(id, organization_id, asset_version_id, object_key, token_digest, status, expires_at, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
          [session.id, session.organization_id, session.asset_version_id, session.object_key, session.token_digest, session.status, session.expires_at, session.created_at]
        )));
        await client.query(
          `INSERT INTO asset_upload_authorization_receipts
             (organization_id, actor_member_id, idempotency_key, payload_fingerprint, asset_id, asset_version_id, upload_session_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [organizationId, actorMemberId, idempotencyKey, fingerprint, targetAsset.id, insertedVersion.id, insertedSession.id, now]
        );
        await appendAudit(client, audit);
        return { asset: targetAsset, asset_version: insertedVersion, upload_session: insertedSession };
      });
    },
    async getUploadSession(organizationId, id) {
      const row = one(await pool.query("SELECT * FROM asset_upload_sessions WHERE id = $1 AND organization_id = $2", [id, organizationId]));
      if (!row) throw failure("UPLOAD_SESSION_NOT_FOUND");
      return row;
    },
    async findUploadSessionByToken(organizationId, token) {
      const digest = createHash("sha256").update(token).digest("hex");
      return one(await pool.query("SELECT * FROM asset_upload_sessions WHERE organization_id = $1 AND token_digest = $2", [organizationId, digest]));
    },
    async markUploaded(organizationId, id, uploadedAt) {
      return withTransaction(pool, async (client) => {
        const session = one(await client.query("SELECT * FROM asset_upload_sessions WHERE id = $1 AND organization_id = $2 FOR UPDATE", [id, organizationId]));
        if (!session) throw failure("UPLOAD_SESSION_NOT_FOUND");
        if (session.status !== "upload_pending") throw failure("UPLOAD_SESSION_NOT_PENDING");
        await client.query("UPDATE asset_upload_sessions SET status = 'uploaded', uploaded_at = $2 WHERE id = $1", [id, uploadedAt]);
        return versionProjection(one(await client.query("UPDATE asset_versions SET status = 'uploading', updated_at = $2 WHERE id = $1 RETURNING *", [session.asset_version_id, uploadedAt])));
      });
    },
    async completeUpload({ organizationId, uploadSessionId, idempotencyKey, fingerprint, actorMemberId = null, now }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${organizationId}:${idempotencyKey}`]);
        const receipt = one(await client.query("SELECT * FROM asset_idempotency_receipts WHERE organization_id = $1 AND idempotency_key = $2", [organizationId, idempotencyKey]));
        if (receipt) {
          if (receipt.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
          return receipt.response_json;
        }
        const session = one(await client.query("SELECT * FROM asset_upload_sessions WHERE id = $1 AND organization_id = $2 FOR UPDATE", [uploadSessionId, organizationId]));
        if (!session) throw failure("UPLOAD_SESSION_NOT_FOUND");
        if (!["uploaded", "completed"].includes(session.status)) throw failure("UPLOAD_NOT_COMPLETED");
        if (session.status === "uploaded") {
          await client.query("UPDATE asset_upload_sessions SET status = 'completed', completed_at = $2 WHERE id = $1", [session.id, now]);
          await client.query("UPDATE asset_versions SET status = 'verifying', updated_at = $2 WHERE id = $1", [session.asset_version_id, now]);
        }
        const version = versionProjection(one(await client.query("SELECT * FROM asset_versions WHERE id = $1", [session.asset_version_id])));
        await client.query(
          `INSERT INTO asset_async_jobs(id, organization_id, type, asset_version_id, status, attempts, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, 'asset_verification', $2, 'queued', 0, $3, $3)
           ON CONFLICT (type, asset_version_id) DO NOTHING`, [organizationId, version.id, now]
        );
        const job = jobProjection(one(await client.query("SELECT * FROM asset_async_jobs WHERE type = 'asset_verification' AND asset_version_id = $1", [version.id])));
        const response = { asset_version: version, job };
        await client.query(
          "INSERT INTO asset_idempotency_receipts(organization_id, idempotency_key, payload_fingerprint, response_json, created_at) VALUES ($1,$2,$3,$4,$5)",
          [organizationId, idempotencyKey, fingerprint, response, now]
        );
        await appendAudit(client, { id: randomUUID(), organization_id: organizationId, actor_member_id: actorMemberId, event_type: "asset.upload_completed", asset_id: version.asset_id, asset_version_id: version.id, created_at: now });
        return response;
      });
    },
    async getAssetVersion(organizationId, id) {
      const row = versionProjection(one(await pool.query("SELECT * FROM asset_versions WHERE id = $1 AND organization_id = $2", [id, organizationId])));
      if (!row) throw failure("ASSET_VERSION_NOT_FOUND");
      return row;
    },
    async getAsset(organizationId, id) {
      const row = assetProjection(one(await pool.query("SELECT * FROM asset_assets WHERE id = $1 AND organization_id = $2", [id, organizationId])));
      if (!row) throw failure("ASSET_NOT_FOUND");
      return row;
    },
    async authorizeAvatarPreviewMaterial({ organizationId, assetVersionId, mintGrant, transactionClient = null }) {
      if (typeof mintGrant !== "function") throw new TypeError("mintGrant is required");
      const work = async (client) => {
        const row = (await client.query(`SELECT av.*,aa.id parent_asset_id,aa.organization_id parent_organization_id,
            aa.kind parent_kind,aa.status parent_status
          FROM asset_versions av JOIN asset_assets aa ON aa.id=av.asset_id AND aa.organization_id=av.organization_id
          WHERE av.id=$1 AND av.organization_id=$2 FOR UPDATE OF av,aa`, [assetVersionId, organizationId])).rows[0];
        if (!row) throw failure("ASSET_VERSION_NOT_FOUND");
        const version = versionProjection(row);
        if (row.parent_organization_id !== organizationId || row.parent_status !== "active" || row.parent_kind !== "avatar_image" ||
            version.status !== "available" || !AVATAR_PREVIEW_MEDIA_TYPES.has(version.verified_content_type) ||
            !Number.isInteger(version.verified_size) || version.verified_size < 1 ||
            !/^[a-f0-9]{64}$/.test(version.verified_checksum_sha256 || "") ||
            typeof version.object_key !== "string" || !version.object_key) {
          throw failure("ASSET_VERSION_NOT_AVAILABLE");
        }
        return mintGrant({ asset: assetProjection({ id: row.parent_asset_id, organization_id: row.parent_organization_id,
          kind: row.parent_kind, status: row.parent_status, row_version: row.row_version }), assetVersion: version });
      };
      if (transactionClient) {
        if (typeof transactionClient.query !== "function") throw new TypeError("transactionClient must be a PostgreSQL client");
        return work(transactionClient);
      }
      return withTransaction(pool, work);
    },
    async listAssets(organizationId) {
      const assetRows = (await pool.query("SELECT * FROM asset_assets WHERE organization_id = $1 AND status <> 'deleted' ORDER BY created_at DESC", [organizationId])).rows;
      const versionRows = (await pool.query("SELECT * FROM asset_versions WHERE organization_id = $1 ORDER BY version_number DESC", [organizationId])).rows.map(versionProjection);
      return assetRows.map((row) => ({ ...assetProjection(row), versions: versionRows.filter((version) => version.asset_id === row.id) }));
    },
    async registerVerifiedOutput({ organizationId, actorMemberId = null, candidate, now, transactionClient = null }) {
      const work = async (client) => {
        const existing = one(await client.query(
          `SELECT av.*, aa.organization_id AS asset_organization_id, aa.kind, aa.display_name, aa.status AS asset_status,
                  aa.row_version, aa.created_by_member_id, aa.created_at AS asset_created_at, aa.updated_at AS asset_updated_at
             FROM asset_versions av JOIN asset_assets aa ON aa.id = av.asset_id
            WHERE av.object_key=$1 FOR UPDATE`, [candidate.object_key]
        ));
        if (existing) {
          if (existing.asset_organization_id !== organizationId || existing.kind !== "work_video" || existing.asset_status !== "active" ||
            existing.status !== "available" || existing.expected_content_type !== candidate.media_type ||
            existing.expected_checksum_sha256 !== candidate.checksum || Number(existing.expected_size) !== Number(candidate.size)) throw failure("WORK_VERIFICATION_ASSET_CONFLICT");
          return { asset: assetProjection({ id: existing.asset_id, organization_id: existing.asset_organization_id, kind: existing.kind,
            display_name: existing.display_name, status: existing.asset_status, row_version: existing.row_version,
            created_by_member_id: existing.created_by_member_id, created_at: existing.asset_created_at, updated_at: existing.asset_updated_at }),
          asset_version: versionProjection(existing) };
        }
        const assetId = randomUUID(), versionId = randomUUID(), displayName = String(candidate.original_filename || "已核验作品").slice(0, 120) || "已核验作品";
        const asset = assetProjection(one(await client.query(
          `INSERT INTO asset_assets(id,organization_id,kind,display_name,status,row_version,created_by_member_id,created_at,updated_at)
           VALUES ($1,$2,'work_video',$3,'active',1,$4,$5,$5) RETURNING *`, [assetId, organizationId, displayName, actorMemberId, now]
        )));
        const version = versionProjection(one(await client.query(
          `INSERT INTO asset_versions(id,asset_id,organization_id,version_number,status,object_key,original_filename,expected_content_type,
             expected_size,expected_checksum_sha256,verified_content_type,verified_size,verified_checksum_sha256,verified_at,created_at,updated_at)
           VALUES ($1,$2,$3,1,'available',$4,$5,$6,$7,$8,$6,$7,$8,$9,$9,$9) RETURNING *`,
          [versionId, assetId, organizationId, candidate.object_key, candidate.original_filename, candidate.media_type, candidate.size, candidate.checksum, now]
        )));
        await appendAudit(client, { id: randomUUID(), organization_id: organizationId, actor_member_id: actorMemberId,
          event_type: "asset.work_video_available", asset_id: asset.id, asset_version_id: version.id,
          metadata: { candidate_id: candidate.id }, created_at: now });
        return { asset, asset_version: version };
      };
      if (transactionClient) return work(transactionClient);
      return withTransaction(pool, work);
    },
    async registerAppearanceCandidate({ organizationId, actorSystemId = null, staged, now, transactionClient = null }) {
      const work = async (client) => {
        const existing = one(await client.query(
          `SELECT av.*, aa.organization_id AS asset_organization_id, aa.kind, aa.display_name,
                  aa.status AS asset_status, aa.row_version, aa.created_by_member_id,
                  aa.created_at AS asset_created_at, aa.updated_at AS asset_updated_at
             FROM asset_versions av
             JOIN asset_assets aa ON aa.id = av.asset_id
            WHERE av.object_key = $1
            FOR UPDATE`,
          [staged.object_key]
        ));
        if (existing) {
          if (existing.asset_organization_id !== organizationId ||
              existing.kind !== "appearance_candidate_image" ||
              existing.asset_status !== "active" ||
              existing.status !== "available" ||
              existing.expected_content_type !== staged.media_type ||
              Number(existing.expected_size) !== Number(staged.size) ||
              existing.expected_checksum_sha256 !== staged.checksum_sha256 ||
              existing.verified_content_type !== staged.media_type ||
              Number(existing.verified_size) !== Number(staged.size) ||
              existing.verified_checksum_sha256 !== staged.checksum_sha256) {
            throw failure("APPEARANCE_CANDIDATE_ASSET_CONFLICT");
          }
          return {
            asset: assetProjection({
              id: existing.asset_id,
              organization_id: existing.asset_organization_id,
              kind: existing.kind,
              display_name: existing.display_name,
              status: existing.asset_status,
              row_version: existing.row_version,
              created_by_member_id: existing.created_by_member_id,
              created_at: existing.asset_created_at,
              updated_at: existing.asset_updated_at
            }),
            asset_version: versionProjection(existing)
          };
        }

        const assetId = randomUUID();
        const versionId = randomUUID();
        const asset = assetProjection(one(await client.query(
          `INSERT INTO asset_assets(id, organization_id, kind, display_name, status, row_version, created_by_member_id, created_at, updated_at)
           VALUES ($1, $2, 'appearance_candidate_image', $3, 'active', 1, NULL, $4, $4)
           RETURNING *`,
          [assetId, organizationId, staged.original_filename, now]
        )));
        const version = versionProjection(one(await client.query(
          `INSERT INTO asset_versions(
             id, asset_id, organization_id, version_number, status, object_key, original_filename,
             expected_content_type, expected_size, expected_checksum_sha256,
             verified_content_type, verified_size, verified_checksum_sha256, verified_at, created_at, updated_at
           ) VALUES ($1, $2, $3, 1, 'available', $4, $5, $6, $7, $8, $6, $7, $8, $9, $9, $9)
           RETURNING *`,
          [versionId, assetId, organizationId, staged.object_key, staged.original_filename, staged.media_type, staged.size, staged.checksum_sha256, now]
        )));
        await appendAudit(client, {
          id: randomUUID(),
          organization_id: organizationId,
          actor_member_id: null,
          event_type: "asset.appearance_candidate_available",
          asset_id: asset.id,
          asset_version_id: version.id,
          metadata: {
            candidate_id: staged.candidate_id,
            capture_request_id: staged.capture_request_id,
            actor_system_id: actorSystemId
          },
          created_at: now
        });
        return { asset, asset_version: version };
      };
      if (transactionClient) {
        if (typeof transactionClient.query !== "function") throw new TypeError("transactionClient must be a PostgreSQL client");
        return work(transactionClient);
      }
      return withTransaction(pool, work);
    },
    async listPendingVerificationJobs() {
      return (await pool.query("SELECT * FROM asset_async_jobs WHERE status IN ('queued','running') ORDER BY created_at")).rows.map(jobProjection);
    },
    async claimNextVerificationJob(now) {
      return withTransaction(pool, async (client) => jobProjection(one(await client.query(
        `UPDATE asset_async_jobs SET status = 'running', attempts = attempts + 1, updated_at = $1
         WHERE id = (SELECT id FROM asset_async_jobs WHERE status IN ('queued','running') ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
         RETURNING *`, [now]
      ))));
    },
    async finishVerification({ jobId, versionStatus, failureCode = null, verification = null, now }) {
      return withTransaction(pool, async (client) => {
        const job = one(await client.query("SELECT * FROM asset_async_jobs WHERE id = $1 FOR UPDATE", [jobId]));
        if (!job) throw failure("VERIFICATION_JOB_NOT_FOUND");
        const version = versionProjection(one(await client.query(
          `UPDATE asset_versions SET status=$2, failure_code=$3, verified_content_type=$4, verified_size=$5,
             verified_checksum_sha256=$6, verified_at=$7, updated_at=$7 WHERE id=$1 RETURNING *`,
          [job.asset_version_id, versionStatus, failureCode, verification?.contentType || null, verification?.size || null, verification?.checksumSha256 || null, now]
        )));
        await client.query("UPDATE asset_async_jobs SET status = 'succeeded', updated_at = $2 WHERE id = $1", [jobId, now]);
        await appendAudit(client, { id: randomUUID(), organization_id: version.organization_id, event_type: versionStatus === "available" ? "asset.version_available" : "asset.verification_failed", asset_id: version.asset_id, asset_version_id: version.id, metadata: failureCode ? { failure_code: failureCode } : {}, created_at: now });
        return version;
      });
    },
    async updateAssetStatus({ organizationId, assetId, expectedRevision, status, actorMemberId = null, now }) {
      return withTransaction(pool, async (client) => {
        const current = one(await client.query("SELECT * FROM asset_assets WHERE id = $1 AND organization_id = $2 FOR UPDATE", [assetId, organizationId]));
        if (!current) throw failure("ASSET_NOT_FOUND");
        if (Number(current.row_version) !== expectedRevision) throw failure("ASSET_VERSION_CONFLICT");
        if (current.status === "deleted" || (status === "disabled" && current.status !== "active")) throw failure("ASSET_NOT_ACTIVE");
        if (status === "deleted" && (await client.query("SELECT 1 FROM asset_references WHERE asset_id = $1 LIMIT 1", [assetId])).rowCount) throw failure("ASSET_HISTORY_REFERENCED");
        const asset = assetProjection(one(await client.query("UPDATE asset_assets SET status=$2, row_version=row_version+1, updated_at=$3 WHERE id=$1 RETURNING *", [assetId, status, now])));
        await appendAudit(client, { id: randomUUID(), organization_id: organizationId, actor_member_id: actorMemberId, event_type: `asset.${status}`, asset_id: assetId, created_at: now });
        return asset;
      });
    },
    async updateAssetMetadata({ organizationId, assetId, expectedRevision, displayName, actorMemberId = null, now }) {
      return withTransaction(pool, async (client) => {
        const current = one(await client.query("SELECT * FROM asset_assets WHERE id=$1 AND organization_id=$2 FOR UPDATE", [assetId, organizationId]));
        if (!current) throw failure("ASSET_NOT_FOUND");
        if (Number(current.row_version) !== expectedRevision) throw failure("ASSET_VERSION_CONFLICT");
        if (current.status !== "active") throw failure("ASSET_NOT_ACTIVE");
        const updated = assetProjection(one(await client.query(
          "UPDATE asset_assets SET display_name=$2, row_version=row_version+1, updated_at=$3 WHERE id=$1 RETURNING *",
          [assetId, displayName, now]
        )));
        await appendAudit(client, { id: randomUUID(), organization_id: organizationId, actor_member_id: actorMemberId, event_type: "asset.metadata_updated", asset_id: assetId, metadata: { display_name: displayName }, created_at: now });
        return updated;
      });
    },
    async bindReference({ organizationId, assetVersionId, referenceType, referenceId, role, now, transactionClient = null }) {
      const work = async (client) => {
        const asset = assetProjection(one(await client.query(
          `SELECT * FROM asset_assets
           WHERE organization_id=$2
             AND id=(SELECT asset_id FROM asset_versions WHERE id=$1 AND organization_id=$2)
           FOR UPDATE`,
          [assetVersionId, organizationId]
        )));
        if (!asset) throw failure("ASSET_VERSION_NOT_FOUND");
        const version = versionProjection(one(await client.query(
          "SELECT * FROM asset_versions WHERE id=$1 AND organization_id=$2 AND asset_id=$3 FOR UPDATE",
          [assetVersionId, organizationId, asset.id]
        )));
        if (!version) throw failure("ASSET_VERSION_NOT_FOUND");
        if (asset.status !== "active") throw failure("ASSET_NOT_ACTIVE");
        if (asset.kind !== "product_image") throw failure("ASSET_VERSION_NOT_AVAILABLE");
        if (version.status !== "available") throw failure("ASSET_VERSION_NOT_AVAILABLE");
        await client.query(
          `INSERT INTO asset_references(id, organization_id, asset_id, asset_version_id, reference_type, reference_id, role, created_at)
           VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [organizationId, asset.id, version.id, referenceType, referenceId, role, now]
        );
        const reference = one(await client.query(
          "SELECT * FROM asset_references WHERE organization_id=$1 AND asset_version_id=$2 AND reference_type=$3 AND reference_id=$4 AND role=$5",
          [organizationId, version.id, referenceType, referenceId, role]
        ));
        return { reference, asset, asset_version: version };
      };
      if (transactionClient) {
        if (typeof transactionClient.query !== "function") throw new TypeError("transactionClient must be a PostgreSQL client");
        return work(transactionClient);
      }
      return withTransaction(pool, work);
    },
    async listAuditEvents() { return (await pool.query("SELECT * FROM asset_audit_events ORDER BY created_at, id")).rows; }
  };
}
