(() => {
  const ACTIONS = Object.freeze({
    return_to_video_plan: Object.freeze({ stage: "production", kind: "navigate", label: "返回视频方案" }),
    create_production_order: Object.freeze({ stage: "production", kind: "command", label: "创建生产工单" }),
    generate_handoff_package: Object.freeze({ stage: "production", kind: "command", label: "生成生产交接资料" }),
    retry_handoff_package: Object.freeze({ stage: "production", kind: "command", label: "经人工确认重试交接资料" }),
    authorize_handoff_download: Object.freeze({ stage: "production", kind: "command", label: "重新获取下载授权" }),
    view_production_failure_details: Object.freeze({ stage: "production", kind: "focus", label: "查看失败详情" }),
    view_verification_details: Object.freeze({ stage: "production", kind: "focus", label: "查看核验详情" }),
    review_production_work: Object.freeze({ stage: "production", kind: "navigate", label: "进入作品库检查" }),
    view_production_rework: Object.freeze({ stage: "production", kind: "navigate", label: "查看返工要求" }),
    deliver_production_work: Object.freeze({ stage: "production", kind: "navigate", label: "进入作品库登记交付" }),
    view_production_delivery: Object.freeze({ stage: "production", kind: "navigate", label: "查看交付记录并完成真实下载验收" }),
    retry_production_read: Object.freeze({ stage: "production", kind: "refresh", label: "刷新当前工单" })
  });
  const ORDER_LABELS = {
    waiting_for_executor: "等待执行", claimed: "已领取", running: "执行中", requires_action: "需人工处理",
    failed: "已失败", cancel_requested: "取消中", cancelled: "已取消", succeeded: "已生成"
  };
  const PACKAGE_LABELS = {
    generating: "准备中", generation_failed: "准备失败", ready: "已就绪", expired: "授权过期",
    superseded: "已被替代", revoked: "已撤销"
  };
  const WORK_LABELS = {
    pending_review: "待检查", rework_required: "需返工", deliverable: "可交付", delivered: "已交付"
  };
  const VERIFICATION_LABELS = {
    not_started: "未发起", pending: "核验中", passed: "已通过", failed: "核验失败", requires_action: "需人工处理"
  };
  const byId = (id) => document.getElementById(id);
  const ambiguousWriteError = (error) => !Number.isInteger(error?.status) || error.status === 408 ||
    error.status >= 500 || [404, 409, 422].includes(error.status);
  const csrf = () => decodeURIComponent((document.cookie.split(";").map((part) => part.trim())
    .find((part) => part.startsWith("hifly_identity_csrf=")) || "=").split("=").slice(1).join("="));

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.method && options.method !== "GET") {
      headers.set("x-identity-csrf", csrf());
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
    }
    const response = await fetch(url, { credentials: "same-origin", ...options, headers });
    if ([401, 403].includes(response.status)) {
      location.replace("/login.html");
      throw Object.assign(new Error("AUTH_REQUIRED"), { status: response.status });
    }
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.error), { status: response.status, body });
    return body;
  }

  function ownedAction(value) {
    if (!value || typeof value !== "object" || !Object.hasOwn(ACTIONS, value.code)) return null;
    const registered = ACTIONS[value.code];
    if (value.stage !== registered.stage || value.kind !== registered.kind) return null;
    return { code: value.code, ...registered };
  }

  function stageUrl(projectId, productId, stage, projection, orderId = null) {
    const url = new URL("/workspace.html", location.origin);
    url.searchParams.set("project", projectId);
    url.searchParams.set("product", productId);
    url.searchParams.set("stage", stage);
    const target = projection?.stages?.find((item) => item.code === stage);
    if (stage === "product_content" && projection?.product?.current_revision_id) {
      url.searchParams.set("revision", projection.product.current_revision_id);
    }
    if (stage === "copy" && target?.current_object?.id) url.searchParams.set("copy", target.current_object.id);
    if (stage === "video_plan" && target?.current_object?.id) url.searchParams.set("plan", target.current_object.id);
    if (stage === "production" && orderId) url.searchParams.set("orderId", orderId);
    return `${url.pathname}${url.search}`;
  }

  function legacyProductionUrl(projectId, productId, orderId) {
    const url = new URL("/production.html", location.origin);
    url.searchParams.set("project", projectId);
    url.searchParams.set("product", productId);
    if (orderId) url.searchParams.set("orderId", orderId);
    return `${url.pathname}${url.search}`;
  }

  async function start({ projectId, productId, orderId = null }) {
    const panel = byId("productionWorkspacePanel");
    const loading = byId("productionWorkspaceLoading");
    const body = byId("productionWorkspaceBody");
    const primary = byId("workspacePrimaryAction");
    const actionLabel = byId("workspaceActionLabel");
    const notice = byId("productionWorkspaceNotice");
    let project = null;
    let projection = null;
    let production = null;
    let activeProductId = productId;
    let selectedOrderId = orderId;
    let requestEpoch = 0;
    let busy = false;
    let readFailed = false;
    let lastOrderTriggerId = orderId;
    let selectedProductTrigger = null;
    let createTrigger = null;
    let createIntentKey = null;

    document.body.dataset.workspaceStage = "production";
    document.body.dataset.mobileLayer = "detail";
    byId("editor").hidden = true;
    byId("copyWorkspacePanel").hidden = true;
    byId("avatarWorkspacePanel").hidden = true;
    byId("videoPlanWorkspacePanel").hidden = true;
    panel.hidden = false;

    function setMobileLayer(layer, focus = false) {
      panel.dataset.productionMobileLayer = layer;
      if (!focus) return;
      if (layer === "detail") byId("productionTaskTitle").focus();
      else currentOrderTrigger()?.focus();
    }

    function currentOrderTrigger() {
      const buttons = [...byId("productionOrderList").querySelectorAll("button[data-order-id]")];
      return buttons.find((button) => button.dataset.orderId === (selectedOrderId || lastOrderTriggerId)) || null;
    }

    function invalidateCreateIntent({ restoreFocus = false } = {}) {
      const trigger = createTrigger;
      const dialog = byId("productionCreateDialog");
      if (dialog.open) dialog.close();
      createIntentKey = null;
      createTrigger = null;
      byId("productionCreateError").textContent = "";
      if (restoreFocus && trigger?.isConnected) trigger.focus();
    }

    function clearRecommendedAction() {
      for (const element of document.querySelectorAll('[data-recommended-action="true"]')) {
        element.removeAttribute("data-recommended-action");
      }
      primary.removeAttribute("data-action-code");
      primary.removeAttribute("data-recommended-action");
    }

    function renderAction() {
      clearRecommendedAction();
      if (readFailed && !busy) {
        primary.disabled = false;
        primary.textContent = "刷新当前工单";
        primary.dataset.actionCode = "retry_production_read";
        primary.dataset.recommendedAction = "true";
        actionLabel.textContent = "刷新当前工单";
        return;
      }
      const action = ownedAction(projection?.recommended_action);
      if (!action || busy) {
        primary.disabled = true;
        primary.textContent = busy ? "处理中" : "当前无需操作";
        actionLabel.textContent = busy ? "正在读取服务端最新状态" : "当前没有安全的推荐操作";
        return;
      }
      primary.disabled = false;
      primary.textContent = action.label;
      primary.dataset.actionCode = action.code;
      primary.dataset.recommendedAction = "true";
      actionLabel.textContent = action.label;
    }

    function disableStageLinks() {
      for (const link of document.querySelectorAll("[data-stage-code]")) {
        link.removeAttribute("href");
        link.setAttribute("aria-disabled", "true");
        (link.closest("li") || link).dataset.stageState = "blocked";
      }
    }

    function syncStageLinks() {
      for (const link of document.querySelectorAll("[data-stage-code]")) {
        const stage = link.dataset.stageCode;
        const value = projection?.stages?.find((item) => item.code === stage);
        if (!value || value.implementation_status !== "workspace" || value.read_status !== "ok") {
          link.removeAttribute("href");
          link.setAttribute("aria-disabled", "true");
          (link.closest("li") || link).dataset.stageState = "error";
          continue;
        }
        link.href = stageUrl(projectId, activeProductId, stage, projection, selectedOrderId);
        link.removeAttribute("aria-disabled");
        (link.closest("li") || link).dataset.stageState = stage === "production" ? "current" :
          value.navigation_state || "available";
      }
    }

    function orderButton(order) {
      const wrapper = document.createElement("div");
      wrapper.setAttribute("role", "listitem");
      const button = document.createElement("button");
      button.type = "button";
      button.className = "production-order-item";
      button.dataset.orderId = order.id;
      button.setAttribute("aria-current", String(order.id === selectedOrderId));
      button.setAttribute("aria-label", `生产工单 ${ORDER_LABELS[order.status] || "状态待确认"}`);
      const title = document.createElement("strong");
      title.textContent = order.execution_purpose === "rework" ? "返工生产工单" : "生产工单";
      const meta = document.createElement("span");
      meta.textContent = ORDER_LABELS[order.status] || "状态待确认";
      button.append(title, meta);
      button.addEventListener("click", async () => {
        lastOrderTriggerId = order.id;
        selectedOrderId = order.id;
        setMobileLayer("detail");
        const url = stageUrl(projectId, activeProductId, "production", projection, selectedOrderId);
        history.pushState({ productId: activeProductId, orderId: selectedOrderId }, "", url);
        await load({ focus: true });
      });
      wrapper.append(button);
      return wrapper;
    }

    function productButton(item) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.setAttribute("aria-current", String(item.id === activeProductId));
      button.textContent = item.revision?.product_name || "未命名商品";
      if (item.id === activeProductId) selectedProductTrigger = button;
      button.addEventListener("click", async () => {
        invalidateCreateIntent();
        selectedProductTrigger = button;
        activeProductId = item.id;
        selectedOrderId = null;
        history.pushState({ productId: item.id, orderId: null }, "",
          stageUrl(projectId, item.id, "production", projection));
        document.body.dataset.mobileLayer = "detail";
        setMobileLayer("detail");
        await load({ focus: true });
      });
      return button;
    }

    function renderProducts() {
      const list = byId("productList");
      list.replaceChildren(...(project?.products || []).map(productButton));
      byId("projectName").textContent = project?.name || "项目";
    }

    function renderProduction() {
      const stage = projection.stages.find((item) => item.code === "production");
      production = stage.production;
      const selected = production.selected_order;
      const packageValue = production.package;
      const attempt = production.execution?.current_attempt;
      const verification = production.verification?.job;
      const work = production.work;
      const readErrors = new Set(production.read_errors || []);
      byId("productionOrderList").replaceChildren(...production.orders.map(orderButton));
      byId("productionOrderEmpty").hidden = production.orders.length > 0;
      byId("productionTaskTitle").textContent = stage.business_status;
      byId("productionTaskState").textContent = stage.business_status;
      byId("productionTaskState").className = `state ${stage.blocker_codes.length ? "blocked" : "ready"}`;
      byId("productionTaskDescription").textContent = stage.blocker_codes.length
        ? "当前状态不会自动重试、重新领取或创建下一单。" : "服务端持久真值允许进入下一步。";
      byId("productionOrderSummary").textContent = selected ? ORDER_LABELS[selected.status] || "状态待确认" : "尚无工单";
      byId("productionPackageSummary").textContent = readErrors.has("handoff") ? "读取失败" :
        packageValue ? PACKAGE_LABELS[packageValue.status] || "状态待确认" : "未生成";
      byId("productionExecutionSummary").textContent = readErrors.has("execution") ? "读取失败" :
        attempt ? ORDER_LABELS[attempt.status] || "状态待确认" : "未开始";
      byId("productionVerificationSummary").textContent = readErrors.has("verification") ? "读取失败" :
        verification ? VERIFICATION_LABELS[verification.verification_status] ||
          VERIFICATION_LABELS[verification.status] || "状态待确认" : "未发起";
      byId("productionWorkSummary").textContent = readErrors.has("work") ? "读取失败" :
        work ? WORK_LABELS[work.delivery_status] || "状态待确认" : "尚未登记";
      byId("productionTechnicalOrder").textContent = selected?.id || "无";
      byId("productionTechnicalAttempt").textContent = attempt?.id || "无";
      byId("productionTechnicalVerification").textContent = verification?.id || "无";
      byId("productionTechnicalWork").textContent = work?.id || "无";
      notice.textContent = stage.blocker_codes.includes("PRODUCTION_ACTIVATION_NOT_PROVEN")
        ? "页面没有组织级 eligible、active attempts 或 Worker 启停真值，因此保持失败关闭。" : "";
      renderSupportingContext(stage);
      loading.hidden = true;
      body.hidden = false;
      syncStageLinks();
      renderAction();
    }

    function renderSupportingContext(stage) {
      const action = ownedAction(projection?.recommended_action);
      const selected = stage.production?.selected_order;
      byId("taskSummaryTitle").textContent = "当前生产任务";
      byId("taskContext").textContent = selected
        ? `${projection.product.name || "当前商品"} · ${ORDER_LABELS[selected.status] || "生产状态待确认"}`
        : `${projection.product.name || "当前商品"} · 尚无生产工单`;
      byId("taskStatus").textContent = stage.business_status;
      byId("taskStatus").className = `state ${stage.blocker_codes.length ? "blocked" : "ready"}`;
      byId("saveStatus").textContent = "服务端状态已同步";
      byId("taskNext").textContent = action?.label || "当前无需操作";
      byId("taskBlocker").hidden = stage.blocker_codes.length === 0;
      byId("taskBlocker").textContent = stage.blocker_codes.length
        ? "当前状态保持失败关闭，不会自动重试、重新领取或创建下一单。" : "";
      byId("workspaceProjectionVersion").textContent = `v${projection.projection_version} · 动作表 v${projection.action_registry_version}`;
      byId("workspaceTechnicalStage").textContent = "生产";
      byId("workspaceTechnicalObjectRow").hidden = !selected;
      byId("workspaceTechnicalObject").textContent = selected ? `production_order · ${selected.id}` : "未载入";
    }

    function clearProductionTruth() {
      production = null;
      byId("productionOrderList").replaceChildren();
      byId("productionOrderEmpty").hidden = false;
      byId("productionOrderSummary").textContent = "未读取";
      byId("productionPackageSummary").textContent = "未读取";
      byId("productionExecutionSummary").textContent = "未读取";
      byId("productionVerificationSummary").textContent = "未读取";
      byId("productionWorkSummary").textContent = "未读取";
      byId("productionTechnicalOrder").textContent = "无";
      byId("productionTechnicalAttempt").textContent = "无";
      byId("productionTechnicalVerification").textContent = "无";
      byId("productionTechnicalWork").textContent = "无";
      byId("productionTechnicalDetails").open = false;
      notice.textContent = "";
      byId("taskSummaryTitle").textContent = "当前生产任务";
      byId("taskContext").textContent = "当前商品生产真值暂时无法读取";
      byId("taskStatus").textContent = "读取失败";
      byId("taskStatus").className = "state failure";
      byId("saveStatus").textContent = "服务端状态未同步";
      byId("taskNext").textContent = "刷新当前工单";
      byId("taskBlocker").hidden = false;
      byId("taskBlocker").textContent = "读取成功前不使用上一工单的生产、核验或作品状态。";
      byId("workspaceProjectionVersion").textContent = "读取失败";
      byId("workspaceTechnicalStage").textContent = "生产";
      byId("workspaceTechnicalObjectRow").hidden = true;
      byId("workspaceTechnicalObject").textContent = "未载入";
    }

    function renderPendingAuthority() {
      clearProductionTruth();
      const item = project?.products?.find((productItem) => productItem.id === activeProductId);
      const name = item?.revision?.product_name || "当前商品";
      byId("taskSummaryTitle").textContent = "当前生产任务";
      byId("taskContext").textContent = `正在读取 ${name} 的生产状态`;
      byId("taskStatus").textContent = "正在读取服务端";
      byId("taskStatus").className = "state";
      byId("saveStatus").textContent = "等待服务端状态";
      byId("taskNext").textContent = "等待读取完成";
      byId("taskBlocker").hidden = false;
      byId("taskBlocker").textContent = "读取完成前不使用上一商品的生产真值。";
      byId("workspaceProjectionVersion").textContent = "正在读取";
      byId("productionTaskTitle").textContent = "正在读取生产状态";
      byId("productionTaskState").textContent = "正在读取";
      byId("productionTaskState").className = "state";
      byId("productionTaskDescription").textContent = "正在核对当前商品的服务端持久真值。";
    }

    function failRead() {
      readFailed = true;
      projection = null;
      clearProductionTruth();
      loading.hidden = true;
      body.hidden = false;
      byId("productionTaskTitle").textContent = "生产状态暂时无法读取";
      byId("productionTaskState").textContent = "读取失败";
      byId("productionTaskState").className = "state failure";
      byId("productionTaskDescription").textContent = "读取成功前不会使用旧工单、执行、核验或作品状态。";
      disableStageLinks();
      clearRecommendedAction();
      renderAction();
    }

    async function load({ focus = false } = {}) {
      const epoch = ++requestEpoch;
      busy = true;
      renderProducts();
      renderPendingAuthority();
      loading.hidden = false;
      body.hidden = true;
      disableStageLinks();
      renderAction();
      try {
        const query = new URLSearchParams({ stage: "production" });
        if (selectedOrderId) query.set("orderId", selectedOrderId);
        const response = await request(`/api/projects/${encodeURIComponent(projectId)}/products/${encodeURIComponent(activeProductId)}/operator-workspace?${query}`);
        if (epoch !== requestEpoch || activeProductId !== response.workspace.product.id) return;
        if (response.workspace.render_mode === "legacy") {
          location.replace(legacyProductionUrl(projectId, activeProductId, selectedOrderId));
          return;
        }
        const stage = response.workspace.stages?.find((item) => item.code === "production");
        if (!stage || stage.implementation_status !== "workspace" || stage.read_status !== "ok") throw new Error("INVALID_PRODUCTION_PROJECTION");
        projection = response.workspace;
        readFailed = false;
        selectedOrderId = stage.production?.selected_order?.id || null;
        renderProducts();
        renderProduction();
        const exactUrl = stageUrl(projectId, activeProductId, "production", projection, selectedOrderId);
        history.replaceState({ productId: activeProductId, orderId: selectedOrderId }, "", exactUrl);
        if (focus) byId("productionTaskTitle").focus();
        return true;
      } catch {
        if (epoch !== requestEpoch) return;
        failRead();
        return false;
      } finally {
        if (epoch === requestEpoch) {
          busy = false;
          renderAction();
        }
      }
    }

    async function command(url, options) {
      if (busy) return false;
      busy = true;
      renderAction();
      try {
        await request(url, options);
        await load({ focus: true });
        return true;
      } catch (error) {
        if (ambiguousWriteError(error)) {
          projection = null;
          clearProductionTruth();
          const recovered = await load({ focus: true });
          if (recovered && !notice.textContent) notice.textContent = "已重新读取当前生产状态，请按最新状态继续。";
        } else {
          notice.textContent = "操作未完成，当前状态没有改变。";
        }
        return false;
      } finally {
        busy = false;
        renderAction();
      }
    }

    async function createProductionOrder() {
      if (busy || !production?.current_plan?.id || !createIntentKey) return false;
      busy = true;
      renderAction();
      try {
        await request(`/api/products/${encodeURIComponent(activeProductId)}/production-orders`, {
          method: "POST", headers: { "idempotency-key": createIntentKey },
          body: JSON.stringify({ video_plan_version_id: production.current_plan.id, execution_purpose: "first_production" })
        });
        createIntentKey = null;
        createTrigger = null;
        await load({ focus: true });
        return true;
      } catch (error) {
        const mustReconcile = ambiguousWriteError(error);
        if (!mustReconcile) {
          byId("productionCreateError").textContent = "创建未完成，当前状态没有改变。";
          return false;
        }
        projection = null;
        clearProductionTruth();
        const recovered = await load();
        if (!recovered) {
          byId("productionCreateError").textContent = "创建结果未知，当前生产状态仍无法读取。";
          return false;
        }
        const currentAction = ownedAction(projection?.recommended_action);
        if (currentAction?.code === "create_production_order") {
          createIntentKey = crypto.randomUUID();
          byId("productionCreateError").textContent = "服务端仍允许创建；请重新确认新的创建意图。";
          byId("confirmProductionCreate").focus();
          return false;
        }
        invalidateCreateIntent();
        byId("productionTaskTitle").focus();
        return true;
      } finally {
        busy = false;
        renderAction();
      }
    }

    function closeCreateDialog() {
      invalidateCreateIntent({ restoreFocus: true });
    }

    byId("refreshProductionWorkspace").addEventListener("click", () => load({ focus: true }));
    byId("mobileProductionProductBack").addEventListener("click", () => {
      document.body.dataset.mobileLayer = "list";
      selectedProductTrigger?.focus();
    });
    byId("mobileProductionDetailBack").addEventListener("click", () => setMobileLayer("list", true));
    byId("closeProductionCreateDialog").addEventListener("click", closeCreateDialog);
    byId("cancelProductionCreate").addEventListener("click", closeCreateDialog);
    byId("productionCreateDialog").addEventListener("cancel", (event) => {
      event.preventDefault();
      closeCreateDialog();
    });
    byId("productionCreateForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const succeeded = await createProductionOrder();
      if (succeeded) {
        if (byId("productionCreateDialog").open) byId("productionCreateDialog").close();
        byId("productionTaskTitle").focus();
      }
    });
    primary.addEventListener("click", async () => {
      const action = ownedAction({ code: primary.dataset.actionCode,
        stage: "production", kind: ACTIONS[primary.dataset.actionCode]?.kind });
      if (!action) return;
      const selected = production?.selected_order;
      const packageValue = production?.package;
      if (action.code === "retry_production_read") return load({ focus: true });
      if (action.code === "return_to_video_plan") {
        location.assign(stageUrl(projectId, activeProductId, "video_plan", projection));
      } else if (action.code === "create_production_order") {
        createTrigger = primary;
        createIntentKey = crypto.randomUUID();
        byId("productionCreateError").textContent = "";
        byId("productionCreateDialog").showModal();
        byId("confirmProductionCreate").focus();
      } else if (action.code === "generate_handoff_package" && selected) {
        await command(`/api/production-orders/${encodeURIComponent(selected.id)}/manual-handoff-packages`, {
          method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: "{}"
        });
      } else if (action.code === "retry_handoff_package" && packageValue) {
        await command(`/api/manual-handoff-packages/${encodeURIComponent(packageValue.id || packageValue.package_id)}/retry`, {
          method: "POST", headers: { "idempotency-key": crypto.randomUUID() }, body: "{}"
        });
      } else if (action.code === "authorize_handoff_download" && packageValue) {
        await command(`/api/manual-handoff-packages/${encodeURIComponent(packageValue.id || packageValue.package_id)}/download-authorizations`, {
          method: "POST", body: "{}"
        });
      } else if (["view_production_failure_details", "view_verification_details"].includes(action.code)) {
        byId("productionTechnicalDetails").open = true;
        byId("productionTechnicalDetails").querySelector("summary").focus();
      } else if (["review_production_work", "view_production_rework", "deliver_production_work",
        "view_production_delivery"].includes(action.code) && production?.work?.id) {
        location.assign(`/works.html?work=${encodeURIComponent(production.work.id)}&project=${encodeURIComponent(projectId)}&product=${encodeURIComponent(activeProductId)}`);
      }
    });
    addEventListener("popstate", async () => {
      invalidateCreateIntent();
      const params = new URLSearchParams(location.search);
      activeProductId = params.get("product");
      selectedOrderId = params.get("orderId");
      await load({ focus: true });
    });

    try {
      const runtime = await request("/api/runtime");
      if (runtime.operatorWorkspaceEnabled !== true) {
        location.replace(legacyProductionUrl(projectId, activeProductId, selectedOrderId));
        return;
      }
      project = (await request(`/api/projects/${encodeURIComponent(projectId)}`)).project;
      if (!project?.products?.some((item) => item.id === activeProductId)) throw new Error("PRODUCT_NOT_FOUND");
      renderProducts();
      await load();
    } catch {
      failRead();
    }
  }

  window.HiflyProductionWorkspace = Object.freeze({ start });
})();
