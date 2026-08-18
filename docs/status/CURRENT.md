# 项目当前状态

> 最后更新：2026-08-18
> 当前 Goal：P0 Cloud Executor 纯云端生产闭环（D-034）
> 当前结论：CE-08 单条闭环与 P0.4 三条严格串行内部试运行均已通过；`main@5c6384d` 已部署到内部验收环境，运营工作台 V2 核心页面完成真实管理员只读验收并带 #190/#191 两个 P1 条件通过。可信 TLS 仍未完成，因此不等同于公网生产就绪、自动批量队列或长期稳定性证明。
>
> 2026-08-13 收敛前的完整时间序列已保留在
> `docs/status/archive/CURRENT-through-2026-08-13-pre-closeout.md`。

## UX V1 Slice A 仓库实现

- Owner 已批准 UX 方案 A“运营任务流优先”；Issue #164 / PR #165 已将精确合同合并进入 `main`，当前状态为 `designed`。
- `docs/frontend/OPERATOR_TASK_FLOW_UX_V1.md` 固化首屏五问、业务状态优先、唯一推荐下一步、技术详情折叠、
  Entry seam、Production 时序门禁、Works 列表+预览、Assets 类型/用途分组和 1440/768/390 验收合同。
- Issue #166 / PR #167 已完成 Slice A 的仓库实现；2026-08-18 该实现随 `main@5c6384d` 部署到内部验收环境，
  Entry、Login、Projects 与 Project 的核心路径通过真实管理员只读验收。该证据仍不是客户采用或公网发布证明。
- 企业能力开启时，直接访问 `/` 进入 Projects；登录、改密、会话恢复与成员无权限回落继续使用现有企业落点。
  显式 `/index.html` 保留本地/运维 legacy fallback，并提示企业流程进入项目；feature-off 或 runtime/auth 请求失败时
  安全保留 legacy 页面，不产生空白页、跳转循环或权限绕过。
- Projects 覆盖加载、空、失败、有项目和创建 Dialog；有项目时优先继续最近项目。Project 覆盖无商品、草稿、
  未保存/保存中/已保存、Ready、superseded、Ready 阻断和 409 版本冲突。商品切换、刷新和冲突后载入最新版本
  均显式保护本地修改；只有商品的当前 revision 可编辑，任何非当前 revision（包括状态仍为 Ready 的父版本）
  都作为只读历史快照呈现并提供回到当前版本的入口。409 恢复按冲突商品重新选择其最新 current revision，
  不会回到旧父版本。历史 revision 深链通过组织隔离的只读 seam 加载：404 或归属核对失败安全回落，
  网络、5xx 或无效响应则显式失败且保留请求上下文。草稿首屏按 active asset + available version 的交集计算
  Ready 阻断；素材竞态失效时刷新可引用集合并要求重新选择。Projects 快照不足时明确提示进入项目核对，
  不伪造零阻断。
- 新样式仅在 `.operator-task-page` 根节点下生效，未迁移企业页面和 legacy GUI 不受共享 CSS 意外影响；浏览器回归覆盖
  1440/768/390、无页面级横向滚动、Dialog 焦点恢复、可见焦点和 reduced-motion。
- Production 合同按时序执行：每轮激活前 Worker off，只为当前 SKU 准备 order + ready handoff，eligible 严格为
  `[currentOrderId]`，当前 order `attempts=[]` 且 active attempts=0；terminal 后立即关 Worker并保留 attempt。
  失败/需处理停止且不创建下一条、不自动重试；成功须经 A12 passed、Work available 与鉴权真实字节下载后，
  才能在 Worker off 下准备下一条。
- UX 页面实施保持严格串行：Slice A（Entry seam + opt-in foundation + Projects/Project）与 Slice B
  （Copy/Avatar/Plan）均已合并，并已随 `main@5c6384d` 部署到内部验收环境。Slice B 后不直接开始 Slice C，而是先完成 Owner 已锁定的
  successor gate；该 gate 完成后只决定 Slice C（Production/Works/Assets）rebase 或吸收到后续分片，
  不再照旧直接实施。
  每个实施分片仍须独立 Issue、Draft PR、浏览器回归和 Review，且不自动部署。
- 旧 `gui/visual-refresh` 工作树及 CSS-only 改动不是本轮基线，不得合并、搬运或覆盖；现有 tokens、基础组件、
  vanilla HTML/CSS/JS、组织授权、状态机和 fail-closed 生产合同继续保留；唯一新增 API 是组织隔离的
  `GET /api/product-revisions/:revisionId` 只读 seam，写路径与领域语义不变。

## UX V1 Slice B 仓库实现

- Issue #168 / PR #169 已完成 Slice B 的实现与 acceptance gate；2026-08-18 已随 `main@5c6384d` 部署。
  Copy、Avatar 与 Plan 的状态驱动任务摘要、唯一推荐下一步和业务状态区分已通过真实管理员只读验收；这不代表
  客户采用，也没有改变或重新验证真实飞影生产链路。
- Copy 首屏区分生成、质检与人工审核：生成成功不等于质检通过，QC passed 不等于 HumanReview approved。
  异步生成中可离页恢复，生成/质检失败提供同阶段重试；脏文案与 409 冲突继续保留本地输入和现有恢复动作。
  只有当前有效的人工批准文案才推荐进入人物选择。
- Avatar 首屏以当前商品的 approved copy、当前人物选择及可用性门禁为真值；“为商品选择人物”是主任务，
  企业人物登记仍是管理员次级入口。未选择、选择已失效、授权或素材阻断均不会伪造可继续状态；每个商品保持
  独立选择，只有当前有效确认才推荐进入 Plan。
- Plan 首屏区分草稿、未保存、预检中、预检失败、预检 warning/passed、人工审核中、需修改、已批准和上游失效。
  preflight passed/warning 不等于 Plan approved；冲突保留本地输入，非当前方案只读，只有当前有效
  HumanReview approved 方案才进入“等待生产工单能力”状态。
- 三页继续复用现有 vanilla HTML/CSS/JS、API、状态机、授权和审计证据；没有新增依赖、后端 seam 或自动终态。
  浏览器回归覆盖 1440/768/390、无页面级横向滚动、可见焦点与 reduced-motion；截图只写入临时目录且不入 Git。
- Slice B 完成后的 successor gate 顺序已由 Owner 锁定：内部问题审计、定向外部研究、Issue #174 的 V2
  独立设计合同和 V2-A shared foundation 均已合并。实现必须继续按 Production → Works → Assets → 必要时
  回补 A/B 严格串行；设计合同或仓库实现不等于部署或客户采用。

## 运营工作台 successor gate

- Issue #170 已完成 Slice B 之后的内部问题审计；`docs/frontend/OPERATOR_UX_INTERNAL_AUDIT.md` 已进入
  `main`，成为后续定向研究与设计合同的权威输入。
- 审计从角色任务、频率、错误成本、权限/审计、安全门禁、现有 API/领域状态和中文环境出发，覆盖企业入口、
  Projects/Project、Copy/Avatar/Plan、Production/Works、Assets/Members 与显式 legacy `/index.html`。
- 当前主要 P1 聚类是：一级导航与项目阶段导航职责不清且缺少全局生产任务入口、Production 技术状态抢占业务主叙事、
  Works 已交付终态仍有多个竞争动作、Assets 缺少类型/用途/关联语义，以及内部英文术语和移动端首屏层级不一致。
  同一管理员/runtime 的跨九页取证确认一级导航显隐一致，不再把不同测试 fixture 的能力/角色差异误判为跨页不稳定。本轮本地假数据
  公开 seam 未发现新的 P0，但这不替代真实 Provider、部署或长期运行证据。
- Issue #172 已完成定向外部研究，`docs/frontend/OPERATOR_UX_TARGETED_EXTERNAL_RESEARCH.md` 已进入
  `main`。研究只回答内部审计的明确问题，并把外部模式分类为 adopt、adapt 或 reject；它不等于最终 IA、
  页面方案、实现、部署或生产采用。
- Issue #174 已将 `docs/frontend/OPERATOR_WORKBENCH_UX_V2_CONTRACT.md` 合并进入 `main`，V2 设计状态为
  `designed`；这只表示设计获批，代码实现、部署和客户采用仍为独立门禁。
- Issue #176 / PR #177 已将 V2-A shared IA/content/control foundation 合并进入 `main`。企业壳层已统一
  一级导航顺序、五阶段标签、V2 中文词典、刷新作用域及 opt-in 审计/技术详情原语；全局“生产任务”在组织级
  真实索引 gate 通过前继续隐藏。未迁移页面与显式 legacy `/index.html` 不受共享样式影响；该入口边界已在
  2026-08-18 内部验收环境复核。
- Issue #178 / PR #179 已将 V2-B Production Task Flow 合并进入 `main`。Production 仓库页面已采用逐单业务摘要、
  完整工单/交接包/执行/A12/Work 状态矩阵、唯一推荐下一步、完整 bootstrap 恢复，以及默认折叠的
  Cloud Executor/attempt/handoff 技术详情。该页面已部署并完成只读 UI 验收，但 #191 证明 Worker 关闭后
  terminal Work 投影仍有 P1，不得把本次验收写成无条件通过或真实生产再验收。
- Production 仅在当前商品零工单且上游 gate 允许时开放“创建生产工单”；任一已有工单（含 claimed/running、
  failed/requires_action、已交付但未完成真实字节验收）都会真实禁用两个创建入口。Work 的 `pending_review`、
  `rework_required`、`deliverable`、`delivered` 均按控制面同名状态进入作品库对应动作，不回落成生产门禁错误，
  也不在真实字节证明前宣称本单完成或开放下一单。
- 当前 API 不提供组织级 `eligible=[currentOrderId]` 和 active attempts=0 的可验证前端投影。V2-B 因此在 `ready`
  交接包阶段保持“生产门禁未通过”，等待获授权运维在既有部署控制面核对；前端不拼装组织队列、不显示 Worker
  启停命令，也不把 `worker.connection=online` 或 `readiness.status=available` 单独解释成可安全领取。
- 固定实施顺序为：V2-A shared IA/content/control foundation → Production → Works → Assets，最后仅在证据
  需要时回补 Slice A/B；每片仍须独立 Issue、Draft PR、公开浏览器回归和 Review。
- Issue #180 / PR #181 已将 V2-C Works Review and Delivery 合并进入 `main`：作品库仓库页面完成列表/预览层级、
  四种业务状态、终态动作收敛、显式追加交付、移动端列表/详情分层，以及服务端授权的文件名、媒体类型、大小、
  校验值与真实字节下载合同。该页面已部署并完成只读 UI 验收；本轮没有创建下载授权或重新验证真实字节下载，
  因此不替代既有下载证据，也不等于客户采用。
- Issue #182 / PR #183 已将 V2-D Assets by Real Type 合并进入 `main`：素材中心按 `product_image`、
  `avatar_image`、`work_video` 三种服务端真值分组，明确 Asset/AssetVersion 层级，并保持作品视频只读、
  图片上传与临时下载授权、乐观冲突和组织权限语义。素材用途、业务关联、缩略图、搜索和分页没有现成 API 真值，
  不由前端推断。该页面已部署并通过三类素材与 `work_video` 只读的核心验收；#190 同时证明 Project 的商品图片
  选择器仍会混入 `work_video`，需独立修复。
- Issue #184 / PR #185 已完成 V2-E 回补审计并进入 `main`。审计证据不支持全站返工，只接受两个严格串行的
  最小回补：V2-E1（Projects/Project/Copy 的业务中文、刷新作用域与 Copy Tab 键盘语义）已通过 Issue #186 / PR #187
  合并；V2-E2 已通过 Issue #188 / PR #189 合并并随 `main@5c6384d` 部署。Avatar/Plan 的业务中文、技术详情层级与
  Plan Tab 键盘语义已完成真实管理员只读验收，但仍不代表客户或 Provider 采用。Avatar 的内部 ID、
  原始代码和能力依据引用只移入折叠审计详情，Plan 只使用现有 API 可证明的商品与业务状态；未新增或猜测业务名称。
  若展示修复需要改变存储/API 真值，必须停在 Product/API gate。
- Production 的企业 Web/API 当前只提供 `GET /api/cloud-executor/status` 只读状态；Worker 启停继续由获授权运维在
  既有部署控制面执行。V2 页面不得向组织用户推荐不存在的“启动工单/Worker”命令；未来若要 Web 启停必须另过
  Product/API、安全授权和审计 gate。

## 2026-08-18 运营工作台 V2 内部部署与 UI 验收

- 内部验收环境已更新到精确 `main@5c6384d523cc8b251a2def04f47e99b3cdbd142a`。13 组 production migration
  全部成功；只 recreate App 并 restart Proxy，PostgreSQL 未重启。App、PostgreSQL、Proxy 均 healthy，公网
  `/healthz` 返回 ok。
- 部署前数据库备份为 `/var/backups/hifly/hifly-20260818T004615Z.dump`。管理员应急密码恢复前另创建
  `/var/backups/hifly/hifly-20260818T010850Z-pre-password-reset.dump`。
- Cloud Executor 保持 `exited / running=false / exit=0`，`eligible=0`、`active_attempts=0`。未访问 Hifly、未生成
  视频、未消耗积分，也未修改商品、订单、作品或交付等生产业务数据。
- 因唯一管理员忘记密码且没有第二管理员，按既有身份合同执行一次应急自重置：追加 `admin_reset` credential、设置
  `requires_password_change=true`、撤销旧会话并写入 `identity.password_reset` 审计。用户随后完成首次改密并登录；
  旧密码未被读取或回显。该动作属于受控身份恢复，不应误写为“完全没有生产数据写入”。
- 真实管理员会话验证：登录后根路径进入 Projects；显式 `/index.html` 保留 legacy 与“进入项目”入口。
  Projects、Project、Copy、Avatar、Plan、Production、Works、Assets、Members 九页均在
  `1440x900 / 768x900 / 390x844` 下无页面级横向溢出，一级导航稳定为“项目 / 作品库 / 素材中心 / 成员管理”。
- Project→Copy→Avatar→Plan 五阶段、Copy 的 QC 与人工审核分离、Plan 的 preflight 与人工批准分离、Works 已交付
  唯一推荐“查看交付记录”、Assets 三种真实分类与 `work_video` 只读均通过。Copy/Plan Tab 的 ARIA 与 roving
  tabindex 实跑通过，九页 console errors 为空。
- 本次结论为“部署成功、核心 V2 可用、带两个 P1 条件通过”：#190 记录商品资料页把 `work_video` 混入商品图片
  选择器；#191 记录 Worker 关闭后 Production 抹去 terminal Work 真值。二者均未在本 docs-only 收口中修复。
- 仍使用 IP + 自签证书；正式域名、DNS、可信证书、严格 CA 与 HTTP→HTTPS 尚未完成。本轮不是公网生产就绪、
  客户采用、Provider 验收、自动批量或长期稳定性证明。
- 完整执行与证据边界见
  `docs/status/sessions/2026-08-18-operator-workbench-v2-internal-deployment.md`。

## P0.5 内部验收环境部署

- 2026-08-13 将内部验收环境从 `main@40e92414d4ef4a4015da9bb3f709f775c67843b6`
  更新到精确 `main@5e449021eee6802b51a220009a8a3620d9bd40f4`；服务器 Git 工作树保持 clean。
- 因阿里云到 GitHub 的直连历史不稳定，本次使用本地验证过、仅包含 `40e9241..5e449021` 的 Git bundle
  快进，没有混入其他分支或工作区改动。
- 部署前 App、PostgreSQL、Proxy 均 healthy，Cloud Executor 为 `exited 0`；执行配置保持
  `PRODUCTION_EXECUTOR=fail_closed`、`LOCAL_AGENT_ENABLED=false`、`CLOUD_EXECUTOR_ENABLED=false`、
  `CLOUD_EXECUTOR_MODE=fail_closed`、`CLOUD_EXECUTOR_CONCURRENCY=1`。standby heartbeat 环境变量仍为 true，
  但 Worker 容器未启动。
- 部署前 SQL 为 `eligible=0`、`active_attempts=0`、`total_attempts=13`。数据库备份为
  `/var/backups/hifly/hifly-20260813T092726Z.dump`（533808 bytes），回滚镜像为
  `hifly-pilot-app:rollback-40e9241-pre-5e449021`。
- 使用 `/opt/hifly-runtime/Dockerfile` 构建新 App；它与仓库 Dockerfile 的唯一长期差异仍是阿里云 Debian
  apt mirror。构建审计为 `0 critical / 0 high / 2 moderate`，没有运行 `npm audit fix --force`；13 组
  production migrations 全部成功，Archiver 8 `ZipArchive` 可实际加载。
- 只重建 App，App healthy 后重启 Proxy；PostgreSQL 未重启，Cloud Executor 未启动。部署后 App、PostgreSQL、
  Proxy 均 healthy，本机和公网 HTTPS `/healthz` 均返回 ok，`login.html` 返回 200。
- 容器内 `web/works.js` 和 `manual-handoff-package-store.js` 与目标提交逐文件校验一致；镜像实际依赖为
  `@fastify/static@10.1.3`、`archiver@8.0.0`、`fastify@5.11.3`、`sharp@0.35.3`。
- 部署后 SQL 仍为 `eligible=0`、`active_attempts=0`、`total_attempts=13`；Cloud Executor 仍为
  `exited / running=false / exit=0`，App 日志只有正常 production startup。
- 使用既有登录会话只读打开
  `/works.html?work=936e9b2e-027a-496b-9b3b-067f5b401cfc`：首次严格选中该 Work，详情为
  `SKU003 · 麦香坚果脆`，列表显示 10 条，未跳转登录且 console errors 为 0。因此 #156 已获得部署后的
  只读运行时证据。
- 本轮没有点击下载、创建下载授权或执行其他写操作；未访问 `hifly.cc`、未生成视频、未消耗积分、未启动
  Worker，也未新增 attempt。
- 完整部署、回滚、校验值和边界见
  `docs/status/sessions/2026-08-13-release-readiness-internal-deployment.md`。

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

- 现有公网证书仍为自签名，严格 CA 校验失败；仓库已补充
  `docs/deployment/TRUSTED_TLS_RELEASE_CHECKLIST.md`，但正式域名、可信证书签发、部署和严格 CA 验收尚未执行。
- #157 的仓库侧依赖治理已完成：官方 npm registry 的生产审计由
  `0 critical / 20 high / 1 moderate` 收敛到 `0 critical / 0 high / 2 moderate`。剩余两项均来自
  `exceljs@4.4.0 → uuid@8.3.2` 的同一 moderate advisory；当前代码只使用 ExcelJS 读取工作簿，未调用受影响的
  UUID v3/v5/v6 buffer API。当前 latest `exceljs@4.4.0` 没有可向前升级的修复版本；npm audit 仅建议
  semver-major 回退到 `exceljs@3.4.0`，本轮未把依赖降级当作安全升级。详细证据和复查门禁见
  `docs/status/sessions/2026-08-13-issue-157-release-readiness.md`。
- #156 的最小修复已完成并通过本地浏览器回归：`works.html?work=<id>` 首次加载会选中
  组织内可见目标；缺失或不可见 ID 回落到第一条可见作品且不渲染隐藏作品信息。该修复现已部署到内部
  验收环境，并完成指定非首项 Work 的只读运行时验证。
- #157 的依赖治理已随 `main@5e449021` 部署并通过健康检查，但 Issue 仍保持 OPEN：入口仍为 IP + 自签证书，
  严格 CA、正式域名/DNS 和可信证书尚未完成；当前 HTTP `/healthz` 仍返回 200 而不是跳转到 HTTPS。

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

- 每条内部试运行在 Worker off 时只准备当前 SKU 的唯一工单和 ready handoff；激活前复核全组织 eligible
  严格等于当前 order、当前 order `attempts=[]`、active attempts=0、审批链、Profile/login readiness 和磁盘门限。
- terminal 后立即停止 Worker并保留 attempt 历史；失败/需处理不创建下一条且禁止自动重试、重新领取或再次生产；
  成功须完成 A12 passed、Work available 与鉴权真实字节下载，才可在 Worker off 下准备下一条。
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

1. 严格串行处理两个部署后 P1：先修 #190，确保 Project 只接受真实 `product_image`；合并后再修 #191，恢复
   Production 对 terminal Work 的稳定投影。#191 修复不得弱化激活前 fail-closed、唯一 eligible、零初始 attempt、
   terminal 关 Worker、失败停批与不自动重试门禁。
2. 继续 P0.5 release-readiness：V2 与依赖治理已部署到内部验收环境；下一步由部署负责人取得正式域名并按可信 TLS 清单完成 DNS、可信证书、严格 CA 和 HTTP→HTTPS 验收。
3. 保持 Cloud Executor 默认 disabled/fail-closed、并发 1，并按“激活前唯一当前 eligible + 当前 order 零 attempt；
   terminal 立即关 Worker；失败停批且不自动重试；成功验收后才准备下一条”的逐单时序护栏执行。
4. 是否扩大试运行规模、开放自动队列或宣称长期稳定，必须基于新的运行证据和 Owner 单独决策；本次三条结果不能直接外推。

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
- `main@5e449021` 已完成数据库备份、migration、App/Proxy 受控更新与健康检查；#156 指定 Work 的部署后
  只读浏览器验证通过，部署前后无 eligible order、active attempt 或新增 attempt。
- 本文档只记录生产收尾事实；历史实现过程、失败尝试和旧门禁详见归档 CURRENT 与各 session 文档。
