# 当前 Goal：Vertical Slice A 企业内容生产人工闭环

> 状态：IN_PROGRESS（Owner 已于 2026-08-08 明确恢复执行）
> Owner：JettxonHo
> 最后更新：2026-08-08
> 权威规划：`docs/product/VERTICAL_SLICE_A_DELIVERY_PLAN.md`（D-030）

## 最终目标

在不依赖真实 Hifly 自动执行的前提下，交付一条可审计、可恢复、具备 Organization 隔离的企业内容生产人工闭环：

```text
企业登录 → 项目与商品事实 → 文案生成/质检/批准 → 已有人物选择
→ VideoPlan/Preflight/批准 → ProductionOrder → 人工交接包
→ manual ExecutionAttempt/报告 → 候选产物核验 → Work → 检查与交付记录
```

## 当前范围与非目标

- 当前范围：D-030 的 VSA-A01～A14，对应 GitHub Issues #57～#70。
- 当前阶段：VSA-A04～A08 已合并并关闭，A09-A10 页面设计已合并（main `1afac0b`）。A09 Issue #65 已通过
  PR #86 合并；A10 Issue #66 已在 `/private/tmp/hifly-vsa-a10`、分支 `codex/vsa-a10-manual-handoff` 完成本地实现、Review 修复、真实链路/定向测试与桌面/移动视觉验收，等待主控独立 Review/PR/CI；A11+ 未开始。
- 非目标：真实 Hifly 接入、Local Agent 自动执行、Playwright/影刀作为新 SaaS 主流程、SSO/MFA、多 Organization 切换、完整 RBAC、自动发布和客户计费。
- 旧本地 GUI/Playwright 链路保持兼容，不作为 Slice A 完成条件。
- Q-018、HIFLY-001、SPK-018 继续按 Evidence 管理，不因 Slice A 测试替身而关闭。

## 里程碑与依赖

| 波次 | Issue | 结果 | 状态 |
|---|---|---|---|
| 1 | A01 / #57 | 企业身份与单 Organization 上下文 | 已合并，Issue 已关闭 |
| 2 | A02 / #58 ‖ A03 / #59 | 商品权威快照 ‖ 素材上传核验 | 已合并，Issues 已关闭，Wave 2 验收通过 |
| 3-5 | A04 / #60、A05 / #61、A06 / #62、A07 / #63 | 文案生成、质检、批准与已有人物选择 | 已合并，Issues 已关闭 |
| 6-8 | A08 / #64、A09 / #65、A10 / #66 | 方案、工单与人工交接包 | A08、A09 已合并并关闭；A10 本地实现与定向验收通过，待独立 Review/PR/CI |
| 9-11 | A11 / #67、A12 / #68、A13 / #69 | 人工执行、产物核验、作品交付 | 等待前置 |
| 12 | A14 / #70 | Slice A 端到端验收与加固 | 等待 A01～A13 |

详细依赖、对象边界和每项 DoD 以 D-030 与对应 GitHub Issue 为准；本文件只维护 Goal 级快照，不复制全部规范。

## 完成标准

1. #57～#70 的业务结果均通过正式 UI 或服务 API 可达，且各自独立 Review、测试和 CI 通过。
2. 完整主路径不需要直接改数据库、不依赖未合并分支、不冒充 Hifly/Local Agent 能力。
3. Organization 隔离、权限、不可变历史、幂等、并发、失败恢复和审计满足 D-030 的 Slice 级反向测试。
4. 全新测试 Organization 的端到端验收通过，文档与 Evidence 状态一致。
5. Goal 级 Review 给出 `GOAL_APPROVED` 或 `GOAL_APPROVED_WITH_FOLLOW_UPS`。

## 主要风险与人工确认条件

- 身份/权限逻辑、不可逆 Migration、生产数据、真实 Secret、真实 Hifly 积分、主要技术栈或产品方向变更必须人工确认。
- A02/A03 后可能出现共享数据库 Migration 冲突；并行前必须固定表归属与合并顺序。
- Q-018 未决，禁止把 Hifly Token/Cookie/Profile 迁移到云端设计中。
- 不进行攻防论文式过度防御；只有真实核心风险阻塞合并，低概率非核心风险记录后续项。

## 下一步

Owner 已明确恢复执行。A09-A10 Kimi 设计已完成并合并；A09 已合并，A10 本地实现与 Review 修复、定向验收已完成，当前等待主控独立 Review/PR/CI。

1. 由主控对 A10 独立 Review 后提交、创建 PR 并等待 CI；实现者不得批准或合并自己的改动。
2. PostgreSQL clean migration/integration 在 CI 或带连接的受控环境补跑；本地无数据库连接时不得声称通过。
3. A10 合并后先由 Kimi K3 完成 A11-A13 页面设计，再按同一流程依次实现；不开始 A14。
4. 每个里程碑结束时更新本文件与 `docs/status/CURRENT.md`。
