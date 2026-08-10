# 2026-08-10 第六次真实 Local Agent 验收前置

## 决策

Owner 确认下一优先级是先完成一条最小真实端到端生产闭环，而不是继续横向扩充生产功能。当前步骤只准备工单和执行门禁；不包含新的真实飞影生成授权。

## 权威输入

- 商品：`ca54826c-91b3-4b9e-9fb7-f922a4152e1d`（`iPad 平板电脑`）
- 已批准视频方案：`ab4f7c0c-2cfa-4023-9b63-b419233efab3`（v1 / frozen / approved）
- 已确认人物素材版本：`4e1bbcbb-5e8c-483e-9ea3-9a1ce51732a0`

云端当前只有这一个具备完整批准链的商品/人物/方案组合。第四次真实执行曾使用同组输入成功生成飞影手持商品图和外层视频；第五次飞影返回的“生成失败”因此按单次上游业务失败处理，不凭空修改权威输入或新增未经批准的素材。

## 新工单与交接包

通过正式 HTTPS API 创建：

- reproduction 工单：`77aa217b-9a86-42de-8412-6dca62b0841b`
- 工单状态：`waiting_for_executor`
- 交接包：`8df73c3d-7fdd-49b5-b672-a2e1f4b420b1`
- 交接包状态：`ready / v1`
- 生成 job：`6d482d51-171a-40b1-be6c-b73d449c7b97`
- job 状态：`succeeded / attempts 1`

创建前云端没有活跃工单。创建后只读数据库复核确认该工单是全组织唯一 `waiting_for_executor` 工单，ExecutionAttempt 数为 0。

## 无副作用门禁

Mac Local Agent checkout 为 `main@47093bb`。仅调用真实执行器 `preflight()`：

```json
{"status":"ready","backend":"playwright"}
```

该检查只打开飞影“手里有货”页面并确认登录态；没有领取云端工单、上传素材或点击生成。

随后在待执行工单存在时运行默认 standby，结果为 heartbeat 200 和 `local_agent_standby`；没有 claim 或 ExecutionAttempt。

## 安全停点

- 未运行 `LOCAL_AGENT_REAL_EXECUTION=true ... --real`。
- 未上传人物或商品图。
- 未点击飞影生成。
- 未创建 ExecutionAttempt、candidate 或 Work。
- 飞影积分消耗 0。

第五次真实授权已经使用。下一步必须获得 Owner 对“最多 1 条真实飞影生成及积分风险”的新明确授权，才允许运行一次 real 双门禁。任何失败立即停止且不自动重试。
