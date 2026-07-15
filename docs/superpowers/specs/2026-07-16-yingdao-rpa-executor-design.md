# 影刀 RPA 执行器设计

## 目标

在已跑通的本地 GUI + Playwright 飞影「手里有货」链路之外，新增一个影刀 RPA 版本，用来降低对网页按钮定位的依赖，并为后续抓包直连飞影私有接口留下接口边界。

本次设计的核心不是重写 GUI，而是把“飞影执行层”抽成可替换能力：

- GUI 继续负责商品录入、素材上传、批次状态、失败重跑和积分确认。
- Playwright 执行器继续保留，作为当前稳定可用版本。
- 新增影刀 RPA 执行器，优先尝试抓包/HTTP 请求方式，必要时用影刀网页自动化兜底。

## 背景判断

当前项目执行链路是 Node.js + Playwright 操作飞影网页，不是通过 JSON 抓包直接向飞影传输数据。最近自定义文案校准批次 `batch-custom-script-20260715155417` 已证明：

- 自定义文案填入已跑通：日志出现 `field_filled`、`field_read`、`script-filled`。
- 外层「立即生成」已经点击。
- 当前问题转移到远端作品唯一识别和下载阶段。

因此影刀版优先解决两个痛点：

1. 飞影页面按钮定位不稳定，容易点错确认、删除、下载等相邻按钮。
2. 提交后依赖页面“最新作品”识别远端作品，证据不够稳定。

## 外部依据

- 影刀官网说明其支持 Windows、Mac，以及 Web 程序自动化，符合本项目跨平台目标：https://www.yingdao.com/
- 影刀社区有使用 webhook、队列和 Open API 批量触发工作流的实践，适合本地 GUI 派发任务、RPA 执行并回写状态的模式：https://www.yingdao.com/community/detaildiscuss?id=970603801570009088
- 影刀社区也强调网页元素定位建议使用稳定 XPath / placeholder，而不是易变 id，这与本项目避免纯坐标点击的目标一致：https://www.yingdao.com/community/detaildiscuss?id=827571791869353984

## 设计原则

- 不污染已跑通版本：影刀能力通过新执行器接入，不删除 Playwright。
- 抓包优先：能用 HTTP 请求稳定复放的步骤不再用按钮点击。
- RPA 兜底：遇到签名、一次性 token、风控或接口无法复放时，影刀执行网页动作。
- 状态以 GUI 为准：影刀只负责执行和回传结果，不直接改批次 JSON。
- 真实飞影执行仍需用户确认，因为会消耗积分。
- 第一版优先建立桥接协议和模拟验证，不急于跑大批量真实任务。

## 总体架构

```text
本地 GUI
  ├─ 批次创建 / 素材上传 / 策略选择
  ├─ 积分确认 / 失败重跑 / 状态展示
  └─ Execution Coordinator
        ├─ Playwright Executor（现有）
        └─ Yingdao RPA Executor（新增）
              ├─ 任务包导出
              ├─ 影刀触发适配
              ├─ 回调接收
              └─ 结果归档

影刀 RPA
  ├─ 读取任务包
  ├─ 抓包 HTTP 执行（优先）
  ├─ 网页自动化执行（兜底）
  ├─ 下载成片
  └─ POST 回调本地 GUI
```

## 执行器选择

新增配置项：

```json
{
  "executionBackend": "playwright"
}
```

可选值：

| 值 | 含义 |
| --- | --- |
| `playwright` | 当前默认执行器，保持现有行为。 |
| `yingdao_rpa` | 新增影刀执行器，向影刀派发任务并等待回调。 |

GUI 第一版不需要新增复杂设置页，只在本地配置中切换。等影刀链路稳定后，再考虑在 GUI 加“执行引擎”选择。

## 任务包协议

本地 GUI 在执行每条商品时生成一个任务包，保存到批次目录：

```text
batches/<batch_id>/rpa/tasks/<task_id>.json
```

任务包字段：

```json
{
  "schema_version": 1,
  "batch_id": "batch-id",
  "task_id": "task-id",
  "execution_key": "snapshot-key",
  "sku": "SKU",
  "product_name": "商品名称",
  "selling_points": "核心卖点",
  "category": "品类",
  "product_image_path": "/absolute/path/product.png",
  "person_image_path": "/absolute/path/person.png",
  "person_strategy": "auto_pool",
  "script_strategy": "mixed",
  "script": "自定义口播",
  "resolved_script_mode": "custom",
  "download_dir": "/absolute/path/batches/<batch_id>",
  "callback_url": "http://127.0.0.1:<port>/api/rpa/callback",
  "callback_token": "ephemeral-token"
}
```

安全要求：

- 路径必须是服务端已批准的素材路径，沿用现有 `approvedImagePath` 规则。
- `callback_token` 每次执行生成，不能写入 git。
- 任务包不包含飞影账号密码、cookie 或浏览器登录态。

## 回调协议

新增本地接口：

```http
POST /api/rpa/callback
```

请求头：

```text
X-RPA-Callback-Token: <callback_token>
```

请求体：

```json
{
  "schema_version": 1,
  "batch_id": "batch-id",
  "task_id": "task-id",
  "execution_key": "snapshot-key",
  "status": "submitted",
  "phase": "remote_submit",
  "remote_evidence": {
    "evidence_source": "yingdao_rpa",
    "remote_id": "632410",
    "remote_url": null,
    "work_key": "632410",
    "label": "2026-07-16 00:22:23"
  },
  "artifact": {
    "artifact_id": "632410",
    "relative_path": "batches/batch-id/2026-07-16T00-22-23-632410.mp4"
  },
  "error": null
}
```

允许的状态：

| status | 含义 |
| --- | --- |
| `asset_confirmed` | 手持商品图已生成并确认。 |
| `submitted` | 视频已提交，返回稳定远端证据。 |
| `download_pending` | 视频已完成，准备下载。 |
| `completed` | 成片已下载到本地。 |
| `failed_pre_submit` | 提交前失败，不应消耗外层视频积分。 |
| `failed_remote` | 飞影远端明确失败。 |
| `interrupted_unknown` | 影刀无法判断是否已提交，必须人工核对。 |

回调必须校验 `batch_id`、`task_id`、`execution_key` 与当前批次一致，避免旧任务污染新批次。

## 影刀执行模式

### 抓包 HTTP 模式

影刀流程优先尝试用 HTTP 请求组件执行：

1. 上传人物图和商品图。
2. 创建手持商品图。
3. 轮询手持商品图结果。
4. 提交外层视频。
5. 轮询视频状态。
6. 下载视频。
7. 回调本地 GUI。

如果飞影接口需要动态签名、一次性 token、复杂浏览器上下文或触发风控，则该步骤标记为 `api_unavailable`，切换到网页自动化兜底。

### 网页自动化兜底

影刀使用网页自动化时，不允许使用裸坐标作为主定位方式。定位优先级：

1. 稳定 XPath / placeholder / 文本。
2. 图片识别或 OCR 辅助。
3. 坐标只作为最后兜底，并必须配合页面文字/截图校验。

关键动作都要回传证据：

- 弹窗打开。
- 商品图上传后截图或图片 URL。
- 手持图生成完成。
- 外层视频提交后远端作品 ID 或时间标签。
- 下载文件路径和文件大小。

## 本地执行器行为

`YingdaoRpaExecutor` 实现现有 executor adapter：

- `createAsset(product, context)`：生成任务包并触发影刀执行到手持图确认阶段，等待回调 `asset_confirmed`。
- `submitVideo(product, asset, context)`：继续等待或触发影刀提交视频，要求返回稳定 `remoteEvidence`。
- `querySubmission(remoteEvidence)`：通过回调状态或影刀查询结果判断是否 ready。
- `downloadArtifact(remoteEvidence, destination)`：等待影刀下载结果并注册 artifact。
- `reconcileSubmission(product, checkpoint)`：根据影刀回调、任务包状态和下载目录恢复中断状态。

第一版可以先做“单任务同步等待”：本地发出任务包后等待回调。后续再升级为真正的队列并发。

## 状态恢复

影刀版必须继承现有安全状态机：

- `confirmed → generating_asset → asset_confirmed → submitted → download_pending → completed`
- 提交前失败进入 `failed_pre_submit`
- 提交边界不明确进入 `interrupted_unknown`

新增 RPA 本地状态文件：

```text
batches/<batch_id>/rpa/state/<task_id>.json
```

用于记录：

- 任务包路径。
- 影刀任务 ID 或队列 ID。
- 最近一次回调。
- 远端证据。
- 下载文件。
- 错误信息。

服务重启时，只从这些文件恢复状态，不自动重新生成。

## GUI 变化

第一版 GUI 只做轻量提示：

- 批次详情显示执行引擎：`Playwright` 或 `影刀 RPA`。
- 失败详情中显示 RPA 阶段和最后一次回调。
- `interrupted_unknown` 仍需要人工核对后才能重试。

暂不新增影刀账号、队列、流程编辑界面。这些由影刀客户端/控制台管理。

## 测试计划

无积分测试：

- `YingdaoRpaExecutor` 任务包生成测试。
- 回调接口鉴权测试。
- 回调 `completed` 后批次进入 `completed` 并注册 artifact。
- 回调 `failed_pre_submit` 不进入外层提交状态。
- 回调 `interrupted_unknown` 后 GUI 可显示异常并允许人工核对。
- 服务重启后从 RPA state 文件恢复，不自动重跑。

人工/真实测试：

1. 安装并登录影刀客户端。
2. 用测试任务包让影刀只回调模拟成功，不访问飞影。
3. 影刀打开飞影页面，人工确认登录态可用。
4. 跑 1 条真实商品，用户确认消耗积分后执行。
5. 验证本地批次状态、下载文件、飞影作品时间、RPA 日志一致。

## 不做范围

- 不在第一版内实现完整飞影私有 API 逆向。
- 不把飞影登录态或 cookie 写入项目文件。
- 不做多机分布式调度。
- 不做大批量并发生成。
- 不删除 Playwright 执行器。
- 不绕过飞影平台权限、积分或风控机制。

## 开放问题

- 影刀本机客户端尚未安装，需要用户安装并登录后才能做真实联调。
- 影刀是否提供本地 CLI / webhook 触发能力需要实机确认；如果没有，就先通过共享任务包目录和手动启动影刀流程联调。
- 飞影私有接口是否可稳定复放未知；需要先采集 HAR 或由影刀流程记录请求，再决定哪些步骤可 HTTP 化。
