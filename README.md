# 飞影「手里有货」批量生产工作台

这个项目用于批量制作电商产品数字人手持商品种草视频。当前唯一生产主路径是 Cloud Control Plane + Cloud Executor：运营在任意电脑通过云端 HTTPS 完成项目、商品、文案、人物、视频方案和生产工单，阿里云 Cloud Executor 通过持久 Chrome Profile 与 Playwright 进入飞影「手里有货」，下载视频并回传到 A12、Work 和鉴权下载。Mac Local Agent 与传统本地工作台仅保留为 legacy fallback，不是生产入口或验收依据。

## 当前生产工作流

1. 运营通过云端 HTTPS 登录企业工作台。
2. 完成商品事实、文案生成/QC/审核、人物确认和 VideoPlan 审核。
3. 创建一商品一工单的生产任务，并确认 Cloud Executor 在线、登录态与存储就绪。
4. Cloud Executor 严格串行领取工单，进入飞影「手里有货」完成上传、提交和下载。
5. 系统保存云端视频，完成 A12 核验并在 Work 中提供鉴权预览和下载。
6. 真实生成必须有对应积分授权；首失败即停，不自动重试。

云端飞影登录只通过 SSH tunnel + loopback noVNC 完成，Profile、Token、素材、下载、日志和截图不会进入 Git。`LOCAL_AGENT_ENABLED=false` 是当前生产默认值。

## 生产入口

普通运营只需浏览器和云端 HTTPS 地址，不需要安装 Node.js、Playwright 或 Local Agent。部署和 Cloud Executor 运维见 `docs/deployment/ALIYUN_CLOUD_EXECUTOR_CE07_RUNBOOK.md`。

## Legacy 本地开发入口

以下命令只用于开发、演示和故障回退，不作为当前生产流程：

```bash
npm install
npx playwright install chromium
cp config.example.json config.local.json
npm run login
npm run gui
```

登录步骤会弹出本地浏览器；其 Profile 与云端 Cloud Executor Profile 相互独立，不能用来证明纯云端系统就绪。

如果默认端口被占用，工作台会自动选择下一个可用端口，并在终端打印类似：

```bash
Local workbench: http://127.0.0.1:4318
```

## A01-A14 本地全链路演示

只想查看企业内容生产闭环时，可使用不读取 `config.local.json`、不读取飞影登录态的本地演示：

```bash
npm run demo
```

该命令需要 Docker Desktop，使用独立的 PostgreSQL 容器（loopback 端口从 `55433` 起自动选择、独立 Compose project 和 volume），按 A01→A14 顺序执行 migration，启用完整企业功能，并打开 `http://127.0.0.1:<port>/login.html`。演示数据默认保存在项目 `.local-demo/`，不会因系统清理临时目录而丢失。演示使用仓库现有 controlled provider/evaluator 和 fake executor；真实 Provider、Capture HTTP、Playwright、影刀和飞影积分均不会被调用。旧工作台的生成按钮在演示中也只会落到 fake executor。

固定的本地测试凭据如下，仅用于演示：

```text
账号：demo-admin@demo.local
临时密码：Demo-Local-2026-Only!
```

首次登录会强制设置新密码；后续重启请使用你设置的新密码，忘记时可执行下方 reset 后重新初始化。请勿把该凭据当作生产密码。停止演示数据库但保留数据：

```bash
npm run demo:stop
```

只有明确需要重置演示数据库时才运行 `npm run demo:reset`；该命令只删除演示专用 PostgreSQL volume，不触碰 `docker-compose.identity.yml` 的测试库，也不删除 `.local-demo/` 中的本地素材文件。

## Legacy 本地工作台能力

- 单条商品录入：填写 SKU、产品名称、核心卖点、品类并上传商品图。
- 批量导入：上传 CSV/XLSX 和多张商品图，系统按 `sku`、显式图片名或文件名自动匹配。
- 待执行任务：查看批次、任务状态和确认生成动作。
- 运行记录：显示导入、校验、开始生成和错误信息。
- 安全边界：同源请求令牌、Host/Origin 校验、上传文件类型/大小/像素限制、全局执行锁和幂等 key。

## CSV/XLSX 字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `sku` | 建议 | 唯一编号；留空时 GUI 会自动生成。 |
| `product_name` | 是 | 产品名称或视频展示名。 |
| `selling_points` | 是 | 核心卖点，建议用分号分隔。 |
| `category` | 否 | 用于匹配人物素材池，如 `beauty`、`fresh_food`。 |
| `image_path` | 是 | 在 GUI 中填写上传文件名；CLI 中填写本地相对路径。 |
| `person_image_path` | CLI 可选 | GUI 不接受客户本机路径；CLI 可用本地人物池或显式路径。 |
| `status` | CLI 可选 | 新任务使用 `pending`。 |

## 人物和背景差异化

当前飞影「手里有货」页面没有暴露数字人姿势参数。坐姿、站姿、景别和背景主要由上传人物图或飞影推荐模板决定。要避免批量视频过于雷同，建议按品类准备多张人物/背景图：

```text
assets/person_pool/fresh_food/
assets/person_pool/beauty/
assets/person_pool/snacks/
assets/person_pool/default/
```

优先级为：商品表显式人物图、同品类人物池、默认人物池、飞影推荐人物。GUI 当前主打客户上传商品图和商品信息；人物池由运营在项目目录中维护。

## 命令

| 命令 | 用途 |
| --- | --- |
| `npm run gui` | 启动 legacy Mac/Windows 本地网页工作台，仅用于开发/回退。 |
| `npm run demo` | 启动不访问飞影的 A01-A14 企业本地演示并打开登录页。 |
| `npm run demo:stop` | 停止演示 PostgreSQL，保留演示数据。 |
| `npm run demo:reset` | 显式删除演示 PostgreSQL 的专用 volume；保留 `.local-demo/` 文件。 |
| `npm run login` | 保存 legacy 本地 Profile；不会配置云端 Cloud Executor。 |
| `npm run validate` | 校验传统 `products/products.csv` 输入。 |
| `npm run prepare-standard` | 按每商品 1 条标准视频生成口播脚本、飞影提示词和质检表。 |
| `npm run run` | 使用 CLI 路径批量跑 `products/products.csv`。 |
| `npm test` | 运行单元和集成测试；默认使用假执行器，不访问飞影。 |
| `npm run check` | 运行 JavaScript 语法检查。 |
| `npm run package` | 生成交付包 `outputs/hifly-hands-on-product-batch.tar.gz`。 |

`npm run prepare-standard` 的默认输出目录：

```text
outputs/standard-video-assets/
  scripts/
  prompts/
  qc/qc_report.csv
```

## 关键限制

网页自动化依赖飞影页面结构。当前页面流程已校准为：外层点击「上传人物+产品图」打开弹窗，弹窗中选择推荐人物图或上传人物图，上传商品图，点击弹窗「立即生成」，生成完成后必须点击「确认」，再回外层点击「立即生成」创建视频，最后从作品入口下载结果。

遇到登录失效、验证码、按钮文案变化、页面改版、任务排队、积分不足或下载入口变化时，自动化会暂停或记录失败，需要人工处理后重跑。第一版建议先用 5-10 个商品做校准批次，再扩大到 20-50 条一批。

## 交付文档

- `docs/新人培训使用手册.html`：给客户和运营共同使用的离线培训手册。
- `docs/ENVIRONMENT.md`：安装、启动、打包和 GitHub 发布前检查。
- `docs/SOP.md`：运营 SOP 与质检规则。
- `docs/飞影标准视频工作流.md`：每个商品 1 条标准视频的项目生产链路。
- `docs/飞影提示词模板.md`：飞影左右分屏画面提示词、口播模板和负面提示词。
