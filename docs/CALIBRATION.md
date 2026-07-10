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
