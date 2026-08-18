(async () => {
  const params = new URLSearchParams(location.search), projectId = params.get("project"), requestedProductId = params.get("product");
  let project, product, workspace, runtime, dirty = false, polling, reviewAction = "submit", pendingReload = null;
  let taskLoadError = "", taskConflict = false;
  const element = (selector) => document.querySelector(selector);
  const csrf = () => decodeURIComponent((document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hifly_identity_csrf=")) || "=").split("=").slice(1).join("="));
  const planLabels = { draft: "草稿", frozen: "已冻结", superseded: "已被替代" };
  const preflightLabels = { not_run: "未预检", passed: "预检通过", warning: "存在提醒", blocked: "被阻断", invalidated: "已失效" };
  const reviewLabels = { not_submitted: "未提交审核", pending: "审核中", approved: "已批准", changes_requested: "要求修改", revoked: "已撤销" };
  const presentationSizeLabels = { smart_fit: "智能适配", extra_large: "超大", large: "大", medium: "中", small: "小", extra_small: "超小" };
  const groupLabels = { upstream_validity: "A 上游有效性", plan_completeness: "B 方案完整性", production_readiness: "C 生产准备度" };

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {}); if (options.method && options.method !== "GET") headers.set("x-identity-csrf", csrf());
    const response = await fetch(url, { credentials: "same-origin", ...options, headers });
    if (response.status === 401) { location.replace("/login.html"); throw new Error("AUTH_REQUIRED"); }
    const body = await response.json(); if (!response.ok) throw Object.assign(new Error(body.error), { status: response.status, body }); return body;
  }
  function notice(target, message = "", tone = "") { target.className = `notice${tone ? ` ${tone}` : ""}`; target.textContent = message; }
  function stateClass(status) { return ["passed","approved"].includes(status) ? "ready" : ["queued","running","pending"].includes(status) ? "uploading" :
    ["warning","blocked","invalidated","changes_requested"].includes(status) ? "blocked" : ["failed"].includes(status) ? "failure" : ["superseded","revoked"].includes(status) ? "superseded" : ""; }
  function badge(target, label, status) { target.textContent = label; target.className = `state ${stateClass(status)}`; }
  function setTaskStatus(selector, text, status = "") {
    const target = element(selector);
    target.textContent = text;
    target.className = status ? `state ${stateClass(status)}` : "state";
  }
  function recommend(action) {
    const controls = ["#refreshPlan","#createPlan","#saveDraft","#deriveDraft","#runPreflight","#submitReview","#approveReview","#requestChanges","#createOrderLink"]
      .map(element).filter(Boolean);
    for (const control of controls) {
      if (!control.dataset.taskBaseClass) control.dataset.taskBaseClass = control.className;
      control.className = control.dataset.taskBaseClass;
      control.removeAttribute("data-recommended-action");
      if (control.tagName === "BUTTON" && control.id !== "refreshPlan") control.classList.add("secondary");
      if (control.id === "createOrderLink") control.classList.add("task-action-secondary");
    }
    if (!action || action.hidden || action.disabled || action.getAttribute("aria-disabled") === "true") return;
    action.className = action.dataset.taskBaseClass || "";
    if (action.tagName === "A") action.classList.add("button-link");
    action.setAttribute("data-recommended-action", "true");
  }
  function renderTaskSummary() {
    if (!element("#taskSummaryTitle")) return;
    element("#taskContext").textContent = project && product ? `${project.name} · ${product.revision.product_name || "未命名商品"}` : "正在读取项目与商品";
    element("#taskStage").textContent = "视频方案 · 4/5";
    const plan = workspace?.current_plan;
    const run = workspace?.preflight?.current_run;
    const result = workspace?.preflight?.current_result;
    const review = workspace?.review?.current_review;
    const reviewStatus = review?.status || "not_submitted";
    element("#taskPlanVersion").textContent = plan ? `方案 v${plan.version_number} · ${planLabels[plan.status]}` : "尚无方案";
    setTaskStatus("#taskPreflightStatus",
      ["queued","running"].includes(run?.status) ? "预检中" : run?.status === "failed" ? "预检失败" : preflightLabels[result?.status || "not_run"],
      ["queued","running"].includes(run?.status) ? "running" : run?.status === "failed" ? "failed" : result?.status || "not_run");
    setTaskStatus("#taskReviewStatus", reviewLabels[reviewStatus], reviewStatus);

    let task = { title: "载入视频方案", description: "正在读取方案、预检与人工审核", status: "正在加载", statusClass: "running",
      next: "等待视频方案载入", blocker: "", action: null };
    if (taskLoadError) {
      task = { title: "视频方案暂时无法载入", description: "没有改变当前方案。", status: "加载失败", statusClass: "failed",
        next: "刷新视频方案", blocker: taskLoadError, action: element("#refreshPlan") };
    } else if (!workspace || !project || !product) {
      // Keep loading truth.
    } else if (!plan) {
      task = { title: "创建第一版视频方案", description: "基于当前已批准文案和已确认人物固定制作说明。", status: "尚无方案", statusClass: "not_run",
        next: "填写制作说明并创建方案", blocker: "", action: element("#createPlan") };
    } else if (taskConflict) {
      task = { title: "方案版本冲突", description: "你的本地内容仍保留，未覆盖服务端版本。", status: "需要处理", statusClass: "blocked",
        next: "保留本地内容并刷新核对", blocker: "先复制或保留当前文字，再通过刷新查看服务端最新版本。", action: element("#refreshPlan") };
    } else if (dirty) {
      task = { title: "保存当前方案草稿", description: "保存后才能预检或切换方案。", status: "待保存", statusClass: "draft",
        next: "保存草稿", blocker: "当前制作说明有未保存修改。", action: element("#saveDraft") };
    } else if (plan.status === "superseded") {
      task = { title: "正在查看历史方案", description: "历史版本只读保留，不能继续预检或审核。", status: "已被替代", statusClass: "superseded",
        next: "从方案版本列表回到当前版本", blocker: "历史方案不能作为新的生产依据。", action: null };
    } else if (["queued","running"].includes(run?.status)) {
      task = { title: "方案正在预检", description: "结果由服务端保存，重新进入后可恢复。", status: "预检中", statusClass: "running",
        next: "等待预检完成，可离开后返回", blocker: "", action: null };
    } else if (run?.status === "failed") {
      task = { title: "预检未完成", description: "技术失败没有形成业务结论。", status: "预检失败", statusClass: "failed",
        next: "重新预检", blocker: "本次失败不等于方案不通过，也不会自动批准。", action: element("#runPreflight") };
    } else if (!result) {
      task = { title: "方案草稿待预检", description: "预检只验证门禁，不会代替人工批准。", status: "待预检", statusClass: "draft",
        next: "开始预检", blocker: "", action: element("#runPreflight") };
    } else if (["blocked","invalidated"].includes(result.status)) {
      task = { title: result.status === "invalidated" ? "预检结论已失效" : "预检发现阻断", description: "上游引用或方案条件需要先处理。",
        status: preflightLabels[result.status], statusClass: result.status, next: "处理上游阻断后重新预检",
        blocker: "请从上游引用卡片返回文案或人物步骤处理；旧预检不能用于审核。", action: null };
    } else if (reviewStatus === "approved") {
      const productionAvailable = runtime?.productionOrdersEnabled === true && workspace.production_order_available === true;
      task = productionAvailable
        ? { title: "方案已批准", description: "当前人工审核已批准方案。", status: "已批准", statusClass: "approved",
          next: "进入生产工单", blocker: "", action: element("#createOrderLink") }
        : { title: "方案已批准", description: "当前人工审核已批准方案。", status: "已批准", statusClass: "approved",
          next: "等待生产工单能力开放", blocker: workspace.production_order_notice || "生产工单当前未开放。", action: null };
    } else if (reviewStatus === "pending") {
      task = { title: "方案待人工决策", description: `${preflightLabels[result.status]}不等于人工批准。`, status: "待人工审核", statusClass: "pending",
        next: "批准方案或要求修改", blocker: "人工审核仍未完成。", action: element("#approveReview") };
    } else if (["changes_requested","revoked"].includes(reviewStatus)) {
      task = { title: reviewStatus === "changes_requested" ? "审核要求修改方案" : "方案批准已撤销", description: "历史审核保留，需创建新方案版本。",
        status: reviewLabels[reviewStatus], statusClass: reviewStatus, next: "基于此方案修改", blocker: review?.decision_reason || "修改后需要重新预检和人工审核。",
        action: element("#deriveDraft") };
    } else if (workspace.review.gate.can_submit) {
      task = { title: "预检已完成，等待人工审核", description: `${preflightLabels[result.status]}不等于人工批准。`, status: "待提交审核", statusClass: "pending",
        next: "提交方案审核", blocker: "", action: element("#submitReview") };
    } else {
      task = { title: "预检已完成，审核门禁未满足", description: "预检结论与人工批准保持独立。", status: "需要处理", statusClass: "blocked",
        next: "处理审核门禁", blocker: "当前方案不能提交人工审核，请核对预检和上游引用。", action: null };
    }
    element("#taskSummaryTitle").textContent = task.title;
    element("#taskSummaryDescription").textContent = task.description;
    setTaskStatus("#taskStatus", task.status, task.statusClass);
    element("#taskNext").textContent = task.next;
    element("#taskBlocker").hidden = !task.blocker;
    element("#taskBlocker").textContent = task.blocker;
    recommend(task.action);
  }
  function updateLocation(planId = workspace?.current_plan?.id) {
    const next = new URL(location.href); next.searchParams.set("project", project.id); next.searchParams.set("product", product.id);
    if (planId) next.searchParams.set("plan", planId); else next.searchParams.delete("plan"); history.replaceState(null, "", next);
  }
  function productionHref() { return `/production.html?project=${encodeURIComponent(project.id)}&product=${encodeURIComponent(product.id)}`; }
  function configureProductionLinks() {
    const href = productionHref();
    for (const id of ["#productionStageLink", "#mobileProductionStageLink"]) {
      const link = element(id);
      if (runtime?.productionOrdersEnabled === true) { link.href = href; link.removeAttribute("aria-disabled"); window.HiflyOperatorStages.set(link, "available"); }
      else { link.removeAttribute("href"); link.setAttribute("aria-disabled", "true"); window.HiflyOperatorStages.set(link, "blocked"); }
    }
  }
  function links() {
    element("#projectBreadcrumb").textContent = project.name; element("#projectBreadcrumb").href = `/project.html?id=${encodeURIComponent(project.id)}`;
    const facts = `/project.html?id=${encodeURIComponent(project.id)}`, copy = `/copy.html?project=${encodeURIComponent(project.id)}&revision=${encodeURIComponent(product.revision.id)}`;
    const avatar = `/avatar.html?project=${encodeURIComponent(project.id)}&product=${encodeURIComponent(product.id)}`;
    for (const id of ["#factsStageLink","#mobileFactsStageLink"]) element(id).href = facts;
    for (const id of ["#copyStageLink","#mobileCopyStageLink"]) element(id).href = copy;
    for (const id of ["#avatarStageLink","#mobileAvatarStageLink"]) element(id).href = avatar;
    const upstream = workspace?.current_plan?.upstream_snapshot || {};
    window.HiflyOperatorStages.set(["#factsStageLink", "#mobileFactsStageLink"], upstream.product_revision_id ? "completed" : "available");
    window.HiflyOperatorStages.set(["#copyStageLink", "#mobileCopyStageLink"], upstream.copy_version_id ? "completed" : "available");
    window.HiflyOperatorStages.set(["#avatarStageLink", "#mobileAvatarStageLink"], upstream.avatar_selection_id ? "completed" : "available");
    configureProductionLinks();
    const selector = element("#productSelector"); selector.replaceChildren(...project.products.map((item) => {
      const option = document.createElement("option"); option.value = item.id; option.textContent = item.revision.product_name || "未命名商品"; option.selected = item.id === product.id; return option;
    }));
  }
  function versionRow(item) {
    const button = document.createElement("button"); button.type = "button"; button.className = `version-row${item.id === workspace.current_plan?.id ? " selected" : ""}`;
    const left = document.createElement("span"), title = document.createElement("strong"), meta = document.createElement("small"), status = document.createElement("span");
    title.textContent = `方案 v${item.version_number}`; meta.textContent = `${planLabels[item.status]} · ${new Date(item.created_at).toLocaleString("zh-CN")}`;
    status.className = `state ${stateClass(item.status)}`; status.textContent = planLabels[item.status]; left.append(title,meta); button.append(left,status);
    button.addEventListener("click", () => guardReload(async () => { await loadWorkspace(item.id); element("#versionDialog").close(); })); return button;
  }
  function renderVersions() {
    const desktop = workspace.versions.slice().reverse().map(versionRow), mobile = workspace.versions.slice().reverse().map(versionRow);
    element("#versionList").replaceChildren(...desktop); element("#mobileVersionList").replaceChildren(...mobile);
  }
  function upstreamCard(label, href) {
    const card = document.createElement("a"); card.className = "upstream-card"; card.href = href;
    const name = document.createElement("strong"), meta = document.createElement("span"); name.textContent = label; meta.textContent = "当前引用"; card.append(name,meta); return card;
  }
  function renderEditor() {
    const plan = workspace.current_plan; element("#planVersionTitle").textContent = `方案 v${plan.version_number}`;
    badge(element("#planVersionState"), planLabels[plan.status], plan.status); badge(element("#planState"), planLabels[plan.status], plan.status);
    element("#contextSummary").textContent = "文案已人工批准 · 人物已确认";
    element("#upstreamCards").replaceChildren(
      upstreamCard("商品快照", `/project.html?id=${encodeURIComponent(project.id)}`),
      upstreamCard("文案已人工批准", `/copy.html?project=${encodeURIComponent(project.id)}&revision=${encodeURIComponent(product.revision.id)}`),
      upstreamCard("人物已确认", `/avatar.html?project=${encodeURIComponent(project.id)}&product=${encodeURIComponent(product.id)}`));
    const output = element("#outputInstructions"); output.value = plan.output_instructions; output.readOnly = plan.status !== "draft";
    const presentationSize = element("#presentationSize"); presentationSize.value = plan.presentation_size_code || "smart_fit"; presentationSize.disabled = plan.status !== "draft";
    element("#contextSummary").textContent = `文案已人工批准 · 人物已确认 · 呈现大小：${presentationSizeLabels[presentationSize.value] || "需核对"}`;
    element("#saveDraft").hidden = plan.status !== "draft"; element("#deriveDraft").hidden = plan.status !== "frozen";
    element("#runPreflight").hidden = plan.status === "superseded";
    dirty = false; syncDirtyControls();
    const upstream = plan.upstream_snapshot || {};
    const technicalIds = document.createElement("dl"); technicalIds.className = "technical-id-list";
    for (const [label, value] of [[
      "product_revision_id", upstream.product_revision_id
    ], [
      "copy_version_id", upstream.copy_version_id
    ], [
      "avatar_selection_id", upstream.avatar_selection_id
    ], [
      "avatar_asset_version_id", upstream.avatar_asset_version_id
    ]]) {
      const term = document.createElement("dt"), detail = document.createElement("dd");
      term.textContent = label; detail.textContent = value || "未就绪"; technicalIds.append(term, detail);
    }
    const caps = plan.capability_config_snapshot.verified_capabilities || [];
    element("#capabilitySnapshot").replaceChildren(technicalIds, ...caps.map((item) => { const row = document.createElement("span"); row.textContent = `已验证：${item.code}`; return row; }));
  }
  function renderPreflight() {
    const run = workspace.preflight.current_run, result = workspace.preflight.current_result;
    if (run?.status === "running" || run?.status === "queued") badge(element("#preflightBadge"), "预检中", "running");
    else if (run?.status === "failed") badge(element("#preflightBadge"), "预检未完成", "failed");
    else badge(element("#preflightBadge"), preflightLabels[result?.status || "not_run"], result?.status || "not_run");
    const summary = element("#preflightSummary"); summary.textContent = run?.status === "failed" ? "预检未完成（技术原因），没有产生业务结论。可以重新预检。" :
      ["queued","running"].includes(run?.status) ? "预检中，可离开本页；重新进入后会从服务端恢复状态。" : result ? `本次预检结论：${preflightLabels[result.status]}。预检通过不等于人工批准。` : "尚未运行预检。";
    const groups = element("#preflightGroups"); groups.replaceChildren();
    if (result) for (const [name, group] of Object.entries(result.groups)) {
      const block = document.createElement("section"); block.className = `check-group ${group.status}`;
      const heading = document.createElement("h3"), label = document.createElement("span"), status = document.createElement("span"); label.textContent = groupLabels[name] || name; status.className = `state ${stateClass(group.status)}`; status.textContent = preflightLabels[group.status] || group.status; heading.append(label,status); block.append(heading);
      for (const check of group.checks) { const row = document.createElement("p"); row.className = "check-row"; row.textContent = check.message; block.append(row); } groups.append(block);
    }
    element("#preflightHistorySummary").textContent = `历史预检（${workspace.preflight.history.length}）`;
    element("#preflightHistory").replaceChildren(...workspace.preflight.history.map((item) => { const row = document.createElement("div"); row.className = "history-row"; const title = document.createElement("strong"), meta = document.createElement("span"); title.textContent = item.status === "failed" ? "预检未完成（技术原因）" : preflightLabels[item.result?.status || "not_run"]; meta.textContent = new Date(item.created_at).toLocaleString("zh-CN"); row.append(title,meta); return row; }));
  }
  function renderReview() {
    const review = workspace.review.current_review, status = review?.status || "not_submitted"; badge(element("#reviewBadge"), reviewLabels[status], status);
    const productionAvailable = runtime?.productionOrdersEnabled === true && workspace.production_order_available === true;
    const productionNotice = workspace.production_order_notice || "创建生产工单尚未开放。";
    element("#reviewSummary").textContent = status === "not_submitted" ? "方案尚未提交人工审核。" : status === "pending" ? "方案审核中。审核人与提交人可以是同一成员，但会记录本人审核。" : status === "approved" ? productionNotice : status === "changes_requested" ? "审核要求修改，请创建新方案版本后重新预检。" : "方案批准已撤销，不可恢复；请创建新版本和新的审核记录。";
    notice(element("#reviewReason"), review?.decision_reason || (status === "revoked" ? "上游内容已变化，原批准不再有效。" : ""), status === "approved" ? "success" : "blocked");
    element("#submitReview").hidden = status !== "not_submitted" && !["changes_requested","revoked"].includes(status); element("#submitReview").disabled = !workspace.review.gate.can_submit;
    element("#approveReview").hidden = status !== "pending"; element("#requestChanges").hidden = status !== "pending";
    element("#createOrderDisabled").textContent = productionNotice;
    element("#createOrderDisabled").hidden = productionAvailable;
    element("#createOrderLink").hidden = !productionAvailable;
    element("#createOrderLink").href = productionHref();
    element("#reviewHistorySummary").textContent = `审核历史（${workspace.review.history.length}）`;
    element("#reviewHistory").replaceChildren(...workspace.review.history.map((item) => { const row = document.createElement("div"); row.className = "history-row"; const title = document.createElement("strong"), meta = document.createElement("span"); title.textContent = reviewLabels[item.status]; meta.textContent = `${new Date(item.created_at).toLocaleString("zh-CN")}${item.review_mode === "self_review" ? " · 本人审核" : ""}`; row.append(title,meta); return row; }));
  }
  function render() {
    links(); const hasPlan = Boolean(workspace.current_plan); element("#emptyPlan").hidden = hasPlan; element("#planWorkspace").hidden = !hasPlan; element("#openVersionDrawer").hidden = !hasPlan;
    if (!hasPlan) { badge(element("#planState"), "尚无方案", "not_run"); element("#contextSummary").textContent = "人物确认后可创建"; renderTaskSummary(); return; }
    renderVersions(); renderEditor(); renderPreflight(); renderReview(); updateLocation(); renderTaskSummary();
  }
  async function loadWorkspace(planId = null) {
    const query = planId ? `?planVersionId=${encodeURIComponent(planId)}` : "";
    workspace = await request(`/api/products/${encodeURIComponent(product.id)}/video-plan-workspace${query}`); taskLoadError = ""; taskConflict = false; render();
    if (["queued","running"].includes(workspace.preflight.current_run?.status)) startPolling(); else stopPolling();
  }
  async function bootstrap(planId = params.get("plan")) {
    try {
      const nextRuntime = await request("/api/runtime");
      const nextProject = (await request(`/api/projects/${encodeURIComponent(projectId)}`)).project;
      const nextProduct = nextProject.products.find((item) => item.id === (product?.id || requestedProductId)) || nextProject.products[0];
      if (!nextProduct) {
        location.replace(`/project.html?id=${nextProject.id}`);
        return false;
      }
      runtime = nextRuntime;
      project = nextProject;
      product = nextProduct;
      await loadWorkspace(planId);
      notice(element("#pageNotice"));
      return true;
    } catch (_error) {
      taskLoadError = "视频方案工作区加载失败，请刷新重试。";
      notice(element("#pageNotice"), taskLoadError, "error");
      renderTaskSummary();
      return false;
    }
  }
  function startPolling() { stopPolling(); polling = setInterval(() => loadWorkspace(workspace.current_plan.id).catch(() => undefined), 800); }
  function stopPolling() { if (polling) clearInterval(polling); polling = null; }
  async function mutate(url, method, payload, idempotent = false) {
    const local = { output: element("#outputInstructions").value, presentationSize: element("#presentationSize").value };
    try {
      workspace = await request(url, { method, headers: { "content-type": "application/json", ...(idempotent ? { "idempotency-key": crypto.randomUUID() } : {}) }, body: JSON.stringify(payload) }); taskConflict = false; render(); return true;
    } catch (error) {
      if (error.status === 409) { element("#outputInstructions").value = local.output; element("#presentationSize").value = local.presentationSize; dirty = true; taskConflict = true; element("#dirtyState").textContent = "此方案已被他人更新，你的制作说明和呈现大小仍保留在本页。请核对后再处理。"; notice(element("#editorNotice"), "版本冲突：没有覆盖你的本地修改。", "blocked"); renderTaskSummary(); }
      else if (error.status === 422) notice(element("#editorNotice"), "当前条件已变化，操作未执行。请刷新并按提示处理。", "blocked");
      else notice(element("#pageNotice"), "请求未完成，请稍后重试。", "error"); return false;
    }
  }
  function syncDirtyControls() {
    const plan = workspace?.current_plan, active = ["running","queued"].includes(workspace?.preflight?.current_run?.status);
    element("#runPreflight").disabled = Boolean(dirty || active);
    element("#dirtyState").textContent = dirty ? "有未保存的修改，请先保存后预检。" :
      plan?.status === "draft" ? "所有修改需要显式保存。" : "此版本已锁定，修改会创建新方案版本。";
    renderTaskSummary();
  }
  async function saveCurrentDraft() {
    return mutate(`/api/products/${product.id}/video-plans/${workspace.current_plan.id}`, "PATCH", {
      output_instructions: element("#outputInstructions").value, presentation_size_code: element("#presentationSize").value,
      expected_revision: workspace.current_plan.row_version
    });
  }
  function guardReload(action) {
    if (!dirty) return void action();
    pendingReload = action; element("#unsavedDialog").showModal();
  }
  async function finishGuardedReload(mode) {
    const action = pendingReload;
    if (!action) return element("#unsavedDialog").close();
    if (mode === "save" && !await saveCurrentDraft()) return;
    if (mode === "cancel") { pendingReload = null; return element("#unsavedDialog").close(); }
    pendingReload = null; dirty = false; element("#unsavedDialog").close(); await action();
  }
  function openReviewDialog(action) {
    reviewAction = action; const titles = { submit: "提交方案审核", approve: "批准方案", changes: "要求修改" };
    element("#reviewDialogTitle").textContent = titles[action]; element("#confirmReviewAction").textContent = action === "changes" ? "确认要求修改" : action === "approve" ? "确认批准" : "确认提交";
    element("#reviewReasonField").hidden = action !== "changes"; element("#reviewReasonInput").value = "";
    element("#reviewDialogSummary").textContent = action === "submit" ? "提交后进入人工审核。预检通过或存在允许审核的提醒，都不会自动批准方案。" : action === "approve" ? "批准前会由服务端再次验证预检和上游引用。" : "填写明确修改意见；当前方案与历史审核记录会保留。";
    element("#reviewDialogError").textContent = ""; element("#reviewDialog").showModal();
  }
  async function performReview() {
    const plan = workspace.current_plan, review = workspace.review.current_review; let url, payload = {};
    if (reviewAction === "submit") url = `/api/products/${product.id}/video-plans/${plan.id}/reviews`;
    else { url = `/api/products/${product.id}/plan-reviews/${review.id}/${reviewAction === "approve" ? "approve" : "request-changes"}`; payload = { expected_revision: review.row_version, ...(reviewAction === "changes" ? { reason: element("#reviewReasonInput").value.trim() } : {}) }; }
    if (reviewAction === "changes" && !payload.reason) return void (element("#reviewDialogError").textContent = "请填写修改意见。");
    const ok = await mutate(url, "POST", payload, true); if (ok) element("#reviewDialog").close();
  }
  function selectDecisionTab(tabId, focus = false) {
    const tabs = [element("#showPreflight"), element("#showReview")];
    for (const tab of tabs) {
      const selected = tab.id === tabId;
      tab.setAttribute("aria-selected", String(selected)); tab.tabIndex = selected ? 0 : -1; tab.classList.toggle("active", selected);
      element(`#${tab.getAttribute("aria-controls")}`).hidden = !selected;
    }
    if (focus) element(`#${tabId}`).focus();
  }
  function handleDecisionTabKeydown(event) {
    const tabIds = ["showPreflight", "showReview"], currentIndex = tabIds.indexOf(event.currentTarget.id);
    if (currentIndex < 0) return;
    let nextIndex = currentIndex;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex + tabIds.length - 1) % tabIds.length;
    else if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabIds.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabIds.length - 1;
    else return;
    event.preventDefault(); selectDecisionTab(tabIds[nextIndex], true);
  }
  element("#outputInstructions").addEventListener("input", () => { dirty = true; syncDirtyControls(); });
  element("#presentationSize").addEventListener("change", () => { dirty = true; syncDirtyControls(); });
  element("#createPlan").addEventListener("click", async () => { const value = element("#firstInstructions").value.trim(); if (!value) return notice(element("#pageNotice"), "请先填写制作说明。", "blocked"); await mutate(`/api/products/${product.id}/video-plans`, "POST", { output_instructions: value, presentation_size_code: element("#firstPresentationSize").value, expected_head_revision: workspace.head_revision }, true); });
  element("#saveDraft").addEventListener("click", saveCurrentDraft);
  element("#deriveDraft").addEventListener("click", async () => mutate(`/api/products/${product.id}/video-plans/${workspace.current_plan.id}/derive`, "POST", { output_instructions: element("#outputInstructions").value, presentation_size_code: element("#presentationSize").value, expected_head_revision: workspace.head_revision }, true));
  element("#runPreflight").addEventListener("click", async () => { const ok = await mutate(`/api/products/${product.id}/video-plans/${workspace.current_plan.id}/preflight`, "POST", { expected_revision: workspace.current_plan.row_version }, true); if (ok) startPolling(); });
  element("#submitReview").addEventListener("click", () => openReviewDialog("submit")); element("#approveReview").addEventListener("click", () => openReviewDialog("approve")); element("#requestChanges").addEventListener("click", () => openReviewDialog("changes"));
  element("#reviewForm").addEventListener("submit", async (event) => { event.preventDefault(); await performReview(); }); element("#closeReviewDialog").addEventListener("click", () => element("#reviewDialog").close()); element("#cancelReviewDialog").addEventListener("click", () => element("#reviewDialog").close());
  for (const tab of [element("#showPreflight"), element("#showReview")]) {
    tab.addEventListener("click", () => selectDecisionTab(tab.id, true));
    tab.addEventListener("keydown", handleDecisionTabKeydown);
  }
  element("#openVersionDrawer").addEventListener("click", () => element("#versionDialog").showModal()); element("#closeVersionDialog").addEventListener("click", () => element("#versionDialog").close());
  element("#refreshPlan").addEventListener("click", () => guardReload(() => bootstrap(workspace?.current_plan?.id || params.get("plan"))));
  element("#productSelector").addEventListener("change", (event) => {
    const nextProduct = project.products.find((item) => item.id === event.currentTarget.value); event.currentTarget.value = product.id;
    guardReload(async () => { product = nextProduct; await loadWorkspace(); });
  });
  element("#closeUnsavedDialog").addEventListener("click", () => finishGuardedReload("cancel"));
  element("#cancelUnsaved").addEventListener("click", () => finishGuardedReload("cancel"));
  element("#discardUnsaved").addEventListener("click", () => finishGuardedReload("discard"));
  element("#saveUnsaved").addEventListener("click", () => finishGuardedReload("save"));
  addEventListener("beforeunload", (event) => { if (dirty) event.preventDefault(); });
  if (!projectId) return notice(element("#pageNotice"), "缺少项目上下文，请从项目页面重新进入。", "error");
  await bootstrap();
})();
