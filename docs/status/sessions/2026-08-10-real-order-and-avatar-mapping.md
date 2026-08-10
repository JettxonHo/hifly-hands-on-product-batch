# 2026-08-10 单条真实工单与人物映射准备

## 目标与边界

为后续一次真实飞影「手里有货」验收准备完整云端工单与 Mac 人物映射。本轮不启用 real executor，不领取工单，不访问飞影，不消耗积分。

## 云端业务链

- Project：`cbd2399e-d1bc-4bc8-b295-bb0a9e15ce07`（真实出片验收 2026-08-10）
- Product：`ca54826c-91b3-4b9e-9fb7-f922a4152e1d`（iPad 平板电脑）
- Product revision：`604560b9-1a3c-404c-905a-7f3bfaa1c92c`，状态 Ready
- Copy version：`cc89f6ba-aebb-495f-bcde-532c8b6eb74c`，QC 通过并人工批准
- Avatar selection：`6a5148ad-0378-408d-a83a-11547a9b120c`（林小满 v1）
- Avatar asset version：`4e1bbcbb-5e8c-483e-9ea3-9a1ce51732a0`
- Video plan：`ab4f7c0c-2cfa-4023-9b63-b419233efab3`，v1，预检存在允许审核的执行环境提醒，人工批准
- Production order：`97bba08b-d602-4fd2-88b3-86f3af76f570`，`first_production / waiting_for_executor`
- Manual handoff package：`ca1e1192-ea25-465f-ba06-78cb67c8afab`，`ready / v1`
- Manual/Local Agent execution attempts：0

## 本地人物映射

- 人物素材版本已在 Mac 用户级私有 JSON 中映射到本地人物 PNG。
- 映射 JSON、人物图和 Local Agent 环境文件权限均为 600；真实路径、Token、登录态和图片不提交仓库。
- Local Agent 环境已指向人物映射文件和现有飞影 `config.local.json`。

## 无副作用验证

1. 从云端 GUI 下载 ready 交接包到仓库外目录。
2. 使用正式 `extractHandoffPackage`、`loadAvatarMappings` 和 `compilePackageToBatchItem` 离线编译成功。
3. 编译结果为单商品 iPad 任务；商品图可读，批准文案长度 72，人物映射来源为 `local_agent_mapping`，人物版本与云端一致。
4. 有待执行工单时运行默认 `npm run local-agent:run-once`，结果为 heartbeat 200 与 `local_agent_standby`。
5. 数据库复核工单仍为 `waiting_for_executor`、交接包仍为 `ready`、attempt 数仍为 0。

## 下一步门禁

只有 Owner 对本次 1 条真实生成再次明确接受飞影积分扣除后，才允许运行：

```bash
LOCAL_AGENT_REAL_EXECUTION=true npm run local-agent:run-once -- --real
```

真实运行只执行一次。任何失败立即停止且不自动重试；记录工单、attempt、飞影远端作品、候选文件、A12 Work 和积分情况。
