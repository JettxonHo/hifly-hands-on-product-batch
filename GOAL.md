# 当前 Goal：RBV-001 Real Batch Production Validation

> Goal ID：`RBV-GOAL-001`
> 状态：`STAGE_1_CONTRACT_PENDING_OWNER_GATE`
> 当前只激活：Stage 1「合同与人工门禁」
> 产品决策：[D-037](docs/product/DECISION_LOG.md#d-037-real-batch-production-validation)
> 执行合同：[Real Batch Production Validation Pilot Contract](docs/product/REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md)
> 上一 Goal 历史归档：[P0 Cloud Executor Goal（2026-08-13）](docs/status/archive/GOAL-cloud-executor-p0-complete-2026-08-13.md)

## 目标

建立一条可审计、可重复、费用受控的真实批次生产验证路径，用于判断当前最小业务闭环（MBL）是否具备真实运营证据。当前阶段只建立合同、事实链和人工门禁；本文件是唯一现行 Goal，不能把文档、测试或代码完成写成 MBL/RBV 完成。

## Stage 1 边界

- 以 D-037 和 Pilot Contract 为唯一产品方向与执行合同。
- 只固化 Calibration roster、素材权利、非作者运营、成本上限、登录窗口、证据脱敏和后续 Owner Gate 的人工要求。
- Calibration 运行、真实 Provider/飞影访问、上传/生成/提交/下载、生产部署、公开发布和任何积分消耗均未授权，保持 fail-closed。
- Repeatable Batch、并行生产、自动重试、通用 Agent、UI/API/数据库/Cloud Executor 修改均不属于 Stage 1。

## 必须满足的后续门禁

Pilot Contract 固定 Calibration 为 3–5 个真实或获许可脱敏商品、至少两个品类、至少一个需要人工修正，且不预设成功率；修复真实阻塞后 Repeatable 至少 10 个商品，成本不合理时停在 Owner Gate，不得自行缩样并宣称通过。至少一名非作者运营发起第二批，且至少一个真实视频实际交付、展示或用于运营；连续完成 5 个工单期间不得修改生产代码。

## 现行事实链

```text
GOAL.md (RBV-GOAL-001, Stage 1)
  → docs/product/DECISION_LOG.md (D-037)
  → docs/product/REAL_BATCH_PRODUCTION_VALIDATION_PILOT.md (Pilot Contract)
  → docs/status/CURRENT.md / docs/ROADMAP.md / docs/PROJECT_HANDOFF.md
```

下游文档只能引用这条链，不能创造 roster、成功率、成本、运行、发布或反馈事实。Stage 1 结束条件是独立 Reviewer 给出 `APPROVED` 后，Draft PR 停止并等待 Owner Gate；未获得 Owner 明确授权前不合并、不激活 Calibration。
