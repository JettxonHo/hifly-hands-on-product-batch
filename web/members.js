(function () {
  const csrfCookieName = "hifly_identity_csrf";
  const byId = (id) => document.getElementById(id);
  let members = [];
  let memberPendingDisable = null;

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

  async function landingPath() {
    try {
      const response = await fetch("/api/runtime", { credentials: "same-origin" });
      const runtime = response.ok ? await response.json() : {};
      return runtime.projectContentEnabled === true ? "/projects.html" : "/";
    } catch (_error) {
      return "/";
    }
  }

  function render() {
    const root = byId("memberList");
    root.replaceChildren();
    for (const member of members) {
      const row = document.createElement("div");
      row.className = "member-row";
      const identity = document.createElement("div");
      identity.className = "member-identity member-cell";
      const displayName = document.createElement("strong"); displayName.textContent = member.display_name;
      const email = document.createElement("span"); email.textContent = member.email; email.title = member.email;
      identity.append(displayName, email);
      const role = document.createElement("div"); role.className = "member-cell"; role.dataset.label = "角色";
      role.textContent = member.role === "admin" ? "管理员" : "成员";
      const status = document.createElement("div"); status.className = "member-cell"; status.dataset.label = "状态";
      const statusLabel = document.createElement("span"); statusLabel.className = `state ${member.status}`; statusLabel.textContent = member.status === "disabled" ? "已停用" : "启用"; status.append(statusLabel);
      const actions = document.createElement("div"); actions.className = "member-actions";
      if (member.status !== "disabled") {
        const reset = document.createElement("button");
        reset.type = "button";
        reset.className = "secondary";
        reset.textContent = "重置密码";
        reset.addEventListener("click", () => resetPassword(member));
        const disable = document.createElement("button");
        disable.type = "button";
        disable.className = "danger";
        disable.textContent = "停用";
        disable.addEventListener("click", () => openDisableDialog(member));
        actions.append(reset, disable);
      } else {
        actions.classList.add("member-disabled-copy");
        actions.textContent = "当前版本不支持重新启用";
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
      if (me.membership.role !== "admin") return window.location.replace(await landingPath());
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
      byId("disableMemberDialog").close();
    } catch (error) {
      byId("membersError").textContent = error.code === "MEMBER_VERSION_CONFLICT"
        ? "成员状态已被其他操作更新，请刷新后重试。"
        : "成员停用失败。";
    }
  }

  function openDisableDialog(member) {
    memberPendingDisable = member;
    byId("disableMemberSummary").textContent = `确认停用“${member.display_name}”（${member.email}）？停用后将无法继续访问企业工作台。`;
    byId("disableMemberDialog").showModal();
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

  byId("openMemberDialog").addEventListener("click", () => {
    byId("temporaryPassword").hidden = true;
    byId("memberDialog").showModal();
    byId("memberEmail").focus();
  });
  byId("closeMemberDialog").addEventListener("click", () => byId("memberDialog").close());
  byId("closeDisableMemberDialog").addEventListener("click", () => byId("disableMemberDialog").close());
  byId("cancelDisableMember").addEventListener("click", () => byId("disableMemberDialog").close());
  byId("confirmDisableMember").addEventListener("click", async () => {
    if (memberPendingDisable) await disableMember(memberPendingDisable);
  });

  load();
})();
