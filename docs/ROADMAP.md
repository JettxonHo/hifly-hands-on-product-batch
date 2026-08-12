# 项目 Roadmap

> 最后更新：2026-08-12
> 当前状态：Vertical Slice A 已完成；生产化核心能力升级 Goal 进行中

## 1. 已完成基线

- A01～A14 已完成企业登录、项目与商品、文案版本/QC/人工审核、人物选择、VideoPlan、ProductionOrder、交接包、执行报告、作品核验与交付。
- 阿里云 2C4G 内部试运行环境已部署。
- 单条真实云端工单已通过 Mac Local Agent 调用飞影「手里有货」，完成下载、云端回传、核验和 Work 登记。
- 官方 Hifly API Token 已完成只读积分连接验证；「手里有货」仍走 Playwright。

## 2. 当前升级顺序

```text
P0  Goal / Roadmap / Evidence 重基线
P1  真实 DeepSeek 文案生成、语义 QC 与改写
P2  人物目录同步、上传维护与品类推荐
P3  3 商品 / 2 人物的小批量真实生产验收
P4  声音、背景、场景、姿势和构图 Evidence / 受控参数
P5  可安装常驻 Local Agent
P6  对象存储、托管 PostgreSQL、可信域名、监控和恢复
```

详细范围、门禁和完成标准见 `docs/product/PRODUCTIONIZATION_UPGRADE_PLAN.md`。

## 3. 当前第一项

先实现 P1 的 DeepSeek Provider Adapter 与生产配置，使用 fake transport 完成无费用 TDD；随后再进行单独授权的真实模型 smoke。当前 `phase1_controlled_test_double` 仍是生产 wiring，替换完成前不能宣称真实 AI 文案已上线。

## 4. 保留但不抢跑的工作

- Issue #37 Windows capture timing flake，以及 crash recovery、stale lock、诊断和任务预算 UX，继续保留为可靠性 backlog。
- Capture HTTP 是实验路径；不会为了路线切换破坏已跑通的 Playwright/Local Agent 生产能力。
- 企业级云基础设施必须等 P1～P5 的真实负载和运行证据，不以当前 2C4G 试运行服务器冒充正式生产 SLA。

## 5. 每波次门禁

1. 上游 Issue 已合并且 CI 通过。
2. CURRENT、Goal、Roadmap 与 Evidence 结论一致。
3. 实现任务有明确文件边界、状态合同、测试和非目标。
4. 真实费用、Secret、生产数据或云资源变更在执行前通过对应授权门禁。
5. `luna-worker` 负责边界明确的实现，Sol 独立 Review；不自动回退 Terra。
