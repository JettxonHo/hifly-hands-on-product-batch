(async () => {
  const el = (selector) => document.querySelector(selector);
  const PAGE_SIZE = 6;
  const DELIVERY_STATUSES = new Set(["all", "pending_review", "deliverable", "rework_required", "delivered"]);
  const WORK_STATUSES = new Set(["available", "unavailable", "withdrawn"]);
  const INSPECTION_STATUSES = new Set(["pending", "passed", "rework_required", "superseded"]);
  const statusLabels = { pending_review: "待检查", deliverable: "可交付", rework_required: "需要返工", delivered: "已交付" };
  const inspectionLabels = { pending: "待检查", passed: "已通过", rework_required: "需要返工", superseded: "已替代" };
  const categoryLabels = { content_not_as_planned: "内容与方案不一致", visual_quality: "画面质量", audio_or_avatar: "声音或人物", file_or_format: "文件或格式", other: "其他" };
  const stageLabels = { video_plan: "视频方案", copy_review: "文案审核", avatar_selection: "人物选择", project_content: "商品资料" };
  const upstreamPaths = { video_plan: "/plan.html", copy_review: "/copy.html", avatar_selection: "/avatar.html", project_content: "/project.html" };
  const deliveryLabels = { manual_transfer: "人工转交", email: "邮件", enterprise_drive: "企业云盘", other: "其他" };

  let runtime = null;
  let works = [];
  let selected = null;
  let pagination = { page: 1, page_size: PAGE_SIZE, total_items: 0, total_pages: 0 };
  let busy = false;
  let previewBusy = false;
  let loading = false;
  let authorityFailed = false;
  let listEpoch = 0;
  let previewEpoch = 0;
  let mobileDetailOpen = false;
  let mobileReturnWorkId = null;
  let mobileReturnScroll = 0;
  let listMessage = "正在加载作品…";
  let listMessageTone = "";
  let lastLoadError = "";
  const dialogTriggers = new WeakMap();
  const intents = { pass: null, rework: null, delivery: null };

  async function request(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = new Headers(options.headers || {});
    if (method !== "GET") {
      headers.set("x-identity-csrf", csrf());
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      if (options.body == null) options.body = "{}";
    }
    let response;
    try { response = await fetch(url, { ...options, method, headers, credentials: "same-origin" }); }
    catch (cause) { throw Object.assign(new Error("WORKS_NETWORK_FAILED"), { status: 0, cause }); }
    if (response.status === 401) {
      location.replace("/login.html");
      throw Object.assign(new Error("AUTH_REQUIRED"), { status: 401 });
    }
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
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.valueOf())
      ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date)
      : "时间待确认";
  }

  function formatBytes(value) {
    const size = Number(value);
    if (!Number.isFinite(size) || size < 1) return "大小待确认";
    if (size >= 1024 * 1024) return `${Math.round(size / 1024 / 1024)} MB`;
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }

  function clean(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }
  function positiveInteger(value) {
    if (!/^\d+$/.test(String(value || ""))) return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  function usesSequentialLayout() { return window.matchMedia("(max-width: 820px)").matches; }
  function currentInspection() { return selected?.current_inspection || null; }
  function workTitle(work) { return work?.product_name || "已登记作品"; }
  function reducedMotion() { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }

  function locationState() {
    const query = new URLSearchParams(location.search);
    const status = DELIVERY_STATUSES.has(query.get("deliveryStatus")) ? query.get("deliveryStatus") : "all";
    const canonicalPage = positiveInteger(query.get("page"));
    const legacyPage = canonicalPage ? null : positiveInteger(query.get("workPage"));
    return {
      page: canonicalPage || legacyPage || 1,
      explicitPage: Boolean(canonicalPage || legacyPage),
      status,
      workId: clean(query.get("work")),
      usedLegacyPage: Boolean(legacyPage)
    };
  }

  function updateUrl(mutator, { replace = false } = {}) {
    const next = new URL(location.href);
    mutator(next.searchParams);
    next.searchParams.delete("workPage");
    history[replace ? "replaceState" : "pushState"]({ works: true }, "", next);
  }

  function setRecommended(control = null) {
    document.querySelectorAll('#mainContent [data-recommended-action="true"]').forEach((node) => node.removeAttribute("data-recommended-action"));
    if (control && !control.disabled && !control.hidden) control.setAttribute("data-recommended-action", "true");
  }

  function assertPublicWork(work) {
    if (!work || !clean(work.id) || !WORK_STATUSES.has(work.status) || !DELIVERY_STATUSES.has(work.delivery_status) ||
      !Array.isArray(work.inspection_history) || !Array.isArray(work.deliveries)) throw new Error("WORKS_PROJECTION_INVALID");
    if (work.current_inspection) {
      if (!clean(work.current_inspection.id) || !INSPECTION_STATUSES.has(work.current_inspection.status) ||
        !Number.isInteger(Number(work.current_inspection.revision)) || Number(work.current_inspection.revision) < 1) {
        throw new Error("WORKS_PROJECTION_INVALID");
      }
    }
    for (const item of work.inspection_history) {
      if (!clean(item?.id) || !INSPECTION_STATUSES.has(item.status) || !Number.isInteger(Number(item.revision))) throw new Error("WORKS_PROJECTION_INVALID");
    }
    for (const item of work.deliveries) if (!clean(item?.id) || !clean(item.delivery_method)) throw new Error("WORKS_PROJECTION_INVALID");
  }

  function assertPage(body, requestedWorkId) {
    if (!body || !Array.isArray(body.works) || body.works.length > PAGE_SIZE || !body.pagination) throw new Error("WORKS_PROJECTION_INVALID");
    const next = body.pagination;
    if (!Number.isInteger(next.page) || next.page < 1 || next.page_size !== PAGE_SIZE || !Number.isInteger(next.total_items) ||
      next.total_items < 0 || !Number.isInteger(next.total_pages) || next.total_pages < 0) throw new Error("WORKS_PROJECTION_INVALID");
    const ids = new Set();
    for (const work of body.works) { assertPublicWork(work); if (ids.has(work.id)) throw new Error("WORKS_PROJECTION_INVALID"); ids.add(work.id); }
    if (body.selected_work_id != null && (!requestedWorkId || !ids.has(body.selected_work_id) || body.selected_work_id !== requestedWorkId)) {
      throw new Error("WORKS_PROJECTION_INVALID");
    }
  }

  function resetPreview() {
    previewEpoch += 1;
    previewBusy = false;
    el("#previewWork").disabled = false;
    const video = el("#workVideo");
    video.pause();
    video.removeAttribute("src");
    delete video.dataset.workId;
    video.load();
    video.hidden = true;
    el(".preview-placeholder").hidden = false;
    const download = el("#downloadWork");
    download.hidden = true;
    download.removeAttribute("href");
    download.removeAttribute("download");
    el("#downloadBoundary").hidden = true;
    el("#downloadMetadata").hidden = true;
    for (const selector of ["#downloadFileName", "#downloadMediaType", "#downloadSize", "#downloadChecksum"]) el(selector).textContent = "";
    notice(el("#previewNotice"));
  }

  function clearAuthority() {
    works = [];
    selected = null;
    mobileDetailOpen = false;
    resetPreview();
  }

  function renderMobileLayer() {
    el("#worksApp").classList.toggle("mobile-detail-open", Boolean(selected && mobileDetailOpen));
  }

  function taskSummary({ loadError = "" } = {}) {
    const title = el("#worksTaskTitle"), description = el("#worksTaskDescription"), object = el("#worksTaskObject");
    const status = el("#worksTaskStatus"), next = el("#worksTaskNext"), blocker = el("#worksTaskBlocker");
    blocker.hidden = true;
    blocker.textContent = "";
    if (loadError) {
      title.textContent = "作品库读取失败";
      description.textContent = "当前页面没有使用先前作品状态";
      object.textContent = "作品库";
      status.textContent = "读取失败";
      next.textContent = "刷新作品库";
      blocker.textContent = loadError;
      blocker.hidden = false;
      setRecommended(el("#refreshWorks"));
      return;
    }
    if (!selected) {
      title.textContent = pagination.total_items ? "选择要处理的作品" : "等待作品登记";
      description.textContent = pagination.total_items ? "从作品列表进入检查与交付" : "完成生产与文件核验后，作品会出现在这里";
      object.textContent = "作品库";
      status.textContent = pagination.total_items ? "待选择" : "暂无作品";
      next.textContent = pagination.total_items ? "选择作品" : "等待作品登记";
      setRecommended(null);
      return;
    }
    const inspection = currentInspection();
    title.textContent = workTitle(selected);
    description.textContent = "来源与生成快照已固定";
    object.textContent = workTitle(selected);
    status.textContent = statusLabels[selected.delivery_status] || "状态待确认";
    if (usesSequentialLayout() && !mobileDetailOpen) {
      next.textContent = "查看作品详情";
      if (selected.delivery_status === "rework_required" || inspection?.status === "rework_required") {
        blocker.textContent = inspection?.reason || "当前作品需要返回上游处理";
        blocker.hidden = false;
      }
      setRecommended(el("#mobilePrimaryAction"));
      return;
    }
    if (selected.status !== "available") {
      next.textContent = "联系管理员核对作品状态";
      blocker.textContent = "当前作品已不可操作。";
      blocker.hidden = false;
      setRecommended(null);
    } else if (selected.delivery_status === "rework_required" || inspection?.status === "rework_required") {
      next.textContent = "处理返工要求";
      blocker.textContent = inspection?.reason || "当前作品需要返回上游处理";
      blocker.hidden = false;
      setRecommended(el("#upstreamActionLink").hidden ? null : el("#upstreamActionLink"));
    } else if (selected.delivery_status === "delivered") {
      next.textContent = "查看交付记录";
      setRecommended(el("#viewDeliveryHistory"));
    } else if (inspection?.status === "passed") {
      next.textContent = "登记真实交付";
      setRecommended(el("#recordDelivery"));
    } else {
      next.textContent = "完成作品检查";
      setRecommended(el("#passInspection"));
    }
  }

  function upstreamHref(inspection) {
    if (inspection?.status !== "rework_required" || !selected?.project_id || !selected?.product_id) return "";
    const path = upstreamPaths[inspection.target_upstream_stage];
    if (!path) return "";
    const project = encodeURIComponent(selected.project_id), product = encodeURIComponent(selected.product_id);
    return path === "/project.html" ? `/project.html?id=${project}` : `${path}?project=${project}&product=${product}`;
  }

  function listButton(work) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "work-list-item";
    button.dataset.workId = work.id;
    button.setAttribute("aria-current", String(work.id === selected?.id));
    const copy = document.createElement("span");
    copy.className = "work-list-copy";
    const title = document.createElement("strong");
    title.textContent = workTitle(work);
    const meta = document.createElement("small");
    meta.textContent = `登记于 ${formatTime(work.created_at)}`;
    copy.append(title, meta);
    const badge = document.createElement("span");
    state(badge, work.delivery_status);
    button.append(copy, badge);
    button.addEventListener("click", () => selectWork(work.id));
    return button;
  }

  function renderPagination() {
    const nav = el("#worksPagination");
    const total = pagination.total_items;
    nav.hidden = total === 0;
    if (!total) return;
    const first = (pagination.page - 1) * PAGE_SIZE + 1;
    const last = Math.min(pagination.page * PAGE_SIZE, total);
    el("#worksPaginationSummary").textContent = `第 ${first}–${last} 项，共 ${total} 项`;
    el("#previousWorksPage").disabled = loading || pagination.page <= 1;
    el("#nextWorksPage").disabled = loading || pagination.page >= pagination.total_pages;
    const pageSet = new Set([1, pagination.total_pages, pagination.page]);
    if (pagination.page === 1 && pagination.total_pages > 1) pageSet.add(2);
    if (pagination.page === pagination.total_pages && pagination.total_pages > 1) pageSet.add(pagination.total_pages - 1);
    const pages = pagination.total_pages <= 4
      ? Array.from({ length: pagination.total_pages }, (_value, index) => index + 1)
      : [...pageSet].filter((page) => page >= 1 && page <= pagination.total_pages).sort((left, right) => left - right);
    const buttons = [];
    let previousPage = null;
    for (const page of pages) {
      if (previousPage != null && page - previousPage > 1) {
        const ellipsis = document.createElement("span");
        ellipsis.className = "pagination-ellipsis";
        ellipsis.textContent = "…";
        ellipsis.setAttribute("aria-hidden", "true");
        buttons.push(ellipsis);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.textContent = String(page);
      button.dataset.page = String(page);
      button.setAttribute("aria-label", `第 ${page} 页`);
      if (page === pagination.page) button.setAttribute("aria-current", "page");
      button.disabled = loading;
      button.addEventListener("click", () => goToPage(page));
      buttons.push(button);
      previousPage = page;
    }
    el("#worksPageNumbers").replaceChildren(...buttons);
  }

  function renderList() {
    const stateNode = el("#worksListState");
    stateNode.className = `inline-state${listMessageTone ? ` ${listMessageTone}` : ""}`;
    stateNode.textContent = listMessage;
    el("#worksList").replaceChildren(...works.map(listButton));
    renderPagination();
  }

  function sourceItem(label, value) {
    const item = document.createElement("div");
    item.className = "snapshot-item";
    const title = document.createElement("dt");
    title.textContent = label;
    const content = document.createElement("dd");
    content.textContent = value || "已固定";
    item.append(title, content);
    return item;
  }

  function renderSource() {
    const grid = el("#sourceSnapshotGrid");
    if (!selected) { grid.replaceChildren(); return; }
    grid.replaceChildren(
      sourceItem("商品", selected.product_name || "商品信息已固定"),
      sourceItem("来源项目", "登记时已固定"),
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
      const copy = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = inspectionLabels[item.status] || "状态待确认"; copy.append(title);
      const detail = document.createElement("p");
      detail.textContent = item.status === "rework_required"
        ? `${categoryLabels[item.category] || "返工"} · ${item.reason || "原因待补充"} · 返回${stageLabels[item.target_upstream_stage] || "上游阶段"}`
        : item.status === "passed" ? "检查人已确认作品可交付。"
          : item.status === "superseded" ? "该记录已被新的检查结果替代。" : "等待检查人处理。";
      copy.append(detail);
      const time = document.createElement("time"); time.textContent = formatTime(item.inspected_at || item.created_at);
      row.append(copy, time); return row;
    }));
    const deliveries = selected?.deliveries || [];
    el("#deliveryCount").textContent = deliveries.length ? `共 ${deliveries.length} 次` : "尚无记录";
    const deliveryList = el("#deliveryHistoryList");
    if (!deliveries.length) deliveryList.replaceChildren(Object.assign(document.createElement("p"), { className: "muted", textContent: "尚未登记交付；下载作品不代表已经交付。" }));
    else deliveryList.replaceChildren(...deliveries.slice().reverse().map((item) => {
      const row = document.createElement("div"); row.className = "history-row";
      const copy = document.createElement("div");
      const title = document.createElement("strong"); title.textContent = deliveryLabels[item.delivery_method] || "已交付"; copy.append(title);
      const detail = document.createElement("p"); detail.textContent = [item.recipient_reference, item.note].filter(Boolean).join(" · ") || "已记录本次真实交付"; copy.append(detail);
      const time = document.createElement("time"); time.textContent = formatTime(item.delivered_at);
      row.append(copy, time); return row;
    }));
  }

  function actionExplanation() {
    if (!selected) return "选择作品后，这里会显示下一步。";
    if (selected.status !== "available") return "当前作品已不可操作，请联系管理员核对。";
    const inspection = currentInspection();
    if (selected.delivery_status === "rework_required" || inspection?.status === "rework_required") {
      return `当前作品需要返工：新的上游生产周期和新工单会产生新的作品，原作品与检查、交付历史会保留。请由${stageLabels[inspection?.target_upstream_stage] || "上游负责人"}处理“${inspection?.reason || "检查提出的问题"}”。`;
    }
    if (selected.delivery_status === "delivered") return `已登记 ${selected.delivery_count} 次交付。下载作品不等于新增交付记录。`;
    if (inspection?.status === "passed") return "作品已通过检查，可以登记一次真实交付；交付记录会保留在历史中。";
    return "检查尚未完成。可以确认通过，或登记返工并返回明确的上游阶段。";
  }

  function renderActions() {
    const inspection = currentInspection();
    const available = selected?.status === "available";
    const rework = selected?.delivery_status === "rework_required" || inspection?.status === "rework_required";
    const delivered = selected?.delivery_status === "delivered" && !rework;
    const ready = available && !rework && inspection?.status === "passed";
    const disabled = loading || busy || authorityFailed || !selected || !available;
    state(el("#actionState"), selected ? (rework ? "rework_required" : delivered ? "delivered" : inspection?.status) : "", selected && !delivered ? inspectionLabels : statusLabels);
    el("#actionExplanation").textContent = actionExplanation();
    const pass = el("#passInspection"), requestRework = el("#requestRework"), delivery = el("#recordDelivery");
    el("#inspectionActionGroup").hidden = false;
    el("#terminalActionGroup").hidden = !delivered;
    pass.hidden = delivered;
    pass.disabled = disabled || rework || ready || delivered;
    pass.textContent = rework ? "无法再次通过检查" : ready ? "检查已通过" : "标记为通过";
    requestRework.disabled = disabled || rework;
    delivery.disabled = disabled || rework || (!ready && !delivered);
    delivery.textContent = delivered ? "新增一次交付" : "登记一次交付";
    delivery.classList.toggle("secondary", delivered);
    el("#deliveryBlockedReason").textContent = ready || delivered ? "" : selected
      ? rework ? "当前作品需要返工；请按提示进入新的上游生产周期。" : "交付登记需先通过检查。"
      : "选择作品后可查看交付条件。";
    const upstream = el("#upstreamActionLink"), href = upstreamHref(inspection);
    if (href && !authorityFailed) {
      upstream.href = href;
      upstream.textContent = `返回${stageLabels[inspection.target_upstream_stage] || "上游阶段"} →`;
      upstream.hidden = false;
    } else { upstream.hidden = true; upstream.removeAttribute("href"); }
    const mobile = el("#mobilePrimaryAction");
    mobile.closest(".works-mobile-action").hidden = !selected;
    mobile.disabled = loading || busy || authorityFailed;
    if (!selected) mobile.textContent = "选择作品";
    else if (!mobileDetailOpen) mobile.textContent = "查看作品详情";
    else if (rework) mobile.textContent = "查看返工要求";
    else if (delivered) mobile.textContent = "查看交付记录";
    else if (ready) mobile.textContent = "登记一次交付";
    else mobile.textContent = "标记为通过";
    taskSummary();
  }

  function renderDetail() {
    el("#workDetailEmpty").hidden = Boolean(selected);
    el("#workDetail").hidden = !selected;
    if (!selected) { renderActions(); renderMobileLayer(); return; }
    el("#selectedWorkName").textContent = workTitle(selected);
    state(el("#selectedDeliveryStatus"), selected.delivery_status);
    renderSource();
    renderHistory();
    renderActions();
    renderMobileLayer();
  }

  function render() { renderList(); renderDetail(); }

  function failRead(error) {
    authorityFailed = true;
    clearAuthority();
    listMessageTone = "error";
    listMessage = error?.status === 403 ? "你没有权限查看作品库。" : "作品列表读取失败，请刷新重试。";
    const message = error?.status === 403 ? "当前账号没有作品库权限，请联系组织管理员。" : "作品列表暂时无法读取（技术原因），请刷新作品库重试。";
    lastLoadError = message;
    notice(el("#worksNotice"), message, error?.status === 403 ? "blocked" : "error");
    render();
    taskSummary({ loadError: message });
  }

  async function loadWorks({ focus = "none", focusPage = null } = {}) {
    const epoch = ++listEpoch;
    const route = locationState();
    loading = true;
    authorityFailed = true;
    clearAuthority();
    listMessage = "正在加载作品…";
    listMessageTone = "";
    render();
    const query = new URLSearchParams({ pageSize: String(PAGE_SIZE), deliveryStatus: route.status });
    if (route.explicitPage) query.set("page", String(route.page));
    if (route.workId) query.set("anchorWorkId", route.workId);
    try {
      const body = await request(`/api/works?${query}`);
      if (epoch !== listEpoch) return false;
      assertPage(body, route.workId);
      works = body.works;
      pagination = body.pagination;
      el("#deliveryFilter").value = route.status;
      selected = body.selected_work_id ? works.find((work) => work.id === body.selected_work_id) || null : null;
      if (!route.workId && !usesSequentialLayout()) selected = works[0] || null;
      mobileDetailOpen = Boolean(usesSequentialLayout() && route.workId && selected);
      authorityFailed = false;
      lastLoadError = "";
      listMessageTone = "";
      listMessage = pagination.total_items ? `${pagination.total_items} 个作品` : "还没有已登记作品";
      notice(el("#worksNotice"), route.workId && !selected ? "指定作品不可查看，未选择其他作品。" : "");
      updateUrl((params) => {
        if (route.status === "all") params.delete("deliveryStatus"); else params.set("deliveryStatus", route.status);
        if (route.explicitPage || pagination.page > 1) params.set("page", String(pagination.page)); else params.delete("page");
        if (route.workId && !selected) params.delete("work");
      }, { replace: true });
      resetPreview();
      render();
      if (focus === "detail" && selected) el("#selectedWorkName").focus();
      if (focus === "list") restoreListFocus();
      return true;
    } catch (error) {
      if (epoch !== listEpoch) return false;
      failRead(error);
      return false;
    } finally {
      if (epoch === listEpoch) {
        loading = false;
        if (!authorityFailed) renderActions();
        renderPagination();
        if (!authorityFailed && focusPage != null) {
          el(`#worksPageNumbers [data-page="${CSS.escape(String(focusPage))}"]`)?.focus();
        }
      }
    }
  }

  async function bootstrap({ focus = "none" } = {}) {
    const refresh = el("#refreshWorks");
    refresh.disabled = true;
    try {
      runtime = await request("/api/runtime");
      if (runtime.worksEnabled !== true) {
        el("#worksApp").hidden = true;
        el("#worksUnavailable").hidden = false;
        el("#worksUnavailableMessage").textContent = "作品库功能尚未开放；管理员开启后，这里会显示本组织已登记的作品。";
        taskSummary({ loadError: "作品库功能尚未开放。" });
        return;
      }
      el("#worksUnavailable").hidden = true;
      el("#worksApp").hidden = false;
      await loadWorks({ focus });
    } catch (error) {
      if (error.status === 401) return;
      el("#worksApp").hidden = true;
      el("#worksUnavailable").hidden = false;
      const message = error.status === 403 ? "当前账号没有作品库权限，请联系组织管理员。" : "作品库暂时无法读取（技术原因），请刷新重试。";
      el("#worksUnavailableMessage").textContent = message;
      taskSummary({ loadError: message });
    } finally {
      refresh.disabled = false;
      if (authorityFailed && lastLoadError) taskSummary({ loadError: lastLoadError });
    }
  }

  function selectWork(id) {
    const next = works.find((work) => work.id === id) || null;
    if (!next || authorityFailed) return;
    mobileReturnWorkId = id;
    mobileReturnScroll = window.scrollY;
    selected = next;
    mobileDetailOpen = usesSequentialLayout();
    updateUrl((params) => {
      params.set("work", id);
      params.set("page", String(pagination.page));
    });
    resetPreview();
    render();
    if (usesSequentialLayout()) el("#selectedWorkName").focus();
    else el(`#worksList [data-work-id="${CSS.escape(id)}"]`)?.focus();
  }

  function restoreListFocus() {
    const id = mobileReturnWorkId || selected?.id;
    const target = id ? el(`#worksList [data-work-id="${CSS.escape(id)}"]`) : el("#worksList .work-list-item");
    if (target) {
      target.focus({ preventScroll: true });
      window.scrollTo({ top: mobileReturnScroll, behavior: "auto" });
    }
  }

  function backToList() {
    if (!usesSequentialLayout()) return;
    mobileReturnWorkId = selected?.id || mobileReturnWorkId;
    updateUrl((params) => params.delete("work"));
    mobileDetailOpen = false;
    renderMobileLayer();
    renderActions();
    restoreListFocus();
  }

  function goToPage(page) {
    if (loading || page < 1 || page > pagination.total_pages || page === pagination.page) return;
    mobileReturnWorkId = null;
    updateUrl((params) => { params.set("page", String(page)); params.delete("work"); });
    void loadWorks({ focusPage: page });
  }

  function applyFilter() {
    updateUrl((params) => {
      const value = el("#deliveryFilter").value;
      if (value === "all") params.delete("deliveryStatus"); else params.set("deliveryStatus", value);
      params.delete("page");
      params.delete("work");
    });
    void loadWorks();
  }

  function ensureSelectedUrl() {
    if (!selected) return;
    const query = new URLSearchParams(location.search);
    if (query.get("work") === selected.id) return;
    updateUrl((params) => { params.set("work", selected.id); params.set("page", String(pagination.page)); }, { replace: true });
  }

  function binding() {
    const inspection = currentInspection();
    return inspection ? { id: inspection.id, revision: Number(inspection.revision), status: inspection.status } : null;
  }

  function freshIntent(kind) {
    const existing = intents[kind];
    if ((existing?.uncertain || existing?.needsReload) && existing.workId === selected?.id) return existing;
    intents[kind] = {
      kind,
      key: crypto.randomUUID(),
      workId: selected?.id || null,
      inspection: binding(),
      beforeDeliveryCount: Number(selected?.delivery_count || 0),
      uncertain: false,
      needsReload: false,
      errorStatus: null
    };
    return intents[kind];
  }

  function intentDialog(kind) { return el(kind === "pass" ? "#passDialog" : kind === "rework" ? "#reworkDialog" : "#deliveryDialog"); }
  function intentError(kind) { return el(kind === "pass" ? "#passError" : kind === "rework" ? "#reworkError" : "#deliveryError"); }
  function intentReload(kind) { return el(kind === "pass" ? "#reloadPassState" : kind === "rework" ? "#reloadReworkState" : "#reloadDeliveryState"); }
  function intentSubmit(kind) { return el(kind === "pass" ? "#submitPass" : kind === "rework" ? "#submitRework" : "#submitDelivery"); }

  function showDialog(dialog, trigger = document.activeElement, focusSelector = null) {
    dialogTriggers.set(dialog, trigger);
    dialog.showModal();
    requestAnimationFrame(() => el(focusSelector || `#${dialog.id} h2`)?.focus());
  }

  function clearIntent(kind) { intents[kind] = null; }

  function operationError(error, action) {
    if (error.status === 403) return { text: `当前账号没有${action}权限，请联系组织管理员。`, tone: "blocked" };
    if (error.status === 409) return { text: "作品状态已变化。请显式载入最新状态；已填写内容会保留。", tone: "blocked" };
    if (!error.status || error.status === 408 || error.status >= 500) return { text: `${action}结果待确认。请载入最新作品状态；系统不会自动重试。`, tone: "blocked" };
    if (error.status === 404 || error.status === 422) return { text: "当前作品已不满足该操作条件。请载入最新状态。", tone: "blocked" };
    if (error.status === 400) return { text: "请补齐必填信息后重试。", tone: "error" };
    return { text: `${action}未完成（技术原因）。`, tone: "error" };
  }

  function eligible(kind) {
    const inspection = currentInspection();
    if (!selected || selected.status !== "available") return false;
    if (kind === "pass") return inspection?.status === "pending";
    if (kind === "rework") return inspection?.status === "pending" || inspection?.status === "passed";
    return inspection?.status === "passed" && selected.delivery_status !== "rework_required";
  }

  function installLatestBinding(intent, { replaceKey }) {
    intent.inspection = binding();
    if (replaceKey) intent.key = crypto.randomUUID();
    intent.needsReload = false;
    intent.uncertain = false;
  }

  async function reloadIntent(kind) {
    const intent = intents[kind];
    if (!intent || busy) return;
    const button = intentReload(kind);
    busy = true;
    button.disabled = true;
    intentError(kind).textContent = "正在载入最新作品状态…";
    const loaded = await loadWorks({ focus: "none" });
    busy = false;
    button.disabled = false;
    if (!loaded) {
      intentError(kind).textContent = "最新状态仍无法读取；已填写内容和同一操作标识会保留。";
      renderActions();
      return;
    }
    if (!selected || selected.id !== intent.workId) {
      intent.needsReload = true;
      intentError(kind).textContent = "最新状态已载入，但原作品已不可查看；本次操作未被宣称成功。";
      intentSubmit(kind).disabled = true;
      renderActions();
      return;
    }
    if (intent.uncertain) {
      intent.needsReload = false;
      button.hidden = true;
      intentSubmit(kind).disabled = false;
      intentError(kind).textContent = "权威状态已载入，但仅凭业务状态无法确认本次写入；可使用同一操作标识显式重放，系统不会创建重复记录。";
      renderActions();
      return;
    }
    if (!eligible(kind)) {
      intent.needsReload = true;
      intentError(kind).textContent = "最新状态已载入，但当前已不能执行该操作；已填写内容仍保留。";
      intentSubmit(kind).disabled = true;
      renderActions();
      return;
    }
    installLatestBinding(intent, { replaceKey: true });
    button.hidden = true;
    intentSubmit(kind).disabled = false;
    intentError(kind).textContent = "最新作品状态已载入；已填写内容仍保留，请确认后再提交。";
    renderActions();
  }

  async function submitIntent(kind, payload = {}) {
    const intent = intents[kind];
    if (!intent || busy || intent.needsReload || !intent.inspection) return;
    busy = true;
    intentSubmit(kind).disabled = true;
    const path = kind === "pass" ? "inspections/pass" : kind === "rework" ? "inspections/rework" : "deliveries";
    const body = {
      idempotency_key: intent.key,
      expected_inspection_id: intent.inspection.id,
      expected_revision: intent.inspection.revision,
      ...payload
    };
    try {
      await request(`/api/works/${encodeURIComponent(intent.workId)}/${path}`, { method: "POST", body: JSON.stringify(body) });
      clearIntent(kind);
      intentDialog(kind).close();
      await loadWorks();
      notice(el("#actionNotice"), kind === "delivery" ? "交付已登记；这次记录已保留。" : kind === "rework" ? "返工已登记，原作品与历史仍会保留。" : "检查已完成。", "success");
    } catch (error) {
      const result = operationError(error, kind === "delivery" ? "交付登记" : kind === "rework" ? "返工登记" : "检查");
      intent.uncertain = !error.status || error.status === 408 || error.status >= 500;
      intent.needsReload = true;
      intent.errorStatus = error.status || 0;
      authorityFailed = true;
      intentError(kind).textContent = result.text;
      intentReload(kind).hidden = false;
      notice(el("#actionNotice"), result.text, result.tone);
    } finally {
      busy = false;
      intentSubmit(kind).disabled = Boolean(intents[kind]?.needsReload);
      renderActions();
    }
  }

  function openPassDialog() {
    if (!eligible("pass") || busy || authorityFailed) return;
    ensureSelectedUrl();
    const intent = freshIntent("pass");
    el("#passWorkSummary").textContent = `作品：${workTitle(selected)}`;
    if (!intent.uncertain && !intent.needsReload) el("#passError").textContent = "";
    el("#reloadPassState").hidden = !intent.needsReload;
    el("#submitPass").disabled = Boolean(intent.needsReload);
    showDialog(el("#passDialog"), document.activeElement, "#passDialogTitle");
  }

  function openReworkDialog() {
    if (!eligible("rework") || busy || authorityFailed) return;
    ensureSelectedUrl();
    const intent = freshIntent("rework");
    if (!intent.uncertain && !intent.needsReload) {
      el("#reworkForm").reset();
      el("#reworkError").textContent = "";
      el("#reloadReworkState").hidden = true;
    }
    el("#submitRework").disabled = Boolean(intent.needsReload);
    showDialog(el("#reworkDialog"), document.activeElement, "#reworkCategory");
  }

  function localDateTimeValue() {
    const now = new Date(), local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function openDeliveryDialog() {
    if (!eligible("delivery") || busy || authorityFailed) return;
    ensureSelectedUrl();
    const intent = freshIntent("delivery");
    if (!intent.uncertain && !intent.needsReload) {
      el("#deliveryForm").reset();
      el("#deliveryTime").value = localDateTimeValue();
      el("#deliveryError").textContent = "";
      el("#reloadDeliveryState").hidden = true;
    }
    el("#submitDelivery").disabled = Boolean(intent.needsReload);
    showDialog(el("#deliveryDialog"), document.activeElement, "#deliveryMethod");
  }

  async function submitPass(event) {
    event.preventDefault();
    await submitIntent("pass");
  }

  async function submitRework(event) {
    event.preventDefault();
    const category = el("#reworkCategory").value, reason = el("#reworkReason").value.trim(), target = el("#reworkTarget").value;
    if (!category || !reason || !target) { el("#reworkError").textContent = "请填写返工分类、原因和返回阶段。"; return; }
    await submitIntent("rework", { category, reason, target_upstream_stage: target });
  }

  async function submitDelivery(event) {
    event.preventDefault();
    const deliveredAt = new Date(el("#deliveryTime").value);
    if (Number.isNaN(deliveredAt.valueOf())) { el("#deliveryError").textContent = "请选择有效的交付时间。"; return; }
    await submitIntent("delivery", {
      delivery_method: el("#deliveryMethod").value,
      recipient_reference: clean(el("#deliveryRecipient").value),
      note: clean(el("#deliveryNote").value),
      delivered_at: deliveredAt.toISOString()
    });
  }

  function renderDownloadMetadata(download) {
    el("#downloadFileName").textContent = download.filename || "文件名待确认";
    el("#downloadMediaType").textContent = download.media_type || "媒体类型待确认";
    el("#downloadSize").textContent = formatBytes(download.size);
    el("#downloadChecksum").textContent = download.checksum_sha256 || "校验值待确认";
    el("#downloadMetadata").hidden = false;
  }

  async function preview() {
    if (!selected || previewBusy || authorityFailed) return;
    const workId = selected.id;
    const epoch = ++previewEpoch;
    previewBusy = true;
    el("#previewWork").disabled = true;
    notice(el("#previewNotice"), "正在准备预览…");
    try {
      const result = await request(`/api/works/${encodeURIComponent(workId)}/download-authorizations`, { method: "POST" });
      if (epoch !== previewEpoch || selected?.id !== workId) return;
      const download = result.download || {}, url = download.url;
      if (!url) throw Object.assign(new Error("WORK_DELIVERY_DOWNLOAD_UNAVAILABLE"), { status: 422 });
      const video = el("#workVideo");
      video.dataset.workId = workId;
      video.src = url;
      video.hidden = false;
      const link = el("#downloadWork");
      link.href = url;
      link.hidden = false;
      if (download.filename) link.download = download.filename; else link.removeAttribute("download");
      renderDownloadMetadata(download);
      el("#downloadBoundary").hidden = false;
      el(".preview-placeholder").hidden = true;
      notice(el("#previewNotice"), "下载授权已准备；交付登记与真实字节下载验收是两个独立步骤。", "success");
    } catch (error) {
      if (epoch === previewEpoch && selected?.id === workId) notice(el("#previewNotice"), error.status === 403 ? "当前账号没有下载权限。" : "作品暂时无法预览（技术原因），可以稍后重试或联系处理人。", error.status === 403 ? "blocked" : "error");
    } finally {
      if (epoch === previewEpoch) { previewBusy = false; el("#previewWork").disabled = false; renderActions(); }
    }
  }

  function closeOpenDialogs() {
    for (const dialog of document.querySelectorAll("dialog[open]")) dialog.close();
  }

  el("#refreshWorks").addEventListener("click", () => bootstrap());
  el("#deliveryFilter").addEventListener("change", applyFilter);
  el("#previousWorksPage").addEventListener("click", () => goToPage(pagination.page - 1));
  el("#nextWorksPage").addEventListener("click", () => goToPage(pagination.page + 1));
  el("#passInspection").addEventListener("click", openPassDialog);
  el("#passForm").addEventListener("submit", submitPass);
  el("#requestRework").addEventListener("click", openReworkDialog);
  el("#reworkForm").addEventListener("submit", submitRework);
  el("#recordDelivery").addEventListener("click", openDeliveryDialog);
  el("#deliveryForm").addEventListener("submit", submitDelivery);
  el("#reloadPassState").addEventListener("click", () => reloadIntent("pass"));
  el("#reloadReworkState").addEventListener("click", () => reloadIntent("rework"));
  el("#reloadDeliveryState").addEventListener("click", () => reloadIntent("delivery"));
  el("#previewWork").addEventListener("click", preview);
  el("#workVideo").addEventListener("error", () => {
    if (el("#workVideo").dataset.workId === selected?.id) notice(el("#previewNotice"), "预览暂不可用（技术原因），可以下载文件后查看。", "blocked");
  });
  el("#backToWorksList").addEventListener("click", backToList);
  el("#viewDeliveryHistory").addEventListener("click", () => {
    const heading = el("#deliveryHistoryTitle");
    heading.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
    heading.focus({ preventScroll: true });
  });
  el("#mobilePrimaryAction").addEventListener("click", () => {
    if (!selected || authorityFailed) return;
    if (!mobileDetailOpen) { mobileDetailOpen = true; renderMobileLayer(); el("#selectedWorkName").focus(); return; }
    const inspection = currentInspection();
    if (selected.delivery_status === "rework_required" || inspection?.status === "rework_required") {
      el("#actionPanelTitle").scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "start" });
      el("#actionPanelTitle").focus({ preventScroll: true });
    } else if (selected.delivery_status === "delivered") el("#viewDeliveryHistory").click();
    else if (inspection?.status === "passed") openDeliveryDialog();
    else openPassDialog();
  });

  for (const [selector, dialogSelector] of [["#cancelPass", "#passDialog"], ["#closePass", "#passDialog"], ["#cancelRework", "#reworkDialog"], ["#closeRework", "#reworkDialog"], ["#cancelDelivery", "#deliveryDialog"], ["#closeDelivery", "#deliveryDialog"]]) {
    el(selector).addEventListener("click", () => el(dialogSelector).close());
  }
  for (const dialog of document.querySelectorAll("dialog")) {
    dialog.addEventListener("close", () => {
      const kind = dialog.id === "passDialog" ? "pass" : dialog.id === "reworkDialog" ? "rework" : dialog.id === "deliveryDialog" ? "delivery" : null;
      if (kind && !intents[kind]?.uncertain && !intents[kind]?.needsReload) clearIntent(kind);
      const trigger = dialogTriggers.get(dialog);
      if (trigger?.isConnected) trigger.focus();
      else el("#worksTaskTitle")?.focus?.();
      dialogTriggers.delete(dialog);
    });
  }

  window.addEventListener("popstate", () => {
    closeOpenDialogs();
    const route = locationState();
    void loadWorks({ focus: usesSequentialLayout() ? (route.workId ? "detail" : "list") : "none" });
  });
  window.addEventListener("resize", () => {
    mobileDetailOpen = usesSequentialLayout() ? Boolean(locationState().workId && selected) : Boolean(selected);
    renderMobileLayer();
    renderActions();
  });

  await bootstrap();
})();
