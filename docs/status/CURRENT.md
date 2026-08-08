# 项目当前状态

> 最后更新：2026-08-08
> 当前远端 main：`fd6a206`（VSA-A09 已通过 PR #86 合并）
> 当前 Goal：Vertical Slice A

## VSA-A10 当前实现与独立验收（Issue #66，2026-08-08）

- 状态：本 worktree 的 A10 实现、Review 修复、定向测试和浏览器验收已完成；未 commit、push、创建 PR、合并或关闭 Issue。
- worktree：`/private/tmp/hifly-vsa-a10`；分支：`codex/vsa-a10-manual-handoff`；基线：`fd6a2062c2329e66617ee35e028cc1ae4ffce4f2`（A09 PR #86 已合并）。
- 已实现 ManualHandoffPackage、AsyncJob、memory/PostgreSQL repository、独立 migration/ledger、服务/API、Organization 隔离、权限、审计、短时下载授权、状态历史和默认关闭 feature flag。
- ZIP 固定包含权威 `manifest.json` 与由 manifest 派生的 `README.md`，只按 embedded 模式写入受控 assets；实现 `manual_handoff` / `1.0`、package/manifest/package hash、幂等、失败脱敏重试、superseded/expired/revoked 历史投影。
- README 的派生作业说明包含固定商品、完整批准文案、人物名称/来源/授权摘要、VideoPlan 输出说明，以及 manifest 中存在的预期行为、已知限制和人工确认点；不新增独立事实。
- 生成与下载不创建 ExecutionAttempt，也不改变 ProductionOrder 状态；下载授权不向 public JSON、日志或 manifest 暴露 token、签名 URL、永久路径。
- A09 创建 ProductionOrder 时新增深模块输入快照：冻结真实 A04 文案正文/版本/审核事实、A02 ProductRevision 产品事实与固定 AssetVersion 引用、A07 已选人物展示/来源/授权/能力事实；A10 仅按固定 asset version 读取字节。旧 order 缺少这些事实时以受控错误失败，不会生成空字段 ready 包。
- 补充真实 A04-A09 服务/API 链路到 A10 ZIP/manifest 集成测试；移除二进制图片正文的 URL/token 正则扫描，含普通 URL 元数据的合法图片可随包写入，敏感边界仍由受控 asset version、组织/权限/用途和 manifest 投影保证。
- 每个 embedded asset 入包前校验冻结 `size` 与实际 `Buffer.length`、冻结 `checksum` 与实际 SHA-256；错误字节、长度或 checksum 进入 `generation_failed`，不会写入 ready ZIP。相关测试 fixtures 使用真实一致的尺寸与 checksum。
- `/production.html/css/js` 右栏增量覆盖生成、刷新恢复、重试、下载、重新授权、内容摘要、历史和 A11 禁用说明；A09 feature-off 浏览器回归保持无 A10 按钮，390px 无横向滚动验收已实跑。
- 浏览器测试用受控 fake 实跑 generation_failed → 刷新恢复 → 重试 → ready → 下载，并覆盖 390px 无横向滚动与 A11 无可执行入口；不访问真实网络。
- 定向验证：ManualHandoff service 10 pass；API 3 pass；真实 A04-A09→A10 链路 1 pass；A10 系统 Chrome/Playwright 1 pass；A09 production-order 系统 Chrome/Playwright 回归 1 pass；`npm run check` 通过（159 个 JavaScript 文件）。
- 全量 `npm test`：755 tests / 717 pass / 0 fail / 38 environment skips。A10 PostgreSQL clean migration/integration 因未设置 `TEST_DATABASE_URL` 或 `IDENTITY_TEST_DATABASE_URL` 明确 skipped，未声称通过。
- `git diff --check` 已通过；依赖仅新增成熟 server-side `archiver` 并更新 `package-lock.json`。
- 本轮未访问 Hifly、未发送真实 Provider/Capture HTTP、未运行批次、未消耗飞影积分。配置模型为 `gpt-5.6-luna` / Max，配置状态 `CONFIG_VERIFIED`；实际运行时模型无法从环境验证，标记 `UNVERIFIED_RUNTIME_MODEL`。

## VSA-A09 当前实现与独立验收（Issue #65，2026-08-08）

- A09 已在独立 worktree `/private/tmp/hifly-vsa-a09`、分支 `codex/vsa-a09-production-order` 从基准
  `1afac0b56b740d41cb9b0d5c0b1363b2f3e57a08` 实现，并已由 PR #86 合并；A10 当前 worktree 以合并提交
  `fd6a2062c2329e66617ee35e028cc1ae4ffce4f2` 为基线，根工作区未触碰。
- 已实现 ProductionOrder memory/PostgreSQL repository、独立 migration/ledger、服务端正式的当前有效已批准
  VideoPlan port、创建/列表/详情/工作区 API、组织隔离、成员权限、幂等回放/冲突、新意图新工单、输入快照、
  `draft → ready → waiting_for_executor` 状态链、同事务 AuditEvent/Outbox，以及 Local Agent 离线非阻断投影。
- `/production.html/css/js` 遵循 A09 三栏/390 单列设计；右栏仅保留真实「尚未生成交接包」占位，没有 A10 生成按钮或
  A11 领取入口。A08 `plan.html` 批准后在 productionOrders feature 开启时展示真实入口；默认 feature off 保持旧路径。
- Sol 首轮 Review 的 3 项修复已完成：outbox 允许唯一受控的 `published_at` 首次写入并保护其余字段；
  Video Planning 服务端按 feature/head/frozen/approved/preflight gate 投影生产可用性，API 与 `plan.js` 均消费该投影；
  A07 copy-quality 浏览器断言已更新为真实「进入人物与素材」链接并校验 href。
- targeted：ProductionOrder/Video Planning service/API 共 25 pass；PostgreSQL 迁移集成 1 skipped（未设置
  `TEST_DATABASE_URL`/`IDENTITY_TEST_DATABASE_URL`，未声称通过）；`npm run check` 通过（149 JS 文件）。
- `npm test`：739 tests / 703 pass / 0 fail / 36 skipped。Sol 已使用系统 Chrome 实跑 A09/A08/A07 targeted 3/3，
  并对 A09 1440px/390px 临时截图完成视觉验收；无横向滚动、文字遮挡、按钮溢出或状态语义误用。
- Sol 独立代码与视觉复审未发现剩余 Critical/Important。PostgreSQL 集成因本机没有测试数据库连接而 skipped，
  待 PR CI 数据库任务验证。
- Kimi 长期规则已记录：固定 `kimi-code/k3`、1M context（`max_context_size=1048576`）、thinking 显式 `max`；
  当前默认 `high` 不得误报，wire/session 无法验证时标 `UNVERIFIED_RUNTIME_MODEL`。
- 本轮未访问 Hifly、未发送真实 Provider 请求、未运行任何批次、未消耗飞影积分。

## Agent 路由迁移与 A09-A10 设计（2026-08-08）

- A08 已通过 PR #84 合并并关闭 Issue #64；Ubuntu、Windows、identity/PostgreSQL CI 全绿。
- Kimi Code 已使用 `kimi-code/k3` 完成 `docs/frontend/VSA-A09-A10_UIUX_DESIGN.md`；主控已复核并修正
  ProductionOrder 幂等边界与较早工单状态表达。只包含设计文档，不修改生产代码。
- Owner 已于 2026-08-08 明确恢复 Goal；当前从 main `1afac0b` 建立 A09 独立 worktree
  `/private/tmp/hifly-vsa-a09`、分支 `codex/vsa-a09-production-order`，准备实现 Issue #65。
- Owner 已纠正实现模型路由：后续边界明确的实现任务必须使用自定义 Agent `luna-worker`，配置为
  `~/.codex/agents/luna-worker.toml`、`gpt-5.6-luna`、Max；不再自动回退 Terra。
- 配置文件已核验，状态 `CONFIG_VERIFIED`。恢复后的当前会话已明确暴露
  `agent_type: "luna-worker"`；派发前运行时状态仍为 `UNVERIFIED_RUNTIME_MODEL`，派发后按工具可见证据更新。
- 当前无 Active Terra Agent。已完成的 Terra Review/修复结果全部保留并已进入 A07/A08 合并历史；
  Socrates 与 Tesla 的已完成会话已关闭，不删除其成果。
- A09 实现、Review 修复和独立验收已在上方独立 worktree 完成，等待 PR/CI；不得回退 Terra，也不要在本 worktree
  执行 A10/A11+。
- 本轮未访问 Hifly、未发送真实 Provider 请求、未运行 `MULTI-002`、未消耗积分。

## VSA-A08 当前本地实现（Issue #64）

- A07 已通过 PR #83 合并并关闭 Issue #63；A08 基于该 main 在 `/private/tmp/hifly-vsa-a08`、分支
  `codex/vsa-a08-video-plan` 完成本地实现、两轮独立 Review 修复与最终复审，尚未 commit、push、PR、CI 或合并。
- 已实现不可变 VideoPlanVersion（draft→frozen→superseded）、只读 ProductRevision/approved CopyVersion/
  confirmed AvatarSelection/实际 capability snapshot 引用；frozen 修改只能派生新 draft。
- PreflightRun 技术执行与 PreflightResult 业务结论完全分离；三组检查为 upstream_validity、
  plan_completeness、production_readiness。技术失败不产生 blocked 结论；执行环境离线只产生 amber warning，
  不阻止保存、预检、提交或批准审核。
- PlanReview 采用不可变审核记录 + 状态头 + 追加事件；passed/warning 不会自动 approved；同方案仅一个审核周期，
  changes_requested/revoked 后必须派生新方案，revoked 不恢复。审核决定支持相同命令安全回放，并始终返回
  当前服务端投影。读取/关键命令会重验上游与 capability/Evidence 快照，相关变化使预检 invalidated、
  批准 revoked；未进入权威快照的展示元数据不级联。
- memory/PostgreSQL repository、独立 migration、正式 API、异步 preflight worker 与 `/plan.html/css/js`
  已完成；A07 阶段 4 已变为真实链接；A09「创建生产工单」明确禁用且无假链接。
- 页面在草稿有未保存输入时禁用预检并提示先保存；切换商品、切换版本和刷新均通过保存/放弃/取消
  对话框保护本地输入。A07 仅在 runtime 明确启用 A08 时展示可点击视频方案入口。
- 当前自动验证：A08 service/API 定向 12 pass；PostgreSQL 16 clean migration/integration 1/1 实际通过；
  系统 Chrome 中 A07 回归与 A08 1440/390 页面合同 2/2 实际通过；全量 724 tests / 690 pass /
  0 fail / 34 environment skips；`npm run check` 142 文件通过。全量命令中的浏览器/数据库用例仍按
  环境条件 skip，但已分别在可用环境定向实跑通过。
- 最终独立 Reviewer 结论为 **`APPROVED`**，无剩余 Critical/Important。首轮发现的审核决定回放、
  capability/Evidence 失效传播、未保存输入保护与 feature flag 入口问题均已按 TDD 修复；初始 DOM
  在 runtime 返回前也不会暴露 A08 链接。
- 本轮未访问 Hifly、未调用真实 Provider/外部生产、未运行 `MULTI-002`、未消耗积分。

## VSA-A07 已合并快照（Issue #63）

- A06 已通过 PR #81 合并并关闭 Issue #62；A07/A08 Kimi 设计已通过 PR #82 合并；A07 已通过
  PR #83 合并并关闭 Issue #63。
- 已交付 existing-only 公共/企业目录；Phase 1 受控预置显式标记；不连接真实 Hifly、不提供人物/
  声音/背景创建、不宣称推荐。未知能力不投影 supported，只有带 Evidence 的 verified capability 展示。
- AvatarAsset、AvatarAssetVersion、AvatarVerifiedCapability、AvatarSelection 已有正式 memory/PostgreSQL
  repository 与独立 migration；选择事实/事件历史保留，状态为 draft→confirmed→superseded。
- member/admin 可浏览和显式确认；A06 current effective approved copy、资产、授权/有效期、Evidence、
  Organization 范围与素材访问由服务端确认 gate 权威重验。expired/incomplete/unknown/cross-org 均阻断。
- 相同 key+payload 回放、冲突 payload 拒绝；商品级 `selection_revision` 防静默覆盖。更换创建新选择，
  旧选择 superseded retained。上游批准后续失效通过读取/下游 gate 动态投影 current_valid=false，历史不改写。
- 独立 Reviewer 首轮两项 Important 已按 TDD 最小修复：receipt 重放返回完整首次业务结果，不再把旧选择/
  revision 与最新 history 拼接；workspace 在 copy query 缺省时按 product 解析 current effective approved copy，
  返回 resolved id，前端商品切换后恢复 URL/状态并可继续确认。最终独立复审 `APPROVED`，无剩余
  Critical/Important。
- 正式 API 与 `/avatar.html/css/js` 已完成；桌面 288/弹性/384 三栏、390 单栏/目录 Dialog、门禁、
  禁用原因、确认/更换 Dialog 与历史；`copy.html` 阶段 3 为真实链接；A08 保持禁用且无假页面。
- Reviewer 前 service/API 实际为 11 pass；修复回归加入后为 14 pass。PostgreSQL 16 clean integration
  1/1 实际通过；全量 710 tests / 678 pass / 0 fail / 32 environment skips；`npm run check` 133 files；
  `git diff --check` 通过。
- 主控使用系统 Chrome 实跑 browser flow 1/1，覆盖 1440/390、确认/更换/刷新/历史、未知能力、
  商品切换恢复对应批准文案、无横向溢出及 A08 禁用边界。
- 本轮未访问 Hifly、未发送真实业务 HTTP、未调用真实 Provider、未运行 `MULTI-002`、未消耗积分。

## VSA-A06 已合并快照（Issue #62）

- PR #81 已合并，Issue #62 已关闭，合并提交 `517654c`。
- 已交付独立 HumanReview、不可变审核周期、append-only transition/event、memory/PostgreSQL、正式 API、
  审计、主动/读取失效协调与 current effective approved-copy gate；最终独立 Review 为 `APPROVED`。
- 系统 Chrome 1440/390 与 PostgreSQL 16 clean integration 均实际通过；详细证据见
  `docs/status/sessions/2026-08-07-vsa-a06-copy-review.md`。该轮未访问 Hifly、未消耗积分。

## VSA-A05 已合并快照（Issue #61）

- A04 已通过 PR #79 合并，Issue #60 已关闭；A05 后续通过 PR #80 合并，Issue #61 已关闭。
- A05 已实现服务端权威 QC policy、current/ready ProductRevision 门禁、异步 QualityRun、不可变
  QualityResult/QualityFinding、D-028 Finding 结构字段、逐条 Resolution，以及持久化 RewriteJob
  驱动的新版本与自动完整 QC。
- memory/PostgreSQL repository、独立 migration、正式 API 与 `/copy.html` 质检右栏均已完成；
  A06 审核操作未提前实现，passed 明确不等于 approved。
- Terra/High 最终复审追加四项 Important。实现者已按 TDD 完成 current ProductRevision 正式门禁、
  已完成 Result 的当前有效性投影、Finding 完整性校验及 AI 改写 Dialog 双击幂等；复审结论为
  **`APPROVED`**，无剩余 Critical/Important。
- D-025 policy/事实漂移均不会改写历史 Result：API 动态投影 `current_valid` 与受控失效原因，UI 以
  amber 阻断；失效 Finding 只读展示且不再提供处理动作。child draft 成为 current 后，旧 ready
  revision 在 freeze 前即被拒绝。
- Rewrite worker 在 Provider 调用前后均复核 current revision；运行期间事实变化不会遗留 stale
  CopyVersion，Job 以稳定 stale 错误失败。
- 当前全量无积分自验：673 tests / 644 pass / 0 fail / 29 environment skips；`npm run check`
  119 文件。系统 Chrome 1440/390 流程 1/1、PostgreSQL 16 clean migration/integration 1/1；
  最终截图在仓库外 `/private/tmp/hifly-a05-final-visual-qa/`。
- PR #80 已合并到 `main`，提交为 `0a1fa9c`。该轮未访问 Hifly、未执行真实外部生成、未消耗积分。

## VSA-A04 已合并快照（Issue #60）

- Kimi Code 已使用 `kimi-code/k3` 完成 A04-A06 页面级设计，批准文档为
  `docs/frontend/VSA-A04-A06_UIUX_DESIGN.md`；未发现 `DESIGN_BLOCKER`。
- A04 已在独立分支 `codex/vsa-a04-copy-generation` 实现 Provider-neutral 异步文案生成、
  CopyVersion 历史、幂等、安全重试、租约恢复、冻结后派生、组织隔离、PostgreSQL migration、
  正式 API 与独立 `/copy.html` 工作区。
- A05 QC 与 A06 人工审核没有提前实现；Phase 1 受控生成器不是真实模型或飞影接入。
- 真实系统 Chrome 已通过生成失败/重试、离开后恢复、冻结历史、派生新草稿、409 冲突恢复和
  390px 无横向溢出流程。桌面与移动截图保存在仓库外 `/private/tmp/hifly-a04-visual-qa/`。
- 最终验证：全量 641 tests / 614 pass / 0 fail / 27 environment skips；系统 Chrome A04 1/1；
  PostgreSQL 16 clean migration 1/1；`npm run check` 108 文件；`git diff --check` 通过。
- 独立 Reviewer 首轮发现 390px 失败态缺少重试入口；已补移动版本抽屉重试并将真实浏览器流程改为
  移动端失败后完成重试，复审结论 `APPROVED`，无剩余 Blocker/Important。
- PR #79 已合并，Issue #60 已关闭；合并提交为 `2484197`。
- 本轮未访问 Hifly、未执行真实外部生成、未消耗积分。

## Kimi K3 前端视觉升级策划（2026-08-06）

- 已建立独立规划文件 `docs/frontend/KIMI_K3_FRONTEND_VISUAL_UPGRADE_PLAN.md`，采用 Stage 0 方向确认、Stage 1 基础层、Stage 2 随 VSA 增量落地、Stage 3 全链路收尾的节奏。
- 已建立 Claude 对接提示词 `docs/prompts/CLAUDE_KIMI_K3_FRONTEND_HANDOFF.md`；Claude 只协调 Stage 0 与业务复核，Kimi K3 只负责设计，Owner 批准 Stage 1 后由 Codex 实施代码、测试和 Git 交付。
- Kimi Code `0.33.0` 已通过 `kimi-code/k3` 完成 Stage 0 真实审计；完整结果存入 `docs/frontend/KIMI_K3_STAGE0_VISUAL_AUDIT.md`。
- Owner 已批准“冷中性灰 + 品牌蓝 `#1769e0`”方向，并要求动效简约、高级、丝滑；动效只服务保存、上传、状态切换、抽屉和对话框等真实反馈。
- Owner 已授权单独建立 Stage 1 Frontend Foundation Issue；后续由 Codex 实施、测试，并交给独立 Reviewer 审查。
- 未实现的首页、生产任务、作品库不得进入代码导航；遗留 `index.html` 继续作为运维兜底页，不作为企业一级导航。
- 本轮未访问 Hifly、未发送真实外部 HTTP、未消耗积分。

## Frontend Foundation Stage 1（Issue #77）

- 状态：Codex 已完成本地实现、视觉验收与独立 Review；Review 结论 `APPROVED`，无剩余 blocker/important；ready PR #78 已创建。
- 分支/worktree：`codex/frontend-foundation-stage1` / `/private/tmp/hifly-frontend-foundation-stage1`。
- 已覆盖登录、项目、商品快照、素材中心、成员管理；共享导航只含已实现入口，遗留 `index.html` 未改。
- 验证：628 tests / 624 pass / 0 fail / 4 environment skips；桌面与 390px 截图位于仓库外 `/private/tmp/hifly-stage1-visual-qa/`。
- 下一步：等待 PR #78 CI 与 Owner 合并授权；未经 Owner 单独授权不合并、不关闭 Issue #77。
- 本轮未访问 Hifly、未运行真实生成、未消耗积分。

## VSA-A02 已合并快照

- Issue #58 已完成并关闭；PR #74 已在最终 diff 审查和三组 CI 全绿后合并，`main` 提交为 `5e8b28a`。
- 已交付 Project/Product/ProductRevision memory/PostgreSQL 持久化、独立 `project_content_schema_migrations`、service/API、最小 UI、审计、幂等、乐观并发与下游 ready snapshot port。
- ready 只通过 A03 `assetReferencePort` 绑定 available 商品图片，并复用同一 transaction client；PostgreSQL 16 rollback 测试通过。
- 系统 Chrome 已完成创建项目、创建商品、保存卖点、逐条确认、选择图片、Ready、刷新恢复与重复 Ready 禁用流程。
- 默认 feature disabled，旧 Playwright workbench 回归通过；完整套件 627 tests / 603 passed / 24 environment-conditional skips / 0 failed，A02 PostgreSQL 16 与系统 Chrome 定向测试另行实际通过且无 skip。
- 独立 Reviewer 首轮发现相同 Ready 快照会派生重复 child revision；TDD 修复后复审 `APPROVED`，无 Blocker/Important。
- PR #74 最终分支 CI run `31083604483` 与合并后 `main` CI run `31084194959` 均通过 Ubuntu、Windows、identity/PostgreSQL 三项检查。
- 未访问 Hifly、未发送真实外部 HTTP、未消耗积分。
- 详细证据见 `docs/status/sessions/2026-08-06-vsa-a02-project-content.md` 和 `docs/project-content/VSA-A02.md`。

## VSA-A03 已合并快照

- Issue #59 已完成并关闭；PR #73 已在 CI 全绿后以仓库允许的 squash 方式合并，`main` 提交为 `78a8fc3`。
- A03 使用独立 `asset_schema_migrations`，与 A01 共用 PostgreSQL 连接但不进入 identity migration ledger。
- 已交付资产 API、核验状态机、可恢复 verification job、生产 PostgreSQL/memory repositories、
  local development ObjectStore、素材中心 UI 和唯一 A02 `assetReferencePort`。
- PostgreSQL 16 clean migration/integration 已通过；未访问飞影、未消耗积分、未宣称 COS 已接入。
- 详细证据见 `docs/status/sessions/2026-08-06-vsa-a03-assets.md` 和 `docs/assets/VSA-A03.md`。

## 当前开发

- VSA-A01 / Issue #57 已完成，PR #71 已合并，Issue #57 已关闭。
- 合并提交：`82d1c9f5075098559306f4a72eebbeaa79ed1959`。
- A01 独立 Review 结论为 `APPROVED`；最终 CI run `31072997173` 的 Ubuntu、Windows、PostgreSQL identity 三项均通过。
- A01 已实现 PostgreSQL 权威身份库、工作邮箱登录、首次强制改密、单 Organization 上下文、退出、disabled 每请求失效，以及管理员成员管理。
- A02 / Issue #58 与 A03 / Issue #59 均已合并并关闭；A02 ready 通过唯一 `assetReferencePort` 绑定 available AssetVersion，Wave 2 已完成。
- A02 实施 Agent 使用 GPT-5.6 Sol / Medium；独立 Reviewer 使用 GPT-5.6 Terra / High。

## 当前治理

- 产品定位、D-025～D-030、A01～A14 边界和 Issues 已存在，不重复规划或创建。
- `GOAL.md` 是 Goal 级快照；`docs/agent-collaboration.md` 记录角色、权限、交接和 Review。
- 当前新增功能主线是 Slice A；旧 GUI/Playwright 是兼容基线和运维兜底。
- 工程审查遵守“真实核心风险优先、禁止过度防御、Rubric 不机械化”。
- 治理文档 PR #72 已合并。

## 当前生产路径与积分

- 默认历史批量生产路径：Playwright 浏览器自动化。
- Capture HTTP：默认关闭，仅作为实验/恢复能力。
- 当前没有真实飞影执行授权，不得执行 `MULTI-002`。
- 本轮治理和 VSA-A01 开发均未访问飞影、未消耗积分。

## 关键历史批次

| 批次 ID | 状态 | 说明 |
|---|---|---|
| `batch-ec174f28-e9b8-4541-b2e7-c60b10e22474` | `real_batch_completed` | MULTI-001 完成；MULTI-002 pending |
| `batch-bdbf3cec-24d1-4bef-b1db-95775b357f1f` | 混合态 | 历史 GUI 排障样本，不重跑 |

## 已知问题与风险

1. Issue #37 的 Windows capture `interrupted_unknown` 具体写入者仍未定位；与 Slice A 独立。
2. Q-018 仍为 Pending Evidence / Open；HIFLY-001 与 SPK-018 未执行，不阻塞 Slice A 人工闭环。
3. A01 登录限流当前为单进程最小实现，多实例生产前需共享网关或数据库策略。
4. 仓库依赖审计存在既有告警，跨主版本修复需独立回归，不搭车进入后续 Slice。

## 下一步

1. 主控对 A10 worktree 做独立 Review，随后自行 commit、push、创建 PR 并等待 CI；实现者不批准或合并自己的 PR。
2. PostgreSQL clean migration/integration 在带测试数据库的 CI 或受控环境执行；本地缺少连接时保持明确 skip。
3. A10 合并后再按既有边界进入 A11-A13 设计与实现；本 worktree 不实现 A11+。
