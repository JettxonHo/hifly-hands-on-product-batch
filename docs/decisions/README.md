# 架构决策索引

本目录按创建时间保留架构决策编号。2026-07 的两项决策已经先占用
`ADR-001` 和 `ADR-002`；2026-08-01 的两项历史决策原先重复使用旧编号，
现统一为 `ADR-004` 和 `ADR-005`。正文保留原决策背景，并标注被 D-034
取代的关系。

| 编号 | 文件 | 主题 | 状态 |
|---|---|---|---|
| ADR-001 | [Playwright fallback until Capture HTTP is complete](ADR-001-playwright-fallback-capture-http-target.md) | Capture HTTP 完成前保留 Playwright fallback | Accepted |
| ADR-002 | [Gate Capture HTTP real client](ADR-002-capture-http-real-client-gates.md) | mock / dry-run / live 三段式真实客户端门禁 | Accepted |
| ADR-003 | [PostgreSQL identity store](ADR-003-vsa-a01-postgresql-identity.md) | VSA-A01 PostgreSQL 权威身份存储 | Accepted |
| ADR-004 | [本地优先执行架构](ADR-004-local-first-execution.md) | 2026-08-01 历史本地优先决策 | Superseded by D-034 |
| ADR-005 | [云控制面 + 执行 Agent 架构](ADR-005-cloud-control-plane-and-agent.md) | 2026-08-01 历史云控制面方向 | Superseded by D-034 |

D-034 是当前 Cloud Executor P0 的权威决策；实现状态和验收事实见
[`docs/product/CLOUD_EXECUTOR_P0.md`](../product/CLOUD_EXECUTOR_P0.md)、
[`GOAL.md`](../../GOAL.md) 与 [`docs/status/CURRENT.md`](../status/CURRENT.md)。
