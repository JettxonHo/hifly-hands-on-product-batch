(async () => {
  const params = new URLSearchParams(location.search), projectId = params.get("project"), requestedProductId = params.get("product");
  let project, product, runtime, workspace, creating = false, selectedOrderId = params.get("orderId") || null, pendingCreateKey = null;
  const element = (selector) => document.querySelector(selector);
  const csrf = () => decodeURIComponent((document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hifly_identity_csrf=")) || "=").split("=").slice(1).join("="));
  const purposeLabels = { first_production: "首次生产", rework: "返工重做", supplemental_version: "补充版本", reproduction: "再次生产" };
  const purposeDescriptions = {
    first_production: "本商品首次安排真实生产。", rework: "此前生产结果不满足要求，按相同方案重新生产。",
    supplemental_version: "在已有生产结果之外，按相同方案追加生产一个版本。", reproduction: "按相同方案再次生产，例如原产物不可用或需要重出。"
  };
  const statusLabels = { draft: "草稿", ready: "已就绪", waiting_for_executor: "等待执行", claimed: "已领取", running: "执行中", requires_action: "需要处理", succeeded: "已完成", failed: "失败", cancel_requested: "取消中", cancelled: "已取消" };
  const planLabels = { frozen: "已批准方案", draft: "草稿方案", superseded: "已被替代" };
  const gateLabels = { approved_plan_missing: "视频方案尚未通过人工审核，不能创建工单", plan_review_not_approved: "视频方案尚未通过人工审核，不能创建工单", preflight_not_reviewable: "视频方案预检尚未达到可生产条件，不能创建工单", preflight_invalidated: "方案批准已失效，请返回视频方案重新确认", upstream_changed: "方案引用的商品、文案或人物信息已变化，请创建新方案版本", capability_snapshot_changed: "方案能力配置已变化，请返回视频方案重新确认", plan_not_current: "当前方案已不是有效版本，请返回视频方案查看最新版本", plan_not_frozen: "视频方案尚未固定，不能创建工单" };

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {}); if (options.method && options.method !== "GET") headers.set("x-identity-csrf", csrf());
    const response = await fetch(url, { credentials: "same-origin", ...options, headers });
    if (response.status === 401) { location.replace("/login.html"); throw new Error("AUTH_REQUIRED"); }
    const body = await response.json(); if (!response.ok) throw Object.assign(new Error(body.error), { status: response.status, body }); return body;
  }
  function notice(target, message = "", tone = "") { target.className = `notice${tone ? ` ${tone}` : ""}`; target.textContent = message; }
  function stateClass(status) { return ["succeeded", "ready"].includes(status) ? "ready" : ["queued", "running", "pending", "waiting_for_executor", "claimed"].includes(status) ? "waiting_for_executor" : ["requires_action"].includes(status) ? "blocked" : ["failed"].includes(status) ? "failure" : ["cancelled", "superseded"].includes(status) ? "superseded" : ""; }
  function badge(target, status) { target.textContent = statusLabels[status] || "状态待确认"; target.className = `state ${stateClass(status)}`; }
  function short(value) { return value ? value.slice(0, 8) : "未就绪"; }
  function formatTime(value) { return value ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "时间待确认"; }
  function planHref() { return `/plan.html?project=${encodeURIComponent(project.id)}&product=${encodeURIComponent(product.id)}`; }
  function updateLocation() { const next = new URL(location.href); next.searchParams.set("project", project.id); next.searchParams.set("product", product.id); if (selectedOrderId) next.searchParams.set("orderId", selectedOrderId); else next.searchParams.delete("orderId"); history.replaceState(null, "", next); }

  function renderContext() {
    element("#projectBreadcrumb").textContent = project.name; element("#projectBreadcrumb").href = `/project.html?id=${encodeURIComponent(project.id)}`;
    const facts = `/project.html?id=${encodeURIComponent(project.id)}`, copy = `/copy.html?project=${encodeURIComponent(project.id)}&revision=${encodeURIComponent(product.revision.id)}`, avatar = `/avatar.html?project=${encodeURIComponent(project.id)}&product=${encodeURIComponent(product.id)}`;
    element("#factsStageLink").href = facts; element("#mobileFactsStageLink").href = facts; element("#copyStageLink").href = copy; element("#mobileCopyStageLink").href = copy; element("#avatarStageLink").href = avatar; element("#mobileAvatarStageLink").href = avatar; element("#planStageLink").href = planHref(); element("#mobilePlanStageLink").href = planHref(); element("#planContextLink").href = planHref();
    const selector = element("#productSelector"); selector.replaceChildren(...project.products.map((item) => { const option = document.createElement("option"); option.value = item.id; option.textContent = item.revision.product_name || "未命名商品"; option.selected = item.id === product.id; return option; }));
  }

  function renderGate() {
    const reasons = workspace?.gate?.reasons || [];
    const plan = workspace?.current_plan;
    const planState = element("#planState"); planState.textContent = plan ? planLabels[plan.status] || "状态待确认" : "尚无已批准方案"; planState.className = `state ${workspace?.gate?.can_create ? "ready" : "blocked"}`;
    element("#contextSummary").textContent = plan ? `方案 v${plan.version_number} · ${workspace.gate.can_create ? "已批准" : "批准已失效"}` : "请先完成方案审核";
    const summary = plan ? `文案 ${short(plan.upstream_snapshot?.copy_version_id)} · 人物 ${short(plan.upstream_snapshot?.avatar_selection_id)}` : "等待当前有效已批准方案";
    element("#planContextLink").textContent = plan ? "查看方案 →" : "返回视频方案 →"; element("#contextSummary").title = summary;
    if (workspace.execution_environment.online === false) notice(element("#executorNotice"), "当前没有可用的执行环境，工单将等待人工执行；不影响创建工单。", "blocked"); else notice(element("#executorNotice"));
    const createDisabled = !workspace.gate.can_create;
    for (const selector of ["#createOrderButton", "#createOrderEmpty"]) { const button = element(selector); button.disabled = createDisabled; button.title = createDisabled ? (gateLabels[reasons[0]] || "当前条件不满足，无法创建工单") : ""; }
    if (createDisabled) notice(element("#pageNotice"), reasons.map((reason) => gateLabels[reason] || "当前方案不可创建工单").join("；") + "。请返回视频方案处理。", "blocked"); else if (!element("#pageNotice").textContent || element("#pageNotice").classList.contains("blocked")) notice(element("#pageNotice"));
  }

  function orderRow(order, mobile = false) {
    const button = document.createElement("button"); button.type = "button"; button.className = "order-row"; button.dataset.orderId = order.id; button.setAttribute("aria-current", String(order.id === selectedOrderId));
    const title = document.createElement("span"); title.className = "order-row-title"; const name = document.createElement("strong"); name.textContent = purposeLabels[order.execution_purpose] || "生产工单"; const state = document.createElement("span"); badge(state, order.status); title.append(name, state);
    const meta = document.createElement("span"); meta.className = "order-row-meta"; const time = document.createElement("span"); time.textContent = formatTime(order.created_at); const packageState = document.createElement("span"); packageState.textContent = "交接包：尚未生成"; meta.append(time, packageState); button.append(title, meta);
    button.addEventListener("click", () => { selectedOrderId = order.id; render(); if (mobile) element("#orderDrawer").close(); }); return button;
  }
  function renderOrders() {
    const orders = workspace.orders || []; if (!selectedOrderId || !orders.some((order) => order.id === selectedOrderId)) selectedOrderId = orders.at(-1)?.id || null;
    element("#orderList").replaceChildren(...orders.slice().reverse().map((order) => orderRow(order))); element("#mobileOrderList").replaceChildren(...orders.slice().reverse().map((order) => orderRow(order, true))); element("#orderListEmpty").hidden = orders.length > 0;
    const trigger = element("#mobileOrderTrigger"); trigger.hidden = orders.length === 0; trigger.textContent = `▦ 工单（${orders.length}）· 当前：${purposeLabels[orders.find((order) => order.id === selectedOrderId)?.execution_purpose] || "无"} ▾`;
    updateLocation();
  }
  function snapshotCard(label, value, href) { const card = document.createElement("a"); card.className = "snapshot-card"; card.href = href; const copy = document.createElement("span"); const title = document.createElement("strong"); title.textContent = label; const meta = document.createElement("span"); meta.textContent = value; copy.append(title, meta); const link = document.createElement("span"); link.textContent = "查看 →"; card.append(copy, link); return card; }
  function renderDetail() {
    const order = workspace.orders.find((item) => item.id === selectedOrderId) || null; element("#orderDetailEmpty").hidden = Boolean(order); element("#orderDetail").hidden = !order;
    if (!order) { element("#orderEmptyDescription").textContent = workspace.orders.length ? "选择左侧工单查看固定输入快照。" : workspace.gate.can_create ? "方案通过人工审核后，选择业务目的并创建第一个生产工单。" : "当前没有可创建工单的已批准方案，请返回视频方案处理。"; return; }
    element("#orderDetailTitle").textContent = purposeLabels[order.execution_purpose] || "生产工单"; badge(element("#orderStatus"), order.status); element("#orderPurpose").textContent = purposeLabels[order.execution_purpose] || "生产目的待确认"; element("#orderPurposeDescription").textContent = purposeDescriptions[order.execution_purpose] || "该生产目的说明待确认。";
    const snapshot = order.input_snapshot, plan = snapshot?.video_plan_version || {}, upstream = snapshot?.upstream_snapshot || {};
    element("#snapshotCards").replaceChildren(
      snapshotCard("商品快照", `${short(upstream.product_revision_id)} · 已固定`, `/project.html?id=${encodeURIComponent(project.id)}`),
      snapshotCard("已批准文案", `${short(upstream.copy_version_id)} · 已批准`, `/copy.html?project=${encodeURIComponent(project.id)}&revision=${encodeURIComponent(product.revision.id)}`),
      snapshotCard("已确认人物", `${short(upstream.avatar_selection_id)} · 版本 ${short(upstream.avatar_asset_version_id)}`, `/avatar.html?project=${encodeURIComponent(project.id)}&product=${encodeURIComponent(product.id)}`),
      snapshotCard("视频方案", `v${plan.version_number || "?"} · 已批准`, planHref())
    );
    element("#orderCreatedMeta").textContent = `创建于 ${formatTime(order.created_at)} · 工单输入只读固定。`;
    notice(element("#orderDetailNotice"), order.status === "waiting_for_executor" ? "工单将等待人工执行，不会自动开始生产。" : "");
  }
  function renderPackagePlaceholder() { element("#packagePlaceholder").textContent = workspace.selected_order ? "当前工单尚未生成交接包。交接包生成能力将在后续阶段开放。" : "创建生产工单后，可在后续阶段生成人工交接包。"; }
  function render() { renderContext(); renderGate(); renderOrders(); renderDetail(); renderPackagePlaceholder(); element("#productionWorkspace").hidden = false; }
  async function loadWorkspace() { workspace = await request(`/api/products/${encodeURIComponent(product.id)}/production-workspace${selectedOrderId ? `?orderId=${encodeURIComponent(selectedOrderId)}` : ""}`); render(); }
  function openCreateOrder() { if (!workspace.gate.can_create || creating) return; pendingCreateKey = null; element("#createOrderError").textContent = ""; element("#createOrderForm").reset(); renderDialogSnapshot(); element("#createOrderDialog").showModal(); }
  function renderDialogSnapshot() { const plan = workspace.current_plan, upstream = plan?.upstream_snapshot || {}; element("#dialogSnapshot").replaceChildren(...[["商品快照", short(upstream.product_revision_id)], ["已批准文案", short(upstream.copy_version_id)], ["已确认人物", short(upstream.avatar_selection_id)], ["视频方案", plan ? `v${plan.version_number}` : "未就绪"]].map(([label, value]) => { const row = document.createElement("div"); row.className = "dialog-snapshot-row"; const name = document.createElement("strong"); name.textContent = label; const meta = document.createElement("span"); meta.textContent = value; row.append(name, meta); return row; })); }
  async function submitCreate(event) { event.preventDefault(); if (creating || !workspace.gate.can_create) return; const selected = document.querySelector("input[name=executionPurpose]:checked"); if (!selected) return; creating = true; const button = element("#confirmCreateOrder"); button.disabled = true; pendingCreateKey ||= crypto.randomUUID(); element("#createOrderError").textContent = "";
    try { const result = await request(`/api/products/${encodeURIComponent(product.id)}/production-orders`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": pendingCreateKey }, body: JSON.stringify({ video_plan_version_id: workspace.current_plan.id, execution_purpose: selected.value }) }); selectedOrderId = result.order.id; element("#createOrderDialog").close(); await loadWorkspace(); notice(element("#pageNotice"), result.replayed ? "创建请求已受理，已为你打开对应工单。" : "生产工单已创建，正在等待人工执行。", "success"); pendingCreateKey = null; }
    catch (error) { if (error.status === 409) element("#createOrderError").textContent = "创建信息已变化或请求已冲突，请刷新后重新确认。"; else if (error.status === 422) element("#createOrderError").textContent = (error.body?.reasons || []).map((reason) => gateLabels[reason] || "当前方案不可创建工单").join("；") || "当前方案不可创建工单，请返回视频方案处理。"; else element("#createOrderError").textContent = "创建未完成（技术原因），你的操作未生效；可以使用同一目的重试。"; }
    finally { creating = false; button.disabled = !document.querySelector("input[name=executionPurpose]:checked"); }
  }
  element("#createOrderButton").addEventListener("click", openCreateOrder); element("#createOrderEmpty").addEventListener("click", openCreateOrder); element("#createOrderForm").addEventListener("submit", submitCreate); element("#cancelCreateOrder").addEventListener("click", () => element("#createOrderDialog").close()); element("#closeCreateOrder").addEventListener("click", () => element("#createOrderDialog").close());
  document.querySelectorAll("input[name=executionPurpose]").forEach((input) => input.addEventListener("change", () => { if (!creating) element("#confirmCreateOrder").disabled = false; }));
  element("#mobileOrderTrigger").addEventListener("click", () => element("#orderDrawer").showModal()); element("#closeOrderDrawer").addEventListener("click", () => element("#orderDrawer").close()); element("#refreshProduction").addEventListener("click", () => loadWorkspace().catch(() => notice(element("#pageNotice"), "工单状态读取失败，请刷新重试。", "error")));
  element("#productSelector").addEventListener("change", async (event) => { product = project.products.find((item) => item.id === event.currentTarget.value); selectedOrderId = null; await loadWorkspace(); });
  if (!projectId) { notice(element("#pageNotice"), "缺少项目上下文，请从项目页面重新进入。", "error"); return; }
  try { runtime = await request("/api/runtime"); if (!runtime.productionOrdersEnabled) { notice(element("#pageNotice"), "生成与交付功能尚未开放。", "blocked"); return; } project = (await request(`/api/projects/${encodeURIComponent(projectId)}`)).project; product = project.products.find((item) => item.id === requestedProductId) || project.products[0]; if (!product) return location.replace(`/project.html?id=${encodeURIComponent(project.id)}`); await loadWorkspace(); }
  catch (_error) { notice(element("#pageNotice"), "生成与交付工作区加载失败，请刷新重试。", "error"); }
})();
