(async () => {
  const params = new URLSearchParams(location.search);
  const workspaceMode = document.body.classList.contains("single-workspace-page");
  const projectId = workspaceMode ? params.get("project") : params.get("id");
  const requestedProductId = workspaceMode ? params.get("product") : null;
  const requestedStage = workspaceMode ? params.get("stage") || "product_content" : "product_content";
  const requestedRevisionId = params.get("revision");
  const editor = document.querySelector("#editor");
  const revisionForm = document.querySelector("#revisionForm");
  const pointList = document.querySelector("#pointList");
  const notice = document.querySelector("#editorNotice");
  const productDialog = document.querySelector("#productDialog");
  const productForm = document.querySelector("#productForm");
  const productOpener = document.querySelector("#openProductDialog");
  const saveButton = document.querySelector("#saveDraft");
  const readyButton = document.querySelector("#readyRevision");
  const refreshButton = document.querySelector("#refreshRevision");
  const returnCurrentButton = document.querySelector("#returnCurrentRevision");
  const loadLatestButton = document.querySelector("#loadLatestRevision");
  const copyLink = document.querySelector("#openCopyWorkspace");
  const copyStageLinks = [document.querySelector("#copyStageLink"), document.querySelector("#mobileCopyStageLink")];
  const workspacePrimaryAction = document.querySelector("#workspacePrimaryAction");
  const workspaceActionLabel = document.querySelector("#workspaceActionLabel");
  const mobileProductBack = document.querySelector("#mobileProductBack");
  const taskTitle = document.querySelector("#taskSummaryTitle");
  const taskContext = document.querySelector("#taskContext");
  const taskStatus = document.querySelector("#taskStatus");
  const saveStatus = document.querySelector("#saveStatus");
  const taskNext = document.querySelector("#taskNext");
  const taskBlocker = document.querySelector("#taskBlocker");
  let project;
  let revision;
  let runtime;
  let dirty = false;
  let rendering = false;
  let conflictProductId;
  let workspaceProjection;
  let workspaceProjectionTrusted = true;
  let workspaceReadFailed = false;
  let selectedProductTrigger;
  let activeProductId = requestedProductId;
  let acceptedWorkspaceHistoryIndex = 0;
  let restoringWorkspaceHistoryIndex = null;
  let legacyContext = {
    productId: requestedProductId,
    copy: params.get("copy"),
    plan: params.get("plan"),
    orderId: params.get("orderId")
  };
  let availableAssetVersionIds = new Set();
  const revisionLabels = { draft: "草稿", ready: "商品资料已就绪", superseded: "已被替代" };
  const generalCategoryLabel = "未细分品类";
  const workspaceActionRegistry = Object.freeze({
    save_product_content: { stage: "product_content", kind: "command", label: "保存当前修改" },
    load_latest_product_content: { stage: "product_content", kind: "refresh", label: "载入服务端最新版本" },
    return_to_current_product_revision: { stage: "product_content", kind: "navigate", label: "回到当前版本" },
    review_product_blockers: { stage: "product_content", kind: "focus", label: "查看待补资料" },
    mark_product_content_ready: { stage: "product_content", kind: "command", label: "设为资料已就绪" },
    continue_to_copy: { stage: "product_content", kind: "navigate", label: "确认并进入文案" },
    retry_product_content_read: { stage: "product_content", kind: "refresh", label: "刷新当前商品" }
  });
  const legacyStageRoutes = Object.freeze({ copy: "/copy.html", avatar: "/avatar.html", video_plan: "/plan.html", production: "/production.html" });
  const csrf = () => decodeURIComponent((document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hifly_identity_csrf=")) || "=").split("=").slice(1).join("="));

  function categoryDisplayValue(value) {
    return value === "general" || !value ? generalCategoryLabel : value;
  }

  function categoryPayloadValue(value) {
    return value === generalCategoryLabel ? "general" : value;
  }

  function numberValue(field) {
    const value = field.value.trim();
    if (!value) return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function quantityValue(valueField, unitField) {
    const value = numberValue(valueField);
    const unit = unitField.value;
    if (value == null && !unit) return null;
    return { value, unit };
  }

  function physicalDimensionsPayload() {
    const height = numberValue(revisionForm.physical_height);
    const width = numberValue(revisionForm.physical_width);
    const depth = numberValue(revisionForm.physical_depth);
    const capacity = quantityValue(revisionForm.capacity_value, revisionForm.capacity_unit);
    const weight = quantityValue(revisionForm.weight_value, revisionForm.weight_unit);
    const hasAxis = [height, width, depth].some((value) => value != null);
    if (!hasAxis && !capacity && !weight) return {};
    const dimensions = {};
    if (hasAxis) {
      dimensions.height = height;
      dimensions.width = width;
      if (depth != null) dimensions.depth = depth;
      dimensions.unit = revisionForm.physical_unit.value;
    }
    if (capacity) dimensions.capacity = capacity;
    if (weight) dimensions.weight = weight;
    return dimensions;
  }

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.method && options.method !== "GET") headers.set("x-identity-csrf", csrf());
    const response = await fetch(url, { credentials: "same-origin", ...options, headers });
    if ([401, 403].includes(response.status)) {
      location.replace("/login.html");
      throw new Error("AUTH_REQUIRED");
    }
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.error), { body, status: response.status });
    return body;
  }

  function legacyStageUrl(stage, selectedRevision = revision) {
    const target = new URL(legacyStageRoutes[stage] || "/project.html", location.origin);
    target.searchParams.set("project", projectId);
    const selectedProductId = selectedRevision?.product_id || activeProductId;
    if (["avatar", "video_plan", "production"].includes(stage)) target.searchParams.set("product", selectedProductId);
    if (stage === "copy" && selectedRevision?.id) target.searchParams.set("revision", selectedRevision.id);
    const namedContext = { avatar: "copy", video_plan: "plan", production: "orderId" }[stage];
    if (namedContext && legacyContext.productId === selectedProductId && legacyContext[namedContext]) {
      target.searchParams.set(namedContext, legacyContext[namedContext]);
    }
    return `${target.pathname}${target.search}`;
  }

  function clearLegacyContextForSelection(nextRevision) {
    if (!revision || (revision.id === nextRevision.id && revision.product_id === nextRevision.product_id)) return;
    legacyContext = { productId: nextRevision.product_id, copy: null, plan: null, orderId: null };
  }

  function workspaceStageUrl(stage, selectedRevision = revision) {
    const target = new URL("/workspace.html", location.origin);
    target.searchParams.set("project", projectId);
    target.searchParams.set("product", selectedRevision?.product_id || activeProductId);
    target.searchParams.set("stage", stage);
    if (stage === "product_content" && selectedRevision?.id) target.searchParams.set("revision", selectedRevision.id);
    return `${target.pathname}${target.search}`;
  }

  function validateWorkspaceProjection(value) {
    if (!value || value.projection_version !== 1 || value.action_registry_version !== 1 || value.requested_stage !== requestedStage) return false;
    const action = value.recommended_action;
    if (action == null) return true;
    const registered = workspaceActionRegistry[action.code];
    return Boolean(registered && registered.stage === action.stage && registered.kind === action.kind && action.stage === "product_content");
  }

  async function loadWorkspaceProjection() {
    if (!workspaceMode) return;
    const body = await request(`/api/projects/${encodeURIComponent(projectId)}/products/${encodeURIComponent(activeProductId)}/operator-workspace?stage=${encodeURIComponent(requestedStage)}`);
    workspaceProjection = body.workspace;
    workspaceProjectionTrusted = validateWorkspaceProjection(workspaceProjection);
    workspaceReadFailed = false;
    const projectionVersion = document.querySelector("#workspaceProjectionVersion");
    if (projectionVersion) projectionVersion.textContent = workspaceProjectionTrusted ? `v${workspaceProjection.projection_version} · 动作表 v${workspaceProjection.action_registry_version}` : "响应不可识别";
    if (workspaceProjection.render_mode === "legacy") {
      const target = legacyStageRoutes[requestedStage];
      if (!target) throw Object.assign(new Error("INVALID_OPERATOR_WORKSPACE_STAGE"), { status: 400 });
      location.replace(legacyStageUrl(requestedStage, { id: workspaceProjection.product.current_revision_id, product_id: workspaceProjection.product.id }));
      return false;
    }
    return true;
  }

  function actionCodeForElement(element) {
    if (element === saveButton) return "save_product_content";
    if (element === loadLatestButton) return "load_latest_product_content";
    if (element === returnCurrentButton) return "return_to_current_product_revision";
    if (element === readyButton) return "mark_product_content_ready";
    if (element === copyLink) return "continue_to_copy";
    if (element === refreshButton) return "retry_product_content_read";
    return null;
  }

  function setWorkspaceAction(code) {
    if (!workspaceMode || !workspacePrimaryAction) return;
    workspacePrimaryAction.removeAttribute("data-recommended-action");
    workspacePrimaryAction.removeAttribute("data-action-code");
    const registered = code ? workspaceActionRegistry[code] : null;
    if (!workspaceProjectionTrusted || !registered || registered.stage !== "product_content") {
      workspacePrimaryAction.disabled = true;
      workspacePrimaryAction.textContent = "暂不可用";
      workspaceActionLabel.textContent = workspaceProjectionTrusted ? "当前没有安全的推荐操作" : "下一步暂不可用";
      return;
    }
    workspacePrimaryAction.disabled = false;
    workspacePrimaryAction.textContent = registered.label;
    workspaceActionLabel.textContent = registered.label;
    workspacePrimaryAction.dataset.actionCode = code;
    workspacePrimaryAction.dataset.recommendedAction = "true";
  }

  function recommend(element, actionCode = actionCodeForElement(element)) {
    document.querySelectorAll('[data-recommended-action="true"]').forEach((item) => item.removeAttribute("data-recommended-action"));
    [productOpener, saveButton, readyButton, refreshButton, returnCurrentButton, loadLatestButton].forEach((button) => button.classList.add("secondary"));
    copyLink.classList.add("secondary-link");
    if (workspaceMode) {
      setWorkspaceAction(actionCode);
      return;
    }
    if (element?.tagName === "BUTTON") element.classList.remove("secondary");
    if (element === copyLink) copyLink.classList.remove("secondary-link");
    element?.setAttribute("data-recommended-action", "true");
  }

  function setTask({ title, status, statusClass, saved, next, blocker = "", action, actionCode }) {
    taskTitle.textContent = title;
    taskContext.textContent = revision ? `${project.name} · ${revision.product_name || "未命名商品"}` : project?.name || "正在读取项目";
    taskStatus.className = `state ${statusClass}`;
    taskStatus.textContent = status;
    saveStatus.textContent = saved;
    taskNext.textContent = next;
    taskBlocker.hidden = !blocker;
    taskBlocker.textContent = blocker;
    recommend(action, actionCode || actionCodeForElement(action));
  }

  function syncRevisionUrl() {
    const next = new URL(location.href);
    if (workspaceMode) {
      next.searchParams.delete("id");
      next.searchParams.set("project", projectId);
      if (revision?.product_id) next.searchParams.set("product", revision.product_id);
      next.searchParams.set("stage", "product_content");
    }
    if (revision?.id) next.searchParams.set("revision", revision.id);
    else next.searchParams.delete("revision");
    const state = workspaceMode
      ? { ...(history.state || {}), workspaceHistoryIndex: Number.isInteger(history.state?.workspaceHistoryIndex) ? history.state.workspaceHistoryIndex : acceptedWorkspaceHistoryIndex, productId: revision?.product_id || activeProductId }
      : history.state;
    history.replaceState(state, "", next);
  }

  function setRevisionControls() {
    const immutable = revision.status === "superseded" || isHistoricalRevision(revision);
    revisionForm.querySelectorAll("input, textarea, select").forEach((field) => { field.disabled = immutable; });
    document.querySelector("#addPoint").disabled = immutable;
    pointList.querySelectorAll("button").forEach((button) => { if (immutable) button.disabled = true; });
    saveButton.disabled = immutable;
    readyButton.disabled = immutable || revision.status !== "draft";
    readyButton.title = immutable ? "历史快照不可修改" : (revision.status === "ready" ? "修改后保存会创建新的草稿版本" : "");
  }

  function currentRevisionForProduct(productId) {
    return project?.products.find((item) => item.id === productId || item.revision.product_id === productId)?.revision;
  }

  function isHistoricalRevision(value) {
    const current = value && currentRevisionForProduct(value.product_id);
    return Boolean(current && current.id !== value.id);
  }

  function readyBlockers(value = revision) {
    if (!value || value.status !== "draft") return [];
    const blockers = [];
    if (!value.product_name?.trim()) blockers.push("填写商品名称");
    if (!value.selling_points.some((point) => point.confirmed && point.text?.trim())) blockers.push("确认至少一条卖点");
    if (runtime?.assetsEnabled === true && !value.asset_version_ids.some((id) => availableAssetVersionIds.has(id))) blockers.push("选择至少一张可引用图片");
    if (runtime?.assetsEnabled !== true) blockers.push("素材功能未启用，无法选择商品图片");
    return blockers;
  }

  function confirmDiscardChanges() {
    return !dirty || window.confirm("当前有未保存修改。放弃这些修改并继续吗？");
  }

  function showWorkspaceLayer(layer, moveFocus = false) {
    if (!workspaceMode) return;
    document.body.dataset.mobileLayer = layer;
    if (!moveFocus || !matchMedia("(max-width: 680px)").matches) return;
    if (layer === "detail") {
      const heading = document.querySelector(".workspace-task-panel h2");
      heading.tabIndex = -1;
      requestAnimationFrame(() => heading.focus());
    } else {
      requestAnimationFrame(() => {
        const target = selectedProductTrigger?.isConnected
          ? selectedProductTrigger
          : document.querySelector('#productList button[aria-current="true"]') || document.querySelector("#productList button");
        target?.focus();
      });
    }
  }

  function focusFirstProductBlocker() {
    const blockers = readyBlockers();
    let target;
    if (blockers.includes("填写商品名称")) target = revisionForm.product_name;
    else if (blockers.includes("确认至少一条卖点")) target = pointList.querySelector("input") || document.querySelector("#addPoint");
    else if (blockers.some((item) => item.includes("商品图片") || item.includes("素材"))) target = document.querySelector("#assetOptions input") || document.querySelector("#assetOptions");
    if (!target) return;
    if (!target.matches("input, button, select, textarea, a[href]")) target.tabIndex = -1;
    target.focus();
  }

  function refreshTask() {
    if (workspaceMode && workspaceReadFailed) {
      setTask({ title: "商品资料暂时无法读取", status: "读取失败", statusClass: "failure", saved: dirty ? "本地修改仍保留" : "未载入", next: "刷新当前商品", blocker: "未读取到当前商品的权威状态。", action: refreshButton, actionCode: "retry_product_content_read" });
      return;
    }
    if (!revision) {
      setTask({ title: "创建第一个商品", status: "尚未开始", statusClass: "unavailable", saved: "无商品", next: "创建第一个商品", action: productOpener });
    } else if (dirty) {
      setTask({ title: revision.product_name, status: revision.status === "ready" ? "资料已就绪 · 修改中" : "草稿", statusClass: "draft", saved: "有未保存修改", next: "保存当前修改", action: saveButton });
    } else if (isHistoricalRevision(revision) || revision.status === "superseded") {
      setTask({ title: revision.product_name, status: "历史版本", statusClass: "superseded", saved: "只读版本", next: "回到当前版本", blocker: "该版本仅供追溯，不能继续修改。", action: returnCurrentButton.hidden ? null : returnCurrentButton });
    } else if (revision.status === "ready") {
      const copyAvailable = workspaceMode || runtime?.copyGenerationEnabled === true;
      setTask({ title: revision.product_name, status: "商品资料已就绪", statusClass: "ready", saved: "已保存", next: copyAvailable ? "进入文案" : "等待文案功能启用", action: copyAvailable ? copyLink : null });
    } else {
      const blockers = readyBlockers();
      if (blockers.length) {
        setTask({ title: revision.product_name || "未命名商品", status: "需要处理", statusClass: "requires_action", saved: "已保存", next: "补齐资料就绪条件", blocker: `${blockers.length} 项待处理：${blockers.join("、")}`, action: null, actionCode: "review_product_blockers" });
      } else {
        setTask({ title: revision.product_name, status: "草稿", statusClass: "draft", saved: "已保存", next: "检查并设为资料已就绪", action: readyButton });
      }
    }
  }

  function markDirty() {
    if (rendering || dirty || revision?.status === "superseded" || isHistoricalRevision(revision)) return;
    dirty = true;
    copyLink.hidden = true;
    refreshTask();
  }

  workspacePrimaryAction?.addEventListener("click", () => {
    const code = workspacePrimaryAction.dataset.actionCode;
    const registered = workspaceActionRegistry[code];
    if (!workspaceProjectionTrusted || !registered || registered.stage !== "product_content") return;
    if (code === "save_product_content") saveButton.click();
    else if (code === "load_latest_product_content") loadLatestButton.click();
    else if (code === "return_to_current_product_revision") returnCurrentButton.click();
    else if (code === "review_product_blockers") focusFirstProductBlocker();
    else if (code === "mark_product_content_ready") readyButton.click();
    else if (code === "continue_to_copy") location.assign(legacyStageUrl("copy"));
    else if (code === "retry_product_content_read") refreshButton.click();
  });

  mobileProductBack?.addEventListener("click", () => showWorkspaceLayer("list", true));

  function syncStageLinks() {
    if (workspaceMode) {
      const stageLinks = document.querySelectorAll("[data-stage-code]");
      for (const link of stageLinks) {
        const stage = link.dataset.stageCode;
        link.href = stage === "product_content" ? workspaceStageUrl(stage) : legacyStageUrl(stage);
        link.removeAttribute("aria-disabled");
        const stateNode = link.closest("li") || link;
        stateNode.dataset.stageState = stage === "product_content" ? "current" : "available";
      }
      return;
    }
    const available = runtime?.copyGenerationEnabled === true && revision?.status === "ready" && !isHistoricalRevision(revision);
    const href = available ? `/copy.html?project=${encodeURIComponent(projectId)}&revision=${encodeURIComponent(revision.id)}` : "";
    window.HiflyOperatorStages.set(copyStageLinks, available ? "available" : "blocked");
    for (const link of copyStageLinks) {
      if (!link) continue;
      if (available) {
        link.href = href;
        link.removeAttribute("aria-disabled");
      } else {
        link.removeAttribute("href");
        link.setAttribute("aria-disabled", "true");
      }
    }
  }

  function pointRow(point = { text: "", confirmed: false }) {
    const row = document.createElement("div");
    row.className = "point-row";
    row.dataset.id = point.id || "";
    row.dataset.confirmed = String(point.confirmed);
    const label = document.createElement("label");
    label.textContent = point.confirmed ? "已确认卖点" : "待确认卖点";
    const input = document.createElement("input");
    input.value = point.text;
    input.addEventListener("input", () => {
      if (row.dataset.confirmed === "true" && input.value.trim() !== point.text) {
        row.dataset.confirmed = "false";
        label.firstChild.textContent = "待确认卖点";
      }
    });
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "secondary";
    confirm.textContent = point.confirmed ? "已确认" : "确认";
    confirm.disabled = point.confirmed;
    confirm.addEventListener("click", async () => {
      if (!row.dataset.id) {
        notice.className = "notice blocked";
        notice.textContent = "请先保存草稿，再确认卖点。";
        setTask({ title: revision.product_name, status: "需要处理", statusClass: "requires_action", saved: dirty ? "有未保存修改" : "已保存", next: "先保存草稿", blocker: "新增卖点保存后才能确认。", action: saveButton });
        return;
      }
      await confirmPoint(row.dataset.id);
    });
    label.append(input);
    row.append(label, confirm);
    return row;
  }

  function renderRevision(value) {
    clearLegacyContextForSelection(value);
    revision = value;
    dirty = false;
    conflictProductId = undefined;
    loadLatestButton.hidden = true;
    rendering = true;
    syncRevisionUrl();
    editor.hidden = false;
    revisionForm.hidden = false;
    const state = document.querySelector("#revisionState");
    state.className = `state ${revision.status}`;
    state.textContent = `${revisionLabels[revision.status] || "状态待确认"} · v${revision.revision_number}`;
    revisionForm.product_name.value = revision.product_name;
    revisionForm.product_description.value = revision.product_description || "";
    revisionForm.primary_category.value = categoryDisplayValue(revision.primary_category);
    revisionForm.expression_style.value = revision.content_brief?.expression_style || "";
    revisionForm.additional_requirements.value = revision.content_brief?.additional_requirements || "";
    const dimensions = revision.physical_dimensions || {};
    revisionForm.physical_height.value = dimensions.height ?? "";
    revisionForm.physical_width.value = dimensions.width ?? "";
    revisionForm.physical_depth.value = dimensions.depth ?? "";
    revisionForm.physical_unit.value = dimensions.unit || "";
    revisionForm.capacity_value.value = dimensions.capacity?.value ?? "";
    revisionForm.capacity_unit.value = dimensions.capacity?.unit || "";
    revisionForm.weight_value.value = dimensions.weight?.value ?? "";
    revisionForm.weight_unit.value = dimensions.weight?.unit || "";
    pointList.replaceChildren(...revision.selling_points.map(pointRow));
    copyLink.hidden = (!workspaceMode && runtime?.copyGenerationEnabled !== true) || revision.status !== "ready" || isHistoricalRevision(revision);
    copyLink.href = `/copy.html?project=${encodeURIComponent(projectId)}&revision=${encodeURIComponent(revision.id)}`;
    syncStageLinks();
    const current = currentRevisionForProduct(revision.product_id);
    returnCurrentButton.hidden = !current || current.id === revision.id;
    notice.textContent = "";
    setRevisionControls();
    renderProducts();
    rendering = false;
    refreshTask();
  }

  function renderProducts() {
    const list = document.querySelector("#productList");
    list.replaceChildren();
    if (!project.products.length) {
      list.innerHTML = '<div class="empty operator-empty"><strong>还没有商品</strong><span>创建商品后开始维护事实与目标。</span></div>';
      return;
    }
    for (const item of project.products) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `secondary${item.revision.id === revision?.id ? " is-selected" : ""}`;
      button.title = item.revision.product_name || "未命名商品";
      if (item.revision.id === revision?.id) button.setAttribute("aria-current", "true");
      const name = document.createElement("span");
      name.className = "product-name";
      name.textContent = item.revision.product_name || "未命名商品";
      const meta = document.createElement("span");
      meta.className = "product-meta";
      const blockers = readyBlockers(item.revision);
      const readiness = item.revision.status === "draft"
        ? (blockers.length ? `${blockers.length} 项待处理` : "可设为资料已就绪")
        : null;
      meta.textContent = [`${revisionLabels[item.revision.status] || "状态待确认"} · v${item.revision.revision_number}`, readiness].filter(Boolean).join(" · ");
      button.append(name, meta);
      button.addEventListener("click", async () => {
        if (!confirmDiscardChanges()) return;
        selectedProductTrigger = button;
        activeProductId = item.id;
        if (workspaceMode) {
          const next = new URL(workspaceStageUrl("product_content", item.revision), location.origin);
          const workspaceHistoryIndex = acceptedWorkspaceHistoryIndex + 1;
          history.pushState({ workspaceHistoryIndex, productId: item.id }, "", next);
          acceptedWorkspaceHistoryIndex = workspaceHistoryIndex;
        }
        renderRevision(item.revision);
        await refreshAssets();
        if (workspaceMode) showWorkspaceLayer("detail", true);
      });
      list.append(button);
    }
  }

  async function requestedProjectRevision(revisionId) {
    if (!revisionId) return null;
    try {
      const candidate = (await request(`/api/product-revisions/${encodeURIComponent(revisionId)}`)).revision;
      if (!candidate || typeof candidate.id !== "string" || typeof candidate.project_id !== "string" || typeof candidate.product_id !== "string") {
        throw Object.assign(new Error("PRODUCT_REVISION_RESPONSE_INVALID"), { status: 502 });
      }
      const productVisibleInProject = project.products.some((item) => item.id === candidate.product_id && item.revision.product_id === candidate.product_id);
      if (workspaceMode && activeProductId && candidate.product_id !== activeProductId) return null;
      return candidate.project_id === project.id && productVisibleInProject ? candidate : null;
    } catch (error) {
      if (error.message === "AUTH_REQUIRED") throw error;
      if (error.status === 404) return null;
      throw error;
    }
  }

  async function loadProject(selectRevisionId = revision?.id || requestedRevisionId, selectProductId = workspaceMode ? activeProductId : null) {
    project = (await request(`/api/projects/${projectId}`)).project;
    const projectName = document.querySelector("#projectName");
    projectName.textContent = project.name;
    projectName.title = project.name;
    const selected = selectProductId
      ? project.products.find((item) => item.id === selectProductId || item.revision.product_id === selectProductId)
      : project.products.find((item) => item.revision.id === selectRevisionId);
    if (workspaceMode && !selected && !selectRevisionId) throw Object.assign(new Error("OPERATOR_WORKSPACE_NOT_FOUND"), { status: 404 });
    const historicalRevision = selected ? null : await requestedProjectRevision(selectRevisionId);
    const selectedRevision = selected?.revision || historicalRevision || (workspaceMode ? null : project.products[0]?.revision);
    if (workspaceMode && !selectedRevision) throw Object.assign(new Error("OPERATOR_WORKSPACE_NOT_FOUND"), { status: 404 });
    if (selectedRevision) activeProductId = selectedRevision.product_id;
    if (selectedRevision) renderRevision(selectedRevision);
    else {
      editor.hidden = true;
      revision = undefined;
      dirty = false;
      syncStageLinks();
      syncRevisionUrl();
      copyLink.hidden = true;
      renderProducts();
      refreshTask();
    }
  }

  async function loadAssets() {
    const box = document.querySelector("#assetOptions");
    const assets = (await request("/api/assets")).assets
      .filter((asset) => asset.kind === "product_image" && asset.status === "active")
      .flatMap((asset) => asset.versions.filter((version) => version.status === "available"));
    availableAssetVersionIds = new Set(assets.map((asset) => asset.id));
    box.replaceChildren();
    if (!assets.length) {
      box.innerHTML = '<p class="empty">没有可引用的商品图片</p>';
      renderProducts();
      refreshTask();
      return;
    }
    for (const asset of assets) {
      const label = document.createElement("label");
      label.className = "asset-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = asset.id;
      input.checked = revision?.asset_version_ids.includes(asset.id) || false;
      input.disabled = revision?.status === "superseded" || isHistoricalRevision(revision);
      label.append(input, document.createTextNode(`${asset.original_filename} · 版本 ${asset.version_number}`));
      box.append(label);
    }
    renderProducts();
    refreshTask();
  }

  async function refreshAssets() {
    const box = document.querySelector("#assetOptions");
    if (!revision) {
      availableAssetVersionIds = new Set();
      box.innerHTML = '<p class="empty">创建或选择商品后显示可引用图片。</p>';
    } else if (runtime?.assetsEnabled !== true) {
      availableAssetVersionIds = new Set();
      box.innerHTML = '<p class="empty">素材功能未启用，暂不能选择商品图片。</p>';
    } else {
      await loadAssets();
      return;
    }
    renderProducts();
    refreshTask();
  }

  function payload() {
    return {
      expected_revision: revision.revision_number,
      product_name: revisionForm.product_name.value,
      product_description: revisionForm.product_description.value,
      primary_category: categoryPayloadValue(revisionForm.primary_category.value),
      content_brief: { expression_style: revisionForm.expression_style.value, additional_requirements: revisionForm.additional_requirements.value },
      physical_dimensions: physicalDimensionsPayload(),
      selling_points: [...pointList.children].map((row) => ({ ...(row.dataset.id ? { id: row.dataset.id } : {}), text: row.querySelector("input").value })),
      asset_version_ids: [...document.querySelectorAll("#assetOptions input:checked")].map((input) => input.value)
    };
  }

  async function save() {
    notice.className = "notice";
    notice.textContent = "正在保存...";
    saveStatus.textContent = "保存中";
    saveButton.disabled = true;
    if (workspaceMode) setWorkspaceAction(null);
    try {
      const saved = (await request(`/api/product-revisions/${revision.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(payload()) })).revision;
      await loadProject(saved.id);
      await refreshAssets();
      notice.className = "notice success";
      notice.textContent = revision.status === "ready" ? "当前已就绪资料未变化。" : "草稿已保存。";
      saveStatus.textContent = "已保存";
      return true;
    } catch (error) {
      saveButton.disabled = false;
      if (error.status === 409) {
        conflictProductId = revision.product_id;
        notice.className = "notice blocked";
        notice.textContent = "页面内容已过期。本地修改仍保留，可先复制内容，或明确载入服务端最新版本。";
        loadLatestButton.hidden = false;
        setTask({ title: revision.product_name, status: "版本冲突", statusClass: "requires_action", saved: "本地修改未保存", next: "核对后载入服务端最新版本", blocker: "其他人已更新该商品。载入最新版本会放弃当前本地修改。", action: loadLatestButton });
      } else if (error.body?.error === "INVALID_PHYSICAL_DIMENSIONS") {
        notice.className = "notice blocked";
        notice.textContent = "实物尺寸未保存：填写任一尺寸时需同时填写正数高度、宽度和单位；容量或重量也需成对填写数值与单位。";
        setTask({ title: revision.product_name, status: "需要补充", statusClass: "requires_action", saved: "未保存", next: "核对实物尺寸", blocker: "未知信息可以留空，不能从商品图像素推断。", action: saveButton });
      } else {
        notice.className = "notice error";
        notice.textContent = "保存失败，请稍后重试。";
        setTask({ title: revision.product_name, status: "保存失败", statusClass: "failure", saved: "未保存", next: "重新保存草稿", blocker: "当前修改尚未保存。", action: saveButton });
      }
      return false;
    }
  }

  async function confirmPoint(id) {
    if (!(await save())) return;
    const current = revision.selling_points.find((point) => point.id === id);
    const confirmed = (await request(`/api/product-revisions/${revision.id}/selling-points/${id}/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected_revision: revision.revision_number }) })).revision;
    await loadProject(confirmed.id);
    await refreshAssets();
    notice.className = "notice success";
    notice.textContent = `“${current.text}”已确认。`;
  }

  productForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = productForm.querySelector('button[type="submit"]');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = "正在创建...";
    try {
      const result = await request(`/api/projects/${projectId}/products`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ product_name: productForm.product_name.value }) });
      productForm.reset();
      productDialog.close();
      if (workspaceMode) activeProductId = result.product.id;
      await loadProject(result.revision.id, workspaceMode ? result.product.id : null);
      await refreshAssets();
    } catch (error) {
      if (error.message !== "AUTH_REQUIRED") document.querySelector("#productError").textContent = "商品创建失败，请重试。";
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });

  revisionForm.addEventListener("submit", async (event) => { event.preventDefault(); await save(); });
  revisionForm.addEventListener("input", markDirty);
  revisionForm.addEventListener("change", markDirty);
  document.querySelector("#addPoint").addEventListener("click", () => { pointList.append(pointRow()); markDirty(); });
  refreshButton.addEventListener("click", async () => {
    if (!confirmDiscardChanges()) return;
    try {
      if (workspaceMode && !(await loadWorkspaceProjection())) return;
      await loadProject(null, workspaceMode ? activeProductId : null);
      await refreshAssets();
      workspaceReadFailed = false;
      productOpener.disabled = false;
    } catch (error) {
      if (error.message === "AUTH_REQUIRED") return;
      workspaceReadFailed = true;
      refreshTask();
    }
  });
  loadLatestButton.addEventListener("click", async () => {
    if (!confirmDiscardChanges()) return;
    const productId = conflictProductId || revision.product_id;
    await loadProject(null, productId);
    await refreshAssets();
  });
  returnCurrentButton.addEventListener("click", async () => {
    if (!confirmDiscardChanges()) return;
    const current = currentRevisionForProduct(revision.product_id);
    if (!current) return;
    renderRevision(current);
    await refreshAssets();
  });
  readyButton.addEventListener("click", async () => {
    if (!(await save())) return;
    try {
      const ready = (await request(`/api/product-revisions/${revision.id}/ready`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ expected_revision: revision.revision_number }) })).revision;
      await loadProject(ready.id);
      notice.className = "notice success";
      notice.textContent = "商品资料已设为就绪。";
    } catch (error) {
      if (["ASSET_NOT_ACTIVE", "ASSET_VERSION_NOT_AVAILABLE"].includes(error.message)) {
        await refreshAssets();
        notice.className = "notice blocked";
        notice.textContent = "素材已不可引用，请重新选择。";
        setTask({ title: revision.product_name, status: "需要处理", statusClass: "requires_action", saved: "已保存", next: "重新选择商品图片", blocker: "原商品图片已失效或不可用。", action: null, actionCode: "review_product_blockers" });
      } else if (error.message === "PRODUCT_REVISION_READY_BLOCKED") {
        const labels = { PRODUCT_NAME_REQUIRED: "填写商品名称", SELLING_POINT_REQUIRED: "确认至少一条卖点", IMAGE_REQUIRED: "选择至少一张可引用图片" };
        const blocker = error.body.reasons.map((item) => labels[item.code]).join("、");
        notice.className = "notice blocked";
        notice.textContent = `暂不能设为资料已就绪：${blocker}。`;
        setTask({ title: revision.product_name, status: "需要处理", statusClass: "requires_action", saved: "已保存", next: "补齐资料就绪条件", blocker, action: null, actionCode: "review_product_blockers" });
      } else {
        notice.className = "notice error";
        notice.textContent = "资料就绪操作失败，请稍后重试。";
        setTask({ title: revision.product_name, status: "操作失败", statusClass: "failure", saved: "已保存", next: "重新设为资料已就绪", blocker: "资料就绪操作未完成。", action: readyButton });
      }
    }
  });

  productOpener.addEventListener("click", () => {
    if (!confirmDiscardChanges()) return;
    document.querySelector("#productError").textContent = "";
    productDialog.showModal();
    productForm.product_name.focus();
  });
  document.querySelector("#closeProductDialog").addEventListener("click", () => productDialog.close());
  productDialog.addEventListener("close", () => productOpener.focus());

  function fallbackFromWorkspace() {
    if (requestedStage !== "product_content" && legacyStageRoutes[requestedStage]) return location.replace(legacyStageUrl(requestedStage));
    const target = new URL("/project.html", location.origin);
    target.searchParams.set("id", projectId);
    if (requestedRevisionId) target.searchParams.set("revision", requestedRevisionId);
    return location.replace(`${target.pathname}${target.search}`);
  }

  async function bootstrap() {
    try {
      runtime = await request("/api/runtime");
      if (!runtime.projectContentEnabled) return location.replace("/");
      if (workspaceMode) {
        if (runtime.operatorWorkspaceEnabled !== true) return fallbackFromWorkspace();
        if (!(await loadWorkspaceProjection())) return;
      }
      await loadProject(requestedRevisionId, workspaceMode && !requestedRevisionId ? activeProductId : null);
      await refreshAssets();
      workspaceReadFailed = false;
      productOpener.disabled = false;
      if (workspaceMode) showWorkspaceLayer("detail", false);
    } catch (error) {
      if (error.message === "AUTH_REQUIRED") return;
      editor.hidden = workspaceMode ? false : true;
      productOpener.disabled = true;
      workspaceReadFailed = workspaceMode;
      const returnLink = document.querySelector('.eyebrow a[href="/projects.html"]');
      setTask({ title: "商品工作区暂时无法载入", status: "加载失败", statusClass: "failure", saved: "未载入", next: workspaceMode ? "刷新当前商品" : "返回项目列表", blocker: "项目或商品信息未载入。", action: workspaceMode ? refreshButton : returnLink, actionCode: workspaceMode ? "retry_product_content_read" : null });
    }
  }

  window.addEventListener("beforeunload", (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });
  if (workspaceMode) {
    window.addEventListener("popstate", async (event) => {
      const targetIndex = Number.isInteger(event.state?.workspaceHistoryIndex) ? event.state.workspaceHistoryIndex : null;
      if (restoringWorkspaceHistoryIndex != null && targetIndex === restoringWorkspaceHistoryIndex) {
        restoringWorkspaceHistoryIndex = null;
        return;
      }
      restoringWorkspaceHistoryIndex = null;
      const next = new URLSearchParams(location.search);
      const productId = next.get("product");
      if (!productId || productId === activeProductId) return;
      if (!confirmDiscardChanges()) {
        const delta = targetIndex == null ? 0 : acceptedWorkspaceHistoryIndex - targetIndex;
        if (delta !== 0) {
          restoringWorkspaceHistoryIndex = acceptedWorkspaceHistoryIndex;
          history.go(delta);
        } else {
          history.replaceState({ ...(history.state || {}), workspaceHistoryIndex: acceptedWorkspaceHistoryIndex, productId: activeProductId }, "", workspaceStageUrl("product_content"));
        }
        return;
      }
      activeProductId = productId;
      if (targetIndex != null) acceptedWorkspaceHistoryIndex = targetIndex;
      revisionForm.hidden = true;
      productOpener.disabled = true;
      setTask({ title: "正在载入商品资料", status: "加载中", statusClass: "processing", saved: "等待权威状态", next: "载入完成后继续", blocker: "", action: null });
      try {
        if (!(await loadWorkspaceProjection())) return;
        await loadProject(null, activeProductId);
        await refreshAssets();
        workspaceReadFailed = false;
        productOpener.disabled = false;
        showWorkspaceLayer("detail", false);
      } catch (error) {
        if (error.message === "AUTH_REQUIRED") return;
        revision = undefined;
        dirty = false;
        workspaceReadFailed = true;
        revisionForm.hidden = true;
        editor.hidden = false;
        productOpener.disabled = true;
        renderProducts();
        refreshTask();
      }
    });
  }

  if (!projectId || (workspaceMode && !activeProductId)) return location.replace("/projects.html");
  if (workspaceMode) {
    acceptedWorkspaceHistoryIndex = Number.isInteger(history.state?.workspaceHistoryIndex) ? history.state.workspaceHistoryIndex : 0;
    history.replaceState({ ...(history.state || {}), workspaceHistoryIndex: acceptedWorkspaceHistoryIndex, productId: activeProductId }, "", location.href);
  }
  await bootstrap();
})();
