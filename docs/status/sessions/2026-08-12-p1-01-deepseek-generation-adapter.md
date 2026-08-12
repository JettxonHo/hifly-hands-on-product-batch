# 2026-08-12 P1-01 DeepSeek 文案生成适配

## 授权与范围

- 对应 Issue：#121。
- 本轮只实现 DeepSeek 官方 HTTP client、文案 Provider Adapter、生产配置与测试。
- 不实现语义质检、AI 改写、数据库变更、UI 变更或飞影执行器变更。
- 不运行真实 DeepSeek 或 Hifly 请求，不产生模型费用或飞影积分。

## Agent 路由

- 逻辑角色：`IMPLEMENTER`。
- 自定义 Agent：`luna-worker`。
- 配置文件：`~/.codex/agents/luna-worker.toml`。
- 配置模型：`gpt-5.6-luna`，推理强度 `max`。
- 运行时模型元数据不可见：`UNVERIFIED_RUNTIME_MODEL`。
- Luna 产出初版实现并完成定向测试；Sol 负责收口、完整验证和独立审查。

## 实现结果

- 新增 provider-neutral HTTPS JSON transport。
- 新增 DeepSeek 官方 client，固定官方 Base URL、`deepseek-v4-flash`、显式非思考模式和 JSON Output。
- 新增文案 Provider Adapter，只投影已确认文字商品事实和规范化 ContentBrief，不发送图片、图片 URL、路径或飞影凭据。
- 结构无效输出最多按同配置重试一次；HTTP、鉴权、限流、服务端和未知上游错误不自动重试，也不回退到其他 Provider。
- 生产配置可显式选择 `deepseek`；缺少服务端 `DEEPSEEK_API_KEY` 时在启动前失败关闭。默认仍为受控测试 Provider，部署环境尚未切换。
- 成功输出沿用现有异步任务与版本合同，只创建 `draft` CopyVersion，不自动质检或批准。

## 安全与边界

- API Key、Authorization、原始响应、prompt、reasoning content 和 Provider 内部错误不写入业务记录或公开错误。
- 输入防护采用允许字段投影和类型校验，不扫描或阻断正常文案中的任意 URL 文本。
- 未新增 SHA-256、模型 fallback、BYOK、Provider 选择 UI 或推测性防御。

## 验证

- `node --test test/deepseek-client.test.js test/deepseek-provider.test.js test/production-start.test.js test/copy-generation-service.test.js test/copy-generation-api.test.js test/copy-generation-browser.test.js`：33/33 通过。
- `npm run check`：通过，检查 207 个 JavaScript 文件。
- `npm test`：894 项，880 通过、14 个环境型跳过、0 失败。
- `git diff --check`：通过。

## 下一步

1. 完成全量门禁、独立 Sol review 和 CI。
2. 合并后关闭 Issue #121。
3. 进入 P1-02：确定性质量规则与 DeepSeek 语义质检；不得把生成成功等同于质检或人工批准。
