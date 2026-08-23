(() => {
  const STAGE = "video_plan";
  const ACTIONS = Object.freeze({
    return_to_avatar: { stage: STAGE, kind: "navigate", label: "返回人物" },
    create_video_plan: { stage: STAGE, kind: "command", label: "创建视频方案" },
    save_video_plan_draft: { stage: STAGE, kind: "command", label: "保存草稿" },
    load_latest_video_plan: { stage: STAGE, kind: "refresh", label: "载入最新方案状态" },
    return_to_current_video_plan: { stage: STAGE, kind: "navigate", label: "回到当前方案" },
    run_video_plan_preflight: { stage: STAGE, kind: "command", label: "开始预检" },
    retry_video_plan_preflight: { stage: STAGE, kind: "command", label: "重新预检" },
    derive_video_plan_draft: { stage: STAGE, kind: "command", label: "基于此方案修改" },
    submit_video_plan_review: { stage: STAGE, kind: "command", label: "提交方案审核" },
    approve_video_plan_review: { stage: STAGE, kind: "command", label: "批准方案" },
    continue_to_production: { stage: STAGE, kind: "navigate", label: "进入生产" },
    retry_video_plan_read: { stage: STAGE, kind: "refresh", label: "刷新当前方案" }
  });
  const PLAN_LABELS = Object.freeze({ draft: "草稿", frozen: "已冻结", superseded: "历史版本" });
  const PREFLIGHT_LABELS = Object.freeze({
    not_run: "未预检", passed: "预检通过", warning: "存在提醒", blocked: "被阻断", invalidated: "已失效"
  });
  const PREFLIGHT_RUN_LABELS = Object.freeze({ queued: "已排队", running: "正在预检", succeeded: "已完成", failed: "预检失败" });
  const REVIEW_LABELS = Object.freeze({
    not_submitted: "未提交审核", pending: "审核中", approved: "已批准", changes_requested: "要求修改", revoked: "批准已失效"
  });
  const PRESENTATION_SIZES = Object.freeze({
    smart_fit: "智能适配", extra_large: "超大", large: "大", medium: "中", small: "小", extra_small: "超小"
  });
  const GROUP_LABELS = Object.freeze({
    upstream_validity: "A 上游有效性", plan_completeness: "B 方案完整性", production_readiness: "C 生产准备度"
  });
  const node = (selector) => document.querySelector(selector);
  const text = (value, fallback = "") => typeof value === "string" && value.trim() ? value : fallback;
  const has = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
  const csrf = () => decodeURIComponent((document.cookie.split(";").map((part) => part.trim())
    .find((part) => part.startsWith("hifly_identity_csrf=")) || "=").split("=").slice(1).join("="));

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.method && options.method !== "GET") headers.set("x-identity-csrf", csrf());
    const response = await fetch(url, { credentials: "same-origin", ...options, headers });
    if ([401, 403].includes(response.status)) {
      location.replace("/login.html");
      throw Object.assign(new Error("AUTH_REQUIRED"), { status: response.status });
    }
    let body;
    try { body = await response.json(); }
    catch (_error) { throw Object.assign(new Error("INVALID_RESPONSE"), { status: response.status }); }
    if (!response.ok) throw Object.assign(new Error(body.error || "REQUEST_FAILED"), { status: response.status, body });
    return body;
  }

  function stateClass(status) {
    if (["passed", "approved"].includes(status)) return "ready";
    if (["queued", "running", "pending"].includes(status)) return "uploading";
    if (["warning", "blocked", "invalidated", "changes_requested"].includes(status)) return "blocked";
    if (["failed"].includes(status)) return "failure";
    if (["superseded", "revoked"].includes(status)) return "superseded";
    return "";
  }

  function setNotice(target, message = "", kind = "") {
    if (!target) return;
    target.textContent = message;
    target.className = `notice${kind ? ` ${kind}` : ""}`;
    target.hidden = !message;
  }

  function setBadge(target, label, status = "") {
    if (!target) return;
    target.textContent = label;
    target.className = `state ${stateClass(status)}`;
  }

  function workspaceUrl(projectId, productId, stage, planId = null) {
    const url = new URL("/workspace.html", location.origin);
    url.searchParams.set("project", projectId);
    url.searchParams.set("product", productId);
    url.searchParams.set("stage", stage);
    if (stage === STAGE && planId) url.searchParams.set("plan", planId);
    return `${url.pathname}${url.search}`;
  }

  function productionUrl(projectId, productId) {
    const url = new URL("/production.html", location.origin);
    url.searchParams.set("project", projectId);
    url.searchParams.set("product", productId);
    return `${url.pathname}${url.search}`;
  }

  function legacyPlanUrl(projectId, productId, planId = null) {
    const url = new URL("/plan.html", location.origin);
    url.searchParams.set("project", projectId);
    url.searchParams.set("product", productId);
    if (planId) url.searchParams.set("plan", planId);
    return `${url.pathname}${url.search}`;
  }

  function registeredAction(action) {
    if (!action || typeof action !== "object") return null;
    const registered = ACTIONS[action.code];
    if (!registered || action.stage !== registered.stage || action.kind !== registered.kind) return null;
    return { code: action.code, stage: action.stage, kind: action.kind };
  }

  function validateProjection(value) {
    if (!value || value.projection_version !== 1 || value.action_registry_version !== 1 ||
        value.requested_stage !== STAGE || value.render_mode !== "workspace" || value.recommended_stage !== STAGE) {
      return null;
    }
    const stage = value.stages?.find((item) => item.code === STAGE);
    const production = value.stages?.find((item) => item.code === "production");
    const planWorkspace = stage?.video_plan_workspace;
    if (!stage || stage.implementation_status !== "workspace" || stage.read_status !== "ok" ||
        !planWorkspace || !has(planWorkspace, "current_plan") ||
        !Number.isInteger(planWorkspace.head_revision) || !Array.isArray(planWorkspace.versions) ||
        !planWorkspace.preflight || !Array.isArray(planWorkspace.preflight.history) ||
        !planWorkspace.human_review || !Array.isArray(planWorkspace.human_review.history) ||
        !planWorkspace.human_review.gate ||
        !production || production.implementation_status !== "legacy" || production.read_status !== "not_loaded" ||
        production.current_object !== null || production.blocker_codes?.length) return null;
    if (value.recommended_action && !registeredAction(value.recommended_action)) return null;
    return { stage, planWorkspace };
  }

  function createController({ projectId, initialProductId, initialPlanId }) {
    let project = null;
    let productId = initialProductId;
    let planId = initialPlanId || null;
    let projection = null;
    let planStage = null;
    let planWorkspace = null;
    let runtime = null;
    let readFailed = false;
    let readFailureMessage = "";
    let conflict = false;
    let trusted = true;
    let busy = false;
    let dirty = false;
    let draftBuffer = { output: "", size: "smart_fit" };
    let pollTimer = null;
    let pollEpoch = 0;
    let selectedProductTrigger = null;
    let pendingNavigation = null;
    let dialogTrigger = null;
    let reviewAction = "submit";
    let versionDialogTrigger = null;
    let acceptedHistoryIndex = 0;
    let historyTraversal = null;
    let pendingHistory = null;

    const panel = node("#videoPlanWorkspacePanel");
    const primary = node("#workspacePrimaryAction");
    const actionLabel = node("#workspaceActionLabel");
    const unsavedDialog = node("#workspaceUnsavedDialog");
    const reviewDialog = node("#reviewDialog");
    const versionDialog = node("#versionDialog");

    function currentPlan() { return planWorkspace?.current_plan || null; }
    function currentPlanId() {
      if (text(planWorkspace?.current_plan_id)) return planWorkspace.current_plan_id;
      const candidates = (planWorkspace?.versions || []).filter((item) => item?.id && item.status !== "superseded");
      candidates.sort((left, right) => (Number(left.version_number) || 0) - (Number(right.version_number) || 0) ||
        String(left.updated_at || left.created_at || "").localeCompare(String(right.updated_at || right.created_at || "")) ||
        String(left.id).localeCompare(String(right.id)));
      return candidates.at(-1)?.id || currentPlan()?.id || null;
    }
    function selectedPlanId() { return currentPlan()?.id || null; }
    function selectedPlanIsHistorical() {
      const plan = currentPlan();
      return Boolean(plan && currentPlanId() && plan.id !== currentPlanId());
    }
    function currentProduct() { return project?.products?.find((item) => item.id === productId) || null; }
    function currentRun() { return planWorkspace?.preflight?.current_run || null; }
    function currentResult() { return planWorkspace?.preflight?.current_result || null; }
    function humanReview() { return planWorkspace?.human_review || null; }
    function reviewState() { return humanReview()?.current_review || null; }
    function reviewGate() { return humanReview()?.gate || {}; }
    function activeRun(run = currentRun()) {
      return ["queued", "running"].includes(run?.status);
    }
    function planIsEditable() {
      return Boolean(currentPlan() && !selectedPlanIsHistorical() && currentPlan().status === "draft");
    }
    function serverDraft() {
      const plan = currentPlan();
      return { output: plan?.output_instructions || "", size: PRESENTATION_SIZES[plan?.presentation_size_code] ? plan.presentation_size_code : "smart_fit" };
    }
    function readEditorDraft() {
      const output = node("#outputInstructions");
      const size = node("#presentationSize");
      const createOutput = node("#firstInstructions");
      const createSize = node("#firstPresentationSize");
      if (currentPlan()) return { output: output?.value || "", size: size?.value || "smart_fit" };
      return { output: createOutput?.value || "", size: createSize?.value || "smart_fit" };
    }
    function draftDiffersFromServer(value = draftBuffer) {
      if (!currentPlan()) return Boolean(value.output.trim() || value.size !== "smart_fit");
      const server = serverDraft();
      return value.output !== server.output || value.size !== server.size;
    }
    function captureDraft() {
      draftBuffer = readEditorDraft();
      dirty = draftDiffersFromServer(draftBuffer);
      return { ...draftBuffer };
    }
    function restoreDraft(value = draftBuffer) {
      const output = node("#outputInstructions");
      const size = node("#presentationSize");
      const createOutput = node("#firstInstructions");
      const createSize = node("#firstPresentationSize");
      if (currentPlan()) {
        if (output) output.value = value.output;
        if (size) size.value = PRESENTATION_SIZES[value.size] ? value.size : "smart_fit";
      } else {
        if (createOutput) createOutput.value = value.output;
        if (createSize) createSize.value = PRESENTATION_SIZES[value.size] ? value.size : "smart_fit";
      }
    }
    function setDraftFromServer() {
      draftBuffer = currentPlan() ? serverDraft() : { output: "", size: "smart_fit" };
      dirty = false;
      restoreDraft();
    }

    function setPrimary(code) {
      document.querySelectorAll('[data-recommended-action="true"]').forEach((item) => item.removeAttribute("data-recommended-action"));
      primary.removeAttribute("data-action-code");
      const registered = code ? ACTIONS[code] : null;
      if (!trusted || !registered || registered.stage !== STAGE || registered.kind !== ACTIONS[code]?.kind || busy) {
        primary.disabled = true;
        primary.textContent = busy ? "正在处理" : "暂不可用";
        actionLabel.textContent = trusted ? "当前没有安全的推荐操作" : "下一步暂不可用";
        return;
      }
      primary.disabled = false;
      primary.textContent = registered.label;
      primary.dataset.actionCode = code;
      primary.dataset.recommendedAction = "true";
      actionLabel.textContent = registered.label;
    }

    function recommendedCode() {
      if (readFailed) return "retry_video_plan_read";
      if (conflict) return "load_latest_video_plan";
      if (dirty) return currentPlan() ? "save_video_plan_draft" : "create_video_plan";
      if (selectedPlanIsHistorical()) return "return_to_current_video_plan";
      const action = registeredAction(projection?.recommended_action);
      return action?.code || null;
    }

    function renderTaskSummary() {
      const context = node("#taskContext");
      const title = node("#taskSummaryTitle");
      const status = node("#taskStatus");
      const saveStatus = node("#saveStatus");
      const next = node("#taskNext");
      const blocker = node("#taskBlocker");
      const product = currentProduct();
      context.textContent = product ? `${project?.name || ""} · ${product.revision?.product_name || "未命名商品"}` : "正在读取项目与商品";

      let task = { title: "载入视频方案", status: "正在加载", statusClass: "uploading", saved: "等待载入", next: "等待视频方案载入", blocker: "" };
      if (readFailed) {
        task = { title: "视频方案暂时无法读取", status: "读取失败", statusClass: "failure", saved: "未载入", next: "刷新当前方案", blocker: readFailureMessage || "当前方案、预检和人工审核状态未完整载入。" };
      } else if (!projection || !project || !planWorkspace) {
        // Keep the loading summary until the projection is trusted.
      } else if (conflict) {
        task = { title: "方案版本冲突", status: "需要处理", statusClass: "blocked", saved: "本地修改仍保留", next: "载入服务端最新状态", blocker: "服务端版本已变化；载入最新状态后，再决定是否保存本地文字和呈现大小。" };
      } else if (dirty) {
        task = { title: "保存当前方案草稿", status: "待保存", statusClass: "", saved: "有未保存修改", next: "保存草稿", blocker: "保存后才能运行预检或切换方案。" };
      } else if (selectedPlanIsHistorical()) {
        task = { title: "正在查看历史方案", status: "历史版本", statusClass: "superseded", saved: "只读", next: "回到当前方案", blocker: "历史方案只用于核对，不能保存、预检或审核。" };
      } else if (registeredAction(projection?.recommended_action)?.code === "return_to_avatar") {
        task = { title: "视频方案上游需要处理", status: "上游已变化", statusClass: "blocked", saved: currentPlan() ? "当前版本已保留" : "尚未创建",
          next: "返回人物", blocker: "当前文案或人物真值已变化；请先回到人物阶段重新确认，旧方案不能继续预检或审核。" };
      } else if (!currentPlan()) {
        task = { title: "创建第一版视频方案", status: "尚无方案", statusClass: "", saved: "等待输入", next: "填写制作说明并创建方案", blocker: "" };
      } else if (activeRun()) {
        task = { title: "方案正在预检", status: currentRun().status === "queued" ? "已排队" : "预检中", statusClass: "uploading", saved: "已保存", next: "等待预检完成", blocker: "预检完成后仍需单独进行人工审核。" };
      } else if (currentRun()?.status === "failed") {
        task = { title: "预检未完成", status: "预检失败", statusClass: "failure", saved: "已保存", next: "重新预检", blocker: "本次技术失败没有形成业务结论，也不会自动批准方案。" };
      } else if (!currentResult()) {
        task = { title: "方案待预检", status: "待预检", statusClass: "", saved: "已保存", next: "开始预检", blocker: "预检只验证门禁，不代替人工批准。" };
      } else if (["blocked", "invalidated"].includes(currentResult().status)) {
        task = { title: currentResult().status === "invalidated" ? "预检结论已失效" : "预检发现阻断", status: PREFLIGHT_LABELS[currentResult().status], statusClass: "blocked", saved: "已保存", next: "处理阻断后重新预检", blocker: "请从上游引用返回人物、文案或商品资料；旧预检不能用于审核。" };
      } else if (reviewState()?.status === "approved") {
        task = { title: "方案已批准", status: "已批准", statusClass: "ready", saved: "已保存", next: "进入生产", blocker: "" };
      } else if (reviewState()?.status === "pending") {
        task = { title: "方案待人工决策", status: "待人工审核", statusClass: "uploading", saved: "已保存", next: "批准方案或要求修改", blocker: "预检通过或存在允许审核的提醒，都不等于人工批准。" };
      } else if (["changes_requested", "revoked"].includes(reviewState()?.status)) {
        task = { title: reviewState().status === "changes_requested" ? "审核要求修改方案" : "方案批准已失效", status: REVIEW_LABELS[reviewState().status], statusClass: "blocked", saved: "已保存", next: "基于此方案修改", blocker: reviewState()?.decision_reason || "创建新方案版本后，需要重新预检和人工审核。" };
      } else if (reviewGate().can_submit === true) {
        task = { title: "预检已完成，等待人工审核", status: "待提交审核", statusClass: "uploading", saved: "已保存", next: "提交方案审核", blocker: "预检结论和人工批准保持独立。" };
      } else {
        task = { title: planStage?.business_status || "方案待处理", status: planStage?.business_status || "需要处理", statusClass: "blocked", saved: "已保存", next: "核对方案门禁", blocker: (planStage?.blocker_codes || []).join(" ") || "当前没有可安全执行的推荐操作。" };
      }
      title.textContent = task.title;
      status.textContent = task.status;
      status.className = `state ${task.statusClass}`;
      saveStatus.textContent = task.saved;
      next.textContent = task.next;
      blocker.hidden = !task.blocker;
      blocker.textContent = task.blocker;
      node("#workspaceTechnicalStage").textContent = STAGE;
      node("#workspaceProjectionVersion").textContent = projection ? `v${projection.projection_version} · 动作表 v${projection.action_registry_version}` : "待载入";
      node("#workspaceTechnicalObjectRow").hidden = !currentPlan();
      node("#workspaceTechnicalObject").textContent = currentPlan() ? `VideoPlan ${currentPlan().id} · row v${currentPlan().row_version}` : "尚未创建";
      setPrimary(recommendedCode());
    }

    function setStageLinks(failed = false) {
      const stageValues = projection?.stages || [];
      for (const link of document.querySelectorAll("[data-stage-code]")) {
        const state = link.closest("li") || link;
        const stage = link.dataset.stageCode;
        const value = stageValues.find((item) => item.code === stage);
        const migrated = value?.implementation_status === "workspace" && ["ok", "error"].includes(value.read_status);
        const legacy = value?.implementation_status === "legacy" && value.read_status === "not_loaded" &&
          value.current_object === null && Array.isArray(value.blocker_codes) && value.blocker_codes.length === 0;
        if (failed || (!migrated && !legacy)) {
          link.removeAttribute("href");
          link.setAttribute("aria-disabled", "true");
          state.dataset.stageState = "blocked";
          state.removeAttribute("aria-current");
          continue;
        }
        link.removeAttribute("aria-disabled");
        link.href = stage === "production" ? productionUrl(projectId, productId) : workspaceUrl(projectId, productId, stage, stage === STAGE ? selectedPlanId() : null);
        state.dataset.stageState = value.read_status === "error" ? "error" :
          stage === STAGE ? "current" : value?.blocker_codes?.length ? "blocked" : value?.current_object ? "completed" : "available";
        if (stage === STAGE) state.setAttribute("aria-current", "step");
        else state.removeAttribute("aria-current");
      }
      const summary = node(".workspace-mobile-stages summary");
      if (summary) summary.textContent = failed ? "阶段状态暂不可用" : "阶段 4/5 · 视频方案";
    }

    function renderProducts() {
      const list = node("#productList");
      if (!list || !project?.products) return;
      list.replaceChildren(...project.products.map((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "product-list-item secondary";
        button.dataset.productId = item.id;
        button.setAttribute("aria-current", String(item.id === productId));
        const title = document.createElement("strong");
        title.textContent = item.revision?.product_name || item.name || "未命名商品";
        const meta = document.createElement("span");
        meta.textContent = item.id === productId ? planStage?.business_status || "当前商品" : "打开视频方案";
        button.append(title, meta);
        button.addEventListener("click", () => {
          selectedProductTrigger = button;
          guardNavigation(() => navigateProduct(item.id));
        });
        return button;
      }));
    }

    function upstreamCard(label, href, meta = "当前引用") {
      const card = document.createElement("a");
      card.className = "upstream-card";
      card.href = href;
      const name = document.createElement("strong");
      name.textContent = label;
      const detail = document.createElement("span");
      detail.textContent = meta;
      card.append(name, detail);
      return card;
    }

    function renderVersions() {
      const versions = [...(planWorkspace?.versions || [])].sort((left, right) =>
        (Number(right.version_number) || 0) - (Number(left.version_number) || 0));
      const renderButton = (version) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `workspace-plan-version${version.id === selectedPlanId() ? " selected" : ""}`;
        button.dataset.planId = version.id;
        button.setAttribute("aria-current", String(version.id === selectedPlanId()));
        const title = document.createElement("strong");
        title.textContent = `方案 v${version.version_number}`;
        const meta = document.createElement("small");
        meta.textContent = PLAN_LABELS[version.status] || text(version.status, "状态未知");
        button.append(title, meta);
        button.addEventListener("click", () => {
          versionDialogTrigger = button;
          guardNavigation(() => navigatePlan(version.id));
        });
        return button;
      };
      node("#versionList").replaceChildren(...versions.map(renderButton));
      node("#mobileVersionList").replaceChildren(...versions.map(renderButton));
      node("#openVersionDrawer").hidden = versions.length === 0;
    }

    function renderPlanEditor() {
      const plan = currentPlan();
      const empty = node("#emptyPlan");
      const editor = node("#planWorkspace");
      empty.hidden = Boolean(plan);
      editor.hidden = !plan;
      if (!plan) {
        node("#videoPlanVersionSummary").textContent = "尚无方案版本";
        return;
      }
      const historical = selectedPlanIsHistorical();
      const editable = planIsEditable() && !busy;
      node("#videoPlanVersionSummary").textContent = historical ? `正在查看方案 v${plan.version_number} · 历史只读` : `当前方案 v${plan.version_number}`;
      node("#planVersionTitle").textContent = `方案 v${plan.version_number}`;
      setBadge(node("#videoPlanState"), planStage?.business_status || PLAN_LABELS[plan.status] || "视频方案", planStage?.business_status);
      setBadge(node("#planVersionState"), PLAN_LABELS[plan.status] || "状态未知", plan.status);
      const output = node("#outputInstructions");
      const size = node("#presentationSize");
      if (!dirty) {
        output.value = plan.output_instructions || "";
        size.value = PRESENTATION_SIZES[plan.presentation_size_code] ? plan.presentation_size_code : "smart_fit";
      } else restoreDraft();
      output.readOnly = !editable;
      size.disabled = !editable;
      node("#saveVideoPlanDraft").hidden = !editable;
      node("#saveVideoPlanDraft").disabled = !dirty || busy;
      node("#deriveVideoPlanDraft").hidden = historical || plan.status === "draft" || busy;
      node("#runVideoPlanPreflight").hidden = historical || plan.status === "superseded";
      node("#runVideoPlanPreflight").disabled = historical || dirty || busy || activeRun();
      node("#returnCurrentVideoPlan").hidden = !historical;
      node("#dirtyState").textContent = dirty ? "有未保存的修改，请先保存后预检或切换方案。" :
        historical ? "历史版本只读，不能修改或运行命令。" : plan.status === "draft" ? "所有修改需要显式保存。" : "此版本已锁定，修改会创建新方案版本。";

      const upstream = plan.upstream_snapshot || {};
      node("#upstreamCards").replaceChildren(
        upstreamCard("商品资料", workspaceUrl(projectId, productId, "product_content")),
        upstreamCard("文案已人工批准", workspaceUrl(projectId, productId, "copy")),
        upstreamCard("人物已确认", workspaceUrl(projectId, productId, "avatar"))
      );
      const details = node("#capabilitySnapshot");
      details.replaceChildren();
      const ids = [
        ["product_revision_id", upstream.product_revision_id],
        ["copy_version_id", upstream.copy_version_id],
        ["avatar_selection_id", upstream.avatar_selection_id],
        ["avatar_asset_version_id", upstream.avatar_asset_version_id],
        ["capability_snapshot", plan.capability_config_snapshot?.snapshot_version]
      ];
      const list = document.createElement("dl");
      list.className = "workspace-technical-facts";
      for (const [label, value] of ids) {
        const row = document.createElement("div");
        const term = document.createElement("dt");
        const definition = document.createElement("dd");
        term.textContent = label;
        definition.textContent = value || "未就绪";
        row.append(term, definition);
        list.append(row);
      }
      details.append(list);
      const capabilities = plan.capability_config_snapshot?.verified_capabilities || [];
      if (capabilities.length) {
        const heading = document.createElement("p");
        heading.className = "muted";
        heading.textContent = "已验证能力";
        details.append(heading, ...capabilities.map((item) => {
          const value = document.createElement("p");
          value.textContent = `${text(item.code, "能力未知")} · ${text(item.evidence_reference, "证据待确认")}`;
          return value;
        }));
      }
    }

    function renderPreflight() {
      const run = currentRun();
      const result = currentResult();
      if (activeRun(run)) setBadge(node("#preflightBadge"), run.status === "queued" ? "预检已排队" : "预检中", run.status);
      else if (run?.status === "failed") setBadge(node("#preflightBadge"), "预检未完成", "failed");
      else setBadge(node("#preflightBadge"), PREFLIGHT_LABELS[result?.status || "not_run"] || "预检状态未知", result?.status || "not_run");
      const summary = node("#preflightSummary");
      if (run?.status === "failed") summary.textContent = "预检未完成（技术原因），没有形成业务结论。可以重新预检。";
      else if (activeRun(run)) summary.textContent = `预检${PREFLIGHT_RUN_LABELS[run.status] || "处理中"}，可离开本页，返回后从服务端恢复状态。`;
      else if (result) summary.textContent = `本次预检结论：${PREFLIGHT_LABELS[result.status] || "状态未知"}。预检通过或存在提醒，都不等于人工批准。`;
      else summary.textContent = "尚未运行预检。保存方案后开始预检。";
      const groups = node("#preflightGroups");
      groups.replaceChildren();
      for (const [name, group] of Object.entries(result?.groups || {})) {
        const block = document.createElement("section");
        block.className = `workspace-plan-check-group ${group.status || ""}`;
        const heading = document.createElement("h4");
        const label = document.createElement("span");
        const state = document.createElement("span");
        label.textContent = GROUP_LABELS[name] || name;
        state.textContent = PREFLIGHT_LABELS[group.status] || text(group.status, "状态未知");
        state.className = `state ${stateClass(group.status)}`;
        heading.append(label, state);
        block.append(heading);
        for (const check of group.checks || []) {
          const row = document.createElement("p");
          row.className = "workspace-plan-check-row";
          row.textContent = text(check.message, "检查项待确认");
          block.append(row);
        }
        groups.append(block);
      }
      const history = planWorkspace?.preflight?.history || [];
      node("#preflightHistorySummary").textContent = `历史预检（${history.length}）`;
      node("#preflightHistory").replaceChildren(...history.map((item) => {
        const row = document.createElement("div");
        row.className = "workspace-plan-history-row";
        const title = document.createElement("strong");
        const meta = document.createElement("span");
        title.textContent = item.status === "failed" ? "预检未完成（技术原因）" : PREFLIGHT_LABELS[item.result?.status || item.status] || "预检记录";
        meta.textContent = item.created_at ? new Date(item.created_at).toLocaleString("zh-CN") : "时间待确认";
        row.append(title, meta);
        return row;
      }));
    }

    function renderReview() {
      const review = reviewState();
      const status = review?.status || "not_submitted";
      setBadge(node("#reviewBadge"), REVIEW_LABELS[status] || "审核状态未知", status);
      const summary = node("#reviewSummary");
      summary.textContent = status === "not_submitted" ? "方案尚未提交人工审核。" :
        status === "pending" ? "方案等待人工决策。预检通过或存在提醒不等于人工批准。" :
          status === "approved" ? "当前方案已获人工批准；预检结论仍单独保留。" :
            status === "changes_requested" ? "审核人要求修改，请创建新方案版本后重新预检。" :
              status === "revoked" ? "原批准已失效，不能原地恢复；请创建新版本和新的审核记录。" : "审核状态待确认。";
      const reason = review?.decision_reason || (status === "revoked" ? "上游内容已变化，原批准不再有效。" : "");
      setNotice(node("#reviewReason"), reason, "blocked");
      const historical = selectedPlanIsHistorical();
      const canSubmit = !historical && !dirty && (status === "not_submitted" || ["changes_requested", "revoked"].includes(status)) && reviewGate().can_submit === true;
      const canApprove = !historical && !dirty && status === "pending" && (reviewGate().can_approve === true || reviewGate().can_decide === true);
      node("#submitReview").hidden = !canSubmit;
      node("#submitReview").disabled = busy;
      node("#approveReview").hidden = !canApprove;
      node("#approveReview").disabled = busy;
      node("#requestChanges").hidden = historical || status !== "pending";
      node("#requestChanges").disabled = busy;
      const productionNotice = node("#productionNotice");
      if (status === "approved") {
        productionNotice.hidden = false;
        productionNotice.textContent = "方案批准后可进入生产页面；本工作区不会创建生产工单。";
      } else productionNotice.hidden = true;
      const history = humanReview()?.history || [];
      node("#reviewHistorySummary").textContent = `审核历史（${history.length}）`;
      node("#reviewHistory").replaceChildren(...history.map((item) => {
        const row = document.createElement("div");
        row.className = "workspace-plan-history-row";
        const title = document.createElement("strong");
        const meta = document.createElement("span");
        title.textContent = REVIEW_LABELS[item.status] || "审核记录";
        meta.textContent = `${item.created_at ? new Date(item.created_at).toLocaleString("zh-CN") : "时间待确认"}${item.review_mode === "self_review" ? " · 本人审核" : ""}`;
        row.append(title, meta);
        return row;
      }));
    }

    function renderPanel() {
      panel.hidden = false;
      node("#videoPlanWorkspaceHeading").textContent = "制定并审核视频方案";
      node("#videoPlanWorkspaceLoading").hidden = true;
      node("#videoPlanWorkspaceContent").hidden = false;
      renderVersions();
      renderPlanEditor();
      if (currentPlan()) {
        renderPreflight();
        renderReview();
      } else {
        setBadge(node("#videoPlanState"), planStage?.business_status || "尚无方案", "not_run");
        node("#videoPlanEditorNotice").hidden = true;
      }
    }

    function renderFailure() {
      panel.hidden = false;
      node("#videoPlanWorkspaceLoading").hidden = true;
      node("#videoPlanWorkspaceContent").hidden = true;
      node("#videoPlanWorkspaceHeading").textContent = "视频方案暂时无法读取";
      setBadge(node("#videoPlanState"), "读取失败", "failed");
      setStageLinks(true);
      renderTaskSummary();
    }

    function render() {
      if (readFailed) return renderFailure();
      node("#projectName").textContent = project?.name || "正在加载...";
      document.body.dataset.workspaceStage = STAGE;
      document.body.dataset.mobileLayer = "detail";
      node("#editor").hidden = true;
      node("#copyWorkspacePanel").hidden = true;
      node("#avatarWorkspacePanel").hidden = true;
      renderProducts();
      setStageLinks(false);
      renderPanel();
      renderTaskSummary();
    }

    function replaceUrl() {
      const next = workspaceUrl(projectId, productId, STAGE, selectedPlanId());
      history.replaceState({ ...(history.state || {}), planWorkspaceHistoryIndex: acceptedHistoryIndex, productId, planId: selectedPlanId() }, "", next);
    }

    function clearPolling() {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = null;
      pollEpoch += 1;
    }

    function schedulePolling() {
      clearPolling();
      const run = currentRun();
      const plan = currentPlan();
      if (!plan || selectedPlanIsHistorical() || !activeRun(run)) return;
      if (run.video_plan_version_id && run.video_plan_version_id !== plan.id) return failRead("预检作用域已变化，请刷新当前方案。");
      const epoch = pollEpoch;
      pollTimer = setTimeout(async () => {
        if (epoch !== pollEpoch) return;
        try {
          await loadProjection({ planId: plan.id, focus: false, preserveDraft: dirty, scoped: true });
        } catch (_error) {
          failRead("预检状态暂时无法读取，请刷新当前方案。");
        }
      }, 1200);
    }

    function failRead(message = "视频方案工作区加载失败，请刷新重试。") {
      clearPolling();
      projection = null;
      planStage = null;
      planWorkspace = null;
      trusted = true;
      readFailed = true;
      readFailureMessage = message;
      conflict = false;
      renderFailure();
    }

    function workspaceRequestUrl(requestedPlanId = null) {
      const url = new URL(`/api/projects/${encodeURIComponent(projectId)}/products/${encodeURIComponent(productId)}/operator-workspace`, location.origin);
      url.searchParams.set("stage", STAGE);
      if (requestedPlanId) url.searchParams.set("plan", requestedPlanId);
      return `${url.pathname}${url.search}`;
    }

    async function loadProjection({ planId: requestedPlanId = null, focus = true, preserveDraft = false, scoped = false } = {}) {
      clearPolling();
      const requestedProduct = productId;
      const localDraft = preserveDraft || dirty ? captureDraft() : null;
      node("#videoPlanWorkspaceLoading").hidden = false;
      node("#videoPlanWorkspaceContent").hidden = true;
      try {
        const [workspaceBody, projectBody] = await Promise.all([
          request(workspaceRequestUrl(requestedPlanId)),
          request(`/api/projects/${encodeURIComponent(projectId)}`)
        ]);
        if (productId !== requestedProduct) return;
        const validated = validateProjection(workspaceBody.workspace);
        if (!validated) throw new Error("OPERATOR_WORKSPACE_RESPONSE_INVALID");
        const exactProduct = projectBody.project?.products?.find((item) => item.id === requestedProduct);
        if (!exactProduct || exactProduct.current_revision_id !== workspaceBody.workspace.product.current_revision_id) throw new Error("OPERATOR_WORKSPACE_RESPONSE_INVALID");
        const selected = validated.planWorkspace.current_plan;
        if (requestedPlanId && (!selected || selected.id !== requestedPlanId)) throw new Error("VIDEO_PLAN_NOT_FOUND");
        project = projectBody.project;
        productId = requestedProduct;
        projection = workspaceBody.workspace;
        planStage = validated.stage;
        planWorkspace = validated.planWorkspace;
        planId = selected?.id || null;
        trusted = true;
        readFailed = false;
        readFailureMessage = "";
        conflict = preserveDraft ? conflict : false;
        if (localDraft) {
          draftBuffer = localDraft;
          dirty = draftDiffersFromServer(localDraft);
          restoreDraft(localDraft);
        } else setDraftFromServer();
        render();
        replaceUrl();
        if (focus) node("#videoPlanWorkspaceHeading").focus();
        schedulePolling();
        return true;
      } catch (error) {
        if (scoped || !readFailed) failRead(error?.message === "VIDEO_PLAN_NOT_FOUND" ? "当前方案不存在或已不可见，请刷新当前方案。" : "视频方案工作区加载失败，请刷新重试。");
        throw error;
      }
    }

    async function bootstrap({ focus = true } = {}) {
      node("#videoPlanWorkspaceLoading").hidden = false;
      node("#videoPlanWorkspaceContent").hidden = true;
      try {
        const nextRuntime = await request("/api/runtime");
        runtime = nextRuntime;
        if (runtime.operatorWorkspaceEnabled !== true || runtime.videoPlanningEnabled !== true || runtime.avatarSelectionEnabled !== true || runtime.copyReviewEnabled !== true) {
          location.replace(legacyPlanUrl(projectId, productId, planId));
          return false;
        }
        await loadProjection({ planId, focus });
        return true;
      } catch (_error) {
        failRead("视频方案工作区加载失败，请刷新重试。");
        return false;
      }
    }

    function guardNavigation(work) {
      if (!dirty) return work();
      pendingNavigation = work;
      dialogTrigger = document.activeElement;
      node("#workspaceUnsavedTitle").textContent = "保留当前视频方案修改";
      unsavedDialog.querySelector(".dialog-body p").textContent = "切换商品、方案版本、刷新或返回前，请先处理当前修改。";
      unsavedDialog.showModal();
      node("#keepWorkspaceEditing").focus();
    }

    function restoreFocus(trigger = dialogTrigger, fallback = node("#videoPlanWorkspaceHeading")) {
      const candidate = trigger?.isConnected && !candidateHidden(trigger) ? trigger : fallback;
      candidate?.focus?.();
    }

    function candidateHidden(target) {
      return target.hidden || target.disabled || target.getAttribute("aria-hidden") === "true";
    }

    async function finishUnsaved(mode) {
      const work = pendingNavigation;
      if (!work) {
        unsavedDialog.close();
        restoreFocus();
        return;
      }
      if (mode === "keep") {
        pendingNavigation = null;
        unsavedDialog.close();
        restoreFocus(node("#outputInstructions"));
        return;
      }
      if (mode === "save" && !(await saveDraft())) return;
      if (mode === "discard") {
        dirty = false;
        conflict = false;
        draftBuffer = { output: "", size: "smart_fit" };
      }
      pendingNavigation = null;
      unsavedDialog.close();
      await work();
    }

    async function navigateProduct(nextProductId) {
      if (!nextProductId || nextProductId === productId) return;
      productId = nextProductId;
      planId = null;
      projection = null;
      planStage = null;
      planWorkspace = null;
      dirty = false;
      conflict = false;
      acceptedHistoryIndex += 1;
      history.pushState({ ...(history.state || {}), planWorkspaceHistoryIndex: acceptedHistoryIndex, productId, planId: null }, "", workspaceUrl(projectId, productId, STAGE));
      document.body.dataset.mobileLayer = "detail";
      await bootstrap();
    }

    async function navigatePlan(nextPlanId) {
      if (!nextPlanId) return;
      planId = nextPlanId;
      acceptedHistoryIndex += 1;
      history.pushState({ ...(history.state || {}), planWorkspaceHistoryIndex: acceptedHistoryIndex, productId, planId }, "", workspaceUrl(projectId, productId, STAGE, nextPlanId));
      await bootstrap();
    }

    async function navigateStage(target) {
      if (!target) return;
      location.assign(target);
    }

    async function loadLatest() {
      if (busy) return false;
      const local = captureDraft();
      busy = true;
      renderTaskSummary();
      try {
        await loadProjection({ planId: null, focus: false, preserveDraft: true });
        draftBuffer = local;
        dirty = draftDiffersFromServer(local);
        conflict = false;
        restoreDraft(local);
        setNotice(node("#videoPlanEditorNotice"), "已载入服务端最新状态；本地文字和呈现大小仍保留，请核对后再保存。", "blocked");
        renderPlanEditor();
        renderTaskSummary();
        return true;
      } catch (_error) {
        return false;
      } finally {
        busy = false;
        renderTaskSummary();
      }
    }

    function commandUrl(code, plan) {
      const encodedProduct = encodeURIComponent(productId);
      if (code === "create_video_plan") return `/api/products/${encodedProduct}/video-plans`;
      if (!plan?.id) return "";
      const encodedPlan = encodeURIComponent(plan.id);
      if (["save_video_plan_draft"].includes(code)) return `/api/products/${encodedProduct}/video-plans/${encodedPlan}`;
      if (["run_video_plan_preflight", "retry_video_plan_preflight"].includes(code)) return `/api/products/${encodedProduct}/video-plans/${encodedPlan}/preflight`;
      if (code === "derive_video_plan_draft") return `/api/products/${encodedProduct}/video-plans/${encodedPlan}/derive`;
      if (code === "submit_video_plan_review") return `/api/products/${encodedProduct}/video-plans/${encodedPlan}/reviews`;
      return "";
    }

    function responsePlanId(body) {
      return body?.current_plan?.id || body?.workspace?.current_plan?.id || body?.review?.current_review?.video_plan_version_id || null;
    }

    async function sendCommand(code, { url, method = "POST", payload = {}, nextPlanId = planId, preserveLocal = false } = {}) {
      if (busy) return false;
      const local = preserveLocal || dirty ? captureDraft() : null;
      busy = true;
      renderPlanEditor();
      renderTaskSummary();
      try {
        const body = await request(url, {
          method,
          headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify(payload)
        });
        const responseId = responsePlanId(body);
        if (responseId) nextPlanId = responseId;
        dirty = false;
        conflict = false;
        await loadProjection({ planId: nextPlanId, focus: false });
        if (code === "create_video_plan" || code === "derive_video_plan_draft") setNotice(node("#videoPlanEditorNotice"), code === "create_video_plan" ? "视频方案已创建。" : "已创建新的方案草稿。", "success");
        return true;
      } catch (error) {
        if (error.status === 409) {
          if (local) {
            draftBuffer = local;
            dirty = true;
            conflict = true;
            restoreDraft(local);
          }
          setNotice(node("#videoPlanEditorNotice"), "版本冲突：没有覆盖你的本地文字和呈现大小。请先载入最新状态。", "blocked");
        } else if (error.status === 422) {
          setNotice(node("#videoPlanEditorNotice"), "当前条件已变化，操作未执行。请核对上游状态后重试。", "blocked");
        } else {
          setNotice(node("#videoPlanEditorNotice"), "操作未完成，请稍后重试。", "error");
        }
        renderTaskSummary();
        return false;
      } finally {
        busy = false;
        renderPlanEditor();
        if (currentPlan()) {
          renderPreflight();
          renderReview();
        }
        renderTaskSummary();
      }
    }

    async function createPlan() {
      const value = captureDraft();
      if (!value.output.trim()) {
        setNotice(node("#videoPlanCreateNotice"), "请先填写制作说明。", "blocked");
        node("#firstInstructions").focus();
        return false;
      }
      return sendCommand("create_video_plan", {
        url: commandUrl("create_video_plan"),
        payload: { output_instructions: value.output.trim(), presentation_size_code: value.size, expected_head_revision: planWorkspace?.head_revision },
        nextPlanId: null
      });
    }

    async function saveDraft() {
      const plan = currentPlan();
      if (!plan || !planIsEditable() || !dirty || busy) return false;
      const value = captureDraft();
      if (!value.output.trim()) {
        setNotice(node("#videoPlanEditorNotice"), "制作说明不能为空。", "error");
        node("#outputInstructions").focus();
        return false;
      }
      return sendCommand("save_video_plan_draft", {
        url: commandUrl("save_video_plan_draft", plan),
        method: "PATCH",
        payload: { output_instructions: value.output.trim(), presentation_size_code: value.size, expected_revision: plan.row_version },
        nextPlanId: plan.id,
        preserveLocal: false
      });
    }

    async function deriveDraft() {
      const plan = currentPlan();
      if (!plan || selectedPlanIsHistorical() || busy) return false;
      const value = captureDraft();
      return sendCommand("derive_video_plan_draft", {
        url: commandUrl("derive_video_plan_draft", plan),
        payload: { output_instructions: value.output || plan.output_instructions || "", presentation_size_code: value.size || plan.presentation_size_code || "smart_fit", expected_head_revision: planWorkspace.head_revision },
        nextPlanId: null
      });
    }

    async function requestPreflight() {
      const plan = currentPlan();
      if (!plan || selectedPlanIsHistorical() || dirty || activeRun() || busy) return false;
      return sendCommand(currentRun()?.status === "failed" ? "retry_video_plan_preflight" : "run_video_plan_preflight", {
        url: commandUrl("run_video_plan_preflight", plan),
        payload: { expected_revision: plan.row_version },
        nextPlanId: plan.id
      });
    }

    function openReview(kind) {
      const plan = currentPlan();
      if (!plan || selectedPlanIsHistorical() || dirty) return;
      reviewAction = kind;
      dialogTrigger = document.activeElement;
      const titles = { submit: "提交方案审核", approve: "批准方案", changes: "要求修改" };
      node("#reviewDialogTitle").textContent = titles[kind];
      node("#confirmReviewAction").textContent = kind === "changes" ? "确认要求修改" : kind === "approve" ? "确认批准" : "确认提交";
      node("#reviewReasonField").hidden = kind !== "changes";
      node("#reviewReasonInput").value = "";
      node("#reviewDialogSummary").textContent = kind === "submit" ? "提交后进入人工审核。预检通过或存在提醒，都不会自动批准方案。" :
        kind === "approve" ? "批准前服务端会重新验证当前方案、预检和上游引用。" : "请填写明确的修改意见；当前方案与历史审核记录会保留。";
      node("#reviewDialogError").textContent = "";
      reviewDialog.showModal();
      (kind === "changes" ? node("#reviewReasonInput") : node("#confirmReviewAction")).focus();
    }

    function closeReview({ restore = true } = {}) {
      if (reviewDialog.open) reviewDialog.close();
      node("#reviewDialogError").textContent = "";
      if (restore) restoreFocus(dialogTrigger);
      dialogTrigger = null;
    }

    async function performReview() {
      const plan = currentPlan();
      const review = reviewState();
      if (!plan || busy) return false;
      if (reviewAction === "submit") {
        const ok = await sendCommand("submit_video_plan_review", {
          url: `/api/products/${encodeURIComponent(productId)}/video-plans/${encodeURIComponent(plan.id)}/reviews`,
          payload: {}, nextPlanId: plan.id
        });
        if (ok) closeReview();
        return ok;
      }
      if (!review?.id) return false;
      const reason = node("#reviewReasonInput").value.trim();
      if (reviewAction === "changes" && !reason) {
        node("#reviewDialogError").textContent = "请填写修改意见。";
        node("#reviewReasonInput").focus();
        return false;
      }
      const endpoint = reviewAction === "approve" ? "approve" : "request-changes";
      const ok = await sendCommand(`plan_review_${reviewAction}`, {
        url: `/api/products/${encodeURIComponent(productId)}/plan-reviews/${encodeURIComponent(review.id)}/${endpoint}`,
        payload: { expected_revision: review.row_version, ...(reviewAction === "changes" ? { reason } : {}) },
        nextPlanId: plan.id
      });
      if (ok) closeReview();
      return ok;
    }

    async function execute(code) {
      const action = ACTIONS[code];
      if (!action || action.stage !== STAGE || action.kind !== ACTIONS[code]?.kind) return false;
      if (code === "retry_video_plan_read") return bootstrap();
      if (code === "load_latest_video_plan") return loadLatest();
      if (code === "return_to_avatar") return navigateStage(workspaceUrl(projectId, productId, "avatar"));
      if (code === "return_to_current_video_plan") return navigatePlan(currentPlanId());
      if (code === "continue_to_production") return navigateStage(productionUrl(projectId, productId));
      if (code === "create_video_plan") return createPlan();
      if (code === "save_video_plan_draft") return saveDraft();
      if (code === "derive_video_plan_draft") return deriveDraft();
      if (["run_video_plan_preflight", "retry_video_plan_preflight"].includes(code)) return requestPreflight();
      if (code === "submit_video_plan_review") return openReview("submit");
      if (code === "approve_video_plan_review") return openReview("approve");
      return false;
    }

    function selectTab(name, focus = false) {
      const preflight = name === "preflight";
      const preflightTab = node("#showPreflight");
      const reviewTab = node("#showReview");
      preflightTab.setAttribute("aria-selected", String(preflight));
      reviewTab.setAttribute("aria-selected", String(!preflight));
      preflightTab.tabIndex = preflight ? 0 : -1;
      reviewTab.tabIndex = preflight ? -1 : 0;
      node("#preflightPanel").hidden = !preflight;
      node("#reviewPanel").hidden = preflight;
      if (focus) (preflight ? preflightTab : reviewTab).focus();
    }

    function handleTabKeydown(event) {
      const tabs = [node("#showPreflight"), node("#showReview")];
      const index = tabs.indexOf(event.currentTarget);
      if (index < 0) return;
      let next = null;
      if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next === null) return;
      event.preventDefault();
      selectTab(next === 0 ? "preflight" : "review", true);
    }

    async function applyHistoryEntry(targetIndex) {
      acceptedHistoryIndex = targetIndex;
      const url = new URL(location.href);
      const nextProductId = url.searchParams.get("product");
      const nextPlanId = url.searchParams.get("plan");
      productId = nextProductId;
      planId = nextPlanId;
      dirty = false;
      conflict = false;
      document.body.dataset.mobileLayer = "detail";
      if (!productId) return location.reload();
      await bootstrap();
    }

    function bind() {
      node("#videoPlanForm").addEventListener("submit", async (event) => { event.preventDefault(); await saveDraft(); });
      node("#videoPlanCreateForm").addEventListener("submit", async (event) => { event.preventDefault(); await createPlan(); });
      node("#outputInstructions").addEventListener("input", () => { captureDraft(); renderPlanEditor(); renderTaskSummary(); });
      node("#presentationSize").addEventListener("change", () => { captureDraft(); renderPlanEditor(); renderTaskSummary(); });
      node("#firstInstructions").addEventListener("input", () => { captureDraft(); renderPlanEditor(); renderTaskSummary(); });
      node("#firstPresentationSize").addEventListener("change", () => { captureDraft(); renderPlanEditor(); renderTaskSummary(); });
      primary.addEventListener("click", () => execute(primary.dataset.actionCode));
      node("#saveVideoPlanDraft").addEventListener("click", saveDraft);
      node("#deriveVideoPlanDraft").addEventListener("click", () => execute("derive_video_plan_draft"));
      node("#runVideoPlanPreflight").addEventListener("click", () => execute(currentRun()?.status === "failed" ? "retry_video_plan_preflight" : "run_video_plan_preflight"));
      node("#refreshVideoPlanWorkspace").addEventListener("click", () => guardNavigation(() => bootstrap()));
      node("#returnCurrentVideoPlan").addEventListener("click", () => guardNavigation(() => navigatePlan(currentPlanId())));
      node("#mobileVideoPlanProductBack").addEventListener("click", () => guardNavigation(() => {
        document.body.dataset.mobileLayer = "list";
        restoreFocus(selectedProductTrigger?.isConnected ? selectedProductTrigger : node(`#productList [data-product-id="${CSS.escape(productId)}"]`));
      }));
      node("#openVersionDrawer").addEventListener("click", () => {
        versionDialogTrigger = document.activeElement;
        versionDialog.showModal();
      });
      node("#closeVersionDialog").addEventListener("click", () => {
        versionDialog.close();
        restoreFocus(versionDialogTrigger);
      });
      node("#showPreflight").addEventListener("click", () => selectTab("preflight", true));
      node("#showReview").addEventListener("click", () => selectTab("review", true));
      node("#showPreflight").addEventListener("keydown", handleTabKeydown);
      node("#showReview").addEventListener("keydown", handleTabKeydown);
      node("#submitReview").addEventListener("click", () => openReview("submit"));
      node("#approveReview").addEventListener("click", () => openReview("approve"));
      node("#requestChanges").addEventListener("click", () => openReview("changes"));
      node("#reviewForm").addEventListener("submit", async (event) => { event.preventDefault(); await performReview(); });
      node("#closeReviewDialog").addEventListener("click", () => closeReview());
      node("#cancelReviewDialog").addEventListener("click", () => closeReview());
      node("#keepWorkspaceEditing").addEventListener("click", () => finishUnsaved("keep"));
      node("#closeWorkspaceUnsaved").addEventListener("click", () => {
        pendingNavigation = null;
        unsavedDialog.close();
        restoreFocus();
      });
      node("#discardWorkspaceChanges").addEventListener("click", () => finishUnsaved("discard"));
      node("#saveWorkspaceAndContinue").addEventListener("click", () => finishUnsaved("save"));
      for (const link of document.querySelectorAll("[data-stage-code]")) {
        link.addEventListener("click", (event) => {
          if (link.getAttribute("aria-disabled") === "true") return event.preventDefault();
          if (!dirty) return;
          event.preventDefault();
          const target = link.href;
          dialogTrigger = link;
          guardNavigation(() => location.assign(target));
        });
      }
      window.addEventListener("beforeunload", (event) => { if (dirty) event.preventDefault(); });
      window.addEventListener("popstate", async (event) => {
        const targetIndex = Number.isInteger(event.state?.planWorkspaceHistoryIndex) ? event.state.planWorkspaceHistoryIndex : null;
        if (historyTraversal === "restore_accepted") {
          historyTraversal = null;
          if (pendingHistory) {
            const pendingTargetIndex = pendingHistory.targetIndex;
            pendingNavigation = async () => {
              const delta = pendingTargetIndex - acceptedHistoryIndex;
              pendingHistory = null;
              historyTraversal = "apply_pending";
              history.go(delta);
            };
            dialogTrigger = node("#outputInstructions");
            unsavedDialog.showModal();
            node("#keepWorkspaceEditing").focus();
          }
          return;
        }
        if (historyTraversal === "apply_pending") {
          historyTraversal = null;
          pendingHistory = null;
          if (targetIndex == null) return location.reload();
          await applyHistoryEntry(targetIndex);
          return;
        }
        if (targetIndex == null) return location.reload();
        if (dirty) {
          pendingHistory = { targetIndex };
          historyTraversal = "restore_accepted";
          history.go(acceptedHistoryIndex - targetIndex);
          return;
        }
        await applyHistoryEntry(targetIndex);
      });
    }

    async function start() {
      if (!projectId || !productId) return location.replace("/projects.html");
      panel.classList.add("workspace-task-panel");
      panel.dataset.workspacePanel = "current-task";
      acceptedHistoryIndex = Number.isInteger(history.state?.planWorkspaceHistoryIndex) ? history.state.planWorkspaceHistoryIndex : 0;
      history.replaceState({ ...(history.state || {}), planWorkspaceHistoryIndex: acceptedHistoryIndex, productId, planId }, "", location.href);
      document.body.dataset.mobileLayer = "detail";
      node("#workspaceUnsavedTitle").textContent = "保留当前视频方案修改";
      bind();
      await bootstrap({ focus: false });
    }

    return { start };
  }

  window.HiflyPlanWorkspace = {
    async start({ projectId, productId, planId }) {
      if (!projectId || !productId) return location.replace("/projects.html");
      return createController({ projectId, initialProductId: productId, initialPlanId: planId }).start();
    }
  };
})();
