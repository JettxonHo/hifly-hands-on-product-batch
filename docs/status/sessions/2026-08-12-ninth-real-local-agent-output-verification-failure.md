# 2026-08-12 第九次真实 Local Agent 出片与 A12 核验技术失败

## 授权与前置门禁

Owner 已明确授予未来 5 次单条真实飞影生成 standing authorization，无需逐次再次确认；每次仍要求唯一工单、0 attempt、交接包 ready、飞影登录预检 ready，且失败即停、不自动重试。

PR #116 合并后，使用 `LOCAL_AGENT_HIFLY_CONFIG_PATH` 指向的同一外部配置重新登录飞影。无副作用预检返回：

```json
{"backend":"playwright","status":"ready"}
```

通过正式云端 API 创建：

- reproduction 工单：`970cc09d-2f33-4c9c-9b2a-72136bdc8988`
- 工单创建状态：`waiting_for_executor`
- 交接包：`89e14d98-5619-456c-b82a-88112a823949`
- 交接包状态：`ready / v1`
- 交接包 job：`dba31154-f901-4e83-aa25-606bacf97d84 / succeeded / attempts 1`

执行前再次确认全组织只有该工单活跃、ExecutionAttempt 数为 0、交接包 ready、Playwright 登录预检 ready。

## 唯一真实执行结果

只运行一次 real 双门禁。本次正式使用 standing authorization 的第 1/5 次，启动后剩余 4 次。

真实页面证据：

1. 点击外层“上传人物+产品图”后检测到账号级旧失败态，自动点击“重新编辑”，没有点击“再次生成”。
2. 清理旧残留后上传本工单人物图和商品图，并通过商品图替换校验。
3. 只点击一次手持商品图“立即生成 150积分”；约 80 秒后生成成功并确认。
4. 关闭 AI 自动文案，填入并回读 72 字批准文案。
5. 只点击一次外层视频“立即生成”；最新作品出现 `2026-08-12 08:57:44` 的生成中条目。
6. 飞影作品 `remote_id=696679` 生成完成。自动化按稳定作品身份匹配下载按钮，并确认命中动作 `isDownload=true / isDanger=false`。
7. MP4 下载后成功获得云端候选上传授权、上传、完成候选并提交结果报告；进程以 0 正常结束，没有第二次生成。

云端记录：

- attempt：`5c093c19-19b5-456e-8028-60ff2ec03459 / succeeded`
- report：`e2c523e9-a5c6-4d7b-b825-61b5f7aba96b / completed`
- candidate：`e6d33671-f662-458a-a200-cfb4e85d5f7a / pending_verification`
- candidate media：`video/mp4 / 41874377 bytes`

## A12 技术失败

Local Agent 成功报告触发 A12 artifact verification 后：

- verification job：`bd0789ed-e152-49fa-8931-17bb58e0a422`
- job：`failed / attempts 1`
- failure：`technical / MANUAL_HANDOFF_CONTEXT_REQUIRED`
- candidate verification：`failed / technical / MANUAL_HANDOFF_CONTEXT_REQUIRED`
- ProductionOrder：`running`
- Work：0

代码诊断确认 `work-verification-service.authoritativeInput()` 已从 job 构造 `actorMemberId / actorRole`，但调用 `packagePort.getPackage()` 时只传 `organizationId / packageId`。生产 wiring 使用需要 actor context 的 `manualHandoff.service.getPackage`，因此核验 worker 被正确拒绝。该问题不影响飞影出片、文件下载、候选上传或报告完整性。

## 积分与安全停点

- 本轮已点击一次手持图生成和一次外层视频生成，存在真实积分消耗；最终以飞影后台账单为准。
- 没有自动重试，没有第二个 ExecutionAttempt，也没有第二次飞影提交。
- standing authorization 已使用 1 次，剩余 4 次。
- 当前修复和恢复不需要再次访问飞影：只修复内部 actor context 透传，部署后对既有 verification job/candidate 发起技术核验重试。

## 下一步

1. `luna-worker` 用 TDD 锁定 worker package lookup 必须转发 job 的 actor context，并完成最小修复。
2. 主控独立 review，完整测试通过后提交 PR、等待 CI、合并并部署。
3. 使用正式 A12 技术重试入口只重试 verification job `bd0789ed-e152-49fa-8931-17bb58e0a422`；不得运行 Local Agent real 命令或触发飞影。
4. 只读确认 candidate `passed`、order `succeeded`、Work 已创建后，才能宣称新云端系统最小真实执行器闭环跑通。

## 无积分修复验证

- `luna-worker` 先新增回归测试，旧实现得到 `expected passed / actual failed`，证明测试能捕获生产故障。
- 最小实现只在 `authoritativeInput()` 调用 `packagePort.getPackage()` 时补传 job 已持久化的 `requested_by_member_id / requested_by_role`；没有绕过 `manualHandoff.service.getPackage` 的 actor 校验，也没有修改公开 API。
- 主控独立 review 未发现 blocker；定向服务/API/wiring 测试通过。
- 完整验证：`npm run check` 检查 204 个 JavaScript 文件；`npm test` 共 879 项，865 pass / 14 environment skip / 0 fail；`git diff --check` 通过。
- 修复阶段没有访问飞影、没有运行 Local Agent real 模式、没有上传或生成、没有产生额外积分消耗。

## 部署与既有核验恢复结果

- PR #117 在 Ubuntu、Windows、PostgreSQL 三项 CI 全绿后 squash 合并到 `main@eaf64c9`。
- 阿里云升级前生成数据库备份 `/var/backups/hifly/hifly-20260812T012109Z.dump`，并将旧应用镜像标记为 `hifly-pilot-app:rollback-e9c0df2`。服务器源码快进到 `eaf64c9`，13 组 production migration 全部成功；app/postgres/proxy 均 healthy，HTTPS `/healthz` 返回 `ok`，Git 工作树干净。
- 部署后仅对既有 verification job `bd0789ed-e152-49fa-8931-17bb58e0a422` 调用一次正式技术重试。未运行 Local Agent real 命令，未访问飞影，未创建第二个视频或候选，未产生新的积分消耗。
- job 第 2 次尝试完成为 `succeeded / passed`；candidate `e6d33671-f662-458a-a200-cfb4e85d5f7a` 的 verification 状态为 `passed`，技术失败字段已清空；ProductionOrder `970cc09d-2f33-4c9c-9b2a-72136bdc8988` 为 `succeeded`。
- Work `41905ac8-4a41-4072-84cd-a6856c7e0124` 已登记为 `available`，主资产版本 `838c83c9-e5a6-4f33-86b0-ffa378bbcde3` 为 `available / video/mp4 / 41874377 bytes`，与原候选一致。
- 最小真实执行器闭环现已实证跑通：云端工单与交接包 → Mac Local Agent → 飞影生成作品 `696679` → 下载 → 候选上传 → A12 核验 → Work 登记。standing authorization 剩余 4 次；本次真实生成实际积分仍以飞影后台流水为准。
