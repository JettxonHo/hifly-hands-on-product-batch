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
- `hiflyUi.scriptLabel`：文案输入框的 label 或 placeholder。当前「手里有货」页面实测为 `文案`。
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

## 自定义文案校准

自定义文案依赖飞影页面的“AI 自动生成”开关。首次使用自定义口播时，只运行 1 条校准样片：

1. 将文案策略设置为“使用导入文案”（`mixed`）。
2. 填入 50-80 字口播，并确认商品项的 `script` 已保存。
3. 检查日志或截图中出现 `script-filled`，且提交外层视频前没有报错。

如果开关定位或文案填入校验失败，任务状态应为 `failed_pre_submit`，不会继续外层视频提交，也不会进入后续外层视频生成。

## 飞影页面已知行为与调试要点（实机总结）

- **Local Agent 真实模式必须先做登录预检**：执行器进入 `https://hifly.cc/goods` 后，手机号输入框（placeholder 含「11 位手机号」）、「微信扫码登录」、顶部「游客模式」或「注册即得…积分」都属于登录失效信号。飞影允许游客访问商品页，因此“页面可打开”不等于已登录。预检必须发生在云端 heartbeat/claim 前；命中时返回 `LOGIN_REQUIRED / requires_action`，不得领取工单或继续上传。
- **登录与执行必须使用同一份外部配置/Profile**：Local Agent 通过 `LOCAL_AGENT_HIFLY_CONFIG_PATH` 指定配置时，Playwright lazy executor 必须按该路径重新加载配置，并相对于该配置文件目录解析 `browser.profileDir`。登录也要显式使用同一路径：先加载 `~/.config/hifly-local-agent/cloud.env`，再运行 `HIFLY_CONFIG="$LOCAL_AGENT_HIFLY_CONFIG_PATH" npm run login`。不要只登录仓库运行目录的默认 Profile，否则预检与真实执行可能使用不同登录态。
- **弹窗上传优先直接设置对应 input**：实页 DOM 中“上传人物”和“上传商品”都是 `<span role="button">`，各自内部有独立的隐藏 `input[type=file]`。上传必须先限定到可见“手持商品图”弹窗，再对匹配控件内的 input 调用 `setInputFiles`；不要用页面级 `/上传人物/` 查询，否则会误命中弹窗背后的“上传人物+产品图”。只有控件内没有 input 时才用 `Promise.all([waitForEvent("filechooser"), click()])` 回退。
- **商品主图校验不能按最右图片判断**：商品推荐缩略图（如 `pd4.jpg`）位于主商品图右侧。上传后应优先选择展示面积最大的非人物推荐图，并在面积相同时取更靠右者，避免把推荐缩略图误判为未替换的商品主图。
- **手持商品图是账号级持久化残留**：上一个商品生成的手持图会残留在账号里，新商品打开「手持商品图」弹窗时看到的是上一个商品的残留已生成图（不是空上传界面）。`page.reload` / 重新导航都清不掉——残留是服务端/会话维度。这是「新商品生成却复用上一个商品（如青菜/白菜）素材」bug 的根因。
- **生成失败弹窗也会跨工单残留**：上一任务若停在「生成失败 / 再次生成 / 重新编辑 / 确认」，下一任务打开上传入口仍会看到该失败弹窗，没有「上传人物 / 上传商品」。自动化必须点「重新编辑」回到上传态，再上传当前任务素材；禁止点击「再次生成」，否则会用旧素材重新扣分。该恢复只处理页面残留，不等于重试上一工单。
- **删残留图会关弹窗**：在弹窗里点残留图的垃圾桶删除，会把弹窗也关闭（回到外层「手里有货」页面）。代码对策：`resetGeneratedHandsOnImage` 清残留后会重新 `openHandsOnModal` 打开干净上传界面（见 `src/hifly-page.js`），并有 `verifyProductImageReplaced` 安全网在上传后验证商品图真的被替换，未替换则在上传阶段抛错、不会走到「立即生成」消耗积分。
- **调试定位别靠视觉截图**：`getByRole` 匹配的是 accessible name（aria-label / innerText），不是可见像素。不要用「截图里看不到按钮文字」推断「`getByRole` 匹配不到」。飞影上传入口可能是图标按钮（如紫色「+」），按文字匹配不到时要加 `input[type='file']` 兜底。看真实 DOM 用 `dumpModalDomSnapshot`（落盘 `logs/batch-*.jsonl` 的 `modal_dom_snapshot` 事件，含所有按钮 text+aria-label+图片 src）。
## 影刀 / 抓包校准

影刀版先跑 mock 回调，不直接消耗飞影积分。抓包 HTTP 化需要先采集飞影上传、手持图生成、视频提交、状态轮询和下载请求。若任一请求依赖动态签名、一次性 token 或风控，保持网页自动化兜底。

抓包本地回放链路已具备（Phase 1，无积分）：`executionBackend: "yingdao_rpa"` + `rpa.mode: "capture_http"` 时，执行器读取脱敏 manifest（`rpa.manifestPath`），用 mock HTTP client 离线回放上传/手持图/提交/轮询/下载步骤并推进 rpa-state，绝不发起真实网络请求。真实采集前仍需先抓 HAR、用 `redactCaptureSource` 脱敏、人工复核 `report`，且需用户授权积分后只跑 1 条商品。设计依据见 `docs/superpowers/specs/2026-07-16-capture-http-rpa-design.md`。完整的采集→脱敏→复核→离线回放操作流程见 `docs/rpa/capture-runbook.md`；脱敏可一键用 `node scripts/redact-capture-source.mjs <raw-steps.json> --out=... --report=...`（原始 HAR 放 `rpa/capture/raw/`，已被 gitignore）。

GUI 抓包工作流已接入：勾选“同时录制抓包产物”后，真实生成仍走 Playwright，但会为该批次创建带 `recordHar` 的一次性 browser context。普通批次仍使用默认 Playwright 路径。因为 Playwright 的 HAR 录制必须在 context 创建时配置，不能给已经启动的长驻 context 临时打开录制，所以 capture-enabled 批次会使用 per-run executor。批次完成后可在 GUI 执行抽取、脱敏和离线回放，这些后处理不会再次消耗飞影积分。

HAR 抽取已按 2026-07-16 真实样本校准到 `hiflyworks-api.lingverse.co`：`upload_url` 归为上传授权，`one_stop/goods_in_hand/goods_holding_image_generation` 归为手持图生成/轮询，`one_stop/goods_in_hand/videos` 归为视频提交/轮询/下载。页面加载时会先拉历史手持图和历史视频列表，抽取器必须只接受本次 POST 之后的 ready/视频轮询结果，避免把旧作品误认为当前批次证据。
