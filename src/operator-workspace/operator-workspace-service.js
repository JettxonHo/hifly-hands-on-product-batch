const STAGES = Object.freeze(["product_content", "copy", "avatar", "video_plan", "production"]);
const STAGE_SET = new Set(STAGES);
const PROJECTION_VERSION = 1;
const ACTION_REGISTRY_VERSION = 1;

const failure = (code, details = {}) => Object.assign(new Error(code), { code, ...details });
const text = (value) => typeof value === "string" ? value.trim() : "";

function notFound() {
  return failure("OPERATOR_WORKSPACE_NOT_FOUND");
}

function unavailable(cause) {
  return failure("OPERATOR_WORKSPACE_UNAVAILABLE", { cause });
}

function legacyStage(code) {
  return {
    code,
    implementation_status: "legacy",
    read_status: "not_loaded",
    navigation_state: null,
    business_status: null,
    blocker_codes: [],
    current_object: null
  };
}

function blockersFor(revision) {
  const blockers = [];
  if (!text(revision.product_name)) blockers.push("PRODUCT_NAME_REQUIRED");
  if (!Array.isArray(revision.selling_points) || !revision.selling_points.some((point) => point?.confirmed === true && text(point.text))) {
    blockers.push("SELLING_POINT_REQUIRED");
  }
  if (!Array.isArray(revision.asset_version_ids) || revision.asset_version_ids.length < 1) blockers.push("IMAGE_REQUIRED");
  return blockers;
}

function actionFor(revision, blockerCodes) {
  if (revision.status === "ready") return { code: "continue_to_copy", stage: "product_content", kind: "navigate" };
  if (blockerCodes.length > 0) return { code: "review_product_blockers", stage: "product_content", kind: "focus" };
  return { code: "mark_product_content_ready", stage: "product_content", kind: "command" };
}

function productContentStage({ project, product, revision, requestedStage }) {
  const blockerCodes = revision.status === "ready" ? [] : blockersFor(revision);
  const businessStatus = revision.status === "ready"
    ? "商品资料已就绪"
    : blockerCodes.length > 0
      ? "商品资料待完善"
      : "商品资料可设为就绪";
  return {
    code: "product_content",
    implementation_status: "workspace",
    read_status: "ok",
    navigation_state: requestedStage === "product_content" ? "current" : "available",
    business_status: businessStatus,
    blocker_codes: blockerCodes,
    current_object: { type: "product_revision", id: revision.id }
  };
}

function projectProductRevision(project, projectId, productId, organizationId) {
  if (!project) throw notFound();
  if (!text(project.id) || !Array.isArray(project.products)) throw unavailable();
  if (project.id !== projectId) throw notFound();
  if (project.organization_id != null && project.organization_id !== organizationId) throw notFound();
  const product = project.products.find((candidate) => candidate?.id === productId);
  if (!product) throw notFound();
  if (product.project_id != null && product.project_id !== project.id) throw notFound();
  if (product.organization_id != null && product.organization_id !== organizationId) throw notFound();

  const currentRevisionId = product.current_revision_id;
  const revision = product.revision;
  if (!text(currentRevisionId) || !revision || revision.id !== currentRevisionId) throw unavailable();
  if (revision.organization_id != null && revision.organization_id !== organizationId) throw notFound();
  if (revision.project_id != null && revision.project_id !== project.id) throw notFound();
  if (revision.product_id != null && revision.product_id !== product.id) throw notFound();
  if (!new Set(["draft", "ready"]).has(revision.status)) throw unavailable();
  return { product, revision };
}

export function createOperatorWorkspaceService({ projectContentService } = {}) {
  if (!projectContentService?.getProject) throw new TypeError("projectContentService.getProject is required");

  async function getWorkspace(input = {}) {
    const requestedStage = input.stage === undefined ? "product_content" : input.stage;
    if (!STAGE_SET.has(requestedStage)) throw failure("INVALID_OPERATOR_WORKSPACE_STAGE");
    if (!text(input.organizationId) || !text(input.actorMemberId) || !text(input.projectId) || !text(input.productId)) {
      throw notFound();
    }

    let project;
    try {
      project = await projectContentService.getProject({
        organizationId: input.organizationId,
        actorMemberId: input.actorMemberId,
        projectId: input.projectId
      });
    } catch (error) {
      if (["PROJECT_NOT_FOUND", "PRODUCT_NOT_FOUND"].includes(error?.code)) throw notFound();
      throw unavailable(error);
    }

    let selected;
    try {
      selected = projectProductRevision(project, input.projectId, input.productId, input.organizationId);
    } catch (error) {
      if (error?.code === "OPERATOR_WORKSPACE_NOT_FOUND" || error?.code === "OPERATOR_WORKSPACE_UNAVAILABLE") throw error;
      throw unavailable(error);
    }

    const { product, revision } = selected;
    const productContent = productContentStage({ project, product, revision, requestedStage });
    const stages = [productContent, ...STAGES.slice(1).map(legacyStage)];
    const isProductContent = requestedStage === "product_content";
    return {
      project: { id: project.id, name: project.name ?? null },
      product: { id: product.id, name: revision.product_name ?? product.name ?? null, current_revision_id: revision.id },
      projection_version: PROJECTION_VERSION,
      action_registry_version: ACTION_REGISTRY_VERSION,
      requested_stage: requestedStage,
      render_mode: isProductContent ? "workspace" : "legacy",
      recommended_stage: isProductContent ? "product_content" : null,
      recommended_action: isProductContent ? actionFor(revision, productContent.blocker_codes) : null,
      stages
    };
  }

  return { getWorkspace };
}

export { ACTION_REGISTRY_VERSION, PROJECTION_VERSION, STAGES as OPERATOR_WORKSPACE_STAGES };
