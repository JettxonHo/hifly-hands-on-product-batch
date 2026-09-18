# 当前 Goal：RBV-001 Real Batch Production Validation

> Goal ID：`RBV-GOAL-001`
> 状态：`CALIBRATION_READINESS_FREEZE_BLOCKED_PRE_REAL_RUN`
> 当前只激活：`Readiness Freeze`
> Stage 1「合同与人工门禁」：已完成历史（Issue #259 / PR #260）
> 产品决策：[D-037](docs/product/DECISION_LOG.md#d-037-real-batch-production-validation)
> 执行合同：[Real Batch Production Validation Pilot Contract](docs/product/REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md)
> 当前记录：[RBV-CAL-001 Calibration Readiness Freeze](docs/status/RBV_CALIBRATION_READINESS_FREEZE.md)
> 上一 Goal 历史归档：[P0 Cloud Executor Goal（2026-08-13）](docs/status/archive/GOAL-cloud-executor-p0-complete-2026-08-13.md)

## 目标

建立一条可审计、可重复、费用受控的真实批次生产验证路径，用于判断当前最小业务闭环（MBL）是否具备真实运营证据。本轮只冻结 Calibration Readiness，不运行真实批次；本文件是唯一现行 Goal，不能把文档、测试或代码完成写成 MBL/RBV 完成。

## Readiness Freeze 边界（Issue #261）

- 以 D-037 和 Pilot Contract 为唯一产品方向与执行合同。
- 只冻结 `RBV-CAL-001` 的 5 SKU roster、商品事实/素材元数据、权利与内部许可、候选人物、Provider 输入、预算、窗口、证据 alias 和 Stop Rules。
- 五个 SKU 当前均为 `BLOCKED`；唯一 verdict 为 `BLOCKED_PRE_REAL_RUN`。未核验网页图片许可、测试 fixture 名称/卖点、预制 revision、人物内部上传许可及真实上游 readiness 均不得升级为 Ready。
- Calibration 运行、真实 Provider/飞影访问、登录、上传/生成/提交/下载、生产部署、公开发布和任何积分消耗均未授权，保持 fail-closed。现有 Playwright 直接人物+商品上传仅是工程基线，不是本轮授权。
- Repeatable Batch、并行生产、自动重试、通用 Agent、UI/API/数据库/Cloud Executor 修改均不属于本 Readiness Freeze。

## Stage 1 历史边界（已完成）

- Issue #259 / PR #260 已完成合同、治理测试与人工门禁；其 `STAGE_1_CONTRACT_PENDING_OWNER_GATE` 仅为历史状态，不是当前 active stage。
- Stage 1 的独立 Review/Owner Gate 规则继续约束本轮；文档、测试和代码不能宣布 MBL/RBV 完成。

## 必须满足的后续门禁

Pilot Contract 固定 Calibration 为 3–5 个真实或获许可脱敏商品、至少两个品类、至少一个需要人工修正，且不预设成功率；修复真实阻塞后 Repeatable 至少 10 个商品，成本不合理时停在 Owner Gate，不得自行缩样并宣称通过。至少一名非作者运营发起第二批，且至少一个真实视频实际交付、展示或用于运营；连续完成 5 个工单期间不得修改生产代码。

## 现行事实链

```text
GOAL.md (RBV-GOAL-001, Readiness Freeze)
  → docs/product/DECISION_LOG.md (D-037)
  → docs/product/REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md (Pilot Contract)
  → docs/status/RBV_CALIBRATION_READINESS_FREEZE.md (Issue #261 current record)
  → docs/status/CURRENT.md / docs/ROADMAP.md / docs/PROJECT_HANDOFF.md
```

下游文档只能引用这条链，不能创造 roster、成功率、成本、运行、发布或反馈事实。Stage 1 已在独立 Reviewer `APPROVED` 后完成历史；当前 Readiness Freeze 仍须经独立 Review 与 Owner Gate，未获得逐动作明确授权前不合并、不激活 Calibration。
