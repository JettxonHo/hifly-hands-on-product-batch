# 运营单任务工作区 Stage 5 生产

> 执行日期：2026-08-24
> 固定基线：`origin/main@334a88198192121694ded34844f247c0ed983bbf`
> 治理入口：Issue #246；对应 Draft PR 是独立 acceptance gate
> 生命周期：只有 Draft PR 经独立复审并合并后，Stage 5 才计为仓库实现；本次没有部署或生产验收

## Product/API gate

- 现有 ProductionOrder workspace、manual handoff package、ManualExecution attempt/report、A12 verification 与
  Work/delivery API 已持有 Stage 5 所需持久化真值和写命令；本片不需要新增领域状态、数据库 migration、权限角色、
  组织队列、Worker 命令、自动重试或跨阶段写事务。
- operator workspace 只 additive 读取 exact selected ProductionOrder 及其 handoff/execution/A12/Work 链。Work/delivery 使用
  专用非写入 projection，不调用会建立 pending inspection 的通用作品读取。所有子对象在公开裁剪前必须绑定同一
  organization/project/product/order、canonical attempt、按 `report_version,id` 排序的 exact latest
  `execution_attempt_id` report、A12 job 及其 exact Work；缺失/非法 report version、旧 correction 链、错绑定、transient
  read 或 stale async 均 fail-visible，不以旧商品或旧工单补位。
- 浏览器不读取 Cloud Executor 状态，不推断 eligible、active attempts、Worker 在线状态或下一单资格。激活前继续由既有
  Production 服务端 gate 决定是否可创建；企业 Web 没有 Worker/Local Agent 启停、retry/reclaim 或自动下一单能力。
- Stage 1 商品资料、Stage 2 文案、Stage 3 人物与 Stage 4 视频方案继续使用已合并投影。Post-stage 作品库和素材中心没有
  在本片提前迁移；Stage 5 只在 Work 已存在时导航到既有 Works 深链。

## RED -> GREEN

1. Projection RED：基线 `stage=production` 仍为 `legacy/not_loaded`。GREEN 后 action registry 只 additive 增加 Stage 5
   动作，投影 selected order、package、attempt/report、A12 job 与 Work/delivery；unknown registry/code、wrong stage/kind、
   prototype key、对象错绑定与读取失败均零主动作 fail closed。
2. Terminal precedence RED：handoff 生命周期或无关读取错误可遮蔽 persisted succeeded + A12/Work 真值；旧 fixture
   还错误假设 A12 pending/failed 时 order 已 succeeded。GREEN 后 completed execution 的真实 order=running 阶段即可读取
   A12：无 job、queued/running、failed/requires_action 分别投影待核验、核验中和需处理；只有 A12 passed + Work 原子完成
   后才接受 order=succeeded 的作品真值。跨读取观察到 running order 与 succeeded verification/Work 时只允许 scoped refresh。
   此外，
   handoff 读取失败只改变交接资料摘要，并仅在 `waiting_for_executor` 阻断主任务；任何依赖 execution 的状态（含
   succeeded）读取失败均 fail-visible，verification/Work 错误只影响 succeeded，terminal Work 状态不依赖 package ready
   或 Worker/current order。
3. Default App/API RED：默认 operator workspace 不读取 Production 权威链，也不转发 order 深链。GREEN 后 default App
   仅在既有服务可用时 lazy 组装只读端口，精确绑定 project/product/order；安全 404/503 envelope 不泄露 cause、object key、
   Provider/credential 或内部路径。
4. Browser RED：生产阶段回旧页面，不能在单工作区呈现激活前、执行、失败、A12 与 Work 状态。GREEN 后复用既有
   Production/handoff 命令，业务主层显示每态唯一安全下一步；attempt、report、handoff 与内部 ID 只在折叠技术详情。
5. Recovery RED：旧请求、商品切换、Back/Forward、initial/scoped failure 与 response unknown 可留下 stale 商品/工单，
   创建请求在响应丢失后用新 key 重试还可形成第二个工单。GREEN 后每次读取使用 request epoch + exact product/order；
   失败清空五组业务摘要、技术 ID、旧 notice 与展开详情，只保留 scoped refresh。一个 Dialog 创建意图固定一个
   Idempotency-Key；408、5xx、404/409/422 或网络未知响应先撤销旧写权限并权威重读，只有重读后仍可创建才允许新的
   意图/key；handoff 命令使用同一 ambiguity gate，不会把已提交但响应丢失误作可再次生成。accepted product/popstate
   一开始即重绘 exact 商品选中态并清除上一商品摘要、同步状态和技术对象，读失败后仍保持目标商品选中。
6. Responsive RED：基线没有 Stage 5 单任务 composition。GREEN 后 1440 保持商品、工单/当前任务和辅助上下文并列，768
   独立收敛为两栏，390 使用商品列表 -> 生产详情 -> 工单列表/详情的分层返回。三个视口分别验证焦点、reduced-motion、
   唯一主动作与无页面级横向滚动。

## 实现边界

- 本片仅对现有 default-off operator workspace 做 additive targeted upgrade，不改变 ProductionOrder、ManualExecution、A12、
  Work 或 delivery 状态机，不新增 API 写命令、DB schema、依赖、Worker 控制面或组织队列。
- `failed` / `requires_action` / cancelled 均停批；不会显示重试、重新领取或创建下一单。`succeeded` 只按 exact A12 与
  Work/delivery 真值推进，Work 读取失败只允许刷新当前工单。
- screenshot 与 browser fixture 只证明仓库内 synthetic public seam，不是部署、真实 Worker、Provider、生产数据或积分证据。

## 精确 allowlist

1. `.github/workflows/ci.yml`
2. `docs/ROADMAP.md`
3. `docs/status/CURRENT.md`
4. `docs/status/sessions/2026-08-24-operator-single-workspace-stage-5-production.md`
5. `src/operator-workspace/operator-workspace-service.js`
6. `src/server/app.js`
7. `src/server/routes/operator-workspace.js`
8. `test/operator-single-workspace-stage-5-browser.test.js`
9. `test/manual-handoff-package-postgres.integration.test.js`
10. `test/operator-workspace-service.test.js`
11. `test/project-content-api.test.js`
12. `test/work-delivery-postgres.integration.test.js`
13. `web/project.js`
14. `web/workspace-production.js`
15. `web/workspace.css`
16. `web/workspace.html`
17. `src/work-delivery/work-delivery-service.js`
18. `test/work-delivery-service.test.js`

首轮独立复审 head `0b6fb1a6f3be30db6c6c1defdabb6fb1577c803e` 的六组 RED 证明：通用 Work 读取会产生
inspection/audit/ledger 写入；report 使用错误字段且 attempt/A12/Work 可串链；创建响应丢失可产生新 key；scoped 503
残留完整旧工单；390 返回聚焦 detached button；辅助上下文仍停在商品资料占位。修正后的 memory/default-App/PG 合同、
公开 API 与真实 Chrome regression 分别锁定零写、exact chain、安全恢复、connected exact order focus 和三视口同源业务上下文。
最终 fixed-head 测试与 CI 数字以本 session 后续验证记录及 PR 结果评论为准，不把旧 head 的绿色测试当作修复证明。

后续同一 repair checkpoint 继续锁定：execution/verification raw child order 的 organization 必须在公开裁剪前 exact；父
execution 读取失败时 A12/Work 为零读取；A12/Work 必须绑定 current attempt 的 latest report，v2 correction 后不得继续显示
v1 Work；verification read error 优先于任何旧 passed 摘要；create 与 handoff 的 committed-but-503 只做权威重读；商品切换
读取窗口立即清空上一商品真值。上述变更仍只使用已 checkpoint 的 18-file allowlist。

`.github/workflows/ci.yml` 的扩张已在 Issue #246 编辑前 checkpoint；它只把既有 ProductionOrder -> handoff ->
ManualExecution -> A12 -> Work/delivery PostgreSQL integration 串行加入 required `identity-postgres` job，不改变运行时行为。
第二次 fixed-head CI 首次真正执行了既有 ManualHandoff PostgreSQL integration，也暴露其 `input_snapshot` fixture 仍早于
当前交接包合同。Issue/PR 已在编辑前追加 checkpoint；测试只补齐 exact ready ProductRevision 与素材 checksum、approved
Copy、confirmed Avatar 及内部 asset resolver，继续要求现有 compiler 在完整证据下生成 `ready`，不放宽 fail-closed 校验。

## 验证

- service/API、非写 Work projection 与既有 Production authority 受影响组：60/60 pass；Stage 5 公开真实 Chrome
  6/6 pass，覆盖 1440/768/390、A12 真实 running-order 矩阵、response-unknown、商品 authority 切换与恢复。
- Stage 1 至 Stage 5 加 legacy Production 的并行真实 Chrome 组合首次 24/25：唯一失败是已经单独通过的 Stage 5
  committed-503 用例在多浏览器并行下等待 30 秒超时；同一 exact 用例随后独立 1/1 自然通过。该历史保留，不把重跑
  当作首次全组通过。
- 本地默认 `npm test` 未改变并发或跳过参数启动；运行至 `assets-browser` 50 项均无断言失败后，已通过的 Playwright
  子进程及 Chrome 连续 0% CPU 且不退出，人工终止为 exit 130。该运行不计为 full pass；exact fixed-head Ubuntu/Windows
  required CI 必须自然完成默认套件，才能作为最终全量证据。`npm run check`、`git diff --check` 与严格 allowlist 的最终
  数字以提交前复核及 PR 结果评论为准。
- 本机没有可用 PostgreSQL daemon，不能把 environment-gated skip 冒充本地 PostgreSQL 通过；required
  `identity-postgres` 必须在 exact fixed head 自然执行上述五段既有 integration，并与 Ubuntu/Windows 一同 SUCCESS。
- official-registry `npm audit --omit=dev --audit-level=high`：0 high/critical、2 个既有 moderate，均来自
  `exceljs -> uuid`；本片未执行 breaking `--force` 修复。
- 1440x900、768x900、390x844 临时截图只写入 Git 外临时目录；SHA-256 分别为
  `01842962fd36d93f087c5752c48c7ae4f5c97fcbbd8f5137cd588e1fe26c262a`、
  `13d1c5b9138332333b235e70338bd4fa8f4082076f4b26a405bb906099f2d64a`、
  `92ccfc9a0f28bc269c2fbf8c341208640883a8527cbc398c30e34bb89293e4e8`。截图二进制不提交；它们只证明
  synthetic browser seam 的响应式 composition，不是部署或生产数据证据。
- fixed-head CI 的最终 commit、run 与三项 required check 结果以 Draft PR 元数据和结果评论为准；session 不在提交
  正文中自引用自身最终 head。
- 首个 Draft head 的 CI run `32737416941` 如实失败：Ubuntu/Windows 的默认套件发现 Stage 5 browser fixture 缺少既有的
  “系统 Chrome 不可用时环境门禁 skip”，各 4 条错误尝试 macOS Chrome 路径；`identity-postgres` 又发现五个会重置同一
  测试库的 integration 被单个 `node --test` 并行执行，产生 package/work delivery 串扰。修复只让 browser fixture 与
  Stage 1 至 Stage 4 同构，并把五段既有 PostgreSQL integration 明确串行；没有修改领域状态或弱化断言。后续 fixed-head
  CI 必须在新提交上自然三绿，不能以重跑旧 head 代替。
- 后续 head 的 CI run `32737781842` 已令 Ubuntu/Windows 自然 SUCCESS；`identity-postgres` 在新增 required 链首次执行
  ManualHandoff PostgreSQL integration 时得到 `generation_failed`。该测试的旧 fixture 缺少当前 manifest compiler 必需的
  冻结商品/素材、已批准文案和已确认人物证据；本地没有 PostgreSQL，因此不会把 skip 记为 GREEN。修正后的新 fixed head
  必须让该 integration 及后续 ManualExecution/A12/Work delivery 段自然完成，不能重跑旧 head 掩盖失败。
- CI run `32738363155` 已证明修正后的 ManualHandoff、ManualExecution 与 A12 PostgreSQL integration 自然通过；最后一段
  WorkDelivery 暴露既有并发测试的非确定性：测试已识别并回放实际 winning payload，却在后续 rework 后硬编码回放 input 0。
  若 input 1 赢得事务，repository 正确返回 `IDEMPOTENCY_CONFLICT`。测试修正只复用已记录的 exact winner，不改变
  WorkDelivery receipt、冲突或状态机语义；最终新 fixed head 仍须让整条链和其后 required tests 自然完成。

## 未执行边界

没有开始 Post-stage 作品库或素材中心实现；没有新增领域状态、DB migration、依赖、组织队列或 Worker 命令；没有部署、
SSH、访问 Hifly/Provider、启动 Worker/Local Agent、修改生产数据、创建或重试真实工单、生成候选/视频或消耗积分。
