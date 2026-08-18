# 2026-08-19 Fidelity-0 Provider capability gate

## 1. 范围与基线

- 仓库基线：`origin/main@a2a1e96e42655fa7d26f8686b9848d261c2a92af`。
- 跟踪：Issue #210。
- Owner 授权：最多一次可能收费的“手持商品候选生成”；不含候选确认、外层视频生成、第二次候选、重试、生产工单或
  Fidelity-A～E 实现。
- 本会话先执行零费用源码、脱敏 HTTP、DOM 与历史 Evidence 审计；只有在证据不足时才使用一次真实候选动作。

## 2. 零费用审计

- `createHandsOnImage()` 的页面时序是上传人物与商品图、选择商品大小、点击候选生成、等待候选，再点击候选“确认”；
  外层视频提交由后续独立动作完成。
- 候选完成弹窗可观察“再次生成 / 重新编辑 / 确认”，因此存在理论上的视频前暂停点。
- 历史脱敏 HTTP 响应把 `gen_id`、`image_url`、`goods_image_oss_key`、`human_image_oss_key` 与完成状态放在同一响应；
  旧候选 URL 已返回 403，无法证明当前 bytes、当前生命周期或恢复能力。
- 因零费用证据不足以证明当前候选 bytes 与恢复语义，按 Owner 授权进入一次真实候选生成门禁。

## 3. 付费前门禁

- 本次没有可证明的 ProductRevision AssetVersion，因此使用合同允许的确定本地源文件：
  `/private/tmp/hifly-real-sunscreen-evidence-input-20260818/SUNSCREEN-20260818-001.png`。
- 源文件为 PNG 656x952、419685 bytes，SHA-256
  `e57cf213cbbf8f6acafed0a1bf4a47db33e7a1668237181dc77499eb9cf387c5`。
- 在同一编辑会话中只替换商品槽位，Provider 当前商品预览受控读取为 200 `image/png`、419685 bytes，SHA-256 与
  本地源文件完全一致；证明本次实际 Provider 上传输入，但不把本地文件伪装成领域 AssetVersion。
- 登录态可用，目标弹窗明确，候选按钮显示“立即生成 150积分”，没有旧候选残留。
- 生产安全态：Cloud Executor stopped，`CLOUD_EXECUTOR_ENABLED=false`、`CLOUD_EXECUTOR_MODE=fail_closed`、
  `LOCAL_AGENT_ENABLED=false`、`PRODUCTION_EXECUTOR=fail_closed`；`eligible=0`、`active_attempts=0`，Mac Local Agent
  进程不存在。

## 4. 唯一真实候选动作

- 在 `2026-08-18T19:32:00.141Z` 恰好点击一次候选生成；没有第二次点击或自动重试。
- 候选完成后弹窗保持“再次生成 / 重新编辑 / 确认”，等待 10 秒仍为就绪；外层作品数量前后均为 3。
- 没有点击候选“确认”，没有点击外层视频生成，没有创建或复用 ProductionOrder，也没有启动 Worker/Local Agent。
- Provider header 在动作前后可见值均为 `42594`，页面没有刷新最终余额。因此只记录一次可能收费的候选生成，
  不宣称精确扣除 150 积分。

## 5. 候选与恢复 Evidence

- 关闭浏览器上下文后，以同一受控 Playwright Profile 重新进入，登录态仍有效，候选弹窗恢复为同一就绪状态。
- 恢复响应包含 `gen_id`、`goods_image_oss_key`、`goods_size`、`human_image_oss_key`、`image_url`、`status`；
  `gen_id=lZRGIwOKPBScFlEz`，`status=3`。
- 候选引用只记录脱敏形状：HTTPS、host=`hfcdn.lingverse.co`、`.jpg`、无 query；不记录完整 URL、Cookie、Token、
  密码或完整敏感请求头。
- 受控读取候选为 200 `image/jpeg`、275745 bytes，SHA-256
  `1778a04198280c4cf2d08f78ba544085da44611d76f69b0653004bffe483244b`。同一响应将该引用与上述 `gen_id` 绑定。
- 临时截图与读回证据只保存在系统临时目录，不进入 Git。

## 6. 结论与边界

Fidelity-0 对以下**有界 Provider seam**给出 PASS：精确上传输入可逐字节证明；候选完成后存在可读取 bytes/reference；
即时浏览器上下文重启可以恢复候选；流程可以在候选确认和外层视频提交前安全暂停。

本结论不是商品外观保真 PASS，也不证明长期或跨设备生命周期、正式下载 API、Provider 自动评分、精确积分变化、
ProductRevision AssetVersion 绑定、领域候选持久化、人工批准、自动检查、执行器恢复或生产可用。Fidelity-A 只能在本证据
经独立审阅并合并后，另行设计状态所有权、领域对象、组织隔离、审计、幂等与显式源 AssetVersion 绑定；不得自动开始实现。

## 7. 收尾状态

- 真实候选生成动作：1。
- 外层视频生成动作：0。
- 第二候选或重试：0。
- 生产工单、claim、attempt：0。
- 收尾复核仍为 Cloud Executor/Local Agent disabled、`eligible=0`、`active_attempts=0`、`waiting_orders=0`；
  `total_attempts=17` 为既有历史值，未由本次增加。
- 未修改生产业务数据，未生成视频，未提交敏感证据。

## 8. 仓库验证

- `npm run check`：通过，230 个 JavaScript 文件。
- `git diff --check`：通过。
- strict allowlist：通过，仅 5 份文档。
- Draft PR #211 首个提交 `65f3aae` 的 CI 全部通过：Ubuntu 52 秒、Windows 1 分 44 秒、
  identity-postgres 2 分 23 秒；后续固定提交的结果以 PR checks 记录为准。
