import { randomUUID } from "node:crypto";

const clean = (value) => typeof value === "string" ? value.trim() : "";
const failure = (code, details = null) => Object.assign(new Error(code), { code, details });
const stableJson = (value) => Array.isArray(value) ? `[${value.map(stableJson).join(",")}]` :
  value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}` : JSON.stringify(value);

export const REWORK_CATEGORIES = ["content_not_as_planned", "visual_quality", "audio_or_avatar", "file_or_format", "other"];
export const REWORK_TARGET_STAGES = ["video_plan", "copy_review", "avatar_selection", "project_content"];
export const DELIVERY_METHODS = ["manual_transfer", "email", "enterprise_drive", "other"];

function validateActor(input) {
  if (!clean(input.organizationId) || !clean(input.actorMemberId)) throw failure("WORK_DELIVERY_CONTEXT_REQUIRED");
  if (!["member", "admin"].includes(input.actorRole)) throw failure("WORK_DELIVERY_FORBIDDEN");
}

function validateKey(value) {
  if (!clean(value) || value.length > 128) throw failure("INVALID_IDEMPOTENCY_KEY");
  return value.trim();
}

function validateInspectionPrecondition(input) {
  const expectedInspectionId = clean(input.expectedInspectionId);
  const rawRevision = input.expectedRevision;
  const expectedRevision = typeof rawRevision === "number" || (typeof rawRevision === "string" && rawRevision.trim() !== "") ? Number(rawRevision) : NaN;
  if (!expectedInspectionId || !Number.isInteger(expectedRevision) || expectedRevision < 1) throw failure("WORK_DELIVERY_INSPECTION_PRECONDITION_REQUIRED");
  return { expectedInspectionId, expectedRevision };
}

function publicInspection(value) {
  if (!value) return null;
  const { organization_id: _organizationId, ...safe } = value;
  return safe;
}

function publicDelivery(value) {
  if (!value) return null;
  const { organization_id: _organizationId, ...safe } = value;
  return safe;
}

function publicWork(value, state) {
  if (!value) return null;
  const { organization_id: _organizationId, ...safe } = value;
  return { ...safe,
    current_inspection: publicInspection(state.current),
    inspection_history: state.history.map(publicInspection),
    deliveries: state.deliveries.map(publicDelivery),
    delivery_count: state.deliveries.length,
    delivery_status: state.deliveries.length ? "delivered" : state.current?.status === "passed" ? "deliverable" : state.current?.status === "rework_required" ? "rework_required" : "pending_review" };
}

function timestamp(now) { return new Date(now()).toISOString(); }

function validateDate(value, fallback) {
  if (value == null || value === "") return fallback;
  const normalized = new Date(value);
  if (Number.isNaN(normalized.valueOf())) throw failure("WORK_DELIVERY_DATE_INVALID");
  return normalized.toISOString();
}

export function createWorkDeliveryService({ repository, workPort, orderPort = null, assetPort = null, now = Date.now } = {}) {
  if (!repository?.ensurePendingInspection || !repository?.createInspection || !repository?.createDelivery) throw new TypeError("work delivery repository is required");
  if (!workPort?.listWorks || !workPort?.getWork) throw new TypeError("formal work port is required");
  const at = () => timestamp(now);

  async function getWorkOrThrow(input) {
    validateActor(input);
    if (!clean(input.workId)) throw failure("WORK_DELIVERY_WORK_NOT_FOUND");
    const work = await workPort.getWork(input.organizationId, input.workId);
    if (!work || work.organization_id !== input.organizationId) throw failure("WORK_DELIVERY_WORK_NOT_FOUND");
    return work;
  }

  async function enrichWork(work, input) {
    let enriched = { ...work };
    if (orderPort?.getOrder && work.production_order_id) {
      const order = await orderPort.getOrder({ organizationId: input.organizationId, actorMemberId: input.actorMemberId, actorRole: input.actorRole, orderId: work.production_order_id });
      const snapshot = order?.input_snapshot?.product_revision_snapshot || {};
      enriched = { ...enriched, product_name: enriched.product_name || snapshot.product_name || null,
        project_id: enriched.project_id || snapshot.project_id || null, product_id: enriched.product_id || order?.product_id || null };
    }
    const inspection = await repository.ensurePendingInspection({ organizationId: input.organizationId, workId: work.id, now: at() });
    const state = await repository.getInspectionState(input.organizationId, work.id);
    const deliveries = await repository.listDeliveries(input.organizationId, work.id);
    return publicWork(enriched, { current: state.current || inspection, history: state.history.length ? state.history : [inspection], deliveries });
  }

  async function listWorks(input) {
    validateActor(input);
    const values = await workPort.listWorks(input.organizationId);
    const result = [];
    for (const value of values.filter((work) => work?.organization_id === input.organizationId)) result.push(await enrichWork(value, input));
    const projectId = clean(input.projectId);
    const deliveryStatus = clean(input.deliveryStatus);
    return result.filter((work) => (!projectId || work.project_id === projectId) && (!deliveryStatus || deliveryStatus === "all" || work.delivery_status === deliveryStatus));
  }

  async function getWork(input) {
    const work = await getWorkOrThrow(input);
    return enrichWork(work, input);
  }

  async function createInspection(input, status, fields = {}) {
    const work = await getWorkOrThrow(input);
    const precondition = validateInspectionPrecondition(input);
    if (work.status !== "available") throw failure("WORK_DELIVERY_WORK_UNAVAILABLE");
    const state = await repository.getInspectionState(input.organizationId, work.id);
    const current = state.current || await repository.ensurePendingInspection({ organizationId: input.organizationId, workId: work.id, now: at() });
    if (status === "rework_required") {
      if (!REWORK_CATEGORIES.includes(fields.category)) throw failure("WORK_DELIVERY_REWORK_CATEGORY_INVALID");
      if (!clean(fields.reason)) throw failure("WORK_DELIVERY_REWORK_REASON_REQUIRED");
      if (fields.reason.trim().length > 2000) throw failure("WORK_DELIVERY_REWORK_REASON_INVALID");
      if (!REWORK_TARGET_STAGES.includes(fields.targetUpstreamStage)) throw failure("WORK_DELIVERY_REWORK_TARGET_INVALID");
    }
    const key = validateKey(input.idempotencyKey);
    const inspection = { id: randomUUID(), organization_id: input.organizationId, work_id: work.id, status,
      category: status === "rework_required" ? fields.category : null, reason: status === "rework_required" ? fields.reason.trim() : null,
      target_upstream_stage: status === "rework_required" ? fields.targetUpstreamStage : null,
      inspected_by_member_id: input.actorMemberId, inspected_at: at(), superseded_by_inspection_id: null, created_at: at(), updated_at: at() };
    const fingerprint = stableJson({ operation: status, work_id: work.id, category: inspection.category, reason: inspection.reason,
      target_upstream_stage: inspection.target_upstream_stage, expected_inspection_id: precondition.expectedInspectionId,
      expected_revision: precondition.expectedRevision });
    const saved = await repository.createInspection({ receiptKey: `${input.organizationId}:work-inspection:${key}`, fingerprint, inspection,
      expectedInspectionId: precondition.expectedInspectionId, expectedRevision: precondition.expectedRevision,
      audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, work_id: work.id,
        event_type: status === "passed" ? "work_inspection.passed" : "work_inspection.rework_required",
        metadata: { category: inspection.category, target_upstream_stage: inspection.target_upstream_stage }, created_at: inspection.inspected_at } });
    const projected = await enrichWork(work, input);
    return { inspection: publicInspection(saved.inspection), work: projected, replayed: saved.replayed };
  }

  async function markDeliverable(input) { return createInspection(input, "passed"); }

  async function requestRework(input) { return createInspection(input, "rework_required", { category: input.category, reason: input.reason, targetUpstreamStage: input.targetUpstreamStage }); }

  async function createDelivery(input) {
    const work = await getWorkOrThrow(input);
    const precondition = validateInspectionPrecondition(input);
    if (work.status !== "available") throw failure("WORK_DELIVERY_WORK_UNAVAILABLE");
    if (!DELIVERY_METHODS.includes(input.deliveryMethod)) throw failure("WORK_DELIVERY_METHOD_INVALID");
    const note = input.note == null ? null : clean(input.note);
    if (note && note.length > 2000) throw failure("WORK_DELIVERY_NOTE_INVALID");
    const recipientReference = input.recipientReference == null ? null : clean(input.recipientReference);
    if (recipientReference && recipientReference.length > 255) throw failure("WORK_DELIVERY_RECIPIENT_INVALID");
    const deliveredAt = validateDate(input.deliveredAt, at());
    const key = validateKey(input.idempotencyKey);
    const delivery = { id: randomUUID(), organization_id: input.organizationId, work_id: work.id, delivered_by: input.actorMemberId,
      delivered_at: deliveredAt, delivery_method: input.deliveryMethod, note, recipient_reference: recipientReference, created_at: at() };
    const fingerprint = stableJson({ operation: "delivery", work_id: work.id, delivered_at: input.deliveredAt || null, delivery_method: input.deliveryMethod,
      note, recipient_reference: recipientReference,
      expected_inspection_id: precondition.expectedInspectionId, expected_revision: precondition.expectedRevision });
    const saved = await repository.createDelivery({ receiptKey: `${input.organizationId}:work-delivery:${key}`, fingerprint, delivery,
      expectedInspectionId: precondition.expectedInspectionId, expectedRevision: precondition.expectedRevision,
      audit: { id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, work_id: work.id,
        event_type: "delivery_record.created", metadata: { delivery_method: input.deliveryMethod }, created_at: at() } });
    return { delivery: publicDelivery(saved.delivery), work: await enrichWork(work, input), replayed: saved.replayed };
  }

  async function createDownloadAuthorization(input) {
    const work = await getWorkOrThrow(input);
    if (!assetPort?.createDownloadAuthorization) throw failure("WORK_DELIVERY_DOWNLOAD_UNAVAILABLE");
    return assetPort.createDownloadAuthorization({ organizationId: input.organizationId, assetVersionId: work.primary_asset_version_id });
  }

  async function downloadObject(input) {
    await getWorkOrThrow(input);
    if (!assetPort?.downloadObject) throw failure("WORK_DELIVERY_DOWNLOAD_UNAVAILABLE");
    return assetPort.downloadObject({ organizationId: input.organizationId, token: input.token });
  }

  return { listWorks, getWork, markDeliverable, requestRework, createDelivery, createDownloadAuthorization, downloadObject,
    publicWork, publicInspection, publicDelivery };
}
