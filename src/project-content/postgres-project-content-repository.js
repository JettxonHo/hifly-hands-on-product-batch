import { withTransaction } from "../identity/postgres.js";
import { assertProjectContentSchemaCurrent } from "./postgres.js";

const one = (result) => result.rows[0] || null;
const iso = (value) => value instanceof Date ? value.toISOString() : value;
const project = (row) => row ? { ...row, created_at: iso(row.created_at), updated_at: iso(row.updated_at) } : null;
const product = (row) => row ? { ...row, created_at: iso(row.created_at), updated_at: iso(row.updated_at) } : null;
const revision = (row) => row ? { ...row, revision_number: Number(row.revision_number), created_at: iso(row.created_at), updated_at: iso(row.updated_at), ready_at: iso(row.ready_at) } : null;

function uow(client) {
  return {
    transactionClient: client,
    async findReceipt(key) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`project-content:${key}`]);
      return one(await client.query("SELECT * FROM project_content_idempotency_receipts WHERE receipt_key=$1", [key]));
    },
    async insertReceipt(key, receipt) {
      await client.query("INSERT INTO project_content_idempotency_receipts(receipt_key,payload_fingerprint,response_json) VALUES ($1,$2,$3)", [key, receipt.payload_fingerprint, JSON.stringify(receipt.response_json)]);
    },
    async insertProject(value) {
      await client.query(`INSERT INTO project_content_projects(id,organization_id,name,description,delivery_date,created_by_member_id,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [value.id, value.organization_id, value.name, value.description, value.delivery_date, value.created_by_member_id, value.created_at, value.updated_at]);
    },
    async findProject(organizationId, id) { return project(one(await client.query("SELECT * FROM project_content_projects WHERE organization_id=$1 AND id=$2", [organizationId, id]))); },
    async listProjects(organizationId) { return (await client.query("SELECT * FROM project_content_projects WHERE organization_id=$1 ORDER BY created_at DESC", [organizationId])).rows.map(project); },
    async insertProduct(value) {
      await client.query(`INSERT INTO project_content_products(id,organization_id,project_id,current_revision_id,created_by_member_id,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO UPDATE SET current_revision_id=EXCLUDED.current_revision_id,updated_at=EXCLUDED.updated_at`,
      [value.id, value.organization_id, value.project_id, value.current_revision_id, value.created_by_member_id, value.created_at, value.updated_at]);
    },
    async findProduct(organizationId, id) { return product(one(await client.query("SELECT * FROM project_content_products WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, id]))); },
    async listProductsByProject(organizationId, projectId) { return (await client.query("SELECT * FROM project_content_products WHERE organization_id=$1 AND project_id=$2 ORDER BY created_at", [organizationId, projectId])).rows.map(product); },
    async insertRevision(value) {
      await client.query(`INSERT INTO project_content_product_revisions(id,organization_id,project_id,product_id,status,revision_number,product_name,product_description,primary_category,content_brief,asset_version_ids,selling_points,parent_revision_id,created_by_member_id,created_at,updated_at,ready_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [value.id, value.organization_id, value.project_id, value.product_id, value.status, value.revision_number, value.product_name, value.product_description, value.primary_category, JSON.stringify(value.content_brief), JSON.stringify(value.asset_version_ids), JSON.stringify(value.selling_points), value.parent_revision_id, value.created_by_member_id, value.created_at, value.updated_at, value.ready_at]);
    },
    async updateRevision(value) {
      await client.query(`UPDATE project_content_product_revisions SET status=$2,revision_number=$3,product_name=$4,product_description=$5,primary_category=$6,content_brief=$7,asset_version_ids=$8,selling_points=$9,updated_at=$10,ready_at=$11 WHERE id=$1`,
      [value.id, value.status, value.revision_number, value.product_name, value.product_description, value.primary_category, JSON.stringify(value.content_brief), JSON.stringify(value.asset_version_ids), JSON.stringify(value.selling_points), value.updated_at, value.ready_at]);
    },
    async findRevision(organizationId, id) { return revision(one(await client.query("SELECT * FROM project_content_product_revisions WHERE organization_id=$1 AND id=$2 FOR UPDATE", [organizationId, id]))); },
    async appendAudit(event) {
      await client.query(`INSERT INTO project_content_audit_events(id,organization_id,actor_member_id,event_type,project_id,product_id,product_revision_id,metadata,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [event.id, event.organization_id, event.actor_member_id || null, event.event_type, event.project_id || null, event.product_id || null, event.product_revision_id || null, JSON.stringify(event.metadata || {}), event.created_at]);
    }
  };
}

export function createPostgresProjectContentRepository({ pool, ownsPool = false } = {}) {
  if (!pool?.connect) throw new TypeError("pool is required");
  return {
    async initialize() { await assertProjectContentSchemaCurrent(pool); },
    async close() { if (ownsPool) await pool.end(); },
    async transaction(work) { return withTransaction(pool, (client) => work(uow(client))); },
    async listAuditEvents() { return (await pool.query("SELECT * FROM project_content_audit_events ORDER BY created_at")).rows.map((row) => ({ ...row, created_at: iso(row.created_at) })); }
  };
}
