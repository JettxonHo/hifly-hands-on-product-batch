(async () => {
  const params = new URLSearchParams(location.search);
  const projectId = params.get("project");
  let requestedRevisionId = params.get("revision");
  let project, revision, runtime, identityContext, copyVersion;
  let copyJobs = [], copyVersions = [], copyPollTimer;
  let qualityRuns = [], qualityDetails = [], qualityPollTimer, activeFinding;
  let rewriteJobs = [], rewritePollTimer, activeRewriteFinding, handledRewriteJobId;
  const observedActiveRewriteJobs = new Set();
  let rewriteSubmissionKey, rewriteSubmitting = false;
  let reviewState = null, reviewSubmitting = false, reviewReasonAction = "changes";
  let dirty = false, deriveMode = false, conflictDraft = null, pendingNavigation = null;

  const revisionLabels = { draft: "草稿", ready: "已 Ready", superseded: "已被替代" };
  const copyLabels = { draft: "草稿", frozen: "已冻结", superseded: "已被替代" };
  const qualityRunLabels = { queued: "排队中", running: "质检中", succeeded: "已完成", failed: "技术失败", cancelled: "已取消" };
  const conclusionLabels = { invalid: "质检结果无效", blocked: "存在硬阻断", needs_review: "待人工判断", passed: "质检通过" };
  const severityLabels = { low: "低", medium: "中", high: "高", critical: "严重" };
  const resolutionLabels = { accepted_with_reason: "已接受（附理由）", change_requested: "已要求修改", returned_to_facts: "已退回商品事实" };
  const reviewLabels = { pending: "审核中", approved: "已批准", changes_requested: "要求修改", revoked: "批准已失效" };
  const reviewEventLabels = { pending: "提交审核", approved: "批准文案", changes_requested: "要求修改", revoked: "撤销批准" };
  const gateReasonLabels = {
    copy_version_superseded: "文案版本已被替代，请对当前版本重新质检",
    copy_version_not_frozen: "文案尚未冻结，请先完成质检",
    quality_result_missing: "尚无可用质检结果",
    quality_result_replaced: "已有新的质检结果，需创建新审核周期",
    quality_result_invalidated: "质检结果已失效，请重新完整质检",
    product_revision_changed: "商品事实已有新版本，请返回商品与目标确认",
    quality_policy_changed: "质检规则已更新，请重新完整质检",
    quality_invalid: "质检结果无效，不能提交或批准",
    quality_blocked: "存在硬阻断，任何角色都不能批准",
    quality_needs_review: "请先逐项处理所有待人工判断 Finding"
  };
  const csrf = () => decodeURIComponent((document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hifly_identity_csrf=")) || "=").split("=").slice(1).join("="));
  const element = (selector) => document.querySelector(selector);

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.method && options.method !== "GET") headers.set("x-identity-csrf", csrf());
    const response = await fetch(url, { credentials: "same-origin", ...options, headers });
    if (response.status === 401) {
      location.replace("/login.html");
      throw new Error("AUTH_REQUIRED");
    }
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.error), { body, status: response.status });
    return body;
  }

  function setNotice(target, message = "", tone = "") {
    target.className = `notice${tone ? ` ${tone}` : ""}`;
    target.textContent = message;
  }

  function formatTime(value) {
    if (!value) return "时间待确认";
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  }

  function currentProduct() {
    return project?.products.find((item) => item.revision.id === revision?.id);
  }

  function updateAvatarLinks() {
    if (!project || !revision) return;
    const avatarHref = `/avatar.html?project=${encodeURIComponent(project.id)}&product=${encodeURIComponent(currentProduct()?.id || "")}&copy=${encodeURIComponent(copyVersion?.id || "")}`;
    element("#avatarStageLink").href = avatarHref;
    element("#mobileAvatarStageLink").href = avatarHref;
    element("#nextStageLink").href = avatarHref;
    const productionHref = `/production.html?project=${encodeURIComponent(project.id)}&product=${encodeURIComponent(currentProduct()?.id || "")}`;
    for (const selector of ["#productionStageLink", "#mobileProductionStageLink"]) {
      const link = element(selector);
      if (runtime?.productionOrdersEnabled === true) { link.href = productionHref; link.removeAttribute("aria-disabled"); }
      else { link.removeAttribute("href"); link.setAttribute("aria-disabled", "true"); }
    }
  }

  function updateLocation() {
    const next = new URL(location.href);
    next.searchParams.set("project", projectId);
    next.searchParams.set("revision", revision.id);
    history.replaceState(null, "", next);
  }

  function renderProductContext() {
    element("#projectBreadcrumb").textContent = project.name;
    element("#projectBreadcrumb").href = `/project.html?id=${encodeURIComponent(project.id)}`;
    element("#factsStageLink").href = `/project.html?id=${encodeURIComponent(project.id)}`;
    element("#mobileFactsStageLink").href = `/project.html?id=${encodeURIComponent(project.id)}`;
    element("#productFactsLink").href = `/project.html?id=${encodeURIComponent(project.id)}&revision=${encodeURIComponent(revision.id)}`;
    updateAvatarLinks();

    const selector = element("#productSelector");
    selector.replaceChildren(...project.products.map((item) => {
      const option = document.createElement("option");
      option.value = item.revision.id;
      option.textContent = `${item.revision.product_name || "未命名商品"} · ${revisionLabels[item.revision.status] || "状态待确认"}`;
      return option;
    }));
    selector.value = revision.id;
    const state = element("#revisionState");
    state.className = `state ${revision.status}`;
    state.textContent = revisionLabels[revision.status] || "状态待确认";
    element("#revisionMeta").textContent = `商品快照 v${revision.revision_number} · ${revision.primary_category || "未设置品类"}`;
    updateLocation();
  }

  function stopPolling() {
    if (copyPollTimer) clearTimeout(copyPollTimer);
    copyPollTimer = undefined;
  }

  function schedulePolling() {
    stopPolling();
    copyPollTimer = setTimeout(() => loadWorkspace().catch(() => undefined), 1000);
  }

  function versionAccessibleName(value) {
    return `v${value.version_number} · ${copyLabels[value.status] || "状态待确认"}`;
  }

  function createVersionButton(value, { mobile = false } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-version-row secondary";
    button.setAttribute("aria-current", String(value.id === copyVersion?.id));
    button.setAttribute("aria-label", versionAccessibleName(value));
    const title = document.createElement("span");
    title.className = "version-title";
    const name = document.createElement("strong");
    name.textContent = `v${value.version_number}`;
    const state = document.createElement("span");
    state.className = `state ${value.status}`;
    state.textContent = copyLabels[value.status] || "状态待确认";
    title.append(name, state);
    const meta = document.createElement("span");
    meta.className = "version-meta";
    const source = document.createElement("span");
    source.textContent = value.generation_job_id ? "AI 生成" : "人工修改";
    const time = document.createElement("time");
    time.dateTime = value.updated_at;
    time.textContent = formatTime(value.updated_at);
    meta.append(source, time);
    button.append(title, meta);
    button.addEventListener("click", () => attemptNavigation(async () => {
      selectVersion(value);
      if (mobile) element("#versionDialog").close();
    }));
    return button;
  }

  function renderVersionLists() {
    const desktop = element("#copyVersions"), mobile = element("#mobileCopyVersions");
    desktop.replaceChildren();
    mobile.replaceChildren();
    const ordered = [...copyVersions].sort((left, right) => right.version_number - left.version_number);
    if (!ordered.length) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "暂无文案版本";
      desktop.append(empty);
    } else {
      for (const value of ordered) {
        desktop.append(createVersionButton(value));
        mobile.append(createVersionButton(value, { mobile: true }));
      }
    }
    element("#openVersionDialog").textContent = copyVersion ? `当前版本 v${copyVersion.version_number} · ${copyLabels[copyVersion.status]}` : "选择文案版本";
  }

  function updateEditorMeta() {
    const body = element("#copyBody").value;
    element("#copyCount").textContent = `${[...body].length} 字`;
    const changed = copyVersion ? body !== copyVersion.body : false;
    dirty = (copyVersion?.status === "draft" || deriveMode) && changed;
    element("#saveCopy").disabled = !dirty;
    if (element("#startQuality")) element("#startQuality").disabled = dirty || deriveMode;
    element("#saveState").textContent = dirty ? "有未保存的修改" : "已保存";
  }

  function renderEditor() {
    updateAvatarLinks();
    const form = element("#copyForm"), body = element("#copyBody"), state = element("#copyState");
    element("#copyLoading").hidden = true;
    element("#copyEmpty").hidden = true;
    form.hidden = false;
    state.className = `state ${copyVersion.status}`;
    state.textContent = `${copyLabels[copyVersion.status] || "状态待确认"} · v${copyVersion.version_number}`;
    element("#copySource").textContent = copyVersion.generation_job_id ? "AI 生成" : "人工修改";
    body.value = copyVersion.body;
    body.readOnly = copyVersion.status !== "draft" && !deriveMode;
    element("#deriveCopy").hidden = copyVersion.status === "draft" || deriveMode;
    element("#saveCopy").textContent = deriveMode ? "保存为新草稿" : "保存草稿";
    element("#compareVersions").disabled = copyVersions.length < 2;
    if (deriveMode) setNotice(element("#readonlyNotice"), "修改后保存会创建新草稿，当前历史版本不会被覆盖。", "blocked");
    else if (copyVersion.status !== "draft") setNotice(element("#readonlyNotice"), "此版本已冻结并保持只读。如需修改，请基于它创建新草稿。", "");
    else setNotice(element("#readonlyNotice"));
    element("#conflictNotice").hidden = true;
    conflictDraft = null;
    updateEditorMeta();
    renderVersionLists();
  }

  function selectVersion(value) {
    copyVersion = value;
    deriveMode = false;
    dirty = false;
    renderEditor();
    loadQuality().then(loadReview).catch(() => undefined);
  }

  function stopQualityPolling() {
    if (qualityPollTimer) clearTimeout(qualityPollTimer);
    qualityPollTimer = undefined;
  }

  function stopRewritePolling() {
    if (rewritePollTimer) clearTimeout(rewritePollTimer);
    rewritePollTimer = undefined;
  }

  function scheduleRewritePolling() {
    stopRewritePolling();
    rewritePollTimer = setTimeout(() => loadWorkspace({ preferredId: copyVersion?.id }).catch(() => undefined), 1000);
  }

  function scheduleQualityPolling() {
    stopQualityPolling();
    qualityPollTimer = setTimeout(() => loadQuality().then(loadReview).catch(() => undefined), 1000);
  }

  function renderQualityHistory() {
    const list = element("#qualityHistory");
    list.replaceChildren();
    element("#qualityHistorySummary").textContent = `历史质检（${qualityRuns.length}）`;
    for (const details of [...qualityDetails].reverse()) {
      const item = document.createElement("div");
      item.className = "quality-history-item";
      const title = document.createElement("strong");
      title.textContent = details.quality_result ? conclusionLabels[details.quality_result.conclusion] : qualityRunLabels[details.quality_run.status];
      const meta = document.createElement("span");
      meta.textContent = `${details.quality_run.profile_version} · ${details.quality_run.rule_version} · ${formatTime(details.quality_run.created_at)}`;
      item.append(title, meta);
      list.append(item);
    }
  }

  function findingButton(label, action, className = "secondary") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = className;
    button.textContent = label;
    button.addEventListener("click", action);
    return button;
  }

  function renderFindings(details, { readOnly = false } = {}) {
    const list = element("#findingList");
    list.replaceChildren();
    for (const finding of details?.quality_findings || []) {
      const latest = finding.resolutions.at(-1);
      const card = document.createElement("article");
      card.className = `finding-card${latest ? " resolved" : ""}`;
      const kind = document.createElement("span");
      kind.className = `state ${finding.kind === "review" ? "needs_review" : "blocked"}`;
      kind.textContent = `${finding.kind === "review" ? "待人工判断" : "不可绕过门禁"} · ${severityLabels[finding.severity] || "等级待确认"}`;
      const title = document.createElement("h3"); title.textContent = finding.title;
      const message = document.createElement("p"); message.textContent = finding.message;
      const matched = document.createElement("blockquote"); matched.className = "finding-match";
      matched.textContent = `命中文本：${finding.matched_text || "未定位到具体片段"}`;
      const evidence = document.createElement("p"); evidence.className = "finding-meta";
      evidence.textContent = `规则来源：${finding.rule_source} · 证据引用：${finding.evidence_reference}`;
      const suggestion = document.createElement("p"); suggestion.className = "finding-suggestion";
      suggestion.textContent = `修复建议：${finding.suggestion}`;
      card.append(kind, title, matched, message, evidence, suggestion);
      if (latest) {
        const resolution = document.createElement("p"); resolution.className = "finding-resolution";
        resolution.textContent = `${resolutionLabels[latest.state] || "已处理"}${latest.reason ? `：${latest.reason}` : ""}`;
        card.append(resolution);
      } else if (readOnly) {
        const historical = document.createElement("p"); historical.className = "finding-resolution";
        historical.textContent = "结果已失效，仅供历史查看。";
        card.append(historical);
      } else {
        const actions = document.createElement("div"); actions.className = "button-row";
        if (finding.kind === "review") actions.append(findingButton("接受并填写理由", () => openAcceptFinding(finding)));
        actions.append(
          findingButton("返回商品事实", () => resolveFinding(finding, "returned_to_facts", "需要补充或修正商品事实")
            .then(() => { window.location.href = element("#productFactsLink").href; })
            .catch(() => setNotice(element("#qualityNotice"), "未能记录返回商品事实操作，请重试。", "error"))),
          findingButton("人工修改", () => resolveFinding(finding, "change_requested", "运营选择人工修改文案")
            .then(() => beginManualEdit())
            .catch(() => setNotice(element("#qualityNotice"), "未能进入人工修改，请重试。", "error"))),
          findingButton("AI 改写", () => openRewriteDialog(finding), "")
        );
        card.append(actions);
      }
      list.append(card);
    }
  }

  function renderQuality() {
    const loading = element("#qualityLoading"), content = element("#qualityContent");
    loading.hidden = true; content.hidden = false;
    const latest = qualityDetails.at(-1), run = latest?.quality_run, result = latest?.quality_result;
    const runState = element("#qualityRunState"), conclusion = element("#qualityConclusion");
    const start = element("#startQuality"), retry = element("#retryQuality"), cancel = element("#cancelQuality");
    if (!run || !["queued", "running"].includes(run.status)) setNotice(element("#qualityNotice"));
    retry.hidden = true; cancel.hidden = true; start.hidden = false;
    start.disabled = dirty || deriveMode || !copyVersion || !["draft", "frozen"].includes(copyVersion.status);
    renderQualityHistory(); renderFindings(latest, { readOnly: result?.current_valid === false });
    element("#reviewReminder").hidden = true;
    if (!run) {
      runState.className = "state"; runState.textContent = "未质检";
      conclusion.className = "state"; conclusion.textContent = "未质检";
      element("#qualityConclusionText").textContent = "尚未开始质检";
      element("#qualityGuidance").textContent = dirty ? "先保存当前修改，再开始完整质检。" : "开始质检会冻结当前草稿。";
      start.textContent = "开始质检"; stopQualityPolling(); return;
    }
    runState.className = `state ${run.status}`; runState.textContent = qualityRunLabels[run.status] || "状态待确认";
    if (["queued", "running"].includes(run.status)) {
      conclusion.className = "state running"; conclusion.textContent = "质检中";
      element("#qualityConclusionText").textContent = "质检中，可离开本页";
      element("#qualityGuidance").textContent = "结果会由服务端保存，重新进入后可继续。";
      start.hidden = true; cancel.hidden = false; scheduleQualityPolling(); return;
    }
    stopQualityPolling();
    if (run.status === "failed") {
      const factsStale = run.failure_code === "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT";
      conclusion.className = factsStale ? "state blocked" : "state failed";
      conclusion.textContent = factsStale ? "商品事实已失效" : "技术失败";
      element("#qualityConclusionText").textContent = factsStale ? "商品事实已更新，当前质检已停止" : "质检未完成（技术原因）";
      element("#qualityGuidance").textContent = factsStale ?
        "请返回商品事实确认最新快照，再为最新商品版本生成文案并重新质检。" :
        "没有形成业务质检结论，可以安全重新质检。";
      start.hidden = true; retry.hidden = factsStale; return;
    }
    if (!result) {
      conclusion.className = "state"; conclusion.textContent = qualityRunLabels[run.status] || "未完成";
      element("#qualityConclusionText").textContent = "本次质检未形成结论";
      element("#qualityGuidance").textContent = "可以重新发起完整质检。";
      start.textContent = "重新质检"; return;
    }
    if (result.current_valid === false) {
      const factsChanged = result.invalidation_reason === "product_revision_changed";
      conclusion.className = "state blocked"; conclusion.textContent = "结论已失效";
      element("#qualityConclusionText").textContent = factsChanged ?
        "质检结论已失效：商品事实已有新版本，请重新确认后质检。" :
        "质检结论已失效：质检规则已更新，请重新完整质检。";
      element("#qualityGuidance").textContent = factsChanged ?
        "请返回商品事实确认当前版本，再为最新文案执行完整质检。" :
        "历史结论已保留，但不能继续使用；请按当前规则重新质检。";
      start.textContent = "重新质检"; start.hidden = factsChanged;
      element("#reviewReminder").hidden = true; return;
    }
    const unresolved = latest.quality_findings.filter((finding) => finding.kind === "review" &&
      finding.resolutions.at(-1)?.state !== "accepted_with_reason").length;
    conclusion.className = `state ${result.effective_conclusion}`;
    conclusion.textContent = conclusionLabels[result.effective_conclusion] || "结论待确认";
    element("#qualityConclusionText").textContent = result.effective_conclusion === "needs_review" ? `待人工判断（${unresolved} 条）` : conclusionLabels[result.effective_conclusion];
    const guidance = {
      invalid: "本次检查未得到可信结果，请重新质检。",
      blocked: "必须修正文案或商品事实并完整重新质检，不能绕过。",
      needs_review: "请逐条处理所有 Finding。",
      passed: result.conclusion === "needs_review" ? "Finding 已逐条处理，原始质检结论和处理历史均已保留。" : "文案已通过质检，但不等于人工审核通过。"
    };
    element("#qualityGuidance").textContent = guidance[result.effective_conclusion];
    start.textContent = "重新质检";
    start.hidden = !["invalid"].includes(result.effective_conclusion);
    element("#reviewReminder").hidden = result.effective_conclusion !== "passed";
  }

  async function loadQuality() {
    stopQualityPolling();
    element(".copy-workspace").classList.toggle("quality-disabled", !runtime?.copyQualityEnabled);
    if (!runtime?.copyQualityEnabled || !copyVersion) {
      element("#qualityPanel").hidden = !runtime?.copyQualityEnabled;
      qualityRuns = []; qualityDetails = []; rewriteJobs = []; renderQuality(); return;
    }
    element("#qualityPanel").hidden = false;
    const listed = await request(`/api/copy-versions/${copyVersion.id}/quality-runs`);
    qualityRuns = listed.quality_runs;
    qualityDetails = await Promise.all(qualityRuns.map((run) => request(`/api/quality-runs/${run.id}`)));
    renderQuality();
    const rewriteList = await request(`/api/copy-versions/${copyVersion.id}/rewrite-jobs`);
    rewriteJobs = rewriteList.rewrite_jobs;
    const latestRewrite = rewriteJobs.at(-1);
    const rewriteFactsStale = latestRewrite?.failure_code === "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT";
    element("#retryRewrite").hidden = rewriteFactsStale || !["failed", "timed_out"].includes(latestRewrite?.status) ||
      latestRewrite.attempts >= latestRewrite.max_attempts;
    if (["queued", "running"].includes(latestRewrite?.status)) {
      observedActiveRewriteJobs.add(latestRewrite.id);
      setNotice(element("#qualityNotice"), latestRewrite.status === "queued" ? "AI 改写已排队，可离开或刷新页面。" : "AI 正在改写，可离开或刷新页面。", "");
      scheduleRewritePolling();
    } else {
      stopRewritePolling();
      if (latestRewrite?.status === "succeeded" && latestRewrite.output_copy_version_id &&
        observedActiveRewriteJobs.has(latestRewrite.id) && latestRewrite.id !== handledRewriteJobId &&
        latestRewrite.output_copy_version_id !== copyVersion.id) {
        handledRewriteJobId = latestRewrite.id;
        await loadWorkspace({ preferredId: latestRewrite.output_copy_version_id });
        setNotice(element("#qualityNotice"), "AI 改写已生成新版本，并已进入完整质检。", "success");
      } else if (["failed", "timed_out"].includes(latestRewrite?.status)) {
        setNotice(element("#qualityNotice"), rewriteFactsStale ?
          "商品事实已更新，AI 改写已停止。请返回商品事实确认最新内容。" :
          "AI 改写未完成，原版本和质检历史未受影响。可以安全重试。", rewriteFactsStale ? "blocked" : "error");
      }
    }
  }

  function selectPanel(name) {
    const qualitySelected = name === "quality";
    element("#qualityTab").setAttribute("aria-selected", String(qualitySelected));
    element("#reviewTab").setAttribute("aria-selected", String(!qualitySelected));
    element("#qualityTabPanel").hidden = !qualitySelected;
    element("#reviewTabPanel").hidden = qualitySelected;
  }

  function latestQualityResult() {
    return qualityDetails.at(-1)?.quality_result || null;
  }

  function renderReviewGate() {
    const result = latestQualityResult();
    const checks = [
      { ready: copyVersion?.status === "frozen", text: "文案版本已冻结且未被替代" },
      { ready: Boolean(result?.current_valid), text: "存在当前有效的 QualityResult" },
      { ready: result?.effective_conclusion === "passed", text: "有效结论为质检通过，待判断项已逐项处理" },
      { ready: revision?.status === "ready" && !reviewState?.gate?.reasons.some((reason) => ["product_revision_changed", "quality_policy_changed"].includes(reason)),
        text: "商品快照、QC Profile 与规则版本仍为当前版本" }
    ];
    const list = element("#reviewGateList");
    list.replaceChildren(...checks.map((check) => {
      const item = document.createElement("li"); item.className = `review-gate-item${check.ready ? " ready" : ""}`;
      item.textContent = check.text; return item;
    }));
  }

  function renderReviewHistory() {
    const history = reviewState?.history || [], list = element("#reviewHistory");
    element("#reviewHistorySummary").textContent = `审核历史（${history.length}）`;
    list.replaceChildren(...[...history].reverse().map((record) => {
      const item = document.createElement("div"); item.className = "quality-history-item review-history-item";
      const title = document.createElement("strong"); title.textContent = reviewEventLabels[record.to_status] || "审核状态变化";
      const meta = document.createElement("span");
      meta.textContent = `${formatTime(record.created_at)} · 操作人 ${record.actor_member_id || "系统"}`;
      item.append(title, meta);
      if (record.reason || record.reason_code) {
        const reason = document.createElement("p"); reason.textContent = record.reason || gateReasonLabels[record.reason_code] || "相关上游输入已变化";
        item.append(reason);
      }
      return item;
    }));
  }

  function renderReview() {
    const enabled = runtime?.copyReviewEnabled === true;
    element("#reviewTab").hidden = !enabled;
    element("#reviewStateBadge").hidden = !enabled;
    element("#reviewLoading").hidden = true;
    element("#reviewContent").hidden = !enabled;
    for (const selector of ["#submitReview", "#approveReview", "#requestReviewChanges", "#revokeReview", "#nextStageLink"]) element(selector).hidden = true;
    if (!enabled) return;
    const review = reviewState?.current_review;
    const status = review?.status || "not_submitted";
    const label = reviewLabels[status] || "未提交审核";
    for (const selector of ["#reviewStateBadge", "#reviewConclusion"]) {
      const badge = element(selector); badge.className = `state ${status}`; badge.textContent = label;
    }
    renderReviewGate(); renderReviewHistory(); setNotice(element("#reviewNotice"));
    const reasons = reviewState?.gate?.reasons || [];
    if (status === "not_submitted") {
      element("#reviewConclusionText").textContent = "等待提交人工审核";
      element("#reviewGuidance").textContent = reasons.length ? (gateReasonLabels[reasons[0]] || "当前条件不满足，请先处理门禁。") : "质检通过不等于批准，提交后由审核人作出独立决策。";
      element("#submitReview").hidden = !reviewState?.gate?.can_submit;
    } else if (status === "pending") {
      element("#reviewConclusionText").textContent = "文案正在等待人工决策";
      element("#reviewGuidance").textContent = identityContext?.membership?.role === "admin" ? "批准前服务端会再次验证全部门禁。" : "你可以查看审核进度；管理员负责批准或要求修改。";
      if (identityContext?.membership?.role === "admin") {
        element("#approveReview").hidden = false; element("#approveReview").disabled = !reviewState.gate.can_approve;
        element("#requestReviewChanges").hidden = false;
      } else setNotice(element("#reviewNotice"), "当前账号为只读审核视角，请联系管理员完成决策。", "blocked");
    } else if (status === "approved") {
      element("#reviewConclusionText").textContent = review.review_mode === "self_review" ? "文案已批准 · 本人审核" : "文案已批准 · 当前有效";
      element("#reviewGuidance").textContent = "文案批准仍会在人物确认时由服务端再次验证。";
      element("#nextStageLink").hidden = false;
      element("#revokeReview").hidden = identityContext?.membership?.role !== "admin";
    } else if (status === "changes_requested") {
      element("#reviewConclusionText").textContent = "审核人要求修改文案";
      element("#reviewGuidance").textContent = review.decision_reason || "请基于此版本创建新草稿，修改后重新完整质检。";
    } else {
      element("#reviewConclusionText").textContent = "原批准已撤销，历史仍完整保留";
      element("#reviewGuidance").textContent = review.revoke_reason || gateReasonLabels[review.revoke_reason_code] || "请按当前商品事实和规则重新质检并创建新审核周期。";
      setNotice(element("#reviewNotice"), "此批准不可恢复；重新审核会创建新的 HumanReview。", "blocked");
      element("#submitReview").hidden = !reviewState?.gate?.can_submit;
    }
  }

  async function loadReview() {
    if (!runtime?.copyReviewEnabled || !copyVersion) { reviewState = null; renderReview(); return; }
    try {
      reviewState = await request(`/api/copy-versions/${copyVersion.id}/review`);
      renderReview();
      if (reviewState.current_review?.status === "pending") selectPanel("review");
    } catch (_error) {
      element("#reviewLoading").hidden = true; element("#reviewContent").hidden = false;
      setNotice(element("#reviewNotice"), "审核状态暂时无法读取，请刷新后重试。", "error");
    }
  }

  function setReviewButtonsLocked(locked) {
    reviewSubmitting = locked;
    for (const selector of ["#submitReview", "#approveReview", "#requestReviewChanges", "#revokeReview", "#confirmApproveReview", "#confirmReviewReason"]) element(selector).disabled = locked;
  }

  async function reviewCommand(url, payload, { closeDialog } = {}) {
    if (reviewSubmitting) return;
    setReviewButtonsLocked(true);
    try {
      reviewState = await request(url, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(payload) });
      closeDialog?.close(); renderReview(); selectPanel("review");
    } catch (error) {
      const message = error.status === 403 ? "当前账号没有审核决策权限。" : error.status === 409 ? "审核状态已被其他人更新，请刷新后重试。" :
        error.status === 422 ? (gateReasonLabels[error.body?.reasons?.[0]] || "上游状态已变化，当前不能完成审核。") : "审核请求未完成，请稍后重试。";
      setNotice(element("#reviewNotice"), message, error.status === 409 || error.status === 422 || error.status === 403 ? "blocked" : "error");
      await loadReview();
    } finally {
      reviewSubmitting = false;
      element("#confirmApproveReview").disabled = false;
      element("#confirmReviewReason").disabled = false;
      renderReview();
    }
  }

  function openApproveReview() {
    const review = reviewState?.current_review, result = latestQualityResult();
    element("#approveReviewSummary").textContent = `文案 v${copyVersion.version_number}\n商品快照 v${revision.revision_number}\n质检：${conclusionLabels[result?.effective_conclusion] || "待确认"}\n审核模式：${review?.author_member_id === identityContext?.member?.id ? "本人审核（self_review）" : "普通审核"}`;
    element("#approveReviewError").textContent = ""; element("#approveReviewDialog").showModal();
  }

  function openReviewReason(action) {
    reviewReasonAction = action; element("#reviewReasonTitle").textContent = action === "revoke" ? "撤销批准" : "要求修改";
    element("#reviewReason").value = ""; element("#reviewReasonError").textContent = ""; element("#reviewReasonDialog").showModal();
  }

  async function startQualityCheck() {
    if (!copyVersion || dirty || deriveMode) return;
    try {
      await request(`/api/copy-versions/${copyVersion.id}/quality-runs`, { method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ expected_revision: copyVersion.row_version }) });
      await loadWorkspace({ preferredId: copyVersion.id });
    } catch (error) {
      if (error.message === "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT") {
        setNotice(element("#qualityNotice"), "商品事实已更新或尚未确认，请返回商品事实完成确认后再质检。", "blocked");
      } else setNotice(element("#qualityNotice"), "质检请求未提交，请刷新后重试。", "error");
    }
  }

  async function retryQualityCheck() {
    const failed = qualityRuns.findLast((run) => run.status === "failed");
    if (!failed) return;
    try {
      await request(`/api/quality-runs/${failed.id}/retry`, { method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: "{}" });
      await loadQuality();
    } catch (_error) { setNotice(element("#qualityNotice"), "重新质检未提交，请刷新后再试。", "error"); }
  }

  async function cancelQualityCheck() {
    const active = qualityRuns.findLast((run) => ["queued", "running"].includes(run.status));
    if (!active) return;
    await request(`/api/quality-runs/${active.id}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    await loadQuality();
  }

  function openAcceptFinding(finding) {
    activeFinding = finding;
    element("#acceptFindingMessage").textContent = finding.title;
    element("#acceptReason").value = "";
    element("#acceptFindingError").textContent = "";
    element("#acceptFindingDialog").showModal();
    element("#acceptReason").focus();
  }

  async function resolveFinding(finding, resolution, reason) {
    const result = await request(`/api/quality-findings/${finding.id}/resolutions`, { method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify({ resolution, reason }) });
    qualityDetails = qualityDetails.map((details) => details.quality_run.id === result.quality_run.id ? result : details);
    renderQuality();
    return result;
  }

  function beginManualEdit() {
    if (!copyVersion) return;
    deriveMode = true; element("#copyBody").readOnly = false; element("#deriveCopy").hidden = true;
    element("#saveCopy").textContent = "保存为新草稿";
    setNotice(element("#readonlyNotice"), "修改后保存会创建新草稿；新版本需要重新完整质检。", "blocked");
    element("#copyBody").focus();
  }

  function openRewriteDialog(finding) {
    activeRewriteFinding = finding;
    rewriteSubmissionKey = crypto.randomUUID(); rewriteSubmitting = false;
    element("#submitRewrite").disabled = false; element("#submitRewrite").textContent = "提交改写任务";
    element("#rewriteFindingMessage").textContent = `${finding.title}：${finding.suggestion}`;
    element("#rewriteScope").value = finding.matched_text ? "matched_text" : "full";
    element("#rewriteInstruction").value = "";
    element("#rewriteError").textContent = "";
    element("#rewriteDialog").showModal();
    element("#rewriteInstruction").focus();
  }

  async function rewriteCopy() {
    if (rewriteSubmitting) return;
    rewriteSubmitting = true;
    const submit = element("#submitRewrite");
    submit.disabled = true; submit.textContent = "提交中…";
    try {
      const result = await request(`/api/copy-versions/${copyVersion.id}/rewrite-jobs`, { method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": rewriteSubmissionKey },
        body: JSON.stringify({ finding_id: activeRewriteFinding?.id,
          scope: element("#rewriteScope").value, instruction: element("#rewriteInstruction").value.trim() }) });
      rewriteJobs.push(result.rewrite_job);
      element("#rewriteDialog").close();
      rewriteSubmissionKey = undefined;
      setNotice(element("#qualityNotice"), "AI 改写已排队，可离开或刷新页面。", "success");
      scheduleRewritePolling();
    } catch (error) {
      if (error.message === "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT") {
        element("#rewriteError").textContent = "商品事实已更新，请返回商品事实确认最新内容。";
      } else element("#rewriteError").textContent = "改写任务未提交，请稍后重试。";
    } finally {
      rewriteSubmitting = false;
      if (element("#rewriteDialog").open) {
        submit.disabled = false; submit.textContent = "提交改写任务";
      }
    }
  }

  async function retryRewrite() {
    const failed = rewriteJobs.findLast((job) => ["failed", "timed_out"].includes(job.status));
    if (!failed) return;
    try {
      await request(`/api/rewrite-jobs/${failed.id}/retry`, { method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: "{}" });
      await loadQuality();
    } catch (error) {
      setNotice(element("#qualityNotice"), error.message === "COPY_QUALITY_PRODUCT_REVISION_NOT_CURRENT" ?
        "商品事实已更新，请返回商品事实确认最新内容。" : "AI 改写重试未提交，请稍后再试。", "error");
    }
  }

  function renderJobState() {
    const active = copyJobs.find((job) => ["queued", "running"].includes(job.status));
    const latest = copyJobs[0];
    const generate = element("#generateCopy"), mobileGenerate = element("#mobileGenerateCopy");
    const retry = element("#retryCopy"), mobileRetry = element("#mobileRetryCopy");
    const ready = revision.status === "ready";
    const generationDisabled = !ready || Boolean(active);
    for (const button of [generate, mobileGenerate]) {
      button.disabled = generationDisabled;
      button.textContent = active ? "生成中…" : (copyVersions.length ? "生成新文案" : "生成文案");
      button.classList.toggle("secondary", copyVersions.length > 0);
      button.title = ready ? (active ? "已有生成任务进行中，可离开页面后返回查看" : "") : "先完成商品信息、卖点与图片确认，并将商品快照设为 Ready";
    }
    for (const button of [retry, mobileRetry]) {
      button.hidden = latest?.status !== "failed" || latest.attempts >= latest.max_attempts;
      button.classList.toggle("secondary", copyVersions.length > 0);
    }

    if (!ready) {
      setNotice(element("#pageNotice"), "当前商品快照尚未 Ready。请返回商品与目标，完成商品信息、卖点和图片确认后再生成文案。", "blocked");
      stopPolling();
    } else if (active) {
      setNotice(element("#pageNotice"), "文案正在生成，可离开此页面。", "");
      schedulePolling();
    } else if (latest?.status === "failed") {
      setNotice(element("#pageNotice"), copyVersions.length ? "新文案生成失败，现有版本未受影响，可以安全重试。" : "文案生成失败，未产生文案版本。可以安全重试。", "error");
      stopPolling();
    } else if (latest?.status === "timed_out") {
      setNotice(element("#pageNotice"), "文案生成等待超时，未产生新版本。可以重新发起生成。", "blocked");
      stopPolling();
    } else {
      setNotice(element("#pageNotice"));
      stopPolling();
    }
  }

  function renderWorkspace() {
    element("#copyLoading").hidden = true;
    const preferred = copyVersion && copyVersions.find((value) => value.id === copyVersion.id);
    const next = preferred || copyVersions.find((value) => value.status === "draft") || copyVersions.at(-1);
    if (next) {
      copyVersion = next;
      deriveMode = false;
      dirty = false;
      renderEditor();
    } else {
      copyVersion = null;
      dirty = false;
      deriveMode = false;
      element("#copyForm").hidden = true;
      element("#copyEmpty").hidden = false;
      element("#openVersionDialog").textContent = "选择文案版本";
      renderVersionLists();
    }
    renderJobState();
  }

  async function loadWorkspace({ preferredId } = {}) {
    if (!revision) return;
    const revisionId = revision.id;
    const [jobsResult, copiesResult] = await Promise.all([
      request(`/api/product-revisions/${revisionId}/copy-generation-jobs`),
      request(`/api/product-revisions/${revisionId}/copy-versions`)
    ]);
    if (revision?.id !== revisionId) return;
    copyJobs = jobsResult.jobs;
    copyVersions = copiesResult.copy_versions;
    if (preferredId) copyVersion = copyVersions.find((value) => value.id === preferredId) || copyVersion;
    renderWorkspace();
    await loadQuality();
    await loadReview();
  }

  async function loadProject(selectRevisionId = requestedRevisionId) {
    project = (await request(`/api/projects/${projectId}`)).project;
    if (!project.products.length) return location.replace(`/project.html?id=${encodeURIComponent(projectId)}`);
    revision = project.products.find((item) => item.revision.id === selectRevisionId)?.revision || project.products[0].revision;
    requestedRevisionId = revision.id;
    renderProductContext();
    await loadWorkspace();
  }

  async function submitGeneration() {
    if (revision.status !== "ready") return;
    const buttons = [element("#generateCopy"), element("#mobileGenerateCopy")];
    buttons.forEach((button) => { button.disabled = true; button.textContent = "正在提交…"; });
    try {
      await request(`/api/product-revisions/${revision.id}/copy-generations`, {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ intent: "product_recommendation" })
      });
      if (element("#versionDialog").open) element("#versionDialog").close();
      await loadWorkspace();
    } catch (_error) {
      setNotice(element("#pageNotice"), "生成请求提交失败，请稍后重试。", "error");
      renderJobState();
    }
  }

  async function retryGeneration() {
    const failed = copyJobs.find((job) => job.status === "failed");
    if (!failed) return;
    element("#retryCopy").disabled = true;
    try {
      await request(`/api/copy-generation-jobs/${failed.id}/retry`, {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: "{}"
      });
      if (element("#versionDialog").open) element("#versionDialog").close();
      await loadWorkspace();
    } catch (_error) {
      setNotice(element("#pageNotice"), "重试请求未提交，请刷新状态后再试。", "error");
      element("#retryCopy").disabled = false;
    }
  }

  async function saveCopyDraft() {
    if (!copyVersion || !dirty) return false;
    const body = element("#copyBody").value.trim();
    if (!body) {
      setNotice(element("#copyNotice"), "文案正文不能为空。", "error");
      return false;
    }
    if (deriveMode && body === copyVersion.body) {
      setNotice(element("#copyNotice"), "请先修改文案内容，再保存为新草稿。", "blocked");
      return false;
    }
    element("#saveCopy").disabled = true;
    element("#saveState").textContent = "保存中…";
    const sourceId = copyVersion.id;
    try {
      const updated = (await request(`/api/copy-versions/${sourceId}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ expected_revision: copyVersion.row_version, body })
      })).copy_version;
      dirty = false;
      deriveMode = false;
      await loadWorkspace({ preferredId: updated.id });
      setNotice(element("#copyNotice"), updated.id === sourceId ? "文案草稿已保存。" : "已基于冻结版本创建新草稿。", "success");
      return true;
    } catch (error) {
      element("#saveCopy").disabled = false;
      element("#saveState").textContent = "保存失败";
      if (error.status === 409) {
        conflictDraft = element("#copyBody").value;
        element("#conflictNotice").hidden = false;
        setNotice(element("#copyNotice"));
      } else setNotice(element("#copyNotice"), "文案保存失败，请稍后重试。", "error");
      return false;
    }
  }

  async function attemptNavigation(work) {
    if (!dirty) return work();
    pendingNavigation = work;
    element("#unsavedNotice").hidden = false;
    element("#keepEditing").focus();
  }

  async function continuePending({ save }) {
    if (!pendingNavigation) return;
    if (save && !(await saveCopyDraft())) return;
    if (!save) {
      dirty = false;
      deriveMode = false;
    }
    const work = pendingNavigation;
    pendingNavigation = null;
    element("#unsavedNotice").hidden = true;
    await work();
  }

  function openCompareDialog() {
    const ordered = [...copyVersions].sort((left, right) => right.version_number - left.version_number);
    const options = ordered.map((value) => {
      const option = document.createElement("option");
      option.value = value.id;
      option.textContent = versionAccessibleName(value);
      return option;
    });
    element("#compareLeft").replaceChildren(...options.map((option) => option.cloneNode(true)));
    element("#compareRight").replaceChildren(...options.map((option) => option.cloneNode(true)));
    element("#compareLeft").value = copyVersion.id;
    element("#compareRight").value = ordered.find((value) => value.id !== copyVersion.id)?.id || copyVersion.id;
    renderComparison();
    element("#compareDialog").showModal();
  }

  function renderComparison() {
    for (const side of ["Left", "Right"]) {
      const value = copyVersions.find((item) => item.id === element(`#compare${side}`).value);
      element(`#compare${side}Title`).textContent = versionAccessibleName(value);
      element(`#compare${side}Body`).textContent = value.body;
    }
  }

  element("#productSelector").addEventListener("change", (event) => {
    const nextRevisionId = event.currentTarget.value;
    event.currentTarget.value = revision.id;
    attemptNavigation(async () => {
      revision = project.products.find((item) => item.revision.id === nextRevisionId).revision;
      copyVersion = null;
      requestedRevisionId = revision.id;
      renderProductContext();
      await loadWorkspace();
    });
  });
  element("#generateCopy").addEventListener("click", submitGeneration);
  element("#mobileGenerateCopy").addEventListener("click", submitGeneration);
  element("#retryCopy").addEventListener("click", retryGeneration);
  element("#mobileRetryCopy").addEventListener("click", retryGeneration);
  element("#refreshCopy").addEventListener("click", () => attemptNavigation(() => loadProject(revision.id)));
  element("#copyBody").addEventListener("input", updateEditorMeta);
  element("#copyForm").addEventListener("submit", async (event) => { event.preventDefault(); await saveCopyDraft(); });
  element("#deriveCopy").addEventListener("click", () => {
    deriveMode = true;
    element("#copyBody").readOnly = false;
    element("#deriveCopy").hidden = true;
    element("#saveCopy").textContent = "保存为新草稿";
    setNotice(element("#readonlyNotice"), "修改后保存会创建新草稿，当前历史版本不会被覆盖。", "blocked");
    updateEditorMeta();
    element("#copyBody").focus();
  });
  element("#saveAndContinue").addEventListener("click", () => continuePending({ save: true }));
  element("#discardAndContinue").addEventListener("click", () => continuePending({ save: false }));
  element("#keepEditing").addEventListener("click", () => { pendingNavigation = null; element("#unsavedNotice").hidden = true; element("#productSelector").value = revision.id; element("#copyBody").focus(); });
  element("#viewLatestCopy").addEventListener("click", async () => {
    const latest = (await request(`/api/copy-versions/${copyVersion.id}`)).copy_version;
    copyVersions = copyVersions.map((value) => value.id === latest.id ? latest : value);
    copyVersion = latest;
    deriveMode = false;
    dirty = false;
    element("#copyBody").value = latest.body;
    element("#copyBody").readOnly = latest.status !== "draft";
    element("#saveState").textContent = "已显示最新版本；你的修改仍可复制";
    renderVersionLists();
  });
  element("#copyLocalDraft").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(conflictDraft || ""); setNotice(element("#copyNotice"), "你的修改已复制。", "success"); }
    catch (_error) { setNotice(element("#copyNotice"), "浏览器未允许复制，请手动选择并复制正文。", "blocked"); }
  });
  element("#discardLocalDraft").addEventListener("click", async () => {
    conflictDraft = null;
    element("#conflictNotice").hidden = true;
    await loadWorkspace({ preferredId: copyVersion.id });
    setNotice(element("#copyNotice"), "已放弃本地修改并载入最新版本。", "");
  });
  element("#openVersionDialog").addEventListener("click", () => element("#versionDialog").showModal());
  element("#closeVersionDialog").addEventListener("click", () => element("#versionDialog").close());
  element("#compareVersions").addEventListener("click", openCompareDialog);
  element("#closeCompareDialog").addEventListener("click", () => element("#compareDialog").close());
  element("#compareLeft").addEventListener("change", renderComparison);
  element("#compareRight").addEventListener("change", renderComparison);
  element("#startQuality").addEventListener("click", startQualityCheck);
  element("#retryQuality").addEventListener("click", retryQualityCheck);
  element("#cancelQuality").addEventListener("click", cancelQualityCheck);
  element("#retryRewrite").addEventListener("click", retryRewrite);
  element("#qualityTab").addEventListener("click", () => selectPanel("quality"));
  element("#reviewTab").addEventListener("click", () => selectPanel("review"));
  element("#submitReview").addEventListener("click", () => reviewCommand(`/api/copy-versions/${copyVersion.id}/reviews`, {}));
  element("#approveReview").addEventListener("click", openApproveReview);
  element("#requestReviewChanges").addEventListener("click", () => openReviewReason("changes"));
  element("#revokeReview").addEventListener("click", () => openReviewReason("revoke"));
  element("#closeApproveReview").addEventListener("click", () => element("#approveReviewDialog").close());
  element("#cancelApproveReview").addEventListener("click", () => element("#approveReviewDialog").close());
  element("#closeReviewReason").addEventListener("click", () => element("#reviewReasonDialog").close());
  element("#cancelReviewReason").addEventListener("click", () => element("#reviewReasonDialog").close());
  element("#approveReviewForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const review = reviewState?.current_review;
    await reviewCommand(`/api/copy-reviews/${review.id}/approve`, { expected_revision: review.row_version }, { closeDialog: element("#approveReviewDialog") });
  });
  element("#reviewReasonForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const reason = element("#reviewReason").value.trim();
    if (!reason) { element("#reviewReasonError").textContent = reviewReasonAction === "revoke" ? "请填写撤销理由。" : "请填写修改意见。"; return; }
    const review = reviewState?.current_review;
    const action = reviewReasonAction === "revoke" ? "revoke" : "request-changes";
    await reviewCommand(`/api/copy-reviews/${review.id}/${action}`, { expected_revision: review.row_version, reason }, { closeDialog: element("#reviewReasonDialog") });
  });
  element("#closeAcceptFinding").addEventListener("click", () => element("#acceptFindingDialog").close());
  element("#cancelAcceptFinding").addEventListener("click", () => element("#acceptFindingDialog").close());
  element("#closeRewriteDialog").addEventListener("click", () => element("#rewriteDialog").close());
  element("#cancelRewrite").addEventListener("click", () => element("#rewriteDialog").close());
  element("#rewriteForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!element("#rewriteInstruction").value.trim()) {
      element("#rewriteError").textContent = "请填写业务改写要求。"; return;
    }
    await rewriteCopy();
  });
  element("#acceptFindingForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const reason = element("#acceptReason").value.trim();
    if (!reason) { element("#acceptFindingError").textContent = "请填写接受理由。"; return; }
    try { await resolveFinding(activeFinding, "accepted_with_reason", reason); element("#acceptFindingDialog").close(); }
    catch (_error) { element("#acceptFindingError").textContent = "Finding 处理失败，请刷新后重试。"; }
  });
  window.addEventListener("beforeunload", (event) => { if (dirty) event.preventDefault(); });

  if (!projectId) return location.replace("/projects.html");
  try {
    runtime = await request("/api/runtime");
    if (!runtime.projectContentEnabled || !runtime.copyGenerationEnabled) return location.replace("/projects.html");
    identityContext = await request("/api/auth/me");
    await loadProject();
  } catch (_error) {
    element("#copyLoading").hidden = true;
    setNotice(element("#pageNotice"), "文案工作区暂时无法加载，请返回项目后重试。", "error");
  }
})();
