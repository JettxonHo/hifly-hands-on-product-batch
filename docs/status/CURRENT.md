# 项目当前状态

> 最后更新：2026-08-07
> 当前远端 main：`0a1fa9c`（VSA-A05 已合并）
> 当前 Goal：Vertical Slice A

## VSA-A06 当前开发（Issue #62）

- A05 已通过 PR #80 合并；A06 在独立 worktree `/private/tmp/hifly-vsa-a06`、分支
  `codex/vsa-a06-copy-review` 完成实现与最终独立审查，尚未 commit/push/建 PR。
- 已实现独立 HumanReview、不可变审核周期、append-only transition/event、mutable head/row_version、
  memory/PostgreSQL repository、独立 migration、正式 API、审计与 current approved gate。
- member 可提交/查看；admin 决策；self-review 明确记录。批准重新验证 CopyVersion、QualityResult、
  effective conclusion、ProductRevision、profile/rule；passed 不等于 approved。
- 相关商品事实、文案替代、QC policy/result 变化会在服务端读取/命令时持久化 revoked；展示名等
  无关元数据不撤销；revoked 不恢复，重新审核创建新 HumanReview。
- 独立审查问题已按 TDD 修复：receipt 回放先于动态 gate；相关 ProductRevision/CopyVersion/QC
  命令通过最小显式 coordinator 主动失效；批准 transition 后、返回前做最终权威 recheck，竞态结果
  会持久化 revoked。读取与未来下游 gate 仍每次重验。
- 第二轮最终审查 Important 已修复：若 final gate 仍有效但返回 projection 再次发现变化，该自动撤销
  同样更新批准 receipt；首次结果与同 key 回放均为 revoked，撤销事件只追加一次。
- `/copy.html` 已加入质检/审核 tabs、门禁列表、Dialogs、权限只读、失效阻断和历史；A07 只显示
  禁用说明。系统 Chrome 1440/390 流程通过，截图在仓库外 `/private/tmp/hifly-a06-visual-qa/`。
- PostgreSQL 16.14 clean migration/integration 1/1 通过；全量 694 tests / 664 pass / 0 fail /
  30 environment skips，`npm run check` 检查 126 个 JavaScript 文件；详细证据见
  `docs/status/sessions/2026-08-07-vsa-a06-copy-review.md`。
- 最终独立 Reviewer 结论为 **`APPROVED`**，无剩余 Critical/Important。主控另行实际通过
  PostgreSQL 16 clean integration 与系统 Chrome 1440/390 验收。
- 本轮未访问 Hifly、未调用真实模型、未消耗积分。下一步是 commit、PR、CI 与合并。

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

1. A05 最终独立复审已 `APPROVED`；主控正在完成 commit、PR、CI 与合并交付。
2. 用户已授权 A04-A13 在各自审查与 CI 通过后合并；A05 合并前不开始 A06 实施。
3. A06 继续复用 Kimi K3 已批准的 A04-A06 UI/UX 设计，不把 QC passed 当 approved。
4. 每个里程碑结束时更新本文件与 `GOAL.md`。
