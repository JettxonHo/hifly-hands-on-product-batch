(function () {
  const state = {
    batches: [],
    selectedBatchId: null,
    busy: false
  };

  const api = window.HiflyApi;
  const nodes = {
    sessionStatus: document.querySelector("#sessionStatus"),
    batchStatus: document.querySelector("#batchStatus"),
    tabs: Array.from(document.querySelectorAll(".tab")),
    panels: Array.from(document.querySelectorAll(".panel")),
    singleForm: document.querySelector("#singleForm"),
    resetSingle: document.querySelector("#resetSingle"),
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

  function setBusy(isBusy) {
    state.busy = isBusy;
    for (const button of document.querySelectorAll("button")) {
      if (button.id !== "cancelConfirm") button.disabled = isBusy || button.dataset.disabled === "true";
    }
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
    const fields = ["sku", "product_name", "selling_points", "category", "image_path"];
    return [
      fields.join(","),
      ...rows.map((row) => fields.map((field) => csvCell(row[field])).join(","))
    ].join("\n");
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

  function activeBatch() {
    return state.batches.find((batch) => batch.batch_id === state.selectedBatchId) || null;
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
        state.selectedBatchId = state.batches[0].batch_id;
      }
      renderAll();
      if (!silent) showToast("批次列表已刷新");
    } catch (error) {
      showToast(`刷新失败：${error.message}`);
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
    for (const batch of state.batches) {
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
    const executionPlan = document.createElement("div");
    executionPlan.className = "execution-plan";
    const executionTitle = document.createElement("strong");
    setText(executionTitle, "执行设置");
    const executionCopy = document.createElement("span");
    setText(executionCopy, `按当前批次全部商品执行：${itemCount} 个商品生成 ${itemCount} 条视频。`);
    executionPlan.append(executionTitle, executionCopy);
    const list = document.createElement("ul");
    list.className = "task-list";
    for (const item of batch.items || []) {
      list.append(taskItem(item));
    }
    nodes.batchDetail.append(summary, executionPlan, list);
  }

  function taskItem(item) {
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
    return li;
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
      const list = document.createElement("ul");
      list.className = "task-list";
      for (const item of batch.items || []) list.append(taskItem(item));
      card.append(title, list);
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
      return `${row}：${error.code}${error.sku ? `（${error.sku}）` : ""}`;
    }).join("\n");
  }

  async function createBatchAndImport(formData) {
    const created = await api.createBatch();
    formData.set("batchId", created.batch.batch_id);
    return api.importBatch(formData);
  }

  async function handleSingleSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const image = form.productImage.files[0];
    if (!image) {
      showToast("请先上传商品图");
      return;
    }
    const sku = form.sku.value.trim() || safeId("sku");
    const row = {
      sku,
      product_name: form.productName.value,
      selling_points: form.sellingPoints.value,
      category: form.category.value || "default",
      image_path: image.name
    };
    const table = new File([makeCsv([row])], "products.csv", { type: "text/csv" });
    const formData = new FormData();
    formData.append("batchId", "pending");
    formData.append("files", table);
    formData.append("files", image, image.name);

    setBusy(true);
    try {
      const payload = await createBatchAndImport(formData);
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
    const tableFile = form.tableFile.files[0];
    const images = Array.from(form.imageFiles.files || []);
    nodes.importErrors.hidden = true;
    nodes.importErrors.textContent = "";
    if (!tableFile || images.length === 0) {
      showToast("请上传表格和商品图片");
      return;
    }
    const formData = new FormData();
    formData.append("batchId", "pending");
    formData.append("files", tableFile, tableFile.name);
    for (const image of images) formData.append("files", image, image.name);

    setBusy(true);
    try {
      const payload = await createBatchAndImport(formData);
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
      `批次 ${batch.batch_id} 含 ${batch.items.length} 条商品，将按“一商品一条片”生成 ${batch.items.length} 条视频。预计积分以飞影页面最终显示为准。`
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

  function bindEvents() {
    for (const tab of nodes.tabs) {
      tab.addEventListener("click", () => switchTab(tab.dataset.tab));
    }
    nodes.singleForm.addEventListener("submit", handleSingleSubmit);
    nodes.importForm.addEventListener("submit", handleBatchImport);
    nodes.resetSingle.addEventListener("click", () => nodes.singleForm.reset());
    nodes.refreshBatches.addEventListener("click", () => refreshBatches());
    nodes.startExecution.addEventListener("click", openConfirmDialog);
    nodes.confirmExecution.addEventListener("click", confirmExecution);
  }

  async function init() {
    bindEvents();
    try {
      await api.ensureSession();
      setText(nodes.sessionStatus, "会话已就绪");
      await refreshBatches({ silent: true });
    } catch (error) {
      setText(nodes.sessionStatus, "会话失败");
      showToast(`初始化失败：${error.message}`);
    }
  }

  init();
}());
