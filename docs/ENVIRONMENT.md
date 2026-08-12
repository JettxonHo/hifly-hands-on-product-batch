# 运行环境与交付打包说明

## 本地依赖

- macOS 12+ 或 Windows 10+
- Node.js 20+，推荐 22+
- npm
- Playwright Chromium
- 飞影账号，且账号可访问 `https://hifly.cc/goods`
- GitHub CLI `gh`，仅在需要推送 GitHub 或创建 PR 时使用

## 首次安装

```bash
npm install
npx playwright install chromium
cp config.example.json config.local.json
```

然后运行：

```bash
npm run login
```

在弹出的浏览器中登录飞影。确认可以进入 `https://hifly.cc/goods` 后，回到终端按 Enter 保存登录态。

## GUI 启动

Mac 和 Windows 使用同一个命令：

```bash
npm run gui
```

启动后终端会打印本地地址，例如：

```bash
Local workbench: http://127.0.0.1:4317
```

身份关闭时工作台只绑定 `127.0.0.1`。如果 `4317` 被占用，会自动尝试下一个端口。也可以临时指定端口：

```bash
HIFLY_GUI_PORT=4320 npm run gui
```

Windows PowerShell 可使用：

```powershell
$env:HIFLY_GUI_PORT=4320; npm run gui
```

## A01-A14 本地全链路演示

演示入口与传统 GUI 配置完全隔离，不读取或覆盖 `config.local.json`，不读取飞影登录态，也不访问 `hifly.cc`。Mac 和 Windows 使用同一套 Node 脚本；只要求 Docker Desktop 的 `docker compose` 可用：

```bash
npm run demo
```

启动顺序固定为：

```text
Docker Compose up（project=hifly-vsa-demo，DB port 从 55433 起自动选择）
→ PostgreSQL ready
→ identity
→ assets
→ projectContent
→ copyGeneration
→ copyQuality
→ copyReview
→ avatarSelection
→ videoPlanning
→ productionOrders
→ manualHandoff
→ manualExecution
→ artifactVerification（work-verification migration）
→ workDelivery
→ demo server
→ /login.html
```

演示启用 A01-A14 全部 feature，使用现有 `phase1_controlled_test_double` provider/evaluator 和 `src/executors/fake-executor.js`。`realLive.batch.enabled` 为 `false`，runtime auth 和 real capture transport 都是 fail-closed；旧工作台生成按钮也不会切换到 Playwright、影刀或真实 Capture HTTP，因此不消耗飞影积分。演示 server 的本地固定测试凭据为：

```text
账号：demo-admin@demo.local
临时密码：Demo-Local-2026-Only!
```

首次登录会进入已有的强制改密页面，请设置新的本地密码。该凭据只用于本地演示，不得复用到真实环境。

演示数据库使用独立的 `docker-compose.demo.yml`、Compose project `hifly-vsa-demo`、volume `hifly_vsa_demo_data`，loopback 端口从 `55433` 起自动选择可用值，不会影响 `docker-compose.identity.yml` 的 `55432` 测试库。素材、交接包等本地演示文件默认保存在项目 `.local-demo/`。停止时默认保留数据：

```bash
npm run demo:stop
```

只有明确需要重置演示数据库时才运行：

```bash
npm run demo:reset
```

该命令删除演示专用 PostgreSQL volume，但保留 `.local-demo/` 中的素材、交接包等本地文件。

可选的本地环境变量只改变演示运行位置，不会进入真实配置路径：`HIFLY_DEMO_DB_PORT`（设置后固定该端口；未设置时从 `55433` 起自动选择）、`HIFLY_DEMO_GUI_PORT`（默认 `4317`）和 `HIFLY_DEMO_DATA_DIR`（默认项目 `.local-demo/`）。

## 企业身份模式（VSA-A01）

身份模式默认关闭；关闭时仍是原来的 127.0.0.1 单用户工作台，不需要数据库。
启用后 PostgreSQL 是唯一权威身份库，不可用时服务拒绝启动，不会回退到 JSON 文件。

本地验证可启动专用 PostgreSQL：

```bash
docker compose -f docker-compose.identity.yml up -d --wait
DATABASE_URL=postgresql://hifly_test:local-test-only@127.0.0.1:55432/hifly_identity_test npm run migrate:identity
```

然后在 `config.local.json` 明确设置本地测试值：

```json
{
  "gui": {
    "identity": {
      "enabled": true,
      "databaseUrl": "postgresql://hifly_test:local-test-only@127.0.0.1:55432/hifly_identity_test",
      "trustedHosts": ["127.0.0.1:4317"],
      "trustedOrigins": ["http://127.0.0.1:4317"],
      "cookieSecure": false
    }
  }
}
```

生产部署必须使用 HTTPS、`cookieSecure: true`、实际域名的 Host/Origin 白名单，且建议通过
`DATABASE_URL` 注入连接信息。部署流程先显式执行 `npm run migrate:identity`；启用素材、项目内容与
文案生成、质检与审核时，再依次执行 `npm run migrate:assets`、`npm run migrate:project-content`、
`npm run migrate:copy-generation`、`npm run migrate:copy-quality`、`npm run migrate:copy-review` 与
`npm run migrate:avatar-selection` 与 `npm run migrate:video-planning`。应用启动只检查 schema
版本，不自动执行生产 migration。初始管理员 seed 只用于受控部署初始化，启用 seed
时 `CHANGE_ME` 占位密码会被拒绝。

项目内容、文案生成、质检、审核、人物选择与视频方案默认关闭。启用 A08 时 `gui.identity.enabled`、`gui.assets.enabled`、
`gui.projectContent.enabled`、`gui.copyGeneration.enabled`、`gui.copyQuality.enabled` 和
`gui.copyReview.enabled`、`gui.avatarSelection.enabled`、`gui.videoPlanning.enabled` 必须同时为 `true`。A01-A08 共用一个
PostgreSQL pool，但分别使用 `identity_schema_migrations`、`asset_schema_migrations`、
`project_content_schema_migrations`、`copy_generation_schema_migrations`、
`copy_quality_schema_migrations`、`copy_review_schema_migrations` 和
`avatar_selection_schema_migrations` 和 `video_planning_schema_migrations`。默认生成器、质检器、改写器和预检器的
`phase1_controlled_test_double` 只用于 Slice A 本地验收，不访问真实模型或飞影。

### DeepSeek 文案 Provider（P1-01，默认关闭）

生产配置默认保持 `COPY_GENERATION_PROVIDER=phase1_controlled_test_double`，不会访问外部模型。
只有在服务端明确设置 `COPY_GENERATION_PROVIDER=deepseek` 时，启动配置才要求服务端环境变量
`DEEPSEEK_API_KEY`；缺少该变量会在服务启动前失败关闭，不会回退到受控替身、其他模型或其他 Provider。
适配器使用 DeepSeek 官方 OpenAI-compatible endpoint `https://api.deepseek.com/chat/completions`、默认模型
`deepseek-v4-flash`、`thinking.type=disabled` 和 `response_format={"type":"json_object"}`。请求只投影已确认
商品文字事实与规范化 ContentBrief，不发送图片、图片 URL、本地路径、Hifly 凭据、Cookie 或浏览器会话。

官方参数说明以 [DeepSeek API 文档](https://api-docs.deepseek.com/api/create-chat-completion) 为准；本项目只在
输出为空、非法、截断或不满足 `{ "body": "string" }` 最小结构时对同一 Provider/模型重试一次。HTTP、认证、
限流和服务端错误不自动切换模型或 Provider。当前 PR 只交付可选择的 adapter 与配置，未执行真实 DeepSeek
smoke、未切换已部署环境；真实模型 activation pending。

### DeepSeek 语义质检（P1-02，默认关闭）

生产配置默认保持 `COPY_QUALITY_EVALUATOR=phase1_controlled_test_double`。只有服务端显式设置
`COPY_QUALITY_EVALUATOR=deepseek_hybrid` 时，质检 worker 才组合确定性事实/平台规则与 DeepSeek
语义质检；该模式同样要求 `DEEPSEEK_API_KEY`，缺失时在数据库 pool 创建前失败关闭。文案生成与
质检可独立选择，但共用同一个服务端 Key。

确定性规则掌握 `fact_gate` 与 `hard_block`；模型 finding 只会映射为 `review`，不能创建阻断结论、
不能批准文案。语义调用只发送文案正文、已确认商品文字事实、规范化 ContentBrief 与质检版本标识；
技术失败会让 QualityRun 失败，不创建虚假的 `passed` QualityResult。真实 DeepSeek activation 仍需
单独执行 smoke 并记录费用，当前默认部署配置不访问模型。

### DeepSeek 质检改写（P1-03，默认关闭）

生产配置默认保持 `COPY_QUALITY_REWRITER=phase1_controlled_test_double`。只有服务端显式设置
`COPY_QUALITY_REWRITER=deepseek` 时，异步改写 worker 才调用 DeepSeek；该模式要求
`DEEPSEEK_API_KEY`，缺失时在数据库 pool 创建前失败关闭。生成、质检和改写三个选择器彼此独立，
但共用同一个服务端 Key。

改写请求只投影冻结文案正文、当前商品修订中的已确认文字事实、规范化 ContentBrief、改写范围与指令，
以及被选质检 Finding 的最小文本字段。结构输出必须满足 `{ "body": "string" }`，结构错误最多重试一次；
HTTP、认证、限流和未知 Provider 错误不重试。成功结果不会覆盖原文案，而是由现有服务创建一个子草稿并
重新排队完整 QC；空结果、原文不变或非法结构都不会创建子版本，可由运营显式重试。真实 DeepSeek
activation 仍需单独执行 smoke 并记录费用，当前默认部署配置不访问模型。

本地数据库验证完成后可清理：

```bash
docker compose -f docker-compose.identity.yml down -v
```

### 改代码后必须重启 GUI（无热重载）

`npm run gui` 是 `node src/server/start.js`，ES module 在进程启动时一次性加载磁盘代码，**没有热重载**。改了 `src/` 任何文件后必须停旧进程再重启，否则跑的是旧代码：

```bash
lsof -nP -iTCP:4317 -sTCP:LISTEN   # 找 PID
kill <PID>
npm run gui
```

**端口自增陷阱**：`4317` 被占会自动跳 `4318`。如果旧进程没停干净就重启，新实例落 `4318` 加载新码、但浏览器标签还指 `4317` 跑旧码——会误以为重启了却仍跑旧码。务必先确认 `4317` 空闲。

## GUI 使用路径

1. 打开 `npm run gui` 输出的本地地址。
2. 单条录入商品，或上传 CSV/XLSX 与商品图片。
3. 在「待执行任务」检查批次和商品。
4. 点击「开始生成」，在确认弹窗中再次确认。
5. 等待自动化浏览器完成飞影页面的上传、确认、提交和下载。

CSV/XLSX 批量导入时，图片文件名建议与 `sku` 一致；也可以在 `image_path` 填写上传图片文件名。

## 配置项

`config.local.json` 从 `config.example.json` 复制而来，只在本机使用，不提交 Git。

- `gui.port`：默认本地端口，默认 `4317`。
- `gui.openBrowser`：是否启动后自动打开浏览器。
- `uploadLimits`：GUI 上传文件数量、大小和像素上限。
- `executionLock`：同一时间只允许一个批次执行的锁心跳与可疑阈值。
- `pointsEstimate`：积分估算版本。飞影视频创作积分可能变化，未知项用 `null`，不要按 0 估算。
- `hiflyUi`：飞影页面按钮和文案校准项。
- `personPool`：CLI 和运营人物素材池配置。

## 高级 CLI 路径

GUI 是推荐入口。需要排障或沿用传统商品表时，可使用：

```bash
npm run validate
npm run run
```

传统 CLI 读取 `products/products.csv` 或相关配置中的商品表路径，适合运营本机维护人物池和调试飞影页面 selector。

抓包 HTTP RPA 的脱敏工具（离线、不访问网络、不消耗积分）：

```bash
node scripts/redact-capture-source.mjs <raw-steps.json> --out=<manifest.json> --report=<report.json>
```

把人工整理的原始抓包步骤脱敏成可入库的 capture manifest，内置 `parseCaptureManifest` 门禁作双重保险。完整采集→脱敏→复核→离线回放流程见 `docs/rpa/capture-runbook.md`。

GUI 的“抓包 HTTP 小批量预演”同样是本地能力：它使用 `capture_http` 的 mock 队列验证多商品编排、状态恢复和 artifact 登记，不读取运行时飞影登录态，不调用真实 Hifly HTTP transport，不访问飞影，也不消耗积分。该入口不替代 Playwright 批量生产；真实 HTTP 出片仍只允许单条授权联调。

## 沙箱 / 代理网络（排障用）

在这台 Mac 上用 Claude Code 等沙箱工具排障时：`hifly.cc` 在沙箱里可能被解析到 `198.18.x.x`（RFC2544 fake-ip，不可路由），且无 `HTTP_PROXY` 环境变量——看起来「连不上」。但本机系统配了代理（TUN 模式），fake-ip 会被转发到真实 hifly，所以 GUI 触发的 Playwright 浏览器能正常访问。**判断能否连 hifly，以实际跑一次飞影链路（能否走到 asset_generation/submit）为准，不要只看 `dns.resolve4` 就下结论。**

## 输出目录

- `workspace/` 或 `batches/`：GUI 批次状态、上传副本和批次产物。
- `downloads/`：CLI 路径下载的视频样片或成片。
- `logs/`：CLI JSONL 运行日志。
- `screenshots/`：失败截图和调试截图。
- `outputs/`：最终交付打包目录。
- `assets/person_pool/`：按商品品类轮换的人物/背景图。

### GUI 产物下载

GUI 中的“下载产物”按钮只读取当前批次已登记的 artifact ID，不接受用户输入的本地路径。后端会在返回文件前检查 artifact 路径仍位于当前 batch 目录内、不是 symlink、且是普通文件。

前端公开的 batch JSON 仍不会暴露 artifact 的 `relative_path` 列表；只有任务输出路径与已登记 artifact 精确匹配时，任务行才会额外出现 `output_artifact_id`，用于生成同源下载链接。

## 不入库内容

以下内容涉及账号、环境、本地状态或大文件，不提交到 Git，也不进入交付包：

- `config.local.json`
- `playwright/profile/`
- `playwright/.auth/`
- `workspace/`
- `batches/`
- `downloads/`
- `logs/`
- `screenshots/`
- `outputs/`
- `node_modules/`
- `*.har`、`rpa/capture/raw/`（抓包原始产物，含 cookie/token/签名/登录态）

## 打包交付

```bash
npm run package
```

交付包输出到：

```text
outputs/hifly-hands-on-product-batch.tar.gz
```

## 腾讯云 2C4G 内网试运行

生产试运行不使用 `config.local.json`、本地 GUI 自动开浏览器或真实飞影链路；配置来自环境变量/secret，
默认 `PRODUCTION_EXECUTOR=fail_closed`。完整步骤见
`docs/deployment/TENCENT_CLOUD_2C4G_DEPLOYMENT_RUNBOOK.md`。

```bash
cp .env.example .env
HTTP_PORT=18080 HTTPS_PORT=18443 docker compose -p hifly-pilot \
  -f docker-compose.production.yml config
docker compose -p hifly-pilot -f docker-compose.production.yml up -d postgres
docker compose -p hifly-pilot -f docker-compose.production.yml run --rm app npm run migrate:production
docker compose -p hifly-pilot -f docker-compose.production.yml up -d
```

实际部署前必须准备 `PUBLIC_HOST`/`PUBLIC_ORIGIN`、数据库连接串、初始管理员配置（如启用 seed）以及只读挂载
证书 `fullchain.pem`/`privkey.pem`。只有 Nginx 对外发布，`app` 与 PostgreSQL 仅在 Compose 内网；备份写入
`/var/backups/hifly` 挂载目录，恢复必须显式传 `--confirm`。这套配置是低并发内网试点，不代表公网生产就绪。

包内包含 `web/`、`src/`、`scripts/`、`docs/`、示例配置和示例商品表；不包含浏览器登录态、真实下载视频、日志、截图和本地配置。

## GitHub 发布前检查

```bash
npm test
npm run check
npm run validate
npm run package
```

GitHub CLI 需要认证：

```bash
gh auth login -h github.com
gh auth status
```
## 影刀 RPA 执行器

默认执行器仍是 Playwright。要启用影刀桥接版本，在 `config.local.json` 设置：

```json
{
  "executionBackend": "yingdao_rpa"
}
```

第一版只保证本地任务包、回调和 mock 流程。真实影刀客户端联调前需要：

1. 安装并登录影刀客户端。
2. 确认影刀流程能读取 `batches/<batch_id>/rpa/tasks/<task_id>.json`。
3. 确认影刀流程能 POST 到 `http://127.0.0.1:<port>/api/rpa/callback`。
4. 用户明确允许消耗飞影积分后再跑真实商品。

### RPA 本地桥接约束

- GUI 确定实际监听端口后，会把 callback base URL 更新为 `http://127.0.0.1:<实际端口>`。这同时覆盖 `HIFLY_GUI_PORT` 和默认端口被占用后的自动递增端口；`rpa.callbackBaseUrl` 只是 executor 创建时的初始值，不应假定任务包永远使用 `4317`。
- task package 发布前，人物图会复制到 `batches/<batch_id>/rpa/inputs/`。`auto_pool` 的项目级人物池路径和 `fixed_upload` 的批次上传路径都不会原样暴露给影刀；只允许普通 `.jpg`、`.jpeg`、`.png` 文件，symlink 和越界的 `rpa/inputs` 目录会被拒绝。
- callback token 除了写入 RPA state，还必须登记在当前 GUI 进程的 active registry 中。仅从旧 state 读取到 token 不能恢复回调权限；GUI 进程重启或任务进入 `completed`、失败、人工核对终态后，旧 token 无效。
- `completed` callback 只接受当前批次内已存在的普通文件，字段必须为 `artifact_id` 和 batch-relative `relative_path`。绝对路径、`..`、symlink escape、缺失文件和额外本地路径字段都会被拒绝。
- RPA 查询或下载超时会把批次转为 `interrupted_unknown`，由 GUI 人工核对后决定是否重试；非 RPA 下载异常仍保持 `download_pending`，不会改变现有 Playwright 重试流程。
