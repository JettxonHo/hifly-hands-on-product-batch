# 2026-08-11 第七次真实 Local Agent 验收前置

## 决策与边界

第六次工单 `77aa217b-9a86-42de-8412-6dca62b0841b` 已按 `not_retryable` 保留审计链，不恢复、不重用。Owner 要求新的验证必须创建 reproduction 工单，并重新取得单条积分授权。

本轮只创建新工单、生成交接包并完成无副作用预检；不包含真实飞影生成授权。

## 新工单与交接包

通过正式云端 HTTPS API 创建：

- reproduction 工单：`b5e180bc-7d7d-4d22-be4a-57ac0bd2484e`
- 工单状态：`waiting_for_executor`
- 已批准视频方案：`ab4f7c0c-2cfa-4023-9b63-b419233efab3`
- 交接包：`3c653228-2dff-420e-aaa1-5754792d299e`
- 交接包状态：`ready / v1`
- 生成 job：`72c3eb76-0f4c-4432-afca-3e065f850fb9`
- job 状态：`succeeded / attempts 1`

创建后只读数据库复核确认：

- 全组织只有该工单处于 `waiting_for_executor`；
- 该工单 ExecutionAttempt 数为 0；
- 没有其他 `claimed`、`running` 或 `requires_action` 活跃工单。

## 无副作用预检

只调用真实执行器 `preflight()`，结果：

```json
{"status":"ready","backend":"playwright"}
```

该检查只打开飞影“手里有货”页面并确认登录态。没有 heartbeat/claim、交接包下载、素材上传或生成按钮点击。

## 安全停点

- 未运行 `LOCAL_AGENT_REAL_EXECUTION=true ... --real`。
- 未创建 ExecutionAttempt、candidate 或 Work。
- 未触发飞影生成，积分消耗 0。
- 下一步必须由 Owner 针对工单 `b5e180bc-7d7d-4d22-be4a-57ac0bd2484e` 明确授权最多 1 条真实飞影生成并接受积分扣除风险。
- 获得授权后只运行一次；成功或失败都不得自动运行第二次。
