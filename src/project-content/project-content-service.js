import { randomUUID } from "node:crypto";

const failure = (code, details = {}) => Object.assign(new Error(code), { code, ...details });
const text = (value) => typeof value === "string" ? value.trim() : "";
const optionalText = (value) => value == null || text(value) === "" ? null : text(value);

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateContext(input) {
  if (!text(input.organizationId) || !text(input.actorMemberId)) throw failure("PROJECT_CONTENT_CONTEXT_REQUIRED");
}

function validateIdempotencyKey(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 128) throw failure("INVALID_IDEMPOTENCY_KEY");
  return value;
}

function normalizeBrief(value) {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw failure("INVALID_CONTENT_BRIEF");
  const normalized = {};
  for (const [key, field] of Object.entries(value)) {
    if (field != null && typeof field !== "string") throw failure("INVALID_CONTENT_BRIEF");
    const clean = optionalText(field);
    if (clean) normalized[key] = clean;
  }
  return Object.keys(normalized).length ? normalized : null;
}

function normalizePointInputs(inputs, previous = []) {
  if (!Array.isArray(inputs)) throw failure("INVALID_SELLING_POINTS");
  const byId = new Map(previous.map((point) => [point.id, point]));
  const seen = new Set();
  return inputs.map((input) => {
    if (!input || typeof input !== "object") throw failure("INVALID_SELLING_POINTS");
    const existing = input.id ? byId.get(input.id) : null;
    if (input.id && (!existing || seen.has(input.id))) throw failure("INVALID_SELLING_POINT_ID");
    const id = existing?.id || randomUUID();
    seen.add(id);
    const value = text(input.text);
    return { id, text: value, confirmed: Boolean(existing?.confirmed && existing.text === value) };
  });
}

function immutableClone(value) {
  const cloned = structuredClone(value);
  const freeze = (item) => {
    if (item && typeof item === "object" && !Object.isFrozen(item)) {
      Object.freeze(item);
      for (const child of Object.values(item)) freeze(child);
    }
    return item;
  };
  return freeze(cloned);
}

function snapshotFields(revision) {
  return {
    product_name: revision.product_name,
    product_description: revision.product_description,
    primary_category: revision.primary_category,
    content_brief: revision.content_brief,
    asset_version_ids: revision.asset_version_ids,
    selling_points: revision.selling_points
  };
}

export function createProjectContentService({ repository, assetReferencePort, now = Date.now } = {}) {
  if (!repository || !assetReferencePort?.bindAvailableVersion) throw new TypeError("repository and assetReferencePort are required");
  const timestamp = () => new Date(now()).toISOString();
  const receiptKey = (input, command) => `${input.organizationId}:${input.actorMemberId}:${command}:${validateIdempotencyKey(input.idempotencyKey)}`;

  async function replayOrRun(uow, key, fingerprint, work) {
    const receipt = await uow.findReceipt(key);
    if (receipt) {
      if (receipt.payload_fingerprint !== fingerprint) throw failure("IDEMPOTENCY_CONFLICT");
      return receipt.response_json;
    }
    const response = await work();
    await uow.insertReceipt(key, { payload_fingerprint: fingerprint, response_json: response });
    return response;
  }

  async function createProject(input) {
    validateContext(input);
    const name = text(input.name);
    if (!name) throw failure("PROJECT_NAME_REQUIRED");
    const normalized = { name, description: optionalText(input.description), delivery_date: optionalText(input.deliveryDate) };
    return repository.transaction(async (uow) => replayOrRun(uow, receiptKey(input, "create_project"), stableJson(normalized), async () => {
      const createdAt = timestamp();
      const project = { id: randomUUID(), organization_id: input.organizationId, ...normalized, created_by_member_id: input.actorMemberId, created_at: createdAt, updated_at: createdAt };
      await uow.insertProject(project);
      await uow.appendAudit({ id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, event_type: "project.created", project_id: project.id, created_at: createdAt });
      return project;
    }));
  }

  async function listProjects(input) {
    validateContext(input);
    return repository.transaction((uow) => uow.listProjects(input.organizationId));
  }

  async function getProject(input) {
    validateContext(input);
    return repository.transaction(async (uow) => {
      const project = await uow.findProject(input.organizationId, input.projectId);
      if (!project) throw failure("PROJECT_NOT_FOUND");
      const products = await uow.listProductsByProject(input.organizationId, project.id);
      const enriched = [];
      for (const product of products) {
        const revision = await uow.findRevision(input.organizationId, product.current_revision_id);
        enriched.push({ ...product, revision });
      }
      return { ...project, products: enriched };
    });
  }

  async function createProduct(input) {
    validateContext(input);
    const productName = text(input.productName);
    const normalized = { project_id: input.projectId, product_name: productName };
    return repository.transaction(async (uow) => replayOrRun(uow, receiptKey(input, "create_product"), stableJson(normalized), async () => {
      const project = await uow.findProject(input.organizationId, input.projectId);
      if (!project) throw failure("PROJECT_NOT_FOUND");
      const createdAt = timestamp();
      const product = { id: randomUUID(), organization_id: input.organizationId, project_id: project.id, current_revision_id: null, created_by_member_id: input.actorMemberId, created_at: createdAt, updated_at: createdAt };
      const revision = {
        id: randomUUID(), organization_id: input.organizationId, project_id: project.id, product_id: product.id,
        status: "draft", revision_number: 1, product_name: productName, product_description: null,
        primary_category: "general", content_brief: null, asset_version_ids: [], selling_points: [],
        parent_revision_id: null, created_by_member_id: input.actorMemberId, created_at: createdAt, updated_at: createdAt, ready_at: null
      };
      product.current_revision_id = revision.id;
      await uow.insertProduct(product);
      await uow.insertRevision(revision);
      await uow.appendAudit({ id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, event_type: "product.created", project_id: project.id, product_id: product.id, product_revision_id: revision.id, created_at: createdAt });
      return { product, revision };
    }));
  }

  async function getRevision(input) {
    validateContext(input);
    return repository.transaction(async (uow) => {
      const revision = await uow.findRevision(input.organizationId, input.productRevisionId);
      if (!revision) throw failure("PRODUCT_REVISION_NOT_FOUND");
      return revision;
    });
  }

  async function saveRevision(input) {
    validateContext(input);
    return repository.transaction(async (uow) => {
      const current = await uow.findRevision(input.organizationId, input.productRevisionId);
      if (!current) throw failure("PRODUCT_REVISION_NOT_FOUND");
      if (current.revision_number !== input.expectedRevision) throw failure("PRODUCT_REVISION_CONFLICT");
      if (current.status === "superseded") throw failure("PRODUCT_REVISION_IMMUTABLE");
      const product = await uow.findProduct(input.organizationId, current.product_id);
      if (!product || product.current_revision_id !== current.id) throw failure("PRODUCT_REVISION_CONFLICT");
      const updatedAt = timestamp();
      const changed = {
        product_name: text(input.productName), product_description: optionalText(input.productDescription),
        primary_category: optionalText(input.primaryCategory) || "general", content_brief: normalizeBrief(input.contentBrief),
        asset_version_ids: [...new Set(Array.isArray(input.assetVersionIds) ? input.assetVersionIds.filter((id) => typeof id === "string" && id) : [])],
        selling_points: normalizePointInputs(input.sellingPoints, current.selling_points)
      };
      if (current.status === "ready" && stableJson(changed) === stableJson(snapshotFields(current))) return current;
      let revision;
      if (current.status === "ready") {
        revision = { ...current, ...changed, id: randomUUID(), status: "draft", revision_number: 1, parent_revision_id: current.id, created_by_member_id: input.actorMemberId, created_at: updatedAt, updated_at: updatedAt, ready_at: null };
        await uow.insertRevision(revision);
        product.current_revision_id = revision.id; product.updated_at = updatedAt;
        await uow.insertProduct(product);
      } else {
        revision = { ...current, ...changed, revision_number: current.revision_number + 1, updated_at: updatedAt };
        await uow.updateRevision(revision);
      }
      await uow.appendAudit({ id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, event_type: current.status === "ready" ? "product_revision.child_draft_created" : "product_revision.saved", project_id: current.project_id, product_id: current.product_id, product_revision_id: revision.id, created_at: updatedAt });
      return revision;
    });
  }

  async function confirmSellingPoint(input) {
    validateContext(input);
    return repository.transaction(async (uow) => {
      const revision = await uow.findRevision(input.organizationId, input.productRevisionId);
      if (!revision) throw failure("PRODUCT_REVISION_NOT_FOUND");
      if (revision.status !== "draft") throw failure("PRODUCT_REVISION_IMMUTABLE");
      if (revision.revision_number !== input.expectedRevision) throw failure("PRODUCT_REVISION_CONFLICT");
      const point = revision.selling_points.find((item) => item.id === input.pointId);
      if (!point) throw failure("SELLING_POINT_NOT_FOUND");
      if (!text(point.text)) throw failure("SELLING_POINT_EMPTY");
      point.confirmed = true;
      revision.revision_number += 1; revision.updated_at = timestamp();
      await uow.updateRevision(revision);
      await uow.appendAudit({ id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, event_type: "selling_point.confirmed", project_id: revision.project_id, product_id: revision.product_id, product_revision_id: revision.id, metadata: { selling_point_id: point.id }, created_at: revision.updated_at });
      return revision;
    });
  }

  async function readyRevision(input) {
    validateContext(input);
    return repository.transaction(async (uow) => {
      const key = receiptKey(input, "ready_revision");
      const fingerprint = stableJson({ product_revision_id: input.productRevisionId, expected_revision: input.expectedRevision });
      return replayOrRun(uow, key, fingerprint, async () => {
        const revision = await uow.findRevision(input.organizationId, input.productRevisionId);
        if (!revision) throw failure("PRODUCT_REVISION_NOT_FOUND");
        if (revision.status !== "draft") throw failure("PRODUCT_REVISION_IMMUTABLE");
        if (revision.revision_number !== input.expectedRevision) throw failure("PRODUCT_REVISION_CONFLICT");
        const product = await uow.findProduct(input.organizationId, revision.product_id);
        if (!product || product.current_revision_id !== revision.id) throw failure("PRODUCT_REVISION_CONFLICT");
        const reasons = [];
        if (!text(revision.product_name)) reasons.push({ code: "PRODUCT_NAME_REQUIRED", field: "product_name" });
        if (!revision.selling_points.some((point) => point.confirmed && text(point.text))) reasons.push({ code: "SELLING_POINT_REQUIRED", field: "selling_points" });
        if (revision.asset_version_ids.length < 1) reasons.push({ code: "IMAGE_REQUIRED", field: "asset_version_ids" });
        if (reasons.length) throw failure("PRODUCT_REVISION_READY_BLOCKED", { reasons });
        for (const assetVersionId of revision.asset_version_ids) {
          await assetReferencePort.bindAvailableVersion({ organizationId: input.organizationId, assetVersionId, referenceType: "product_revision", referenceId: revision.id, role: "product_image", transactionClient: uow.transactionClient });
        }
        const readyAt = timestamp();
        revision.status = "ready"; revision.revision_number += 1; revision.ready_at = readyAt; revision.updated_at = readyAt;
        await uow.updateRevision(revision);
        if (revision.parent_revision_id) {
          const parent = await uow.findRevision(input.organizationId, revision.parent_revision_id);
          if (parent?.status === "ready") { parent.status = "superseded"; parent.updated_at = readyAt; await uow.updateRevision(parent); }
        }
        await uow.appendAudit({ id: randomUUID(), organization_id: input.organizationId, actor_member_id: input.actorMemberId, event_type: "product_revision.ready", project_id: revision.project_id, product_id: revision.product_id, product_revision_id: revision.id, created_at: readyAt });
        return revision;
      });
    });
  }

  const productRevisionPort = {
    async getSnapshot({ organizationId, productRevisionId }) {
      return repository.transaction(async (uow) => {
        const revision = await uow.findRevision(organizationId, productRevisionId);
        if (!revision) throw failure("PRODUCT_REVISION_NOT_FOUND");
        return immutableClone(revision);
      });
    },
    async getReadySnapshot({ organizationId, productRevisionId }) {
      return repository.transaction(async (uow) => {
        const revision = await uow.findRevision(organizationId, productRevisionId);
        if (!revision || revision.status !== "ready") throw failure("PRODUCT_REVISION_NOT_FOUND");
        return immutableClone(revision);
      });
    },
    async getCurrentReadySnapshot({ organizationId, productRevisionId }) {
      return repository.transaction(async (uow) => {
        const revision = await uow.findRevision(organizationId, productRevisionId);
        if (!revision || revision.status !== "ready") throw failure("PRODUCT_REVISION_NOT_FOUND");
        const product = await uow.findProduct(organizationId, revision.product_id);
        if (!product || product.current_revision_id !== revision.id) throw failure("PRODUCT_REVISION_NOT_FOUND");
        return immutableClone(revision);
      });
    }
  };

  return { createProject, listProjects, getProject, createProduct, getRevision, saveRevision, confirmSellingPoint, readyRevision, productRevisionPort };
}
