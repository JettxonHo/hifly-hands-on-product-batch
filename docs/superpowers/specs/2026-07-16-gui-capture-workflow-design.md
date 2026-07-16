# GUI 抓包工作流设计

## 目标

把当前已验证可用的 Playwright 主链路扩展成 GUI 可驱动的抓包闭环。最终用户仍在本地网页 GUI 中完成商品录入、批量导入、策略选择、执行、重试和下载；系统在执行过程中自动录制飞影 HTTP HAR，并把 HAR 转成脱敏 manifest，再用 `capture_http` 离线回放验证请求链路是否自洽。

本阶段的交付目标是“GUI 抓包工作流跑通”，不是直接用飞影私有 HTTP 接口真实出片。真实 HTTP 复放是下一阶段，必须在确认签名、一次性 token、风控与积分消耗规则后再做。

## 范围

本阶段必须覆盖 GUI 的所有现有生产入口：

- 单条录入：商品图、SKU、产品名、卖点、类目、可选口播文案。
- 批量录入：多行商品与图片上传。
- 表格导入：CSV/XLSX 商品表与图片批量导入。
- 人物策略：`auto_pool`、`fixed_upload`、`hifly_recommended`。
- 文案策略：`hifly_ai`、`provided_script`、`mixed`。
- 执行确认：按商品数量执行，一个商品一条视频。
- 状态展示：批次状态、商品状态、失败阶段、错误信息、下载产物。
- 重试恢复：失败或 `interrupted_unknown` 后可以从原批次重新执行，不要求用户重新录入。

## 非目标

- 不把默认执行后端从 `playwright` 改成抓包模式。
- 不提交原始 HAR、cookie、authorization、登录态、签名、批次数据、日志、截图或视频。
- 不在本阶段真实复放飞影私有 HTTP 请求生成新视频。
- 不删除 Playwright 执行器、影刀 RPA bridge 或既有 GUI 功能。
- 不做 TagUI。

## 推荐方案

采用“三段式抓包工作流”。

第一段是 GUI 触发的真实采集：GUI 仍调用现有执行接口，执行器仍用 Playwright 操作飞影页面，但在本次执行中开启 HAR 录制。这样可以保留已经跑通的上传、确认、提交和下载流程，同时获得真实请求证据。

第二段是本地处理：执行完成后，系统把 HAR 作为本地敏感原始材料保存到 `rpa/capture/raw/`，自动抽取候选请求步骤，生成人工可读的 raw steps 草稿。随后运行现有脱敏 CLI 产出 sanitized manifest 和 report。

第三段是离线验收：系统用 `capture_http` mock executor 加载 sanitized manifest，执行离线回放。只有当 manifest 解析、变量链、produces、占位 artifact 都通过时，GUI 才把该批次标记为“抓包产物可用”。

这个方案的好处是风险低：生产出片仍靠 Playwright；抓包链路先作为旁路验证积累稳定 manifest；当 manifest 被多次验证后，再进入真实 HTTP client 阶段。

## 过渡与切换策略

抓包 HTTP 是最终目标，但在它完整可用前，GUI 默认执行方式继续使用 Playwright。这里的“完整可用”必须同时满足：

- 上传商品图、上传人物图、手持商品图生成、视频提交、状态轮询和下载都能通过 HTTP 请求稳定完成。
- 单条录入、批量录入和表格导入都能走同一套 HTTP 执行路径。
- 人物策略和文案策略都能在 HTTP 执行路径中得到等价支持。
- 失败、重试、异常态和下载产物登记都能在 GUI 中正常展示。
- 至少完成 1 条真实商品和 3 条小批量真实商品验证，并确认不会误复用旧素材、旧作品或错误下载目标。

因此本阶段实现时必须保持：

- `executionBackend: "playwright"` 仍是默认生产路径。
- GUI 抓包开关只增加 HAR 采集和离线验证，不改变真实生成方式。
- `capture_http` 在未接入真实 HTTP client 前只作为离线回放验证能力。
- 只有当上述完整可用标准通过并再次获得用户确认后，才允许把 GUI 默认执行方式切到抓包 HTTP。

## 数据流

```text
GUI 创建批次
  -> 执行前确认积分
  -> Playwright 执行真实飞影流程
  -> 同步录制 HAR 到 rpa/capture/raw/
  -> 批次完成并下载真实 mp4
  -> HAR 自动抽取 raw steps 草稿
  -> 脱敏生成 sanitized manifest + report
  -> capture_http 离线回放
  -> GUI 展示抓包状态、manifest 路径、回放结果
```

## 批次模型扩展

批次 JSON 增加可选 `capture` 字段，不影响旧批次：

```json
{
  "capture": {
    "enabled": true,
    "status": "not_started | recording | recorded | extracted | redacted | replay_passed | replay_failed",
    "har_path": "rpa/capture/raw/...",
    "raw_steps_path": "batches/<batch_id>/capture/raw-steps.json",
    "manifest_path": "batches/<batch_id>/capture/manifest.json",
    "report_path": "batches/<batch_id>/capture/redaction-report.json",
    "replay_error": null,
    "updated_at": "..."
  }
}
```

安全约束：

- `har_path` 只能指向 gitignored 的本地原始目录，不提供浏览器下载链接。
- GUI 可以显示路径和状态，但不能直接把 HAR 内容暴露给前端。
- `manifest_path` 和 report 属于批次运行期产物，默认不入库；只有人工复核后才复制到 `rpa/capture/fixtures/`。

## GUI 交互

新增一个“抓包工作流”设置区，放在执行设置附近：

- 开关：`同时录制抓包产物`，默认关闭。
- 状态徽章：未开始、录制中、已录制、已抽取、已脱敏、离线回放通过、离线回放失败。
- 操作按钮：
  - `抽取请求步骤`：从 HAR 生成 raw steps 草稿。
  - `脱敏生成 manifest`：调用脱敏 CLI 或同等服务端函数。
  - `离线回放验证`：用 `capture_http` mock executor 验证 manifest。
  - `重新执行抓包处理`：只重跑抽取/脱敏/回放，不重新消耗飞影积分。

执行真实飞影前仍必须弹出积分确认。抓包后处理不消耗积分，不需要再次确认。

## HAR 抽取策略

第一版自动抽取采用保守规则：

- 只读取本地 HAR 文件。
- 只保留 `hifly.cc` 或配置中允许域名的 `Fetch/XHR` 请求。
- 跳过静态资源、图片 CDN、统计、前端 bundle。
- 以请求路径、method、响应 JSON 结构和时间顺序推断候选阶段。
- 无法确定阶段时标记 `phase: "unclassified"` 并要求人工处理，不进入 manifest 门禁。

第一版允许“半自动”：系统生成 raw steps 草稿，用户或接手代理复核阶段和 produces。只要能从 GUI 触发采集、看到草稿、完成脱敏和离线回放，就算本阶段跑通。

## Manifest 与离线回放

沿用现有 `capture_http` manifest 协议和 mock executor。每条 manifest 至少要能产生：

- `asset_generation` 阶段的 `asset_id`。
- `remote_submit` 阶段的 `remote_id`。
- `download` 阶段的 `artifact_filename` 或默认 artifact 名称。

离线回放只验证请求链和变量链，不发真实网络请求，不生成真实视频。回放 artifact 是占位文件。

## 错误处理

- HAR 缺失：批次显示 `recorded` 前失败，错误为 `CAPTURE_HAR_MISSING`。
- HAR 无候选请求：显示 `CAPTURE_NO_CANDIDATES`，允许重新抽取或重新真实采集。
- 脱敏失败：显示具体敏感字段路径，禁止生成 manifest。
- 门禁失败：显示 `INVALID_CAPTURE_MANIFEST`，禁止回放。
- 离线回放失败：显示缺失变量、缺失 produces 或未知 step，不影响真实视频下载结果。
- 真实飞影执行失败：保持现有批次失败和重试逻辑；抓包状态最多停在 `recording` 或 `recorded`。

## 测试计划

无积分测试：

- 服务端 API：创建带 `capture.enabled=true` 的批次，状态可持久化并展示。
- HAR 抽取：用本地 fixture HAR 生成 raw steps 草稿，敏感头不进入响应。
- 脱敏：raw steps 生成 sanitized manifest，敏感字段被删除，门禁通过。
- 离线回放：manifest 经 `capture_http` mock executor 完整走完。
- GUI smoke：执行设置能开启抓包，批次详情能显示抓包状态和可重跑按钮。
- 回归：默认 `playwright` 执行后端不变；未开抓包时所有现有测试继续通过。

真实测试：

- 只在用户授权后跑 1 条商品。
- 确认真实视频仍下载成功。
- 确认 HAR 保存成功。
- 不重复消耗积分测试抽取、脱敏、离线回放。

## 验收标准

1. 用户在 GUI 创建任意现有类型批次时，可以选择开启抓包。
2. 批次真实执行成功后，GUI 能展示 HAR 已录制。
3. 用户不用重新录入商品，就能对该批次执行抽取、脱敏、离线回放。
4. 离线回放通过后，GUI 显示明确成功状态和产物路径。
5. 任何抓包后处理失败都能重试，不触发新的飞影真实生成。
6. 默认 Playwright 生产链路保持可用。

## 后续阶段

当多份 manifest 都能离线回放通过后，再设计真实 HTTP client：

- 从 manifest 读取请求模板。
- 使用当前浏览器登录态或受控 session 发送真实请求。
- 对不可复放步骤标记 `api_unavailable`，回退 Playwright。
- 真实 HTTP 出片前再次要求用户授权积分。
