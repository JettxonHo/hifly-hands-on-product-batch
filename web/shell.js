(async () => {
  const shell = document.querySelector(".app-shell");
  if (!shell) return;

  const currentPage = document.body.dataset.shellPage;
  for (const link of document.querySelectorAll(".app-nav [data-page]")) {
    if (link.dataset.page === currentPage) link.setAttribute("aria-current", "page");
  }

  try {
    const meResponse = await fetch("/api/auth/me", { credentials: "same-origin" });
    if ([401, 403].includes(meResponse.status)) return window.location.replace("/login.html");
    if (!meResponse.ok) return;
    const context = await meResponse.json();
    if (context.status === "password_change_required") return window.location.replace("/login.html");
    window.HiflyIdentity = context;

    const runtimeResponse = await fetch("/api/runtime", { credentials: "same-origin" });
    const runtime = runtimeResponse.ok ? await runtimeResponse.json() : {};
    for (const link of document.querySelectorAll('[data-feature="assets"]')) link.hidden = runtime.assetsEnabled !== true;
    for (const link of document.querySelectorAll('[data-feature="project-content"]')) link.hidden = runtime.projectContentEnabled !== true;
    if (runtime.worksEnabled === true) {
      for (const nav of document.querySelectorAll(".app-nav")) {
        if (nav.querySelector('[data-feature="works"]')) continue;
        const link = document.createElement("a"); link.href = "/works.html"; link.dataset.page = "works"; link.dataset.feature = "works"; link.textContent = "作品库";
        if (currentPage === "works") link.setAttribute("aria-current", "page");
        const assetsLink = nav.querySelector('[data-feature="assets"]');
        const firstAdminLink = nav.querySelector('[data-role="admin"]');
        if (assetsLink) nav.insertBefore(link, assetsLink);
        else if (firstAdminLink) nav.insertBefore(link, firstAdminLink);
        else nav.append(link);
      }
    }
    for (const link of document.querySelectorAll('[data-role="admin"]')) link.hidden = context.membership.role !== "admin";

    const organization = document.querySelector("[data-shell-organization]");
    const member = document.querySelector("[data-shell-member]");
    if (organization) organization.textContent = context.organization?.name || "企业工作台";
    if (member) member.textContent = context.member?.display_name || context.member?.email || "已登录";

    document.querySelector("[data-shell-logout]")?.addEventListener("click", async () => {
      const value = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("hifly_identity_csrf="));
      const csrf = value ? decodeURIComponent(value.split("=").slice(1).join("=")) : "";
      await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json", "x-identity-csrf": csrf },
        body: "{}"
      });
      window.location.replace("/login.html");
    });
  } catch (_error) {
    const member = document.querySelector("[data-shell-member]");
    if (member) member.textContent = "身份信息暂不可用";
  }
})();
