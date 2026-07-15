# 飞影页面校准清单

`https://hifly.cc/goods` 是「手里有货」直达页面。由于网页自动化依赖页面结构，第一次跑真实样片时需要校准以下字段。

## 配置文件

复制：

```bash
cp config.example.json config.local.json
```

重点检查 `config.local.json`：

- `handsOnProductUrl`：默认 `https://hifly.cc/goods`
- `hiflyUi.productNameLabel`：产品名称输入框的 label 或 placeholder
- `hiflyUi.sellingPointsLabel`：核心卖点输入框的 label 或 placeholder
- `hiflyUi.scriptLabel`：脚本文案输入框的 label 或 placeholder
- `hiflyUi.uploadLabel`：上传商品图按钮文案
- `hiflyUi.uploadPersonText`：弹窗内上传人物图按钮文案
- `hiflyUi.uploadProductText`：弹窗内上传商品图按钮文案
- `hiflyUi.modalSubmitText`：弹窗内生成按钮文案
- `hiflyUi.modalConfirmText`：弹窗生成完成后的确认按钮文案
- `hiflyUi.submitText`：生成按钮文案
- `hiflyUi.downloadText`：下载按钮文案
- `behavior.productFieldsRequired`：默认 `false`。因为当前 `手里有货` 页面可能只需要商品图，产品名/卖点找不到时会跳过。
- `personPool.enabled`：默认 `true`。当商品表未填 `person_image_path` 时，按 `category` 读取人物素材池。
- `personPool.rootDir`：默认 `assets/person_pool`。
- `personPool.defaultCategory`：品类池为空时的兜底目录，默认 `default`。
- `personPool.fallbackToRecommended`：素材池为空时是否继续选择飞影推荐人物。

## 首轮样片建议

先放 2-3 个商品：

- 一个包装类商品
- 一个生鲜/食品类商品
- 一个日用品类商品

每个商品至少提供：

- 商品图
- 产品名称
- 3 条以内核心卖点
- 商品品类 `category`

如果要验证批量差异化，给同一品类准备至少 2 张人物图，例如：

```text
assets/person_pool/fresh_food/host_01.jpg
assets/person_pool/fresh_food/host_02.jpg
```

首轮目标不是大批量生产，而是确认：

- 页面能稳定进入
- 图片能稳定上传
- 文案字段能稳定填写
- 生成按钮能稳定提交
- 视频能稳定下载
- 异常截图和日志可用于定位问题
- 同品类多商品会按人物素材顺序轮换，不会固定只用同一张人物图

## 飞影页面已知行为与调试要点（实机总结）

- **手持商品图是账号级持久化残留**：上一个商品生成的手持图会残留在账号里，新商品打开「手持商品图」弹窗时看到的是上一个商品的残留已生成图（不是空上传界面）。`page.reload` / 重新导航都清不掉——残留是服务端/会话维度。这是「新商品生成却复用上一个商品（如青菜/白菜）素材」bug 的根因。
- **删残留图会关弹窗**：在弹窗里点残留图的垃圾桶删除，会把弹窗也关闭（回到外层「手里有货」页面）。代码对策：`resetGeneratedHandsOnImage` 清残留后会重新 `openHandsOnModal` 打开干净上传界面（见 `src/hifly-page.js`），并有 `verifyProductImageReplaced` 安全网在上传后验证商品图真的被替换，未替换则在上传阶段抛错、不会走到「立即生成」消耗积分。
- **调试定位别靠视觉截图**：`getByRole` 匹配的是 accessible name（aria-label / innerText），不是可见像素。不要用「截图里看不到按钮文字」推断「`getByRole` 匹配不到」。飞影上传入口可能是图标按钮（如紫色「+」），按文字匹配不到时要加 `input[type='file']` 兜底。看真实 DOM 用 `dumpModalDomSnapshot`（落盘 `logs/batch-*.jsonl` 的 `modal_dom_snapshot` 事件，含所有按钮 text+aria-label+图片 src）。
