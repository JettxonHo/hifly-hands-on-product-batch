# 2026-08-10 Local Agent 登录态预检修复

## 目标

在不领取云端工单、不上传素材、不触发飞影生成和不消耗积分的前提下，修复首次真实执行暴露的两个问题：

1. 已失效的飞影 Profile 在工单领取后才被发现；
2. 上传点击被登录弹窗阻断时，`filechooser` Promise 可能产生未处理拒绝并使进程异常退出。

## 实现

- `HiflyHandsOnProductPage.preflight()` 进入「手里有货」并检测手机号输入框或微信扫码登录信号。
- 真实 Local Agent 在 heartbeat/claim 前调用执行器预检；登录失效返回 `LOGIN_REQUIRED / requires_action`，attempt 保持为空。
- 登录在领取后失效时，`batch-runner` 的暂停状态经 Local Agent 映射为受控 `LOGIN_REQUIRED` 报告。
- `uploadModalFile` 用 `Promise.all` 共同持有 filechooser listener 与按钮 click；失败后重新检查登录态。

## 无积分实机验证

Owner 已通过 `npm run login` 保存登录状态。随后只创建 Playwright 执行器并调用 `preflight()`，结果：

```text
status: ready
backend: playwright
```

本次未调用 Local Agent 主命令，没有 heartbeat、claim、素材上传、生成按钮点击或视频下载，飞影积分消耗为 0。

## 自动验证

```text
focused Local Agent / batch regression: 101/101 pass
npm run check: 204 JavaScript files checked
git diff --check: pass
```

全量 `npm test` 输出中的 838 项均通过，但测试进程被既有 `test/yingdao-rpa-executor.test.js` worker 阻塞而未自然退出。本轮未修改该模块，也未清理已有长时间运行的测试进程；该结果不能标记为完整全量测试通过。

## 当前状态与下一步

- 生产工单 `97bba08b-d602-4fd2-88b3-86f3af76f570` 仍为上次失败后的 `requires_action`，本轮没有修改。
- 合并修复后，先通过受支持的云端恢复入口恢复工单并无积分核对唯一可领取工单、交接包和 attempt 状态。
- 真实生成仍需 Owner 新的单条积分授权。执行 1 条，失败立即停止，不自动重试。
