# 当前 Goal：Vertical Slice A 企业内容生产人工闭环

> 状态：A14_IMPLEMENTATION_VALIDATED（本地验收完成，待 PR/CI 与 Owner 合并授权）
> Owner：JettxonHo
> 最后更新：2026-08-09
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
- 当前阶段：A01～A13 均已合并并关闭对应 Issue；A14 的 Kimi K3 UX 审计已通过 PR #93 合并，
  实现与本地独立验收已完成，当前等待实现 PR、CI 与 Owner 合并授权。
- 非目标：真实 Hifly 接入、Local Agent 自动执行、Playwright/影刀作为新 SaaS 主流程、SSO/MFA、多 Organization 切换、完整 RBAC、自动发布和客户计费。
- 旧本地 GUI/Playwright 链路保持兼容，不作为 Slice A 完成条件。
- Q-018、HIFLY-001、SPK-018 继续按 Evidence 管理，不因 Slice A 测试替身而关闭。

## 里程碑与依赖

| 波次 | Issue | 结果 | 状态 |
|---|---|---|---|
| 1 | A01 / #57 | 企业身份与单 Organization 上下文 | 已合并，Issue 已关闭 |
| 2 | A02 / #58 ‖ A03 / #59 | 商品权威快照 ‖ 素材上传核验 | 已合并，Issues 已关闭，Wave 2 验收通过 |
| 3-5 | A04 / #60、A05 / #61、A06 / #62、A07 / #63 | 文案生成、质检、批准与已有人物选择 | 已合并，Issues 已关闭 |
| 6-8 | A08 / #64、A09 / #65、A10 / #66 | 方案、工单与人工交接包 | 已合并，Issues 已关闭 |
| 9-11 | A11 / #67、A12 / #68、A13 / #69 | 人工执行、产物核验、作品交付 | 已合并，Issues 已关闭；A13 PR #91 CI 全绿 |
| 12 | A14 / #70 | Slice A 端到端验收与加固 | 本地实现与验收完成；待 PR/CI/合并 |

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

A14 已由 Owner 明确启动。Kimi K3 审计设计已合并，实现分支已完成一条从全新企业登录、空项目到
Work 检查与交付的浏览器主路径，并完成有界集成缺陷修复。

1. 提交并推送 A14 实现，创建 ready PR，等待 CI。
2. Sol 完成 PR diff/CI 复核；A14 合并不在 A04～A13 的预授权范围，合并前需 Owner 明确授权。
3. 合并后关闭 Issue #70，更新 Goal 为最终结论并完成 Vertical Slice A 收尾。
4. 任何真实 Hifly/Provider/Capture HTTP 与积分执行仍需单独明确授权。
