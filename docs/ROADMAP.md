# 项目 Roadmap

> 最后更新：2026-08-20
> 当前状态：Vertical Slice A、CE-08 与 P0.4 已完成；#200/#201/#202 已合并，并随 `main@8787b60c` 部署到内部验收环境。新单条 `small` Provider 复验的商品呈现大小 PASS，但外观保真 FAIL，Work 已登记返工且没有交付或重试。Fidelity-0 Evidence 与 Fidelity-A 设计已进入 `main`；Issue #214 / 对应 Draft PR 是 Fidelity-B 默认关闭的 capture/storage/API 仓库实现 acceptance gate。该 gate 不代表真实 Hifly Adapter、Fidelity-C～E、部署或外观保真已完成。系统保持 disabled/fail-closed；可信 TLS 仍待独立门禁

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
P1 Fidelity #208 DSE accepted → #210 Fidelity-0 Evidence accepted → #212 Fidelity-A designed → #214 Fidelity-B capture/storage/API acceptance gate（默认 disabled、same-gate-only observation；进入 main 才 repository implemented）→ Fidelity-C～E 未开始
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

Issue #214 / 对应 Draft PR 是 Fidelity-B 的 acceptance gate。合并后仅落地默认关闭的 capture request、内部候选
AssetVersion、Candidate/State/Observation、组织作用域 API、短任务 Worker 与 fake/disabled Adapter seam；创建 request
不调用 Provider，授权上限固定为一次，失败 terminal 且无 retry/resume。Observation 当前故意采用
`valid_until=observed_at` 的 same-gate-only 策略，不能被 Production 当成正 TTL。真实 Hifly capture/observe、合理有效期、
自动检查、人工审核、Production 门禁和真实验收继续分别属于 Fidelity-C～E，不由本切片提前实现。

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
- #208/#210 已建立并接受 Fidelity-0 有界 Provider Evidence；#212 Fidelity-A 合同已进入 `main`。#214 是
  Fidelity-B 仓库实现 acceptance gate；Fidelity-C～E 不得并行抢跑，也不得把设计、fake Adapter 或 Provider Evidence
  写成真实 Hifly 能力、部署或外观保真通过。
- 文案增强、人物推荐、背景/场景/姿势、动效精修、Capture HTTP、Local Agent 新功能、并行生产、复杂对象存储和高可用全部暂停。
- Local Agent 保留已验证代码但默认关闭，并从生产主路径/操作说明中退出；纯云端稳定至少 10 条或 1～2 周后再决定是否删除。
- 当前 2C4G/2C4G 级试运行服务器只证明内部功能闭环，不承诺正式生产 SLA。

## 5. 每波次门禁

1. 上游 Issue 已合并且 CI 通过。
2. CURRENT、Goal、Roadmap 与 Evidence 结论一致。
3. 实现任务有明确文件边界、状态合同、测试和非目标。
4. 真实费用、Secret、生产数据或云资源变更在执行前通过对应授权门禁；复用既有成功产物的下载/A12/Work 复验不重新生成。
5. `luna-worker` 负责边界明确的实现，Sol 独立 Review；不自动回退 Terra。
