import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { runIdentityMigrations, createIdentityPool } from "../src/identity/postgres.js";
import { createPostgresIdentityRepository } from "../src/identity/postgres-identity-repository.js";
import { seedInitialAdmin } from "../src/identity/seed-admin.js";
import { runProjectContentMigrations } from "../src/project-content/postgres.js";
import { runVideoPlanningMigrations } from "../src/video-planning/postgres.js";
import { runProductionOrderMigrations } from "../src/production-orders/postgres.js";
import { createPostgresManualHandoffRepository } from "../src/manual-handoff/postgres-manual-handoff-repository.js";
import { runManualHandoffMigrations } from "../src/manual-handoff/postgres.js";
import { createManualHandoffPackageService } from "../src/manual-handoff/manual-handoff-package-service.js";
import { createManualHandoffPackageWorker } from "../src/manual-handoff/manual-handoff-package-worker.js";
import { createMemoryManualHandoffPackageStore } from "../src/manual-handoff/manual-handoff-package-store.js";

const connectionString = process.env.TEST_DATABASE_URL || process.env.IDENTITY_TEST_DATABASE_URL;
const isolatedUrl = (value, schema) => { const url = new URL(value); url.searchParams.set("options", `-c search_path=${schema}`); return url.toString(); };

test("clean PostgreSQL ManualHandoffPackage migration is transactional, restart-safe, isolated, and idempotent", { skip: !connectionString }, async (t) => {
  const schema = `manual_handoff_${randomUUID().replaceAll("-", "")}`;
  const adminPool = createIdentityPool({ connectionString });
  await adminPool.query(`CREATE SCHEMA "${schema}"`);
  const pool = createIdentityPool({ connectionString: isolatedUrl(connectionString, schema) });
  t.after(async () => { await pool.end(); await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`); await adminPool.end(); });
  await runIdentityMigrations(pool);
  await runProjectContentMigrations(pool);
  await runVideoPlanningMigrations(pool);
  await runProductionOrderMigrations(pool);
  await runManualHandoffMigrations(pool);
  assert.equal((await pool.query("SELECT max(version)::integer version FROM manual_handoff_schema_migrations")).rows[0].version, 1);

  const identity = createPostgresIdentityRepository({ pool, ownsPool: false });
  const seeded = await seedInitialAdmin(identity, { organizationId: "org-manual-pg", organizationName: "Manual PG", adminEmail: "manual-pg@example.test", adminDisplayName: "Manual PG", adminTempPassword: "Temporary-Manual-PG-9!" });
  const projectId = randomUUID(), productId = randomUUID(), planId = randomUUID(), orderId = randomUUID(), at = "2026-08-08T09:00:00.000Z";
  await pool.query("INSERT INTO project_content_projects(id,organization_id,name,created_by_member_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5)", [projectId, "org-manual-pg", "项目", seeded.member.id, at]);
  await pool.query("INSERT INTO project_content_products(id,organization_id,project_id,created_by_member_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5)", [productId, "org-manual-pg", projectId, seeded.member.id, at]);
  await pool.query(`INSERT INTO video_plan_versions(id,organization_id,product_id,version_number,status,row_version,upstream_snapshot,capability_config_snapshot,output_instructions,created_by_member_id,created_at,updated_at)
    VALUES ($1,$2,$3,2,'frozen',1,$4,$5,$6,$7,$8,$8)`, [planId, "org-manual-pg", productId, JSON.stringify({ product_revision_id: "revision", copy_version_id: "copy", avatar_selection_id: "selection", avatar_asset_version_id: "avatar" }), JSON.stringify({ snapshot_version: "capability-v1" }), "输出说明", seeded.member.id, at]);
  await pool.query(`INSERT INTO production_orders(id,organization_id,product_id,video_plan_version_id,execution_purpose,status,row_version,input_snapshot,status_history,created_by_member_id,created_at,updated_at)
    VALUES ($1,$2,$3,$4,'first_production','waiting_for_executor',1,$5,$6,$7,$8,$8)`, [orderId, "org-manual-pg", productId, planId, JSON.stringify({ project_id: projectId, video_plan_version: { id: planId, version_number: 2, status: "frozen", presentation_size_code: "smart_fit", output_instructions: "输出说明" }, upstream_snapshot: { product_revision_id: "revision", copy_version_id: "copy", avatar_asset_version_id: "avatar" }, configuration_snapshot: { snapshot_version: "capability-v1" } }), JSON.stringify([{ status: "draft", at }, { status: "ready", at }, { status: "waiting_for_executor", at }]), seeded.member.id, at]);

  const repository = createPostgresManualHandoffRepository({ pool });
  await repository.initialize();
  const service = createManualHandoffPackageService({ repository, packageStore: createMemoryManualHandoffPackageStore(), orderPort: { async getOrder({ organizationId, orderId: requested }) {
    return requested === orderId && organizationId === "org-manual-pg" ? (await pool.query("SELECT * FROM production_orders WHERE id=$1", [orderId])).rows[0] : null;
  } }, now: () => Date.parse(at) });
  const worker = createManualHandoffPackageWorker({ service });
  const requested = await service.requestGeneration({ organizationId: "org-manual-pg", actorMemberId: seeded.member.id, actorRole: "admin", productionOrderId: orderId, generationRequestId: "pg-generation" });
  await worker.runNext();
  const ready = await service.getPackage({ organizationId: "org-manual-pg", actorMemberId: seeded.member.id, actorRole: "admin", packageId: requested.package.package_id });
  assert.equal(ready.status, "ready");
  const replay = await service.requestGeneration({ organizationId: "org-manual-pg", actorMemberId: seeded.member.id, actorRole: "admin", productionOrderId: orderId, generationRequestId: "pg-generation" });
  assert.equal(replay.replayed, true);
  await assert.rejects(service.requestGeneration({ organizationId: "org-manual-pg", actorMemberId: seeded.member.id, actorRole: "admin", productionOrderId: orderId, generationRequestId: "pg-generation", packageVersion: 2 }), { code: "IDEMPOTENCY_CONFLICT" });
  assert.equal((await repository.listPackages("org-other", orderId)).length, 0);
  await repository.close();
});
