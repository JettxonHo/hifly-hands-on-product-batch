(async () => {
  const params = new URLSearchParams(location.search);
  const projectId = params.get("id");
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
  let availableAssetVersionIds = new Set();
  const revisionLabels = { draft: "草稿", ready: "商品资料已就绪", superseded: "已被替代" };
  const generalCategoryLabel = "未细分品类";
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

  function recommend(element) {
    document.querySelectorAll('[data-recommended-action="true"]').forEach((item) => item.removeAttribute("data-recommended-action"));
    [productOpener, saveButton, readyButton, refreshButton, returnCurrentButton, loadLatestButton].forEach((button) => button.classList.add("secondary"));
    copyLink.classList.add("secondary-link");
    if (element?.tagName === "BUTTON") element.classList.remove("secondary");
    if (element === copyLink) copyLink.classList.remove("secondary-link");
    element?.setAttribute("data-recommended-action", "true");
  }

  function setTask({ title, status, statusClass, saved, next, blocker = "", action }) {
    taskTitle.textContent = title;
    taskContext.textContent = revision ? `${project.name} · ${revision.product_name || "未命名商品"}` : project?.name || "正在读取项目";
    taskStatus.className = `state ${statusClass}`;
    taskStatus.textContent = status;
    saveStatus.textContent = saved;
    taskNext.textContent = next;
    taskBlocker.hidden = !blocker;
    taskBlocker.textContent = blocker;
    recommend(action);
  }

  function syncRevisionUrl() {
    const next = new URL(location.href);
    if (revision?.id) next.searchParams.set("revision", revision.id);
    else next.searchParams.delete("revision");
    history.replaceState(null, "", next);
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

  function refreshTask() {
    if (!revision) {
      setTask({ title: "创建第一个商品", status: "尚未开始", statusClass: "unavailable", saved: "无商品", next: "创建第一个商品", action: productOpener });
    } else if (dirty) {
      setTask({ title: revision.product_name, status: revision.status === "ready" ? "资料已就绪 · 修改中" : "草稿", statusClass: "draft", saved: "有未保存修改", next: "保存当前修改", action: saveButton });
    } else if (isHistoricalRevision(revision) || revision.status === "superseded") {
      setTask({ title: revision.product_name, status: "历史版本", statusClass: "superseded", saved: "只读版本", next: "回到当前版本", blocker: "该版本仅供追溯，不能继续修改。", action: returnCurrentButton.hidden ? null : returnCurrentButton });
    } else if (revision.status === "ready") {
      setTask({ title: revision.product_name, status: "商品资料已就绪", statusClass: "ready", saved: "已保存", next: runtime?.copyGenerationEnabled ? "进入文案" : "等待文案功能启用", action: runtime?.copyGenerationEnabled ? copyLink : null });
    } else {
      const blockers = readyBlockers();
      if (blockers.length) {
        setTask({ title: revision.product_name || "未命名商品", status: "需要处理", statusClass: "requires_action", saved: "已保存", next: "补齐资料就绪条件", blocker: `${blockers.length} 项待处理：${blockers.join("、")}`, action: null });
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

  function syncStageLinks() {
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
    revision = value;
    dirty = false;
    conflictProductId = undefined;
    loadLatestButton.hidden = true;
    rendering = true;
    syncRevisionUrl();
    editor.hidden = false;
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
    copyLink.hidden = runtime?.copyGenerationEnabled !== true || revision.status !== "ready" || isHistoricalRevision(revision);
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
        renderRevision(item.revision);
        await refreshAssets();
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
      return candidate.project_id === project.id && productVisibleInProject ? candidate : null;
    } catch (error) {
      if (error.message === "AUTH_REQUIRED") throw error;
      if (error.status === 404) return null;
      throw error;
    }
  }

  async function loadProject(selectRevisionId = revision?.id || requestedRevisionId, selectProductId) {
    project = (await request(`/api/projects/${projectId}`)).project;
    const projectName = document.querySelector("#projectName");
    projectName.textContent = project.name;
    projectName.title = project.name;
    const selected = selectProductId
      ? project.products.find((item) => item.id === selectProductId || item.revision.product_id === selectProductId)
      : project.products.find((item) => item.revision.id === selectRevisionId);
    const historicalRevision = selected ? null : await requestedProjectRevision(selectRevisionId);
    const selectedRevision = selected?.revision || historicalRevision || project.products[0]?.revision;
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
      .filter((asset) => asset.status === "active")
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
      await loadProject(result.revision.id);
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
    await loadProject();
    await refreshAssets();
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
        setTask({ title: revision.product_name, status: "需要处理", statusClass: "requires_action", saved: "已保存", next: "重新选择商品图片", blocker: "原商品图片已失效或不可用。", action: null });
      } else if (error.message === "PRODUCT_REVISION_READY_BLOCKED") {
        const labels = { PRODUCT_NAME_REQUIRED: "填写商品名称", SELLING_POINT_REQUIRED: "确认至少一条卖点", IMAGE_REQUIRED: "选择至少一张可引用图片" };
        const blocker = error.body.reasons.map((item) => labels[item.code]).join("、");
        notice.className = "notice blocked";
        notice.textContent = `暂不能设为资料已就绪：${blocker}。`;
        setTask({ title: revision.product_name, status: "需要处理", statusClass: "requires_action", saved: "已保存", next: "补齐资料就绪条件", blocker, action: null });
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

  if (!projectId) return location.replace("/projects.html");
  try {
    runtime = await request("/api/runtime");
    if (!runtime.projectContentEnabled) return location.replace("/");
    await loadProject();
    await refreshAssets();
  } catch (error) {
    if (error.message !== "AUTH_REQUIRED") {
      editor.hidden = true;
      productOpener.disabled = true;
      const returnLink = document.querySelector('.eyebrow a[href="/projects.html"]');
      setTask({ title: "商品工作区暂时无法载入", status: "加载失败", statusClass: "failure", saved: "未载入", next: "返回项目列表", blocker: "项目或商品信息未载入。", action: returnLink });
    }
  }
})();
