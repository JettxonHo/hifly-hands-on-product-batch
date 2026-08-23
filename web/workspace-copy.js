(() => {
  const stageRoutes = Object.freeze({
    avatar: "/avatar.html",
    video_plan: "/plan.html",
    production: "/production.html"
  });
  const actions = Object.freeze({
    return_to_product_content: { stage: "copy", kind: "navigate", label: "返回商品资料" },
    request_copy_generation: { stage: "copy", kind: "command", label: "生成文案" },
    retry_copy_generation: { stage: "copy", kind: "command", label: "重新生成文案" },
    save_copy_draft: { stage: "copy", kind: "command", label: "保存当前修改" },
    load_latest_copy_version: { stage: "copy", kind: "refresh", label: "载入最新文案状态" },
    return_to_current_copy_version: { stage: "copy", kind: "navigate", label: "回到当前文案" },
    derive_copy_draft: { stage: "copy", kind: "focus", label: "基于此版本修改" },
    start_copy_quality: { stage: "copy", kind: "command", label: "开始质检" },
    retry_copy_quality: { stage: "copy", kind: "command", label: "重新质检" },
    review_copy_quality: { stage: "copy", kind: "focus", label: "处理质检问题" },
    submit_copy_review: { stage: "copy", kind: "command", label: "提交人工审核" },
    approve_copy_review: { stage: "copy", kind: "command", label: "批准文案" },
    continue_to_avatar: { stage: "copy", kind: "navigate", label: "进入人物" },
    retry_copy_read: { stage: "copy", kind: "refresh", label: "刷新当前文案" }
  });
  const qualityLabels = Object.freeze({
    not_started: "未质检", queued: "质检已排队", running: "正在质检", failed: "质检失败", timed_out: "质检超时",
    invalid: "结果无效", blocked: "未通过", needs_review: "需要判断", passed: "质检通过", succeeded: "质检完成"
  });
  const reviewLabels = Object.freeze({
    not_submitted: "未提交审核", pending: "待人工审核", approved: "已批准", changes_requested: "需要修改", revoked: "批准已失效"
  });
  const copyLabels = Object.freeze({ draft: "草稿", frozen: "已冻结", superseded: "历史版本" });
  const csrf = () => decodeURIComponent((document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hifly_identity_csrf=")) || "=").split("=").slice(1).join("="));
  const node = (selector) => document.querySelector(selector);

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.method && options.method !== "GET") headers.set("x-identity-csrf", csrf());
    const response = await fetch(url, { credentials: "same-origin", ...options, headers });
    if ([401, 403].includes(response.status)) {
      location.replace("/login.html");
      throw Object.assign(new Error("AUTH_REQUIRED"), { status: response.status });
    }
    let body;
    try { body = await response.json(); } catch (_error) { throw Object.assign(new Error("INVALID_RESPONSE"), { status: response.status }); }
    if (!response.ok) throw Object.assign(new Error(body.error || "REQUEST_FAILED"), { status: response.status, body });
    return body;
  }

  function workspaceUrl(projectId, productId, stage, copyVersionId = null) {
    const url = new URL("/workspace.html", location.origin);
    url.searchParams.set("project", projectId);
    url.searchParams.set("product", productId);
    url.searchParams.set("stage", stage);
    if (stage === "copy" && copyVersionId) url.searchParams.set("copy", copyVersionId);
    return `${url.pathname}${url.search}`;
  }

  function legacyUrl(stage, projectId, productId, copyVersionId) {
    const url = new URL(stageRoutes[stage], location.origin);
    url.searchParams.set("project", projectId);
    url.searchParams.set("product", productId);
    if (stage === "avatar" && copyVersionId) url.searchParams.set("copy", copyVersionId);
    return `${url.pathname}${url.search}`;
  }

  function setStageLinks({ projectId, productId, copyVersionId, failed = false }) {
    for (const link of document.querySelectorAll("[data-stage-code]")) {
      const state = link.closest("li") || link;
      if (failed) {
        link.removeAttribute("href");
        link.setAttribute("aria-disabled", "true");
        state.dataset.stageState = "blocked";
        state.removeAttribute("aria-current");
        continue;
      }
      const stage = link.dataset.stageCode;
      link.removeAttribute("aria-disabled");
      link.href = ["product_content", "copy"].includes(stage)
        ? workspaceUrl(projectId, productId, stage, stage === "copy" ? copyVersionId : null)
        : legacyUrl(stage, projectId, productId, copyVersionId);
      state.dataset.stageState = stage === "copy" ? "current" : stage === "product_content" ? "completed" : "available";
      if (stage === "copy") state.setAttribute("aria-current", "step");
      else state.removeAttribute("aria-current");
    }
    const summary = node(".workspace-mobile-stages summary");
    if (summary) summary.textContent = failed ? "阶段状态暂不可用" : "阶段 2/5 · 文案";
  }

  function validateProjection(workspace) {
    if (!workspace || workspace.projection_version !== 1 || workspace.action_registry_version !== 1 ||
      workspace.requested_stage !== "copy" || workspace.render_mode !== "workspace" || workspace.recommended_stage !== "copy") return false;
    const copyStage = workspace.stages?.find((stage) => stage.code === "copy");
    if (!copyStage || copyStage.implementation_status !== "workspace" || copyStage.read_status !== "ok") return false;
    for (const code of ["avatar", "video_plan", "production"]) {
      const stage = workspace.stages.find((value) => value.code === code);
      if (!stage || stage.implementation_status !== "legacy" || stage.read_status !== "not_loaded" || stage.current_object !== null || stage.blocker_codes?.length) return false;
    }
    const action = workspace.recommended_action;
    if (!action) return true;
    const registered = actions[action.code];
    return Boolean(registered && registered.stage === action.stage && registered.kind === action.kind && action.stage === "copy");
  }

  function createController({ projectId, initialProductId, initialCopyVersionId }) {
    let project = null;
    let productId = initialProductId;
    let copyVersionId = initialCopyVersionId;
    let workspace = null;
    let copyStage = null;
    let identity = null;
    let dirty = false;
    let deriveMode = false;
    let conflict = false;
    let readFailed = false;
    let trusted = true;
    let busy = false;
    let pollTimer = null;
    let selectedProductTrigger = null;
    let pendingNavigation = null;
    let acceptedHistoryIndex = 0;
    let restoringHistory = false;
    let pendingHistory = null;
    let dialogTrigger = null;
    let activeFinding = null;

    const primary = node("#workspacePrimaryAction");
    const actionLabel = node("#workspaceActionLabel");
    const form = node("#workspaceCopyForm");
    const body = node("#workspaceCopyBody");
    const unsaved = node("#workspaceUnsavedDialog");

    function selectedCopy() { return copyStage?.copy_version || null; }
    function currentProduct() { return project?.products.find((item) => item.id === productId) || null; }
    function isHistorical() { return Boolean(selectedCopy() && copyStage.current_copy_version_id && selectedCopy().id !== copyStage.current_copy_version_id); }

    function setNotice(message = "", kind = "") {
      const notice = node("#workspaceCopyNotice");
      notice.textContent = message;
      notice.className = `notice${kind ? ` ${kind}` : ""}`;
    }

    function setPrimary(code) {
      primary.removeAttribute("data-recommended-action");
      primary.removeAttribute("data-action-code");
      const registered = code ? actions[code] : null;
      if (!trusted || !registered || registered.stage !== "copy" || busy) {
        primary.disabled = true;
        primary.textContent = busy ? "正在处理" : "暂不可用";
        actionLabel.textContent = trusted ? "当前没有安全的推荐操作" : "下一步暂不可用";
        return;
      }
      primary.disabled = false;
      primary.textContent = registered.label;
      primary.dataset.actionCode = code;
      primary.dataset.recommendedAction = "true";
      actionLabel.textContent = registered.label;
    }

    function recommendedCode() {
      if (readFailed) return "retry_copy_read";
      if (conflict) return "load_latest_copy_version";
      if (dirty) return "save_copy_draft";
      if (isHistorical()) return "return_to_current_copy_version";
      return workspace?.recommended_action?.code || null;
    }

    function renderSummary() {
      const copy = selectedCopy();
      node("#taskSummaryTitle").textContent = readFailed ? "文案暂时无法读取" : copyStage?.business_status || "准备文案";
      node("#taskContext").textContent = currentProduct()?.revision?.product_name || workspace?.product?.name || "当前商品";
      const status = node("#taskStatus");
      status.textContent = readFailed ? "读取失败" : copyStage?.business_status || "等待开始";
      status.className = `state ${readFailed ? "failure" : copyStage?.human_review?.status === "approved" ? "approved" : "pending"}`;
      node("#saveStatus").textContent = dirty ? "有未保存修改" : busy ? "处理中" : "已保存";
      const code = recommendedCode();
      node("#taskNext").textContent = actions[code]?.label || "等待当前状态完成";
      const blocker = node("#taskBlocker");
      const blockers = readFailed ? ["当前商品或文案的权威状态未完整载入。"] : copyStage?.blocker_codes || [];
      blocker.hidden = blockers.length === 0;
      blocker.textContent = blockers.length ? blockers.map((value) => ({
        PRODUCT_CONTENT_NOT_READY: "先完成当前商品资料。", COPY_REQUIRED: "当前商品还没有文案版本。",
        COPY_GENERATION_IN_PROGRESS: "文案生成尚未结束。", COPY_GENERATION_FAILED: "文案生成未完成。",
        COPY_QUALITY_REQUIRED: "当前文案尚未完成质检。", COPY_QUALITY_IN_PROGRESS: "文案质检尚未结束。",
        COPY_QUALITY_FAILED: "文案质检未完成。", COPY_QUALITY_INVALIDATED: "上游商品事实或质检规则已变化。",
        COPY_QUALITY_NEEDS_REVIEW: "请逐条处理质检判断项。", COPY_QUALITY_BLOCKED: "当前文案未通过质检。",
        HUMAN_REVIEW_REQUIRED: "自动质检通过不等于人工批准。", COPY_CHANGES_REQUIRED: "审核人要求修改文案。",
        COPY_APPROVAL_REVOKED: "原人工批准已失效。", COPY_VERSION_HISTORICAL: "历史版本保持只读。"
      }[value] || value)).join(" ") : "";
      node("#workspaceTechnicalStage").textContent = "copy";
      node("#workspaceTechnicalObjectRow").hidden = !copy;
      node("#workspaceTechnicalObject").textContent = copy ? `CopyVersion ${copy.id} · row v${copy.row_version}` : "尚未生成";
      node("#workspaceProjectionVersion").textContent = workspace ? `v${workspace.projection_version} · 动作表 v${workspace.action_registry_version}` : "待载入";
      setPrimary(code);
    }

    function renderVersions() {
      const list = node("#copyVersionList");
      list.replaceChildren(...(copyStage?.versions || []).map((version) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "secondary workspace-copy-version";
        button.setAttribute("aria-current", String(version.id === selectedCopy()?.id));
        button.textContent = `v${version.version_number} · ${copyLabels[version.status] || version.status}`;
        button.addEventListener("click", () => guardNavigation(() => navigate({ copyId: version.id })));
        return button;
      }));
    }

    function renderCopy() {
      const copy = selectedCopy();
      node("#copyWorkspaceLoading").hidden = true;
      node("#copyWorkspaceContent").hidden = false;
      node("#copyVersionState").textContent = copy ? `${copyLabels[copy.status] || copy.status} · v${copy.version_number}` : "尚无文案";
      node("#copyVersionState").className = `state ${copy?.status || "pending"}`;
      node("#copyVersionMeta").textContent = copy ? `文案版本 v${copy.version_number}` : "基于已就绪商品资料生成第一版文案";
      renderVersions();
      const historical = isHistorical();
      form.hidden = !copy;
      node("#generateWorkspaceCopy").hidden = Boolean(copy) || !["not_started", "failed", "timed_out"].includes(copyStage?.generation?.status);
      node("#deriveWorkspaceCopy").hidden = !copy || copy.status === "draft" || deriveMode;
      node("#returnCurrentCopy").hidden = !historical;
      if (copy && !dirty && !deriveMode) body.value = copy.body;
      body.readOnly = !copy || historical || (copy.status !== "draft" && !deriveMode);
      node("#saveWorkspaceCopy").hidden = !copy || body.readOnly;
      node("#workspaceCopyConflict").hidden = !conflict;
      updateEditorMeta();
      renderQuality();
      renderReview();
      renderSummary();
    }

    function updateEditorMeta() {
      node("#workspaceCopyCount").textContent = `${[...body.value].length} 字`;
      if (selectedCopy() && !busy) dirty = (selectedCopy().status === "draft" || deriveMode) && body.value !== selectedCopy().body;
      node("#workspaceCopySaveState").textContent = dirty ? "有未保存修改" : busy ? "保存中" : "已保存";
      node("#saveWorkspaceCopy").disabled = !dirty || busy;
      renderSummary();
    }

    function renderQuality() {
      const quality = copyStage?.quality;
      const label = quality?.conclusion ? qualityLabels[quality.conclusion] : qualityLabels[quality?.status] || "未质检";
      const badge = node("#workspaceQualityState");
      badge.textContent = label;
      badge.className = `state ${quality?.conclusion || quality?.status || "pending"}`;
      node("#workspaceQualitySummary").textContent = quality?.current_valid === false ? "结论已失效，不能用于人工审核。" :
        quality?.conclusion === "passed" ? "自动质检已通过，仍需独立人工审核。" :
          quality?.conclusion === "needs_review" ? "请逐条处理待人工判断项；全部处理后服务端才会更新有效结论。" :
            quality?.conclusion === "blocked" ? "存在不可绕过门禁，不能接受后继续人工审核。" :
              ["queued", "running"].includes(quality?.status) ? "质检正在异步执行，可以离开后返回。" : "保存当前文案后执行完整质检。";
      const findings = node("#workspaceFindingList");
      findings.replaceChildren(...(quality?.findings || []).map((finding) => {
        const item = document.createElement("article");
        item.className = "workspace-finding";
        item.dataset.findingCode = finding.code;
        const kind = document.createElement("span");
        kind.className = `state ${finding.kind === "review" ? "needs_review" : "blocked"}`;
        kind.textContent = finding.kind === "review" ? "待人工判断" : "不可绕过门禁";
        const title = document.createElement("h4");
        title.textContent = finding.title || "质检问题";
        const message = document.createElement("p");
        message.textContent = finding.message || finding.suggestion || "请核对此项。";
        const evidence = document.createElement("p");
        evidence.className = "workspace-finding-meta";
        evidence.textContent = `${finding.rule_source || "规则来源待确认"} · ${finding.evidence_reference || "证据引用待确认"}`;
        item.append(kind, title, message, evidence);
        const resolution = finding.resolutions?.at(-1);
        if (resolution) {
          const resolved = document.createElement("p");
          resolved.className = "workspace-finding-meta";
          resolved.textContent = `${resolution.state === "accepted_with_reason" ? "已接受" : resolution.state === "returned_to_facts" ? "已返回商品资料" : "已选择人工修改"}${resolution.reason ? `：${resolution.reason}` : ""}`;
          item.append(resolved);
        } else if (quality?.current_valid !== false) {
          const controls = document.createElement("div");
          controls.className = "workspace-finding-actions";
          if (finding.kind === "review") controls.append(findingButton("接受并填写理由", () => openFindingDialog(finding)));
          controls.append(
            findingButton("返回商品资料", () => resolveFinding(finding, "returned_to_facts", "需要补充或修正商品事实").then((ok) => {
              if (ok) location.assign(workspaceUrl(projectId, productId, "product_content"));
            })),
            findingButton("人工修改文案", () => resolveFinding(finding, "change_requested", "运营选择人工修改文案").then((ok) => {
              if (!ok) return;
              deriveMode = true;
              body.readOnly = false;
              node("#deriveWorkspaceCopy").hidden = true;
              updateEditorMeta();
              body.focus();
            }))
          );
          item.append(controls);
        }
        return item;
      }));
    }

    function findingButton(label, action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.textContent = label;
      button.addEventListener("click", action);
      return button;
    }

    function openFindingDialog(finding) {
      if (finding.kind !== "review" || finding.resolutions?.length) return;
      activeFinding = finding;
      dialogTrigger = document.activeElement;
      node("#workspaceFindingMessage").textContent = `${finding.title || "质检问题"}：${finding.message || "请确认当前表达。"}`;
      node("#workspaceFindingReason").value = "";
      node("#workspaceFindingError").textContent = "";
      node("#workspaceFindingDialog").showModal();
      node("#workspaceFindingReason").focus();
    }

    function closeFindingDialog({ restore = true } = {}) {
      node("#workspaceFindingDialog").close();
      activeFinding = null;
      if (restore) (dialogTrigger?.isConnected ? dialogTrigger : node("#workspaceQualityTab"))?.focus();
    }

    async function resolveFinding(finding, resolution, reason) {
      if (!finding?.id || busy) return false;
      busy = true;
      renderSummary();
      try {
        await request(`/api/quality-findings/${encodeURIComponent(finding.id)}/resolutions`, {
          method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({ resolution, reason })
        });
        await load({ focus: false });
        replaceUrl();
        return true;
      } catch (error) {
        const message = error.status === 409 ? "质检状态已被其他人更新，请刷新当前文案。" :
          error.status === 422 ? "当前判断项不能这样处理，请刷新后核对。" : "质检判断未保存，请稍后重试。";
        setNotice(message, error.status === 409 || error.status === 422 ? "blocked" : "error");
        if (node("#workspaceFindingDialog").open) node("#workspaceFindingError").textContent = message;
        return false;
      } finally {
        busy = false;
        renderSummary();
      }
    }

    function renderReview() {
      const review = copyStage?.human_review;
      const badge = node("#workspaceReviewState");
      badge.textContent = reviewLabels[review?.status] || "未提交审核";
      badge.className = `state ${review?.status || "pending"}`;
      node("#workspaceReviewSummary").textContent = review?.status === "approved" ? "当前人工批准有效；进入人物时仍会由服务端重新验证。" :
        review?.status === "pending" ? (identity?.membership?.role === "admin" ? "等待管理员作出独立人工决定。" : "当前账号只能查看审核进度。") :
          review?.status === "changes_requested" ? "审核人要求修改；新草稿需重新完成质检。" :
            review?.status === "revoked" ? "原批准保留在历史中，但不能继续用于下游。" : "只有当前有效质检通过后才能提交人工审核。";
    }

    function selectTab(name, focus = false) {
      const quality = name === "quality";
      const qualityTab = node("#workspaceQualityTab");
      const reviewTab = node("#workspaceReviewTab");
      qualityTab.setAttribute("aria-selected", String(quality));
      reviewTab.setAttribute("aria-selected", String(!quality));
      qualityTab.tabIndex = quality ? 0 : -1;
      reviewTab.tabIndex = quality ? -1 : 0;
      node("#workspaceQualityPanel").hidden = !quality;
      node("#workspaceReviewPanel").hidden = quality;
      if (focus) (quality ? qualityTab : reviewTab).focus();
    }

    function renderProducts() {
      const list = node("#productList");
      list.replaceChildren(...project.products.map((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "product-list-item";
        button.setAttribute("aria-current", String(item.id === productId));
        const title = document.createElement("strong");
        title.textContent = item.revision.product_name || "未命名商品";
        const meta = document.createElement("span");
        meta.textContent = item.id === productId ? copyStage?.business_status || "当前商品" : "打开文案";
        button.append(title, meta);
        button.addEventListener("click", () => {
          selectedProductTrigger = button;
          guardNavigation(() => navigate({ product: item.id, copyId: null }));
        });
        return button;
      }));
    }

    function disableForReadFailure() {
      clearTimeout(pollTimer);
      readFailed = true;
      trusted = true;
      workspace = null;
      copyStage = null;
      node("#copyWorkspaceLoading").hidden = true;
      node("#copyWorkspaceContent").hidden = true;
      node("#copyWorkspacePanel").hidden = false;
      setStageLinks({ projectId, productId, failed: true });
      renderSummary();
    }

    function schedulePolling() {
      clearTimeout(pollTimer);
      if ([copyStage?.generation?.status, copyStage?.quality?.status].some((status) => ["queued", "running"].includes(status))) {
        pollTimer = setTimeout(() => load({ focus: false }).catch(disableForReadFailure), 1200);
      }
    }

    async function load({ focus = true } = {}) {
      clearTimeout(pollTimer);
      const requestedProduct = productId;
      const query = new URLSearchParams({ stage: "copy" });
      if (copyVersionId) query.set("copy", copyVersionId);
      const [workspaceBody, projectBody] = await Promise.all([
        request(`/api/projects/${encodeURIComponent(projectId)}/products/${encodeURIComponent(requestedProduct)}/operator-workspace?${query}`),
        request(`/api/projects/${encodeURIComponent(projectId)}`)
      ]);
      if (productId !== requestedProduct) return;
      if (!validateProjection(workspaceBody.workspace)) {
        trusted = false;
        throw new Error("OPERATOR_WORKSPACE_RESPONSE_INVALID");
      }
      const exactProduct = projectBody.project?.products?.find((item) => item.id === requestedProduct);
      if (!exactProduct || exactProduct.current_revision_id !== workspaceBody.workspace.product.current_revision_id) throw new Error("OPERATOR_WORKSPACE_RESPONSE_INVALID");
      workspace = workspaceBody.workspace;
      project = projectBody.project;
      copyStage = workspace.stages.find((stage) => stage.code === "copy");
      copyVersionId = copyStage.copy_version?.id || null;
      trusted = true;
      readFailed = false;
      conflict = false;
      document.body.dataset.workspaceStage = "copy";
      node("#copyWorkspacePanel").classList.add("workspace-task-panel");
      node("#copyWorkspacePanel").dataset.workspacePanel = "current-task";
      node("#projectName").textContent = project.name;
      node("#editor").hidden = true;
      node("#copyWorkspacePanel").hidden = false;
      renderProducts();
      setStageLinks({ projectId, productId, copyVersionId: copyStage.current_copy_version_id });
      renderCopy();
      if (focus) node("#copyWorkspaceHeading").focus();
      schedulePolling();
    }

    function replaceUrl() {
      history.replaceState({ ...(history.state || {}), copyWorkspaceHistoryIndex: acceptedHistoryIndex, productId }, "", workspaceUrl(projectId, productId, "copy", copyVersionId));
    }

    async function bootstrap({ focus = true } = {}) {
      node("#copyWorkspaceLoading").hidden = false;
      node("#copyWorkspaceContent").hidden = true;
      try {
        const [runtime, identityBody] = await Promise.all([request("/api/runtime"), request("/api/auth/me")]);
        if (!runtime.operatorWorkspaceEnabled || !runtime.copyGenerationEnabled || !runtime.copyQualityEnabled || !runtime.copyReviewEnabled) {
          const legacyProject = (await request(`/api/projects/${encodeURIComponent(projectId)}`)).project;
          const legacyProduct = legacyProject?.products?.find((item) => item.id === productId);
          const legacyRevisionId = legacyProduct?.current_revision_id || legacyProduct?.revision?.id;
          const target = new URL("/copy.html", location.origin);
          target.searchParams.set("project", projectId);
          if (legacyRevisionId) target.searchParams.set("revision", legacyRevisionId);
          location.replace(`${target.pathname}${target.search}`);
          return;
        }
        identity = identityBody;
        await load({ focus });
        replaceUrl();
      } catch (_error) {
        disableForReadFailure();
      }
    }

    async function navigate({ product = productId, copyId = copyVersionId } = {}) {
      productId = product;
      copyVersionId = copyId;
      acceptedHistoryIndex += 1;
      history.pushState({ copyWorkspaceHistoryIndex: acceptedHistoryIndex, productId }, "", workspaceUrl(projectId, productId, "copy", copyVersionId));
      await bootstrap();
      document.body.dataset.mobileLayer = "detail";
    }

    function guardNavigation(work) {
      if (!dirty) return work();
      pendingNavigation = work;
      dialogTrigger = document.activeElement;
      unsaved.showModal();
      node("#keepWorkspaceEditing").focus();
    }

    async function save() {
      const copy = selectedCopy();
      if (!copy || !dirty || busy) return false;
      const value = body.value.trim();
      if (!value) { setNotice("文案正文不能为空。", "error"); return false; }
      busy = true;
      updateEditorMeta();
      try {
        const result = await request(`/api/copy-versions/${encodeURIComponent(copy.id)}`, {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ expected_revision: copy.row_version, body: value })
        });
        dirty = false;
        deriveMode = false;
        copyVersionId = result.copy_version.id;
        await load({ focus: false });
        replaceUrl();
        setNotice(result.copy_version.id === copy.id ? "文案草稿已保存。" : "已创建新的文案草稿。", "success");
        return true;
      } catch (error) {
        if (error.status === 409) {
          conflict = true;
          setNotice("保存发生版本冲突，本地正文尚未丢失。", "blocked");
        } else setNotice("文案保存失败，请稍后重试。", "error");
        return false;
      } finally {
        busy = false;
        updateEditorMeta();
      }
    }

    async function command(url, options = {}) {
      if (busy) return false;
      busy = true;
      renderSummary();
      try {
        await request(url, {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify(options.body || {})
        });
        copyVersionId = options.keepCopy ? copyVersionId : null;
        await load({ focus: false });
        replaceUrl();
        return true;
      } catch (error) {
        setNotice(error.status === 409 ? "状态已被其他人更新，请刷新当前文案。" : "操作未完成，请刷新后重试。", error.status === 409 ? "blocked" : "error");
        return false;
      } finally {
        busy = false;
        renderSummary();
      }
    }

    async function execute(code) {
      const copy = selectedCopy();
      const quality = copyStage?.quality;
      const review = copyStage?.human_review;
      if (!actions[code] || actions[code].stage !== "copy") return;
      if (code === "retry_copy_read") return bootstrap();
      if (code === "return_to_product_content") return location.assign(workspaceUrl(projectId, productId, "product_content"));
      if (code === "request_copy_generation") return command(`/api/product-revisions/${encodeURIComponent(workspace.product.current_revision_id)}/copy-generations`, { body: { intent: "product_recommendation" } });
      if (code === "retry_copy_generation" && copyStage.generation.current_job_id) return command(`/api/copy-generation-jobs/${encodeURIComponent(copyStage.generation.current_job_id)}/retry`);
      if (code === "save_copy_draft") return save();
      if (code === "load_latest_copy_version") {
        const local = body.value;
        const latest = await request(`/api/copy-versions/${encodeURIComponent(copy.id)}`);
        copyStage.copy_version = latest.copy_version;
        conflict = false;
        body.value = local;
        dirty = body.value !== latest.copy_version.body;
        setNotice("已载入服务端最新状态；你的本地正文仍保留，请确认后重新保存。", "blocked");
        return renderCopy();
      }
      if (code === "return_to_current_copy_version") return navigate({ copyId: copyStage.current_copy_version_id });
      if (code === "derive_copy_draft") {
        deriveMode = true;
        body.readOnly = false;
        node("#deriveWorkspaceCopy").hidden = true;
        body.focus();
        return updateEditorMeta();
      }
      if (code === "start_copy_quality" && copy) return command(`/api/copy-versions/${encodeURIComponent(copy.id)}/quality-runs`, { body: { expected_revision: copy.row_version }, keepCopy: true });
      if (code === "retry_copy_quality" && quality?.run_id) return command(`/api/quality-runs/${encodeURIComponent(quality.run_id)}/retry`, { keepCopy: true });
      if (code === "review_copy_quality") { selectTab("quality", true); return; }
      if (code === "submit_copy_review" && copy) return command(`/api/copy-versions/${encodeURIComponent(copy.id)}/reviews`, { keepCopy: true });
      if (code === "approve_copy_review" && review?.review_id) {
        dialogTrigger = primary;
        node("#workspaceApproveError").textContent = "";
        node("#workspaceApproveDialog").showModal();
        return;
      }
      if (code === "continue_to_avatar" && copyStage.current_copy_version_id) return location.assign(legacyUrl("avatar", projectId, productId, copyStage.current_copy_version_id));
    }

    async function continuePending({ saveFirst, discard = false }) {
      if (saveFirst && !(await save())) return;
      if (discard) { dirty = false; deriveMode = false; }
      const work = pendingNavigation;
      pendingNavigation = null;
      unsaved.close();
      if (work) await work();
    }

    function bind() {
      body.addEventListener("input", updateEditorMeta);
      form.addEventListener("submit", async (event) => { event.preventDefault(); await save(); });
      primary.addEventListener("click", () => execute(primary.dataset.actionCode));
      node("#generateWorkspaceCopy").addEventListener("click", () => execute(workspace?.recommended_action?.code === "retry_copy_generation" ? "retry_copy_generation" : "request_copy_generation"));
      node("#deriveWorkspaceCopy").addEventListener("click", () => execute("derive_copy_draft"));
      node("#returnCurrentCopy").addEventListener("click", () => guardNavigation(() => execute("return_to_current_copy_version")));
      node("#loadLatestWorkspaceCopy").addEventListener("click", () => execute("load_latest_copy_version"));
      node("#refreshCopyWorkspace").addEventListener("click", () => guardNavigation(() => bootstrap()));
      node("#mobileCopyBack").addEventListener("click", () => {
        document.body.dataset.mobileLayer = "list";
        (selectedProductTrigger || node('#productList button[aria-current="true"]'))?.focus();
      });
      for (const [name, selector] of [["quality", "#workspaceQualityTab"], ["review", "#workspaceReviewTab"]]) {
        const tab = node(selector);
        tab.addEventListener("click", () => selectTab(name, true));
        tab.addEventListener("keydown", (event) => {
          const tabs = [node("#workspaceQualityTab"), node("#workspaceReviewTab")];
          const index = tabs.indexOf(tab);
          const next = event.key === "Home" ? 0 : event.key === "End" ? 1 : event.key === "ArrowRight" ? (index + 1) % 2 : event.key === "ArrowLeft" ? (index + 1) % 2 : null;
          if (next == null) return;
          event.preventDefault();
          selectTab(next === 0 ? "quality" : "review", true);
        });
      }
      node("#keepWorkspaceEditing").addEventListener("click", () => { pendingNavigation = null; unsaved.close(); body.focus(); });
      node("#closeWorkspaceUnsaved").addEventListener("click", () => { pendingNavigation = null; unsaved.close(); dialogTrigger?.focus(); });
      node("#discardWorkspaceChanges").addEventListener("click", () => continuePending({ discard: true }));
      node("#saveWorkspaceAndContinue").addEventListener("click", () => continuePending({ saveFirst: true }));
      node("#closeWorkspaceApprove").addEventListener("click", () => { node("#workspaceApproveDialog").close(); dialogTrigger?.focus(); });
      node("#cancelWorkspaceApprove").addEventListener("click", () => { node("#workspaceApproveDialog").close(); dialogTrigger?.focus(); });
      node("#workspaceApproveForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const review = copyStage?.human_review;
        if (!review?.review_id) return;
        const approved = await command(`/api/copy-reviews/${encodeURIComponent(review.review_id)}/approve`, { body: { expected_revision: review.row_version }, keepCopy: true });
        if (!approved) return;
        node("#workspaceApproveDialog").close();
        dialogTrigger?.focus();
      });
      node("#closeWorkspaceFinding").addEventListener("click", () => closeFindingDialog());
      node("#cancelWorkspaceFinding").addEventListener("click", () => closeFindingDialog());
      node("#workspaceFindingForm").addEventListener("submit", async (event) => {
        event.preventDefault();
        const reason = node("#workspaceFindingReason").value.trim();
        if (!reason) {
          node("#workspaceFindingError").textContent = "请填写接受理由。";
          node("#workspaceFindingReason").focus();
          return;
        }
        if (!activeFinding || activeFinding.kind !== "review") return;
        const accepted = await resolveFinding(activeFinding, "accepted_with_reason", reason);
        if (!accepted) return;
        closeFindingDialog({ restore: false });
        node("#workspaceQualityTab").focus();
      });
      window.addEventListener("beforeunload", (event) => { if (dirty) event.preventDefault(); });
      window.addEventListener("popstate", async (event) => {
        const targetIndex = Number.isInteger(event.state?.copyWorkspaceHistoryIndex) ? event.state.copyWorkspaceHistoryIndex : null;
        if (restoringHistory) {
          restoringHistory = false;
          if (pendingHistory) {
            pendingNavigation = async () => {
              const delta = pendingHistory.targetIndex - acceptedHistoryIndex;
              pendingHistory = null;
              restoringHistory = true;
              history.go(delta);
            };
            dialogTrigger = body;
            unsaved.showModal();
            node("#keepWorkspaceEditing").focus();
          }
          return;
        }
        if (targetIndex == null) return location.reload();
        if (dirty) {
          const targetUrl = new URL(location.href);
          pendingHistory = { targetIndex, targetUrl };
          const delta = acceptedHistoryIndex - targetIndex;
          restoringHistory = true;
          history.go(delta);
          return;
        }
        acceptedHistoryIndex = targetIndex;
        const url = new URL(location.href);
        productId = url.searchParams.get("product");
        copyVersionId = url.searchParams.get("copy");
        await bootstrap();
      });
    }

    async function start() {
      acceptedHistoryIndex = Number.isInteger(history.state?.copyWorkspaceHistoryIndex) ? history.state.copyWorkspaceHistoryIndex : 0;
      history.replaceState({ ...(history.state || {}), copyWorkspaceHistoryIndex: acceptedHistoryIndex, productId }, "", location.href);
      document.body.dataset.mobileLayer = "detail";
      bind();
      await bootstrap({ focus: false });
    }

    return { start };
  }

  window.HiflyCopyWorkspace = {
    async start({ projectId, productId, copyVersionId }) {
      if (!projectId || !productId) return location.replace("/projects.html");
      return createController({ projectId, initialProductId: productId, initialCopyVersionId: copyVersionId }).start();
    }
  };
})();
