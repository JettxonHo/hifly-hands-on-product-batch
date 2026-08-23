# 项目 Roadmap

> 最后更新：2026-08-24
> 当前状态：Vertical Slice A、CE-08 与 P0.4 已完成；#200/#201/#202 已合并，并随 `main@8787b60c` 部署到内部验收环境。新单条 `small` Provider 复验的商品呈现大小 PASS，但外观保真 FAIL，Work 已登记返工且没有交付或重试。Fidelity-C5 合同、synthetic harness 与 C5a 许可证、依赖、安全和 patched-lane successor Evidence 已进入 `main@677d79c2cc8256b7cb6661972b934b289c3b456d`，但没有建立 accepted environment lane；六项 blocker 和 `BLOCKED_CHECK_CAPABILITY_UNSELECTED` 保持。下一代运营工作台 Stage 0 合同、Stage 1 商品资料、Stage 2 文案与 Stage 3 人物已进入 `main@4293be0e80deafc0d844f596239626be4bcdead4`；Issue #244 是 Stage 4 视频方案仓库实现的独立 acceptance gate，只有对应 Draft PR 经独立 Review 合并后才计为实现，也不授权 Stage 5。系统保持 disabled/fail-closed；可信 TLS 仍待独立门禁

## 1. 已完成基线

- A01～A14 已完成企业登录、项目与商品、文案版本/QC/人工审核、人物选择、VideoPlan、ProductionOrder、交接包、执行报告、作品核验与交付。
- 阿里云 2C4G 内部试运行环境已部署。
- 历史单条真实工单曾通过 Mac Local Agent 完成闭环；该路径现仅为 legacy fallback，不再作为生产路径或当前验收依据。
- 官方 Hifly API Token 已完成只读积分连接验证；「手里有货」仍走 Playwright。
- Cloud Executor CE-01～CE-08 已实现并部署；disabled/fail-closed standby 的 heartbeat、持久目录、重启恢复、无 claim/无新增 attempt 已在阿里云实证。
- CE-08 新零-attempt 工单已完成 Cloud GUI → Hifly → 云端 artifact → A12 → Work → 鉴权下载；当前结论允许受控内部试运行，不等同于公网生产就绪。
- P0.4 已完成三个不同商品的严格串行 Cloud Executor 内部试运行：每轮仅暴露一个 eligible、零-attempt 工单，三条均一次成功并通过 A12、Work 和鉴权字节下载；Mac Local Agent 全程关闭。
- `main@5e449021` 已部署到阿里云内部验收环境；#156 深链修复完成部署后只读 UI 验证，#157 依赖治理的
  实际镜像审计为 `0 critical / 0 high / 2 moderate`。部署没有启动 Worker 或新增 attempt。
- `main@5c6384d` 已部署到同一内部验收环境；V2 九个企业页面完成 1440/768/390 真实管理员只读验收，结论为
  核心可用、带 #190 商品图片类型混入与 #191 Production 终态投影两个 P1 条件通过。部署及验收没有启动 Worker、
  访问 Hifly、生成视频或消耗积分。
- `main@db36cc53` 已部署到同一内部验收环境；Issue #193 两组 migration 成功，既有 ProductRevision 保持尺寸未知，
  既有 VideoPlan 安全回填 `smart_fit`。Project/Plan/Production 的真实管理员只读验收确认新字段可见、迁移默认正确，
  且历史工单 snapshot 不被当前值反向改写；未启动 Worker、未访问 Hifly、未生成视频或消耗积分。
- `main@80bdfd45` 已部署到同一内部验收环境；#190 确认 Project 只列出服务端 active+available 的 5 个
  `product_image`，#191 确认 Worker offline、`current_order=null` 时 persisted succeeded 工单仍显示 exact Work
  “作品待检查”与唯一作品库动作。部署和只读验收没有启动 Worker、访问 Hifly、写生产业务对象或消耗积分。
- `main@8787b60c` 已部署到同一内部验收环境；#200 付费前完整六档唯一选中真值、#201 terminal heartbeat drain 与
  #202 failed 工单持久终态均进入运行时。一条获授权的新 `small` 工单完成唯一 attempt、A12 passed、Work available
  和鉴权真实字节下载；尺寸选档通过，但包装瓶盖几何失真，Work 为 `rework_required`，没有交付或第二工单。

## 2. 当前升级顺序

```text
P0.1  云端飞影登录并证明 Profile 重启保留（已完成）
P0.2  激活单实例 Cloud Executor（playwright / concurrency=1）（已完成）
P0.3  CE-08 一条纯云端真实闭环：Cloud GUI → Hifly → A12 → Work → 鉴权下载（已完成）
P0.4  3 条严格串行、受控内部试运行（已完成）
P0.5  release-readiness：代码/依赖部署完成；正式域名、DNS、可信证书、严格 CA 与 HTTP→HTTPS 待执行（当前阶段）
UX V1 运营任务流优先：designed → Slice A/B（已合并、已部署到内部验收环境）
    → 内部问题审计（已完成）→ 定向外部工作台研究（已完成）
    → V2 独立设计合同（#174，已完成）
    → shared IA/content/control foundation（#176/#177 已完成）→ Production（#178/#179 已完成）→ Works（#180/#181 已完成）→ Assets（#182/#183 已完成）→ V2-E 回补审计（#184/#185 已完成）→ V2-E1（#186/#187 已完成）→ V2-E2（#188/#189 已完成并部署）
P1 UI  部署后条件通过收口：#190 → #191 → 统一内部部署/真实管理员只读复验（已完成）
P1 Product  #193 实物尺寸 + 飞影原生呈现大小（新单条复验：尺寸 PASS、技术闭环 PASS、外观保真 FAIL、Work 返工）
P1 Runtime  #200 Provider 选档真值 → #201 heartbeat/report 竞态 → #202 failed 工单首屏终态（均已实现、Review、合并、部署并完成单条复验）
P1 Fidelity #208 DSE accepted → #210 Fidelity-0 Evidence accepted → #212 Fidelity-A designed → #214 Fidelity-B repository implemented（默认 disabled、same-gate-only observation）→ #216 Fidelity-C0 gate → #218/#219 shortlist accepted → #220 readiness blocker audit accepted → #222/#223 受控数据/独立七维真值准入合同 → #224/#225 Fidelity-C4 数据/人工真值 accepted → #226/#227 Fidelity-C5 环境/harness 合同 accepted → #228/#229 synthetic harness implemented → #230/#231 C5a 首轮 Evidence accepted（lane blocked）→ #232/#233 archive/license/security blocker Evidence accepted → #234/#235 patched lane/fixed model successor Evidence accepted（lane blocked）→ Owner/upstream inputs → C5b 未授权 → 受控 benchmark 未授权 → Fidelity-C～E 未开始
P1 UX Next  单任务工作区方向 accepted → #236/#237 正式合同/Product API gate（已完成）→ #238/#239 Stage 1 商品资料（已完成）→ #240/#241 Stage 2 文案（已完成）→ #242/#243 Stage 3 人物（已完成）→ #244 Stage 4 视频方案（独立 Draft gate）→ Stage 5 生产 → Post-stage 作品库 → 素材中心/移动收口（后续 Goals 均待独立 gate）
P1+   上述内部试运行、release-readiness 与获批 UX 切片完成后，再决定产品增强与规模化
```

Cloud Executor 的权威范围、门禁和完成标准见 `docs/product/CLOUD_EXECUTOR_P0.md`；三条严格串行内部试运行由 #132 跟踪，Issue 已关闭并已补充最终验收证据；release-readiness 由 #156、#157 跟踪。

## 3. 下一阶段

`main@8787b60c` 已部署到内部验收环境。#190 的真实管理员只读复验确认 Project 商品图片候选只包含服务端
`kind=product_image`、Asset `active`、AssetVersion `available` 的交集；5 个商品图片可见，无 `work_video`/mp4，
且没有保存 revision。#191 的复验确认 persisted succeeded 工单在 Worker offline、`current_order=null` 时仍显示
exact Work 的“作品待检查”和唯一作品库动作，创建工单保持 disabled；没有点击 Works、下载、保存、创建或其他写操作。
这只证明两个 P1 已统一部署且内部只读验收通过。可信 CA 证书仍缺正式域名、DNS、签发和部署实证，当前 HTTP `/healthz` 也尚未跳转 HTTPS；
必须按 `docs/deployment/TRUSTED_TLS_RELEASE_CHECKLIST.md` 完成严格 CA 与 HTTP→HTTPS 验收后，才能评估公网发布。
#200/#201/#202 合并部署后执行的一条获授权新 `small` 工单，已在付费前证明完整六档的图片框与文字标记一致、连续两次
唯一选中“小”，并以唯一 attempt 完成 candidate、terminal report、A12 passed、Work available 与鉴权真实字节下载。
技术链路和商品呈现大小验收为 PASS；但成片全程把原图的斜切蓝盖生成为蓝色钻石/宝石形，外观保真与整体内容验收为
FAIL。Work 已登记 `rework_required`，没有交付、自动重试、重新领取或第二工单；系统已恢复 disabled/fail-closed。

P0.4 的三条结果证明人工控制下的严格串行路径可重复完成，但不构成自动队列批量运行、更大规模、长时间稳定性、并行能力或公网生产 SLA 的证据。

Owner 已批准“运营任务流优先”作为页面升级方向；`docs/frontend/OPERATOR_TASK_FLOW_UX_V1.md` 已通过
Issue #164 / PR #165 合并进入 `main`，状态为 `designed`。Slice A/B 与 V2-A～V2-E2 已进入 `main` 并部署到内部
验收环境，但不代表客户采用、公网发布或 Provider 验收。后续 P1 仍必须严格串行：

1. Slice A：Entry seam + shared opt-in UX foundation + Projects/Project；企业能力开启时 `/` 进入 Projects，显式
   `/index.html` 保留 legacy fallback；Login、Projects 与 Project 使用首屏任务摘要和唯一推荐下一步；共享 CSS 仅
   通过根 class opt-in，不得意外改变未迁移页面。未保存修改在商品切换、刷新和版本冲突处理中受显式保护；
   只有商品 current revision 可编辑，任何非当前 revision（含 Ready 父版本）都按历史快照只读呈现；历史深链
   仅经组织隔离的只读 revision seam 加载，404/归属不匹配安全回落，而网络、5xx 与无效响应显式失败。
   Ready 素材门禁只接受 active asset 的 available version，素材竞态失效时刷新集合并要求重新选择。
   Issue #166 / PR #167 已合并并随 `main@5c6384d` 完成内部部署与核心只读 UI 验收。
2. Slice B：Copy/Avatar/Plan；清楚区分生成、自动检查与人工批准。Issue #168 / PR #169 已合并，Copy 以
   approved copy 为人物阶段门禁，Avatar 以当前商品的有效确认选择为 Plan 门禁，Plan 明确 preflight
   passed/warning 不等于人工批准。该实现已部署并完成对应只读 UI 验收，但仍不代表真实生产再验收或客户采用。
3. 原 Slice C 不再照旧实施。Issue #174 的 V2 合同已通过 acceptance；其范围已按严格串行切片吸收：Issue #176 / PR #177
   完成 shared IA/content/control foundation，Issue #178 / PR #179 完成 Production，Issue #180 / PR #181
   完成 Works，Issue #182 / PR #183 完成 Assets，Issue #184 / PR #185 完成 V2-E 回补审计，Issue #186 / PR #187
   完成 V2-E1 Projects/Project/Copy 最小回补；Issue #188 / PR #189 已完成 V2-E2 Avatar/Plan 最小回补。
   所有 V2 切片已随 `main@5c6384d` 部署；部署后两个 P1 已由 #190/#191 严格串行修复，并随
   `main@80bdfd45` 统一部署和完成真实管理员只读复验。
   Production 必须按时序保持激活前 Worker off、唯一当前 eligible、当前 order 零 attempt 与 active attempts=0；
   terminal 后立即关 Worker并保留 attempt；失败停批且无自动重试；成功经 A12、Work 和真实字节下载后才准备下一条。
   页面仅在当前商品零工单且上游 gate 允许时开放创建；claimed/running/failed/requires_action 及未完成真实字节验收的
   Work 都不得开放下一单。`pending_review` / `rework_required` / `deliverable` / `delivered` 必须按控制面真值进入
   Works 对应检查、返工、交付或交付记录动作。
   企业 Web/API 只读取 Cloud Executor 状态，且当前没有组织级 eligible/active-attempt 前端投影，也不提供 Worker 启停命令；
   无法证明门禁时 Production 必须保持阻断，启停继续由获授权运维在既有部署控制面完成，
   未来 Web 启停能力须另过 Product/API、安全授权和审计 gate。Works 保留深链授权并收敛已交付终态；V2-C 仅以
   additive 下载授权投影暴露服务端已核验的文件名、媒体类型、大小和校验值，不新增状态或写命令。Assets 只展示
   API 可证明的 `product_image` / `avatar_image` / `work_video`、Asset 与 AssetVersion 状态；作品视频保持系统登记
   只读，图片沿用现有上传、核验、管理和临时下载授权。用途与关联缺少 API 真值时明确说明，不由前端伪造。

每个已批准的实施分片独立 Issue、独立 Draft PR、独立浏览器回归；只有前一分片合并后才开始下一分片，且不自动部署。

Issue #193 将商品实物事实与画面呈现档位分开：ProductRevision 记录可选的高/宽/深、容量和重量，
VideoPlan 只使用飞影原生六档（智能适配/超大/大/中/小/超小）。#200 以完整六档、图片框与文字双标记及连续唯一选中
建立付费前 Provider DOM 真值；#201 以不放宽乐观锁的 terminal heartbeat drain 关闭 report 竞态；#202 恢复 failed 工单
持久终态。三项已合并部署。新单条真实复验证明选档与技术闭环通过，但也证明尺寸档位不等于包装保真：蓝色斜切瓶盖
被持续生成成宝石形。当前 Work 为 `rework_required`；再次生成须先有新的外观约束方案、独立批准和单条积分授权。

Issue #208 把本次形态漂移提升为通用商品身份一致性门禁。D-035 要求轮廓/几何、部件、颜色、比例、包装、Logo
与标签文字默认保持，姿势、视角、相对大小、光照与合理遮挡才可变化；自动检查、人工候选批准和最终 Works 内容
验收必须分别保留状态与审计证据。Fidelity-0 的一次获授权候选生成已证明精确源图 bytes 与 Provider 上传预览一致、
候选响应绑定 `gen_id` 与可读取 JPEG bytes、关闭上下文后可从同一受控 Profile 恢复候选，并可在候选确认和外层视频
提交前安全停下。它没有证明长期/跨设备生命周期、正式下载 API、Provider 评分、领域 AssetVersion 绑定或外观保真。

Fidelity-0 Evidence 已 accepted。Fidelity-A 的 `docs/product/PRODUCT_APPEARANCE_FIDELITY_DOMAIN_API.md` 已进入
`main` 并计为 designed：采用 ProductionOrder 前独立候选门禁，冻结 `source_asset_version_id` 与完整上游，
候选 bytes 进入系统管理 AssetVersion；不可变 Candidate、可变 CandidateState、有时效的 Provider Observation、exact
Check result、人工 AppearanceReview 与最终 WorkInspection 分别持有真值。Production 创建与 claim 分别绑定 exact
Observation，任一未知零 attempt 失败关闭；Fidelity-B 无法证明合理有效期或 claim-side 无副作用再观察时 Fidelity-D
必须停止。候选生成本身可能收费；本次恰好执行一次显示“150积分”的候选动作，
但精确余额变化未知。后续真实 capability probe、候选生成或 Fidelity-E 验收仍需当次明确单条授权。

Issue #214 / PR #215 已合并到 `main@c4abb792`，落地默认关闭的 capture request、内部候选
AssetVersion、Candidate/State/Observation、组织作用域 API、短任务 Worker 与 fake/disabled Adapter seam；创建 request
不调用 Provider，授权上限固定为一次，失败 terminal 且无 retry/resume。Observation 当前故意采用
`valid_until=observed_at` 的 same-gate-only 策略，不能被 Production 当成正 TTL。真实 Hifly capture/observe、合理有效期、
自动检查、人工审核、Production 门禁和真实验收继续分别属于 Fidelity-C～E，不由本切片提前实现。
PR #215 的独立审阅纠偏已覆盖默认 App/Asset 端口、服务端可信零时效、内部候选通用 API 隔离与 PostgreSQL
冻结/terminal 不可变回归；合并只改变 repository truth，不构成部署或 Provider 验收。

Issue #216 的 Fidelity-C0 gate 先验证可控检查能力，而不是先实现状态机：仓库目前没有 AppearanceCheckRun/Result、
AppearanceReview、视觉检查 Adapter 或已接受模型/阈值/误判/费用 Evidence。后续必须先完成 capability shortlist、逐维受控
benchmark、误放行/误阻断/unknown、费用与数据治理证据，并由 Owner 接受 policy/model version 和阈值；否则保持
`BLOCKED_CHECK_CAPABILITY_UNSELECTED`，不得用 fake 结果进入 Fidelity-C 实现。

Issue #218 / PR #219 的只读官方来源 shortlist 已进入 `main@8c9930f4`，当前仅本地 PaddleOCR/OpenCV 基线具备
进入独立受控 benchmark 的资格；OpenAI 固定 snapshot 与 Google Vertex AI 保持 reserve，混合方案保持 deferred。该资格不表示
benchmark 已开始。任何外部 API、图片上传或费用动作都继续要求 Owner 当次明确授权。在逐维
误放行、误阻断、unknown、延迟、费用与数据治理未实测并获接受前，Fidelity-C 实现继续关闭。

Issue #220 / PR #221 的 Fidelity-C2 readiness blocker 审计与 Issue #222 / PR #223 的 Fidelity-C3 准入合同已进入
`main@f8d63e7c`。C2 当时的 `DATASET_BLOCKER` + `ANNOTATION_BLOCKER` 已由 Fidelity-C4 仓库外受控包解除：4 个 exact
source/candidate 配对覆盖 4 类/4 商品族，4 samples x 7 axes 人工真值由不同角色盲审并 accepted，Owner 也已批准用途依据和
12 个月保留/复审/删除边界。Issue #224 / PR #225 已将仓库侧 acceptance 合并进入 `main@fb04b487`。
Issue #226 / PR #227 已设计并锁定可证明的环境与 harness 合同，Issue #228 / PR #229 已把 synthetic-only seam 合并进入
`main@4e352334`。合同保持 annotation axis/runtime dimension 双层映射和静态图像处理边界，不允许一对多真值复制、伪造
第八维或扩成视频能力。Issue #228 的 synthetic seam 使用 C4 同构字段，raw Evidence 固定 manifest/dataset/
source/candidate identity，scoring 拒绝跨数据集 truth，并以 exact version+content hash 锁定 mapping；假 lock 不得冒充真实环境。
逐样本/逐轴独立 review 必须完整且无未解决决定，顶层 accepted 不能覆盖 changes requested；infer/score 均按真实路径阻止直接或
经 symlink 写回受控数据包。Synthetic truth 必须使用 C4 exact pack/sample/review 审计字段；人工分歧的普通理由不能替代
`decision_note`。
Issue #230 / PR #231 的 C5a 首轮 Evidence 已进入 `main@4e18f116`，将 det/rec exact 参数 bytes 绑定到 PaddlePaddle 官方
Apache-2.0 模型卡与固定 LFS OID，但 BOS tar 的 archive-specific 复制/再分发边界仍未证明。Issue #232 / PR #233 又进入
`main@eab7758af94253aa22dd057f943f55d226f597b3`，接受两架构 resolver 不是 exact artifact/hash/license lock、PaddleX 精确要求
vulnerable contrib 4.10，以及 FFmpeg/Qt 义务和静态解码安全未接受的 blocker 真值。Issue #234 / PR #235 已进入
`main@677d79c2cc8256b7cb6661972b934b289c3b456d`，进一步只读核对：
OpenCV 4.14 patched artifacts 已存在，但最新固定 PaddleX `v3.7.2` 仍精确 pin 4.10，手工 contrib/headless 替换均非官方支持；
第一方 fixed model tree 也缺完整 SHA-256、license/notice scope 与替代 BOS tar 的官方声明。该合并只接受 successor Evidence，
不建立环境 lane。故完整 lock/cache、离线安装与 synthetic model smoke 继续 blocked；只有官方支持的 patched graph 或完整 model
route、逐 artifact 义务计划和安全 acceptance 全部解除后，才可另行决定是否授权 C5b。
`BLOCKED_CHECK_CAPABILITY_UNSELECTED` 保持不变，Fidelity-C 产品实现继续关闭。

Owner 已接受下一代运营工作台“方案 A：单任务工作区”方向。Issue #236 / PR #237 已将一个商品、一个稳定工作区、
一个当前阶段和一个唯一推荐动作的正式合同合并进入 `main@b7716acf`，并审计两项最小 additive seam：
project/product/stage 只读聚合投影，以及人物目录专用短时 preview authorization。人物预览必须绑定组织内真实
`avatar_image`、父 Asset `active`、版本 `available`；浏览器不获取内部素材 ID 或对象存储路径，首字只作为有原因的
失败占位。Stage 1 只读取商品资料；未迁移阶段固定为 `legacy/not_loaded` 并回既有页面，不伪造状态或动作。推荐动作使用
版本化、按 Goal additive 的 registry，未知或错阶段 code fail closed。Issue #238 / PR #239 已把 Stage 1 最小 shared
foundation、只读 Product Content 投影和商品资料 workspace 合并进入 `main@f87c2068`；canonical local/demo/production 启动链具有显式 default-off
配置，受控 demo 明确开启但继续使用 fake executor；legacy deep link 只绑定实时选中对象，dirty Back/Forward 与读取失败均
fail-visible 恢复。Issue #240 / PR #241 已把 Stage 2 文案实现合并进入 `main@c6ce4016`：只 additive 投影 exact
CopyVersion、生成、QC 与人工审核，并保持后续阶段 `legacy/not_loaded`。其投影固定使用 CopyGeneration newest-first
任务头；`needs_review` 仅复用既有 resolution API 提供接受理由、返回商品资料与人工修改，hard block 不可接受，AI
改写暂留既有 Copy 页面。Issue #242 / PR #243 已把 Stage 3 人物实现合并进入 `main@4293be0e`：只 additive 投影 exact
AvatarSelection、组织可见目录、授权/素材/能力门禁，并通过人物专用短时授权提供同一受控 `avatar_image` 版本的缩略图
与大图；memory 串行门禁与 PostgreSQL 组织级事务锁 + 同事务行锁关闭目录、私有绑定、父 Asset/Version 和 grant 之间的
interleaving，并消除预览与企业目录登记的相反锁序；bytes 响应还会按 grant 的 exact size/SHA-256 fail closed 复核。
公共响应不暴露私有素材绑定、object key 或 Provider/凭据数据；权威 refresh 与自然到期会撤下旧 `src`，授权/解码失败
使用带原因的首字 fallback；同商品 approved Copy 替换时保留旧人物选择为 `copy_version_changed` 失效历史，不把它误作
404 或有效确认。Issue #244 是 Stage 4 视频方案独立 acceptance gate：只 additive 投影 exact VideoPlan、preflight
run/result、人工审核与历史；方案创建、保存、派生、预检、提交审核、批准或要求修改仍使用既有 VideoPlanning API 与
状态机，且 preflight passed/warning 不等于人工批准。当前 Draft 的复审纠偏进一步锁定 preflight 真值优先级、计划链
exact identity/result-run 绑定、own-property action registry、同商品请求世代、首版保存、版本 Dialog 焦点、统一 409 恢复和
三视口确定性 preflight/focus matrix；只有 fixed head 独立 Review 合并后才计为实现。Stage 1/2/3 保持稳定，Stage 5 Production 继续
`legacy/not_loaded` 和零读取；对应 Draft PR 合并前不计为完成，也不授权 Stage 5。后续实现严格串行：Stage 5
Production、Post-stage 作品库、素材中心/移动收口。
作品库后续桌面验收固定为 9 项原型数据第 1 页 6 项、第 2 页 3 项，390 保持列表 -> 详情 -> 返回；分页必须使用真实
服务端集合真值，不得前端伪造。原型只是设计输入，不得直接合并；任何实现均不自动部署。
全部功能 Stage 完成并分别 Review 后，才另开独立视觉 refinement/research gate。PC 1440 主工作区与 768 收敛、移动
390 列表/详情分层须作为并行的一等合同：两端共享业务真值、动作和状态词，但 composition 可以不同；不得描述移动
高于 PC，也不得把桌面实现为放大的移动布局。两端都必须有真实 Chrome 行为/截图和人工视觉 acceptance 后才能合并
视觉实现；设计站点仅按 Hifly 自身工作流选择性取证，不复制不适合运营清晰度的实验交互。

Slice B 完成后的 successor gate 顺序已获 Owner 锁定。内部问题审计、定向外部研究和 Issue #174 的
`docs/frontend/OPERATOR_WORKBENCH_UX_V2_CONTRACT.md` 均已进入 `main`；V2 设计状态为 `designed`，但不等于实现、
部署或生产采用。Issue #176 / PR #177 已完成第一片 shared IA/content/control foundation，Issue #178 / PR #179
已完成 Production，Issue #180 / PR #181 已完成 Works，Issue #182 / PR #183 已完成 Assets，Issue #184 / PR #185
已完成 V2-E 回补审计。审计只接受两个严格串行的最小回补：V2-E1 已通过 Issue #186 / PR #187 完成
Projects/Project/Copy 的中文、刷新作用域与 Copy Tab 键盘语义；Issue #188 / PR #189 已完成 V2-E2 Avatar/Plan
中文、技术详情层级和 Plan Tab 键盘语义。两个页签回补均包含完整 ARIA 关系、单一 Tab 停靠点及
ArrowLeft/ArrowRight/Home/End 的焦点与选中同步。上述实现已部署并完成内部只读 UI 验收，但不自动授权扩 API，
也不代表客户采用。
不得以竞品视觉或页面结构反向决定本项目 IA。

## 4. 保留但不抢跑的工作

- #190/#191 已完成代码、独立 Review、统一部署与真实管理员只读复验；后续不得为重复确认这两项而启动 Worker 或生成视频。
- #200/#201/#202 已严格串行完成并部署；不得把本次技术成功、返工 Work 或已下载候选解释为再次生成授权。
- #208/#210 已建立并接受 Fidelity-0 有界 Provider Evidence；#212 Fidelity-A 合同、#214 Fidelity-B repository、#216
  Fidelity-C0 检查能力 gate、#218/#219 shortlist、#220 blocker 审计与 #222/#223 准入合同已进入 `main`。Owner 已接受
  Fidelity-C4 仓库外 exact bytes、用途依据、脱敏 manifest 与分离角色完成的七维人工真值；#224 / PR #225 已把该
  acceptance 固化进仓库。#226/#227 已完成环境与 harness 设计合同，#228/#229 已实现 synthetic validator/harness；#230/#231
  已完成 C5a 首轮官方 artifact/license/dependency Evidence，#232/#233 已接受后续 archive/license/security blocker Evidence；
  #234 / PR #235 只接受 patched lane/fixed model successor Evidence。BOS tar 再分发、两架构 exact artifact/license graph 与
  官方支持的 patched OpenCV lane 未解除前不得授权 C5b，C5b
  独立 Review 前也不得授权受控 benchmark。
  Fidelity-C～E 不得并行抢跑，也不得把设计、研究、fake Adapter 或 Provider Evidence 写成真实 Hifly 能力、部署或
  外观保真通过。
- 文案增强、人物推荐、背景/场景/姿势、动效精修、Capture HTTP、Local Agent 新功能、并行生产、复杂对象存储和高可用全部暂停。
- Local Agent 保留已验证代码但默认关闭，并从生产主路径/操作说明中退出；纯云端稳定至少 10 条或 1～2 周后再决定是否删除。
- 当前 2C4G/2C4G 级试运行服务器只证明内部功能闭环，不承诺正式生产 SLA。

## 5. 每波次门禁

1. 上游 Issue 已合并且 CI 通过。
2. CURRENT、Goal、Roadmap 与 Evidence 结论一致。
3. 实现任务有明确文件边界、状态合同、测试和非目标。
4. 真实费用、Secret、生产数据或云资源变更在执行前通过对应授权门禁；复用既有成功产物的下载/A12/Work 复验不重新生成。
5. `luna-worker` 负责边界明确的实现，Sol 独立 Review；不自动回退 Terra。
