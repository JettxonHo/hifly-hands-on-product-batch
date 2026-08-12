# 2026-08-12 CE-04 / Issue #139 Cloud Profile 与受控登录

## 授权与边界

- 角色：`IMPLEMENTER`。
- 自定义 Agent：`luna-worker`；配置模型：`gpt-5.6-luna`；推理：`max`；配置状态：`CONFIG_VERIFIED`；运行时模型元数据不可见：`UNVERIFIED_RUNTIME_MODEL`。
- 分支：`codex/ce-04-cloud-login-readiness`；基线：`main@678aa48`。
- 本轮严格限制为 CE-04 本地 fake 实现和测试。不访问 Hifly，不启动真实浏览器页面，不上传、不生成、不下载，不调用 DeepSeek，不部署服务器，不触发积分。

## 已完成

- 新增 `src/cloud-executor/login.js` 和 `scripts/cloud-executor.js`，提供显式 `login` mode/command。Active login runtime 只有 `login`/`close`，不构造 Cloud Executor service/worker，因此没有 `runOnce` 或 claim seam；命令拒绝其他模式并以受控状态退出。
- 扩展 `src/cloud-executor/config.js`：login mode 所需的 workspace/Profile、Hifly config path、`DISPLAY=:99`、Xvfb 与 loopback/private noVNC contract。noVNC 默认 `127.0.0.1:6080`，`public=false`，拒绝 wildcard/public bind。
- 新增 `src/cloud-executor/workspace.js`：为持久 Profile 建立固定非敏感 `.cloud-executor-profile.marker`，验证 marker 内容，fake restart 可证明使用同一 Profile filesystem。Profile/cookie/LocalStorage/token 内容不进入 Git、DB、公共 API、日志或 snapshots；仓库内 cloud Profile/marker 加入 `.gitignore`。
- 修改 CE-03 adapter 复用既有 Hifly page/executor：login 先打开已有 workbench，等待 operator 输入，再调用 delegate `preflight()`；未新增 selector、上传、生成或下载 flow。Cloud runtime readiness 在 claim 前调用已有 Playwright preflight，将 `LOGIN_REQUIRED`/missing/expired session 归一为 `requires_login`；公开 seam 只返回受控状态。
- 新增 `docs/deployment/CLOUD_EXECUTOR_LOGIN_CONTRACT.md` 与 `deploy/cloud-executor-login.yml`。fragment 是 CE-04 contract only，无 public `ports:`，实际 Xvfb/noVNC image、部署与 live proof 归 CE-07。

## 验证

- TDD red 阶段先确认缺少 login runtime、adapter login/marker、command 的测试失败；随后实现并通过。
- `node --test test/cloud-executor-login.test.js test/cloud-executor.test.js test/cloud-executor-playwright.test.js`：30/30 通过。
- `npm run check`：检查 223 个 JavaScript 文件通过。
- `npm test`：985 total / 971 pass / 14 existing environment skip / 0 fail。
- `git diff --check`：通过。
- `npm audit --omit=dev --audit-level=high`：官方 registry 报告仓库既有 7 个依赖漏洞（5 high/2 moderate）；未执行 `npm audit fix`，避免扩大 CE-04 范围。默认镜像 registry 的 audit endpoint 返回未实现。

## 当前状态与下一步

- Implementation commit：`62854cb`。分支已推送，READY PR [#147](https://github.com/JettxonHo/hifly-hands-on-product-batch/pull/147) 为 `OPEN`、非 draft、base `main`、body 关联 `Closes #139`。
- PR 初次 CI：Ubuntu Node 22 `pass`、Windows Node 22 `pass`、identity-postgres `pass`。
- 当前等待独立 Review；不合并、不审批、不部署、不访问 Hifly、不使用真实 Profile/登录态，不执行真实 Provider 或积分动作。
- 不合并、不审批、不部署、不访问 Hifly、不使用真实 Profile/登录态，不执行真实 Provider 或积分动作。
