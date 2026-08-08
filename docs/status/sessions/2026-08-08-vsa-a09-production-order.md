# VSA-A09 ProductionOrder 实现接力（2026-08-08）

## 任务与路由

- Issue：GitHub #65，VSA-A09「ProductionOrder creation and execution waiting」
- 逻辑角色：IMPLEMENTER；请求自定义 Agent：`luna-worker`
- 配置：`~/.codex/agents/luna-worker.toml` / `gpt-5.6-luna` / Max
- 实际运行时模型：`UNVERIFIED_RUNTIME_MODEL`
- worktree：`/private/tmp/hifly-vsa-a09`
- 分支：`codex/vsa-a09-production-order`
- 基准/当前 HEAD：`1afac0b56b740d41cb9b0d5c0b1363b2f3e57a08`（未 commit）

## Sol 首轮 Review 修复

- 修正 PostgreSQL outbox trigger：仅允许 `published_at` 从 null 首次写入时间，delete、payload、aggregate、event 等字段仍不可变；集成测试已锁定该合同。
- Video Planning 在 productionOrders feature 开启时服务端投影当前 head/frozen/approved/有效 preflight 的生产可用性；API 与 `plan.js` 使用该投影，feature off 保持 false。
- A07 浏览器断言改为真实「进入人物与素材」链接并校验 href。
- Kimi 长期规则：固定 `kimi-code/k3`；`max_context_size=1048576`；thinking 显式 `max`（默认 `high` 不得误报）；wire/session 不可验证模型时标 `UNVERIFIED_RUNTIME_MODEL`。

## 已完成

- 新增 ProductionOrder memory/PostgreSQL repository、独立 PostgreSQL migration/ledger 与迁移脚本。
- 新增 ProductionOrder service：四种合法目的、服务端重新校验当前有效 approved VideoPlan/PlanReview、不可变输入快照、
  `draft → ready → waiting_for_executor`、离线 Agent 非阻断、幂等回放/冲突/新意图、审计和 outbox 同写入边界。
- 为 Video Planning 增加正式 `resolveCurrentApprovedPlan` port；新增创建、列表、详情、workspace API 与安全公共投影。
- 新增 `/production.html` 三栏/390 单列 UI；仅 A09 状态和交接包占位；A08 方案页及阶段条 feature 开启时提供真实生产入口。
- 默认 feature off，未修改 Capture HTTP、Playwright 执行链、默认生产路径或真实飞影行为。

## 验证与卡点

- targeted service/API：25 pass；PostgreSQL 集成因未设置 `TEST_DATABASE_URL` 或 `IDENTITY_TEST_DATABASE_URL` 明确 skipped。
- Sol 使用系统 Chrome 实跑 A09/A08/A07 targeted：3/3 通过。
- A09 专项浏览器测试再次通过，并生成桌面 1440px 与移动 390px 临时截图；无横向滚动、文字遮挡、按钮溢出或状态色误用。
  截图仅位于 `/tmp/hifly-a09-visual/`，不提交仓库。
- `npm run check`：通过（149 JavaScript 文件）。
- `npm test`：739 tests / 703 pass / 0 fail / 36 skipped。
- `git diff --check`：通过。
- Sol 独立代码与视觉复审：无剩余 Critical/Important。PostgreSQL 集成因本机未配置测试数据库，待 PR CI 验证。

## 成本与后续

- 未访问飞影、未发送真实 HTTP/Provider 请求、未使用登录态、未运行批次、未消耗积分。
- 下一步由 Sol 提交并创建 PR，等待三组 CI 后按 Owner 预授权决定合并；实现者不批准或合并自己的改动，不开始 A10/A11+。
