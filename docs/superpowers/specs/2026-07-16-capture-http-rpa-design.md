# 抓包 HTTP RPA 执行器设计

> 说明：交接文档曾称本文件保存在 `stash@{0}`，实际该 stash 只含 `2026-07-16-tagui-rpa-cli-design.md`（已废弃，用户不做 TagUI）。本文件为 Claude Code 新写的设计依据，不是从 stash 恢复。

## 目标

在已跑通的 Playwright「手里有货」主链路和已完成的 `yingdao_rpa` 桥接/mock 之外，新增「抓包 HTTP」执行模式，目标是逐步用复放的飞影 HTTP 请求替代不稳定的网页按钮定位。

核心原则：

- Playwright 仍是默认 `executionBackend`，任何改动不得改坏它。
- 不删除、不重写 Playwright executor 和现有 `yingdao_rpa` bridge。
- 不做 TagUI，不安装或开发 `tagui_rpa`。
- 抓包能力作为 `yingdao_rpa` bridge 下的一个显式模式分支接入：`rpa.mode: "capture_http"`，最大限度复用已有的 task package、callback token、`/api/rpa/callback`、rpa-state。
- 第一阶段只做无积分本地实现：manifest parser、脱敏规则、mock HTTP client、capture flow 测试，不访问飞影、不消耗积分。
- 真实飞影抓包或生成前，必须先向用户确认会消耗积分，并只跑 1 条商品。

## 背景判断

现有两条执行路径：

- `executionBackend: "playwright"`（默认）：Node.js + Playwright 操作飞影网页 DOM，是目前稳定可用版本。
- `executionBackend: "yingdao_rpa"`：本地 GUI 生成 task package，外部执行器通过 `/api/rpa/callback` 回写状态，本地轮询 rpa-state 推进。目前 bridge/mock 已完成并通过测试，但执行端仍是 mock，没有真实抓包。

抓包 HTTP 模式要解决两个痛点（与影刀设计一致）：

1. 飞影页面按钮定位不稳定，容易点错确认、删除、下载等相邻按钮。
2. 提交后依赖页面「最新作品」识别远端作品，证据不够稳定。

抓包模式的设想：先用浏览器真实登录态采集「手里有货」的上传、手持图生成、视频提交、状态轮询、下载请求，确认是否可稳定复放；若私有接口存在动态签名、一次性 token、风控或不可复放，则该步骤标记为 `api_unavailable`，保持网页自动化兜底。

但真实采集和复放涉及飞影积分和账号风控，必须用户明确授权后才能进行。因此本设计第一版只交付「能解析、脱敏、本地 mock 复放」的能力，把真实抓包留到后续阶段。

## 设计原则

- 不污染已跑通版本：抓包能力通过 `rpa.mode` 分支接入，不新增顶层 `executionBackend`，不改默认路径。
- 复用优先：复用 `createRpaTaskPackage`、callback token registry、`/api/rpa/callback`、rpa-state、executor adapter 五方法契约。
- 数据与密钥分离：采集到的原始请求含 cookie、authorization、CSRF token、登录态，这些是敏感数据，绝不入库；入库的是脱敏后的 manifest（模板 + 占位符 + 已录制响应结构）。
- 本地无积分先行：mock HTTP client 只回放已录制响应，不发起任何真实网络请求；所有第一版测试都不访问飞影、不消耗积分。
- 状态以 GUI/state 为准：capture executor 只负责推进 rpa-state 并通过 executor adapter 返回 asset/evidence/artifact，不直接改 batch.json。
- 真实飞影执行仍需用户确认，因为会消耗积分。

## 总体架构

```text
本地 GUI / Batch Runner
  ├─ executionBackend = playwright        默认稳定主链路（不动）
  ├─ executionBackend = yingdao_rpa       既有影刀桥接
  │     └─ rpa.mode = "default"           现有 mock bridge 行为（不动）
  │     └─ rpa.mode = "capture_http"      新增抓包回放分支
  │           ├─ 复用 createRpaTaskPackage()
  │           ├─ 复用 callback token registry（可选）
  │           ├─ 解析 sanitized capture manifest
  │           ├─ 用 mock HTTP client 回放步骤
  │           ├─ 把结果写入 rpa-state（asset_confirmed / submitted / completed）
  │           └─ 通过现有 executor adapter 返回 asset / evidence / artifact

抓包产物（不进 git）
  ├─ 原始 HAR / raw steps（含敏感头，仅本地，不提交）
  └─ sanitized capture manifest（脱敏后，可入库作为测试 fixture）

脱敏工具（本地离线运行）
  └─ redactCaptureSource(rawHarOrSteps) → { sanitized, report }
```

## 执行后端与模式配置

不新增顶层 `executionBackend`。抓包模式挂在 `yingdao_rpa` 下：

```json
{
  "executionBackend": "playwright",
  "rpa": {
    "mode": "capture_http",
    "callbackBaseUrl": "http://127.0.0.1:4317",
    "manifestPath": "rpa/capture/fixtures/hifly-goods-sample.json",
    "assetTimeoutMs": 600000,
    "submitTimeoutMs": 1200000,
    "queryTimeoutMs": 120000,
    "downloadTimeoutMs": 1200000,
    "pollIntervalMs": 1000
  }
}
```

规则：

- `executionBackend` 默认仍为 `playwright`，不在本设计内改动。
- `rpa.mode` 缺省或为 `"default"` 时，`yingdao_rpa` 保持现有 mock bridge 行为，完全不动。
- `rpa.mode = "capture_http"` 时，bridge 切换为抓包回放执行器。
- `rpa.manifestPath` 指向脱敏后的 manifest 文件，支持相对项目根或绝对路径。
- `rpa.mode` 与 `executionBackend` 的组合：只有 `executionBackend = "yingdao_rpa"` 且 `rpa.mode = "capture_http"` 才进入抓包分支；其他组合一律走原路径。

GUI 第一版不新增模式选择控件，保持现有「执行引擎」展示即可，模式通过本地配置切换。

## Capture Manifest 协议

manifest 是脱敏后的「飞影请求步骤剧本」，描述要回放的请求顺序和每步的已录制响应结构。

文件位置约定（测试 fixture 与真实抓包产物分开）：

```text
rpa/capture/fixtures/*.json     测试用脱敏 manifest（可入库）
batches/<batch_id>/rpa/capture/ 运行期产物（不进 git）
```

manifest schema（`schema_version: 1`）：

```json
{
  "schema_version": 1,
  "source": "hifly_goods",
  "captured_at": "2026-07-16T00:00:00Z",
  "sanitized": true,
  "notes": "脱敏后的示例 manifest，仅用于本地回放测试",
  "steps": [
    {
      "id": "upload_product_image",
      "phase": "asset_generation",
      "method": "POST",
      "url_template": "https://hifly.cc/api/goods/upload",
      "placeholders": ["{{product_image_path}}"],
      "response": {
        "status": 200,
        "body": { "code": 0, "data": { "image_id": "img-sample-001" } }
      },
      "produces": { "product_image_id": "$response.body.data.image_id" }
    },
    {
      "id": "create_hands_on_image",
      "phase": "asset_generation",
      "method": "POST",
      "url_template": "https://hifly.cc/api/goods/hands-on",
      "placeholders": ["{{product_image_id}}", "{{person_image_id}}"],
      "response": { "status": 200, "body": { "code": 0, "data": { "asset_id": "asset-sample-001" } } },
      "produces": { "asset_id": "$response.body.data.asset_id" }
    },
    {
      "id": "submit_video",
      "phase": "remote_submit",
      "method": "POST",
      "url_template": "https://hifly.cc/api/goods/submit",
      "placeholders": ["{{asset_id}}"],
      "response": { "status": 200, "body": { "code": 0, "data": { "work_id": "632410" } } },
      "produces": { "remote_id": "$response.body.data.work_id" }
    },
    {
      "id": "poll_video_status",
      "phase": "remote_query",
      "method": "GET",
      "url_template": "https://hifly.cc/api/goods/status/{{remote_id}}",
      "placeholders": ["{{remote_id}}"],
      "response": { "status": 200, "body": { "code": 0, "data": { "status": "ready" } } }
    },
    {
      "id": "download_video",
      "phase": "download",
      "method": "GET",
      "url_template": "https://hifly.cc/api/goods/download/{{remote_id}}",
      "placeholders": ["{{remote_id}}"],
      "response": { "status": 200, "body": { "code": 0, "data": { "filename": "632410.mp4", "size": 12345 } } },
      "produces": { "artifact_filename": "$response.body.data.filename" }
    }
  ]
}
```

字段约束：

- `schema_version` 必须为 `1`。
- `source`、`captured_at` 为字符串；`sanitized` 必须为 `true`，否则 parser 拒绝加载（防止误用未脱敏产物）。
- `steps` 必须是非空数组，每个 step 必须有唯一 `id`、合法 `phase`、`method`、`url_template`、`response`。
- `phase` 取值限定在执行器阶段集合：`asset_generation`、`remote_submit`、`remote_query`、`download`。
- `response` 必须有 `status`（整数）和 `body`（对象或字符串）。
- `placeholders` 是字符串数组，列出 `url_template` / `body` 里用到的 `{{var}}`，供回放时校验变量是否齐全。
- `produces` 是 `变量名 -> 取值路径` 映射，路径以 `$response.body...` 形式从已录制响应里提取，供后续步骤和执行器使用。

安全要求：

- manifest 不得包含 `cookie`、`authorization`、`x-csrf-token`、`x-xsrf-token`、`set-cookie`、登录态或真实账号信息。parser 在加载时会做脱敏门禁检查（见下文「脱敏规则」），命中即拒绝。
- manifest 不包含飞影账号密码或浏览器登录态。
- 运行期产物的 `download_dir` 仍等于当前批次目录，沿用 task package 的批次边界约束。

## 脱敏规则（redact）

`redactCaptureSource(rawHarOrSteps)` 是离线工具，把原始抓包（HAR 或手动整理的 step 数组）清洗成可入库的 manifest。它**不**在执行热路径上自动运行，只在「采集 → 入库 fixture」时由人工或脚本调用。

清洗规则：

1. 请求/响应头：删除 `cookie`、`set-cookie`、`authorization`、`proxy-authorization`、`x-csrf-token`、`x-xsrf-token`、以及名字含 `token`/`session`/`auth`/`ticket` 的头（大小写不敏感）。
2. 请求/响应 body：删除或掩码形如 token、session、签名的字段；保留业务结构（image_id、work_id、status 等）。
3. URL query：删除 `token`、`sign`、`session` 等敏感参数。
4. 标注 `sanitized: true`，输出 `report` 列出每条被删除/掩码的路径，便于人工复核是否漏删。

返回：

```json
{
  "sanitized": { "schema_version": 1, "source": "...", "sanitized": true, "steps": [ ... ] },
  "report": { "removed": ["steps[0].request.headers.cookie", "..."], "masked": ["steps[1].response.body.data.sign"] }
}
```

约束：

- 脱敏工具不访问网络，不读浏览器登录态，纯文本处理。
- 脱敏后的 manifest 才允许入库；脱敏报告不进 git（可能含被删字段的路径名，但不含值）。
- `parseCaptureManifest` 内置同样的脱敏门禁：加载任意 manifest 时再次扫描敏感头/字段，命中即抛错，作为双重保险。

## Mock HTTP Client

`createMockHttpClient({ manifest })` 返回一个回放客户端，**不发起任何真实网络请求**。

接口：

```text
async request({ stepId, variables })
  -> { status, body, produced }
```

行为：

- 按 `stepId` 在 manifest.steps 查找；找不到抛 `CAPTURE_STEP_NOT_FOUND`。
- 用 `variables` 对 `url_template` / `response.body` 做 `{{var}}` 替换（仅字符串值替换）。
- 校验 `placeholders` 里声明的变量在 `variables` 中都存在，缺失抛 `CAPTURE_MISSING_VARIABLE`。
- 返回录制响应的 `{ status, body }`，并按 `produces` 映射计算 `produced` 变量。
- 不读文件系统之外的资源，不调用 `fetch`/`http`/`https`。

第一版只做「单步回放 + 变量替换 + produces 提取」，不做真实签名计算、不做重试、不做风控模拟。签名/token 不可复放的步骤在后续真实抓包阶段标记 `api_unavailable`，第一版不实现该降级逻辑（mock client 永远回放成功响应）。

## 本地执行器行为（capture_http 分支）

`createCaptureHttpExecutor({ root, config })` 实现 executor adapter 五方法，复用 rpa-state，行为对齐 `YingdaoRpaExecutor` 的状态推进语义，但状态由「mock 回放 manifest」驱动，而不是「等待外部 callback」。

- `createAsset(task, context)`：加载 manifest，回放 `asset_generation` 阶段步骤，把产出的 `asset_id` 写入 rpa-state 为 `asset_confirmed`，返回 asset。
- `submitVideo(task, asset, context)`：回放 `remote_submit` 步骤，写入 `submitted` 和稳定 `remote_evidence`（`evidence_source` 归一为 `direct_submission`，与现有 bridge 一致）。
- `querySubmission(remoteEvidence, context)`：回放 `remote_query` 步骤，返回 `ready` 或 `unknown`。
- `downloadArtifact(remoteEvidence, destination, context)`：回放 `download` 步骤，在批次 `download_dir` 下生成占位 artifact 文件（第一版用最小占位文件，不下载真实视频），写入 `completed` 和 artifact（`relative_path` 必须批次相对），返回 artifact。
- `reconcileSubmission(task, checkpoint, context)`：读 rpa-state，与现有 bridge 一致。

复用约束：

- 复用 `createRpaTaskPackage` / `writeRpaTaskPackage` 生成 task package（capture_http 同样需要任务包，便于未来切换到真实抓包时外部执行器复用）。
- 复用 `registerRpaCallbackToken` / `revokeRpaCallbackToken`：第一版 capture executor 直接写 rpa-state，不强制走 callback；但 token 仍注册，保持 state 结构一致，便于 reconcile 和未来真实联调。
- `downloadArtifact` 生成的占位 artifact 必须满足现有 callback 的 artifact 安全约束：`relative_path` 批次相对、是普通文件、realpath 在批次目录内。

超时与恢复沿用现有 bridge 表（asset/submit/query/download 超时 → `interrupted_unknown`）。第一版 mock 回放是同步完成的，超时主要用于异常路径测试。

## 状态恢复

capture_http 分支继承现有安全状态机：

- `confirmed → generating_asset → asset_confirmed → submitted → download_pending → completed`
- 提交前失败 `failed_pre_submit`，提交边界不明 `interrupted_unknown`。

rpa-state 文件位置不变：`batches/<batch_id>/rpa/state/<task_id>.json`。服务重启时只从 state 恢复，不自动重跑、不自动回放。

## 测试计划

无积分测试（第一版必须全部覆盖）：

- manifest parser：合法 manifest 解析、缺字段拒绝、重复 id 拒绝、未知 phase 拒绝、`sanitized:false` 拒绝、含敏感头拒绝。
- 脱敏规则：删除 cookie/authorization/csrf/set-cookie、掩码 body 敏感字段、report 完整、URL query 敏感参数删除。
- mock HTTP client：按 stepId 回放、变量替换、placeholder 缺失抛错、未知 stepId 抛错、produces 提取正确、绝不发起网络请求。
- capture flow 集成：用 fixture manifest 驱动 capture executor，覆盖 `createAsset → submitVideo → querySubmission → downloadArtifact` 完整状态流转，artifact 落批次目录且批次相对。
- 默认路径回归：`executionBackend` 缺省/`playwright` 时 `createExecutorForBackend` 仍返回 playwright executor；`yingdao_rpa` 无 `rpa.mode` 或 `rpa.mode=default` 时仍返回现有 bridge；新增模式不影响既有执行后端配置测试。

人工/真实测试（不在第一版，需用户授权积分后才做）：

1. 用真实登录态采集「手里有货」HAR（上传、手持图、提交、轮询、下载）。
2. 用脱敏工具清洗成 manifest，人工复核 report 无敏感残留。
3. 只跑 1 条商品，用户确认消耗积分后，先验证回放能否复现远端 work_id。
4. 验证本地批次状态、下载文件、飞影作品时间、rpa-state 一致。

## 不做范围

- 第一版不做真实飞影 HAR 采集，不做真实网络回放，不消耗积分。
- 不在第一版实现签名/一次性 token 计算，不实现 `api_unavailable` 降级到网页自动化的逻辑。
- 不新增顶层 `executionBackend`，不改默认 `playwright` 路径。
- 不删除 Playwright executor、不重写 `yingdao_rpa` 现有 bridge。
- 不做 TagUI，不安装 `tagui_rpa`。
- 不把原始 HAR、cookie、authorization、CSRF token、登录态、批次数据、下载视频、日志、截图、outputs 或 node_modules 提交到 git。

## 开放问题

- 飞影私有接口是否可稳定复放未知；需要真实采集后才能决定哪些步骤可 HTTP 化，哪些必须网页兜底。
- 真实 manifest 采集方式（浏览器 DevTools 导出 HAR、还是 mitmproxy 脚本）待用户授权后确定。
- 第一版占位 artifact 是最小空文件；真实下载阶段的文件校验（大小、mp4 头）留到真实联调。

## 第一版实施顺序

1. 设计 spec + 实现 plan（本文件 + `docs/superpowers/plans/2026-07-16-capture-http-rpa.md`）。
2. manifest parser + 脱敏门禁 + 测试。
3. 脱敏规则工具 + 测试。
4. mock HTTP client + 测试。
5. capture_http 执行器分支 + capture flow 集成测试，接入 `createExecutorForBackend` 的 `rpa.mode` 分支。
6. 文档与 PROJECT_HANDOFF 更新。

真实抓包和真实联调不阻塞第一版。等本地无积分流程通过后，再向用户申请积分授权、采集真实 HAR、只跑 1 条商品校准。
