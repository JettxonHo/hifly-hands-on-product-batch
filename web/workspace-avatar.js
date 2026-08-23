(() => {
  const stageRoutes = Object.freeze({ video_plan: "/plan.html", production: "/production.html" });
  const actions = Object.freeze({
    return_to_copy: { stage: "avatar", kind: "navigate", label: "返回文案" },
    select_avatar: { stage: "avatar", kind: "focus", label: "选择人物" },
    confirm_avatar_selection: { stage: "avatar", kind: "command", label: "确认选择人物" },
    load_latest_avatar_selection: { stage: "avatar", kind: "refresh", label: "载入最新人物状态" },
    continue_to_video_plan: { stage: "avatar", kind: "navigate", label: "进入视频方案" },
    retry_avatar_read: { stage: "avatar", kind: "refresh", label: "刷新当前人物" }
  });
  const authorizationLabels = Object.freeze({ valid: "授权有效", expiring: "授权即将到期", expired: "授权已过期", incomplete: "授权待补全" });
  const node = (selector) => document.querySelector(selector);
  const csrf = () => decodeURIComponent((document.cookie.split(";").map((part) => part.trim())
    .find((part) => part.startsWith("hifly_identity_csrf=")) || "=").split("=").slice(1).join("="));

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.method && options.method !== "GET") headers.set("x-identity-csrf", csrf());
    const response = await fetch(url, { credentials: "same-origin", ...options, headers });
    if ([401, 403].includes(response.status)) {
      location.replace("/login.html");
      throw Object.assign(new Error("AUTH_REQUIRED"), { status: response.status });
    }
    let body;
    try { body = await response.json(); }
    catch (_error) { throw Object.assign(new Error("INVALID_RESPONSE"), { status: response.status }); }
    if (!response.ok) throw Object.assign(new Error(body.error || "REQUEST_FAILED"), { status: response.status, body });
    return body;
  }

  function workspaceUrl(projectId, productId, stage, copyVersionId = null) {
    const url = new URL("/workspace.html", location.origin);
    url.searchParams.set("project", projectId);
    url.searchParams.set("product", productId);
    url.searchParams.set("stage", stage);
    if (["copy", "avatar"].includes(stage) && copyVersionId) url.searchParams.set("copy", copyVersionId);
    return `${url.pathname}${url.search}`;
  }

  function legacyUrl(stage, projectId, productId) {
    const url = new URL(stageRoutes[stage], location.origin);
    url.searchParams.set("project", projectId);
    url.searchParams.set("product", productId);
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
      link.href = ["product_content", "copy", "avatar"].includes(stage)
        ? workspaceUrl(projectId, productId, stage, copyVersionId)
        : legacyUrl(stage, projectId, productId);
      state.dataset.stageState = stage === "avatar" ? "current" : ["product_content", "copy"].includes(stage) ? "completed" : "available";
      if (stage === "avatar") state.setAttribute("aria-current", "step");
      else state.removeAttribute("aria-current");
    }
    const summary = node(".workspace-mobile-stages summary");
    if (summary) summary.textContent = failed ? "阶段状态暂不可用" : "阶段 3/5 · 人物";
  }

  function validateProjection(workspace) {
    if (!workspace || workspace.projection_version !== 1 || workspace.action_registry_version !== 1 ||
        workspace.requested_stage !== "avatar" || workspace.render_mode !== "workspace" || workspace.recommended_stage !== "avatar") return false;
    const productStage = workspace.stages?.find((stage) => stage.code === "product_content");
    const copyStage = workspace.stages?.find((stage) => stage.code === "copy");
    const avatarStage = workspace.stages?.find((stage) => stage.code === "avatar");
    if (!productStage || productStage.implementation_status !== "workspace" || productStage.read_status !== "ok" ||
        !copyStage || copyStage.implementation_status !== "workspace" || copyStage.read_status !== "ok" ||
        !avatarStage || avatarStage.implementation_status !== "workspace" || avatarStage.read_status !== "ok" ||
        !Array.isArray(avatarStage.avatar_workspace?.catalog) || !avatarStage.avatar_workspace?.selection) return false;
    for (const code of ["video_plan", "production"]) {
      const stage = workspace.stages.find((value) => value.code === code);
      if (!stage || stage.implementation_status !== "legacy" || stage.read_status !== "not_loaded" ||
          stage.current_object !== null || stage.blocker_codes?.length) return false;
    }
    if (JSON.stringify(avatarStage).includes("material_asset_version_id")) return false;
    const action = workspace.recommended_action;
    if (!action) return true;
    const registered = actions[action.code];
    return Boolean(registered && registered.stage === action.stage && registered.kind === action.kind && action.stage === "avatar");
  }

  function createController({ projectId, initialProductId, initialCopyVersionId }) {
    let project = null;
    let productId = initialProductId;
    let copyVersionId = initialCopyVersionId;
    let workspace = null;
    let avatarStage = null;
    let selectedAvatarVersionId = null;
    let viewedAvatarVersionId = null;
    let readFailed = false;
    let trusted = true;
    let busy = false;
    let conflict = false;
    let selectedProductTrigger = null;
    let selectedAvatarTrigger = null;
    let pendingNavigation = null;
    let acceptedHistoryIndex = 0;
    let historyTraversal = null;
    let pendingHistory = null;
    let dialogTrigger = null;
    let logicalSelectionKey = null;
    const previewCache = new Map();
    const previewExpiryTimers = new Map();
    const previewQueue = [];
    let previewActive = 0;
    let previewEpoch = 0;

    const primary = node("#workspacePrimaryAction");
    const actionLabel = node("#workspaceActionLabel");
    const confirmDialog = node("#workspaceAvatarConfirmDialog");
    const pendingDialog = node("#workspaceAvatarPendingDialog");

    function avatarWorkspace() { return avatarStage?.avatar_workspace || null; }
    function catalog() { return avatarWorkspace()?.catalog || []; }
    function currentProduct() { return project?.products.find((item) => item.id === productId) || null; }
    function currentSelection() { return avatarWorkspace()?.selection?.current_selection || null; }
    function entryByVersion(id) { return catalog().find((item) => item.asset_version?.id === id) || null; }
    function viewedEntry() { return entryByVersion(viewedAvatarVersionId); }
    function isDirty() {
      return Boolean(selectedAvatarVersionId && selectedAvatarVersionId !== currentSelection()?.asset_version_id);
    }

    function previewKey(entry) { return `${entry.id}:${entry.asset_version.id}`; }
    function previewState(entry) { return previewCache.get(previewKey(entry)) || { status: "idle", reason: "" }; }
    function firstCharacter(entry) { return [...(entry?.display_name || "人")][0] || "人"; }
    function previewReason(error) {
      if (error?.status === 404) return "人物图片已不可见，请刷新人物目录。";
      if (error?.status === 422) return "人物图片暂不可用，已显示文字占位。";
      if (error?.status === 503) return "人物图片授权暂时失败，可以重试。";
      return "人物图片无法显示，可以重试。";
    }

    function validPreview(value) {
      if (!value || typeof value.url !== "string" || typeof value.expires_at !== "string" ||
          !["image/jpeg", "image/png", "image/webp"].includes(value.media_type) ||
          !Number.isInteger(value.size) || value.size < 1 || !/^[a-f0-9]{64}$/.test(value.checksum_sha256 || "")) return false;
      const url = new URL(value.url, location.origin);
      return url.origin === location.origin && url.pathname.startsWith("/api/assets/downloads/") && Number.isFinite(Date.parse(value.expires_at));
    }

    function clearPreviewTimer(key) {
      const timer = previewExpiryTimers.get(key);
      if (timer) clearTimeout(timer);
      previewExpiryTimers.delete(key);
    }

    function setPreviewState(entry, state) {
      const key = previewKey(entry);
      clearPreviewTimer(key);
      previewCache.set(key, state);
      if (state.status !== "ready") return;
      const epoch = previewEpoch;
      const delay = Math.max(0, Date.parse(state.expiresAt) - Date.now());
      previewExpiryTimers.set(key, setTimeout(() => {
        const current = previewCache.get(key);
        if (epoch !== previewEpoch || current?.status !== "ready" || current.url !== state.url) return;
        previewExpiryTimers.delete(key);
        previewCache.set(key, { status: "expired", reason: "人物图片授权已过期，请重新获取。" });
        updatePreviewNodes(entry);
      }, delay));
    }

    function invalidatePreviewCache(nextCatalog) {
      previewEpoch += 1;
      previewQueue.length = 0;
      for (const timer of previewExpiryTimers.values()) clearTimeout(timer);
      previewExpiryTimers.clear();
      previewCache.clear();
      for (const entry of nextCatalog || []) {
        if (entry.materials_accessible !== false) continue;
        previewCache.set(previewKey(entry), {
          status: "error", reason: "人物图片当前不可用，已显示文字占位。"
        });
      }
    }

    async function authorizePreview(entry, force = false) {
      const key = previewKey(entry);
      const existing = previewState(entry);
      if (!force && existing.status === "ready" && Date.parse(existing.expiresAt) > Date.now()) return existing;
      if (entry.materials_accessible === false) {
        setPreviewState(entry, { status: "error", reason: "人物图片当前不可用，已显示文字占位。" });
        updatePreviewNodes(entry);
        return previewState(entry);
      }
      const epoch = previewEpoch;
      setPreviewState(entry, { status: "loading", reason: "" });
      updatePreviewNodes(entry);
      try {
        const body = await request(`/api/avatar-catalog/${encodeURIComponent(entry.id)}/preview-authorizations`, {
          method: "POST", headers: { "content-type": "application/json" }, body: "{}"
        });
        if (epoch !== previewEpoch) return previewState(entry);
        if (!validPreview(body.preview)) throw Object.assign(new Error("INVALID_AVATAR_PREVIEW_RESPONSE"), { status: 503 });
        const state = Date.parse(body.preview.expires_at) <= Date.now()
          ? { status: "expired", reason: "人物图片授权已过期，请重新获取。" }
          : { status: "ready", url: body.preview.url, expiresAt: body.preview.expires_at,
            mediaType: body.preview.media_type, size: body.preview.size, checksum: body.preview.checksum_sha256, reason: "" };
        setPreviewState(entry, state);
      } catch (error) {
        if (epoch !== previewEpoch) return previewState(entry);
        setPreviewState(entry, { status: "error", reason: previewReason(error) });
      }
      updatePreviewNodes(entry);
      return previewState(entry);
    }

    function drainPreviewQueue() {
      while (previewActive < 3 && previewQueue.length) {
        const entry = previewQueue.shift();
        if (previewState(entry).status !== "idle") continue;
        previewActive += 1;
        authorizePreview(entry).finally(() => { previewActive -= 1; drainPreviewQueue(); });
      }
    }

    function queuePreview(entry) {
      if (!entry || previewState(entry).status !== "idle" || previewQueue.some((item) => item.id === entry.id)) return;
      previewQueue.push(entry);
      drainPreviewQueue();
    }

    function imageError(entry, expectedUrl, epoch) {
      const current = previewState(entry);
      if (epoch !== previewEpoch || current.status !== "ready" || current.url !== expectedUrl) return;
      setPreviewState(entry, { status: "error", reason: "人物图片解码失败，可以重试。" });
      updatePreviewNodes(entry);
    }

    function thumbContent(entry) {
      const state = previewState(entry);
      if (state.status === "ready") {
        const image = document.createElement("img");
        image.src = state.url;
        image.alt = `${entry.display_name}人物缩略图`;
        const epoch = previewEpoch;
        image.addEventListener("error", () => imageError(entry, state.url, epoch), { once: true });
        return image;
      }
      const fallback = document.createElement("span");
      fallback.className = "avatar-thumb-fallback";
      const unavailable = ["error", "expired"].includes(state.status);
      fallback.dataset.fallback = String(unavailable);
      fallback.textContent = unavailable ? firstCharacter(entry) : "";
      fallback.setAttribute("aria-label", unavailable ? state.reason : "人物图片正在读取");
      return fallback;
    }

    function updatePreviewNodes(entry) {
      const card = node(`[data-avatar-id="${CSS.escape(entry.id)}"]`);
      if (card) card.firstElementChild?.replaceWith(thumbContent(entry));
      if (viewedAvatarVersionId !== entry.asset_version.id) return;
      const state = previewState(entry);
      const image = node("#avatarPreviewImage");
      const fallback = node("#avatarPreviewFallback");
      const frame = node("#avatarPreviewFrame");
      frame.dataset.previewState = state.status;
      if (state.status === "ready") {
        image.src = state.url;
        image.alt = `${entry.display_name}人物大图`;
        image.hidden = false;
        fallback.hidden = true;
        const epoch = previewEpoch;
        image.onerror = () => imageError(entry, state.url, epoch);
      } else {
        image.hidden = true;
        image.removeAttribute("src");
        fallback.hidden = false;
        const unavailable = ["error", "expired"].includes(state.status);
        fallback.querySelector("span").textContent = unavailable ? firstCharacter(entry) : "";
        fallback.querySelector("small").textContent = unavailable ? state.reason : "正在读取人物图片";
        fallback.setAttribute("aria-label", unavailable ? state.reason : "人物图片正在读取");
      }
      node("#avatarPreviewNotice").textContent = ["error", "expired"].includes(state.status) ? state.reason : "";
      node("#retryAvatarPreview").hidden = !["error", "expired"].includes(state.status);
    }

    function setPrimary(code) {
      primary.removeAttribute("data-recommended-action");
      primary.removeAttribute("data-action-code");
      const registered = code ? actions[code] : null;
      if (!trusted || !registered || registered.stage !== "avatar" || busy) {
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
      if (readFailed) return "retry_avatar_read";
      if (conflict) return "load_latest_avatar_selection";
      if (isDirty()) return "confirm_avatar_selection";
      return workspace?.recommended_action?.code || null;
    }

    function renderSummary() {
      node("#taskSummaryTitle").textContent = readFailed ? "人物暂时无法读取" : avatarStage?.business_status || "准备选择人物";
      node("#taskContext").textContent = currentProduct()?.revision?.product_name || workspace?.product?.name || "当前商品";
      const status = node("#taskStatus");
      status.textContent = readFailed ? "读取失败" : avatarStage?.business_status || "等待开始";
      status.className = `state ${readFailed ? "failure" : avatarWorkspace()?.selection?.current_valid ? "approved" : "pending"}`;
      node("#saveStatus").textContent = isDirty() ? "人物选择尚未确认" : busy ? "处理中" : currentSelection() ? "人物选择已保存" : "无未提交选择";
      const code = recommendedCode();
      node("#taskNext").textContent = actions[code]?.label || "等待当前状态完成";
      const blocker = node("#taskBlocker");
      const blockers = readFailed ? ["当前商品或人物的权威状态未完整载入。"] : avatarStage?.blocker_codes || [];
      const labels = {
        APPROVED_COPY_REQUIRED: "先完成文案人工批准。", AVATAR_SELECTION_REQUIRED: "请选择并确认一个可用人物。",
        AVATAR_SELECTION_INVALID: "当前人物已失效，请重新选择。", AVATAR_CATALOG_UNAVAILABLE: "当前没有可确认的人物。"
      };
      blocker.hidden = blockers.length === 0;
      blocker.textContent = blockers.map((value) => labels[value] || value).join(" ");
      node("#workspaceTechnicalStage").textContent = "avatar";
      node("#workspaceTechnicalObjectRow").hidden = !currentSelection();
      node("#workspaceTechnicalObject").textContent = currentSelection()
        ? `AvatarSelection ${currentSelection().id} · selection v${avatarWorkspace().selection.selection_revision}` : "尚未确认";
      node("#workspaceProjectionVersion").textContent = workspace
        ? `v${workspace.projection_version} · 动作表 v${workspace.action_registry_version}` : "待载入";
      setPrimary(code);
    }

    function renderProducts() {
      const list = node("#productList");
      list.replaceChildren(...project.products.map((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "product-list-item secondary";
        button.dataset.productId = item.id;
        button.setAttribute("aria-current", String(item.id === productId));
        const title = document.createElement("strong");
        title.textContent = item.revision.product_name || "未命名商品";
        const meta = document.createElement("span");
        meta.textContent = item.id === productId ? avatarStage?.business_status || "当前商品" : "打开人物选择";
        button.append(title, meta);
        button.addEventListener("click", () => {
          selectedProductTrigger = button;
          guardNavigation(() => navigate(item.id));
        });
        return button;
      }));
    }

    function renderCatalog() {
      const list = node("#avatarCatalogList");
      const fragment = document.createDocumentFragment();
      for (const entry of catalog()) {
        const item = document.createElement("div");
        item.setAttribute("role", "listitem");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "workspace-avatar-item";
        button.dataset.avatarId = entry.id;
        button.dataset.avatarVersionId = entry.asset_version.id;
        button.setAttribute("aria-current", String(entry.asset_version.id === viewedAvatarVersionId));
        const copy = document.createElement("span");
        copy.className = "workspace-avatar-item-copy";
        const title = document.createElement("strong");
        title.textContent = entry.display_name;
        const meta = document.createElement("small");
        meta.textContent = entry.gate?.can_confirm ? (entry.asset_version.id === currentSelection()?.asset_version_id ? "当前已确认" : "可选择") : "当前不可确认";
        copy.append(title, meta);
        button.append(thumbContent(entry), copy);
        button.addEventListener("click", () => selectEntry(entry, button));
        item.append(button);
        fragment.append(item);
        if ("IntersectionObserver" in window) {
          const observer = new IntersectionObserver((records) => {
            if (records.some((record) => record.isIntersecting)) { observer.disconnect(); queuePreview(entry); }
          }, { rootMargin: "80px" });
          observer.observe(button);
        } else queuePreview(entry);
      }
      list.replaceChildren(fragment);
    }

    function renderDetail() {
      const entry = viewedEntry();
      if (!entry) return;
      node("#avatarDetailHeading").textContent = entry.display_name;
      node("#avatarDetailDescription").textContent = entry.description || "暂无人物说明。";
      const detailStatus = node("#avatarDetailStatus");
      detailStatus.textContent = entry.asset_version.id === currentSelection()?.asset_version_id && avatarWorkspace().selection.current_valid
        ? "当前已确认" : entry.gate?.can_confirm ? "可选择" : "当前不可确认";
      detailStatus.className = `state ${entry.gate?.can_confirm ? "available" : "blocked"}`;
      node("#avatarAuthorizationFact").textContent = authorizationLabels[entry.authorization_status] || "授权状态未知";
      node("#avatarMaterialFact").textContent = entry.materials_accessible ? "人物图片可用" : "人物图片不可用";
      node("#avatarCapabilityFact").textContent = entry.verified_capabilities?.length
        ? entry.verified_capabilities.map((item) => item.label).join("、") : "没有已验证能力";
      node("#avatarTechnicalVersion").textContent = `目录版本 v${entry.asset_version.version_number} · ${entry.asset_version.id}`;
      node("#avatarEvidenceList").textContent = entry.verified_capabilities?.length
        ? entry.verified_capabilities.map((item) => `${item.label}: ${item.evidence_reference}`).join("；") : "无";
      updatePreviewNodes(entry);
      queuePreview(entry);
    }

    function selectEntry(entry, trigger) {
      viewedAvatarVersionId = entry.asset_version.id;
      selectedAvatarTrigger = trigger;
      if (entry.gate?.can_confirm) selectedAvatarVersionId = entry.asset_version.id;
      conflict = false;
      document.body.dataset.avatarMobileLayer = "detail";
      renderCatalog();
      renderDetail();
      renderSummary();
      const replacement = node(`[data-avatar-version-id="${CSS.escape(entry.asset_version.id)}"]`);
      selectedAvatarTrigger = replacement;
      if (matchMedia("(max-width: 680px)").matches) node("#avatarDetailHeading").focus();
      else replacement?.focus();
    }

    function renderAvatar() {
      node("#avatarWorkspaceLoading").hidden = true;
      node("#avatarWorkspaceContent").hidden = false;
      node("#avatarSelectionState").textContent = avatarWorkspace().selection.current_valid ? "人物已确认" : currentSelection() ? "人物选择已失效" : "尚未确认人物";
      node("#avatarSelectionState").className = `state ${avatarWorkspace().selection.current_valid ? "approved" : "pending"}`;
      const initial = entryByVersion(viewedAvatarVersionId) || entryByVersion(currentSelection()?.asset_version_id) ||
        catalog().find((item) => item.recommendation?.recommended) || catalog()[0] || null;
      viewedAvatarVersionId = initial?.asset_version.id || null;
      renderCatalog();
      if (initial) renderDetail();
      else {
        node("#avatarDetailHeading").textContent = "当前没有可见人物";
        node("#avatarDetailDescription").textContent = "请刷新人物目录或联系管理员核对企业人物素材。";
      }
      renderSummary();
    }

    function disableForReadFailure() {
      readFailed = true;
      trusted = true;
      workspace = null;
      avatarStage = null;
      selectedAvatarVersionId = null;
      viewedAvatarVersionId = null;
      node("#avatarWorkspaceLoading").hidden = true;
      node("#avatarWorkspaceContent").hidden = true;
      node("#avatarWorkspacePanel").hidden = false;
      node("#avatarSelectionState").textContent = "读取失败";
      setStageLinks({ projectId, productId, failed: true });
      renderSummary();
    }

    async function load({ focus = true, preservePending = false } = {}) {
      const requestedProduct = productId;
      const pending = preservePending ? selectedAvatarVersionId : null;
      const query = new URLSearchParams({ stage: "avatar" });
      if (copyVersionId) query.set("copy", copyVersionId);
      const [workspaceBody, projectBody] = await Promise.all([
        request(`/api/projects/${encodeURIComponent(projectId)}/products/${encodeURIComponent(requestedProduct)}/operator-workspace?${query}`),
        request(`/api/projects/${encodeURIComponent(projectId)}`)
      ]);
      if (productId !== requestedProduct) return;
      if (!validateProjection(workspaceBody.workspace)) { trusted = false; throw new Error("OPERATOR_WORKSPACE_RESPONSE_INVALID"); }
      const exactProduct = projectBody.project?.products?.find((item) => item.id === requestedProduct);
      if (!exactProduct || exactProduct.current_revision_id !== workspaceBody.workspace.product.current_revision_id) {
        throw new Error("OPERATOR_WORKSPACE_RESPONSE_INVALID");
      }
      const nextAvatarStage = workspaceBody.workspace.stages.find((stage) => stage.code === "avatar");
      invalidatePreviewCache(nextAvatarStage?.avatar_workspace?.catalog);
      workspace = workspaceBody.workspace;
      project = projectBody.project;
      avatarStage = nextAvatarStage;
      copyVersionId = avatarWorkspace().resolved_copy_version_id || workspace.stages.find((stage) => stage.code === "copy")?.current_copy_version_id || null;
      const currentVersion = avatarWorkspace().selection.current_selection?.asset_version_id || null;
      selectedAvatarVersionId = preservePending && entryByVersion(pending)?.gate?.can_confirm ? pending : currentVersion;
      viewedAvatarVersionId = entryByVersion(viewedAvatarVersionId)?.asset_version.id || selectedAvatarVersionId;
      trusted = true;
      readFailed = false;
      conflict = false;
      document.body.dataset.workspaceStage = "avatar";
      node("#avatarWorkspacePanel").classList.add("workspace-task-panel");
      node("#avatarWorkspacePanel").dataset.workspacePanel = "current-task";
      node("#projectName").textContent = project.name;
      node("#editor").hidden = true;
      node("#copyWorkspacePanel").hidden = true;
      node("#avatarWorkspacePanel").hidden = false;
      renderProducts();
      setStageLinks({ projectId, productId, copyVersionId });
      renderAvatar();
      if (focus) node("#avatarWorkspaceHeading").focus();
    }

    function replaceUrl() {
      history.replaceState({ ...(history.state || {}), avatarWorkspaceHistoryIndex: acceptedHistoryIndex, productId }, "",
        workspaceUrl(projectId, productId, "avatar", copyVersionId));
    }

    async function bootstrap({ focus = true } = {}) {
      node("#avatarWorkspaceLoading").hidden = false;
      node("#avatarWorkspaceContent").hidden = true;
      try {
        const runtime = await request("/api/runtime");
        await request("/api/auth/me");
        if (!runtime.operatorWorkspaceEnabled || !runtime.avatarSelectionEnabled || !runtime.copyReviewEnabled) {
          const target = new URL("/avatar.html", location.origin);
          target.searchParams.set("project", projectId);
          target.searchParams.set("product", productId);
          if (copyVersionId) target.searchParams.set("copy", copyVersionId);
          location.replace(`${target.pathname}${target.search}`);
          return;
        }
        await load({ focus });
        replaceUrl();
      } catch (_error) {
        disableForReadFailure();
      }
    }

    async function navigate(nextProductId) {
      productId = nextProductId;
      copyVersionId = null;
      selectedAvatarVersionId = null;
      viewedAvatarVersionId = null;
      acceptedHistoryIndex += 1;
      history.pushState({ avatarWorkspaceHistoryIndex: acceptedHistoryIndex, productId }, "",
        workspaceUrl(projectId, productId, "avatar"));
      document.body.dataset.mobileLayer = "detail";
      document.body.dataset.avatarMobileLayer = "list";
      await bootstrap();
    }

    async function applyHistoryEntry(targetIndex) {
      acceptedHistoryIndex = targetIndex;
      const url = new URL(location.href);
      productId = url.searchParams.get("product");
      copyVersionId = url.searchParams.get("copy");
      selectedAvatarVersionId = null;
      viewedAvatarVersionId = null;
      logicalSelectionKey = null;
      conflict = false;
      document.body.dataset.mobileLayer = "detail";
      document.body.dataset.avatarMobileLayer = "list";
      if (!productId) return location.reload();
      await bootstrap();
    }

    function guardNavigation(work) {
      if (!isDirty()) return work();
      pendingNavigation = work;
      dialogTrigger = document.activeElement;
      pendingDialog.showModal();
      node("#keepWorkspaceAvatarSelection").focus();
    }

    function closeConfirm({ restore = true } = {}) {
      confirmDialog.close();
      conflict = false;
      node("#workspaceAvatarConflict").hidden = true;
      node("#workspaceAvatarConfirmError").textContent = "";
      if (restore) dialogTrigger?.focus();
    }

    async function confirmSelection() {
      const entry = entryByVersion(selectedAvatarVersionId);
      if (!entry?.gate?.can_confirm || busy) return false;
      busy = true;
      renderSummary();
      try {
        await request(`/api/products/${encodeURIComponent(productId)}/avatar-selections`, {
          method: "POST", headers: { "content-type": "application/json", "idempotency-key": logicalSelectionKey },
          body: JSON.stringify({ copy_version_id: copyVersionId, asset_version_id: entry.asset_version.id,
            expected_revision: avatarWorkspace().selection.selection_revision })
        });
        logicalSelectionKey = null;
        await load({ focus: false });
        replaceUrl();
        closeConfirm({ restore: false });
        node("#avatarWorkspaceHeading").focus();
        return true;
      } catch (error) {
        if (error.status === 409) {
          conflict = true;
          node("#workspaceAvatarConfirmError").textContent = "人物选择已被其他成员更新，请载入最新状态后再确认。";
          node("#workspaceAvatarConflict").hidden = false;
          node("#confirmWorkspaceAvatar").disabled = true;
        } else node("#workspaceAvatarConfirmError").textContent = "人物选择未保存，请稍后重试。";
        return false;
      } finally {
        busy = false;
        renderSummary();
      }
    }

    async function execute(code) {
      if (!actions[code] || actions[code].stage !== "avatar") return;
      if (code === "retry_avatar_read") return bootstrap();
      if (code === "return_to_copy") return location.assign(workspaceUrl(projectId, productId, "copy", copyVersionId));
      if (code === "select_avatar") {
        const target = catalog().find((item) => item.gate?.can_confirm);
        return node(`[data-avatar-id="${CSS.escape(target?.id || "")}"]`)?.focus();
      }
      if (code === "confirm_avatar_selection") {
        const entry = entryByVersion(selectedAvatarVersionId);
        if (!entry?.gate?.can_confirm) return;
        logicalSelectionKey ||= crypto.randomUUID();
        dialogTrigger = primary;
        node("#workspaceAvatarConfirmMessage").textContent = `确认选择「${entry.display_name}」？视频方案会引用当前人物版本。`;
        node("#workspaceAvatarConfirmError").textContent = "";
        node("#workspaceAvatarConflict").hidden = true;
        node("#confirmWorkspaceAvatar").disabled = false;
        confirmDialog.showModal();
        node("#confirmWorkspaceAvatar").focus();
        return;
      }
      if (code === "load_latest_avatar_selection") {
        await load({ focus: false, preservePending: true });
        logicalSelectionKey = crypto.randomUUID();
        conflict = false;
        node("#workspaceAvatarConflict").hidden = true;
        node("#confirmWorkspaceAvatar").disabled = false;
        node("#workspaceAvatarConfirmError").textContent = "已载入最新人物状态；本地选择仍保留，请重新确认。";
        renderSummary();
        return;
      }
      if (code === "continue_to_video_plan") return location.assign(legacyUrl("video_plan", projectId, productId));
    }

    function bind() {
      primary.addEventListener("click", () => execute(primary.dataset.actionCode));
      node("#refreshAvatarWorkspace").addEventListener("click", () => guardNavigation(() => bootstrap()));
      node("#retryAvatarPreview").addEventListener("click", () => {
        const entry = viewedEntry();
        if (entry) authorizePreview(entry, true);
      });
      node("#mobileAvatarProductBack").addEventListener("click", () => {
        guardNavigation(() => {
          document.body.dataset.mobileLayer = "list";
          const target = selectedProductTrigger?.isConnected ? selectedProductTrigger :
            node(`#productList [data-product-id="${CSS.escape(productId)}"]`);
          target?.focus();
        });
      });
      node("#mobileAvatarDetailBack").addEventListener("click", () => {
        document.body.dataset.avatarMobileLayer = "list";
        const target = selectedAvatarTrigger?.isConnected ? selectedAvatarTrigger :
          node(`[data-avatar-version-id="${CSS.escape(viewedAvatarVersionId || "")}"]`);
        target?.focus();
      });
      node("#closeWorkspaceAvatarConfirm").addEventListener("click", () => closeConfirm());
      node("#cancelWorkspaceAvatarConfirm").addEventListener("click", () => closeConfirm());
      node("#workspaceAvatarConfirmForm").addEventListener("submit", async (event) => { event.preventDefault(); await confirmSelection(); });
      node("#loadLatestAvatarSelection").addEventListener("click", () => execute("load_latest_avatar_selection"));
      node("#keepWorkspaceAvatarSelection").addEventListener("click", () => {
        pendingNavigation = null;
        pendingHistory = null;
        historyTraversal = null;
        pendingDialog.close();
        dialogTrigger?.focus();
      });
      node("#closeWorkspaceAvatarPending").addEventListener("click", () => {
        pendingNavigation = null;
        pendingHistory = null;
        historyTraversal = null;
        pendingDialog.close();
        dialogTrigger?.focus();
      });
      node("#discardWorkspaceAvatarSelection").addEventListener("click", async () => {
        selectedAvatarVersionId = currentSelection()?.asset_version_id || null;
        const work = pendingNavigation;
        pendingNavigation = null;
        pendingDialog.close();
        if (work) await work();
      });
      window.addEventListener("beforeunload", (event) => { if (isDirty()) event.preventDefault(); });
      window.addEventListener("popstate", async (event) => {
        const targetIndex = Number.isInteger(event.state?.avatarWorkspaceHistoryIndex) ? event.state.avatarWorkspaceHistoryIndex : null;
        if (historyTraversal === "restore_accepted") {
          historyTraversal = null;
          if (pendingHistory) {
            const pendingTargetIndex = pendingHistory.targetIndex;
            pendingNavigation = async () => {
              const delta = pendingTargetIndex - acceptedHistoryIndex;
              pendingHistory = null;
              historyTraversal = "apply_pending";
              history.go(delta);
            };
            dialogTrigger = selectedAvatarTrigger || primary;
            pendingDialog.showModal();
            node("#keepWorkspaceAvatarSelection").focus();
          }
          return;
        }
        if (historyTraversal === "apply_pending") {
          historyTraversal = null;
          pendingHistory = null;
          if (targetIndex == null) return location.reload();
          await applyHistoryEntry(targetIndex);
          return;
        }
        if (targetIndex == null) return location.reload();
        if (isDirty()) {
          pendingHistory = { targetIndex };
          historyTraversal = "restore_accepted";
          history.go(acceptedHistoryIndex - targetIndex);
          return;
        }
        await applyHistoryEntry(targetIndex);
      });
    }

    async function start() {
      acceptedHistoryIndex = Number.isInteger(history.state?.avatarWorkspaceHistoryIndex)
        ? history.state.avatarWorkspaceHistoryIndex : 0;
      history.replaceState({ ...(history.state || {}), avatarWorkspaceHistoryIndex: acceptedHistoryIndex, productId }, "", location.href);
      document.body.dataset.mobileLayer = "detail";
      document.body.dataset.avatarMobileLayer = "list";
      bind();
      await bootstrap({ focus: false });
    }

    return { start };
  }

  window.HiflyAvatarWorkspace = {
    async start({ projectId, productId, copyVersionId }) {
      if (!projectId || !productId) return location.replace("/projects.html");
      return createController({ projectId, initialProductId: productId, initialCopyVersionId: copyVersionId }).start();
    }
  };
})();
