# 项目 Roadmap

> 最后更新：2026-08-18
> 当前状态：Vertical Slice A、CE-08 与 P0.4 已完成；`main@db36cc53` 已部署到内部验收环境，运营工作台 V2 与 Issue #193 migration/只读 UI 验收通过。#190 已合并但尚未部署；#191 的窄修复只有随 accompanying implementation 合并进入 `main` 后才计为仓库完成。两项合并后的统一部署/复验、可信 TLS 与 #193 受控 Provider 效果验收仍是后续门禁

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
P1 UI  部署后条件通过收口：#190（已合并、待统一部署）→ #191（当前仓库修复；合并后再统一部署/复验）
P1 Product  #193 实物尺寸 + 飞影原生呈现大小（仓库实现、内部部署与只读验收已完成；受控 Provider 效果验收待执行）
P1+   上述内部试运行、release-readiness 与获批 UX 切片完成后，再决定产品增强与规模化
```

Cloud Executor 的权威范围、门禁和完成标准见 `docs/product/CLOUD_EXECUTOR_P0.md`；三条严格串行内部试运行由 #132 跟踪，Issue 已关闭并已补充最终验收证据；release-readiness 由 #156、#157 跟踪。

## 3. 下一阶段

`main@db36cc53` 与运营工作台 V2、Issue #193 已部署到内部验收环境。V2 真实管理员只读验收覆盖九页、三视口、入口/导航、
五阶段、QC/人工审核、preflight/人工批准、Works 终态动作、Assets 三类真值及 Tab 键盘合同；结论为带 #190/#191
两个 P1 条件通过，不是无条件验收。#190 的仓库修复已合并，只接受服务端 `kind=product_image`、Asset `active`、
AssetVersion `available` 的交集，并保持非商品图片与脏历史选择不能满足 Ready 或进入保存 payload。#191 当前严格
串行恢复 terminal Work 真值且不弱化 fail-closed 门禁；只有 accompanying implementation 合并后才计为仓库完成。
两项合并后再统一部署和真实管理员复验。可信 CA 证书仍缺正式域名、DNS、签发和部署实证，当前 HTTP `/healthz` 也尚未跳转 HTTPS；
必须按 `docs/deployment/TRUSTED_TLS_RELEASE_CHECKLIST.md` 完成严格 CA 与 HTTP→HTTPS 验收后，才能评估公网发布。
继续保持 Mac Local Agent 关闭、Cloud Executor 默认 disabled/fail-closed 与 concurrency=1；任何新增真实生成仍需新的授权和逐单门禁。

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
   所有 V2 切片已随 `main@5c6384d` 部署，部署后两个 P1 由 #190/#191 独立跟踪；#190 已合并，#191 当前修复，
   两项完成后统一部署复验。
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
VideoPlan 只使用飞影原生六档（智能适配/超大/大/中/小/超小）。映射与选中态已由当前飞影静态资源只读核实；
执行器必须在付费生成前验证选中档位，无法验证则 fail closed。该改动已完成内部部署、migration 与只读 UI/历史
snapshot 验收，但尚未执行真实付费出片或新尺寸效果验证；呈现大小不代表外观保真，瓶盖、包装、标签和形态仍由
Works 检查单独验收。#190 已合并，#191 继续按独立 P1 严格串行处理；两项仓库修复不因既有部署证据而视为已部署。

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

- #190 已合并，#191 仍须完成代码 RED/GREEN 与独立 Review；两项随后统一进入部署和真实管理员复验。
- 文案增强、人物推荐、背景/场景/姿势、动效精修、Capture HTTP、Local Agent 新功能、并行生产、复杂对象存储和高可用全部暂停。
- Local Agent 保留已验证代码但默认关闭，并从生产主路径/操作说明中退出；纯云端稳定至少 10 条或 1～2 周后再决定是否删除。
- 当前 2C4G/2C4G 级试运行服务器只证明内部功能闭环，不承诺正式生产 SLA。

## 5. 每波次门禁

1. 上游 Issue 已合并且 CI 通过。
2. CURRENT、Goal、Roadmap 与 Evidence 结论一致。
3. 实现任务有明确文件边界、状态合同、测试和非目标。
4. 真实费用、Secret、生产数据或云资源变更在执行前通过对应授权门禁；复用既有成功产物的下载/A12/Work 复验不重新生成。
5. `luna-worker` 负责边界明确的实现，Sol 独立 Review；不自动回退 Terra。
