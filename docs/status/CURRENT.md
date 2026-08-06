# 项目当前状态

> 最后更新：2026-08-06
> 当前远端 main：`dd57a08`（VSA Wave 2 收尾已合并）
> 当前 Goal：Vertical Slice A

## Kimi K3 前端视觉升级策划（2026-08-06）

- 已建立独立规划文件 `docs/frontend/KIMI_K3_FRONTEND_VISUAL_UPGRADE_PLAN.md`，采用 Stage 0 方向确认、Stage 1 基础层、Stage 2 随 VSA 增量落地、Stage 3 全链路收尾的节奏。
- 已建立 Claude 对接提示词 `docs/prompts/CLAUDE_KIMI_K3_FRONTEND_HANDOFF.md`；Claude 只协调 Stage 0 与业务复核，Kimi K3 只负责设计，Owner 批准 Stage 1 后由 Codex 实施代码、测试和 Git 交付。
- Kimi Code `0.33.0` 已通过 `kimi-code/k3` 完成 Stage 0 真实审计；完整结果存入 `docs/frontend/KIMI_K3_STAGE0_VISUAL_AUDIT.md`。
- Owner 已批准“冷中性灰 + 品牌蓝 `#1769e0`”方向，并要求动效简约、高级、丝滑；动效只服务保存、上传、状态切换、抽屉和对话框等真实反馈。
- Owner 已授权单独建立 Stage 1 Frontend Foundation Issue；后续由 Codex 实施、测试，并交给独立 Reviewer 审查。
- 未实现的首页、生产任务、作品库不得进入代码导航；遗留 `index.html` 继续作为运维兜底页，不作为企业一级导航。
- 本轮未访问 Hifly、未发送真实外部 HTTP、未消耗积分。

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

1. Wave 2 已完成：PR #73/#74 已合并，Issue #58/#59 已关闭，`main` CI 全绿。
2. 未经用户建立下一阶段 Goal 与明确开发授权，不开始 A04 或其他后续 Issue。
3. 下一阶段开始前，从最新 `main` 创建新的独立 worktree/分支并重新确认范围。
4. 每个里程碑结束时更新本文件与 `GOAL.md`。
