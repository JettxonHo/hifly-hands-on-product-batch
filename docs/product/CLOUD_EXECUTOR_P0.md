# Cloud Executor P0 产品合同

> 状态：Accepted
> Owner 决策日期：2026-08-12
> 对应决策：D-034
> 当前实现状态：CE-01～CE-08 已完成；新的零-attempt 纯云端闭环已在阿里云真实验证，可进入严格串行、受控内部试运行；不等同于公网生产就绪

## 1. P0 目标

P0 的生产主路径是纯云端闭环：

```text
任意现代浏览器
→ Cloud Control Plane
→ Cloud Executor Worker（云端 Chrome / Playwright）
→ 飞影「手里有货」
→ 云端持久化视频
→ A12 核验
→ Work / Delivery
→ 鉴权预览与下载
```

用户不需要让 Mac、Windows 或其他个人电脑保持在线。Local Agent 保留为历史兼容与后续可选执行路径，但不再是 P0 生产路径或验收依据。

只有一条新的、零 attempt 的 ProductionOrder 从 Cloud GUI 经 Cloud Executor 完成飞影生成、下载、云端 artifact、A12、Work 和用户鉴权下载后，才允许写“P0 可投入内部试运行”。

## 2. 产品边界

### Cloud Control Plane

继续复用现有 Web GUI、API、PostgreSQL、VideoPlan、ProductionOrder、ManualHandoffPackage、ExecutionAttempt、A12 Work Verification、Work 与 Delivery 合同。控制面负责业务状态、鉴权、任务编排和可观察投影，不在普通 HTTP 请求生命周期运行长时间浏览器任务。

### Cloud Executor Worker

Cloud Executor 是独立进程或独立 Docker service：

- 运行时身份固定为 `cloud_executor`，不得伪装为 `local_agent` 或人工操作员；
- 串行领取一条已批准、handoff ready 的 ProductionOrder；
- 并发固定为 1；
- 使用 lease、heartbeat、checkpoint 和幂等提交防止重复领取、重复提交和重复扣积分；
- 复用现有 Hifly Playwright 执行核心，不复制另一套 DOM 自动化；
- 飞影登录态无效、磁盘低于门限或配置未就绪时不领取新工单；
- 失败立即停止，不自动创建新 attempt，不自动重复提交飞影；
- 将商品图、人物图、Evidence 和输出下载到云端持久目录；
- 通过现有报告、候选产物与 A12 合同回传结果。

### P0 非目标

- 不删除 Local Agent 历史代码；
- 不做并行生产；
- 不在 P0 接入 OSS/COS 或建设复杂存储抽象；
- 不提前开发声音、背景、场景、姿势与构图等 P4 扩展；
- 不把 noVNC/VNC 暴露公网；
- 不宣称 2C4G 已具备正式生产 SLA、高可用或灾备；
- 不用 fake transport、登录成功或 standby 代替真实纯云端出片 Evidence。

## 3. 运行时身份与状态

Cloud Executor 与 Local Agent 使用不同身份和产品文案。最小状态投影：

| 状态域 | 值 | 含义 |
|---|---|---|
| Worker 连接 | `offline / online` | Worker 是否持续 heartbeat |
| 业务可用 | `disabled / unconfigured / requires_login / storage_blocked / available / busy / requires_action` | 是否可领取新工单 |
| 当前执行 | `standby / claimed / running / requires_action / succeeded / failed` | 当前工单阶段 |

`online` 不等于可生产。只有配置启用、飞影登录 ready、持久目录可写、磁盘高于门限且没有活动 attempt 时，Worker 才可显示 `available`。

控制台不得继续把“请启动本地 Agent”作为生产主提示。登录失效时显示“需要重新登录飞影”，失败时显示受控阶段和可操作原因，不暴露 Cookie、Token、Profile、服务器绝对路径或签名 URL。

## 4. 云端飞影登录

P0 提供受控的云端可视登录：

- Chromium/Chrome 使用持久化 Profile；
- Xvfb 或等效显示服务承载有头浏览器；
- noVNC 或等效入口只通过 SSH tunnel、VPN 或受限管理入口访问；
- 登录操作与生产领取分离，登录时不领取工单、不点击生成、不消耗积分；
- Profile 跨容器重建保留；
- Cookie、LocalStorage、Token、Profile 内容不进入 Git、业务数据库或业务日志。

## 5. 云端持久化与下载

P0 使用服务器持久磁盘，不把业务文件留在容器临时层。默认目录合同：

```text
/var/lib/hifly-executor/profile
/var/lib/hifly-executor/assets
/var/lib/hifly-executor/outputs
/var/lib/hifly-executor/evidence
```

目录通过 Docker volume 或宿主机 bind mount 持久化。数据库只保存内部 artifact id、相对/内部存储引用和受控元数据。浏览器通过现有身份会话访问鉴权预览/下载 API，不接收服务器绝对路径。

磁盘容量门限可配置。低于门限时 Worker 转为 `storage_blocked` 并停止领取新工单；不需要为 P0 引入复杂分层存储或新哈希机制。既有不可变素材合同需要 checksum 时继续复用既有实现。

## 6. 串行、恢复与积分安全

1. 单实例 Worker，领取并发固定为 1。
2. 一条 ProductionOrder 同时最多一个活动 ExecutionAttempt。
3. 领取、开始、heartbeat、候选上传、报告提交继续使用稳定 idempotency key。
4. lease 过期只进入 `requires_action`，不自动创建下一 attempt。
5. checkpoint 区分飞影提交前后；无法确认是否已提交时必须 `requires_action`，禁止自动重试。
6. 飞影登录无效、Profile 不可读、素材缺失、磁盘不足时均在 claim 前失败关闭。
7. 真实生成必须绑定新的零 attempt 工单和明确积分授权；首失败即停，不自动重试。

## 7. 2C4G 资源边界

现有阿里云 2C4G 只用于 P0 单条串行试验：

- Worker 并发固定为 1；
- 部署前检查可用内存、磁盘和必要的 swap；
- 为 Chrome 与 Worker 设置合理资源边界；
- 记录真实运行期间内存峰值；
- 若 Chrome、PostgreSQL 与 App 竞争资源导致不稳定，再拆出独立 Cloud Executor 节点，不回退到个人电脑 Local Agent。

## 8. 分阶段交付

| 阶段 | 结果 | 真实外部动作 |
|---|---|---|
| CE-01 | 本合同、Goal、设计、计划与 Issues | 无 |
| CE-02 | `cloud_executor` 身份、配置、Worker 入口、串行领取；默认 disabled/fail_closed | fake only |
| CE-03 | 复用既有 Playwright 飞影执行核心 | 无真实飞影 |
| CE-04 | 持久 Profile、受控可视登录与 readiness | 仅登录/standby，无生成 |
| CE-05 | 持久素材/视频、鉴权下载、磁盘门限、重启恢复 | 无真实飞影 |
| CE-06 | 控制台 Worker/登录/阶段/错误/作品投影 | 无真实飞影 |
| CE-07 | 阿里云部署、migration、Worker、Chrome/Xvfb、volume、standby 与重启恢复 | 无真实生成 |
| CE-08 | 一条纯云端真实出片验收 | 已在单条明确积分授权下完成 |

## 9. P0 完成定义

以下 11 项必须全部满足：

1. 个人电脑关闭后云端任务仍可执行。
2. 验收期间不启动 Local Agent。
3. 用户只用浏览器即可提交、查看状态和下载。
4. Worker 重启后 Chrome Profile、素材和视频不丢失。
5. 同时只执行一条工单。
6. 同一 ProductionOrder 不会被重复提交。
7. 登录失效时不领取，控制台提示重新登录。
8. 生成失败后不自动重试。
9. 视频位于云端持久磁盘并可鉴权下载。
10. 新工单完成 Cloud GUI → Cloud Executor → Hifly → Download → Cloud artifact → A12 → Work → 用户下载。
11. 第 10 项成功后才允许标记 P0 可投入内部试运行。

## 10. 当前 Evidence

- 已实现并真实验证：新的零-attempt 工单完成 Cloud GUI → Cloud Executor → Hifly → 云端下载 → artifact → A12 → Work → 用户鉴权下载；验收期间未启动 Local Agent。
- 已部署并核验：阿里云 App/PostgreSQL/Proxy、13 组 migration、HTTPS health、`PRODUCTION_EXECUTOR=fail_closed`，以及 App 对 Cloud Executor 输出卷的只读回退挂载。
- 生产收尾复验已完成：App 部署后及再次重启后鉴权下载均为授权创建 POST 201、鉴权 GET 200，完整发送 `43,425,097` bytes；下载、candidate/AssetVersion 与输出卷 SHA-256 均为 `0becaab1076a8af1124ed4f10f8eac5fc93b21d41af3adb8db5b59213f1ab96b`。
- 当前边界：本合同单条内部闭环完成，但公网证书为自签名且严格 CA 校验失败；`npm audit --omit=dev` 的既存 `5 high / 2 moderate` 依赖项与 `works.html?work=<id>` 首选项缺陷列入 release-readiness/follow-up。
