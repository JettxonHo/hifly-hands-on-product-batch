# 飞影「手里有货」批量生产工作台

这个项目用于批量制作电商产品数字人手持商品种草视频。飞影官方 API 目前没有开放「一键成片 - 手里有货」模式，所以主链路采用本地网页工作台 + Playwright 浏览器自动化：运营或客户在本机浏览器上传商品图、填写产品名和卖点，系统生成待执行任务，再由自动化浏览器进入 `https://hifly.cc/goods` 完成上传、确认、提交视频和下载。

## 推荐工作流

1. 首次安装依赖并登录飞影。
2. 运行 `npm run gui` 打开本地工作台。
3. 在浏览器中单条录入，或批量上传 CSV/XLSX 与商品图片。
4. 在「待执行任务」中确认待生成商品和积分提示。
5. 点击「开始生成」，由自动化流程逐条处理飞影页面。
6. 下载完成的视频进入批次产物目录，历史 CLI 下载仍保留在 `downloads/`。

本地工作台只监听 `127.0.0.1`，不会开放到公网或局域网。真实飞影登录态、下载文件、日志、截图和 `config.local.json` 不会进入交付包或 Git。

## 快速开始

```bash
npm install
npx playwright install chromium
cp config.example.json config.local.json
npm run login
npm run gui
```

登录步骤会弹出浏览器。完成飞影登录并确认能进入 `https://hifly.cc/goods` 后，回到终端按 Enter 保存登录态。

如果默认端口被占用，工作台会自动选择下一个可用端口，并在终端打印类似：

```bash
Local workbench: http://127.0.0.1:4318
```

## 本地工作台能力

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
| `npm run gui` | 启动 Mac/Windows 通用本地网页工作台。 |
| `npm run login` | 打开浏览器，人工登录飞影并保存登录态。 |
| `npm run validate` | 校验传统 `products/products.csv` 输入。 |
| `npm run run` | 使用 CLI 路径批量跑 `products/products.csv`。 |
| `npm test` | 运行单元和集成测试；默认使用假执行器，不访问飞影。 |
| `npm run check` | 运行 JavaScript 语法检查。 |
| `npm run package` | 生成交付包 `outputs/hifly-hands-on-product-batch.tar.gz`。 |

## 关键限制

网页自动化依赖飞影页面结构。当前页面流程已校准为：外层点击「上传人物+产品图」打开弹窗，弹窗中选择推荐人物图或上传人物图，上传商品图，点击弹窗「立即生成」，生成完成后必须点击「确认」，再回外层点击「立即生成」创建视频，最后从作品入口下载结果。

遇到登录失效、验证码、按钮文案变化、页面改版、任务排队、积分不足或下载入口变化时，自动化会暂停或记录失败，需要人工处理后重跑。第一版建议先用 5-10 个商品做校准批次，再扩大到 20-50 条一批。

## 交付文档

- `docs/新人培训使用手册.html`：给客户和运营共同使用的离线培训手册。
- `docs/ENVIRONMENT.md`：安装、启动、打包和 GitHub 发布前检查。
- `docs/SOP.md`：运营 SOP 与质检规则。
