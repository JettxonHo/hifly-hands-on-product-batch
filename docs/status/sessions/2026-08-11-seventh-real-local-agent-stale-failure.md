# 2026-08-11 第七次真实 Local Agent：失败弹窗残留

## 授权与执行边界

Owner 明确授权工单 `b5e180bc-7d7d-4d22-be4a-57ac0bd2484e` 执行最多 1 条真实飞影生成，接受积分扣除；失败立即停止且不自动重试。

执行前复核：

- 工单是全组织唯一 `waiting_for_executor` 工单；
- 交接包 `3c653228-2dff-420e-aaa1-5754792d299e` 为 `ready / v1`；
- ExecutionAttempt 数为 0；
- 飞影预检返回 `ready / playwright`。

只运行一次真实命令：

```bash
LOCAL_AGENT_REAL_EXECUTION=true npm run local-agent:run-once -- --real
```

失败后没有再次运行该命令，没有自动重试。

## 云端结果

- attempt：`512e225c-d8f2-4ce7-b5d8-39237cc42c3e`
- report：`f7bb5133-fc4c-4e07-938f-b289701a0c1a`
- 工单状态：`failed`
- attempt 状态：`failed`
- report 状态：`failed / not_retryable`
- candidate：0
- Work：0

该工单保留为失败审计链，不允许直接恢复或重试。

## 只读页面证据

执行结束后仅做了不触发生成的页面与浏览器缓存检查：

- 可见弹窗文本为「手持商品图生成失败再次生成150积分重新编辑确认」；
- 按钮为 `Close`、`再次生成 150积分`、`重新编辑`、`确认`；
- 弹窗没有「上传人物」和「上传商品」入口；
- 本轮缓存中的 `goods_holding_image_generation` 结果仍是 `data.status = 4`；
- 其中人物图与商品图 OSS key 和第六次失败执行完全相同；
- 最新作品仍只有旧作品 `692503`，没有本工单新 Work。

这证明新工单打开时看到的是上一轮账号级失败残留，而不是本轮已经上传并生成的新素材。

## 根因

`createHandsOnImage()` 打开弹窗后只调用 `hasGeneratedImageReady()` 判断成功残留。`hasGeneratedImageReady()` 会对「生成失败」返回 `false`，所以失败残留不会进入已有的重置流程。

随后自动化等待失败弹窗中不存在的「上传商品」入口，最终本地超时。它没有点击「再次生成」，也没有用本工单素材发起新的手持图生成。

## 积分判断

- 本轮没有点击新的手持图「立即生成」或外层视频生成；
- 页面余额执行前后均为 `56041`；
- 因此未观察到本轮新扣分，但最终以飞影后台积分流水为准。

## 修复合同

无积分 TDD 修复仅覆盖以下行为：

1. 新任务遇到账号级「生成失败」残留时，先点「重新编辑」进入上传态；
2. 继续上传本工单人物与商品素材；
3. 不点击「再次生成」复用旧素材；
4. 保持成功残留清理、商品图替换校验和生成失败即时停止行为不回归。

修复不包含新的真实飞影执行。下一次真实验收必须创建新 reproduction 工单并取得新的单条积分授权。

## 无积分修复与验证

实现分支：`codex/hifly-stale-failure-recovery`。

`createHandsOnImage()` 现在把当前商品上下文传给 `openHandsOnModal(product)`。打开时若可见弹窗为失败态，则复用已有 `resetGeneratedHandsOnImage(product)`：只点击「重新编辑」，确认「上传商品」重新出现后继续当前工单上传流程。不会点击「再次生成」。

TDD 证据：

- RED：新增回归测试在旧实现中等待被失败弹窗遮挡的外层上传入口，并以 `stale failed modal left the outer upload entry blocked` 失败；
- GREEN：新行为验证「重新编辑」被点击、外层上传入口未被点击、当前人物/商品素材均上传，之后才进入生成与确认；
- Luna 实现 Agent 的运行时模型不可见，记录为 `UNVERIFIED_RUNTIME_MODEL`；自定义 Agent 配置 `luna-worker / gpt-5.6-luna / max` 已验证。

独立复核结果：

```text
node --test test/batch-runner.test.js
80/80 pass

npm run check
Checked 204 JavaScript file(s)

npm test
874 total / 860 pass / 14 skip / 0 fail

git diff --check
pass
```

本修复阶段未访问飞影、未创建工单、未执行真实生成、积分消耗 0。
