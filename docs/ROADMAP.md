# 项目 Roadmap

> 最后更新：2026-08-06
> 当前正式 Goal：Vertical Slice A（详见 `GOAL.md` 与 D-030）

## 1. 当前交付：Vertical Slice A

```text
Wave 1  A01 企业身份与 Organization 上下文
Wave 2  A02 商品权威快照 ‖ A03 素材上传核验
Wave 3  A04 文案生成 ‖ A07 已有人物目录基础
Wave 4  A05 文案质检 ‖ A07 人物确认
Wave 5  A06 文案人工审核
Wave 6  A08 VideoPlan / Preflight / PlanReview
Wave 7  A09 ProductionOrder
Wave 8  A10 ManualHandoffPackage
Wave 9  A11 manual ExecutionAttempt / ManualExecutionReport
Wave 10 A12 候选产物核验 / Work
Wave 11 A13 WorkInspection / DeliveryRecord
Wave 12 A14 端到端验收与加固
```

- Development Issues：#57～#70，均已创建。
- 当前：A01 / #57 已获实现授权，独立 worktree 中完成首版，等待独立 Review、PR 和 CI。
- A01 阻塞所有需要身份/Organization 上下文的后续 Issue。
- A02 与 A03 仅在 A01 合并后并行；A02 的 ProductRevision ready 完整验收依赖 A03。
- A14 只做串联、回归和小型加固，不接收 A01～A13 遗漏的主要能力。

## 2. 旧本地生产链路：维护基线

- GUI 单条/批量录入、失败重试、Playwright 生产链路与 Capture HTTP 实验能力已有历史验证。
- Batch schema version/migrations（CORE-001 / PR #41）已合并；portable path（CORE-004）与 CI 稳定化已合并。
- Issue #37 Windows capture `interrupted_unknown` 根因仍开放；本轮 VSA 不扩大处理。
- MULTI-002 保持 pending，未获新积分授权不得执行。

## 3. Slice A 之后

- HIFLY-001、Q-018、SPK-018：继续 Evidence/能力验证，不是 Slice A 完成条件。
- Local Agent 与自动 Provider 执行：在凭据边界和 Evidence 明确后进入后续阶段。
- Cloud 正式部署、企业增强、多 Provider、发布与数据复盘：依据 `docs/product/DELIVERY_ROADMAP.md` 分阶段实施。

## 4. 进入下一波次的门禁

1. 前置 Issue 已合并并通过 CI。
2. `docs/status/CURRENT.md`、Goal 与相关产品文档一致。
3. 下一 Issue 合同完整，Migration/公共接口/并行文件边界已确认。
4. 没有需要人工确认的身份、权限、生产数据、不可逆 Migration、Secret 或真实积分风险。
5. 实现与最终审查由独立 Agent/线程承担。
