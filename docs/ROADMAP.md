# 项目 Roadmap

> 最后更新：2026-08-03

## v0.2 Local Stable

目标：本地生产链路稳定可靠，CI 自动门禁，PR 独立可合并。

- [x] CI quality gates (GitHub Actions, cross-platform)
- [x] PR 治理（独立分支、无搭车合并）
- [ ] Batch schema version 与 migrations (CORE-001)
- [ ] Crash-recovery fault-injection tests (CORE-002)
- [ ] Stale execution-lock recovery 改进 (CORE-003)
- [ ] Portable-path API 边界加固 (CORE-004 / Issue #33，PR 待审查)
- [ ] Structured redacted diagnostics (OBS-001)
- [ ] GUI 稳定性与错误状态优化 (UX-001)
- [x] PR #15 视觉确认合并
- [x] Windows capture completion / filesystem stability hardening (CI-002 / PR #38)

## v0.3 Production Pilot

目标：小批量真实生产验证，成本可控，SOP 可执行。

- [ ] 人物策略实验 (EXP-001)：飞影推荐 vs 自有人物池
- [ ] 小批量验收（10-20 SKU/批）
- [ ] 成本记录与积分核对流程
- [ ] 运营 SOP 完善
- [ ] 真实失败恢复演练

## v1.0 Cloud Control Plane

目标：云端控制面 + 本地/VPS 执行 Agent 架构落地。

- [ ] 控制面设计 (ARCH-001)
- [ ] Agent 协议（任务拉取、心跳、结果上传）
- [ ] 数据库选型与 schema
- [ ] 对象存储（视频产物）
- [ ] 多执行节点协调
- [ ] Web GUI 云端部署

## 依赖关系

```
v0.2 CI ──→ v0.2 schema ──→ v0.3 小批量
                            ↗
v0.2 fault-injection ──────┘
v0.3 人物实验 ──→ v0.3 SOP
v0.3 成本记录 ──→ v1.0 控制面
```
