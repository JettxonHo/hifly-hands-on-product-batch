(async () => {
  const params = new URLSearchParams(location.search), projectId = params.get("project"), requestedProductId = params.get("product");
  let project, product, runtime, workspace, cloudExecutor = null, cloudStatusRequest = null, execution = null, verification = null, packages = [], creating = false, packageBusy = false, packagePoll = null, verificationPoll = null, cloudStatusPoll = null, cloudStatusPollActive = false, cloudStatusPollInFlight = false, verificationReadError = "", workDeliveryReadError = "",
    manualBusy = false, manualUploadBusy = false, verificationBusy = false, manualCorrectionReportId = null, selectedOrderId = params.get("orderId") || null, pendingCreateKey = null, pendingPackageKey = null, pendingRetryKey = null, bootstrapFailed = false;
  const element = (selector) => document.querySelector(selector);
  const csrf = () => decodeURIComponent((document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hifly_identity_csrf=")) || "=").split("=").slice(1).join("="));
  const purposeLabels = { first_production: "首次生产", rework: "返工重做", supplemental_version: "补充版本", reproduction: "再次生产" };
  const purposeDescriptions = {
    first_production: "本商品首次安排真实生产。", rework: "此前生产结果不满足要求，按相同方案重新生产。",
    supplemental_version: "在已有生产结果之外，按相同方案追加生产一个版本。", reproduction: "按相同方案再次生产，例如原产物不可用或需要重出。"
  };
  const statusLabels = { draft: "草稿", ready: "已就绪", waiting_for_executor: "等待执行", claimed: "已领取", running: "执行中", requires_action: "需要处理", succeeded: "已完成", failed: "失败", cancel_requested: "取消中", cancelled: "已取消" };
  const packageLabels = { generating: "生成中", ready: "可下载", generation_failed: "生成未完成", superseded: "已由新版本替代", expired: "下载权限已过期", revoked: "已停用" };
  const planLabels = { frozen: "已批准方案", draft: "草稿方案", superseded: "已被替代" };
  const presentationSizeLabels = { smart_fit: "智能适配", extra_large: "超大", large: "大", medium: "中", small: "小", extra_small: "超小" };
  const outcomeLabels = { completed: "已完成，等待核验", requires_action: "需要处理", failed: "执行失败", cancelled: "已取消" };
  const verificationLabels = { queued: "等待核验", running: "核验中", passed: "核验通过", failed: "核验未完成", requires_action: "需要处理" };
  const cloudReadinessLabels = { disabled: "未启用", unconfigured: "未配置", requires_login: "需要重新登录飞影", storage_blocked: "磁盘不足", available: "待命", busy: "执行中", requires_action: "需要人工处理" };
  const cloudConnectionLabels = { online: "在线", offline: "离线" };
  const cloudExecutionLabels = { pending: "未开始", succeeded: "执行成功", failed: "执行失败", requires_action: "需要处理" };
  const cloudVerificationLabels = { not_started: "未发起", pending: "等待 A12 核验", passed: "A12 核验通过", failed: "A12 核验未完成", requires_action: "A12 需要处理" };
  const cloudDeliveryLabels = { not_available: "未登记", pending_review: "等待作品检查", deliverable: "待交付", rework_required: "需要返工", delivered: "已交付" };
  const gateLabels = { approved_plan_missing: "视频方案尚未通过人工审核，不能创建工单", plan_review_not_approved: "视频方案尚未通过人工审核，不能创建工单", preflight_not_reviewable: "视频方案预检尚未达到可生产条件，不能创建工单", preflight_invalidated: "方案批准已失效，请返回视频方案重新确认", upstream_changed: "方案引用的商品、文案或人物信息已变化，请创建新方案版本", capability_snapshot_changed: "方案能力配置已变化，请返回视频方案重新确认", plan_not_current: "当前方案已不是有效版本，请返回视频方案查看最新版本", plan_not_frozen: "视频方案尚未固定，不能创建工单" };
  const injectedCloudPollInterval = Number(window.__HIFLY_CLOUD_STATUS_POLL_INTERVAL_MS__);
  const cloudStatusPollIntervalMs = Number.isFinite(injectedCloudPollInterval) && injectedCloudPollInterval >= 50
    ? Math.min(injectedCloudPollInterval, 60_000) : 5_000;

  async function request(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = new Headers(options.headers || {});
    if (method !== "GET") {
      headers.set("x-identity-csrf", csrf());
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
    }
    const fetchOptions = { credentials: "same-origin", ...options, method, headers };
    if (method !== "GET" && fetchOptions.body == null && headers.get("content-type") === "application/json") fetchOptions.body = "{}";
    const response = await fetch(url, fetchOptions);
    if (response.status === 401) { location.replace("/login.html"); throw new Error("AUTH_REQUIRED"); }
    const body = await response.json(); if (!response.ok) throw Object.assign(new Error(body.error), { status: response.status, body }); return body;
  }
  function notice(target, message = "", tone = "") { target.className = `notice${tone ? ` ${tone}` : ""}`; target.textContent = message; }
  function stateClass(status) { return ["succeeded", "ready"].includes(status) ? "ready" : ["queued", "running", "pending", "waiting_for_executor", "claimed"].includes(status) ? "waiting_for_executor" : ["requires_action"].includes(status) ? "blocked" : ["failed"].includes(status) ? "failure" : ["cancelled", "superseded"].includes(status) ? "superseded" : ""; }
  function cloudStateClass(status) { return status === "available" ? "ready" : status === "busy" ? "waiting_for_executor" : ["requires_login", "storage_blocked", "requires_action"].includes(status) ? "blocked" : status === "disabled" || status === "unconfigured" ? "disabled" : ""; }
  function badge(target, status) { target.textContent = statusLabels[status] || "状态待确认"; target.className = `state ${stateClass(status)}`; }
  function short(value) { return value ? value.slice(0, 8) : "未就绪"; }
  function formatTime(value) { return value ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "时间待确认"; }
  function planHref() { return `/plan.html?project=${encodeURIComponent(project.id)}&product=${encodeURIComponent(product.id)}`; }
  function updateLocation() { const next = new URL(location.href); next.searchParams.set("project", project.id); next.searchParams.set("product", product.id); if (selectedOrderId) next.searchParams.set("orderId", selectedOrderId); else next.searchParams.delete("orderId"); history.replaceState(null, "", next); }

  function renderCloudExecutor() {
    const value = cloudExecutor || { worker: { connection: "offline" }, readiness: { status: "requires_action" }, execution: { status: "pending" }, verification: { status: "not_started" }, delivery: { status: "not_available" } };
    const readiness = value.readiness?.status || "requires_action", connection = value.worker?.connection || "offline", executionStatus = value.execution?.status || "pending";
    const readinessTarget = element("#cloudExecutorReadiness"); readinessTarget.textContent = cloudReadinessLabels[readiness] || "状态待确认"; readinessTarget.className = `state ${cloudStateClass(readiness)}`;
    element("#cloudExecutorConnection").textContent = cloudConnectionLabels[connection] || "状态待确认";
    element("#cloudExecutorOrder").textContent = value.current_order?.id ? `${short(value.current_order.id)} · ${statusLabels[value.current_order.status] || "状态待确认"}` : "无当前工单";
    element("#cloudExecutorAttempt").textContent = value.current_attempt?.id ? `${short(value.current_attempt.id)} · ${statusLabels[value.current_attempt.status] || "状态待确认"}` : "无当前尝试";
    element("#cloudExecutorProgress").textContent = value.progress?.label || "待命";
    element("#cloudExecutorExecution").textContent = cloudExecutionLabels[executionStatus] || "状态待确认";
    element("#cloudExecutorVerification").textContent = cloudVerificationLabels[value.verification?.status] || "状态待确认";
    element("#cloudExecutorDelivery").textContent = cloudDeliveryLabels[value.delivery?.status] || "状态待确认";
    const summary = element("#cloudExecutorSummary"), statusNotice = element("#cloudExecutorNotice");
    let summaryText = "Cloud Executor 当前状态待确认。", noticeText = "", noticeTone = "";
    if (readiness === "disabled") {
      summaryText = "Cloud Executor 当前未启用；生产主路径不会自动改为本地 Agent。";
    } else if (readiness === "unconfigured") {
      summaryText = "Cloud Executor 尚未配置，请完成云端执行器配置后再提交生产。";
    } else if (readiness === "requires_login") {
      summaryText = "需要重新登录飞影";
      noticeText = "云端飞影登录态已失效，请通过受控登录入口重新登录飞影。"; noticeTone = "blocked";
    } else if (readiness === "storage_blocked") {
      summaryText = "云端磁盘空间不足";
      noticeText = "低于安全门限，已暂停领取新工单。"; noticeTone = "blocked";
    } else if (connection !== "online") {
      summaryText = "云端执行器离线";
      noticeText = "暂未收到 Cloud Executor 心跳，不会自动切换为本地 Agent。"; noticeTone = "blocked";
    } else if (readiness === "busy" || executionStatus === "pending" && value.current_attempt) {
      summaryText = "Cloud Executor 正在执行";
      noticeText = value.progress?.label ? `当前进度：${value.progress.label}。正在持续更新当前工单进度。` : "正在持续更新当前工单进度。";
    } else if (readiness === "requires_action") {
      summaryText = "需要人工处理";
      noticeText = "当前云端执行已暂停；请按处理提示完成核对，不会自动重试。"; noticeTone = "blocked";
    } else if (readiness === "available") {
      summaryText = "Cloud Executor 已连接并待命，可领取下一条工单。";
    }
    if (value.failure && !["requires_login", "storage_blocked"].includes(readiness)) {
      noticeText = value.failure.message || "Cloud Executor 执行失败；不会自动重试。"; noticeTone = "error";
    }
    summary.textContent = summaryText; notice(statusNotice, noticeText, noticeTone);
    const failureTarget = element("#cloudExecutorFailure");
    if (value.failure && !["requires_login", "storage_blocked"].includes(readiness)) { failureTarget.textContent = value.failure.message || "Cloud Executor 执行失败；不会自动重试。"; failureTarget.hidden = false; }
    else { failureTarget.textContent = ""; failureTarget.hidden = true; }
    const workLink = element("#cloudExecutorWorkLink");
    if (value.work?.id && value.verification?.status === "passed") {
      workLink.href = `/works.html?work=${encodeURIComponent(value.work.id)}&project=${encodeURIComponent(project.id)}&product=${encodeURIComponent(product.id)}`;
      workLink.hidden = false;
    } else { workLink.hidden = true; workLink.removeAttribute("href"); }
    renderProductionTechnicalDetails(value);
  }

  function renderProductionTechnicalDetails(value) {
    const packageValue = packages[0] || null;
    element("#productionTechnicalOrderId").textContent = value.current_order?.id || "无";
    element("#productionTechnicalAttemptId").textContent = value.current_attempt?.id || "无";
    element("#productionTechnicalEligible").textContent = "页面未提供组织级可验证投影";
    element("#productionTechnicalActiveAttempts").textContent = "页面未提供组织级可验证投影";
    element("#productionTechnicalHeartbeat").textContent = value.current_attempt?.heartbeat_at || value.worker?.last_heartbeat_at || "无";
    const connection = value.worker?.connection || "offline";
    element("#productionTechnicalConnection").textContent = `${cloudConnectionLabels[connection] || "待确认"}（${connection}）`;
    const readiness = value.readiness?.status || "requires_action";
    element("#productionTechnicalReadiness").textContent = `${cloudReadinessLabels[readiness] || "待确认"}（${readiness}）`;
    const progress = value.progress;
    element("#productionTechnicalProgress").textContent = progress ? `${progress.label || "进度待确认"}（${progress.phase || "unknown"}）` : "无当前进度";
    element("#productionTechnicalHandoff").textContent = packageValue
      ? `v${packageValue.package_version || "?"} · ${packageLabels[packageValue.status] || "状态待确认"}（${packageValue.status}）`
      : selectedOrderId ? "尚未生成" : "无当前交接资料";
  }

  function renderContext() {
    element("#projectBreadcrumb").textContent = project.name; element("#projectBreadcrumb").href = `/project.html?id=${encodeURIComponent(project.id)}`;
    const facts = `/project.html?id=${encodeURIComponent(project.id)}`, copy = `/copy.html?project=${encodeURIComponent(project.id)}&revision=${encodeURIComponent(product.revision.id)}`, avatar = `/avatar.html?project=${encodeURIComponent(project.id)}&product=${encodeURIComponent(product.id)}`;
    element("#factsStageLink").href = facts; element("#mobileFactsStageLink").href = facts; element("#copyStageLink").href = copy; element("#mobileCopyStageLink").href = copy; element("#avatarStageLink").href = avatar; element("#mobileAvatarStageLink").href = avatar; element("#planStageLink").href = planHref(); element("#mobilePlanStageLink").href = planHref(); element("#planContextLink").href = planHref();
    const upstreamState = workspace?.gate?.can_create === true ? "completed" : "available";
    window.HiflyOperatorStages.set(["#factsStageLink", "#mobileFactsStageLink", "#copyStageLink", "#mobileCopyStageLink", "#avatarStageLink", "#mobileAvatarStageLink", "#planStageLink", "#mobilePlanStageLink"], upstreamState);
    const selector = element("#productSelector"); selector.replaceChildren(...project.products.map((item) => { const option = document.createElement("option"); option.value = item.id; option.textContent = item.revision.product_name || "未命名商品"; option.selected = item.id === product.id; return option; }));
  }

  function canCreateOrder() {
    return workspace?.gate?.can_create === true
      && Boolean(workspace?.current_plan)
      && (workspace?.orders || []).length === 0;
  }

  function persistedTerminalProjection(selectedOrder) {
    if (selectedOrder?.status !== "succeeded") return null;
    const rawVerificationStatus = verification?.job?.verification_status;
    const verificationStatus = ["queued", "running"].includes(rawVerificationStatus)
      ? "pending"
      : ["passed", "failed", "requires_action"].includes(rawVerificationStatus)
        ? rawVerificationStatus
        : "not_started";
    const work = verification?.delivery_work || null;
    return {
      executionStatus: execution?.current_attempt?.status === "succeeded" || selectedOrder.status === "succeeded" ? "succeeded" : "pending",
      verificationStatus,
      deliveryStatus: work?.delivery_status || "not_available",
      workReadError: Boolean(workDeliveryReadError && verification?.work?.id && !work),
      work
    };
  }

  function renderGate() {
    const reasons = workspace?.gate?.reasons || [];
    const plan = workspace?.current_plan;
    const planState = element("#planState"); planState.textContent = plan ? planLabels[plan.status] || "状态待确认" : "尚无已批准方案"; planState.className = `state ${workspace?.gate?.can_create ? "ready" : "blocked"}`;
    element("#contextSummary").textContent = plan ? `方案 v${plan.version_number} · ${workspace.gate.can_create ? "已批准" : "批准已失效"}` : "请先完成方案审核";
    const summary = plan ? `文案 ${short(plan.upstream_snapshot?.copy_version_id)} · 人物 ${short(plan.upstream_snapshot?.avatar_selection_id)}` : "等待当前有效已批准方案";
    element("#planContextLink").textContent = plan ? "查看方案 →" : "返回视频方案 →"; element("#contextSummary").title = summary;
    if (runtime?.manualHandoffEnabled || runtime?.manualExecutionEnabled) notice(element("#executorNotice"), "历史人工执行与交接包入口仍保留在下方；生产主路径由 Cloud Executor 状态决定。", ""); else notice(element("#executorNotice"));
    const createDisabled = !canCreateOrder();
    const createBlockedByOrder = workspace.gate.can_create && (workspace.orders || []).length > 0;
    for (const selector of ["#createOrderButton", "#createOrderEmpty"]) {
      const button = element(selector);
      button.disabled = createDisabled;
      button.title = createDisabled
        ? createBlockedByOrder ? "当前商品已有生产工单，请先完成当前工单验收" : (gateLabels[reasons[0]] || "当前条件不满足，无法创建工单")
        : "";
    }
    if (!workspace.gate.can_create) notice(element("#pageNotice"), reasons.map((reason) => gateLabels[reason] || "当前方案不可创建工单").join("；") + "。请返回视频方案处理。", "blocked"); else if (!element("#pageNotice").textContent || element("#pageNotice").classList.contains("blocked")) notice(element("#pageNotice"));
  }

  function renderTaskSummary() {
    const summary = element("#productionTaskSummary");
    const createOrderButton = element("#createOrderEmpty");
    const taskAction = element("#productionTaskAction");
    document.querySelectorAll('#mainContent [data-recommended-action="true"]').forEach((control) => control.removeAttribute("data-recommended-action"));
    taskAction.hidden = true;
    taskAction.removeAttribute("href");
    const selectedOrder = workspace?.orders?.find((order) => order.id === selectedOrderId) || workspace?.selected_order || null;
    const readyToCreate = canCreateOrder();
    const packageStatus = selectedOrder && runtime?.manualHandoffEnabled === true
      ? packages[0]?.status || (selectedOrder.status === "waiting_for_executor" ? "absent" : null)
      : null;
    const cloudMatchesOrder = Boolean(selectedOrder && cloudExecutor?.current_order?.id === selectedOrder.id);
    const persistedTerminal = persistedTerminalProjection(selectedOrder);
    const supportedPackageStates = new Set(["absent", "generating", "generation_failed", "expired", "superseded", "revoked", "ready"]);
    summary.hidden = !readyToCreate && !persistedTerminal && !supportedPackageStates.has(packageStatus);

    const status = element("#productionTaskStatus"); status.textContent = "正在读取"; status.className = "state";
    const blocker = element("#productionTaskBlocker"); blocker.className = "task-summary-blocker"; blocker.textContent = ""; blocker.hidden = true;
    if (summary.hidden) return;

    element("#productionTaskProduct").textContent = product.revision.product_name || "未命名商品";
    element("#productionTaskStage").textContent = "生产";
    if (readyToCreate) {
      element("#productionTaskTitle").textContent = "准备生产工单";
      element("#productionTaskDescription").textContent = "当前已批准方案可用于生产。";
      status.textContent = "可准备生产"; status.className = "state ready";
      element("#productionTaskNextStep").textContent = "创建生产工单";
      createOrderButton.setAttribute("data-recommended-action", "true");
      return;
    }

    if (!persistedTerminal && packageStatus === "absent") {
      element("#productionTaskTitle").textContent = "准备生产交接资料";
      element("#productionTaskDescription").textContent = "当前工单正在等待生产交接资料。";
      status.textContent = "交接资料未就绪"; status.className = "state blocked";
      element("#productionTaskNextStep").textContent = "生成生产交接包";
      element("#generatePackageButton").setAttribute("data-recommended-action", "true");
    } else if (!persistedTerminal && packageStatus === "generating") {
      element("#productionTaskTitle").textContent = "正在准备生产交接资料";
      element("#productionTaskDescription").textContent = "交接资料正在准备，当前无需重复操作。";
      status.textContent = "正在准备交接资料"; status.className = "state waiting_for_executor";
      element("#productionTaskNextStep").textContent = "等待";
    } else if (!persistedTerminal && packageStatus === "generation_failed") {
      element("#productionTaskTitle").textContent = "生产交接资料准备失败";
      element("#productionTaskDescription").textContent = "本次准备未完成，不会自动重试。";
      status.textContent = "交接资料准备失败"; status.className = "state failure";
      element("#productionTaskNextStep").textContent = "经人工确认重试";
      element("#retryPackageButton").setAttribute("data-recommended-action", "true");
    } else if (!persistedTerminal && packageStatus === "expired") {
      element("#productionTaskTitle").textContent = "生产交接资料下载授权已过期";
      element("#productionTaskDescription").textContent = "交接资料仍保留，需要重新获取下载授权。";
      status.textContent = "下载授权已过期"; status.className = "state blocked";
      element("#productionTaskNextStep").textContent = "重新获取下载授权";
      element("#authorizePackageButton").setAttribute("data-recommended-action", "true");
    } else if (!persistedTerminal && ["superseded", "revoked"].includes(packageStatus)) {
      element("#productionTaskTitle").textContent = "当前生产交接包不可用";
      element("#productionTaskDescription").textContent = "该交接包不能继续用于当前生产。";
      status.textContent = "当前交接包不可用"; status.className = "state blocked";
      element("#productionTaskNextStep").textContent = "返回当前有效包或重新生成";
    } else if (persistedTerminal || packageStatus === "ready") {
      const restoredTerminal = cloudMatchesOrder ? null : persistedTerminal;
      const executionStatus = restoredTerminal?.executionStatus || cloudExecutor?.execution?.status || "pending";
      const verificationStatus = restoredTerminal?.verificationStatus || cloudExecutor?.verification?.status || "not_started";
      const deliveryStatus = restoredTerminal?.deliveryStatus || cloudExecutor?.delivery?.status || "not_available";
      const work = restoredTerminal?.work || cloudExecutor?.work || null;
      const terminalMatchesOrder = cloudMatchesOrder || Boolean(persistedTerminal);
      const attemptRunning = cloudMatchesOrder && (cloudExecutor?.current_attempt?.status === "running" || cloudExecutor?.current_order?.status === "running" || cloudExecutor?.readiness?.status === "busy");

      if (selectedOrder.status === "cancel_requested") {
        element("#productionTaskTitle").textContent = "正在取消当前生产";
        element("#productionTaskDescription").textContent = "取消请求已记录，当前等待服务端终态。";
        status.textContent = "正在取消"; status.className = "state waiting_for_executor";
        element("#productionTaskNextStep").textContent = "等待终态";
      } else if (selectedOrder.status === "cancelled") {
        element("#productionTaskTitle").textContent = "当前生产已取消";
        element("#productionTaskDescription").textContent = "历史执行记录仍会保留，不会自动重新生产。";
        status.textContent = "已取消"; status.className = "state blocked";
        element("#productionTaskNextStep").textContent = "查看结果或按新授权重新规划";
      } else if (cloudMatchesOrder && (executionStatus === "failed" || cloudExecutor?.readiness?.status === "requires_action" && executionStatus !== "succeeded")) {
        element("#productionTaskTitle").textContent = "当前生产需要人工处理";
        element("#productionTaskDescription").textContent = "本次生产已停止，需先处理当前阻断。";
        status.textContent = "需人工处理，整批已停"; status.className = "state failure";
        element("#productionTaskNextStep").textContent = "处理当前阻断";
        const failureMessage = cloudExecutor?.failure?.message || "当前生产遇到阻断。";
        blocker.textContent = failureMessage.includes("不会自动重试") ? failureMessage : `${failureMessage} 不会自动重试。`;
        blocker.hidden = false;
      } else if (attemptRunning) {
        element("#productionTaskTitle").textContent = "正在生成作品";
        element("#productionTaskDescription").textContent = "当前工单正在生成，状态会持续更新。";
        status.textContent = "正在生成"; status.className = "state waiting_for_executor";
        element("#productionTaskNextStep").textContent = "等待";
      } else if (terminalMatchesOrder && executionStatus === "succeeded" && ["failed", "requires_action"].includes(verificationStatus)) {
        element("#productionTaskTitle").textContent = "作品文件核验需要处理";
        element("#productionTaskDescription").textContent = "生成结果已保留，需先处理文件核验问题。";
        status.textContent = "文件核验需处理"; status.className = "state blocked";
        element("#productionTaskNextStep").textContent = "处理核验问题";
      } else if (terminalMatchesOrder && executionStatus === "succeeded" && verificationStatus === "pending") {
        element("#productionTaskTitle").textContent = "正在核验作品文件";
        element("#productionTaskDescription").textContent = "正在确认作品文件是否可用于后续验收。";
        status.textContent = "正在核验作品文件"; status.className = "state waiting_for_executor";
        element("#productionTaskNextStep").textContent = "等待";
      } else if (restoredTerminal?.workReadError) {
        element("#productionTaskTitle").textContent = "作品状态读取失败";
        element("#productionTaskDescription").textContent = "作品已经登记，但当前无法读取最新检查与交付状态。";
        status.textContent = "作品状态读取失败"; status.className = "state failure";
        element("#productionTaskNextStep").textContent = "刷新当前工单";
        blocker.textContent = "请刷新当前工单；在读取成功前不会开放下一单。";
        blocker.hidden = false;
        element("#refreshProduction").setAttribute("data-recommended-action", "true");
      } else if (terminalMatchesOrder && executionStatus === "succeeded" && verificationStatus === "passed" && !work) {
        element("#productionTaskTitle").textContent = "正在登记作品";
        element("#productionTaskDescription").textContent = "文件核验已通过，正在形成可验收作品。";
        status.textContent = "正在登记作品"; status.className = "state waiting_for_executor";
        element("#productionTaskNextStep").textContent = "等待";
      } else if (terminalMatchesOrder && verificationStatus === "passed" && work?.id && ["pending_review", "rework_required", "deliverable", "delivered"].includes(deliveryStatus)) {
        const workStates = {
          pending_review: { title: "作品等待检查", description: "作品文件已登记，需先完成内容检查。", status: "作品待检查", tone: "blocked", next: "进入作品库检查", action: "进入作品库检查 →" },
          rework_required: { title: "作品需要返工", description: "检查已提出返工要求，当前工单不会自动重新生产。", status: "作品需要返工", tone: "blocked", next: "查看返工要求", action: "查看返工要求 →" },
          deliverable: { title: "作品可以交付", description: "内容检查已通过，可以进入作品库登记交付。", status: "作品可交付", tone: "ready", next: "进入作品库登记交付", action: "进入作品库登记交付 →" },
          delivered: { title: "作品已交付，等待真实下载验收", description: "交付登记不等于真实文件下载已经验收。", status: "作品已交付，待真实下载验收", tone: "blocked", next: "查看交付记录并完成真实下载验收", action: "查看交付记录并完成真实下载验收 →" }
        };
        const workState = workStates[deliveryStatus];
        element("#productionTaskTitle").textContent = workState.title;
        element("#productionTaskDescription").textContent = workState.description;
        status.textContent = workState.status; status.className = `state ${workState.tone}`;
        element("#productionTaskNextStep").textContent = workState.next;
        taskAction.href = `/works.html?work=${encodeURIComponent(work.id)}&project=${encodeURIComponent(project.id)}&product=${encodeURIComponent(product.id)}`;
        taskAction.textContent = workState.action;
        taskAction.hidden = false;
        taskAction.setAttribute("data-recommended-action", "true");
      } else if (terminalMatchesOrder && executionStatus === "succeeded" && verificationStatus === "not_started") {
        element("#productionTaskTitle").textContent = "生成完成，等待文件核验";
        element("#productionTaskDescription").textContent = "生成结束不等于本单完成，仍需核验作品文件。";
        status.textContent = "生成完成，待文件核验"; status.className = "state blocked";
        element("#productionTaskNextStep").textContent = "等待文件核验";
      } else {
        element("#productionTaskTitle").textContent = "等待生产门禁核对";
        element("#productionTaskDescription").textContent = "交接资料已就绪，但页面不能证明生产已获授权。";
        status.textContent = "生产门禁未通过"; status.className = "state blocked";
        element("#productionTaskNextStep").textContent = "等待获授权运维核对";
        blocker.textContent = "激活门禁尚未由页面证明；等待获授权运维核对后再继续生产。";
        blocker.hidden = false;
      }
    }
  }

  function orderRow(order, mobile = false) {
    const button = document.createElement("button"); button.type = "button"; button.className = "order-row"; button.dataset.orderId = order.id; button.setAttribute("aria-current", String(order.id === selectedOrderId));
    const title = document.createElement("span"); title.className = "order-row-title"; const name = document.createElement("strong"); name.textContent = purposeLabels[order.execution_purpose] || "生产工单"; const state = document.createElement("span"); badge(state, order.status); title.append(name, state);
    const meta = document.createElement("span"); meta.className = "order-row-meta"; const time = document.createElement("span"); time.textContent = formatTime(order.created_at); const packageState = document.createElement("span"); packageState.textContent = order.id === selectedOrderId ? `交接包：${packageLabels[packages[0]?.status] || "未生成"}` : "交接包：打开查看"; meta.append(time, packageState); button.append(title, meta);
    button.addEventListener("click", () => { selectedOrderId = order.id; loadWorkspace().catch(() => notice(element("#pageNotice"), "工单状态读取失败，请刷新重试。", "error")); if (mobile) element("#orderDrawer").close(); }); return button;
  }
  function renderOrders() {
    const orders = workspace.orders || []; if (!selectedOrderId || !orders.some((order) => order.id === selectedOrderId)) selectedOrderId = orders.at(-1)?.id || null;
    element("#orderList").replaceChildren(...orders.slice().reverse().map((order) => orderRow(order))); element("#mobileOrderList").replaceChildren(...orders.slice().reverse().map((order) => orderRow(order, true))); element("#orderListEmpty").hidden = orders.length > 0;
    const trigger = element("#mobileOrderTrigger"); trigger.hidden = orders.length === 0; trigger.textContent = `▦ 工单（${orders.length}）· 当前：${purposeLabels[orders.find((order) => order.id === selectedOrderId)?.execution_purpose] || "无"} ▾`;
    updateLocation();
  }
  function snapshotCard(label, value, href) { const card = document.createElement("a"); card.className = "snapshot-card"; card.href = href; const copy = document.createElement("span"); const title = document.createElement("strong"); title.textContent = label; const meta = document.createElement("span"); meta.textContent = value; copy.append(title, meta); const link = document.createElement("span"); link.textContent = "查看 →"; card.append(copy, link); return card; }
  function quantityText(value) { return value && typeof value === "object" && Number.isFinite(value.value) && typeof value.unit === "string" && value.unit ? `${value.value} ${value.unit}` : null; }
  function physicalDimensionsText(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "未知";
    const axis = Number.isFinite(value.height) && Number.isFinite(value.width) && typeof value.unit === "string" && value.unit
      ? `${value.height} × ${value.width}${Number.isFinite(value.depth) ? ` × ${value.depth}` : ""} ${value.unit}` : null;
    return axis || "未知";
  }
  function snapshotFact(label, value) { const row = document.createElement("div"); row.className = "snapshot-fact"; row.textContent = `${label}：${value}`; return row; }
  function renderSnapshotFacts(snapshot, plan) {
    const dimensions = snapshot?.product_revision_snapshot?.physical_dimensions;
    const code = typeof plan?.presentation_size_code === "string" && plan.presentation_size_code.trim() ? plan.presentation_size_code.trim() : null;
    const presentation = code && presentationSizeLabels[code] ? `${presentationSizeLabels[code]}（${code}）` : "未设置";
    const facts = [snapshotFact("实物尺寸", physicalDimensionsText(dimensions))];
    const capacity = quantityText(dimensions?.capacity), weight = quantityText(dimensions?.weight);
    if (capacity) facts.push(snapshotFact("容量", capacity));
    if (weight) facts.push(snapshotFact("重量", weight));
    facts.push(snapshotFact("商品呈现大小", presentation));
    element("#snapshotFacts").replaceChildren(...facts);
  }
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
    renderSnapshotFacts(snapshot, plan);
    element("#orderCreatedMeta").textContent = `创建于 ${formatTime(order.created_at)} · 工单输入只读固定。`;
    notice(element("#orderDetailNotice"), order.status === "waiting_for_executor" ? "工单已提交，等待 Cloud Executor 领取；不会自动开始其他执行路径。" : "");
  }
  function packageStateClass(status) { return status === "ready" ? "ready" : status === "generating" ? "waiting_for_executor" : status === "generation_failed" ? "failure" : status === "expired" ? "blocked" : status === "superseded" || status === "revoked" ? "superseded" : ""; }
  function currentPackage() { return packages[0] || null; }
  function currentPackageId(value = currentPackage()) { return value?.id || value?.package_id || null; }
  function packageSummaryRows(summary) {
    const rows = [
      ["执行步骤", summary.execution_steps],
      ["业务约束", summary.business_constraints],
      ["预期行为", summary.expected_behavior],
      ["输出要求", summary.output_requirements ? [`数量：${summary.output_requirements.expected_quantity}`, `命名：${summary.output_requirements.file_naming_rule}`, `类型：${summary.output_requirements.accepted_media_types.join("、")}`, ...summary.output_requirements.minimum_validation_requirements] : []],
      ["素材", summary.assets?.map((asset) => `${asset.display_name}：${asset.retrieval_mode === "embedded" ? "已随包附带" : asset.retrieval_mode === "short_lived_fetch" ? "使用时短时获取" : "执行环境已有素材"}`) || []]
    ];
    return rows.filter(([, values]) => values?.length).map(([label, values]) => { const row = document.createElement("div"); row.className = "package-summary-row"; const title = document.createElement("strong"); title.textContent = label; const list = document.createElement("ul"); for (const value of values) { const item = document.createElement("li"); item.textContent = value; list.append(item); } row.append(title, list); return row; });
  }
  function renderPackage() {
    const panel = element("#packagePanel"), title = element("#packageTitle"), status = element("#packageStatus"), meta = element("#packageMeta"), integrity = element("#packageIntegrity"), failure = element("#packageFailure"), content = element("#packageContent"), actions = element("#packageActions"), history = element("#packageHistory"), historyList = element("#packageHistoryList"), future = element(".future-stage-card");
    if (!runtime?.manualHandoffEnabled) {
      panel.dataset.feature = "disabled"; title.textContent = "尚未生成交接包"; status.textContent = "未生成"; status.className = "state"; meta.textContent = "创建生产工单后，可在后续阶段生成人工交接包。当前阶段不会自动开始生产。"; integrity.textContent = ""; notice(failure); notice(element("#packageNotice")); content.hidden = true; actions.hidden = true; history.hidden = true; future.hidden = true; element("#manualExecutionPanel").hidden = true; return;
    }
    panel.dataset.feature = "enabled"; future.hidden = Boolean(runtime?.manualExecutionEnabled || runtime?.artifactVerificationEnabled); element("#manualExecutionPanel").hidden = !runtime?.manualExecutionEnabled;
    const value = currentPackage();
    if (!workspace?.selected_order || !selectedOrderId) {
      title.textContent = "尚未生成交接包"; status.textContent = "未生成"; status.className = "state"; meta.textContent = "创建生产工单后，可以生成一份供人工执行的交接包。"; integrity.textContent = ""; notice(failure); content.hidden = true; actions.hidden = true; history.hidden = true; return;
    }
    if (!value) {
      title.textContent = "尚未生成交接包"; status.textContent = "未生成"; status.className = "state"; meta.textContent = "当前工单还没有交接包；生成后可在此查看内容摘要与下载。"; integrity.textContent = ""; notice(failure); content.hidden = true; actions.hidden = false; history.hidden = true; element("#generatePackageButton").hidden = false; element("#retryPackageButton").hidden = true; element("#authorizePackageButton").hidden = true; element("#downloadPackageButton").hidden = true; for (const button of actions.querySelectorAll("button")) button.disabled = packageBusy; notice(element("#packageNotice"), "生成交接包不会开始执行。", ""); return;
    }
    title.textContent = value.status === "ready" ? "交接包已准备好" : value.status === "generating" ? "正在生成交接包" : "交接包历史状态";
    status.textContent = packageLabels[value.status] || "状态待确认"; status.className = `state ${packageStateClass(value.status)}`;
    meta.textContent = `包版本 v${value.package_version} · ${formatTime(value.created_at)}${value.supersedes_package_id ? " · 已替代上一版本" : ""}`;
    integrity.textContent = value.integrity_summary ? `完整性摘要：${value.integrity_summary}` : "生成完成后显示完整性摘要";
    if (value.failure_reason) notice(failure, value.failure_reason, "error"); else notice(failure);
    const summary = value.content_summary;
    content.hidden = !summary; if (summary) element("#packageContentSummary").replaceChildren(...packageSummaryRows(summary));
    actions.hidden = !["ready", "generation_failed", "expired"].includes(value.status);
    element("#generatePackageButton").hidden = true; element("#retryPackageButton").hidden = value.status !== "generation_failed"; element("#authorizePackageButton").hidden = value.status !== "expired"; element("#downloadPackageButton").hidden = value.status !== "ready";
    for (const button of actions.querySelectorAll("button")) button.disabled = packageBusy;
    if (value.status === "generating") notice(element("#packageNotice"), "正在生成；离开或刷新页面后，可从当前工单继续查看。", "");
    else if (value.status === "ready") notice(element("#packageNotice"), "下载不代表开始执行。", "");
    else if (value.status === "expired") notice(element("#packageNotice"), "下载权限已过期；重新获取权限不会创建新的包版本。", "blocked");
    else notice(element("#packageNotice"));
    const previous = packages.slice(1); history.hidden = previous.length === 0; historyList.replaceChildren(...previous.map((item) => { const row = document.createElement("div"); row.className = "package-history-row"; const name = document.createElement("strong"); name.textContent = `v${item.package_version} · ${packageLabels[item.status] || "状态待确认"}`; const date = document.createElement("span"); date.textContent = formatTime(item.updated_at || item.created_at); row.append(name, date); return row; }));
  }
  function schedulePackagePoll() { if (packagePoll) { clearTimeout(packagePoll); packagePoll = null; } if (runtime?.manualHandoffEnabled && currentPackage()?.status === "generating") packagePoll = setTimeout(() => loadPackages().catch(() => undefined), 2500); }
  async function loadPackages({ render = true } = {}) {
    if (!runtime?.manualHandoffEnabled || !selectedOrderId) { packages = []; if (render) renderPackage(); return; }
    const body = await request(`/api/production-orders/${encodeURIComponent(selectedOrderId)}/manual-handoff-packages`); packages = body.packages || []; if (render) renderPackage(); schedulePackagePoll();
  }
  function manualError(error) { if (error.status === 403) return "你没有权限操作当前人工任务。"; if (error.status === 404) return "当前工单状态已变化，请刷新后重试。"; if (error.status === 409) return "当前任务已被其他操作更新，请刷新后继续。"; if (error.status === 413) return "候选视频超过单个文件上限，请选择更小的文件。"; if (error.body?.error === "MANUAL_EXECUTION_UPLOAD_NOT_COMPLETED") return "候选作品尚未完成上传，请重新上传后再提交。"; if (error.status === 422) return "请先完成候选作品上传或处理当前提示。"; return "人工执行操作未完成，请稍后重试。"; }
  function candidateStatusLabel(status) { return { upload_pending: "等待上传", uploaded: "已上传，待提交结果", pending_verification: "已上传，等待后续核验", removed: "已移除" }[status] || "状态待确认"; }
  function formatBytes(value) { if (!Number.isFinite(value) || value < 1) return "大小待确认"; if (value >= 1024 * 1024) return `${Math.round(value / 1024 / 1024)} MB`; return `${Math.round(value / 1024)} KB`; }
  function reportPrimaryCandidate(isCorrection = false) {
    const candidates = execution?.candidates || [], latest = execution?.reports?.at(-1), latestPrimaryId = latest?.primary_output?.upload_reference;
    return candidates.find((item) => item.role === "primary_video" && item.status === "uploaded") ||
      (isCorrection && latestPrimaryId ? candidates.find((item) => item.id === latestPrimaryId && item.status === "pending_verification") : null);
  }
  function renderStartPackageMeta() {
    const value = currentPackage(), container = element("#startManualPackageMeta > div");
    if (!container) return;
    const rows = [["交接包版本", value?.package_version ? `v${value.package_version}` : "版本待确认"], ["完整性摘要", value?.integrity_summary || "摘要待确认"]];
    container.replaceChildren(...rows.map(([label, text]) => { const row = document.createElement("div"); row.className = "dialog-snapshot-row"; const name = document.createElement("strong"); name.textContent = label; const valueNode = document.createElement("span"); valueNode.textContent = text; row.append(name, valueNode); return row; }));
  }
  function syncReportFields() {
    const outcome = element("#manualReportOutcome")?.value || "", requiresFields = element("#manualRequiresActionFields"), failureFields = element("#manualFailureFields"), deviation = element("#manualDeviationType")?.value || "";
    if (requiresFields) requiresFields.hidden = outcome !== "requires_action";
    if (failureFields) failureFields.hidden = outcome !== "failed";
    const deviationNote = element("#manualDeviationNote"), deviationLabel = element("#manualDeviationNoteLabel");
    if (deviationNote) { deviationNote.hidden = !deviation; deviationNote.required = Boolean(deviation); }
    if (deviationLabel) deviationLabel.hidden = !deviation;
    const completed = outcome === "completed" || outcome === "cancelled";
    const completedAt = element("#manualReportCompletedAt"); if (completedAt) completedAt.hidden = !completed;
    const submit = element("#confirmManualReportButton"); if (submit) submit.disabled = !outcome || manualBusy;
  }
  function renderManualExecution() {
    const panel = element("#manualExecutionPanel"); if (!runtime?.manualExecutionEnabled) { panel.hidden = true; return; }
    panel.hidden = false;
    const attempt = execution?.current_attempt || null, order = workspace?.orders?.find((item) => item.id === selectedOrderId), packageReady = currentPackage()?.status === "ready";
    const status = attempt?.status || order?.status || "waiting_for_executor"; badge(element("#manualExecutionStatus"), status);
    const meta = element("#manualExecutionMeta");
    if (!attempt) meta.textContent = packageReady ? "交接包已准备好。领取后确认开始，上传候选作品并提交执行结果。" : "请先生成并准备好当前工单的交接包。";
    else if (status === "claimed") meta.textContent = "任务已领取；确认开始后才会记录执行已开始。";
    else if (status === "running") meta.textContent = "执行中。候选作品上传完成后仍需提交执行结果。";
    else if (status === "succeeded") meta.textContent = runtime?.artifactVerificationEnabled ? "执行结果已提交；执行完成不等于工单完成，候选产物仍需服务端核验。" : "执行结果已提交；产物核验将在后续阶段开放，当前工单尚未完成。";
    else if (status === "requires_action") meta.textContent = "当前结果需要处理；完成处理后可以重新检查。";
    else if (status === "failed") meta.textContent = execution?.reports?.at(-1)?.retryability === "retryable" ? "本次执行失败；该问题可重试，可以重新领取。" : "本次执行失败；该问题不可在当前工单重试，请返回上游处理。";
    else if (status === "cancel_requested") meta.textContent = "工单正在取消；请提交已取消结果完成本次记录。";
    else if (status === "cancelled") meta.textContent = "本次人工执行已取消。";
    else meta.textContent = "领取后确认开始，上传候选作品并提交执行结果。";
    const claim = element("#claimManualExecution"); claim.hidden = Boolean(attempt); claim.disabled = manualBusy || !packageReady;
    claim.title = !packageReady && !attempt ? "交接包准备好后才能领取人工任务" : "";
    element("#confirmManualStart").hidden = status !== "claimed"; element("#confirmManualStart").disabled = manualBusy;
    element("#recheckManualExecution").hidden = status !== "requires_action"; element("#recheckManualExecution").disabled = manualBusy;
    const latestReport = execution?.reports?.at(-1);
    element("#reenterManualExecution").hidden = status !== "failed" || latestReport?.retryability !== "retryable"; element("#reenterManualExecution").disabled = manualBusy;
    element("#cancelManualOrder").hidden = !order || ["succeeded", "failed", "cancel_requested", "cancelled"].includes(order.status) || ["succeeded", "cancelled"].includes(status);
    element("#cancelManualOrder").disabled = manualBusy;
    const outputSection = element("#manualOutputSection"); outputSection.hidden = !["running", "succeeded", "requires_action", "cancel_requested"].includes(status);
    const file = element("#manualCandidateFile"); file.disabled = status !== "running" || manualUploadBusy;
    const candidates = execution?.candidates || [], primary = candidates.find((item) => item.role === "primary_video");
    element("#manualCandidateLimit").textContent = runtime.manualExecutionMaxCandidateBytes ? `单个候选视频上限：${formatBytes(runtime.manualExecutionMaxCandidateBytes)}` : "候选视频大小限制由服务端控制。";
    element("#uploadManualCandidate").disabled = status !== "running" || manualUploadBusy || !file.files?.[0] || Boolean(primary && primary.status !== "removed");
    element("#manualCandidateList").replaceChildren(...candidates.map((item) => { const row = document.createElement("div"); row.className = "manual-candidate-row"; const name = document.createElement("strong"); name.textContent = item.original_filename || "候选作品"; const state = document.createElement("span"); const verificationState = item.verification_status ? ` · ${verificationLabels[item.verification_status] || "核验状态待确认"}` : ""; state.textContent = `${item.role === "primary_video" ? "主要视频" : "辅助作品"} · ${candidateStatusLabel(item.status)}${verificationState}`; row.append(name, state); return row; }));
    const canReport = ["running", "cancel_requested"].includes(status);
    element("#submitManualReport").hidden = !canReport; element("#submitManualReport").disabled = manualBusy;
    const reportOutcome = element("#manualReportOutcome"), cancelledOption = reportOutcome?.querySelector("option[value=cancelled]");
    if (cancelledOption) { cancelledOption.hidden = status !== "cancel_requested"; cancelledOption.disabled = status !== "cancel_requested"; }
    syncReportFields();
    const history = element("#manualHistorySection"), historyList = element("#manualHistoryList"), reports = execution?.reports || [];
    history.hidden = !reports.length; historyList.replaceChildren(...reports.map((report) => { const row = document.createElement("div"); row.className = "manual-history-row"; const name = document.createElement("strong"); name.textContent = `第 ${report.report_version} 次记录 · ${outcomeLabels[report.outcome] || "结果待确认"}`; const note = document.createElement("span"); note.textContent = report.operator_note || report.requires_action_reason || report.error_category || `提交于 ${formatTime(report.submitted_at)}`; row.append(name, note); if (latestReport?.id === report.id && !["cancelled"].includes(status)) { const correction = document.createElement("button"); correction.type = "button"; correction.className = "secondary"; correction.textContent = "提交更正报告"; correction.addEventListener("click", () => openManualReport(report)); row.append(correction); } return row; }));
  }
  async function loadExecution({ render = true } = {}) {
    if (!runtime?.manualExecutionEnabled || !selectedOrderId) { execution = null; if (render) renderManualExecution(); return; }
    execution = await request(`/api/production-orders/${encodeURIComponent(selectedOrderId)}/manual-execution`); if (render) renderManualExecution();
  }
  function verificationError(error) { if (error.status === 403) return "你没有权限处理当前候选产物。"; if (error.status === 404) return "当前核验任务或工单不存在，请刷新后重试。"; if (error.status === 409) return "核验输入已更新，请使用最新更正报告重新核验。"; return "候选产物核验操作未完成，请稍后重试。"; }
  function latestExecutionReport() {
    return (execution?.reports || []).filter(Boolean).slice().sort((left, right) =>
      (left.report_version || 0) - (right.report_version || 0) || String(left.submitted_at || "").localeCompare(String(right.submitted_at || "")) || String(left.id || "").localeCompare(String(right.id || ""))).at(-1) || null;
  }
  function verificationInput() {
    const report = latestExecutionReport(), primaryId = report?.primary_output?.upload_reference;
    const primary = execution?.candidates?.find((item) => item.id === primaryId && item.role === "primary_video");
    return { report, primary, ready: report?.outcome === "completed" && Boolean(primary) };
  }
  function jobMatchesVerificationInput(job, report, primary) {
    return Boolean(job && report && primary && job.report_id === report.id && job.candidate_id === primary.id &&
      String(job.primary_output_checksum || "").toLowerCase() === String(primary.checksum || "").toLowerCase());
  }
  function verificationFailureReason(job) {
    if (job?.failure_reason) return job.failure_reason;
    return job?.failure_kind === "technical" ? "系统暂未完成文件检查，请重新核验。" : "候选文件未通过检查，请提交更正报告。";
  }
  function scheduleVerificationPoll(delayMs = 2000, { force = false } = {}) {
    if (verificationPoll) { clearTimeout(verificationPoll); verificationPoll = null; }
    if (runtime?.artifactVerificationEnabled && selectedOrderId && (force || ["queued", "running"].includes(verification?.job?.verification_status))) {
      verificationPoll = setTimeout(() => loadVerification().catch(() => undefined), delayMs);
    }
  }
  function renderVerification() {
    const panel = element("#workVerificationPanel");
    if (!runtime?.artifactVerificationEnabled) { panel.hidden = true; return; }
    panel.hidden = false;
    const job = verification?.job || null, work = verification?.work || null, order = workspace?.orders?.find((item) => item.id === selectedOrderId);
    const { report, primary, ready } = verificationInput();
    const currentJob = jobMatchesVerificationInput(job, report, primary), status = currentJob ? job.verification_status : job ? "stale" : "queued";
    const badgeTarget = element("#workVerificationStatus"); badgeTarget.textContent = status === "stale" ? "待重新核验" : job ? (verificationLabels[status] || "状态待确认") : "未发起"; badgeTarget.className = `state ${job && status !== "stale" ? stateClass(status) : ""}`;
    const meta = element("#workVerificationMeta");
    if (!job) meta.textContent = "执行结果提交后，服务端会读取固定报告与候选对象，核对归属、关联、类型、大小和文件完整性。";
    else if (!currentJob && ready) meta.textContent = "已提交新的更正报告，请使用最新报告重新核验。";
    else if (status === "queued") meta.textContent = "核验已排队；刷新或离开页面不会丢失，状态会自动更新。";
    else if (status === "running") meta.textContent = "正在读取真实候选对象并检查文件完整性，请等待结果。";
    else if (status === "passed") meta.textContent = "候选产物已通过检查并登记作品；正式文件版本已固定。";
    else if (status === "requires_action") meta.textContent = "当前核验需要处理；请先提交更正报告，提交后再重新核验，不会自动登记作品。";
    else if (job.failure_kind === "technical") meta.textContent = "文件检查暂未完成；可以在有限次数内重新核验。技术问题不等于业务失败。";
    else meta.textContent = "候选产物未通过检查；请根据提示处理后提交更正报告。";
    const summary = element("#workVerificationSummary");
    const rows = [];
    if (job) rows.push(["更新时间", formatTime(job.updated_at || job.created_at)]);
    if (currentJob && ["failed", "requires_action"].includes(status)) rows.push(["处理提示", verificationFailureReason(job)]);
    if (!currentJob && ready) rows.push(["处理提示", "请使用最新的更正报告重新核验。"]);
    if (verificationReadError) rows.push(["读取提示", verificationReadError]);
    if (workDeliveryReadError) rows.push(["作品状态", workDeliveryReadError]);
    if (job?.attempts != null) rows.push(["尝试次数", `${job.attempts}/${job.max_attempts}`]);
    if (order?.status === "succeeded" && status !== "passed") rows.push(["工单提醒", "执行完成不等于工单完成"]);
    summary.replaceChildren(...rows.map(([label, text]) => { const row = document.createElement("div"); row.className = "verification-check-row"; const title = document.createElement("strong"); title.textContent = label; const value = document.createElement("span"); value.textContent = text; row.append(title, value); return row; }));
    const requestButton = element("#requestWorkVerification"); requestButton.hidden = !ready || (Boolean(job) && currentJob); requestButton.textContent = job ? "重新核验" : "发起核验"; requestButton.disabled = verificationBusy;
    const retryButton = element("#retryWorkVerification"); retryButton.hidden = !currentJob || job.status !== "failed" || job.failure_kind !== "technical"; retryButton.textContent = "重新核验"; retryButton.disabled = verificationBusy;
    const workCard = element("#workCard"); workCard.hidden = !work;
    if (work) {
      element("#workCardSummary").textContent = `工单已固定主要视频 · ${work.primary_output_media_type || "视频"} · ${formatBytes(work.primary_output_size)}`;
      element("#workAssetVersion").textContent = "正式文件版本已固定";
      element("#workChecksum").textContent = "文件内容已核对";
    }
    let worksLink = element("#worksLibraryLink"), worksDisabled = element("#worksLibraryDisabled");
    if (runtime?.worksEnabled && work && !workDeliveryReadError) {
      if (worksLink.tagName !== "A") {
        const anchor = document.createElement("a"); anchor.id = "worksLibraryLink"; anchor.className = "button-link"; anchor.textContent = "进入作品库检查与交付 →";
        worksLink.replaceWith(anchor); worksLink = anchor;
      }
      worksLink.href = `/works.html?work=${encodeURIComponent(work.id)}&project=${encodeURIComponent(project.id)}&product=${encodeURIComponent(product.id)}`;
      worksLink.hidden = false; worksDisabled.hidden = true;
    } else {
      worksLink.hidden = true; worksDisabled.hidden = false;
      worksDisabled.textContent = workDeliveryReadError
        ? "作品状态读取失败，请刷新当前工单后再进入作品库。"
        : runtime?.worksEnabled ? "作品登记完成后，可从作品库进行检查与交付登记。" : "作品检查与交付功能暂未开放；当前仅可在本工单查看已登记作品。";
    }
    scheduleVerificationPoll(verificationReadError ? 3000 : 2000, { force: Boolean(verificationReadError) });
  }
  async function loadVerification({ render = true } = {}) {
    if (verificationPoll) { clearTimeout(verificationPoll); verificationPoll = null; }
    if (!runtime?.artifactVerificationEnabled || !selectedOrderId) { verification = null; verificationReadError = ""; workDeliveryReadError = ""; if (render) renderVerification(); return; }
    try {
      verification = await request(`/api/production-orders/${encodeURIComponent(selectedOrderId)}/work-verification`);
      workDeliveryReadError = "";
      if (runtime?.worksEnabled && verification?.work?.id) {
        try {
          const deliveryWorkspace = await request(`/api/works/${encodeURIComponent(verification.work.id)}`);
          verification.delivery_work = deliveryWorkspace.work;
        } catch (_error) {
          workDeliveryReadError = "作品状态暂时无法读取，请刷新当前工单。";
        }
      }
      verificationReadError = "";
      if (render) renderVerification();
      scheduleVerificationPoll();
      return verification;
    } catch (error) {
      verificationReadError = "核验状态暂时无法读取，正在继续自动更新。";
      renderVerification();
      scheduleVerificationPoll(3000, { force: true });
      throw error;
    }
  }
  async function loadCloudExecutorStatus() {
    if (cloudStatusRequest) return cloudStatusRequest;
    const pending = (async () => {
      try {
        cloudExecutor = await request("/api/cloud-executor/status");
      } catch (_error) {
        cloudExecutor = { worker: { connection: "offline", last_heartbeat_at: null }, readiness: { status: "requires_action", reason_code: "CLOUD_EXECUTOR_STATUS_UNAVAILABLE" }, worker_state: "offline", current_order: null, current_attempt: null, progress: null, execution: { status: "pending" }, verification: { status: "not_started" }, work: null, delivery: { status: "not_available" }, failure: null };
        renderCloudExecutor();
        return null;
      }
      renderCloudExecutor();
      return cloudExecutor;
    })();
    cloudStatusRequest = pending;
    try { return await pending; }
    finally { if (cloudStatusRequest === pending) cloudStatusRequest = null; }
  }
  function scheduleCloudStatusPoll(delay = cloudStatusPollIntervalMs) {
    if (!cloudStatusPollActive || cloudStatusPoll || cloudStatusPollInFlight) return;
    cloudStatusPoll = setTimeout(async () => {
      cloudStatusPoll = null;
      if (!cloudStatusPollActive || cloudStatusPollInFlight) return;
      cloudStatusPollInFlight = true;
      let available = false;
      try { available = Boolean(await loadCloudExecutorStatus()); }
      finally {
        cloudStatusPollInFlight = false;
        scheduleCloudStatusPoll(available ? cloudStatusPollIntervalMs : Math.max(100, cloudStatusPollIntervalMs * 2));
      }
    }, delay);
  }
  function startCloudStatusPolling() {
    if (cloudStatusPollActive) return;
    cloudStatusPollActive = true;
    scheduleCloudStatusPoll();
  }
  function stopCloudStatusPolling() {
    cloudStatusPollActive = false;
    if (cloudStatusPoll) clearTimeout(cloudStatusPoll);
    cloudStatusPoll = null;
  }
  async function requestWorkVerification() {
    const latestReport = latestExecutionReport(), primaryId = latestReport?.primary_output?.upload_reference;
    if (verificationBusy || !selectedOrderId || latestReport?.outcome !== "completed" || !primaryId) return;
    verificationBusy = true; renderVerification();
    try {
      const accepted = await request(`/api/production-orders/${encodeURIComponent(selectedOrderId)}/work-verification`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({
        execution_attempt_id: execution.current_attempt.id, report_id: latestReport.id, candidate_id: primaryId
      }) });
      verification = { job: accepted.job, work: accepted.work };
      verificationReadError = "";
      renderVerification();
      notice(element("#workVerificationNotice"), "核验请求已受理；执行完成不等于工单完成。", "success");
      try { await loadVerification({ render: false }); }
      catch (_error) { return; }
      renderVerification();
      notice(element("#workVerificationNotice"), "核验请求已受理；执行完成不等于工单完成。", "success");
    } catch (error) { notice(element("#workVerificationNotice"), verificationError(error), "error"); }
    finally { verificationBusy = false; renderVerification(); }
  }
  async function retryWorkVerification() {
    if (verificationBusy || !verification?.job?.id) return;
    verificationBusy = true; renderVerification();
    try { await request(`/api/work-verification-jobs/${encodeURIComponent(verification.job.id)}/retry`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: "{}" }); await loadVerification(); notice(element("#workVerificationNotice"), "技术核验重试已排队。", "success"); }
    catch (error) { notice(element("#workVerificationNotice"), verificationError(error), "error"); }
    finally { verificationBusy = false; renderVerification(); }
  }
  async function claimManualExecution() { if (manualBusy || !selectedOrderId || currentPackage()?.status !== "ready") return; manualBusy = true; renderManualExecution(); const key = crypto.randomUUID(); try { const result = await request(`/api/production-orders/${encodeURIComponent(selectedOrderId)}/manual-execution/claim`, { method: "POST", headers: { "idempotency-key": key }, body: JSON.stringify({ package_id: currentPackageId() }) }); await loadExecution({ render: false }); renderManualExecution(); notice(element("#manualExecutionNotice"), result.replayed ? "已恢复同一次领取请求。" : "任务已领取，请确认开始。", "success"); } catch (error) { notice(element("#manualExecutionNotice"), manualError(error), "error"); } finally { manualBusy = false; renderManualExecution(); } }
  function openStartManual() { if (manualBusy || !execution?.current_attempt) return; element("#startManualError").textContent = ""; renderStartPackageMeta(); element("#startManualDialog").showModal(); }
  async function submitStartManual(event) { event.preventDefault(); if (manualBusy || !execution?.current_attempt) return; manualBusy = true; element("#confirmStartManualButton").disabled = true; try { await request(`/api/manual-execution-attempts/${encodeURIComponent(execution.current_attempt.id)}/start`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: "{}" }); element("#startManualDialog").close(); await loadExecution({ render: false }); renderManualExecution(); notice(element("#manualExecutionNotice"), "已确认开始人工执行。", "success"); } catch (error) { element("#startManualError").textContent = manualError(error); } finally { manualBusy = false; element("#confirmStartManualButton").disabled = false; renderManualExecution(); } }
  async function checksum(file) { const bytes = await file.arrayBuffer(); const hash = await crypto.subtle.digest("SHA-256", bytes); return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0")).join(""); }
  async function uploadManualCandidate() { const file = element("#manualCandidateFile").files?.[0], attempt = execution?.current_attempt; if (manualUploadBusy || !file || !attempt) return; manualUploadBusy = true; renderManualExecution(); try { const digest = await checksum(file); const authorized = await request(`/api/manual-execution-attempts/${encodeURIComponent(attempt.id)}/candidates/upload-authorizations`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ role: "primary_video", original_filename: file.name, media_type: file.type || "video/mp4", size: file.size, checksum: digest }) }); await request(`/api/manual-execution-candidate-uploads/${encodeURIComponent(authorized.candidate.id)}`, { method: "PUT", headers: { "content-type": file.type || "video/mp4", "x-manual-upload-token": authorized.upload_token }, body: file }); await request(`/api/manual-execution-attempts/${encodeURIComponent(attempt.id)}/candidates/${encodeURIComponent(authorized.candidate.id)}/complete`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ upload_token: authorized.upload_token }) }); element("#manualCandidateFile").value = ""; await loadExecution({ render: false }); renderManualExecution(); notice(element("#manualExecutionNotice"), "候选作品已上传，等待提交结果。", "success"); } catch (error) { notice(element("#manualExecutionNotice"), manualError(error), "error"); } finally { manualUploadBusy = false; renderManualExecution(); } }
  function openManualReport(report = null) { if (manualBusy || !execution?.current_attempt) return; const correction = report || execution.reports?.at(-1) || null; manualCorrectionReportId = correction?.id || null; element("#reportManualForm").reset(); element("#reportManualDialogTitle").textContent = correction ? "提交更正报告" : "记录本次结果"; element("#reportManualError").textContent = ""; const hint = element("#manualReportCorrectionHint"); hint.hidden = !correction; if (correction) hint.textContent = `本次更正将替代第 ${correction.report_version} 版记录，原记录会保留。请重新选择结果。`; syncReportFields(); element("#reportManualDialog").showModal(); }
  async function submitManualReport(event) {
    event.preventDefault(); if (manualBusy || !execution?.current_attempt) return;
    const outcome = element("#manualReportOutcome").value, isCorrection = Boolean(manualCorrectionReportId), primary = reportPrimaryCandidate(isCorrection), operatorNote = element("#manualReportReason").value.trim(), deviationCode = element("#manualDeviationType").value, deviationNote = element("#manualDeviationNote").value.trim();
    const errorBox = element("#reportManualError"); errorBox.textContent = "";
    if (!outcome) { errorBox.textContent = "请选择执行结果。"; return; }
    if (outcome === "completed" && !primary) { errorBox.textContent = "请先上传主要视频候选作品。"; return; }
    if (outcome === "requires_action" && !element("#manualRequiresActionReason").value.trim()) { errorBox.textContent = "请说明需要处理的事项与恢复要求。"; return; }
    if (outcome === "failed" && (!element("#manualFailureCategory").value || !element("#manualFailureStage").value.trim() || !element("#manualRetryability").value)) { errorBox.textContent = "请填写失败分类、阶段和是否可重试。"; return; }
    if (outcome === "cancelled" && execution.current_attempt.status !== "cancel_requested") { errorBox.textContent = "只有取消中的工单可以确认停止。"; return; }
    if (deviationCode && !deviationNote) { errorBox.textContent = "请选择偏差后填写偏差说明。"; return; }
    const body = { report_id: crypto.randomUUID(), outcome, operator_note: operatorNote, deviations: deviationCode ? [{ code: deviationCode, note: deviationNote }] : [] };
    if (isCorrection) body.supersedes_report_id = manualCorrectionReportId;
    if (outcome === "completed") body.primary_candidate_id = primary.id;
    if (outcome === "requires_action") body.requires_action_reason = element("#manualRequiresActionReason").value.trim();
    if (outcome === "failed") { body.error_category = element("#manualFailureCategory").value; body.failure_stage = element("#manualFailureStage").value.trim(); body.retryability = element("#manualRetryability").value; }
    const completedAt = element("#manualReportCompletedAt").value; if ((outcome === "completed" || outcome === "cancelled") && completedAt) body.completed_at = new Date(completedAt).toISOString();
    manualBusy = true; element("#confirmManualReportButton").disabled = true;
    try { await request(`/api/manual-execution-attempts/${encodeURIComponent(execution.current_attempt.id)}/reports`, { method: "POST", headers: { "idempotency-key": body.report_id }, body: JSON.stringify(body) }); element("#reportManualDialog").close(); await loadWorkspace(); notice(element("#manualExecutionNotice"), isCorrection ? "更正报告已提交，旧记录仍会保留。" : outcome === "completed" ? "执行结果已提交，候选作品等待后续核验。" : "执行结果已记录。", "success"); }
    catch (error) { errorBox.textContent = manualError(error); }
    finally { manualBusy = false; element("#confirmManualReportButton").disabled = false; renderManualExecution(); }
  }
  async function recheckManualExecution() { if (manualBusy || !execution?.current_attempt) return; element("#manualRecheckReason").value = ""; element("#recheckManualError").textContent = ""; element("#confirmRecheckManualButton").disabled = true; element("#recheckManualDialog").showModal(); }
  async function submitRecheckManual(event) { event.preventDefault(); if (manualBusy || !execution?.current_attempt) return; const note = element("#manualRecheckReason").value.trim(); if (!note) { element("#recheckManualError").textContent = "请填写处理说明。"; return; } manualBusy = true; element("#confirmRecheckManualButton").disabled = true; try { await request(`/api/manual-execution-attempts/${encodeURIComponent(execution.current_attempt.id)}/recheck`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ resolution_note: note }) }); element("#recheckManualDialog").close(); await loadWorkspace(); } catch (error) { element("#recheckManualError").textContent = manualError(error); } finally { manualBusy = false; element("#confirmRecheckManualButton").disabled = false; renderManualExecution(); } }
  async function reenterManualExecution() { const attempt = execution?.current_attempt; if (manualBusy || !attempt) return; manualBusy = true; renderManualExecution(); try { await request(`/api/manual-execution-attempts/${encodeURIComponent(attempt.id)}/reenter`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: "{}" }); await loadWorkspace(); } catch (error) { notice(element("#manualExecutionNotice"), manualError(error), "error"); } finally { manualBusy = false; renderManualExecution(); } }
  function cancelManualOrder() { if (manualBusy || !selectedOrderId) return; element("#cancelManualError").textContent = ""; element("#cancelManualDialog").showModal(); }
  async function submitCancelManual(event) { event.preventDefault(); if (manualBusy || !selectedOrderId) return; manualBusy = true; element("#confirmCancelManualButton").disabled = true; try { await request(`/api/production-orders/${encodeURIComponent(selectedOrderId)}/cancel`, { method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: "{}" }); element("#cancelManualDialog").close(); await loadWorkspace(); } catch (error) { element("#cancelManualError").textContent = manualError(error); } finally { manualBusy = false; element("#confirmCancelManualButton").disabled = false; renderManualExecution(); } }
  function render() { renderContext(); renderGate(); renderTaskSummary(); renderCloudExecutor(); renderOrders(); renderDetail(); renderPackage(); renderManualExecution(); renderVerification(); element("#productionWorkspace").hidden = false; }
  async function loadWorkspace() { workspace = await request(`/api/products/${encodeURIComponent(product.id)}/production-workspace${selectedOrderId ? `?orderId=${encodeURIComponent(selectedOrderId)}` : ""}`); selectedOrderId = workspace.orders.find((order) => order.id === selectedOrderId)?.id || workspace.selected_order?.id || workspace.orders.at(-1)?.id || null; workspace.selected_order = workspace.orders.find((order) => order.id === selectedOrderId) || null; await loadCloudExecutorStatus(); await loadPackages({ render: false }); await loadExecution({ render: false }); try { await loadVerification({ render: false }); } catch (_error) { if (!runtime?.artifactVerificationEnabled || !selectedOrderId) throw _error; } render(); }
  function showBootstrapError(message = "生成与交付工作区加载失败，请刷新重试。") {
    bootstrapFailed = true;
    const pageNotice = element("#pageNotice");
    pageNotice.dataset.bootstrapError = "true";
    notice(pageNotice, message, "error");
    document.querySelectorAll('#mainContent [data-recommended-action="true"]').forEach((control) => control.removeAttribute("data-recommended-action"));
    element("#refreshProduction").setAttribute("data-recommended-action", "true");
  }
  function clearBootstrapError() {
    bootstrapFailed = false;
    const pageNotice = element("#pageNotice");
    if (pageNotice.dataset.bootstrapError === "true") notice(pageNotice);
    delete pageNotice.dataset.bootstrapError;
  }
  async function bootstrap() {
    stopCloudStatusPolling();
    try {
      runtime = await request("/api/runtime");
      if (!runtime.productionOrdersEnabled) {
        clearBootstrapError();
        notice(element("#pageNotice"), "生成与交付功能尚未开放。", "blocked");
        return;
      }
      project = (await request(`/api/projects/${encodeURIComponent(projectId)}`)).project;
      product = project.products.find((item) => item.id === requestedProductId) || project.products[0];
      if (!product) return location.replace(`/project.html?id=${encodeURIComponent(project.id)}`);
      await loadWorkspace();
      clearBootstrapError();
      startCloudStatusPolling();
    } catch (_error) {
      showBootstrapError();
    }
  }
  async function refreshProduction() {
    if (bootstrapFailed || !runtime || !project || !product) return bootstrap();
    try {
      await loadWorkspace();
      clearBootstrapError();
    } catch (_error) {
      showBootstrapError("当前生产工单读取失败，请刷新重试。");
    }
  }
  function openCreateOrder() { if (!canCreateOrder() || creating) return; pendingCreateKey = null; element("#createOrderError").textContent = ""; element("#createOrderForm").reset(); renderDialogSnapshot(); element("#createOrderDialog").showModal(); }
  function renderDialogSnapshot() { const plan = workspace.current_plan, upstream = plan?.upstream_snapshot || {}; element("#dialogSnapshot").replaceChildren(...[["商品快照", short(upstream.product_revision_id)], ["已批准文案", short(upstream.copy_version_id)], ["已确认人物", short(upstream.avatar_selection_id)], ["视频方案", plan ? `v${plan.version_number}` : "未就绪"]].map(([label, value]) => { const row = document.createElement("div"); row.className = "dialog-snapshot-row"; const name = document.createElement("strong"); name.textContent = label; const meta = document.createElement("span"); meta.textContent = value; row.append(name, meta); return row; })); }
  async function submitCreate(event) { event.preventDefault(); if (creating || !canCreateOrder()) return; const selected = document.querySelector("input[name=executionPurpose]:checked"); if (!selected) return; creating = true; const button = element("#confirmCreateOrder"); button.disabled = true; pendingCreateKey ||= crypto.randomUUID(); element("#createOrderError").textContent = "";
    try { const result = await request(`/api/products/${encodeURIComponent(product.id)}/production-orders`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": pendingCreateKey }, body: JSON.stringify({ video_plan_version_id: workspace.current_plan.id, execution_purpose: selected.value }) }); selectedOrderId = result.order.id; element("#createOrderDialog").close(); await loadWorkspace(); notice(element("#pageNotice"), result.replayed ? "创建请求已受理，已为你打开对应工单。" : "生产工单已创建，已提交 Cloud Executor 等待领取。", "success"); pendingCreateKey = null; }
    catch (error) { if (error.status === 409) element("#createOrderError").textContent = "创建信息已变化或请求已冲突，请刷新后重新确认。"; else if (error.status === 422) element("#createOrderError").textContent = (error.body?.reasons || []).map((reason) => gateLabels[reason] || "当前方案不可创建工单").join("；") || "当前方案不可创建工单，请返回视频方案处理。"; else element("#createOrderError").textContent = "创建未完成（技术原因），你的操作未生效；可以使用同一目的重试。"; }
    finally { creating = false; button.disabled = !document.querySelector("input[name=executionPurpose]:checked"); }
  }
  function packageError(error) { if (error.status === 403 || error.body?.error === "MANUAL_HANDOFF_FORBIDDEN") return "你没有权限操作当前交接包。"; if (error.status === 404) return "当前工单或交接包不存在，请刷新后重试。"; if (error.status === 409) return "请求信息已变化，请刷新后重试。"; if (error.body?.error === "MANUAL_HANDOFF_PACKAGE_NOT_READY") return "交接包仍在生成，请稍后查看。"; return "交接包操作未完成，请稍后重试。"; }
  async function generatePackage() { if (packageBusy || !selectedOrderId) return; packageBusy = true; pendingPackageKey ||= crypto.randomUUID(); renderPackage(); try { const result = await request(`/api/production-orders/${encodeURIComponent(selectedOrderId)}/manual-handoff-packages`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": pendingPackageKey }, body: JSON.stringify({ generation_request_id: pendingPackageKey }) }); pendingPackageKey = null; await loadPackages(); notice(element("#packageNotice"), result.replayed ? "已恢复同一次生成请求；离开或刷新页面后仍可继续查看。" : "生成请求已受理；离开或刷新页面后仍可继续查看。", ""); } catch (error) { notice(element("#packageNotice"), packageError(error), "error"); } finally { packageBusy = false; renderPackage(); } }
  async function retryPackage() { const value = currentPackage(), id = currentPackageId(value); if (packageBusy || !value || !id) return; packageBusy = true; pendingRetryKey ||= crypto.randomUUID(); renderPackage(); try { const result = await request(`/api/manual-handoff-packages/${encodeURIComponent(id)}/retry`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": pendingRetryKey }, body: JSON.stringify({ generation_request_id: pendingRetryKey }) }); pendingRetryKey = null; await loadPackages(); notice(element("#packageNotice"), result.replayed ? "已恢复同一次重试请求。" : "重试请求已受理；不会创建新的包版本。", ""); } catch (error) { notice(element("#packageNotice"), packageError(error), "error"); } finally { packageBusy = false; renderPackage(); } }
  async function authorizePackage() { const value = currentPackage(), id = currentPackageId(value); if (packageBusy || !value || !id) return; packageBusy = true; renderPackage(); try { await request(`/api/manual-handoff-packages/${encodeURIComponent(id)}/download-authorizations`, { method: "POST" }); await loadPackages(); notice(element("#packageNotice"), "下载权限已重新获取；包版本未改变。", ""); } catch (error) { notice(element("#packageNotice"), packageError(error), "error"); } finally { packageBusy = false; renderPackage(); } }
  async function downloadPackage() { const value = currentPackage(), id = currentPackageId(value); if (packageBusy || !value || !id) return; packageBusy = true; renderPackage(); try { await request(`/api/manual-handoff-packages/${encodeURIComponent(id)}/download-authorizations`, { method: "POST" }); await loadPackages(); const link = document.createElement("a"); link.href = `/api/manual-handoff-packages/${encodeURIComponent(id)}/download`; link.download = `manual-handoff-${id}.zip`; link.style.position = "fixed"; link.style.left = "-10000px"; link.style.top = "-10000px"; document.body.append(link); link.click(); setTimeout(() => link.remove(), 1000); } catch (error) { notice(element("#packageNotice"), packageError(error), "error"); } finally { packageBusy = false; renderPackage(); } }
  element("#createOrderButton").addEventListener("click", openCreateOrder); element("#createOrderEmpty").addEventListener("click", openCreateOrder); element("#createOrderForm").addEventListener("submit", submitCreate); element("#cancelCreateOrder").addEventListener("click", () => element("#createOrderDialog").close()); element("#closeCreateOrder").addEventListener("click", () => element("#createOrderDialog").close());
  document.querySelectorAll("input[name=executionPurpose]").forEach((input) => input.addEventListener("change", () => { if (!creating) element("#confirmCreateOrder").disabled = false; }));
  element("#generatePackageButton").addEventListener("click", generatePackage); element("#retryPackageButton").addEventListener("click", retryPackage); element("#authorizePackageButton").addEventListener("click", authorizePackage); element("#downloadPackageButton").addEventListener("click", downloadPackage);
  element("#requestWorkVerification").addEventListener("click", requestWorkVerification); element("#retryWorkVerification").addEventListener("click", retryWorkVerification);
  element("#claimManualExecution").addEventListener("click", claimManualExecution); element("#confirmManualStart").addEventListener("click", openStartManual); element("#startManualForm").addEventListener("submit", submitStartManual); element("#uploadManualCandidate").addEventListener("click", uploadManualCandidate); element("#manualCandidateFile").addEventListener("change", renderManualExecution); element("#submitManualReport").addEventListener("click", openManualReport); element("#reportManualForm").addEventListener("submit", submitManualReport); element("#recheckManualExecution").addEventListener("click", recheckManualExecution); element("#recheckManualForm").addEventListener("submit", submitRecheckManual); element("#reenterManualExecution").addEventListener("click", reenterManualExecution); element("#cancelManualOrder").addEventListener("click", cancelManualOrder); element("#cancelManualForm").addEventListener("submit", submitCancelManual);
  element("#manualReportOutcome").addEventListener("change", syncReportFields); element("#manualDeviationType").addEventListener("change", syncReportFields); element("#manualRecheckReason").addEventListener("input", () => { element("#confirmRecheckManualButton").disabled = !element("#manualRecheckReason").value.trim(); });
  element("#reportManualDialog").addEventListener("close", () => { manualCorrectionReportId = null; element("#reportManualDialogTitle").textContent = "记录本次结果"; element("#manualReportCorrectionHint").hidden = true; syncReportFields(); });
  document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => element(`#${button.dataset.closeDialog}`).close()));
  element("#mobileOrderTrigger").addEventListener("click", () => element("#orderDrawer").showModal()); element("#closeOrderDrawer").addEventListener("click", () => element("#orderDrawer").close()); element("#refreshProduction").addEventListener("click", refreshProduction);
  element("#productSelector").addEventListener("change", async (event) => { product = project.products.find((item) => item.id === event.currentTarget.value); selectedOrderId = null; await loadWorkspace(); });
  window.addEventListener("pagehide", stopCloudStatusPolling);
  window.addEventListener("beforeunload", stopCloudStatusPolling);
  if (!projectId) { notice(element("#pageNotice"), "缺少项目上下文，请从项目页面重新进入。", "error"); return; }
  await bootstrap();
})();
