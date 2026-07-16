# 抓包 HTTP RPA 操作流程（Runbook）

本 runbook 描述如何从飞影「手里有货」流程采集 HTTP 请求、脱敏入库、并在本地离线回放验证。配合设计依据 `docs/superpowers/specs/2026-07-16-capture-http-rpa-design.md` 使用。

## 能力边界（先读这一节）

当前（Phase 1）已实现的能力，**全部不消耗积分、不访问网络**：

- GUI 批次可勾选“同时录制抓包产物”：真实生成仍由 Playwright 完成，同时录制 HAR；执行完成后可在批次详情中点击“抽取请求步骤”“脱敏生成 manifest”“离线回放验证”。
- 从本地 HAR 自动抽取飞影「手里有货」主链路请求（`hiflyworks-api.lingverse.co`），并给上传授权、手持图生成、视频提交、轮询和下载步骤补齐可离线回放的 phase / placeholders / produces。旧版或未知 `hifly.cc/api/*` 请求仍会保守标记为 `unclassified`，需要人工复核。
- 解析脱敏后的 capture manifest（`src/rpa/capture/manifest.js`）。
- 离线脱敏原始抓包步骤（`src/rpa/capture/redact.js` + `scripts/redact-capture-source.mjs`）。
- 用 mock HTTP client 回放已录制响应（`src/rpa/capture/mock-http-client.js`），**只回放、绝不发起真实请求**。
- `capture_http` 执行器（`src/executors/capture-http-executor.js`）按 manifest 推进 rpa-state，`downloadArtifact` 只写**占位文件**，不下载真实视频。

**当前做不到**（属后续阶段，需另授权）：

- 真实发起飞影 HTTP 请求 / 真实生成视频 / 真实下载 mp4。真实 HTTP client 尚未实现，`capture_http` 执行器现在永远走 mock 回放。
- 全自动覆盖所有飞影页面变体。当前已覆盖 2026-07-16 采集到的 `hiflyworks-api.lingverse.co` 手里有货主链路；若飞影改接口、字段或风控，仍需重新校准。

因此：**配好 manifest 并把 `rpa.mode` 设为 `capture_http`，也只会离线回放 + 生成占位文件，不会消耗积分、不会出真实视频。** 真实联调是另一阶段，且必须先经用户授权积分、只跑 1 条商品。

## 安全红线

- 原始 HAR、cookie、authorization、CSRF token、登录态、签名、批次数据、下载视频、日志、截图、outputs、node_modules **绝不进 git**。
- 原始抓包产物只放本地 `rpa/capture/raw/`（已被 `.gitignore` 屏蔽，连同 `*.har`）。
- 入库的只能是脱敏后的 manifest（`sanitized: true`，过门禁）。脱敏报告 `report` 也不进 git（虽只含路径不含值，仍按敏感处理）。
- 真实采集需登录态，请在自己可控的环境操作；登录态本身不进入任何入库文件。

## 前置条件

- 本仓库已可在本地运行（`npm install` 完成）。
- 一个可登录的飞影账号（真实采集时用；离线脱敏/回放不需要）。
- 浏览器 DevTools（Chrome / Edge 自带）或 mitmproxy（可选，用于更干净的抓包）。
- 只准备 **1 条商品** 的素材（商品图 + 可选人物图 + 商品信息），用于首次采集。

## GUI 抓包工作流（推荐）

1. 在 GUI 的单条录入、批量录入或批量导入中勾选“同时录制抓包产物”。
2. 按正常流程开始生成；这一步仍会真实访问飞影并消耗积分，因为当前生产出片仍由 Playwright 完成。
3. 批次完成后，批次详情会显示“抓包工作流”状态。HAR 路径只在服务端保存，GUI 不暴露原始内容。
4. 点击“抽取请求步骤”，系统从 HAR 生成 `batches/<batch_id>/capture/raw-steps.json`。这一步不消耗积分。
5. 复核 raw steps：常规 `hiflyworks-api.lingverse.co` 手里有货链路会自动补齐 `phase` / `placeholders` / `produces`；若出现 `unclassified`，需要人工判断是否删除或补齐后再继续。
6. 点击“脱敏生成 manifest”，系统生成 `manifest.json` 和 `redaction-report.json`。若仍含敏感键或 phase 不合法，会直接失败。
7. 点击“离线回放验证”，系统用 mock client 验证变量链。通过后状态为“离线回放通过”。

注意：第 4～7 步都是本地后处理，不会重新打开飞影、不会重新生成视频、不会再次消耗积分。

## 手动流程总览

```text
[无积分]                                            [消耗积分，后续阶段]
1. 采集原始 HAR ──► 2. 整理 raw-steps.json ──► 3. 脱敏 ──► 4. 复核 report
                      (人工)                (CLI)        (人工)
                                                                   │
5. 门禁验证 ◄─────────────────────────────────────────────────────┘
   (CLI 内嵌)
   │
6. 离线回放自检（mock，无网络、无积分）
   │
   ▼
7. 真实回放 —— ⚠️ 当前未实现，需授权积分 + 只跑 1 条（后续阶段）
```

步骤 1～6 都不消耗积分。步骤 7 是另一阶段，本 runbook 只给出约定，不执行。

## 步骤 1：采集原始 HAR（无积分，但用到登录态）

目标：录下「手里有货」单条商品的完整请求链——上传商品图、上传人物图、手持图生成、提交视频、轮询状态、下载视频。

用 Chrome / Edge DevTools：

1. 登录飞影，打开 `https://hifly.cc/goods`。
2. 打开 DevTools → Network 面板，勾选 **Preserve log**，清空当前记录。
3. Filter 选 `Fetch/XHR`，重点关注 `hiflyworks-api.lingverse.co` 与 `hifly.cc` 域名下的接口请求（跳过静态资源、第三方统计）。
4. 手动走完**一条**商品的完整流程：上传商品图 →（若需要）上传人物图 → 生成手持图 → 确认 → 立即生成视频 → 等待生成完成 → 下载。
5. 在 Network 面板右键 → **Save all as HAR with content**，保存到 `rpa/capture/raw/hifly-goods-<日期>.har`（该目录已被 gitignore）。

mitmproxy 备选（当 DevTools 抓不全或想脚本化时）：用 `mitmproxy --save-stream-file` 录流，再导出需要的 entry。本 runbook 不展开，首次建议直接用 DevTools。

注意：

- 只跑 1 条商品，避免混杂多条请求难以对应。
- HAR 文件含完整登录态，**只存本地 `rpa/capture/raw/`**，不要复制到别处，不要提交。

## 步骤 2：人工整理成 raw-steps.json

脱敏工具不解析 HAR，需要人工把关键请求整理成下面的结构。这一步必须人来判断每个请求属于哪个阶段、哪些响应字段要传给后续步骤。

骨架示例（`rpa/capture/raw/hifly-goods-raw-steps.json`，含会被脱敏的敏感字段做演示）：

```json
{
  "source": "hifly_goods",
  "captured_at": "2026-07-16T00:00:00Z",
  "steps": [
    {
      "id": "upload_product_image",
      "phase": "asset_generation",
      "method": "POST",
      "url_template": "https://hifly.cc/api/goods/upload?sign=abc123",
      "placeholders": ["{{product_image_path}}"],
      "request": { "headers": { "content-type": "multipart/form-data", "cookie": "sid=真实会话", "authorization": "Bearer 真实令牌" } },
      "response": {
        "status": 200,
        "headers": { "set-cookie": "sid=真实会话" },
        "body": { "code": 0, "data": { "image_id": "真实id", "access_token": "真实token" } }
      },
      "produces": { "product_image_id": "$response.body.data.image_id" }
    }
  ]
}
```

整理要点：

- **id**：人工起一个稳定名称，如 `upload_product_image`、`create_hands_on_image`、`submit_video`、`poll_video_status`、`download_video`。
- **phase**：归类到 `asset_generation` / `remote_submit` / `remote_query` / `download`（见下文「phase 归类」）。
- **method / url_template**：照抄 HAR 的 method 和 url。url 里的动态段（如作品 id）改成占位符 `{{remote_id}}`。
- **placeholders**：列出 `url_template` 和 body 里用到的所有 `{{var}}`。
- **response.status / response.body**：抄 HAR 响应的 status 和 body（JSON）。body 里真实 id 可以保留（脱敏只删键名敏感的字段，不删业务 id）。
- **response.headers / request.headers**：可填，脱敏会删除其中敏感头；`response.headers` 脱敏后会被整体丢弃，`request.headers` 保留非敏感项（如 `content-type`）。
- **produces**：声明本步响应里哪些字段要作为变量传给后续步骤（见下文「produces 判定」）。
- **request.body 不用整理**：脱敏产物不保留 request.body，提交体里的签名天然不会泄露。

## 步骤 3：脱敏（跑 CLI）

```bash
node scripts/redact-capture-source.mjs rpa/capture/raw/hifly-goods-raw-steps.json \
  --out=rpa/capture/fixtures/hifly-goods-<日期>.json \
  --report=rpa/capture/raw/hifly-goods-<日期>.report.json
```

- `--out` 是脱敏后的 manifest，**可入库**（建议放 `rpa/capture/fixtures/`）。
- `--report` 是脱敏报告，**不进 git**（放 `rpa/capture/raw/`）。
- CLI 内部会再用 `parseCaptureManifest` 做一次门禁扫描作为双重保险；若仍残留敏感键，退出码 2 并提示路径。

不传 `--out` 时 manifest 打到 stdout，不传 `--report` 时只在 stderr 打印删除数量摘要。

## 步骤 4：人工复核 report

打开 `*.report.json`，逐项确认：

- `report.removed` 里应能看到所有预期敏感项的路径：`cookie`、`authorization`、`set-cookie`、`x-csrf-token`、`x-xsrf-token`、以及 body 里名字含 `token`/`session`/`auth`/`ticket`/`sign`/`secret` 的字段。
- 对 manifest 文件本身做一次兜底搜索，确认无残留：

```bash
grep -niE 'cookie|authorization|set-cookie|csrf|xsrf|token|session|secret|ticket' rpa/capture/fixtures/hifly-goods-<日期>.json
```

  预期只可能命中**业务字段名或 url 路径段**（如接口路径含 `session` 字样），不应命中任何真实凭据值。若命中疑似凭据，回步骤 2 检查该字段键名是否需要人工改名后再脱敏。

- 确认 `sanitized: true`、`schema_version: 1`。
- 确认每个 step 的 `response.headers` 已被丢弃（不存在）、`request.headers` 只剩非敏感项。

## 步骤 5：门禁验证

步骤 3 的 CLI 已内嵌门禁。若想单独验证某个 manifest 是否可被加载：

```bash
node --input-type=module -e 'import("./src/rpa/capture/manifest.js").then(async ({ parseCaptureManifest, loadCaptureManifest }) => { const m = await loadCaptureManifest(process.argv[1]); console.log("门禁通过，步骤数", m.steps.length); })' rpa/capture/fixtures/hifly-goods-<日期>.json
```

通过则说明结构合法、无敏感键残留。失败会抛 `INVALID_CAPTURE_MANIFEST` 并指出具体原因（缺字段、未知 phase、重复 id、含敏感键等）。

## 步骤 6：离线回放自检（无积分、无网络）

验证脱敏 manifest 在本地能被解析 + 占位符/产出变量链自洽。**不访问网络、不消耗积分**：

```bash
node --input-type=module -e "$(cat <<'JS'
import { loadCaptureManifest, selectStepsByPhase, CAPTURE_PHASES } from "./src/rpa/capture/manifest.js";
import { createMockHttpClient } from "./src/rpa/capture/mock-http-client.js";
const manifest = await loadCaptureManifest(process.argv[1]);
const client = createMockHttpClient({ manifest });
const vars = { product_image_path: "sample.jpg", person_image_path: "person.jpg" };
for (const phase of CAPTURE_PHASES) {
  for (const step of selectStepsByPhase(manifest, phase)) {
    const out = await client.request({ stepId: step.id, variables: vars });
    Object.assign(vars, out.produced);
  }
}
console.log("离线回放自洽 OK，产出变量：", vars);
JS
)" rpa/capture/fixtures/hifly-goods-<日期>.json
```

说明：

- 初值变量 `product_image_path` / `person_image_path` 是执行器在 `asset_generation` 阶段注入的（来自 task package）；若你的 manifest 第一步用了别的占位符名，按 `placeholders` 调整初值。
- 自洽的标准：全流程不抛 `CAPTURE_MISSING_VARIABLE`（占位符都有值）和 `CAPTURE_PRODUCES_MISSING`（produces 路径都能取到）。
- 也可把新 manifest 临时设为 fixture，参考 `test/capture-http-executor.test.js` 的集成测试方式跑一次完整状态流转。

## 步骤 7：真实回放（⚠️ 消耗积分，当前未实现）

**当前 `capture_http` 执行器只有 mock 回放，没有真实 HTTP client。** 即使 manifest 准备好、config 切到 `capture_http`，也只会离线回放 + 写占位文件，不会出真实视频。

真实回放属于后续阶段，启动前必须满足：

1. 用户明确授权消耗积分。
2. 只跑 1 条商品。
3. 实现真实 HTTP 执行器（替换 mock client，按 manifest 发真实请求、处理签名/一次性 token/风控；不可复放的步骤标记 `api_unavailable` 并回退网页自动化）。

**在用户授权前，不做这一步。** 本 runbook 只记录约定，便于将来授权后直接接上。

## HAR → capture step 字段对照表

| capture step 字段 | HAR 来源 | 说明 |
|---|---|---|
| `id` | 人工命名 | 稳定唯一，如 `submit_video` |
| `phase` | 人工归类 | 四选一，见下节 |
| `method` | `entry.request.method` | `GET`/`POST` 等 |
| `url_template` | `entry.request.url` | 动态段替换为 `{{var}}` |
| `placeholders` | 由 url/body 推导 | 列出所有 `{{var}}` |
| `response.status` | `entry.response.status` | 整数 |
| `response.body` | `JSON.parse(entry.response.content.text)` | 抄业务结构 |
| `response.headers` | `entry.response.headers` | 可选；脱敏后整体丢弃 |
| `request.headers` | `entry.request.headers` | 可选；脱敏删敏感、留 `content-type` 等 |
| `produces` | 人工判定 | 变量名 → `$response.body.<路径>` |

## phase 归类与 produces 判定

四个阶段及典型请求：

| phase | 典型请求 | 执行器注入的起始变量 | 通常 produces |
|---|---|---|---|
| `asset_generation` | 上传商品图 / 上传人物图 / 生成手持图 | `product_image_path`、`person_image_path` | `asset_id`（必须，执行器用它构造 asset） |
| `remote_submit` | 提交视频生成 | `asset_id` | `remote_id`（必须，作为远端作品标识） |
| `remote_query` | 轮询生成状态 | `remote_id` | 通常无（状态由执行器读取） |
| `download` | 下载视频 | `remote_id` | `artifact_filename`（可选，缺省用 `<remote_id>.mp4`） |

变量链：`product_image_path`/`person_image_path`（注入）→ 中间 `product_image_id`/`person_image_id`（各上传步 produce）→ `asset_id` → `remote_id` → `artifact_filename`。每一步的 `produces` 必须能从本步 `response.body` 取到，否则回放抛 `CAPTURE_PRODUCES_MISSING`。

## 不进 git 的产物清单

| 产物 | 存放 | 进 git？ |
|---|---|---|
| 原始 HAR | `rpa/capture/raw/*.har` | 否（gitignore） |
| 人工整理的 raw-steps | `rpa/capture/raw/*-raw-steps.json` | 否（gitignore） |
| 脱敏报告 report | `rpa/capture/raw/*.report.json` | 否（gitignore） |
| 脱敏 manifest | `rpa/capture/fixtures/*.json` | **是**（过门禁后） |
| 运行期占位 artifact | `batches/<batch_id>/...` | 否（gitignore） |

## 故障排查

- **CLI 退出码 2（门禁失败）**：脱敏产物仍含敏感键。通常是某个 produces 的键名本身含敏感词（如把变量命名为 `access_token`），改用业务名（如 `asset_id`）后重新脱敏。
- **`CAPTURE_MISSING_VARIABLE`**：回放时某步的占位符没有值。检查上游步骤的 `produces` 是否漏声明、变量名是否与占位符一致。
- **`CAPTURE_PRODUCES_MISSING`**：`produces` 路径在 `response.body` 里取不到。检查 body 结构与路径写法（`$response.body.data.image_id`）。
- **grep 命中疑似凭据**：脱敏按键名判断，若敏感值藏在非敏感键名下（罕见），需人工在 raw-steps 里删除该字段后再脱敏。
- **manifest 加载报 `sanitized must be true`**：直接编辑过脱敏产物或用了未脱敏文件。回到步骤 3 用 CLI 重新生成，不要手改 `sanitized` 标记。
