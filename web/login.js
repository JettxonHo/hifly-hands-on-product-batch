(function () {
  let csrf = null;
  let mode = "login";
  const byId = (id) => document.getElementById(id);

  function cookie(name) {
    const part = document.cookie.split(";").map((value) => value.trim()).find((value) => value.startsWith(`${name}=`));
    return part ? decodeURIComponent(part.slice(name.length + 1)) : null;
  }

  function message(code) {
    return {
      AUTH_INVALID_CREDENTIALS: "邮箱或密码不正确。",
      ACCOUNT_UNAVAILABLE: "该账号不可使用，请联系管理员。",
      AUTH_RATE_LIMITED: "尝试次数过多，请稍后再试。",
      NO_ACTIVE_MEMBERSHIP: "当前账号没有可用企业空间。",
      PASSWORD_TOO_WEAK: "新密码至少需要 8 位。",
      PASSWORD_MUST_DIFFER: "新密码不能与临时密码相同。",
      CSRF_REQUIRED: "登录页面已过期，请刷新后重试。"
    }[code] || "操作失败，请稍后重试。";
  }

  async function json(response) {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error || "REQUEST_FAILED"), { code: payload.error, status: response.status });
    return payload;
  }

  async function newIntent() {
    csrf = await json(await fetch("/api/auth/intent", { credentials: "same-origin" }));
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

  function mutation(path, body) {
    return fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json", [csrf.csrf_header]: csrf.csrf_token },
      body: JSON.stringify(body)
    }).then(json);
  }

  function enterPasswordChange() {
    mode = "change";
    byId("authTitle").textContent = "设置新密码";
    byId("authSubtitle").textContent = "临时密码已验证，请设置新的登录密码。";
    byId("emailField").hidden = true;
    byId("passwordField").hidden = true;
    byId("email").disabled = true;
    byId("password").disabled = true;
    byId("newPasswordField").hidden = false;
    byId("newPassword").required = true;
    byId("submitButton").textContent = "保存并进入工作台";
    byId("newPassword").focus();
  }

  byId("authForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = byId("submitButton");
    button.disabled = true;
    byId("authError").textContent = "";
    try {
      if (!csrf) await newIntent();
      if (mode === "login") {
        const result = await mutation("/api/auth/login", { email: byId("email").value, password: byId("password").value });
        if (result.status === "password_change_required") enterPasswordChange();
        else window.location.assign(await landingPath());
      } else {
        await mutation("/api/auth/change-password", { new_password: byId("newPassword").value });
        window.location.assign(await landingPath());
      }
    } catch (error) {
      byId("authError").textContent = message(error.code);
      if (mode === "login" && [401, 403].includes(error.status)) await newIntent().catch(() => {});
    } finally {
      button.disabled = false;
    }
  });

  fetch("/api/auth/me", { credentials: "same-origin" })
    .then(async (response) => {
      if (!response.ok) return newIntent();
      const context = await response.json();
      if (context.status !== "password_change_required") return window.location.replace(await landingPath());
      const token = cookie("hifly_identity_csrf");
      if (!token) return newIntent();
      csrf = { csrf_token: token, csrf_header: "x-identity-csrf" };
      enterPasswordChange();
    })
    .catch(() => { byId("authError").textContent = "无法连接身份服务。"; });
})();
