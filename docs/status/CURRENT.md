# 项目当前状态

> 最后更新：2026-08-06
> 当前远端 main：`60ecaa2`（VSA-A01 + 多 Agent 治理文档）
> 当前 Goal：Vertical Slice A

## VSA-A02 独立分支快照

- `codex/vsa-a02-project-content` 基于 A03 完成提交 `547c843` 实现 Issue #58，主代理验证与独立 Review 已完成。
- 已交付 Project/Product/ProductRevision memory/PostgreSQL 持久化、独立 `project_content_schema_migrations`、service/API、最小 UI、审计、幂等、乐观并发与下游 ready snapshot port。
- ready 只通过 A03 `assetReferencePort` 绑定 available 商品图片，并复用同一 transaction client；PostgreSQL 16 rollback 测试通过。
- 系统 Chrome 已完成创建项目、创建商品、保存卖点、逐条确认、选择图片、Ready、刷新恢复与重复 Ready 禁用流程。
- 默认 feature disabled，旧 Playwright workbench 回归通过；完整套件 627 tests / 603 passed / 24 environment-conditional skips / 0 failed，A02 PostgreSQL 16 与系统 Chrome定向测试另行实际通过且无 skip。
- 独立 Reviewer 首轮发现相同 Ready 快照会派生重复 child revision；TDD 修复后复审 `APPROVED`，无 Blocker/Important。
- 未访问 Hifly、未发送真实外部 HTTP、未消耗积分。
- 详细证据见 `docs/status/sessions/2026-08-06-vsa-a02-project-content.md` 和 `docs/project-content/VSA-A02.md`。

## VSA-A03 独立分支快照

- `codex/vsa-a03-assets` 基于 `60ecaa2` 完成 Issue #59 TDD 实现与独立审查，Important 已修复；PR #73 CI 全绿，等待合并授权。
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
- A03 / Issue #59 已完成分支实现与本地验收；A02 / Issue #58 已在独立分支完成实现、验证与独立 Review，A02 ready 通过唯一 `assetReferencePort` 绑定 available AssetVersion。
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

1. A02 创建以 `codex/vsa-a03-assets` 为 base 的堆叠 PR并等待 CI。
2. 未经用户单独授权不合并 A03 PR #73 或 A02 PR，也不开始 A04。
3. A03 合并后将 A02 PR base 调整为 `main`，重跑最终 CI 与 diff 审查。
4. 每个里程碑结束时更新本文件与 `GOAL.md`。
