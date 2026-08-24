import { isDeepStrictEqual } from "node:util";

const STAGES = Object.freeze(["product_content", "copy", "avatar", "video_plan", "production"]);
const STAGE_SET = new Set(STAGES);
const PROJECTION_VERSION = 1;
const ACTION_REGISTRY_VERSION = 1;
const AVATAR_ACTIONS = Object.freeze({
  return_to_copy: Object.freeze({ stage: "avatar", kind: "navigate" }),
  select_avatar: Object.freeze({ stage: "avatar", kind: "focus" }),
  continue_to_video_plan: Object.freeze({ stage: "avatar", kind: "navigate" }),
  retry_avatar_read: Object.freeze({ stage: "avatar", kind: "refresh" })
});
const VIDEO_PLAN_ACTIONS = Object.freeze({
  return_to_avatar: Object.freeze({ stage: "video_plan", kind: "navigate" }),
  create_video_plan: Object.freeze({ stage: "video_plan", kind: "command" }),
  return_to_current_video_plan: Object.freeze({ stage: "video_plan", kind: "navigate" }),
  run_video_plan_preflight: Object.freeze({ stage: "video_plan", kind: "command" }),
  retry_video_plan_preflight: Object.freeze({ stage: "video_plan", kind: "command" }),
  derive_video_plan_draft: Object.freeze({ stage: "video_plan", kind: "command" }),
  submit_video_plan_review: Object.freeze({ stage: "video_plan", kind: "command" }),
  approve_video_plan_review: Object.freeze({ stage: "video_plan", kind: "command" }),
  continue_to_production: Object.freeze({ stage: "video_plan", kind: "navigate" })
});
const PRODUCTION_ACTIONS = Object.freeze({
  return_to_video_plan: Object.freeze({ stage: "production", kind: "navigate" }),
  create_production_order: Object.freeze({ stage: "production", kind: "command" }),
  generate_handoff_package: Object.freeze({ stage: "production", kind: "command" }),
  retry_handoff_package: Object.freeze({ stage: "production", kind: "command" }),
  authorize_handoff_download: Object.freeze({ stage: "production", kind: "command" }),
  view_production_failure_details: Object.freeze({ stage: "production", kind: "focus" }),
  view_verification_details: Object.freeze({ stage: "production", kind: "focus" }),
  review_production_work: Object.freeze({ stage: "production", kind: "navigate" }),
  view_production_rework: Object.freeze({ stage: "production", kind: "navigate" }),
  deliver_production_work: Object.freeze({ stage: "production", kind: "navigate" }),
  view_production_delivery: Object.freeze({ stage: "production", kind: "navigate" }),
  retry_production_read: Object.freeze({ stage: "production", kind: "refresh" })
});

const failure = (code, details = {}) => Object.assign(new Error(code), { code, ...details });
const text = (value) => typeof value === "string" ? value.trim() : "";

function notFound() {
  return failure("OPERATOR_WORKSPACE_NOT_FOUND");
}

function unavailable(cause) {
  return failure("OPERATOR_WORKSPACE_UNAVAILABLE", { cause });
}

function generationMismatch() {
  return failure("VIDEO_PLAN_WORKSPACE_GENERATION_MISMATCH");
}

function legacyStage(code, _readPort = null) {
  // A later-stage port may be injected for zero-read tests, but is intentionally untouched until that Stage migrates.
  void _readPort;
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

function newestGenerationJob(values = []) {
  return values[0] || null;
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

function publicSelection(value) {
  if (!value) return null;
  const keys = ["id", "product_id", "copy_version_id", "asset_version_id", "version_number", "created_by_member_id",
    "status", "row_version", "confirmed_at", "superseded_at", "superseded_by_selection_id", "created_at", "updated_at"];
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]));
}

function publicAvatarWorkspace(value) {
  const copyGate = value?.copy_gate;
  const selection = value?.selection;
  return {
    catalog_kind: value?.catalog_kind,
    provider_integration: value?.provider_integration,
    recommendation: value?.recommendation,
    controlled_seed_notice: value?.controlled_seed_notice,
    resolved_copy_version_id: value?.resolved_copy_version_id || null,
    copy_gate: {
      approved: copyGate?.approved === true,
      reasons: Array.isArray(copyGate?.reasons) ? [...copyGate.reasons] : [],
      copy_version_id: copyGate?.copy_version_id || copyGate?.copy?.copy_version_id || null
    },
    catalog: Array.isArray(value?.catalog) ? structuredClone(value.catalog) : [],
    selection: selection ? {
      current_selection: publicSelection(selection.current_selection),
      selection_revision: selection.selection_revision,
      current_valid: selection.current_valid === true,
      invalidation_reasons: Array.isArray(selection.invalidation_reasons) ? [...selection.invalidation_reasons] : [],
      history: Array.isArray(selection.history) ? selection.history.map(publicSelection) : []
    } : null
  };
}

function registeredAvatarAction(action) {
  if (!action || typeof action !== "object") return null;
  if (!Object.hasOwn(AVATAR_ACTIONS, action.code)) return null;
  const registered = AVATAR_ACTIONS[action.code];
  if (!registered || action.stage !== registered.stage || action.kind !== registered.kind) return null;
  return { code: action.code, stage: action.stage, kind: action.kind };
}

function registeredVideoPlanAction(action) {
  if (!action || typeof action !== "object") return null;
  if (!Object.hasOwn(VIDEO_PLAN_ACTIONS, action.code)) return null;
  const registered = VIDEO_PLAN_ACTIONS[action.code];
  if (!registered || action.stage !== registered.stage || action.kind !== registered.kind) return null;
  return { code: action.code, stage: action.stage, kind: action.kind };
}

const VIDEO_PLAN_PRIVATE_KEYS = new Set(["organization_id", "lease_token", "input_snapshot"]);

function publicVideoPlanValue(value) {
  if (Array.isArray(value)) return value.map(publicVideoPlanValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !VIDEO_PLAN_PRIVATE_KEYS.has(key))
    .map(([key, item]) => [key, publicVideoPlanValue(item)]));
}

function publicVideoPlanWorkspace(value) {
  if (!value || typeof value !== "object") throw unavailable();
  if (value.versions != null && !Array.isArray(value.versions)) throw unavailable();
  const preflight = value.preflight && typeof value.preflight === "object" ? value.preflight : {};
  const review = value.review && typeof value.review === "object" ? value.review : {};
  if (preflight.history != null && !Array.isArray(preflight.history)) throw unavailable();
  if (review.history != null && !Array.isArray(review.history)) throw unavailable();
  return {
    current_plan: publicVideoPlanValue(value.current_plan || null),
    head_revision: value.head_revision,
    versions: (value.versions || []).map(publicVideoPlanValue),
    preflight: {
      current_run: publicVideoPlanValue(preflight.current_run || null),
      current_result: publicVideoPlanValue(preflight.current_result || null),
      history: (preflight.history || []).map(publicVideoPlanValue)
    },
    human_review: {
      current_review: publicVideoPlanValue(review.current_review || null),
      history: (review.history || []).map(publicVideoPlanValue),
      gate: publicVideoPlanValue(review.gate || null)
    }
  };
}

function avatarActionFor(workspace, { copy, selection }) {
  if (Object.hasOwn(workspace || {}, "recommended_action")) return registeredAvatarAction(workspace.recommended_action);
  const reasons = workspace?.copy_gate?.reasons || [];
  if (!copy || workspace?.copy_gate?.approved !== true || reasons.length > 0) {
    return { code: "return_to_copy", stage: "avatar", kind: "navigate" };
  }
  if (!selection?.current_selection || selection.current_valid !== true) {
    return { code: "select_avatar", stage: "avatar", kind: "focus" };
  }
  return { code: "continue_to_video_plan", stage: "avatar", kind: "navigate" };
}

function avatarStage({ project, product, revision, copy, workspace, requestedStage }) {
  const publicWorkspace = publicAvatarWorkspace(workspace);
  const selection = publicWorkspace.selection;
  const currentSelection = selection?.current_selection || null;
  const copyBlocked = !copy || publicWorkspace.copy_gate.approved !== true || publicWorkspace.copy_gate.reasons.length > 0;
  const currentValid = currentSelection && selection.current_valid === true && !copyBlocked;
  const businessStatus = copyBlocked ? "文案尚未批准" : currentValid ? "人物已确认" : currentSelection ? "人物选择已失效" : "人物待确认";
  const blockerCodes = copyBlocked ? ["APPROVED_COPY_REQUIRED"] : currentValid ? [] : currentSelection ? ["AVATAR_SELECTION_INVALID"] : ["AVATAR_SELECTION_REQUIRED"];
  return {
    stage: {
      code: "avatar",
      implementation_status: "workspace",
      read_status: "ok",
      navigation_state: requestedStage === "avatar" ? "current" : "available",
      business_status: businessStatus,
      blocker_codes: blockerCodes,
      current_object: currentSelection ? { type: "avatar_selection", id: currentSelection.id } : null,
      current_copy_version_id: copy?.id || null,
      copy_version: publicCopyVersion(copy),
      avatar_workspace: publicWorkspace
    },
    action: avatarActionFor(workspace, { copy, selection })
  };
}

function avatarErrorStage() {
  return {
    ...legacyStage("avatar"),
    implementation_status: "workspace",
    read_status: "error"
  };
}

function assertPlanIdentity(value, { organizationId, productId }) {
  if (!value || typeof value !== "object" || !text(value.id) ||
      value.organization_id !== organizationId || value.product_id !== productId) throw notFound();
}

function assertPlanChildIdentity(value, { organizationId, planId }) {
  if (!value || typeof value !== "object" || !text(value.id) ||
      value.organization_id !== organizationId || value.video_plan_version_id !== planId) {
    throw failure("VIDEO_PLAN_SELECTED_OBJECT_MISMATCH");
  }
}

function assertExactVideoPlanWorkspace(value, { organizationId, projectId, productId, requestedPlanId }) {
  void projectId;
  if (!value || typeof value !== "object") throw notFound();
  const versions = Array.isArray(value.versions) ? value.versions : [];
  for (const version of versions) assertPlanIdentity(version, { organizationId, productId });
  const activeVersions = versions.filter((version) => version.status !== "superseded");
  if (activeVersions.length > 1) throw notFound();
  const plan = value.current_plan;
  if (requestedPlanId && (!plan || plan.id !== requestedPlanId)) throw notFound();
  const preflight = value.preflight && typeof value.preflight === "object" ? value.preflight : {};
  const review = value.review && typeof value.review === "object" ? value.review : {};
  if (!plan) {
    if (activeVersions.length || preflight.current_run || preflight.current_result || (preflight.history || []).length ||
        review.current_review || (review.history || []).length) throw notFound();
    return;
  }
  assertPlanIdentity(plan, { organizationId, productId });
  const planId = plan.id;
  const canonicalPlan = versions.find((version) => version.id === planId);
  if (!canonicalPlan || !isDeepStrictEqual(plan, canonicalPlan)) throw notFound();
  if (!requestedPlanId && (activeVersions.length !== 1 || activeVersions[0].id !== planId)) throw notFound();
  const hasPreflightTruth = Boolean(preflight.current_run || preflight.current_result || (preflight.history || []).length);
  const hasReviewTruth = Boolean(review.current_review || (review.history || []).length);
  if (plan.status === "draft" && (hasPreflightTruth || hasReviewTruth)) throw generationMismatch();
  const assertRunResultPair = (run, result) => {
    if (run) assertPlanChildIdentity(run, { organizationId, planId });
    if (result) {
      assertPlanChildIdentity(result, { organizationId, planId });
      if (!run || result.preflight_run_id !== run.id || run.preflight_result_id !== result.id) {
        throw failure("VIDEO_PLAN_SELECTED_OBJECT_MISMATCH");
      }
    } else if (run?.preflight_result_id) {
      throw failure("VIDEO_PLAN_SELECTED_OBJECT_MISMATCH");
    }
  };
  assertRunResultPair(preflight.current_run, preflight.current_result);
  for (const run of preflight.history || []) {
    assertRunResultPair(run, run.result || null);
  }
  for (const item of [review.current_review, ...(review.history || [])]) {
    if (item) assertPlanChildIdentity(item, { organizationId, planId });
  }
}

function videoPlanCurrentId(workspace) {
  const candidates = (workspace.versions || []).filter((value) => value?.id && value.status !== "superseded");
  return candidates.length === 1 ? candidates[0].id : null;
}

function currentAvatarContext(avatarProjection) {
  const stage = avatarProjection?.stage;
  const workspace = stage?.avatar_workspace;
  const selection = workspace?.selection?.current_selection;
  const reasons = workspace?.copy_gate?.reasons;
  const valid = stage?.read_status === "ok" && stage?.implementation_status === "workspace" &&
    workspace?.copy_gate?.approved === true && (!Array.isArray(reasons) || reasons.length === 0) &&
    Boolean(selection) && workspace?.selection?.current_valid === true;
  return {
    valid,
    copyVersionId: stage?.current_copy_version_id || workspace?.copy_gate?.copy_version_id || null,
    selectionId: selection?.id || stage?.current_object?.id || null,
    assetVersionId: selection?.asset_version_id || null
  };
}

function videoPlanUpstreamMatches(plan, avatar, revision) {
  const snapshot = plan?.upstream_snapshot;
  return avatar.valid && snapshot && snapshot.product_revision_id === revision.id &&
    snapshot.copy_version_id === avatar.copyVersionId && snapshot.avatar_selection_id === avatar.selectionId &&
    snapshot.avatar_asset_version_id === avatar.assetVersionId;
}

function videoPlanAction(code) {
  if (!Object.hasOwn(VIDEO_PLAN_ACTIONS, code)) return null;
  const registered = VIDEO_PLAN_ACTIONS[code];
  return registered ? { code, stage: registered.stage, kind: registered.kind } : null;
}

function videoPlanErrorStage() {
  return {
    ...legacyStage("video_plan"),
    implementation_status: "workspace",
    read_status: "error"
  };
}

function videoPlanStage({ workspace, avatarProjection, revision, requestedStage }) {
  const publicWorkspace = publicVideoPlanWorkspace(workspace);
  const plan = workspace.current_plan || null;
  const currentPlanId = videoPlanCurrentId(workspace);
  const historical = Boolean(plan && (plan.status === "superseded" || (currentPlanId && plan.id !== currentPlanId)));
  const avatar = currentAvatarContext(avatarProjection);
  const upstreamMatches = !plan || videoPlanUpstreamMatches(plan, avatar, revision);
  const preflight = workspace.preflight && typeof workspace.preflight === "object" ? workspace.preflight : {};
  const run = preflight.current_run || null;
  const result = preflight.current_result || null;
  const review = workspace.review && typeof workspace.review === "object" ? workspace.review : {};
  const currentReview = review.current_review || null;
  const reviewGate = review.gate && typeof review.gate === "object" ? review.gate : {};
  const reviewReasons = Array.isArray(reviewGate.reasons) ? reviewGate.reasons : [];
  const reviewable = ["passed", "warning"].includes(result?.status);
  const suppliedActionInvalid = Object.hasOwn(workspace, "recommended_action") && workspace.recommended_action !== null &&
    !registeredVideoPlanAction(workspace.recommended_action);
  let businessStatus = "视频方案待创建";
  let blockerCodes = ["VIDEO_PLAN_REQUIRED"];
  let action = null;

  if (historical) {
    businessStatus = "历史视频方案";
    blockerCodes = ["VIDEO_PLAN_HISTORICAL"];
    action = videoPlanAction("return_to_current_video_plan");
  } else if (!avatar.valid || (plan && !upstreamMatches)) {
    businessStatus = !avatar.valid ? "人物选择尚未有效" : "视频方案上游已失效";
    blockerCodes = ["VIDEO_PLAN_UPSTREAM_INVALID"];
    action = videoPlanAction("return_to_avatar");
  } else if (!plan) {
    action = videoPlanAction("create_video_plan");
  } else if (result?.status === "invalidated") {
    businessStatus = "视频方案预检已失效";
    blockerCodes = ["VIDEO_PLAN_PREFLIGHT_INVALIDATED"];
    action = videoPlanAction("derive_video_plan_draft");
  } else if (result?.status === "blocked") {
    businessStatus = "视频方案预检未通过";
    blockerCodes = ["VIDEO_PLAN_PREFLIGHT_BLOCKED"];
    action = videoPlanAction("derive_video_plan_draft");
  } else if (run?.status === "failed" || result?.status === "failed") {
    businessStatus = "视频方案预检未完成";
    blockerCodes = ["VIDEO_PLAN_PREFLIGHT_FAILED"];
    action = videoPlanAction("retry_video_plan_preflight");
  } else if (["queued", "running"].includes(run?.status)) {
    businessStatus = run.status === "queued" ? "视频方案预检已排队" : "正在进行视频方案预检";
    blockerCodes = ["VIDEO_PLAN_PREFLIGHT_IN_PROGRESS"];
    action = null;
  } else if (["changes_requested", "revoked"].includes(currentReview?.status)) {
    businessStatus = currentReview.status === "changes_requested" ? "人工审核要求修改视频方案" : "视频方案批准已失效";
    blockerCodes = [currentReview.status === "changes_requested" ? "VIDEO_PLAN_CHANGES_REQUIRED" : "VIDEO_PLAN_APPROVAL_REVOKED"];
    action = videoPlanAction("derive_video_plan_draft");
  } else if (currentReview?.status === "approved") {
    if (reviewable && plan.status === "frozen") {
      businessStatus = "视频方案已批准";
      blockerCodes = [];
      action = videoPlanAction("continue_to_production");
    } else {
      businessStatus = "视频方案批准状态不可继续";
      blockerCodes = ["VIDEO_PLAN_PREFLIGHT_REQUIRED"];
      action = videoPlanAction("derive_video_plan_draft");
    }
  } else if (currentReview?.status === "pending" && plan.status === "frozen" && reviewable && reviewGate.can_decide === true &&
      !reviewReasons.includes("preflight_not_reviewable") && !reviewReasons.includes("plan_not_frozen")) {
    businessStatus = "视频方案待人工审核";
    blockerCodes = ["VIDEO_PLAN_HUMAN_REVIEW_REQUIRED"];
    action = videoPlanAction("approve_video_plan_review");
  } else if (plan.status === "frozen" && reviewable && reviewGate.can_submit === true &&
      !reviewReasons.includes("plan_not_frozen")) {
    businessStatus = "预检已通过，待提交人工审核";
    blockerCodes = ["VIDEO_PLAN_HUMAN_REVIEW_REQUIRED"];
    action = videoPlanAction("submit_video_plan_review");
  } else if (run?.status === "succeeded" && !result) {
    businessStatus = "视频方案预检结果不可用";
    blockerCodes = ["VIDEO_PLAN_PREFLIGHT_REQUIRED"];
    action = videoPlanAction("retry_video_plan_preflight");
  } else {
    businessStatus = plan.status === "draft" ? "视频方案草稿待预检" : "视频方案待运行预检";
    blockerCodes = ["VIDEO_PLAN_PREFLIGHT_REQUIRED"];
    action = videoPlanAction("run_video_plan_preflight");
  }

  return {
    stage: {
      code: "video_plan",
      implementation_status: "workspace",
      read_status: "ok",
      navigation_state: historical ? "history" : requestedStage === "video_plan" ? "current" : "available",
      business_status: businessStatus,
      blocker_codes: blockerCodes,
      current_object: publicWorkspace.current_plan ? { type: "video_plan", id: publicWorkspace.current_plan.id } : null,
      video_plan_workspace: publicWorkspace
    },
    action: suppliedActionInvalid ? null : action
  };
}

function productionAction(code) {
  if (!Object.hasOwn(PRODUCTION_ACTIONS, code)) return null;
  const registered = PRODUCTION_ACTIONS[code];
  return registered ? { code, stage: registered.stage, kind: registered.kind } : null;
}

function publicProductionOrder(value) {
  if (!value) return null;
  const keys = ["id", "product_id", "video_plan_version_id", "execution_purpose", "status", "row_version",
    "created_at", "updated_at"];
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]));
}

function publicProductionPackage(value) {
  if (!value) return null;
  const keys = ["id", "package_id", "production_order_id", "status", "package_version", "row_version",
    "attempts", "max_attempts", "failure_reason", "expires_at", "created_at", "updated_at"];
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]));
}

function publicProductionAttempt(value) {
  if (!value) return null;
  const keys = ["id", "production_order_id", "status", "row_version", "progress_phase", "heartbeat_at",
    "claimed_at", "started_at", "completed_at", "created_at", "updated_at"];
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]));
}

function publicProductionReport(value) {
  if (!value) return null;
  const keys = ["id", "production_order_id", "outcome", "failure_stage", "failure_code",
    "failure_reason", "retryability", "created_at", "completed_at"];
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]));
}

function publicVerificationJob(value) {
  if (!value) return null;
  const keys = ["id", "production_order_id", "execution_attempt_id", "status", "verification_status",
    "failure_kind", "failure_code", "failure_reason", "row_version", "attempts", "max_attempts",
    "created_at", "updated_at", "completed_at"];
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]));
}

function publicProductionWork(value) {
  if (!value) return null;
  const keys = ["id", "production_order_id", "project_id", "product_id", "status", "delivery_status",
    "delivery_count", "created_at", "updated_at"];
  return Object.fromEntries(keys.filter((key) => Object.hasOwn(value, key)).map((key) => [key, value[key]]));
}

function hasForeignOrganization(value, organizationId) {
  return Boolean(value && Object.hasOwn(value, "organization_id") && value.organization_id !== organizationId);
}

function latestExecutionReport(reports) {
  if (!Array.isArray(reports) || reports.length === 0) return null;
  if (reports.some((report) => !text(report?.id) || !Number.isInteger(report.report_version) || report.report_version < 1)) {
    throw notFound();
  }
  return [...reports].sort((left, right) =>
    left.report_version - right.report_version || left.id.localeCompare(right.id)).at(-1);
}

function assertExactProductionWorkspace(value, { organizationId, projectId, productId, requestedOrderId }) {
  if (!value || typeof value !== "object" || !value.workspace || typeof value.workspace !== "object") throw notFound();
  const workspace = value.workspace;
  const orders = Array.isArray(workspace.orders) ? workspace.orders : [];
  for (const order of orders) {
    if (!text(order?.id) || order.organization_id !== organizationId || order.product_id !== productId) throw notFound();
  }
  const selected = workspace.selected_order || null;
  if (requestedOrderId && (!selected || selected.id !== requestedOrderId)) throw notFound();
  if (selected) {
    const canonicalOrder = orders.find((order) => order.id === selected.id);
    if (!canonicalOrder || !isDeepStrictEqual(canonicalOrder, selected) || selected.organization_id !== organizationId ||
        selected.product_id !== productId) throw notFound();
  }
  if (workspace.current_plan && (!text(workspace.current_plan.id) ||
      workspace.current_plan.organization_id !== organizationId || workspace.current_plan.product_id !== productId)) throw notFound();
  if (!selected) {
    if ((value.packages || []).length || value.execution || value.verification || value.work) throw notFound();
    return;
  }
  for (const item of value.packages || []) {
    if (!text(item?.id || item?.package_id) || item.production_order_id !== selected.id ||
        hasForeignOrganization(item, organizationId)) throw notFound();
  }
  const execution = value.execution;
  let currentAttempt = null;
  let latestReport = null;
  if (execution) {
    if (hasForeignOrganization(execution.order, organizationId) ||
        !isDeepStrictEqual(publicProductionOrder(execution.order), publicProductionOrder(selected))) throw notFound();
    const attempts = Array.isArray(execution.attempts) ? execution.attempts : [];
    for (const attempt of attempts) {
      if (attempt && (!text(attempt.id) || attempt.production_order_id !== selected.id ||
          hasForeignOrganization(attempt, organizationId))) throw notFound();
    }
    currentAttempt = execution.current_attempt || null;
    if (currentAttempt) {
      const canonicalAttempt = attempts.find((attempt) => attempt.id === currentAttempt.id);
      if (!canonicalAttempt || !isDeepStrictEqual(canonicalAttempt, currentAttempt) ||
          currentAttempt.production_order_id !== selected.id ||
          hasForeignOrganization(currentAttempt, organizationId)) throw notFound();
    }
    const reports = execution.reports || [];
    for (const report of reports) {
      if (!currentAttempt || !text(report?.id) || report.production_order_id !== selected.id ||
          report.execution_attempt_id !== currentAttempt.id ||
          hasForeignOrganization(report, organizationId)) throw notFound();
    }
    latestReport = latestExecutionReport(reports);
  }
  const verification = value.verification;
  if (verification) {
    if (hasForeignOrganization(verification.order, organizationId) ||
        !isDeepStrictEqual(publicProductionOrder(verification.order), publicProductionOrder(selected))) throw notFound();
    if (verification.job && (!currentAttempt || verification.job.production_order_id !== selected.id ||
        verification.job.execution_attempt_id !== currentAttempt.id ||
        !latestReport || verification.job.report_id !== latestReport.id ||
        hasForeignOrganization(verification.job, organizationId))) throw notFound();
    for (const work of [verification.work, ...(verification.works || [])]) {
      if (work && (!verification.job || !text(work.id) || work.production_order_id !== selected.id ||
          work.execution_attempt_id !== currentAttempt?.id ||
          work.manual_execution_report_id !== verification.job.report_id ||
          hasForeignOrganization(work, organizationId))) throw notFound();
    }
  }
  if (value.work) {
    if (!text(value.work.id) || value.work.production_order_id !== selected.id ||
        value.work.project_id !== projectId || value.work.product_id !== productId ||
        value.work.execution_attempt_id !== currentAttempt?.id ||
        value.work.manual_execution_report_id !== verification?.job?.report_id ||
        !verification?.work?.id || verification.work.id !== value.work.id ||
        hasForeignOrganization(value.work, organizationId)) throw notFound();
  }
}

function productionStage({ value, requestedStage }) {
  const workspace = value.workspace;
  const selected = workspace.selected_order || null;
  const packages = (value.packages || []).map(publicProductionPackage);
  const currentPackage = packages[0] || null;
  const execution = value.execution || null;
  const attempt = publicProductionAttempt(execution?.current_attempt || null);
  const latestReport = latestExecutionReport(execution?.reports || []);
  const reports = (execution?.reports || []).map(publicProductionReport);
  const verification = value.verification || null;
  const verificationJob = publicVerificationJob(verification?.job || null);
  const work = publicProductionWork(value.work || null);
  const readErrors = new Set(Array.isArray(value.read_errors) ? value.read_errors : []);
  let businessStatus = "生产待创建";
  let blockerCodes = ["PRODUCTION_ORDER_REQUIRED"];
  let action = workspace.gate?.can_create === true ? productionAction("create_production_order") : productionAction("return_to_video_plan");

  if (selected) {
    action = null;
    const executionCompleted = attempt?.status === "succeeded" && latestReport?.outcome === "completed";
    const observesVerification = selected.status === "succeeded" ||
      (selected.status === "running" && executionCompleted);
    const handoffReadFailed = selected.status === "waiting_for_executor" && readErrors.has("handoff");
    const executionReadFailed = ["claimed", "running", "requires_action", "failed", "cancel_requested", "cancelled", "succeeded"]
      .includes(selected.status) && readErrors.has("execution");
    const verificationReadFailed = observesVerification && readErrors.has("verification");
    const workReadFailed = selected.status === "succeeded" && readErrors.has("work");
    if (readErrors.has("production") || readErrors.has("generation") || handoffReadFailed || executionReadFailed ||
        verificationReadFailed || workReadFailed) {
      businessStatus = workReadFailed ? "作品状态读取失败" : verificationReadFailed ? "核验状态读取失败" :
        handoffReadFailed ? "生产交接资料读取失败" : readErrors.has("generation") ?
          "生产状态已变化，请刷新" : "生产执行状态读取失败";
      blockerCodes = ["PRODUCTION_READ_FAILED"];
      action = productionAction("retry_production_read");
    } else if (selected.status === "waiting_for_executor") {
      if (!currentPackage) {
        businessStatus = "生产交接资料待生成";
        blockerCodes = ["HANDOFF_PACKAGE_REQUIRED"];
        action = productionAction("generate_handoff_package");
      } else if (currentPackage.status === "generating") {
        businessStatus = "正在准备生产交接资料";
        blockerCodes = ["HANDOFF_PACKAGE_IN_PROGRESS"];
      } else if (currentPackage.status === "generation_failed") {
        businessStatus = "生产交接资料准备失败";
        blockerCodes = ["HANDOFF_PACKAGE_FAILED"];
        action = productionAction("retry_handoff_package");
      } else if (currentPackage.status === "expired") {
        businessStatus = "生产交接资料授权已过期";
        blockerCodes = ["HANDOFF_PACKAGE_AUTHORIZATION_EXPIRED"];
        action = productionAction("authorize_handoff_download");
      } else if (currentPackage.status === "ready") {
        businessStatus = "等待生产门禁核对";
        blockerCodes = ["PRODUCTION_ACTIVATION_NOT_PROVEN"];
      } else {
        businessStatus = "当前生产交接包不可用";
        blockerCodes = ["HANDOFF_PACKAGE_UNAVAILABLE"];
      }
    } else if (selected.status === "claimed") {
      businessStatus = "生产任务已领取";
      blockerCodes = ["PRODUCTION_IN_PROGRESS"];
    } else if (selected.status === "running") {
      if (executionCompleted) {
        const verificationStatus = verificationJob?.verification_status ||
          (["queued", "running"].includes(verificationJob?.status) ? "pending" : "not_started");
        if (["queued", "running", "pending"].includes(verificationStatus)) {
          businessStatus = "正在核验作品文件";
          blockerCodes = ["WORK_VERIFICATION_IN_PROGRESS"];
        } else if (["failed", "requires_action"].includes(verificationStatus)) {
          businessStatus = "作品文件核验需要处理";
          blockerCodes = ["WORK_VERIFICATION_REQUIRES_ACTION"];
          action = productionAction("view_verification_details");
        } else if (verificationStatus === "passed" || work) {
          businessStatus = "生产状态已变化，请刷新";
          blockerCodes = ["PRODUCTION_READ_FAILED"];
          action = productionAction("retry_production_read");
        } else {
          businessStatus = "生成完成，待文件核验";
          blockerCodes = ["WORK_VERIFICATION_REQUIRED"];
        }
      } else {
        businessStatus = "正在生成作品";
        blockerCodes = ["PRODUCTION_IN_PROGRESS"];
      }
    } else if (selected.status === "requires_action") {
      businessStatus = "生产需要人工处理";
      blockerCodes = ["PRODUCTION_REQUIRES_ACTION"];
      action = productionAction("view_production_failure_details");
    } else if (selected.status === "failed") {
      businessStatus = "生产失败，已停止";
      blockerCodes = ["PRODUCTION_FAILED"];
      action = reports.some((report) => report.outcome === "failed")
        ? productionAction("view_production_failure_details") : productionAction("return_to_video_plan");
    } else if (selected.status === "cancel_requested") {
      businessStatus = "正在取消生产";
      blockerCodes = ["PRODUCTION_CANCEL_PENDING"];
    } else if (selected.status === "cancelled") {
      businessStatus = "生产已取消";
      blockerCodes = ["PRODUCTION_CANCELLED"];
      action = productionAction("return_to_video_plan");
    } else if (selected.status === "succeeded") {
      const verificationStatus = verificationJob?.verification_status ||
        (["queued", "running"].includes(verificationJob?.status) ? "pending" : "not_started");
      if (verificationStatus === "passed" && work) {
        const labels = {
          pending_review: "作品待检查", rework_required: "作品需要返工",
          deliverable: "作品可交付", delivered: "作品已交付，待真实下载验收"
        };
        businessStatus = labels[work.delivery_status] || "作品状态待确认";
        blockerCodes = work.delivery_status === "deliverable" ? [] : ["WORK_ACTION_REQUIRED"];
        const workActions = {
          pending_review: "review_production_work",
          rework_required: "view_production_rework",
          deliverable: "deliver_production_work",
          delivered: "view_production_delivery"
        };
        action = productionAction(workActions[work.delivery_status]);
      } else {
        businessStatus = "生产状态已变化，请刷新";
        blockerCodes = ["PRODUCTION_READ_FAILED"];
        action = productionAction("retry_production_read");
      }
    } else {
      businessStatus = "生产状态待确认";
      blockerCodes = ["PRODUCTION_STATUS_UNKNOWN"];
    }
  }

  return {
    stage: {
      code: "production",
      implementation_status: "workspace",
      read_status: "ok",
      navigation_state: requestedStage === "production" ? "current" : "available",
      business_status: businessStatus,
      blocker_codes: blockerCodes,
      current_object: selected ? { type: "production_order", id: selected.id } : null,
      production: {
        current_plan: workspace.current_plan ? {
          id: workspace.current_plan.id,
          status: workspace.current_plan.status,
          version_number: workspace.current_plan.version_number
        } : null,
        gate: { can_create: workspace.gate?.can_create === true,
          reasons: Array.isArray(workspace.gate?.reasons) ? [...workspace.gate.reasons] : [] },
        orders: (workspace.orders || []).map(publicProductionOrder),
        selected_order: publicProductionOrder(selected),
        package: currentPackage,
        execution: { current_attempt: attempt, reports },
        verification: { job: verificationJob },
        work,
        read_errors: [...readErrors]
      }
    },
    action
  };
}

function productionErrorStage() {
  return {
    ...legacyStage("production"),
    implementation_status: "workspace",
    read_status: "error"
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

function assertExactCopy(copy, { organizationId, projectId, productId, productRevisionId }) {
  if (!copy || copy.organization_id !== organizationId || copy.project_id !== projectId ||
      copy.product_id !== productId || copy.product_revision_id !== productRevisionId) throw notFound();
  return copy;
}

function isApprovedCopy(copy, reviewState, revisionId) {
  const review = reviewState?.current_review;
  return copy?.status === "frozen" && review?.status === "approved" && review.copy_version_id === copy.id &&
    (!review.product_revision_id || review.product_revision_id === revisionId) &&
    (!Array.isArray(reviewState?.gate?.reasons) || reviewState.gate.reasons.length === 0);
}

async function readAvatarProjection({ avatarService, copyService, reviewService, input, project, product, revision }) {
  const context = { organizationId: input.organizationId, actorMemberId: input.actorMemberId };
  const copyContext = { ...context, productRevisionId: revision.id };
  let copies = null;
  if (typeof copyService?.listCopyVersions === "function") {
    copies = await copyService.listCopyVersions(copyContext);
    if (!Array.isArray(copies)) throw unavailable();
    copies.forEach((copy) => assertExactCopy(copy, {
      organizationId: input.organizationId, projectId: project.id, productId: product.id, productRevisionId: revision.id
    }));
  }

  let copy = null;
  if (input.copyVersionId) {
    copy = copies?.find((value) => value.id === input.copyVersionId) || null;
    if (!copy && typeof copyService?.getCopyVersion === "function") {
      try {
        copy = await copyService.getCopyVersion({ ...context, copyVersionId: input.copyVersionId });
      } catch (error) {
        if (error?.code === "COPY_VERSION_NOT_FOUND") throw notFound();
        throw error;
      }
      assertExactCopy(copy, {
        organizationId: input.organizationId, projectId: project.id, productId: product.id, productRevisionId: revision.id
      });
      if (copy.status !== "frozen") throw notFound();
    }
    if (!copy && copies) throw notFound();
    if (copy && typeof reviewService?.getReviewState === "function") {
      const reviewState = await reviewService.getReviewState({ ...context, copyVersionId: copy.id });
      if (!isApprovedCopy(copy, reviewState, revision.id)) copy = null;
    }
  } else if (copies && typeof reviewService?.getReviewState === "function") {
    const approvalCandidates = [...copies].sort((left, right) =>
      (Number(right.version_number) || 0) - (Number(left.version_number) || 0) ||
      String(right.created_at || "").localeCompare(String(left.created_at || "")) ||
      String(right.id || "").localeCompare(String(left.id || "")));
    for (const candidate of approvalCandidates) {
      const reviewState = await reviewService.getReviewState({ ...context, copyVersionId: candidate.id });
      if (isApprovedCopy(candidate, reviewState, revision.id)) {
        copy = candidate;
        break;
      }
    }
  }

  const avatarInput = { ...context, actorRole: input.actorRole, productId: product.id };
  if (copy) avatarInput.copyVersionId = copy.id;
  else if (input.copyVersionId) avatarInput.copyVersionId = input.copyVersionId;
  const workspace = await avatarService.getWorkspace(avatarInput);
  if (!workspace || typeof workspace !== "object") throw unavailable();

  const resolvedCopyVersionId = workspace.resolved_copy_version_id || workspace.copy_gate?.copy_version_id || null;
  if (workspace.copy_gate?.copy_version_id && resolvedCopyVersionId !== workspace.copy_gate.copy_version_id) throw notFound();
  const avatarCopyApproved = workspace.copy_gate?.approved === true &&
    (!Array.isArray(workspace.copy_gate?.reasons) || workspace.copy_gate.reasons.length === 0);
  if (avatarCopyApproved) {
    if (!resolvedCopyVersionId) throw unavailable();
    if (copy && copy.status !== "frozen") throw notFound();
    if (copy && copy.id !== resolvedCopyVersionId) throw notFound();
    if (!copy) {
      copy = copies?.find((value) => value.id === resolvedCopyVersionId) || null;
      if (!copy && typeof copyService?.getCopyVersion === "function") {
        try {
          copy = await copyService.getCopyVersion({ ...context, copyVersionId: resolvedCopyVersionId });
        } catch (error) {
          if (error?.code === "COPY_VERSION_NOT_FOUND") throw notFound();
          throw error;
        }
      }
      assertExactCopy(copy, {
        organizationId: input.organizationId, projectId: project.id, productId: product.id, productRevisionId: revision.id
      });
      if (copy.status !== "frozen") throw notFound();
    }
  } else {
    copy = null;
  }

  const currentSelection = workspace.selection?.current_selection;
  if (currentSelection) {
    if (currentSelection.product_id !== product.id) throw notFound();
    if (copy && currentSelection.copy_version_id !== copy.id) {
      const invalidationReasons = workspace.selection?.invalidation_reasons;
      if (workspace.selection?.current_valid !== false || !Array.isArray(invalidationReasons) ||
          !invalidationReasons.includes("copy_version_changed")) throw unavailable();
    }
  }
  return avatarStage({ project, product, revision, copy, workspace, requestedStage: input.stage });
}

export function createOperatorWorkspaceService({ projectContentService, copyService = null,
  qualityService = null, reviewService = null, avatarService = null,
  videoPlanningService = null, videoPlanningEnabled = null, productionService = null } = {}) {
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
          generation: publicGeneration(newestGenerationJob(jobs)), quality, review, requestedStage, actorRole: input.actorRole });
      } catch (error) {
        if (error?.code === "OPERATOR_WORKSPACE_NOT_FOUND") throw error;
        if (requestedStage === "copy") throw unavailable(error);
        copyProjection = { stage: { ...legacyStage("copy"), implementation_status: "workspace", read_status: "error" }, action: null };
      }
    }
    let avatarProjection = { stage: legacyStage("avatar"), action: null };
    const avatarWorkspaceEnabled = typeof avatarService?.getWorkspace === "function";
    if (avatarWorkspaceEnabled) {
      try {
        avatarProjection = await readAvatarProjection({ avatarService, copyService, reviewService, input,
          project, product, revision });
      } catch (error) {
        if (error?.code === "OPERATOR_WORKSPACE_NOT_FOUND") throw error;
        if (requestedStage === "avatar") throw unavailable(error);
        avatarProjection = { stage: avatarErrorStage(), action: null };
      }
    }
    let videoPlanProjection = { stage: legacyStage("video_plan"), action: null };
    const videoPlanWorkspaceEnabled = videoPlanningEnabled !== false && typeof videoPlanningService?.getWorkspace === "function";
    const readVideoPlan = videoPlanWorkspaceEnabled && !(requestedStage === "avatar" && !currentAvatarContext(avatarProjection).valid);
    if (readVideoPlan) {
      try {
        const videoPlanWorkspace = await videoPlanningService.getWorkspace({
          organizationId: input.organizationId,
          actorMemberId: input.actorMemberId,
          actorRole: input.actorRole,
          productId: product.id,
          planId: input.planId
        });
        assertExactVideoPlanWorkspace(videoPlanWorkspace, {
          organizationId: input.organizationId,
          projectId: project.id,
          productId: product.id,
          requestedPlanId: input.planId
        });
        videoPlanProjection = videoPlanStage({ workspace: videoPlanWorkspace, avatarProjection, revision, requestedStage });
      } catch (error) {
        if (["OPERATOR_WORKSPACE_NOT_FOUND", "VIDEO_PLAN_NOT_FOUND", "VIDEO_PLAN_SELECTED_OBJECT_MISMATCH"].includes(error?.code)) throw notFound();
        if (requestedStage === "video_plan") throw unavailable(error);
        videoPlanProjection = { stage: videoPlanErrorStage(), action: null };
      }
    }
    let productionProjection = { stage: legacyStage("production"), action: null };
    const productionWorkspaceEnabled = typeof productionService?.getOperatorWorkspace === "function";
    if (productionWorkspaceEnabled) {
      try {
        const productionWorkspace = await productionService.getOperatorWorkspace({
          organizationId: input.organizationId,
          actorMemberId: input.actorMemberId,
          actorRole: input.actorRole,
          productId: product.id,
          orderId: input.orderId || null
        });
        assertExactProductionWorkspace(productionWorkspace, {
          organizationId: input.organizationId,
          projectId: project.id,
          productId: product.id,
          requestedOrderId: input.orderId || null
        });
        productionProjection = productionStage({ value: productionWorkspace, requestedStage });
      } catch (error) {
        if (error?.code === "OPERATOR_WORKSPACE_NOT_FOUND") throw error;
        if (requestedStage === "production") throw unavailable(error);
        productionProjection = { stage: productionErrorStage(), action: null };
      }
    }
    const stages = [productContent, copyProjection.stage, avatarProjection.stage,
      videoPlanProjection.stage, productionProjection.stage];
    const isProductContent = requestedStage === "product_content";
    const isCopy = requestedStage === "copy" && copyWorkspaceEnabled;
    const isAvatar = requestedStage === "avatar" && avatarWorkspaceEnabled;
    const isVideoPlan = requestedStage === "video_plan" && videoPlanWorkspaceEnabled && videoPlanProjection.stage.read_status === "ok";
    const isProduction = requestedStage === "production" && productionWorkspaceEnabled && productionProjection.stage.read_status === "ok";
    return {
      project: { id: project.id, name: project.name ?? null },
      product: { id: product.id, name: revision.product_name ?? product.name ?? null, current_revision_id: revision.id },
      projection_version: PROJECTION_VERSION,
      action_registry_version: ACTION_REGISTRY_VERSION,
      requested_stage: requestedStage,
      render_mode: isProductContent || isCopy || isAvatar || isVideoPlan || isProduction ? "workspace" : "legacy",
      recommended_stage: isProductContent ? "product_content" : isCopy ? "copy" : isAvatar ? "avatar" :
        isVideoPlan ? "video_plan" : isProduction ? "production" : null,
      recommended_action: isProductContent ? actionFor(revision, productContent.blocker_codes) :
        isCopy ? copyProjection.action : isAvatar ? avatarProjection.action : isVideoPlan ? videoPlanProjection.action :
          isProduction ? productionProjection.action : null,
      stages
    };
  }

  return { getWorkspace };
}

export { ACTION_REGISTRY_VERSION, PROJECTION_VERSION, STAGES as OPERATOR_WORKSPACE_STAGES };
