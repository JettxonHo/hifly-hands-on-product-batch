# 2026-08-15 运营任务流 UX Slice B 实现会话

## 任务与边界

- Issue：#168 `UX Slice B: state-driven Copy, Avatar, and Plan workflow`
- 精确基线：`origin/main@8abdb1732402122c8fc7c96a3b536c830df9d333`
- 分支：`codex/operator-task-flow-slice-b`
- 工作树：`/private/tmp/hifly-operator-task-flow-slice-b`
- 严格顺序：Copy → Avatar → Plan

本轮只改三页前端、既有公开浏览器测试与三份状态文档；没有新增 API、数据库、migration、认证、package
或 lockfile 变更。没有开始 Slice C，也没有部署、SSH、访问 Hifly、启动 Worker、修改生产数据、生成视频或
消耗积分。旧 `gui/visual-refresh` 工作树和改动没有被复用、合并或覆盖。

## TDD 证据

### Copy RED → GREEN

在精确基线的临时只读工作树运行 `test/copy-generation-browser.test.js`，真实 Chrome 首个 RED 为：
页面没有 `当前任务` region，断言 `0 !== 1`。最小 GREEN 增加状态驱动任务摘要和推荐动作，随后继续用
既有 Copy 浏览器 seam 锁定生成中可离页、生成失败重试、脏输入、409 冲突保留、QC 失效与人工审核。

Copy 现在明确区分：

- 生成 pending/failed/succeeded；
- QC not-run/running/failed/review-required/passed/invalidated；
- HumanReview 未提交/审核中/需修改/approved/revoked；
- QC passed 只推荐提交人工审核，不显示“文案已批准”；
- 只有当前有效的 HumanReview approved 才推荐进入人物与素材。

### Avatar RED → GREEN

在精确基线运行 `test/avatar-selection-browser.test.js`，真实 Chrome RED 同样为缺少 `当前任务` region
（`0 !== 1`）。GREEN 以当前商品、approved copy、当前 selection 与既有 reason labels 为真值，保持
每商品独立选择；未选人物、当前选择失效、素材/授权/能力阻断均显示业务恢复动作，不伪造可继续状态。

“为商品确认人物”保持主任务；管理员登记企业人物仍留在次级管理区域，普通成员只读合同不变。只有当前有效
确认才推荐进入 Plan；Plan 能力关闭时明确等待，不制造未来链接。

### Plan RED → GREEN

在精确基线运行 `test/video-planning-browser.test.js`，真实 Chrome RED 为缺少 Plan `当前任务` region
（`0 !== 1`）。GREEN 覆盖无方案、草稿、dirty、预检 queued/running/failed/warning/passed、审核中、
需修改、approved、revoked、上游失效与 409 冲突。冲突继续保留本地输入；方案切换沿用既有脏数据确认。

preflight warning/passed 只代表检查完成，不等于 HumanReview approved。只有当前有效批准方案才进入
“等待生产工单能力开放”，前端没有模拟生产终态或放宽既有门禁。

### 第一轮独立 Review 修复 RED → GREEN

- Copy 公开浏览器 seam 在正文编辑后等待“保存当前修改”30 秒超时，证明首屏摘要没有随 dirty 状态更新；
  initial runtime fail-once 后点击推荐刷新，仍无法恢复项目与商品上下文。最小 GREEN 让编辑/派生状态同步刷新
  摘要，并让 derive 尚未修改正文时不推荐 disabled QC。
- Copy、Avatar、Plan 均复用完整 bootstrap 恢复入口。首次 runtime/context 请求失败时显示唯一“加载失败”与推荐
  刷新；刷新重新读取完整 runtime/project/auth 上下文，只有工作区完整成功后才清除错误。三页 browser seam
  都以 fail-once → 推荐刷新 → 正常业务状态锁定该行为。
- 状态文档统一到 Owner 锁定的 successor gate 顺序；该顺序不是已设计、已实现或已部署能力。

## 视觉、响应式与可访问性

- 三页均复用既有企业 shell、tokens、Button、Dialog、Notice 与 State Badge，没有引入框架、字体、图片、
  CDN、渐变、重阴影或新依赖。
- 每个业务状态最多一个品牌主操作；技术 ID 和证据仍由现有页面保留，但任务摘要只使用运营语言。
- 真实 Chrome 覆盖 1440x900、768x900、390x844；三页均无页面级横向滚动。回归在 768px 发现 Copy 与
  Avatar 原断点仍保持多列导致溢出，最小调整仅收窄这两页的响应式布局，未用全局 overflow 隐藏问题。
- 九张临时截图的 PNG 像素头与文件名逐一一致：
  `copy/avatar/plan-1440x900`、`-768x900`、`-390x844`。截图位于
  `/private/tmp/hifly-slice-b-screenshots`，不提交 Git。
- 回归保留语义 region/headings/labels、键盘 focus、`aria-live`、Dialog 和
  `prefers-reduced-motion`；Frontend Foundation 与 A14 主路径浏览器测试继续通过。

## 精确文件范围

- Copy：`web/copy.html`、`web/copy.css`、`web/copy.js`
- Avatar：`web/avatar.html`、`web/avatar.css`、`web/avatar.js`
- Plan：`web/plan.html`、`web/plan.css`、`web/plan.js`
- 浏览器测试：`test/copy-generation-browser.test.js`、`test/copy-quality-browser.test.js`、
  `test/avatar-selection-browser.test.js`、`test/video-planning-browser.test.js`
- 状态文档：`docs/status/CURRENT.md`、`docs/ROADMAP.md`、本 session

`web/operator-task-flow.css` 无需改动；未扩大到 `src/`、API 或 Slice C 页面。

## 验证与证据边界

- 页面级真实 Chrome 回归：Copy generation 1/1、Copy quality 1/1、Avatar 2/2、Plan 1/1。
- 共享回归：Frontend Foundation 1/1、A14 主路径 1/1。
- `npm run check`：通过，检查 229 个 JavaScript 文件。
- 第一轮 Review 修复后的默认 `npm test` 完整结束并通过：1022 tests，1008 通过、14 跳过、0 失败，
  用时约 48 秒。14 项跳过仍为仓库既有可选环境门禁（13 项 PostgreSQL integration，1 项可选 identity browser）。
- `git diff --check` 与 16 文件严格 allowlist 在提交前复核；fixed-head Ubuntu、Windows 与
  identity-postgres CI 是 Draft PR 的最终完整并发门禁。

本会话证明的是仓库实现与本地浏览器行为，不是合并、部署、客户采用或真实生产证据。Slice B 必须先经独立
Review 与合并；部署仍需单独授权和运行时验证。

Owner 已锁定 Slice B 之后的 successor gate 顺序：先从本项目运营角色、端到端任务、频率、错误成本、权限/审计、
安全门禁、现有 API/领域状态和中文环境开展内部问题审计；再带着具体问题定向研究外部企业工作台；随后形成
独立设计合同并通过 acceptance gate；最后才允许按 taste 原则分片重构。完成后再决定原 Slice C 照旧、rebase
或被新分片吸收。该方向不是本轮已设计或已实现内容，也不扩大 Issue #168。
