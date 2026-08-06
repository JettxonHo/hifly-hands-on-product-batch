(async () => {
  const form = document.querySelector("#projectForm");
  const list = document.querySelector("#projectList");
  const formError = document.querySelector("#formError");
  const listError = document.querySelector("#listError");
  const csrf = () => decodeURIComponent((document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hifly_identity_csrf=")) || "=").split("=").slice(1).join("="));
  async function request(url, options = {}) {
    const headers = new Headers(options.headers || {}); if (options.method && options.method !== "GET") headers.set("x-identity-csrf", csrf());
    const response = await fetch(url, { credentials: "same-origin", ...options, headers });
    if ([401, 403].includes(response.status)) { location.replace("/login.html"); throw new Error("AUTH_REQUIRED"); }
    const body = await response.json(); if (!response.ok) throw Object.assign(new Error(body.error), { body }); return body;
  }
  function render(projects) {
    list.replaceChildren();
    if (!projects.length) { const empty = document.createElement("p"); empty.className = "empty"; empty.textContent = "还没有项目"; list.append(empty); return; }
    for (const project of projects) {
      const row = document.createElement("article"); row.className = "row";
      const detail = document.createElement("div"); const name = document.createElement("strong"); name.textContent = project.name;
      const meta = document.createElement("p"); meta.textContent = [project.delivery_date ? `交付 ${project.delivery_date}` : null, project.description].filter(Boolean).join(" · ") || "未填写说明";
      const link = document.createElement("a"); link.href = `/project.html?id=${encodeURIComponent(project.id)}`; link.textContent = "打开";
      detail.append(name, meta); row.append(detail, link); list.append(row);
    }
  }
  async function refresh() { listError.textContent = ""; try { render((await request("/api/projects")).projects); } catch (error) { if (error.message !== "AUTH_REQUIRED") listError.textContent = "项目加载失败，请刷新重试。"; } }
  form.addEventListener("submit", async (event) => { event.preventDefault(); formError.textContent = ""; const data = new FormData(form); const button = form.querySelector("button"); button.disabled = true;
    try { await request("/api/projects", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(Object.fromEntries(data)) }); form.reset(); await refresh(); }
    catch (error) { if (error.message !== "AUTH_REQUIRED") formError.textContent = error.message === "PROJECT_NAME_REQUIRED" ? "请填写项目名称。" : "项目创建失败，请重试。"; } finally { button.disabled = false; }
  });
  document.querySelector("#refresh").addEventListener("click", refresh);
  const runtime = await request("/api/runtime"); if (!runtime.projectContentEnabled) location.replace("/"); else await refresh();
})();
