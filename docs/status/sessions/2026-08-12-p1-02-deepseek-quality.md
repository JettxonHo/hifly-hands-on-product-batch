# 2026-08-12 P1-02 确定性规则与 DeepSeek 语义质检

## 授权与范围

- 对应 Issue：#120。
- 本轮实现确定性事实/平台规则、DeepSeek 语义 evaluator、混合聚合和生产配置接线。
- 不实现 AI 改写、数据库/API/UI 变更，不访问真实 DeepSeek、Hifly 或 Local Agent。

## Agent 路由

- 逻辑角色：`IMPLEMENTER`；自定义 Agent：`luna-worker`。
- 配置文件：`~/.codex/agents/luna-worker.toml`；配置模型 `gpt-5.6-luna`，推理强度 `max`。
- 运行时模型元数据不可见：`UNVERIFIED_RUNTIME_MODEL`。
- Luna 完成 evaluator 切片与生产 wiring；Sol 修正一条错误测试预期、补充服务端聚合回归并独立审查。

## 实现结果

- 确定性 evaluator 只把 `confirmed === true` 的卖点作为权威事实；实现有单位数字事实校验、直接 `含/不含` 矛盾校验和显式注入的平台强制规则。默认平台规则为空，不自造禁词表。
- DeepSeek evaluator 只投影文案正文、已确认文字事实、规范化 ContentBrief 与质检版本；结构错误最多同配置重试一次，Provider/HTTP/未知错误不重试并转为稳定技术失败。
- 模型 finding 的 `code/kind/evidence/rule_source` 均由服务端重建，最高只产生 `review`；模型不能创建 `hard_block`、不能生成 `passed` 或 `approved`。
- 混合 evaluator 保留确定性 `fact_gate/hard_block` 权威，QualityRun 仍由现有服务端状态机聚合为 `blocked/needs_review/passed`；HumanReview 仍是唯一批准入口。
- 生产配置新增 `COPY_QUALITY_EVALUATOR=phase1_controlled_test_double|deepseek_hybrid`。默认不变，显式启用时缺少 `DEEPSEEK_API_KEY` 会在建 pool 前失败关闭，启动阶段不发模型请求。

## 验证与边界

- evaluator 定向回归：17/17 通过；生产启动与配置回归：11/11 通过。
- `npm run check`：通过，检查 210 个 JavaScript 文件。
- `npm test`：914 项，900 通过、14 个环境型跳过、0 失败。
- `git diff --check`：通过。
- 真实 DeepSeek 请求 0；真实 Hifly 请求 0；模型费用和飞影积分均为 0。

## 下一步

1. 完成 P1-02 PR、CI 与独立合并门禁后关闭 Issue #120。
2. 进入 P1-03 / Issue #122：DeepSeek AI 改写；继续使用 fake transport，保留新 CopyVersion 与重新质检合同。
3. P1 三项全部合并后，真实 DeepSeek smoke 仍需单独授权并记录费用与输入边界。
