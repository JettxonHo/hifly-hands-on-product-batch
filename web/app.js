(function () {
  const state = {
    batches: [],
    selectedBatchId: null,
    busy: false,
    pollTimer: null,
    pollFailures: 0,
    realBatchEnabled: false,
    realBatchMaxItems: 3
  };

  const api = window.HiflyApi;
  const nodes = {
    sessionStatus: document.querySelector("#sessionStatus"),
    batchStatus: document.querySelector("#batchStatus"),
    runtimeBackendBadge: document.querySelector("#runtimeBackendBadge"),
    captureHttpBadge: document.querySelector("#captureHttpBadge"),
    tabs: Array.from(document.querySelectorAll(".tab")),
    panels: Array.from(document.querySelectorAll(".panel")),
    singleForm: document.querySelector("#singleForm"),
    resetSingle: document.querySelector("#resetSingle"),
    bulkForm: document.querySelector("#bulkForm"),
    bulkRows: document.querySelector("#bulkRows"),
    addBulkRow: document.querySelector("#addBulkRow"),
    resetBulk: document.querySelector("#resetBulk"),
    bulkErrors: document.querySelector("#bulkErrors"),
    importForm: document.querySelector("#importForm"),
    importErrors: document.querySelector("#importErrors"),
    batchTable: document.querySelector("#batchTable"),
    batchDetail: document.querySelector("#batchDetail"),
    refreshBatches: document.querySelector("#refreshBatches"),
    startExecution: document.querySelector("#startExecution"),
    recordList: document.querySelector("#recordList"),
    toast: document.querySelector("#toast"),
    confirmDialog: document.querySelector("#confirmDialog"),
    confirmSummary: document.querySelector("#confirmSummary"),
    confirmItems: document.querySelector("#confirmItems"),
    confirmExecution: document.querySelector("#confirmExecution")
  };

  function setText(node, value) {
    node.textContent = value == null || value === "" ? "-" : String(value);
  }

  function showToast(message) {
    setText(nodes.toast, message);
    nodes.toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => {
      nodes.toast.hidden = true;
    }, 4200);
  }

  async function copyText(value, label = "内容") {
    const text = String(value || "").trim();
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const input = document.createElement("textarea");
        input.value = text;
        input.setAttribute("readonly", "");
        input.style.position = "fixed";
        input.style.left = "-9999px";
        document.body.append(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      showToast(`${label}已复制`);
    } catch (error) {
      showToast(`复制失败：${error.message || "浏览器拒绝访问剪贴板"}`);
    }
  }

  function copyPathButton(pathValue, label = "复制路径") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-button compact-button";
    setText(button, label);
    button.addEventListener("click", () => copyText(pathValue, "路径"));
    return button;
  }

  function downloadArtifactButton(batchId, artifactId) {
    const link = document.createElement("a");
    link.className = "ghost-button compact-button";
    link.href = api.artifactUrl(batchId, artifactId);
    link.download = "";
    setText(link, "下载产物");
    return link;
  }

  function outputArtifactIdForPath(batch, artifactPath) {
    if (!artifactPath) return "";
    const item = (batch.items || []).find((candidate) =>
      candidate.output_path === artifactPath && candidate.output_artifact_id
    );
    return item?.output_artifact_id || "";
  }

  function setBusy(isBusy) {
    state.busy = isBusy;
    for (const button of document.querySelectorAll("button")) {
      if (button.id !== "cancelConfirm") button.disabled = isBusy || button.dataset.disabled === "true";
    }
    updateBulkDeleteButtons();
    updateStartButton();
  }

  function safeId(prefix) {
    const random = crypto.getRandomValues(new Uint32Array(2));
    return `${prefix}-${Date.now().toString(36)}-${Array.from(random).map((part) => part.toString(36)).join("")}`;
  }

  function csvCell(value) {
    const text = String(value ?? "").replace(/\r?\n/g, " ").trim();
    if (!/[",\n\r]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function makeCsv(rows) {
    const fields = ["sku", "product_name", "selling_points", "category", "image_path", "script"];
    return [
      fields.join(","),
      ...rows.map((row) => fields.map((field) => csvCell(row[field])).join(","))
    ].join("\n");
  }

  function imageExtension(file) {
    const name = file?.name || "";
    const match = name.match(/\.[a-z0-9]+$/i);
    return match ? match[0].toLowerCase() : ".png";
  }

  function safeUploadStem(value, fallback) {
    const text = String(value || "").trim().normalize("NFC");
    const safe = text.replace(/[^\p{Letter}\p{Number}._-]+/gu, "-").replace(/^-+|-+$/g, "");
    return safe || fallback;
  }

  function statusLabel(status) {
    const labels = {
      needs_input: "待补充",
      validation_failed: "校验失败",
      pending: "待执行",
      confirmed: "已确认",
      generating_asset: "生成手持图",
      asset_confirmed: "手持图已确认",
      submitted: "已提交飞影",
      download_pending: "等待下载",
      completed: "已完成",
      failed_pre_submit: "提交前失败",
      failed_remote: "远端失败",
      interrupted_unknown: "需人工核对"
    };
    return labels[status] || status || "未知";
  }

  function strategySummary(batch) {
    const person = {
      auto_pool: "人物池自动分配",
      fixed_upload: "固定上传人物",
      hifly_recommended: "飞影推荐人物"
    }[batch.person_strategy] || batch.person_strategy || "人物池自动分配";
    const script = {
      hifly_ai: "飞影 AI 自动文案",
      provided_script: "使用导入文案",
      mixed: "混合模式"
    }[batch.script_strategy] || batch.script_strategy || "混合模式";
    return `人物策略：${person} (${batch.person_strategy || "auto_pool"}) · 文案策略：${script} (${batch.script_strategy || "mixed"})`;
  }

  function captureStatusLabel(status) {
    const labels = {
      disabled: "未开启",
      not_started: "未开始",
      recording: "录制中",
      recorded: "已录制",
      extracted: "已抽取",
      redacted: "已脱敏",
      replay_passed: "离线回放通过",
      replay_failed: "离线回放失败",
      dry_run_passed: "真实请求预演通过",
      dry_run_failed: "真实请求预演失败",
      real_live_disabled: "真实请求已禁用",
      real_live_running: "真实 HTTP 生成中",
      real_live_completed: "真实 HTTP 已完成",
      real_live_failed: "真实 HTTP 失败",
      real_batch_running: "真实 HTTP 小批量生成中",
      real_batch_completed: "真实 HTTP 小批量已完成",
      real_batch_failed: "真实 HTTP 小批量失败"
    };
    return labels[status] || status || "未知";
  }

  function formatQueueLastError(code) {
    if (code === "CAPTURE_HTTP_MANIFEST_DRIFT") return "小批量错误：飞影接口结构可能变化，请重新抓包/重新录制流程";
    if (code === "CAPTURE_HTTP_AUTH_REQUIRED" || code === "CAPTURE_HTTP_RUNTIME_AUTH_UNAVAILABLE") return "小批量错误：登录态不可用，请重新 npm run login 后再试";
    return code ? `小批量错误：${code}` : "";
  }

  function formatCaptureActionError(error) {
    const code = error?.message || "";
    if (code === "CAPTURE_HTTP_RUNTIME_AUTH_UNAVAILABLE" || code === "CAPTURE_HTTP_AUTH_REQUIRED") return "登录态不可用，请重新 npm run login 后再试";
    if (code === "CAPTURE_HTTP_MANIFEST_DRIFT") return "飞影接口结构可能变化，请重新抓包/重新录制流程";
    return `抓包处理失败：${code || "未知错误"}`;
  }

  function captureQueueStatusLabel(status) {
    const labels = {
      not_started: "未开始",
      running: "运行中",
      completed: "已完成",
      failed: "失败",
      interrupted: "已中断"
    };
    return labels[status] || status || "未开始";
  }

  function formatCaptureTime(value) {
    if (!value) return "";
    const time = new Date(value);
    if (Number.isNaN(time.getTime())) return String(value);
    return time.toLocaleString("zh-CN", { hour12: false });
  }

  function appendCaptureNotice(panel, batch) {
    const capture = batch.capture || {};
    if (capture.status === "real_live_completed") {
      const summary = capture.live_summary || {};
      const notice = document.createElement("div");
      notice.className = "notice success";
      const lines = [
        "真实 HTTP 已完成并下载到本地。",
        summary.sku ? `SKU：${summary.sku}` : "",
        summary.remote_id ? `飞影作品 ID：${summary.remote_id}` : "",
        summary.artifact_path ? `下载路径：${summary.artifact_path}` : "",
        summary.completed_at ? `完成时间：${formatCaptureTime(summary.completed_at)}` : ""
      ].filter(Boolean);
      setText(notice, lines.join("\n"));
      if (summary.artifact_path) {
        const actions = document.createElement("div");
        actions.className = "inline-actions";
        const artifactId = outputArtifactIdForPath(batch, summary.artifact_path);
        if (artifactId) actions.append(downloadArtifactButton(batch.batch_id, artifactId));
        actions.append(copyPathButton(summary.artifact_path));
        notice.append(actions);
      }
      panel.append(notice);
      return;
    }

    if (capture.status === "real_live_failed") {
      const error = capture.live_error || {};
      const notice = document.createElement("div");
      notice.className = "notice error";
      const lines = [
        "真实 HTTP 生成失败，可在确认积分风险后对该批次重新执行。",
        error.code ? `错误码：${error.code}` : "",
        `错误信息：${error.message || "Unable to complete the real HTTP live run."}`
      ].filter(Boolean);
      setText(notice, lines.join("\n"));
      panel.append(notice);
    }
  }

  function captureRecordSummary(batch) {
    const capture = batch.capture || {};
    if (capture.enabled !== true) return null;

    if (capture.status === "real_live_completed") {
      const summary = capture.live_summary || {};
      const notice = document.createElement("div");
      notice.className = "notice success compact-notice";
      const lines = [
        "抓包 HTTP：已完成",
        summary.remote_id ? `飞影作品 ID：${summary.remote_id}` : "",
        summary.artifact_path ? `下载路径：${summary.artifact_path}` : "",
        summary.completed_at ? `完成时间：${formatCaptureTime(summary.completed_at)}` : ""
      ].filter(Boolean);
      setText(notice, lines.join("\n"));
      if (summary.artifact_path) {
        const actions = document.createElement("div");
        actions.className = "inline-actions";
        const artifactId = outputArtifactIdForPath(batch, summary.artifact_path);
        if (artifactId) actions.append(downloadArtifactButton(batch.batch_id, artifactId));
        actions.append(copyPathButton(summary.artifact_path));
        notice.append(actions);
      }
      return notice;
    }

    if (capture.status === "real_live_failed") {
      const error = capture.live_error || {};
      const notice = document.createElement("div");
      notice.className = "notice error compact-notice";
      const lines = [
        "抓包 HTTP：失败，可到待执行任务中重新真实 HTTP 生成",
        error.code ? `错误码：${error.code}` : "",
        `错误信息：${error.message || "Unable to complete the real HTTP live run."}`
      ].filter(Boolean);
      setText(notice, lines.join("\n"));
      return notice;
    }

    if (capture.status && capture.status !== "disabled" && capture.status !== "not_started") {
      const notice = document.createElement("div");
      notice.className = "notice compact-notice";
      setText(notice, `抓包工作流：${captureStatusLabel(capture.status)}`);
      return notice;
    }

    return null;
  }

  const BATCH_FOCUS_PRIORITY = new Map([
    ["interrupted_unknown", 0],
    ["active", 1],
    ["paused_auth", 2],
    ["failed", 3],
    ["needs_input", 4],
    ["pending", 5],
    ["completed", 6],
    ["empty", 7]
  ]);
  const AUTO_OPEN_QUEUE_STATUSES = new Set(["interrupted_unknown", "active", "paused_auth", "failed"]);

  function batchFocusPriority(batch) {
    return BATCH_FOCUS_PRIORITY.get(batch?.status) ?? 99;
  }

  function batchCreatedTime(batch) {
    const time = Date.parse(batch?.created_at || "");
    return Number.isNaN(time) ? 0 : time;
  }

  function preferredBatch(batches) {
    if (!Array.isArray(batches) || batches.length === 0) return null;
    return [...batches].sort(compareBatchesForFocus)[0];
  }

  function compareBatchesForFocus(left, right) {
    const priority = batchFocusPriority(left) - batchFocusPriority(right);
    if (priority !== 0) return priority;
    const created = batchCreatedTime(right) - batchCreatedTime(left);
    if (created !== 0) return created;
    return String(left.batch_id || "").localeCompare(String(right.batch_id || ""));
  }

  function batchesForDisplay() {
    return [...state.batches].sort((left, right) => {
      if (left.batch_id === state.selectedBatchId) return -1;
      if (right.batch_id === state.selectedBatchId) return 1;
      return compareBatchesForFocus(left, right);
    });
  }

  function shouldOpenQueueOnInit(batch) {
    return AUTO_OPEN_QUEUE_STATUSES.has(batch?.status);
  }

  function hasActiveBatch() {
    return state.batches.some((batch) => {
      if (batch.execution_error) return false;
      return batch.status === "active" ||
        (batch.items || []).some((item) =>
          item.status === "confirmed" && item.execution_key ||
          [
            "generating_asset",
            "asset_confirmed",
            "submitted",
            "download_pending"
          ].includes(item.status));
    });
  }

  function schedulePolling() {
    window.clearTimeout(state.pollTimer);
    state.pollTimer = null;
    if (!hasActiveBatch()) return;
    state.pollTimer = window.setTimeout(async () => {
      await refreshBatches({ silent: true });
    }, 5000);
  }

  function activeBatch() {
    return state.batches.find((batch) => batch.batch_id === state.selectedBatchId) || null;
  }

  function canRetryBatch(batch) {
    return Boolean(batch?.items?.length) && batch.items.every((item) =>
      item.status === "failed_pre_submit" ||
      item.status === "failed_remote" ||
      item.status === "interrupted_unknown"
    );
  }

  function retryHasUnknown(batch) {
    return Boolean(batch?.items?.some((item) => item.status === "interrupted_unknown"));
  }

  function switchTab(name) {
    for (const tab of nodes.tabs) {
      const active = tab.dataset.tab === name;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    }
    for (const panel of nodes.panels) {
      const active = panel.id === `panel-${name}`;
      panel.classList.toggle("active", active);
      panel.hidden = !active;
    }
  }

  async function refreshBatches({ silent = false } = {}) {
    try {
      const payload = await api.getBatches();
      state.batches = payload.batches || [];
      if (state.selectedBatchId && !state.batches.some((batch) => batch.batch_id === state.selectedBatchId)) {
        state.selectedBatchId = null;
      }
      if (!state.selectedBatchId && state.batches.length > 0) {
        state.selectedBatchId = preferredBatch(state.batches)?.batch_id ?? null;
      }
      state.pollFailures = 0;
      renderAll();
      schedulePolling();
      if (!silent) showToast("批次列表已刷新");
    } catch (error) {
      state.pollFailures += 1;
      if (!silent) showToast(`刷新失败：${error.message}`);
      if (state.pollFailures < 3) schedulePolling();
    }
  }

  async function loadRuntimeInfo() {
    if (!nodes.runtimeBackendBadge) return;
    try {
      const runtime = await api.getRuntime();
      const backendLabel = runtime.executionBackend === "yingdao_rpa" ? "影刀 RPA" : "Playwright";
      state.realBatchEnabled = runtime.realBatchEnabled === true;
      state.realBatchMaxItems = Number.isInteger(runtime.realBatchMaxItems) && runtime.realBatchMaxItems >= 1
        ? runtime.realBatchMaxItems
        : 3;
      setText(
        nodes.runtimeBackendBadge,
        `批量生成：${backendLabel}`
      );
      if (nodes.captureHttpBadge) setText(nodes.captureHttpBadge, "抓包 HTTP：单条联调");
    } catch {
      setText(nodes.runtimeBackendBadge, "批量生成：未知");
      if (nodes.captureHttpBadge) setText(nodes.captureHttpBadge, "抓包 HTTP：状态未知");
    }
  }

  function renderAll() {
    setText(nodes.batchStatus, `${state.batches.length} 个批次`);
    renderBatchTable();
    renderBatchDetail();
    renderRecords();
    updateStartButton();
  }

  function renderBatchTable() {
    nodes.batchTable.textContent = "";
    if (state.batches.length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.className = "empty-state";
      setText(cell, "暂无批次。请先在新建商品或批量导入中提交素材。");
      row.append(cell);
      nodes.batchTable.append(row);
      return;
    }
    for (const batch of batchesForDisplay()) {
      const row = document.createElement("tr");
      row.classList.toggle("selected", batch.batch_id === state.selectedBatchId);
      row.append(
        td(batch.batch_id),
        td(statusLabel(batch.status)),
        td(`${batch.items?.length || 0} 条`),
        td(formatTime(batch.created_at)),
        actionCell(batch)
      );
      nodes.batchTable.append(row);
    }
  }

  function td(value) {
    const cell = document.createElement("td");
    setText(cell, value);
    return cell;
  }

  function actionCell(batch) {
    const cell = document.createElement("td");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-button";
    setText(button, "查看");
    button.addEventListener("click", () => {
      state.selectedBatchId = batch.batch_id;
      renderAll();
    });
    cell.append(button);
    return cell;
  }

  function renderBatchDetail() {
    const batch = activeBatch();
    nodes.batchDetail.textContent = "";
    if (!batch) {
      nodes.batchDetail.className = "detail-empty";
      setText(nodes.batchDetail, "选择一个批次查看商品。");
      return;
    }
    nodes.batchDetail.className = "";
    const itemCount = batch.items?.length || 0;
    const summary = document.createElement("p");
    summary.className = "task-meta";
    setText(summary, `状态：${statusLabel(batch.status)} · 商品 ${itemCount} 条`);
    const error = batch.execution_error ? document.createElement("div") : null;
    if (error) {
      error.className = "notice error";
      setText(error, `执行异常：${batch.execution_error}`);
    }
    const executionPlan = document.createElement("div");
    executionPlan.className = "execution-plan";
    const executionTitle = document.createElement("strong");
    setText(executionTitle, "执行设置");
    const executionCopy = document.createElement("span");
    setText(executionCopy, `按当前批次全部商品执行：${itemCount} 个商品生成 ${itemCount} 条视频。`);
    const strategyCopy = document.createElement("span");
    setText(strategyCopy, strategySummary(batch));
    executionPlan.append(executionTitle, executionCopy, strategyCopy);
    const list = document.createElement("ul");
    list.className = "task-list";
    for (const item of batch.items || []) {
      list.append(taskItem(item, batch));
    }
    nodes.batchDetail.append(summary);
    if (error) nodes.batchDetail.append(error);
    nodes.batchDetail.append(executionPlan);
    nodes.batchDetail.append(capturePanel(batch));
    if (canRetryBatch(batch)) nodes.batchDetail.append(retryBatchButton(batch));
    nodes.batchDetail.append(list);
  }

  function capturePanel(batch) {
    const capture = batch.capture || { enabled: false, status: "disabled" };
    const panel = document.createElement("div");
    panel.className = "capture-panel";
    const title = document.createElement("strong");
    setText(title, "抓包工作流");
    const status = document.createElement("span");
    setText(status, `状态：${captureStatusLabel(capture.status)}`);
    panel.append(title, status);
    if (!capture.enabled) {
      const hint = document.createElement("span");
      setText(hint, "本批次未开启抓包。");
      panel.append(hint);
      return panel;
    }
    for (const text of [
      capture.raw_steps_path ? `Raw steps：${capture.raw_steps_path}` : "",
      capture.manifest_path ? `Manifest：${capture.manifest_path}` : "",
      capture.replay_error ? `回放错误：${capture.replay_error.message || "Unable to complete the offline replay."}` : "",
      capture.replay_summary?.remote_id ? `远端 ID：${capture.replay_summary.remote_id}` : "",
      capture.dry_run_summary?.executed_step_count ? `预演步骤数：${capture.dry_run_summary.executed_step_count}` : "",
      capture.dry_run_error ? `预演错误：${capture.dry_run_error.message || "Unable to construct the dry-run request plan."}` : "",
      capture.queue ? `小批量预演：${captureQueueStatusLabel(capture.queue.status)}（${capture.queue.completed || 0}/${capture.queue.total || 0}）` : "",
      capture.queue?.last_error ? formatQueueLastError(capture.queue.last_error.code) : "",
      capture.status === "real_live_completed"
        ? "该批次已完成真实 HTTP 出片，默认不再重复生成。"
        : "真实请求预演仅构造请求计划，不访问飞影、不消耗积分"
    ].filter(Boolean)) {
      const line = document.createElement("span");
      setText(line, text);
      panel.append(line);
    }
    appendCaptureNotice(panel, batch);
    const actions = document.createElement("div");
    actions.className = "button-row";
    actions.append(
      captureActionButton(batch.batch_id, "抽取请求步骤", "extract", capture.status === "recorded"),
      captureActionButton(batch.batch_id, "脱敏生成 manifest", "redact", capture.status === "extracted"),
      captureActionButton(batch.batch_id, "离线回放验证", "replay", capture.status === "redacted" || capture.status === "replay_failed"),
      captureActionButton(
        batch.batch_id,
        "真实请求预演",
        "dryRun",
        ["redacted", "replay_passed", "dry_run_failed"].includes(capture.status)
      ),
      captureActionButton(
        batch.batch_id,
        "抓包 HTTP 小批量预演",
        "queueRun",
        Boolean(capture.manifest_path) && (batch.items || []).length > 0 && capture.status !== "real_live_running"
      ),
      captureActionButton(
        batch.batch_id,
        capture.status === "real_live_failed"
          ? "重新真实 HTTP 生成（会访问飞影，可能消耗积分）"
          : "真实 HTTP 生成（会访问飞影，可能消耗积分）",
        "liveRun",
        ["dry_run_passed", "real_live_failed"].includes(capture.status) && (batch.items || []).length === 1
      )
    );
    if (state.realBatchEnabled) {
      actions.append(
        captureActionButton(
          batch.batch_id,
          capture.status === "real_batch_failed"
            ? "重新真实 HTTP 小批量生成"
            : "真实 HTTP 小批量生成",
          "realBatchRun",
          ["dry_run_passed", "real_batch_failed"].includes(capture.status) && (batch.items || []).length > 0
        )
      );
    }
    panel.append(actions);
    const liveHint = document.createElement("p");
    liveHint.className = "muted";
    setText(liveHint, "小批量预演只使用本地 mock，不访问飞影、不消耗积分；真实 HTTP 生成只允许单条联调，且可能消耗积分。");
    panel.append(liveHint);
    if (state.realBatchEnabled) {
      const realBatchHint = document.createElement("p");
      realBatchHint.className = "muted";
      setText(realBatchHint, "真实 HTTP 小批量会访问飞影，可能消耗积分；按商品逐条执行，首失败即停，可在确认积分预算后续跑。");
      panel.append(realBatchHint);
      const realBatchReady = ["dry_run_passed", "real_batch_failed", "real_batch_running", "real_batch_completed"].includes(capture.status) && (batch.items || []).length > 0;
      const checklist = document.createElement("p");
      checklist.className = "muted";
      setText(checklist, `真实小批量就绪检查：${realBatchReady ? "✓ 批次可执行" : "✗ 批次未就绪（需 dry_run_passed 且有商品）"} · 积分预算 1-${state.realBatchMaxItems}（会消耗积分）`);
      panel.append(checklist);
    }
    return panel;
  }

  function captureActionButton(batchId, label, action, enabled) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost-button";
    button.dataset.disabled = enabled ? "false" : "true";
    button.disabled = state.busy || !enabled;
    setText(button, label);
    button.addEventListener("click", () => runCaptureAction(batchId, action));
    return button;
  }

  function retryBatchButton(batch) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "primary-button full-width-action";
    setText(button, retryHasUnknown(batch) ? "重新生成异常批次" : "重试失败批次");
    button.addEventListener("click", () => retryBatch(batch.batch_id));
    return button;
  }

  function taskItem(item, batch) {
    const li = document.createElement("li");
    li.className = "task-item";
    const title = document.createElement("div");
    title.className = "task-title";
    const name = document.createElement("span");
    setText(name, item.product_name);
    const badge = document.createElement("span");
    badge.className = "badge";
    setText(badge, statusLabel(item.status));
    title.append(name, badge);
    const meta = document.createElement("div");
    meta.className = "task-meta";
    setText(meta, `${item.sku || "-"} · ${item.category || "未填写品类"} · ${item.selling_points || "未填写卖点"}`);
    li.append(title, meta);
    const progress = taskProgress(item);
    if (progress) li.append(progress);
    if (item.output_path) {
      const actions = document.createElement("div");
      actions.className = "inline-actions";
      if (item.output_artifact_id) actions.append(downloadArtifactButton(batch.batch_id, item.output_artifact_id));
      actions.append(copyPathButton(item.output_path));
      li.append(actions);
    }
    return li;
  }

  function taskProgress(item) {
    const text = taskProgressText(item);
    if (!text) return null;
    const node = document.createElement("div");
    node.className = "task-progress";
    setText(node, text);
    return node;
  }

  function taskProgressText(item) {
    if (item.output_path) return `输出文件：${item.output_path}`;
    if (item.error_message) return `错误：${item.error_message}`;
    const checkpoint = item.submit_checkpoint;
    if (checkpoint?.phase === "remote_submit_wait") {
      const elapsed = Math.round((checkpoint.evidence?.elapsed_ms || 0) / 1000);
      const candidates = checkpoint.evidence?.candidate_count ?? 0;
      return `已点击视频生成，等待飞影最新作品刷新；已等待 ${elapsed} 秒，新作品候选 ${candidates} 个。`;
    }
    if (checkpoint?.phase === "remote_submit_clicked") {
      return "已点击视频生成，正在观察飞影最新作品列表。";
    }
    if (checkpoint?.phase === "remote_submit_pre") {
      return "手持商品图已确认，准备点击视频生成。";
    }
    if (item.status === "confirmed" && item.execution_key) return "已确认执行，等待后台开始处理。";
    if (item.status === "generating_asset") return "正在生成手持商品图。";
    if (item.status === "asset_confirmed") return "手持商品图已确认，等待提交视频或等待作品刷新。";
    if (item.status === "submitted") return "已提交飞影，等待生成完成。";
    if (item.status === "download_pending") return "飞影作品已生成，等待下载。";
    return "";
  }

  function renderRecords() {
    nodes.recordList.textContent = "";
    const batches = state.batches.filter((batch) =>
      (batch.items || []).some((item) => item.status && item.status !== "pending")
    );
    if (batches.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      setText(empty, "暂无运行记录。批次启动后会在这里显示提交、下载、失败和人工核对状态。");
      nodes.recordList.append(empty);
      return;
    }
    for (const batch of batches) {
      const card = document.createElement("article");
      card.className = "record-card";
      const title = document.createElement("h3");
      setText(title, batch.batch_id);
      const captureSummary = captureRecordSummary(batch);
      const list = document.createElement("ul");
      list.className = "task-list";
      for (const item of batch.items || []) list.append(taskItem(item, batch));
      card.append(title);
      if (captureSummary) card.append(captureSummary);
      card.append(list);
      nodes.recordList.append(card);
    }
  }

  function updateStartButton() {
    const batch = activeBatch();
    const ready = Boolean(batch?.items?.length) && batch.items.every((item) => item.status === "pending");
    nodes.startExecution.disabled = state.busy || !ready;
    nodes.startExecution.dataset.disabled = ready ? "false" : "true";
  }

  function formatTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("zh-CN", { hour12: false });
  }

  function importErrors(errors) {
    if (!errors || errors.length === 0) return "导入失败";
    return errors.map((error) => {
      const row = error.row ? `第 ${error.row} 行` : "表格";
      const detail = error.code === "SCRIPT_REQUIRED"
        ? "使用导入文案时，口播文案不能为空"
        : error.code;
      return `${row}：${detail}${error.sku ? `（${error.sku}）` : ""}`;
    }).join("\n");
  }

  async function createBatchAndImport(formData, options) {
    const created = await api.createBatch(options);
    formData.set("batchId", created.batch.batch_id);
    return api.importBatch(formData, options);
  }

  function formCaptureOption(form) {
    return { enabled: new FormData(form).get("captureEnabled") === "on" };
  }

  function bulkRowTemplate(rowId) {
    const row = document.createElement("article");
    row.className = "bulk-row";
    row.dataset.rowId = rowId;
    row.innerHTML = `
      <div class="bulk-row-head">
        <strong>商品</strong>
        <button class="ghost-button bulk-remove" type="button">删除</button>
      </div>
      <label>
        <span>SKU</span>
        <input name="bulkSku" autocomplete="off" placeholder="留空自动生成">
      </label>
      <label>
        <span>产品名称</span>
        <input name="bulkProductName" required autocomplete="off" placeholder="例如：云感保湿乳">
      </label>
      <label>
        <span>品类</span>
        <input name="bulkCategory" autocomplete="off" placeholder="例如：beauty">
      </label>
      <label class="file-control">
        <span>商品图</span>
        <input name="bulkProductImage" type="file" accept=".jpg,.jpeg,.png,image/jpeg,image/png" required>
      </label>
      <label class="bulk-selling-points">
        <span>核心卖点</span>
        <textarea name="bulkSellingPoints" rows="3" placeholder="每条卖点可用顿号、逗号或换行分隔"></textarea>
      </label>
      <label class="bulk-script">
        <span>口播文案</span>
        <textarea name="script" rows="3" placeholder="可选。填写后可按文案策略提交给飞影。"></textarea>
      </label>
    `;
    row.querySelector(".bulk-remove").addEventListener("click", () => {
      row.remove();
      updateBulkDeleteButtons();
    });
    return row;
  }

  function updateBulkDeleteButtons() {
    const rows = Array.from(nodes.bulkRows.querySelectorAll(".bulk-row"));
    for (const button of nodes.bulkRows.querySelectorAll(".bulk-remove")) {
      button.disabled = rows.length <= 1 || state.busy;
    }
  }

  function addBulkEntry() {
    const row = bulkRowTemplate(safeId("bulk-row"));
    nodes.bulkRows.append(row);
    updateBulkDeleteButtons();
  }

  function resetBulkForm() {
    nodes.bulkRows.textContent = "";
    nodes.bulkErrors.hidden = true;
    nodes.bulkErrors.textContent = "";
    addBulkEntry();
  }

  function bulkFormRows() {
    return Array.from(nodes.bulkRows.querySelectorAll(".bulk-row")).map((row, index) => {
      const sku = row.querySelector("[name='bulkSku']").value.trim() || safeId(`sku-${index + 1}`);
      const image = row.querySelector("[name='bulkProductImage']").files[0];
      const imageName = `${safeUploadStem(sku, `sku-${index + 1}`)}${imageExtension(image)}`;
      return {
        rowNumber: index + 1,
        image,
        uploadName: imageName,
        product: {
          sku,
          product_name: row.querySelector("[name='bulkProductName']").value.trim(),
          selling_points: row.querySelector("[name='bulkSellingPoints']").value.trim(),
          category: row.querySelector("[name='bulkCategory']").value.trim() || "default",
          image_path: imageName,
          script: row.querySelector("[name='script']").value.trim()
        }
      };
    });
  }

  function validateBulkRows(rows, options) {
    const errors = [];
    const seenSkus = new Set();
    for (const row of rows) {
      if (!row.product.product_name) errors.push(`第 ${row.rowNumber} 行：请填写产品名称`);
      if (!row.image) errors.push(`第 ${row.rowNumber} 行：请上传商品图`);
      if (options.script_strategy === "provided_script" && !row.product.script) {
        errors.push(`第 ${row.rowNumber} 行：使用导入文案时，请填写口播文案`);
      }
      const key = row.product.sku.toLocaleLowerCase("und");
      if (seenSkus.has(key)) errors.push(`第 ${row.rowNumber} 行：SKU 重复`);
      seenSkus.add(key);
    }
    return errors;
  }

  function appendFixedPersonFile(formData, file, options, errors) {
    if (options.person_strategy !== "fixed_upload") return;
    if (!file) {
      errors.push("选择固定人物时，请上传固定人物图");
      return;
    }
    formData.append("fixed_person_file", file, file.name);
  }

  async function handleBulkSubmit(event) {
    event.preventDefault();
    const options = {
      person_strategy: new FormData(event.currentTarget).get("personStrategy") || "auto_pool",
      script_strategy: new FormData(event.currentTarget).get("scriptStrategy") || "mixed",
      capture: formCaptureOption(event.currentTarget)
    };
    const fixedPersonImage = event.currentTarget.bulkFixedPersonImage.files[0];
    const rows = bulkFormRows();
    const errors = validateBulkRows(rows, options);
    const formData = new FormData();
    formData.append("batchId", "pending");
    appendFixedPersonFile(formData, fixedPersonImage, options, errors);
    nodes.bulkErrors.hidden = true;
    nodes.bulkErrors.textContent = "";
    if (errors.length > 0) {
      setText(nodes.bulkErrors, errors.join("\n"));
      nodes.bulkErrors.hidden = false;
      showToast("批量录入信息不完整");
      return;
    }

    const table = new File([makeCsv(rows.map((row) => row.product))], "products.csv", { type: "text/csv" });
    formData.append("files", table);
    for (const row of rows) formData.append("files", row.image, row.uploadName);

    setBusy(true);
    try {
      const payload = await createBatchAndImport(formData, options);
      state.selectedBatchId = payload.batch.batch_id;
      resetBulkForm();
      await refreshBatches({ silent: true });
      switchTab("queue");
      showToast(`批量录入成功：${rows.length} 个商品`);
    } catch (error) {
      const message = error.payload?.errors ? importErrors(error.payload.errors) : error.message;
      setText(nodes.bulkErrors, message);
      nodes.bulkErrors.hidden = false;
      showToast("批量录入失败，请查看错误明细");
    } finally {
      setBusy(false);
    }
  }

  async function handleSingleSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const image = form.productImage.files[0];
    if (!image) {
      showToast("请先上传商品图");
      return;
    }
    const sku = form.sku.value.trim() || safeId("sku");
    const script = String(values.get("script") || "").trim();
    const options = {
      person_strategy: values.get("personStrategy") || "auto_pool",
      script_strategy: values.get("scriptStrategy") || "mixed",
      capture: formCaptureOption(form)
    };
    const fixedPersonImage = form.personImage.files[0];
    if (options.script_strategy === "provided_script" && !script) {
      showToast("使用导入文案时，请填写口播文案");
      return;
    }
    if (options.person_strategy === "fixed_upload" && !fixedPersonImage) {
      showToast("选择固定人物时，请上传固定人物图");
      return;
    }
    const row = {
      sku,
      product_name: form.productName.value,
      selling_points: form.sellingPoints.value,
      category: form.category.value || "default",
      image_path: image.name,
      script
    };
    const table = new File([makeCsv([row])], "products.csv", { type: "text/csv" });
    const formData = new FormData();
    formData.append("batchId", "pending");
    if (options.person_strategy === "fixed_upload") {
      formData.append("fixed_person_file", fixedPersonImage, fixedPersonImage.name);
    }
    formData.append("files", table);
    formData.append("files", image, image.name);

    setBusy(true);
    try {
      const payload = await createBatchAndImport(formData, options);
      state.selectedBatchId = payload.batch.batch_id;
      form.reset();
      await refreshBatches({ silent: true });
      switchTab("queue");
      showToast("已加入待执行");
    } catch (error) {
      showToast(`加入失败：${error.payload?.errors ? importErrors(error.payload.errors) : error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleBatchImport(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const options = {
      person_strategy: values.get("personStrategy") || "auto_pool",
      script_strategy: values.get("scriptStrategy") || "mixed",
      capture: formCaptureOption(form)
    };
    const tableFile = form.tableFile.files[0];
    const images = Array.from(form.imageFiles.files || []);
    const fixedPersonImage = form.importFixedPersonImage.files[0];
    nodes.importErrors.hidden = true;
    nodes.importErrors.textContent = "";
    if (!tableFile || images.length === 0) {
      showToast("请上传表格和商品图片");
      return;
    }
    if (options.person_strategy === "fixed_upload" && !fixedPersonImage) {
      setText(nodes.importErrors, "选择固定人物时，请上传固定人物图");
      nodes.importErrors.hidden = false;
      showToast("批量导入信息不完整");
      return;
    }
    const formData = new FormData();
    formData.append("batchId", "pending");
    if (options.person_strategy === "fixed_upload") {
      formData.append("fixed_person_file", fixedPersonImage, fixedPersonImage.name);
    }
    formData.append("files", tableFile, tableFile.name);
    for (const image of images) formData.append("files", image, image.name);

    setBusy(true);
    try {
      const payload = await createBatchAndImport(formData, options);
      state.selectedBatchId = payload.batch.batch_id;
      form.reset();
      await refreshBatches({ silent: true });
      switchTab("queue");
      showToast("批量导入成功");
    } catch (error) {
      const message = error.payload?.errors ? importErrors(error.payload.errors) : error.message;
      setText(nodes.importErrors, message);
      nodes.importErrors.hidden = false;
      showToast("批量导入失败，请查看错误明细");
    } finally {
      setBusy(false);
    }
  }

  function openConfirmDialog() {
    const batch = activeBatch();
    if (!batch) return;
    setText(
      nodes.confirmSummary,
      `批次 ${batch.batch_id} 含 ${batch.items.length} 条商品，将按“一商品一条片”生成 ${batch.items.length} 条视频。${strategySummary(batch)}。预计积分以飞影页面最终显示为准。`
    );
    nodes.confirmItems.textContent = "";
    for (const item of batch.items) {
      const li = document.createElement("li");
      li.className = "task-item";
      setText(li, `${item.sku} · ${item.product_name}`);
      nodes.confirmItems.append(li);
    }
    nodes.confirmDialog.showModal();
  }

  async function confirmExecution() {
    const batch = activeBatch();
    if (!batch) return;
    nodes.confirmExecution.disabled = true;
    try {
      await api.startExecution({
        batchId: batch.batch_id,
        idempotencyKey: safeId(`exec-${batch.batch_id}`)
      });
      nodes.confirmDialog.close();
      await refreshBatches({ silent: true });
      switchTab("records");
      showToast("已启动生成，请保持飞影浏览器可用");
    } catch (error) {
      showToast(`启动失败：${error.message}`);
    } finally {
      nodes.confirmExecution.disabled = false;
    }
  }

  async function retryBatch(batchId) {
    const batch = state.batches.find((candidate) => candidate.batch_id === batchId);
    const allowUnknown = retryHasUnknown(batch);
    if (allowUnknown) {
      const approved = window.confirm(
        "这个批次处于需人工核对状态，可能已经在飞影提交过生成。重新生成可能重复消耗积分。确认要把异常任务重置为待执行吗？"
      );
      if (!approved) return;
    }
    setBusy(true);
    try {
      const payload = await api.retryBatch({ batchId, allowUnknown });
      state.selectedBatchId = payload.batch.batch_id;
      await refreshBatches({ silent: true });
      switchTab("queue");
      showToast(allowUnknown ? "异常批次已恢复为待执行，请确认后重新开始生成" : "失败批次已恢复为待执行，可以重新开始生成");
    } catch (error) {
      showToast(`重试失败：${error.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function runCaptureAction(batchId, action) {
    const methods = {
      extract: api.extractCapture,
      redact: api.redactCapture,
      replay: api.replayCapture,
      dryRun: api.dryRunCapture,
      queueRun: api.runCaptureQueue,
      liveRun: api.runLiveCapture,
      realBatchRun: api.runRealBatchCapture
    };
    let options = {};
    if (action === "queueRun") {
      const approved = window.confirm(
        "抓包 HTTP 小批量预演只使用本地 mock，不访问飞影、不消耗积分。确认继续吗？"
      );
      if (!approved) return;
    }
    if (action === "liveRun") {
      const approved = window.confirm(
        "真实 HTTP 生成会访问飞影并可能消耗积分。本次只执行 1 条商品。确认继续吗？"
      );
      if (!approved) return;
    }
    if (action === "realBatchRun") {
      const maxItems = state.realBatchMaxItems || 3;
      const input = window.prompt(
        `真实 HTTP 小批量会访问飞影并可能消耗积分（最多 ${maxItems} 条）。请输入本次积分预算（1-${maxItems} 的整数）：`,
        "1"
      );
      if (input === null) return;
      const pointBudget = Number.parseInt(input, 10);
      if (!Number.isInteger(pointBudget) || pointBudget < 1 || pointBudget > maxItems) {
        showToast(`积分预算必须是 1-${maxItems} 的整数`);
        return;
      }
      const approved = window.confirm(
        `确认以积分预算 ${pointBudget} 条执行真实 HTTP 小批量？会访问飞影并可能消耗积分。`
      );
      if (!approved) return;
      options = { pointBudget, resume: true };
    }
    setBusy(true);
    try {
      const payload = await methods[action](batchId, options);
      state.selectedBatchId = payload.batch.batch_id;
      await refreshBatches({ silent: true });
      showToast(`抓包工作流已更新：${captureStatusLabel(payload.batch.capture?.status)}`);
    } catch (error) {
      showToast(formatCaptureActionError(error));
    } finally {
      setBusy(false);
    }
  }

  function bindEvents() {
    for (const tab of nodes.tabs) {
      tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    }
    nodes.singleForm.addEventListener("submit", handleSingleSubmit);
    nodes.bulkForm.addEventListener("submit", handleBulkSubmit);
    nodes.importForm.addEventListener("submit", handleBatchImport);
    nodes.resetSingle.addEventListener("click", () => nodes.singleForm.reset());
    nodes.addBulkRow.addEventListener("click", addBulkEntry);
    nodes.resetBulk.addEventListener("click", resetBulkForm);
    nodes.refreshBatches.addEventListener("click", () => refreshBatches());
    nodes.startExecution.addEventListener("click", openConfirmDialog);
    nodes.confirmExecution.addEventListener("click", confirmExecution);
  }

  async function init() {
    bindEvents();
    resetBulkForm();
    try {
      await api.ensureSession();
      setText(nodes.sessionStatus, "会话已就绪");
      await loadRuntimeInfo();
      await refreshBatches({ silent: true });
      if (shouldOpenQueueOnInit(activeBatch())) switchTab("queue");
    } catch (error) {
      setText(nodes.sessionStatus, "会话失败");
      showToast(`初始化失败：${error.message}`);
    }
  }

  init();
}());
