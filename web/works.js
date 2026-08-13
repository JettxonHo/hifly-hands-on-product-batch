(async () => {
  const el = (selector) => document.querySelector(selector);
  let runtime = null, works = [], selected = null, busy = false;
  const statusLabels = { pending_review: "待检查", deliverable: "可交付", rework_required: "需要返工", delivered: "已交付" };
  const inspectionLabels = { pending: "待检查", passed: "已通过", rework_required: "需要返工", superseded: "已替代" };
  const categoryLabels = { content_not_as_planned: "内容与方案不一致", visual_quality: "画面质量", audio_or_avatar: "声音或人物", file_or_format: "文件或格式", other: "其他" };
  const stageLabels = { video_plan: "视频方案", copy_review: "文案审核", avatar_selection: "人物选择", project_content: "商品资料" };
  const upstreamPaths = { video_plan: "/plan.html", copy_review: "/copy.html", avatar_selection: "/avatar.html", project_content: "/project.html" };
  const deliveryLabels = { manual_transfer: "人工转交", email: "邮件", enterprise_drive: "企业云盘", other: "其他" };
  const deliveryFilter = el("#deliveryFilter"), projectFilter = el("#projectFilter");

  async function request(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = new Headers(options.headers || {});
    if (method !== "GET") {
      headers.set("x-identity-csrf", csrf());
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      if (options.body == null) options.body = "{}";
    }
    const response = await fetch(url, { ...options, method, headers, credentials: "same-origin" });
    if (response.status === 401) { location.replace("/login.html"); throw Object.assign(new Error("AUTH_REQUIRED"), { status: 401 }); }
    let body = null;
    try { body = await response.json(); } catch { body = {}; }
    if (!response.ok) throw Object.assign(new Error(body.error || "WORKS_REQUEST_FAILED"), { status: response.status, body });
    return body;
  }

  function csrf() {
    const part = document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith("hifly_identity_csrf="));
    return part ? decodeURIComponent(part.split("=").slice(1).join("=")) : "";
  }

  function notice(target, message = "", tone = "") {
    if (!target) return;
    target.className = `notice${tone ? ` ${tone}` : ""}`;
    target.textContent = message;
  }

  function stateClass(value) {
    return value === "pending" || value === "pending_review" ? "pending" :
      value === "passed" || value === "deliverable" || value === "delivered" ? "passed" :
        value === "rework_required" ? "rework_required" : value === "superseded" ? "superseded" : "";
  }

  function state(target, value, labels = statusLabels) {
    target.textContent = labels[value] || "状态待确认";
    target.className = `state ${stateClass(value)}`;
  }

  function formatTime(value) {
    return value ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "时间待确认";
  }

  function formatBytes(value) {
    const size = Number(value);
    if (!Number.isFinite(size) || size < 1) return "大小待确认";
    if (size >= 1024 * 1024) return `${Math.round(size / 1024 / 1024)} MB`;
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  function currentInspection() { return selected?.current_inspection || null; }

  function upstreamHref(inspection) {
    if (inspection?.status !== "rework_required" || !selected?.project_id || !selected?.product_id) return "";
    const project = encodeURIComponent(selected.project_id), product = encodeURIComponent(selected.product_id);
    const path = upstreamPaths[inspection.target_upstream_stage];
    if (!path) return "";
    return path === "/project.html" ? `/project.html?id=${project}` : `${path}?project=${project}&product=${product}`;
  }

  function filteredWorks() {
    return works.filter((work) => (projectFilter.value === "all" || work.project_id === projectFilter.value) &&
      (deliveryFilter.value === "all" || work.delivery_status === deliveryFilter.value));
  }

  function refreshProjectOptions() {
    const current = projectFilter.value;
    const projects = new Map();
    for (const work of works) if (work.project_id) projects.set(work.project_id, work.project_name || "项目");
    projectFilter.replaceChildren(new Option("全部项目", "all"), ...[...projects.entries()].map(([id, name]) => new Option(name, id)));
    projectFilter.value = projects.has(current) || current === "all" ? current : "all";
  }

  function workTitle(work) { return work.product_name || "已登记作品"; }

  function listButton(work) {
    const button = document.createElement("button");
    button.type = "button"; button.className = "work-list-item"; button.dataset.workId = work.id; button.setAttribute("aria-current", String(work.id === selected?.id));
    const copy = document.createElement("span"); copy.className = "work-list-copy";
    const title = document.createElement("strong"); title.textContent = workTitle(work);
    const meta = document.createElement("small"); meta.textContent = work.project_name || "来源项目已固定";
    copy.append(title, meta);
    const badge = document.createElement("span"); state(badge, work.delivery_status);
    button.append(copy, badge); button.addEventListener("click", () => selectWork(work.id));
    return button;
  }

  function renderList() {
    const values = filteredWorks();
    const stateNode = el("#worksListState");
    stateNode.className = "inline-state";
    stateNode.textContent = values.length ? `${values.length} 个作品` : works.length ? "没有符合筛选条件的作品" : "还没有已登记作品";
    el("#worksList").replaceChildren(...values.map(listButton));
    el("#mobileWorksList").replaceChildren(...values.map(listButton));
  }

  function sourceItem(label, value) {
    const item = document.createElement("div"); item.className = "snapshot-item";
    const title = document.createElement("dt"); title.textContent = label;
    const content = document.createElement("dd"); content.textContent = value || "已固定";
    item.append(title, content); return item;
  }

  function renderSource() {
    const grid = el("#sourceSnapshotGrid");
    if (!selected) { grid.replaceChildren(); return; }
    grid.replaceChildren(
      sourceItem("项目", selected.project_name || "来源项目已固定"),
      sourceItem("商品", selected.product_name || "商品信息已固定"),
      sourceItem("视频方案", "登记时已固定"),
      sourceItem("人物与声音", "登记时已固定"),
      sourceItem("文件类型", selected.primary_output_media_type || "视频"),
      sourceItem("文件大小", formatBytes(selected.primary_output_size))
    );
  }

  function renderHistory() {
    const history = selected?.inspection_history || [];
    const historyList = el("#inspectionHistoryList");
    if (!history.length) historyList.replaceChildren(Object.assign(document.createElement("p"), { className: "muted", textContent: "暂无检查记录" }));
    else historyList.replaceChildren(...history.slice().reverse().map((item) => {
      const row = document.createElement("div"); row.className = "history-row";
      const copy = document.createElement("div"); const title = document.createElement("strong"); title.textContent = inspectionLabels[item.status] || "状态待确认"; copy.append(title);
      const detail = document.createElement("p");
      detail.textContent = item.status === "rework_required" ? `${categoryLabels[item.category] || "返工"} · ${item.reason || "原因待补充"} · 返回${stageLabels[item.target_upstream_stage] || "上游阶段"}` : item.status === "passed" ? "检查人已确认作品可交付。" : item.status === "superseded" ? "该记录已被新的检查结果替代。" : "等待检查人处理。";
      copy.append(detail);
      const time = document.createElement("time"); time.textContent = formatTime(item.inspected_at || item.created_at); row.append(copy, time); return row;
    }));
    const deliveries = selected?.deliveries || [];
    el("#deliveryCount").textContent = deliveries.length ? `共 ${deliveries.length} 次` : "尚无记录";
    const deliveryList = el("#deliveryHistoryList");
    if (!deliveries.length) deliveryList.replaceChildren(Object.assign(document.createElement("p"), { className: "muted", textContent: "尚未登记交付；下载作品不代表已经交付。" }));
    else deliveryList.replaceChildren(...deliveries.slice().reverse().map((item) => {
      const row = document.createElement("div"); row.className = "history-row";
      const copy = document.createElement("div"); const title = document.createElement("strong"); title.textContent = deliveryLabels[item.delivery_method] || "已交付"; copy.append(title);
      const detail = document.createElement("p"); detail.textContent = [item.recipient_reference, item.note].filter(Boolean).join(" · ") || "已记录本次真实交付"; copy.append(detail);
      const time = document.createElement("time"); time.textContent = formatTime(item.delivered_at); row.append(copy, time); return row;
    }));
  }

  function actionExplanation() {
    if (!selected) return "选择作品后，这里会显示下一步。";
    const inspection = currentInspection();
    if (inspection?.status === "rework_required") return `当前作品需要返工：新的上游生产周期和新工单会产生新的作品，原作品与检查历史会保留。请由${stageLabels[inspection.target_upstream_stage] || "上游负责人"}处理“${inspection.reason || "检查提出的问题"}”。`;
    if (selected.delivery_status === "delivered") return `已登记 ${selected.delivery_count} 次交付。再次交付需要新的明确登记，由交付负责人处理。`;
    if (inspection?.status === "pending") return "检查尚未完成。请由内容审核人先确认作品，下一步可标记为通过或登记返工。";
    if (inspection?.status === "passed") return "作品已通过检查，可以登记一次真实交付；交付记录会保留在历史中。";
    return "请先完成检查，再进行交付登记。";
  }

  function renderActions() {
    const inspection = currentInspection(), ready = Boolean(selected && inspection?.status === "passed");
    state(el("#actionState"), selected ? (selected.delivery_status === "delivered" ? "delivered" : inspection?.status) : "", selected ? (selected.delivery_status === "delivered" ? statusLabels : inspectionLabels) : statusLabels);
    el("#actionExplanation").textContent = actionExplanation();
    const pass = el("#passInspection"), rework = el("#requestRework"), delivery = el("#recordDelivery"), blocked = el("#deliveryBlockedReason");
    const reworkBlocked = inspection?.status === "rework_required";
    pass.disabled = !selected || busy || reworkBlocked; pass.textContent = reworkBlocked ? "无法再次通过检查" : "标记为通过";
    rework.disabled = !selected || busy || reworkBlocked;
    delivery.disabled = !ready || busy;
    blocked.textContent = ready ? "" : selected ? reworkBlocked ? "当前作品需要返工；请按提示创建新的上游生产周期和新工单。" : "交付登记需先通过检查；由内容审核人处理检查状态。" : "选择作品后可查看交付条件。";
    const upstream = el("#upstreamActionLink"), href = upstreamHref(inspection);
    if (href) { upstream.href = href; upstream.textContent = `返回${stageLabels[inspection.target_upstream_stage] || "上游阶段"} →`; upstream.hidden = false; }
    else { upstream.hidden = true; upstream.removeAttribute("href"); }
    const mobile = el("#mobilePrimaryAction"); mobile.disabled = busy;
    if (!selected) { mobile.textContent = "选择作品"; mobile.disabled = false; }
    else if (ready) mobile.textContent = "登记一次交付";
    else if (reworkBlocked) mobile.textContent = "选择其他作品";
    else mobile.textContent = pass.textContent;
  }

  function renderDetail() {
    const empty = el("#workDetailEmpty"), detail = el("#workDetail");
    empty.hidden = Boolean(selected); detail.hidden = !selected;
    if (!selected) { renderActions(); return; }
    el("#selectedWorkName").textContent = workTitle(selected);
    state(el("#selectedDeliveryStatus"), selected.delivery_status);
    renderSource(); renderHistory(); renderActions();
  }

  function render() { renderList(); renderDetail(); }

  async function loadWorks({ preserveSelection = true } = {}) {
    const stateNode = el("#worksListState"); stateNode.className = "inline-state"; stateNode.textContent = "正在加载作品…";
    try {
      const body = await request("/api/works"); works = body.works || [];
      refreshProjectOptions();
      const requested = new URLSearchParams(location.search).get("work");
      const wanted = preserveSelection ? selected?.id || requested : requested;
      selected = works.find((work) => work.id === wanted) || works[0] || null;
      render();
    } catch (error) {
      stateNode.className = "inline-state error"; stateNode.textContent = error.status === 403 ? "你没有权限查看作品库。" : "作品列表读取失败，请刷新重试。";
      notice(el("#worksNotice"), error.status === 403 ? "当前账号没有作品库权限，请联系组织管理员。" : "作品列表暂时无法读取（技术原因），请稍后刷新。", error.status === 403 ? "blocked" : "error");
    }
  }

  function selectWork(id) {
    selected = works.find((work) => work.id === id) || null;
    if (selected) { const next = new URL(location.href); next.searchParams.set("work", selected.id); history.replaceState(null, "", next); }
    render();
    if (el("#workDrawer").open) el("#workDrawer").close();
  }

  function operationError(error, action) {
    if (error.status === 403) return { text: `当前账号没有${action}权限，请联系组织管理员。`, tone: "blocked" };
    if (error.status === 409) return { text: "作品状态已被更新，请刷新后使用最新检查记录重试。", tone: "blocked" };
    if (error.status === 422 && error.body?.error === "WORK_DELIVERY_REWORK_BLOCKED") return { text: "当前作品已登记返工：需要新的上游生产周期和新工单，原作品与检查历史会保留。", tone: "blocked" };
    if (error.status === 422) return { text: "当前条件不满足，先完成检查或处理返工提示后再继续。", tone: "blocked" };
    if (error.status === 400) return { text: "请补齐必填信息后重试。", tone: "error" };
    return { text: `${action}未完成（技术原因），你的操作未生效；可以稍后重试。`, tone: "error" };
  }

  async function runCommand(action, fn) {
    if (busy) return;
    busy = true; renderActions();
    try { await fn(); await loadWorks(); notice(el("#actionNotice"), `${action}已完成。`, "success"); }
    catch (error) { const result = operationError(error, action); notice(el("#actionNotice"), result.text, result.tone); }
    finally { busy = false; renderActions(); }
  }

  function openPassDialog() {
    if (!selected || busy || currentInspection()?.status === "rework_required") return;
    el("#passWorkSummary").textContent = `作品：${workTitle(selected)} · 项目：${selected.project_name || "来源项目已固定"}`;
    el("#passDialog").showModal();
  }

  async function submitPass(event) {
    event.preventDefault();
    if (!selected || currentInspection()?.status === "rework_required") return;
    const inspection = currentInspection();
    el("#passDialog").close();
    await runCommand("检查", () => request(`/api/works/${encodeURIComponent(selected.id)}/inspections/pass`, { method: "POST", body: JSON.stringify({ idempotency_key: crypto.randomUUID(), expected_inspection_id: inspection?.id, expected_revision: inspection?.revision }) }));
  }

  async function submitRework(event) {
    event.preventDefault();
    if (!selected) return;
    const category = el("#reworkCategory").value, reason = el("#reworkReason").value.trim(), target = el("#reworkTarget").value;
    if (!category || !reason || !target) { el("#reworkError").textContent = "请填写返工分类、原因和返回阶段。"; return; }
    const inspection = currentInspection(); busy = true; el("#submitRework").disabled = true;
    try { await request(`/api/works/${encodeURIComponent(selected.id)}/inspections/rework`, { method: "POST", body: JSON.stringify({ idempotency_key: crypto.randomUUID(), category, reason, target_upstream_stage: target, expected_inspection_id: inspection?.id, expected_revision: inspection?.revision }) }); el("#reworkDialog").close(); await loadWorks(); notice(el("#actionNotice"), "返工已登记，原作品与检查历史仍会保留。", "success"); }
    catch (error) { el("#reworkError").textContent = operationError(error, "返工登记").text; }
    finally { busy = false; el("#submitRework").disabled = false; renderActions(); }
  }

  async function submitDelivery(event) {
    event.preventDefault();
    if (!selected) return;
    const method = el("#deliveryMethod").value, recipient = el("#deliveryRecipient").value.trim(), noteText = el("#deliveryNote").value.trim();
    const deliveredAt = new Date(el("#deliveryTime").value);
    const deliveredAtIso = Number.isNaN(deliveredAt.valueOf()) ? null : deliveredAt.toISOString();
    busy = true; el("#submitDelivery").disabled = true;
    const inspection = currentInspection();
    const payload = { idempotency_key: crypto.randomUUID(), delivery_method: method, recipient_reference: recipient || null, note: noteText || null, expected_inspection_id: inspection?.id, expected_revision: inspection?.revision };
    if (deliveredAtIso) payload.delivered_at = deliveredAtIso;
    try { await request(`/api/works/${encodeURIComponent(selected.id)}/deliveries`, { method: "POST", body: JSON.stringify(payload) }); el("#deliveryDialog").close(); await loadWorks(); notice(el("#actionNotice"), "交付已登记；这次记录已保留。", "success"); }
    catch (error) { el("#deliveryError").textContent = operationError(error, "交付登记").text; }
    finally { busy = false; el("#submitDelivery").disabled = false; renderActions(); }
  }

  async function preview() {
    if (!selected || busy) return;
    busy = true; el("#previewWork").disabled = true; notice(el("#previewNotice"), "正在准备预览…");
    try {
      const result = await request(`/api/works/${encodeURIComponent(selected.id)}/download-authorizations`, { method: "POST" });
      const url = result.download?.url;
      if (!url) throw Object.assign(new Error("WORK_DELIVERY_DOWNLOAD_UNAVAILABLE"), { status: 422 });
      const video = el("#workVideo"); video.src = url; video.hidden = false; el("#downloadWork").href = url; el("#downloadWork").hidden = false; el(".preview-placeholder").hidden = true;
      notice(el("#previewNotice"), "预览已准备；下载作品不会自动登记交付。", "success");
    } catch (error) { notice(el("#previewNotice"), error.status === 403 ? "当前账号没有下载权限。" : "作品暂时无法预览（技术原因），可以稍后重试或联系处理人。", error.status === 403 ? "blocked" : "error"); }
    finally { busy = false; el("#previewWork").disabled = false; renderActions(); }
  }

  function resetDialog(form, error) { form.reset(); error.textContent = ""; }
  function localDateTimeValue() { const now = new Date(), local = new Date(now.getTime() - now.getTimezoneOffset() * 60000); return local.toISOString().slice(0, 16); }
  function openDeliveryDialog() { resetDialog(el("#deliveryForm"), el("#deliveryError")); el("#deliveryTime").value = localDateTimeValue(); el("#deliveryDialog").showModal(); }

  el("#refreshWorks").addEventListener("click", () => loadWorks({ preserveSelection: true }));
  projectFilter.addEventListener("change", renderList); deliveryFilter.addEventListener("change", renderList);
  el("#openWorkDrawer").addEventListener("click", () => el("#workDrawer").showModal()); el("#closeWorkDrawer").addEventListener("click", () => el("#workDrawer").close());
  el("#passInspection").addEventListener("click", openPassDialog); el("#passForm").addEventListener("submit", submitPass); el("#cancelPass").addEventListener("click", () => el("#passDialog").close()); el("#closePass").addEventListener("click", () => el("#passDialog").close());
  el("#requestRework").addEventListener("click", () => { resetDialog(el("#reworkForm"), el("#reworkError")); el("#reworkDialog").showModal(); });
  el("#cancelRework").addEventListener("click", () => el("#reworkDialog").close()); el("#closeRework").addEventListener("click", () => el("#reworkDialog").close()); el("#reworkForm").addEventListener("submit", submitRework);
  el("#recordDelivery").addEventListener("click", openDeliveryDialog);
  el("#cancelDelivery").addEventListener("click", () => el("#deliveryDialog").close()); el("#closeDelivery").addEventListener("click", () => el("#deliveryDialog").close()); el("#deliveryForm").addEventListener("submit", submitDelivery);
  el("#previewWork").addEventListener("click", preview);
  el("#workVideo").addEventListener("error", () => notice(el("#previewNotice"), "预览暂不可用（技术原因），可以下载文件后查看。", "blocked"));
  el("#mobilePrimaryAction").addEventListener("click", () => { if (!selected) return el("#openWorkDrawer").click(); const status = currentInspection()?.status; if (status === "rework_required") return el("#workDrawer").showModal(); if (status === "passed") return el("#recordDelivery").click(); return openPassDialog(); });

  try {
    runtime = await request("/api/runtime");
    if (runtime.worksEnabled !== true) { el("#worksUnavailable").hidden = false; el("#worksUnavailableMessage").textContent = "作品库功能尚未开放；管理员开启后，这里会显示本组织已登记的作品。"; return; }
    el("#worksApp").hidden = false;
    await loadWorks({ preserveSelection: false });
  } catch (error) {
    if (error.status === 403) { el("#worksUnavailable").hidden = false; el("#worksUnavailableMessage").textContent = "当前账号没有作品库权限，请联系组织管理员。"; }
    else if (error.status !== 401) { el("#worksUnavailable").hidden = false; el("#worksUnavailableMessage").textContent = "作品库暂时无法读取（技术原因），请刷新重试。"; }
  }
})();
