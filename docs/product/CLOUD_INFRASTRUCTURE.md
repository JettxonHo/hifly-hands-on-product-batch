# MVP 云基础设施与两阶段部署规格

> 状态：Accepted at product specification level
> Owner：owner（JettxonHo）
> 最后更新：2026-08-05
> 关联 Decision：[D-026](DECISION_LOG.md)
> 解决问题：Q-021
> 非目标：不创建云资源、不固定企业最终规格、不实现代码、不完成备案

本文件是 D-026 的详细 Specification。它只固化架构方向、环境边界和后续部署验收要求，**不代表任何云资源已经部署**，也不固定企业最终实例规格、预算、域名或已有资源。

---

## 1. 目标与范围

- 为 MVP 定义 Cloud Control Plane 与 Local Agent 分离的基础设施边界；
- 区分「个人开发与功能验收环境」与「企业正式生产环境」；
- 明确计算、数据库、对象存储、任务、Secret、观测、备份与恢复的概念边界；
- 保留 Q-018（飞影 API Token 保管与调用位置）为开放问题；
- 不实施功能、不创建云资源、不制作低保真原型。

## 2. 核心原则

- 产品采用 Cloud Control Plane 与 Local Agent 分离架构；
- 腾讯云负责云端控制面；Local Agent 负责需要本地文件、浏览器登录态、长时间自动化和人工接管的执行；
- 腾讯云优先，但**领域层不绑定腾讯云**；
- Database、ObjectStorage、TaskQueue、SecretStore、LogSink 等必须通过基础设施抽象接入；
- MVP 使用**模块化单体**，而不是微服务系统；
- API 与异步 Worker 是两个独立部署单元；
- 不在 MVP 建设 Kubernetes、服务网格或复杂分布式基础设施；
- 长时间 Playwright、视频编码和本地大模型不得运行在普通 Web/API 请求生命周期中。

## 3. 两阶段部署策略

必须明确区分：

- **个人开发与功能验收环境** ≠ **企业正式生产环境**。

个人开发与功能验收阶段：

- 使用 owner 已有的 2 核 4 GB（2C4G）测试服务器；
- 使用单机 Docker Compose；
- 只验证产品功能闭环、架构边界和任务可靠性；
- 不承担生产 SLA、高可用、企业并发容量或完整灾备验收；
- 测试环境通过不代表生产规格已经达标。

企业正式上线阶段：

- 不直接沿用 2C4G 规格；
- 根据企业已有云资源、用户数量、商品数量、任务吞吐、媒体容量、安全要求、审计要求和可用性目标重新评估；
- 企业正式月度预算保持 **Pending Evidence**；
- 必须先盘点企业已有资源与真实容量需求，再确定采购规格和预算；
- 正式环境按照 D-026 的企业生产架构落地。

## 4. 个人 2C4G 验证环境

```text
2C4G Test Server
├── Reverse Proxy
├── Web / API
├── Async Worker
├── PostgreSQL
└── Persistent Volume
```

限制：

- API 实例数：1；
- Worker 实例数：1；
- Worker 并发：1；
- PostgreSQL 使用小连接池；
- 不部署 RabbitMQ；
- Redis 非必要不部署；
- 不部署 Kubernetes；
- 不运行本地大模型；
- 不执行视频编码；
- 不在该服务器运行长时间 Playwright；
- 长时间 Provider 网页自动化继续在 Local Agent 执行；
- 图片、音频和视频不得长期堆积在服务器本地磁盘。

对象存储阶段：

- 开发早期允许通过 ObjectStorage 抽象使用 LocalStorageAdapter；
- 企业部署前必须使用真实 COS 测试私有桶完成集成验收；
- 必须验证短时上传授权、对象核验、私有下载、组织权限隔离、重复完成和失败处理；
- 本地文件实现通过不等于 COS 集成通过。

最低保护：

- PostgreSQL 数据卷持久化；
- 容器自动重启；
- 管理端口不直接暴露公网；
- 数据库不开放公网；
- Secret 不进入 Git 或镜像；
- 每日 pg_dump；
- 备份复制到服务器之外；
- 基础磁盘、内存和服务存活监控；
- 可配置少量 Swap 作为突发保护，但不得将 Swap 视为正常内存容量。

个人环境应验收：登录；项目；商品与商品事实；文案生成；AsyncJob；文案质检；人工批准；VideoPlan；ProductionOrder；Local Agent 协议或人工交接包；状态回传；作品登记；API 重启数据不丢；Worker 重启任务可恢复；重复领取不产生重复业务结果；Provider 失败进入有限重试或人工处理；文案/质检/批准版本门禁有效；数据库备份可以恢复。

个人环境不验收：高并发容量；多实例高可用；数据库自动故障切换；企业级完整安全审计；正式 RPO/RTO；大批量视频生产吞吐；正式生产成本。

## 5. 企业正式生产拓扑

```text
Tencent Cloud Guangzhou (ap-guangzhou)
├── CloudBase Run API
├── CloudBase Run Worker
├── TencentDB for PostgreSQL
├── COS
│   ├── sensitive private bucket
│   └── content private bucket
├── SSM / KMS / CAM / STS
├── CLS / APM / CloudAudit
├── VPC / subnet
└── Backup / PITR

Local Agent
├── Provider login state
├── Local files
├── Playwright or another verified Adapter
├── Human takeover
└── Task and artifact reporting
```

## 6. 计算服务

```text
CloudBase Run
├── hifly-web-api
└── hifly-async-worker
```

- API 与 Worker 是两个独立容器服务；
- 代码保持模块化单体；
- 不拆分 auth-service、product-service、copy-service 等大量微服务；
- API 处理同步请求、身份权限、业务事务、任务创建和状态查询；
- Worker 处理文案生成、LLM 语义质检、批量任务和状态推进；
- 不让用户 HTTP 请求长时间等待所有异步任务完成；
- API 创建 AsyncJob 后返回 job_id；前端通过轮询或后续状态机制查看进度；
- Lighthouse 与 CVM 是开发、诊断或平台限制出现后的回退方案；
- TKE 不进入 MVP；
- 核心业务不得依赖 CloudBase 专有身份、数据库或领域 SDK；
- CloudBase Run 的具体限制必须在正式部署前进行技术验证。

## 7. PostgreSQL 数据层

正式生产数据库：**TencentDB for PostgreSQL**。

- PostgreSQL 是唯一权威关系型业务数据库；
- production 使用托管高可用主实例；
- API、Worker 和 PostgreSQL 位于同地域、同 VPC；
- 数据库默认不开放公网；
- local、staging、production 数据库隔离；
- staging 与 production 不共用实例、账号或密码；
- 核心业务字段使用关系型列、外键、唯一约束和状态约束；
- 仅将弹性 finding、规则快照、证据引用和 Provider 摘要等保存为 JSONB；
- 关键业务状态不得只隐藏在 JSONB 中；
- Schema 变更必须通过版本化 Migration；
- 禁止应用启动时自动执行不可逆生产 Migration；
- 应用不得使用数据库超级管理员账号；
- API 与 Worker 使用最小权限账号；
- 使用受限连接池；
- MVP 不建设分库分表、读写分离、只读实例、跨地域双活或数据仓库。

## 8. COS 对象存储

正式生产对象存储：**Tencent Cloud COS**。

```text
sensitive production bucket
├── 数字人原始照片
├── 数字人原始视频
├── 声音克隆源文件
├── 授权证明
└── 其他可识别个人身份的敏感源素材

content production bucket
├── 商品图片
├── 普通业务附件
├── 视频中间产物
├── 正式输出
├── 缩略图
└── 失败证据
```

要求：

- 所有桶默认私有读写；
- staging 与 production 使用独立存储桶和凭据；
- 数据库保存 bucket、object_key、version_id、content_type、size、checksum、asset_status 和归属元数据；
- 不保存永久公开 URL；
- 浏览器通过业务 API 获取短时、最小权限上传或下载授权；
- 永久 SecretId / SecretKey 不得进入浏览器；
- 上传授权必须限制 bucket、object key、操作、有效期、大小、Content-Type、组织和上传会话；
- API 必须在前端报告完成后重新验证对象存在、大小、类型、校验值、加密和归属；
- 核验前状态为 uploading / pending_verification；核验通过后才变为 available；
- 对象键使用内部 ID，不使用包含姓名、手机号或原始敏感文件名的路径；
- 业务版本通过新 asset_id 和新 object_key 管理；
- COS 版本控制仅作为误删和覆盖保护；
- 生命周期按临时上传、中间产物、失败证据、正式作品和敏感源素材分别配置；
- 敏感资产的最终保留期限不在 D-026 擅自固定，由后续隐私和授权决策确定。

加密策略：

- sensitive production bucket：优先 SSE-KMS；
- content production bucket：默认 SSE-COS；
- SSE-KMS 的地域支持、费用和接入能力必须在部署前验证；
- 若必须回退为 SSE-COS，必须明确记录，不能静默取消加密。

## 9. AsyncJob / Outbox

MVP 不单独采购消息队列。采用 **PostgreSQL AsyncJob / Transactional Outbox + CloudBase Run Worker**。

- API 在同一数据库事务中提交业务变化和 AsyncJob；
- Worker 使用 PostgreSQL `FOR UPDATE SKIP LOCKED` 领取任务；
- 领取后写入 claimed_by、lease_expires_at 和 heartbeat；
- 耗时 Provider 调用不得持有长数据库事务或行锁；
- 采用有限租约、心跳和租约过期恢复；
- 任务交付语义为 **at-least-once**，不宣称 exactly-once；
- 每种任务必须使用稳定 idempotency key；
- 重复执行不得创建重复正式结果、重复批准、重复扣减内部用量或重复创建 VideoPlan；
- 只对明确瞬时技术故障有限重试；blocked、事实不足、权限失败、业务 Schema 错误等不得自动重试；
- D-023 的 LLM 输出形态失败仍最多进行一次同配置受控重试，通用重试不得绕过；
- Worker 初始为常驻单副本；CloudBase Run 初始配置方向为 min replicas = 1、max replicas = 1；
- 实例重启后的恢复依赖持久化任务状态、租约和幂等，而不是假设进程永不重启。

任务概念状态：`queued` / `running` / `retry_wait` / `succeeded` / `failed` / `cancelled` / `dead_letter`。

必须区分：**AsyncJob = succeeded** 与 **CopyQualityCheck = blocked** 是合法状态，表示任务成功执行并发现业务阻断（详见 D-025）。

升级 TDMQ RabbitMQ 的条件：消费者数量显著增加；PostgreSQL 轮询形成可测量压力；需要复杂路由、扇出、背压或队列级死信治理；多服务部署后数据库任务表成为瓶颈。即使以后引入 RabbitMQ：PostgreSQL 仍是业务状态权威来源，RabbitMQ 只负责消息传输和调度。

## 10. Secret、KMS 与权限

正式生产采用 **SSM + KMS + CAM + STS**。

- SSM：保存数据库密码、DeepSeek API Key、签名密钥和其他服务端凭据；
- KMS：保护凭据和敏感对象所使用的密钥；
- CAM：服务和人员最小权限；
- STS：浏览器 COS 直传和下载的短期凭证。

要求：

- API、Worker、部署身份和人工运维身份分离；
- 不共享全权限永久访问密钥；
- API 只读取自身需要的数据库、登录和上传授权相关 Secret；
- Worker 只读取 Worker 数据库账号、DeepSeek API Key 和任务所需 Secret；
- staging 与 production 的 Secret、角色和凭据完全隔离；
- Secret 不进入 Git、Markdown、Docker 镜像、前端、业务数据库、日志或错误响应；
- 日志只记录 secret_name、secret_version 和 access_result，不记录值；
- 浏览器不得获得 SSM、KMS、数据库或 DeepSeek 权限；
- CloudBase Run 是否可通过服务角色或等效临时身份访问 SSM、COS 和 KMS，必须在正式部署前验证；
- 若暂不支持，只允许使用专用、最小权限、可轮换的引导凭据；
- 凭据必须支持版本化、轮换、紧急吊销和访问审计；
- 不在 D-026 统一固定所有 Secret 的轮换周期。

**Q-018 仍然开放。采用 SSM 不等于授权上传 Hifly Token。** 在 Q-018 决定前：Hifly Token 不进入既定云端 Secret 清单、不默认进入 CloudBase Run、不从 Local Agent 迁移至云端。

## 11. 日志、监控与审计

正式生产采用：CLS；腾讯云可观测平台；APM / OpenTelemetry；CloudAudit；PostgreSQL AuditEvent。

职责分离：

- 应用运行日志 → CLS；
- 云资源指标和事件 → 腾讯云可观测平台；
- 技术调用链 → APM / OpenTelemetry；
- 产品业务审计 → PostgreSQL AuditEvent；
- 腾讯云账号及资源操作 → CloudAudit。

要求：

- 应用日志使用结构化 JSON；使用 request_id、trace_id、job_id 和业务对象 ID 关联；
- 不记录密码、Token、Cookie、Authorization Header、数据库密码、完整预签名 URL、完整 Prompt、完整 Response、完整文案正文、原始人物照片、声音或授权材料；
- 可以记录 Provider request ID、Token 数量、模板版本、Schema 版本、结果状态、错误类别、内容哈希和脱敏摘要；
- API 提供 liveness 与 readiness；Worker 健康状态包含持久化心跳；
- 必须监控 API 错误率和延迟、Worker 心跳、queued 数量、最旧任务等待时间、dead_letter、任务成功率、Provider 429/5xx/timeout、PostgreSQL 连接和备份状态、COS 上传核验失败；
- 告警分 P0、P1、P2；告警应有持续条件和恢复通知，避免单个瞬时错误形成告警风暴；
- staging 与 production 的日志主题、APM 应用和告警策略隔离。

初始保留建议：staging 应用日志 14 天；production 普通应用日志 30 天可检索；production 安全与重要操作日志 180 天；PostgreSQL AuditEvent 按业务审计和数据生命周期保存，不随 CLS 到期删除。这些保留期可以在企业正式预算核算时调整，但不能通过删除业务审计记录来降低日志费用。

## 12. 备份、恢复与灾难恢复

生产恢复目标：

- 数据库 RPO ≤ 30 分钟；
- 数据库 RTO ≤ 4 小时；
- 应用发布故障目标为 30 分钟内回滚上一稳定版本；
- 以上是**产品目标**，不是已取得的云服务 SLA；上线前必须通过真实恢复演练验证。

PostgreSQL：每日自动全量备份；开启日志备份和 PITR；常规备份保留 30 天；月度长期备份保留 12 个月；高风险 Migration 前增加手动备份；恢复时优先克隆或恢复到新实例、验证后再切换，不直接覆盖当前生产实例；数据库 Migration 采用向后兼容策略；应用版本回滚不等于数据库 Schema 自动回滚。

COS：production 敏感桶开启版本控制；production 内容桶开启版本控制并配置历史版本生命周期；MVP 暂不默认启用跨地域复制；数据量、SLA 或企业风险要求提高后再评估。

恢复演练：首次 production 上线前至少完成一次；此后每季度至少一次；包含 PostgreSQL 备份恢复、PITR、COS 对象版本恢复、CloudBase Run 版本回滚和关键业务查询验证；不得把生产敏感数据随意复制到普通 staging，应优先使用合成或脱敏数据；备份失败、日志备份中断、版本控制暂停和演练逾期进入告警。

## 13. 广州地域、网络与域名

首批用户：中国大陆华南为主。正式主地域：**腾讯云广州 `ap-guangzhou`**。

- production API、Worker、PostgreSQL、COS 和其他核心资源尽量同地域；
- API、Worker 和 PostgreSQL 使用 VPC 内网连接；
- PostgreSQL 不开放公网；
- staging 与 production 使用独立环境、VPC、数据库、存储、Secret、日志和域名；
- MVP 不建设跨地域双活；
- Worker 调用外部 Provider 时，可按部署验证结果使用 NAT 网关及固定出口 IP；不在本 Decision 承诺固定出口已经部署；
- production Web 与 API 使用独立正式域名；staging 使用独立测试域名；所有用户入口使用 HTTPS；
- Worker、SSM、数据库和内部管理接口不作为普通用户公网入口。

域名示例仅作为命名方向，不绑定真实域名：`app.<primary-domain>`、`api.<primary-domain>`、`staging.<primary-domain>`、`api-staging.<primary-domain>`。

中国大陆正式上线前：按上线时适用的法规和腾讯云要求完成 ICP 备案；上线后按适用要求办理公安联网备案；**D-026 不声称备案已经完成**；不在仓库写入真实主体证件、账号信息或敏感备案资料。

## 14. 成本与容量评估

正式月度预算：**Pending Evidence**。

原因：个人阶段只使用已有 2C4G 测试服务器；当前不知道企业已经开通哪些腾讯云资源；企业生产规格需要根据真实负载和既有资源确定。

企业生产采购前必须盘点：已有 CloudBase / CloudBase Run；CVM / Lighthouse；PostgreSQL / MySQL；COS；VPC / NAT / EIP；SSM / KMS；CLS / APM；域名、证书与备案资源；包年包月资源；资源包、代金券和优惠额度；到期时间、自动续费和是否可复用。

不得将已有资源自动视为可复用，必须判断：是否位于广州；是否属于其他项目；是否能隔离 staging / production；是否能使用独立数据库和凭据；是否存在未知历史配置；是否满足企业安全和备案要求。

## 15. Local Agent 与 Provider 边界

- 个人 2C4G 服务器只运行 Web/API、Worker、PostgreSQL 和反向代理；
- 长 Playwright 仍在 Local Agent，不在 Cloud Web 请求进程运行；
- 企业正式 CloudBase Run API / Worker；
- PostgreSQL AsyncJob / Outbox 是 MVP 任务机制；
- Q-018 Token 边界保持开放（见第 10 节）；
- CloudBase Run 服务角色访问 SSM/COS/KMS 需部署前验证；
- 正式生产广州地域；
- 基础设施通过抽象接入，领域层不绑定腾讯云；
- 不把 CloudBase Run 产品名泄露到领域模型。
- 不新增或修改 Provider capability 声明；不访问真实 Provider。
- 影刀（Yingdao）仍是可选 Adapter，需要独立 Evidence，不替代现有 Playwright 主链路；不在 D-026 中做最终工具迁移决策。

## 16. 环境隔离

- local / staging / production 三套环境隔离；
- staging 与 production 不共用数据库实例、COS 桶、Secret、账号、密码、日志主题、APM 应用、告警策略或域名；
- 各环境使用独立凭据；不共享全权限永久访问密钥。

## 17. 上线前技术验证清单

至少包括：

- CloudBase Run 与 PostgreSQL 的内网连接；
- CloudBase Run 服务身份访问 SSM、COS、KMS；
- Worker 常驻实例和缩容行为；
- PostgreSQL 连接池上限；
- AsyncJob 租约和崩溃恢复；
- COS STS 直传；
- COS 私有下载；
- SSE-KMS 地域支持和成本；
- 数据库 PITR；
- COS 对象版本恢复；
- CloudBase Run 版本回滚；
- OpenTelemetry / APM 接入；
- CLS 敏感字段脱敏；
- ICP 与公安备案要求；
- 真实 COS 测试桶验收；
- 企业已有云资源盘点；
- 企业容量和预算评估。

## 18. 非目标与待决事项

D-026 不代表以下内容已经实现：CloudBase Run 已创建；PostgreSQL 已购买；COS 已创建；SSM/KMS/CAM 已配置；日志和 APM 已接入；备份和恢复演练已完成；ICP 或公安备案已完成；2C4G 已经跑通完整产品；企业生产容量已经验证；企业预算已经确认；Hifly Token 已上传云端；Hifly API 或真实网页能力已验证；低保真页面已经完成。

待决事项必须保留：

- Q-018 Hifly Token 位置；
- 企业正式预算；
- 企业最终实例规格；
- 企业具体域名；
- 企业实际已有资源；
- 是否需要固定出口 IP；
- 是否需要跨地域复制；
- 何时升级 RabbitMQ；
- 影刀 Adapter 是否进入某个独立能力切片。

影刀相关内容只能表达为：可选 Adapter；需要独立 Evidence；不替代现有 Playwright 主链路；不在 D-026 中做最终工具迁移决策。

## 19. 验收标准

- D-026 在产品规格层固化云基础设施方向、环境边界与部署验收要求；
- 个人 2C4G 环境用于功能闭环与可靠性验收，不验收生产容量/SLA/高可用；
- 企业正式环境在广州按 D-026 架构落地，且上线前必须完成第 17 节验证清单与第 12 节恢复演练；
- 企业正式预算与最终规格保持 Pending Evidence，直到完成企业资源盘点与容量评估；
- Q-018 保持开放；Hifly Token 不默认进入云端；
- 本规格不代表任何云资源已经部署。
