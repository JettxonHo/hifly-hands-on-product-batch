# 2026-08-12 P1-03 DeepSeek 质检改写

## 授权与范围

- 对应 Issue：#122。
- 本轮实现 DeepSeek 文案改写 adapter、生产配置接线，以及现有改写异步链路的回归证明。
- 不修改数据库、API 形状或 UI，不访问真实 DeepSeek、Hifly 或 Local Agent。

## Agent 路由

- 逻辑角色：`IMPLEMENTER`；自定义 Agent：`luna-worker`。
- 配置文件：`~/.codex/agents/luna-worker.toml`；配置模型 `gpt-5.6-luna`，推理强度 `max`。
- 运行时模型元数据不可见：`UNVERIFIED_RUNTIME_MODEL`。
- Luna 完成实现与测试；Sol 独立检查输入投影、重试边界、版本历史、重新质检和生产默认行为。

## 实现结果

- Adapter 只发送冻结文案、当前 ProductRevision 的已确认文字事实、规范化 ContentBrief、改写范围/指令，以及被选 Finding 的最小文本字段。
- 输出必须为 `{ "body": "string" }`。结构错误最多同配置重试一次；HTTP、认证、限流和未知 Provider 错误转为稳定技术错误且不自动重试。
- 现有 rewrite worker 在 Provider 调用前取得当前商品修订，并在调用后再次检查修订是否仍有效。成功时保留父文案、创建一个子草稿并对新版本排队完整 QC；空结果、未变化结果或非法结构不创建子版本。
- 生产配置新增 `COPY_QUALITY_REWRITER=phase1_controlled_test_double|deepseek`。默认不变，显式启用时缺少 `DEEPSEEK_API_KEY` 会在建 pool 前失败关闭，启动阶段不发模型请求。

## 验证与边界

- 改写器、服务与生产配置定向回归：50/50 通过。
- `npm run check`：通过，检查 211 个 JavaScript 文件。
- 全量 `npm test`：927 项，913 通过、14 个环境型跳过、0 失败。
- `git diff --check`：通过。
- 真实 DeepSeek 请求 0；真实 Hifly 请求 0；模型费用和飞影积分均为 0。

## 下一步

1. 完成全量回归、PR、CI 与 Sol 独立合并门禁后关闭 Issue #122。
2. 进入 P2：把受控人物种子升级为可管理的人物目录和按品类选择能力；真实 Hifly 目录读取另行遵守外部访问授权边界。
3. P1 三项的真实 DeepSeek activation 仍须单独授权并记录费用、输入边界和结果。
