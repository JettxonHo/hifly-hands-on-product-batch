# 项目 Roadmap

> 最后更新：2026-08-09
> 当前状态：Vertical Slice A 已完成；进入腾讯云试运行准备

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

- Development Issues #57～#70 已全部完成并关闭；A01-A14 已进入 `main`。
- PR #97 已合并，提供隔离、无积分的一键 A01-A14 本地演示入口。
- 该里程碑证明企业业务闭环和页面链路可运行，不代表真实 Provider、飞影执行链和云端生产已经交付。

## 2. 旧本地生产链路：维护基线

- GUI 单条/批量录入、失败重试、Playwright 生产链路与 Capture HTTP 实验能力已有历史验证。
- Batch schema version/migrations（CORE-001 / PR #41）已合并；portable path（CORE-004）与 CI 稳定化已合并。
- Issue #37 Windows capture `interrupted_unknown` 根因仍开放；本轮 VSA 不扩大处理。
- MULTI-002 保持 pending，未获新积分授权不得执行。

## 3. 当前阶段：云端试运行准备

1. 建立 Linux 生产入口、环境变量配置、容器、HTTPS、健康检查和显式 migration。
2. 在腾讯云 2C4G 上完成无积分端到端与资源基准。
3. 接入真实 Provider 与腾讯云 COS；正式客户生产时优先使用托管 PostgreSQL。
4. 经单独积分授权后，才执行 1 条真实飞影链路验收。

部署设计见 `docs/deployment/TENCENT_CLOUD_2C4G_DEPLOYMENT_DESIGN.md`。

## 4. Slice A 之后的产品能力

- HIFLY-001、SPK-018：继续 Evidence/能力验证，不是 Slice A 完成条件；Q-018 已由 D-032 关闭。
- Local Agent 与自动 Provider 执行：按 D-032 的双执行路径，在各 capability Evidence 明确后逐项接入。
- Cloud 正式部署、企业增强、多 Provider、发布与数据复盘：依据 `docs/product/DELIVERY_ROADMAP.md` 分阶段实施。

## 5. 进入下一波次的门禁

1. 前置 Issue 已合并并通过 CI。
2. `docs/status/CURRENT.md`、Goal 与相关产品文档一致。
3. 下一 Issue 合同完整，Migration/公共接口/并行文件边界已确认。
4. 没有需要人工确认的身份、权限、生产数据、不可逆 Migration、Secret 或真实积分风险。
5. 实现与最终审查由独立 Agent/线程承担。
