# 2026-08-10 首次真实 Local Agent 单条执行

## 授权与边界

- Owner 明确授权执行 1 条真实飞影「手里有货」生成并接受积分扣除。
- 失败后立即停止，不自动重试。
- 本轮只允许目标工单的一次 real 双门禁执行；不运行 fake，不提交私有配置、登录态、截图或产物。

## 执行前状态

- Production order：`97bba08b-d602-4fd2-88b3-86f3af76f570`，`waiting_for_executor / first_production`。
- Manual handoff package：`ca1e1192-ea25-465f-ba06-78cb67c8afab`，`ready / v1`。
- 该工单 attempt 数：0。
- 云端只有这一条 `waiting_for_executor` 工单。
- 默认 standby heartbeat 返回 200；本地人物映射、人物图和飞影配置文件存在且权限为 600。

## 单次真实执行结果

真实命令使用 `LOCAL_AGENT_REAL_EXECUTION=true` 与 `--real` 双门禁。执行日志确认：

1. Agent heartbeat 200。
2. claim 201，创建 attempt `3c90b604-f79f-4769-b235-7b00783bb724`。
3. start 200，交接包下载 200。
4. 飞影页面进入「手里有货」上传弹窗，但账号登录态已失效，页面叠加手机号/验证码登录框。
5. `HiflyHandsOnProductPage.uploadModalFile` 等待 `filechooser` 30 秒超时，Node 进程退出。
6. 没有点击弹窗「立即生成」，没有进入外层视频生成、确认或下载。

进程异常没有正常提交失败报告。租约过期后执行一次仅用于状态清理的 claim；服务端把原 attempt 和工单转为 `requires_action / lease_expired`，并返回空 attempt，没有创建第二个 attempt，也没有访问飞影或重试生成。

## 最终数据状态

- Attempt：`3c90b604-f79f-4769-b235-7b00783bb724`，`requires_action / lease_expired`。
- Production order：`requires_action`。
- Candidate：0。
- Manual execution report：0。
- Work：0。
- 本地忽略目录产生一张诊断截图，未进入 Git。

本次在上传前失败，且没有点击任何飞影生成按钮，因此按执行链判断没有触发积分动作；实际积分变化仍需以飞影账户后台为准。

## 发现的问题

1. Local Agent real preflight 只验证云端认证与本地文件，没有在 claim 前验证飞影网页登录态。
2. `uploadModalFile` 先创建 `page.waitForEvent("filechooser")`，页面被登录弹窗遮挡时 click 不会产生 chooser；等待 Promise 超时以未处理 rejection 结束进程，绕过 runner 的受控失败报告。
3. 异常退出后云端依赖下一次 Agent poll 才把过期租约收口为 `requires_action`。

## 下一步

1. 运营先运行 `npm run login`，在专用飞影浏览器 Profile 完成登录并保存状态。
2. 无积分、TDD 修复：real 执行 claim 前检查登录态；发现登录页时返回明确 requires-action；`filechooser` 等待必须被点击失败路径安全取消/回收，不能形成未处理 rejection。
3. 验证失败收口会提交受控报告，云端不再遗留运行态。
4. 修复后由人工把该工单恢复为 `waiting_for_executor`。
5. Owner 重新明确授权 1 条积分后，才允许再次运行 real 双门禁；不得复用本次授权。
