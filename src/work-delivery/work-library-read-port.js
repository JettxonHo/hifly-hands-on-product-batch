import { randomUUID } from "node:crypto";

const clone = (value) => value == null ? value : structuredClone(value);
const failure = (code) => Object.assign(new Error(code), { code });
const iso = (value) => value instanceof Date ? value.toISOString() : value;

function deliveryStatus(current, deliveries) {
  if (current?.status === "rework_required") return "rework_required";
  if (deliveries.length) return "delivered";
  if (current?.status === "passed") return "deliverable";
  return "pending_review";
}

function newestFirst(left, right) {
  const byCreatedAt = String(right.created_at || "").localeCompare(String(left.created_at || ""));
  return byCreatedAt || String(right.id || "").localeCompare(String(left.id || ""));
}

function inspectionProjection(row) {
  if (!row) return null;
  return { ...row, revision: Number(row.revision), inspected_at: iso(row.inspected_at),
    created_at: iso(row.created_at), updated_at: iso(row.updated_at) };
}

function deliveryProjection(row) {
  if (!row) return null;
  return { ...row, delivered_at: iso(row.delivered_at), created_at: iso(row.created_at) };
}

function workProjection(row) {
  return { ...row, primary_output_size: Number(row.primary_output_size), created_at: iso(row.created_at),
    updated_at: iso(row.updated_at), project_id: row.library_project_id || null,
    product_id: row.library_product_id || null, product_name: row.library_product_name || null };
}

async function metadataFor(work, input, orderPort) {
  let value = { ...work };
  if (!orderPort?.getOrder || !work.production_order_id) return value;
  const order = await orderPort.getOrder({ organizationId: input.organizationId,
    actorMemberId: input.actorMemberId, actorRole: input.actorRole, orderId: work.production_order_id });
  const snapshot = order?.input_snapshot?.product_revision_snapshot || {};
  if (order?.id !== work.production_order_id || order?.organization_id !== input.organizationId ||
      (work.product_id && order.product_id && work.product_id !== order.product_id) ||
      (snapshot.organization_id && snapshot.organization_id !== input.organizationId) ||
      (snapshot.product_id && order.product_id && snapshot.product_id !== order.product_id)) {
    throw failure("WORK_DELIVERY_PROJECTION_INVALID");
  }
  value = { ...value, project_id: value.project_id || snapshot.project_id || null,
    product_id: value.product_id || order.product_id || null,
    product_name: value.product_name || snapshot.product_name || null };
  return value;
}

export function createMemoryWorkLibraryReadPort({ workPort, orderPort = null, repository } = {}) {
  if (!workPort?.listWorks || !repository?.getInspectionState || !repository?.listDeliveries || !repository?.ensurePendingInspection) {
    throw new TypeError("memory work library dependencies are required");
  }

  return {
    async listPage(input) {
      const candidates = [];
      for (const work of await workPort.listWorks(input.organizationId)) {
        if (work?.organization_id !== input.organizationId) continue;
        const enriched = await metadataFor(work, input, orderPort);
        if (input.projectId && enriched.project_id !== input.projectId) continue;
        const state = await repository.getInspectionState(input.organizationId, work.id);
        const deliveries = await repository.listDeliveries(input.organizationId, work.id);
        const stateAfterDeliveries = await repository.getInspectionState(input.organizationId, work.id);
        if (JSON.stringify(state) !== JSON.stringify(stateAfterDeliveries)) {
          throw failure("WORK_DELIVERY_PROJECTION_INVALID");
        }
        const status = deliveryStatus(stateAfterDeliveries.current, deliveries);
        if (input.deliveryStatus !== "all" && status !== input.deliveryStatus) continue;
        candidates.push({ work: enriched, status });
      }
      candidates.sort((left, right) => newestFirst(left.work, right.work));
      const totalItems = candidates.length;
      const totalPages = totalItems ? Math.ceil(totalItems / input.pageSize) : 0;
      const anchorIndex = input.anchorWorkId
        ? candidates.findIndex((candidate) => candidate.work.id === input.anchorWorkId) : -1;
      const desiredPage = input.explicitPage ? input.requestedPage
        : anchorIndex >= 0 ? Math.floor(anchorIndex / input.pageSize) + 1 : 1;
      const page = totalPages ? Math.min(desiredPage, totalPages) : 1;
      const selected = candidates.slice((page - 1) * input.pageSize, page * input.pageSize);
      const items = [];
      for (const candidate of selected) {
        const before = await repository.getInspectionState(input.organizationId, candidate.work.id);
        if (!before.current) await repository.ensurePendingInspection({ organizationId: input.organizationId,
          workId: candidate.work.id, now: input.now });
        const stateBeforeDeliveries = await repository.getInspectionState(input.organizationId, candidate.work.id);
        const deliveries = await repository.listDeliveries(input.organizationId, candidate.work.id);
        const stateAfterDeliveries = await repository.getInspectionState(input.organizationId, candidate.work.id);
        if (JSON.stringify(stateBeforeDeliveries) !== JSON.stringify(stateAfterDeliveries)) {
          throw failure("WORK_DELIVERY_PROJECTION_INVALID");
        }
        const status = deliveryStatus(stateAfterDeliveries.current, deliveries);
        if (input.deliveryStatus !== "all" && status !== input.deliveryStatus) {
          throw failure("WORK_DELIVERY_PROJECTION_INVALID");
        }
        items.push({ work: clone(candidate.work), current_inspection: clone(stateAfterDeliveries.current),
          inspection_history: clone(stateAfterDeliveries.history), deliveries: clone(deliveries), delivery_status: status });
      }
      const selectedWorkId = input.anchorWorkId && items.some((item) => item.work.id === input.anchorWorkId)
        ? input.anchorWorkId : null;
      return { items, pagination: { page, page_size: input.pageSize, total_items: totalItems, total_pages: totalPages },
        selected_work_id: selectedWorkId };
    }
  };
}

const candidateCte = `
  WITH candidate_state AS (
    SELECT w.*,
      po.product_id AS library_product_id,
      po.input_snapshot #>> '{product_revision_snapshot,project_id}' AS library_project_id,
      po.input_snapshot #>> '{product_revision_snapshot,product_name}' AS library_product_name,
      po.input_snapshot #>> '{product_revision_snapshot,organization_id}' AS library_snapshot_organization_id,
      po.input_snapshot #>> '{product_revision_snapshot,product_id}' AS library_snapshot_product_id,
      COALESCE(ci.status, 'pending') AS library_inspection_status,
      EXISTS (
        SELECT 1 FROM work_delivery_records d
        WHERE d.organization_id=w.organization_id AND d.work_id=w.id
      ) AS library_has_delivery
    FROM works w
    JOIN production_orders po
      ON po.organization_id=w.organization_id AND po.id=w.production_order_id
    LEFT JOIN LATERAL (
      SELECT i.status FROM work_inspections i
      WHERE i.organization_id=w.organization_id AND i.work_id=w.id AND i.status <> 'superseded'
      ORDER BY i.revision DESC,i.id DESC LIMIT 1
    ) ci ON true
    WHERE w.organization_id=$1
  ), projected AS (
    SELECT *, CASE
      WHEN library_inspection_status='rework_required' THEN 'rework_required'
      WHEN library_has_delivery THEN 'delivered'
      WHEN library_inspection_status='passed' THEN 'deliverable'
      ELSE 'pending_review'
    END AS library_delivery_status
    FROM candidate_state
    WHERE ($2::text IS NULL OR library_project_id=$2)
  ), filtered AS (
    SELECT * FROM projected
    WHERE $3::text='all' OR library_delivery_status=$3
  ), ranked AS (
    SELECT *, row_number() OVER (ORDER BY created_at DESC,id DESC) AS library_rank
    FROM filtered
  )`;

async function repeatableRead(pool, callback) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const value = await callback(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    if (error?.code === "40001" || error?.code === "40P01" ||
        (error?.code === "23505" && error?.constraint === "work_inspections_organization_id_work_id_revision_key")) {
      throw failure("WORK_DELIVERY_PROJECTION_INVALID");
    }
    throw error;
  } finally {
    client.release();
  }
}

function groupByWork(rows, projector) {
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.work_id)) grouped.set(row.work_id, []);
    grouped.get(row.work_id).push(projector(row));
  }
  return grouped;
}

export function createPostgresWorkLibraryReadPort({ pool } = {}) {
  if (!pool?.connect || !pool?.query) throw new TypeError("pool is required");

  return {
    async listPage(input) {
      return repeatableRead(pool, async (client) => {
        const parameters = [input.organizationId, input.projectId || null, input.deliveryStatus, input.anchorWorkId || null];
        const stats = (await client.query(`${candidateCte}
          SELECT count(*)::int AS total_items,
            max(CASE WHEN id::text=$4::text THEN library_rank END)::int AS anchor_rank
          FROM ranked`, parameters)).rows[0];
        const totalItems = Number(stats?.total_items || 0);
        const totalPages = totalItems ? Math.ceil(totalItems / input.pageSize) : 0;
        const desiredPage = input.explicitPage ? input.requestedPage
          : stats?.anchor_rank ? Math.floor((Number(stats.anchor_rank) - 1) / input.pageSize) + 1 : 1;
        const page = totalPages ? Math.min(desiredPage, totalPages) : 1;
        const start = (page - 1) * input.pageSize + 1;
        const end = page * input.pageSize;
        const pageRows = (await client.query(`${candidateCte}
          SELECT * FROM ranked WHERE library_rank BETWEEN $4 AND $5 ORDER BY library_rank`,
        [input.organizationId, input.projectId || null, input.deliveryStatus, start, end])).rows;
        const workIds = pageRows.map((row) => row.id);

        if (workIds.length) {
          const locked = await client.query(
            "SELECT id FROM works WHERE organization_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
            [input.organizationId, workIds]
          );
          if (locked.rowCount !== workIds.length) throw failure("WORK_DELIVERY_PROJECTION_INVALID");
          const current = await client.query(
            `SELECT DISTINCT ON (work_id) work_id,id FROM work_inspections
             WHERE organization_id=$1 AND work_id=ANY($2::uuid[]) AND status <> 'superseded'
             ORDER BY work_id,revision DESC,id DESC`, [input.organizationId, workIds]
          );
          const present = new Set(current.rows.map((row) => row.work_id));
          for (const workId of workIds.filter((id) => !present.has(id))) {
            const inspectionId = randomUUID();
            await client.query(
              `INSERT INTO work_inspections
                 (id,organization_id,work_id,status,revision,category,reason,target_upstream_stage,inspected_by_member_id,
                  inspected_at,superseded_by_inspection_id,created_at,updated_at)
               VALUES ($1,$2,$3,'pending',1,NULL,NULL,NULL,NULL,$4,NULL,$4,$4)`,
              [inspectionId, input.organizationId, workId, input.now]
            );
            await client.query(
              `INSERT INTO work_delivery_status_ledger
                 (id,organization_id,work_id,inspection_id,from_status,to_status,reason,created_at)
               VALUES ($1,$2,$3,$4,NULL,'pending',NULL,$5)`,
              [randomUUID(), input.organizationId, workId, inspectionId, input.now]
            );
            await client.query(
              `INSERT INTO work_delivery_audit_events
                 (id,organization_id,actor_member_id,work_id,inspection_id,delivery_id,event_type,metadata,created_at)
               VALUES ($1,$2,NULL,$3,$4,NULL,'work_inspection.pending_created','{}'::jsonb,$5)`,
              [randomUUID(), input.organizationId, workId, inspectionId, input.now]
            );
          }
        }

        const inspections = workIds.length ? (await client.query(
          `SELECT * FROM work_inspections WHERE organization_id=$1 AND work_id=ANY($2::uuid[])
           ORDER BY work_id,revision,id`, [input.organizationId, workIds]
        )).rows : [];
        const deliveries = workIds.length ? (await client.query(
          `SELECT * FROM work_delivery_records WHERE organization_id=$1 AND work_id=ANY($2::uuid[])
           ORDER BY work_id,delivered_at,id`, [input.organizationId, workIds]
        )).rows : [];
        const inspectionByWork = groupByWork(inspections, inspectionProjection);
        const deliveryByWork = groupByWork(deliveries, deliveryProjection);
        const items = pageRows.map((row) => {
          if ((row.library_snapshot_organization_id && row.library_snapshot_organization_id !== input.organizationId) ||
              (row.library_snapshot_product_id && row.library_snapshot_product_id !== row.library_product_id)) {
            throw failure("WORK_DELIVERY_PROJECTION_INVALID");
          }
          const history = inspectionByWork.get(row.id) || [];
          const active = history.filter((inspection) => inspection.status !== "superseded");
          if (active.length !== 1) throw failure("WORK_DELIVERY_PROJECTION_INVALID");
          const workDeliveries = deliveryByWork.get(row.id) || [];
          const status = deliveryStatus(active[0], workDeliveries);
          if (input.deliveryStatus !== "all" && status !== input.deliveryStatus) {
            throw failure("WORK_DELIVERY_PROJECTION_INVALID");
          }
          return { work: workProjection(row), current_inspection: active[0], inspection_history: history,
            deliveries: workDeliveries, delivery_status: status };
        });
        const selectedWorkId = input.anchorWorkId && items.some((item) => item.work.id === input.anchorWorkId)
          ? input.anchorWorkId : null;
        return { items, pagination: { page, page_size: input.pageSize, total_items: totalItems, total_pages: totalPages },
          selected_work_id: selectedWorkId };
      });
    }
  };
}
