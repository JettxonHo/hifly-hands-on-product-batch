(async () => {
  const params = new URLSearchParams(location.search);
  const projectId = params.get("project");
  let requestedRevisionId = params.get("revision");
  let project, revision, runtime, copyVersion;
  let copyJobs = [], copyVersions = [], copyPollTimer;
  let dirty = false, deriveMode = false, conflictDraft = null, pendingNavigation = null;

  const revisionLabels = { draft: "草稿", ready: "已 Ready", superseded: "已被替代" };
  const copyLabels = { draft: "草稿", frozen: "已冻结", superseded: "已被替代" };
  const csrf = () => decodeURIComponent((document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hifly_identity_csrf=")) || "=").split("=").slice(1).join("="));
  const element = (selector) => document.querySelector(selector);

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
    element("#productFactsLink").href = `/project.html?id=${encodeURIComponent(project.id)}`;

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
    element("#saveState").textContent = dirty ? "有未保存的修改" : "已保存";
  }

  function renderEditor() {
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
  window.addEventListener("beforeunload", (event) => { if (dirty) event.preventDefault(); });

  if (!projectId) return location.replace("/projects.html");
  try {
    runtime = await request("/api/runtime");
    if (!runtime.projectContentEnabled || !runtime.copyGenerationEnabled) return location.replace("/projects.html");
    await loadProject();
  } catch (_error) {
    element("#copyLoading").hidden = true;
    setNotice(element("#pageNotice"), "文案工作区暂时无法加载，请返回项目后重试。", "error");
  }
})();
