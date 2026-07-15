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

工作台只绑定 `127.0.0.1`。如果 `4317` 被占用，会自动尝试下一个端口。也可以临时指定端口：

```bash
HIFLY_GUI_PORT=4320 npm run gui
```

Windows PowerShell 可使用：

```powershell
$env:HIFLY_GUI_PORT=4320; npm run gui
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

## 沙箱 / 代理网络（排障用）

在这台 Mac 上用 Claude Code 等沙箱工具排障时：`hifly.cc` 在沙箱里可能被解析到 `198.18.x.x`（RFC2544 fake-ip，不可路由），且无 `HTTP_PROXY` 环境变量——看起来「连不上」。但本机系统配了代理（TUN 模式），fake-ip 会被转发到真实 hifly，所以 GUI 触发的 Playwright 浏览器能正常访问。**判断能否连 hifly，以实际跑一次飞影链路（能否走到 asset_generation/submit）为准，不要只看 `dns.resolve4` 就下结论。**

## 输出目录

- `workspace/` 或 `batches/`：GUI 批次状态、上传副本和批次产物。
- `downloads/`：CLI 路径下载的视频样片或成片。
- `logs/`：CLI JSONL 运行日志。
- `screenshots/`：失败截图和调试截图。
- `outputs/`：最终交付打包目录。
- `assets/person_pool/`：按商品品类轮换的人物/背景图。

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

## 打包交付

```bash
npm run package
```

交付包输出到：

```text
outputs/hifly-hands-on-product-batch.tar.gz
```

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
