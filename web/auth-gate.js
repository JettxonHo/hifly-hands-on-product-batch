(async () => {
  try {
    const response = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (response.status === 401 || response.status === 403) {
      window.location.replace("/login.html");
      return;
    }
    if (response.status === 404) return;
    if (!response.ok) return;
    const context = await response.json();
    if (context.status === "password_change_required") {
      window.location.replace("/login.html");
      return;
    }
    window.HiflyIdentity = context;
    const strip = document.querySelector(".status-strip");
    if (!strip) return;
    if (context.membership.role === "admin") {
      const members = document.createElement("a");
      members.href = "/members.html";
      members.className = "status-pill";
      members.textContent = "成员管理";
      strip.append(members);
    }
    const logout = document.createElement("button");
    logout.type = "button";
    logout.className = "status-pill identity-logout";
    logout.textContent = "退出";
    logout.addEventListener("click", async () => {
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
    strip.append(logout);
  } catch (_error) {
    // The workbench already renders its normal connection error state.
  }
})();
