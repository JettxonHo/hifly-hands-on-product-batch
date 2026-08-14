# 2026-08-13 运营任务流 UX Slice A 实现会话

## 任务与边界

- Issue：#166 `UX Slice A: Entry seam + opt-in foundation + Projects/Project`
- 基线：`origin/main@54fb3d88f2b182d358df8e8f5a9b0d06518b29b3`
- 分支：`codex/operator-task-flow-slice-a`
- 工作树：`/private/tmp/hifly-operator-task-flow-slice-a`
- 目标：实现 Entry seam、Login、Projects、Project 和严格 opt-in 的运营任务流 UX。独立 Review 后为兑现
  superseded 深链合同，主控批准新增一个组织隔离的 revision 只读路由；除该 additive GET seam 外，不改数据库、
  身份授权、写 API、状态机或生产执行语义。

本会话不开始 Slice B/C，不部署、不 SSH、不访问 Hifly、不启动 Worker、不修改生产数据、不生成视频且不消耗积分。
旧 `gui/visual-refresh` 工作树及其脏改动未被合并、搬运或覆盖。

## TDD 证据

### RED

公开浏览器 seam 在既有实现上复现：登录后再次直接访问 `/`，测试等待
`http://127.0.0.1:57900/projects.html` 30 秒超时。该失败证明企业能力开启时根路径仍停在 legacy GUI，
未满足已批准的 Entry 合同。

### GREEN

- `projectContentEnabled=true` 时，仅根路径 `/` 进入 `/projects.html`；显式 `/index.html` 保留 legacy GUI，
  并显示“企业流程请进入项目”。
- feature-off、runtime 请求失败或 auth 请求失败时保留 legacy 页面，不产生空白、循环跳转或前端权限绕过。
- Login、Projects 与 Project 通过 `.operator-task-page` 启用新样式；未迁移页面不受宽泛选择器影响。
- Projects 覆盖加载、空、失败、有项目、创建中和创建 Dialog；有项目时唯一推荐动作为继续最近项目。
- Project 覆盖无商品、草稿、脏数据、保存中/已保存、Ready、superseded、Ready 阻断与 409 版本冲突；
  保存和卖点确认后重新读取服务端快照，保持 revision 与商品列表同步。
- 同一状态最多一个实心品牌主操作；阻断状态不伪造可执行命令；Dialog 打开后焦点进入，关闭后恢复。

自审阶段另补两条公开 seam 的 RED/GREEN：Ready 版本的商品图片复选框曾被误禁用，浏览器断言得到
`true !== false` 后将禁用条件收窄为仅 `superseded`；素材功能关闭时页面曾永久显示“正在加载素材”并错误推荐
“设为 Ready”，新增浏览器断言超时 RED 后改为明确阻断且不提供主操作。两项均未改变后端状态或 API。

独立 Review required changes 的 RED/GREEN：商品切换和刷新会直接重绘并丢弃未保存字段；409 只有“刷新”动作；
旧 revision query 只在当前 revision 列表中查找而不可达；Projects 请求失败仍残留 loading；草稿阻断要到 Ready
失败后才显示。修复后，dirty 切换/刷新先明确确认，409 保留本地字段并提供独立“载入服务端最新版本”动作；
`GET /api/product-revisions/:revisionId` 复用现有组织作用域服务读取，缺失与跨组织统一 404；前端继续核对
`project_id` 与 `product_id`，不匹配时回落当前可见 revision 且不渲染外部内容；Projects 错误态清除 loading，
Project 与商品列表在首屏展示可计算的 Ready 阻断。

## 视觉与可访问性验收

- 真实 Chromium 覆盖 1440、768、390 三个视口，页面无横向滚动，长文本与操作区不溢出。
- 首轮 768 检查发现 Ready 阻断在双列布局下被压成过长竖排；在不改变业务 DOM 的前提下，将项目工作区在
  `<=980px` 切为单列，随后三个视口回归通过。
- 保留语义标题、landmark、label、`aria-live`、`aria-current`、可见键盘焦点、Dialog 焦点恢复和
  `prefers-reduced-motion`。
- 截图只写入 Git 忽略的 `/private/tmp/hifly-slice-a-screenshots`，未提交到仓库。

## 文件范围

- Entry/Login：`web/auth-gate.js`、`web/index.html`、`web/login.html`
- Projects/Project：`web/projects.html`、`web/projects.js`、`web/project.html`、`web/project.js`
- opt-in 样式：`web/operator-task-flow.css`
- 浏览器测试：`test/operator-task-flow-slice-a-browser.test.js`、`test/project-content-browser.test.js`
- 只读 revision seam：`src/server/routes/project-content.js`、`test/project-content-api.test.js`
- 状态文档：`docs/status/CURRENT.md`、`docs/ROADMAP.md`、本 session

原 no-`src/` 范围因历史 deep-link 所需只读 seam 经主控批准，仅扩展上述路由与 API 测试；没有修改数据库/migrations、
package/lock、Cloud Executor、Local Agent、Hifly 实现或任何写 API。

## 验证

- `node --test test/operator-task-flow-slice-a-browser.test.js test/project-content-browser.test.js`：5/5 通过。
- `node --test test/operator-task-flow-slice-a-browser.test.js test/gui-smoke.test.js test/frontend-foundation-browser.test.js test/identity-browser.test.js test/project-content-browser.test.js`：23 通过、1 跳过；跳过项是 identity browser 自身的可选环境门禁；新增覆盖 dirty 切换/刷新、409 本地字段保留、历史深链、安全回落、
  Projects runtime/API 错误、三视口和 reduced-motion。
- Project API/service 聚焦回归：14/14 通过，新增同组织读取、未认证拒绝、缺失与跨组织统一 404。
- `npm run check`：通过，检查 229 个 JavaScript 文件。
- `npm test`：1022 tests，972 通过，50 跳过，0 失败；其中 37 项因该次全量命令的 Chromium 环境门禁跳过，
  13 项因可选 PostgreSQL 环境未启用而跳过。Slice A 的公开浏览器组已另用本机 Chrome 实际运行通过。
- 首次修复后全量并发测试暴露 Slice A 与既有 production-order browser 同用 57900 起始端口的竞争；将 Slice A
  测试起始端口移至未占用区间后，全量回归稳定为零失败，未改生产端口或运行逻辑。
- `git diff --check` 与严格 allowlist 在提交前复核。

## 证据边界与下一步

本会话证明的是本地仓库实现、真实 Chromium 浏览器回归和既有测试兼容；不是部署、生产采用或客户验收证据。
Issue #166 的 Draft PR 经独立 Review 并合并后，才允许另建 Slice B Issue；部署仍是独立授权与验证步骤。
