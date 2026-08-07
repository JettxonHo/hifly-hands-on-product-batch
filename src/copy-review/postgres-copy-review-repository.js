import { withTransaction } from "../identity/postgres.js";
import { assertCopyReviewSchemaCurrent } from "./postgres.js";

const failure = (code) => Object.assign(new Error(code), { code });
const one = (result) => result.rows[0] || null;
const iso = (value) => value instanceof Date ? value.toISOString() : value;
const head = (row) => row ? { ...row, id: row.human_review_id, row_version: Number(row.row_version),
  created_at: iso(row.created_at), updated_at: iso(row.updated_at), decided_at: iso(row.decided_at), revoked_at: iso(row.revoked_at) } : null;
const receiptHead = (row) => row ? { ...row, row_version: Number(row.row_version),
  created_at: iso(row.created_at), updated_at: iso(row.updated_at), decided_at: iso(row.decided_at), revoked_at: iso(row.revoked_at) } : null;
const event = (row) => row ? { ...row, created_at: iso(row.created_at) } : null;

async function receiptReplay(client, receiptKey, fingerprint) {
  const receipt = one(await client.query("SELECT * FROM copy_review_idempotency_receipts WHERE receipt_key=$1", [receiptKey]));
  if (!receipt) return null;
  if (receipt.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
  return receiptHead(receipt.result_head);
}

async function appendEvent(client, value) {
  await client.query(`INSERT INTO copy_human_review_events(id,organization_id,human_review_id,copy_version_id,actor_member_id,from_status,to_status,reason,reason_code,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [value.id,value.organization_id,value.human_review_id,value.copy_version_id,
    value.actor_member_id,value.from_status,value.to_status,value.reason,value.reason_code,value.created_at]);
}

async function appendAudit(client, value) {
  await client.query(`INSERT INTO copy_review_audit_events(id,organization_id,actor_member_id,event_type,human_review_id,copy_version_id,metadata,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [value.id,value.organization_id,value.actor_member_id,value.event_type,
    value.human_review_id,value.copy_version_id,JSON.stringify(value.metadata || {}),value.created_at]);
}

export function createPostgresCopyReviewRepository({ pool, ownsPool = false } = {}) {
  if (!pool?.connect) throw new TypeError("pool is required");
  const selectHead = `SELECT h.*,r.author_member_id,r.quality_result_id,r.product_revision_id,r.profile_version,r.rule_version,r.created_at
    FROM copy_human_review_heads h JOIN copy_human_reviews r ON r.id=h.human_review_id`;
  return {
    async initialize() { await assertCopyReviewSchemaCurrent(pool); },
    async close() { if (ownsPool) await pool.end(); },
    async createReview({ receiptKey, fingerprint, review, head: value, event: transition, audit }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`copy-review:${receiptKey}`]);
        const replay = await receiptReplay(client, receiptKey, fingerprint);
        if (replay) return replay;
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`copy-review-active:${review.organization_id}:${review.copy_version_id}`]);
        if ((await client.query("SELECT 1 FROM copy_human_review_heads WHERE organization_id=$1 AND copy_version_id=$2 AND status IN ('pending','approved')", [review.organization_id,review.copy_version_id])).rowCount) {
          throw failure("COPY_REVIEW_ACTIVE_EXISTS");
        }
        await client.query(`INSERT INTO copy_human_reviews(id,organization_id,copy_version_id,author_member_id,quality_result_id,product_revision_id,profile_version,rule_version,created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [review.id,review.organization_id,review.copy_version_id,review.author_member_id,
          review.quality_result_id,review.product_revision_id,review.profile_version,review.rule_version,review.created_at]);
        await client.query(`INSERT INTO copy_human_review_heads(human_review_id,organization_id,copy_version_id,status,row_version,reviewer_member_id,review_mode,decision_reason,decided_at,revoked_at,revoke_reason,revoke_reason_code,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [review.id,value.organization_id,value.copy_version_id,value.status,value.row_version,
          value.reviewer_member_id,value.review_mode,value.decision_reason,value.decided_at,value.revoked_at,value.revoke_reason,value.revoke_reason_code,value.updated_at]);
        await appendEvent(client, transition); await appendAudit(client, audit);
        await client.query("INSERT INTO copy_review_idempotency_receipts(receipt_key,payload_fingerprint,human_review_id,result_head,created_at) VALUES ($1,$2,$3,$4,$5)",
          [receiptKey,fingerprint,review.id,JSON.stringify(value),review.created_at]);
        return value;
      });
    },
    async transition({ receiptKey, fingerprint, resultReceiptKey = null, reviewId, organizationId, expectedRevision, fromStatuses, patch, event: transition, audit }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`copy-review:${receiptKey}`]);
        const replay = await receiptReplay(client, receiptKey, fingerprint);
        if (replay) return replay;
        const current = head(one(await client.query(`${selectHead} WHERE h.organization_id=$1 AND h.human_review_id=$2 FOR UPDATE`, [organizationId,reviewId])));
        if (!current) throw failure("COPY_REVIEW_NOT_FOUND");
        if (current.row_version !== expectedRevision || !fromStatuses.includes(current.status)) throw failure("COPY_REVIEW_CONFLICT");
        const saved = head(one(await client.query(`UPDATE copy_human_review_heads SET status=$3,row_version=row_version+1,reviewer_member_id=$4,review_mode=$5,
          decision_reason=$6,decided_at=$7,revoked_at=$8,revoke_reason=$9,revoke_reason_code=$10,updated_at=$11
          WHERE organization_id=$1 AND human_review_id=$2 RETURNING *`, [organizationId,reviewId,patch.status,
          patch.reviewer_member_id ?? current.reviewer_member_id,patch.review_mode ?? current.review_mode,
          patch.decision_reason ?? current.decision_reason,patch.decided_at ?? current.decided_at,
          patch.revoked_at ?? current.revoked_at,patch.revoke_reason ?? current.revoke_reason,
          patch.revoke_reason_code ?? current.revoke_reason_code,transition.created_at])));
        await appendEvent(client, transition); await appendAudit(client, audit);
        await client.query("INSERT INTO copy_review_idempotency_receipts(receipt_key,payload_fingerprint,human_review_id,result_head,created_at) VALUES ($1,$2,$3,$4,$5)",
          [receiptKey,fingerprint,reviewId,JSON.stringify({ ...current, ...saved }),transition.created_at]);
        if (resultReceiptKey) await client.query("UPDATE copy_review_idempotency_receipts SET result_head=$2 WHERE receipt_key=$1",
          [resultReceiptKey,JSON.stringify({ ...current, ...saved })]);
        return { ...current, ...saved };
      });
    },
    async getReceipt(receiptKey, fingerprint) {
      const client = await pool.connect();
      try { return await receiptReplay(client, receiptKey, fingerprint); }
      finally { client.release(); }
    },
    async updateReceiptResult(receiptKey, resultHead) {
      await pool.query("UPDATE copy_review_idempotency_receipts SET result_head=$2 WHERE receipt_key=$1", [receiptKey,JSON.stringify(resultHead)]);
    },
    async getReview(organizationId, reviewId) {
      return head(one(await pool.query(`${selectHead} WHERE h.organization_id=$1 AND h.human_review_id=$2`, [organizationId,reviewId])));
    },
    async listReviews(organizationId, copyVersionId) {
      return (await pool.query(`${selectHead} WHERE h.organization_id=$1 AND h.copy_version_id=$2 ORDER BY r.created_at,r.id`, [organizationId,copyVersionId])).rows.map(head);
    },
    async listEvents(organizationId, copyVersionId) {
      return (await pool.query("SELECT * FROM copy_human_review_events WHERE organization_id=$1 AND copy_version_id=$2 ORDER BY created_at,id", [organizationId,copyVersionId])).rows.map(event);
    },
    async listAuditEvents() {
      return (await pool.query("SELECT * FROM copy_review_audit_events ORDER BY created_at,id")).rows.map((row) => ({ ...row, created_at: iso(row.created_at) }));
    }
  };
}
