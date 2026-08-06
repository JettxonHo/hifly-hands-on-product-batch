# 项目当前状态

> 最后更新：2026-08-06
> 当前远端 main：`9c18859`（D-030 / PR #56）
> 当前 Goal：Vertical Slice A

## 当前开发

- 当前里程碑：Wave 1，VSA-A01 / Issue #57。
- 实现分支：`feat/vsa-a01-enterprise-identity`。
- 独立 worktree：`/Users/ketchup/Documents/hifly-vsa-a01-identity-dse`。
- 状态：PostgreSQL 身份实现与本地无积分验证已完成，尚未 commit/push/创建 PR，正在独立审查。
- 当前 GitHub 无开放 PR；#57～#70 均为 Open，A02 及以后尚未开始。
- 实现 Agent 请求配置：GPT-5.6 Sol / Medium（用户明确指定，作为 Luna 槽位替代）；运行时状态 `UNVERIFIED_RUNTIME_MODEL`。
- 最终审查请求配置：ORCHESTRATOR_REVIEWER + 独立 Reviewer；运行时状态 `UNVERIFIED_RUNTIME_MODEL`。最终批准必须与实现上下文独立。

## 当前治理

- 产品定位、D-025～D-030、A01～A14 边界和 Issues 已存在，不重复规划或创建。
- `GOAL.md` 是 Goal 级快照；`docs/agent-collaboration.md` 记录角色、权限、交接和 Review。
- 当前新增功能主线是 Slice A；旧 GUI/Playwright 是兼容基线和运维兜底。
- 工程审查遵守“真实核心风险优先、禁止过度防御、Rubric 不机械化”。

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

1. Issue #37 的 Windows capture `interrupted_unknown` 具体写入者仍未定位；与 A01 独立。
2. Q-018 仍为 Pending Evidence / Open；HIFLY-001 与 SPK-018 未执行，不阻塞 Slice A 人工闭环。
3. A01 登录限流当前为单进程最小实现，多实例生产前需共享网关或数据库策略。
4. 仓库依赖审计存在既有告警，跨主版本修复需独立回归，不搭车进入 A01。

## 下一步

1. 完成 A01 独立 Review，只修复真实 blocker/important。
2. 运行 PostgreSQL clean migration、浏览器 smoke、全量测试与 CI。
3. 创建关联 #57 的独立 PR；未获单独授权前不合并、不关闭 #57、不开始 A02。
4. A01 合并后重新确认 A02/A03 的共享 Migration 与接口边界，再分配实现 Agent。
