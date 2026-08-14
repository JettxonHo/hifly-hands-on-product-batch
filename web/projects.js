(async () => {
  const form = document.querySelector("#projectForm");
  const list = document.querySelector("#projectList");
  const formError = document.querySelector("#formError");
  const listError = document.querySelector("#listError");
  const dialog = document.querySelector("#projectDialog");
  const opener = document.querySelector("#openProjectDialog");
  const refreshButton = document.querySelector("#refresh");
  const taskTitle = document.querySelector("#taskSummaryTitle");
  const taskContext = document.querySelector("#taskContext");
  const taskStatus = document.querySelector("#taskStatus");
  const taskNext = document.querySelector("#taskNext");
  const taskBlocker = document.querySelector("#taskBlocker");
  const csrf = () => decodeURIComponent((document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hifly_identity_csrf=")) || "=").split("=").slice(1).join("="));

  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.method && options.method !== "GET") headers.set("x-identity-csrf", csrf());
    const response = await fetch(url, { credentials: "same-origin", ...options, headers });
    if ([401, 403].includes(response.status)) {
      location.replace("/login.html");
      throw new Error("AUTH_REQUIRED");
    }
    const body = await response.json();
    if (!response.ok) throw Object.assign(new Error(body.error), { body });
    return body;
  }

  function recommend(element) {
    document.querySelectorAll('[data-recommended-action="true"]').forEach((item) => item.removeAttribute("data-recommended-action"));
    opener.classList.add("secondary");
    refreshButton.classList.add("secondary");
    list.querySelectorAll("a").forEach((link) => { link.className = "project-context-link"; });
    if (element?.tagName === "BUTTON") element.classList.remove("secondary");
    if (element?.tagName === "A") element.className = "button-link";
    element?.setAttribute("data-recommended-action", "true");
  }

  function task({ title, context, status, statusClass, next, blocker = "" }) {
    taskTitle.textContent = title;
    taskContext.textContent = context;
    taskStatus.className = `state ${statusClass}`;
    taskStatus.textContent = status;
    taskNext.textContent = next;
    taskBlocker.hidden = !blocker;
    taskBlocker.textContent = blocker;
  }

  function render(projects) {
    list.replaceChildren();
    list.setAttribute("aria-busy", "false");
    refreshButton.className = "secondary";
    opener.className = projects.length ? "secondary" : "";
    if (!projects.length) {
      const empty = document.createElement("div");
      empty.className = "empty operator-empty";
      empty.innerHTML = "<strong>还没有项目</strong><span>创建项目后即可录入商品并推进内容生产。</span>";
      list.append(empty);
      task({ title: "创建第一个项目", context: "企业项目 · 0 个", status: "尚未开始", statusClass: "unavailable", next: "创建第一个项目" });
      recommend(opener);
      return;
    }

    projects.forEach((project, index) => {
      const row = document.createElement("article");
      row.className = "row project-row";
      const detail = document.createElement("div");
      const name = document.createElement("strong");
      name.className = "row-title";
      name.textContent = project.name;
      name.title = project.name;
      const meta = document.createElement("p");
      meta.textContent = [project.delivery_date ? `交付 ${project.delivery_date}` : null, project.description].filter(Boolean).join(" · ") || "未填写说明";
      const link = document.createElement("a");
      link.href = `/project.html?id=${encodeURIComponent(project.id)}`;
      link.textContent = index === 0 ? "继续项目" : "打开项目";
      link.setAttribute("aria-label", index === 0 ? `继续项目，打开 ${project.name}` : `打开项目 ${project.name}`);
      link.className = "project-context-link";
      detail.append(name, meta);
      row.append(detail, link);
      list.append(row);
    });
    recommend(list.querySelector("a"));
    task({ title: "选择要继续的项目", context: `企业项目 · ${projects.length} 个`, status: "可继续", statusClass: "ready", next: "继续最近项目" });
  }

  async function refresh() {
    listError.textContent = "";
    list.setAttribute("aria-busy", "true");
    list.innerHTML = '<p class="empty">正在加载...</p>';
    task({ title: "选择要继续的项目", context: "企业项目", status: "正在加载", statusClass: "upload_pending", next: "等待项目载入" });
    try {
      render((await request("/api/projects")).projects);
    } catch (error) {
      list.setAttribute("aria-busy", "false");
      if (error.message === "AUTH_REQUIRED") return;
      listError.textContent = "项目加载失败，请刷新重试。";
      recommend(refreshButton);
      task({ title: "项目暂时无法载入", context: "企业项目", status: "加载失败", statusClass: "failure", next: "重新加载项目", blocker: "项目列表未载入，请先重试。" });
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    formError.textContent = "";
    const data = new FormData(form);
    const button = form.querySelector('button[type="submit"]');
    const label = button.textContent;
    button.disabled = true;
    button.textContent = "正在创建...";
    try {
      await request("/api/projects", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(Object.fromEntries(data)) });
      form.reset();
      dialog.close();
      await refresh();
    } catch (error) {
      if (error.message !== "AUTH_REQUIRED") formError.textContent = error.message === "PROJECT_NAME_REQUIRED" ? "请填写项目名称。" : "项目创建失败，请重试。";
    } finally {
      button.disabled = false;
      button.textContent = label;
    }
  });

  refreshButton.addEventListener("click", refresh);
  opener.addEventListener("click", () => {
    formError.textContent = "";
    dialog.showModal();
    form.name.focus();
  });
  document.querySelector("#closeProjectDialog").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => opener.focus());

  try {
    const runtime = await request("/api/runtime");
    if (!runtime.projectContentEnabled) location.replace("/");
    else await refresh();
  } catch (error) {
    if (error.message !== "AUTH_REQUIRED") {
      list.setAttribute("aria-busy", "false");
      listError.textContent = "工作台配置暂时无法读取，请稍后刷新。";
      recommend(refreshButton);
      task({ title: "工作台暂时无法载入", context: "企业项目", status: "加载失败", statusClass: "failure", next: "稍后刷新页面", blocker: "运行配置未载入。" });
    }
  }
})();
