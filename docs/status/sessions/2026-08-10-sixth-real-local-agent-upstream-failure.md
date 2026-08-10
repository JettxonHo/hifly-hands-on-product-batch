# 2026-08-10 第六次真实 Local Agent：飞影手持图上游失败

## 授权与执行边界

Owner 明确授权工单 `77aa217b-9a86-42de-8412-6dca62b0841b` 最多执行 1 条真实飞影生成，接受积分扣除风险，并要求失败立即停止、不自动重试。

执行前无副作用核验：

- Local Agent checkout：`main@ef7c5e5f235883642c24f75f5122ef52ed2fd280`
- 工单：全组织唯一 `waiting_for_executor`
- 交接包 `8df73c3d-7fdd-49b5-b672-a2e1f4b420b1`：`ready / v1`
- 该工单 ExecutionAttempt：0
- 飞影登录预检：`ready / playwright`

## 唯一真实执行

只运行一次：

```bash
LOCAL_AGENT_REAL_EXECUTION=true npm run local-agent:run-once -- --real
```

该命令完成：

1. heartbeat 200；
2. claim 201；
3. start 200；
4. download package 200；
5. 人物与商品素材上传；
6. 点击一次飞影手持商品图生成；
7. 收到飞影明确失败后提交 failed report 201 并退出。

没有运行第二次命令，没有自动重试。

## 结果与证据

- Production order：`failed`
- Execution attempt：`8793ea7b-4fe5-41a5-b4b1-1dfbff6d5013 / failed`
- Execution report：`70cd9d0d-556b-4e96-a4fe-89d65832c59d / failed / not_retryable`
- Candidate：0
- Work：0
- 外层视频提交：未发生

浏览器缓存中的同次飞影响应显示：

```text
endpoint: goods_holding_image_generation
http: 200
code: 0
data.status: 4
```

页面适配器把该状态对应的“生成失败”识别为失败并立即退出。飞影“最新作品”仍只有此前作品 `692503`，没有出现本次新视频。因此本次不是下载或远端作品匹配失败，而是在手持商品图生成阶段由飞影明确失败。

## 积分判断

页面在执行前后读取的账户余额均为 `56041`，未观察到净扣分。由于积分流水可能存在延迟或其他结算规则，最终结果仍以飞影后台账单为准。

## 结论与下一步

- 本地登录、云端 claim/start/package/report、素材上传和失败态识别均按设计工作。
- 当前失败证据指向飞影手持商品图上游，不支持凭空修改本地代码。
- 本次真实授权已经使用。禁止恢复或重复执行该 `not_retryable` attempt。
- 若继续真实验收，应先由 Owner 决定是否接受再次上游失败风险，再创建新的 reproduction 工单并取得新的单条积分授权。
