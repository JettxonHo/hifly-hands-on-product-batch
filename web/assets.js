(async () => {
  const byId = (id) => document.getElementById(id);
  const kindLabels = { product_image: "商品图片", avatar_image: "人物图片", work_video: "作品视频" };
  const kindDescriptions = {
    product_image: "核验通过后才能被商品引用。",
    avatar_image: "核验通过后可进入企业人物目录。",
    work_video: "由系统完成生产后登记；此处只读。"
  };
  const assetLabels = { active: "可用", disabled: "已停用", deleted: "已删除" };
  const versionLabels = {
    upload_pending: "等待上传", uploading: "等待核验", verifying: "核验中",
    available: "核验通过", verification_failed: "核验失败", unavailable: "不可用"
  };
  const failures = {
    OBJECT_MISSING: "未找到上传文件，请重新选择图片上传。",
    FILE_TYPE_MISMATCH: "文件内容不是支持的图片格式，请重新选择 JPG、PNG 或 WebP。",
    SIZE_MISMATCH: "文件大小与上传声明不一致，请重新上传。",
    CHECKSUM_MISMATCH: "文件完整性核验失败，请重新上传。",
    OWNERSHIP_MISMATCH: "文件归属核验失败，请联系管理员。"
  };
  const pendingStatuses = new Set(["upload_pending", "uploading", "verifying"]);
  const dialogs = [byId("uploadDialog"), byId("renameDialog"), byId("assetDangerDialog")];
  const dialogTriggers = new Map();
  const workspace = document.querySelector(".asset-workspace");

  let assets = [];
  let activeKind = "product_image";
  let selectedAssetId = null;
  let identity = null;
  let loading = true;
  let loadError = false;
  let refreshInFlight = false;
  let pollTimer = null;
  let tornDown = false;
  let uploadBusy = false;
  let renameBusy = false;
  let renameConflictAssetId = null;
  let dangerIntent = null;

  const csrf = () => {
    const value = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hifly_identity_csrf="));
    return value ? decodeURIComponent(value.split("=").slice(1).join("=")) : "";
  };

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.method && options.method !== "GET") headers.set("x-identity-csrf", csrf());
    const response = await fetch(url, { credentials: "same-origin", ...options, headers });
    const body = response.headers.get("content-type")?.includes("json") ? await response.json() : null;
    if (response.status === 401 || (response.status === 403 && body?.error === "PASSWORD_CHANGE_REQUIRED")) {
      window.location.replace("/login.html");
      throw Object.assign(new Error("AUTH_REQUIRED"), { code: "AUTH_REQUIRED", status: response.status });
    }
    if (!response.ok) throw Object.assign(new Error(body?.error || "REQUEST_FAILED"), { code: body?.error || "REQUEST_FAILED", status: response.status });
    return body;
  }

  const currentAssets = () => assets.filter((asset) => asset.kind === activeKind);
  const selectedAsset = () => assets.find((asset) => asset.id === selectedAssetId) || null;
  const latestVersion = (asset) => asset?.versions?.[0] || null;
  const canWriteAsset = (asset) => asset && asset.kind !== "work_video" && asset.status === "active";
  const isAdmin = () => identity?.membership?.role === "admin";
  const usesSequentialLayout = () => window.matchMedia("(max-width: 900px)").matches;

  function clearRecommended() {
    document.querySelectorAll('#mainContent [data-recommended-action="true"]').forEach((node) => node.removeAttribute("data-recommended-action"));
  }

  function setRecommended(node) {
    clearRecommended();
    if (node && !node.hidden && !node.disabled) node.setAttribute("data-recommended-action", "true");
  }

  function setNotice(message = "", type = "") {
    const node = byId("assetNotice");
    node.className = `notice${type ? ` ${type}` : ""}`;
    node.textContent = message;
  }

  function stopPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  }

  function schedulePolling() {
    stopPolling();
    if (tornDown || !assets.some((asset) => asset.versions?.some((version) => pendingStatuses.has(version.status)))) return;
    pollTimer = setTimeout(() => { pollTimer = null; if (!tornDown) refresh({ preserveSelection: true, quiet: true }); }, 2000);
  }

  function showDialog(dialog, trigger = document.activeElement) {
    dialogTriggers.set(dialog, trigger);
    dialog.showModal();
    queueMicrotask(() => dialog.querySelector("input:not([type=hidden]), select, button")?.focus());
  }

  function closeDialog(dialog) {
    if (dialog.open) dialog.close();
  }

  for (const dialog of dialogs) {
    dialog.addEventListener("close", () => {
      if (dialog === byId("uploadDialog")) {
        byId("uploadForm").reset();
        byId("uploadAssetId").value = "";
        byId("assetKind").disabled = false;
        byId("uploadStatus").textContent = "";
        byId("uploadError").textContent = "";
      }
      const trigger = dialogTriggers.get(dialog);
      if (trigger?.isConnected) trigger.focus();
      dialogTriggers.delete(dialog);
    });
    dialog.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => closeDialog(dialog)));
  }

  function makeState(value, labels = versionLabels) {
    const node = document.createElement("span");
    node.className = `state ${value}`;
    node.textContent = labels[value] || value;
    return node;
  }

  function renderSummary() {
    const group = currentAssets();
    const selected = selectedAsset();
    byId("summaryKind").textContent = kindLabels[activeKind];
    byId("summaryCount").textContent = loading ? "--" : String(group.length);
    byId("summaryBlocker").textContent = "无";
    clearRecommended();
    if (loading) {
      byId("summaryStatus").textContent = "正在加载";
      byId("summaryNext").textContent = "等待素材加载完成";
      return;
    }
    if (loadError) {
      byId("summaryStatus").textContent = group.length ? "状态可能已过期" : "加载失败";
      byId("summaryBlocker").textContent = group.length ? "最新服务端状态暂不可用" : "当前分类状态未知";
      byId("summaryNext").textContent = "刷新当前分类";
      setRecommended(byId("refreshAssets"));
      return;
    }
    if (!group.length) {
      byId("summaryStatus").textContent = "暂无素材";
      if (activeKind === "work_video") {
        byId("summaryNext").textContent = "等待系统登记生产作品";
      } else {
        byId("summaryNext").textContent = `上传${kindLabels[activeKind]}`;
        setRecommended(byId("openUpload"));
      }
      return;
    }
    if (!selected || selected.kind !== activeKind) {
      byId("summaryStatus").textContent = "待选择";
      byId("summaryNext").textContent = "选择一个素材查看版本和状态";
      return;
    }
    const version = latestVersion(selected);
    byId("summaryStatus").textContent = `${assetLabels[selected.status] || selected.status} · ${versionLabels[version?.status] || "暂无版本"}`;
    if (selected.status === "disabled") {
      byId("summaryBlocker").textContent = "素材已停用";
      byId("summaryNext").textContent = "选择其他素材";
    } else if (version?.status === "verification_failed") {
      byId("summaryBlocker").textContent = failures[version.failure_code] || "最新版本核验失败";
      byId("summaryNext").textContent = "上传修正后的新版本";
      setRecommended(byId("uploadNewVersion"));
    } else if (pendingStatuses.has(version?.status)) {
      byId("summaryBlocker").textContent = "服务端尚未完成核验";
      byId("summaryNext").textContent = "等待核验完成，或刷新当前分类";
      setRecommended(byId("refreshAssets"));
    } else if (version?.status === "available") {
      byId("summaryNext").textContent = activeKind === "work_video" ? "查看或下载系统登记作品" : "查看版本，或继续上传新版本";
      setRecommended(document.querySelector('[data-action="download-version"]'));
    } else {
      byId("summaryNext").textContent = "查看版本状态";
    }
  }

  function renderTabs() {
    for (const kind of Object.keys(kindLabels)) {
      const button = document.querySelector(`[data-kind="${kind}"]`);
      button.setAttribute("aria-current", String(kind === activeKind));
      byId(kind === "product_image" ? "productImageCount" : kind === "avatar_image" ? "avatarImageCount" : "workVideoCount").textContent = String(assets.filter((asset) => asset.kind === kind).length);
    }
    byId("assetListTitle").textContent = kindLabels[activeKind];
    byId("assetListDescription").textContent = kindDescriptions[activeKind];
    byId("openUpload").hidden = activeKind === "work_video";
  }

  function renderList() {
    const node = byId("assetList");
    node.replaceChildren();
    if (loading) {
      const loadingNode = document.createElement("p"); loadingNode.className = "empty"; loadingNode.textContent = "正在加载素材..."; node.append(loadingNode); return;
    }
    if (loadError && !currentAssets().length) {
      const error = document.createElement("div"); error.className = "operator-empty";
      const title = document.createElement("strong"); title.textContent = "素材加载失败";
      const copy = document.createElement("span"); copy.textContent = "没有覆盖已有列表，请刷新当前分类后重试。";
      error.append(title, copy); node.append(error); return;
    }
    const group = currentAssets();
    if (!group.length) {
      const empty = document.createElement("div"); empty.className = "operator-empty empty";
      const title = document.createElement("strong"); title.textContent = `还没有${kindLabels[activeKind]}`;
      const copy = document.createElement("span"); copy.textContent = activeKind === "work_video" ? "生产完成并由系统登记后，作品会显示在这里。" : "上传图片后，服务端会校验类型、大小与文件完整性。";
      empty.append(title, copy); node.append(empty); return;
    }
    for (const asset of group) {
      const version = latestVersion(asset);
      const button = document.createElement("button");
      button.type = "button"; button.className = "asset-row"; button.dataset.assetId = asset.id;
      button.setAttribute("aria-current", String(asset.id === selectedAssetId));
      const main = document.createElement("span"); main.className = "asset-row-main";
      const name = document.createElement("span"); name.className = "asset-name"; name.textContent = asset.display_name;
      const meta = document.createElement("span"); meta.className = "asset-meta"; meta.textContent = `${asset.versions?.length || 0} 个版本 · ${version?.original_filename || "暂无文件"}`;
      main.append(name, meta); button.append(main, asset.status === "disabled" ? makeState("disabled", assetLabels) : makeState(version?.status || "unavailable"));
      button.addEventListener("click", () => selectAsset(asset.id, { openDetail: true, focusDetail: true }));
      node.append(button);
    }
  }

  function technicalDetails(version) {
    const details = document.createElement("details"); details.className = "operator-technical-details";
    const summary = document.createElement("summary"); summary.textContent = "技术详情";
    const list = document.createElement("dl");
    const facts = [
      ["版本 ID", version.id],
      ["媒体类型", version.verified_content_type || version.expected_content_type || "待核验"],
      ["文件大小", version.verified_size ?? version.expected_size ?? "待核验"],
      ["SHA-256", version.verified_checksum_sha256 || version.expected_checksum_sha256 || "待核验"]
    ];
    for (const [label, value] of facts) {
      const wrap = document.createElement("div"); const dt = document.createElement("dt"); const dd = document.createElement("dd");
      dt.textContent = label; dd.textContent = String(value); wrap.append(dt, dd); list.append(wrap);
    }
    details.append(summary, list); return details;
  }

  function renderDetail() {
    const node = byId("assetDetail");
    node.replaceChildren();
    const asset = selectedAsset();
    if (!asset || asset.kind !== activeKind) {
      const empty = document.createElement("div"); empty.className = "operator-empty";
      const title = document.createElement("strong"); title.id = "assetDetailTitle"; title.tabIndex = -1; title.textContent = "选择一个素材查看详情";
      const copy = document.createElement("span"); copy.textContent = "版本、核验结果和审计信息会显示在这里。";
      empty.append(title, copy); node.append(empty); return;
    }

    const header = document.createElement("div"); header.className = "asset-detail-header";
    const headingWrap = document.createElement("div"); const eyebrow = document.createElement("p"); eyebrow.className = "eyebrow"; eyebrow.textContent = kindLabels[asset.kind];
    const title = document.createElement("h2"); title.id = "assetDetailTitle"; title.tabIndex = -1; title.textContent = asset.display_name;
    headingWrap.append(eyebrow, title); header.append(headingWrap, makeState(asset.status, assetLabels)); node.append(header);

    const actions = document.createElement("div"); actions.className = "asset-detail-actions";
    if (canWriteAsset(asset)) {
      const upload = document.createElement("button"); upload.type = "button"; upload.id = "uploadNewVersion"; upload.textContent = "上传新版本"; upload.addEventListener("click", (event) => openUploadDialog(event.currentTarget, asset)); actions.append(upload);
      const rename = document.createElement("button"); rename.type = "button"; rename.className = "secondary"; rename.textContent = "重命名"; rename.addEventListener("click", (event) => openRenameDialog(event.currentTarget, asset)); actions.append(rename);
      if (isAdmin()) {
        const disable = document.createElement("button"); disable.type = "button"; disable.className = "secondary"; disable.textContent = "停用"; disable.addEventListener("click", (event) => openDangerDialog(event.currentTarget, asset, "disable")); actions.append(disable);
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "danger"; remove.textContent = "删除"; remove.addEventListener("click", (event) => openDangerDialog(event.currentTarget, asset, "delete")); actions.append(remove);
      }
    }
    if (actions.childElementCount) node.append(actions);

    const facts = document.createElement("dl"); facts.className = "asset-facts";
    for (const [label, value] of [["素材类型", kindLabels[asset.kind]], ["素材状态", assetLabels[asset.status] || asset.status], ["版本数量", String(asset.versions?.length || 0)], ["关联信息", "关联信息当前未提供"]]) {
      const wrap = document.createElement("div"); const dt = document.createElement("dt"); const dd = document.createElement("dd"); dt.textContent = label; dd.textContent = value; wrap.append(dt, dd); facts.append(wrap);
    }
    node.append(facts);

    const versionTitle = document.createElement("h3"); versionTitle.textContent = "版本历史"; node.append(versionTitle);
    const versions = document.createElement("div"); versions.className = "asset-version-list";
    for (const [index, version] of (asset.versions || []).entries()) {
      const card = document.createElement("article"); card.className = `asset-version${index === 0 ? " current" : ""}`;
      const head = document.createElement("div"); head.className = "asset-version-head";
      const copy = document.createElement("div"); const versionHeading = document.createElement("h3"); versionHeading.textContent = `版本 ${version.version_number ?? "系统"} · ${version.original_filename}`;
      const meta = document.createElement("p"); meta.textContent = index === 0 ? "当前版本" : "历史版本"; copy.append(versionHeading, meta); head.append(copy, makeState(version.status)); card.append(head);
      if (version.failure_code) { const failure = document.createElement("p"); failure.className = "notice error"; failure.textContent = failures[version.failure_code] || `核验失败：${version.failure_code}`; card.append(failure); }
      if (version.status === "available") {
        const versionActions = document.createElement("div"); versionActions.className = "asset-version-actions";
        const download = document.createElement("button"); download.type = "button"; download.className = "secondary"; download.dataset.action = "download-version"; download.dataset.versionId = version.id; download.textContent = "下载文件";
        download.addEventListener("click", () => downloadVersion(version, download)); versionActions.append(download); card.append(versionActions);
      }
      card.append(technicalDetails(version)); versions.append(card);
    }
    node.append(versions);
  }

  function render() {
    renderTabs(); renderList(); renderDetail(); renderSummary();
  }

  function selectAsset(assetId, { openDetail = false, focusDetail = false } = {}) {
    selectedAssetId = assetId;
    if (openDetail && usesSequentialLayout()) workspace.dataset.layer = "detail";
    render();
    if (focusDetail) queueMicrotask(() => byId("assetDetailTitle")?.focus({ preventScroll: true }));
  }

  function backToList() {
    workspace.dataset.layer = "list";
    queueMicrotask(() => document.querySelector(`[data-asset-id="${CSS.escape(selectedAssetId || "")}"]`)?.focus());
  }

  async function refresh({ preserveSelection = true, quiet = false } = {}) {
    if (refreshInFlight || tornDown) return false;
    refreshInFlight = true; byId("refreshAssets").disabled = true;
    if (!quiet) { loadError = false; byId("assetError").textContent = ""; }
    try {
      const result = await request("/api/assets");
      if (!Array.isArray(result?.assets)) throw Object.assign(new Error("INVALID_ASSET_RESPONSE"), { code: "INVALID_ASSET_RESPONSE" });
      assets = result.assets;
      if (!preserveSelection || !assets.some((asset) => asset.id === selectedAssetId)) selectedAssetId = null;
      loadError = false; loading = false; render(); schedulePolling(); return true;
    } catch (error) {
      stopPolling(); loading = false;
      if (error.code !== "AUTH_REQUIRED") { loadError = true; byId("assetError").textContent = "素材加载失败，现有内容没有被覆盖。请刷新当前分类。"; render(); }
      return false;
    } finally {
      refreshInFlight = false; byId("refreshAssets").disabled = false; renderSummary();
    }
  }

  function openUploadDialog(trigger, asset = null) {
    if (asset?.kind === "work_video" || asset?.status === "disabled") return;
    byId("uploadForm").reset(); byId("uploadError").textContent = ""; byId("uploadStatus").textContent = "";
    byId("uploadAssetId").value = asset?.id || "";
    byId("assetKind").value = asset?.kind || (activeKind === "avatar_image" ? "avatar_image" : "product_image");
    byId("assetKind").disabled = Boolean(asset);
    byId("uploadTitle").textContent = asset ? `上传“${asset.display_name}”的新版本` : "上传图片";
    showDialog(byId("uploadDialog"), trigger);
  }

  async function submitUpload(event) {
    event.preventDefault();
    const file = byId("assetFile").files[0];
    const kind = byId("assetKind").value;
    if (!file || !["product_image", "avatar_image"].includes(kind) || uploadBusy) return;
    uploadBusy = true; byId("submitUpload").disabled = true; byId("uploadError").textContent = ""; byId("uploadStatus").textContent = "正在上传...";
    try {
      const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))).map((value) => value.toString(16).padStart(2, "0")).join("");
      const payload = { filename: file.name, content_type: file.type, size: file.size, checksum_sha256: checksum, kind };
      const assetId = byId("uploadAssetId").value; if (assetId) payload.asset_id = assetId;
      const authorization = await request("/api/assets/upload-authorizations", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(payload) });
      await request(authorization.upload.url, { method: "PUT", headers: { "content-type": file.type }, body: file });
      await request("/api/assets/upload-completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ upload_session_id: authorization.upload_session_id, idempotency_key: crypto.randomUUID() }) });
      activeKind = kind; selectedAssetId = null; byId("uploadStatus").textContent = "上传完成，服务端正在核验。";
      await refresh({ preserveSelection: true, quiet: true }); closeDialog(byId("uploadDialog")); setNotice("上传完成，服务端正在核验。可以离开页面，稍后再刷新。", "success");
    } catch (error) {
      if (error.code !== "AUTH_REQUIRED") byId("uploadError").textContent = error.code === "ASSET_NOT_ACTIVE" ? "该素材已不可写，请关闭后刷新状态。" : "上传未完成，请检查图片后重试。";
    } finally { uploadBusy = false; byId("submitUpload").disabled = false; }
  }

  function openRenameDialog(trigger, asset) {
    if (!canWriteAsset(asset)) return;
    renameConflictAssetId = null; byId("renameConflictActions").hidden = true; byId("renameError").textContent = ""; byId("assetDisplayName").value = asset.display_name;
    showDialog(byId("renameDialog"), trigger);
  }

  async function submitRename(event) {
    event.preventDefault();
    const asset = selectedAsset(); if (!canWriteAsset(asset) || renameBusy) return;
    renameBusy = true; byId("submitRename").disabled = true; byId("renameError").textContent = "";
    try {
      await request(`/api/assets/${encodeURIComponent(asset.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ display_name: byId("assetDisplayName").value, expected_revision: asset.revision_number }) });
      await refresh({ preserveSelection: true, quiet: true }); closeDialog(byId("renameDialog")); setNotice("素材名称已保存。", "success");
    } catch (error) {
      if (error.status === 409 || error.code === "ASSET_VERSION_CONFLICT") {
        renameConflictAssetId = asset.id; byId("renameError").textContent = "素材状态已变化。你的名称仍保留，请先载入最新状态。"; byId("renameConflictActions").hidden = false;
      } else if (error.code !== "AUTH_REQUIRED") byId("renameError").textContent = "名称未保存，请稍后重试。";
    } finally { renameBusy = false; byId("submitRename").disabled = Boolean(renameConflictAssetId); }
  }

  async function reloadRenameIntent() {
    const draft = byId("assetDisplayName").value;
    const targetId = renameConflictAssetId;
    byId("reloadRename").disabled = true;
    const ok = await refresh({ preserveSelection: true, quiet: true });
    const target = assets.find((asset) => asset.id === targetId);
    byId("assetDisplayName").value = draft;
    if (!ok || !canWriteAsset(target)) {
      byId("renameError").textContent = "无法载入同一素材的可写状态。请保留名称并关闭窗口，重新选择素材。";
      byId("submitRename").disabled = true;
    } else {
      selectedAssetId = target.id; renameConflictAssetId = null; byId("renameConflictActions").hidden = true; byId("renameError").textContent = "已载入最新状态，你的名称仍保留；请明确再次保存。"; byId("submitRename").disabled = false; render();
    }
    byId("reloadRename").disabled = false;
  }

  function openDangerDialog(trigger, asset, action) {
    if (!isAdmin() || !canWriteAsset(asset)) return;
    dangerIntent = { assetId: asset.id, revision: asset.revision_number, action };
    byId("dangerTitle").textContent = action === "delete" ? "删除素材" : "停用素材";
    byId("dangerMessage").textContent = action === "delete" ? `删除“${asset.display_name}”后，该素材不会再出现在目录中。` : `停用“${asset.display_name}”后，它不能再被新内容引用。`;
    byId("dangerError").textContent = ""; byId("confirmDanger").textContent = action === "delete" ? "确认删除" : "确认停用";
    showDialog(byId("assetDangerDialog"), trigger);
  }

  async function confirmDanger() {
    if (!dangerIntent) return;
    byId("confirmDanger").disabled = true; byId("dangerError").textContent = "";
    try {
      const { assetId, revision, action } = dangerIntent;
      await request(`/api/assets/${encodeURIComponent(assetId)}${action === "disable" ? "/disable" : ""}`, { method: action === "delete" ? "DELETE" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected_revision: revision }) });
      closeDialog(byId("assetDangerDialog")); dangerIntent = null; await refresh({ preserveSelection: true, quiet: true }); setNotice(action === "delete" ? "素材已删除。" : "素材已停用。", "success");
    } catch (error) {
      if (error.status === 409 || error.code === "ASSET_VERSION_CONFLICT") byId("dangerError").textContent = "素材状态已变化，本次操作未执行。请关闭并刷新当前分类。";
      else if (error.code !== "AUTH_REQUIRED") byId("dangerError").textContent = "操作未完成，请稍后重试。";
    } finally { byId("confirmDanger").disabled = false; }
  }

  async function downloadVersion(version, button) {
    button.disabled = true; setNotice("正在获取临时下载权限...");
    try {
      const result = await request(`/api/asset-versions/${encodeURIComponent(version.id)}/download-authorizations`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      const link = document.createElement("a"); link.href = result.download.url; link.download = version.original_filename; link.hidden = true; document.body.append(link); link.click(); setTimeout(() => link.remove(), 1000);
      setNotice(`已获取临时下载权限，有效期至 ${new Date(result.download.expires_at).toLocaleString("zh-CN")}。`, "success");
    } catch (error) {
      if (error.code !== "AUTH_REQUIRED") setNotice("下载权限获取失败，请刷新素材状态后重试。", "error");
    } finally { button.disabled = false; }
  }

  for (const button of document.querySelectorAll("[data-kind]")) button.addEventListener("click", () => { activeKind = button.dataset.kind; selectedAssetId = null; workspace.dataset.layer = "list"; render(); });
  byId("openUpload").addEventListener("click", (event) => {
    if (byId("assetFile").files[0]) byId("uploadForm").requestSubmit();
    else openUploadDialog(event.currentTarget);
  });
  byId("uploadForm").addEventListener("submit", submitUpload);
  byId("renameForm").addEventListener("submit", submitRename);
  byId("reloadRename").addEventListener("click", reloadRenameIntent);
  byId("confirmDanger").addEventListener("click", confirmDanger);
  byId("refreshAssets").addEventListener("click", () => refresh({ preserveSelection: true }));
  byId("backToAssets").addEventListener("click", backToList);
  window.addEventListener("pagehide", () => { tornDown = true; stopPolling(); }, { once: true });

  try {
    identity = await request("/api/auth/me");
    if (identity.status !== "ok") return window.location.replace("/login.html");
    await refresh({ preserveSelection: false });
  } catch (_error) {
    loading = false; loadError = true; render();
  }
})();
