# Capture HTTP Real Client 受控接入设计

## 目标

在现有 GUI 抓包工作流已经完成“真实 HAR 录制 → 请求抽取 → 脱敏 manifest → 离线回放”的基础上，继续设计下一阶段：让 `capture_http` 具备可演进到真实 HTTP 请求的执行能力，但在默认情况下仍不访问飞影、不消耗积分、不替代 Playwright。

本阶段的核心目标不是马上真实出片，而是先把真实 HTTP 的代码边界、配置开关、错误分类、GUI 状态和测试路径建立起来。这样后续只需要在明确授权后打开 `real_live`，而不是把真实请求逻辑混在 mock 回放里。

## 当前状态

已完成能力：

- GUI 可勾选抓包，Playwright 真实生成时同步录制 HAR。
- HAR 可抽取 7 个手里有货主链路步骤。
- 脱敏 manifest 可通过门禁，敏感字段被删除。
- 离线 mock 回放可执行完整变量链。
- Playwright 仍是默认生产链路。

尚未完成能力：

- 没有真实 HTTP client。
- `capture_http` 目前只使用 mock client，不会真实上传、提交、轮询或下载。
- 脱敏 manifest 不包含 cookie、authorization、CSRF、签名等凭据，因此不能直接拿来发真实请求。

## 非目标

- 不把默认执行后端切到 `capture_http`。
- 不在本阶段自动访问飞影或消耗积分。
- 不提交原始 HAR、cookie、token、登录态、签名、批次数据、视频、日志、截图。
- 不复用 HAR 中的原始敏感头作为入库配置。
- 不删除或重写 Playwright executor。
- 不保证所有飞影私有接口都可复放；不可复放时必须保留 Playwright 兜底。

## 推荐方案：三档 capture HTTP 模式

新增一个独立的真实请求模式配置，例如：

```json
{
  "executionBackend": "yingdao_rpa",
  "rpa": {
    "mode": "capture_http",
    "manifestPath": "batches/<batch_id>/capture/manifest.json",
    "captureHttpMode": "mock"
  }
}
```

`captureHttpMode` 允许三个值：

| 模式 | 是否访问网络 | 是否消耗积分 | 用途 |
|---|---:|---:|---|
| `mock` | 否 | 否 | 当前能力：离线回放 manifest 响应，验证变量链。默认值。 |
| `real_dry_run` | 否 | 否 | 真实 HTTP client 的安全预演：解析 manifest、替换变量、构造请求计划、校验风险，但不发送请求。 |
| `real_live` | 是 | 可能 | 真实请求飞影，后续阶段启用。必须显式配置并获得用户授权。 |

默认必须是 `mock`。缺省配置、非法配置或 GUI 普通执行都不能进入 `real_live`。

## 架构

```text
capture_http executor
  ├─ load sanitized manifest
  ├─ select capture client by rpa.captureHttpMode
  │     ├─ mock client              已有：离线回放响应
  │     ├─ real dry-run client      新增：构造请求计划，不发网络
  │     └─ real live client         后续：真实 fetch，需授权
  ├─ replay asset_generation
  ├─ replay remote_submit
  ├─ replay remote_query
  └─ replay download
```

建议新增一个 client factory：

```text
createCaptureHttpClient({ mode, manifest, root, config, runtimeAuth })
  -> { request({ stepId, variables, phase, task, context }) }
```

现有 `createMockHttpClient` 可以保留，也可以通过 factory 包一层。`capture-http-executor.js` 不应直接知道每种 client 的内部细节，只负责按 phase 调用 client，并把 produced variables 写回 rpa-state。

## real_dry_run 行为

`real_dry_run` 是下一步实现的第一优先级。它的行为：

1. 加载 sanitized manifest。
2. 按 phase 顺序选择步骤。
3. 对每个 step 做变量替换，得到：
   - method
   - resolved URL
   - non-sensitive request headers
   - request body 模板结果（若 manifest 支持）
4. 不调用 `fetch`、`http`、`https` 或任何网络 API。
5. 不生成真实视频；download 阶段仍写 dry-run 占位 artifact 或只返回计划摘要。
6. 输出 `request_plan`，包含每步：
   - step id
   - phase
   - method
   - host
   - path
   - placeholder names
   - risk flags

`real_dry_run` 的验收标准不是“出片”，而是证明真实请求链路在代码上可被安全构造，并且不会误发请求。

## real_live 行为边界

`real_live` 后续实现时必须满足：

1. 用户明确授权本轮会访问飞影并可能消耗积分。
2. 只允许 1 条商品先跑通。
3. 必须有运行期登录态提供机制，不允许从入库 manifest 恢复 cookie/token。
4. 每一步真实请求前做风险检查：
   - 是否含敏感头来自本地运行态，而不是 manifest。
   - 是否命中提交/生成类接口。
   - 是否属于允许 host。
   - 是否存在未替换占位符。
5. 不可复放的步骤返回明确错误，例如 `CAPTURE_HTTP_API_UNAVAILABLE`，而不是静默回退。
6. 真实下载产物必须登记到原批次 artifacts，与 Playwright 下载路径一致。

本设计只预留 `real_live` 接口和错误类型；默认不实现真实出片。

## 运行期登录态原则

脱敏 manifest 只描述请求结构和响应变量链，不保存登录态。真实 HTTP 请求若要发起，登录态必须来自运行期：

- 方案 A：从当前 Playwright persistent profile 中读取浏览器 cookie，并在内存中注入请求。
- 方案 B：用户提供一次性本地 session 文件，该文件被 gitignore，永不入库。
- 方案 C：继续由 Playwright 完成必须登录态/签名的步骤，HTTP client 只接管可复放步骤。

第一版不实现登录态读取，只在 `real_dry_run` 中标记 `auth_required`。后续若做 `real_live`，优先考虑方案 A，因为它与现有登录流程一致。

## Manifest 扩展

现有 manifest 足够支持 mock 回放，但真实请求需要更明确的请求模板。允许向 step 增加可选字段：

```json
{
  "request_template": {
    "headers": {
      "content-type": "application/json"
    },
    "body": {
      "asset_id": "{{asset_id}}"
    }
  },
  "risk": {
    "requires_auth": true,
    "may_consume_points": true,
    "replayability": "unknown"
  }
}
```

门禁规则：

- `request_template.headers` 不允许出现 cookie、authorization、token、session、sign 等敏感键。
- `risk.may_consume_points=true` 的 step 在 `real_live` 中必须经过显式授权。
- `replayability` 可取 `unknown`、`replayable`、`api_unavailable`。

为了兼容旧 manifest，新增字段全部可选。mock 回放继续只依赖 `response` 和 `produces`。

## GUI 状态

GUI 抓包工作流面板应继续区分：

- `离线回放通过`：mock replay 成功。
- `真实请求预演通过`：real_dry_run 成功，已生成 request plan，但未访问飞影。
- `真实请求不可用`：dry-run 发现缺登录态、未替换占位符、危险敏感字段或不可复放步骤。
- `真实请求已禁用`：当前未获授权或配置不是 `real_live`。

如果后续实现 real-live 按钮，按钮文案必须明确显示“会访问飞影，可能消耗积分”，不能和离线按钮混在一起。

## 错误分类

新增或保留以下错误码：

| 错误码 | 含义 |
|---|---|
| `CAPTURE_HTTP_MODE_INVALID` | `captureHttpMode` 不是允许值。 |
| `CAPTURE_HTTP_REAL_LIVE_DISABLED` | 试图真实请求，但未启用 live 或未授权。 |
| `CAPTURE_HTTP_AUTH_REQUIRED` | 当前步骤需要登录态，但运行期没有提供。 |
| `CAPTURE_HTTP_UNRESOLVED_PLACEHOLDER` | 请求模板仍有未替换变量。 |
| `CAPTURE_HTTP_SENSITIVE_TEMPLATE` | 请求模板包含敏感键，门禁拒绝。 |
| `CAPTURE_HTTP_API_UNAVAILABLE` | 该步骤被标记为不可复放，需要 Playwright 兜底。 |
| `CAPTURE_HTTP_NETWORK_DISABLED` | dry-run 模式检测到网络调用企图。 |

这些错误必须回写批次状态，供 GUI 展示和重试。

## 测试计划

无积分测试：

- client factory：缺省 `mock`，非法 mode 抛 `CAPTURE_HTTP_MODE_INVALID`。
- dry-run client：构造 request plan，不调用网络 API。
- dry-run placeholder：缺变量时抛 `CAPTURE_HTTP_UNRESOLVED_PLACEHOLDER`。
- sensitive gate：request template 出现 cookie/token/sign 时拒绝。
- executor integration：`rpa.mode=capture_http + captureHttpMode=real_dry_run` 能走完 phase，并输出 dry-run artifact/summary。
- GUI/API：批次详情能展示 dry-run 状态。
- 回归：`captureHttpMode=mock` 与现有离线回放结果保持不变；`executionBackend=playwright` 默认不变。

真实测试（后续，需授权）：

- 只跑 1 条商品。
- 先验证 auth/session 注入。
- 再验证上传/生成/提交/轮询/下载各阶段。
- 任一步不可复放则记录 `api_unavailable`，不继续重复消耗积分。

## 验收标准

第一阶段验收：

1. `mock` 模式保持当前可用。
2. `real_dry_run` 能从真实 GUI HAR 生成的 manifest 构造完整 request plan。
3. dry-run 明确证明未访问网络。
4. GUI 能显示 dry-run 成功或具体失败原因。
5. Playwright 默认生产链路不受影响。
6. 文档清楚标明 `real_live` 仍未启用，真实出片继续使用 Playwright。

第二阶段验收（另行授权后）：

1. 真实 HTTP client 可以在 1 条商品上完成端到端出片。
2. 下载产物和批次 artifacts 正常登记。
3. 失败时不会重复消费积分。
4. 至少完成 3 条小批量验证后，才讨论是否替换默认执行路径。

## 交接提醒

- 不要把 `real_dry_run` 的通过误写成“真实 HTTP 出片已完成”。
- 不要把 HAR 中的敏感头复制到 manifest 或配置文件。
- 不要在测试里 monkey patch 全局 `fetch` 后忘记恢复。
- 不要让 GUI 自动切换到 `real_live`。
- 任何真实飞影请求都必须先写入接力文档，并获得用户明确授权。
