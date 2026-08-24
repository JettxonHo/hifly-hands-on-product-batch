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
  const imageMediaTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  const routeKinds = new Set(Object.keys(kindLabels));
  const dialogs = [byId("uploadDialog"), byId("renameDialog"), byId("assetDangerDialog")];
  const dialogTriggers = new Map();
  const dialogFocusOverrides = new Map();
  const dialogCloseResolvers = new Map();
  const workspace = document.querySelector(".asset-workspace");

  let assets = [];
  let activeKind = "product_image";
  let selectedAssetId = null;
  let identity = null;
  let loading = true;
  let loadError = false;
  let assetAuthorityValid = false;
  let bootstrapInFlight = false;
  let listEpoch = 0;
  let actionEpoch = 0;
  let actionAbortController = new AbortController();
  let previewEpoch = 0;
  let previewEntries = new Map();
  let previewPump = null;
  let previewAbortController = new AbortController();
  let pollTimer = null;
  let tornDown = false;
  let uploadBusy = false;
  let uploadIntent = null;
  let renameBusy = false;
  let renameIntent = null;
  let renameConflictAssetId = null;
  let dangerIntent = null;
  let sequentialLayout = null;

  function readRoute() {
    const url = new URL(window.location.href);
    const rawKind = url.searchParams.get("kind");
    return {
      kind: routeKinds.has(rawKind) ? rawKind : "product_image",
      assetId: url.searchParams.get("asset") || null,
      needsKindRepair: rawKind !== null && !routeKinds.has(rawKind),
      legacy: rawKind === null && !url.searchParams.has("asset")
    };
  }

  function routeIdentity() {
    const route = readRoute();
    return `${route.kind}:${route.assetId || ""}`;
  }

  function routeUrl(kind, assetId = null) {
    const url = new URL("/assets.html", window.location.origin);
    url.searchParams.set("kind", kind);
    if (assetId) url.searchParams.set("asset", assetId);
    return `${url.pathname}${url.search}`;
  }

  function writeRoute(kind, assetId, { replace = false, state = {} } = {}) {
    const method = replace ? "replaceState" : "pushState";
    history[method]({ assetsRoute: true, ...state }, "", routeUrl(kind, assetId));
  }

  function validPreviewVersion(asset) {
    const version = asset?.versions?.[0];
    return asset?.kind === "avatar_image" && version?.status === "available" &&
      imageMediaTypes.has(version.verified_content_type) && Number.isInteger(version.verified_size) &&
      version.verified_size > 0 && /^[a-f0-9]{64}$/.test(version.verified_checksum_sha256 || "") ? version : null;
  }

  const previewKey = (assetId, versionId) => `${assetId}:${versionId}`;

  function clearPreviewAuthority() {
    previewEpoch += 1;
    previewAbortController.abort();
    previewAbortController = new AbortController();
    previewPump = null;
    for (const entry of previewEntries.values()) if (entry.timer) clearTimeout(entry.timer);
    previewEntries = new Map();
    document.querySelectorAll("img[data-preview-role]").forEach((image) => {
      image.removeAttribute("src");
      image.hidden = true;
    });
  }

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
  const canWriteAsset = (asset) => assetAuthorityValid && asset && asset.kind !== "work_video" && asset.status === "active";
  const isAdmin = () => identity?.membership?.role === "admin";
  const usesSequentialLayout = () => window.matchMedia("(max-width: 900px)").matches;

  function clearRecommended() {
    document.querySelectorAll('#mainContent [data-recommended-action="true"]').forEach((node) => node.removeAttribute("data-recommended-action"));
  }

  function setRecommended(node) {
    clearRecommended();
    if (node && !node.hidden && !node.disabled && node.getClientRects().length > 0) node.setAttribute("data-recommended-action", "true");
  }

  function setNotice(message = "", type = "") {
    const node = byId("assetNotice");
    node.className = `notice${type ? ` ${type}` : ""}`;
    node.textContent = message;
  }

  function createActionBinding(asset = null, extra = {}) {
    return {
      epoch: actionEpoch,
      route: routeIdentity(),
      kind: activeKind,
      assetId: asset?.id || null,
      revision: asset?.revision_number ?? null,
      ...extra
    };
  }

  function isBaseActionBindingCurrent(binding) {
    return Boolean(binding) && assetAuthorityValid && !tornDown && binding.epoch === actionEpoch &&
      binding.route === routeIdentity() && binding.kind === activeKind;
  }

  function currentBoundAsset(binding) {
    if (!isBaseActionBindingCurrent(binding) || !binding.assetId || binding.assetId !== selectedAssetId) return null;
    const asset = assets.find((candidate) => candidate.id === binding.assetId && candidate.kind === binding.kind);
    return asset?.revision_number === binding.revision ? asset : null;
  }

  function currentBoundVersion(binding) {
    const asset = currentBoundAsset(binding);
    const version = asset?.versions?.find((candidate) => candidate.id === binding?.versionId);
    return version?.status === "available" ? version : null;
  }

  function isUploadIntentCurrent(intent) {
    if (!isBaseActionBindingCurrent(intent) || intent !== uploadIntent || intent.needsReopen) return false;
    if (!intent.assetId) return readRoute().assetId === null;
    return Boolean(currentBoundAsset(intent));
  }

  function markUploadIntentStale() {
    if (!uploadIntent || !byId("uploadDialog").open) return;
    uploadIntent.needsReopen = true;
    byId("submitUpload").disabled = true;
    byId("uploadError").textContent = "素材状态已变化，本次上传权限已失效。请关闭窗口后重新打开。";
  }

  function markRenameIntentStale() {
    if (!renameIntent || !byId("renameDialog").open) return;
    renameIntent.needsReload = true;
    renameConflictAssetId = renameIntent.assetId;
    byId("submitRename").disabled = true;
    byId("renameConflictActions").hidden = false;
    byId("renameError").textContent = "素材状态已变化，本次保存权限已失效。名称草稿已保留，请载入最新素材状态。";
  }

  function markDangerIntentStale() {
    if (!dangerIntent || !byId("assetDangerDialog").open) return;
    dangerIntent.needsReload = true;
    byId("confirmDanger").disabled = true;
    byId("dangerConflictActions").hidden = false;
    byId("dangerError").textContent = "素材状态已变化，本次操作权限已失效。请先载入同一素材的最新状态。";
  }

  function invalidateActionAuthority() {
    actionEpoch += 1;
    actionAbortController.abort();
    actionAbortController = new AbortController();
    markUploadIntentStale();
    markRenameIntentStale();
    markDangerIntentStale();
  }

  function stopPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  }

  function schedulePolling() {
    stopPolling();
    if (tornDown || !assets.some((asset) => pendingStatuses.has(latestVersion(asset)?.status))) return;
    pollTimer = setTimeout(() => { pollTimer = null; if (!tornDown) refresh({ preserveSelection: true, quiet: true }); }, 2000);
  }

  function showDialog(dialog, trigger = document.activeElement) {
    dialogTriggers.set(dialog, {
      node: trigger,
      id: trigger?.id || null,
      action: trigger?.dataset?.action || null,
      assetId: selectedAssetId,
      kind: trigger?.dataset?.kind || null
    });
    dialog.showModal();
    queueMicrotask(() => {
      const target = dialog === byId("uploadDialog")
        ? (byId("assetKind").disabled ? byId("assetFile") : byId("assetKind"))
        : dialog === byId("renameDialog") ? byId("assetDisplayName") : byId("dangerTitle");
      target?.focus();
    });
  }

  function closeDialog(dialog, focusOverride = null) {
    if (!dialog.open) return Promise.resolve();
    if (focusOverride) dialogFocusOverrides.set(dialog, focusOverride);
    return new Promise((resolve) => {
      dialogCloseResolvers.set(dialog, resolve);
      dialog.close();
    });
  }

  for (const dialog of dialogs) {
    dialog.addEventListener("close", () => {
      if (dialog === byId("uploadDialog")) {
        uploadIntent = null;
        byId("uploadForm").reset();
        byId("uploadAssetId").value = "";
        byId("assetKind").disabled = false;
        byId("uploadStatus").textContent = "";
        byId("uploadError").textContent = "";
        if (!uploadBusy) byId("submitUpload").disabled = false;
      }
      if (dialog === byId("renameDialog")) {
        renameIntent = null;
        renameConflictAssetId = null;
        byId("renameConflictActions").hidden = true;
        if (!renameBusy) byId("submitRename").disabled = false;
      }
      if (dialog === byId("assetDangerDialog")) {
        dangerIntent = null;
        byId("dangerConflictActions").hidden = true;
        byId("confirmDanger").disabled = false;
      }
      const trigger = dialogTriggers.get(dialog);
      const usable = (node) => node?.isConnected && !node.disabled && !node.hidden && node.getClientRects().length > 0 ? node : null;
      const override = dialogFocusOverrides.get(dialog);
      let replacement = override?.action ? usable(document.querySelector(`[data-action="${CSS.escape(override.action)}"]`)) : null;
      if (!replacement && override?.detailAssetId === selectedAssetId) replacement = usable(byId("assetDetailTitle"));
      if (!replacement && override?.kind) replacement = usable(document.querySelector(`[data-kind="${CSS.escape(override.kind)}"]`));
      if (!replacement && override?.id) replacement = usable(byId(override.id));
      if (!replacement) replacement = usable(trigger?.node);
      if (!replacement && trigger?.action) replacement = usable(document.querySelector(`[data-action="${CSS.escape(trigger.action)}"]`));
      if (!replacement && trigger?.assetId) replacement = usable(document.querySelector(`[data-asset-id="${CSS.escape(trigger.assetId)}"]`));
      if (!replacement && trigger?.id) replacement = usable(byId(trigger.id));
      if (!replacement && trigger?.kind) replacement = usable(document.querySelector(`[data-kind="${CSS.escape(trigger.kind)}"]`));
      if (!replacement) replacement = usable(byId("refreshAssets")) || usable(byId("mainContent"));
      const resolveClose = dialogCloseResolvers.get(dialog);
      dialogTriggers.delete(dialog);
      dialogFocusOverrides.delete(dialog);
      dialogCloseResolvers.delete(dialog);
      queueMicrotask(() => {
        replacement?.focus({ preventScroll: true });
        resolveClose?.();
      });
    });
    dialog.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => closeDialog(dialog)));
  }

  function makeState(value, labels = versionLabels) {
    const node = document.createElement("span");
    node.className = `state ${value}`;
    node.textContent = labels[value] || value;
    return node;
  }

  function failPreview(key, message, expectedEpoch, expectedUrl = null, state = "error") {
    if (expectedEpoch !== previewEpoch) return;
    const entry = previewEntries.get(key);
    if (!entry || (expectedUrl && entry.url !== expectedUrl)) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.state = state;
    entry.message = message;
    entry.url = null;
    entry.timer = null;
    applyPreviewEntry(key);
  }

  function applyPreviewEntry(key) {
    const entry = previewEntries.get(key);
    document.querySelectorAll(`[data-preview-key="${CSS.escape(key)}"]`).forEach((region) => {
      const image = region.querySelector("img[data-preview-role]");
      const fallback = region.querySelector("[data-preview-fallback]");
      const retry = region.querySelector("#retryAssetPreview");
      if (!image || !fallback) return;
      region.dataset.previewState = entry?.state || "loading";
      if (retry) retry.hidden = !["error", "expired"].includes(entry?.state);
      if (["loading", "ready"].includes(entry?.state) && entry.url) {
        const expectedUrl = entry.url;
        image.onload = () => {
          const current = previewEntries.get(key);
          if (current && ["loading", "ready"].includes(current.state) && current.url === expectedUrl &&
              current.epoch === previewEpoch && current.listEpoch === listEpoch) {
            current.state = "ready";
            applyPreviewEntry(key);
          }
        };
        image.onerror = () => failPreview(key, "图片预览解码失败，请重试。", entry.epoch, expectedUrl);
        fallback.hidden = entry.state === "ready";
        if (!fallback.hidden) fallback.textContent = "正在载入人物预览...";
        image.hidden = false;
        if (image.getAttribute("src") !== expectedUrl) image.setAttribute("src", expectedUrl);
      } else {
        image.onload = null;
        image.onerror = null;
        image.removeAttribute("src");
        image.hidden = true;
        fallback.hidden = false;
        fallback.textContent = ["error", "expired"].includes(entry?.state) ? entry.message : "正在获取人物预览...";
      }
    });
  }

  function createPreviewRegion(asset, role) {
    const version = validPreviewVersion(asset);
    if (!version) return null;
    const region = document.createElement(role === "detail" ? "section" : "span");
    const key = previewKey(asset.id, version.id);
    region.className = role === "detail" ? "asset-preview" : "asset-thumb";
    region.dataset.previewKey = key;
    if (role === "detail") {
      region.id = "assetPreviewRegion";
      region.setAttribute("aria-live", "polite");
    }
    const image = document.createElement("img");
    image.hidden = true;
    image.alt = `${asset.display_name}预览`;
    image.dataset.previewRole = role;
    image.dataset.assetId = asset.id;
    if (role === "detail") image.id = "assetPreviewImage";
    const fallback = document.createElement("span");
    fallback.dataset.previewFallback = "true";
    fallback.setAttribute("role", "img");
    fallback.setAttribute("aria-label", `${asset.display_name}人物预览`);
    fallback.textContent = "正在获取人物预览...";
    if (role === "detail") fallback.id = "assetPreviewFallback";
    region.append(image, fallback);
    if (role === "detail") {
      const retry = document.createElement("button");
      retry.id = "retryAssetPreview";
      retry.type = "button";
      retry.className = "secondary";
      retry.textContent = "重试人物预览";
      retry.addEventListener("click", () => {
        const existing = previewEntries.get(key);
        if (existing?.timer) clearTimeout(existing.timer);
        previewEntries.delete(key);
        applyPreviewEntry(key);
        const currentAsset = assets.find((candidate) => candidate.id === asset.id && candidate.kind === "avatar_image");
        const currentVersion = validPreviewVersion(currentAsset);
        if (currentVersion?.id === version.id) {
          void authorizePreview(currentAsset, currentVersion, listEpoch, previewEpoch, previewAbortController.signal);
        }
      });
      region.append(retry);
    }
    queueMicrotask(() => applyPreviewEntry(key));
    return region;
  }

  function normalizedDownloadUrl(value) {
    if (typeof value !== "string" || !value) return null;
    let parsed;
    try { parsed = new URL(value, window.location.origin); } catch { return null; }
    if (parsed.origin !== window.location.origin || parsed.search || parsed.hash ||
        !/^\/api\/assets\/downloads\/[^/]+$/.test(parsed.pathname)) return null;
    return parsed.pathname;
  }

  async function authorizePreview(asset, version, epoch, authorityEpoch, signal) {
    const key = previewKey(asset.id, version.id);
    if (previewEntries.has(key)) return;
    previewEntries.set(key, { state: "pending", assetId: asset.id, versionId: version.id, listEpoch: epoch, epoch: authorityEpoch, url: null, timer: null });
    applyPreviewEntry(key);
    try {
      const result = await request(`/api/asset-versions/${encodeURIComponent(version.id)}/download-authorizations`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal
      });
      if (epoch !== listEpoch || authorityEpoch !== previewEpoch || tornDown) return;
      const currentAsset = assets.find((candidate) => candidate.id === asset.id && candidate.kind === "avatar_image");
      const currentVersion = validPreviewVersion(currentAsset);
      if (!currentVersion || currentVersion.id !== version.id) return;
      const url = normalizedDownloadUrl(result?.download?.url);
      const expiresAt = Date.parse(result?.download?.expires_at || "");
      if (!url || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("PREVIEW_AUTHORIZATION_INVALID");
      const entry = previewEntries.get(key);
      if (!entry || entry.epoch !== authorityEpoch) return;
      entry.state = "loading";
      entry.url = url;
      entry.message = "";
      const delay = Math.min(2147483647, Math.max(0, expiresAt - Date.now()));
      entry.timer = setTimeout(() => failPreview(key, "人物预览权限已过期，请重试。", authorityEpoch, url, "expired"), delay);
      applyPreviewEntry(key);
    } catch (error) {
      if (epoch === listEpoch && authorityEpoch === previewEpoch && error.code !== "AUTH_REQUIRED") {
        failPreview(key, "人物预览暂不可用，请重试。", authorityEpoch);
      }
    }
  }

  function ensurePreviews() {
    if (loading || loadError || !assetAuthorityValid || activeKind !== "avatar_image" || tornDown || previewPump) return;
    const epoch = listEpoch;
    const authorityEpoch = previewEpoch;
    const signal = previewAbortController.signal;
    const selected = selectedAsset();
    const visibleAssetIds = new Set([...document.querySelectorAll(".asset-row[data-asset-id]")]
      .filter((row) => {
        if (!row.getClientRects().length) return false;
        const rect = row.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight;
      })
      .map((row) => row.dataset.assetId));
    const visibleAssets = currentAssets().filter((asset) => visibleAssetIds.has(asset.id));
    const ordered = [selected, ...visibleAssets.filter((asset) => asset.id !== selected?.id)]
      .filter((asset) => asset && validPreviewVersion(asset) && !previewEntries.has(previewKey(asset.id, validPreviewVersion(asset).id)));
    if (!ordered.length) return;
    const pump = (async () => {
      for (const asset of ordered) {
        if (epoch !== listEpoch || authorityEpoch !== previewEpoch || tornDown) return;
        const version = validPreviewVersion(asset);
        if (version) await authorizePreview(asset, version, epoch, authorityEpoch, signal);
      }
    })();
    previewPump = pump;
    void pump.finally(() => {
      if (previewPump === pump) {
        previewPump = null;
        ensurePreviews();
      }
    });
  }

  function renderSummary() {
    const group = currentAssets();
    const selected = selectedAsset();
    byId("refreshAssets").textContent = identity ? "刷新当前分类" : "重新加载素材中心";
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
      byId("summaryNext").textContent = identity ? "刷新当前分类" : "重新加载素材中心";
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
      if (activeKind === "work_video") {
        byId("summaryNext").textContent = "下载系统登记作品";
        setRecommended(document.querySelector('[data-action="download-version"]'));
      } else {
        byId("summaryNext").textContent = "上传新的图片版本";
        setRecommended(byId("uploadNewVersion"));
      }
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
    byId("openUpload").hidden = activeKind === "work_video" || Boolean(selectedAssetId);
    byId("openUpload").disabled = loading || loadError || !assetAuthorityValid;
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
      button.disabled = !assetAuthorityValid;
      if (!assetAuthorityValid) button.title = "状态可能已过期，请先刷新当前分类";
      button.setAttribute("aria-current", String(asset.id === selectedAssetId));
      const main = document.createElement("span"); main.className = "asset-row-main";
      const name = document.createElement("span"); name.className = "asset-name"; name.textContent = asset.display_name;
      const meta = document.createElement("span"); meta.className = "asset-meta"; meta.textContent = `${asset.versions?.length || 0} 个版本 · ${version?.original_filename || "暂无文件"}`;
      main.append(name, meta);
      const preview = createPreviewRegion(asset, "list");
      if (preview) { button.classList.add("has-preview"); button.append(preview); }
      button.append(main, asset.status === "disabled" ? makeState("disabled", assetLabels) : makeState(version?.status || "unavailable"));
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

    const preview = createPreviewRegion(asset, "detail");
    if (preview) node.append(preview);

    const actions = document.createElement("div"); actions.className = "asset-detail-actions";
    if (canWriteAsset(asset)) {
      const upload = document.createElement("button"); upload.type = "button"; upload.id = "uploadNewVersion"; upload.dataset.action = "upload-new-version"; upload.textContent = "上传新版本"; upload.addEventListener("click", (event) => openUploadDialog(event.currentTarget, asset)); actions.append(upload);
      const rename = document.createElement("button"); rename.type = "button"; rename.className = "secondary"; rename.dataset.action = "rename"; rename.textContent = "重命名"; rename.addEventListener("click", (event) => openRenameDialog(event.currentTarget, asset)); actions.append(rename);
      if (isAdmin()) {
        const disable = document.createElement("button"); disable.type = "button"; disable.className = "secondary"; disable.dataset.action = "disable"; disable.textContent = "停用"; disable.addEventListener("click", (event) => openDangerDialog(event.currentTarget, asset, "disable")); actions.append(disable);
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "danger"; remove.dataset.action = "delete"; remove.textContent = "删除"; remove.addEventListener("click", (event) => openDangerDialog(event.currentTarget, asset, "delete")); actions.append(remove);
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
    ensurePreviews();
  }

  function invalidateRouteAuthority() {
    listEpoch += 1;
    invalidateActionAuthority();
    clearPreviewAuthority();
  }

  function selectAsset(assetId, { openDetail = false, focusDetail = false } = {}) {
    if (!assetAuthorityValid) return;
    const asset = assets.find((candidate) => candidate.id === assetId && candidate.kind === activeKind);
    if (!asset) return;
    if (readRoute().kind === activeKind && readRoute().assetId === assetId) {
      if (focusDetail) queueMicrotask(() => {
        const target = usesSequentialLayout() ? byId("assetDetailTitle") : document.querySelector(`[data-asset-id="${CSS.escape(assetId)}"]`);
        target?.focus({ preventScroll: true });
      });
      return;
    }
    history.replaceState({ ...(history.state || {}), assetFocusId: assetId }, "", window.location.href);
    writeRoute(activeKind, assetId);
    invalidateRouteAuthority();
    selectedAssetId = assetId;
    if (openDetail && usesSequentialLayout()) workspace.dataset.layer = "detail";
    render();
    if (focusDetail) queueMicrotask(() => {
      const target = usesSequentialLayout() ? byId("assetDetailTitle") : document.querySelector(`[data-asset-id="${CSS.escape(assetId)}"]`);
      target?.focus({ preventScroll: true });
    });
  }

  function backToList() {
    const sourceAssetId = selectedAssetId;
    writeRoute(activeKind, null, { state: { assetFocusId: sourceAssetId } });
    invalidateRouteAuthority();
    selectedAssetId = null;
    workspace.dataset.layer = "list";
    render();
    queueMicrotask(() => document.querySelector(`[data-asset-id="${CSS.escape(sourceAssetId || "")}"]`)?.focus({ preventScroll: true }));
  }

  async function refresh({ preserveSelection = true, quiet = false, requestedAssetId, focusAfter = null } = {}) {
    if (tornDown) return false;
    const desiredAssetId = requestedAssetId === undefined ? (preserveSelection ? (readRoute().assetId || selectedAssetId) : null) : requestedAssetId;
    const requestIdentity = routeIdentity();
    const epoch = ++listEpoch;
    invalidateActionAuthority();
    clearPreviewAuthority();
    selectedAssetId = null;
    workspace.dataset.layer = "list";
    loading = true;
    loadError = false;
    assetAuthorityValid = false;
    byId("refreshAssets").disabled = true;
    if (!quiet) byId("assetError").textContent = "";
    render();
    try {
      const result = await request("/api/assets");
      if (!Array.isArray(result?.assets)) throw Object.assign(new Error("INVALID_ASSET_RESPONSE"), { code: "INVALID_ASSET_RESPONSE" });
      if (epoch !== listEpoch || requestIdentity !== routeIdentity() || tornDown) return false;
      assets = result.assets.filter((asset) => routeKinds.has(asset?.kind));
      assetAuthorityValid = true;
      const selected = desiredAssetId ? assets.find((asset) => asset.id === desiredAssetId && asset.kind === activeKind) : null;
      selectedAssetId = selected?.id || null;
      if (desiredAssetId && !selected && readRoute().assetId === desiredAssetId) writeRoute(activeKind, null, { replace: true });
      workspace.dataset.layer = selectedAssetId && usesSequentialLayout() ? "detail" : "list";
      loadError = false;
      loading = false;
      byId("assetError").textContent = "";
      render();
      schedulePolling();
      if (focusAfter === "detail" && selectedAssetId) queueMicrotask(() => byId("assetDetailTitle")?.focus({ preventScroll: true }));
      else if (focusAfter) queueMicrotask(() => document.querySelector(`[data-asset-id="${CSS.escape(focusAfter)}"]`)?.focus({ preventScroll: true }));
      return true;
    } catch (error) {
      if (epoch !== listEpoch || requestIdentity !== routeIdentity() || tornDown) return false;
      stopPolling();
      loading = false;
      if (error.code !== "AUTH_REQUIRED") {
        loadError = true;
        assetAuthorityValid = false;
        byId("assetError").textContent = `${kindLabels[activeKind]}加载失败，旧详情和操作权限已清除。请刷新当前分类。`;
        render();
      }
      return false;
    } finally {
      if (epoch === listEpoch) {
        byId("refreshAssets").disabled = false;
        renderSummary();
      }
    }
  }

  async function bootstrap() {
    if (bootstrapInFlight || tornDown) return false;
    bootstrapInFlight = true;
    invalidateActionAuthority();
    assets = [];
    selectedAssetId = null;
    workspace.dataset.layer = "list";
    clearPreviewAuthority();
    loading = true;
    loadError = false;
    assetAuthorityValid = false;
    byId("assetError").textContent = "";
    byId("refreshAssets").disabled = true;
    render();
    try {
      identity = await request("/api/auth/me");
      if (identity.status !== "ok") { window.location.replace("/login.html"); return false; }
      return await refresh({ preserveSelection: true, requestedAssetId: readRoute().assetId });
    } catch (error) {
      if (error.code !== "AUTH_REQUIRED") {
        identity = null; loading = false; loadError = true;
        byId("assetError").textContent = "素材中心初始化失败，请重新加载身份与素材状态。";
        render();
        queueMicrotask(() => byId("refreshAssets")?.focus({ preventScroll: true }));
      }
      return false;
    } finally {
      bootstrapInFlight = false; byId("refreshAssets").disabled = false; renderSummary();
    }
  }

  function openUploadDialog(trigger, asset = null) {
    if (!assetAuthorityValid || tornDown || (asset ? !canWriteAsset(asset) : !["product_image", "avatar_image"].includes(activeKind))) return;
    byId("uploadForm").reset(); byId("uploadError").textContent = ""; byId("uploadStatus").textContent = "";
    byId("uploadAssetId").value = asset?.id || "";
    byId("assetKind").value = asset?.kind || (activeKind === "avatar_image" ? "avatar_image" : "product_image");
    byId("assetKind").disabled = Boolean(asset);
    byId("submitUpload").disabled = false;
    byId("uploadTitle").textContent = asset ? `上传“${asset.display_name}”的新版本` : "上传图片";
    uploadIntent = createActionBinding(asset, { needsReopen: false });
    showDialog(byId("uploadDialog"), trigger);
  }

  async function submitUpload(event) {
    event.preventDefault();
    const intent = uploadIntent;
    if (!isUploadIntentCurrent(intent)) { markUploadIntentStale(); return; }
    const file = byId("assetFile").files[0];
    const kind = byId("assetKind").value;
    const boundAsset = intent.assetId ? currentBoundAsset(intent) : null;
    if (!file || !["product_image", "avatar_image"].includes(kind) || (boundAsset && boundAsset.kind !== kind) || uploadBusy) return;
    const signal = actionAbortController.signal;
    uploadBusy = true; byId("submitUpload").disabled = true; byId("uploadError").textContent = ""; byId("uploadStatus").textContent = "正在上传...";
    try {
      const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))).map((value) => value.toString(16).padStart(2, "0")).join("");
      if (!isUploadIntentCurrent(intent)) { markUploadIntentStale(); return; }
      const payload = { filename: file.name, content_type: file.type, size: file.size, checksum_sha256: checksum, kind };
      const assetId = byId("uploadAssetId").value; if (assetId) payload.asset_id = assetId;
      const authorization = await request("/api/assets/upload-authorizations", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(payload), signal });
      if (!isUploadIntentCurrent(intent)) { markUploadIntentStale(); return; }
      await request(authorization.upload.url, { method: "PUT", headers: { "content-type": file.type }, body: file, signal });
      if (!isUploadIntentCurrent(intent)) { markUploadIntentStale(); return; }
      await request("/api/assets/upload-completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ upload_session_id: authorization.upload_session_id, idempotency_key: crypto.randomUUID() }), signal });
      if (!isUploadIntentCurrent(intent)) { markUploadIntentStale(); return; }
      const targetAssetId = assetId || authorization.asset.id;
      activeKind = kind; selectedAssetId = targetAssetId; byId("uploadStatus").textContent = "上传完成，服务端正在核验。";
      if (readRoute().kind !== kind || readRoute().assetId !== targetAssetId) writeRoute(kind, targetAssetId);
      const refreshed = await refresh({ preserveSelection: true, quiet: true, requestedAssetId: targetAssetId });
      await closeDialog(byId("uploadDialog"), refreshed ? { detailAssetId: targetAssetId } : { id: "refreshAssets" });
      setNotice("上传完成，服务端正在核验。可以离开页面，稍后再刷新。", "success");
    } catch (error) {
      if (!isUploadIntentCurrent(intent)) markUploadIntentStale();
      else if (error.code !== "AUTH_REQUIRED") byId("uploadError").textContent = error.code === "ASSET_NOT_ACTIVE" ? "该素材已不可写，请关闭后刷新状态。" : "上传未完成，请检查图片后重试。";
    } finally {
      uploadBusy = false;
      byId("submitUpload").disabled = Boolean(uploadIntent?.needsReopen);
    }
  }

  function openRenameDialog(trigger, asset) {
    if (!canWriteAsset(asset)) return;
    renameIntent = createActionBinding(asset, { needsReload: false });
    renameConflictAssetId = null; byId("renameConflictActions").hidden = true; byId("renameError").textContent = ""; byId("assetDisplayName").value = asset.display_name; byId("submitRename").disabled = false;
    showDialog(byId("renameDialog"), trigger);
  }

  async function submitRename(event) {
    event.preventDefault();
    const intent = renameIntent;
    const asset = currentBoundAsset(intent);
    if (!asset || intent?.needsReload) { markRenameIntentStale(); return; }
    if (!canWriteAsset(asset) || renameBusy) return;
    const signal = actionAbortController.signal;
    renameBusy = true; byId("submitRename").disabled = true; byId("renameError").textContent = "";
    try {
      await request(`/api/assets/${encodeURIComponent(asset.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ display_name: byId("assetDisplayName").value, expected_revision: intent.revision }), signal });
      if (!currentBoundAsset(intent)) { markRenameIntentStale(); return; }
      const refreshed = await refresh({ preserveSelection: true, quiet: true });
      await closeDialog(byId("renameDialog"), refreshed ? { action: "rename", detailAssetId: asset.id } : { id: "refreshAssets" });
      setNotice("素材名称已保存。", "success");
    } catch (error) {
      if (error.status === 409 || error.code === "ASSET_VERSION_CONFLICT") {
        intent.needsReload = true; renameConflictAssetId = asset.id; byId("renameError").textContent = "素材状态已变化。你的名称仍保留，请先载入最新状态。"; byId("renameConflictActions").hidden = false;
      } else if (!currentBoundAsset(intent)) markRenameIntentStale();
      else if (error.code !== "AUTH_REQUIRED") byId("renameError").textContent = "名称未保存，请稍后重试。";
    } finally { renameBusy = false; byId("submitRename").disabled = Boolean(renameIntent?.needsReload || renameConflictAssetId); }
  }

  async function reloadRenameIntent() {
    const draft = byId("assetDisplayName").value;
    const targetId = renameIntent?.assetId || renameConflictAssetId;
    if (!targetId) return;
    byId("reloadRename").disabled = true;
    const ok = await refresh({ preserveSelection: true, quiet: true, requestedAssetId: targetId });
    const target = assets.find((asset) => asset.id === targetId && asset.kind === activeKind);
    byId("assetDisplayName").value = draft;
    if (!ok || !canWriteAsset(target)) {
      byId("renameError").textContent = "无法载入同一素材的可写状态。请保留名称并关闭窗口，重新选择素材。";
      byId("submitRename").disabled = true;
    } else {
      selectedAssetId = target.id; renameIntent = createActionBinding(target, { needsReload: false }); renameConflictAssetId = null; byId("renameConflictActions").hidden = true; byId("renameError").textContent = "已载入最新状态，你的名称仍保留；请明确再次保存。"; byId("submitRename").disabled = false; render();
    }
    byId("reloadRename").disabled = false;
  }

  function openDangerDialog(trigger, asset, action) {
    if (!isAdmin() || !canWriteAsset(asset)) return;
    dangerIntent = createActionBinding(asset, { action, needsReload: false });
    byId("dangerTitle").textContent = action === "delete" ? "删除素材" : "停用素材";
    byId("dangerMessage").textContent = action === "delete" ? `删除“${asset.display_name}”后，该素材不会再出现在目录中。` : `停用“${asset.display_name}”后，它不能再被新内容引用。`;
    byId("dangerError").textContent = ""; byId("dangerConflictActions").hidden = true;
    byId("confirmDanger").disabled = false; byId("confirmDanger").textContent = action === "delete" ? "确认删除" : "确认停用";
    showDialog(byId("assetDangerDialog"), trigger);
  }

  async function confirmDanger() {
    const intent = dangerIntent;
    const asset = currentBoundAsset(intent);
    if (!intent || intent.needsReload || !asset || !isAdmin() || !canWriteAsset(asset)) { markDangerIntentStale(); return; }
    const signal = actionAbortController.signal;
    byId("confirmDanger").disabled = true; byId("dangerError").textContent = "";
    try {
      const { assetId, revision, action } = intent;
      await request(`/api/assets/${encodeURIComponent(assetId)}${action === "disable" ? "/disable" : ""}`, { method: action === "delete" ? "DELETE" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expected_revision: revision }), signal });
      if (!currentBoundAsset(intent)) { markDangerIntentStale(); return; }
      dangerIntent = null;
      const refreshed = await refresh({ preserveSelection: true, quiet: true });
      await closeDialog(byId("assetDangerDialog"), refreshed
        ? (action === "delete" ? { kind: activeKind } : { detailAssetId: assetId })
        : { id: "refreshAssets" });
      setNotice(action === "delete" ? "素材已删除。" : "素材已停用。", "success");
    } catch (error) {
      if (error.status === 409 || error.code === "ASSET_VERSION_CONFLICT") {
        intent.needsReload = true;
        byId("dangerError").textContent = "素材状态已变化，本次操作未执行。请先载入同一素材的最新状态。";
        byId("dangerConflictActions").hidden = false;
      }
      else if (!currentBoundAsset(intent)) markDangerIntentStale();
      else if (error.code !== "AUTH_REQUIRED") byId("dangerError").textContent = "操作未完成，请稍后重试。";
    } finally { byId("confirmDanger").disabled = Boolean(dangerIntent?.needsReload); }
  }

  async function reloadDangerIntent() {
    if (!dangerIntent?.needsReload) return;
    const { assetId, action } = dangerIntent;
    byId("reloadDanger").disabled = true;
    const ok = await refresh({ preserveSelection: true, quiet: true, requestedAssetId: assetId });
    const target = assets.find((asset) => asset.id === assetId && asset.kind === activeKind);
    if (!ok || !isAdmin() || !canWriteAsset(target)) {
      byId("dangerError").textContent = "无法载入同一素材的可写状态。本次操作已取消，请关闭窗口。";
      byId("confirmDanger").disabled = true;
    } else {
      dangerIntent = createActionBinding(target, { action, needsReload: false });
      byId("dangerConflictActions").hidden = true;
      byId("dangerError").textContent = "已载入最新状态；请重新核对并再次明确确认。";
      byId("confirmDanger").disabled = false;
    }
    byId("reloadDanger").disabled = false;
  }

  async function downloadVersion(version, button) {
    const asset = selectedAsset();
    const intent = createActionBinding(asset, { versionId: version.id });
    if (!currentBoundVersion(intent)) {
      setNotice("素材状态已变化，下载权限已失效。请刷新后重试。", "error");
      return;
    }
    const signal = actionAbortController.signal;
    button.disabled = true; setNotice("正在获取临时下载权限...");
    try {
      const result = await request(`/api/asset-versions/${encodeURIComponent(version.id)}/download-authorizations`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal });
      const currentVersion = currentBoundVersion(intent);
      if (!currentVersion) {
        setNotice("素材状态已变化，下载权限已失效。请刷新后重试。", "error");
        return;
      }
      const url = normalizedDownloadUrl(result?.download?.url);
      const expiresAt = Date.parse(result?.download?.expires_at || "");
      if (!url || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("DOWNLOAD_AUTHORIZATION_INVALID");
      const link = document.createElement("a"); link.href = url; link.download = currentVersion.original_filename; link.hidden = true; document.body.append(link); link.click(); setTimeout(() => link.remove(), 1000);
      setNotice(`已获取临时下载权限，有效期至 ${new Date(expiresAt).toLocaleString("zh-CN")}。`, "success");
    } catch (error) {
      if (!currentBoundVersion(intent)) setNotice("素材状态已变化，下载权限已失效。请刷新后重试。", "error");
      else if (error.code !== "AUTH_REQUIRED") setNotice("下载权限获取失败，请刷新素材状态后重试。", "error");
    } finally { if (button.isConnected && currentBoundVersion(intent)) button.disabled = false; }
  }

  function initializeRoute() {
    let route = readRoute();
    const url = new URL(window.location.href);
    if (route.needsKindRepair) {
      writeRoute("product_image", null, { replace: true });
      route = readRoute();
    } else if (!route.legacy && !url.searchParams.has("kind")) {
      writeRoute("product_image", route.assetId, { replace: true });
      route = readRoute();
    }
    activeKind = route.kind;
    selectedAssetId = route.assetId;
    sequentialLayout = usesSequentialLayout();
    workspace.dataset.layer = selectedAssetId && sequentialLayout ? "detail" : "list";
  }

  function syncResponsiveLayout() {
    const nextSequentialLayout = usesSequentialLayout();
    const layoutChanged = sequentialLayout !== nextSequentialLayout;
    sequentialLayout = nextSequentialLayout;
    const route = readRoute();
    const asset = selectedAsset();
    const hasExactSelection = Boolean(asset && asset.kind === route.kind && asset.id === route.assetId && assetAuthorityValid);
    workspace.dataset.layer = nextSequentialLayout && hasExactSelection ? "detail" : "list";
    renderSummary();
    ensurePreviews();
    if (layoutChanged && hasExactSelection) queueMicrotask(() => {
      const target = nextSequentialLayout
        ? byId("assetDetailTitle")
        : document.querySelector(`[data-asset-id="${CSS.escape(asset.id)}"]`);
      target?.focus({ preventScroll: true });
    });
  }

  function changeKind(kind) {
    if (!routeKinds.has(kind)) return;
    const needsRead = loading || loadError || !assetAuthorityValid;
    if (readRoute().kind === kind && !readRoute().assetId) {
      document.querySelector(`[data-kind="${kind}"]`)?.focus({ preventScroll: true });
      if (identity && needsRead) void refresh({ preserveSelection: false, requestedAssetId: null });
      return;
    }
    writeRoute(kind, null);
    invalidateRouteAuthority();
    activeKind = kind;
    selectedAssetId = null;
    if (assetAuthorityValid) {
      loadError = false;
      byId("assetError").textContent = "";
    }
    workspace.dataset.layer = "list";
    render();
    queueMicrotask(() => document.querySelector(`[data-kind="${kind}"]`)?.focus({ preventScroll: true }));
    if (identity && needsRead) void refresh({ preserveSelection: false, requestedAssetId: null });
  }

  async function restoreRouteFromHistory() {
    for (const dialog of dialogs) closeDialog(dialog);
    let route = readRoute();
    if (route.needsKindRepair) {
      writeRoute("product_image", null, { replace: true });
      route = readRoute();
    }
    invalidateRouteAuthority();
    activeKind = route.kind;
    selectedAssetId = route.assetId;
    workspace.dataset.layer = route.assetId && usesSequentialLayout() ? "detail" : "list";
    render();
    if (identity) await refresh({
      preserveSelection: true,
      requestedAssetId: route.assetId,
      focusAfter: route.assetId ? "detail" : history.state?.assetFocusId || null
    });
  }

  initializeRoute();
  for (const button of document.querySelectorAll("[data-kind]")) button.addEventListener("click", () => changeKind(button.dataset.kind));
  byId("openUpload").addEventListener("click", (event) => {
    if (byId("assetFile").files[0]) {
      if (!uploadIntent && assetAuthorityValid && !tornDown && ["product_image", "avatar_image"].includes(activeKind)) {
        uploadIntent = createActionBinding(null, { needsReopen: false });
      }
      byId("uploadForm").requestSubmit();
    }
    else openUploadDialog(event.currentTarget);
  });
  byId("uploadForm").addEventListener("submit", submitUpload);
  byId("renameForm").addEventListener("submit", submitRename);
  byId("reloadRename").addEventListener("click", reloadRenameIntent);
  byId("confirmDanger").addEventListener("click", confirmDanger);
  byId("reloadDanger").addEventListener("click", reloadDangerIntent);
  byId("refreshAssets").addEventListener("click", () => identity ? refresh({ preserveSelection: true, requestedAssetId: readRoute().assetId }) : bootstrap());
  byId("backToAssets").addEventListener("click", backToList);
  window.addEventListener("scroll", ensurePreviews, { passive: true });
  window.addEventListener("resize", syncResponsiveLayout);
  window.addEventListener("popstate", () => { void restoreRouteFromHistory(); });
  window.addEventListener("pagehide", () => {
    tornDown = true;
    assetAuthorityValid = false;
    listEpoch += 1;
    invalidateActionAuthority();
    clearPreviewAuthority();
    stopPolling();
  });
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    tornDown = false;
    bootstrapInFlight = false;
    identity = null;
    assetAuthorityValid = false;
    void bootstrap();
  });

  await bootstrap();
})();
