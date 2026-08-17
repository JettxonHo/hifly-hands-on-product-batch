# Issue #188 · Operator Workbench V2-E2

## 接管信息

- 日期：2026-08-18
- Issue：#188
- 分支：`codex/operator-workbench-v2-e2`
- 精确基线：`730616337a62f15b3b24beeab172610325cea626`
- 逻辑角色：`IMPLEMENTER`
- 请求 custom agent：`luna-worker`
- 配置模型：`gpt-5.6-luna`
- reasoning：`max`
- 实际运行时模型：`UNVERIFIED_RUNTIME_MODEL`
- 首个宽任务包的 `luna-worker` 只完成阅读，没有代码产出，已及时关闭；随后两个边界更小的实例分别完成 Avatar 与 Plan 的 RED/GREEN 初稿并关闭。Sol 独立复核、收紧技术详情边界并运行最终浏览器验证。

## 范围与 Product/API gate

本轮只实现 V2-E2：Avatar/Plan 的业务中文、技术/审计详情层级与 Plan Tab 键盘语义。Product/API gate 已确认现有
workspace 能证明当前商品、当前文案已人工批准、人物已确认及完整上游引用；页面不从内部 ID 猜测文案或人物名称，
也没有新增 API、DB、领域状态或依赖。

未修改人物授权、素材门禁、方案预检、人工审核、版本、冲突或权限语义。QC passed 仍不等于人工批准，
preflight passed/warning 仍不等于 Plan approved。

## 实际改动

- Avatar 主业务区用“当前文案已人工批准”替代短 CopyVersion ID；`avatar_image`、`Evidence`、
  `verified capability`、`Organization` 使用“人物图片 / 能力依据 / 已验证能力 / 当前企业”等业务中文。
- 企业人物的能力代码与能力依据引用进入默认折叠的技术选项；人物详情新增默认折叠的技术与审计详情，保留完整
  文案版本、人物资产/版本、能力代码、能力依据引用、授权范围与来源代码。用户填写的人物说明不被改写。
- Plan 主上下文与上游卡只显示商品快照、文案已人工批准、人物已确认；四个完整上游 ID 继续保留在折叠技术详情。
- Plan 预检/审核切换补齐 `tablist / tab / tabpanel`、`aria-selected / aria-controls / aria-labelledby`、唯一
  `tabindex=0`，并支持鼠标、ArrowLeft/ArrowRight/Home/End 的焦点、选中和面板同步。

## TDD 证据

### Avatar 业务语言与审计详情

RED：

```text
node --test --test-concurrency=1 test/avatar-selection-browser.test.js
```

结果：`1 pass / 1 fail`；公开主业务内容仍出现 `当前 Organization` 与 `能力已有 Evidence 支持`。

GREEN：同一文件由 Sol 使用真实宿主 Chrome 复验，`2/2 pass / 0 fail / 0 skip`。回归同时验证完整文案 ID、人物
资产/版本 ID、能力代码、依据引用、授权范围和来源代码只在显式展开的审计详情中可见；管理员填写可选能力前需展开
技术选项。

### Plan 上游语言与 Tab 键盘合同

RED 1：

```text
node --test --test-concurrency=1 test/video-planning-browser.test.js
```

结果：公开主上下文仍显示 `文案 copy-app · 人物 selectio`。

RED 2：业务语言 GREEN 后，同一命令在 Tab seam 失败，页面没有两个 `role=tab`。

GREEN：Sol 使用真实宿主 Chrome 复验同一文件，`1/1 pass / 0 fail / 0 skip`；覆盖完整四个上游 ID 的折叠保留，
以及鼠标和全部方向/Home/End 键的焦点、选中与面板同步。

## 验证与证据边界

本 session 的 focused Chrome 结果来自本地假数据公开 browser seam，只证明仓库页面行为，不是部署、客户或真实
Provider 证据。

- Avatar/Plan 联合真实宿主 Chrome：`3/3 pass / 0 fail / 0 skip`。
- 受影响浏览器矩阵（Avatar、Plan、V2 shared foundation、VSA-A14）：`5/5 pass / 0 fail / 0 skip`。
- Avatar/Plan API 与 service：`41/41 pass / 0 fail / 0 skip`。
- `npm run check`：检查 `229` 个 JavaScript 文件，通过。
- `git diff --check`：通过；最终变更严格限制为 Issue #188 锁定的 9 个文件。
- 默认 `npm test` 首次完整运行：`1038 total / 1024 pass / 14 existing skips / 0 fail`，约 54.8 秒。第二次重复
  运行在并行浏览器组约第 580 项后超过两分钟无进展并由 Sol 终止；该长尾不改写为通过，也不推翻首次完整零失败
  结果，fixed-head 三组 CI 继续作为合并前的独立稳定性门禁。
- 临时截图位于 `/private/tmp/hifly-v2-e2-screenshots-20260818a/`，Avatar 与 Plan 各覆盖
  `1440x900 / 768x900 / 390x844`；PNG 像素头已核验，人工检查未见页面级横向溢出、窄栏硬挤或主业务层 ID 泄露。
  截图没有提交到 Git。

fixed-head CI 在 Draft PR 创建后核验；未通过的门禁不得写成已完成。

本轮未部署、未 SSH、未访问 Hifly、未启动 Worker、未修改生产数据、未生成视频、未消耗积分。
