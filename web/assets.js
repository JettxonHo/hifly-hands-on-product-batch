(async () => {
  const fileInput = document.querySelector("#assetFile");
  const form = document.querySelector("#uploadForm");
  const statusNode = document.querySelector("#uploadStatus");
  const errorNode = document.querySelector("#assetError");
  const listNode = document.querySelector("#assetList");
  const refreshButton = document.querySelector("#refreshAssets");
  const pendingStatuses = new Set(["upload_pending", "uploading", "verifying"]);
  let pollTimer = null;
  let refreshInFlight = false;
  let tornDown = false;

  const csrf = () => {
    const value = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hifly_identity_csrf="));
    return value ? decodeURIComponent(value.split("=").slice(1).join("=")) : "";
  };
  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.method && options.method !== "GET") headers.set("x-identity-csrf", csrf());
    const response = await fetch(url, { credentials: "same-origin", ...options, headers });
    if (response.status === 401 || response.status === 403) { window.location.replace("/login.html"); throw new Error("AUTH_REQUIRED"); }
    const body = response.headers.get("content-type")?.includes("json") ? await response.json() : null;
    if (!response.ok) throw new Error(body?.error || "REQUEST_FAILED");
    return body;
  }
  const labels = {
    upload_pending: "等待上传", uploading: "等待核验", verifying: "核验中",
    available: "核验通过", verification_failed: "核验失败", unavailable: "不可用"
  };
  const failures = {
    OBJECT_MISSING: "未找到上传文件，请重新选择图片上传。", FILE_TYPE_MISMATCH: "文件内容不是支持的图片格式，请重新选择 JPG、PNG 或 WebP。",
    SIZE_MISMATCH: "文件大小与上传声明不一致，请重新上传。", CHECKSUM_MISMATCH: "文件完整性核验失败，请重新上传。",
    OWNERSHIP_MISMATCH: "文件归属核验失败，请联系管理员。"
  };
  function stopPolling() {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
  }
  function schedulePolling(assets) {
    stopPolling();
    if (tornDown || !assets.some((asset) => pendingStatuses.has(asset.versions[0]?.status))) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      if (!tornDown) refresh();
    }, 2000);
  }
  function render(assets) {
    listNode.replaceChildren();
    if (!assets.length) {
      const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "还没有商品图片"; listNode.append(empty); return;
    }
    for (const asset of assets) {
      const version = asset.versions[0];
      const row = document.createElement("article"); row.className = "asset-row";
      const detail = document.createElement("div");
      const name = document.createElement("p"); name.className = "asset-name"; name.textContent = version.original_filename; name.title = version.original_filename;
      const meta = document.createElement("p"); meta.className = "asset-meta";
      meta.textContent = version.failure_code ? failures[version.failure_code] || `核验失败：${version.failure_code}` : `版本 ${version.version_number} · ${version.expected_content_type}`;
      const state = document.createElement("span"); state.className = `state ${version.status}`; state.textContent = labels[version.status] || version.status;
      detail.append(name, meta); row.append(detail, state); listNode.append(row);
    }
  }
  async function refresh() {
    if (refreshInFlight || tornDown) return;
    refreshInFlight = true;
    refreshButton.disabled = true; errorNode.textContent = "";
    try {
      const assets = (await request("/api/assets")).assets;
      render(assets);
      schedulePolling(assets);
    } catch (error) {
      stopPolling();
      if (error.message !== "AUTH_REQUIRED") errorNode.textContent = "素材状态加载失败，请稍后刷新。";
    } finally {
      refreshInFlight = false;
      refreshButton.disabled = false;
    }
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault(); const file = fileInput.files[0]; if (!file) return;
    form.querySelector("button").disabled = true; errorNode.textContent = ""; statusNode.textContent = "正在上传...";
    try {
      const checksum = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer()))).map((value) => value.toString(16).padStart(2, "0")).join("");
      const authorization = await request("/api/assets/upload-authorizations", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify({ filename: file.name, content_type: file.type, size: file.size, checksum_sha256: checksum }) });
      await request(authorization.upload.url, { method: "PUT", headers: { "content-type": file.type }, body: file });
      await request("/api/assets/upload-completions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ upload_session_id: authorization.upload_session_id, idempotency_key: crypto.randomUUID() }) });
      statusNode.textContent = "上传完成，服务端正在核验。可以离开此页面，稍后刷新查看结果。";
      fileInput.value = ""; await refresh();
    } catch (error) {
      if (error.message !== "AUTH_REQUIRED") errorNode.textContent = "上传未完成，请检查图片后重试。";
    } finally { form.querySelector("button").disabled = false; }
  });
  refreshButton.addEventListener("click", refresh);
  window.addEventListener("pagehide", () => { tornDown = true; stopPolling(); }, { once: true });
  try {
    const me = await request("/api/auth/me");
    if (me.status !== "ok") window.location.replace("/login.html"); else await refresh();
  } catch (_error) { /* request handles authentication redirects */ }
})();
