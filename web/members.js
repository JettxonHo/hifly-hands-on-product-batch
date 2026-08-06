(function () {
  const csrfCookieName = "hifly_identity_csrf";
  const byId = (id) => document.getElementById(id);
  let members = [];

  function cookie(name) {
    const part = document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
    return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
  }

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body) headers.set("content-type", "application/json");
    if (options.method && options.method !== "GET") headers.set("x-identity-csrf", cookie(csrfCookieName) || "");
    const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error || "REQUEST_FAILED"), { code: payload.error, status: response.status });
    return payload;
  }

  function render() {
    const root = byId("memberList");
    root.replaceChildren();
    for (const member of members) {
      const row = document.createElement("div");
      row.className = "member-row";
      const identity = document.createElement("div");
      identity.textContent = `${member.display_name} · ${member.email}`;
      const role = document.createElement("div");
      role.textContent = member.role === "admin" ? "管理员" : "成员";
      const status = document.createElement("div");
      status.textContent = member.status;
      const actions = document.createElement("div");
      if (member.status !== "disabled") {
        const reset = document.createElement("button");
        reset.type = "button";
        reset.textContent = "重置密码";
        reset.addEventListener("click", () => resetPassword(member));
        const disable = document.createElement("button");
        disable.type = "button";
        disable.className = "danger";
        disable.textContent = "停用";
        disable.addEventListener("click", () => disableMember(member));
        actions.append(reset, disable);
      } else {
        actions.textContent = "已停用；当前版本不支持重新启用";
      }
      row.append(identity, role, status, actions);
      root.append(row);
    }
  }

  function showTemporary(label, value) {
    const panel = byId("temporaryPassword");
    panel.hidden = false;
    panel.textContent = `${label}：${value}。请立即安全交付，该密码不会再次显示。`;
  }

  async function load() {
    byId("memberList").textContent = "加载中…";
    try {
      const me = await request("/api/auth/me");
      if (me.status === "password_change_required") return window.location.replace("/login.html");
      if (me.membership.role !== "admin") return window.location.replace("/");
      members = (await request("/api/identity/members")).members;
      byId("membersError").textContent = "";
      render();
    } catch (error) {
      if (error.status === 401) return window.location.replace("/login.html");
      byId("membersError").textContent = "成员列表加载失败。";
    }
  }

  async function resetPassword(member) {
    try {
      const result = await request(`/api/identity/members/${encodeURIComponent(member.id)}/reset-password`, {
        method: "POST", body: JSON.stringify({ expected_revision: member.revision_number })
      });
      showTemporary("新临时密码", result.temporary_password);
      await load();
    } catch (error) {
      byId("membersError").textContent = error.code === "MEMBER_VERSION_CONFLICT"
        ? "成员状态已被其他操作更新，请刷新后重试。"
        : error.code === "ACCOUNT_UNAVAILABLE" ? "已停用成员不能重置密码。" : "密码重置失败。";
    }
  }

  async function disableMember(member) {
    try {
      await request(`/api/identity/members/${encodeURIComponent(member.id)}/disable`, {
        method: "POST", body: JSON.stringify({ expected_revision: member.revision_number })
      });
      await load();
    } catch (error) {
      byId("membersError").textContent = error.code === "MEMBER_VERSION_CONFLICT"
        ? "成员状态已被其他操作更新，请刷新后重试。"
        : "成员停用失败。";
    }
  }

  byId("createMemberForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      const result = await request("/api/identity/members", {
        method: "POST",
        body: JSON.stringify({ email: byId("memberEmail").value, display_name: byId("memberName").value, role: byId("memberRole").value })
      });
      showTemporary("一次性临时密码", result.temporary_password);
      event.target.reset();
      await load();
    } catch (error) {
      byId("membersError").textContent = error.code === "MEMBER_EMAIL_CONFLICT" ? "该工作邮箱已存在。" : "创建成员失败。";
    }
  });

  load();
})();
