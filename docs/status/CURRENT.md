# 项目当前状态

> 最后更新：2026-08-13
> 当前 Goal：P0 Cloud Executor 纯云端生产闭环（D-034）
> 当前结论：CE-08 单条闭环与 P0.4 三条严格串行内部试运行均已通过；可以继续 release-readiness，仍不等同于公网生产就绪、自动批量队列或长期稳定性证明。
>
> 2026-08-13 收敛前的完整时间序列已保留在
> `docs/status/archive/CURRENT-through-2026-08-13-pre-closeout.md`。

## P0.4 三条严格串行内部试运行

- 生产代码与部署基线为 `main@40e92414d4ef4a4015da9bb3f709f775c67843b6`，App 在最终重启后保持 healthy。
- SKU001、SKU002、SKU003 先分别完成到 approved VideoPlan；每轮只在 Worker 关闭时创建当前唯一
  `waiting_for_executor` ProductionOrder 和 `ready` handoff package。激活前全组织 eligible 恰好为 1，
  当前工单 attempts 为空；上一轮完成 A12、Work 与鉴权字节下载后才创建下一轮。
- 三个工单均由 Cloud Executor 严格串行完成，且每单恰好一个 succeeded attempt、一个通过的 A12、
  一个 available Work；没有失败、`requires_action`、重试、重复提交或 Mac Local Agent 参与。
- 三个鉴权下载均返回真实 `video/mp4` 字节，大小与已登记 checksum 一致；最终 App 重启后作品库仍显示
  包含 SKU001/002/003 的 5 个作品，SKU003 的鉴权下载在该重启后再次通过。
- 飞影仅记录运行中观察值：SKU001 `06:36:12 / 51,464`、SKU002 `06:58:24 / 50,864`、
  SKU003 `07:14:18 / 50,259`。最终标签页卡住，三条完成后的动态余额未验证，因此不得据此推断总积分消耗。
- 收尾后 `eligible=[]`、`active_attempts=[]`，Mac Local Agent 进程为空；生产配置恢复为
  `PRODUCTION_EXECUTOR=fail_closed`、`LOCAL_AGENT_ENABLED=false`、`CLOUD_EXECUTOR_ENABLED=false`、
  `CLOUD_EXECUTOR_MODE=fail_closed`、`CLOUD_EXECUTOR_CONCURRENCY=1`，Cloud Executor `stopped / exited 0`。
- 完整对象 ID、包哈希、文件大小、SHA-256 和逐轮边界见
  `docs/status/sessions/2026-08-13-cloud-executor-three-product-internal-trial.md`。

## CE-08 生产收尾证据

- 代码基线为 `main@f519d42db26ef5f59cb8a6a6fb80bf8b68fb7eb3`；PR #155 已 squash merge。
- Ubuntu、Windows、identity-postgres 三组 CI 均为 green。
- 云端仓库工作树已快进至该提交；部署前数据库备份已写入受保护的备份卷
  （471289 bytes），回滚镜像为 `hifly-pilot-app:rollback-dc4ca9f-ce08-download`。
- 本次只重建并重启 App。App healthy；Cloud Executor 输出卷在 App 内以只读方式挂载；
  Cloud Executor 本轮保持 exited/未启动，没有领取新工单。
- 既有唯一订单
  `ff5285cd-d2b7-4552-a276-cff18015fc67`、attempt
  `46d1f209-caf8-4998-8d5d-5e435b0b0f11`、candidate
  `09891151-59e6-4c87-849e-c6f0defc1be4`、A12
  `2e8adabc-c570-4ef6-b5bb-26733c4ad262` 与 Work
  `80958749-9f92-40e6-a30e-7c886b555ef6` 已逐项复核：订单/attempt 为
  `succeeded`，candidate 为 `pending_verification / passed`，A12 为
  `succeeded / passed`，Work 为 `available`。
- App 部署后及随后再次重启 App 后，真实 HTTPS 鉴权下载均为授权创建 POST 201、鉴权 GET 200；
  重启后的完整响应发送 `43,425,097` bytes。
- 下载文件、数据库 candidate/AssetVersion 与输出卷内容的 SHA-256 均为
  `0becaab1076a8af1124ed4f10f8eac5fc93b21d41af3adb8db5b59213f1ab96b`。
- 本轮未访问飞影、未启动 Worker、未新增 attempt：`target_attempts=1`、`active=0`、`total=10`；
  积分记录仍只有原 CE-08 真实生成的 650。

## P0 验收结论

- 新的零-attempt 工单已经完成
  `Cloud GUI → Cloud Executor → Hifly → 下载 → 云端 artifact → A12 → Work → 用户鉴权下载`。
- Cloud Executor P0 合同的单条纯云端闭环已满足，GOAL 为 `COMPLETE`；P0.4 三条严格串行内部试运行也已通过，下一阶段为 release-readiness。
- Worker 仍保持单实例、并发 1、失败即停和默认 disabled/fail-closed；Local Agent 未参与本次闭环。
- 本结论只证明三条由人工门禁逐轮暴露的严格串行路径，不证明自动队列批量运行、更大规模或长期稳定性，也不宣称公网生产就绪、正式 SLA、高可用或灾备。

## 发布就绪后续

- 现有公网证书为自签名，严格 CA 校验失败；可信证书与依赖治理由 #157 跟踪。
- `npm audit --omit=dev` 为 `0 critical / 5 high / 2 moderate`；这些是既存依赖风险，未由 PR #155 引入，
  需在 release-readiness 阶段形成升级或风险接受记录。
- #156 的最小修复已完成并通过本地浏览器回归：`works.html?work=<id>` 首次加载会选中
  组织内可见目标；缺失或不可见 ID 回落到第一条可见作品且不渲染隐藏作品信息。生产仍未部署，部署验证留待后续 release-readiness。

## 当前运行时边界

- Cloud Control Plane 负责订单、attempt、交接包、报告、A12、Work 和 Delivery 的业务状态与鉴权。
- Cloud Executor 是独立执行身份；本轮完成证据来自云端链路，不将其伪装为人工成员或 Local Agent。
- 生产 Worker 的并发上限保持 1；同一订单最多一个活动 attempt，lease 过期或阶段不确定时进入受控状态。
- 飞影 Profile、商品/人物素材、Evidence 和输出视频位于云端持久卷；App 只读访问输出卷作为下载回退。
- 数据库只保留 artifact/AssetVersion 等受控元数据和内部引用，公共投影不暴露 Token、Cookie、服务器路径或对象存储 key。
- 三条试运行每轮仅短时激活 Worker；每轮终态后先停止 Worker 并恢复 fail-closed，再执行 A12、Work 和下载验收。最终 Worker 已关闭且无 eligible order 或 active attempt。
- Local Agent 继续保留为 legacy fallback；本轮未启动，后续也不得以它作为 P0 生产执行器。

## P0 完成定义映射

合同第 9 节的 11 项均有当前证据或既有实现覆盖：

1. 个人电脑关闭不影响本次云端订单完成。
2. 本次验收及下载复验未启动 Local Agent。
3. 浏览器 GUI 可提交、观察状态并下载鉴权 Work。
4. CE-07 已证明 Worker/Profile 重启恢复；CE-08 收尾证明 App 重启后视频持久性与下载字节保持。
5. Worker 运行约束为单实例、并发 1。
6. 订单与 attempt 使用既有幂等/租约合同，未发生重复提交。
7. 登录、存储和 readiness 门禁在 claim 前失败关闭。
8. 失败状态不自动重试，也不自动创建新 attempt。
9. 视频落在云端持久输出卷并可通过鉴权下载。
10. 新零-attempt 工单完成 Cloud GUI 到用户下载的完整链路。
11. 第 10 项完成后进入严格串行、受控内部试运行，而非公网生产。

## 生产操作护栏

- 每条内部试运行先复核唯一工单、审批链、handoff ready、零 attempt、Profile/login readiness 和磁盘门限。
- 每次最多执行一个工单；首个失败阶段立即停止，禁止按钮级调试重跑或沿用失败 attempt。
- 真实飞影动作与积分消耗必须有当次明确授权，并记录订单、attempt、作品、产物路径和账单边界。
- 发生下载、A12 或 Work 异常时优先复用既有成功产物做无积分复验，不重新生成。
- 任何并发扩容、Provider/API 接入、Local Agent 恢复或公网发布都需 Owner 单独决策。

## 权威文档与恢复顺序

1. `AGENTS.md`：范围、积分、文件和协作安全门禁。
2. `GOAL.md`、`docs/product/CLOUD_EXECUTOR_P0.md`：P0 合同和完成定义。
3. `docs/ROADMAP.md`：下一阶段内部试运行与 release-readiness 顺序。
4. 本文件：最新生产事实与边界；历史过程见 archive 和 sessions。
5. `docs/PROJECT_HANDOFF.md`：仅作历史背景，不覆盖本快照。

## 里程碑状态

| 里程碑 | 结果 | 状态 |
|---|---|---|
| CE-01 / #136 | 合同、Goal、设计、计划与 Issues | 已完成 |
| CE-02 / #137 | `cloud_executor` 身份、默认 fail-closed 串行 Worker | 已完成 |
| CE-03 / #138 | 复用现有 Hifly Playwright 核心 | 已完成 |
| CE-04 / #139 | 持久 Profile、受控可视登录、readiness | 已完成并实证 |
| CE-05 / #140 | 持久素材/视频、鉴权下载、磁盘门限 | 已完成 |
| CE-06 / #141 | 控制面状态与作品体验 | 已完成 |
| CE-07 / #142 | 阿里云 standby、卷与重启恢复 | 已完成并实证 |
| CE-08 / #143 | 一条纯云端真实出片验收 | 已完成并关闭 |
| P0.4 / #132 | 三条严格串行 Cloud Executor 内部试运行 | 已完成并关闭 |

## 下一步

1. 进入 P0.5 release-readiness：#156 深链首选项修复已完成；可信证书、依赖治理和后续部署验证继续按 #157 / release-readiness 顺序推进。
2. 保持 Cloud Executor 默认 disabled/fail-closed、并发 1，继续保留逐单授权、唯一 eligible、首失败即停和无自动重试护栏。
3. 是否扩大试运行规模、开放自动队列或宣称长期稳定，必须基于新的运行证据和 Owner 单独决策；本次三条结果不能直接外推。

## 长期边界

- Local Agent 保留为 legacy fallback，不是当前 P0 生产路径或验收依据。
- 不在本阶段扩展并行生产、Capture HTTP、声音/背景/姿势/动效、复杂对象存储或高可用。
- Profile、Cookie、素材、视频、Evidence、Token、下载文件和服务器绝对路径不得进入 Git、公共 API 或日志。

## 已执行验证与证据索引

- PR #155 的 Ubuntu、Windows、identity-postgres CI 均通过；基线与部署提交一致。
- App 部署前数据库备份可读且非空；回滚镜像已保留。
- App healthy、输出卷只读挂载、App 重启后鉴权下载 201/200 与完整字节发送均已实测。
- 下载、candidate/AssetVersion 与输出卷 SHA-256 已交叉核对一致。
- #132 三条试运行均为单一 eligible、零初始 attempt、一个 succeeded attempt；A12/Work/鉴权下载逐条通过，最终无 eligible order 或 active attempt。
- 本文档只记录生产收尾事实；历史实现过程、失败尝试和旧门禁详见归档 CURRENT 与各 session 文档。
