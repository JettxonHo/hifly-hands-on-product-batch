# 2026-08-10 第四次真实 Local Agent：飞影作品生成成功，下载根目录错误失败即停

## 授权与前置状态

- Owner 明确授权最多执行 1 条真实飞影生成，接受积分扣除；失败立即停止且不自动重试。
- 旧失败 attempt 为 `not_retryable`，没有恢复、覆盖或篡改其审计记录。
- 通过正式 API 创建 reproduction 工单 `bc0153e2-1f2c-49bd-a75d-ab909fb28a20`。
- 交接包 `e4ed7df0-0b87-4ce4-acfd-17948215dff9` 生成成功，为 `ready / v1`。
- 数据库只读检查确认该工单是全组织唯一的 `waiting_for_executor` 工单，attempt 数为 0。
- 本机飞影无副作用预检返回 `ready`。

## 唯一一次真实执行

- heartbeat、claim、start、交接包下载和租约心跳均成功。
- 人物图与商品图上传成功；商品图扩展名修复生效。
- 手持商品图生成完成并由脚本确认。
- 已批准的 72 字文案成功写入并完成回读校验。
- 外层视频生成成功提交；飞影最新作品时间为 `2026-08-10 14:20:20`。
- 飞影作品 ID 为 `692503`，脚本正确识别并点击该作品的下载按钮，没有误点删除。

## 最终失败状态

- attempt：`f71a9bfd-51e2-4312-bc5d-206dd09c6504`
- report：`ed678819-b5f6-4bcb-b023-816492523325`
- order / attempt：`failed`
- report：`failed / not_retryable / local_executor`
- candidate：0
- 云端视频 / Work：无
- 失败后没有自动重试，也没有启动第二条真实命令。

## 根因

Local Agent 在系统临时目录创建每次执行的 `projectRoot` 和 `downloads/`。真实 Hifly executor 则由仓库配置创建，其 `config.__rootDir` 指向仓库目录。

`runBatch` 调用 `downloadArtifact(remoteEvidence, destination)` 时只传了临时下载目录，没有把本次批处理的 `projectRoot` 传给适配器。Hifly 页面适配器因此用仓库根目录验证临时下载路径，在下载按钮已经点击后、`download.saveAs()` 之前把该合法路径误判为越界路径。临时目录随后按设计清理，因此本地也没有残留 MP4。

## 无积分修复

- `runBatch` 的现有内部 executor context 增加 `projectRoot`。
- Hifly executor 将该 context 转发给页面适配器。
- Hifly 下载器优先使用 context 中的批处理根目录校验下载路径和生成相对路径；普通 GUI 路径没有 context 时仍使用原配置根目录。
- 原有“配置根目录之外的任意目标必须在 `saveAs` 前拒绝”行为保持不变。

TDD 红灯证明三段合同此前均缺失：批处理未提供根目录、Hifly executor 丢弃 context、页面适配器忽略批处理根目录。修复后相关测试 95/95 通过。

## 积分与下一步

本次真实流程已点击手持商品图 `立即生成 150积分` 和外层视频生成，因此会产生实际积分消耗；最终数额必须以飞影后台账单为准。页面外层提交时仍显示 `56841`，该读数尚未刷新，不能作为扣费后余额。

本次授权已经使用。修复合并后若继续真实验收，必须创建新的 reproduction 工单与 ready 交接包，重新完成唯一待执行和登录预检，并再次取得 Owner 对最多 1 条真实生成的明确授权。
