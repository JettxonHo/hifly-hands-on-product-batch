import { createHash, randomUUID } from "node:crypto";

import { createMemoryWorkLibraryReadPort } from "./work-library-read-port.js";

const clean = (value) => typeof value === "string" ? value.trim() : "";
const failure = (code, details = null) => Object.assign(new Error(code), { code, details });
const stableJson = (value) => Array.isArray(value) ? `[${value.map(stableJson).join(",")}]` :
  value && typeof value === "object" ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}` : JSON.stringify(value);

export const REWORK_CATEGORIES = ["content_not_as_planned", "visual_quality", "audio_or_avatar", "file_or_format", "other"];
export const REWORK_TARGET_STAGES = ["video_plan", "copy_review", "avatar_selection", "project_content"];
export const DELIVERY_METHODS = ["manual_transfer", "email", "enterprise_drive", "other"];
export const WORK_LIBRARY_PAGE_SIZE = 6;
export const WORK_LIBRARY_DELIVERY_STATUSES = ["all", "pending_review", "deliverable", "rework_required", "delivered"];

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

function publicLibraryInspection(value) {
  if (!value) return null;
  return {
    id: value.id,
    status: value.status,
    revision: value.revision,
    category: value.category || null,
    reason: value.reason || null,
    target_upstream_stage: value.target_upstream_stage || null,
    inspected_at: value.inspected_at || null,
    created_at: value.created_at || null,
    updated_at: value.updated_at || null
  };
}

function publicLibraryDelivery(value) {
  return {
    id: value.id,
    delivered_at: value.delivered_at,
    delivery_method: value.delivery_method,
    note: value.note || null,
    recipient_reference: value.recipient_reference || null,
    created_at: value.created_at || null
  };
}

function publicLibraryWork(value) {
  return {
    id: value.id,
    status: value.status,
    created_at: value.created_at,
    updated_at: value.updated_at,
    project_id: value.project_id || null,
    product_id: value.product_id || null,
    product_name: value.product_name || null,
    primary_output_media_type: value.primary_output_media_type || null,
    primary_output_size: value.primary_output_size ?? null,
    current_inspection: publicLibraryInspection(value.current_inspection),
    inspection_history: (value.inspection_history || []).map(publicLibraryInspection),
    deliveries: (value.deliveries || []).map(publicLibraryDelivery),
    delivery_count: Number(value.delivery_count || 0),
    delivery_status: value.delivery_status
  };
}

function publicWork(value, state) {
  if (!value) return null;
  const { organization_id: _organizationId, ...safe } = value;
  return { ...safe,
    current_inspection: publicInspection(state.current),
    inspection_history: state.history.map(publicInspection),
    deliveries: state.deliveries.map(publicDelivery),
    delivery_count: state.deliveries.length,
    delivery_status: state.current?.status === "rework_required" ? "rework_required" : state.deliveries.length ? "delivered" : state.current?.status === "passed" ? "deliverable" : "pending_review" };
}

function timestamp(now) { return new Date(now()).toISOString(); }

function validateDate(value, fallback) {
  if (value == null || value === "") return fallback;
  const normalized = new Date(value);
  if (Number.isNaN(normalized.valueOf())) throw failure("WORK_DELIVERY_DATE_INVALID");
  return normalized.toISOString();
}

function positiveInteger(value) {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : null;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function assertLibraryProjection(value, input) {
  if (!value || !Array.isArray(value.items) || value.items.length > input.pageSize || !value.pagination) {
    throw failure("WORK_DELIVERY_PROJECTION_INVALID");
  }
  const pagination = value.pagination;
  if (!Number.isInteger(pagination.page) || pagination.page < 1 || pagination.page_size !== input.pageSize ||
      !Number.isInteger(pagination.total_items) || pagination.total_items < 0 ||
      !Number.isInteger(pagination.total_pages) || pagination.total_pages < 0 ||
      (pagination.total_items === 0 ? pagination.total_pages !== 0 : pagination.total_pages !== Math.ceil(pagination.total_items / input.pageSize))) {
    throw failure("WORK_DELIVERY_PROJECTION_INVALID");
  }
  const ids = new Set();
  const works = value.items.map((item) => {
    const work = item?.work;
    if (!clean(work?.id) || ids.has(work.id) || work.organization_id !== input.organizationId ||
        !["available", "unavailable", "withdrawn"].includes(work.status) ||
        (input.projectId && work.project_id !== input.projectId) ||
        !Array.isArray(item.inspection_history) || !Array.isArray(item.deliveries)) {
      throw failure("WORK_DELIVERY_PROJECTION_INVALID");
    }
    ids.add(work.id);
    const historyIds = new Set();
    const active = [];
    for (const inspection of item.inspection_history) {
      if (!clean(inspection?.id) || historyIds.has(inspection.id) || inspection.organization_id !== input.organizationId ||
          inspection.work_id !== work.id || !["pending", "passed", "rework_required", "superseded"].includes(inspection.status) ||
          !Number.isInteger(Number(inspection.revision)) || Number(inspection.revision) < 1) {
        throw failure("WORK_DELIVERY_PROJECTION_INVALID");
      }
      historyIds.add(inspection.id);
      if (inspection.status !== "superseded") active.push(inspection);
    }
    if (active.length !== 1 || item.current_inspection?.id !== active[0].id) throw failure("WORK_DELIVERY_PROJECTION_INVALID");
    const deliveryIds = new Set();
    for (const delivery of item.deliveries) {
      if (!clean(delivery?.id) || deliveryIds.has(delivery.id) || delivery.organization_id !== input.organizationId ||
          delivery.work_id !== work.id || !DELIVERY_METHODS.includes(delivery.delivery_method)) {
        throw failure("WORK_DELIVERY_PROJECTION_INVALID");
      }
      deliveryIds.add(delivery.id);
    }
    const derivedStatus = active[0].status === "rework_required" ? "rework_required" : item.deliveries.length
      ? "delivered" : active[0].status === "passed" ? "deliverable" : "pending_review";
    if (item.delivery_status !== derivedStatus || (input.deliveryStatus !== "all" && derivedStatus !== input.deliveryStatus)) {
      throw failure("WORK_DELIVERY_PROJECTION_INVALID");
    }
    return publicLibraryWork({ ...work, current_inspection: active[0], inspection_history: item.inspection_history,
      deliveries: item.deliveries, delivery_count: item.deliveries.length, delivery_status: derivedStatus });
  });
  if (value.selected_work_id != null && (value.selected_work_id !== input.anchorWorkId || !ids.has(value.selected_work_id))) {
    throw failure("WORK_DELIVERY_PROJECTION_INVALID");
  }
  return { works, pagination, selected_work_id: value.selected_work_id || null };
}

export function createWorkDeliveryService({ repository, workPort, orderPort = null, assetPort = null,
  libraryReadPort = null, now = Date.now } = {}) {
  if (!repository?.ensurePendingInspection || !repository?.createInspection || !repository?.createDelivery) throw new TypeError("work delivery repository is required");
  if (!workPort?.listWorks || !workPort?.getWork) throw new TypeError("formal work port is required");
  const at = () => timestamp(now);
  const downloadBindings = new Map();
  const workLibrary = libraryReadPort || createMemoryWorkLibraryReadPort({ workPort, orderPort, repository });
  if (!workLibrary?.listPage) throw new TypeError("work library read port is required");

  async function getWorkOrThrow(input) {
    validateActor(input);
    if (!clean(input.workId)) throw failure("WORK_DELIVERY_WORK_NOT_FOUND");
    const work = await workPort.getWork(input.organizationId, input.workId);
    if (!work || work.organization_id !== input.organizationId) throw failure("WORK_DELIVERY_WORK_NOT_FOUND");
    return work;
  }

  async function resolveWorkMetadata(work, input, { strict = false } = {}) {
    if (strict && (!clean(work?.id) || work?.organization_id !== input.organizationId || !clean(work?.production_order_id))) {
      throw failure("WORK_DELIVERY_PROJECTION_INVALID");
    }
    let enriched = { ...work };
    if (orderPort?.getOrder && work.production_order_id) {
      const order = await orderPort.getOrder({ organizationId: input.organizationId, actorMemberId: input.actorMemberId, actorRole: input.actorRole, orderId: work.production_order_id });
      const snapshot = order?.input_snapshot?.product_revision_snapshot || {};
      if (strict && (order?.id !== work.production_order_id || order?.organization_id !== input.organizationId ||
        (work.product_id && order.product_id && work.product_id !== order.product_id) ||
        (snapshot.organization_id && snapshot.organization_id !== input.organizationId) ||
        (snapshot.product_id && order.product_id && snapshot.product_id !== order.product_id))) {
        throw failure("WORK_DELIVERY_PROJECTION_INVALID");
      }
      enriched = { ...enriched, product_name: enriched.product_name || snapshot.product_name || null,
        project_id: enriched.project_id || snapshot.project_id || null, product_id: enriched.product_id || order?.product_id || null };
    }
    return enriched;
  }

  async function projectWork(work, input, { ensureInspection = false, metadataResolved = false } = {}) {
    const enriched = metadataResolved ? { ...work } : await resolveWorkMetadata(work, input);
    const inspection = ensureInspection
      ? await repository.ensurePendingInspection({ organizationId: input.organizationId, workId: work.id, now: at() })
      : null;
    const stateBeforeDeliveries = await repository.getInspectionState(input.organizationId, work.id);
    const deliveries = await repository.listDeliveries(input.organizationId, work.id);
    const stateAfterDeliveries = await repository.getInspectionState(input.organizationId, work.id);
    if (stableJson(stateBeforeDeliveries) !== stableJson(stateAfterDeliveries)) throw failure("WORK_DELIVERY_PROJECTION_INVALID");
    return publicWork(enriched, {
      current: stateAfterDeliveries.current || inspection,
      history: stateAfterDeliveries.history.length ? stateAfterDeliveries.history : inspection ? [inspection] : [],
      deliveries
    });
  }

  const enrichWork = (work, input) => projectWork(work, input, { ensureInspection: true });

  async function listWorks(input) {
    validateActor(input);
    const values = await workPort.listWorks(input.organizationId);
    const result = [];
    for (const value of values.filter((work) => work?.organization_id === input.organizationId)) result.push(await enrichWork(value, input));
    const projectId = clean(input.projectId);
    const deliveryStatus = clean(input.deliveryStatus);
    return result.filter((work) => (!projectId || work.project_id === projectId) && (!deliveryStatus || deliveryStatus === "all" || work.delivery_status === deliveryStatus));
  }

  async function listWorksPage(input) {
    validateActor(input);
    const pageSize = positiveInteger(input.pageSize);
    const explicitPage = input.page !== undefined && input.page !== null && input.page !== "";
    const requestedPage = explicitPage ? positiveInteger(input.page) : 1;
    if (pageSize !== WORK_LIBRARY_PAGE_SIZE || requestedPage === null) throw failure("WORK_DELIVERY_PAGINATION_INVALID");
    const deliveryStatus = clean(input.deliveryStatus) || "all";
    if (deliveryStatus && !WORK_LIBRARY_DELIVERY_STATUSES.includes(deliveryStatus)) throw failure("WORK_DELIVERY_FILTER_INVALID");
    const projectId = clean(input.projectId);
    const anchorWorkId = clean(input.anchorWorkId);
    const projectionInput = { ...input, requestedPage, explicitPage, pageSize, projectId,
      deliveryStatus, anchorWorkId, now: at() };
    const result = await workLibrary.listPage(projectionInput);
    return assertLibraryProjection(result, projectionInput);
  }

  async function getWork(input) {
    const work = await getWorkOrThrow(input);
    return enrichWork(work, input);
  }

  async function getWorkProjection(input) {
    const work = await getWorkOrThrow(input);
    return projectWork(work, input);
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
    const result = await assetPort.createDownloadAuthorization({ organizationId: input.organizationId, assetVersionId: work.primary_asset_version_id });
    const expiresAt = Date.parse(result?.expires_at || "");
    if (!clean(result?.token) || result.asset_version_id !== work.primary_asset_version_id || !Number.isFinite(expiresAt) || expiresAt <= now() ||
        (work.primary_output_media_type && result.verified_content_type !== work.primary_output_media_type) ||
        (work.primary_output_size != null && Number(result.verified_size) !== Number(work.primary_output_size)) ||
        (work.primary_output_checksum && result.verified_checksum_sha256 !== work.primary_output_checksum)) {
      throw failure("WORK_DELIVERY_PROJECTION_INVALID");
    }
    downloadBindings.set(result.token, {
      organizationId: input.organizationId,
      workId: work.id,
      assetVersionId: work.primary_asset_version_id,
      mediaType: result.verified_content_type,
      size: Number(result.verified_size),
      checksumSha256: result.verified_checksum_sha256,
      expiresAt
    });
    return result;
  }

  async function downloadObject(input) {
    const work = await getWorkOrThrow(input);
    if (!assetPort?.downloadObject) throw failure("WORK_DELIVERY_DOWNLOAD_UNAVAILABLE");
    const binding = downloadBindings.get(input.token);
    if (!binding || binding.organizationId !== input.organizationId || binding.workId !== work.id ||
        binding.assetVersionId !== work.primary_asset_version_id || binding.expiresAt <= now()) {
      throw failure("DOWNLOAD_AUTHORIZATION_NOT_FOUND");
    }
    const result = await assetPort.downloadObject({ organizationId: input.organizationId, token: input.token });
    if (!Buffer.isBuffer(result?.body) || result.verified_content_type !== binding.mediaType ||
        Number(result.verified_size) !== binding.size || result.body.length !== binding.size ||
        result.verified_checksum_sha256 !== binding.checksumSha256 ||
        createHash("sha256").update(result.body).digest("hex") !== binding.checksumSha256) {
      throw failure("WORK_DELIVERY_PROJECTION_INVALID");
    }
    return result;
  }

  return { listWorks, listWorksPage, getWork, getWorkProjection, markDeliverable, requestRework, createDelivery, createDownloadAuthorization, downloadObject,
    publicWork, publicInspection, publicDelivery, publicLibraryWork };
}
