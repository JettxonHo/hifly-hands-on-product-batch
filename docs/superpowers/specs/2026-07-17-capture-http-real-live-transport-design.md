# Capture HTTP real_live 真实 transport 与 GUI 执行设计

## 背景

当前 `capture_http` 已完成到受控脚手架阶段：

- `mock` 可离线回放录制响应。
- `real_dry_run` 可构造真实请求计划，但不访问飞影、不消耗积分。
- `real_live` client 已有授权门禁和 fake transport 测试，但没有真实 transport、没有 GUI 可点击执行入口，也没有真实 1 条商品联调。
- Playwright 仍是生产可用兜底链路。

本阶段目标是把抓包 HTTP 从“可测试脚手架”推进到“可由 GUI 触发真实 HTTP 出片并验证 1 条商品”的阶段。

## 决策

采用方案 A：**Playwright 仅负责提供已登录态，抓包 HTTP 负责真实请求出片**。

这不是继续用 Playwright 点页面。Playwright 的职责缩小为从现有已登录 profile 临时读取 `hiflyworks-api.lingverse.co` / `hifly.cc` 相关 cookie，并只在内存中拼成 runtime auth。随后执行链路走 sanitized capture manifest 与 Node HTTP transport。

```text
GUI
  -> 确认真实 HTTP + 积分风险
  -> server API
      -> 从 Playwright profile 临时读取 cookie（内存）
      -> createCaptureHttpExecutor({ captureHttpMode: "real_live" })
      -> Node fetch transport
      -> manifest phases: asset_generation -> remote_submit -> remote_query -> download
      -> 下载真实 artifact 到 batch artifacts
```

## 为什么不用其他方案

### 手动复制 cookie/header

实现较快，但会把高敏信息暴露给操作者、浏览器输入框、剪贴板和潜在日志。后续新人/客户使用时也容易误操作。

### 从 HAR 恢复 headers

HAR 是高敏抓包文件，含 cookie、token、签名和响应内容。用 HAR 自动恢复请求头会鼓励把敏感数据持久化，和当前安全边界冲突。

### 继续只用 Playwright

已可作为兜底，但无法达成“抓包 HTTP 替代网页自动化”的目标。

## 范围

### 本阶段要做

1. 新增真实 HTTP transport，使用 Node `fetch` 发送请求。
2. 新增 runtime auth provider，从 Playwright persistent profile 临时读取匹配域名 cookie，只保存在内存中。
3. 新增 server API，让 GUI 能对已完成 capture manifest 的批次触发 1 条真实 HTTP 执行。
4. GUI 开放真实 HTTP 生成按钮，但必须带二次确认和积分风险确认。
5. 执行只允许单商品批次或只允许用户明确选择 1 个 item。
6. 下载阶段必须保存真实 artifact，而不是 placeholder。
7. 成功/失败状态必须可在 GUI 中看到，失败批次可重新执行，无需重新录入。
8. 所有敏感数据不得写入 batch、manifest、RPA state、日志、文档或 git。

### 本阶段不做

- 不把默认执行后端改成 `capture_http`。
- 不删除 Playwright 生产兜底。
- 不做多商品并发真实 HTTP。
- 不自动复用 raw HAR 中的 cookie/header。
- 不在未授权时访问飞影。
- 不提交下载视频、真实批次数据、raw HAR、日志、截图或 `config.local.json`。

## 授权与积分门禁

真实 HTTP 执行必须同时满足：

1. 批次已启用 capture，且有 sanitized `manifest_path`。
2. 用户在 GUI 中明确点击真实 HTTP 生成。
3. GUI 请求体包含一次性确认字段，例如：
   - `allowRealLive: true`
   - `acknowledgePointRisk: true`
   - `limitItems: 1`
4. 服务端再次校验批次只执行 1 条商品。
5. 配置 `rpa.realLive.enabled === true`。
6. manifest step host 在 allowlist 内。
7. step 风险 `may_consume_points` 必须由本次上下文确认。
8. runtime auth 在内存中存在；否则返回 `CAPTURE_HTTP_AUTH_REQUIRED`。

任一条件不满足，不得调用 transport。

## Runtime Auth

新增模块建议：

```text
src/rpa/capture/playwright-runtime-auth.js
```

职责：

- 使用项目现有 `browser.profileDir` 打开或读取 Playwright persistent context。
- 只提取 allowlist 域名 cookie。
- 拼成内存中的 `runtimeAuth.headers.cookie`。
- 不返回其他 header，除非后续确认为必要且通过安全评审。
- 不写入文件、不打印 cookie、不进入 batch JSON。

如果当前 profile 未登录或 cookie 不足，返回稳定错误 `CAPTURE_HTTP_AUTH_REQUIRED` 或 `CAPTURE_HTTP_RUNTIME_AUTH_UNAVAILABLE`。

## Transport

新增模块建议：

```text
src/rpa/capture/fetch-live-transport.js
```

职责：

- 使用 Node `fetch`。
- 只接受 `https://`。
- 只允许 `real_live` client 已构造出的 request。
- 支持超时。
- JSON 响应解析为 `body`；二进制响应用于 download 阶段 artifact。
- 不记录 URL、headers、body、response body。
- 网络错误转换为稳定错误，例如 `CAPTURE_HTTP_TRANSPORT_FAILED`。

## 下载 artifact

现有 executor 的 `downloadArtifact()` 只写 placeholder。真实 HTTP 出片需要扩展：

- 如果 `real_live` download step 返回 artifact bytes/stream，则写入 `batches/<batchId>/artifacts/<safe filename>.mp4`。
- 仍使用 basename、symlink、exclusive-open、containment 防护。
- 文件名优先来自 manifest produces 的 `artifact_filename`，否则使用 `remote_id.mp4`。
- artifact 相对路径可以写入 batch state；绝对路径不能公开。

## GUI 行为

抓包工作流面板按钮：

```text
真实 HTTP 生成（会访问飞影，可能消耗积分）
```

按钮启用条件：

- capture 状态为 `dry_run_passed` 或 `real_live_failed`。
- 批次中待执行 item 数为 1，或用户选择 1 条 item。
- 后端 runtime 显示 `realLive.enabled=true`。

点击后显示确认文案：

```text
此操作会真实访问飞影并可能消耗积分。本次只执行 1 条商品。确认继续？
```

确认后调用真实执行 API。GUI 显示：

- `real_live_running`
- `real_live_completed`
- `real_live_failed`
- `CAPTURE_HTTP_AUTH_REQUIRED`
- `CAPTURE_HTTP_POINT_RISK_NOT_ACKNOWLEDGED`
- `CAPTURE_HTTP_TRANSPORT_FAILED`

## API

建议新增：

```text
POST /api/batches/:batchId/capture/live-run
```

请求体只允许：

```json
{
  "allowRealLive": true,
  "acknowledgePointRisk": true,
  "limitItems": 1
}
```

服务端不接受 cookie/header/body/runtimeAuth 由前端传入。

成功返回 public batch；失败也返回 public batch 和稳定错误。public API 不返回 raw request plan、headers、body、cookie、token、绝对路径或 raw response。

## 状态

扩展 capture workflow state：

- `real_live_ready`
- `real_live_running`
- `real_live_completed`
- `real_live_failed`

保存内容：

- `live_summary.executed_step_count`
- `live_summary.artifact_relative_path`
- `live_summary.remote_id`
- `live_error: { code, message }`

不保存：

- runtimeAuth
- cookie
- authorization
- request URL/path/query
- request headers/body
- raw response body
- 下载绝对路径

## 测试边界

先用 fake auth provider + fake fetch transport 做无网络测试：

1. API 未确认积分风险时不调用 transport。
2. API 未启用 `rpa.realLive.enabled` 时不调用 transport。
3. auth provider 无 cookie 时不调用 transport。
4. 成功路径只对单 item 执行，状态到 `real_live_completed`。
5. RPA state / batch JSON / public API 不包含 cookie、raw URL、headers、body。
6. download artifact 写入仍拒绝 traversal、symlink、已存在目标。
7. GUI 按钮仅在可运行状态启用，并显示明确风险文案。
8. Playwright 默认生产执行、`mock`、`real_dry_run` 原测试继续通过。

真实联调测试：

1. 用户明确授权。
2. 只跑已有已完成 capture 的 1 条商品。
3. 记录批次 ID、SKU、远端作品 ID、下载产物相对路径、积分消耗说明。
4. 任一步出现接口不可复放、鉴权失败、风控或扣分风险不确定，立即停止并保留 Playwright 兜底。

## 验收标准

1. GUI 可点击真实 HTTP 生成，且有二次风险确认。
2. 服务端真实 transport 可在授权后调用飞影。
3. 成功时下载真实视频 artifact，并在 GUI 可见。
4. 失败时 GUI 展示稳定错误，可重新执行，无需重新录入。
5. 未授权或配置未启用时不会访问飞影。
6. `npm test`、`npm run check`、`git diff --check` 通过。
7. 最终真实 1 条联调在用户授权后完成并记录到 `docs/PROJECT_HANDOFF.md`。
