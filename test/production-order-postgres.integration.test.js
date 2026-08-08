import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { runProductionOrderMigrations } from "../src/production-orders/postgres.js";
import { createPostgresProductionOrderRepository } from "../src/production-orders/postgres-production-order-repository.js";
import { createIdentityPool, runIdentityMigrations } from "../src/identity/postgres.js";
import { createPostgresIdentityRepository } from "../src/identity/postgres-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { runProjectContentMigrations } from "../src/project-content/postgres.js";
import { runVideoPlanningMigrations } from "../src/video-planning/postgres.js";

const connectionString = process.env.TEST_DATABASE_URL || process.env.IDENTITY_TEST_DATABASE_URL;
const isolatedUrl = (value, schema) => { const url = new URL(value); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); };

test("clean PostgreSQL production-order migration is transactional, restart-safe, isolated, and idempotent", { skip: !connectionString }, async (t) => {
  const schema = `production_orders_${randomUUID().replaceAll("-", "")}`;
  const adminPool = createIdentityPool({ connectionString });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = createIdentityPool({ connectionString: isolatedUrl(connectionString, schema) });
  t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`); await adminPool.end(); });
  await runIdentityMigrations(pool); await runProjectContentMigrations(pool); await runVideoPlanningMigrations(pool); await runProductionOrderMigrations(pool);
  assert.equal((await pool.query("SELECT max(version)::integer version FROM production_orders_schema_migrations")).rows[0].version, 1);

  const identity = createPostgresIdentityRepository({ pool, ownsPool: false });
  const seeded = await seedInitialAdmin(identity, { organizationId: "org-production-pg", organizationName: "Production PG",
    adminEmail: "production-pg@example.test", adminDisplayName: "Production Admin", adminTempPassword: "Temporary-Production-PG-9!" });
  const projectId = randomUUID(), productId = randomUUID(), planId = randomUUID(), at = "2026-08-08T09:00:00.000Z";
  await pool.query("INSERT INTO project_content_projects(id,organization_id,name,created_by_member_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5)",
    [projectId, "org-production-pg", "生产项目", seeded.member.id, at]);
  await pool.query("INSERT INTO project_content_products(id,organization_id,project_id,created_by_member_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5)",
    [productId, "org-production-pg", projectId, seeded.member.id, at]);
  await pool.query(`INSERT INTO video_plan_versions(id,organization_id,product_id,version_number,status,row_version,upstream_snapshot,capability_config_snapshot,output_instructions,created_by_member_id,created_at,updated_at)
    VALUES ($1,$2,$3,1,'frozen',1,$4,$5,$6,$7,$8,$8)`, [planId, "org-production-pg", productId,
    JSON.stringify({ product_revision_id: "revision", copy_version_id: "copy", avatar_selection_id: "selection", avatar_asset_version_id: "avatar" }),
    JSON.stringify({ snapshot_version: "capability-v1", verified_capabilities: [{ code: "speech", evidence_reference: "seed:speech" }] }), "方案说明", seeded.member.id, at]);

  const repository = createPostgresProductionOrderRepository({ pool }); await repository.initialize();
  const order = { id: randomUUID(), organization_id: "org-production-pg", product_id: productId, video_plan_version_id: planId,
    execution_purpose: "first_production", status: "waiting_for_executor", row_version: 1,
    input_snapshot: { video_plan_version: { id: planId }, plan_review: { id: "review", status: "approved" } },
    status_history: [{ status: "draft", at }, { status: "ready", at }, { status: "waiting_for_executor", at }],
    created_by_member_id: seeded.member.id, created_at: at, updated_at: at };
  const auditEvents = ["created", "ready", "waiting_for_executor"].map((transition) => ({ id: randomUUID(), organization_id: order.organization_id,
    actor_member_id: seeded.member.id, production_order_id: order.id, event_type: `production_order.${transition}`, metadata: {}, created_at: at }));
  const outboxEvent = { id: randomUUID(), organization_id: order.organization_id, aggregate_id: order.id,
    event_type: "production_order.created", payload: { order_id: order.id }, created_at: at, published_at: null };
  const saved = await repository.createOrder({ receiptKey: "pg-create", fingerprint: "same", order, auditEvents, outboxEvent });
  assert.equal(saved.replayed, false);
  assert.equal((await repository.getOrder(order.organization_id, order.id)).status, "waiting_for_executor");
  assert.equal((await repository.listAuditEvents(order.organization_id)).length, 3);
  assert.equal((await repository.listOutboxEvents(order.organization_id)).length, 1);
  const publishedAt = "2026-08-08T09:05:00.000Z";
  const published = await pool.query("UPDATE production_order_outbox_events SET published_at=$2 WHERE id=$1 RETURNING published_at",
    [outboxEvent.id, publishedAt]);
  assert.equal(published.rows[0].published_at.toISOString(), publishedAt);
  await assert.rejects(pool.query("UPDATE production_order_outbox_events SET payload=$2::jsonb WHERE id=$1",
    [outboxEvent.id, JSON.stringify({ tampered: true })]), /production order outbox is immutable/);
  await assert.rejects(pool.query("UPDATE production_order_outbox_events SET production_order_id=$2 WHERE id=$1",
    [outboxEvent.id, randomUUID()]), /production order outbox is immutable/);
  await assert.rejects(pool.query("UPDATE production_order_outbox_events SET event_type=$2 WHERE id=$1",
    [outboxEvent.id, "production_order.tampered"]), /production order outbox is immutable/);
  await assert.rejects(pool.query("UPDATE production_order_outbox_events SET published_at=$2 WHERE id=$1",
    [outboxEvent.id, "2026-08-08T09:10:00.000Z"]), /production order outbox is immutable/);
  await assert.rejects(pool.query("DELETE FROM production_order_outbox_events WHERE id=$1", [outboxEvent.id]), /production order outbox is immutable/);
  assert.equal((await repository.getOrder("org-other", order.id)), null);
  const replay = await repository.createOrder({ receiptKey: "pg-create", fingerprint: "same", order, auditEvents, outboxEvent });
  assert.equal(replay.replayed, true);
  await assert.rejects(repository.createOrder({ receiptKey: "pg-create", fingerprint: "different", order, auditEvents, outboxEvent }), { code: "IDEMPOTENCY_CONFLICT" });

  const failedOrder = { ...order, id: randomUUID() };
  await assert.rejects(repository.createOrder({ receiptKey: "pg-rollback", fingerprint: "rollback", order: failedOrder,
    auditEvents: [{ ...auditEvents[0], id: randomUUID(), production_order_id: randomUUID() }], outboxEvent: { ...outboxEvent, id: randomUUID(), aggregate_id: failedOrder.id } }));
  assert.equal(await repository.getOrder(order.organization_id, failedOrder.id), null);

  await repository.close();
  const restarted = createPostgresProductionOrderRepository({ pool }); await restarted.initialize();
  assert.equal((await restarted.getOrder(order.organization_id, order.id)).id, order.id);
  await restarted.close();
});
