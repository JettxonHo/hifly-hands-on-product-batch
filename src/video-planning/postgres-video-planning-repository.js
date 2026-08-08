import { withTransaction } from "../identity/postgres.js";
import { assertVideoPlanningSchemaCurrent } from "./postgres.js";

const failure = (code) => Object.assign(new Error(code), { code });
const one = (result) => result.rows[0] || null;
const iso = (value) => value instanceof Date ? value.toISOString() : value;
const plan = (row) => row ? { ...row, version_number: Number(row.version_number), row_version: Number(row.row_version),
  created_at: iso(row.created_at), updated_at: iso(row.updated_at), frozen_at: iso(row.frozen_at) } : null;
const head = (row) => row ? { ...row, row_version: Number(row.row_version), updated_at: iso(row.updated_at) } : null;
const run = (row) => row ? { ...row, started_at: iso(row.started_at), completed_at: iso(row.completed_at),
  created_at: iso(row.created_at), updated_at: iso(row.updated_at) } : null;
const result = (row) => row ? { id: row.id, organization_id: row.organization_id,
  video_plan_version_id: row.video_plan_version_id, preflight_run_id: row.preflight_run_id, status: row.status,
  groups: row.groups_json, created_at: iso(row.created_at), invalidated_at: iso(row.invalidated_at),
  invalidation_reason: row.invalidation_reason } : null;
const review = (row) => row ? { ...row, row_version: Number(row.row_version), created_at: iso(row.created_at),
  updated_at: iso(row.updated_at), decided_at: iso(row.decided_at), revoked_at: iso(row.revoked_at) } : null;
const REVIEW_SELECT = `SELECT r.id,r.organization_id,r.video_plan_version_id,r.author_member_id,r.created_at,
  h.status,h.row_version,h.reviewer_member_id,h.review_mode,h.decision_reason,h.updated_at,h.decided_at,h.revoked_at,h.revoke_reason_code
  FROM video_plan_reviews r JOIN video_plan_review_heads h ON h.plan_review_id=r.id`;

async function appendAudit(client, event) {
  await client.query(`INSERT INTO video_planning_audit_events(id,organization_id,actor_member_id,event_type,video_plan_version_id,plan_review_id,preflight_run_id,metadata,created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [event.id,event.organization_id,event.actor_member_id || null,event.event_type,
    event.video_plan_version_id || null,event.plan_review_id || null,event.preflight_run_id || null,
    JSON.stringify(event.metadata || {}),event.created_at]);
}
async function readReceipt(client, receiptKey, fingerprint) {
  const found = one(await client.query("SELECT * FROM video_planning_idempotency_receipts WHERE receipt_key=$1", [receiptKey]));
  if (!found) return null;
  if (found.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
  return found.result;
}

export function createPostgresVideoPlanningRepository({ pool, ownsPool = false } = {}) {
  if (!pool?.connect) throw new TypeError("pool is required");
  return {
    async initialize() { await assertVideoPlanningSchemaCurrent(pool); },
    async close() { if (ownsPool) await pool.end(); },
    async getReceipt(receiptKey, fingerprint) { return readReceipt(pool, receiptKey, fingerprint); },
    async updateReceiptResult(receiptKey, value) {
      await pool.query("UPDATE video_planning_idempotency_receipts SET result=$2 WHERE receipt_key=$1", [receiptKey,JSON.stringify(value)]);
    },
    async recordReceipt(receiptKey, fingerprint, value) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`video-receipt:${receiptKey}`]);
        const prior = await readReceipt(client, receiptKey, fingerprint); if (prior) return prior;
        await client.query("INSERT INTO video_planning_idempotency_receipts(receipt_key,payload_fingerprint,result) VALUES ($1,$2,$3)",
          [receiptKey,fingerprint,JSON.stringify(value)]); return value;
      });
    },
    async getHead(organizationId, productId) {
      return head(one(await pool.query("SELECT * FROM video_plan_heads WHERE organization_id=$1 AND product_id=$2", [organizationId,productId])));
    },
    async getPlan(organizationId, planId) {
      return plan(one(await pool.query("SELECT * FROM video_plan_versions WHERE organization_id=$1 AND id=$2", [organizationId,planId])));
    },
    async listPlans(organizationId, productId) {
      return (await pool.query("SELECT * FROM video_plan_versions WHERE organization_id=$1 AND product_id=$2 ORDER BY version_number,id",
        [organizationId,productId])).rows.map(plan);
    },
    async createPlan({ receiptKey, fingerprint, plan: value, expectedHeadRevision, audit }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`video-receipt:${receiptKey}`]);
        const replay = await readReceipt(client, receiptKey, fingerprint); if (replay) return replay;
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`video-head:${value.organization_id}:${value.product_id}`]);
        const current = head(one(await client.query("SELECT * FROM video_plan_heads WHERE organization_id=$1 AND product_id=$2 FOR UPDATE",
          [value.organization_id,value.product_id])));
        if ((current?.row_version || 0) !== expectedHeadRevision) throw failure("VIDEO_PLAN_CONFLICT");
        await client.query(`INSERT INTO video_plan_versions(id,organization_id,product_id,version_number,status,row_version,upstream_snapshot,capability_config_snapshot,output_instructions,parent_plan_version_id,created_by_member_id,created_at,updated_at,frozen_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [value.id,value.organization_id,value.product_id,value.version_number,
          value.status,value.row_version,JSON.stringify(value.upstream_snapshot),JSON.stringify(value.capability_config_snapshot),value.output_instructions,
          value.parent_plan_version_id,value.created_by_member_id,value.created_at,value.updated_at,value.frozen_at]);
        await client.query(`INSERT INTO video_plan_heads(organization_id,product_id,current_plan_id,row_version,updated_at) VALUES ($1,$2,$3,1,$4)
          ON CONFLICT (organization_id,product_id) DO UPDATE SET current_plan_id=excluded.current_plan_id,row_version=video_plan_heads.row_version+1,updated_at=excluded.updated_at`,
        [value.organization_id,value.product_id,value.id,value.updated_at]);
        await client.query("INSERT INTO video_planning_idempotency_receipts(receipt_key,payload_fingerprint,result,created_at) VALUES ($1,$2,$3,$4)",
          [receiptKey,fingerprint,JSON.stringify({ plan_id: value.id }),value.created_at]);
        await appendAudit(client,audit); return value;
      });
    },
    async saveDraft({ organizationId, planId, expectedRevision, outputInstructions, updatedAt, audit }) {
      return withTransaction(pool, async (client) => {
        const saved = plan(one(await client.query(`UPDATE video_plan_versions SET output_instructions=$4,row_version=row_version+1,updated_at=$5
          WHERE organization_id=$1 AND id=$2 AND status='draft' AND row_version=$3 RETURNING *`,
        [organizationId,planId,expectedRevision,outputInstructions,updatedAt])));
        if (!saved) {
          const current = plan(one(await client.query("SELECT * FROM video_plan_versions WHERE organization_id=$1 AND id=$2", [organizationId,planId])));
          if (!current) return null;
          throw failure(current.status !== "draft" ? "VIDEO_PLAN_IMMUTABLE" : "VIDEO_PLAN_CONFLICT");
        }
        await appendAudit(client,audit); return saved;
      });
    },
    async deriveDraft({ receiptKey, fingerprint, sourcePlanId, expectedHeadRevision, plan: value, audit }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`video-receipt:${receiptKey}`]);
        const replay = await readReceipt(client, receiptKey, fingerprint); if (replay) return replay;
        const current = head(one(await client.query("SELECT * FROM video_plan_heads WHERE organization_id=$1 AND product_id=$2 FOR UPDATE",
          [value.organization_id,value.product_id])));
        if (!current || current.current_plan_id !== sourcePlanId || current.row_version !== expectedHeadRevision) throw failure("VIDEO_PLAN_CONFLICT");
        const source = plan(one(await client.query("SELECT * FROM video_plan_versions WHERE organization_id=$1 AND id=$2 FOR UPDATE", [value.organization_id,sourcePlanId])));
        if (!source) return null;
        if (source.status !== "frozen") throw failure("VIDEO_PLAN_DERIVE_BLOCKED");
        await client.query("UPDATE video_plan_versions SET status='superseded',updated_at=$2 WHERE id=$1", [sourcePlanId,value.created_at]);
        await client.query(`INSERT INTO video_plan_versions(id,organization_id,product_id,version_number,status,row_version,upstream_snapshot,capability_config_snapshot,output_instructions,parent_plan_version_id,created_by_member_id,created_at,updated_at,frozen_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, [value.id,value.organization_id,value.product_id,value.version_number,
          value.status,value.row_version,JSON.stringify(value.upstream_snapshot),JSON.stringify(value.capability_config_snapshot),value.output_instructions,
          value.parent_plan_version_id,value.created_by_member_id,value.created_at,value.updated_at,value.frozen_at]);
        await client.query("UPDATE video_plan_heads SET current_plan_id=$3,row_version=row_version+1,updated_at=$4 WHERE organization_id=$1 AND product_id=$2",
          [value.organization_id,value.product_id,value.id,value.updated_at]);
        await client.query("INSERT INTO video_planning_idempotency_receipts(receipt_key,payload_fingerprint,result,created_at) VALUES ($1,$2,$3,$4)",
          [receiptKey,fingerprint,JSON.stringify({ plan_id: value.id }),value.created_at]);
        await appendAudit(client,audit); return value;
      });
    },
    async createRun({ receiptKey, fingerprint, run: value, planId, expectedRevision, audit }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`video-receipt:${receiptKey}`]);
        const replay = await readReceipt(client, receiptKey, fingerprint); if (replay) return replay;
        let current = plan(one(await client.query("SELECT * FROM video_plan_versions WHERE organization_id=$1 AND id=$2 FOR UPDATE", [value.organization_id,planId])));
        if (!current) return null;
        if (current.status === "draft") {
          if (current.row_version !== expectedRevision) throw failure("VIDEO_PLAN_CONFLICT");
          current = plan(one(await client.query("UPDATE video_plan_versions SET status='frozen',frozen_at=$2,row_version=row_version+1,updated_at=$2 WHERE id=$1 RETURNING *", [planId,value.created_at])));
        } else if (current.status !== "frozen") throw failure("VIDEO_PLAN_PREFLIGHT_BLOCKED");
        const active = run(one(await client.query("SELECT * FROM video_preflight_runs WHERE organization_id=$1 AND video_plan_version_id=$2 AND status IN ('queued','running') ORDER BY created_at LIMIT 1",
          [value.organization_id,planId])));
        const saved = active || run(one(await client.query(`INSERT INTO video_preflight_runs(id,organization_id,video_plan_version_id,status,input_snapshot,preflight_result_id,failure_code,lease_token,created_by_member_id,started_at,completed_at,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`, [value.id,value.organization_id,value.video_plan_version_id,
          value.status,JSON.stringify(value.input_snapshot),value.preflight_result_id,value.failure_code,value.lease_token,value.created_by_member_id,
          value.started_at,value.completed_at,value.created_at,value.updated_at])));
        await client.query("INSERT INTO video_planning_idempotency_receipts(receipt_key,payload_fingerprint,result,created_at) VALUES ($1,$2,$3,$4)",
          [receiptKey,fingerprint,JSON.stringify({ run_id: saved.id }),value.created_at]); await appendAudit(client,audit); return saved;
      });
    },
    async claimNextRun({ now, leaseToken }) {
      return withTransaction(pool, async (client) => run(one(await client.query(`UPDATE video_preflight_runs SET status='running',lease_token=$1,started_at=$2,updated_at=$2
        WHERE id=(SELECT id FROM video_preflight_runs WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`, [leaseToken,now]))));
    },
    async completeRun({ runId, leaseToken, result: value, audit, now }) {
      return withTransaction(pool, async (client) => {
        const locked = run(one(await client.query("SELECT * FROM video_preflight_runs WHERE id=$1 AND status='running' AND lease_token=$2 FOR UPDATE", [runId,leaseToken])));
        if (!locked) throw failure("PREFLIGHT_RUN_LEASE_LOST");
        const savedResult = result(one(await client.query(`INSERT INTO video_preflight_results(id,organization_id,video_plan_version_id,preflight_run_id,status,groups_json,created_at,invalidated_at,invalidation_reason)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [value.id,value.organization_id,value.video_plan_version_id,
          value.preflight_run_id,value.status,JSON.stringify(value.groups),value.created_at,value.invalidated_at,value.invalidation_reason])));
        const savedRun = run(one(await client.query("UPDATE video_preflight_runs SET status='succeeded',preflight_result_id=$3,failure_code=NULL,completed_at=$4,lease_token=NULL,updated_at=$4 WHERE id=$1 AND lease_token=$2 RETURNING *",
          [runId,leaseToken,savedResult.id,now]))); await appendAudit(client,audit); return { run: savedRun, result: savedResult };
      });
    },
    async failRun({ runId, leaseToken, failureCode, audit, now }) {
      return withTransaction(pool, async (client) => {
        const saved = run(one(await client.query("UPDATE video_preflight_runs SET status='failed',failure_code=$3,completed_at=$4,lease_token=NULL,updated_at=$4 WHERE id=$1 AND status='running' AND lease_token=$2 RETURNING *",
          [runId,leaseToken,failureCode,now]))); if (!saved) throw failure("PREFLIGHT_RUN_LEASE_LOST");
        await appendAudit(client,audit); return saved;
      });
    },
    async getPreflightState(organizationId, planId) {
      const history = [];
      for (const row of (await pool.query("SELECT * FROM video_preflight_runs WHERE organization_id=$1 AND video_plan_version_id=$2 ORDER BY created_at,id", [organizationId,planId])).rows) {
        const runRow = run(row), resultRow = runRow.preflight_result_id ? result(one(await pool.query("SELECT * FROM video_preflight_results WHERE organization_id=$1 AND id=$2", [organizationId,runRow.preflight_result_id]))) : null;
        history.push({ ...runRow, result: resultRow });
      }
      const current = history.at(-1) || null;
      return { current_run: current ? Object.fromEntries(Object.entries(current).filter(([name]) => name !== "result")) : null,
        current_result: current?.result || null, history };
    },
    async listReviews(organizationId, planId) {
      return (await pool.query(`${REVIEW_SELECT} WHERE r.organization_id=$1 AND r.video_plan_version_id=$2 ORDER BY r.created_at,r.id`, [organizationId,planId])).rows.map(review);
    },
    async getReview(organizationId, reviewId) {
      return review(one(await pool.query(`${REVIEW_SELECT} WHERE r.organization_id=$1 AND r.id=$2`, [organizationId,reviewId])));
    },
    async createReview({ receiptKey, fingerprint, review: value, audit }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`video-receipt:${receiptKey}`]);
        const replay = await readReceipt(client, receiptKey, fingerprint); if (replay) return replay;
        const active = one(await client.query("SELECT plan_review_id FROM video_plan_review_heads WHERE organization_id=$1 AND video_plan_version_id=$2 AND status='pending'",
          [value.organization_id,value.video_plan_version_id])); if (active) throw failure("VIDEO_PLAN_REVIEW_ACTIVE_EXISTS");
        await client.query(`INSERT INTO video_plan_reviews(id,organization_id,video_plan_version_id,author_member_id,created_at)
          VALUES ($1,$2,$3,$4,$5)`, [value.id,value.organization_id,value.video_plan_version_id,value.author_member_id,value.created_at]);
        await client.query(`INSERT INTO video_plan_review_heads(plan_review_id,organization_id,video_plan_version_id,status,row_version,reviewer_member_id,review_mode,decision_reason,updated_at,decided_at,revoked_at,revoke_reason_code)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [value.id,value.organization_id,value.video_plan_version_id,
          value.status,value.row_version,value.reviewer_member_id,value.review_mode,value.decision_reason,value.updated_at,value.decided_at,value.revoked_at,value.revoke_reason_code]);
        await client.query(`INSERT INTO video_plan_review_events(id,organization_id,plan_review_id,video_plan_version_id,actor_member_id,from_status,to_status,created_at)
          VALUES (gen_random_uuid(),$1,$2,$3,$4,'not_submitted','pending',$5)`, [value.organization_id,value.id,value.video_plan_version_id,value.author_member_id,value.created_at]);
        const saved = value;
        await client.query("INSERT INTO video_planning_idempotency_receipts(receipt_key,payload_fingerprint,result,created_at) VALUES ($1,$2,$3,$4)",
          [receiptKey,fingerprint,JSON.stringify({ review_id: saved.id }),value.created_at]); await appendAudit(client,audit); return saved;
      });
    },
    async transitionReview({ receiptKey, fingerprint, organizationId, reviewId, expectedRevision, fromStatuses, patch, audit }) {
      return withTransaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`video-receipt:${receiptKey}`]);
        const replay = await readReceipt(client, receiptKey, fingerprint); if (replay) return replay;
        const current = review(one(await client.query(`${REVIEW_SELECT} WHERE r.organization_id=$1 AND r.id=$2 FOR UPDATE OF h`, [organizationId,reviewId])));
        if (!current) return null;
        if (current.row_version !== expectedRevision || !fromStatuses.includes(current.status)) throw failure("VIDEO_PLAN_REVIEW_CONFLICT");
        await client.query(`UPDATE video_plan_review_heads SET status=$3,row_version=row_version+1,reviewer_member_id=$4,review_mode=$5,decision_reason=$6,decided_at=$7,updated_at=$8
          WHERE organization_id=$1 AND plan_review_id=$2`, [organizationId,reviewId,patch.status,patch.reviewer_member_id,patch.review_mode,
          patch.decision_reason,patch.decided_at,patch.updated_at]);
        await client.query(`INSERT INTO video_plan_review_events(id,organization_id,plan_review_id,video_plan_version_id,actor_member_id,from_status,to_status,reason,created_at)
          VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7,$8)`, [organizationId,reviewId,current.video_plan_version_id,patch.reviewer_member_id,
          current.status,patch.status,patch.decision_reason,patch.updated_at]);
        const saved = review(one(await client.query(`${REVIEW_SELECT} WHERE r.organization_id=$1 AND r.id=$2`, [organizationId,reviewId])));
        await client.query("INSERT INTO video_planning_idempotency_receipts(receipt_key,payload_fingerprint,result,created_at) VALUES ($1,$2,$3,$4)",
          [receiptKey,fingerprint,JSON.stringify({ review_id: saved.id }),patch.updated_at]); await appendAudit(client,audit); return saved;
      });
    },
    async invalidate({ organizationId, planId, reasonCode, actorMemberId, now, audit }) {
      return withTransaction(pool, async (client) => {
        await client.query(`UPDATE video_preflight_results SET status='invalidated',invalidated_at=$3,invalidation_reason=$4
          WHERE organization_id=$1 AND video_plan_version_id=$2 AND status IN ('passed','warning','blocked')`, [organizationId,planId,now,reasonCode]);
        const approved = (await client.query("SELECT plan_review_id FROM video_plan_review_heads WHERE organization_id=$1 AND video_plan_version_id=$2 AND status='approved' FOR UPDATE",
          [organizationId,planId])).rows;
        await client.query(`UPDATE video_plan_review_heads SET status='revoked',revoke_reason_code=$3,revoked_at=$4,row_version=row_version+1,updated_at=$4
          WHERE organization_id=$1 AND video_plan_version_id=$2 AND status='approved'`, [organizationId,planId,reasonCode,now]);
        for (const item of approved) await client.query(`INSERT INTO video_plan_review_events(id,organization_id,plan_review_id,video_plan_version_id,actor_member_id,from_status,to_status,reason_code,created_at)
          VALUES (gen_random_uuid(),$1,$2,$3,$4,'approved','revoked',$5,$6)`, [organizationId,item.plan_review_id,planId,actorMemberId,reasonCode,now]);
        await appendAudit(client,{ ...audit, actor_member_id: actorMemberId });
      });
    },
    async listAuditEvents() {
      return (await pool.query("SELECT * FROM video_planning_audit_events ORDER BY created_at,id")).rows.map((row) => ({ ...row, created_at: iso(row.created_at) }));
    },
    async listReviewEvents() {
      return (await pool.query("SELECT * FROM video_plan_review_events ORDER BY created_at,id")).rows.map((row) => ({ ...row, created_at: iso(row.created_at) }));
    }
  };
}
