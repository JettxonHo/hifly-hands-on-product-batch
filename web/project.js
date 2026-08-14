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
  const copyLink = document.querySelector("#openCopyWorkspace");
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
  const revisionLabels = { draft: "草稿", ready: "已 Ready", superseded: "已被替代" };
  const csrf = () => decodeURIComponent((document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hifly_identity_csrf=")) || "=").split("=").slice(1).join("="));

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
    [productOpener, saveButton, readyButton, refreshButton].forEach((button) => button.classList.add("secondary"));
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
    const immutable = revision.status === "superseded";
    revisionForm.querySelectorAll("input, textarea").forEach((field) => { field.disabled = immutable; });
    document.querySelector("#addPoint").disabled = immutable;
    pointList.querySelectorAll("button").forEach((button) => { if (immutable) button.disabled = true; });
    saveButton.disabled = immutable;
    readyButton.disabled = revision.status !== "draft";
    readyButton.title = revision.status === "ready" ? "修改后保存会创建新的草稿版本" : (immutable ? "已被替代的快照不可修改" : "");
  }

  function refreshTask() {
    if (!revision) {
      setTask({ title: "创建第一个商品", status: "尚未开始", statusClass: "unavailable", saved: "无商品", next: "创建第一个商品", action: productOpener });
    } else if (dirty) {
      setTask({ title: revision.product_name, status: revision.status === "ready" ? "已 Ready · 修改中" : "草稿", statusClass: "draft", saved: "有未保存修改", next: "保存当前修改", action: saveButton });
    } else if (revision.status === "ready") {
      setTask({ title: revision.product_name, status: "已 Ready", statusClass: "ready", saved: "已保存", next: runtime?.copyGenerationEnabled ? "进入文案与质检" : "等待文案功能启用", action: runtime?.copyGenerationEnabled ? copyLink : null });
    } else if (revision.status === "superseded") {
      setTask({ title: revision.product_name, status: "已被替代", statusClass: "superseded", saved: "只读版本", next: "选择当前商品版本", blocker: "该版本仅供追溯，不能继续修改。", action: null });
    } else if (runtime?.assetsEnabled !== true) {
      setTask({ title: revision.product_name, status: "需要处理", statusClass: "requires_action", saved: "已保存", next: "等待素材功能启用", blocker: "素材功能未启用，无法选择 Ready 所需的商品图片。", action: null });
    } else {
      setTask({ title: revision.product_name, status: "草稿", statusClass: "draft", saved: "已保存", next: "检查并设为 Ready", action: readyButton });
    }
  }

  function markDirty() {
    if (rendering || dirty || revision?.status === "superseded") return;
    dirty = true;
    copyLink.hidden = true;
    refreshTask();
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
    rendering = true;
    syncRevisionUrl();
    editor.hidden = false;
    const state = document.querySelector("#revisionState");
    state.className = `state ${revision.status}`;
    state.textContent = `${revisionLabels[revision.status] || "状态待确认"} · v${revision.revision_number}`;
    revisionForm.product_name.value = revision.product_name;
    revisionForm.product_description.value = revision.product_description || "";
    revisionForm.primary_category.value = revision.primary_category;
    revisionForm.expression_style.value = revision.content_brief?.expression_style || "";
    revisionForm.additional_requirements.value = revision.content_brief?.additional_requirements || "";
    pointList.replaceChildren(...revision.selling_points.map(pointRow));
    copyLink.hidden = runtime?.copyGenerationEnabled !== true || revision.status !== "ready";
    copyLink.href = `/copy.html?project=${encodeURIComponent(projectId)}&revision=${encodeURIComponent(revision.id)}`;
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
      meta.textContent = `${revisionLabels[item.revision.status] || "状态待确认"} · v${item.revision.revision_number}`;
      button.append(name, meta);
      button.addEventListener("click", () => renderRevision(item.revision));
      list.append(button);
    }
  }

  async function loadProject(selectRevisionId = revision?.id || requestedRevisionId) {
    project = (await request(`/api/projects/${projectId}`)).project;
    const projectName = document.querySelector("#projectName");
    projectName.textContent = project.name;
    projectName.title = project.name;
    const selected = project.products.find((item) => item.revision.id === selectRevisionId) || project.products[0];
    if (selected) renderRevision(selected.revision);
    else {
      editor.hidden = true;
      revision = undefined;
      dirty = false;
      syncRevisionUrl();
      copyLink.hidden = true;
      renderProducts();
      refreshTask();
    }
  }

  async function loadAssets() {
    const box = document.querySelector("#assetOptions");
    const assets = (await request("/api/assets")).assets.flatMap((asset) => asset.versions.filter((version) => version.status === "available"));
    box.replaceChildren();
    if (!assets.length) {
      box.innerHTML = '<p class="empty">没有可引用的商品图片</p>';
      return;
    }
    for (const asset of assets) {
      const label = document.createElement("label");
      label.className = "asset-option";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = asset.id;
      input.checked = revision?.asset_version_ids.includes(asset.id) || false;
      input.disabled = revision?.status === "superseded";
      label.append(input, document.createTextNode(`${asset.original_filename} · 版本 ${asset.version_number}`));
      box.append(label);
    }
  }

  async function refreshAssets() {
    const box = document.querySelector("#assetOptions");
    if (!revision) {
      box.innerHTML = '<p class="empty">创建或选择商品后显示可引用图片。</p>';
    } else if (runtime?.assetsEnabled !== true) {
      box.innerHTML = '<p class="empty">素材功能未启用，暂不能选择商品图片。</p>';
    } else {
      await loadAssets();
    }
  }

  function payload() {
    return {
      expected_revision: revision.revision_number,
      product_name: revisionForm.product_name.value,
      product_description: revisionForm.product_description.value,
      primary_category: revisionForm.primary_category.value,
      content_brief: { expression_style: revisionForm.expression_style.value, additional_requirements: revisionForm.additional_requirements.value },
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
      notice.textContent = revision.status === "ready" ? "当前 Ready 快照未变化。" : "草稿已保存。";
      saveStatus.textContent = "已保存";
      return true;
    } catch (error) {
      saveButton.disabled = false;
      if (error.status === 409) {
        notice.className = "notice blocked";
        notice.textContent = "页面内容已过期，请刷新后继续。";
        setTask({ title: revision.product_name, status: "版本冲突", statusClass: "requires_action", saved: "未保存", next: "刷新当前版本", blocker: "其他人已更新该商品，请刷新后重新确认修改。", action: refreshButton });
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
  refreshButton.addEventListener("click", async () => { await loadProject(); await refreshAssets(); });
  readyButton.addEventListener("click", async () => {
    if (!(await save())) return;
    try {
      const ready = (await request(`/api/product-revisions/${revision.id}/ready`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ expected_revision: revision.revision_number }) })).revision;
      await loadProject(ready.id);
      notice.className = "notice success";
      notice.textContent = "商品快照已 Ready。";
    } catch (error) {
      if (error.message === "PRODUCT_REVISION_READY_BLOCKED") {
        const labels = { PRODUCT_NAME_REQUIRED: "填写商品名称", SELLING_POINT_REQUIRED: "确认至少一条卖点", IMAGE_REQUIRED: "选择至少一张可引用图片" };
        const blocker = error.body.reasons.map((item) => labels[item.code]).join("、");
        notice.className = "notice blocked";
        notice.textContent = `暂不能 Ready：${blocker}。`;
        setTask({ title: revision.product_name, status: "需要处理", statusClass: "requires_action", saved: "已保存", next: "补齐 Ready 条件", blocker, action: null });
      } else {
        notice.className = "notice error";
        notice.textContent = "Ready 操作失败，请稍后重试。";
        setTask({ title: revision.product_name, status: "操作失败", statusClass: "failure", saved: "已保存", next: "重新设为 Ready", blocker: "Ready 操作未完成。", action: readyButton });
      }
    }
  });

  productOpener.addEventListener("click", () => {
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
