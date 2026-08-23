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

const failure = (code, details = {}) => Object.assign(new Error(code), { code, ...details });
const text = (value) => typeof value === "string" ? value.trim() : "";

function notFound() {
  return failure("OPERATOR_WORKSPACE_NOT_FOUND");
}

function unavailable(cause) {
  return failure("OPERATOR_WORKSPACE_UNAVAILABLE", { cause });
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
  const plan = value.current_plan;
  if (requestedPlanId && (!plan || plan.id !== requestedPlanId)) throw notFound();
  if (!plan) return;
  assertPlanIdentity(plan, { organizationId, productId });
  const planId = plan.id;
  for (const version of value.versions || []) assertPlanIdentity(version, { organizationId, productId });
  if (!(value.versions || []).some((version) => version.id === planId)) throw notFound();
  if (!requestedPlanId && videoPlanCurrentId(value) !== planId) throw notFound();
  const preflight = value.preflight && typeof value.preflight === "object" ? value.preflight : {};
  if (preflight.current_run) assertPlanChildIdentity(preflight.current_run, { organizationId, planId });
  if (preflight.current_result) {
    assertPlanChildIdentity(preflight.current_result, { organizationId, planId });
    if (!preflight.current_run || preflight.current_result.preflight_run_id !== preflight.current_run.id) {
      throw failure("VIDEO_PLAN_SELECTED_OBJECT_MISMATCH");
    }
  }
  for (const run of preflight.history || []) {
    assertPlanChildIdentity(run, { organizationId, planId });
    if (run.result) {
      assertPlanChildIdentity(run.result, { organizationId, planId });
      if (run.result.preflight_run_id !== run.id) throw failure("VIDEO_PLAN_SELECTED_OBJECT_MISMATCH");
    }
  }
  const review = value.review && typeof value.review === "object" ? value.review : {};
  for (const item of [review.current_review, ...(review.history || [])]) {
    if (item) assertPlanChildIdentity(item, { organizationId, planId });
  }
}

function videoPlanCurrentId(workspace) {
  const explicit = workspace.current_plan_id || workspace.head?.current_plan_id;
  if (text(explicit)) return explicit;
  const candidates = (workspace.versions || []).filter((value) => value?.id && value.status !== "superseded");
  candidates.sort((left, right) => (Number(left.version_number) || 0) - (Number(right.version_number) || 0) ||
    String(left.updated_at || left.created_at || "").localeCompare(String(right.updated_at || right.created_at || "")) ||
    String(left.id).localeCompare(String(right.id)));
  return candidates.at(-1)?.id || workspace.current_plan?.id || null;
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
  let businessStatus = "视频方案待创建";
  let blockerCodes = ["VIDEO_PLAN_REQUIRED"];
  let action = Object.hasOwn(workspace, "recommended_action")
    ? registeredVideoPlanAction(workspace.recommended_action)
    : null;

  if (historical) {
    businessStatus = "历史视频方案";
    blockerCodes = ["VIDEO_PLAN_HISTORICAL"];
    if (!Object.hasOwn(workspace, "recommended_action")) action = videoPlanAction("return_to_current_video_plan");
  } else if (!avatar.valid || (plan && !upstreamMatches)) {
    businessStatus = !avatar.valid ? "人物选择尚未有效" : "视频方案上游已失效";
    blockerCodes = ["VIDEO_PLAN_UPSTREAM_INVALID"];
    if (!Object.hasOwn(workspace, "recommended_action")) action = videoPlanAction("return_to_avatar");
  } else if (!plan) {
    if (!Object.hasOwn(workspace, "recommended_action")) action = videoPlanAction("create_video_plan");
  } else if (result?.status === "invalidated") {
    businessStatus = "视频方案预检已失效";
    blockerCodes = ["VIDEO_PLAN_PREFLIGHT_INVALIDATED"];
    if (!Object.hasOwn(workspace, "recommended_action")) action = videoPlanAction("derive_video_plan_draft");
  } else if (result?.status === "blocked") {
    businessStatus = "视频方案预检未通过";
    blockerCodes = ["VIDEO_PLAN_PREFLIGHT_BLOCKED"];
    if (!Object.hasOwn(workspace, "recommended_action")) action = videoPlanAction("derive_video_plan_draft");
  } else if (run?.status === "failed" || result?.status === "failed") {
    businessStatus = "视频方案预检未完成";
    blockerCodes = ["VIDEO_PLAN_PREFLIGHT_FAILED"];
    if (!Object.hasOwn(workspace, "recommended_action")) action = videoPlanAction("retry_video_plan_preflight");
  } else if (["queued", "running"].includes(run?.status)) {
    businessStatus = run.status === "queued" ? "视频方案预检已排队" : "正在进行视频方案预检";
    blockerCodes = ["VIDEO_PLAN_PREFLIGHT_IN_PROGRESS"];
    if (!Object.hasOwn(workspace, "recommended_action")) action = null;
  } else if (["changes_requested", "revoked"].includes(currentReview?.status)) {
    businessStatus = currentReview.status === "changes_requested" ? "人工审核要求修改视频方案" : "视频方案批准已失效";
    blockerCodes = [currentReview.status === "changes_requested" ? "VIDEO_PLAN_CHANGES_REQUIRED" : "VIDEO_PLAN_APPROVAL_REVOKED"];
    if (!Object.hasOwn(workspace, "recommended_action")) action = videoPlanAction("derive_video_plan_draft");
  } else if (currentReview?.status === "approved") {
    if (reviewable && plan.status === "frozen") {
      businessStatus = "视频方案已批准";
      blockerCodes = [];
      if (!Object.hasOwn(workspace, "recommended_action")) action = videoPlanAction("continue_to_production");
    } else {
      businessStatus = "视频方案批准状态不可继续";
      blockerCodes = ["VIDEO_PLAN_PREFLIGHT_REQUIRED"];
      if (!Object.hasOwn(workspace, "recommended_action")) action = videoPlanAction("derive_video_plan_draft");
    }
  } else if (currentReview?.status === "pending" && reviewable && reviewGate.can_decide === true &&
      !reviewReasons.includes("preflight_not_reviewable")) {
    businessStatus = "视频方案待人工审核";
    blockerCodes = ["VIDEO_PLAN_HUMAN_REVIEW_REQUIRED"];
    if (!Object.hasOwn(workspace, "recommended_action")) {
      action = videoPlanAction("approve_video_plan_review");
    }
  } else if (reviewable && reviewGate.can_submit === true) {
    businessStatus = "预检已通过，待提交人工审核";
    blockerCodes = ["VIDEO_PLAN_HUMAN_REVIEW_REQUIRED"];
    if (!Object.hasOwn(workspace, "recommended_action")) action = videoPlanAction("submit_video_plan_review");
  } else if (run?.status === "succeeded" && !result) {
    businessStatus = "视频方案预检结果不可用";
    blockerCodes = ["VIDEO_PLAN_PREFLIGHT_REQUIRED"];
    if (!Object.hasOwn(workspace, "recommended_action")) action = videoPlanAction("retry_video_plan_preflight");
  } else {
    businessStatus = plan.status === "draft" ? "视频方案草稿待预检" : "视频方案待运行预检";
    blockerCodes = ["VIDEO_PLAN_PREFLIGHT_REQUIRED"];
    if (!Object.hasOwn(workspace, "recommended_action")) action = videoPlanAction("run_video_plan_preflight");
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
    action
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
    const stages = [productContent, copyProjection.stage, avatarProjection.stage,
      videoPlanProjection.stage, legacyStage("production", productionService)];
    const isProductContent = requestedStage === "product_content";
    const isCopy = requestedStage === "copy" && copyWorkspaceEnabled;
    const isAvatar = requestedStage === "avatar" && avatarWorkspaceEnabled;
    const isVideoPlan = requestedStage === "video_plan" && videoPlanWorkspaceEnabled && videoPlanProjection.stage.read_status === "ok";
    return {
      project: { id: project.id, name: project.name ?? null },
      product: { id: product.id, name: revision.product_name ?? product.name ?? null, current_revision_id: revision.id },
      projection_version: PROJECTION_VERSION,
      action_registry_version: ACTION_REGISTRY_VERSION,
      requested_stage: requestedStage,
      render_mode: isProductContent || isCopy || isAvatar || isVideoPlan ? "workspace" : "legacy",
      recommended_stage: isProductContent ? "product_content" : isCopy ? "copy" : isAvatar ? "avatar" : isVideoPlan ? "video_plan" : null,
      recommended_action: isProductContent ? actionFor(revision, productContent.blocker_codes) :
        isCopy ? copyProjection.action : isAvatar ? avatarProjection.action : isVideoPlan ? videoPlanProjection.action : null,
      stages
    };
  }

  return { getWorkspace };
}

export { ACTION_REGISTRY_VERSION, PROJECTION_VERSION, STAGES as OPERATOR_WORKSPACE_STAGES };
