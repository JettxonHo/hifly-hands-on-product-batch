# Capture HTTP real_live 受控脚手架设计

## 背景

当前抓包 HTTP 工作流已经完成：

- 真实 HAR 批次 `batch-8d74e3ce-42f6-4ae3-b6ea-328d3fdfe3ca` 可完成 `extract -> redact -> replay -> real_dry_run`。
- `real_dry_run` 已在 GUI API 中验证通过，构造 7 步请求计划，不访问飞影、不消耗积分。
- Playwright 仍是默认生产链路，`capture_http` 仅作为可选 RPA 分支。

下一阶段选择方案 A：先做 `real_live` 受控脚手架，不发真实请求。目标是把真实 HTTP 出片所需的代码边界、授权门禁、状态、测试替身和 GUI 提示补齐；但默认仍禁止真实访问飞影。

## 目标

1. 给 `capture_http` 增加 `real_live` 的可测试执行路径，但默认禁用。
2. 引入明确的运行期授权门禁，未授权时必须失败为稳定错误，不得发网络。
3. 引入真实 HTTP client 的接口形状和 mockable transport，便于后续单条真实联调。
4. GUI 明确显示 `real_live` 是高风险、会访问飞影且可能消耗积分的功能；当前阶段只能看到禁用或未授权状态。
5. 保持 Playwright 默认生产路径和已通过的 `mock` / `real_dry_run` 行为不变。

## 非目标

- 不在本阶段发真实飞影 HTTP 请求。
- 不自动读取或提交浏览器 cookie、authorization、CSRF、签名等登录态。
- 不消耗飞影积分，不生成真实视频。
- 不把默认 `executionBackend` 改成 `yingdao_rpa` 或 `capture_http`。
- 不提交 raw HAR、批次数据、视频、日志、截图、`config.local.json`、登录态或任何 secret。
- 不删除 Playwright 兜底链路。

## 推荐架构

新增或完善一个 `real_live` client，但把真实网络传输抽成可注入 transport：

```text
capture_http executor
  -> createCaptureHttpClient({ mode, manifest, config, runtimeAuth, transport })
       mock          -> 已有 mock response replay
       real_dry_run  -> 已有 request plan builder
       real_live     -> 新增受控 client
            -> validate live gate
            -> validate step risk
            -> resolve request
            -> call injected transport only when explicitly authorized
```

第一阶段默认 transport 不连接外网。测试中可以注入 fake transport，验证变量链、错误处理和响应解析。生产配置未显式授权时，`real_live` client 必须在任何 transport 调用前抛出禁用/未授权错误。

## 授权门禁

`real_live` 必须同时满足以下条件才允许调用 transport：

1. `rpa.captureHttpMode === "real_live"`。
2. 配置显式包含 `rpa.realLive.enabled === true`。
3. 本次执行上下文显式包含一次性授权，例如 `context.allowRealLive === true` 或同等服务端确认字段。
4. 若 step 的 `risk.may_consume_points === true`，还需要本次执行上下文包含 `acknowledgePointRisk === true`。
5. step host 必须在 allowlist 内，初始只允许 `hiflyworks-api.lingverse.co`。
6. 请求模板不得含未替换占位符、敏感键、绝对本地路径或未声明的动态变量。

任一条件不满足，返回稳定错误：

- `CAPTURE_HTTP_REAL_LIVE_DISABLED`
- `CAPTURE_HTTP_REAL_LIVE_NOT_AUTHORIZED`
- `CAPTURE_HTTP_POINT_RISK_NOT_ACKNOWLEDGED`
- `CAPTURE_HTTP_HOST_NOT_ALLOWED`
- `CAPTURE_HTTP_AUTH_REQUIRED`

这些错误必须可被 GUI 显示，但不得泄露 URL、headers、body、cookie、token、绝对路径或原始异常。

## 运行期登录态

本阶段不实现真实登录态读取。`real_live` client 只定义接口：

```js
runtimeAuth = {
  headers: {},
  cookies: []
}
```

规则：

- `runtimeAuth` 只存在于内存，不写入 batch、manifest、日志或 git。
- manifest 继续禁止持久化 cookie、authorization、token、session、sign、secret 等敏感键。
- 如果 step 标记 `risk.requires_auth === true` 且 runtimeAuth 为空，抛 `CAPTURE_HTTP_AUTH_REQUIRED`。

后续真实联调时再决定 runtimeAuth 来源，优先考虑从已登录 Playwright profile 临时读取 cookie 并只保存在内存中。

## Transport 接口

Transport 是后续真实网络的唯一出口：

```js
transport.request({
  step,
  method,
  url,
  headers,
  body,
  timeoutMs
}) -> {
  status,
  headers,
  body,
  artifact
}
```

脚手架阶段：

- 默认 transport 是 disabled transport，调用即抛 `CAPTURE_HTTP_REAL_LIVE_DISABLED`。
- 测试可注入 fake transport，返回本地 fixture response。
- 所有 response 仍走 `produces` 解析和变量续传。
- download 阶段即使用 fake transport，也只写受控测试 artifact；真实 mp4 下载留到后续授权阶段。

## GUI 行为

GUI 抓包工作流新增或调整状态文案：

- `真实请求预演通过`：`real_dry_run` 成功，无网络、无积分。
- `真实请求已禁用`：`real_live` 未启用或未授权。
- `真实请求待授权`：配置允许但本次执行没有确认风险。

如果出现 real-live 按钮，按钮文案必须包含：

```text
真实 HTTP 生成（会访问飞影，可能消耗积分）
```

本阶段默认不显示可点击的真实生成按钮，或显示为禁用状态。不能把它和“真实请求预演”混在一起。

## 数据与安全边界

- public batch API 不返回真实 request URL、path、query、headers、body、runtimeAuth 或 raw response。
- batch JSON 不持久化 runtimeAuth、cookie、authorization、token 或原始错误。
- request plan public summary 继续只保留 step id、phase、method、host、placeholders、risk flags。
- artifact 写入继续使用已实现的 basename、symlink 和 containment 防护。
- 所有 live 错误保存为稳定 `{ code, message }`。

## 测试计划

无网络测试：

1. `createCaptureHttpClient({ mode: "real_live" })` 在未启用配置时抛 `CAPTURE_HTTP_REAL_LIVE_DISABLED`，且 fake transport 未被调用。
2. 启用配置但没有本次授权时抛 `CAPTURE_HTTP_REAL_LIVE_NOT_AUTHORIZED`。
3. `may_consume_points` step 没有积分风险确认时抛 `CAPTURE_HTTP_POINT_RISK_NOT_ACKNOWLEDGED`。
4. `requires_auth` step 缺 runtimeAuth 时抛 `CAPTURE_HTTP_AUTH_REQUIRED`。
5. host 不在 allowlist 时抛 `CAPTURE_HTTP_HOST_NOT_ALLOWED`。
6. fake transport 模式下，完整 phase 能通过 response `produces` 续传变量，但仍不访问网络。
7. GUI/API 对 real-live disabled/not-authorized 状态展示稳定错误，不泄露敏感内容。
8. 回归：`mock`、`real_dry_run` 和 Playwright 默认路径测试继续通过。

真实测试（后续另行授权）：

1. 用户明确同意访问飞影并可能消耗积分。
2. 只跑 1 条商品。
3. 先只验证 auth/session 注入和 upload/poll 等低风险步骤。
4. 再决定是否允许生成/提交类可能扣积分步骤。
5. 任一步不可复放，立即停止并保留 Playwright 兜底。

## 验收标准

本阶段完成时：

1. 代码中存在 `real_live` client 路径和 transport 接口，但默认禁用。
2. 所有未授权 live 尝试都在发网络前失败。
3. fake transport 可证明真实 client 的变量链与错误处理可用。
4. GUI/文档清楚区分 `real_dry_run` 与 `real_live`。
5. `npm test`、`npm run check`、`git diff --check` 通过。
6. 没有新增真实飞影访问、积分消耗或敏感文件入库。
