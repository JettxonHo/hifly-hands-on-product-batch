# 2026-08-12 生产化核心能力升级 Goal 重基线

## 授权与范围

Owner 明确批准按推荐顺序开发未完成核心升级。本轮仅重基线项目权威文档，不修改生产代码，不访问 DeepSeek、Hifly 或云资源。

## 已完成

- 将已完成的 Vertical Slice A 与新生产化 Goal 分开记录。
- 新增 D-033 与 `docs/product/PRODUCTIONIZATION_UPGRADE_PLAN.md`。
- 固定 P0～P6 顺序：DeepSeek → 人物目录 → 小批量 → 声音/场景 Evidence → 常驻 Local Agent → 生产基础设施。
- 将「手里有货」Evidence 更新到 2026-08-12 单条真实闭环，保留小批量和参数控制未完成边界。
- 更新 `AGENTS.md` 的当前优先级与 `luna-worker` 失败关闭规则。

## 当前卡点

- 无文档 blocker。
- DeepSeek 真实 API Key/费用验证不属于本轮；P1 先用 fake transport 实现和测试。

## 下一步

1. 合并本轮文档 PR。
2. 创建 P1 首个开发 Issue：DeepSeek Provider Adapter 与生产配置。
3. 由 `luna-worker` 实现，Sol 独立审查；不触发真实模型请求。

## 验证与费用

- 验证命令：`git diff --check`；文档链接和关键状态用 `rg` 核对。
- Hifly 访问：无。
- 飞影积分：0。
- DeepSeek 请求：0。
