# 项目 Roadmap

> 最后更新：2026-08-13
> 当前状态：Vertical Slice A 已完成；唯一 P0 为 Cloud Control Plane + Cloud Executor 纯云端闭环

## 1. 已完成基线

- A01～A14 已完成企业登录、项目与商品、文案版本/QC/人工审核、人物选择、VideoPlan、ProductionOrder、交接包、执行报告、作品核验与交付。
- 阿里云 2C4G 内部试运行环境已部署。
- 历史单条真实工单曾通过 Mac Local Agent 完成闭环；该路径现仅为 legacy fallback，不再作为生产路径或当前验收依据。
- 官方 Hifly API Token 已完成只读积分连接验证；「手里有货」仍走 Playwright。
- Cloud Executor CE-01～CE-07 已实现并部署；disabled/fail-closed standby 的 heartbeat、持久目录、重启恢复、无 claim/无新增 attempt 已在阿里云实证。

## 2. 当前升级顺序

```text
P0.1  云端飞影登录并证明 Profile 重启保留
P0.2  激活单实例 Cloud Executor（playwright / concurrency=1）
P0.3  CE-08 一条纯云端真实闭环：Cloud GUI → Hifly → A12 → Work → 鉴权下载
P0.4  CE-08 成功后再做 3 条严格串行内部试运行
P1+   只有上述完成后才恢复产品增强与规模化工作
```

详细范围、门禁和完成标准见 `docs/product/PRODUCTIONIZATION_UPGRADE_PLAN.md`。

## 3. 当前第一项

从已通过的 CE-07 standby 继续：保持 Mac Local Agent 关闭，通过 SSH tunnel + noVNC 完成云端飞影登录，重启确认 Profile 保留；再复核唯一新零-attempt 工单、完整审批链和交接包后，使用已获授权的 CE-08 单条真实出片。失败立即停止且不自动重试。

## 4. 保留但不抢跑的工作

- 文案增强、人物推荐、背景/场景/姿势、动效精修、Capture HTTP、Local Agent 新功能、并行生产、复杂对象存储和高可用全部暂停。
- Local Agent 保留已验证代码但默认关闭，并从生产主路径/操作说明中退出；纯云端稳定至少 10 条或 1～2 周后再决定是否删除。
- 当前 2C4G/2C4G 级试运行服务器只证明内部功能闭环，不承诺正式生产 SLA。

## 5. 每波次门禁

1. 上游 Issue 已合并且 CI 通过。
2. CURRENT、Goal、Roadmap 与 Evidence 结论一致。
3. 实现任务有明确文件边界、状态合同、测试和非目标。
4. 真实费用、Secret、生产数据或云资源变更在执行前通过对应授权门禁。
5. `luna-worker` 负责边界明确的实现，Sol 独立 Review；不自动回退 Terra。
