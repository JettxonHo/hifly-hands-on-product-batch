(async () => {
  const params = new URLSearchParams(location.search);
  const projectId = params.get("project"), requestedProductId = params.get("product");
  let copyVersionId = params.get("copy") || "", project, product, workspace, runtime, selectedAvatar, submitting = false;
  const element = (selector) => document.querySelector(selector);
  const csrf = () => decodeURIComponent((document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hifly_identity_csrf=")) || "=").split("=").slice(1).join("="));
  const sourceLabels = { public: "公共数字人物", enterprise: "企业数字人物" };
  const authorizationLabels = { valid: "授权有效", expiring: "授权即将到期", expired: "授权已失效", incomplete: "授权信息不完整" };
  const reasonLabels = {
    approved_copy_missing: "当前没有有效的已批准文案，请返回文案与质检完成批准",
    copy_version_changed: "当前文案版本已变化，请从最新批准文案重新进入",
    avatar_asset_unavailable: "人物资产暂不可用，请联系管理员",
    avatar_version_unavailable: "人物版本暂不可用，请联系管理员",
    authorization_expired: "人物授权已失效，请联系管理员更新授权",
    authorization_incomplete: "人物授权信息不完整，请联系管理员补全",
    capability_evidence_missing: "人物生产能力缺少 Evidence，当前不承诺支持",
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
    element("#copyApprovalState").className = `state ${approved ? "approved" : "blocked"}`;
    element("#copyApprovalState").textContent = approved ? "文案已批准" : "文案批准不可用";
    element("#copyApprovalMeta").textContent = copyVersionId ? `当前文案 ${copyVersionId.slice(0, 8)}` : "可浏览，确认前需批准文案";
    updateLocation();
  }

  function createAvatarButton(item, mobile = false) {
    const button = document.createElement("button"); button.type = "button"; button.className = "avatar-row secondary";
    button.setAttribute("aria-current", String(item.asset_version.id === selectedAvatar?.asset_version.id));
    button.setAttribute("aria-label", `${item.display_name} · ${sourceLabels[item.source_type]} · ${item.gate.can_confirm ? "可确认" : "暂不可确认"}`);
    const thumb = document.createElement("span"); thumb.className = "avatar-thumb"; thumb.textContent = initials(item.display_name);
    const copy = document.createElement("span"); copy.className = "avatar-row-copy";
    const title = document.createElement("span"); title.className = "avatar-row-title";
    const name = document.createElement("strong"); name.textContent = item.display_name;
    const state = document.createElement("span"); state.className = `state ${item.gate.can_confirm ? "available" : "unavailable"}`;
    state.textContent = item.gate.can_confirm ? "可确认" : "暂不可确认"; title.append(name,state);
    const meta = document.createElement("span"); meta.className = "avatar-row-meta";
    const source = document.createElement("span"); source.textContent = sourceLabels[item.source_type];
    const seed = document.createElement("span"); seed.className = "seed-mini"; seed.textContent = "受控预置"; meta.append(source,seed);
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
  }

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
      ["能力已有 Evidence 支持", !reasons.includes("capability_evidence_missing"), reasonLabels.capability_evidence_missing],
      ["当前企业有权使用", !reasons.includes("organization_use_not_authorized"), reasonLabels.organization_use_not_authorized],
      ["必要素材可访问", !reasons.includes("avatar_materials_unavailable"), reasonLabels.avatar_materials_unavailable]
    ];
    element("#selectionGateList").replaceChildren(...checks.map(([label, allowed, reason]) => gateItem(label, allowed, reason || label)));
    const same = current?.asset_version_id === selectedAvatar?.asset_version.id && current?.copy_version_id === copyVersionId;
    const button = element("#confirmAvatar"); button.textContent = current && !same ? "更换人物" : "确认此人物";
    button.disabled = !selectedAvatar?.gate.can_confirm || same || submitting;
    if (same) setNotice(element("#selectionNotice"), "当前已确认此人物。", "success");
    else if (!workspace.copy_gate.approved) setNotice(element("#selectionNotice"), "可继续浏览；确认前请返回文案与质检完成当前有效批准。", "blocked");
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

  function render() { renderContext(); renderCatalog(); renderDetail(); renderSelection(); }

  async function loadWorkspace({ keepSelection = false } = {}) {
    const before = keepSelection ? selectedAvatar?.asset_version.id : null;
    workspace = await request(`/api/products/${encodeURIComponent(product.id)}/avatar-workspace?copyVersionId=${encodeURIComponent(copyVersionId)}`);
    copyVersionId = workspace.resolved_copy_version_id || "";
    selectedAvatar = workspace.catalog.find((item) => item.asset_version.id === before) ||
      avatarForVersion(workspace.selection.current_selection?.asset_version_id) || workspace.catalog[0] || null;
    render();
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
  element("#refreshAvatar").addEventListener("click", () => loadWorkspace({ keepSelection: true }).catch(() => setNotice(element("#pageNotice"), "人物状态读取失败，请稍后重试。", "error")));
  element("#productSelector").addEventListener("change", async (event) => { product = project.products.find((item) => item.id === event.currentTarget.value); copyVersionId = ""; await loadWorkspace(); });
  element("#confirmAvatar").addEventListener("click", openConfirmation);
  element("#confirmAvatarForm").addEventListener("submit", async (event) => { event.preventDefault(); await confirmSelection(); });
  element("#closeConfirmAvatar").addEventListener("click", () => element("#confirmAvatarDialog").close());
  element("#cancelConfirmAvatar").addEventListener("click", () => element("#confirmAvatarDialog").close());
  element("#openCatalogDrawer").addEventListener("click", openCatalog); element("#closeCatalogDialog").addEventListener("click", closeCatalog);

  if (!projectId) return setNotice(element("#pageNotice"), "缺少项目上下文，请从项目页面重新进入。", "error");
  try {
    [project, runtime] = await Promise.all([
      request(`/api/projects/${encodeURIComponent(projectId)}`).then((body) => body.project), request("/api/runtime")
    ]);
    product = project.products.find((item) => item.id === requestedProductId) || project.products[0];
    if (!product) return location.replace(`/project.html?id=${encodeURIComponent(project.id)}`);
    await loadWorkspace();
  } catch (_error) { setNotice(element("#pageNotice"), "人物工作区加载失败，请刷新重试。", "error"); }
})();
