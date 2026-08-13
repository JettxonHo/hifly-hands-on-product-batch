# 项目当前状态

> 最后更新：2026-08-13
> 当前 Goal：P0 Cloud Executor 纯云端生产闭环（D-034）
> 当前结论：CE-08 单条纯云端闭环已完成并通过验收，可进入严格串行、受控内部试运行；这不等同于公网生产就绪。
>
> 2026-08-13 收敛前的完整时间序列已保留在
> `docs/status/archive/CURRENT-through-2026-08-13-pre-closeout.md`。

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
- Cloud Executor P0 合同的单条纯云端闭环已满足，GOAL 可标记 `COMPLETE`，下一阶段为受控内部试运行。
- Worker 仍保持单实例、并发 1、失败即停和默认 disabled/fail-closed；Local Agent 未参与本次闭环。
- 本结论只覆盖内部受控试运行边界，不宣称公网生产就绪、正式 SLA、高可用或灾备。

## 发布就绪后续

- 现有公网证书为自签名，严格 CA 校验失败；可信证书与依赖治理由 #157 跟踪。
- `npm audit --omit=dev` 为 `0 critical / 5 high / 2 moderate`；这些是既存依赖风险，未由 PR #155 引入，
  需在 release-readiness 阶段形成升级或风险接受记录。
- 已确认的非阻塞 UX follow-up #156：`works.html?work=<id>` 首次加载因
  `loadWorks({preserveSelection:false})` 忽略 query 而默认选择第一条；人工重新选择目标后下载正常。

## 当前运行时边界

- Cloud Control Plane 负责订单、attempt、交接包、报告、A12、Work 和 Delivery 的业务状态与鉴权。
- Cloud Executor 是独立执行身份；本轮完成证据来自云端链路，不将其伪装为人工成员或 Local Agent。
- 生产 Worker 的并发上限保持 1；同一订单最多一个活动 attempt，lease 过期或阶段不确定时进入受控状态。
- 飞影 Profile、商品/人物素材、Evidence 和输出视频位于云端持久卷；App 只读访问输出卷作为下载回退。
- 数据库只保留 artifact/AssetVersion 等受控元数据和内部引用，公共投影不暴露 Token、Cookie、服务器路径或对象存储 key。
- 本次复验没有重启或激活 Worker，没有 claim 新工单，也没有触发 Provider 页面动作。
- Local Agent 继续保留为 legacy fallback；本轮及下一阶段内部试运行均不得以它作为 P0 生产执行器。

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

## 下一步

1. 按 #132 执行 3 条严格串行的内部试运行；CE-08 授权不延续，每条都须重新取得明确的单条积分授权，并通过唯一工单、零 attempt、审批链和交接包门禁；每条最多一个工单，首失败即停，不自动重试。
2. 记录每条试运行的订单、attempt、产物校验、A12/Work、下载响应和资源峰值；不得启动并行 Worker 或恢复 Local Agent 生产路径。
3. 完成可信证书、依赖审计处置和 works query 选择修复，再由 Owner 单独决定是否扩大范围。

## 长期边界

- Local Agent 保留为 legacy fallback，不是当前 P0 生产路径或验收依据。
- 不在本阶段扩展并行生产、Capture HTTP、声音/背景/姿势/动效、复杂对象存储或高可用。
- Profile、Cookie、素材、视频、Evidence、Token、下载文件和服务器绝对路径不得进入 Git、公共 API 或日志。

## 已执行验证与证据索引

- PR #155 的 Ubuntu、Windows、identity-postgres CI 均通过；基线与部署提交一致。
- App 部署前数据库备份可读且非空；回滚镜像已保留。
- App healthy、输出卷只读挂载、App 重启后鉴权下载 201/200 与完整字节发送均已实测。
- 下载、candidate/AssetVersion 与输出卷 SHA-256 已交叉核对一致。
- 本文档只记录生产收尾事实；历史实现过程、失败尝试和旧门禁详见归档 CURRENT 与各 session 文档。
