# 飞影「手里有货」批量生产自动化

这个项目用于通过网页自动化批量操作飞影工作台的一键成片「手里有货」模式。官方 API 文档没有开放该模式，因此主链路采用 Playwright 浏览器自动化：保留登录态、逐条读取商品表、打开「上传人物+产品图」弹窗、选择/上传人物图和商品图、确认生成图、提交视频生成、下载成片并记录状态。

## 工作流

1. 运营填写 `products/products.csv` 或 `products/商品信息表.xlsx`。
2. 首次运行 `npm run login`，人工登录飞影工作台并保存自动化浏览器登录态。
3. 可选：按品类把人物/背景图放入 `assets/person_pool/<category>/`，用于 CSV 没填 `person_image_path` 时自动轮换。
4. 根据实际飞影页面，把 `config.example.json` 复制为 `config.local.json`，校准输入框标签、上传按钮、下载规则等。默认会直达 `https://hifly.cc/goods`。
5. 运行 `npm run validate` 检查商品表字段和图片路径。
6. 运行 `npm run run` 批量创建「手里有货」视频任务并下载最新作品。
7. 下载完成的视频进入 `downloads/`，运行日志进入 `logs/`，关键截图进入 `screenshots/`。

## 目录

- `products/`：商品信息表和 CSV 示例。
- `assets/person_pool/`：按品类轮换的人物/背景图素材池。
- `src/`：Playwright 自动化脚本。
- `downloads/`：飞影导出的成片。
- `logs/`：批量任务日志和失败原因。
- `screenshots/`：异常截图和调试截图。
- `outputs/`：最终交付打包目录。
- `docs/SOP.md`：运营 SOP 和质检规则。
- `docs/新人培训使用手册.html`：供客户和内部运营共同使用的离线新人培训手册。

## 关键限制

网页自动化依赖飞影页面结构。脚本默认直达「手里有货」页面 `https://hifly.cc/goods`。遇到登录失效、验证码、按钮文案变化、页面改版、任务排队等情况时，脚本会暂停或记录失败，需要人工处理后重跑。第一版建议先用 5-10 个商品做校准批次，再扩大到 20-50 条一批。

当前页面流程已校准为：外层点击「上传人物+产品图」打开弹窗，弹窗中选择推荐人物图或上传 `person_image_path`，上传商品图，点击弹窗「立即生成」，生成完成后必须点击「确认」，再回外层点击「立即生成」创建视频，最后点击「最新作品」右下角下载图标。

人物图选择优先级：

1. CSV 明确填写 `person_image_path`。
2. CSV 留空时，按 `category` 从 `assets/person_pool/<category>/` 轮换。
3. 品类池为空时，退回 `assets/person_pool/default/`。
4. 仍无素材时，按配置退回飞影弹窗里的推荐人物。

当前飞影「手里有货」页面没有暴露姿势参数。视频里数字人坐姿、站姿、景别主要由上传的人物图或飞影推荐模板决定；如果客户要求批量差异化，建议为每个品类准备多张不同姿势、场景、景别的人物图。

## 安装与运行

```bash
npm install
npm run login
npm run validate
npm run run
```

`npm install` 会安装 Playwright。首次运行后如果提示缺少浏览器，可执行：

```bash
npx playwright install chromium
```
