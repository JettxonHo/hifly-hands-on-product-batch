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

function latest(values = []) {
  return values.at(-1) || null;
}

function currentCopyVersion(values = []) {
  return values.find((value) => value?.status === "draft") || latest(values);
}

function publicCopyVersion(value) {
  return value ? {
    id: value.id,
    status: value.status,
    version_number: value.version_number,
    row_version: value.row_version,
    body: value.body,
    product_revision_id: value.product_revision_id
  } : null;
}

function publicGeneration(job) {
  return job ? {
    current_job_id: job.id,
    status: job.status,
    failure_code: job.failure_code || null,
    attempts: job.attempts,
    max_attempts: job.max_attempts
  } : { current_job_id: null, status: "not_started", failure_code: null, attempts: 0, max_attempts: null };
}

function publicQuality(details) {
  const run = details?.quality_run;
  const result = details?.quality_result;
  return run ? {
    run_id: run.id,
    result_id: result?.id || null,
    status: run.status,
    attempts: run.attempts,
    max_attempts: run.max_attempts,
    conclusion: result?.effective_conclusion || result?.conclusion || null,
    current_valid: result?.current_valid ?? null,
    invalidation_reason: result?.invalidation_reason || null,
    findings: details.quality_findings || []
  } : {
    run_id: null,
    result_id: null,
    status: "not_started",
    attempts: 0,
    max_attempts: null,
    conclusion: null,
    current_valid: null,
    invalidation_reason: null,
    findings: []
  };
}

function publicReview(state) {
  const review = state?.current_review;
  return {
    review_id: review?.id || null,
    status: review?.status || "not_submitted",
    row_version: review?.row_version || null,
    can_submit: state?.gate?.can_submit === true,
    can_approve: state?.gate?.can_approve === true,
    reasons: state?.gate?.reasons || []
  };
}

function copyState({ revision, copy, currentCopyId, versions, generation, quality, review, requestedStage, actorRole }) {
  const generationStatus = generation.status;
  const reviewStatus = review.status;
  const activeGeneration = ["queued", "running"].includes(generationStatus);
  const activeQuality = ["queued", "running"].includes(quality.status);
  let businessStatus = "尚未生成文案";
  let blockerCodes = ["COPY_REQUIRED"];
  let action = null;
  const historical = Boolean(copy && currentCopyId && copy.id !== currentCopyId);

  if (revision.status !== "ready") {
    businessStatus = "商品资料尚未就绪";
    blockerCodes = ["PRODUCT_CONTENT_NOT_READY"];
    action = { code: "return_to_product_content", stage: "copy", kind: "navigate" };
  } else if (historical) {
    businessStatus = "历史文案版本";
    blockerCodes = ["COPY_VERSION_HISTORICAL"];
    action = { code: "return_to_current_copy_version", stage: "copy", kind: "navigate" };
  } else if (!copy) {
    if (activeGeneration) {
      businessStatus = generationStatus === "queued" ? "文案生成已排队" : "正在生成文案";
      blockerCodes = ["COPY_GENERATION_IN_PROGRESS"];
    } else if (["failed", "timed_out"].includes(generationStatus)) {
      businessStatus = "文案生成未完成";
      blockerCodes = ["COPY_GENERATION_FAILED"];
      if (generationStatus === "failed" && generation.attempts < generation.max_attempts) {
        action = { code: "retry_copy_generation", stage: "copy", kind: "command" };
      } else action = { code: "request_copy_generation", stage: "copy", kind: "command" };
    } else action = { code: "request_copy_generation", stage: "copy", kind: "command" };
  } else if (reviewStatus === "approved" && review.reasons.length === 0) {
    businessStatus = "文案已批准";
    blockerCodes = [];
    action = { code: "continue_to_avatar", stage: "copy", kind: "navigate" };
  } else if (reviewStatus === "pending") {
    businessStatus = "文案待人工审核";
    blockerCodes = ["HUMAN_REVIEW_REQUIRED"];
    if (review.can_approve && actorRole === "admin") action = { code: "approve_copy_review", stage: "copy", kind: "command" };
  } else if (["changes_requested", "revoked"].includes(reviewStatus)) {
    businessStatus = reviewStatus === "changes_requested" ? "审核要求修改文案" : "文案批准已失效";
    blockerCodes = [reviewStatus === "changes_requested" ? "COPY_CHANGES_REQUIRED" : "COPY_APPROVAL_REVOKED"];
    action = { code: "derive_copy_draft", stage: "copy", kind: "focus" };
  } else if (quality.current_valid === false) {
    businessStatus = "质检结论已失效";
    blockerCodes = ["COPY_QUALITY_INVALIDATED"];
    action = { code: "start_copy_quality", stage: "copy", kind: "command" };
  } else if (activeQuality) {
    businessStatus = quality.status === "queued" ? "文案质检已排队" : "正在质检文案";
    blockerCodes = ["COPY_QUALITY_IN_PROGRESS"];
  } else if (["failed", "timed_out"].includes(quality.status)) {
    businessStatus = "文案质检未完成";
    blockerCodes = ["COPY_QUALITY_FAILED"];
    action = quality.status === "failed" && quality.attempts < quality.max_attempts
      ? { code: "retry_copy_quality", stage: "copy", kind: "command" }
      : { code: "start_copy_quality", stage: "copy", kind: "command" };
  } else if (quality.conclusion === "passed" && review.can_submit) {
    businessStatus = "质检已通过，待提交人工审核";
    blockerCodes = ["HUMAN_REVIEW_REQUIRED"];
    action = { code: "submit_copy_review", stage: "copy", kind: "command" };
  } else if (["blocked", "needs_review", "invalid"].includes(quality.conclusion)) {
    businessStatus = quality.conclusion === "needs_review" ? "质检需要人工判断" : "文案质检未通过";
    blockerCodes = [quality.conclusion === "needs_review" ? "COPY_QUALITY_NEEDS_REVIEW" : "COPY_QUALITY_BLOCKED"];
    action = { code: "review_copy_quality", stage: "copy", kind: "focus" };
  } else {
    businessStatus = copy.status === "draft" ? "文案草稿待质检" : "文案待质检";
    blockerCodes = ["COPY_QUALITY_REQUIRED"];
    action = { code: "start_copy_quality", stage: "copy", kind: "command" };
  }

  return {
    stage: {
      code: "copy",
      implementation_status: "workspace",
      read_status: "ok",
      navigation_state: historical ? "history" : requestedStage === "copy" ? "current" : "available",
      business_status: businessStatus,
      blocker_codes: blockerCodes,
      current_object: copy ? { type: "copy_version", id: copy.id } : null,
      current_copy_version_id: currentCopyId || null,
      versions: versions.map(publicCopyVersion),
      generation,
      copy_version: publicCopyVersion(copy),
      quality,
      human_review: review
    },
    action
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

export function createOperatorWorkspaceService({ projectContentService, copyService = null,
  qualityService = null, reviewService = null } = {}) {
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
    let copyProjection = { stage: legacyStage("copy"), action: null };
    const copyWorkspaceEnabled = copyService?.listCopyVersions && copyService?.listGenerationJobs &&
      qualityService?.listQualityRuns && qualityService?.getQualityRun && reviewService?.getReviewState;
    if (copyWorkspaceEnabled) {
      try {
        const context = { organizationId: input.organizationId, actorMemberId: input.actorMemberId };
        const [copies, jobs] = await Promise.all([
          copyService.listCopyVersions({ ...context, productRevisionId: revision.id }),
          copyService.listGenerationJobs({ ...context, productRevisionId: revision.id })
        ]);
        const currentCopy = currentCopyVersion(copies);
        const copy = input.copyVersionId ? copies.find((value) => value.id === input.copyVersionId) : currentCopy;
        if (input.copyVersionId && !copy) throw notFound();
        if (copy && (copy.organization_id !== input.organizationId || copy.project_id !== project.id ||
          copy.product_id !== product.id || copy.product_revision_id !== revision.id)) throw notFound();
        let quality = publicQuality(null);
        let review = publicReview(null);
        if (copy) {
          const runs = await qualityService.listQualityRuns({ ...context, copyVersionId: copy.id });
          const currentRun = latest(runs);
          if (currentRun) quality = publicQuality(await qualityService.getQualityRun({ ...context, qualityRunId: currentRun.id }));
          review = publicReview(await reviewService.getReviewState({ ...context, copyVersionId: copy.id }));
        }
        copyProjection = copyState({ revision, copy, currentCopyId: currentCopy?.id || null, versions: copies,
          generation: publicGeneration(latest(jobs)), quality, review, requestedStage, actorRole: input.actorRole });
      } catch (error) {
        if (error?.code === "OPERATOR_WORKSPACE_NOT_FOUND") throw error;
        if (requestedStage === "copy") throw unavailable(error);
        copyProjection = { stage: { ...legacyStage("copy"), implementation_status: "workspace", read_status: "error" }, action: null };
      }
    }
    const stages = [productContent, copyProjection.stage, ...STAGES.slice(2).map(legacyStage)];
    const isProductContent = requestedStage === "product_content";
    const isCopy = requestedStage === "copy" && copyWorkspaceEnabled;
    return {
      project: { id: project.id, name: project.name ?? null },
      product: { id: product.id, name: revision.product_name ?? product.name ?? null, current_revision_id: revision.id },
      projection_version: PROJECTION_VERSION,
      action_registry_version: ACTION_REGISTRY_VERSION,
      requested_stage: requestedStage,
      render_mode: isProductContent || isCopy ? "workspace" : "legacy",
      recommended_stage: isProductContent ? "product_content" : isCopy ? "copy" : null,
      recommended_action: isProductContent ? actionFor(revision, productContent.blocker_codes) : isCopy ? copyProjection.action : null,
      stages
    };
  }

  return { getWorkspace };
}

export { ACTION_REGISTRY_VERSION, PROJECTION_VERSION, STAGES as OPERATOR_WORKSPACE_STAGES };
