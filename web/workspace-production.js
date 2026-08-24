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
  const byId = (id) => document.getElementById(id);
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
    let lastOrderTrigger = null;
    let selectedProductTrigger = null;
    let createTrigger = null;

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
      else lastOrderTrigger?.focus();
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
      button.setAttribute("aria-current", String(order.id === selectedOrderId));
      button.setAttribute("aria-label", `生产工单 ${ORDER_LABELS[order.status] || "状态待确认"}`);
      const title = document.createElement("strong");
      title.textContent = order.execution_purpose === "rework" ? "返工生产工单" : "生产工单";
      const meta = document.createElement("span");
      meta.textContent = ORDER_LABELS[order.status] || "状态待确认";
      button.append(title, meta);
      button.addEventListener("click", async () => {
        lastOrderTrigger = button;
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
      byId("productionOrderList").replaceChildren(...production.orders.map(orderButton));
      byId("productionOrderEmpty").hidden = production.orders.length > 0;
      byId("productionTaskTitle").textContent = stage.business_status;
      byId("productionTaskState").textContent = stage.business_status;
      byId("productionTaskState").className = `state ${stage.blocker_codes.length ? "blocked" : "ready"}`;
      byId("productionTaskDescription").textContent = stage.blocker_codes.length
        ? "当前状态不会自动重试、重新领取或创建下一单。" : "服务端持久真值允许进入下一步。";
      byId("productionOrderSummary").textContent = selected ? ORDER_LABELS[selected.status] || "状态待确认" : "尚无工单";
      byId("productionPackageSummary").textContent = packageValue ? PACKAGE_LABELS[packageValue.status] || "状态待确认" : "未生成";
      byId("productionExecutionSummary").textContent = attempt ? ORDER_LABELS[attempt.status] || "状态待确认" : "未开始";
      byId("productionVerificationSummary").textContent = verification
        ? verification.verification_status || verification.status || "状态待确认" : "未发起";
      byId("productionWorkSummary").textContent = work ? WORK_LABELS[work.delivery_status] || "状态待确认" : "尚未登记";
      byId("productionTechnicalOrder").textContent = selected?.id || "无";
      byId("productionTechnicalAttempt").textContent = attempt?.id || "无";
      byId("productionTechnicalVerification").textContent = verification?.id || "无";
      byId("productionTechnicalWork").textContent = work?.id || "无";
      notice.textContent = stage.blocker_codes.includes("PRODUCTION_ACTIVATION_NOT_PROVEN")
        ? "页面没有组织级 eligible、active attempts 或 Worker 启停真值，因此保持失败关闭。" : "";
      loading.hidden = true;
      body.hidden = false;
      syncStageLinks();
      renderAction();
    }

    function failRead() {
      readFailed = true;
      projection = null;
      production = null;
      loading.hidden = true;
      body.hidden = false;
      byId("productionOrderList").replaceChildren();
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
      } catch {
        if (epoch !== requestEpoch) return;
        failRead();
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
        notice.textContent = error.status === 409 ? "服务端状态已变化，请刷新当前工单。" : "操作未完成，当前状态没有改变。";
        if (error.status === 409) await load();
        return false;
      } finally {
        busy = false;
        renderAction();
      }
    }

    function closeCreateDialog() {
      byId("productionCreateDialog").close();
      createTrigger?.focus();
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
      const planId = production?.current_plan?.id;
      if (!planId) return;
      const succeeded = await command(`/api/products/${encodeURIComponent(activeProductId)}/production-orders`, {
        method: "POST", headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ video_plan_version_id: planId, execution_purpose: "first_production" })
      });
      if (succeeded) {
        if (byId("productionCreateDialog").open) byId("productionCreateDialog").close();
        byId("productionTaskTitle").focus();
      } else {
        byId("productionCreateError").textContent = "工单状态已变化；已载入服务端最新状态，请确认后再继续。";
        byId("confirmProductionCreate").focus();
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
