# 2026-08-12 第八次真实 Local Agent 失败弹窗残留

## 授权边界

Owner 明确授权仅执行工单 `e9d6139f-42cf-4145-95b0-1c2f5b834d4c` 的 1 条真实飞影生成，接受积分扣除风险；失败立即停止且不自动重试。

执行前无副作用复核确认：

- 本地运行 checkout 为干净 `main`，已同步 `origin/main`；
- 目标工单是唯一活跃工单，状态为 `waiting_for_executor`；
- ExecutionAttempt 数为 0；
- 交接包 `d0856dc8-7bc7-42f6-b55f-551b68f27e22` 为 `ready / v1`；
- 当时的 Playwright `preflight()` 返回 `ready`。

## 唯一真实执行结果

只运行一次：

```bash
LOCAL_AGENT_REAL_EXECUTION=true npm run local-agent:run-once -- --real
```

执行完成 heartbeat、claim、start、交接包下载和任务 heartbeat，随后提交失败报告并以退出码 1 结束：

- attempt：`59b4a9a1-eb96-44c5-a0c0-25c8d404f181`
- report：`a466cf58-2fa8-490d-8f49-f712ba8d1074`
- order：`failed`
- attempt：`failed`
- report：`failed / not_retryable`
- candidate：0
- Work：0

失败后没有再次运行命令，也没有恢复或重用该工单。

## 根因证据

读取本次真实执行实际误用的运行目录 Profile 后确认：

- URL 为 `https://hifly.cc/goods`；
- Profile 仍为会员登录态，页面显示余额 `55637`；
- 点击外层“上传人物+产品图”后，弹窗显示“手持商品图生成失败 / 再次生成 150积分 / 重新编辑 / 确认”；
- 弹窗没有“上传人物 / 上传商品”入口。

旧修复只在点击外层入口之前检查失败态。账号级失败弹窗是在点击后才重新出现，因此代码继续等待不存在的“上传商品”按钮并超时。正确恢复动作是“重新编辑”，禁止点击“再次生成”。

诊断中还发现 `LOCAL_AGENT_HIFLY_CONFIG_PATH` 指向的外部 Profile 已是游客态，但 Playwright lazy executor 会重新读取运行目录配置。本次真实运行因而使用了错误的 Profile；这不是弹窗超时的直接根因，却会让预检证据与实际配置不一致。修复后 lazy executor 会按 `config.__configPath` 重新加载外部配置，并以该配置目录解析相对 Profile 路径；未显式提供配置路径时仍保持运行目录回退。

## 积分与安全停点

- 没有进入人物/商品上传；
- 没有点击手持图 `立即生成 150积分` 或 `再次生成 150积分`；
- 没有点击外层视频生成；
- 没有 candidate、视频或 Work；
- 页面余额为 `55637`。它较更早记录发生变化，但没有证据可归因到本轮；最终积分结算仍以飞影后台流水为准。

## 下一步

1. 无积分 TDD 修复已完成：点击外层入口后出现失败弹窗时只走“重新编辑”，不会点击“再次生成”。
2. 游客态延迟信号已加入登录前置门禁；外部配置/Profile 选择错误也已修复。修复后对正确外部 Profile 的无副作用预检返回 `LOGIN_REQUIRED`，没有 heartbeat、claim、上传或生成。
3. 验证完成：`npm run check` 检查 204 个 JavaScript 文件；`npm test` 共 878 项，864 pass / 14 environment skip / 0 fail；`git diff --check` 通过。主控已独立复核变更，未发现 blocker。
4. 合并后先使用 `LOCAL_AGENT_HIFLY_CONFIG_PATH` 指向的同一配置执行 `npm run login`，保存该外部 Profile 的登录态，再做一次无副作用预检。当前工单不得重试。
5. Owner 已在本轮失败后明确授予未来 5 次单条真实飞影生成权限，无需逐次再次确认；从下一条新 reproduction 工单开始计数，当前剩余 5 次。每次仍须通过登录态、唯一工单、零 attempt 和交接包就绪门禁，最多执行 1 条，失败即停且不自动重试。
