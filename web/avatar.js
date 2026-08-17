(async () => {
  const params = new URLSearchParams(location.search);
  const projectId = params.get("project"), requestedProductId = params.get("product");
  let copyVersionId = params.get("copy") || "", project, product, workspace, runtime, identityContext, selectedAvatar, submitting = false, adminSubmitting = false;
  let taskLoadError = "";
  const element = (selector) => document.querySelector(selector);
  const csrf = () => decodeURIComponent((document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hifly_identity_csrf=")) || "=").split("=").slice(1).join("="));
  const sourceLabels = { public: "公共数字人物", enterprise: "企业数字人物" };
  const authorizationLabels = { valid: "授权有效", expiring: "授权即将到期", expired: "授权已失效", incomplete: "授权信息不完整" };
  const reasonLabels = {
    approved_copy_missing: "当前没有有效的已批准文案，请返回文案完成人工审核",
    copy_version_changed: "当前文案版本已变化，请从最新批准文案重新进入",
    avatar_asset_unavailable: "人物资产暂不可用，请联系管理员",
    avatar_version_unavailable: "人物版本暂不可用，请联系管理员",
    authorization_expired: "人物授权已失效，请联系管理员更新授权",
    authorization_incomplete: "人物授权信息不完整，请联系管理员补全",
    capability_evidence_missing: "人物生产能力缺少能力依据，当前不承诺支持",
    organization_use_not_authorized: "当前企业没有此人物的使用授权",
    avatar_materials_unavailable: "人物必要素材暂不可访问，请联系管理员"
  };

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.method && options.method !== "GET") headers.set("x-identity-csrf", csrf());
    const response = await fetch(url, { credentials: "same-origin", ...options, headers });
    if (response.status === 401) { location.replace("/login.html"); throw new Error("AUTH_REQUIRED"); }
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.error), { status: response.status, body });
    return body;
  }

  function setNotice(target, message = "", tone = "") {
    target.className = `notice${tone ? ` ${tone}` : ""}`;
    target.textContent = message;
  }

  function initials(value) { return [...value].slice(0, 2).join(""); }
  function formatDate(value) {
    return value ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value)) : "有效期待补全";
  }
  function avatarForVersion(id) { return workspace?.catalog.find((item) => item.asset_version.id === id) || null; }
  function isAdmin() { return identityContext?.membership?.role === "admin"; }

  function setTaskStatus(selector, text, statusClass = "") {
    const target = element(selector);
    target.className = statusClass ? `state ${statusClass}` : "state";
    target.textContent = text;
  }

  function recommend(action) {
    const controls = [element("#refreshAvatar"), element("#copyContextLink"), element("#confirmAvatar"), element("#nextPlanLink")].filter(Boolean);
    for (const control of controls) {
      control.removeAttribute("data-recommended-action");
      if (control.id === "confirmAvatar") control.classList.add("secondary");
      if (control.id === "nextPlanLink") control.classList.add("task-action-secondary");
      if (control.id === "copyContextLink") control.classList.remove("button-link");
    }
    if (!action || action.hidden || action.disabled || action.getAttribute("aria-disabled") === "true") {
      return;
    }
    if (action.id === "confirmAvatar") action.classList.remove("secondary");
    if (action.id === "nextPlanLink") action.classList.remove("task-action-secondary");
    if (action.id === "copyContextLink") action.classList.add("button-link");
    action.setAttribute("data-recommended-action", "true");
  }

  function renderTaskSummary() {
    if (!element("#taskSummaryTitle")) return;
    const productName = product?.revision?.product_name || "未命名商品";
    element("#taskContext").textContent = project && product ? `${project.name} · ${productName}` : "正在读取项目与商品";
    element("#taskStage").textContent = "人物 · 3/5";

    const approved = workspace?.copy_gate?.approved === true;
    setTaskStatus("#taskCopyStatus", approved ? "文案已批准" : "文案批准不可用", approved ? "approved" : "blocked");
    const current = workspace?.selection?.current_selection;
    const currentAvatar = current ? avatarForVersion(current.asset_version_id) : null;
    const currentValid = current && workspace.selection.current_valid === true;
    setTaskStatus("#taskSelectionStatus",
      !current ? "尚未确认" : currentValid ? `已确认 · ${currentAvatar?.display_name || "历史人物"}` : "已确认但上游已变化",
      !current ? "unavailable" : currentValid ? "confirmed" : "blocked");

    let task = {
      title: "载入人物工作区",
      description: "正在读取人物目录与当前选择",
      status: "正在加载",
      statusClass: "running",
      next: "等待人物工作区载入",
      blocker: "",
      action: null
    };
    const same = current?.asset_version_id === selectedAvatar?.asset_version.id && current?.copy_version_id === copyVersionId;
    const firstReason = selectedAvatar?.gate?.reasons?.[0];

    if (taskLoadError) {
      task = { title: "人物工作区暂时无法载入", description: "没有改变当前人物选择。", status: "加载失败", statusClass: "failure",
        next: "刷新人物工作区", blocker: taskLoadError, action: element("#refreshAvatar") };
    } else if (!workspace || !project || !product) {
      // Keep the loading state.
    } else if (!approved) {
      task = { title: "先完成文案人工批准", description: "可以浏览人物，但不能确认新选择。", status: "上游阻断", statusClass: "blocked",
        next: "返回文案", blocker: "当前没有有效的已批准文案，文案质检通过不能替代人工审核批准。", action: element("#copyContextLink") };
    } else if (!selectedAvatar) {
      task = { title: "人物目录暂无可选项", description: "每个商品都需要单独确认人物。", status: "需要处理", statusClass: "blocked",
        next: "联系管理员登记或恢复可用人物", blocker: "当前企业没有可浏览的人物版本。", action: null };
    } else if (!selectedAvatar.gate.can_confirm) {
      task = { title: "当前人物暂不可确认", description: `已选中 ${selectedAvatar.display_name}，但门禁未满足。`, status: "人物受阻", statusClass: "blocked",
        next: "选择其他可确认人物", blocker: reasonLabels[firstReason] || "当前人物的资产、授权、能力依据或素材不可用于新确认。", action: null };
    } else if (!current) {
      task = { title: "确认当前商品的人物", description: `已选中 ${selectedAvatar.display_name}，确认后会留下可审计记录。`, status: "待确认", statusClass: "draft",
        next: "确认此人物", blocker: "", action: element("#confirmAvatar") };
    } else if (!currentValid) {
      task = { title: "原人物选择已失效", description: "上游文案或人物版本已变化，历史选择仍保留。", status: "上游已变化", statusClass: "blocked",
        next: same ? "重新确认当前人物" : "确认新的可用人物", blocker: "必须为当前已批准文案重新确认人物，才能进入视频方案。", action: element("#confirmAvatar") };
    } else if (!same) {
      task = { title: "确认是否更换人物", description: `当前有效选择为 ${currentAvatar?.display_name || "历史人物"}，另选了 ${selectedAvatar.display_name}。`, status: "待确认变更", statusClass: "draft",
        next: "更换人物", blocker: "更换后当前选择会保留为历史，下游方案需使用新选择。", action: element("#confirmAvatar") };
    } else if (runtime?.videoPlanningEnabled === true) {
      task = { title: "人物已确认", description: `${selectedAvatar.display_name} 对当前商品与文案有效。`, status: "已确认", statusClass: "confirmed",
        next: "进入视频方案", blocker: "", action: element("#nextPlanLink") };
    } else {
      task = { title: "人物已确认", description: `${selectedAvatar.display_name} 对当前商品与文案有效。`, status: "已确认", statusClass: "confirmed",
        next: "等待视频方案能力开放", blocker: "视频方案当前未开放，人物选择已安全保存。", action: null };
    }

    element("#taskSummaryTitle").textContent = task.title;
    element("#taskSummaryDescription").textContent = task.description;
    setTaskStatus("#taskStatus", task.status, task.statusClass);
    element("#taskNext").textContent = task.next;
    element("#taskBlocker").hidden = !task.blocker;
    element("#taskBlocker").textContent = task.blocker;
    recommend(task.action);
  }

  function updateLocation() {
    const next = new URL(location.href); next.searchParams.set("project", project.id); next.searchParams.set("product", product.id);
    if (copyVersionId) next.searchParams.set("copy", copyVersionId); else next.searchParams.delete("copy");
    history.replaceState(null, "", next);
  }

  function renderContext() {
    element("#projectBreadcrumb").textContent = project.name;
    element("#projectBreadcrumb").href = `/project.html?id=${encodeURIComponent(project.id)}`;
    for (const selector of ["#factsStageLink", "#mobileFactsStageLink"]) element(selector).href = `/project.html?id=${encodeURIComponent(project.id)}`;
    const copyHref = `/copy.html?project=${encodeURIComponent(project.id)}&revision=${encodeURIComponent(product.revision.id)}`;
    for (const selector of ["#copyStageLink", "#mobileCopyStageLink", "#copyContextLink"]) element(selector).href = copyHref;
    const planHref = `/plan.html?project=${encodeURIComponent(project.id)}&product=${encodeURIComponent(product.id)}`;
    for (const selector of ["#planStageLink", "#mobilePlanStageLink", "#nextPlanLink"]) {
      const link = element(selector);
      if (runtime.videoPlanningEnabled) { link.href = planHref; link.removeAttribute("aria-disabled"); }
      else { link.removeAttribute("href"); link.setAttribute("aria-disabled", "true"); }
    }
    element("#nextPlanLink").textContent = runtime.videoPlanningEnabled ? "进入视频方案" : "视频方案尚未开放";
    const productionHref = `/production.html?project=${encodeURIComponent(project.id)}&product=${encodeURIComponent(product.id)}`;
    for (const selector of ["#productionStageLink", "#mobileProductionStageLink"]) {
      const link = element(selector);
      if (runtime.productionOrdersEnabled) { link.href = productionHref; link.removeAttribute("aria-disabled"); }
      else { link.removeAttribute("href"); link.setAttribute("aria-disabled", "true"); }
    }
    const selector = element("#productSelector");
    selector.replaceChildren(...project.products.map((item) => {
      const option = document.createElement("option"); option.value = item.id;
      option.textContent = item.revision.product_name || "未命名商品"; return option;
    }));
    selector.value = product.id;
    const approved = workspace?.copy_gate.approved === true;
    window.HiflyOperatorStages.set(["#factsStageLink", "#mobileFactsStageLink"], product.revision.status === "ready" ? "completed" : "available");
    window.HiflyOperatorStages.set(["#copyStageLink", "#mobileCopyStageLink"], approved ? "completed" : "available");
    window.HiflyOperatorStages.set(["#planStageLink", "#mobilePlanStageLink"], runtime.videoPlanningEnabled ? "available" : "blocked");
    window.HiflyOperatorStages.set(["#productionStageLink", "#mobileProductionStageLink"], runtime.productionOrdersEnabled ? "available" : "blocked");
    element("#copyApprovalState").className = `state ${approved ? "approved" : "blocked"}`;
    element("#copyApprovalState").textContent = approved ? "文案已批准" : "文案批准不可用";
    element("#copyApprovalMeta").textContent = approved ? "当前文案已人工批准" : "可浏览，确认前需人工批准文案";
    updateLocation();
  }

  function createAvatarButton(item, mobile = false) {
    const button = document.createElement("button"); button.type = "button"; button.className = "avatar-row secondary";
    button.setAttribute("aria-current", String(item.asset_version.id === selectedAvatar?.asset_version.id));
    const recommendation = item.recommendation || {};
    button.setAttribute("aria-label", `${item.display_name} · ${sourceLabels[item.source_type]} · ${item.gate.can_confirm ? "可确认" : "暂不可确认"}${recommendation.recommended ? ` · 推荐 · ${recommendation.reason}` : ""}`);
    const thumb = document.createElement("span"); thumb.className = "avatar-thumb"; thumb.textContent = initials(item.display_name);
    const copy = document.createElement("span"); copy.className = "avatar-row-copy";
    const title = document.createElement("span"); title.className = "avatar-row-title";
    const name = document.createElement("strong"); name.textContent = item.display_name;
    const state = document.createElement("span"); state.className = `state ${item.gate.can_confirm ? "available" : "unavailable"}`;
    state.textContent = item.gate.can_confirm ? "可确认" : "暂不可确认";
    if (recommendation.recommended) {
      const badge = document.createElement("span"); badge.className = "recommendation-badge"; badge.textContent = "推荐"; title.append(name, badge, state);
    } else title.append(name, state);
    const meta = document.createElement("span"); meta.className = "avatar-row-meta";
    const source = document.createElement("span"); source.textContent = sourceLabels[item.source_type];
    const seed = document.createElement("span"); seed.className = "seed-mini";
    seed.textContent = item.source_type === "enterprise" ? "企业登记" : item.controlled_seed ? "受控预置" : "公共目录";
    meta.append(source, seed);
    if (recommendation.recommended) {
      const reason = document.createElement("span"); reason.className = "avatar-row-recommendation"; reason.textContent = recommendation.reason; meta.append(reason);
    }
    copy.append(title,meta); button.append(thumb,copy);
    button.addEventListener("click", () => { selectedAvatar = item; render(); if (mobile) element("#catalogDialog").close(); });
    return button;
  }

  function filteredCatalog() {
    const source = element("#sourceFilter").value, status = element("#statusFilter").value;
    return workspace.catalog.filter((item) => (source === "all" || item.source_type === source) &&
      (status === "all" || (status === "available") === item.gate.can_confirm));
  }

  function renderCatalog() {
    const items = filteredCatalog(), desktop = element("#catalogList"), mobile = element("#mobileCatalogList");
    desktop.replaceChildren(...items.map((item) => createAvatarButton(item)));
    mobile.replaceChildren(...items.map((item) => createAvatarButton(item, true)));
    element("#catalogLoading").hidden = true; element("#catalogEmpty").hidden = items.length > 0;
    desktop.hidden = items.length === 0;
    const summary = workspace.recommendation;
    const summaryNotice = element("#recommendationNotice");
    summaryNotice.className = `notice recommendation-summary ${summary?.has_recommendations ? "success" : "blocked"}`;
    summaryNotice.textContent = summary?.has_recommendations ? `推荐 ${summary.recommended_count} 位 · ${summary.reason}` : `暂无推荐 · ${summary?.reason || "当前没有可用推荐。"}`;
    element("#openCatalogDrawer").textContent = `▦ 人物目录（${workspace.catalog.length}）· 当前：${selectedAvatar?.display_name || "未选择"} ▾`;
  }

  function renderDetail() {
    element("#detailLoading").hidden = Boolean(selectedAvatar); element("#detailContent").hidden = !selectedAvatar;
    if (!selectedAvatar) return;
    element("#avatarPreview").textContent = initials(selectedAvatar.display_name);
    element("#avatarSource").textContent = sourceLabels[selectedAvatar.source_type]; element("#avatarDetailTitle").textContent = selectedAvatar.display_name;
    element("#avatarDescription").textContent = selectedAvatar.description;
    element("#avatarVersion").textContent = `v${selectedAvatar.asset_version.version_number} · ${selectedAvatar.asset_version.status === "available" ? "资产可用" : "资产不可用"}`;
    element("#avatarSeed").textContent = selectedAvatar.seed_label;
    element("#avatarMaterialState").textContent = selectedAvatar.materials_accessible ? `可访问 · ${selectedAvatar.material_status || "available"}` : `不可访问 · ${selectedAvatar.material_status || "unavailable"}`;
    element("#avatarCategoryTags").textContent = selectedAvatar.category_tags?.length ? selectedAvatar.category_tags.join("、") : "未设置";
    element("#avatarAuditCopyVersionId").textContent = copyVersionId || "未提供";
    element("#avatarAuditAssetId").textContent = selectedAvatar.id || "未提供";
    element("#avatarAuditAssetVersionId").textContent = selectedAvatar.asset_version?.id || "未提供";
    element("#avatarAuditCapabilityCode").textContent = selectedAvatar.verified_capabilities?.map((item) => item.code).filter(Boolean).join("、") || "未提供";
    element("#avatarAuditEvidenceReference").textContent = selectedAvatar.verified_capabilities?.map((item) => item.evidence_reference).filter(Boolean).join("、") || "未提供";
    element("#avatarAuditAuthorizationScope").textContent = selectedAvatar.authorization_scope || "未提供";
    element("#avatarAuditSourceCode").textContent = selectedAvatar.source_type || "未提供";
    const recommendation = selectedAvatar.recommendation || { recommended: false, reason: "当前没有推荐说明。" };
    const recommendationNotice = element("#avatarRecommendation");
    recommendationNotice.className = `avatar-recommendation ${recommendation.recommended ? "recommended" : "not-recommended"}`;
    recommendationNotice.textContent = `${recommendation.recommended ? "推荐" : "未推荐"} · ${recommendation.reason}`;
    const availability = element("#avatarAvailability"); availability.className = `state ${selectedAvatar.gate.can_confirm ? "available" : "unavailable"}`;
    availability.textContent = selectedAvatar.gate.can_confirm ? "可确认" : "暂不可确认";
    const authorization = element("#avatarAuthorization"); authorization.className = `state ${selectedAvatar.authorization_status}`;
    authorization.textContent = `${authorizationLabels[selectedAvatar.authorization_status]}${selectedAvatar.authorization_expires_at ? ` · 至 ${formatDate(selectedAvatar.authorization_expires_at)}` : ""}`;
    const capabilities = element("#verifiedCapabilities"); capabilities.replaceChildren();
    for (const item of selectedAvatar.verified_capabilities) {
      const badge = document.createElement("span"); badge.className = "capability-supported"; badge.textContent = `✓ ${item.label}`; capabilities.append(badge);
    }
    if (!selectedAvatar.verified_capabilities.length) {
      const empty = document.createElement("span"); empty.className = "state unverified"; empty.textContent = "未验证"; capabilities.append(empty);
      setNotice(element("#detailNotice"), "能力未验证，不承诺生产效果。", "blocked");
    } else if (selectedAvatar.authorization_status === "expiring") {
      setNotice(element("#detailNotice"), `授权将于 ${formatDate(selectedAvatar.authorization_expires_at)} 到期，到期后不能用于新确认或新方案。`, "blocked");
    } else if (!selectedAvatar.gate.can_confirm) {
      setNotice(element("#detailNotice"), reasonLabels[selectedAvatar.gate.reasons[0]] || "当前人物暂不可确认。", "blocked");
    } else setNotice(element("#detailNotice"));
    const disable = element("#disableAvatar");
    disable.hidden = !isAdmin() || selectedAvatar.source_type !== "enterprise" || selectedAvatar.controlled_seed || selectedAvatar.status !== "active";
    disable.disabled = adminSubmitting;
  }

  function renderAdminPanel() { element("#enterpriseAvatarAdmin").hidden = !isAdmin() || runtime?.assetsEnabled !== true; }

  function gateItem(label, allowed, reason) {
    const item = document.createElement("li"); item.className = allowed ? "allowed" : "blocked";
    const mark = document.createElement("b"); mark.textContent = allowed ? "✓" : "!";
    const text = document.createElement("span"); text.textContent = allowed ? label : reason; item.append(mark,text); return item;
  }

  function renderSelection() {
    const selection = workspace.selection, current = selection.current_selection, currentAvatar = avatarForVersion(current?.asset_version_id);
    const badge = element("#selectionState"); badge.className = `state ${current ? "confirmed" : ""}`; badge.textContent = current ? "已确认" : "未选择";
    const summary = element("#currentSelection"); summary.replaceChildren();
    if (!current) { const text = document.createElement("p"); text.textContent = "尚未确认人物"; summary.append(text); }
    else {
      const name = document.createElement("strong"); name.textContent = `当前选择 · ${currentAvatar?.display_name || "历史人物"}`;
      const meta = document.createElement("p"); meta.textContent = `选择 v${current.version_number} · ${selection.current_valid ? "当前有效" : "上游已变化，历史保留"}`;
      summary.append(name,meta);
    }
    const reasons = selectedAvatar?.gate.reasons || ["avatar_asset_unavailable"];
    const checks = [
      ["文案批准仍有效", !reasons.includes("approved_copy_missing") && !reasons.includes("copy_version_changed"), reasonLabels[reasons.find((value) => ["approved_copy_missing","copy_version_changed"].includes(value))]],
      ["人物资产版本可用", !reasons.some((value) => ["avatar_asset_unavailable","avatar_version_unavailable"].includes(value)), "人物资产暂不可用，请联系管理员"],
      ["人物授权有效", !reasons.some((value) => value.startsWith("authorization_")), reasonLabels[reasons.find((value) => value.startsWith("authorization_"))]],
      ["能力依据已提供", !reasons.includes("capability_evidence_missing"), reasonLabels.capability_evidence_missing],
      ["当前企业有权使用", !reasons.includes("organization_use_not_authorized"), reasonLabels.organization_use_not_authorized],
      ["必要素材可访问", !reasons.includes("avatar_materials_unavailable"), reasonLabels.avatar_materials_unavailable]
    ];
    element("#selectionGateList").replaceChildren(...checks.map(([label, allowed, reason]) => gateItem(label, allowed, reason || label)));
    const same = current?.asset_version_id === selectedAvatar?.asset_version.id && current?.copy_version_id === copyVersionId;
    const button = element("#confirmAvatar"); button.textContent = current && !same ? "更换人物" : "确认此人物";
    button.disabled = !selectedAvatar?.gate.can_confirm || same || submitting;
    if (same) setNotice(element("#selectionNotice"), "当前已确认此人物。", "success");
    else if (!workspace.copy_gate.approved) setNotice(element("#selectionNotice"), "可继续浏览；确认前请返回文案完成人工审核批准。", "blocked");
    else if (selectedAvatar && !selectedAvatar.gate.can_confirm) setNotice(element("#selectionNotice"), reasonLabels[selectedAvatar.gate.reasons[0]] || "当前人物不能确认。", "blocked");
    else setNotice(element("#selectionNotice"));
    const old = selection.history.filter((item) => item.status === "superseded");
    element("#selectionHistorySummary").textContent = `历史选择（${old.length}）`;
    element("#selectionHistory").replaceChildren(...old.map((item) => {
      const avatar = avatarForVersion(item.asset_version_id), row = document.createElement("div"); row.className = "history-row";
      const name = document.createElement("strong"); name.textContent = avatar?.display_name || "历史人物";
      const meta = document.createElement("span"); meta.textContent = `选择 v${item.version_number} · 已被替代 · 历史保留`; row.append(name,meta); return row;
    }));
  }

  function render() { renderContext(); renderAdminPanel(); renderCatalog(); renderDetail(); renderSelection(); renderTaskSummary(); }

  async function loadWorkspace({ keepSelection = false } = {}) {
    const before = keepSelection ? selectedAvatar?.asset_version.id : null;
    workspace = await request(`/api/products/${encodeURIComponent(product.id)}/avatar-workspace?copyVersionId=${encodeURIComponent(copyVersionId)}`);
    copyVersionId = workspace.resolved_copy_version_id || "";
    selectedAvatar = workspace.catalog.find((item) => item.asset_version.id === before) ||
      avatarForVersion(workspace.selection.current_selection?.asset_version_id) || workspace.catalog[0] || null;
    taskLoadError = "";
    render();
  }

  async function bootstrap({ keepSelection = false } = {}) {
    try {
      const [nextProject, nextRuntime, nextIdentityContext] = await Promise.all([
        request(`/api/projects/${encodeURIComponent(projectId)}`).then((body) => body.project),
        request("/api/runtime"),
        request("/api/auth/me")
      ]);
      const nextProduct = nextProject.products.find((item) => item.id === (product?.id || requestedProductId)) || nextProject.products[0];
      if (!nextProduct) {
        location.replace(`/project.html?id=${encodeURIComponent(nextProject.id)}`);
        return false;
      }
      project = nextProject;
      runtime = nextRuntime;
      identityContext = nextIdentityContext;
      product = nextProduct;
      await loadWorkspace({ keepSelection });
      setNotice(element("#pageNotice"));
      return true;
    } catch (_error) {
      taskLoadError = "人物工作区加载失败，请刷新重试。";
      setNotice(element("#pageNotice"), taskLoadError, "error");
      renderTaskSummary();
      return false;
    }
  }

  function openConfirmation() {
    if (!selectedAvatar?.gate.can_confirm) return;
    const changing = Boolean(workspace.selection.current_selection);
    element("#confirmAvatarDialogTitle").textContent = changing ? "更换人物" : "确认人物选择";
    element("#submitConfirmAvatar").textContent = changing ? "确认更换人物" : "确认选择此人物";
    element("#confirmAvatarSummary").textContent = `${selectedAvatar.display_name} · 人物版本 v${selectedAvatar.asset_version.version_number}\n${authorizationLabels[selectedAvatar.authorization_status]}${selectedAvatar.authorization_expires_at ? `至 ${formatDate(selectedAvatar.authorization_expires_at)}` : ""}\n已验证能力：${selectedAvatar.verified_capabilities.map((item) => item.label).join("、") || "无"}\n${selectedAvatar.seed_label}`;
    element("#confirmAvatarConsequence").textContent = changing ? "更换会创建新的人物选择；当前选择保留为历史，后续视频方案需基于新选择重新确认。" : "确认后会为当前商品创建一条可审计的人物选择记录。";
    element("#confirmAvatarError").textContent = ""; element("#confirmAvatarDialog").showModal();
  }

  async function confirmSelection() {
    if (submitting) return; submitting = true; element("#submitConfirmAvatar").disabled = true;
    const changing = Boolean(workspace.selection.current_selection);
    try {
      await request(`/api/products/${encodeURIComponent(product.id)}/avatar-selections`, { method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ copy_version_id: copyVersionId, asset_version_id: selectedAvatar.asset_version.id,
          expected_revision: workspace.selection.selection_revision }) });
      element("#confirmAvatarDialog").close(); await loadWorkspace({ keepSelection: true });
      setNotice(element("#pageNotice"), changing ? "人物已更换，原选择已保留在历史中。" : "人物已确认。", "success");
    } catch (error) {
      element("#confirmAvatarError").textContent = error.status === 409 ? "人物选择已被他人更新，请关闭对话框并查看最新选择。" :
        error.status === 404 ? "此人物不在本企业可用范围内。" : error.status === 422 ?
          (reasonLabels[error.body?.reasons?.[0]] || "门禁状态已变化，当前不能确认。") : "确认请求未完成，请稍后重试。";
      if ([404,409,422].includes(error.status)) await loadWorkspace({ keepSelection: true });
    } finally { submitting = false; element("#submitConfirmAvatar").disabled = false; renderSelection(); }
  }

  async function checksum(file) {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  async function waitForMaterial(assetVersionId) {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const result = await request(`/api/asset-versions/${encodeURIComponent(assetVersionId)}`);
      const status = result.asset_version?.status;
      if (status === "available") return result.asset_version;
      if (status === "verification_failed" || status === "unavailable") throw new Error("AVATAR_MATERIAL_VERIFICATION_FAILED");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("AVATAR_MATERIAL_VERIFICATION_TIMEOUT");
  }

  async function registerEnterpriseAvatar(event) {
    event.preventDefault();
    if (adminSubmitting || !isAdmin()) return;
    const file = element("#enterpriseAvatarFile").files?.[0];
    if (!file) return;
    adminSubmitting = true; element("#registerEnterpriseAvatar").disabled = true;
    element("#enterpriseAvatarError").textContent = ""; setNotice(element("#enterpriseAvatarStatus"), "正在上传并核验人物图片...", "");
    try {
      const authorized = await request("/api/assets/upload-authorizations", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ filename: file.name, content_type: file.type, size: file.size, checksum_sha256: await checksum(file), kind: "avatar_image" }) });
      await request(authorized.upload.url, { method: "PUT", headers: { "content-type": file.type }, body: file });
      await request("/api/assets/upload-completions", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ upload_session_id: authorized.upload_session_id, idempotency_key: crypto.randomUUID() }) });
      const material = await waitForMaterial(authorized.asset_version.id);
      const tags = element("#enterpriseAvatarTags").value.split(/[，,\n]/).map((item) => item.trim()).filter(Boolean);
      const code = element("#enterpriseAvatarCapabilityCode").value.trim(), label = element("#enterpriseAvatarCapabilityLabel").value.trim(), evidence = element("#enterpriseAvatarCapabilityEvidence").value.trim();
      const capabilities = code || label || evidence ? [{ code, label, evidence_reference: evidence }] : [];
      setNotice(element("#enterpriseAvatarStatus"), "素材已核验，正在登记企业人物...", "");
      const result = await request("/api/avatar-catalog/enterprise", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        material_asset_version_id: material.id, display_name: element("#enterpriseAvatarName").value, description: element("#enterpriseAvatarDescription").value,
        authorization_status: element("#enterpriseAvatarAuthorization").value, authorization_expires_at: element("#enterpriseAvatarExpiry").value || null,
        category_tags: tags, capabilities
      }) });
      await loadWorkspace({ keepSelection: true });
      selectedAvatar = workspace.catalog.find((item) => item.id === result.avatar.id) || selectedAvatar;
      render(); element("#enterpriseAvatarForm").reset(); setNotice(element("#enterpriseAvatarStatus"), "企业人物已登记；生产能力仅按明确能力依据展示。", "success");
    } catch (error) {
      if (error.message !== "AUTH_REQUIRED") setNotice(element("#enterpriseAvatarError"), error.message === "AVATAR_MATERIAL_VERIFICATION_TIMEOUT" ? "图片核验超时，请稍后刷新素材状态。" : "人物上传或登记未完成，请检查信息后重试。", "error");
    } finally { adminSubmitting = false; element("#registerEnterpriseAvatar").disabled = false; renderDetail(); }
  }

  async function disableEnterpriseAvatar() {
    if (!isAdmin() || !selectedAvatar || selectedAvatar.source_type !== "enterprise" || selectedAvatar.controlled_seed) return;
    if (!window.confirm(`确定禁用“${selectedAvatar.display_name}”？历史选择会保留，但不能新确认。`)) return;
    adminSubmitting = true; renderDetail();
    try {
      await request(`/api/avatar-catalog/enterprise/${encodeURIComponent(selectedAvatar.id)}/disable`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expected_revision: selectedAvatar.revision_number }) });
      await loadWorkspace({ keepSelection: true }); setNotice(element("#pageNotice"), "企业人物已禁用；历史选择仍保留。", "success");
    } catch (error) { if (error.message !== "AUTH_REQUIRED") setNotice(element("#pageNotice"), "人物禁用未完成，请刷新后重试。", "error"); }
    finally { adminSubmitting = false; render(); }
  }

  function openCatalog() {
    element("#mobileCatalogFilters").append(element(".catalog-panel .catalog-filters"));
    element("#catalogDialog").showModal();
  }
  function closeCatalog() {
    element(".catalog-panel .surface-header").after(element("#mobileCatalogFilters .catalog-filters"));
    element("#catalogDialog").close();
  }

  element("#sourceFilter").addEventListener("change", renderCatalog); element("#statusFilter").addEventListener("change", renderCatalog);
  element("#clearFilters").addEventListener("click", () => { element("#sourceFilter").value = "all"; element("#statusFilter").value = "all"; renderCatalog(); });
  element("#refreshAvatar").addEventListener("click", () => bootstrap({ keepSelection: true }));
  element("#productSelector").addEventListener("change", async (event) => { product = project.products.find((item) => item.id === event.currentTarget.value); copyVersionId = ""; await loadWorkspace(); });
  element("#confirmAvatar").addEventListener("click", openConfirmation);
  element("#enterpriseAvatarForm").addEventListener("submit", registerEnterpriseAvatar);
  element("#disableAvatar").addEventListener("click", disableEnterpriseAvatar);
  element("#confirmAvatarForm").addEventListener("submit", async (event) => { event.preventDefault(); await confirmSelection(); });
  element("#closeConfirmAvatar").addEventListener("click", () => element("#confirmAvatarDialog").close());
  element("#cancelConfirmAvatar").addEventListener("click", () => element("#confirmAvatarDialog").close());
  element("#openCatalogDrawer").addEventListener("click", openCatalog); element("#closeCatalogDialog").addEventListener("click", closeCatalog);

  if (!projectId) return setNotice(element("#pageNotice"), "缺少项目上下文，请从项目页面重新进入。", "error");
  await bootstrap();
})();
